import { connectionIdOf, hubOptions } from './hubConnect'
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { DirectTextPeer } from './p2pText'
import { makeSealer, seal, unseal, type Sealer } from './p2pIdentity'

/** The set-up messages that carry addresses. */
const CARRIES_ADDRESSES = new Set(['offer', 'answer', 'ice'])
import type {
  ChannelDto, GuildDto, InteractionDto, MemberDto, MessageDto, RoleDto, RollChoice, RollItemDto, RollKind, RollResultDto, RollSessionDto,
  RpsChoice, RpsResultDto, RpsSessionDto, VoiceParticipantDto, FriendDto, DmChannelDto, UserDto, SystemMessageDto,
} from './types'

/** Server → client events, named exactly as IChatClient's methods. */
export interface ChatEvents {
  MessageReceived: (m: MessageDto) => void
  MessageDeleted: (channelId: string, messageId: string) => void
  MessagesRemoved: (channelId: string, authorId: string, since: string | null) => void
  /** P2P text channels: who connects and leaves, the set-up messages between two apps, and being taken out. */
  DirectTextPeerJoined: (channelId: string, peer: DirectTextPeer) => void
  DirectTextPeerLeft: (channelId: string, connectionId: string) => void
  DirectTextSignalReceived: (channelId: string, fromConnectionId: string, kind: string, payload: string) => void
  DirectTextClosed: (channelId: string, reason: string) => void
  Typing: (channelId: string, userId: string, username: string) => void
  MemberPresence: (guildId: string, userId: string, online: boolean) => void
  MemberJoined: (guildId: string, member: MemberDto) => void
  MemberLeft: (guildId: string, userId: string) => void
  MemberUpdated: (guildId: string, member: MemberDto) => void
  GuildUpdated: (guild: GuildDto) => void
  GuildDeleted: (guildId: string) => void
  ChannelCreated: (channel: ChannelDto) => void
  ChannelUpdated: (channel: ChannelDto) => void
  ChannelDeleted: (guildId: string, channelId: string) => void
  RoleCreated: (role: RoleDto) => void
  RoleUpdated: (role: RoleDto) => void
  RoleDeleted: (guildId: string, roleId: string) => void
  PermissionsChanged: (guildId: string) => void
  InteractionCreated: (interaction: InteractionDto) => void
  CommandsChanged: (guildId: string) => void
  RollStarted: (session: RollSessionDto) => void
  RollUpdated: (session: RollSessionDto) => void
  RollEnded: (result: RollResultDto) => void
  RpsStarted: (session: RpsSessionDto) => void
  RpsUpdated: (session: RpsSessionDto) => void
  RpsEnded: (result: RpsResultDto) => void
  ServerNotice: (message: string) => void
  SystemMessage: (message: SystemMessageDto) => void
  FileRequested: (offerId: string, requesterConnectionId: string, requesterUserId: string, requesterName: string) => void
  FileSignalReceived: (offerId: string, fromConnectionId: string, kind: string, payload: string) => void
  FileOfferEnded: (channelId: string, offerId: string, withdrawn: boolean) => void
  FileOfferResumed: (channelId: string, offerId: string) => void
  VoiceStateChanged: (channelId: string, participants: VoiceParticipantDto[]) => void
  FriendRequest: (friend: FriendDto) => void
  FriendAccepted: (friend: FriendDto) => void
  FriendRemoved: (userId: string) => void
  FriendPresence: (userId: string, online: boolean) => void
  PresenceStatus: (userId: string, dnd: boolean) => void
  DmOpened: (dm: DmChannelDto) => void
  UserUpdated: (user: UserDto) => void
}

/** SignalR chat hub wrapper: typed `on` for pushes, methods mirroring IChatHub for calls. */
export class ChatHub {
  private conn: HubConnection | null = null
  readonly state = { status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'reconnecting' }
  onStatus: ((s: string) => void) | null = null
  /** How the server knows this app on the chat hub; file transfers are arranged between two of these. */
  get connectionId() { return this.ownId ?? this.conn?.connectionId ?? null }
  private ownId: string | null = null
  private serverUrl: () => string
  private token: () => string | null

  constructor(serverUrl: () => string, token: () => string | null) { this.serverUrl = serverUrl; this.token = token }

  get connected() { return this.conn?.state === HubConnectionState.Connected }

