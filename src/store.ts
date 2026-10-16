import { checkBeforeSending } from './pictureCheck'
import { plainEmojis, playSound as playExpressionSound } from './expressions'
import type { CommunityPollAnswerDto, CommunityPollDto, UsableExpressionsDto } from './types'
import { shouldAsk } from './communityPoll'
import { inBatches, membersToAsk, mergeMembers } from './memberPaging'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Api, ApiError } from './api'
import { ChatHub } from './hub'
import { setFileLinkSource } from './fileLinks'
import { voiceRecorder } from './voiceReport'
import { measureRelaysOnce } from './relayPings'
import { bridge, isHandheld, type OverlayAction } from './platform'
import { IdleWatch } from './idle'
import { DEFAULT_GATE_LEVEL, DEFAULT_NOTIFY, defaultPluginSettings, gateThreshold, loadSettings, saveSettings, type GuildPrefs, type PluginSettings, type Settings, type UserPrefs } from './settings'
import { pluginIconUrl, type PluginDrop, type PluginInfo, type PluginItem } from './pluginTypes'
import { serverIconUrl, shareIcon, withTimeout } from './itemIcons'
import { appearanceOfMember, appearanceOfUser, shrinkPicture, type Appearance } from './profile'
import { playSound, setChosenSounds, setQuiet, setSoundPacks, startRing, stopRing, type SoundPack } from './sounds'
import { readPackZip } from './soundPackZip'
import { applyTheme } from './theme'
import { VoiceConnectError, VoiceEngine, type IcePolicy, type VoiceEngineEvents } from './voice'
import { NativeVoiceEngine } from './nativeVoice'
import { isNativeApp, nativeApp, type NativeAppEvents } from './native/app'
import { nativeSignIn } from './native/signIn'
import { phoneChoices } from './pushChoices'
import { signInProblem } from './components/SignIn'
import { type DirectTextPeer, P2PTextEngine, P2PFileUnavailable, describeFile, MAX_P2P_FILE, MAX_P2P_FILES, P2P_PICTURE, type P2PFile, type P2PMessage } from './p2pText'
import { foldP2p, foldP2pChat, isP2pNoteText, p2pShape, packP2p, searchP2pChat, searchP2pGallery, type P2PMeta } from './p2pPosts'
import { mayManageMessagesIn } from './channelViewers'
import { forgetFile, holds, keep, keepFile, kept, keptBefore, keptFile, keyPrint, knownKeys, loadIdentity, p2pTextSupported, rememberKey, sha256Hex } from './p2pIdentity'
import { eventIdFrom, forgetRememberedServer, friendCodeFrom, inviteCodeFrom, inviteIsForAnotherServer, rememberedServer, takeRememberedEvent, takeRememberedFriendLink, takeRememberedInvite } from './invites'
import { DEFAULT_PUSH_KEY, PUSH_RELEASE_MS, isChoosingPushKey, isPushKey, type PushKey } from './pushToTalk'
import { VoiceHub } from './voiceHub'
import { TransferEngine, fileSource, rememberedSource, openSink, type TransferView } from './transfer'
import { StreamEngine, applyHint, canShareSound, defaultQuality, p2pVideoRate, qualityChoices, soundConstraints, videoConstraints, type StreamKind, type StreamQuality } from './stream'
import { anyPopoutVisible } from './popout'
import {
  ChannelType, MessageKind, RollChoice, RollKind, UserStatus, type PreferencesDto, type TransferSettingsDto,
  type ChannelDto, type CommandDto, type GuildSummaryDto, type MemberDto, type MessageDto, type RollItemDto, type RollResultDto, type RollSessionDto,
  type VoiceParticipantDto, type RpsSessionDto, type RpsResultDto, RpsChoice, type FriendsDto, type DmChannelDto, type RoleDto,
  type DecorationDto, type QrDto, type UpdateProfileRequest, type UserDto, type UserProfileDto, type SystemMessageDto, type SignInMethodsDto, type ContactEmailDto, type ConnectionDto, type ConnectionServiceDto, type FriendLinkDto, type MediaItem, type SearchResultDto, type NewPollDto, isPostsChannel, type RollStatsDto, type FileOfferDto, type TokenResponse, type StreamSettingsDto,
  type SfuPassDto, type InviteDto, type CalendarEventDto, EventAnswer,
} from './types'

/** A DM rendered as a channel so chat, rolls and the overlay treat it like any other. */
const dmChannel = (dm: DmChannelDto): ChannelDto => ({ id: dm.channelId, guildId: null, parentId: null, name: dm.other.displayName || dm.other.username, type: ChannelType.DirectMessage, position: 0 })
const EMPTY_FRIENDS: FriendsDto = { friends: [], incoming: [], outgoing: [] }
/** Whose remembered file offers are whose: one account on one server. */
/**
 * Where one account's copy of a P2P channel is kept on this device. Another account that signs in here, and can open
 * the same channel, starts with nothing: it does not read what the first one kept.
 */
const p2pBox = (userId: string | undefined, channelId: string) => `${userId ?? ''}|${channelId}`
const offerScope = (serverUrl: string, userId: string) => `${serverUrl.replace(/\/$/, '').toLowerCase()}|${userId}`
/** Set (to the account id) while a browser is away signing in again in order to allow P2P. */
export const PENDING_DIRECT = 'maplecord.pendingDirect'
/** The same, when the page left to prove who is here so that the account could be deleted. */
export const PENDING_DELETE = 'maplecord.pendingDelete'
/** The same, when it was to change how the account is signed in to (Settings, My account). */
export const PENDING_ACCOUNT = 'maplecord.pendingAccount'

export interface ActiveRps { session: RpsSessionDto; result: RpsResultDto | null; myPick: RpsChoice | null }

export interface VoiceParticipant extends VoiceParticipantDto { state: string; speaking: boolean }
/** A call with a friend, as this app sees it: ringing there ('calling'), ringing here ('incoming'), or answered. */
export interface CallState { id: string; channelId: string; direct: boolean; otherId: string; otherName: string; phase: 'calling' | 'incoming' | 'active' }

export interface VoiceState {
  channelId: string
  guildId: string
  /** Set when this is a P2P call: the moment the channel became P2P. Null for a relayed call. */
  directSince: string | null
  participants: VoiceParticipant[]
  policy: IcePolicy
  status: string
}

export interface GuildState extends GuildSummaryDto {
  unread: number
  channelUnread: Record<string, number>
}

export interface ActiveRoll {
  session: RollSessionDto
  result: RollResultDto | null
  channelName: string
}

/** A drop a plugin detected that has not been turned into a roll yet. */
export interface PendingDrop {
  key: string
  pluginId: string
  itemId: string
  name: string
  quantity: number
  gameName: string
  rarity: string | null
  iconUrl: string | null
  context: string | null
  /** Start the roll without asking (the user opted in for this plugin). */
  auto: boolean
  rollKind: RollKind
  at: number
}

export interface CatalogHit { pluginId: string; gameName: string; item: PluginItem; iconUrl: string | null }

export interface Stats { totalRolls: number; rollSum: number; perfect100s: number; ones: number; wins: number; losses: number }

// The totals are kept by the server, on the account, and start from nothing there. (Apps before that counted on
// their own, in this device's storage under 'maplecord.stats'; that is neither read nor written any more.)
const NO_STATS: Stats = { totalRolls: 0, rollSum: 0, perfect100s: 0, ones: 0, wins: 0, losses: 0 }
const asStats = (s: RollStatsDto): Stats => ({ totalRolls: s.rolls, rollSum: s.sum, perfect100s: s.hundreds, ones: s.ones, wins: s.wins, losses: s.losses })

/** All client state and actions. One instance for the app; components read what they need. */
/** A P2P message in the shape the chat screen draws every message in. */
const p2pToMessage = (m: P2PMessage): MessageDto => ({
  id: m.id, channelId: m.channelId, authorId: m.authorId, authorName: m.authorName, kind: MessageKind.Text,
  createdAt: m.sentAt, editedAt: null, attachments: [], roll: null, p2pFiles: m.files,
  // A post, a poll, part of a thread, or a note about another message says so at the start of its text.
  ...p2pShape(m.content),
})

