import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { CallDto, VoiceParticipantDto, VoiceSignalDto } from './types'

export interface VoiceEvents {
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
  /** The only way into a P2P voice channel. Called after the person has read the warning and agreed, never otherwise. */
  joinDirect(channelId: string) { return this.c.invoke<VoiceParticipantDto[]>('JoinDirectVoice', channelId) }
  leave() { return this.c.invoke('LeaveVoice') }
  /** Call the friend we share this direct-message channel with. Relayed unless `direct`. */
  startCall(channelId: string, direct: boolean) { return this.c.invoke<CallDto>('StartCall', channelId, direct) }
  /** Answer a call. `direct` is the kind the person was shown; the server refuses if the call is of the other kind. */
  joinCall(callId: string, direct: boolean) { return this.c.invoke<VoiceParticipantDto[]>('JoinCall', callId, direct) }
  declineCall(callId: string) { return this.c.invoke('DeclineCall', callId) }
  signal(targetConnectionId: string, kind: 'offer' | 'answer' | 'ice', payload: string) { return this.c.invoke('Signal', targetConnectionId, kind, payload) }
  setMuted(muted: boolean) { return this.c.invoke('SetMuted', muted) }
  startStream(kind: string) { return this.c.invoke('StartStream', kind) }
  stopStream(reason: string | null = null) { return this.c.invoke('StopStream', reason) }
  watchStream(streamerConnectionId: string) { return this.c.invoke('WatchStream', streamerConnectionId) }
  unwatchStream(streamerConnectionId: string) { return this.c.invoke('UnwatchStream', streamerConnectionId) }
  streamSignal(target: string, kind: string, payload: string) { return this.c.invoke<void>('StreamSignal', target, kind, payload) }
}