  // ---- Files between two apps that may go P2P: their set-up messages are sealed ------------------------------------
  // As in P2P voice and text. An app says once, on this connection, which key it seals with. When a file is asked
  // for between two friends who both allow P2P and both apps have done that, the server hands each the other's key,
  // and what the two then pass through it to connect is encrypted to each other: it carries it and cannot read it.
  // Without the keys (an older app or server, or an account that does not allow P2P) the transfer is relayed as before.

  /** This app's registered signing key, and how to sign with it. Set by whoever owns the hub. */
  identity: (() => Promise<{ keyId: string; sign(text: string): Promise<string> }>) | null = null
  private sealer: Promise<Sealer> | null = null
  private sealerNow: Sealer | null = null
  private presentedOn: string | null = null
  /** The key shared with the other app in each such transfer: by offer and that app's connection (the sender's is not known to a requester, so its entry is under the offer alone). */
  private fileKeys = new Map<string, Promise<{ key: CryptoKey; theirs: string } | null>>()
  private outbox = new Map<string, Promise<unknown>>()
  private inbox = new Map<string, Promise<unknown>>()

  /** Says which key this app seals with, once per connection. Quietly does nothing where that is not possible: files are then relayed. */
  async presentSeal(): Promise<Sealer | null> {
    if (!this.identity || !this.conn) return null
    try {
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
    } catch { return null }
  }

  private fileKey(offerId: string, other: string) { return this.fileKeys.get(`${offerId}|${other}`) ?? this.fileKeys.get(`${offerId}|`) }

  private inTurn(line: Map<string, Promise<unknown>>, who: string, work: () => Promise<void>): Promise<void> {
    const next = (line.get(who) ?? Promise.resolve()).then(work, work)
    line.set(who, next.catch(() => {}))
    return next
  }

  private connecting: Promise<void> | null = null

  /** Idempotent: a second call while connected (or connecting) reuses the live connection instead of tearing it down. */
  async connect(handlers: Partial<ChatEvents>) {
    if (this.connecting) return this.connecting
    if (this.conn && this.conn.state !== HubConnectionState.Disconnected) return
    this.connecting = this.connectCore(handlers).finally(() => { this.connecting = null })
    return this.connecting
  }

  private async connectCore(handlers: Partial<ChatEvents>) {
    await this.disconnect()
    const conn = new HubConnectionBuilder()
      // withCredentials=false: we authenticate with the bearer token, which lets the server use a permissive CORS policy.
      .withUrl(this.serverUrl().replace(/\/$/, '') + '/hubs/chat?app=' + encodeURIComponent(__APP_VERSION__), await hubOptions(this.serverUrl(), { accessTokenFactory: () => this.token() ?? '', withCredentials: false }))
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()
    // Set-up messages for a file that may go P2P are opened here, in the order they came, before the rest of the app sees them.
    const wired: Partial<ChatEvents> = {
      ...handlers,
      FileSignalReceived: (offerId, from, kind, payload) => {
        const shared = this.fileKey(offerId, from)
        if (!shared) { handlers.FileSignalReceived?.(offerId, from, kind, payload); return }
        void this.inTurn(this.inbox, `${offerId}|${from}`, async () => {
          if (!CARRIES_ADDRESSES.has(kind)) { handlers.FileSignalReceived?.(offerId, from, kind, payload); return }
          const theirs = await shared
          const opened = theirs ? await unseal(theirs.key, payload, `file\n${kind}\n${theirs.theirs}`) : null
          if (opened !== null) handlers.FileSignalReceived?.(offerId, from, kind, opened)
        })
      },
    }
    for (const [name, handler] of Object.entries(wired)) conn.on(name, handler as (...args: unknown[]) => void)
    // Someone asked for a file of ours, and the transfer may go P2P: their keys, just ahead of the request itself.
    conn.on('FileSealOffered', (offerId: string, requester: string, publicKey: string, theirSeal: string) => {
      if (this.sealerNow) this.fileKeys.set(`${offerId}|${requester}`, this.sealerNow.keyWith(theirSeal, publicKey, offerId).catch(() => null))
    })
    const forget = () => { this.presentedOn = null; this.fileKeys.clear(); this.outbox.clear(); this.inbox.clear() }
    conn.onreconnecting(() => { this.ownId = null; this.setStatus('reconnecting') })
    // A connection that came back is a new one to the server, with a new id; it is known before anyone is told we are back.
    conn.onreconnected(() => { forget(); void connectionIdOf(conn).then(id => { this.ownId = id; this.setStatus('connected') }) })
    conn.onclose(() => this.setStatus('disconnected'))
    this.setStatus('connecting')
    await conn.start()
    // start() resolves at the handshake, before the server has subscribed this connection to our channels.
    // A hub call is only answered after that, so this closes the window where an incoming message would be missed.
    await conn.invoke('Ready')
    this.ownId = await connectionIdOf(conn)
    this.conn = conn
    this.setStatus('connected')
  }