/** The pictures and videos on these P2P messages, newest first. */
export const p2pMedia = (messages: MessageDto[]): MediaItem[] => messages
  .flatMap(m => (m.p2pFiles ?? []).filter(f => /^(image|video)\//.test(f.type)).map(f => ({ key: `${m.id}|${f.hash}`, messageId: m.id, threadId: m.threadId ?? null, authorId: m.authorId, authorName: m.authorName, at: m.createdAt, p2pFile: f })))
  .sort((a, b) => b.at.localeCompare(a.at))

/** A file on a P2P message, as the screen shows it: whether this device has it, is fetching it, or could not find it. */
export interface P2PFileView { state: 'have' | 'fetching' | 'nobody' | 'relay'; got: number; url?: string }

/** Direct conversations with the one written in last at the top; ones with nothing said yet keep their order below. */
const newestFirst = (list: DmChannelDto[]) => {
  const at = (d: DmChannelDto) => (d.lastAt ? Date.parse(d.lastAt) || 0 : 0)
  return [...list].sort((a, b) => at(b) - at(a))
}

export function useMaplecord() {
  const settingsRef = useRef<Settings>(loadSettings())
  const [settings, setSettingsState] = useState<Settings>(settingsRef.current)
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    saveSettings(settingsRef.current)
    setSettingsState(settingsRef.current)
  }, [])

  // Held in state, not useMemo: these own live connections, and a memo is recomputed when the dev server hot-reloads
  // a module, which would silently swap in fresh, unconnected ones under a running app.
  const [api] = useState(() => new Api(() => settingsRef.current.serverUrl, () => settingsRef.current.accessToken))
  // Where a new address for a file comes from once the one a message came with has run out (see fileLinks.ts).
  useEffect(() => { setFileLinkSource(id => api.attachmentLink(id).then(r => r.url)); return () => setFileLinkSource(null) }, [api])
  const [hub] = useState(() => new ChatHub(() => settingsRef.current.serverUrl, () => settingsRef.current.accessToken))
  const [voiceHub] = useState(() => new VoiceHub(() => settingsRef.current.serverUrl, () => settingsRef.current.accessToken))

  const [voice, setVoice] = useState<VoiceState | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  /** A P2P voice channel the person tried to join and has to decide about: read its warning, or first allow P2P at all. */
  const [directPrompt, setDirectPrompt] = useState<{ channelId: string; kind: 'warn' | 'blocked'; text?: boolean } | null>(null)
  /** Whether this account allows P2P connections. Kept on the server; until we have heard from it, the answer is no. */
  const [allowDirect, setAllowDirectState] = useState(false)
  const allowDirectRef = useRef(false)
  const voiceRef = useRef<VoiceState | null>(null)
  const joinVoiceRef = useRef<(channelId: string, acknowledged?: boolean) => Promise<void>>(async () => { /* set below */ })
  /** Whether a voice channel is being joined right now (one at a time), and how many joins have got as far as being in one. */
  const voiceJoining = useRef(false)
  const voiceJoins = useRef(0)
  useEffect(() => { voiceRef.current = voice }, [voice])
  /** The call we are placing, being rung for, or in. Once answered its sound is `voice`, exactly like a voice channel's. */
  const [call, setCallState] = useState<CallState | null>(null)
  const callRef = useRef<CallState | null>(null)
  const setCall = useCallback((c: CallState | null) => { callRef.current = c; setCallState(c) }, [])
  const answeringRef = useRef(false)

  /** How we chose to appear and who may send us friend requests. Kept on the account, so it follows us between devices. */
  const [preferences, setPreferencesState] = useState<PreferencesDto>({ status: UserStatus.Online, ignoreFriendRequests: false, friendRequestsSharedOnly: false })
  const preferencesRef = useRef(preferences)
  const applyPreferences = useCallback((p: PreferencesDto) => { preferencesRef.current = p; setPreferencesState(p); setQuiet(p.status === UserStatus.DoNotDisturb) }, [])
  /** People we blocked: no friend requests, messages or calls from them, and what they write in servers is hidden. */
  const [blocked, setBlockedList] = useState<UserDto[]>([])
  const blockedRef = useRef(new Set<string>())
  useEffect(() => { blockedRef.current = new Set(blocked.map(u => u.id)) }, [blocked])
  /** People who are online and asked not to be disturbed. */
  const [dndUsers, setDndUsers] = useState<Set<string>>(new Set())
  const markDnd = useCallback((userId: string, dnd: boolean) => setDndUsers(cur => {
    if (cur.has(userId) === dnd) return cur
    const next = new Set(cur)
    if (dnd) next.add(userId); else next.delete(userId)
    return next
  }), [])
  /** People who are online and idle: they chose it, or every app they have open has gone unused (see idle.ts). */
  const [idleUsers, setIdleUsers] = useState<Set<string>>(new Set())
  const markIdle = useCallback((userId: string, idle: boolean) => setIdleUsers(cur => {
    if (cur.has(userId) === idle) return cur
    const next = new Set(cur)
    if (idle) next.add(userId); else next.delete(userId)
    return next
  }), [])
  /** Whether this app has gone unused. Said again to the server after a reconnect, which is a new connection to it. */
  const unusedRef = useRef(false)
  /** Hearing nobody, without leaving the call. */
  const [deafened, setDeafened] = useState(false)
  /** The colour and picture from our own profile, drawn behind our name at the bottom of the sidebar. */
  const [ownLook, setOwnLook] = useState<{ accentColor: string | null; bannerUrl: string | null }>({ accentColor: null, bannerUrl: null })
  const [transferLimits, setTransferLimits] = useState<TransferSettingsDto | null>(null)

  /** Files moving straight between this app and someone else's, in either direction. */
  const [transfers, setTransfers] = useState<TransferView[]>([])
  const [transferEngine] = useState(() => new TransferEngine({
    signal: (offerId, target, kind, payload) => hub.fileSignal(offerId, target, kind, payload),
    ice: (offerId, requester) => api.transferIce(offerId, requester),
    self: () => hub.connectionId,
    settings: () => api.transferSettings(),
    // The same choice as for voice: unless the person allowed direct connections, only ever through a relay.
    wantRelay: () => !allowDirectRef.current,
    changed: setTransfers,
  }))
  // ---- P2P text (see p2pText.ts). What is typed in a P2P channel goes straight between apps; the history is kept here.
  /** For the P2P channel being read: whether we are connected to it, and to how many of the people there. */
  const [p2pText, setP2pText] = useState<{ channelId: string; state: 'ask' | 'blocked' | 'connecting' | 'on' | 'failed'; reachable: number; present: number; note: string } | null>(null)
  /** Goes up each time the chat connection comes back: the server has forgotten which P2P channels we were connected to. */
  const [hubEpoch, setHubEpoch] = useState(0)
  /** This app's key as registered for each account that has used it here. */
  const p2pKeys = useRef(new Map<string, Promise<{ keyId: string; sign(text: string): Promise<string> }>>())
  const p2pChanged = useRef<(channelId: string) => void>(() => {})
  const p2pReceived = useRef<(message: P2PMessage, caughtUp: boolean) => void>(() => {})
  /** Whose key is whose, as the server answered, for checking messages passed on by other members. */
  const p2pKeyOwners = useRef(new Map<string, Promise<{ userId: string; publicKey: string } | null>>())
  /** This app's signing key as registered for the account in use, and how to sign with it. */
  function p2pIdentityNow() {
    const userId = settingsRef.current.user?.id ?? ''
    let mine = p2pKeys.current.get(userId)
    if (!mine) {
      mine = (async () => { const id = await loadIdentity(); const key = await api.registerKey(id.publicKey); return { keyId: key.id, sign: id.sign } })()
      p2pKeys.current.set(userId, mine)
      mine.catch(() => p2pKeys.current.delete(userId))
    }
    return mine
  }
  const [p2pEngine] = useState(() => new P2PTextEngine({
    join: (channelId, keyId, seal) => hub.joinDirectText(channelId, keyId, seal),
    met: (channelId, peer) => { void p2pMet.current(channelId, peer) },
    connectsTo: (channelId, peer) => {
      if (!peer.bot) return true
      // A bot: only one this person agreed to by name, and never while they keep their own address behind the relay.
      const s = settingsRef.current
      const viaRelay = !!s.p2pViaRelay
      const agreed = !!s.p2pBotsAccepted?.[peer.userId] && !viaRelay
      if (!agreed) queueMicrotask(() => setP2pBotsWaiting(all => (all.some(x => !x.voice && x.channelId === channelId && x.userId === peer.userId) ? all : [...all, { channelId, userId: peer.userId, username: peer.username, viaRelay }])))
      return agreed
    },
    leave: async channelId => { await hub.leaveDirectText(channelId) },
    signal: async (channelId, target, kind, payload) => { await hub.directTextSignal(channelId, target, kind, payload) },
    rtcConfig: async channelId => {
      const ice = await api.iceServers(channelId)
      // The person's choice to go through the relay in P2P channels holds for text as it does for voice.
      const viaRelay = !!settingsRef.current.p2pViaRelay
      if (viaRelay && !ice.some(s => s.urls.some(u => /^turns?:/i.test(u))))
        throw new Error('The relay is not available to you in P2P channels on this server. To connect directly, turn off "Join P2P channels through the relay" under Settings, Voice & audio.')
      return { iceServers: ice.map(s => ({ urls: s.urls, username: s.username ?? undefined, credential: s.credential ?? undefined })), iceTransportPolicy: viaRelay ? 'relay' : 'all' }
    },
    identity: () => p2pIdentityNow(),
    me: () => { const u = settingsRef.current.user; return { id: u?.id ?? '', name: u?.displayName || u?.username || '' } },
    received: (message, caughtUp) => p2pReceived.current(message, caughtUp),
    changed: channelId => p2pChanged.current(channelId),
    held: async channelId => (await kept<{ p2p?: P2PMessage }>(p2pBox(settingsRef.current.user?.id, channelId), 600)).map(e => e.p2p).filter((m): m is P2PMessage => !!m),
    known: async channelId => (await kept<{ p2p?: P2PMessage; server?: MessageDto; removed?: string }>(p2pBox(settingsRef.current.user?.id, channelId), 5000)).map(e => e.p2p?.id ?? e.server?.id ?? e.removed).filter((id): id is string => !!id),
    holds: (channelId, ids) => holds(p2pBox(settingsRef.current.user?.id, channelId), ids),
    heldBefore: async (channelId, before, limit) => (await keptBefore<{ p2p?: P2PMessage }>(p2pBox(settingsRef.current.user?.id, channelId), before, limit)).map(e => e.p2p).filter((m): m is P2PMessage => !!m),
    broadcasting: channelId => !settingsRef.current.p2pNoBroadcast?.[channelId],
    keyOwner: keyId => {
      let owner = p2pKeyOwners.current.get(keyId)
      if (!owner) {
        owner = api.keyOwner(keyId).then(k => (k ? { userId: k.userId, publicKey: k.publicKey } : null))
        p2pKeyOwners.current.set(keyId, owner)
        // A lookup that failed is tried again next time; an answer (even "unknown") is remembered while the app runs.
        owner.catch(() => p2pKeyOwners.current.delete(keyId))
      }
      return owner
    },
    member: (channelId, userId) => {
      const m = findChannel(channelId)?.guild?.members.find(x => x.userId === userId)
      return m ? m.nickname || m.displayName || m.username : null
    },
    file: (channelId, hash) => keptFile(p2pBox(settingsRef.current.user?.id, channelId), hash),
    relayedFileLimit: () => p2pRelayedLimit.current,
  }))
  /**
   * People connected from an app this device has not seen them use before. The server says whose key is whose; this
   * is what makes it have to say the same thing every time. The first app someone is ever seen with is simply
   * remembered. A different one later is pointed out until the person here says it is fine.
   */
  const [p2pNewApps, setP2pNewApps] = useState<{ channelId: string; userId: string; username: string; print: string }[]>([])
  const p2pMet = useRef<(channelId: string, peer: DirectTextPeer) => Promise<void>>(async () => {})
  p2pMet.current = async (channelId, peer) => {
    try {
      const account = settingsRef.current.user?.id ?? ''
      const [print, known] = [await keyPrint(peer.publicKey), await knownKeys(account, peer.userId)]
      if (known.includes(print)) return
      if (known.length === 0) { await rememberKey(account, peer.userId, print); return }
      setP2pNewApps(all => (all.some(x => x.userId === peer.userId && x.print === print && x.channelId === channelId) ? all : [...all, { channelId, userId: peer.userId, username: peer.username, print }]))
    } catch { /* this device's storage would not answer: nothing is said either way */ }
  }
  // P2P voice channels and calls seal their set-up messages with the same signing key, and notice new apps the same way.
  useEffect(() => {
    voiceHub.identity = async () => {
      if (!p2pTextSupported()) throw new Error('This browser cannot seal P2P connections, so P2P calls cannot be used in it.')
      return p2pIdentityNow()
    }
    hub.identity = voiceHub.identity
    voiceHub.onMet = (channelId, who) => {
      // In a P2P voice channel and in a P2P call between friends alike.
      if (who.publicKey) void p2pMet.current(channelId, { connectionId: who.connectionId, userId: who.userId, username: who.username, keyId: '', publicKey: who.publicKey, seal: who.seal ?? '' })
    }
  }, [voiceHub]) // eslint-disable-line react-hooks/exhaustive-deps
  const acceptP2pApp = useCallback(async (userId: string, print: string) => {
    await rememberKey(settingsRef.current.user?.id ?? '', userId, print).catch(() => {})
    setP2pNewApps(all => all.filter(x => !(x.userId === userId && x.print === print)))
  }, [])
  /** Bots in a P2P channel that this app is not connected to: the person has not agreed to them, or joins through the relay. */
  const [p2pBotsWaiting, setP2pBotsWaiting] = useState<{ channelId: string; userId: string; username: string; viaRelay: boolean; voice?: boolean }[]>([])
  /**
   * In a P2P voice channel, a bot this app does not connect to: one this person has not agreed to by name, and any
   * bot while they keep their own address behind the relay. (Nowhere else: an ordinary channel's voice is relayed.)
   */
  const [refusesVoiceBot] = useState(() => (p: VoiceParticipantDto, direct: boolean) =>
    !!p.bot && direct && !(settingsRef.current.p2pBotsAccepted?.[p.userId] && !settingsRef.current.p2pViaRelay))
  /** The most a file may be to cross the relay in a P2P channel: what this server takes as an upload. */
  const p2pRelayedLimit = useRef(32 * 1024 * 1024)
  /** The files on the P2P messages on screen, by channel and hash. */
  const [p2pFiles, setP2pFiles] = useState<Record<string, P2PFileView>>({})
  const p2pFilesBusy = useRef(new Set<string>())

  /** What to do when the voice engine loses its channel for good; set once leaving voice is defined, further down. */
  const voiceLostRef = useRef<(reason: string) => void>(() => {})
  /** The phone's own call screen asked for mute, or hung up (the iPhone app only); set once those are defined, further down. */
  const muteAskedRef = useRef<(muted: boolean) => void>(() => {})
  const hangUpAskedRef = useRef<() => void>(() => {})
  // In the iPhone app the shell does the sound, so that it carries on in the background (see nativeVoice.ts).
  const [voiceEngine] = useState<VoiceEngine | NativeVoiceEngine>(() => isNativeApp() ? new NativeVoiceEngine(voiceHub, voiceEvents()) : new VoiceEngine(voiceHub, voiceEvents()))
  function voiceEvents(): VoiceEngineEvents { return {
    peerState: (id, state) => setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === id ? { ...p, state } : p)) } : v)),
    speaking: (id, speaking) => {
      if (id === null) setIsSpeaking(speaking)
      const target = id ?? voiceHub.connectionId
      setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === target ? { ...p, speaking } : p)) } : v))
    },
    level: () => { /* used by the audio settings meter */ },
    log: m => { console.debug('[voice]', m); voiceRecorder.note(m) },
    lost: reason => voiceLostRef.current(reason),
    // A bot sending more sound than it may: it is no longer played here, and the server is told, which ends its turn.
    overCap: (id, kbps) => { void voiceHub.reportBotSound(id, kbps) },
    // Whether we reach anyone in the call through the relay: said to the server, which counts who is on each relay.
    onRelay: on => { void voiceHub.setOnRelay(on) },
    muteAsked: muted => muteAskedRef.current(muted),
    hangUpAsked: () => hangUpAskedRef.current(),
  } }
  // Closing the app (or the page) while in voice: the server is told we left, so it does not keep our place for a
  // reconnect that is not coming (it keeps one for a few seconds when a connection ends without a word).
  useEffect(() => {
    const going = () => { if (voiceRef.current) { try { void voiceHub.leave().catch(() => { /* gone already */ }) } catch { /* not connected */ } } }
    window.addEventListener('pagehide', going)
    return () => window.removeEventListener('pagehide', going)
  }, [voiceHub])
  // The voice report (see voiceReport.ts): recorded while switched on and in a call, and not otherwise.
  const inCall = !!voice
  useEffect(() => {
    if (!settings.voiceRecord || !inCall) { voiceRecorder.stop(); return }
    const nameOf = (connectionId: string) => {
      const p = voiceRef.current?.participants.find(x => x.connectionId === connectionId)
      return p ? (p.username || connectionId.slice(0, 6)) : connectionId.slice(0, 6)
    }
    voiceRecorder.start(() => voiceEngine.reportProbes(nameOf), () => voiceEngine.sendingNow, () => voiceEngine.carriedHow)
    return () => voiceRecorder.stop()
  }, [settings.voiceRecord, inCall, voiceEngine])

  // ---- Shared video (see stream.ts). The engine holds the live MediaStreams; `streamTick` re-renders when it changes.
  const [, setStreamTick] = useState(0)
  const [streamRules, setStreamRules] = useState<StreamSettingsDto | null>(null)
  const streamRulesRef = useRef<StreamSettingsDto | null>(null)
  /** How many people are watching each stream in the voice channel we are in, by the sharer's connection. */
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({})
  /** How many were watching our own stream when we were last told, to hear the number change. */
  const ownViewers = useRef(0)
  const stopShareRef = useRef<(reason?: string) => Promise<void>>(async () => {})
  const [streamEngine] = useState(() => new StreamEngine({
    signal: (target, kind, payload) => voiceHub.streamSignal(target, kind, payload),
    rtcConfig: () => voiceEngine.rtcConfig,
    settings: () => streamRulesRef.current,
    changed: () => setStreamTick(t => t + 1),
    // The shared window was closed, or the browser's own "stop sharing" bar was used.
    captureEnded: () => { void stopShareRef.current() },
    // The tile stays, saying why; the server is told we are no longer watching, so the place is free for someone else.
    overLimit: streamer => { void voiceHub.unwatchStream(streamer).catch(() => { /* the stream or the call is already gone */ }) },
    sharePass: kind => voiceHub.shareStream(kind),
    shareLost: reason => { void stopShareRef.current(); setError(reason) },
  }))

  const [guilds, setGuilds] = useState<GuildState[]>([])
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  /** Home = the friends / DM view instead of a guild. */
  const [home, setHome] = useState(false)
  const [friends, setFriends] = useState<FriendsDto>(EMPTY_FRIENDS)
  const [dms, setDms] = useState<DmChannelDto[]>([])
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({})
  /** Something arrived while the window was not in front (it may be put away beside the clock), and it has not been in front since. */
  const [awayNews, setAwayNews] = useState(false)
  const dmsRef = useRef<DmChannelDto[]>([])
  const homeRef = useRef(false)
  /** Walking back into a call after the connection dropped is not a coming or a going: no sound is made for it. */
  const rejoining = useRef(false)
  /** A sound about our own place in voice: the knock as we come in, the door as we go, and one of its own for being taken out. */
  const voiceSound = (event: 'join' | 'leave' | 'removed') => { if (!rejoining.current) playSound(event, settingsRef.current.soundProfile, settingsRef.current.soundEnabled) }
  /** When the sound of a new message was last played (see messageSound). */
  const lastMessageSound = useRef(0)
  useEffect(() => { dmsRef.current = dms }, [dms])
  useEffect(() => { homeRef.current = home }, [home])
  const [messages, setMessages] = useState<MessageDto[]>([])
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  /** The thread being read, if one is open: the message it hangs off, and what was said in it, oldest first. */
  const [thread, setThread] = useState<{ root: MessageDto; messages: MessageDto[]; canLoadOlder: boolean } | null>(null)
  const threadRef = useRef<string | null>(null)
  threadRef.current = thread?.root.id ?? null
  /** The post that is open in a P2P gallery, or the message whose thread is open in a P2P text channel. Its messages are among the channel's own, so only which one is kept. */
  const [p2pPost, setP2pPost] = useState<string | null>(null)
  const p2pPostRef = useRef<string | null>(null)
  p2pPostRef.current = p2pPost
  /** Looking at a page from the past (after jumping to a message): what is said now is not added below it. */
  const [viewingPast, setViewingPast] = useState(false)
  const viewingPastRef = useRef(false)
  viewingPastRef.current = viewingPast
  /** The message to bring into view and mark, after jumping to it. */
  const [highlight, setHighlight] = useState<string | null>(null)
  /** The last thing heard about a calendar channel's events, for whichever calendar is on screen to take in. */
  const [calendarChange, setCalendarChange] = useState<{ n: number; channelId: string; changed?: CalendarEventDto; deleted?: string } | null>(null)
  /** Events we have been invited to and have not answered: asked for once when the app starts, then kept up as invitations and answers arrive. */
  const [invitations, setInvitations] = useState<CalendarEventDto[]>([])
  // The newest community poll, and whether it is on screen. It comes up by itself once: when it is opened while we
  // are here, or when the app starts and we have neither answered it nor said "not now".
  const [communityPoll, setCommunityPoll] = useState<CommunityPollDto | null>(null)
  const [communityPollShown, setCommunityPollShown] = useState(false)
  const lookForPoll = useCallback((bringUp: boolean) => {
    api.latestPoll().then(poll => { setCommunityPoll(poll); if (bringUp && shouldAsk(poll)) setCommunityPollShown(true) }).catch(() => { /* a server from before there were polls */ })
  }, [api])
  /** An event the calendar is to open on, when it is next shown: from a link, a posted event or an invitation. */
  const [calendarTarget, setCalendarTarget] = useState<{ n: number; event: CalendarEventDto } | null>(null)
  /** Changes a message wherever it is held: in the channel's list, in the open thread, or as that thread's first message. */
  const patchMessage = useCallback((messageId: string, change: (m: MessageDto) => MessageDto) => {
    setMessages(ms => (ms.some(m => m.id === messageId) ? ms.map(m => (m.id === messageId ? change(m) : m)) : ms))
    setThread(t => (!t ? t : { ...t, root: t.root.id === messageId ? change(t.root) : t.root, messages: t.messages.map(m => (m.id === messageId ? change(m) : m)) }))
  }, [])
  const [activeRoll, setActiveRoll] = useState<ActiveRoll | null>(null)
  const [activeRps, setActiveRps] = useState<ActiveRps | null>(null)
  const activeRpsRef = useRef<ActiveRps | null>(null)
  const rpsClearTimer = useRef<number | undefined>(undefined)
  useEffect(() => { activeRpsRef.current = activeRps }, [activeRps])
  /** Who is typing in the open channel: their id, and the name the server sent, used only if the app knows no better one. */
  const [typing, setTyping] = useState<{ userId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Said on the sign-in screen after the account was deleted, in place of whatever the closing connections reported. */
  const [farewell, setFarewell] = useState<string | null>(null)
  /** While the server is full and this app waits in line to get in: roughly how many are ahead (0 = next). Null otherwise. */
  const [queueAhead, setQueueAhead] = useState<number | null>(null)
  /** Messages from the server's admin, shown until dismissed. */
  const [systemMessages, setSystemMessages] = useState<SystemMessageDto[]>([])
  /** signOut is defined further down; the connection's status handler needs to reach it. */
  const signOutRef = useRef<() => Promise<void>>(async () => {})
  /**
   * Set while this device's sign-in is being replaced (Sign out everywhere): the server closes this device's own
   * connection too, and the app, trying again with the sign-in being replaced, is told it is over. That is not this
   * device being signed out, so it is not acted on; the page starts again with the new sign-in.
   */
  const replacingSignIn = useRef(false)
  /** The ones closed since the app started. The log-on message comes again with every reconnect; once closed, it stays closed. */
  const closedSystemMessages = useRef(new Set<string>())
  const dismissSystemMessage = useCallback((id: string) => { closedSystemMessages.current.add(id); setSystemMessages(list => list.filter(m => m.id !== id)) }, [])
  const [status, setStatus] = useState('Connecting…')
  const [commands, setCommands] = useState<CommandDto[]>([])
  const [stats, setStats] = useState<Stats>(NO_STATS)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  useEffect(() => { readyRef.current = ready }, [ready])
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const pluginsRef = useRef<PluginInfo[]>([])
  useEffect(() => { pluginsRef.current = plugins }, [plugins])
  const [pendingDrops, setPendingDrops] = useState<PendingDrop[]>([])
  /** Sound packs the user added on this machine (desktop app only). */
  const [soundPacks, setSoundPackList] = useState<SoundPack[]>([])
  /** The Lottie decorations this server offers. */
  const [decorations, setDecorations] = useState<DecorationDto[]>([])
  const pendingDropsRef = useRef<PendingDrop[]>([])
  useEffect(() => { pendingDropsRef.current = pendingDrops }, [pendingDrops])
  const dropBusy = useRef(false)
  const [dropTick, setDropTick] = useState(0)

  const selected = useRef({ guild: null as string | null, channel: null as string | null })
  const guildsRef = useRef<GuildState[]>([])
  /** Whether a channel is in a public server, where pictures are checked before they are sent. */
  const inPublicServer = (channelId: string) => guildsRef.current.some(g => g.guild.isPublic && g.channels.some(c => c.id === channelId))
  const activeRollRef = useRef<ActiveRoll | null>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  const rollClearTimer = useRef<number | undefined>(undefined)
  const lastTypingSent = useRef(0)
  useEffect(() => { guildsRef.current = guilds }, [guilds])
  useEffect(() => { activeRollRef.current = activeRoll }, [activeRoll])
  useEffect(() => { selected.current = { guild: selectedGuildId, channel: selectedChannelId } }, [selectedGuildId, selectedChannelId])

  /**
   * Party members without the plugin (or on the web client) have no local icon, so the starter shares a small PNG of
   * it through the server. Never waits long: a roll is worth more than its picture.
   */
  const withSharedIcon = async (item: RollItemDto | null): Promise<RollItemDto | null> => {
    if (!item?.pluginId || !item.itemId || !bridge()) return item
    const plugin = pluginsRef.current.find(x => x.id.toLowerCase() === item.pluginId!.toLowerCase())
    const iconPath = plugin?.items.find(i => i.id.toLowerCase() === item.itemId!.toLowerCase())?.iconPath
    if (!plugin || !iconPath) return item
    const path = await withTimeout(shareIcon(pluginIconUrl(plugin.id, iconPath), png => api.uploadItemIcon(png)), 2500, null)
    return { ...item, iconUrl: path }
  }

  // Games are played by a party: the people in voice together, or the two people in a DM. Everything that starts or
  // shows a game goes through these two, so someone who can merely see a channel is never dealt in or shown a roll.
  const NO_PARTY = 'Join a voice channel to roll. Rolls go to the people in voice with you.'
  /** Where a game started now would go: the DM you have open, otherwise the voice channel you are in. */
  const gameChannelId = (): string | null => {
    const viewing = selected.current.channel
    if (homeRef.current && viewing && dmsRef.current.some(d => d.channelId === viewing)) return viewing
    return voiceRef.current?.channelId ?? null
  }
  const requireParty = (): string | null => { const id = gameChannelId(); if (!id) setError(NO_PARTY); return id }
  /** True if a game in that channel is ours to see: our voice channel, or one of our DMs. */
  const inParty = (channelId: string) => voiceRef.current?.channelId === channelId || dmsRef.current.some(d => d.channelId === channelId)

  // What this user chose about other people and about each server. Read through the ref so event handlers see the
  // current choice; ?? {} because a window opened before these settings existed has neither map yet.
  const userPrefs = (userId: string): UserPrefs => settingsRef.current.users?.[userId] ?? {}
  const guildPrefs = (guildId: string): GuildPrefs => settingsRef.current.guilds?.[guildId] ?? {}
  const isIgnored = (userId: string) => !!userPrefs(userId).ignored || blockedRef.current.has(userId)
  /** "@name" as a word of its own, any case. */
  const mentionsMe = (content: string) => {
    const user = settingsRef.current.user
    if (!user || !content.includes('@')) return false
    return [user.username, user.displayName].some(name => {
      if (!name) return false
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, c => '\\' + c)
      return new RegExp('(^|[^\\w@])@' + escaped + '(?![\\w])', 'i').test(content)
    })
  }
  /** A desktop notification, only while the app is not the focused window. Clicking it opens the channel. */
  /**
   * The sound of a new message. Skipped for the channel on screen while this window is in front, and held to one
   * every second and a half, so a busy channel is a sound now and then and not a drum roll.
   */
  const messageSound = (channelId: string) => {
    if (selected.current.channel === channelId && !homeRef.current && !document.hidden && document.hasFocus()) return
    if (document.hidden || !document.hasFocus()) setAwayNews(true)
    const now = Date.now()
    if (now - lastMessageSound.current < 1500) return
    lastMessageSound.current = now
    playSound('message', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
  }
  const notifyDesktop = (title: string, body: string, channelId: string) => {
    if (preferencesRef.current.status === UserStatus.DoNotDisturb) return
    if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      const said = plainEmojis(body)
      const n = new Notification(title, { body: said.length > 140 ? said.slice(0, 140) + '…' : said, silent: !settingsRef.current.soundEnabled })
      n.onclick = () => { bridge()?.showWindow?.(); window.focus(); selectChannelRef.current(channelId); n.close() }
    } catch { /* notifications unavailable */ }
  }
  const selectChannelRef = useRef<(channelId: string) => void>(() => { /* set below */ })

  const me = () => settingsRef.current.user?.id ?? ''
  /** SignalR wraps server HubExceptions as "An unexpected error occurred invoking 'X' on the server. HubException: <msg>"; show just <msg>. */
  const fail = (e: unknown) => {
    // Refused until the terms are agreed to: the terms dialog is shown for that instead (see TermsGate).
    if (e instanceof ApiError && e.code === 'terms') return
    const raw = e instanceof Error ? e.message : String(e)
    const m = /HubException: (.*)$/s.exec(raw)
    setError(m ? m[1].trim() : raw)
  }

  const patchGuild = useCallback((guildId: string, fn: (g: GuildState) => GuildState) =>
    setGuilds(gs => gs.map(g => (g.guild.id === guildId ? fn(g) : g))), [])

  // ---- Large servers: the members we were not sent -----------------------------------
  // A server with a great many members is sent the people who are there, not everyone (membersPartial). The rest
  // come when they are wanted: a page at a time in the member list, by name when looked for, and by id when
  // something of theirs is on screen.
  /** Per server: the username the next page starts after; null once the last page was read. */
  const memberCursor = useRef<Record<string, string | null>>({})
  /** Per server: whom we have already asked about by id, so nobody is asked about twice. */
  const membersAsked = useRef<Record<string, Set<string>>>({})
  /** Per server: whom the request that is about to go out will ask about. */
  const membersWanted = useRef<Record<string, Set<string>>>({})
  const [membersEnded, setMembersEnded] = useState<Record<string, boolean>>({})
  const takeMembers = useCallback((guildId: string, found: MemberDto[]) => {
    if (found.length > 0) patchGuild(guildId, g => ({ ...g, members: mergeMembers(g.members, found) }))
  }, [patchGuild])
  /** The next hundred members of a large server, in order of username. */
  const loadMoreMembers = useCallback(async (guildId: string) => {
    const after = memberCursor.current[guildId]
    if (after === null) return
    try {
      const page = await api.members(guildId, { after: after ?? undefined, limit: 100 })
      memberCursor.current[guildId] = page.next ?? null
      if (!page.next) setMembersEnded(e => ({ ...e, [guildId]: true }))
      takeMembers(guildId, page.members)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [api, takeMembers])
  /** The members of a server whose name starts with what was typed. They are kept, so the rest of the app can show them. */
  const findMembers = useCallback(async (guildId: string, q: string): Promise<MemberDto[]> => {
    try {
      const page = await api.members(guildId, { q, limit: 50 })
      takeMembers(guildId, page.members)
      return page.members
    } catch { return [] }
  }, [api, takeMembers])
  /**
   * Members of a large server we have come across and were not sent: they are asked for, once, all in one request.
   * `soon` is for what one person did (opened someone's card). What turns up for everyone at once (a message from
   * someone none of the open apps were sent) waits a few seconds chosen at random, so that a busy server's apps do
   * not all ask in the same instant.
   */
  const needMembers = useCallback((guildId: string, userIds: string[], soon = true) => {
    const g = guildsRef.current.find(x => x.guild.id === guildId)
    if (!g?.membersPartial) return
    const asked = (membersAsked.current[guildId] ??= new Set())
    const wanted = (membersWanted.current[guildId] ??= new Set())
    const fresh = membersToAsk(g.members, userIds, asked)
    if (fresh.length === 0) return
    const first = wanted.size === 0
    for (const id of fresh) wanted.add(id)
    if (!first) return
    window.setTimeout(() => {
      const ids = [...wanted]
      wanted.clear()
      for (const some of inBatches(ids, 100)) {
        api.lookupMembers(guildId, some).then(found => takeMembers(guildId, found))
          // Not answered: they may be asked about again later.
          .catch(() => { for (const id of some) asked.delete(id) })
      }
    }, soon ? 60 : 400 + Math.random() * 2600)
  }, [api, takeMembers])

  /** Guild channels and DMs alike; DMs come back with guild = null. */
  const findChannel = (channelId: string): { guild: GuildState | null; channel: ChannelDto } | null => {
    for (const g of guildsRef.current) {
      const c = g.channels.find(x => x.id === channelId)
      if (c) return { guild: g, channel: c }
    }
    const dm = dmsRef.current.find(d => d.channelId === channelId)
    return dm ? { guild: null, channel: dmChannel(dm) } : null
  }
  const isChat = (c: ChannelDto) => c.type !== ChannelType.Category

  // ---- Roll lifecycle -----------------------------------------------------

  const onRollStarted = useCallback((session: RollSessionDto) => {
    if (!inParty(session.channelId)) return // a roll in a voice channel we are not in is not ours
    window.clearTimeout(rollClearTimer.current)
    const found = findChannel(session.channelId)
    setActiveRoll({ session, result: null, channelName: found ? (found.guild ? '🔊 ' : '@') + found.channel.name : '' })
    if (session.participants.includes(me())) playSound('roll', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
  }, [])

  const onRollEnded = useCallback((result: RollResultDto) => {
    const current = activeRollRef.current
    if (!current || current.session.id !== result.sessionId) return
    setActiveRoll({ ...current, result })
    const mine = result.entries.find(e => e.userId === me())
    const s = settingsRef.current
    if (mine && mine.choice !== RollChoice.Pass) {
      const won = result.winnerId === me()
      if (won) playSound(mine.value === 100 ? 'you100' : 'win', s.soundProfile, s.soundEnabled)
      // Level with someone else at the top: a roll-off follows.
      else if (result.tiedUserIds.length > 1 && result.tiedUserIds.includes(me())) playSound('tie', s.soundProfile, s.soundEnabled)
      else if (mine.value === 1) playSound('one', s.soundProfile, s.soundEnabled)
      else if (mine.value === 69) playSound('sixtyNine', s.soundProfile, s.soundEnabled)
      else if (result.winningValue === 100) playSound('they100', s.soundProfile, s.soundEnabled)
      else if (result.winnerId && result.winningValue - mine.value >= 1 && result.winningValue - mine.value <= 5) playSound('emo', s.soundProfile, s.soundEnabled)
      else if (result.winnerId) playSound('lose', s.soundProfile, s.soundEnabled)
    }
    if (result.tiedUserIds.length <= 1)
      rollClearTimer.current = window.setTimeout(() => setActiveRoll(cur => (cur?.result ? null : cur)), 12_000)
  }, [])

  // ---- Connection ---------------------------------------------------------

  const loadGuilds = useCallback(async () => {
    const list = await api.guilds()
    memberCursor.current = {}
    membersAsked.current = {}
    membersWanted.current = {}
    setMembersEnded({})
    setGuilds(prev => list.map(g => {
      const old = prev.find(p => p.guild.id === g.guild.id)
      return { ...g, unread: old?.unread ?? 0, channelUnread: old?.channelUnread ?? {} }
    }))
    return list
  }, [api])

  const connect = useCallback(async () => {
    setFarewell(null)
    let wasConnected = false
    hub.onQueue = setQueueAhead
    hub.onStatus = s => {
      // Back after a drop: the P2P channel being read has to be connected to afresh, and whatever the server told
      // its connected apps while this one was away (a channel made or deleted, someone joining or leaving, a role
      // changed, a friend request) never reached it. So the servers, friends and conversations are asked for again:
      // once, here, and never on a timer.
      if (s === 'connected') {
        // One's roll totals, as the server has them: asked for as the app connects, and sent by the server after each roll.
        void api.rollStats().then(s => setStats(asStats(s))).catch(() => { /* an older server keeps none */ })
        if (unusedRef.current) void hub.setIdle(true).catch(() => { /* an older server has no idle */ })
        if (wasConnected) {
          setHubEpoch(n => n + 1)
          void loadGuilds().catch(() => { /* still what we had; the next reconnect asks again */ })
          void api.friends().then(setFriends).catch(() => {})
          void api.dms().then(list => { setDms(list); dmsRef.current = list }).catch(() => {})
        }
        wasConnected = true
      }
      setStatus(s === 'connected' ? 'Connected' : s === 'reconnecting' ? 'Reconnecting…' : s === 'connecting' ? 'Connecting…' : 'Disconnected')
      // The server closes the connection of an account it has just suspended. Ask it why we were dropped, and
      // if this sign-in is no longer accepted, say so and go back to the sign-in screen instead of sitting dead.
      // Offers are live on the connection that made them. We still have the files, so back online they are offered again.
      if (s === 'connected') { if (wasConnected && allowDirectRef.current) void hub.presentSeal(); void resumeOffers() }
      if (s === 'disconnected' || s === 'reconnecting') {
        api.me().catch(e => { if (e instanceof ApiError && e.unauthorized) { setError(e.message); void signOutRef.current() } })
      }
    }
    // Files this app has offered and still has: the ones picked while it has been open, and in the desktop app the ones
    // it remembered from before it was last closed, as long as each file is still where it was and unchanged.
    const resumeOffers = async () => {
      try {
        const desktop = bridge()
        const user = settingsRef.current.user
        if (!user) return
        const remembered = desktop?.offerList ? await desktop.offerList(offerScope(settingsRef.current.serverUrl, user.id)).catch(() => []) : []
        for (const r of remembered) if (!transferEngine.hasOffer(r.offerId)) transferEngine.addOffer(r.offerId, rememberedSource(r.offerId, r.name, r.size, desktop!.offerRead))
        const ids = transferEngine.offerIds()
        for (let i = 0; i < ids.length; i += 20) {
          const { resumed, gone } = await hub.resumeFileOffers(ids.slice(i, i + 20))
          // Withdrawn, deleted, or not ours: there is nothing to keep the file ready for.
          for (const id of gone) { transferEngine.removeOffer(id); void desktop?.offerForget?.(id) }
          if (resumed.length) setMessages(ms => ms.map(m => (m.fileOffer && resumed.includes(m.fileOffer.id) ? { ...m, fileOffer: { ...m.fileOffer, available: true } } : m)))
        }
      } catch { /* offline again already; the next reconnect tries again */ }
    }
    // A channel switched between relayed and P2P ends the call for everyone in it: the server drops them, and we stop
    // showing the call and say why. Nobody is carried from one kind of call into the other.
    const dropForKindChange = (now: string | null) => {
      voiceSound('removed')
      void Promise.resolve(voiceEngine.leave()).catch(() => { /* nothing to stop */ })
      streamEngine.leaveAll()
      setViewerCounts({})
      voiceRef.current = null
      setVoice(null); setIsSpeaking(false)
      setError(now ? 'That voice channel was changed to a P2P channel, so you were taken out of it. Join again if you want to.' : 'That voice channel is no longer a P2P channel, so you were taken out of it. Join again to carry on.')
    }
    await hub.connect({
      MessageReceived: m => {
        // A direct conversation that was just written in goes to the top of the list.
        if (!m.ephemeral) setDms(ds => (ds.some(d => d.channelId === m.channelId) ? newestFirst(ds.map(d => (d.channelId === m.channelId ? { ...d, lastAt: m.createdAt } : d))) : ds))
        if (!m.ephemeral && findChannel(m.channelId)?.channel.directSince && findChannel(m.channelId)?.guild) void keep(p2pBox(settingsRef.current.user?.id, m.channelId), m.id, m.createdAt, { server: m }).catch(() => {})
        if (selected.current.channel === m.channelId) {
          // While a page from the past is on screen, what is said now is not put below it: there would be a gap between.
          if (!viewingPastRef.current) setMessages(ms => (ms.some(x => x.id === m.id) ? ms : [...ms, m]))
          if (m.authorId !== me()) { setTyping(null); window.clearTimeout(typingTimer.current) }
        } else if (!m.ephemeral && !isIgnored(m.authorId)) {
          const found = findChannel(m.channelId)
          if (found?.guild && settingsRef.current.mutedChannels?.[m.channelId]) {
            // A muted channel leaves no mark at all: that is the point of muting it.
          } else if (found?.guild) {
            const muted = !!guildPrefs(found.guild.guild.id).muted
            patchGuild(found.guild.guild.id, g => ({
              ...g,
              // A muted server keeps its per-channel counts (you can still see where the talk is) but shows no badge.
              unread: muted || (g.guild.id === selected.current.guild && !homeRef.current) ? g.unread : g.unread + 1,
              channelUnread: { ...g.channelUnread, [m.channelId]: (g.channelUnread[m.channelId] ?? 0) + 1 },
            }))
          } else if (found) {
            setDmUnread(u => ({ ...u, [m.channelId]: (u[m.channelId] ?? 0) + 1 }))
          }
        }
        // Something new to read, from someone else, anywhere that is not muted: a sound. Not for the channel being read
        // in a window that is in front, where it can be seen arriving.
        if (m.authorId !== me() && !m.ephemeral && !isIgnored(m.authorId) && (m.kind === MessageKind.Text || m.kind === MessageKind.Webhook || m.kind === MessageKind.Bot)) {
          const where = findChannel(m.channelId)
          const quietPlace = !!where?.guild && (!!guildPrefs(where.guild.guild.id).muted || !!settingsRef.current.mutedChannels?.[m.channelId])
          if (where && !quietPlace) messageSound(m.channelId)
        }
        // Desktop notification while the app is in the background: always for a DM, per the server's level otherwise.
        if (m.authorId !== me() && !m.ephemeral && !isIgnored(m.authorId) && (m.kind === MessageKind.Text || m.kind === MessageKind.Webhook || m.kind === MessageKind.Bot)) {
          const where = findChannel(m.channelId)
          if (where && !where.guild) notifyDesktop(m.authorName, m.content || 'sent a picture', m.channelId)
          else if (where?.guild) {
            const prefs = guildPrefs(where.guild.guild.id)
            const level = prefs.notify ?? DEFAULT_NOTIFY
            if (!prefs.muted && !settingsRef.current.mutedChannels?.[m.channelId] && (level === 'all' || (level === 'mentions' && mentionsMe(m.content))))
              notifyDesktop(m.authorName + ' in #' + where.channel.name, m.content || 'sent a picture', m.channelId)
          }
        }
      },
      VoiceStateChanged: (channelId, participants) => {
        const found = findChannel(channelId)
        if (found?.guild) patchGuild(found.guild.guild.id, g => ({ ...g, voice: { ...(g.voice ?? {}), [channelId]: participants } }))
      },
      FriendRequest: f => setFriends(fr => ({ ...fr, incoming: [...fr.incoming.filter(x => x.user.id !== f.user.id), f] })),
      FriendAccepted: f => setFriends(fr => ({
        friends: [...fr.friends.filter(x => x.user.id !== f.user.id), f].sort((a, b) => a.user.username.localeCompare(b.user.username)),
        incoming: fr.incoming.filter(x => x.user.id !== f.user.id),
        outgoing: fr.outgoing.filter(x => x.user.id !== f.user.id),
      })),
      FriendRemoved: userId => setFriends(fr => ({
        friends: fr.friends.filter(x => x.user.id !== userId), incoming: fr.incoming.filter(x => x.user.id !== userId), outgoing: fr.outgoing.filter(x => x.user.id !== userId),
      })),
      FriendPresence: (userId, online) => {
        if (!online) { markDnd(userId, false); markIdle(userId, false) }
        const mark = <T extends { user: { id: string } }>(f: T): T => (f.user.id === userId ? { ...f, online } : f)
        setFriends(fr => ({ friends: fr.friends.map(mark), incoming: fr.incoming.map(mark), outgoing: fr.outgoing.map(mark) }))
        setDms(ds => ds.map(d => (d.other.id === userId ? { ...d, online } : d)))
      },
      DmOpened: dm => setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [{ ...dm, lastAt: dm.lastAt ?? new Date().toISOString() }, ...ds])),
      // Someone changed how they appear: update every place we hold a copy of them.
      UserUpdated: (u: UserDto) => {
        const look = { avatarUrl: u.avatarUrl, displayName: u.displayName ?? null, nameFont: u.nameFont ?? null, nameColor: u.nameColor ?? null, nameColor2: u.nameColor2 ?? null, nameEffect: u.nameEffect ?? null, decoration: u.decoration ?? null, tag: u.tag ?? null, nameplate: u.nameplate ?? null }
        setGuilds(gs => gs.map(g => (g.members.some(m => m.userId === u.id) ? { ...g, members: g.members.map(m => (m.userId === u.id ? { ...m, ...look } : m)) } : g)))
        const swap = <T extends { user: UserDto }>(f: T): T => (f.user.id === u.id ? { ...f, user: u } : f)
        setFriends(fr => ({ friends: fr.friends.map(swap), incoming: fr.incoming.map(swap), outgoing: fr.outgoing.map(swap) }))
        setDms(ds => ds.map(d => (d.other.id === u.id ? { ...d, other: u } : d)))
        if (u.id === me()) updateSettings({ user: u })
      },
      MessageDeleted: (channelId, messageId) => {
        if (selected.current.channel === channelId) setMessages(ms => ms.filter(x => x.id !== messageId))
        // A thread goes with the message it hangs off.
        setThread(t => (!t ? t : t.root.id === messageId ? null : { ...t, messages: t.messages.filter(x => x.id !== messageId) }))
      },
      ThreadMessage: m => { if (threadRef.current === m.threadId) setThread(t => (t && !t.messages.some(x => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t)) },
      ThreadChanged: (_channelId, rootId, count, lastAt) => patchMessage(rootId, m => ({ ...m, threadCount: count, threadLastAt: lastAt })),
      MessageEdited: (_channelId, messageId, content, title, editedAt) => patchMessage(messageId, m => ({ ...m, content, title: title ?? m.title, editedAt })),
      MessagePinned: (_channelId, messageId, pinnedAt) => patchMessage(messageId, m => ({ ...m, pinnedAt })),
      MessageChanged: (_channelId, messageId, content, embeds, buttons) => patchMessage(messageId, m => ({ ...m, content, embeds, buttons })),
      // Whose reaction it was says whether "mine" changes; the count is the server's.
      ReactionChanged: (_channelId, messageId, emoji, userId, on, count) => patchMessage(messageId, m => {
        const had = m.reactions ?? []
        const mine = userId === me() ? on : had.find(r => r.emoji === emoji)?.mine ?? false
        const next = count <= 0 ? had.filter(r => r.emoji !== emoji)
          : had.some(r => r.emoji === emoji) ? had.map(r => (r.emoji === emoji ? { ...r, count, mine } : r)) : [...had, { emoji, count, mine }]
        return { ...m, reactions: next.length > 0 ? next : null }
      }),
      // Taken down by a moderator: it goes from the message at once, and from this computer's own copies.
      AttachmentRemoved: (_channelId, messageId, attachmentId, removed) => {
        if (removed) void bridge()?.fileForget?.(attachmentId)
        patchMessage(messageId, m => ({ ...m, attachments: m.attachments.map(a => (a.id === attachmentId ? { ...a, removed, expired: removed } : a)) }))
      },
      PictureReactionChanged: (_channelId, messageId, attachmentId, emoji, userId, on, count) => patchMessage(messageId, m => ({
        ...m, attachments: m.attachments.map(a => {
          if (a.id !== attachmentId) return a
          const had = a.reactions ?? []
          const mine = userId === me() ? on : had.find(r => r.emoji === emoji)?.mine ?? false
          const next = count <= 0 ? had.filter(r => r.emoji !== emoji)
            : had.some(r => r.emoji === emoji) ? had.map(r => (r.emoji === emoji ? { ...r, count, mine } : r)) : [...had, { emoji, count, mine }]
          return { ...a, reactions: next.length > 0 ? next : null }
        }),
      })),
      CalendarEventChanged: event => {
        setCalendarChange(c => ({ n: (c?.n ?? 0) + 1, channelId: event.channelId, changed: event }))
        // Answered, or taken off its list: it is no longer waiting on us.
        setInvitations(list => (list.some(e => e.id === event.id)
          ? (event.participants ?? []).some(p => p.userId === me() && p.answer === EventAnswer.Invited) ? list.map(e => (e.id === event.id ? event : e)) : list.filter(e => e.id !== event.id)
          : list))
      },
      CalendarEventDeleted: (channelId, eventId) => {
        setCalendarChange(c => ({ n: (c?.n ?? 0) + 1, channelId, deleted: eventId }))
        setInvitations(list => list.filter(e => e.id !== eventId))
      },
      CommunityPollOpened: () => lookForPoll(true),
      EventInvited: event => {
        setInvitations(list => [...list.filter(e => e.id !== event.id), event])
        const by = (event.participants ?? []).find(p => p.userId === me())?.invitedById
        const who = (event.participants ?? []).find(p => p.userId === by)?.name ?? (by === event.authorId ? event.authorName : null)
        setError(`${who ?? 'Someone'} invited you to "${event.title}". Open the calendar to answer.`)
        playSound('message', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
      },
      PollChanged: (_channelId, messageId, userId, theirs, counts, voters, closed) => patchMessage(messageId, m => (!m.poll ? m : {
        ...m, poll: { ...m.poll, voters, closed, options: m.poll.options.map((o, i) => ({ ...o, votes: counts[i] ?? o.votes, mine: userId === me() ? theirs.includes(i) : o.mine })) },
      })),
      // Someone was banned and what they wrote was deleted with them: all of it, or what they wrote since a moment.
      MessagesRemoved: (channelId, authorId, since) => {
        if (selected.current.channel !== channelId) return
        const from = since ? Date.parse(since) : null
        setMessages(ms => ms.filter(x => !(x.authorId === authorId && !x.webhookId && (from === null || Date.parse(x.createdAt) >= from))))
      },
      DirectTextPeerJoined: (channelId, peer) => p2pEngine.peerJoined(channelId, peer),
      DirectTextPeerLeft: (channelId, connectionId) => p2pEngine.peerLeft(channelId, connectionId),
      DirectTextSignalReceived: (channelId, from, kind, payload) => { void p2pEngine.signal(channelId, from, kind, payload) },
      DirectTextClosed: (channelId, reason) => {
        p2pEngine.closed(channelId)
        setP2pText(p => (p && p.channelId === channelId ? { ...p, state: 'failed', reachable: 0, present: 0, note: reason } : p))
      },
      Typing: (channelId, userId, username) => {
        if (selected.current.channel !== channelId || userId === me() || isIgnored(userId)) return
        // The name is worked out where it is shown, from what the app knows of them now: the server sends the username
        // from the sign-in the typist made, which can be out of date (their name was changed since, by an admin).
        setTyping({ userId, name: username })
        window.clearTimeout(typingTimer.current)
        typingTimer.current = window.setTimeout(() => setTyping(null), 4000)
      },
      PresenceStatus: (userId, dnd) => markDnd(userId, dnd),
      PresenceIdle: (userId, idle) => markIdle(userId, idle),
      MemberPresence: (guildId, userId, online) => {
        if (!online) { markDnd(userId, false); markIdle(userId, false) }
        // No sound for this: the knock and the door are for people coming into and leaving the voice channel you are in.
        patchGuild(guildId, gs => ({ ...gs, members: gs.members.map(x => (x.userId === userId ? { ...x, online } : x)) }))
      },
      MemberJoined: (guildId, member) => patchGuild(guildId, g => ({
        ...g, members: [...g.members.filter(x => x.userId !== member.userId), member],
        memberCount: g.memberCount != null && !g.members.some(x => x.userId === member.userId) ? g.memberCount + 1 : g.memberCount,
      })),
      MemberLeft: (guildId, userId) => {
        if (userId === me()) { setGuilds(gs => gs.filter(g => g.guild.id !== guildId)); return }
        patchGuild(guildId, g => ({ ...g, members: g.members.filter(x => x.userId !== userId), memberCount: g.memberCount != null ? Math.max(0, g.memberCount - 1) : g.memberCount }))
      },
      MemberUpdated: (guildId, member) => patchGuild(guildId, g => ({ ...g, members: g.membersPartial ? mergeMembers(g.members, [member]) : g.members.map(x => (x.userId === member.userId ? member : x)) })),
      GuildUpdated: guild => patchGuild(guild.id, g => ({ ...g, guild })),
      GuildDeleted: guildId => setGuilds(gs => gs.filter(g => g.guild.id !== guildId)),
      ChannelCreated: c => { if (c.guildId) patchGuild(c.guildId, g => (g.channels.some(x => x.id === c.id) ? g : { ...g, channels: [...g.channels, c] })) },
      ChannelUpdated: c => {
        if (c.guildId) patchGuild(c.guildId, g => ({ ...g, channels: g.channels.map(x => (x.id === c.id ? { ...c, bots: c.bots ?? x.bots } : x)) }))
        const cur = voiceRef.current
        if (cur && cur.channelId === c.id && (c.directSince ?? null) !== cur.directSince) dropForKindChange(c.directSince ?? null)
      },
      ChannelDeleted: (guildId, channelId) => patchGuild(guildId, g => ({ ...g, channels: g.channels.filter(x => x.id !== channelId) })),
      PermissionsChanged: async guildId => {
        try { const fresh = await api.guild(guildId); patchGuild(guildId, g => ({ ...g, ...fresh })) } catch { /* lost access; MemberLeft handles it */ }
        // Which bot commands someone is offered can go by their roles, so those are asked for again too.
        if (selected.current.guild === guildId) setCommands(await api.commands(guildId).catch(() => []))
      },
      CommandsChanged: async guildId => { if (selected.current.guild === guildId) setCommands(await api.commands(guildId).catch(() => [])) },
      RoleCreated: r => patchGuild(r.guildId, g => ({ ...g, roles: [...(g.roles ?? []).filter(x => x.id !== r.id), r] })),
      RoleUpdated: r => patchGuild(r.guildId, g => ({ ...g, roles: (g.roles ?? []).map(x => (x.id === r.id ? r : x)) })),
      RoleDeleted: (guildId, roleId) => patchGuild(guildId, g => ({ ...g, roles: (g.roles ?? []).filter(x => x.id !== roleId) })),
      RollStarted: onRollStarted,
      RollUpdated: session => setActiveRoll(cur => (cur && cur.session.id === session.id ? { ...cur, session } : cur)),
      RollEnded: onRollEnded,
      RollStats: s => setStats(asStats(s)),
      RpsStarted: session => { if (!inParty(session.channelId)) return; window.clearTimeout(rpsClearTimer.current); setActiveRps({ session, result: null, myPick: null }) },
      RpsUpdated: session => setActiveRps(cur => (cur && cur.session.id === session.id ? { ...cur, session } : cur)),
      RpsEnded: result => {
        setActiveRps(cur => (cur && cur.session.id === result.sessionId ? { ...cur, result } : cur))
        const s = settingsRef.current
        if (result.winnerIds.length === 1 && result.entries.some(e => e.userId === me()))
          playSound(result.winnerIds[0] === me() ? 'win' : 'lose', s.soundProfile, s.soundEnabled)
        // Nobody won (everyone throws again), or several did and throw again among themselves, this one included.
        else if (result.entries.some(e => e.userId === me()) && ((result.replay && result.winnerIds.length === 0) || (result.winnerIds.length > 1 && result.winnerIds.includes(me()))))
          playSound('tie', s.soundProfile, s.soundEnabled)
        if (!result.replay) rpsClearTimer.current = window.setTimeout(() => setActiveRps(cur => (cur?.result ? null : cur)), 12_000)
      },
      ServerNotice: n => { if (n.startsWith('guild-membership-changed:')) void loadGuilds(); else setError(n) },
      FileRequested: (offerId, requester) => { void transferEngine.requested(offerId, requester) },
      FileSignalReceived: (offerId, from, kind, payload) => { void transferEngine.signal(offerId, from, kind, payload) },
      FileOfferEnded: (_channelId, offerId, withdrawn) => {
        // Withdrawn is for good. Otherwise the sender is only offline: if that is us, we keep the file ready.
        if (withdrawn) { transferEngine.removeOffer(offerId); void bridge()?.offerForget?.(offerId) }
        setMessages(ms => ms.map(m => (m.fileOffer?.id === offerId ? { ...m, fileOffer: { ...m.fileOffer, available: false, withdrawn: withdrawn || m.fileOffer.withdrawn } } : m)))
      },
      FileOfferResumed: (_channelId, offerId) => setMessages(ms => ms.map(m => (m.fileOffer?.id === offerId ? { ...m, fileOffer: { ...m.fileOffer, available: true } } : m))),
      ConnectionsChanged: () => setConnectionsEpoch(n => n + 1),
      SystemMessage: m => { if (!closedSystemMessages.current.has(m.id)) setSystemMessages(list => [...list.filter(x => x.id !== m.id), m].slice(-4)) },
    })

    // The server knows voice membership per connection. After a reconnect (network blip, server restart) it has forgotten
    // us while we still look connected, so walk back into the channel. If the connection is gone for good, stop
    // showing us as in voice: nobody can hear us, and rolls would be refused.
    // The call we were placing or in is over (hung up there, declined, cut off, no longer allowed): stop all of it here.
    const dropCall = (why: string | null) => {
      const cur = callRef.current
      setCall(null)
      if (cur && voiceRef.current?.channelId === cur.channelId) {
        void Promise.resolve(voiceEngine.leave()).catch(() => { /* nothing to stop */ })
        streamEngine.leaveAll()
        setViewerCounts({})
        voiceRef.current = null
        setVoice(null); setIsSpeaking(false)
      }
      if (why) setError(why)
    }
    voiceHub.onReconnected = () => {
      const cur = voiceRef.current
      if (!cur) return
      // A call does not outlive its connection: the server ended it when ours dropped.
      if (callRef.current?.channelId === cur.channelId) { dropCall('The call was cut off.'); return }
      // We only walk back into the same kind of call we were in. If the channel was switched between relayed and
      // P2P while we were away, rejoining is the person's decision to make again, not ours.
      const now = findChannel(cur.channelId)?.channel.directSince ?? null
      if (now !== cur.directSince) { dropForKindChange(now); return }
      void (async () => {
        // Where the channel's sound goes through a stream server, the server keeps our place for a few seconds and we
        // take it back: the sound never stopped, so nothing else is done. Mute and deafen are said again, in case they
        // were changed while the connection was down.
        if (!cur.directSince && await voiceHub.resumeVoice(cur.channelId, cur.participants)) {
          voiceRecorder.note('Back in the same place in the voice channel; the call carried on.')
          void voiceHub.setMuted(voiceEngine.mutedNow).catch(() => { /* said again at the next change */ })
          void voiceHub.setDeafened(voiceEngine.deafenedNow)
          return
        }
        voiceRecorder.note('Joining the voice channel again (sound stops for a moment).')
        const before = voiceJoins.current
        rejoining.current = true
        try { await joinVoiceRef.current(cur.channelId, true) } finally { rejoining.current = false }
        // Still showing the call from before the connection dropped, and no join got in: the server has forgotten
        // us and we are not in it. Stop showing that we are.
        if (voiceRef.current && voiceJoins.current === before && !voiceJoining.current && dropVoice()) setError(e => e ?? 'The connection to this voice channel was lost.')
      })()
    }
    const dropVoice = () => {
      if (callRef.current) setCall(null)
      if (!voiceRef.current) return false
      voiceSound('removed')
      void Promise.resolve(voiceEngine.leave()).catch(() => { /* nothing to stop */ })
      streamEngine.leaveAll()
      setViewerCounts({})
      voiceRef.current = null
      setVoice(null); setIsSpeaking(false)
      return true
    }
    voiceHub.onClosed = () => { dropVoice() }
    await voiceHub.connect({
      // A sound someone played in our voice channel: from this device's own copy, unless soundboards are muted here or we hear nobody.
      SoundPlayed: (_channelId, _userId, _id, url) => {
        const s = settingsRef.current
        if (s.soundboardMuted || voiceEngine.deafenedNow) return
        playExpressionSound(url, (s.soundboardVolume ?? 0.6) * (s.outputVolume ?? 1), s.audioOutputDeviceId)
      },
      // An account is in voice from one place at a time: it has just joined from another app or device.
      VoiceMoved: () => { if (dropVoice()) setError('Voice moved to another app or device you joined from.') },
      // Someone who may disconnect members took us out of the channel. Nothing stops us joining again.
      VoiceRemoved: () => { if (dropVoice()) setError('You were disconnected from the voice channel by someone who manages this server.') },
      // Someone who may move members moved us. We do the joining, so everything that decides whether we may still does.
      VoiceSent: toChannelId => {
        const to = findChannel(toChannelId)
        // Never into a P2P channel: that is only ever our own choice (the server refuses to ask it of us, too).
        if (!voiceRef.current || !to?.guild || to.channel.type !== ChannelType.Voice || to.channel.directSince) return
        setError(`You were moved to ${to.channel.name} by someone who manages this server.`)
        void joinVoiceRef.current(toChannelId, true)
      },
      // These only arrive for the voice channel we are in, and never for ourselves: knock when someone joins, door when they leave.
      ParticipantJoined: (c, p) => {
        const cur = voiceRef.current
        if (cur?.channelId === c && !cur.participants.some(x => x.connectionId === p.connectionId))
          playSound('join', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
        voiceEngine.setPeerSilenced(p.connectionId, !!p.silenced)
        voiceEngine.setPeerCap(p.connectionId, p.bot ? p.kbps ?? null : null)
        // A bot in a P2P call is asked for stereo: it may be there to play music.
        voiceEngine.setPeerMusic(p.connectionId, !!p.bot && cur?.channelId === c && !!cur.directSince)
        // A bot arriving in a P2P call: nothing it sends is answered unless this person has agreed to it.
        const keptAway = cur?.channelId === c && refusesVoiceBot(p, !!cur.directSince)
        if (keptAway) {
          voiceEngine.refuse(p.connectionId)
          setP2pBotsWaiting(all => (all.some(x => x.voice && x.channelId === c && x.userId === p.userId) ? all : [...all, { channelId: c, userId: p.userId, username: p.username, viaRelay: !!settingsRef.current.p2pViaRelay, voice: true }]))
        }
        setVoice(v => (v && v.channelId === c && !v.participants.some(x => x.connectionId === p.connectionId)
          ? { ...v, participants: [...v.participants, { ...p, state: keptAway ? 'not connected' : 'connecting', speaking: false }] } : v))
      },
      ParticipantLeft: (c, _userId, id) => {
        const cur = voiceRef.current
        if (cur?.channelId === c && cur.participants.some(x => x.connectionId === id))
          playSound('leave', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
        void voiceEngine.removePeer(id)
        setP2pBotsWaiting(all => (all.some(x => x.voice && x.channelId === c && x.userId === _userId) ? all.filter(x => !(x.voice && x.channelId === c && x.userId === _userId)) : all))
        streamEngine.viewerLeft(id)
        streamEngine.unwatch(id)
        setVoice(v => (v && v.channelId === c ? { ...v, participants: v.participants.filter(p => p.connectionId !== id) } : v))
      },
      ParticipantUpdated: (c, p) => {
        // They stopped sharing: whatever we were watching of theirs is over.
        if (!p.stream) streamEngine.unwatch(p.connectionId)
        // Whether they can be heard: ourselves (our app stops sending) or someone else (our app stops playing them).
        if (p.connectionId === voiceHub.connectionId) voiceEngine.setSilenced(!!p.silenced)
        else {
          voiceEngine.setPeerSilenced(p.connectionId, !!p.silenced)
          // A bot beginning a turn of being heard comes with the most it may send; counting starts afresh with each turn.
          if (p.bot) voiceEngine.setPeerCap(p.connectionId, p.silenced ? null : p.kbps ?? null)
        }
        setVoice(v => (v && v.channelId === c
          ? { ...v, participants: v.participants.map(x => (x.connectionId === p.connectionId ? { ...x, muted: p.muted, stream: p.stream ?? null, silenced: !!p.silenced, deafened: !!p.deafened } : x)) } : v))
      },
      SignalReceived: (_c, s) => { void voiceEngine.handleSignal(s) },
      CallIncoming: c => {
        // One call at a time: the server does not ring someone who is in one, and neither do we.
        if (callRef.current || c.calleeId !== settingsRef.current.user?.id) return
        setCall({ id: c.id, channelId: c.channelId, direct: c.direct, otherId: c.callerId, otherName: c.callerName, phase: 'incoming' })
        if (document.hidden && preferencesRef.current.status !== UserStatus.DoNotDisturb && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification(`${c.callerName} is calling`, { body: c.direct ? 'P2P call on Maplecord' : 'Call on Maplecord' }) } catch { /* not available here */ }
        }
      },
      CallAnswered: c => {
        const cur = callRef.current
        if (!cur || cur.id !== c.id) return
        if (cur.phase === 'calling') setCall({ ...cur, phase: 'active' })
        // Answered on another of our own apps: this one stops ringing.
        else if (cur.phase === 'incoming' && !answeringRef.current) setCall(null)
      },
      CallEnded: (id, outcome) => {
        const cur = callRef.current
        if (!cur || cur.id !== id) return
        dropCall(cur.phase !== 'calling' ? null : outcome === 'declined' ? `${cur.otherName} declined the call.` : outcome === 'missed' ? `${cur.otherName} did not answer.` : null)
      },
      StreamWatchRequested: viewer => { void streamEngine.viewerRequested(viewer) },
      // To a sharer this names a viewer who left; to a viewer it names a sharer whose stream is over.
      StreamWatchEnded: id => { streamEngine.viewerLeft(id); streamEngine.unwatch(id) },
      StreamSignalReceived: (from, kind, payload) => { void streamEngine.signal(from, kind, payload) },
      StreamViewersChanged: (id, viewers) => {
        // The stream we are sharing: one sound when someone starts watching it, another when someone stops.
        if (id === voiceHub.connectionId) {
          if (streamEngine.localStream && viewers !== ownViewers.current) playSound(viewers > ownViewers.current ? 'watch' : 'unwatch', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
          ownViewers.current = viewers
        }
        setViewerCounts(counts => ({ ...counts, [id]: viewers }))
      },
      StreamEnded: (id, reason) => {
        if (id === voiceHub.connectionId) { streamEngine.stopSharing(); if (reason) setError(reason) }
        else streamEngine.unwatch(id)
      },
    })

    const list = await loadGuilds()
    const [fr, dmList, decos] = await Promise.all([api.friends().catch(() => EMPTY_FRIENDS), api.dms().catch(() => [] as DmChannelDto[]), api.decorations().catch(() => [] as DecorationDto[])])
    // What we were invited to while away. Once, here: after this it is kept up by what arrives.
    void api.invitations().then(setInvitations).catch(() => {})
    lookForPoll(true)
    setFriends(fr); setDms(dmList); dmsRef.current = dmList; setDecorations(decos)
    void api.privacy().then(p => {
      allowDirectRef.current = p.allowDirect; setAllowDirectState(p.allowDirect)
      // Someone who allows P2P says which key their app seals with, so a file between friends can go P2P with its set-up messages sealed.
      if (p.allowDirect) void hub.presentSeal()
    }).catch(() => { /* stays "no" */ })
    void api.preferences().then(applyPreferences).catch(() => { /* shown as online */ })
    void api.blocks().then(setBlockedList).catch(() => { /* none shown */ })
    void api.transferSettings().then(setTransferLimits).catch(() => { /* the tooltip says less */ })
    void api.uploadSettings().then(rules => { p2pRelayedLimit.current = rules.maxBytes }).catch(() => { /* the usual limit is assumed */ })
    const self = settingsRef.current.user
    if (self) void api.profile(self.id).then(p => setOwnLook({ accentColor: p.accentColor, bannerUrl: p.bannerUrl })).catch(() => { /* plain background */ })
    setDndUsers(new Set([
      ...list.flatMap(g => g.members.filter(m => m.dnd).map(m => m.userId)),
      ...fr.friends.filter(f => f.dnd).map(f => f.user.id),
      ...dmList.filter(d => d.dnd).map(d => d.other.id),
    ]))
    setIdleUsers(new Set([
      ...list.flatMap(g => g.members.filter(m => m.idle).map(m => m.userId)),
      ...fr.friends.filter(f => f.idle).map(f => f.user.id),
      ...dmList.filter(d => d.idle).map(d => d.other.id),
    ]))
    const s = settingsRef.current
    const guild = list.find(g => g.guild.id === s.lastGuildId) ?? list[0]
    if (guild) {
      setSelectedGuildId(guild.guild.id)
      const channel = guild.channels.find(c => c.id === s.lastChannelId && isChat(c))
        ?? guild.channels.filter(c => c.type === ChannelType.Text).sort((a, b) => a.position - b.position)[0]
      if (channel) setSelectedChannelId(channel.id)
    } else setHome(true)
    setReady(true)
    if (isNativeApp()) void registerPhone()
    // Once in each run of the app: how far each relay is, so a voice channel nobody is in yet gets the one nearest
    // the first person into it (see relayPings.ts). After everything else has loaded, and in the background.
    if (self) void measureRelaysOnce(api, self.id)
  }, [api, applyPreferences, hub, loadGuilds, markDnd, onRollEnded, onRollStarted, patchGuild, setCall, updateSettings, voiceEngine, voiceHub])

  // ---- The phone's notifications (the iPhone app) ---------------------------------------------------------------
  // The phone is registered with the server once signed in and loaded, and again whenever what it wants to be told
  // of changes; it is forgotten when signing out. A tapped notification opens its conversation.
  const phoneToken = useRef<string | null>(null)
  const phoneVoipToken = useRef<string | null>(null)
  const openFromPush = useRef<string | null>(null)
  const registerPhone = useCallback(async () => {
    try {
      const got = await nativeApp().pushRegister()
      if (!got.token) { console.debug('[push]', got.error ?? 'no token'); return }
      phoneToken.current = got.token
      phoneVoipToken.current = got.voipToken ?? null
      await api.pushDevice({ platform: 'ios', token: got.token, voipToken: got.voipToken ?? null, sandbox: got.sandbox, choices: phoneChoices(settingsRef.current) })
    } catch (e) { console.debug('[push] not registered:', e instanceof Error ? e.message : e) }
  }, [api])
  // The shell keeps the sign-in for calls that come in while the page is not running (see native/app.ts setSession).
  const sessionToken = settings.accessToken ?? null
  useEffect(() => {
    if (!isNativeApp()) return
    void nativeApp().setSession({ serverUrl: sessionToken ? settingsRef.current.serverUrl : null, token: sessionToken }).catch(() => {})
  }, [sessionToken])
  // A call answered on the phone's own screen: joined here once the page is up and connected.
  const answerFromPhone = useRef<NativeAppEvents['callAnswered'] | null>(null)
  const joinAnsweredRef = useRef<(c: NativeAppEvents['callAnswered']) => void>(() => {})
  useEffect(() => {
    if (!isNativeApp()) return
    let handle: { remove: () => Promise<void> } | null = null
    void nativeApp().addListener('callAnswered', c => { if (readyRef.current) joinAnsweredRef.current(c); else answerFromPhone.current = c }).then(h => { handle = h })
    return () => { void handle?.remove() }
  }, [])
  useEffect(() => {
    if (!ready || !answerFromPhone.current) return
    const c = answerFromPhone.current
    answerFromPhone.current = null
    joinAnsweredRef.current(c)
  }, [ready])
  const pushPrefsKey = isNativeApp() ? JSON.stringify(phoneChoices(settings)) : ''
  useEffect(() => {
    if (!isNativeApp() || !phoneToken.current || !ready) return
    const token = phoneToken.current
    const t = window.setTimeout(() => { void api.pushDevice({ platform: 'ios', token, voipToken: phoneVoipToken.current, sandbox: false, choices: phoneChoices(settingsRef.current) }).catch(() => {}) }, 1500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sent when the choices it carries change
  }, [pushPrefsKey, ready, api])
  useEffect(() => {
    if (!isNativeApp()) return
    let handle: { remove: () => Promise<void> } | null = null
    void nativeApp().addListener('pushOpened', d => { if (d.channelId) { openFromPush.current = d.channelId; if (readyRef.current) selectChannelRef.current(d.channelId) } }).then(h => { handle = h })
    return () => { void handle?.remove() }
  }, [])
  useEffect(() => {
    if (!ready || !openFromPush.current) return
    const id = openFromPush.current
    openFromPush.current = null
    selectChannelRef.current(id)
  }, [ready])

  // ---- Selection ----------------------------------------------------------

  /** `openAt`: a channel to open in it, if the person can see it; otherwise the one they were last in, or the first. */
  const selectGuild = useCallback((guildId: string, openAt?: string | null) => {
    const g = guildsRef.current.find(x => x.guild.id === guildId)
    if (!g) return
    setHome(false)
    setSelectedGuildId(guildId)
    patchGuild(guildId, x => ({ ...x, unread: 0 }))
    updateSettings({ lastGuildId: guildId })
    const preferred = g.channels.find(c => c.id === settingsRef.current.lastChannelId && isChat(c))
    const first = g.channels.filter(c => c.type === ChannelType.Text).sort((a, b) => a.position - b.position)[0]
    const wanted = openAt ? g.channels.find(c => c.id === openAt && isChat(c)) : undefined
    setSelectedChannelId((wanted ?? preferred ?? first)?.id ?? null)
  }, [patchGuild, updateSettings])

  /** Text and voice channels both have chat; voice chat opens alongside the call. */
  const selectChannel = useCallback((channelId: string) => {
    const found = findChannel(channelId)
    if (!found || !isChat(found.channel)) return
    setSelectedChannelId(channelId)
    if (found.guild) {
      setHome(false)
      updateSettings({ lastChannelId: channelId })
      patchGuild(found.guild.guild.id, g => ({ ...g, channelUnread: { ...g.channelUnread, [channelId]: 0 } }))
    } else {
      setHome(true)
      setDmUnread(u => ({ ...u, [channelId]: 0 }))
    }
  }, [patchGuild, updateSettings])

  /** The friends / DM view. With no DM chosen the chat column shows the friends list. */
  const openHome = useCallback(() => { setHome(true); setSelectedChannelId(null) }, [])

  const openDm = useCallback(async (userId: string) => {
    await run(async () => {
      const dm = await api.openDm(userId)
      setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [{ ...dm, lastAt: dm.lastAt ?? new Date().toISOString() }, ...ds]))
      dmsRef.current = dmsRef.current.some(d => d.channelId === dm.channelId) ? dmsRef.current : [dm, ...dmsRef.current]
      setHome(true)
      setSelectedChannelId(dm.channelId)
      setDmUnread(u => ({ ...u, [dm.channelId]: 0 }))
    })
  }, [api])

  const addFriend = useCallback(async (userId: string) => run(async () => {
    const f = await api.addFriend(userId)
    setFriends(fr => f.status === 1
      ? { friends: [...fr.friends.filter(x => x.user.id !== userId), f], incoming: fr.incoming.filter(x => x.user.id !== userId), outgoing: fr.outgoing.filter(x => x.user.id !== userId) }
      : { ...fr, outgoing: [...fr.outgoing.filter(x => x.user.id !== userId), f] })
  }), [api])
  const removeFriend = useCallback(async (userId: string) => run(() => api.removeFriend(userId)), [api])
  const searchUsers = useCallback((q: string) => api.searchUsers(q), [api])

  // Pictures from P2P messages are shown through addresses made on this device. They are given back when the channel is left.
  useEffect(() => () => {
    setP2pFiles(all => { for (const view of Object.values(all)) if (view.url) URL.revokeObjectURL(view.url); return {} })
  }, [selectedChannelId])

  // Load history + active roll + commands when the channel changes.
  useEffect(() => {
    setMessages([]); setTyping(null); setCanLoadOlder(false); setThread(null); setP2pPost(null); setViewingPast(false); setHighlight(null)
    if (!selectedChannelId) return
    let cancelled = false
    ;(async () => {
      try {
        const opened = findChannel(selectedChannelId)
        // A calendar has no messages: its events are fetched by the calendar itself, a month at a time.
        if (opened?.channel.type === ChannelType.Calendar) return
        // A forum or a gallery lists its posts; what is said about one is in its thread. (A P2P gallery's posts are
        // P2P messages like any other: the server has none of them.)
        const p2pHere = !!opened?.guild && !!opened.channel.directSince
        const posts = !p2pHere && isPostsChannel(opened?.channel)
        const page = posts ? await api.posts(selectedChannelId) : await api.messages(selectedChannelId)
        if (cancelled) return
        if (p2pHere) {
          // A P2P channel: the server has nothing of it. What was said is what this device kept. A gallery's likes
          // and comments are messages too, so much more of it is read at once to count them.
          const mine = p2pTextSupported() ? await kept<{ p2p?: P2PMessage; server?: MessageDto }>(p2pBox(settingsRef.current.user?.id, selectedChannelId), isPostsChannel(opened?.channel) ? 5000 : 300).catch(() => []) : []
          if (cancelled) return
          const local = mine.map(e => (e.p2p ? p2pToMessage(e.p2p) : e.server)).filter((m): m is MessageDto => !!m)
          const all = new Map([...page, ...local].map(m => [m.id, m]))
          setMessages([...all.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
          // There may be more further back: on this device, or with the people connected.
          setCanLoadOlder(all.size > 0)
          return
        }
        setMessages(page.slice().reverse())
        setCanLoadOlder(page.length >= (posts ? 30 : 50))
        if (!inParty(selectedChannelId)) return
        const active = await hub.getActiveRoll(selectedChannelId)
        if (!cancelled && active && activeRollRef.current?.session.id !== active.id) onRollStarted(active)
        const activeRpsSession = await hub.getActiveRps(selectedChannelId)
        if (!cancelled && activeRpsSession && activeRpsRef.current?.session.id !== activeRpsSession.id) setActiveRps({ session: activeRpsSession, result: null, myPick: null })
      } catch (e) { if (!cancelled) fail(e) }
    })()
    return () => { cancelled = true }
  }, [api, hub, onRollStarted, selectedChannelId])

  // Back after a drop (see hubEpoch): what was said in the channel on screen while we were away is fetched and put
  // in place. Nothing shown is cleared, and a P2P channel is left alone: the server has none of it, and the apps of
  // the people there fill each other in.
  useEffect(() => {
    if (hubEpoch === 0) return
    const channelId = selected.current.channel
    const reading = channelId ? findChannel(channelId) : null
    if (!channelId || (reading?.guild && reading.channel.directSince) || reading?.channel.type === ChannelType.Calendar) return
    let cancelled = false
    api.messages(channelId).then(page => {
      if (cancelled || selected.current.channel !== channelId) return
      setMessages(shown => {
        const have = new Set(shown.map(m => m.id))
        const missed = page.filter(m => !have.has(m.id))
        if (missed.length === 0) return shown
        // More was said than one page holds: there is a gap between what was on screen and now, so the newest page
        // replaces it and the rest is there to scroll back to.
        if (missed.length === page.length && shown.length > 0) { setCanLoadOlder(page.length >= 50); return page.slice().reverse() }
        return [...shown, ...missed].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      })
    }).catch(() => { /* what is on screen stays */ })
    return () => { cancelled = true }
  }, [api, hubEpoch])

  useEffect(() => {
    if (!selectedGuildId) { setCommands([]); return }
    api.commands(selectedGuildId).then(setCommands).catch(() => setCommands([]))
  }, [api, selectedGuildId])

  // ---- Actions --------------------------------------------------------------

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn() }
    catch (e) {
      if (e instanceof ApiError && e.unauthorized) { setError(e.message); await signOut(); return }
      fail(e)
    }
  }

  const sendMessage = useCallback(async (text: string, attachmentIds: string[] | null = null, more: { replyToId?: string | null; poll?: NewPollDto | null } = {}) => {
    const channelId = selected.current.channel
    if (!channelId || (!text.trim() && !attachmentIds?.length)) return
    const sendingIn = findChannel(channelId)
    if (sendingIn?.guild && sendingIn.channel.directSince) {
      // A P2P channel: signed here and sent straight to everyone connected. The server is not involved.
      if (!text.trim()) return
      await run(async () => {
        // Said in the thread (or about the post) that is open, if one is, and in answer to a message if one was picked.
        const about = p2pPostRef.current
        const answers = more.replyToId
        const poll = more.poll ? { pl: { o: more.poll.options, m: more.poll.multi, h: more.poll.hours } } : {}
        const message = await p2pEngine.send(channelId, packP2p({ ...(about ? { th: about } : {}), ...(answers ? { re: answers } : {}), ...poll }, text))
        await keep(p2pBox(settingsRef.current.user?.id, channelId), message.id, message.sentAt, { p2p: message })
        if (selected.current.channel === channelId) setMessages(ms => [...ms, p2pToMessage(message)])
      })
      return
    }
    // Said in the open thread, if there is one. The plain way of sending is kept for a plain message, so that an
    // older server still takes it.
    const threadId = threadRef.current
    await run(() => (threadId || more.replyToId || more.poll
      ? hub.post({ channelId, content: text.trim(), attachmentIds, replyToId: more.replyToId ?? null, threadId, title: null, poll: more.poll ?? null })
      : hub.sendMessage(channelId, text.trim(), attachmentIds)))
  }, [hub])

  /**
   * Files in a P2P channel. Each is kept on this device (encrypted, like the messages) and described on the message
   * by name, size, kind and the hash of its contents; other people's apps fetch the contents from ours, or from
   * anyone else who has them by then. Nothing about them goes to the server.
   */
  const sendP2pFiles = useCallback(async (channelId: string, picked: File[], text = '', meta: P2PMeta | null = null): Promise<boolean> => {
    let sent = false
    await run(async () => {
      if (!p2pEngine.isIn(channelId)) throw new Error('You are not connected to this channel.')
      if (picked.length > MAX_P2P_FILES) throw new Error(`Up to ${MAX_P2P_FILES} files can go with one message.`)
      for (const f of picked) {
        if (f.size === 0) throw new Error(`${f.name} is empty.`)
        if (f.size > MAX_P2P_FILE) throw new Error(`${f.name} is ${(f.size / 1048576).toFixed(1)} MB. The most a file can be in a P2P channel is ${MAX_P2P_FILE / 1048576} MB.`)
      }
      const box = p2pBox(settingsRef.current.user?.id, channelId)
      setUploading(picked[0].name)
      try {
        const files: P2PFile[] = []
        for (const f of picked) {
          const bytes = new Uint8Array(await f.arrayBuffer())
          const hash = await sha256Hex(bytes)
          await keepFile(box, hash, bytes)
          files.push(describeFile(f.name, f.type, bytes.byteLength, hash))
        }
        // A post says so itself; anything else sent while a post is open is said about that post.
        const head = meta ?? (p2pPostRef.current && selected.current.channel === channelId ? { th: p2pPostRef.current } : null)
        const message = await p2pEngine.send(channelId, head ? packP2p(head, text) : text, files)
        await keep(box, message.id, message.sentAt, { p2p: message })
        if (selected.current.channel === channelId) setMessages(ms => [...ms, p2pToMessage(message)])
        sent = true
      } finally { setUploading(null) }
    })
    return sent
  }, [p2pEngine])

  /** A post in a P2P gallery: pictures and a title, sent to everyone connected like any other P2P message. */
  const createP2pPost = useCallback(async (title: string, text: string, files: File[]): Promise<boolean> => {
    const channelId = selected.current.channel
    if (!channelId || !title.trim()) return false
    const pictures = files.filter(f => P2P_PICTURE.test(f.type))
    if (pictures.length === 0 || pictures.length !== files.length) { setError('A post here is one or more pictures (PNG, JPEG, GIF or WebP).'); return false }
    return sendP2pFiles(channelId, pictures, text, { t: title })
  }, [sendP2pFiles])

  /**
   * A note about another message in a P2P channel (a reaction, an edit, a pin, a vote, a poll being closed) is a
   * message of its own, sent and kept like any other. Nothing already sent is changed.
   */
  const sendP2pNote = useCallback(async (meta: P2PMeta, text = '') => {
    const channelId = selected.current.channel
    if (!channelId) return
    await run(async () => {
      const message = await p2pEngine.send(channelId, packP2p(meta, text))
      await keep(p2pBox(settingsRef.current.user?.id, channelId), message.id, message.sentAt, { p2p: message })
      if (selected.current.channel === channelId) setMessages(ms => [...ms, p2pToMessage(message)])
    })
  }, [p2pEngine])
  const reactP2p = useCallback((messageId: string, emoji: string, on: boolean) => sendP2pNote({ rx: { id: messageId, e: emoji, on } }), [sendP2pNote])
  const editP2p = useCallback((messageId: string, text: string, title: string | null = null) => sendP2pNote({ ed: messageId, ...(title ? { t: title } : {}) }, text), [sendP2pNote])
  const pinP2p = useCallback((messageId: string, on: boolean) => sendP2pNote({ pin: { id: messageId, on } }), [sendP2pNote])
  const voteP2p = useCallback((messageId: string, options: number[]) => sendP2pNote({ v: { id: messageId, o: options } }), [sendP2pNote])
  const closeP2pPoll = useCallback((messageId: string) => sendP2pNote({ pc: messageId }), [sendP2pNote])

  /** Everything this device has kept of the P2P channel on screen (the newest 5,000 messages), oldest first, as it arrived. */
  const allKeptHere = useCallback(async (): Promise<{ channelId: string; all: MessageDto[]; mayManage: (authorId: string) => boolean; gallery: boolean } | null> => {
    const channelId = selected.current.channel
    const found = channelId ? findChannel(channelId) : null
    if (!channelId || !found?.guild || !found.channel.directSince) return null
    const mine = await kept<{ p2p?: P2PMessage; server?: MessageDto }>(p2pBox(settingsRef.current.user?.id, channelId), 5000).catch(() => [])
    const all = mine.map(e => (e.p2p ? p2pToMessage(e.p2p) : e.server)).filter((m): m is MessageDto => !!m).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const [guild, channel] = [found.guild, found.channel]
    return { channelId, all, mayManage: authorId => mayManageMessagesIn(guild, authorId, channel), gallery: isPostsChannel(channel) }
  }, [])
  /**
   * Just the pictures and videos of the channel on screen, newest first. For a channel the server keeps they are asked
   * for a page at a time; for a P2P text channel they are the ones on the messages this device has kept, all at once.
   */
  const loadMedia = useCallback(async (before: string | null = null): Promise<{ items: MediaItem[]; more: boolean }> => {
    const channelId = selected.current.channel
    if (!channelId) return { items: [], more: false }
    const found = findChannel(channelId)
    if (found?.guild && found.channel.directSince) {
      const here = await allKeptHere()
      if (!here) return { items: [], more: false }
      const chat = foldP2pChat(here.all, settingsRef.current.user?.id, here.mayManage)
      return { items: p2pMedia([...chat.main, ...[...chat.threads.values()].flat()]), more: false }
    }
    const page = await api.media(channelId, before)
    return { items: page.map(x => ({ ...x, key: x.file.id })), more: page.length >= 60 }
  }, [api, allKeptHere])

  /** What is pinned in a P2P text channel or gallery, from what this device has kept. */
  const loadP2pPins = useCallback(async (): Promise<MessageDto[]> => {
    const here = await allKeptHere()
    return !here ? [] : (here.gallery ? foldP2p : foldP2pChat)(here.all, settingsRef.current.user?.id, here.mayManage).pins
  }, [allKeptHere])
  /** Searching a P2P text channel or gallery looks through what this device has kept: the server has none of it. */
  const searchP2p = useCallback(async (q: string, before: string | null = null): Promise<SearchResultDto> => {
    const here = await allKeptHere()
    if (!here) return { messages: [], before: null, more: false }
    const me = settingsRef.current.user?.id
    const found = (here.gallery ? searchP2pGallery(foldP2p(here.all, me, here.mayManage), q) : searchP2pChat(foldP2pChat(here.all, me, here.mayManage), q)).filter(m => !before || m.createdAt < before)
    const page = found.slice(0, 25)
    return { messages: page, before: page.at(-1)?.createdAt ?? null, more: found.length > page.length }
  }, [allKeptHere])
  /** Brings a message of a P2P channel on screen: everything kept from a little before it onwards, and its thread if it is in one. In a gallery that is the post it is, or is said about. */
  const jumpP2p = useCallback(async (m: { id: string; channelId: string; threadId?: string | null }) => {
    const here = await allKeptHere()
    if (!here || here.channelId !== m.channelId) return
    const at = [m.id, m.threadId].map(id => here.all.findIndex(x => x.id === id)).filter(i => i >= 0)
    if (at.length === 0) return
    const from = here.all.slice(Math.max(0, Math.min(...at) - 30))
    if (selected.current.channel !== here.channelId) return
    setMessages(ms => [...new Map([...from, ...ms].map(x => [x.id, x])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    setCanLoadOlder(true)
    setP2pPost(m.threadId && here.all.some(x => x.id === m.threadId) ? m.threadId : here.gallery ? m.id : null)
    setHighlight(m.id)
  }, [allKeptHere])
  const openP2pPost = useCallback((id: string) => { setP2pPost(id); setHighlight(null) }, [])
  const closeP2pPost = useCallback(() => setP2pPost(null), [])

  /**
   * Makes a file on a P2P message ready to show or save: from this device if it is kept here, otherwise (when
   * `fetch` says so) from someone connected who has it. Returns its contents, or null if it is not to be had now.
   */
  const loadP2pFile = useCallback(async (channelId: string, file: P2PFile, authorId: string, fetch: boolean): Promise<Uint8Array<ArrayBuffer> | null> => {
    const key = `${channelId}|${file.hash}`
    if (p2pFilesBusy.current.has(key)) return null
    p2pFilesBusy.current.add(key)
    const box = p2pBox(settingsRef.current.user?.id, channelId)
    const show = (view: P2PFileView) => setP2pFiles(all => {
      if (all[key]?.url && all[key].url !== view.url) URL.revokeObjectURL(all[key].url!)
      return { ...all, [key]: view }
    })
    const have = (bytes: Uint8Array<ArrayBuffer>) => {
      // Only a picture gets an address the page can show, and only as the kind of picture it is.
      show({ state: 'have', got: file.size, url: P2P_PICTURE.test(file.type) ? URL.createObjectURL(new Blob([bytes], { type: file.type })) : undefined })
      return bytes
    }
    try {
      const mine = await keptFile(box, file.hash).catch(() => null)
      if (mine) return have(mine)
      if (!fetch) return null
      show({ state: 'fetching', got: 0 })
      let shown = 0
      const bytes = await p2pEngine.fetchFile(channelId, file, authorId, got => {
        // Often enough to see it move, not so often that the whole chat is redrawn for every piece.
        if (got - shown < file.size / 50 && got < file.size) return
        shown = got
        show({ state: 'fetching', got })
      })
      await keepFile(box, file.hash, bytes).catch(() => { /* shown now; fetched again next time */ })
      return have(bytes)
    } catch (e) {
      show({ state: e instanceof P2PFileUnavailable && e.why === 'relay' ? 'relay' : 'nobody', got: 0 })
      return null
    } finally { p2pFilesBusy.current.delete(key) }
  }, [p2pEngine])

  /** Saves a file from a P2P message where the person chooses, fetching it first if this device does not have it yet. */
  const saveP2pFile = useCallback(async (channelId: string, file: P2PFile, authorId: string) => {
    await run(async () => {
      const bytes = await loadP2pFile(channelId, file, authorId, true)
      if (!bytes) return
      const sink = await openSink(file.name, file.size, bridge())
      if (!sink) return
      try {
        for (let at = 0; at < bytes.byteLength; at += 1024 * 1024) await sink.write(bytes.subarray(at, at + 1024 * 1024))
        await sink.close()
      } catch (e) { await sink.abort().catch(() => {}); throw e }
    })
  }, [loadP2pFile])

  /** Keep the file behind an offer ready to send. The desktop app also remembers where it is, for after a restart. */
  const holdOffer = useCallback((offerId: string, file: File) => {
    transferEngine.addOffer(offerId, fileSource(file))
    const user = settingsRef.current.user
    if (user) void bridge()?.offerRemember?.(offerId, file, offerScope(settingsRef.current.serverUrl, user.id))?.catch(() => { /* offered for this run only */ })
  }, [transferEngine])

  /** Offer a file straight from this app: nothing is stored on the server, and people must be online to get it. */
  const offerFile = useCallback(async (file: File) => {
    const channelId = selected.current.channel
    if (!channelId) return
    // In a P2P channel every file already goes straight between apps.
    if (findChannel(channelId)?.guild && findChannel(channelId)?.channel.directSince) { await sendP2pFiles(channelId, [file]); return }
    await run(async () => {
      const m = await hub.offerFile(channelId, file.name, file.size)
      if (m.fileOffer) holdOffer(m.fileOffer.id, file)
    })
  }, [hub, holdOffer, sendP2pFiles])

  const withdrawFile = useCallback(async (offerId: string) => {
    transferEngine.removeOffer(offerId)
    void bridge()?.offerForget?.(offerId)
    await run(() => hub.cancelFileOffer(offerId))
  }, [hub, transferEngine])

  /** Ask where to save an offered file, then ask its sender for it. */
  const downloadFile = useCallback(async (offer: FileOfferDto) => {
    await run(async () => {
      const sink = await openSink(offer.fileName, offer.size, bridge())
      if (!sink) return
      transferEngine.receive(offer.id, offer.fileName, offer.size, sink)
      try { await hub.requestFile(offer.id, allowDirectRef.current) }
      catch (e) { transferEngine.cancel(`${offer.id}<`); throw e }
    })
  }, [hub, transferEngine])

  const cancelTransfer = useCallback((key: string) => transferEngine.cancel(key), [transferEngine])

  const [uploading, setUploading] = useState<string | null>(null)

  // ---- Files waiting to be sent: dropped, pasted or picked, shown above the message box from this device, and a
  //      picture going somewhere public checked here at once. Nothing is uploaded until Send: then they are, and go
  //      with the text as one message. One taken out before that never leaves this device.
  const [tray, setTray] = useState<TrayItem[]>([])
  const trayRef = useRef<TrayItem[]>([])
  const trayWork = useRef(new Map<string, Promise<void>>())
  /** A send of the tray under way: Send pressed again meanwhile does nothing. */
  const traySending = useRef(false)
  const putTray = useCallback((change: (items: TrayItem[]) => TrayItem[]) => { trayRef.current = change(trayRef.current); setTray(trayRef.current) }, [])
  const patchTray = useCallback((key: string, part: Partial<TrayItem>) => putTray(items => items.map(i => (i.key === key ? { ...i, ...part } : i))), [putTray])
  const removeFromTray = useCallback((key: string) => {
    const gone = trayRef.current.find(i => i.key === key)
    if (gone?.preview) URL.revokeObjectURL(gone.preview)
    trayWork.current.delete(key)
    putTray(items => items.filter(i => i.key !== key))
  }, [putTray])
  const sendFile = useCallback(async (file: File, text = '') => {
    const channelId = selected.current.channel
    if (!channelId) return
    // Not to the server, and not its name or size either: in a P2P channel a file goes between people's apps.
    if (findChannel(channelId)?.guild && findChannel(channelId)?.channel.directSince) { await sendP2pFiles(channelId, [file], text); return }
    await run(async () => {
      // Ask first, so a file that is too big is refused before it is uploaded rather than after.
      const rules = await api.uploadSettings().catch(() => null)
      if (rules && !rules.enabled) throw new Error('Uploads are turned off on this server right now.')
      if (rules && file.size > rules.maxBytes) {
        // Too big to keep on the server, but it can still go straight to whoever is online.
        const direct = await api.transferSettings().catch(() => null)
        if (direct?.enabled) {
          const m = await hub.offerFile(channelId, file.name, file.size)
          if (m.fileOffer) holdOffer(m.fileOffer.id, file)
          setError(`${file.name} is over the ${(rules.maxBytes / 1048576).toFixed(0)} MB upload limit, so it is offered directly from your computer instead. People can download it while Maplecord is open here.`)
          return
        }
        throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit here is ${(rules.maxBytes / 1048576).toFixed(0)} MB.`)
      }
      // In a public server the picture is checked here first (see checkBeforeSending); the server checks it again.
      if (inPublicServer(channelId)) await checkBeforeSending(file, 'in a public server')
      setUploading(file.name)
      try {
        const a = await api.upload(channelId, file)
        const threadId = threadRef.current
        if (threadId) await hub.post({ channelId, content: text, attachmentIds: [a.id], threadId })
        else await hub.sendMessage(channelId, text, [a.id])
      }
      finally { setUploading(null) }
    })
  }, [api, hub, holdOffer, sendP2pFiles])

  /** Files for the channel on screen: into the tray, shown from this device, and checked here if they go somewhere public. */
  const addToTray = useCallback(async (files: File[]) => {
    const channelId = selected.current.channel
    if (!channelId || files.length === 0) return
    // A P2P channel sends between people's apps, as before: nothing goes to the server to wait there.
    if (findChannel(channelId)?.guild && findChannel(channelId)?.channel.directSince) { await sendP2pFiles(channelId, files); return }
    const rules = await api.uploadSettings().catch(() => null)
    if (rules && !rules.enabled) { setError('Uploads are turned off on this server right now.'); return }
    const room = TRAY_MOST - trayRef.current.filter(i => i.channelId === channelId).length
    if (files.length > room) setError(`A message can carry ${TRAY_MOST} files at most${room > 0 ? `: the first ${room} were added` : ''}.`)
    const publicPlace = inPublicServer(channelId)
    for (const file of files.slice(0, Math.max(0, room))) {
      // Too big to keep on the server: offered straight from this computer instead, or refused, as before.
      if (rules && file.size > rules.maxBytes) { await sendFile(file); continue }
      const key = crypto.randomUUID()
      const shown = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null
      const checking = publicPlace && file.type.startsWith('image/')
      putTray(items => [...items, { key, channelId, file, name: file.name || 'Pasted file', size: file.size, preview: shown, video: file.type.startsWith('video/'), state: checking ? 'checking' : 'ready' }])
      if (!checking) continue
      // In a public server the picture is checked here first (see checkBeforeSending); the server checks it again.
      const work = checkBeforeSending(file, 'in a public server')
        .then(() => patchTray(key, { state: 'ready' }))
        .catch(e => patchTray(key, { state: 'failed', refused: true, problem: e instanceof Error ? e.message : 'It could not be checked.' }))
      trayWork.current.set(key, work)
    }
  }, [api, putTray, patchTray, sendP2pFiles, sendFile])

  /** Sends what is in the tray for the channel on screen: each file uploaded now (once checked), then one message with the text. */
  const sendTray = useCallback(async (text: string, more: { replyToId?: string | null } = {}): Promise<boolean> => {
    const channelId = selected.current.channel
    if (!channelId || traySending.current) return false
    traySending.current = true
    try {
      const keys = trayRef.current.filter(i => i.channelId === channelId).map(i => i.key)
      await Promise.all(keys.map(k => trayWork.current.get(k)))
      const items = trayRef.current.filter(i => keys.includes(i.key))
      if (items.some(i => i.refused)) { setError('A picture here cannot be sent. Take it out (×) and send again.'); return false }
      // Uploaded now, all at once. One that fails says why and stays with the rest; Send again tries it again.
      await Promise.all(items.filter(i => !i.attachmentId).map(async i => {
        patchTray(i.key, { state: 'uploading', problem: undefined })
        try { patchTray(i.key, { state: 'ready', attachmentId: (await api.upload(channelId, i.file)).id }) }
        catch (e) { patchTray(i.key, { state: 'failed', problem: e instanceof Error ? e.message : 'It could not be uploaded.' }) }
      }))
      const uploaded = trayRef.current.filter(i => keys.includes(i.key))
      if (uploaded.some(i => !i.attachmentId)) { setError('Some files could not be uploaded. Send again to try them again, or take them out (×).'); return false }
      const ids = uploaded.map(i => i.attachmentId!)
      let sent = false
      await run(async () => {
        const threadId = threadRef.current
        if (threadId || more.replyToId) await hub.post({ channelId, content: text.trim(), attachmentIds: ids, replyToId: more.replyToId ?? null, threadId, title: null, poll: null })
        else await hub.sendMessage(channelId, text.trim(), ids)
        sent = true
      })
      if (sent) for (const k of keys) removeFromTray(k)
      return sent
    } finally { traySending.current = false }
  }, [api, hub, patchTray, removeFromTray])

  const notifyTyping = useCallback(() => {
    const channelId = selected.current.channel
    if (!channelId || !hub.connected || Date.now() - lastTypingSent.current < 3000) return
    // In a P2P channel the server is not told when someone is typing either.
    if (findChannel(channelId)?.channel.directSince && findChannel(channelId)?.guild) return
    lastTypingSent.current = Date.now()
    void hub.setTyping(channelId)
  }, [hub])

  const loadOlder = useCallback(async () => {
    const channelId = selected.current.channel
    const oldest = messages[0]
    if (!channelId || !oldest) return
    const reading = findChannel(channelId)
    if (reading?.guild && reading.channel.directSince) {
      // A P2P channel: first what this device kept from further back; when that runs out, the people connected are
      // asked what they hold from before the oldest message on screen, and it arrives like anything else caught up.
      await run(async () => {
        const mine = await keptBefore<{ p2p?: P2PMessage; server?: MessageDto }>(p2pBox(settingsRef.current.user?.id, channelId), oldest.createdAt, 100)
        const local = mine.map(e => (e.p2p ? p2pToMessage(e.p2p) : e.server)).filter((m): m is MessageDto => !!m)
        if (local.length > 0) {
          if (selected.current.channel === channelId) setMessages(ms => { const have = new Set(ms.map(m => m.id)); return [...local.filter(m => !have.has(m.id)), ...ms] })
          return
        }
        // Nothing more here. If someone connected has more, it comes; the button is offered again when it does.
        setCanLoadOlder(false)
        if (p2pEngine.askOlder(channelId, oldest.createdAt) === 0) setError('That is everything this device has kept. Nobody else is connected to ask for more.')
      })
      return
    }
    if (isPostsChannel(reading?.channel)) {
      // Posts are listed by a moment (when each was last spoken in, or posted), so the next page is asked for by one.
      const forum = reading?.channel.type === ChannelType.Forum
      const last = messages.map(m => (forum ? m.threadLastAt ?? m.createdAt : m.createdAt)).sort()[0]
      await run(async () => {
        const page = await api.posts(channelId, last)
        setMessages(ms => { const have = new Set(ms.map(m => m.id)); return [...page.filter(m => !have.has(m.id)).reverse(), ...ms] })
        setCanLoadOlder(page.length >= 30)
      })
      return
    }
    await run(async () => { const page = await api.messages(channelId, oldest.id); setMessages(ms => [...page.slice().reverse(), ...ms]); setCanLoadOlder(page.length >= 50) })
  }, [api, messages, p2pEngine])

  // ---- What a message can have: a thread, an edit, reactions, a pin, a poll; and finding one ----

  /** Opens the thread of a message of the channel on screen. */
  const openThread = useCallback(async (root: MessageDto) => {
    setThread({ root, messages: [], canLoadOlder: false })
    setHighlight(null)
    await run(async () => {
      const page = await api.messages(root.channelId, undefined, 50, { thread: root.id })
      setThread(t => (t?.root.id === root.id ? { ...t, messages: page.slice().reverse(), canLoadOlder: page.length >= 50 } : t))
    })
  }, [api])
  const closeThread = useCallback(() => { setThread(null); setHighlight(null) }, [])
  const loadOlderThread = useCallback(async () => {
    const open = thread
    if (!open || open.messages.length === 0) return
    await run(async () => {
      const page = await api.messages(open.root.channelId, open.messages[0]!.id, 50, { thread: open.root.id })
      setThread(t => (t?.root.id === open.root.id ? { ...t, messages: [...page.slice().reverse(), ...t.messages], canLoadOlder: page.length >= 50 } : t))
    })
  }, [api, thread])

  /** A post in a forum or a gallery: its files are uploaded first, then it is posted with its title. */
  const createPost = useCallback(async (title: string, text: string, files: File[], poll: NewPollDto | null = null, markdown = false): Promise<boolean> => {
    const channelId = selected.current.channel
    if (!channelId) return false
    let ok = false
    await run(async () => {
      const ids: string[] = []
      if (inPublicServer(channelId)) for (const file of files) await checkBeforeSending(file, 'in a public server')
      try {
        for (const file of files) { setUploading(file.name); ids.push((await api.upload(channelId, file)).id) }
      } finally { setUploading(null) }
      await hub.post({ channelId, content: text.trim(), attachmentIds: ids, title: title.trim(), poll, markdown })
      ok = true
    })
    return ok
  }, [api, hub])

  const editMessage = useCallback(async (messageId: string, content: string, title: string | null = null) => { await run(() => hub.editMessage(messageId, content, title)) }, [hub])
  const react = useCallback(async (messageId: string, emoji: string, on: boolean) => { await run(() => hub.react(messageId, emoji, on)) }, [hub])
  const reactToPicture = useCallback(async (attachmentId: string, emoji: string, on: boolean) => { await run(() => hub.reactToPicture(attachmentId, emoji, on)) }, [hub])
  const pinMessage = useCallback(async (messageId: string, on: boolean) => { await run(() => hub.pin(messageId, on)) }, [hub])
  const votePoll = useCallback(async (messageId: string, options: number[]) => { await run(() => hub.vote(messageId, options)) }, [hub])
  const closePoll = useCallback(async (messageId: string) => { await run(() => hub.closePoll(messageId)) }, [hub])
  /** What can be reacted with: asked for once, the first time someone opens the choice. */
  const reactionList = useRef<Promise<string[]> | null>(null)
  const reactionChoices = useCallback(() => (reactionList.current ??= api.reactions().catch(() => { reactionList.current = null; return [] as string[] })), [api])
  const loadPins = useCallback(async (): Promise<MessageDto[]> => {
    const channelId = selected.current.channel
    return channelId ? api.pins(channelId) : []
  }, [api])
  const searchMessages = useCallback(async (q: string, before: string | null = null) => {
    const channelId = selected.current.channel
    if (!channelId) return { messages: [], before: null, more: false }
    return api.search(channelId, q, before)
  }, [api])

  /** Brings a message of the channel on screen into view: the page around it, or its thread if it is in one. */
  const jumpTo = useCallback(async (m: { id: string; channelId: string; threadId?: string | null }) => {
    if (selected.current.channel !== m.channelId) return
    const posts = isPostsChannel(findChannel(m.channelId)?.channel)
    await run(async () => {
      if (m.threadId || posts) {
        // In a thread, or a post (whose page is its thread): the thread is opened, on the page that holds the message.
        const rootId = m.threadId ?? m.id
        const root = await api.message(m.channelId, rootId)
        const page = m.threadId ? await api.messages(m.channelId, undefined, 50, { around: m.id }) : await api.messages(m.channelId, undefined, 50, { thread: rootId })
        setThread({ root, messages: page.slice().reverse(), canLoadOlder: page.length >= 25 })
        setHighlight(m.id)
        return
      }
      const page = await api.messages(m.channelId, undefined, 50, { around: m.id })
      setThread(null)
      setMessages(page.slice().reverse())
      setCanLoadOlder(true)
      setViewingPast(true)
      setHighlight(m.id)
    })
  }, [api])
  /** Back from a page of the past to what is being said now. */
  const backToPresent = useCallback(async () => {
    const channelId = selected.current.channel
    if (!channelId) return
    await run(async () => {
      const page = await api.messages(channelId)
      if (selected.current.channel !== channelId) return
      setMessages(page.slice().reverse()); setCanLoadOlder(page.length >= 50); setViewingPast(false); setHighlight(null)
    })
  }, [api])

  const startRoll = useCallback(async (kind: RollKind, item: RollItemDto | null, min = 1, max = 100) => {
    const channelId = requireParty()
    if (!channelId) return
    await run(async () => hub.startRoll(channelId, kind, await withSharedIcon(item), min, max))
  }, [hub])

  /** Personal dice: no session, the server posts "rolled N (min–max)" to the channel. */
  const quickRoll = useCallback(async (min = 1, max = 100) => {
    const channelId = requireParty()
    if (!channelId) return
    await run(() => hub.quickRoll(channelId, min, max))
  }, [hub])

  const roll = useCallback(async (choice: RollChoice) => {
    const cur = activeRollRef.current
    if (!cur || cur.result) return
    await run(() => hub.roll(cur.session.id, choice))
  }, [hub])

  const voteEnd = useCallback(async () => { const cur = activeRollRef.current; if (cur && !cur.result) await run(() => hub.voteEndRoll(cur.session.id)) }, [hub])
  const dismissRoll = useCallback(() => { window.clearTimeout(rollClearTimer.current); setActiveRoll(null) }, [])
  const coinFlip = useCallback(async () => { const c = requireParty(); if (c) await run(() => hub.coinFlip(c)) }, [hub])

  const startRps = useCallback(async () => { const c = requireParty(); if (c) await run(() => hub.startRps(c)) }, [hub])

  /** Overlay shortcut: one tap starts a round (if none is open) and throws. */
  const rpsThrow = useCallback(async (choice: RpsChoice) => {
    const c = requireParty()
    if (!c) return
    await run(async () => {
      let cur = activeRpsRef.current
      if (!cur || cur.result) {
        const session = await hub.startRps(c)
        cur = { session, result: null, myPick: null }
        setActiveRps(cur)
      }
      if (cur.myPick !== null) return
      await hub.rpsPick(cur.session.id, choice)
      setActiveRps(x => (x && x.session.id === cur!.session.id ? { ...x, myPick: choice } : x))
    })
  }, [hub])
  const rpsPick = useCallback(async (choice: RpsChoice) => {
    const cur = activeRpsRef.current
    if (!cur || cur.result || cur.myPick !== null) return
    await run(async () => { await hub.rpsPick(cur.session.id, choice); setActiveRps(x => (x && x.session.id === cur.session.id ? { ...x, myPick: choice } : x)) })
  }, [hub])
  const dismissRps = useCallback(() => { window.clearTimeout(rpsClearTimer.current); setActiveRps(null) }, [])

  /** Presses a button under a bot's message. What the bot answers arrives as a message. */
  const pressButton = useCallback(async (messageId: string, buttonId: string) => { await run(() => hub.pressButton(messageId, buttonId)) }, [hub])
  const invokeCommand = useCallback(async (command: CommandDto, args: Record<string, string>) => {
    const channelId = selected.current.channel
    if (!channelId) return
    // A bot's command goes through the server, and nothing typed in a P2P channel does.
    if (findChannel(channelId)?.guild && findChannel(channelId)?.channel.directSince) { setError('Bot commands do not work in a P2P channel: what is typed there does not go to the server.'); return }
    await run(() => hub.invokeCommand(channelId, command.id, args))
  }, [hub])

  const createGuild = useCallback(async (name: string, isPublic = false, kind: 'standard' | 'hybrid' | 'p2p' = 'standard') => run(async () => {
    const g = await api.createGuild(name, isPublic, kind)
    setGuilds(gs => [...gs, { ...g, unread: 0, channelUnread: {} }])
    guildsRef.current = [...guildsRef.current, { ...g, unread: 0, channelUnread: {} }]
    selectGuild(g.guild.id)
  }), [api, selectGuild])

  const joinGuild = useCallback(async (code: string) => run(async () => {
    // A whole invite link works as well as the code in it.
    const g = await api.joinInvite(inviteCodeFrom(code) ?? code)
    // Someone new to the server is taken to its welcome channel first; someone who was in it already goes where they were.
    const isNew = !guildsRef.current.some(x => x.guild.id === g.guild.id)
    const state: GuildState = { ...g, unread: 0, channelUnread: {} }
    setGuilds(gs => [...gs.filter(x => x.guild.id !== g.guild.id), state])
    guildsRef.current = [...guildsRef.current.filter(x => x.guild.id !== g.guild.id), state]
    selectGuild(g.guild.id, isNew ? g.guild.welcomeChannelId : null)
  }), [api, selectGuild])

  /** Joins a public server straight from the list of them. Throws what went wrong, for that list to show. */
  // ---- Server tags
  const tagSymbolsRef = useRef<Promise<string[]> | null>(null)
  /** The symbols a tag can carry: asked for once. */
  const tagSymbols = useCallback(() => (tagSymbolsRef.current ??= api.tagSymbols().catch(e => { tagSymbolsRef.current = null; throw e })), [api])
  const setGuildTag = useCallback(async (guildId: string, text: string, symbol: string | null) => { const guild = await api.setGuildTag(guildId, text, symbol); patchGuild(guildId, x => ({ ...x, guild })) }, [api, patchGuild])
  const removeGuildTag = useCallback(async (guildId: string) => { const guild = await api.removeGuildTag(guildId); patchGuild(guildId, x => ({ ...x, guild })) }, [api, patchGuild])
  /** Which of our servers' tags we wear, or none. Everyone who can see us is told by the server, ourselves included. */
  const wearTag = useCallback(async (guildId: string | null) => { const user = await api.wearTag(guildId); updateSettings({ user }) }, [api, updateSettings])
  const tagCard = useCallback((guildId: string) => api.tagCard(guildId), [api])

  const joinPublicGuild = useCallback(async (guildId: string) => {
    const g = await api.joinPublic(guildId)
    const isNew = !guildsRef.current.some(x => x.guild.id === g.guild.id)
    const state: GuildState = { ...g, unread: 0, channelUnread: {} }
    setGuilds(gs => [...gs.filter(x => x.guild.id !== g.guild.id), state])
    guildsRef.current = [...guildsRef.current.filter(x => x.guild.id !== g.guild.id), state]
    selectGuild(g.guild.id, isNew ? g.guild.welcomeChannelId : null)
  }, [api, selectGuild])

  /** Whether the owner is shown under their highest role in the member list, and not as "Owner". The owner's own choice. */
  const setGuildHideOwner = useCallback(async (guildId: string, hide: boolean) => {
    await run(async () => { const guild = await api.setGuildHideOwner(guildId, hide); patchGuild(guildId, x => ({ ...x, guild })) })
  }, [api, patchGuild])

  /** Whether rolls in this server's P2P channels add to people's roll totals. */
  const setGuildCountRolls = useCallback(async (guildId: string, countRolls: boolean) => {
    const guild = await api.setGuildCountRolls(guildId, countRolls)
    patchGuild(guildId, x => ({ ...x, guild }))
  }, [api, patchGuild])

  const setGuildWelcome = useCallback(async (guildId: string, channelId: string | null, messages: boolean) => {
    await run(async () => { const guild = await api.setGuildWelcome(guildId, channelId, messages); patchGuild(guildId, x => ({ ...x, guild })) })
  }, [api, patchGuild])

  // ---- Custom emojis, stickers and sounds -------------------------------------------------------------------------
  /** What may be picked in each channel, asked again after half a minute (or after something was added or taken away). */
  const usableKept = useRef(new Map<string, { at: number; data: Promise<UsableExpressionsDto> }>())
  const usableExpressions = useCallback((channelId: string): Promise<UsableExpressionsDto> => {
    const kept = usableKept.current.get(channelId)
    if (kept && Date.now() - kept.at < 30_000) return kept.data
    const data = api.usableExpressions(channelId).catch(() => { usableKept.current.delete(channelId); return { here: [], mine: [], others: [], outside: false, emojis: false, stickers: false, sounds: false } as UsableExpressionsDto })
    usableKept.current.set(channelId, { at: Date.now(), data })
    return data
  }, [api])
  const forgetUsable = useCallback(() => usableKept.current.clear(), [])
  /** Sends a sticker as a message in the open channel (or thread). */
  const sendSticker = useCallback(async (stickerId: string) => {
    const channelId = selected.current.channel
    if (!channelId) return
    await run(() => hub.post({ channelId, content: '', stickerId, threadId: threadRef.current }))
  }, [hub])
  /** Plays one of the server's sounds to everyone in our voice channel. */
  const playSoundboard = useCallback((id: string) => run(() => voiceHub.playSound(id)), [])
  /** Whether members of the open server may use emojis and stickers from outside it. */
  const setGuildOutside = useCallback(async (allowed: boolean) => {
    const g = selected.current.guild
    if (!g) return
    const guild = await api.setGuildOutside(g, allowed)
    patchGuild(g, x => ({ ...x, guild }))
    usableKept.current.clear()
  }, [api, patchGuild])

  const setGuildListing = useCallback(async (patch: { isPublic: boolean; description: string; topics: string[]; featurable: boolean }) => {
    const g = selected.current.guild
    if (g) await run(async () => { const guild = await api.updateGuildListing(g, patch); patchGuild(g, x => ({ ...x, guild })) })
  }, [api, patchGuild])

  /**
   * Drag and drop in the channel list. A channel goes into `parentId`'s group (or stays in its own with null), in
   * front of `beforeId` or at the end; a group of channels is put in front of another group. Everything that shares
   * its new place is renumbered, and only what actually changed is sent.
   */
  const moveChannel = useCallback(async (channelId: string, parentId: string | null, beforeId: string | null) => {
    const g = guildsRef.current.find(x => x.channels.some(c => c.id === channelId))
    const moving = g?.channels.find(c => c.id === channelId)
    if (!g || !moving || beforeId === channelId) return
    const group = moving.type === ChannelType.Category
    const target = group ? null : parentId ?? moving.parentId ?? null
    // A channel cannot be taken out of every group: the server has no way to say so.
    if (!group && target === null && moving.parentId) return
    const siblings = g.channels
      .filter(c => c.id !== channelId && (group ? c.type === ChannelType.Category : c.type !== ChannelType.Category && (c.parentId ?? null) === target))
      .sort((a, b) => a.position - b.position)
    const at = beforeId ? siblings.findIndex(c => c.id === beforeId) : -1
    const ordered = [...siblings]
    ordered.splice(at < 0 ? ordered.length : at, 0, moving)
    await run(async () => {
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i]
        const regroup = c.id === channelId && !group && (c.parentId ?? null) !== target ? target : null
        if (c.position === i && !regroup) continue
        const saved = await api.moveChannel(c.id, regroup, i)
        patchGuild(g.guild.id, x => ({ ...x, channels: x.channels.map(y => (y.id === saved.id ? { ...y, parentId: saved.parentId, position: saved.position } : y)) }))
      }
    })
  }, [api, patchGuild])

  /** Yours, or anyone's where you may manage messages; the server decides. */
  const deleteMessage = useCallback(async (messageId: string) => {
    const channelId = selected.current.channel
    const deletingIn = channelId ? findChannel(channelId) : null
    if (channelId && deletingIn?.guild && deletingIn.channel.directSince) {
      // A P2P channel: there is only this device's copy to remove. Everyone else keeps theirs.
      // What is kept in its place is only "this one was removed", so that catching up from others does not bring it back.
      const removing = messages.find(m => m.id === messageId)
      const removedAt = removing?.createdAt ?? new Date().toISOString()
      // Its files go from this device with it, unless another message still here carries the same file.
      for (const file of removing?.p2pFiles ?? []) {
        if (messages.some(m => m.id !== messageId && m.p2pFiles?.some(f => f.hash === file.hash))) continue
        void forgetFile(p2pBox(settingsRef.current.user?.id, channelId), file.hash).catch(() => {})
      }
      // Written over the message in one step, so there is no moment with neither the message nor the note.
      await run(async () => { await keep(p2pBox(settingsRef.current.user?.id, channelId), messageId, removedAt, { removed: messageId }); setMessages(ms => ms.filter(x => x.id !== messageId)) })
      return
    }
    await run(() => hub.deleteMessage(messageId))
  }, [hub, messages])
  /** Takes someone out of the voice channel they are in on a server; the server decides whether we may. */
  const disconnectMember = useCallback(async (channelId: string, userId: string) => { await run(() => voiceHub.disconnectMember(channelId, userId)) }, [voiceHub])
  const moveMember = useCallback(async (fromChannelId: string, userId: string, toChannelId: string) => { await run(() => voiceHub.moveMember(fromChannelId, userId, toChannelId)) }, [voiceHub])
  /** Mute someone in this server's voice channels, or undo it. Everyone is told by the server. */
  const setVoiceMuted = useCallback(async (guildId: string, userId: string, muted: boolean) => { await run(() => api.setVoiceMuted(guildId, userId, muted)) }, [api])

  /** Makes an invite to one of our servers and sends it to someone as a direct message. */
  const inviteToServer = useCallback(async (guildId: string, userId: string) => {
    await run(async () => {
      const name = guildsRef.current.find(x => x.guild.id === guildId)?.guild.name ?? 'a server'
      const invite = await api.createInvite(guildId)
      // A link to click where the server gives them out; the bare code otherwise.
      const meta = await api.meta(settingsRef.current.serverUrl)
      const link = meta?.inviteBase ? meta.inviteBase + invite.code : `invite code ${invite.code}`
      const dm = await api.openDm(userId)
      setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [{ ...dm, lastAt: dm.lastAt ?? new Date().toISOString() }, ...ds]))
      dmsRef.current = dmsRef.current.some(d => d.channelId === dm.channelId) ? dmsRef.current : [dm, ...dmsRef.current]
      await hub.sendMessage(dm.channelId, `Join me on ${name}: ${link}`, null)
      setError(`Invite to ${name} sent.`)
    })
  }, [api, hub])

  // ---- Invites (see Invites.tsx): made with an end or without, listed, and taken back
  const makeInvite = useCallback(async (guildId: string, expiresInMinutes: number | null, maxUses: number | null): Promise<InviteDto | null> => {
    let made: InviteDto | null = null
    await run(async () => { made = await api.createInvite(guildId, expiresInMinutes, maxUses) })
    return made
  }, [api])
  const loadInvites = useCallback(async (guildId: string): Promise<InviteDto[] | null> => {
    try { return await api.invites(guildId) } catch { return null }
  }, [api])
  const revokeInvite = useCallback(async (code: string): Promise<boolean> => { let done = false; await run(async () => { await api.revokeInvite(code); done = true }); return done }, [api])
  /** An invite's link as a QR code, or null where the server cannot give one (one from before it could, or the invite is gone). */
  const inviteQr = useCallback(async (code: string): Promise<QrDto | null> => { try { return await api.inviteQr(code) } catch { return null } }, [api])
  /** What an invite code is put after to make a link, where the server gives links out. */
  const inviteBase = useCallback(async (): Promise<string | null> => (await api.meta(settingsRef.current.serverUrl).catch(() => null))?.inviteBase ?? null, [api])

  // ---- Idle (see idle.ts): the server is told when this app goes unused and when it is used again, and only then
  const idleWatchRef = useRef<IdleWatch | null>(null)
  useEffect(() => {
    const desktop = bridge()
    const watch = new IdleWatch({
      now: () => Date.now(),
      later: (go, ms) => window.setTimeout(go, ms),
      cancel: timer => window.clearTimeout(timer as number),
      systemIdleSeconds: desktop ? () => desktop.systemIdleSeconds() : undefined,
      busy: () => !!voiceRef.current || !!callRef.current,
      changed: idle => { unusedRef.current = idle; try { void hub.setIdle(idle).catch(() => { /* said again once connected */ }) } catch { /* not connected: said once it is */ } },
    })
    // Moving the mouse fires many times a second; once every couple of seconds is plenty to say "in use".
    let noted = 0
    const used = () => { const now = Date.now(); if (now - noted < 2000 && !watch.idle) return; noted = now; watch.used() }
    const kinds = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    for (const kind of kinds) window.addEventListener(kind, used, { passive: true })
    idleWatchRef.current = watch
    return () => { watch.stop(); idleWatchRef.current = null; for (const kind of kinds) window.removeEventListener(kind, used) }
  }, [hub])
  // Joining or leaving a voice channel or a call counts as using the app: the ten minutes start again from there.
  useEffect(() => { idleWatchRef.current?.used() }, [voice?.channelId, call?.channelId])

  // ---- Invite links (see invites.ts) -------------------------------------------
  /** A server someone has followed an invite link to, waiting for their yes. */
  const [pendingInvite, setPendingInvite] = useState<{ code: string; name: string; members: number; publicId?: string } | null>(null)

  // ---- Linked accounts on other services (Settings, Connections) ----
  /** Goes up each time the server says a link made in the browser is done, so the list on screen is asked for again. */
  const [connectionsEpoch, setConnectionsEpoch] = useState(0)
  const loadConnections = useCallback(async (): Promise<{ services: ConnectionServiceDto[]; mine: ConnectionDto[] } | null> => {
    try { const [services, mine] = await Promise.all([api.connectionServices(), api.connections()]); return { services, mine } }
    catch (e) { fail(e); return null }
  }, [api])
  /** The address to open, in a browser, to link an account on that service. Null if it could not be had. */
  const startConnection = useCallback(async (service: string): Promise<string | null> => { let url: string | null = null; await run(async () => { url = (await api.startConnection(service)).url }); return url }, [api])
  const setConnectionShown = useCallback(async (id: string, shown: boolean): Promise<ConnectionDto | null> => { let saved: ConnectionDto | null = null; await run(async () => { saved = await api.setConnectionShown(id, shown) }); return saved }, [api])
  const removeConnection = useCallback(async (id: string): Promise<boolean> => { let done = false; await run(async () => { await api.removeConnection(id); done = true }); return done }, [api])

  // ---- Ways to sign in, and the address to be written to (Settings, My account) ----
  const loadSignIn = useCallback(async (): Promise<{ ways: SignInMethodsDto; email: ContactEmailDto } | null> => {
    try { const [ways, email] = await Promise.all([api.signInMethods(), api.contactEmail()]); return { ways, email } }
    catch { return null }
  }, [api])
  const startSignInMethod = useCallback(async (service: string): Promise<string | null> => { let url: string | null = null; await run(async () => { url = (await api.startSignInMethod(service)).url }); return url }, [api])
  const removeSignInMethod = useCallback(async (id: number): Promise<boolean> => { let done = false; await run(async () => { await api.removeSignInMethod(id); done = true }); return done }, [api])
  const setContactEmail = useCallback(async (email: string): Promise<ContactEmailDto | null> => { let saved: ContactEmailDto | null = null; await run(async () => { saved = await api.setContactEmail(email) }); return saved }, [api])
  const clearContactEmail = useCallback(async (): Promise<ContactEmailDto | null> => { let saved: ContactEmailDto | null = null; await run(async () => { saved = await api.clearContactEmail() }); return saved }, [api])

  // ---- Friend links: someone's own address, which asks them to be friends ----
  const [pendingFriendLink, setPendingFriendLink] = useState<{ code: string; user: UserDto } | null>(null)
  /** Follows a friend link: says how things already stand, or asks before a request is sent. */
  const openFriendLink = useCallback(async (link: string) => {
    if (inviteIsForAnotherServer(link, settingsRef.current.serverUrl)) { setError('That friend link is for a different Maplecord server than the one this app is connected to.'); return }
    const code = friendCodeFrom(link)
    if (!code) { setError('That is not a friend link.'); return }
    try {
      const owner = await api.friendLinkOwner(code)
      const name = owner.user.displayName ?? owner.user.username
      if (owner.state === 'self') setError('That is your own friend link. Send it to someone else.')
      else if (owner.state === 'friends') setError(`You and ${name} are already friends.`)
      else if (owner.state === 'asked') setError(`You have already asked ${name}. They have not answered yet.`)
      else setPendingFriendLink({ code, user: owner.user })
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'That friend link is no longer valid.' : e instanceof Error ? e.message : String(e))
    }
  }, [api])
  const acceptFriendLink = useCallback(async () => {
    const asked = pendingFriendLink
    setPendingFriendLink(null)
    if (!asked) return
    await run(async () => {
      const f = await api.useFriendLink(asked.code)
      const id = asked.user.id
      setFriends(fr => f.status === 1
        ? { friends: [...fr.friends.filter(x => x.user.id !== id), f], incoming: fr.incoming.filter(x => x.user.id !== id), outgoing: fr.outgoing.filter(x => x.user.id !== id) }
        : { ...fr, outgoing: [...fr.outgoing.filter(x => x.user.id !== id), f] })
    })
  }, [api, pendingFriendLink])
  const dismissFriendLink = useCallback(() => setPendingFriendLink(null), [])
  /** One's own friend link, or null if the server could not give one. */
  const loadFriendLink = useCallback(async (): Promise<FriendLinkDto | null> => { try { return await api.friendLink() } catch { return null } }, [api])
  const resetFriendLink = useCallback(async (): Promise<FriendLinkDto | null> => { let made: FriendLinkDto | null = null; await run(async () => { made = await api.resetFriendLink() }); return made }, [api])

  /** Follows an invite link: straight to the server when already a member, otherwise it asks first. A friend link goes its own way. */
  /** Goes to an event on a calendar: the calendar opens on its day, with the event shown. Says so if we cannot see it. */
  const openEvent = useCallback(async (eventId: string) => {
    try {
      const event = await api.event(eventId)
      const where = findChannel(event.channelId)
      if (!where?.guild) { setError('That event is on a calendar you cannot see.'); return }
      selectGuild(where.guild.guild.id, event.channelId)
      setCalendarTarget(t => ({ n: (t?.n ?? 0) + 1, event }))
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'That event is no longer there, or it is on a calendar you cannot see.' : e instanceof Error ? e.message : String(e))
    }
  }, [api, selectGuild])
  /** A link to an event, to paste somewhere; null when this server gives no such links. */
  const eventLink = useCallback(async (eventId: string): Promise<string | null> => {
    const base = (await api.meta(settingsRef.current.serverUrl).catch(() => null))?.eventBase
    return base ? base + eventId : null
  }, [api])

  const openInvite = useCallback(async (link: string) => {
    if (eventIdFrom(link)) {
      if (inviteIsForAnotherServer(link, settingsRef.current.serverUrl)) { setError('That link is for a different Maplecord server than the one this app is connected to.'); return }
      await openEvent(eventIdFrom(link)!)
      return
    }
    if (friendCodeFrom(link)) { await openFriendLink(link); return }
    if (inviteIsForAnotherServer(link, settingsRef.current.serverUrl)) { setError('That invite is for a different Maplecord server than the one this app is connected to.'); return }
    const code = inviteCodeFrom(link)
    if (!code) { setError('That is not an invite link.'); return }
    try {
      const preview = await api.invitePreview(code)
      if (guildsRef.current.some(x => x.guild.id === preview.guild.id)) { selectGuild(preview.guild.id); return }
      setPendingInvite({ code, name: preview.guild.name, members: preview.memberCount })
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'That invite is no longer valid.' : e instanceof Error ? e.message : String(e))
    }
  }, [api, selectGuild, openFriendLink, openEvent])

  const acceptInvite = useCallback(async () => {
    const invite = pendingInvite
    setPendingInvite(null)
    if (invite?.publicId) await run(() => joinPublicGuild(invite.publicId!))
    else if (invite) await joinGuild(invite.code)
  }, [joinGuild, joinPublicGuild, pendingInvite])

  // The browser version was opened at one server (?server=…): go to it as soon as it is among the person's servers.
  // A public server they are not in (a link from the website's featured servers) is offered to join. Otherwise, if it
  // is not there shortly after connecting, they are not in it, and the address is forgotten.
  useEffect(() => {
    if (!ready) return
    const wanted = rememberedServer()
    if (!wanted) return
    if (guilds.some(g => g.guild.id === wanted)) { forgetRememberedServer(); selectGuild(wanted); return }
    const ask = window.setTimeout(() => {
      void api.discoverOne(wanted).then(g => {
        if (rememberedServer() !== wanted || g.joined) return
        forgetRememberedServer()
        setPendingInvite({ code: '', name: g.name, members: g.memberCount, publicId: g.id })
      }).catch(() => { /* not public: it is waited for as a server they are in */ })
    }, 2000)
    const giveUp = window.setTimeout(forgetRememberedServer, 15_000)
    return () => { window.clearTimeout(ask); window.clearTimeout(giveUp) }
  }, [ready, guilds, selectGuild, api])

  // Once connected: the invite the browser version was opened with, the one the desktop app was started by, and any
  // link clicked while the desktop app is running (it is told there is one, and takes it).
  useEffect(() => {
    if (!ready) return
    const remembered = takeRememberedInvite()
    if (remembered) void openInvite(remembered)
    const rememberedFriend = takeRememberedFriendLink()
    if (rememberedFriend) void openFriendLink(rememberedFriend)
    const rememberedEvent = takeRememberedEvent()
    if (rememberedEvent) void openInvite(rememberedEvent)
    const desktop = bridge()
    if (!desktop) return
    void desktop.takeUpdateNotice?.().then(notice => {
      if (notice) setError(`Maplecord ${notice.version} is out, but this copy could not update itself${notice.reason === 'folder' ? ' (its folder cannot be written to)' : ''}. Download it from the Maplecord website.`)
    })
    const take = () => void desktop.takeInviteLink().then(link => { if (link) void openInvite(link) })
    take()
    return desktop.onInviteLink(take)
  }, [ready, openInvite, openFriendLink])

  const createChannel = useCallback(async (name: string, type: number, parentId: string | null, direct = false) => {
    const g = selected.current.guild
    if (g) await run(() => api.createChannel(g, name, type, parentId, direct))
  }, [api])

  const leaveGuild = useCallback(async () => {
    const g = guildsRef.current.find(x => x.guild.id === selected.current.guild)
    if (!g) return
    await run(async () => {
      if (g.guild.ownerId === me()) await api.deleteGuild(g.guild.id); else await api.leaveGuild(g.guild.id)
      setGuilds(gs => gs.filter(x => x.guild.id !== g.guild.id))
      setSelectedGuildId(null); setSelectedChannelId(null)
    })
  }, [api])

  const kickMember = useCallback(async (m: MemberDto) => { const g = selected.current.guild; if (g) await run(() => api.kick(g, m.userId)) }, [api])
  const banMember = useCallback(async (m: MemberDto, deleteDays: number | null = null) => { const g = selected.current.guild; if (g) await run(() => api.ban(g, m.userId, deleteDays)) }, [api])

  // ---- Server settings --------------------------------------------------------

  const renameGuild = useCallback(async (name: string) => { const g = selected.current.guild; if (g) await run(async () => { const guild = await api.updateGuild(g, name); patchGuild(g, x => ({ ...x, guild })) }) }, [api, patchGuild])
  const setGuildIcon = useCallback(async (file: File | null) => {
    const g = selected.current.guild
    if (!g) return
    await run(async () => {
      if (file) { tooBig(file, 2 * 1024 * 1024, 'A server icon'); await checkBeforeSending(file, 'as a server icon'); const guild = await api.uploadGuildIcon(g, file); patchGuild(g, x => ({ ...x, guild })) }
      else { await api.deleteGuildIcon(g); patchGuild(g, x => ({ ...x, guild: { ...x.guild, iconUrl: null } })) }
    })
  }, [api, patchGuild])
  const setGuildBanner = useCallback(async (file: File | null) => {
    const g = selected.current.guild
    if (!g) return
    await run(async () => {
      if (file) { tooBig(file, 4 * 1024 * 1024, 'A server banner'); await checkBeforeSending(file, 'as a server banner'); const guild = await api.uploadGuildBanner(g, file); patchGuild(g, x => ({ ...x, guild })) }
      else { await api.deleteGuildBanner(g); patchGuild(g, x => ({ ...x, guild: { ...x.guild, bannerUrl: null } })) }
    })
  }, [api, patchGuild])
  const createRole = useCallback(async (name: string, color: string | null, permissions: number) => {
    const g = selected.current.guild
    if (g) await run(async () => { const r = await api.createRole(g, name, color, permissions); patchGuild(g, x => ({ ...x, roles: [...(x.roles ?? []).filter(y => y.id !== r.id), r] })) })
  }, [api, patchGuild])
  const updateRole = useCallback(async (roleId: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) => {
    const g = selected.current.guild
    if (g) await run(async () => { const r: RoleDto = await api.updateRole(roleId, patch); patchGuild(g, x => ({ ...x, roles: (x.roles ?? []).map(y => (y.id === r.id ? r : y)) })) })
  }, [api, patchGuild])
  const deleteRole = useCallback(async (roleId: string) => {
    const g = selected.current.guild
    if (g) await run(async () => { await api.deleteRole(roleId); patchGuild(g, x => ({ ...x, roles: (x.roles ?? []).filter(y => y.id !== roleId) })) })
  }, [api, patchGuild])
  const setMemberRoles = useCallback(async (userId: string, roleIds: string[]) => {
    const g = selected.current.guild
    if (g) await run(async () => { await api.setMemberRoles(g, userId, roleIds); patchGuild(g, x => ({ ...x, members: x.members.map(m => (m.userId === userId ? { ...m, roleIds } : m)) })) })
  }, [api, patchGuild])

  // ---- Voice ----------------------------------------------------------------

  const leaveVoice = useCallback(async () => {
    if (!voiceRef.current) return
    const left = voiceRef.current.channelId
    voiceSound('leave')
    streamEngine.leaveAll()
    setViewerCounts({})
    try { await voiceEngine.leave() } catch { /* nothing to stop */ }
    try { await voiceHub.leave() } catch { /* hub gone */ }
    voiceRef.current = null
    setVoice(null); setIsSpeaking(false)
    // Leaving a call is hanging up (or giving up on one that is still ringing): the server ends it for both.
    if (callRef.current?.channelId === left) setCall(null)
    // We walked out of that party: its roll is no longer ours (the server passes for us).
    setActiveRoll(cur => (cur && cur.session.channelId === left ? null : cur))
    setActiveRps(cur => (cur && cur.session.channelId === left ? null : cur))
  }, [setCall, voiceEngine, voiceHub])
  // The stream server carrying the channel's voice could not be reached again: out of the call, and say why.
  voiceLostRef.current = reason => { void leaveVoice(); setError(reason) }
  hangUpAskedRef.current = () => { void leaveVoice() }

  // ---- Sharing a screen, an app window or a camera with the voice channel -----------------------------------------

  const loadStreamRules = useCallback(async () => {
    const rules = await api.streamSettings(voiceRef.current?.channelId)
    streamRulesRef.current = rules
    setStreamRules(rules)
    return rules
  }, [api])

  /** Tell the channel we are sharing and hand the capture to the engine. Nothing is sent until someone watches. */
  const shareStream = useCallback(async (media: MediaStream, kind: StreamKind, quality: StreamQuality | null = null) => {
    // Where this channel has a stream server the reply is a pass to send the video there; otherwise viewers are
    // connected to one by one as they ask.
    let pass: SfuPassDto | null
    try { pass = await voiceHub.shareStream(kind) }
    catch (e) { media.getTracks().forEach(t => t.stop()); throw e }
    // A new stream starts with nobody watching, whatever the last one ended on.
    const own = voiceHub.connectionId
    ownViewers.current = 0
    if (own) setViewerCounts(counts => ({ ...counts, [own]: 0 }))
    // In a P2P channel or call the video goes from this app to each viewer, and from the third viewer on the encodes are shared.
    try { await streamEngine.start(media, kind, quality, pass, !!voiceRef.current?.directSince) }
    catch {
      media.getTracks().forEach(t => t.stop())
      try { await voiceHub.stopStream(null) } catch { /* not in voice any more */ }
      throw new Error('Could not reach the stream server, so nothing is being shared. Try again in a moment.')
    }
  }, [streamEngine, voiceHub])

  /**
   * Start sharing. In the desktop app `sourceId` is the window or screen picked in our own dialog; in a browser it
   * is null and the browser shows its own picker.
   */
  const startShare = useCallback(async (source: { type: 'camera' } | { type: 'display'; sourceId: string | null; kind: StreamKind | null }, hint: 'motion' | 'detail' = 'motion', sound = false, wanted: StreamQuality | null = null) => {
    if (!voiceRef.current) { setError('Join a voice channel first, then share with the people in it.'); return }
    await run(async () => {
      const rules = await loadStreamRules()
      if (!rules.enabled) throw new Error('Sharing video is turned off on this server right now.')
      // The quality asked for, held to what this kind of channel allows: P2P channels and calls have limits of their own.
      const direct = !!voiceRef.current?.directSince
      const allowed = qualityChoices(rules, direct)
      const picked = (wanted && allowed.find(q => q.height === wanted.height && q.fps === wanted.fps)) || defaultQuality(rules, direct)
      const quality = { ...picked, kbps: p2pVideoRate(picked.kbps, direct, settingsRef.current.p2pVideoKbps, rules) }
      let media: MediaStream
      let kind: StreamKind
      try {
        if (source.type === 'camera') {
          media = await navigator.mediaDevices.getUserMedia({ video: { ...videoConstraints(quality), height: { max: quality.height, ideal: quality.height } }, audio: false })
          kind = 'camera'
        } else {
          if (source.sourceId) await bridge()?.shareChoose(source.sourceId)
          // Sound is only ever asked for where this app's own sound can be left out of it: otherwise everyone in the
          // call would hear themselves coming back.
          media = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints(quality), audio: sound && canShareSound() ? soundConstraints() : false })
          kind = source.kind ?? (media.getVideoTracks()[0]?.getSettings().displaySurface === 'monitor' ? 'screen' : 'window')
        }
      } catch (e) {
        // Closing the browser's picker is not an error worth a message.
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError') && source.type === 'display' && !source.sourceId) return
        throw new Error(source.type === 'camera' ? 'The camera could not be opened. Is another app using it?' : 'That could not be shared. If it is a window, make sure it is not minimised.')
      }
      applyHint(media, kind === 'camera' ? 'motion' : hint)
      await shareStream(media, kind, quality)
    })
  }, [loadStreamRules, shareStream])

  const stopShare = useCallback(async (reason?: string) => {
    streamEngine.stopSharing()
    try { await voiceHub.stopStream(reason ?? null) } catch { /* not in voice any more */ }
  }, [streamEngine, voiceHub])
  stopShareRef.current = stopShare

  const watchStream = useCallback(async (streamer: string) => {
    await run(async () => {
      if (!streamRulesRef.current) await loadStreamRules().catch(() => null)
      streamEngine.watch(streamer)
      let pass: SfuPassDto | null
      try { pass = await voiceHub.watchStreamVia(streamer) }
      catch (e) { streamEngine.unwatch(streamer); throw e }
      // A stream that goes through the channel's stream server is collected from there.
      if (pass) void streamEngine.watchVia(streamer, pass)
    })
  }, [loadStreamRules, streamEngine, voiceHub])

  const unwatchStream = useCallback(async (streamer: string) => {
    streamEngine.unwatch(streamer)
    try { await voiceHub.unwatchStream(streamer) } catch { /* the stream or the call is already gone */ }
  }, [streamEngine, voiceHub])

  const sharing = streamEngine.sharing

  // A stream whose sharer has walked away ends: no speech and no keyboard or mouse for the time the server sets.
  // Only the desktop app can know about the keyboard and mouse, so only it applies this.
  const speakingRef = useRef(false)
  const lastSpokeRef = useRef(0)
  useEffect(() => { speakingRef.current = isSpeaking; if (isSpeaking) lastSpokeRef.current = Date.now() }, [isSpeaking])
  useEffect(() => {
    const desktop = bridge()
    const minutes = streamRules?.inactiveMinutes ?? 0
    if (!sharing || !desktop || minutes <= 0) return
    lastSpokeRef.current = Date.now()
    const timer = window.setInterval(async () => {
      const idle = await desktop.systemIdleSeconds().catch(() => 0)
      const quiet = speakingRef.current ? 0 : (Date.now() - lastSpokeRef.current) / 1000
      if (Math.min(idle, quiet) < minutes * 60) return
      const span = minutes === 1 ? 'a minute' : `${minutes} minutes`
      setError(`Your stream ended because you were away for ${span}.`)
      void stopShareRef.current(`The stream ended because its sharer was away for ${span}.`)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [sharing, streamRules])

  // Back in front after being in the background (a phone's browser minimised, mostly): see VoiceEngine.recover.
  useEffect(() => {
    const onBack = () => {
      // Said as the page is hidden, while it can still do something about it (see VoiceEngine.setBackground).
      if (isHandheld()) voiceEngine.setBackground(document.hidden)
      if (!document.hidden) void voiceEngine.recover()
    }
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('pageshow', onBack)
    return () => { document.removeEventListener('visibilitychange', onBack); window.removeEventListener('pageshow', onBack) }
  }, [voiceEngine])

  // Video is not sent to someone who is not looking: when this window has been hidden for a little while we stop
  // watching, and pick the same streams up again when it comes back.
  const pausedRef = useRef<string[]>([])
  useEffect(() => {
    let timer: number | undefined
    const onChange = () => {
      window.clearTimeout(timer)
      // "Not looking" means the app is hidden and no stream is showing in a window of its own.
      const watchingSomewhere = !document.hidden || anyPopoutVisible()
      if (!watchingSomewhere) {
        timer = window.setTimeout(() => {
          if (!document.hidden || anyPopoutVisible()) return
          const live = streamEngine.watching().filter(w => w.state !== 'failed').map(w => w.streamer)
          if (live.length === 0) return
          pausedRef.current = live
          for (const streamer of live) void unwatchStream(streamer)
        }, 15000)
      } else if (pausedRef.current.length > 0) {
        const resume = pausedRef.current
        pausedRef.current = []
        const stillSharing = new Set((voiceRef.current?.participants ?? []).filter(p => p.stream).map(p => p.connectionId))
        for (const streamer of resume) if (stillSharing.has(streamer)) void watchStream(streamer)
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => { document.removeEventListener('visibilitychange', onChange); window.clearTimeout(timer) }
  }, [streamEngine, unwatchStream, watchStream])

  // In development only: lets a test hand the app a made-up video to share, since a real capture needs a person to pick it.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __maplecordDev?: unknown }
    w.__maplecordDev = { shareStream: async (media: MediaStream, kind: StreamKind, quality?: StreamQuality) => { const rules = await loadStreamRules(); await shareStream(media, kind, quality ?? defaultQuality(rules, !!voiceRef.current?.directSince)) } }
    return () => { delete w.__maplecordDev }
  }, [loadStreamRules, shareStream])

  /**
   * Join a voice channel. Relay is the default; if the server has no relay (or the user chose direct),
   * the first join per guild shows a notice explaining that members will see your IP.
   */
  const joinVoice = useCallback(async (channelId: string, acknowledged = false) => {
    const found = findChannel(channelId)
    if (!found?.guild || found.channel.type !== ChannelType.Voice) return
    const guildId = found.guild.guild.id
    const s = settingsRef.current
    // A P2P channel is never joined in passing. The account must allow P2P at all, and the person must have read this
    // channel's warning (once per channel, and again if the channel has been switched since).
    const directSince = found.channel.directSince ?? null
    if (directSince) {
      if (!allowDirectRef.current) { setDirectPrompt({ channelId, kind: 'blocked' }); return }
      if (!acknowledged && s.directAcknowledged[channelId] !== directSince) { setDirectPrompt({ channelId, kind: 'warn' }); return }
    }
    // One join at a time: a second click while the first is still opening the microphone starts nothing more.
    if (voiceJoining.current) return
    voiceJoining.current = true
    try { await run(async () => {
      // For a relayed channel the server hands out a relay or refuses: there is nothing here to fall back to.
      const ice = await api.iceServers(channelId)
      // In a P2P channel a person's own choice of voice quality comes first: it is their connection, not a relay's.
      const serverKbps = (await api.voiceSettings().catch(() => null))?.audioKbps ?? 0
      voiceEngine.relayedAudioKbps = serverKbps
      voiceEngine.maxAudioKbps = (directSince && s.p2pAudioKbps) || serverKbps
      // A P2P channel is joined directly unless this person chose to go through the relay there.
      const viaRelay = !!directSince && !!s.p2pViaRelay
      const policy = voiceEngine.configure(ice, directSince && !viaRelay ? 'direct' : 'relay')
      if (!directSince && policy !== 'relay') throw new Error('No voice relay is available right now, so this channel cannot connect.')
      if (viaRelay && policy !== 'relay') throw new Error('The relay is not available to you in P2P channels on this server. To join directly, turn off "Join P2P channels through the relay" under Settings, Voice & audio.')
      if (voiceRef.current) await leaveVoice()
      voiceEngine.setDevices(s.audioInputDeviceId, s.audioOutputDeviceId)
      // An ordinary channel may answer with a pass: its voice then goes through the stream server, not app to app.
      const answer = directSince ? { others: await voiceHub.joinDirect(channelId), pass: null } : await voiceHub.joinVia(channelId)
      const others = answer.others
      // Bots already in a P2P channel: this app offers them nothing until this person agrees to each by name.
      const keptAway = others.filter(p => refusesVoiceBot(p, !!directSince))
      setP2pBotsWaiting(all => [...all.filter(x => !x.voice), ...keptAway.map(p => ({ channelId, userId: p.userId, username: p.username, viaRelay, voice: true }))])
      const user = s.user!
      const selfId = voiceHub.connectionId ?? 'self'
      const joined: VoiceState = {
        channelId, guildId, directSince, policy, status: '',
        participants: [
          ...others.map(p => ({ ...p, state: keptAway.includes(p) ? 'not connected' : 'connecting', speaking: false })),
          { userId: user.id, username: user.username, connectionId: selfId, muted: isMuted, state: '', speaking: false, silenced: voiceHub.selfSilenced },
        ],
      }
      voiceRef.current = joined // before the next render, so a roll that starts right now already counts as ours
      voiceJoins.current++
      setVoice(joined)
      voiceSound('join')
      // A roll or round may already be running in the party we just walked into.
      void (async () => {
        try {
          const active = await hub.getActiveRoll(channelId)
          if (active && activeRollRef.current?.session.id !== active.id) onRollStarted(active)
          const round = await hub.getActiveRps(channelId)
          if (round && activeRpsRef.current?.session.id !== round.id) setActiveRps({ session: round, result: null, myPick: null })
        } catch { /* not worth an error banner */ }
      })()
      if (isMuted) void voiceHub.setMuted(true)
      // What a phone shows for this call on its lock screen.
      if (voiceEngine instanceof NativeVoiceEngine) voiceEngine.callTitle = found.channel.name || 'Maplecord'
      try {
        await voiceEngine.join(others, answer.pass, voiceHub.selfSilenced, keptAway.map(p => p.connectionId), directSince ? others.filter(p => p.bot).map(p => p.connectionId) : [])
        // Any bot being heard among them comes with the most it may send (joining starts by clearing every limit).
        for (const p of others) if (p.bot && !p.silenced && p.kbps) voiceEngine.setPeerCap(p.connectionId, p.kbps)
      }
      catch (e) {
        // No way in at all is different from no microphone: we are not in the call, and the server is told so.
        if (e instanceof VoiceConnectError) { await leaveVoice(); throw e }
        setVoice(v => (v ? { ...v, status: 'No microphone: ' + (e instanceof Error ? e.message : e) } : v))
      }
    }) }
    finally { voiceJoining.current = false }
  }, [api, hub, isMuted, leaveVoice, onRollStarted, voiceEngine, voiceHub])

  useEffect(() => { joinVoiceRef.current = joinVoice }, [joinVoice])

  // The relay's sign-in details run out after a while. While in a call they are fetched again now and then, so a
  // connection to someone who joins later is made with ones that still work.
  const voiceChannelNow = voice?.channelId ?? null
  useEffect(() => {
    if (!voiceChannelNow) return
    const timer = window.setInterval(() => {
      api.iceServers(voiceChannelNow).then(ice => { if (voiceRef.current?.channelId === voiceChannelNow) voiceEngine.reconfigure(ice) }).catch(() => { /* the ones we have are used until the next try */ })
    }, 20 * 60_000)
    return () => window.clearInterval(timer)
  }, [api, voiceChannelNow, voiceEngine])

  // ---- Calls with a friend ---------------------------------------------------------
  // A call is voice in the direct-message channel the two share. It is relayed unless the caller asked for a P2P
  // call, both accounts allow P2P, and the person answering was shown that this is what it is.

  /** Take our place in a call's room: the same engine as a voice channel, set up for this call's kind and no other. */
  const enterCall = useCallback(async (channelId: string, direct: boolean, connect: () => Promise<VoiceParticipantDto[]>) => {
    const s = settingsRef.current
    const ice = await api.iceServers(channelId)
    const serverKbps = (await api.voiceSettings().catch(() => null))?.audioKbps ?? 0
    voiceEngine.relayedAudioKbps = serverKbps
    voiceEngine.maxAudioKbps = (direct && s.p2pAudioKbps) || serverKbps
    const policy = voiceEngine.configure(ice, direct ? 'direct' : 'relay')
    if (!direct && policy !== 'relay') throw new Error('No voice relay is available right now, so the call cannot connect. It will not fall back to a direct connection.')
    voiceEngine.setDevices(s.audioInputDeviceId, s.audioOutputDeviceId)
    const others = await connect()
    const user = s.user!
    const joined: VoiceState = {
      channelId, guildId: '', directSince: direct ? new Date().toISOString() : null, policy, status: '',
      participants: [
        ...others.map(p => ({ ...p, state: 'connecting', speaking: false })),
        { userId: user.id, username: user.username, connectionId: voiceHub.connectionId ?? 'self', muted: isMuted, state: '', speaking: false },
      ],
    }
    voiceRef.current = joined
    setVoice(joined)
    voiceSound('join')
    if (isMuted) void voiceHub.setMuted(true)
    try { await voiceEngine.join(others) }
    catch (e) { setVoice(v => (v ? { ...v, status: 'No microphone: ' + (e instanceof Error ? e.message : e) } : v)) }
  }, [api, isMuted, voiceEngine, voiceHub])

  const startCall = useCallback(async (userId: string, direct: boolean) => {
    if (callRef.current) return
    await run(async () => {
      const dm = await api.openDm(userId)
      setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [{ ...dm, lastAt: dm.lastAt ?? new Date().toISOString() }, ...ds]))
      dmsRef.current = dmsRef.current.some(d => d.channelId === dm.channelId) ? dmsRef.current : [dm, ...dmsRef.current]
      if (voiceRef.current) await leaveVoice()
      // Until this call's own connection details are in, nothing here may connect any way but through a relay.
      voiceEngine.configure([], 'relay')
      const placed = await voiceHub.startCall(dm.channelId, direct)
      setCall({ id: placed.id, channelId: placed.channelId, direct: placed.direct, otherId: placed.calleeId, otherName: placed.calleeName, phase: 'calling' })
      try { await enterCall(placed.channelId, placed.direct, async () => []) }
      catch (e) {
        setCall(null)
        try { await voiceHub.leave() } catch { /* hub gone */ }
        throw e
      }
    })
  }, [api, enterCall, leaveVoice, setCall, voiceEngine, voiceHub])

  const answerCall = useCallback(async () => {
    const c = callRef.current
    if (!c || c.phase !== 'incoming' || answeringRef.current) return
    answeringRef.current = true
    try {
      await run(async () => {
        if (voiceRef.current) await leaveVoice()
        try {
          await enterCall(c.channelId, c.direct, () => voiceHub.joinCall(c.id, c.direct, c.channelId))
          if (callRef.current?.id === c.id) setCall({ ...c, phase: 'active' })
        } catch (e) {
          if (callRef.current?.id === c.id) setCall(null)
          void voiceHub.declineCall(c.id).catch(() => { /* already over */ })
          throw e
        }
      })
    } finally { answeringRef.current = false }
  }, [enterCall, leaveVoice, setCall, voiceHub])

  // The phone's own call screen answered a call (see native/app.ts): it is the incoming call here, and is joined.
  joinAnsweredRef.current = c => {
    if (callRef.current && callRef.current.id !== c.callId) return
    setCall({ id: c.callId, channelId: c.channelId, direct: c.direct, otherId: '', otherName: c.callerName, phase: 'incoming' })
    void answerCall()
  }

  const declineCall = useCallback(async () => {
    const c = callRef.current
    if (!c || c.phase !== 'incoming') return
    setCall(null)
    try { await voiceHub.declineCall(c.id) } catch { /* already over */ }
  }, [setCall, voiceHub])

  // It rings for as long as there is a call nobody has answered.
  const callPhase = call?.phase ?? null
  useEffect(() => {
    if (callPhase === 'incoming') startRing('incoming', settings.soundEnabled)
    else if (callPhase === 'calling') startRing('outgoing', settings.soundEnabled)
    else stopRing()
    return stopRing
  }, [callPhase, settings.soundEnabled])
  useEffect(() => { selectChannelRef.current = selectChannel }, [selectChannel])

  // ---- Profiles ------------------------------------------------------------------

  /** Everyone we know how to draw: members of our servers, friends, DM partners, and ourselves. */
  const appearances = useMemo(() => {
    const map = new Map<string, Appearance>()
    for (const g of guilds) for (const m of g.members) map.set(m.userId, appearanceOfMember(m))
    for (const f of [...friends.friends, ...friends.incoming, ...friends.outgoing]) map.set(f.user.id, appearanceOfUser(f.user))
    for (const d of dms) map.set(d.other.id, appearanceOfUser(d.other))
    if (settings.user) map.set(settings.user.id, appearanceOfUser(settings.user))
    return map
  }, [dms, friends, guilds, settings.user])
  const appearanceOf = useCallback((userId: string) => appearances.get(userId) ?? null, [appearances])

  const loadProfile = useCallback(async (userId: string): Promise<UserProfileDto | null> => { try { return await api.profile(userId) } catch { return null } }, [api])
  /** Our own profile changed: keep the copy of ourselves that the rest of the app draws from in step. */
  const applyOwnProfile = useCallback((p: UserProfileDto) => {
    const cur = settingsRef.current.user
    if (cur && cur.id === p.id) setOwnLook({ accentColor: p.accentColor, bannerUrl: p.bannerUrl })
    if (cur && cur.id === p.id) updateSettings({ user: { ...cur, displayName: p.displayName, avatarUrl: p.avatarUrl, nameFont: p.nameFont, nameColor: p.nameColor, nameColor2: p.nameColor2, nameEffect: p.nameEffect ?? null, decoration: p.decoration, nameplate: p.nameplate ?? null } })
  }, [updateSettings])
  /** Throws with the server's reason if a field is refused, so the editor can show it next to the form. */
  const saveProfile = useCallback(async (patch: UpdateProfileRequest) => { const p = await api.updateProfile(patch); applyOwnProfile(p); return p }, [api, applyOwnProfile])
  const setProfilePicture = useCallback(async (kind: 'avatar' | 'banner', file: File | null) => {
    const small = file ? await shrinkPicture(file, kind) : null
    if (small) await checkBeforeSending(small, kind === 'avatar' ? 'as a profile picture' : 'as a profile banner')
    const p = small ? await (kind === 'avatar' ? api.uploadAvatar(small) : api.uploadBanner(small)) : await (kind === 'avatar' ? api.deleteAvatar() : api.deleteBanner())
    applyOwnProfile(p)
    return p
  }, [api, applyOwnProfile])

  /** Stores a nameplate picture of our own and wears it, or with null takes ours away. */
  const setOwnNameplate = useCallback(async (file: File | null) => {
    if (file) { tooBig(file, NAMEPLATE_BYTES, 'A nameplate picture'); await checkBeforeSending(file, 'as a nameplate') }
    const p = file ? await api.uploadNameplate(file) : await api.deleteNameplate()
    applyOwnProfile(p)
    return p
  }, [api, applyOwnProfile])

  /** Stores an animation of our own (around the picture, or over the profile card) and wears it, or with null takes ours away. */
  const setProfileAnimation = useCallback(async (kind: 'avatar' | 'effect', file: File | null, crop = false) => {
    const p = file ? await api.uploadAnimation(kind, file, crop) : await api.deleteAnimation(kind)
    applyOwnProfile(p)
    return p
  }, [api, applyOwnProfile])

  /** A name on one server only (null removes it). The server tells everyone, including us, through MemberUpdated. */
  const setNickname = useCallback(async (guildId: string, userId: string, nickname: string | null, hideRoleColor?: boolean) => run(async () => {
    const member = await api.setNickname(guildId, userId, nickname, hideRoleColor)
    patchGuild(guildId, g => ({ ...g, members: g.members.map(m => (m.userId === userId ? member : m)) }))
  }), [api, patchGuild])

  // ---- Choices about other people and servers ----------------------------------

  const setUserPrefs = useCallback((userId: string, patch: Partial<UserPrefs>) => {
    const all = settingsRef.current.users ?? {}
    updateSettings({ users: { ...all, [userId]: { ...all[userId], ...patch } } })
  }, [updateSettings])

  const setGuildPrefs = useCallback((guildId: string, patch: Partial<GuildPrefs>) => {
    const all = settingsRef.current.guilds ?? {}
    updateSettings({ guilds: { ...all, [guildId]: { ...all[guildId], ...patch } } })
    // Asking for notifications is the moment to get the browser's permission (the desktop app already has it).
    if (patch.notify && patch.notify !== 'none' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    if (patch.muted) patchGuild(guildId, g => ({ ...g, unread: 0 }))
  }, [patchGuild, updateSettings])

  const markGuildRead = useCallback((guildId: string) => patchGuild(guildId, g => ({ ...g, unread: 0, channelUnread: {} })), [patchGuild])

  // Play each person in voice at the volume chosen for them (and not at all if muted).
  const voicePeers = voice ? voice.participants.map(p => p.connectionId + ':' + p.userId).join(',') : ''
  useEffect(() => {
    const cur = voiceRef.current
    if (!cur) return
    for (const p of cur.participants) {
      if (p.connectionId === voiceHub.connectionId) continue
      const prefs = settings.users?.[p.userId] ?? {}
      voiceEngine.setPeerAudio(p.connectionId, prefs.volume ?? 1, !!prefs.muted)
      voiceEngine.setPeerBot(p.connectionId, !!p.bot)
    }
  }, [settings.users, voiceEngine, voiceHub, voicePeers])

  /** The person read a P2P channel's warning and chose to join. Remembered for that channel as it is now. */
  const confirmDirect = useCallback(async () => {
    const p = directPrompt
    setDirectPrompt(null)
    if (!p || p.kind !== 'warn') return
    const since = findChannel(p.channelId)?.channel.directSince
    if (!since) return
    updateSettings({ directAcknowledged: { ...settingsRef.current.directAcknowledged, [p.channelId]: since } })
    // For a voice channel this is the moment of joining. A text channel connects by itself once the warning is accepted.
    if (findChannel(p.channelId)?.channel.type === ChannelType.Voice && !p.text) await joinVoice(p.channelId, true)
  }, [directPrompt, joinVoice, updateSettings])

  /** Turning P2P off is immediate. Turning it on is refused by the server unless this sign-in is minutes old. */
  const setAllowDirect = useCallback(async (on: boolean) => {
    const p = await api.setPrivacy(on)
    allowDirectRef.current = p.allowDirect
    setAllowDirectState(p.allowDirect)
    // From now on a file between friends may go P2P: say which key this app seals its set-up messages with.
    if (p.allowDirect) void hub.presentSeal()
  }, [api, hub])

  /**
   * Sign in again as the account in use, to prove it is really its owner asking. The desktop app and the development
   * sign-in do it in place and this resolves true. A browser has to leave for the provider and come back: this
   * leaves a note of why under `marker`, resolves false, and App.tsx finishes the job on return.
   */
  const signInAgain = useCallback(async (provider: string, devUsername: string, marker: string): Promise<boolean> => {
    const serverUrl = settingsRef.current.serverUrl
    const mine = settingsRef.current.user?.id ?? ''
    let token: TokenResponse
    if (provider === 'dev') token = await api.devLogin(serverUrl, devUsername)
    else {
      const desktop = bridge()
      if (isNativeApp()) {
        const back = await nativeSignIn(serverUrl, provider)
        if (!back.code) throw new Error(back.error ? signInProblem(back.error) : 'Sign-in did not finish.')
        token = await api.exchangeCode(serverUrl, back.code)
      } else if (!desktop) {
        sessionStorage.setItem(marker, mine)
        window.location.href = `${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(window.location.origin + window.location.pathname)}`
        return false
      }
      else token = await api.exchangeCode(serverUrl, await desktop.oauthLogin(serverUrl, provider))
    }
    if (token.user.id !== mine) throw new Error('That sign-in is a different account. Sign in as the account you are using now.')
    updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
    return true
  }, [api, updateSettings])

  /**
   * The ways this account can sign in again here: of what the server offers, the ones the account has. Signing in
   * with any other would be a different account. All of them if that cannot be told.
   */
  const reauthProviders = useCallback(async (): Promise<string[]> => {
    const offered = await api.providers(settingsRef.current.serverUrl)
    try {
      const mine = new Set((await api.signInMethods()).methods.map(m => m.service))
      const own = offered.filter(p => mine.has(p))
      return own.length > 0 ? own : offered
    } catch { return offered }
  }, [api])

  /** Sign in again and, if it comes back as the same account, allow P2P. */
  const reauthenticateForDirect = useCallback(async (provider: string, devUsername = '') => {
    if (await signInAgain(provider, devUsername, PENDING_DIRECT)) await setAllowDirect(true)
  }, [setAllowDirect, signInAgain])

  // ---- Deleting the account (see DeleteAccount.tsx): explain and sign in again, then confirm
  const [deleteStep, setDeleteStep] = useState<'explain' | 'confirm' | null>(null)
  const reauthenticateForDelete = useCallback(async (provider: string, devUsername = '') => {
    if (await signInAgain(provider, devUsername, PENDING_DELETE)) setDeleteStep('confirm')
  }, [signInAgain])

  // ---- Changing how the account is got into (Settings, My account): the server asks for a sign-in from just now
  /** True once signed in again here; false when a browser went off to do it (and comes back to this page). */
  const reauthenticateForAccount = useCallback((provider: string, devUsername = '') => signInAgain(provider, devUsername, PENDING_ACCOUNT), [signInAgain])
  /** Runs such a change: 'reauth' when the server wants a sign-in from just now first; anything else that goes wrong is said. */
  const accountChange = useCallback(async (change: () => Promise<unknown>): Promise<'done' | 'reauth' | 'failed'> => {
    try { await change(); return 'done' }
    catch (e) {
      if (e instanceof ApiError && e.code === 'reauth') return 'reauth'
      if (e instanceof ApiError && e.unauthorized) { setError(e.message); await signOutRef.current(); return 'failed' }
      setError(e instanceof Error ? e.message : String(e))
      return 'failed'
    }
  }, [setError])
  /** Signs out every other device and browser: this one carries on with a fresh sign-in, started again so all of it uses that. */
  const signOutEverywhere = useCallback(async () => {
    replacingSignIn.current = true
    try {
      const token = await api.signOutEverywhere()
      updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
      window.location.reload()
    } catch (e) {
      replacingSignIn.current = false
      throw e
    }
  }, [api, updateSettings])
  /** Throws what the server said if it refuses; on success the account is gone and this app is signed out. */
  const deleteAccount = useCallback(async (username: string) => {
    await api.deleteAccount(username)
    setDeleteStep(null)
    await signOutRef.current().catch(() => { /* the server has already closed everything */ })
    setFarewell('Your account has been deleted.')
  }, [api])

  const renameChannel = useCallback(async (channelId: string, name: string) => { await run(() => api.renameChannel(channelId, name)) }, [api])
  /** Everyone in the server is told of the change (ChannelUpdated), this app included. */
  const setCalendarBackground = useCallback(async (channelId: string, background: string) => { await run(() => api.setCalendarBackground(channelId, background)) }, [api])
  const deleteChannel = useCallback(async (channelId: string) => { await run(() => api.deleteChannel(channelId)) }, [api])
  /** A group of channels, with every channel in it. */
  const deleteGroup = useCallback(async (channelId: string) => { await run(() => api.deleteGroup(channelId)) }, [api])
  /** Yours alone, on this device. Muting also clears whatever that channel had already counted. */
  const setChannelMuted = useCallback((channelId: string, muted: boolean) => {
    const all = { ...(settingsRef.current.mutedChannels ?? {}) }
    if (muted) all[channelId] = true; else delete all[channelId]
    updateSettings({ mutedChannels: all })
    if (muted) setGuilds(gs => gs.map(g => (g.channelUnread[channelId] ? { ...g, unread: Math.max(0, g.unread - g.channelUnread[channelId]), channelUnread: { ...g.channelUnread, [channelId]: 0 } } : g)))
  }, [updateSettings])
  const setChannelDirect = useCallback(async (channelId: string, direct: boolean) => { await run(() => api.setChannelDirect(channelId, direct)) }, [api])

  const toggleMute = useCallback(() => {
    setIsMuted(m => {
      const next = !m
      voiceEngine.setMuted(next)
      if (voiceRef.current) void voiceHub.setMuted(next)
      setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === voiceHub.connectionId ? { ...p, muted: next } : p)) } : v))
      return next
    })
  }, [voiceEngine, voiceHub])
  // The same, to a given state, when the phone's own call screen asks (the iPhone app).
  muteAskedRef.current = muted => {
    setIsMuted(m => {
      if (m === muted) return m
      voiceEngine.setMuted(muted)
      if (voiceRef.current) void voiceHub.setMuted(muted)
      setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === voiceHub.connectionId ? { ...p, muted } : p)) } : v))
      return muted
    })
  }

  const setAudioDevices = useCallback(async (input: string | null, output: string | null) => {
    const changed = input !== settingsRef.current.audioInputDeviceId || output !== settingsRef.current.audioOutputDeviceId
    updateSettings({ audioInputDeviceId: input, audioOutputDeviceId: output })
    // In a call the change is made on the spot. A microphone that cannot be swapped in place is picked up by joining
    // the channel again; a call with a friend is left as it is rather than hung up.
    const live = await voiceEngine.switchDevices(input, output)
    const current = voiceRef.current
    if (changed && current && !live && !callRef.current) { await leaveVoice(); await joinVoice(current.channelId, true) }
  }, [joinVoice, leaveVoice, updateSettings, voiceEngine])

  const savePreferences = useCallback(async (patch: Partial<PreferencesDto>) => run(async () => {
    applyPreferences(await api.setPreferences({ ...preferencesRef.current, ...patch }))
  }), [api, applyPreferences])

  const setBlocked = useCallback(async (userId: string, on: boolean) => run(async () => {
    if (on) {
      const user = await api.block(userId)
      setBlockedList(list => [...list.filter(u => u.id !== userId), user])
    } else {
      await api.unblock(userId)
      setBlockedList(list => list.filter(u => u.id !== userId))
    }
  }), [api])

  const toggleDeafen = useCallback(() => setDeafened(d => !d), [])
  // The others in the call are told, so it shows beside our name; and again whenever we walk into a call deafened.
  const voiceIn = voice?.channelId ?? null
  useEffect(() => {
    if (!voiceIn) return
    void voiceHub.setDeafened(deafened)
    setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === voiceHub.connectionId && !!p.deafened !== deafened ? { ...p, deafened } : p)) } : v))
  }, [deafened, voiceIn, voiceHub])
  const outputVolume = settings.outputVolume ?? 1
  useEffect(() => { voiceEngine.setOutput(outputVolume, deafened) }, [deafened, outputVolume, voiceEngine, voicePeers])
  const voiceGate = settings.voiceGate !== false
  const voiceGateLevel = settings.voiceGateLevel ?? DEFAULT_GATE_LEVEL
  useEffect(() => { voiceEngine.setGate(voiceGate, gateThreshold(voiceGateLevel)) }, [voiceEngine, voiceGate, voiceGateLevel])

  // Push to talk: the microphone follows one key. The page hears it while it is in front; the desktop app is also
  // told when it is held while something else is (only while in voice: that is the only time the listener runs).
  const pushMode = settings.voiceMode === 'push'
  const pushKind = (settings.pushKey ?? DEFAULT_PUSH_KEY).kind
  const pushCode = (settings.pushKey ?? DEFAULT_PUSH_KEY).code
  const inVoice = !!voice
  useEffect(() => {
    if (!pushMode) { voiceEngine.setPushToTalk(false, false); return }
    const key: PushKey = { kind: pushKind, code: pushCode, label: '' }
    let here = false, anywhere = false
    let letGo: number | undefined
    const apply = () => {
      window.clearTimeout(letGo)
      if (here || anywhere) voiceEngine.setPushToTalk(true, true)
      // A moment's grace after letting go, so the end of a word is not cut off.
      else letGo = window.setTimeout(() => voiceEngine.setPushToTalk(true, false), PUSH_RELEASE_MS)
    }
    voiceEngine.setPushToTalk(true, false)
    const down = (e: KeyboardEvent | MouseEvent) => { if (!isChoosingPushKey() && isPushKey(key, e) && !here) { here = true; apply() } }
    const up = (e: KeyboardEvent | MouseEvent) => { if (isPushKey(key, e) && here) { here = false; apply() } }
    const away = () => { if (here) { here = false; apply() } }
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true)
    window.addEventListener('mousedown', down, true); window.addEventListener('mouseup', up, true)
    window.addEventListener('blur', away)
    const desktop = inVoice ? bridge() : undefined
    const stopHearing = desktop?.onPushKey?.(held => { anywhere = held; apply() })
    void desktop?.watchPushKey?.(key)
    return () => {
      window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true)
      window.removeEventListener('mousedown', down, true); window.removeEventListener('mouseup', up, true)
      window.removeEventListener('blur', away)
      window.clearTimeout(letGo)
      stopHearing?.()
      void desktop?.watchPushKey?.(null)
    }
  }, [voiceEngine, pushMode, pushKind, pushCode, inVoice])
  useEffect(() => { applyTheme(settings.theme) }, [settings.theme])


  const signOut = useCallback(async () => {
    if (replacingSignIn.current) return
    // The phone is no longer to be told anything for this account (said while the sign-in still counts).
    if (phoneToken.current) { const token = phoneToken.current; phoneToken.current = null; await api.forgetPushDevice(token).catch(() => { /* the server drops it on the first failed push */ }) }
    await p2pEngine.leaveAll()
    await leaveVoice()
    await voiceHub.disconnect()
    await hub.disconnect()
    // What was picked while signed in is let go of. What the desktop app remembers stays, for this account's next sign-in.
    transferEngine.dropOffers()
    // Whoever signs in next is shown the log-on message, whatever the last person closed.
    closedSystemMessages.current.clear(); setSystemMessages([])
    setStats(NO_STATS)
    updateSettings({ accessToken: null, tokenExpires: null, user: null })
    setGuilds([]); setSelectedGuildId(null); setSelectedChannelId(null); setHome(false); setFriends(EMPTY_FRIENDS); setDms([]); setReady(false)
  }, [api, hub, leaveVoice, transferEngine, updateSettings, voiceHub])

  signOutRef.current = signOut

  const selectedGuild = home ? null : guilds.find(g => g.guild.id === selectedGuildId) ?? null
  const selectedDm = home ? dms.find(d => d.channelId === selectedChannelId) ?? null : null
  const selectedChannel = selectedDm ? dmChannel(selectedDm) : selectedGuild?.channels.find(c => c.id === selectedChannelId) ?? null

  // In a large server, whoever wrote what is on screen and was not sent to us is asked for, so their name is drawn as theirs.
  const partialGuildId = selectedGuild?.membersPartial ? selectedGuild.guild.id : null
  useEffect(() => {
    if (!partialGuildId) return
    needMembers(partialGuildId, [...messages, ...(thread?.messages ?? [])].filter(m => !m.webhookId).map(m => m.authorId), false)
  }, [messages, needMembers, partialGuildId, thread])

  // ---- P2P text: connected to the P2P channel being read, for as long as it is being read ------------------------------
  const p2pChannelId = !selectedDm && selectedChannel?.directSince ? selectedChannel.id : null
  const p2pSince = p2pChannelId ? selectedChannel?.directSince ?? null : null
  const p2pAccepted = !!p2pChannelId && settings.directAcknowledged[p2pChannelId] === p2pSince
  p2pChanged.current = channelId => {
    if (selected.current.channel !== channelId) return
    setP2pText(p => (p && p.channelId === channelId && (p.state === 'on' || p.state === 'connecting' || (p.state === 'failed' && p2pEngine.isIn(channelId)))
      ? p2pEngine.isIn(channelId) ? { ...p, state: 'on', reachable: p2pEngine.reachable(channelId).length, present: p2pEngine.present(channelId) } : { ...p, state: 'connecting', reachable: 0, present: 0 }
      : p))
  }
  p2pReceived.current = (message, caughtUp) => {
    void keep(p2pBox(settingsRef.current.user?.id, message.channelId), message.id, message.sentAt, { p2p: message }).catch(() => {})
    if (!caughtUp && message.authorId !== settingsRef.current.user?.id && !isIgnored(message.authorId) && !isP2pNoteText(message.content)) {
      const where = findChannel(message.channelId)
      const quietPlace = !!where?.guild && (!!guildPrefs(where.guild.guild.id).muted || !!settingsRef.current.mutedChannels?.[message.channelId])
      if (where && !quietPlace) messageSound(message.channelId)
    }
    if (selected.current.channel === message.channelId) {
      // Something from further back arrived: there may be more behind it.
      if (caughtUp) setCanLoadOlder(true)
      // One that was caught up belongs where it was said, not at the end.
      setMessages(ms => (ms.some(x => x.id === message.id) ? ms
        : caughtUp ? [...ms, p2pToMessage(message)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [...ms, p2pToMessage(message)]))
      return
    }
    // A subscribed channel that is not being read: it shows as unread, like any other, unless it is muted.
    const found = findChannel(message.channelId)
    // Someone's reaction, edit, pin or vote is not something new to read.
    if (!found?.guild || settingsRef.current.mutedChannels?.[message.channelId] || isIgnored(message.authorId) || isP2pNoteText(message.content)) return
    patchGuild(found.guild.guild.id, g => ({ ...g, unread: g.unread + 1, channelUnread: { ...g.channelUnread, [message.channelId]: (g.channelUnread[message.channelId] ?? 0) + 1 } }))
  }

  // Which P2P channels this app should be connected to: the one being read, the voice channel we are sitting in
  // (its chat reaches us whatever is on screen), and every one subscribed to. Subscribing is for the ones we are
  // not in. All of them only once their warning has been accepted, and only while the account allows P2P.
  const p2pWanted = !allowDirect || !ready || !p2pTextSupported() ? [] : guilds.flatMap(x => x.channels)
    .filter(c => c.directSince && settings.directAcknowledged[c.id] === c.directSince && (c.id === p2pChannelId || c.id === voice?.channelId || settings.p2pSubscribed?.[c.id]))
    .map(c => c.id).sort()
  const p2pWantedKey = p2pWanted.join(',')
  useEffect(() => {
    // After the chat connection came back the server has forgotten us everywhere: start from nothing.
    p2pEngine.closedAll()
  }, [hubEpoch, p2pEngine])
  /** What is wanted right now, for work that finishes later to check against. */
  const p2pWantedNow = useRef(new Set<string>())
  /** Channels being connected to right now; and, for those that failed, how many times in a row and the timer for the next try. */
  const p2pJoining = useRef(new Set<string>())
  const p2pFailures = useRef(new Map<string, { times: number; timer: number }>())
  const [p2pRetry, setP2pRetry] = useState(0)
  useEffect(() => {
    const wanted = new Set(p2pWantedKey ? p2pWantedKey.split(',') : [])
    p2pWantedNow.current = wanted
    for (const channelId of p2pEngine.joined()) if (!wanted.has(channelId)) void p2pEngine.leave(channelId)
    for (const [channelId, failure] of [...p2pFailures.current]) if (!wanted.has(channelId)) { window.clearTimeout(failure.timer); p2pFailures.current.delete(channelId) }
    for (const channelId of wanted) {
      if (p2pEngine.isIn(channelId) || p2pJoining.current.has(channelId)) continue
      // One that failed waits for its next try, unless it is the channel being looked at: that one is tried now.
      const failed = p2pFailures.current.get(channelId)
      if (failed?.timer && channelId !== p2pChannelId) continue
      window.clearTimeout(failed?.timer)
      p2pJoining.current.add(channelId)
      // Who is there is learned afresh on connecting, the bots among them too.
      setP2pBotsWaiting(all => (all.some(x => !x.voice && x.channelId === channelId) ? all.filter(x => x.voice || x.channelId !== channelId) : all))
      p2pEngine.join(channelId).then(
        () => {
          p2pJoining.current.delete(channelId)
          p2pFailures.current.delete(channelId)
          // No longer wanted by the time it connected (they went on to another channel): let go of it again.
          if (!p2pWantedNow.current.has(channelId)) { void p2pEngine.leave(channelId); return }
          p2pChanged.current(channelId)
        },
        e => {
          p2pJoining.current.delete(channelId)
          setP2pText(p => (p && p.channelId === channelId ? { ...p, state: 'failed', note: e instanceof Error ? e.message : String(e) } : p))
          if (!p2pWantedNow.current.has(channelId)) return
          // Tried again by itself: after a quarter of a minute, then less and less often.
          const times = (p2pFailures.current.get(channelId)?.times ?? 0) + 1
          const timer = window.setTimeout(() => {
            const waiting = p2pFailures.current.get(channelId)
            if (waiting) p2pFailures.current.set(channelId, { ...waiting, timer: 0 })
            setP2pRetry(n => n + 1)
          }, Math.min(120_000, 15_000 * 2 ** (times - 1)))
          p2pFailures.current.set(channelId, { times, timer })
        })
    }
  }, [p2pWantedKey, hubEpoch, p2pEngine, p2pRetry, p2pChannelId])
  useEffect(() => {
    const timer = window.setInterval(() => { void p2pEngine.refresh() }, 20 * 60_000)
    return () => window.clearInterval(timer)
  }, [p2pEngine])
  // What the screen says about the channel being read.
  useEffect(() => {
    if (!p2pChannelId || !ready) { setP2pText(null); return }
    const channelId = p2pChannelId
    const state = (s: 'ask' | 'blocked' | 'connecting' | 'on' | 'failed', note = '') => setP2pText({ channelId, state: s, reachable: 0, present: 0, note })
    if (!p2pTextSupported()) { state('failed', 'This browser cannot keep or sign P2P messages, so P2P channels cannot be used in it.'); return }
    if (!allowDirect) { state('blocked'); return }
    if (!p2pAccepted) { state('ask'); return }
    if (p2pEngine.isIn(channelId)) setP2pText({ channelId, state: 'on', reachable: p2pEngine.reachable(channelId).length, present: p2pEngine.present(channelId), note: '' })
    else state('connecting')
  }, [p2pChannelId, p2pAccepted, allowDirect, ready, hubEpoch, p2pEngine])

  /**
   * Agree to connect to a P2P bot. It is remembered for that bot everywhere it turns up. The channel is left and
   * joined again, which is what makes this app the one to offer the bot a connection.
   */
  const acceptP2pBot = useCallback(async (channelId: string, userId: string, username: string) => {
    updateSettings({ p2pBotsAccepted: { ...(settingsRef.current.p2pBotsAccepted ?? {}), [userId]: username } })
    setP2pBotsWaiting(all => all.filter(x => x.userId !== userId))
    // In the voice channel we are in, the bot is there already: this app offers it a connection now.
    const inVoice = voiceRef.current?.channelId === channelId ? voiceRef.current.participants.filter(p => p.userId === userId) : []
    if (inVoice.length > 0) {
      setVoice(v => (v && v.channelId === channelId ? { ...v, participants: v.participants.map(p => (p.userId === userId ? { ...p, state: 'connecting' } : p)) } : v))
      for (const p of inVoice) await voiceEngine.connectTo(p.connectionId)
    }
    await p2pEngine.leave(channelId)
    setP2pRetry(n => n + 1)
  }, [p2pEngine, updateSettings, voiceEngine])
  const dismissP2pBot = useCallback((channelId: string, userId: string, voice = false) => setP2pBotsWaiting(all => all.filter(x => !(!!x.voice === voice && x.channelId === channelId && x.userId === userId))), [])

  /** Subscribe to a P2P channel (stay connected to it whenever the app is open), or stop. */
  const setP2pSubscribed = useCallback((channelId: string, on: boolean) => {
    const all = { ...(settingsRef.current.p2pSubscribed ?? {}) }
    if (on) all[channelId] = true; else delete all[channelId]
    updateSettings({ p2pSubscribed: all })
    // Subscribing to a channel whose warning has not been read yet shows it: nothing connects until it is accepted.
    const since = findChannel(channelId)?.channel.directSince
    if (on && since && settingsRef.current.directAcknowledged[channelId] !== since) setDirectPrompt({ channelId, kind: allowDirectRef.current ? 'warn' : 'blocked', text: true })
  }, [updateSettings])
  /** Whether this app hands other members the messages they missed in a P2P channel. */
  const setP2pBroadcast = useCallback((channelId: string, on: boolean) => {
    const all = { ...(settingsRef.current.p2pNoBroadcast ?? {}) }
    if (on) delete all[channelId]; else all[channelId] = true
    updateSettings({ p2pNoBroadcast: all })
  }, [updateSettings])

  /** Show a P2P text channel's warning (or say why this account cannot connect). Accepting it connects. */
  const askDirectText = useCallback((channelId: string) => {
    setDirectPrompt({ channelId, kind: allowDirectRef.current ? 'warn' : 'blocked', text: true })
  }, [])
  const voiceChannelId = voice?.channelId ?? null
  /** The channel a game started now would go to (see gameChannelId), for labels and for enabling the roll buttons. */
  const partyChannel = useMemo(() => (selectedDm ? dmChannel(selectedDm)
    : voiceChannelId ? guilds.flatMap(x => x.channels).find(c => c.id === voiceChannelId) ?? null : null), [guilds, selectedDm, voiceChannelId])
  // Name the server too when the voice channel is not on the one being looked at ("Party" exists on most servers).
  const partyGuild = partyChannel?.guildId ? guilds.find(x => x.guild.id === partyChannel.guildId) ?? null : null
  const partyLabel = !partyChannel ? ''
    : partyChannel.type === ChannelType.DirectMessage ? '@' + partyChannel.name
    : '🔊 ' + partyChannel.name + (partyGuild && partyGuild.guild.id !== selectedGuild?.guild.id ? ` (${partyGuild.guild.name})` : '')

  // ---- Game plugins (desktop app only) ----------------------------------------
  // The main process owns the plugin folders and the log watchers; here we keep the catalogs for display and turn
  // detected drops into rolls: straight away if the user chose auto-roll for that plugin, otherwise after a prompt.

  const catalog = useMemo(() => {
    const map = new Map<string, { plugin: PluginInfo; item: PluginItem }>()
    for (const plugin of plugins) {
      if (plugin.error) continue
      for (const item of plugin.items) map.set(plugin.id.toLowerCase() + '/' + item.id.toLowerCase(), { plugin, item })
    }
    return map
  }, [plugins])

  /** Looks an item up in the plugins installed on this machine; null if the plugin is not installed here. */
  const resolveItem = useCallback((pluginId: string | null | undefined, itemId: string | null | undefined) =>
    (pluginId && itemId ? catalog.get(pluginId.toLowerCase() + '/' + itemId.toLowerCase()) ?? null : null), [catalog])

  /** The icon from the plugin installed here if there is one; otherwise the copy the roll starter shared through the server. */
  const itemIcon = useCallback((item: { pluginId: string | null; itemId: string | null; iconUrl?: string | null } | null | undefined) => {
    const hit = item ? resolveItem(item.pluginId, item.itemId) : null
    if (hit?.item.iconPath) return pluginIconUrl(hit.plugin.id, hit.item.iconPath)
    return serverIconUrl(settings.serverUrl, item?.iconUrl)
  }, [resolveItem, settings.serverUrl])

  const searchItems = useCallback((query: string, limit = 12): CatalogHit[] => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const starts: CatalogHit[] = [], contains: CatalogHit[] = []
    for (const { plugin, item } of catalog.values()) {
      const at = item.name.toLowerCase().indexOf(q)
      if (at < 0 && item.id.toLowerCase() !== q) continue
      const hit = { pluginId: plugin.id, gameName: plugin.gameName, item, iconUrl: item.iconPath ? pluginIconUrl(plugin.id, item.iconPath) : null }
      if (at === 0) starts.push(hit); else contains.push(hit)
      if (starts.length >= limit) break
    }
    return [...starts, ...contains].slice(0, limit)
  }, [catalog])

  const onPluginDrop = useCallback((drop: PluginDrop) => {
    if (!readyRef.current) return
    const plugin = pluginsRef.current.find(x => x.id === drop.pluginId)
    const item = plugin?.items.find(i => i.id === drop.itemId)
    if (!plugin || !item) return
    const cfg = settingsRef.current.plugins[plugin.id] ?? defaultPluginSettings()
    const pending: PendingDrop = {
      key: plugin.id + '/' + item.id + '/' + drop.at + '/' + Math.random().toString(36).slice(2, 8),
      pluginId: plugin.id, itemId: item.id, name: item.name, quantity: drop.quantity, gameName: plugin.gameName, rarity: item.rarity,
      iconUrl: item.iconPath ? pluginIconUrl(plugin.id, item.iconPath) : null,
      context: drop.context, auto: cfg.autoRoll, rollKind: cfg.rollKind === 0 ? RollKind.Standard : RollKind.NeedGreed, at: Date.now(),
    }
    setPendingDrops(q => [...q, pending].slice(-5))
    if (pending.iconUrl) void shareIcon(pending.iconUrl, png => api.uploadItemIcon(png)) // warm up, so the roll is not kept waiting
    if (!pending.auto) playSound('drop', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
  }, [api])

  useEffect(() => {
    const b = bridge()
    if (!b) return
    let alive = true
    void b.pluginsList().then(list => { if (alive) setPlugins(list) }).catch(() => { /* older shell */ })
    const offChanged = b.onPluginsChanged(setPlugins)
    const offDrop = b.onPluginDrop(onPluginDrop)
    return () => { alive = false; offChanged(); offDrop() }
  }, [onPluginDrop])

  // Tell the main process which game logs the user allowed it to read.
  useEffect(() => {
    bridge()?.pluginsConfigure(Object.fromEntries(Object.entries(settings.plugins).map(([id, c]) => [id, { watch: c.watch, logPath: c.logPath }])))
  }, [settings.plugins])

  const startDropRoll = useCallback(async (drop: PendingDrop, kind: RollKind) => {
    setPendingDrops(q => q.filter(d => d.key !== drop.key))
    const channelId = gameChannelId()
    if (!channelId) { setError(drop.name + ' dropped, but you are not in a voice channel to roll for it.'); return }
    await run(async () => hub.startRoll(channelId, kind, await withSharedIcon({ pluginId: drop.pluginId, itemId: drop.itemId, name: drop.name, iconUrl: null, quantity: drop.quantity })))
  }, [hub])

  const acceptDrop = useCallback((kind?: RollKind) => { const d = pendingDropsRef.current[0]; if (d) void startDropRoll(d, kind ?? d.rollKind) }, [startDropRoll])
  const dismissDrop = useCallback(() => setPendingDrops(q => q.slice(1)), [])

  // Auto-rolls wait for the roll in progress to finish; a prompt nobody answers goes away after a minute.
  useEffect(() => {
    const d = pendingDrops[0]
    if (!d) return
    if (d.auto) {
      const live = (activeRoll && !activeRoll.result) || (activeRps && !activeRps.result)
      if (live || dropBusy.current) return
      dropBusy.current = true
      void startDropRoll(d, d.rollKind).finally(() => { dropBusy.current = false; setDropTick(t => t + 1) })
      return
    }
    const id = window.setTimeout(() => setPendingDrops(q => q.filter(x => x.key !== d.key)), Math.max(0, d.at + 60_000 - Date.now()))
    return () => window.clearTimeout(id)
  }, [pendingDrops, activeRoll, activeRps, startDropRoll, dropTick])

  const setPluginSettings = useCallback((pluginId: string, patch: Partial<PluginSettings>) => {
    const all = settingsRef.current.plugins
    updateSettings({ plugins: { ...all, [pluginId]: { ...(all[pluginId] ?? defaultPluginSettings()), ...patch } } })
  }, [updateSettings])
  const reloadPlugins = useCallback(async () => { const b = bridge(); if (b) setPlugins(await b.pluginsReload()) }, [])
  const installPlugin = useCallback(async () => {
    const result = await bridge()?.pluginsInstall()
    if (result?.error) setError('Could not install that plugin: ' + result.error)
    return !!result?.installed
  }, [])
  const openPluginsFolder = useCallback(() => { void bridge()?.pluginsOpenFolder() }, [])

  const reloadSoundPacks = useCallback(async () => {
    const found = await bridge()?.soundPacks().catch(() => [] as SoundPack[]) ?? []
    setSoundPacks(found) // what playSound reads
    setSoundPackList(found)
  }, [])
  useEffect(() => { void reloadSoundPacks() }, [reloadSoundPacks])
  // The soundboard sounds chosen for moments, for playSound.
  useEffect(() => { setChosenSounds(settings.soundChoices) }, [settings.soundChoices])
  /** A pack from a zip (desktop app): unpacked into a folder of its own, then chosen. */
  const importSoundPack = useCallback(async (zip: File) => {
    await run(async () => {
      const pack = await readPackZip(zip)
      const name = await bridge()?.soundsImport?.(pack.name, pack.files)
      if (!name) throw new Error('That pack could not be saved.')
      await reloadSoundPacks()
      updateSettings({ soundProfile: name })
    })
  }, [reloadSoundPacks, updateSettings])
  const deleteSoundPack = useCallback(async (name: string) => {
    await run(async () => {
      await bridge()?.soundsDelete?.(name)
      await reloadSoundPacks()
      if (settingsRef.current.soundProfile === name) updateSettings({ soundProfile: 'Default' })
    })
  }, [reloadSoundPacks, updateSettings])
  const reachableSounds = useCallback(() => api.reachableSounds(), [api])
  const openSoundsFolder = useCallback(() => { void bridge()?.soundsOpenFolder() }, [])
  const pickPluginLog = useCallback(async (pluginId: string) => {
    const file = await bridge()?.pluginsPickLog()
    if (file) setPluginSettings(pluginId, { logPath: file })
  }, [setPluginSettings])
  /** "Test" button in plugin settings: behaves exactly like a detected drop. */
  const simulateDrop = useCallback((pluginId: string, itemId: string) =>
    onPluginDrop({ pluginId, itemId, quantity: 1, context: 'test', at: new Date().toISOString() }), [onPluginDrop])

  // Global hotkeys and overlay buttons from the Electron main process.
  const hotkey = useCallback((key: OverlayAction) => {
    const cur = activeRollRef.current
    const ng = cur?.session.kind === RollKind.NeedGreed
    if (key.startsWith('select-channel:')) {
      // From the overlay this means "roll with these people": open the chat and, for a voice channel, join it.
      const id = key.slice('select-channel:'.length)
      selectChannel(id)
      if (findChannel(id)?.channel.type === ChannelType.Voice && voiceRef.current?.channelId !== id) void joinVoice(id)
      return
    }
    const drop = pendingDropsRef.current[0]
    const liveRoll = !!cur && !cur.result
    switch (key) {
      case 'drop-roll': acceptDrop(RollKind.Standard); return
      case 'drop-need': acceptDrop(RollKind.NeedGreed); return
      case 'drop-dismiss': dismissDrop(); return
      case 'dismiss': if (activeRpsRef.current) dismissRps(); else dismissRoll(); return
      case 'start-roll': void startRoll(RollKind.Standard, null); return
      case 'start-need': void startRoll(RollKind.NeedGreed, null); return
      case 'flip': void coinFlip(); return
      case 'rps-rock': void rpsThrow(RpsChoice.Rock); return
      case 'rps-paper': void rpsThrow(RpsChoice.Paper); return
      case 'rps-scissors': void rpsThrow(RpsChoice.Scissors); return
      case 'primary':
        // No roll open: the roll hotkey starts one; otherwise it rolls (or needs) in the open one.
        if (!liveRoll && drop) { acceptDrop(); return } // a detected drop is waiting: the roll hotkey rolls for it
        if (!cur || cur.result) { void startRoll(RollKind.Standard, null); return }
        void roll(ng ? RollChoice.Need : RollChoice.Roll); return
      case 'greed': if (cur && !cur.result && ng) void roll(RollChoice.Greed); return
      case 'pass': if (liveRoll) void roll(RollChoice.Pass); else if (drop) dismissDrop(); return
    }
  }, [acceptDrop, coinFlip, dismissDrop, dismissRoll, dismissRps, joinVoice, roll, rpsThrow, selectChannel, startRoll])
  useEffect(() => bridge()?.onHotkey(hotkey), [hotkey])
  useEffect(() => bridge()?.onOverlayAction(hotkey), [hotkey])

  // The app's icon beside the clock (Electron only) carries a red dot while there is something new to read: a badge
  // on a server or a conversation, or anything that arrived while the window was not in front.
  useEffect(() => {
    const seen = () => setAwayNews(false)
    window.addEventListener('focus', seen)
    return () => window.removeEventListener('focus', seen)
  }, [])
  const somethingNew = ready && (awayNews || guilds.some(g => g.unread > 0) || Object.values(dmUnread).some(n => n > 0))
  useEffect(() => { bridge()?.setUnread?.(somethingNew) }, [somethingNew])

  // Mirror game state to the in-game overlay window (Electron only). Idle = the small pill with the launcher.
  useEffect(() => {
    const b = bridge()
    if (!b) return
    b.setOverlayEnabled(settings.overlayEnabled)
    if (!settings.overlayEnabled || !ready) { b.setOverlayState(null); return }
    const meId = me()
    const channelName = partyLabel // where a roll started from the overlay would go

    // A detected drop waiting for an answer outranks a finished card, but never interrupts a game in progress.
    const drop = pendingDrops[0]
    const liveGame = (activeRoll && !activeRoll.result) || (activeRps && !activeRps.result)
    if (drop && !drop.auto && !liveGame) {
      b.setOverlayState({ kind: 'drop', key: drop.key, itemName: drop.name, quantity: drop.quantity, gameName: drop.gameName, iconUrl: drop.iconUrl, channelName })
      return
    }
    if (activeRoll) {
      const { session, result } = activeRoll
      const entries = result?.entries ?? session.entries
      const mine = entries.find(e => e.userId === meId)
      const ng = session.kind === RollKind.NeedGreed
      const iWon = result?.winnerId === meId
      b.setOverlayState({
        kind: 'roll',
        iconUrl: itemIcon(session.item),
        sessionId: session.id,
        headline: (session.tieBreak ? 'Tie-break: ' : '') + (session.item?.name ?? (ng ? 'Need / Greed' : 'Roll')),
        channelName: activeRoll.channelName,
        range: session.min === 1 && session.max === 100 ? '' : `${session.min}–${session.max}`,
        expiresAt: session.expiresAt,
        status: result ? 'Finished' : `${entries.length}/${session.participants.length} rolled`,
        isNeedGreed: ng,
        canAct: !result && !mine && session.participants.includes(meId),
        myValueText: mine ? (mine.choice === RollChoice.Pass ? '—' : String(mine.value)) : '',
        myChoiceText: mine ? ['Rolled', 'Need', 'Greed', 'Passed'][mine.choice] : '',
        winningValueText: result?.winnerId ? String(result.winningValue) : '',
        winnerText: !result ? '' : result.winnerName ? (iWon ? 'You win!' : `${result.winnerName} wins`) : result.tiedUserIds.length > 1 ? `Tie at ${result.winningValue} — rolling off` : 'Nobody rolled',
        iWon,
        lost: !!result && !!mine && mine.choice !== RollChoice.Pass && !iWon,
        ended: !!result,
      })
      return
    }
    if (activeRps) {
      const { session, result, myPick } = activeRps
      const names = (id: string) => { const a = appearances.get(id); return id === meId ? 'you' : a ? a.displayName || a.username : '…' }
      const icons = ['✊', '✋', '✌️']
      const iWon = !!result && result.winnerIds.length === 1 && result.winnerIds[0] === meId
      b.setOverlayState({
        kind: 'rps',
        sessionId: session.id,
        headline: (session.tieBreak ? 'Tie-break: ' : '') + 'Rock, paper, scissors',
        channelName,
        expiresAt: session.expiresAt,
        status: result ? 'Finished' : `${session.pickedUserIds.length}/${session.participants.length} thrown`,
        canPick: !result && myPick === null && session.participants.includes(meId),
        myPick,
        throws: result
          ? result.entries.map(e => `${icons[e.choice]} ${names(e.userId)}`)
          : session.participants.map(id => `${session.pickedUserIds.includes(id) ? '✅' : '⏳'} ${names(id)}`),
        resultText: !result ? '' : result.winnerIds.length === 1 ? (iWon ? 'You win!' : `${names(result.winnerIds[0])} wins`) : result.replay ? 'Tie — throwing again' : 'Nobody threw',
        iWon,
        ended: !!result,
      })
      return
    }
    // The launcher's picker changes who you roll with: the voice channels of this server (picking one joins it), or your DMs at home.
    const partyGuild = selectedGuild ?? guilds.find(x => x.channels.some(c => c.id === voiceChannelId)) ?? null
    const channels = home || !partyGuild
      ? dms.map(d => ({ id: d.channelId, name: '@ ' + d.other.username, current: d.channelId === partyChannel?.id }))
      : partyGuild.channels.filter(c => c.type === ChannelType.Voice).sort((a, b) => a.position - b.position)
          .map(c => ({ id: c.id, name: '🔊 ' + c.name, current: c.id === partyChannel?.id }))
    b.setOverlayState({ kind: 'idle', channelName, canStart: !!partyChannel, channels })
  }, [activeRoll, activeRps, dms, guilds, home, itemIcon, partyChannel, partyLabel, pendingDrops, ready, selectedDm, selectedGuild, settings.overlayEnabled, voiceChannelId])

  return {
    api, hub, settings, updateSettings, ready, status, error, setError, systemMessages, dismissSystemMessage,
    guilds, selectedGuild, selectedChannel, selectedDm, home, friends, dms, dmUnread, messages, canLoadOlder, activeRoll, typing, commands, stats, setGuildCountRolls, setGuildWelcome,
    communityPoll, communityPollShown,
    /** Opens the newest poll from the link in settings, read afresh first. */
    showCommunityPoll: async () => { const poll = await api.latestPoll().catch(() => null); setCommunityPoll(poll); setCommunityPollShown(!!poll); return poll },
    closeCommunityPoll: () => setCommunityPollShown(false),
    answerCommunityPoll: async (answers: CommunityPollAnswerDto[]) => { if (communityPoll) setCommunityPoll(await api.answerPoll(communityPoll.id, answers)) },
    declineCommunityPoll: async () => { if (communityPoll) { setCommunityPoll(await api.declinePoll(communityPoll.id).catch(() => communityPoll)); setCommunityPollShown(false) } },
    thread, viewingPast, highlight, setHighlight, openThread, closeThread, loadOlderThread, createPost, editMessage, react, reactToPicture, calendarChange, invitations, calendarTarget, openEvent, eventLink, pinMessage, votePoll, closePoll,
    reactionChoices, loadPins, searchMessages, jumpTo, backToPresent,
    pendingFriendLink, openFriendLink, acceptFriendLink, dismissFriendLink, loadFriendLink, resetFriendLink,
    connectionsEpoch, loadConnections, startConnection, setConnectionShown, removeConnection,
    loadSignIn, startSignInMethod, removeSignInMethod, setContactEmail, clearContactEmail,
    loadMedia, p2pPost, openP2pPost, closeP2pPost, createP2pPost, reactP2p, editP2p, pinP2p, voteP2p, closeP2pPoll, loadP2pPins, searchP2p, jumpP2p,
    connect, selectGuild, selectChannel, openHome, openDm, addFriend, removeFriend, searchUsers, sendMessage, sendFile, uploading, tray, addToTray, removeFromTray, sendTray, offerFile, withdrawFile, downloadFile, cancelTransfer, transfers, notifyTyping, loadOlder,
    renameGuild, setGuildIcon, setGuildBanner, createRole, updateRole, deleteRole, setMemberRoles,
    partyChannel, partyLabel,
    setUserPrefs, setGuildPrefs, markGuildRead, mentionsMe,
    appearanceOf, decorations, loadProfile, saveProfile, setProfilePicture, setProfileAnimation, setOwnNameplate, setNickname, setGuildHideOwner, setCalendarBackground,
    loadMoreMembers, findMembers, needMembers, membersEnded,
    plugins, pendingDrops, resolveItem, itemIcon, searchItems, acceptDrop, dismissDrop, simulateDrop,
    setPluginSettings, reloadPlugins, installPlugin, openPluginsFolder, pickPluginLog,
    soundPacks, reloadSoundPacks, openSoundsFolder, importSoundPack, deleteSoundPack, reachableSounds,
    startRoll, quickRoll, roll, voteEnd, dismissRoll, coinFlip, invokeCommand, pressButton,
    activeRps, startRps, rpsPick, rpsThrow, dismissRps,
    createGuild, joinGuild, joinPublicGuild, tagSymbols, setGuildTag, removeGuildTag, wearTag, tagCard, setGuildListing, deleteMessage, disconnectMember, moveMember, setVoiceMuted, moveChannel, inviteToServer, openInvite, pendingInvite, acceptInvite, dismissInvite: () => setPendingInvite(null), createChannel, leaveGuild, kickMember, banMember, signOut,
    sharing, shareQuality: streamEngine.quality, localStream: streamEngine.localStream, shareViewers: streamEngine.viaServer ? { total: viewerCounts[voiceHub.connectionId ?? ''] ?? 0, relayed: 0 } : streamEngine.viewerCounts(), watching: streamEngine.watching(),
    streamOf: (streamer: string) => streamEngine.streamOf(streamer), viewerCounts, streamRules, loadStreamRules,
    streamChoice: (streamer: string) => streamEngine.choiceOf(streamer),
    chooseStreamQuality: (streamer: string, want: { height: number; fps: number } | null) => streamEngine.chooseQuality(streamer, want),
    startShare, stopShare, watchStream, unwatchStream, setStreamLimit: (streamer: string, kbps: number) => streamEngine.requestLimit(streamer, kbps),
    voice, isMuted, isSpeaking, joinVoice, leaveVoice, toggleMute,
    call, startCall, answerCall, declineCall, renameChannel, deleteChannel, deleteGroup, setChannelMuted,
    preferences, savePreferences, blocked, setBlocked, dndUsers, idleUsers, makeInvite, loadInvites, revokeInvite, inviteBase, inviteQr, deafened, toggleDeafen, ownLook, transferLimits,
    usableExpressions, forgetUsable, sendSticker, playSoundboard, setGuildOutside,
    markVoiceGap: () => voiceRecorder.mark(), voiceReport: () => voiceRecorder.report(__APP_VERSION__), clearVoiceReport: () => voiceRecorder.clear(),
    farewell, queueAhead, deleteStep, openDeleteAccount: (step: 'explain' | 'confirm' = 'explain') => setDeleteStep(step), closeDeleteAccount: () => setDeleteStep(null), reauthenticateForDelete, deleteAccount,
    reauthenticateForAccount, accountChange, signOutEverywhere,
    p2pText, askDirectText, setP2pSubscribed, setP2pBroadcast, p2pFiles, loadP2pFile, saveP2pFile, p2pNewApps, acceptP2pApp, p2pBotsWaiting, acceptP2pBot, dismissP2pBot,
    allowDirect, setAllowDirect, reauthenticateForDirect, reauthProviders, directPrompt, confirmDirect, dismissDirectPrompt: () => setDirectPrompt(null), setChannelDirect,
    setAudioDevices, me: () => settingsRef.current.user,
    MessageKind,
  }
}

export type Store = ReturnType<typeof useMaplecord>

/** The most a nameplate picture of one's own can be (as the server says, ProfileLimits.NameplateBytes). */
export const NAMEPLATE_BYTES = 256 * 1024

/** Refuses a picture over the size the server takes, at once: before it is checked or sent. Says it as the server would. */
function tooBig(file: File, most: number, what: string) {
  if (file.size <= most) return
  const kb = most < 1048576
  throw new Error(`${what} can be up to ${kb ? most / 1024 + ' KB' : most / 1048576 + ' MB'}. This one is ${kb ? Math.ceil(file.size / 1024) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB'}.`)
}

/** The most files one message carries. */
export const TRAY_MOST = 10
/** A file waiting above the message box: its preview, and how far it is in being checked and uploaded. */
export interface TrayItem {
  key: string; channelId: string; file: File; name: string; size: number
  /** A picture or video of it, made on this device; null for other files. */
  preview: string | null; video: boolean
  state: 'checking' | 'uploading' | 'ready' | 'failed'
  problem?: string; attachmentId?: string
  /** Refused by the check here: it cannot be sent, only taken out. */
  refused?: boolean
}
