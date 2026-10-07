import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Api, ApiError } from './api'
import { ChatHub } from './hub'
import { bridge, type OverlayAction } from './platform'
import { DEFAULT_GATE_LEVEL, DEFAULT_NOTIFY, defaultPluginSettings, gateThreshold, loadSettings, saveSettings, type GuildPrefs, type PluginSettings, type Settings, type UserPrefs } from './settings'
import { pluginIconUrl, type PluginDrop, type PluginInfo, type PluginItem } from './pluginTypes'
import { serverIconUrl, shareIcon, withTimeout } from './itemIcons'
import { appearanceOfMember, appearanceOfUser, shrinkPicture, type Appearance } from './profile'
import { playSound, setQuiet, setSoundPacks, startRing, stopRing, type SoundPack } from './sounds'
import { applyTheme } from './theme'
import { VoiceEngine, type IcePolicy } from './voice'
import { VoiceHub } from './voiceHub'
import { TransferEngine, fileSource, rememberedSource, openSink, type TransferView } from './transfer'
import { StreamEngine, applyHint, canShareSound, defaultQuality, qualityChoices, soundConstraints, videoConstraints, type StreamKind, type StreamQuality } from './stream'
import { anyPopoutVisible } from './popout'
import {
  ChannelType, MessageKind, RollChoice, RollKind, UserStatus, type PreferencesDto, type TransferSettingsDto,
  type ChannelDto, type CommandDto, type GuildSummaryDto, type MemberDto, type MessageDto, type RollItemDto, type RollResultDto, type RollSessionDto,
  type VoiceParticipantDto, type RpsSessionDto, type RpsResultDto, RpsChoice, type FriendsDto, type DmChannelDto, type RoleDto,
  type DecorationDto, type UpdateProfileRequest, type UserDto, type UserProfileDto, type SystemMessageDto, type FileOfferDto, type TokenResponse, type StreamSettingsDto,
} from './types'

/** A DM rendered as a channel so chat, rolls and the overlay treat it like any other. */
const dmChannel = (dm: DmChannelDto): ChannelDto => ({ id: dm.channelId, guildId: null, parentId: null, name: dm.other.displayName || dm.other.username, type: ChannelType.DirectMessage, position: 0 })
const EMPTY_FRIENDS: FriendsDto = { friends: [], incoming: [], outgoing: [] }
/** Whose remembered file offers are whose: one account on one server. */
const offerScope = (serverUrl: string, userId: string) => `${serverUrl.replace(/\/$/, '').toLowerCase()}|${userId}`
/** Set (to the account id) while a browser is away signing in again in order to allow P2P. */
export const PENDING_DIRECT = 'maplecord.pendingDirect'

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

