import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { VoiceParticipantDto, VoiceSignalDto } from './types'

export interface VoiceEvents {
  ParticipantJoined: (channelId: string, p: VoiceParticipantDto) => void
  ParticipantLeft: (channelId: string, userId: string, connectionId: string) => void
  ParticipantUpdated: (channelId: string, p: VoiceParticipantDto) => void
  SignalReceived: (channelId: string, s: VoiceSignalDto) => void
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
  leave() { return this.c.invoke('LeaveVoice') }
  signal(targetConnectionId: string, kind: 'offer' | 'answer' | 'ice', payload: string) { return this.c.invoke('Signal', targetConnectionId, kind, payload) }
  setMuted(muted: boolean) { return this.c.invoke('SetMuted', muted) }
}
