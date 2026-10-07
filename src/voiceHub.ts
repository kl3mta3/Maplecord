import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { CallDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import type { SfuPassDto } from './types'

/** The server did not recognise what it was asked: it is older than this app. */
const unknownMethod = (e: unknown) => /does not exist|unknown hub method/i.test(e instanceof Error ? e.message : String(e))

export interface VoiceEvents {
  VoiceMoved: () => void
  VoiceRemoved: () => void
  ParticipantJoined: (channelId: string, p: VoiceParticipantDto) => void
  ParticipantLeft: (channelId: string, userId: string, connectionId: string) => void
  ParticipantUpdated: (channelId: string, p: VoiceParticipantDto) => void
  SignalReceived: (channelId: string, s: VoiceSignalDto) => void
  CallIncoming: (call: CallDto) => void
  CallAnswered: (call: CallDto) => void
  CallEnded: (callId: string, outcome: string) => void
  StreamWatchRequested: (viewerConnectionId: string, viewerUserId: string, viewerName: string) => void
  StreamWatchEnded: (connectionId: string) => void
  StreamSignalReceived: (fromConnectionId: string, kind: string, payload: string) => void
  StreamViewersChanged: (streamerConnectionId: string, viewers: number) => void
  StreamEnded: (streamerConnectionId: string, reason: string) => void
}

/** Voice hub: membership + WebRTC signaling relay. Audio never goes through this connection. */
export class VoiceHub {
  private conn: HubConnection | null = null
  private serverUrl: () => string
  private token: () => string | null
  constructor(serverUrl: () => string, token: () => string | null) { this.serverUrl = serverUrl; this.token = token }

  get connectionId() { return this.conn?.connectionId ?? null }

  /** The connection came back after a drop. The server has forgotten which voice channel we were in. */
  onReconnected: (() => void) | null = null
  /** The connection is gone and will not be retried. */
  onClosed: (() => void) | null = null

  private connecting: Promise<void> | null = null

  async connect(handlers: VoiceEvents) {
    if (this.connecting) return this.connecting
    if (this.conn && this.conn.state !== HubConnectionState.Disconnected) return
    this.connecting = this.connectCore(handlers).finally(() => { this.connecting = null })
    return this.connecting
  }

  private async connectCore(handlers: VoiceEvents) {
    await this.disconnect()
    const conn = new HubConnectionBuilder()
      .withUrl(this.serverUrl().replace(/\/$/, '') + '/hubs/voice', { accessTokenFactory: () => this.token() ?? '', withCredentials: false })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()
    for (const [name, handler] of Object.entries(handlers)) conn.on(name, handler as (...args: unknown[]) => void)
    conn.onreconnected(() => this.onReconnected?.())
    conn.onclose(() => { if (this.conn === conn) this.onClosed?.() })
    await conn.start()
    this.conn = conn
  }

  async disconnect() {
    const c = this.conn
    this.conn = null
    if (c) { try { await c.stop() } catch { /* gone */ } }
  }

  private get c() { if (!this.conn) throw new Error('Voice not connected.'); return this.conn }

  join(channelId: string) { return this.c.invoke<VoiceParticipantDto[]>('JoinVoice', channelId) }
  /**
   * Join an ordinary voice channel. Where its voice goes through a stream server the reply carries a pass to it;
   * otherwise voice connects app to app. A server from before stream servers is asked the old way.
   */
  async joinVia(channelId: string): Promise<{ others: VoiceParticipantDto[]; pass: SfuPassDto | null }> {
    try {
      const joined = await this.c.invoke<{ others: VoiceParticipantDto[]; pass?: SfuPassDto | null }>('JoinVoiceVia', channelId)
      return { others: joined.others, pass: joined.pass ?? null }
    } catch (e) {
      if (!unknownMethod(e)) throw e
      return { others: await this.join(channelId), pass: null }
    }
  }
  /** A fresh pass for the voice channel we are in, after the stream server was lost. */
  async voicePass(): Promise<SfuPassDto | null> { return (await this.c.invoke<SfuPassDto | null>('VoicePass')) ?? null }
  /** The only way into a P2P voice channel. Called after the person has read the warning and agreed, never otherwise. */
  joinDirect(channelId: string) { return this.c.invoke<VoiceParticipantDto[]>('JoinDirectVoice', channelId) }
  leave() { return this.c.invoke('LeaveVoice') }
  /** Takes someone else out of a voice channel on a server. The server decides whether we may. */
  disconnectMember(channelId: string, userId: string) { return this.c.invoke('DisconnectMember', channelId, userId) }
  /** Call the friend we share this direct-message channel with. Relayed unless `direct`. */
  startCall(channelId: string, direct: boolean) { return this.c.invoke<CallDto>('StartCall', channelId, direct) }
  /** Answer a call. `direct` is the kind the person was shown; the server refuses if the call is of the other kind. */
  joinCall(callId: string, direct: boolean) { return this.c.invoke<VoiceParticipantDto[]>('JoinCall', callId, direct) }
  declineCall(callId: string) { return this.c.invoke('DeclineCall', callId) }
  signal(targetConnectionId: string, kind: 'offer' | 'answer' | 'ice', payload: string) { return this.c.invoke('Signal', targetConnectionId, kind, payload) }
  setMuted(muted: boolean) { return this.c.invoke('SetMuted', muted) }
  /**
   * Tell the channel we are sharing. Where the channel has a stream server the reply is a pass to send the video
   * there once; otherwise null, and each viewer is connected to one by one. A server from before stream servers
   * does not know the question, and is asked the old way.
   */
  async shareStream(kind: string): Promise<SfuPassDto | null> {
    try { return (await this.c.invoke<SfuPassDto | null>('ShareStream', kind)) ?? null }
    catch (e) {
      if (!unknownMethod(e)) throw e
      await this.c.invoke('StartStream', kind)
      return null
    }
  }
  /** Ask to watch a stream. The reply is a pass when it is being sent through a stream server; otherwise null, and the sharer's app connects to ours. */
  async watchStreamVia(streamerConnectionId: string): Promise<SfuPassDto | null> {
    try { return (await this.c.invoke<SfuPassDto | null>('WatchStreamVia', streamerConnectionId)) ?? null }
    catch (e) {
      if (!unknownMethod(e)) throw e
      await this.c.invoke('WatchStream', streamerConnectionId)
      return null
    }
  }
  startStream(kind: string) { return this.c.invoke('StartStream', kind) }
  stopStream(reason: string | null = null) { return this.c.invoke('StopStream', reason) }
  watchStream(streamerConnectionId: string) { return this.c.invoke('WatchStream', streamerConnectionId) }
  unwatchStream(streamerConnectionId: string) { return this.c.invoke('UnwatchStream', streamerConnectionId) }
  streamSignal(target: string, kind: string, payload: string) { return this.c.invoke<void>('StreamSignal', target, kind, payload) }
}
