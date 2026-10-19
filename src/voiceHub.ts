import { connectionIdOf, hubOptions } from './hubConnect'
import { voiceRecorder } from './voiceReport'
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { CallDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import type { SfuPassDto } from './types'
import { makeSealer, seal, unseal, type Sealer } from './p2pIdentity'
import { canEncryptMedia } from './sealedRoom'

/**
 * A P2P voice channel or call we are in. The set-up messages apps pass through the server there carry the addresses
 * they can be reached at, so each one is encrypted to the app it is for: the server carries them and cannot read
 * them. Every app in such a call has presented a one-off key, signed with its registered signing key, and the
 * server lists it with that person; two apps arrive at the same secret from each other's.
 */
interface SealedRoom {
  channelId: string
  /** The key shared with each other app here, by its connection. Null for one that gave no key that holds. */
  keys: Map<string, Promise<{ key: CryptoKey; theirs: string } | null>>
}
/** The set-up messages that carry addresses. */
const CARRIES_ADDRESSES = new Set(['offer', 'answer', 'ice'])

/** The server did not recognise what it was asked: it is older than this app. */
const unknownMethod = (e: unknown) => /does not exist|unknown hub method/i.test(e instanceof Error ? e.message : String(e))

export interface VoiceEvents {
  /** Someone in our voice channel played one of the server's sounds. */
  SoundPlayed: (channelId: string, userId: string, expressionId: string, url: string) => void
  VoiceMoved: () => void
  VoiceRemoved: () => void
  /** Someone who may move members is moving us into another voice channel. */
  VoiceSent: (toChannelId: string) => void
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

  get connectionId() { return this.ownId ?? this.conn?.connectionId ?? null }
  private ownId: string | null = null
  /** The place in voice this app had before its connection dropped, to take back (see resumeVoice). */
  private resumeFrom: string | null = null
  private silencedBefore = false
  /** What the rest of the app is told about the people in voice, as wired up at connect. */
  private handlers: VoiceEvents | null = null

  // ---- Sealing (see SealedRoom) ---------------------------------------------------------------------------------------

  /** This app's registered signing key, and how to sign with it. Set by whoever owns the hub; without it nothing P2P can be joined. */
  identity: (() => Promise<{ keyId: string; sign(text: string): Promise<string> }>) | null = null
  /** Someone is in a P2P voice channel with us: the moment to notice an app this device has not seen them use before. */
  onMet: ((channelId: string, who: VoiceParticipantDto) => void) | null = null

  private sealer: Promise<Sealer> | null = null
  /** The same, once it is made: at hand without waiting. */
  private sealerNow: Sealer | null = null
  /** The connection the server has been told our sealing key on. */
  private presentedOn: string | null = null
  private sealed: SealedRoom | null = null
  /** Set-up messages to and from each app are handled one after another, so they arrive in the order they were made. */
  private outbox = new Map<string, Promise<unknown>>()
  private inbox = new Map<string, Promise<unknown>>()

  /** Tells the server which key this app seals with, once per connection. Has to be done before anything P2P. */
  private async present(): Promise<Sealer> {
    if (!this.identity) throw new Error('This app cannot seal P2P connections, so P2P calls cannot be used in it.')
    const mine = await this.identity()
    if (!this.sealer) {
      const made = makeSealer(mine.sign)
      this.sealer = made
      made.catch(() => { if (this.sealer === made) this.sealer = null })
    }
    const sealer = this.sealerNow = await this.sealer
    if (this.presentedOn !== this.connectionId) {
      await this.c.invoke('SealWith', mine.keyId, sealer.hello)
      this.presentedOn = this.connectionId
    }
    return sealer
  }

  /** We are now in a P2P call: work out the key shared with each app already there. */
  private open(channelId: string, sealer: Sealer, others: VoiceParticipantDto[]) {
    this.sealed = { channelId, keys: new Map() }
    this.outbox.clear(); this.inbox.clear()
    for (const other of others) this.meet(sealer, other)
  }

  private meet(sealer: Sealer, who: VoiceParticipantDto) {
    if (!this.sealed) return
    const channelId = this.sealed.channelId
    this.sealed.keys.set(who.connectionId, who.seal && who.publicKey ? sealer.keyWith(who.seal, who.publicKey, channelId).catch(() => null) : Promise.resolve(null))
    if (who.publicKey) this.onMet?.(channelId, who)
  }

  /**
   * Whether we cannot be heard in the call we are in (no right to speak there, or muted by a moderator). The server
   * says so just before it answers a join, so it is known here by the time the join returns.
   */
  selfSilenced = false

  private shut() { this.sealed = null; this.selfSilenced = false; this.outbox.clear(); this.inbox.clear() }

  /** One thing after another for one app, whatever each takes. */
  private inTurn(line: Map<string, Promise<unknown>>, who: string, work: () => Promise<void>): Promise<void> {
    const next = (line.get(who) ?? Promise.resolve()).then(work, work)
    line.set(who, next.catch(() => {}))
    return next
  }

  /** Sends one set-up message, sealed to the app it is for when we are in a P2P call. `about` keeps voice and video apart. */
  private send(method: 'Signal' | 'StreamSignal', about: string, target: string, kind: string, payload: string): Promise<void> {
    const room = this.sealed
    if (!room || !CARRIES_ADDRESSES.has(kind)) {
      // Not sealed, but still in its turn behind anything that is.
      return room ? this.inTurn(this.outbox, target, async () => { await this.c.invoke(method, target, kind, payload) }) : this.c.invoke<void>(method, target, kind, payload)
    }
    return this.inTurn(this.outbox, target, async () => {
      const [mine, theirs] = [this.sealerNow, await room.keys.get(target)]
      if (!mine || !theirs) throw new Error('That app gave no key to seal set-up messages with.')
      if (this.sealed !== room) return
      await this.c.invoke(method, target, kind, await seal(theirs.key, payload, `${about}\n${kind}\n${mine.publicKey}`))
    })
  }

  /** Opens one set-up message that arrived, in its turn, and hands it on. One that was not sealed by that app, for us, as that kind, is dropped. */
  private take(about: string, from: string, kind: string, payload: string, deliver: (payload: string) => void) {
    const room = this.sealed
    if (!room) { deliver(payload); return }
    void this.inTurn(this.inbox, from, async () => {
      if (!CARRIES_ADDRESSES.has(kind)) { if (this.sealed === room) deliver(payload); return }
      const theirs = await room.keys.get(from)
      const opened = theirs ? await unseal(theirs.key, payload, `${about}\n${kind}\n${theirs.theirs}`) : null
      if (opened !== null && this.sealed === room) deliver(opened)
    })
  }

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
      .withUrl(this.serverUrl().replace(/\/$/, '') + `/hubs/voice?app=${encodeURIComponent(__APP_VERSION__)}&e2ee=${canEncryptMedia() ? 1 : 0}`, await hubOptions(this.serverUrl(), { accessTokenFactory: () => this.token() ?? '', withCredentials: false }))
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()
    // What passes through here on its way to the rest of the app: who is in a P2P call with us (their keys), and
    // the set-up messages, which are opened before anything else sees them.
    const wired: VoiceEvents = {
      ...handlers,
      ParticipantJoined: (channelId, p) => {
        if (this.sealed?.channelId === channelId && this.sealerNow) this.meet(this.sealerNow, p)
        handlers.ParticipantJoined(channelId, p)
      },
      ParticipantUpdated: (channelId, p) => {
        if (p.connectionId === this.connectionId) this.selfSilenced = !!p.silenced
        handlers.ParticipantUpdated(channelId, p)
      },
      ParticipantLeft: (channelId, userId, connectionId) => {
        if (this.sealed?.channelId === channelId) { this.sealed.keys.delete(connectionId); this.outbox.delete(connectionId); this.inbox.delete(connectionId) }
        handlers.ParticipantLeft(channelId, userId, connectionId)
      },
      SignalReceived: (channelId, s) => {
        if (this.sealed && this.sealed.channelId !== channelId) return
        this.take('voice', s.fromConnectionId, s.kind, s.payload, payload => handlers.SignalReceived(channelId, { ...s, payload }))
      },
      StreamSignalReceived: (from, kind, payload) => this.take('stream', from, kind, payload, opened => handlers.StreamSignalReceived(from, kind, opened)),
    }
    for (const [name, handler] of Object.entries(wired)) conn.on(name, handler as (...args: unknown[]) => void)
    this.handlers = wired
    // After a drop the server has forgotten both the call we were in and the key we presented.
    // Why it dropped goes in the voice report: a closed connection, or a server that stopped answering for 30 seconds.
    conn.onreconnecting(error => { if (this.ownId) this.resumeFrom = this.ownId; this.silencedBefore = this.selfSilenced; this.ownId = null; voiceRecorder.note(`The voice connection to the Maplecord server dropped (${error?.message ?? 'no reason given'}); reconnecting.`) })
    // A connection that came back is a new one to the server, with a new id; it is known before the app rejoins anything with it.
    conn.onreconnected(() => { voiceRecorder.note('The voice connection to the Maplecord server came back.'); this.shut(); this.presentedOn = null; void connectionIdOf(conn).then(id => { this.ownId = id; this.onReconnected?.() }) })
    conn.onclose(() => { this.shut(); this.presentedOn = null; if (this.conn === conn) this.onClosed?.() })
    await conn.start()
    this.ownId = await connectionIdOf(conn)
    this.conn = conn
  }

  async disconnect() {
    const c = this.conn
    this.conn = null
    this.ownId = null
    if (c) { try { await c.stop() } catch { /* gone */ } }
  }

  private get c() { if (!this.conn) throw new Error('Voice not connected.'); return this.conn }

  join(channelId: string) { this.shut(); return this.c.invoke<VoiceParticipantDto[]>('JoinVoice', channelId) }
  /**
   * Join an ordinary voice channel. Where its voice goes through a stream server the reply carries a pass to it;
   * otherwise voice connects app to app. A server from before stream servers is asked the old way.
   */
  async joinVia(channelId: string): Promise<{ others: VoiceParticipantDto[]; pass: SfuPassDto | null }> {
    this.shut()
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
  /**
   * The only way into a P2P voice channel. Called after the person has read the warning and agreed, never otherwise.
   * From here until we leave, set-up messages are sealed between the apps in it.
   */
  async joinDirect(channelId: string) {
    this.shut()
    const sealer = await this.present()
    const others = await this.c.invoke<VoiceParticipantDto[]>('JoinDirectVoice', channelId)
    this.open(channelId, sealer, others)
    return others
  }
  leave() { this.shut(); return this.c.invoke('LeaveVoice') }
  /** Takes someone else out of a voice channel on a server. The server decides whether we may. */
  disconnectMember(channelId: string, userId: string) { return this.c.invoke('DisconnectMember', channelId, userId) }
  /** Move someone from one voice channel of a server into another (neither a P2P one), for people who may move members. */
  moveMember(fromChannelId: string, userId: string, toChannelId: string) { return this.c.invoke('MoveMember', fromChannelId, userId, toChannelId) }
  /** Call the friend we share this direct-message channel with. Relayed unless `direct`. */
  async startCall(channelId: string, direct: boolean) {
    this.shut()
    const sealer = direct ? await this.present() : null
    const call = await this.c.invoke<CallDto>('StartCall', channelId, direct)
    // A P2P call: sealed from the start. The friend's key arrives with them when they answer.
    if (sealer) this.open(call.channelId, sealer, [])
    return call
  }
  /** Answer a call. `direct` is the kind the person was shown; the server refuses if the call is of the other kind. */
  async joinCall(callId: string, direct: boolean, channelId: string) {
    this.shut()
    const sealer = direct ? await this.present() : null
    const others = await this.c.invoke<VoiceParticipantDto[]>('JoinCall', callId, direct)
    if (sealer) this.open(channelId, sealer, others)
    return others
  }
  declineCall(callId: string) { return this.c.invoke('DeclineCall', callId) }
  signal(targetConnectionId: string, kind: 'offer' | 'answer' | 'ice', payload: string) { return this.send('Signal', 'voice', targetConnectionId, kind, payload) }
  setMuted(muted: boolean) { return this.c.invoke('SetMuted', muted) }
  /** Plays one of the server's sounds to everyone in our voice channel. */
  playSound(expressionId: string) { return this.c.invoke('PlaySound', expressionId) }

  /**
   * After the connection dropped and came back: takes back the place in voice this app had, if the server kept it
   * for us (it does where the channel's sound goes through a stream server, for a few seconds, and for a phone app
   * in the background for as long as the phone checks in). Nothing about the call stops: the sound never went through this connection. The people in the channel are brought up to date with
   * whatever changed meanwhile. False if the place was not kept (or the server does not keep places): the app then
   * joins again as it always did.
   */
  async resumeVoice(channelId: string, known: readonly { connectionId: string; userId: string }[]): Promise<boolean> {
    const seat = this.resumeFrom
    this.resumeFrom = null
    const conn = this.conn, h = this.handlers
    if (!seat || !conn || !h) return false
    let others: VoiceParticipantDto[] | null = null
    try { others = await conn.invoke<VoiceParticipantDto[] | null>('ResumeVoice', seat) } catch { return false }
    if (!others) return false
    this.ownId = seat
    this.selfSilenced = this.silencedBefore
    for (const k of known) if (k.connectionId !== seat && !others.some(p => p.connectionId === k.connectionId)) h.ParticipantLeft(channelId, k.userId, k.connectionId)
    for (const p of others) (known.some(k => k.connectionId === p.connectionId) ? h.ParticipantUpdated : h.ParticipantJoined)(channelId, p)
    return true
  }
  /** Says whether we hear anyone, for the others to see. A server from before it kept that simply does not answer. */
  setDeafened(deafened: boolean) { return this.c.invoke('SetDeafened', deafened).catch(() => { /* an older server: nobody is told */ }) }
  /** Whether one of our connections in the voice channel goes through the relay. */
  setOnRelay(onRelay: boolean) { return this.c.invoke('SetOnRelay', onRelay).catch(() => { /* an older server, or we have left */ }) }
  /** A bot in our voice channel is sending more sound than it may: the server ends its turn. */
  reportBotSound(connectionId: string, kbps: number) { return this.c.invoke('ReportBotSound', connectionId, kbps).catch(() => { /* an older server, or the bot has gone */ }) }
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
  streamSignal(target: string, kind: string, payload: string) { return this.send('StreamSignal', 'stream', target, kind, payload) }
}
