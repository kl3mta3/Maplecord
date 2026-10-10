// Mirrors Maplecord.Shared/Contracts (System.Text.Json web defaults: camelCase, enums as numbers).

export const ChannelType = { Category: 0, Text: 1, Voice: 2, DirectMessage: 3, Forum: 4, Gallery: 5 } as const
/** A forum or a gallery: a list of posts, where what is said about a post is in its thread. */
export const isPostsChannel = (c: { type: number } | null | undefined) => c?.type === ChannelType.Forum || c?.type === ChannelType.Gallery
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType]

export const GuildRole = { Member: 0, Moderator: 1, Admin: 2, Owner: 3 } as const
export const MessageKind = { Text: 0, System: 1, Roll: 2, CoinFlip: 3, Webhook: 4, Bot: 5, Rps: 6, Dice: 7, FileOffer: 8, Call: 9 } as const
export interface DiceDto { value: number; min: number; max: number }
export const RollRange = { minAllowed: 0, maxAllowed: 1_000_000, isValid: (min: number, max: number) => Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 1_000_000 && min < max }
export const RpsChoice = { Rock: 0, Paper: 1, Scissors: 2 } as const
export type RpsChoice = (typeof RpsChoice)[keyof typeof RpsChoice]
export interface RpsSessionDto { id: string; channelId: string; startedBy: string; startedAt: string; expiresAt: string; tieBreak: boolean; participants: string[]; pickedUserIds: string[] }
export interface RpsEntryDto { userId: string; username: string; choice: RpsChoice }
export interface RpsResultDto { sessionId: string; channelId: string; tieBreak: boolean; entries: RpsEntryDto[]; winnerIds: string[]; winningChoice: RpsChoice | null; replay: boolean }
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind]
export const RollKind = { Standard: 0, NeedGreed: 1 } as const
export type RollKind = (typeof RollKind)[keyof typeof RollKind]
export const RollChoice = { Roll: 0, Need: 1, Greed: 2, Pass: 3 } as const
export type RollChoice = (typeof RollChoice)[keyof typeof RollChoice]

/** Bit positions match Maplecord.Shared.Contracts.Permission. Stored as a JS number (safe: top bit is 1<<30). */
export const Permission = {
  ViewChannels: 1 << 0, SendMessages: 1 << 1, AttachFiles: 1 << 2, ManageMessages: 1 << 3,
  StartRolls: 1 << 4, JoinVoice: 1 << 5, Speak: 1 << 6, Stream: 1 << 7,
  CreateInvites: 1 << 8, ManageChannels: 1 << 9, ManageRoles: 1 << 10, ManageWebhooks: 1 << 11,
  ManageGuild: 1 << 12, KickMembers: 1 << 13, BanMembers: 1 << 14, MuteMembers: 1 << 15,
  ManageDirectChannels: 1 << 16, StreamDirect: 1 << 17, JoinDirectVoice: 1 << 18, DisconnectMembers: 1 << 19, UseRelayInDirect: 1 << 20, WearTag: 1 << 21,
  Administrator: 1 << 30,
} as const
export const hasPermission = (held: number, required: number) =>
  (held & Permission.Administrator) !== 0 || (held & required) === required

/** username = the fixed name they registered with; displayName = what they chose to be called (null = username). */
/** A server's tag as someone wears it: which server it is from, up to five letters or digits, and a symbol if it has one. */
export interface TagDto { guildId: string; text: string; symbol?: string | null }
/** What anyone is told about the server a tag belongs to. Of a private server, someone outside it gets only the start of each word of its name. */
export interface TagCardDto {
  guildId: string; text: string; symbol: string | null; name: string; private: boolean; iconUrl: string | null; description: string | null
  members: number; online: number; createdAt: string; joined: boolean; canJoin: boolean
}

