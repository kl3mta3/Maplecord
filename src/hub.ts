import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type {
  ChannelDto, GuildDto, InteractionDto, MemberDto, MessageDto, RoleDto, RollChoice, RollItemDto, RollKind, RollResultDto, RollSessionDto,
  RpsChoice, RpsResultDto, RpsSessionDto, VoiceParticipantDto, FriendDto, DmChannelDto, UserDto, SystemMessageDto,
} from './types'

/** Server → client events, named exactly as IChatClient's methods. */
export interface ChatEvents {
  MessageReceived: (m: MessageDto) => void
  MessageDeleted: (channelId: string, messageId: string) => void
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
  get connectionId() { return this.conn?.connectionId ?? null }
  private serverUrl: () => string
  private token: () => string | null

  constructor(serverUrl: () => string, token: () => string | null) { this.serverUrl = serverUrl; this.token = token }

  get connected() { return this.conn?.state === HubConnectionState.Connected }

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
      .withUrl(this.serverUrl().replace(/\/$/, '') + '/hubs/chat', { accessTokenFactory: () => this.token() ?? '', withCredentials: false })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()
    for (const [name, handler] of Object.entries(handlers)) conn.on(name, handler as (...args: unknown[]) => void)
    conn.onreconnecting(() => this.setStatus('reconnecting'))
    conn.onreconnected(() => this.setStatus('connected'))
    conn.onclose(() => this.setStatus('disconnected'))
    this.setStatus('connecting')
    await conn.start()
    // start() resolves at the handshake, before the server has subscribed this connection to our channels.
    // A hub call is only answered after that, so this closes the window where an incoming message would be missed.
    await conn.invoke('Ready')
    this.conn = conn
    this.setStatus('connected')
  }

  async disconnect() {
    const c = this.conn
    this.conn = null
    if (c) { try { await c.stop() } catch { /* gone */ } }
  }

  private setStatus(s: typeof this.state.status) { this.state.status = s; this.onStatus?.(s) }

  private get c() { if (!this.conn) throw new Error('Not connected.'); return this.conn }

  sendMessage(channelId: string, content: string, attachmentIds: string[] | null = null) {
    return this.c.invoke<MessageDto>('SendMessage', channelId, content, attachmentIds)
  }
  deleteMessage(messageId: string) { return this.c.invoke('DeleteMessage', messageId) }
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
  requestFile(offerId: string) { return this.c.invoke('RequestFile', offerId) }
  fileSignal(offerId: string, target: string, kind: string, payload: string) { return this.c.invoke<void>('FileSignal', offerId, target, kind, payload) }
  invokeCommand(channelId: string, commandId: string, args: Record<string, string>) {
    return this.c.invoke<InteractionDto>('InvokeCommand', channelId, commandId, args)
  }
}
