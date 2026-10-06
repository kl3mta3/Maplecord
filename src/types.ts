// Mirrors Maplecord.Shared/Contracts (System.Text.Json web defaults: camelCase, enums as numbers).

export const ChannelType = { Category: 0, Text: 1, Voice: 2, DirectMessage: 3 } as const
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
  ManageDirectChannels: 1 << 16, StreamDirect: 1 << 17,
  Administrator: 1 << 30,
} as const
export const hasPermission = (held: number, required: number) =>
  (held & Permission.Administrator) !== 0 || (held & required) === required

/** username = the fixed name they registered with; displayName = what they chose to be called (null = username). */
export interface UserDto {
  id: string; username: string; avatarUrl: string | null; displayName?: string | null
  nameFont?: string | null; nameColor?: string | null; nameColor2?: string | null; decoration?: string | null
}
export interface UserProfileDto {
  id: string; username: string; displayName: string | null; avatarUrl: string | null; bannerUrl: string | null; accentColor: string | null
  bio: string | null; pronouns: string | null; nameFont: string | null; nameColor: string | null; nameColor2: string | null
  decoration: string | null; effect: string | null; createdAt: string; isBot: boolean
}
/** Each field: undefined leaves it alone, '' clears it. */
export type UpdateProfileRequest = Partial<Record<'displayName' | 'bio' | 'pronouns' | 'accentColor' | 'nameFont' | 'nameColor' | 'nameColor2' | 'decoration' | 'effect', string>>
export interface DecorationDto { id: string; name: string; kind: 'avatar' | 'effect'; url: string }
/** What a server says about itself before sign-in: the protocol it speaks and the oldest client protocol it accepts. */
export interface ServerMetaDto { protocol: number; minClientProtocol: number; version: string }
export interface TokenResponse { accessToken: string; expiresAt: string; user: UserDto }
export interface GuildDto { id: string; name: string; iconUrl: string | null; ownerId: string; createdAt: string }
export interface ChannelOverrideDto { id: string; channelId: string; roleId: string | null; userId: string | null; allow: number; deny: number }
/** directSince is set on a P2P voice channel: people in it connect straight to each other and can see each other's IP address. */
export interface ChannelDto { id: string; guildId: string | null; parentId: string | null; name: string; type: ChannelType; position: number; overrides?: ChannelOverrideDto[] | null; directSince?: string | null }
/** Whether this account allows P2P connections. Kept on the server; off unless the person turns it on. */
export interface PrivacyDto { allowDirect: boolean }
/** How a person chooses to appear. Invisible looks exactly like being offline to everyone else. */
export const UserStatus = { Online: 0, DoNotDisturb: 1, Invisible: 2 } as const
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]
/** A person's own choices, kept on their account. friendRequestsSharedOnly: only from people they share a server with. */
export interface PreferencesDto { status: UserStatus; ignoreFriendRequests: boolean; friendRequestsSharedOnly: boolean }
export interface RoleDto { id: string; guildId: string; name: string; color: string | null; position: number; permissions: number; isEveryone: boolean }
export interface MemberDto {
  userId: string; username: string; avatarUrl: string | null; nickname: string | null; role: number; online: boolean; roleIds?: string[] | null; isBot?: boolean
  displayName?: string | null; nameFont?: string | null; nameColor?: string | null; nameColor2?: string | null; decoration?: string | null
  /** Only on whole-server listings; changes arrive as PresenceStatus. */
  dnd?: boolean
}
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
}
export interface InviteDto { code: string; guildId: string; createdAt: string; expiresAt: string | null; maxUses: number | null; uses: number }
export interface IceServerDto { urls: string[]; username: string | null; credential: string | null }
/** A message from whoever runs the Maplecord server, to everyone online or just to you. */
export interface SystemMessageDto { id: string; message: string; at: string }
/** stream: what they are sharing with the channel, if anything ("screen", "window" or "camera"). */
export interface VoiceParticipantDto { userId: string; username: string; connectionId: string; muted: boolean; stream?: string | null }
/** The server's rules for sharing video. Minutes of 0 mean never. */
export interface StreamSettingsDto {
  enabled: boolean; maxStreamsPerChannel: number; maxViewersDirect: number; maxViewersRelayed: number
  maxHeight: number; maxFps: number; maxKbps: number; noViewersMinutes: number; inactiveMinutes: number
}
export interface VoiceSignalDto { fromUserId: string; fromConnectionId: string; kind: 'offer' | 'answer' | 'ice'; payload: string }

export const CommandOptionType = { String: 0, Integer: 1, Boolean: 2, User: 3, Channel: 4, Number: 5 } as const
export interface CommandChoiceDto { name: string; value: string }
export interface CommandOptionDto { name: string; description: string; type: number; required: boolean; choices?: CommandChoiceDto[] | null }
export interface CommandDto { id: string; applicationId: string; applicationName: string; guildId: string | null; name: string; description: string; options: CommandOptionDto[] }
export interface InteractionDto { id: string; token: string; applicationId: string; commandId: string; commandName: string; guildId: string; channelId: string; userId: string; username: string; args: Record<string, string>; createdAt: string }

export const FriendStatus = { Pending: 0, Accepted: 1 } as const
export type FriendStatus = (typeof FriendStatus)[keyof typeof FriendStatus]
export interface FriendDto { user: UserDto; online: boolean; status: FriendStatus; incoming: boolean; dnd?: boolean }
export interface FriendsDto { friends: FriendDto[]; incoming: FriendDto[]; outgoing: FriendDto[] }
export interface DmChannelDto { channelId: string; other: UserDto; online: boolean; createdAt: string; dnd?: boolean }