export interface UserDto {
  id: string; username: string; avatarUrl: string | null; displayName?: string | null
  nameFont?: string | null; nameColor?: string | null; nameColor2?: string | null; decoration?: string | null
  /** The server tag they wear beside their name. */
  tag?: TagDto | null
}
export interface UserProfileDto {
  id: string; username: string; displayName: string | null; avatarUrl: string | null; bannerUrl: string | null; accentColor: string | null
  bio: string | null; pronouns: string | null; nameFont: string | null; nameColor: string | null; nameColor2: string | null
  decoration: string | null; effect: string | null; createdAt: string; isBot: boolean
  /** Only on your own profile: the ids of the animations you uploaded, and whether uploading has been closed to this account. */
  ownDecoration?: string | null; ownEffect?: string | null; ownAnimationsOff?: boolean; tag?: TagDto | null
  /** The accounts on other services they have linked and chosen to show. */
  connections?: ProfileConnectionDto[] | null
}
/** A service an account can be linked on ("discord", "twitch", "steam", "battlenet"), and what it is called. */
export interface ConnectionServiceDto { key: string; name: string }
/** One of one's own linked accounts. */
export interface ConnectionDto { id: string; service: string; serviceName: string; name: string; url: string | null; shown: boolean; linkedAt: string; /** Where the service limits how long a name may be kept: when this one is removed unless linked again first. */ renewBy?: string | null }
/** One of the ways an account can be signed in to: the service, and the address it gave. */
export interface SignInMethodDto { id: number; service: string; serviceName: string; email: string | null }
/** One's own ways to sign in, and the services that could be added as another. */
export interface SignInMethodsDto { methods: SignInMethodDto[]; canAdd: ConnectionServiceDto[] }
/** The address one is written to: whether it is one's own choice, a change still waiting to be confirmed, and whether the server can confirm one. */
export interface ContactEmailDto { email: string | null; changed: boolean; pending: string | null; canChange: boolean }
/** A linked account as a profile shows it. */
export interface ProfileConnectionDto { service: string; serviceName: string; name: string; url: string | null }
/** Each field: undefined leaves it alone, '' clears it. */
export type UpdateProfileRequest = Partial<Record<'displayName' | 'bio' | 'pronouns' | 'accentColor' | 'nameFont' | 'nameColor' | 'nameColor2' | 'decoration' | 'effect', string>>
export interface DecorationDto { id: string; name: string; kind: 'avatar' | 'effect'; url: string; /** The colors it is drawn in ("9000ff"), each of which can be swapped for your own. */ colors?: string[] | null }
/** What a server says about itself before sign-in: the protocol it speaks and the oldest client protocol it accepts. */
export interface ServerMetaDto { protocol: number; minClientProtocol: number; version: string; /** The server runs as several copies: see hubConnect.ts. */ webSocketsOnly?: boolean; /** What an invite link starts with on this server; the code follows. */ inviteBase?: string | null }
/** What an invite leads to, shown before joining. */
export interface InvitePreviewDto { code: string; guild: GuildDto; memberCount: number }
export interface TokenResponse { accessToken: string; expiresAt: string; user: UserDto }
export interface GuildDto { id: string; name: string; iconUrl: string | null; ownerId: string; createdAt: string; /** Listed for anyone to find and join. */ isPublic?: boolean; description?: string | null; topics?: string[] | null; /** The tag its members may wear, and whether tags are turned off for it. */ tagText?: string | null; tagSymbol?: string | null; noTag?: boolean; /** Rolls in this server's P2P channels are not added to people's roll totals. */ noRollStats?: boolean }
/** A public server as the list of them shows it. */
export interface DiscoverGuildDto { id: string; name: string; iconUrl: string | null; description: string | null; topics: string[]; memberCount: number; joined: boolean }
export interface ChannelOverrideDto { id: string; channelId: string; roleId: string | null; userId: string | null; allow: number; deny: number }
/** directSince is set on a P2P voice channel: people in it connect straight to each other and can see each other's IP address. */
export interface ChannelDto { id: string; guildId: string | null; parentId: string | null; name: string; type: ChannelType; position: number; overrides?: ChannelOverrideDto[] | null; directSince?: string | null; /** The P2P bots (their accounts) let into this channel. Missing when what sent it was not about them. */ bots?: string[] | null }
/** An address other tools can post messages to. `token` and `url` only come back when it is made or renewed. */
export interface WebhookDto { id: string; channelId: string; guildId: string; name: string; avatarUrl: string | null; createdById: string; createdAt: string; token?: string | null; url?: string | null }
/** A bot. `token` and `interactionsSecret` only come back when it is made or its token is renewed. */
export interface ApplicationDto { id: string; name: string; description: string | null; ownerId: string; botUserId: string; botUsername: string; interactionsUrl: string | null; createdAt: string; token?: string | null; interactionsSecret?: string | null
  /** A P2P bot: it connects straight to people's apps in the P2P channels it was let into, and does nothing else. Fixed when the bot is made. */
  direct?: boolean
}
/** A P2P bot added to the server, and whether it has been let into one P2P channel. */
export interface ChannelBotDto { applicationId: string; botUserId: string; name: string; granted: boolean }
/** What deleting your account would take with it. */
export interface AccountDeletionDto { ownedServers: string[]; bots: number }
/** Whether this account allows P2P connections. Kept on the server; off unless the person turns it on. */
export interface PrivacyDto { allowDirect: boolean }
/** How a person chooses to appear. Invisible looks exactly like being offline to everyone else. */
export const UserStatus = { Online: 0, DoNotDisturb: 1, Invisible: 2, Idle: 3 } as const
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]
/** A person's own choices, kept on their account. friendRequestsSharedOnly: only from people they share a server with. */
export interface PreferencesDto { status: UserStatus; ignoreFriendRequests: boolean; friendRequestsSharedOnly: boolean }
export interface RoleDto { id: string; guildId: string; name: string; color: string | null; position: number; permissions: number; isEveryone: boolean }
export interface MemberDto {
  userId: string; username: string; avatarUrl: string | null; nickname: string | null; role: number; online: boolean; roleIds?: string[] | null; isBot?: boolean; /** A P2P bot: only in the P2P channels it was let into. */ directBot?: boolean
  displayName?: string | null; nameFont?: string | null; nameColor?: string | null; nameColor2?: string | null; decoration?: string | null; tag?: TagDto | null
  /** Only on whole-server listings; changes arrive as PresenceStatus. */
  dnd?: boolean
  /** Online and idle. Only on whole-server listings; changes arrive as PresenceIdle. */
  idle?: boolean
  /** Muted in this server's voice channels by someone who may mute members. */
  voiceMuted?: boolean
}
/** A short-lived pass to a voice channel's room on a stream server: where it is, and who the holder is there. */
export interface SfuPassDto {
  url: string; token: string
  /** The key this room's sound and picture are encrypted with by the apps in it (base64). The stream server never has it. */
  key?: string | null
  /** On a pass to watch: the most this stream's sharer may send. The app stops watching a stream that arrives at more. */
  limit?: StreamRateDto | null
}
/** A quality a stream can be sent at, and the most kilobits a second it may use. Set by the server's owner. */
export interface StreamRateDto { height: number; fps: number; kbps: number }
export interface GuildSummaryDto { guild: GuildDto; channels: ChannelDto[]; members: MemberDto[]; roles?: RoleDto[] | null; myPermissions: number; voice?: Record<string, VoiceParticipantDto[]> | null }
export interface ItemIconDto { path: string }
/** contentType is what the server found the file to be: image/* and video/* can be shown in place, anything else is a download. */
export interface AttachmentDto { id: string; fileName: string; contentType: string; size: number; url: string; expired?: boolean }
/** A file offered straight from someone's app. available = their app is still connected and has not withdrawn it. */
/** `available`: the sender is online with the file. Not available comes back when they are, unless `withdrawn`. */
export interface FileOfferDto { id: string; fileName: string; size: number; available: boolean; withdrawn?: boolean }
/** Limits on direct transfers; 0 means no limit. */
export interface TransferSettingsDto { enabled: boolean; maxRelayedBytes: number; maxDirectBytes: number; relayedKbps: number }
export interface UploadSettingsDto { maxBytes: number; keepDays: number; enabled: boolean }
export interface EmbedFieldDto { name: string; value: string; inline: boolean }
export interface EmbedDto { title: string | null; description: string | null; url: string | null; color: number | null; fields?: EmbedFieldDto[] | null; imageUrl?: string | null; footer?: string | null }
export interface RollItemDto { pluginId: string | null; itemId: string | null; name: string; iconUrl: string | null; quantity: number }
export interface RollEntryDto { userId: string; username: string; choice: RollChoice; value: number }
export interface RollSessionDto {
  id: string; channelId: string; startedBy: string; kind: RollKind; item: RollItemDto | null
  startedAt: string; expiresAt: string; tieBreak: boolean; participants: string[]; entries: RollEntryDto[]; endVotes: string[]
  min: number; max: number
}
export interface RollResultDto {
  sessionId: string; channelId: string; kind: RollKind; item: RollItemDto | null; tieBreak: boolean
  entries: RollEntryDto[]; winnerId: string | null; winnerName: string | null; winningValue: number; tiedUserIds: string[]
  min: number; max: number
}
/** A call between two friends. `direct`: a P2P call (each can find the other's IP address); otherwise relayed. Fixed when it is placed. */
export interface CallDto { id: string; channelId: string; callerId: string; callerName: string; calleeId: string; calleeName: string; direct: boolean; ringing: boolean }
/** The note a call leaves in the conversation. The message's author is who called. */
export interface CallLogDto { outcome: 'ended' | 'missed' | 'declined'; seconds: number; direct: boolean }
export interface MessageDto {
  id: string; channelId: string; authorId: string; authorName: string; kind: MessageKind; content: string
  createdAt: string; editedAt: string | null; attachments: AttachmentDto[]; roll: RollResultDto | null
  embeds?: EmbedDto[] | null; authorAvatarUrl?: string | null; webhookId?: string | null; ephemeral?: boolean; rps?: RpsResultDto | null
  dice?: DiceDto | null; call?: CallLogDto | null
  fileOffer?: FileOfferDto | null
  /** The message this one answers; `gone` if it has since been deleted. */
  replyTo?: ReplyToDto | null
  /** Set on a message in a thread: the message the thread hangs off. */
  threadId?: string | null
  /** A post's title, in a forum or a gallery. */
  title?: string | null
  threadCount?: number; threadLastAt?: string | null
  pinnedAt?: string | null
  reactions?: ReactionDto[] | null
  poll?: PollDto | null
  /** Files on a message from a P2P channel. They are not on the server: their contents come from other people's apps. */
  p2pFiles?: import('./p2pText').P2PFile[]
  /** A P2P message that is only someone's reaction to another message (see p2pPosts.ts). It is counted, never shown. */
  p2pReaction?: { id: string; e: string; on: boolean }
  /** The id of the message a P2P message answers. What it shows as is worked out from the messages this device holds. */
  p2pReplyTo?: string
  /** A poll asked in a P2P channel: its choices, whether several may be picked, and how many hours it is open. */
  p2pPoll?: { o: string[]; m: boolean; h: number | null }
  /** Notes about another P2P message, counted and never shown: what it now reads, a pin, a vote, a poll closed by hand. */
  p2pEdit?: string
  p2pPin?: { id: string; on: boolean }
  p2pVote?: { id: string; o: number[] }
  p2pPollClose?: string
}
export interface InviteDto { code: string; guildId: string; createdAt: string; expiresAt: string | null; maxUses: number | null; uses: number; /** Who made it; only when a server's invites are listed. */ createdBy?: string | null }
export interface IceServerDto { urls: string[]; username: string | null; credential: string | null }
/** A message from whoever runs the Maplecord server, to everyone online or just to you. */
export interface SystemMessageDto { id: string; message: string; at: string }
export interface ReplyToDto { id: string; authorId: string; authorName: string; snippet: string; gone?: boolean }
export interface ReactionDto { emoji: string; count: number; mine?: boolean }
export interface PollOptionDto { text: string; votes: number; mine?: boolean }
export interface PollDto { options: PollOptionDto[]; multi: boolean; closesAt: string | null; voters: number; closed?: boolean }
/** A poll being started: two to ten choices, whether several may be picked, and for how many hours it stays open (null: until closed). */
export interface NewPollDto { options: string[]; multi: boolean; hours: number | null }
export interface PostRequest { channelId: string; content: string | null; attachmentIds?: string[] | null; replyToId?: string | null; threadId?: string | null; title?: string | null; poll?: NewPollDto | null }
export interface SearchResultDto { messages: MessageDto[]; before: string | null; more: boolean }
/** One picture or video of a channel, and the message it is on (and the thread that message is in, if it is in one). */
export interface MediaItemDto { file: AttachmentDto; messageId: string; threadId: string | null; authorId: string; authorName: string; at: string }
/** The same as the app shows it. In a P2P channel the file is one people's apps hold (`p2pFile`), not one on the server. */
export interface MediaItem { key: string; messageId: string; threadId: string | null; authorId: string; authorName: string; at: string; file?: AttachmentDto; p2pFile?: import('./p2pText').P2PFile }
/** One's own running totals of loot rolls, as the server keeps them. */
export interface RollStatsDto { rolls: number; sum: number; hundreds: number; ones: number; wins: number; losses: number }
/** stream: what they are sharing with the channel, if anything ("screen", "window" or "camera"). */
export interface VoiceParticipantDto {
  userId: string; username: string; connectionId: string; muted: boolean; stream?: string | null
  /** In a P2P call only: the signing key of their app, and its one-off key for sealing set-up messages to them. */
  publicKey?: string | null; seal?: string | null
  /** They cannot be heard here: they may not speak in this channel, or a moderator muted them. */
  silenced?: boolean
}
/** The server's rules for sharing video. Minutes of 0 mean never. */
export interface StreamSettingsDto {
  enabled: boolean; maxStreamsPerChannel: number; maxViewersDirect: number; maxViewersRelayed: number
  maxHeight: number; maxFps: number; maxKbps: number; noViewersMinutes: number; inactiveMinutes: number
  /** The limits in P2P channels and calls, where video does not cross the relay. */
  directMaxHeight?: number; directMaxFps?: number; directMaxKbps?: number
  /** The voice channel we asked about has a stream server: we send one copy and everyone in the channel may watch. */
  streamServer?: boolean
  /** With a stream server: the most people who may watch one stream there. 0 = everyone in the channel. */
  maxViewersStreamServer?: number
  /** We were picked, on the server, to share above its usual limits: the limits above are the full range. */
  unrestricted?: boolean
  /** What each quality is sent at on this server. An app from before this was sent uses rates of its own, held to maxKbps. */
  rates?: StreamRateDto[] | null
}
export interface VoiceSignalDto { fromUserId: string; fromConnectionId: string; kind: 'offer' | 'answer' | 'ice'; payload: string }