  async disconnect() {
    const c = this.conn
    this.conn = null
    this.ownId = null
    if (c) { try { await c.stop() } catch { /* gone */ } }
  }

  private setStatus(s: typeof this.state.status) { this.state.status = s; this.onStatus?.(s) }

  private get c() { if (!this.conn) throw new Error('Not connected.'); return this.conn }

  sendMessage(channelId: string, content: string, attachmentIds: string[] | null = null) {
    return this.c.invoke<MessageDto>('SendMessage', channelId, content, attachmentIds)
  }
  deleteMessage(messageId: string) { return this.c.invoke('DeleteMessage', messageId) }
  /** Connect to a P2P text channel: the reply is who else is connected there, and the key each signs with. */
  joinDirectText(channelId: string, keyId: string, seal: string) { return this.c.invoke<DirectTextPeer[]>('JoinDirectText', channelId, keyId, seal) }
  leaveDirectText(channelId: string) { return this.c.invoke('LeaveDirectText', channelId) }
  directTextSignal(channelId: string, target: string, kind: string, payload: string) { return this.c.invoke('DirectTextSignal', channelId, target, kind, payload) }
  setTyping(channelId: string) { return this.c.send('SetTyping', channelId) }
  startRoll(channelId: string, kind: RollKind, item: RollItemDto | null, min = 1, max = 100) {
    return this.c.invoke<RollSessionDto>('StartRoll', channelId, kind, item, min, max)
  }
  quickRoll(channelId: string, min = 1, max = 100) { return this.c.invoke('QuickRoll', channelId, min, max) }
  roll(sessionId: string, choice: RollChoice) { return this.c.invoke('Roll', sessionId, choice) }
  voteEndRoll(sessionId: string) { return this.c.invoke('VoteEndRoll', sessionId) }
  getActiveRoll(channelId: string) { return this.c.invoke<RollSessionDto | null>('GetActiveRoll', channelId) }
  coinFlip(channelId: string) { return this.c.invoke('CoinFlip', channelId) }
  startRps(channelId: string) { return this.c.invoke<RpsSessionDto>('StartRps', channelId) }
  rpsPick(sessionId: string, choice: RpsChoice) { return this.c.invoke('RpsPick', sessionId, choice) }
  getActiveRps(channelId: string) { return this.c.invoke<RpsSessionDto | null>('GetActiveRps', channelId) }
  offerFile(channelId: string, fileName: string, size: number) { return this.c.invoke<MessageDto>('OfferFile', channelId, fileName, size) }
  cancelFileOffer(offerId: string) { return this.c.invoke('CancelFileOffer', offerId) }
  resumeFileOffers(offerIds: string[]) { return this.c.invoke<{ resumed: string[]; gone: string[] }>('ResumeFileOffers', offerIds) }
  /** Ask for an offered file. Where the transfer may go P2P the server answers with the sender's keys, and its set-up messages are sealed from then on. */
  async requestFile(offerId: string, sealing: boolean) {
    const sealer = sealing ? await this.presentSeal() : null
    const sender = await this.c.invoke<{ publicKey: string; seal: string } | null | undefined>('RequestFile', offerId)
    if (sealer && sender?.seal && sender.publicKey) this.fileKeys.set(`${offerId}|`, sealer.keyWith(sender.seal, sender.publicKey, offerId).catch(() => null))
  }
  fileSignal(offerId: string, target: string, kind: string, payload: string): Promise<void> {
    const shared = this.fileKey(offerId, target)
    if (!shared) return this.c.invoke<void>('FileSignal', offerId, target, kind, payload)
    return this.inTurn(this.outbox, `${offerId}|${target}`, async () => {
      if (!CARRIES_ADDRESSES.has(kind)) { await this.c.invoke('FileSignal', offerId, target, kind, payload); return }
      const [mine, theirs] = [this.sealerNow, await shared]
      if (!mine || !theirs) throw new Error('That app gave no key to seal set-up messages with.')
      await this.c.invoke('FileSignal', offerId, target, kind, await seal(theirs.key, payload, `file\n${kind}\n${mine.publicKey}`))
    })
  }
  invokeCommand(channelId: string, commandId: string, args: Record<string, string>) {
    return this.c.invoke<InteractionDto>('InvokeCommand', channelId, commandId, args)
  }
}