const STATS_KEY = 'maplecord.stats'
const loadStats = (): Stats => { try { return { totalRolls: 0, rollSum: 0, perfect100s: 0, ones: 0, wins: 0, losses: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}') } } catch { return { totalRolls: 0, rollSum: 0, perfect100s: 0, ones: 0, wins: 0, losses: 0 } } }

/** All client state and actions. One instance for the app; components read what they need. */
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
  const [hub] = useState(() => new ChatHub(() => settingsRef.current.serverUrl, () => settingsRef.current.accessToken))
  const [voiceHub] = useState(() => new VoiceHub(() => settingsRef.current.serverUrl, () => settingsRef.current.accessToken))

  const [voice, setVoice] = useState<VoiceState | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  /** A P2P voice channel the person tried to join and has to decide about: read its warning, or first allow P2P at all. */
  const [directPrompt, setDirectPrompt] = useState<{ channelId: string; kind: 'warn' | 'blocked' } | null>(null)
  /** Whether this account allows P2P connections. Kept on the server; until we have heard from it, the answer is no. */
  const [allowDirect, setAllowDirectState] = useState(false)
  const allowDirectRef = useRef(false)
  const voiceRef = useRef<VoiceState | null>(null)
  const joinVoiceRef = useRef<(channelId: string, acknowledged?: boolean) => Promise<void>>(async () => { /* set below */ })
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
  const [voiceEngine] = useState(() => new VoiceEngine(voiceHub, {
    peerState: (id, state) => setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === id ? { ...p, state } : p)) } : v)),
    speaking: (id, speaking) => {
      if (id === null) setIsSpeaking(speaking)
      const target = id ?? voiceHub.connectionId
      setVoice(v => (v ? { ...v, participants: v.participants.map(p => (p.connectionId === target ? { ...p, speaking } : p)) } : v))
    },
    level: () => { /* used by the audio settings meter */ },
    log: m => console.debug('[voice]', m),
  }))

  // ---- Shared video (see stream.ts). The engine holds the live MediaStreams; `streamTick` re-renders when it changes.
  const [, setStreamTick] = useState(0)
  const [streamRules, setStreamRules] = useState<StreamSettingsDto | null>(null)
  const streamRulesRef = useRef<StreamSettingsDto | null>(null)
  /** How many people are watching each stream in the voice channel we are in, by the sharer's connection. */
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({})
  const stopShareRef = useRef<(reason?: string) => Promise<void>>(async () => {})
  const [streamEngine] = useState(() => new StreamEngine({
    signal: (target, kind, payload) => voiceHub.streamSignal(target, kind, payload),
    rtcConfig: () => voiceEngine.rtcConfig,
    settings: () => streamRulesRef.current,
    changed: () => setStreamTick(t => t + 1),
    // The shared window was closed, or the browser's own "stop sharing" bar was used.
    captureEnded: () => { void stopShareRef.current() },
  }))

  const [guilds, setGuilds] = useState<GuildState[]>([])
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  /** Home = the friends / DM view instead of a guild. */
  const [home, setHome] = useState(false)
  const [friends, setFriends] = useState<FriendsDto>(EMPTY_FRIENDS)
  const [dms, setDms] = useState<DmChannelDto[]>([])
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({})
  const dmsRef = useRef<DmChannelDto[]>([])
  const homeRef = useRef(false)
  useEffect(() => { dmsRef.current = dms }, [dms])
  useEffect(() => { homeRef.current = home }, [home])
  const [messages, setMessages] = useState<MessageDto[]>([])
  const [canLoadOlder, setCanLoadOlder] = useState(false)
  const [activeRoll, setActiveRoll] = useState<ActiveRoll | null>(null)
  const [activeRps, setActiveRps] = useState<ActiveRps | null>(null)
  const activeRpsRef = useRef<ActiveRps | null>(null)
  const rpsClearTimer = useRef<number | undefined>(undefined)
  useEffect(() => { activeRpsRef.current = activeRps }, [activeRps])
  const [typing, setTyping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Messages from the server's admin, shown until dismissed. */
  const [systemMessages, setSystemMessages] = useState<SystemMessageDto[]>([])
  /** signOut is defined further down; the connection's status handler needs to reach it. */
  const signOutRef = useRef<() => Promise<void>>(async () => {})
  const dismissSystemMessage = useCallback((id: string) => setSystemMessages(list => list.filter(m => m.id !== id)), [])
  const [status, setStatus] = useState('Connecting…')
  const [commands, setCommands] = useState<CommandDto[]>([])
  const [stats, setStats] = useState<Stats>(loadStats)
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
  const notifyDesktop = (title: string, body: string, channelId: string) => {
    if (preferencesRef.current.status === UserStatus.DoNotDisturb) return
    if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      const n = new Notification(title, { body: body.length > 140 ? body.slice(0, 140) + '…' : body, silent: !settingsRef.current.soundEnabled })
      n.onclick = () => { window.focus(); selectChannelRef.current(channelId); n.close() }
    } catch { /* notifications unavailable */ }
  }
  const selectChannelRef = useRef<(channelId: string) => void>(() => { /* set below */ })

  const me = () => settingsRef.current.user?.id ?? ''
  /** SignalR wraps server HubExceptions as "An unexpected error occurred invoking 'X' on the server. HubException: <msg>"; show just <msg>. */
  const fail = (e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e)
    const m = /HubException: (.*)$/s.exec(raw)
    setError(m ? m[1].trim() : raw)
  }

  const patchGuild = useCallback((guildId: string, fn: (g: GuildState) => GuildState) =>
    setGuilds(gs => gs.map(g => (g.guild.id === guildId ? fn(g) : g))), [])

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
      setStats(prev => {
        const next = { ...prev, totalRolls: prev.totalRolls + 1, rollSum: prev.rollSum + mine.value, perfect100s: prev.perfect100s + (mine.value === 100 ? 1 : 0), ones: prev.ones + (mine.value === 1 ? 1 : 0), wins: prev.wins + (won ? 1 : 0), losses: prev.losses + (won ? 0 : 1) }
        try { localStorage.setItem(STATS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
      if (won) playSound(mine.value === 100 ? 'you100' : 'win', s.soundProfile, s.soundEnabled)
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
    setGuilds(prev => list.map(g => {
      const old = prev.find(p => p.guild.id === g.guild.id)
      return { ...g, unread: old?.unread ?? 0, channelUnread: old?.channelUnread ?? {} }
    }))
    return list
  }, [api])

  const connect = useCallback(async () => {
    hub.onStatus = s => {
      setStatus(s === 'connected' ? 'Connected' : s === 'reconnecting' ? 'Reconnecting…' : s === 'connecting' ? 'Connecting…' : 'Disconnected')
      // The server closes the connection of an account it has just suspended. Ask it why we were dropped, and
      // if this sign-in is no longer accepted, say so and go back to the sign-in screen instead of sitting dead.
      // Offers are live on the connection that made them. We still have the files, so back online they are offered again.
      if (s === 'connected') void resumeOffers()
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
      void Promise.resolve(voiceEngine.leave()).catch(() => { /* nothing to stop */ })
      streamEngine.leaveAll()
      setViewerCounts({})
      voiceRef.current = null
      setVoice(null); setIsSpeaking(false)
      setError(now ? 'That voice channel was changed to a P2P channel, so you were taken out of it. Join again if you want to.' : 'That voice channel is no longer a P2P channel, so you were taken out of it. Join again to carry on.')
    }
    await hub.connect({
      MessageReceived: m => {
        if (selected.current.channel === m.channelId) {
          setMessages(ms => (ms.some(x => x.id === m.id) ? ms : [...ms, m]))
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
            if (m.authorId !== me()) playSound('join', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
          }
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
        if (!online) markDnd(userId, false)
        const mark = <T extends { user: { id: string } }>(f: T): T => (f.user.id === userId ? { ...f, online } : f)
        setFriends(fr => ({ friends: fr.friends.map(mark), incoming: fr.incoming.map(mark), outgoing: fr.outgoing.map(mark) }))
        setDms(ds => ds.map(d => (d.other.id === userId ? { ...d, online } : d)))
      },
      DmOpened: dm => setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [dm, ...ds])),
      // Someone changed how they appear: update every place we hold a copy of them.
      UserUpdated: (u: UserDto) => {
        const look = { avatarUrl: u.avatarUrl, displayName: u.displayName ?? null, nameFont: u.nameFont ?? null, nameColor: u.nameColor ?? null, nameColor2: u.nameColor2 ?? null, decoration: u.decoration ?? null }
        setGuilds(gs => gs.map(g => (g.members.some(m => m.userId === u.id) ? { ...g, members: g.members.map(m => (m.userId === u.id ? { ...m, ...look } : m)) } : g)))
        const swap = <T extends { user: UserDto }>(f: T): T => (f.user.id === u.id ? { ...f, user: u } : f)
        setFriends(fr => ({ friends: fr.friends.map(swap), incoming: fr.incoming.map(swap), outgoing: fr.outgoing.map(swap) }))
        setDms(ds => ds.map(d => (d.other.id === u.id ? { ...d, other: u } : d)))
        if (u.id === me()) updateSettings({ user: u })
      },
      MessageDeleted: (channelId, messageId) => { if (selected.current.channel === channelId) setMessages(ms => ms.filter(x => x.id !== messageId)) },
      Typing: (channelId, userId, username) => {
        if (selected.current.channel !== channelId || userId === me() || isIgnored(userId)) return
        setTyping(`${username} is typing…`)
        window.clearTimeout(typingTimer.current)
        typingTimer.current = window.setTimeout(() => setTyping(null), 4000)
      },
      PresenceStatus: (userId, dnd) => markDnd(userId, dnd),
      MemberPresence: (guildId, userId, online) => {
        if (!online) markDnd(userId, false)
        // No sound for this: the knock and the door are for people coming into and leaving the voice channel you are in.
        patchGuild(guildId, gs => ({ ...gs, members: gs.members.map(x => (x.userId === userId ? { ...x, online } : x)) }))
      },
      MemberJoined: (guildId, member) => patchGuild(guildId, g => ({ ...g, members: [...g.members.filter(x => x.userId !== member.userId), member] })),
      MemberLeft: (guildId, userId) => {
        if (userId === me()) { setGuilds(gs => gs.filter(g => g.guild.id !== guildId)); return }
        patchGuild(guildId, g => ({ ...g, members: g.members.filter(x => x.userId !== userId) }))
      },
      MemberUpdated: (guildId, member) => patchGuild(guildId, g => ({ ...g, members: g.members.map(x => (x.userId === member.userId ? member : x)) })),
      GuildUpdated: guild => patchGuild(guild.id, g => ({ ...g, guild })),
      GuildDeleted: guildId => setGuilds(gs => gs.filter(g => g.guild.id !== guildId)),
      ChannelCreated: c => { if (c.guildId) patchGuild(c.guildId, g => (g.channels.some(x => x.id === c.id) ? g : { ...g, channels: [...g.channels, c] })) },
      ChannelUpdated: c => {
        if (c.guildId) patchGuild(c.guildId, g => ({ ...g, channels: g.channels.map(x => (x.id === c.id ? c : x)) }))
        const cur = voiceRef.current
        if (cur && cur.channelId === c.id && (c.directSince ?? null) !== cur.directSince) dropForKindChange(c.directSince ?? null)
      },
      ChannelDeleted: (guildId, channelId) => patchGuild(guildId, g => ({ ...g, channels: g.channels.filter(x => x.id !== channelId) })),
      PermissionsChanged: async guildId => { try { const fresh = await api.guild(guildId); patchGuild(guildId, g => ({ ...g, ...fresh })) } catch { /* lost access; MemberLeft handles it */ } },
      CommandsChanged: async guildId => { if (selected.current.guild === guildId) setCommands(await api.commands(guildId).catch(() => [])) },
      RoleCreated: r => patchGuild(r.guildId, g => ({ ...g, roles: [...(g.roles ?? []).filter(x => x.id !== r.id), r] })),
      RoleUpdated: r => patchGuild(r.guildId, g => ({ ...g, roles: (g.roles ?? []).map(x => (x.id === r.id ? r : x)) })),
      RoleDeleted: (guildId, roleId) => patchGuild(guildId, g => ({ ...g, roles: (g.roles ?? []).filter(x => x.id !== roleId) })),
      RollStarted: onRollStarted,
      RollUpdated: session => setActiveRoll(cur => (cur && cur.session.id === session.id ? { ...cur, session } : cur)),
      RollEnded: onRollEnded,
      RpsStarted: session => { if (!inParty(session.channelId)) return; window.clearTimeout(rpsClearTimer.current); setActiveRps({ session, result: null, myPick: null }) },
      RpsUpdated: session => setActiveRps(cur => (cur && cur.session.id === session.id ? { ...cur, session } : cur)),
      RpsEnded: result => {
        setActiveRps(cur => (cur && cur.session.id === result.sessionId ? { ...cur, result } : cur))
        const s = settingsRef.current
        if (result.winnerIds.length === 1 && result.entries.some(e => e.userId === me()))
          playSound(result.winnerIds[0] === me() ? 'win' : 'lose', s.soundProfile, s.soundEnabled)
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
      SystemMessage: m => setSystemMessages(list => [...list.filter(x => x.id !== m.id), m].slice(-4)),
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
      void joinVoiceRef.current(cur.channelId, true)
    }
    voiceHub.onClosed = () => {
      if (callRef.current) setCall(null)
      if (!voiceRef.current) return
      void Promise.resolve(voiceEngine.leave()).catch(() => { /* nothing to stop */ })
      streamEngine.leaveAll()
      setViewerCounts({})
      voiceRef.current = null
      setVoice(null); setIsSpeaking(false)
    }
    await voiceHub.connect({
      // These only arrive for the voice channel we are in, and never for ourselves: knock when someone joins, door when they leave.
      ParticipantJoined: (c, p) => {
        const cur = voiceRef.current
        if (cur?.channelId === c && !cur.participants.some(x => x.connectionId === p.connectionId))
          playSound('join', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
        setVoice(v => (v && v.channelId === c && !v.participants.some(x => x.connectionId === p.connectionId)
          ? { ...v, participants: [...v.participants, { ...p, state: 'connecting', speaking: false }] } : v))
      },
      ParticipantLeft: (c, _userId, id) => {
        const cur = voiceRef.current
        if (cur?.channelId === c && cur.participants.some(x => x.connectionId === id))
          playSound('leave', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
        void voiceEngine.removePeer(id)
        streamEngine.viewerLeft(id)
        streamEngine.unwatch(id)
        setVoice(v => (v && v.channelId === c ? { ...v, participants: v.participants.filter(p => p.connectionId !== id) } : v))
      },
      ParticipantUpdated: (c, p) => {
        // They stopped sharing: whatever we were watching of theirs is over.
        if (!p.stream) streamEngine.unwatch(p.connectionId)
        setVoice(v => (v && v.channelId === c
          ? { ...v, participants: v.participants.map(x => (x.connectionId === p.connectionId ? { ...x, muted: p.muted, stream: p.stream ?? null } : x)) } : v))
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
      StreamViewersChanged: (id, viewers) => setViewerCounts(counts => ({ ...counts, [id]: viewers })),
      StreamEnded: (id, reason) => {
        if (id === voiceHub.connectionId) { streamEngine.stopSharing(); if (reason) setError(reason) }
        else streamEngine.unwatch(id)
      },
    })

    const list = await loadGuilds()
    const [fr, dmList, decos] = await Promise.all([api.friends().catch(() => EMPTY_FRIENDS), api.dms().catch(() => [] as DmChannelDto[]), api.decorations().catch(() => [] as DecorationDto[])])
    setFriends(fr); setDms(dmList); dmsRef.current = dmList; setDecorations(decos)
    void api.privacy().then(p => { allowDirectRef.current = p.allowDirect; setAllowDirectState(p.allowDirect) }).catch(() => { /* stays "no" */ })
    void api.preferences().then(applyPreferences).catch(() => { /* shown as online */ })
    void api.blocks().then(setBlockedList).catch(() => { /* none shown */ })
    void api.transferSettings().then(setTransferLimits).catch(() => { /* the tooltip says less */ })
    const self = settingsRef.current.user
    if (self) void api.profile(self.id).then(p => setOwnLook({ accentColor: p.accentColor, bannerUrl: p.bannerUrl })).catch(() => { /* plain background */ })
    setDndUsers(new Set([
      ...list.flatMap(g => g.members.filter(m => m.dnd).map(m => m.userId)),
      ...fr.friends.filter(f => f.dnd).map(f => f.user.id),
      ...dmList.filter(d => d.dnd).map(d => d.other.id),
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
  }, [api, applyPreferences, hub, loadGuilds, markDnd, onRollEnded, onRollStarted, patchGuild, setCall, updateSettings, voiceEngine, voiceHub])

  // ---- Selection ----------------------------------------------------------

  const selectGuild = useCallback((guildId: string) => {
    const g = guildsRef.current.find(x => x.guild.id === guildId)
    if (!g) return
    setHome(false)
    setSelectedGuildId(guildId)
    patchGuild(guildId, x => ({ ...x, unread: 0 }))
    updateSettings({ lastGuildId: guildId })
    const preferred = g.channels.find(c => c.id === settingsRef.current.lastChannelId && isChat(c))
    const first = g.channels.filter(c => c.type === ChannelType.Text).sort((a, b) => a.position - b.position)[0]
    setSelectedChannelId((preferred ?? first)?.id ?? null)
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
      setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [dm, ...ds]))
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

  // Load history + active roll + commands when the channel changes.
  useEffect(() => {
    setMessages([]); setTyping(null); setCanLoadOlder(false)
    if (!selectedChannelId) return
    let cancelled = false
    ;(async () => {
      try {
        const page = await api.messages(selectedChannelId)
        if (cancelled) return
        setMessages(page.slice().reverse())
        setCanLoadOlder(page.length >= 50)
        if (!inParty(selectedChannelId)) return
        const active = await hub.getActiveRoll(selectedChannelId)
        if (!cancelled && active && activeRollRef.current?.session.id !== active.id) onRollStarted(active)
        const activeRpsSession = await hub.getActiveRps(selectedChannelId)
        if (!cancelled && activeRpsSession && activeRpsRef.current?.session.id !== activeRpsSession.id) setActiveRps({ session: activeRpsSession, result: null, myPick: null })
      } catch (e) { if (!cancelled) fail(e) }
    })()
    return () => { cancelled = true }
  }, [api, hub, onRollStarted, selectedChannelId])

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

  const sendMessage = useCallback(async (text: string, attachmentIds: string[] | null = null) => {
    const channelId = selected.current.channel
    if (!channelId || (!text.trim() && !attachmentIds?.length)) return
    await run(() => hub.sendMessage(channelId, text.trim(), attachmentIds))
  }, [hub])

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
    await run(async () => {
      const m = await hub.offerFile(channelId, file.name, file.size)
      if (m.fileOffer) holdOffer(m.fileOffer.id, file)
    })
  }, [hub, holdOffer])

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
      try { await hub.requestFile(offer.id) }
      catch (e) { transferEngine.cancel(`${offer.id}<`); throw e }
    })
  }, [hub, transferEngine])

  const cancelTransfer = useCallback((key: string) => transferEngine.cancel(key), [transferEngine])

  const [uploading, setUploading] = useState<string | null>(null)
  const sendFile = useCallback(async (file: File, text = '') => {
    const channelId = selected.current.channel
    if (!channelId) return
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
      setUploading(file.name)
      try { const a = await api.upload(channelId, file); await hub.sendMessage(channelId, text, [a.id]) }
      finally { setUploading(null) }
    })
  }, [api, hub, holdOffer])

  const notifyTyping = useCallback(() => {
    const channelId = selected.current.channel
    if (!channelId || !hub.connected || Date.now() - lastTypingSent.current < 3000) return
    lastTypingSent.current = Date.now()
    void hub.setTyping(channelId)
  }, [hub])

  const loadOlder = useCallback(async () => {
    const channelId = selected.current.channel
    const oldest = messages[0]
    if (!channelId || !oldest) return
    await run(async () => { const page = await api.messages(channelId, oldest.id); setMessages(ms => [...page.slice().reverse(), ...ms]); setCanLoadOlder(page.length >= 50) })
  }, [api, messages])

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

  const invokeCommand = useCallback(async (command: CommandDto, args: Record<string, string>) => {
    const channelId = selected.current.channel
    if (!channelId) return
    await run(() => hub.invokeCommand(channelId, command.id, args))
  }, [hub])

  const createGuild = useCallback(async (name: string) => run(async () => {
    const g = await api.createGuild(name)
    setGuilds(gs => [...gs, { ...g, unread: 0, channelUnread: {} }])
    guildsRef.current = [...guildsRef.current, { ...g, unread: 0, channelUnread: {} }]
    selectGuild(g.guild.id)
  }), [api, selectGuild])

  const joinGuild = useCallback(async (code: string) => run(async () => {
    const g = await api.joinInvite(code)
    const state: GuildState = { ...g, unread: 0, channelUnread: {} }
    setGuilds(gs => [...gs.filter(x => x.guild.id !== g.guild.id), state])
    guildsRef.current = [...guildsRef.current.filter(x => x.guild.id !== g.guild.id), state]
    selectGuild(g.guild.id)
  }), [api, selectGuild])

  const createInvite = useCallback(async (guildId?: string) => {
    const g = guildId ?? selected.current.guild
    if (!g) return
    await run(async () => {
      const invite = await api.createInvite(g)
      try { await navigator.clipboard.writeText(invite.code) } catch { /* no clipboard */ }
      setError(`Invite code ${invite.code} copied to clipboard.`)
    })
  }, [api])

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
  const banMember = useCallback(async (m: MemberDto) => { const g = selected.current.guild; if (g) await run(() => api.ban(g, m.userId)) }, [api])

  // ---- Server settings --------------------------------------------------------

  const renameGuild = useCallback(async (name: string) => { const g = selected.current.guild; if (g) await run(async () => { const guild = await api.updateGuild(g, name); patchGuild(g, x => ({ ...x, guild })) }) }, [api, patchGuild])
  const setGuildIcon = useCallback(async (file: File | null) => {
    const g = selected.current.guild
    if (!g) return
    await run(async () => {
      if (file) { const guild = await api.uploadGuildIcon(g, file); patchGuild(g, x => ({ ...x, guild })) }
      else { await api.deleteGuildIcon(g); patchGuild(g, x => ({ ...x, guild: { ...x.guild, iconUrl: null } })) }
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

  // ---- Sharing a screen, an app window or a camera with the voice channel -----------------------------------------

  const loadStreamRules = useCallback(async () => {
    const rules = await api.streamSettings()
    streamRulesRef.current = rules
    setStreamRules(rules)
    return rules
  }, [api])

  /** Tell the channel we are sharing and hand the capture to the engine. Nothing is sent until someone watches. */
  const shareStream = useCallback(async (media: MediaStream, kind: StreamKind, quality: StreamQuality | null = null) => {
    try { await voiceHub.startStream(kind) }
    catch (e) { media.getTracks().forEach(t => t.stop()); throw e }
    streamEngine.start(media, kind, quality)
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
      const quality = (wanted && allowed.find(q => q.height === wanted.height && q.fps === wanted.fps)) || defaultQuality(rules, direct)
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
      try { await voiceHub.watchStream(streamer) }
      catch (e) { streamEngine.unwatch(streamer); throw e }
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
    const onBack = () => { if (!document.hidden) void voiceEngine.recover() }
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
    await run(async () => {
      // For a relayed channel the server hands out a relay or refuses: there is nothing here to fall back to.
      const ice = await api.iceServers(channelId)
      voiceEngine.maxAudioKbps = (await api.voiceSettings().catch(() => null))?.audioKbps ?? 0
      const policy = voiceEngine.configure(ice, directSince ? 'direct' : 'relay')
      if (!directSince && policy !== 'relay') throw new Error('No voice relay is available right now, so this channel cannot connect.')
      if (voiceRef.current) await leaveVoice()
      voiceEngine.setDevices(s.audioInputDeviceId, s.audioOutputDeviceId)
      const others = directSince ? await voiceHub.joinDirect(channelId) : await voiceHub.join(channelId)
      const user = s.user!
      const selfId = voiceHub.connectionId ?? 'self'
      const joined: VoiceState = {
        channelId, guildId, directSince, policy, status: '',
        participants: [
          ...others.map(p => ({ ...p, state: 'connecting', speaking: false })),
          { userId: user.id, username: user.username, connectionId: selfId, muted: isMuted, state: '', speaking: false },
        ],
      }
      voiceRef.current = joined // before the next render, so a roll that starts right now already counts as ours
      setVoice(joined)
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
      try { await voiceEngine.join(others) }
      catch (e) { setVoice(v => (v ? { ...v, status: 'No microphone: ' + (e instanceof Error ? e.message : e) } : v)) }
    })
  }, [api, hub, isMuted, leaveVoice, onRollStarted, voiceEngine, voiceHub])

  useEffect(() => { joinVoiceRef.current = joinVoice }, [joinVoice])

  // ---- Calls with a friend ---------------------------------------------------------
  // A call is voice in the direct-message channel the two share. It is relayed unless the caller asked for a P2P
  // call, both accounts allow P2P, and the person answering was shown that this is what it is.

  /** Take our place in a call's room: the same engine as a voice channel, set up for this call's kind and no other. */
  const enterCall = useCallback(async (channelId: string, direct: boolean, connect: () => Promise<VoiceParticipantDto[]>) => {
    const s = settingsRef.current
    const ice = await api.iceServers(channelId)
    voiceEngine.maxAudioKbps = (await api.voiceSettings().catch(() => null))?.audioKbps ?? 0
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
    if (isMuted) void voiceHub.setMuted(true)
    try { await voiceEngine.join(others) }
    catch (e) { setVoice(v => (v ? { ...v, status: 'No microphone: ' + (e instanceof Error ? e.message : e) } : v)) }
  }, [api, isMuted, voiceEngine, voiceHub])

  const startCall = useCallback(async (userId: string, direct: boolean) => {
    if (callRef.current) return
    await run(async () => {
      const dm = await api.openDm(userId)
      setDms(ds => (ds.some(d => d.channelId === dm.channelId) ? ds : [dm, ...ds]))
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
          await enterCall(c.channelId, c.direct, () => voiceHub.joinCall(c.id, c.direct))
          if (callRef.current?.id === c.id) setCall({ ...c, phase: 'active' })
        } catch (e) {
          if (callRef.current?.id === c.id) setCall(null)
          void voiceHub.declineCall(c.id).catch(() => { /* already over */ })
          throw e
        }
      })
    } finally { answeringRef.current = false }
  }, [enterCall, leaveVoice, setCall, voiceHub])

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
    if (cur && cur.id === p.id) updateSettings({ user: { ...cur, displayName: p.displayName, avatarUrl: p.avatarUrl, nameFont: p.nameFont, nameColor: p.nameColor, nameColor2: p.nameColor2, decoration: p.decoration } })
  }, [updateSettings])
  /** Throws with the server's reason if a field is refused, so the editor can show it next to the form. */
  const saveProfile = useCallback(async (patch: UpdateProfileRequest) => { const p = await api.updateProfile(patch); applyOwnProfile(p); return p }, [api, applyOwnProfile])
  const setProfilePicture = useCallback(async (kind: 'avatar' | 'banner', file: File | null) => {
    const small = file ? await shrinkPicture(file, kind) : null
    const p = small ? await (kind === 'avatar' ? api.uploadAvatar(small) : api.uploadBanner(small)) : await (kind === 'avatar' ? api.deleteAvatar() : api.deleteBanner())
    applyOwnProfile(p)
    return p
  }, [api, applyOwnProfile])

  /** A name on one server only (null removes it). The server tells everyone, including us, through MemberUpdated. */
  const setNickname = useCallback(async (guildId: string, userId: string, nickname: string | null) => run(async () => {
    const member = await api.setNickname(guildId, userId, nickname)
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
    await joinVoice(p.channelId, true)
  }, [directPrompt, joinVoice, updateSettings])

  /** Turning P2P off is immediate. Turning it on is refused by the server unless this sign-in is minutes old. */
  const setAllowDirect = useCallback(async (on: boolean) => {
    const p = await api.setPrivacy(on)
    allowDirectRef.current = p.allowDirect
    setAllowDirectState(p.allowDirect)
  }, [api])

  /**
   * Sign in again and, if it comes back as the same account, allow P2P. The desktop app and the development sign-in
   * do it in place. A browser has to leave for the provider and come back; App.tsx finishes the job on return.
   */
  const reauthenticateForDirect = useCallback(async (provider: string, devUsername = '') => {
    const serverUrl = settingsRef.current.serverUrl
    const mine = settingsRef.current.user?.id ?? ''
    let token: TokenResponse
    if (provider === 'dev') token = await api.devLogin(serverUrl, devUsername)
    else {
      const desktop = bridge()
      if (!desktop) {
        sessionStorage.setItem(PENDING_DIRECT, mine)
        window.location.href = `${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(window.location.origin + window.location.pathname)}`
        return
      }
      token = await api.exchangeCode(serverUrl, await desktop.oauthLogin(serverUrl, provider))
    }
    if (token.user.id !== mine) throw new Error('That sign-in is a different account. Sign in as the account you are using now.')
    updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
    await setAllowDirect(true)
  }, [api, setAllowDirect, updateSettings])

  const renameChannel = useCallback(async (channelId: string, name: string) => { await run(() => api.renameChannel(channelId, name)) }, [api])
  const deleteChannel = useCallback(async (channelId: string) => { await run(() => api.deleteChannel(channelId)) }, [api])
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
  const outputVolume = settings.outputVolume ?? 1
  useEffect(() => { voiceEngine.setOutput(outputVolume, deafened) }, [deafened, outputVolume, voiceEngine, voicePeers])
  const voiceGate = settings.voiceGate !== false
  const voiceGateLevel = settings.voiceGateLevel ?? DEFAULT_GATE_LEVEL
  useEffect(() => { voiceEngine.setGate(voiceGate, gateThreshold(voiceGateLevel)) }, [voiceEngine, voiceGate, voiceGateLevel])
  useEffect(() => { applyTheme(settings.theme) }, [settings.theme])


  const signOut = useCallback(async () => {
    await leaveVoice()
    await voiceHub.disconnect()
    await hub.disconnect()
    // What was picked while signed in is let go of. What the desktop app remembers stays, for this account's next sign-in.
    transferEngine.dropOffers()
    updateSettings({ accessToken: null, tokenExpires: null, user: null })
    setGuilds([]); setSelectedGuildId(null); setSelectedChannelId(null); setHome(false); setFriends(EMPTY_FRIENDS); setDms([]); setReady(false)
  }, [hub, leaveVoice, transferEngine, updateSettings, voiceHub])

  signOutRef.current = signOut

  const selectedGuild = home ? null : guilds.find(g => g.guild.id === selectedGuildId) ?? null
  const selectedDm = home ? dms.find(d => d.channelId === selectedChannelId) ?? null : null
  const selectedChannel = selectedDm ? dmChannel(selectedDm) : selectedGuild?.channels.find(c => c.id === selectedChannelId) ?? null
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
    if (!pending.auto) playSound('join', settingsRef.current.soundProfile, settingsRef.current.soundEnabled)
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
    guilds, selectedGuild, selectedChannel, selectedDm, home, friends, dms, dmUnread, messages, canLoadOlder, activeRoll, typing, commands, stats,
    connect, selectGuild, selectChannel, openHome, openDm, addFriend, removeFriend, searchUsers, sendMessage, sendFile, uploading, offerFile, withdrawFile, downloadFile, cancelTransfer, transfers, notifyTyping, loadOlder,
    renameGuild, setGuildIcon, createRole, updateRole, deleteRole, setMemberRoles,
    partyChannel, partyLabel,
    setUserPrefs, setGuildPrefs, markGuildRead, mentionsMe,
    appearanceOf, decorations, loadProfile, saveProfile, setProfilePicture, setNickname,
    plugins, pendingDrops, resolveItem, itemIcon, searchItems, acceptDrop, dismissDrop, simulateDrop,
    setPluginSettings, reloadPlugins, installPlugin, openPluginsFolder, pickPluginLog,
    soundPacks, reloadSoundPacks, openSoundsFolder,
    startRoll, quickRoll, roll, voteEnd, dismissRoll, coinFlip, invokeCommand,
    activeRps, startRps, rpsPick, rpsThrow, dismissRps,
    createGuild, joinGuild, createInvite, createChannel, leaveGuild, kickMember, banMember, signOut,
    sharing, shareQuality: streamEngine.quality, localStream: streamEngine.localStream, shareViewers: streamEngine.viewerCounts(), watching: streamEngine.watching(),
    streamOf: (streamer: string) => streamEngine.streamOf(streamer), viewerCounts, streamRules, loadStreamRules,
    startShare, stopShare, watchStream, unwatchStream, setStreamLimit: (streamer: string, kbps: number) => streamEngine.requestLimit(streamer, kbps),
    voice, isMuted, isSpeaking, joinVoice, leaveVoice, toggleMute,
    call, startCall, answerCall, declineCall, renameChannel, deleteChannel, setChannelMuted,
    preferences, savePreferences, blocked, setBlocked, dndUsers, deafened, toggleDeafen, ownLook, transferLimits,
    allowDirect, setAllowDirect, reauthenticateForDirect, directPrompt, confirmDirect, dismissDirectPrompt: () => setDirectPrompt(null), setChannelDirect,
    setAudioDevices, me: () => settingsRef.current.user,
    MessageKind,
  }
}

export type Store = ReturnType<typeof useMaplecord>