export const CommandOptionType = { String: 0, Integer: 1, Boolean: 2, User: 3, Channel: 4, Number: 5 } as const
export interface CommandChoiceDto { name: string; value: string }
export interface CommandOptionDto { name: string; description: string; type: number; required: boolean; choices?: CommandChoiceDto[] | null }
export interface CommandDto { id: string; applicationId: string; applicationName: string; guildId: string | null; name: string; description: string; options: CommandOptionDto[] }
export interface InteractionDto { id: string; token: string; applicationId: string; commandId: string; commandName: string; guildId: string; channelId: string; userId: string; username: string; args: Record<string, string>; createdAt: string }

export const FriendStatus = { Pending: 0, Accepted: 1 } as const
export type FriendStatus = (typeof FriendStatus)[keyof typeof FriendStatus]
export interface FriendDto { user: UserDto; online: boolean; status: FriendStatus; incoming: boolean; dnd?: boolean; idle?: boolean }
export interface FriendsDto { friends: FriendDto[]; incoming: FriendDto[]; outgoing: FriendDto[] }
/** A QR code as its squares: `size` rows of `size`, '1' for a dark one, with no margin around it. */
export interface QrDto { size: number; modules: string }
/** One's own friend link: its code, the address to hand out, and that address as a QR code. */
export interface FriendLinkDto { code: string; url: string; qr: QrDto }
/** Whose friend link a code is, and how things stand with them. */
export interface FriendLinkOwnerDto { user: UserDto; state: 'self' | 'friends' | 'asked' | 'open' }
export interface DmChannelDto { channelId: string; other: UserDto; online: boolean; createdAt: string; dnd?: boolean; idle?: boolean }
