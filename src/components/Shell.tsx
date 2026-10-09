import { TagCardDialog, onTagOpened } from './Tags'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Store } from '../store'
import type { TransferView } from '../transfer'
import { ChannelType, MessageKind, Permission, UserStatus, RollChoice, RollKind, RollRange, RpsChoice, hasPermission, type AttachmentDto, type ChannelBotDto, type FileOfferDto, type CommandDto, type MemberDto, type MessageDto, type RoleDto } from '../types'

const RPS_ICON: Record<number, string> = { [RpsChoice.Rock]: '✊', [RpsChoice.Paper]: '✋', [RpsChoice.Scissors]: '✌️' }
const RPS_NAME: Record<number, string> = { [RpsChoice.Rock]: 'Rock', [RpsChoice.Paper]: 'Paper', [RpsChoice.Scissors]: 'Scissors' }

/** Built-in commands handled by the client; they show up in the "/" list next to bot commands. */
const BUILTIN_COMMANDS = [
  { name: 'roll', description: 'Start a roll for everyone (optional range, e.g. /roll 1-20)' },
  { name: 'need', description: 'Start a need / greed roll (optional range)' },
  { name: 'dice', description: 'Roll just for yourself and post the number (e.g. /dice 1-6)' },
  { name: 'flip', description: 'Flip a coin' },
  { name: 'rps', description: 'Rock, paper, scissors' },
  { name: 'rollcust', description: 'Start a roll for a named item (opens the form)' },
  { name: 'needcust', description: 'Start a need / greed roll for a named item (opens the form)' },
] as const

/** "1-20" → [1, 20]; anything else → null. */
function parseRange(text: string): [number, number] | null {
  const m = /^(\d{1,7})\s*[-–]\s*(\d{1,7})$/.exec(text.trim())
  if (!m) return null
  const min = parseInt(m[1], 10), max = parseInt(m[2], 10)
  return RollRange.isValid(min, max) ? [min, max] : null
}
import { PastedDialog, AllowDirectDialog, BanDialog, ConfirmDialog, CreateChannelDialog, DeleteGroupDialog, DirectChannelDialog, IncomingCallDialog, P2PCallDialog, NicknameDialog, PromptDialog, StartRollDialog } from './Dialogs'
import { OverlaySettingsDialog, ServerSettingsDialog } from './Settings'
import Friends from './Home'
import { serverMediaUrl } from '../itemIcons'
import { isElectron } from '../platform'
import { P2P_PICTURE, type P2PFile } from '../p2pText'
import { soundPackNames } from '../sounds'
import { DEFAULT_GATE_LEVEL, DEFAULT_NOTIFY, type NotifyLevel } from '../settings'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import type { GuildFolder } from '../settings'
import { Avatar, ProfileEditor, ProfilePopout, UserName } from './Profile'
import { assetUrl, initials, shownName, type Appearance } from '../profile'
import { STATUSES, UserSettingsDialog } from './UserSettings'
import { ArrowLeftRight, AudioLines, ChevronDown, ChevronRight, HeadphoneOff, Headphones, LoaderCircle, Menu, Mic, MicOff, MonitorUp, Paperclip, Phone, PhoneOff, Plus, Settings as SettingsIcon, Signal, Users, Video } from 'lucide-react'
import { AddServerDialog, CreateServerDialog, DiscoverDialog, JoinServerDialog } from './Servers'
import { ChannelAccessDialog } from './ChannelAccess'
import { DeleteAccountDialog } from './DeleteAccount'
import { VoiceMessageBar } from './VoiceMessage'
import { DEFAULT_PUSH_KEY } from '../pushToTalk'
import { canRecordVoiceMessage } from '../voiceMessage'
import { appleTouch } from '../platform'
import { DropBanner, PluginsDialog } from './Plugins'
import { SharePicker, StreamStage } from './Streams'
import { CHAT_LEAST, COLUMNS, ColumnGrip, clampColumn, type Column } from './ColumnGrip'
import { channelMembers } from '../channelViewers'

type DialogState =
  | { kind: 'createGuild' } | { kind: 'joinGuild' } | { kind: 'addGuild' } | { kind: 'discover' } | { kind: 'channelAccess'; channelId: string } | { kind: 'deleteGroup'; channelId: string; name: string } | { kind: 'createChannel'; category?: boolean } | { kind: 'startRoll'; rollKind: RollKind }
  | { kind: 'leaveGuild' } | { kind: 'kick'; member: MemberDto } | { kind: 'ban'; member: MemberDto }
  | { kind: 'audio' } | { kind: 'allowDirect' } | { kind: 'channelKind'; channelId: string; name: string; direct: boolean } | { kind: 'p2pCall'; userId: string; name: string } | { kind: 'share' } | { kind: 'settings' } | { kind: 'renameChannel'; channelId: string; name: string } | { kind: 'deleteChannel'; channelId: string; name: string } | { kind: 'renameFolder'; folderId: string } | { kind: 'overlay' } | { kind: 'server' } | { kind: 'plugins' } | { kind: 'profile' }
  | { kind: 'nickname'; guildId: string; userId: string } | null

export default function Shell({ store, onSignedOut }: { store: Store; onSignedOut: () => void }) {
  const [dialog, setDialog] = useState<DialogState>(null)
  // A server tag beside someone's name was clicked: whose it is.
  const [tagOpen, setTagOpen] = useState<string | null>(null)
  useEffect(() => onTagOpened(setTagOpen), [])
  /**
   * On a phone there is room for one thing at a time: the channel list, the conversation, or the people in it.
   * Wide windows show all three and ignore this.
   */
  const [pane, setPane] = useState<'list' | 'chat' | 'people'>('chat')
  // The channel list and the member list can be dragged wider or narrower; the widths are remembered on this device.
  const [columns, setColumns] = useState(() => ({
    sidebar: clampColumn('sidebar', store.settings.columnWidths?.sidebar ?? COLUMNS.sidebar.usual),
    members: clampColumn('members', store.settings.columnWidths?.members ?? COLUMNS.members.usual),
  }))
  const columnsNow = useRef(columns)
  const columnsKept = useRef(store.settings.columnWidths ?? {})
  const grip = (column: Column) => (
    <ColumnGrip column={column} width={columns[column]}
      onChange={width => {
        // Never so wide that the chat between the two is squeezed out.
        const room = window.innerWidth - 72 - columnsNow.current[column === 'sidebar' ? 'members' : 'sidebar'] - CHAT_LEAST
        columnsNow.current = { ...columnsNow.current, [column]: Math.max(COLUMNS[column].least, Math.min(width, room)) }
        setColumns(columnsNow.current)
      }}
      onSettle={width => {
        columnsKept.current = { ...columnsKept.current, [column]: width === null ? undefined : columnsNow.current[column] }
        store.updateSettings({ columnWidths: columnsKept.current })
      }} />
  )
  // A file dropped anywhere but on the chat would be opened by the window, in place of the app. Nothing happens instead.
  useEffect(() => {
    const ignore = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', ignore); window.addEventListener('drop', ignore)
    return () => { window.removeEventListener('dragover', ignore); window.removeEventListener('drop', ignore) }
  }, [])
  const openChannelId = store.selectedChannel?.id ?? null
  const atHome = store.home
  useEffect(() => { setPane('chat') }, [openChannelId, atHome])
  /** The dropdown under the server name. */
  const [serverMenu, setServerMenu] = useState(false)
  useEffect(() => {
    if (!serverMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setServerMenu(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [serverMenu])
  const g = store.selectedGuild
  const me = store.me()
  const myPerms = g?.myPermissions ?? 0
  const can = (p: number) => hasPermission(myPerms, p)
  const voice = store.voice
  const inCall = voice && store.call?.channelId === voice.channelId ? store.call : null
  /** Whether we cannot be heard in the voice channel we are in, and our own entry on its server (which says whether a moderator did it). */
  const silencedHere = !!voice?.participants.find(p => p.userId === me?.id)?.silenced
  const myMember = store.guilds.find(x => x.guild.id === voice?.guildId)?.members.find(m => m.userId === me?.id)
  const voiceChannelName = voice ? (inCall ? inCall.otherName : store.guilds.flatMap(x => x.channels).find(c => c.id === voice.channelId)?.name ?? '') : ''
  const peers = voice?.participants.filter(p => p.userId !== me?.id) ?? []
  // Only a P2P connection is remarked on; an ordinary one is simply a connection.
  const voiceDetail = voice
    ? voice.status || (inCall?.phase === 'calling' ? 'ringing…' : peers.length === 0 ? (inCall ? 'connecting…' : 'alone in channel') : `${peers.filter(p => p.state === 'connected').length}/${peers.length} connected`)
    : ''
  const voiceGuild = voice && !inCall ? store.guilds.find(x => x.channels.some(c => c.id === voice.channelId))?.guild.name ?? '' : ''
  const myStatus = STATUSES.find(x => x.value === store.preferences.status) ?? STATUSES[0]
  const banner = assetUrl(store.settings.serverUrl, store.ownLook.bannerUrl)
  const accent = store.ownLook.accentColor
  const selfStyle: React.CSSProperties | undefined = banner
    ? { backgroundImage: `linear-gradient(rgba(11, 11, 16, .45), rgba(11, 11, 16, .8)), url("${banner}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : accent ? { background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 60%, var(--bg0)), color-mix(in srgb, ${accent} 18%, var(--bg0)))` } : undefined
  const screenSharing = store.sharing === 'screen' || store.sharing === 'window'
  const canShareScreen = isElectron() || typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  const toggleCamera = async () => {
    if (store.sharing === 'camera') { await store.stopShare(); return }
    if (store.sharing) await store.stopShare()
    await store.loadStreamRules().catch(() => null)
    await store.startShare({ type: 'camera' })
  }
  const statusEntries = (): MenuEntry[] => [
    { kind: 'label', text: me ? shownName(me) : '' },
    ...STATUSES.map(st => ({ kind: 'item', label: st.label + (st.hint ? ' · ' + st.hint.toLowerCase() : ''), icon: st.value === UserStatus.Online ? '🟢' : st.value === UserStatus.DoNotDisturb ? '⛔' : '⚪', checked: store.preferences.status === st.value, onClick: () => { void store.savePreferences({ status: st.value }) } } as MenuEntry)),
    { kind: 'sep' },
    { kind: 'item', label: 'Edit profile', icon: '✎', onClick: () => setDialog({ kind: 'profile' }) },
    { kind: 'item', label: 'Copy user ID', icon: '🆔', onClick: () => { if (me) void navigator.clipboard.writeText(me.id) } },
    { kind: 'sep' },
    { kind: 'item', label: 'Roll buttons', checked: store.settings.showRollButtons !== false, onClick: () => store.updateSettings({ showRollButtons: store.settings.showRollButtons === false }) },
    { kind: 'item', label: isElectron() ? 'In-game overlay' : 'In-game overlay (desktop app only)', disabled: !isElectron(), checked: isElectron() && store.settings.overlayEnabled, onClick: () => store.updateSettings({ overlayEnabled: !store.settings.overlayEnabled }) },
  ]
  // Servers can be grouped into folders in the rail: drag one onto another. Kept on this device.
  const DRAG = 'text/maplecord-guild'
  // Channels and their groups are dragged too, by people who may manage channels: onto a group to move a channel
  // into it, onto a channel to put it in front of that one, and a group onto a group to reorder the groups.
  const CHANNEL_DRAG = 'text/maplecord-channel'
  // A group of channels folds shut with a click on its heading. What is going on inside still shows: the channel
  // being read, channels with something unread, and voice channels with people in them.
  /** The P2P bots of each P2P channel whose menu has been opened, asked for as the menu opens. */
  const [channelBots, setChannelBots] = useState<Record<string, ChannelBotDto[]>>({})
  const loadChannelBots = (channelId: string) => { void store.api.channelBots(channelId).then(list => setChannelBots(all => ({ ...all, [channelId]: list }))).catch(() => {}) }
  const collapsedGroups = store.settings.collapsedGroups ?? {}
  const toggleGroup = (id: string) => {
    const all = { ...collapsedGroups }
    if (all[id]) delete all[id]; else all[id] = true
    store.updateSettings({ collapsedGroups: all })
  }
  const [dropOn, setDropOn] = useState<string | null>(null)
  const channelDragged = (e: React.DragEvent) => (e.dataTransfer.types.includes(CHANNEL_DRAG) ? e.dataTransfer.getData(CHANNEL_DRAG) : '')
  const channelDrag = (id: string, overGroup: boolean, drop: (dragged: string, draggedIsGroup: boolean) => void) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(CHANNEL_DRAG, id); e.dataTransfer.effectAllowed = 'move' },
    onDragEnd: () => setDropOn(null),
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(CHANNEL_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropOn !== id) setDropOn(id) } },
    onDragLeave: () => { if (dropOn === id) setDropOn(null) },
    onDrop: (e: React.DragEvent) => {
      const dragged = channelDragged(e)
      setDropOn(null)
      if (!dragged || dragged === id) return
      e.preventDefault(); e.stopPropagation()
      const draggedIsGroup = g?.channels.find(c => c.id === dragged)?.type === ChannelType.Category
      // A group can only be dropped on a group.
      if (draggedIsGroup && !overGroup) return
      drop(dragged, !!draggedIsGroup)
    },
  })
  const folders = store.settings.guildFolders ?? []
  const folderOf = (guildId: string) => folders.find(f => f.guildIds.includes(guildId)) ?? null
  // A folder of one is not a folder, and a server we have left is not in any.
  const saveFolders = (next: GuildFolder[]) => store.updateSettings({
    guildFolders: next.map(f => ({ ...f, guildIds: f.guildIds.filter(id => store.guilds.some(x => x.guild.id === id)) })).filter(f => f.guildIds.length >= 2),
  })
  const moveToFolder = (guildId: string, folderId: string | null) =>
    saveFolders(folders.map(f => ({ ...f, guildIds: f.id === folderId ? [...f.guildIds.filter(id => id !== guildId), guildId] : f.guildIds.filter(id => id !== guildId) })))
  const dropOnGuild = (dragged: string, target: string) => {
    if (dragged === target) return
    const into = folderOf(target)
    if (into) { moveToFolder(dragged, into.id); return }
    saveFolders([...folders.map(f => ({ ...f, guildIds: f.guildIds.filter(id => id !== dragged) })), { id: crypto.randomUUID(), name: 'Folder', guildIds: [target, dragged], open: true }])
  }
  const dragged = (e: React.DragEvent) => (e.dataTransfer.types.includes(DRAG) ? e.dataTransfer.getData(DRAG) : '')
  const allowDrop = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }
  const folderEntries = (folderId: string): MenuEntry[] => {
    const f = folders.find(x => x.id === folderId)
    if (!f) return []
    const inside = store.guilds.filter(x => f.guildIds.includes(x.guild.id))
    return [
      { kind: 'label', text: f.name },
      { kind: 'item', label: 'Mark all as read', disabled: !inside.some(x => x.unread > 0), onClick: () => { for (const x of inside) store.markGuildRead(x.guild.id) } },
      { kind: 'item', label: 'Rename folder', icon: '✎', onClick: () => setDialog({ kind: 'renameFolder', folderId }) },
      { kind: 'sep' },
      { kind: 'item', label: 'Ungroup', onClick: () => saveFolders(folders.filter(x => x.id !== folderId)) },
    ]
  }

  const rollEntries = (): MenuEntry[] => [
    { kind: 'label', text: 'Rolls' },
    { kind: 'item', label: 'Roll buttons', checked: store.settings.showRollButtons !== false, onClick: () => store.updateSettings({ showRollButtons: store.settings.showRollButtons === false }) },
    { kind: 'item', label: isElectron() ? 'In-game overlay' : 'In-game overlay (desktop app only)', disabled: !isElectron(), checked: isElectron() && store.settings.overlayEnabled, onClick: () => store.updateSettings({ overlayEnabled: !store.settings.overlayEnabled }) },
  ]
  const deviceEntries = (kind: 'audioinput' | 'audiooutput'): MenuEntry[] => {
    const chosen = kind === 'audioinput' ? store.settings.audioInputDeviceId : store.settings.audioOutputDeviceId
    const pick = (id: string | null) => void store.setAudioDevices(kind === 'audioinput' ? id : store.settings.audioInputDeviceId, kind === 'audiooutput' ? id : store.settings.audioOutputDeviceId)
    const list = devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    return [
      { kind: 'label', text: kind === 'audioinput' ? 'Input device' : 'Output device' },
      { kind: 'item', label: 'System default', checked: !chosen, onClick: () => pick(null) },
      ...list.map((d, i) => ({ kind: 'item', label: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speakers'} ${i + 1}`, checked: chosen === d.deviceId, onClick: () => pick(d.deviceId) } as MenuEntry)),
      ...(kind === 'audioinput' ? [
        { kind: 'sep' } as MenuEntry,
        { kind: 'label', text: 'Send my microphone' } as MenuEntry,
        { kind: 'item', label: 'While I talk (voice activity)', checked: store.settings.voiceMode !== 'push', onClick: () => store.updateSettings({ voiceMode: 'activity' }) } as MenuEntry,
        { kind: 'item', label: `While I hold ${(store.settings.pushKey ?? DEFAULT_PUSH_KEY).label} (push to talk)`, checked: store.settings.voiceMode === 'push', onClick: () => store.updateSettings({ voiceMode: 'push' }) } as MenuEntry,
        ...(store.settings.voiceMode !== 'push' ? [{ kind: 'item', label: 'Only send my voice while I talk', checked: store.settings.voiceGate !== false, onClick: () => store.updateSettings({ voiceGate: store.settings.voiceGate === false }) } as MenuEntry] : []),
        ...(store.settings.voiceMode !== 'push' && store.settings.voiceGate !== false ? [{ kind: 'slider', label: 'How loud counts as talking', min: 1, max: 10, step: 1, value: store.settings.voiceGateLevel ?? DEFAULT_GATE_LEVEL, format: (v: number) => (v <= 2 ? v + ' · a whisper' : v >= 8 ? v + ' · a raised voice' : String(v)), onChange: (v: number) => store.updateSettings({ voiceGateLevel: v }) } as MenuEntry] : []),
      ] : []),
      ...(kind === 'audiooutput' ? [{ kind: 'slider', label: 'Output volume', min: 0, max: 100, step: 5, value: Math.round((store.settings.outputVolume ?? 1) * 100), format: (v: number) => v + '%', onChange: (v: number) => store.updateSettings({ outputVolume: v / 100 }) } as MenuEntry] : []),
      { kind: 'sep' },
      { kind: 'item', label: 'Voice settings', icon: '⚙', onClick: () => setDialog({ kind: 'audio' }) },
    ]
  }
  const colorOf = (userId: string) => (g ? roleColor(userId, g) : undefined)

  const [inviteBase, setInviteBase] = useState<string | null>(null)
  useEffect(() => { void store.api.meta(store.settings.serverUrl).then(meta => setInviteBase(meta?.inviteBase ?? null)) }, [store.api, store.settings.serverUrl])

  // ---- Right-click menus ------------------------------------------------------
  // What they change about other people and servers is yours alone and kept on this device; nobody is told.
  const [menu, setMenu] = useState<({ kind: 'guild'; guildId: string } | { kind: 'user'; userId: string; username: string } | { kind: 'channel'; channelId: string; name: string; direct: boolean; voice: boolean } | { kind: 'group'; channelId: string; name: string } | { kind: 'status' } | { kind: 'mic' } | { kind: 'speaker' } | { kind: 'stats' } | { kind: 'folder'; folderId: string }) & { x: number; y: number } | null>(null)
  /** Microphones and speakers, looked up each time one of the little menus beside the mute buttons opens. */
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const openPanelMenu = (e: React.MouseEvent, kind: 'status' | 'mic' | 'speaker') => {
    e.preventDefault(); e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (kind !== 'status') void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => setDevices([]))
    setMenu({ kind, x: box.left, y: box.top - 8 })
  }
  const openGuildMenu = (e: React.MouseEvent, guildId: string) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'guild', guildId, x: e.clientX, y: e.clientY }) }
  const openUserMenu = (e: React.MouseEvent, userId: string, username: string) => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'user', userId, username, x: e.clientX, y: e.clientY }) }
  /** The profile card shown when you click someone. */
  const [card, setCard] = useState<{ userId: string; name: string; x: number; y: number } | null>(null)
  const openCard = (e: React.MouseEvent, userId: string, name: string) => { e.stopPropagation(); setCard({ userId, name, x: e.clientX + 12, y: e.clientY - 40 }) }
  const serverUrl = store.settings.serverUrl
  const mine = me ? store.appearanceOf(me.id) : null
  /** What to call a member here: their nickname on this server, else the name they chose, else their username. */
  const memberName = (m: MemberDto) => m.nickname || m.displayName || m.username
  const nameIn = (userId: string, fallback: string) => {
    const m = g?.members.find(x => x.userId === userId)
    if (m) return memberName(m)
    const known = store.appearanceOf(userId)
    return known ? shownName(known) : fallback
  }
  const prefsOf = (userId: string) => store.settings.users?.[userId] ?? {}
  const ignored = (userId: string) => !!prefsOf(userId).ignored || store.blocked.some(u => u.id === userId)
  const requests = store.friends.incoming.filter(f => !ignored(f.user.id))

  const guildEntries = (guildId: string): MenuEntry[] => {
    const x = store.guilds.find(y => y.guild.id === guildId)
    if (!x) return []
    const prefs = store.settings.guilds?.[guildId] ?? {}
    const level: NotifyLevel = prefs.notify ?? DEFAULT_NOTIFY
    const allowed = (p: number) => hasPermission(x.myPermissions, p)
    const hasUnread = x.unread > 0 || Object.values(x.channelUnread).some(n => n > 0)
    const notify = (to: NotifyLevel, label: string): MenuEntry => ({ kind: 'item', label, checked: level === to, onClick: () => store.setGuildPrefs(guildId, { notify: to }) })
    const open = (kind: 'server' | 'leaveGuild') => () => { store.selectGuild(guildId); setDialog({ kind }) }
    return [
      { kind: 'label', text: x.guild.name },
      { kind: 'item', label: 'Mark as read', disabled: !hasUnread, onClick: () => store.markGuildRead(guildId) },
      ...(folderOf(guildId)
        ? [{ kind: 'item', label: `Take out of "${folderOf(guildId)!.name}"`, icon: '📁', onClick: () => moveToFolder(guildId, null) } as MenuEntry]
        : folders.map(f => ({ kind: 'item', label: `Put in "${f.name}"`, icon: '📁', onClick: () => moveToFolder(guildId, f.id) } as MenuEntry))),
      ...(allowed(Permission.CreateInvites) ? [{ kind: 'item', label: 'Invite people', icon: '✉', onClick: () => { void store.createInvite(guildId) } } as MenuEntry] : []),
      ...(me ? [{ kind: 'item', label: 'Change nickname', onClick: () => { store.selectGuild(guildId); setDialog({ kind: 'nickname', guildId, userId: me.id }) } } as MenuEntry] : []),
      { kind: 'sep' },
      { kind: 'item', label: 'Mute server', checked: !!prefs.muted, onClick: () => store.setGuildPrefs(guildId, { muted: !prefs.muted }) },
      { kind: 'label', text: 'Desktop notifications' },
      notify('all', 'All messages'),
      notify('mentions', 'Only @mentions'),
      notify('none', 'Nothing'),
      { kind: 'sep' },
      ...(allowed(Permission.ManageGuild) || allowed(Permission.ManageRoles) || allowed(Permission.ManageWebhooks) ? [{ kind: 'item', label: 'Server settings', icon: '⚙', onClick: open('server') } as MenuEntry] : []),
      { kind: 'item', label: x.guild.ownerId === me?.id ? 'Delete server' : 'Leave server', icon: '⎋', danger: true, onClick: open('leaveGuild') },
    ]
  }

  const userEntries = (userId: string, username: string): MenuEntry[] => {
    if (userId === me?.id) {
      const at = menu ?? { x: 200, y: 200 }
      return [
        { kind: 'label', text: username + ' (you)' },
        { kind: 'item', label: 'View profile', icon: '👤', onClick: () => setCard({ userId, name: username, x: at.x, y: at.y }) },
        { kind: 'item', label: 'Edit profile', icon: '✎', onClick: () => setDialog({ kind: 'profile' }) },
        ...(g ? [{ kind: 'item', label: 'Change nickname on ' + g.guild.name, onClick: () => setDialog({ kind: 'nickname', guildId: g.guild.id, userId }) } as MenuEntry] : []),
        { kind: 'sep' },
        { kind: 'item', label: 'Audio & privacy', icon: '🎧', onClick: () => setDialog({ kind: 'audio' }) },
      ]
    }
    const prefs = prefsOf(userId)
    const member = g?.members.find(m => m.userId === userId) ?? null
    const isBot = !!member?.isBot
    const isFriend = store.friends.friends.some(f => f.user.id === userId)
    const theyAsked = store.friends.incoming.some(f => f.user.id === userId)
    const iAsked = store.friends.outgoing.some(f => f.user.id === userId)
    const at = menu ?? { x: 200, y: 200 }
    const entries: MenuEntry[] = [
      { kind: 'label', text: username + (isBot ? ' · bot' : '') },
      { kind: 'item', label: 'View profile', icon: '👤', onClick: () => setCard({ userId, name: username, x: at.x, y: at.y }) },
    ]
    if (!isBot) {
      entries.push({ kind: 'item', label: 'Message', icon: '💬', onClick: () => { void store.openDm(userId) } })
      // Calls are between friends. An ordinary call goes through the relay; a P2P one is asked for by name and confirmed.
      if (isFriend && !store.call) {
        entries.push({ kind: 'item', label: 'Call', icon: '📞', onClick: () => { void store.startCall(userId, false) } })
        if (store.allowDirect) entries.push({ kind: 'item', label: 'P2P call…', icon: '📞', onClick: () => setDialog({ kind: 'p2pCall', userId, name: username }) })
      }
      entries.push(isFriend ? { kind: 'item', label: 'Remove friend', onClick: () => { void store.removeFriend(userId) } }
        : theyAsked ? { kind: 'item', label: 'Accept friend request', icon: '➕', onClick: () => { void store.addFriend(userId) } }
        : iAsked ? { kind: 'item', label: 'Cancel friend request', onClick: () => { void store.removeFriend(userId) } }
        : { kind: 'item', label: 'Add friend', icon: '➕', onClick: () => { void store.addFriend(userId) } })
      // Servers of ours they are not in, where we may make invites.
      const invitable = store.guilds.filter(x => hasPermission(x.myPermissions ?? 0, Permission.CreateInvites) && !x.members.some(m => m.userId === userId))
      if (invitable.length > 0) {
        entries.push({
          kind: 'submenu', label: 'Invite to server',
          entries: invitable.map(x => ({ kind: 'item' as const, label: x.guild.name, onClick: () => { void store.inviteToServer(x.guild.id, userId) } })),
        })
      }
      entries.push({ kind: 'sep' })
      entries.push({ kind: 'item', label: 'Mute their voice', checked: !!prefs.muted, onClick: () => store.setUserPrefs(userId, { muted: !prefs.muted }) })
      entries.push({ kind: 'slider', label: 'Voice volume', min: 0, max: 200, step: 5, value: Math.round((prefs.volume ?? 1) * 100), format: v => v + '%', onChange: v => store.setUserPrefs(userId, { volume: v / 100 }) })
    }
    entries.push({ kind: 'item', label: 'Ignore', checked: !!prefs.ignored, onClick: () => store.setUserPrefs(userId, { ignored: !prefs.ignored }) })
    const isBlocked = store.blocked.some(u => u.id === userId)
    if (!isBot) entries.push({ kind: 'item', label: isBlocked ? 'Unblock' : 'Block', icon: '🚫', danger: !isBlocked, onClick: () => { void store.setBlocked(userId, !isBlocked) } })
    entries.push({ kind: 'item', label: 'Copy user ID', icon: '🆔', onClick: () => { void navigator.clipboard.writeText(userId) } })
    if (member && g && userId !== g.guild.ownerId && can(Permission.ManageGuild)) {
      entries.push({ kind: 'sep' })
      entries.push({ kind: 'item', label: 'Change nickname', onClick: () => setDialog({ kind: 'nickname', guildId: g.guild.id, userId }) })
    }
    // Roles, for people who may manage them: tick to give one, untick to take it away. Only roles below one's own
    // highest can be changed; the server holds to the same rule.
    if (member && g && can(Permission.ManageRoles)) {
      const all = (g.roles ?? []).filter(r => !r.isEveryone).sort((a, b) => b.position - a.position)
      const mine = g.members.find(m => m.userId === me?.id)?.roleIds ?? []
      const top = g.guild.ownerId === me?.id ? Infinity : Math.max(0, ...all.filter(r => mine.includes(r.id)).map(r => r.position))
      const held = member.roleIds ?? []
      if (all.length > 0) {
        if (entries[entries.length - 1]?.kind !== 'item' || !/nickname/.test((entries[entries.length - 1] as { label?: string }).label ?? '')) entries.push({ kind: 'sep' })
        entries.push({
          kind: 'submenu', label: 'Roles',
          entries: all.map(r => ({
            kind: 'item' as const, label: r.name, checked: held.includes(r.id), disabled: r.position >= top,
            onClick: () => { void store.setMemberRoles(userId, held.includes(r.id) ? held.filter(x => x !== r.id) : [...held, r.id]) },
          })),
        })
      }
    }
    // Muting someone in this server's voice channels, for someone who may mute members. It holds until it is undone.
    if (member && g && !isBot && userId !== me?.id && userId !== g.guild.ownerId && can(Permission.MuteMembers)) {
      entries.push({ kind: 'sep' })
      entries.push({ kind: 'item', label: 'Mute in voice channels', checked: !!member.voiceMuted, onClick: () => { void store.setVoiceMuted(g.guild.id, userId, !member.voiceMuted) } })
    }
    // The voice channel they are in on this server, for someone who may take people out of voice.
    const inVoice = g && can(Permission.DisconnectMembers) ? Object.entries(g.voice ?? {}).find(([, people]) => people.some(p => p.userId === userId))?.[0] : undefined
    const mayRemove = !isBot && (can(Permission.KickMembers) || can(Permission.BanMembers))
    if (member && g && userId !== g.guild.ownerId && (mayRemove || inVoice)) {
      entries.push({ kind: 'sep' })
      if (inVoice) entries.push({ kind: 'item', label: 'Disconnect from voice', danger: true, onClick: () => { void store.disconnectMember(inVoice, userId) } })
      if (!mayRemove) return entries
      if (can(Permission.KickMembers)) entries.push({ kind: 'item', label: 'Kick from ' + g.guild.name, danger: true, onClick: () => setDialog({ kind: 'kick', member }) })
      if (can(Permission.BanMembers)) entries.push({ kind: 'item', label: 'Ban from ' + g.guild.name, danger: true, onClick: () => setDialog({ kind: 'ban', member }) })
    }
    return entries
  }
  const dmUnreadTotal = Object.values(store.dmUnread).reduce((a, b) => a + b, 0) + requests.length
  const s = store.stats
  // The member list shows the people of the channel being read: those who can see it. With no channel open, everyone
  // but the P2P bots, which are only ever in particular channels.
  const inChannel = g && store.selectedChannel?.guildId === g.guild.id ? g.channels.find(c => c.id === store.selectedChannel?.id) ?? null : null
  const listed = useMemo(() => (!g ? [] : inChannel ? channelMembers(g, inChannel) : g.members.filter(m => !m.directBot)), [g, inChannel])

  /** Voice channel click: join (if not already there) and open its chat. */
  const openVoice = (channelId: string) => {
    store.selectChannel(channelId)
    if (voice?.channelId !== channelId) void store.joinVoice(channelId)
  }

  return (
    <div className={'shell pane-' + pane} style={{ '--sidebar-w': columns.sidebar + 'px', '--members-w': columns.members + 'px' } as React.CSSProperties}>
      {/* Only shown on a phone: the way between the three panes. */}
      <div className="mobilebar">
        {/* Each button opens its panel, and pressed again puts the conversation back. */}
        <button className={pane === 'list' ? 'accent' : ''} onClick={() => setPane(pane === 'list' ? 'chat' : 'list')} title={pane === 'list' ? 'Back to the conversation' : 'Servers and channels'}><Menu size={18} /></button>
        <span className="grow title" onClick={() => setPane('chat')}>{store.selectedChannel ? (store.selectedChannel.type === ChannelType.DirectMessage ? '@' : '#') + store.selectedChannel.name : 'Maplecord'}</span>
        <button className={pane === 'people' ? 'accent' : ''} onClick={() => setPane(pane === 'people' ? 'chat' : 'people')} title={pane === 'people' ? 'Back to the conversation' : store.home ? 'Friends' : 'Members'}><Users size={18} /></button>
      </div>
      {/* ===== Guild rail ===== */}
      <div className="rail" onDragOver={allowDrop} onDrop={e => { const id = dragged(e); if (id) { e.preventDefault(); moveToFolder(id, null) } }}>
        <button className={'guild home' + (store.home ? ' active' : '')} title="Friends & direct messages" onClick={store.openHome}>
          <img className="logo" src={import.meta.env.BASE_URL + 'logo.png'} alt="Home" draggable={false} />{dmUnreadTotal > 0 && <span className="badge">{dmUnreadTotal}</span>}
        </button>
        <div className="sep" />
        {(() => {
          const serverButton = (x: (typeof store.guilds)[number]) => (
            <button key={x.guild.id} draggable className={'guild' + (x.guild.id === g?.guild.id ? ' active' : '') + (store.settings.guilds?.[x.guild.id]?.muted ? ' muted' : '')}
              title={x.guild.name + (store.settings.guilds?.[x.guild.id]?.muted ? ' (muted)' : '') + ' — right-click for options · drag onto another server to make a folder'}
              onClick={() => store.selectGuild(x.guild.id)} onContextMenu={e => openGuildMenu(e, x.guild.id)}
              onDragStart={e => { e.dataTransfer.setData(DRAG, x.guild.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={allowDrop} onDrop={e => { const id = dragged(e); if (id) { e.preventDefault(); e.stopPropagation(); dropOnGuild(id, x.guild.id) } }}>
              {x.guild.iconUrl ? <img src={x.guild.iconUrl} alt="" draggable={false} /> : initials(x.guild.name)}
              {x.unread > 0 && <span className="badge">{x.unread}</span>}
            </button>
          )
          // A folder is drawn where its first server would be; servers in no folder stay where they were.
          const drawn = new Set<string>()
          return store.guilds.map(x => {
            const f = folderOf(x.guild.id)
            if (!f) return serverButton(x)
            if (drawn.has(f.id)) return null
            drawn.add(f.id)
            const inside = store.guilds.filter(y => f.guildIds.includes(y.guild.id))
            const unread = inside.reduce((n, y) => n + y.unread, 0)
            return (
              <div key={f.id} className={'folder' + (f.open ? ' open' : '')} onDragOver={allowDrop}
                onDrop={e => { const id = dragged(e); if (id) { e.preventDefault(); e.stopPropagation(); moveToFolder(id, f.id) } }}>
                <button className={'folderhead' + (!f.open && inside.some(y => y.guild.id === g?.guild.id) ? ' active' : '')}
                  title={f.name + (f.open ? ' — click to close' : ' — click to open') + ' · right-click for options'}
                  onClick={() => saveFolders(folders.map(y => (y.id === f.id ? { ...y, open: !y.open } : y)))}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'folder', folderId: f.id, x: e.clientX, y: e.clientY }) }}>
                  {/* No folder picture: the first four servers in it, small. */}
                  <span className="mini">
                    {inside.slice(0, 4).map(y => (y.guild.iconUrl ? <img key={y.guild.id} src={y.guild.iconUrl} alt="" draggable={false} /> : <i key={y.guild.id}>{initials(y.guild.name)}</i>))}
                  </span>
                  {!f.open && unread > 0 && <span className="badge">{unread}</span>}
                </button>
                {f.open && inside.map(serverButton)}
              </div>
            )
          })
        })()}
        <div className="spacer" />
        <button className="guild add" title="Add a server" aria-label="Add a server" onClick={() => setDialog({ kind: 'addGuild' })}><Plus size={22} /></button>
      </div>

      {/* ===== Channels (or DMs) + user panel ===== */}
      <div className="sidebar" onClick={e => { if ((e.target as HTMLElement).closest('.channel')) setPane('chat') }}>
        {store.home ? (
          <>
            <div className={'header serverheader' + (serverMenu ? ' open' : '')} title="Settings"
              onClick={() => setServerMenu(open => !open)} onContextMenu={e => { e.preventDefault(); setServerMenu(true) }}>
              <span className="grow">Direct messages</span>
              <span className="chevron">{serverMenu ? '✕' : '▾'}</span>
            </div>
            {serverMenu && (() => {
              const pick = (action: () => void) => () => { setServerMenu(false); action() }
              return (
                <>
                  <div className="menubackdrop" onClick={() => setServerMenu(false)} onContextMenu={e => { e.preventDefault(); setServerMenu(false) }} />
                  <div className="menu servermenu" role="menu">
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'plugins' }))}><span>Game plugins</span><span className="ico">🧩</span></button>
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'overlay' }))}><span>Overlay settings</span><span className="ico">🎲</span></button>
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'audio' }))}><span>Audio &amp; privacy</span><span className="ico">🎧</span></button>
                  </div>
                </>
              )
            })()}
            <div className="channels">
              <div className={'dm' + (!store.selectedChannel ? ' active' : '')} onClick={store.openHome}>
                <span>👥</span><span className="grow">Friends</span>
                {requests.length > 0 && <span className="badge">{requests.length}</span>}
              </div>
              <div className="category">Messages</div>
              {store.dms.map(d => (
                <div key={d.channelId} className={'dm' + (d.channelId === store.selectedChannel?.id ? ' active' : '')} onClick={() => store.selectChannel(d.channelId)} onContextMenu={e => openUserMenu(e, d.other.id, shownName(d.other))}>
                  <Avatar who={d.other} name={shownName(d.other)} serverUrl={serverUrl} size={24} />
                  <span className={'presence' + (d.online ? ' online' : '')} />
                  <span className="grow nameline" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: (store.dmUnread[d.channelId] ?? 0) > 0 ? 600 : undefined }}><UserName who={store.appearanceOf(d.other.id)} label={shownName(d.other)} /></span>
                  {(store.dmUnread[d.channelId] ?? 0) > 0 && <span className="badge">{store.dmUnread[d.channelId]}</span>}
                </div>
              ))}
              {store.dms.length === 0 && <div className="muted" style={{ padding: '6px 16px' }}>Message a friend to start a conversation.</div>}
            </div>
          </>
        ) : (
          <>
            {/* Left- or right-click the server name for everything you can do with this server. */}
            <div className={'header serverheader' + (serverMenu ? ' open' : '')} title={g ? 'Server menu' : undefined}
              onClick={() => g && setServerMenu(open => !open)} onContextMenu={e => { e.preventDefault(); if (g) setServerMenu(true) }}>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g?.guild.name ?? 'No server'}</span>
              {g && <span className="chevron">{serverMenu ? '✕' : '▾'}</span>}
            </div>
            {serverMenu && g && (() => {
              const pick = (action: () => void) => () => { setServerMenu(false); action() }
              const owner = g.guild.ownerId === me?.id
              const settings = can(Permission.ManageGuild) || can(Permission.ManageRoles) || can(Permission.ManageWebhooks)
              return (
                <>
                  <div className="menubackdrop" onClick={() => setServerMenu(false)} onContextMenu={e => { e.preventDefault(); setServerMenu(false) }} />
                  <div className="menu servermenu" role="menu">
                    {can(Permission.CreateInvites) && <button role="menuitem" className="item accent" onClick={pick(() => { void store.createInvite() })}><span>Invite people</span><span className="ico">✉</span></button>}
                    {settings && <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'server' }))}><span>Server settings</span><span className="ico">⚙</span></button>}
                    {can(Permission.ManageChannels) && <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'createChannel' }))}><span>Create channel</span><span className="ico">＋</span></button>}
                    {can(Permission.ManageChannels) && <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'createChannel', category: true }))}><span>Create category</span><span className="ico">📁</span></button>}
                    {!settings && !can(Permission.ManageChannels) && <div className="note">Server settings, roles and channels are managed by members with the Manage Server, Manage Roles or Manage Channels permission.</div>}
                    {me && <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'nickname', guildId: g.guild.id, userId: me.id }))}><span>Change nickname</span><span className="ico">✎</span></button>}
                    <div className="sep" />
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'plugins' }))}><span>Game plugins</span><span className="ico">🧩</span></button>
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'overlay' }))}><span>Overlay settings</span><span className="ico">🎲</span></button>
                    <button role="menuitem" className="item" onClick={pick(() => setDialog({ kind: 'audio' }))}><span>Audio &amp; privacy</span><span className="ico">🎧</span></button>
                    <div className="sep" />
                    <button role="menuitem" className="item danger" onClick={pick(() => setDialog({ kind: 'leaveGuild' }))}><span>{owner ? 'Delete server' : 'Leave server'}</span><span className="ico">⎋</span></button>
                  </div>
                </>
              )
            })()}
            <div className="channels">
              {g && channelRows(g.channels).filter(c => !c.parentId || !collapsedGroups[c.parentId] || c.type === ChannelType.Category
                || c.id === store.selectedChannel?.id || c.id === voice?.channelId || (g.channelUnread[c.id] ?? 0) > 0 || (g.voice?.[c.id]?.length ?? 0) > 0).map(c => c.type === ChannelType.Category
                ? <div key={c.id} className={'category' + (dropOn === c.id ? ' dropon' : '')}
                    role="button" tabIndex={0} aria-expanded={!collapsedGroups[c.id]}
                    onClick={() => toggleGroup(c.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(c.id) } }}
                    title={can(Permission.ManageChannels) ? 'Click to fold or unfold. Drag to reorder the groups. Drop a channel here to move it into this group. Right-click to choose who can see it.' : 'Click to fold or unfold'}
                    onContextMenu={can(Permission.ManageChannels) ? e => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'group', channelId: c.id, name: c.name, x: e.clientX, y: e.clientY }) } : undefined}
                    {...(can(Permission.ManageChannels) ? channelDrag(c.id, true, (dragged, isGroup) => void store.moveChannel(dragged, isGroup ? null : c.id, isGroup ? c.id : null)) : {})}>
                    {collapsedGroups[c.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>{c.name}</span>{c.directSince && <span className="p2ptag">P2P</span>}</div>
                : (
                  <div key={c.id}>
                    <div
                      className={'channel' + (c.id === store.selectedChannel?.id ? ' active' : '') + ((g.channelUnread[c.id] ?? 0) > 0 ? ' unread' : '') + (c.directSince ? ' p2p' : '') + (store.settings.mutedChannels?.[c.id] ? ' mutedchannel' : '') + (dropOn === c.id ? ' dropon' : '')}
                      {...(can(Permission.ManageChannels) ? channelDrag(c.id, false, dragged => void store.moveChannel(dragged, c.parentId ?? null, c.id)) : {})}
                      style={c.id === voice?.channelId ? { color: 'var(--green)' } : undefined}
                      title={c.type !== ChannelType.Voice ? undefined : c.directSince
                        ? 'P2P voice channel: people in it connect straight to each other and can find each other\u2019s IP address. Click to join (you are asked first).'
                        : 'Click to join voice and open its chat'}
                      onClick={() => c.type === ChannelType.Text ? store.selectChannel(c.id) : openVoice(c.id)}
                      onContextMenu={e => {
                        e.preventDefault()
                        if (c.directSince) loadChannelBots(c.id)
                        setMenu({ kind: 'channel', channelId: c.id, name: c.name, direct: !!c.directSince, voice: c.type === ChannelType.Voice, x: e.clientX, y: e.clientY })
                      }}>
                      <span className="muted">{c.type === ChannelType.Text ? '#' : '🔊'}</span>
                      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      {c.directSince && <span className="p2ptag">P2P</span>}
                      {store.settings.mutedChannels?.[c.id] && <span className="muted" title="Muted">🔕</span>}
                      {(g.channelUnread[c.id] ?? 0) > 0 && <span className="badge">{g.channelUnread[c.id]}</span>}
                    </div>
                    {c.type === ChannelType.Voice && (() => {
                      // Live state for the channel I'm in (speaking, connection); the server's roster for every other one.
                      const roster = voice?.channelId === c.id ? voice.participants : (g.voice?.[c.id] ?? []).map(p => ({ ...p, state: '', speaking: false }))
                      return roster.length > 0 && (
                        <div className="voice-users">
                          {roster.map(p => (
                            <div key={p.connectionId} className={'u' + (p.userId === me?.id ? ' me' : '')} title="Right-click for volume and more" onContextMenu={e => openUserMenu(e, p.userId, p.username)}>
                              <span className={'dot' + (p.speaking ? ' speaking' : '')} />
                              <UserName who={store.appearanceOf(p.userId)} label={nameIn(p.userId, p.username)} roleColor={p.speaking ? '#ffffff' : colorOf(p.userId)} onClick={e => openCard(e, p.userId, p.username)} />
                              {p.stream && (() => {
                                // In my own channel a LIVE badge is a button: watch it, or stop watching.
                                const mineHere = voice?.channelId === c.id
                                const isMe = p.connectionId === voice?.participants.find(x => x.userId === me?.id)?.connectionId
                                const on = store.watching.some(w => w.streamer === p.connectionId)
                                const count = store.viewerCounts[p.connectionId]
                                const what = p.stream === 'camera' ? 'camera' : p.stream === 'screen' ? 'screen' : 'app'
                                return mineHere && !isMe
                                  ? <button className={'livebadge' + (on ? ' on' : '')} title={on ? 'Stop watching' : `Watch their ${what}${count ? ` (${count} watching)` : ''}`}
                                      onClick={() => void (on ? store.unwatchStream(p.connectionId) : store.watchStream(p.connectionId))}>{on ? 'WATCHING' : 'LIVE'}</button>
                                  : <span className="livebadge still" title={mineHere ? `You are sharing your ${what}` : `Sharing their ${what}. Join the channel to watch.`}>LIVE</span>
                              })()}
                              {p.silenced
                                ? <span title={g.members.find(m => m.userId === p.userId)?.voiceMuted ? 'Muted by a moderator' : 'May not speak in this channel'}>🚫</span>
                                : p.muted && <span title="Microphone muted">🔇</span>}
                              {p.userId !== me?.id && prefsOf(p.userId).muted && <span title="You muted them">🔕</span>}
                              {voice?.channelId === c.id && p.userId !== me?.id && p.state !== 'connected' && <span style={{ fontSize: 10 }}>{p.state}</span>}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                ))}
            </div>
          </>
        )}

      </div>

      {/* ===== Yourself: voice, mute, settings. Spans the server rail and the channel list ===== */}
      <div className="userpanel">
        {voice && (
          <div className={'voicebox' + (voice.directSince ? ' p2p' : '')}>
            <span className="signal">{inCall ? <Phone size={16} /> : <Signal size={16} />}</span>
            <div className="grow vtext" title={(voiceGuild ? voiceGuild + ' / ' : '') + voiceChannelName + (voiceDetail ? ' · ' + voiceDetail : '')}>
              <div className="vstate">{voice.directSince ? (voice.policy === 'relay' ? 'P2P · through the relay' : 'P2P · using your IP') : inCall ? (inCall.phase === 'calling' ? 'Calling…' : 'In a call') : 'Voice connected'}</div>
              <div className="muted vwhere">{voiceGuild ? voiceGuild + ' / ' : ''}{voiceChannelName}{voiceDetail ? ' · ' + voiceDetail : ''}</div>
            </div>
            <button className={'iconbtn' + (store.sharing === 'camera' ? ' on' : '')} onClick={() => void toggleCamera()} title={store.sharing === 'camera' ? 'Turn your camera off' : 'Turn your camera on'}><Video size={17} /></button>
            <button className={'iconbtn' + (screenSharing ? ' on' : '')} disabled={!canShareScreen && !screenSharing}
              title={screenSharing ? 'Stop sharing' : canShareScreen ? 'Share an app or a screen' : 'This browser cannot share its screen. Your camera can still be shared.'}
              onClick={() => { if (screenSharing) void store.stopShare(); else { void store.loadStreamRules().catch(() => null); setDialog({ kind: 'share' }) } }}><MonitorUp size={17} /></button>
            <button className="iconbtn hangup" onClick={store.leaveVoice} title={inCall ? (inCall.phase === 'calling' ? 'Cancel the call' : 'Hang up') : 'Disconnect'}><PhoneOff size={17} /></button>
          </div>
        )}
        <div className="selfbar" style={selfStyle}>
          <div className="who" title="Status, profile and more" onClick={e => openPanelMenu(e, 'status')} onContextMenu={e => me && openUserMenu(e, me.id, shownName(me))}>
            <span className="avatarwrap">
              <Avatar who={mine} name={me ? shownName(me) : '?'} serverUrl={serverUrl} size={34} animate="always" speaking={store.isSpeaking} />
              <span className={'statusdot ' + (store.status === 'Connected' ? myStatus.dot : 'invisible')} />
            </span>
            <div className="grow self">
              <div className="selfname"><UserName who={mine} label={me ? nameIn(me.id, shownName(me)) : ''} /></div>
              <div className="muted">{store.status === 'Connected' ? myStatus.label : store.status}</div>
            </div>
          </div>
          <span className="controls">
          <span className="split">
            {silencedHere
              ? <button className="iconbtn off" disabled title={myMember?.voiceMuted ? 'A moderator muted you in this server\'s voice channels. You can listen, and nobody hears you.' : 'You may not speak in this channel. You can listen, and nobody hears you.'}><MicOff size={17} /></button>
              : <button className={'iconbtn' + (store.isMuted ? ' off' : '')} onClick={store.toggleMute} title={store.isMuted ? 'Unmute your microphone' : 'Mute your microphone'}>{store.isMuted ? <MicOff size={17} /> : <Mic size={17} />}</button>}
            <button className="caret" onClick={e => openPanelMenu(e, 'mic')} title="Choose a microphone"><ChevronDown size={12} /></button>
          </span>
          <span className="split">
            <button className={'iconbtn' + (store.deafened ? ' off' : '')} onClick={store.toggleDeafen} title={store.deafened ? 'Hear people again' : 'Stop hearing everyone'}>{store.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}</button>
            <button className="caret" onClick={e => openPanelMenu(e, 'speaker')} title="Choose speakers and volume"><ChevronDown size={12} /></button>
          </span>
          <button className="iconbtn" onClick={() => setDialog({ kind: 'settings' })} title="Settings"><SettingsIcon size={17} /></button>
          </span>
        </div>
        <div className="statsline" title="Your roll stats · right-click for options"
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ kind: 'stats', x: e.clientX, y: e.clientY }) }}>
          <span>Avg {s.totalRolls ? (s.rollSum / s.totalRolls).toFixed(1) : '0.0'}</span>
          <span>W/L {s.losses ? (s.wins / s.losses).toFixed(2) : s.wins}</span>
          <span>100s {s.perfect100s}</span>
          <span>1s {s.ones}</span>
          <span>Rolls {s.totalRolls}</span>
        </div>
      </div>

      {/* ===== Chat / friends ===== */}
      {store.home && !store.selectedChannel
        ? <Friends store={store} />
        : <Chat store={store} openRollDialog={(rollKind: RollKind) => setDialog({ kind: 'startRoll', rollKind })} canRoll={g ? can(Permission.StartRolls) : !!store.selectedDm} colorOf={colorOf}
          onCall={(userId, name, direct) => { if (direct) setDialog({ kind: 'p2pCall', userId, name }); else void store.startCall(userId, false) }} onUserMenu={openUserMenu} isIgnored={ignored} onUserCard={openCard} nameIn={nameIn} />}

      {/* The edges of the chat: dragged, they resize the column on their other side. */}
      {grip('sidebar')}{grip('members')}

      {/* ===== Members ===== */}
      <div className="members">
        {store.home ? (
          <>
            <div className="header">Friends <span className="muted">{store.friends.friends.filter(f => f.online).length} online</span></div>
            <div className="list">
              {[...store.friends.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.user.username.localeCompare(b.user.username)).map(f => (
                <div key={f.user.id} className={'member' + (f.online ? ' online' : ' offline') + (f.online && store.dndUsers.has(f.user.id) ? ' dnd' : '')} title="Click to message · right-click for options" onClick={() => store.openDm(f.user.id)} onContextMenu={e => openUserMenu(e, f.user.id, shownName(f.user))}>
                  <div className="row" style={{ gap: 0 }}><Avatar who={f.user} name={shownName(f.user)} serverUrl={serverUrl} size={28} /><div className="presence" /></div>
                  <div className="grow nameline" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><UserName who={store.appearanceOf(f.user.id)} label={shownName(f.user)} /></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="header" title={inChannel ? `The people who can see ${inChannel.name}` : undefined}>Members <span className="muted">{listed.filter(m => m.online).length} online</span></div>
            <div className="list">
              {g && [...listed].sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)).map(m => (
                <div key={m.userId} className={'member' + (m.online ? ' online' : ' offline') + (m.online && store.dndUsers.has(m.userId) ? ' dnd' : '') + (ignored(m.userId) ? ' ignoredmember' : '')} title={'@' + m.username + ' — click for profile, right-click for options'}
                  onClick={e => openCard(e, m.userId, memberName(m))} onContextMenu={e => openUserMenu(e, m.userId, memberName(m))}>
                  <div className="row" style={{ gap: 0 }}><Avatar who={m} name={memberName(m)} serverUrl={serverUrl} size={28} /><div className="presence" /></div>
                  <div className="grow" style={{ overflow: 'hidden' }}>
                    <div className="nameline" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><UserName who={store.appearanceOf(m.userId)} label={memberName(m)} roleColor={roleColor(m.userId, g)} /> {m.isBot && (m.directBot
                      // A P2P bot wears the colour P2P channels do.
                      ? <span className="p2ptag" title="A P2P bot: it is only in the P2P channels it was let into">BOT</span>
                      : <span className="tag" style={{ fontSize: 10, background: 'var(--accent)', borderRadius: 3, padding: '0 4px', color: '#fff' }}>BOT</span>)}</div>
                    <div className="role">{roleLabel(m, g)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {tagOpen && <TagCardDialog guildId={tagOpen} serverUrl={store.settings.serverUrl} load={store.tagCard} onJoin={store.joinPublicGuild} onClose={() => setTagOpen(null)} />}
      {dialog?.kind === 'createGuild' && <CreateServerDialog onCreate={(name, isPublic, kind) => void store.createGuild(name, isPublic, kind)} onClose={() => setDialog(null)} />}
      {store.deleteStep && <DeleteAccountDialog store={store} />}
      {store.pendingInvite && (
        <ConfirmDialog title={`Join ${store.pendingInvite.name}?`}
          message={`You followed an invite to ${store.pendingInvite.name} (${store.pendingInvite.members} ${store.pendingInvite.members === 1 ? 'member' : 'members'}).`}
          onConfirm={() => void store.acceptInvite()} onClose={store.dismissInvite} />
      )}
      {dialog?.kind === 'channelAccess' && g && g.channels.find(c => c.id === dialog.channelId) && (
        <ChannelAccessDialog api={store.api} channel={g.channels.find(c => c.id === dialog.channelId)!} roles={g.roles ?? []} members={g.members} onClose={() => setDialog(null)}
          group={g.channels.find(c => c.id === g.channels.find(x => x.id === dialog.channelId)?.parentId)}
          inside={g.channels.filter(c => c.parentId === dialog.channelId)} />
      )}
      {dialog?.kind === 'addGuild' && <AddServerDialog onCreate={() => setDialog({ kind: 'createGuild' })} onJoin={() => setDialog({ kind: 'joinGuild' })} onDiscover={() => setDialog({ kind: 'discover' })} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'joinGuild' && <JoinServerDialog example={inviteBase} onJoin={store.joinGuild} onBack={() => setDialog({ kind: 'addGuild' })} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'discover' && <DiscoverDialog api={store.api} onJoin={store.joinPublicGuild} onOpen={store.selectGuild} onBack={() => setDialog({ kind: 'addGuild' })} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'createChannel' && g && <CreateChannelDialog initialType={dialog.category ? ChannelType.Category : ChannelType.Text} categories={g.channels.filter(c => c.type === ChannelType.Category)} canDirect={can(Permission.ManageDirectChannels) && !g.guild.isPublic} onSubmit={store.createChannel} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'startRoll' && <StartRollDialog kind={dialog.rollKind} onSubmit={store.startRoll} onClose={() => setDialog(null)} searchItems={store.plugins.some(x => x.items.length > 0) ? store.searchItems : undefined} />}
      {dialog?.kind === 'plugins' && <PluginsDialog store={store} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'leaveGuild' && g && (
        <ConfirmDialog title={g.guild.ownerId === me?.id ? `Delete ${g.guild.name}?` : `Leave ${g.guild.name}?`}
          message={g.guild.ownerId === me?.id ? 'You own this server; leaving deletes it for everyone.' : 'You can rejoin with an invite.'}
          onConfirm={store.leaveGuild} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'profile' && <ProfileEditor store={store} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'nickname' && (() => {
        const where = store.guilds.find(x => x.guild.id === dialog.guildId)
        const target = where?.members.find(m => m.userId === dialog.userId)
        if (!where || !target) return null
        return <NicknameDialog who={target.userId === me?.id ? 'you are' : (target.displayName || target.username) + ' is'} serverName={where.guild.name} current={target.nickname}
          fallback={target.displayName || target.username} onSubmit={nick => store.setNickname(where.guild.id, target.userId, nick)} onClose={() => setDialog(null)} />
      })()}
      {card && (
        <ProfilePopout store={store} userId={card.userId} fallbackName={card.name} x={card.x} y={card.y} onClose={() => setCard(null)} onEdit={() => setDialog({ kind: 'profile' })}
          nickname={g?.members.find(m => m.userId === card.userId)?.nickname ?? null} serverName={g?.guild.name}
          roles={g ? (g.members.find(m => m.userId === card.userId)?.roleIds ?? []).map(id => g.roles?.find(r => r.id === id)).filter((r): r is RoleDto => !!r && !r.isEveryone).sort((a, b) => b.position - a.position) : undefined} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.kind === 'guild' ? guildEntries(menu.guildId) : menu.kind === 'user' ? userEntries(menu.userId, menu.username) : menu.kind === 'stats' ? rollEntries() : menu.kind === 'folder' ? folderEntries(menu.folderId) : menu.kind === 'status' ? statusEntries() : menu.kind === 'mic' ? deviceEntries('audioinput') : menu.kind === 'speaker' ? deviceEntries('audiooutput') : menu.kind === 'group' ? [
        { kind: 'label', text: menu.name },
        { kind: 'item', label: 'Who can see it', icon: '🔒', onClick: () => setDialog({ kind: 'channelAccess', channelId: menu.channelId }) },
        { kind: 'item', label: 'Delete group', icon: '🗑', danger: true, onClick: () => setDialog({ kind: 'deleteGroup', channelId: menu.channelId, name: menu.name }) },
      ] : [
        { kind: 'label', text: menu.name },
        { kind: 'item', label: 'Mute channel', icon: '🔕', checked: !!store.settings.mutedChannels?.[menu.channelId], onClick: () => store.setChannelMuted(menu.channelId, !store.settings.mutedChannels?.[menu.channelId]) },
        // A P2P channel: stay connected to it while the app is open, and whether to hand others what they missed.
        ...(menu.direct ? [
          { kind: 'item', label: 'Subscribe (stay connected)', checked: !!store.settings.p2pSubscribed?.[menu.channelId], onClick: () => store.setP2pSubscribed(menu.channelId, !store.settings.p2pSubscribed?.[menu.channelId]) } as MenuEntry,
          { kind: 'item', label: 'Send others what they missed', checked: !store.settings.p2pNoBroadcast?.[menu.channelId], onClick: () => store.setP2pBroadcast(menu.channelId, !!store.settings.p2pNoBroadcast?.[menu.channelId]) } as MenuEntry,
        ] : []),
        // The P2P bots added to this server, and which of them are let into this channel. Whoever decides which
        // channels are P2P decides this too; everyone else just sees the ones that are in.
        ...(menu.direct && (channelBots[menu.channelId]?.length ?? 0) > 0 ? [{
          kind: 'submenu', label: 'P2P bots',
          entries: channelBots[menu.channelId].map(b => ({
            kind: 'item' as const, label: b.name, checked: b.granted, disabled: !can(Permission.ManageDirectChannels),
            onClick: () => { void store.api.letBotIn(menu.channelId, b.applicationId, !b.granted).then(() => loadChannelBots(menu.channelId)).catch(e => store.setError(e instanceof Error ? e.message : String(e))) },
          })),
        } as MenuEntry] : []),
        // A public server has no P2P channels; one that somehow has can still be turned back into a relayed one.
        ...(menu.voice && can(Permission.ManageChannels) && can(Permission.ManageDirectChannels) && (menu.direct || !g?.guild.isPublic)
          ? [{ kind: 'item', label: menu.direct ? 'Make it a relayed channel' : 'Make it a P2P channel', icon: '⇄', onClick: () => setDialog({ kind: 'channelKind', channelId: menu.channelId, name: menu.name, direct: !menu.direct }) } as MenuEntry] : []),
        ...(can(Permission.ManageChannels) ? [
          { kind: 'sep' } as MenuEntry,
          { kind: 'item', label: 'Who can see it', icon: '🔒', onClick: () => setDialog({ kind: 'channelAccess', channelId: menu.channelId }) } as MenuEntry,
          { kind: 'item', label: 'Rename channel', icon: '✎', onClick: () => setDialog({ kind: 'renameChannel', channelId: menu.channelId, name: menu.name }) } as MenuEntry,
          { kind: 'item', label: 'Delete channel', icon: '🗑', danger: true, onClick: () => setDialog({ kind: 'deleteChannel', channelId: menu.channelId, name: menu.name }) } as MenuEntry,
        ] : []),
      ]} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'kick' && <ConfirmDialog title={`Kick ${dialog.member.username}?`} message="They can rejoin with an invite." onConfirm={() => store.kickMember(dialog.member)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'ban' && <BanDialog name={dialog.member.username} onBan={deleteDays => store.banMember(dialog.member, deleteDays)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'share' && <SharePicker store={store} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'allowDirect' && <AllowDirectStep store={store} onClose={() => setDialog({ kind: 'audio' })} />}
      {dialog?.kind === 'channelKind' && (
        <ConfirmDialog title={dialog.direct ? `Make ${dialog.name} a P2P channel?` : `Make ${dialog.name} a relayed channel?`}
          message={dialog.direct
            ? 'People in it will connect straight to each other and be able to find each other\u2019s IP address. Everyone in the call now is taken out of it; to come back they must allow P2P and accept a warning.'
            : 'It becomes an ordinary voice channel again. Everyone in the call now is taken out of it and can simply rejoin.'}
          onConfirm={() => void store.setChannelDirect(dialog.channelId, dialog.direct)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'p2pCall' && <P2PCallDialog name={dialog.name} onCall={() => void store.startCall(dialog.userId, true)} onClose={() => setDialog(null)} />}
      {store.call?.phase === 'incoming' && (
        <IncomingCallDialog name={store.call.otherName} direct={store.call.direct} allowed={!store.call.direct || store.allowDirect}
          onAnswer={() => void store.answerCall()} onDecline={() => void store.declineCall()} onSettings={() => setDialog({ kind: 'audio' })} />
      )}
      {dialog?.kind === 'renameChannel' && (
        <PromptDialog title={`Rename ${dialog.name}`} label="Channel name" initial={dialog.name} onClose={() => setDialog(null)}
          onSubmit={name => { if (name !== dialog.name) void store.renameChannel(dialog.channelId, name) }} />
      )}
      {dialog?.kind === 'deleteGroup' && (
        <DeleteGroupDialog name={dialog.name} channels={(g?.channels ?? []).filter(c => c.parentId === dialog.channelId).sort((a, b) => a.position - b.position).map(c => c.name)}
          onConfirm={() => void store.deleteGroup(dialog.channelId)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'deleteChannel' && (
        <ConfirmDialog title={`Delete ${dialog.name}?`} message="The channel and everything written in it are removed for everyone. This cannot be undone."
          onConfirm={() => { void store.deleteChannel(dialog.channelId); store.setChannelMuted(dialog.channelId, false) }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'renameFolder' && (
        <PromptDialog title="Rename folder" label="Folder name" onClose={() => setDialog(null)}
          onSubmit={name => saveFolders(folders.map(f => (f.id === dialog.folderId ? { ...f, name: name.slice(0, 40) } : f)))} />
      )}
      {/* "Voice settings", wherever it is asked for, is Settings opened at its Voice & audio section. */}
      {(dialog?.kind === 'settings' || dialog?.kind === 'audio') && (
        <UserSettingsDialog key={dialog.kind} store={store} initial={dialog.kind === 'audio' ? 'voice' : 'account'} onOpen={what => setDialog({ kind: what })} onClose={() => setDialog(null)}
          onAllowDirect={allow => {
            // Saying no is immediate. Saying yes goes through signing in again.
            if (allow) setDialog({ kind: 'allowDirect' })
            else void store.setAllowDirect(false).catch(e => store.setError(e instanceof Error ? e.message : String(e)))
          }}
          onSignOut={async () => { setDialog(null); await store.signOut(); onSignedOut() }} />
      )}
      {dialog?.kind === 'overlay' && (
        <OverlaySettingsDialog settings={store.settings} onChange={store.updateSettings} packs={soundPackNames(store.soundPacks)}
          onOpenSounds={store.openSoundsFolder} onReloadSounds={store.reloadSoundPacks} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'server' && g && (
        <ServerSettingsDialog api={store.api} channels={g.channels} guild={g.guild} roles={g.roles ?? []} members={g.members} myPermissions={myPerms} meId={me?.id ?? ''}
          onRename={store.renameGuild} onIcon={store.setGuildIcon} onListing={store.setGuildListing} tagSymbols={store.tagSymbols} onSetTag={store.setGuildTag} onRemoveTag={store.removeGuildTag} onCountRolls={store.setGuildCountRolls} onCreateRole={store.createRole} onUpdateRole={store.updateRole} onDeleteRole={store.deleteRole} onSetMemberRoles={store.setMemberRoles}
          onClose={() => setDialog(null)} />
      )}
      {store.directPrompt && (
        <DirectChannelDialog kind={store.directPrompt.kind} text={!!store.directPrompt.text}
          channelName={store.guilds.flatMap(x => x.channels).find(c => c.id === store.directPrompt?.channelId)?.name ?? 'This channel'}
          onJoin={() => void store.confirmDirect()} onSettings={() => setDialog({ kind: 'audio' })} onClose={store.dismissDirectPrompt} />
      )}
    </div>
  )
}

// ---- Chat column ------------------------------------------------------------

function Chat({ store, openRollDialog, canRoll, colorOf, onUserMenu, isIgnored, onUserCard, nameIn, onCall }: {
  onCall: (userId: string, name: string, direct: boolean) => void
  store: Store; openRollDialog: (kind: RollKind) => void; canRoll: boolean; colorOf: (userId: string) => string | undefined
  onUserMenu: (e: React.MouseEvent, userId: string, username: string) => void; isIgnored: (userId: string) => boolean
  onUserCard: (e: React.MouseEvent, userId: string, name: string) => void; nameIn: (userId: string, fallback: string) => string
}) {
  // Messages from someone you ignore are folded away; this remembers the ones you chose to look at anyway.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const directRef = useRef<HTMLInputElement>(null)
  /** Files pasted into the message box, waiting for a yes: a paste is easy to do by accident. */
  const [pasted, setPasted] = useState<File[] | null>(null)
  /** Files are being dragged over the chat. */
  const [dropping, setDropping] = useState(false)
  const channel = store.selectedChannel
  // Right-click a message: copy it, or delete it if it is yours or you may manage messages here (the server decides).
  const [messageMenu, setMessageMenu] = useState<{ m: MessageDto; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<MessageDto | null>(null)
  const here = store.guilds.find(x => x.guild.id === channel?.guildId)
  const mayManageMessages = !!here && hasPermission(here.myPermissions, Permission.ManageMessages)
  // Sending straight from this computer is a P2P thing: offered in a P2P channel and in a conversation with a
  // friend, to someone who allows P2P. Everywhere else files are attached in the ordinary way.
  const p2pPlace = !!channel && channel.type === ChannelType.DirectMessage && store.dms.some(d => d.channelId === channel.id && store.friends.friends.some(f => f.user.id === d.other.id))
  // A P2P channel on a server: what is typed goes straight between apps, and only text travels that way so far.
  const p2pChat = !!channel && channel.type !== ChannelType.DirectMessage && channel.directSince != null
  const p2p = p2pChat && store.p2pText?.channelId === channel?.id ? store.p2pText : null
  const canSendDirect = store.allowDirect && p2pPlace && store.transferLimits?.enabled !== false
  // A voice message: recorded here, sent like any file. The server's upload limit is looked up when one is started.
  const [voiceMessage, setVoiceMessage] = useState<{ maxBytes: number } | null>(null)
  // An iPhone has one microphone to give out: recording while in voice would take it away from the call.
  const voiceBusy = appleTouch() && !!store.voice
  const startVoiceMessage = async () => {
    const rules = await store.api.uploadSettings().catch(() => null)
    if (rules && !rules.enabled) { store.setError('Uploads are turned off on this server right now.'); return }
    setVoiceMessage({ maxBytes: rules?.maxBytes ?? 0 })
  }
  useEffect(() => { setVoiceMessage(null) }, [channel?.id])
  const party = store.partyChannel
  const noParty = 'Join a voice channel first: rolls go to the people in voice with you'
  const me = store.me()

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [store.messages.length, store.selectedChannel?.id])

  const suggestions = useMemo(() => {
    if (!text.startsWith('/')) return []
    const typed = text.slice(1).split(/\s/)[0].toLowerCase()
    const builtin = BUILTIN_COMMANDS.filter(c => c.name.startsWith(typed)).map(c => ({ id: 'builtin:' + c.name, name: c.name, description: c.description, applicationName: 'Maplecord', options: [] as CommandDto['options'] }))
    return [...builtin, ...store.commands.filter(c => c.name.startsWith(typed))].slice(0, 8)
  }, [text, store.commands])

  /**
   * Header buttons: with a roll already open, left-click rolls *in* it (Roll → roll, Need/Greed → need) so there is
   * never a second "Roll" that means something else. Otherwise left-click starts an instant roll with no item and
   * right-click (or the *cust commands) opens the customize dialog.
   */
  // What the ⇄ button can really do here: the size limit is the server's, and only P2P between friends goes past it.
  const limits = store.transferLimits
  const directSendTitle = 'Send a file straight from your computer to friends here who allow P2P. It is not kept on the server'
    + (limits && limits.maxDirectBytes > 0 ? `. Up to ${fileSize(limits.maxDirectBytes)}.` : ', so it can be any size.')
  const live = store.activeRoll && !store.activeRoll.result ? store.activeRoll.session : null
  const quickRoll = (kind: RollKind) => {
    if (live) {
      if (kind === RollKind.NeedGreed && live.kind !== RollKind.NeedGreed) return store.roll(RollChoice.Roll)
      return store.roll(live.kind === RollKind.NeedGreed ? RollChoice.Need : RollChoice.Roll)
    }
    return store.startRoll(kind, null)
  }

  const runBuiltin = async (name: string, rest: string): Promise<boolean> => {
    const range = parseRange(rest)
    if (rest && !range && ['roll', 'need', 'needgreed', 'dice', 'rol'].includes(name)) { store.setError(`Use a range like /${name} 1-20 (whole numbers, min < max).`); return true }
    switch (name) {
      case 'roll': if (range) await store.startRoll(RollKind.Standard, null, range[0], range[1]); else await quickRoll(RollKind.Standard); return true
      case 'need': case 'needgreed': if (range) await store.startRoll(RollKind.NeedGreed, null, range[0], range[1]); else await quickRoll(RollKind.NeedGreed); return true
      case 'dice': case 'rol': await store.quickRoll(range?.[0] ?? 1, range?.[1] ?? 100); return true
      case 'flip': await store.coinFlip(); return true
      case 'rps': await store.startRps(); return true
      case 'rollcust': if (rest) await store.startRoll(RollKind.Standard, { pluginId: null, itemId: null, name: rest, iconUrl: null, quantity: 1 }); else openRollDialog(RollKind.Standard); return true
      case 'needcust': if (rest) await store.startRoll(RollKind.NeedGreed, { pluginId: null, itemId: null, name: rest, iconUrl: null, quantity: 1 }); else openRollDialog(RollKind.NeedGreed); return true
      default: return false
    }
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || !channel) return
    setText('')
    if (value.startsWith('/')) {
      const [name, ...rest] = value.slice(1).split(/\s+/)
      if (await runBuiltin(name.toLowerCase(), rest.join(' ').trim())) return
      const command = store.commands.find(c => c.name === name.toLowerCase())
      if (!command) { store.setError(`Unknown command /${name}`); return }
      await store.invokeCommand(command, parseArgs(command, rest.join(' ')))
      return
    }
    await store.sendMessage(value)
  }

  const holdsFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')
  const mayTakeFiles = !!channel && !(p2pChat && p2p?.state !== 'on')
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    if (!mayTakeFiles) return
    for (const f of Array.from(e.dataTransfer.files)) await store.sendFile(f)
  }

  return (
    <div className={'chat' + (dropping && mayTakeFiles ? ' dropping' : '')} onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); if (holdsFiles(e) && !dropping) setDropping(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}>
      {dropping && mayTakeFiles && <div className="dropnote" aria-hidden="true">Drop to send to {channel?.type === ChannelType.DirectMessage ? '@' : '#'}{channel?.name}</div>}
      {pasted && channel && (
        <PastedDialog files={pasted} where={(channel.type === ChannelType.DirectMessage ? '@' : '#') + channel.name} onClose={() => setPasted(null)}
          onSend={async () => { const files = pasted; setPasted(null); for (const f of files) await store.sendFile(f) }} />
      )}
      <StreamStage store={store} nameOf={nameIn} />
      <div className="header">
        <span className="muted">{channel?.type === ChannelType.Voice ? '🔊' : channel?.type === ChannelType.DirectMessage ? '@' : '#'}</span><span>{channel?.name ?? 'Pick a channel'}</span>
        {channel?.type === ChannelType.DirectMessage && <span style={{ width: 8, height: 8, borderRadius: 4, background: !store.selectedDm?.online ? '#555566' : store.dndUsers.has(store.selectedDm.other.id) ? 'var(--red)' : 'var(--green)', display: 'inline-block' }} title={!store.selectedDm?.online ? 'Offline' : store.dndUsers.has(store.selectedDm.other.id) ? 'Do not disturb' : 'Online'} />}
        {channel?.type === ChannelType.DirectMessage && store.selectedDm && !store.call && store.friends.friends.some(f => f.user.id === store.selectedDm?.other.id) && (
          <span className="callbuttons">
            <button className="subtle" title="Call" onClick={() => onCall(store.selectedDm!.other.id, channel.name, false)}>📞 Call</button>
            {store.allowDirect && <button className="subtle p2pcall" title="P2P call: your apps connect straight to each other, so each of you can find the other's IP address. They must allow P2P too." onClick={() => onCall(store.selectedDm!.other.id, channel.name, true)}>📞 P2P call</button>}
          </span>
        )}
        {channel && canRoll && store.settings.showRollButtons !== false && (
          <div className="actions">
            {/* Games are played with the people in voice with you (or the other person in a DM), wherever you happen to be looking. */}
            {!party && <span className="rolltarget none" title="Rolls go to the people in voice with you">Join a voice channel to roll</span>}
            {party && party.id !== channel.id && <span className="rolltarget" title="Rolls go to the people in voice with you; results post in that channel's chat">Rolls go to {store.partyLabel}</span>}
            <button disabled={!party} className={live ? 'accent' : ''} title={!party ? noParty : live ? 'Roll in the open roll' : 'Click: start a roll · Right-click: name the item'} onClick={() => quickRoll(RollKind.Standard)} onContextMenu={e => { e.preventDefault(); if (party) openRollDialog(RollKind.Standard) }}>🎲 Roll</button>
            <button disabled={!party} title={!party ? noParty : live ? 'Need in the open roll' : 'Click: start need/greed · Right-click: name the item'} onClick={() => quickRoll(RollKind.NeedGreed)} onContextMenu={e => { e.preventDefault(); if (party) openRollDialog(RollKind.NeedGreed) }}>Need / Greed</button>
            <button disabled={!party} title={party ? undefined : noParty} onClick={store.coinFlip}>🪙 Flip</button>
            <button disabled={!party} title={party ? undefined : noParty} onClick={store.startRps}>✊ RPS</button>
          </div>
        )}
      </div>

      <div className="messages" ref={listRef}>
        {store.canLoadOlder && <div style={{ textAlign: 'center' }}><button className="subtle" onClick={store.loadOlder}>Load older messages</button></div>}
        {store.messages.map(m => isIgnored(m.authorId) && !m.webhookId && !revealed.has(m.id)
          ? <div key={m.id} className="message ignored"><span /><span className="muted">Message from {m.authorName}, who you ignore · <button className="subtle" onClick={() => setRevealed(new Set([...revealed, m.id]))}>show</button></span></div>
          : <Message key={m.id} m={m} color={colorOf(m.authorId)} icon={store.itemIcon(m.roll?.item)} serverUrl={store.settings.serverUrl} onInvite={link => void store.openInvite(link)}
              fileOffer={m.fileOffer ? <FileOfferView store={store} offer={m.fileOffer} mine={m.authorId === (me?.id ?? '')} /> : undefined}
              p2pFiles={m.p2pFiles?.map(f => <P2PFileChip key={f.hash} store={store} channelId={m.channelId} authorId={m.authorId} file={f} />)}
              author={m.webhookId ? null : store.appearanceOf(m.authorId)} name={m.webhookId ? m.authorName : nameIn(m.authorId, m.authorName)}
              mention={m.authorId !== me?.id && store.mentionsMe(m.content)}
              onMenu={m.ephemeral ? undefined : e => { e.preventDefault(); setMessageMenu({ m, x: e.clientX, y: e.clientY }) }}
              onUserMenu={m.webhookId ? undefined : e => onUserMenu(e, m.authorId, m.authorName)} onUserCard={m.webhookId ? undefined : e => onUserCard(e, m.authorId, m.authorName)} />)}
      </div>

      {messageMenu && (
        <ContextMenu x={messageMenu.x} y={messageMenu.y} onClose={() => setMessageMenu(null)} entries={[
          ...(messageMenu.m.content ? [{ kind: 'item', label: 'Copy text', onClick: () => { void navigator.clipboard.writeText(messageMenu.m.content).catch(() => { /* no clipboard */ }) } } as MenuEntry] : []),
          // In a P2P channel anyone may remove any message from their own device: it touches nobody else's copy.
          ...(messageMenu.m.authorId === me?.id || mayManageMessages || p2pChat
            ? [{ kind: 'item', label: p2pChat ? 'Remove from this device' : 'Delete message', danger: true, onClick: () => setDeleting(messageMenu.m) } as MenuEntry]
            : []),
          ...(!messageMenu.m.content && messageMenu.m.authorId !== me?.id && !mayManageMessages ? [{ kind: 'label', text: 'Nothing to do with this message' } as MenuEntry] : []),
        ]} />
      )}
      {deleting && (
        <ConfirmDialog title={p2pChat ? 'Remove this message from this device?' : 'Delete this message?'} message={p2pChat ? 'Only your own copy is removed. Everyone else who received it keeps theirs.' : deleting.authorId === me?.id ? 'It is removed for everyone and cannot be brought back.' : `This removes ${nameIn(deleting.authorId, deleting.authorName)}'s message for everyone. It cannot be brought back.`}
          onConfirm={() => void store.deleteMessage(deleting.id)} onClose={() => setDeleting(null)} />
      )}
      {store.pendingDrops[0] && !store.pendingDrops[0].auto && <DropBanner drop={store.pendingDrops[0]} more={store.pendingDrops.length - 1} channel={store.partyChannel} onAccept={store.acceptDrop} onDismiss={store.dismissDrop} />}
      {store.activeRoll && <RollPanel store={store} meId={me?.id ?? ''} />}
      {store.activeRps && <RpsPanel store={store} meId={me?.id ?? ''} />}

      {p2pChat && (
        <div className={'p2pbar' + (p2p?.state === 'on' ? '' : ' wide')}>
          {!p2p || p2p.state === 'connecting' ? <span className="muted">P2P · connecting…</span>
            : p2p.state === 'on' ? (
              <span className="muted">
                {p2p.reachable > 0 ? `P2P · connected to ${p2p.reachable} ${p2p.reachable === 1 ? 'person' : 'people'} here`
                  : p2p.present > 0 ? 'P2P · connecting to the people here…'
                  : 'P2P · nobody else is here right now. A message sent now reaches them when they next connect to someone who has it.'}
                {channel && store.settings.p2pSubscribed?.[channel.id] ? ' · subscribed' : ''}
              </span>
            ) : p2p.state === 'failed' ? <span className="bad">{p2p.note || 'Could not connect to this channel.'}</span>
            : (
              <>
                <span className="grow">
                  <b>This is a P2P channel.</b> What is typed here goes straight between people's apps and is kept only on their own devices; the server keeps none of it.
                  People connected to it can find each other's IP address.
                </span>
                <button className="accent" onClick={() => channel && store.askDirectText(channel.id)}>{p2p.state === 'blocked' ? 'Why can I not connect?' : 'Connect'}</button>
              </>
            )}
        </div>
      )}
      {/* Shown for the P2P channel on screen, and wherever this is while in a P2P call or P2P voice channel. */}
      {store.p2pNewApps.filter(x => (p2pChat && x.channelId === channel?.id) || x.channelId === store.voice?.channelId).map(x => (
        <div key={x.channelId + x.userId + x.print} className="p2pbar wide" role="status">
          <span className="grow">
            <b>{x.userId === me?.id ? 'Your account' : nameIn(x.userId, x.username)}</b> {x.channelId !== store.voice?.channelId ? 'is connected here' : store.call?.channelId === x.channelId ? 'is in your call' : 'is in your voice channel'} from an app or browser this device has not seen {x.userId === me?.id ? 'you' : 'them'} use before.
            If that is not expected, check with {x.userId === me?.id ? 'your other devices' : 'them'} some other way before trusting what it sends.
          </span>
          <button className="subtle" onClick={() => void store.acceptP2pApp(x.userId, x.print)}>That is fine</button>
        </div>
      ))}
      {p2pChat && channel && store.p2pBotsWaiting.filter(x => x.channelId === channel.id).map(x => (
        <div key={x.userId} className="p2pbar wide">
          {x.viaRelay ? (
            <span className="grow">
              <b>{nameIn(x.userId, x.username)}</b> is a bot in this channel. You join P2P channels through the relay, and a bot is never reached through it, so your app is not connected to it.
              What you write here can still reach it through the people who are connected to it. How long it keeps that is up to whoever runs it.
            </span>
          ) : (
            <>
              <span className="grow">
                <b>{nameIn(x.userId, x.username)}</b> is a bot in this channel. It receives what is said here and can hand you what you missed. How long it keeps that is up to whoever runs it.{' '}
                Connecting to it lets whoever runs it find your IP address; it is never reached through the relay.
                Not connecting keeps your address from it, but what you write here can still reach it through the people who are connected to it.
              </span>
              <button className="accent" onClick={() => void store.acceptP2pBot(channel.id, x.userId, x.username)}>Connect to it</button>
            </>
          )}
          <button className="subtle" title="Not now" onClick={() => store.dismissP2pBot(channel.id, x.userId)}>×</button>
        </div>
      ))}
      <div className="typing muted">{store.typing}</div>
      {store.error && <div className="error"><span className="grow">{store.error}</span><button className="subtle" onClick={() => store.setError(null)}>×</button></div>}

      <div style={{ position: 'relative' }}>
        {suggestions.length > 0 && (
          <div className="dialog" style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, width: 'auto', padding: 8, gap: 2 }}>
            {suggestions.map(c => (
              <div key={c.id} className="row" style={{ padding: '4px 6px', cursor: 'pointer' }} onClick={() => setText(`/${c.name} `)}>
                <b>/{c.name}</b> <span className="muted">{c.options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ')}</span>
                <span className="muted grow" style={{ textAlign: 'right' }}>{c.description} · {c.applicationName}</span>
              </div>
            ))}
          </div>
        )}
        {voiceMessage && channel ? (
          <VoiceMessageBar deviceId={store.settings.audioInputDeviceId} maxBytes={voiceMessage.maxBytes} onSend={file => store.sendFile(file)} onClose={() => setVoiceMessage(null)} />
        ) : (
        <div className="composer">
          <input ref={fileRef} type="file" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) await store.sendFile(f); e.target.value = '' }} />
          <button title={store.uploading ? `Sending ${store.uploading}…` : p2pChat ? 'Send a picture or a file to the people in this channel' : 'Send a file'} onClick={() => fileRef.current?.click()}
            disabled={!channel || !!store.uploading || (p2pChat && p2p?.state !== 'on')}>{store.uploading ? <LoaderCircle size={17} className="spin" /> : <Paperclip size={17} />}</button>
          <input ref={directRef} type="file" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) await store.offerFile(f); e.target.value = '' }} />
          {canRecordVoiceMessage() && !p2pChat && (
            <button title={voiceBusy ? 'Leave voice to record a voice message on this device' : 'Record a voice message'} aria-label="Record a voice message"
              onClick={() => void startVoiceMessage()} disabled={!channel || !!store.uploading || voiceBusy}><AudioLines size={17} /></button>
          )}
          {canSendDirect && <button title={directSendTitle} aria-label="Send a file straight from your computer" onClick={() => directRef.current?.click()} disabled={!channel}><ArrowLeftRight size={17} /></button>}
          <textarea
            placeholder={!channel ? '' : p2pChat ? `Message #${channel.name}  ·  P2P` : `Message ${channel.type === ChannelType.DirectMessage ? '@' : '#'}${channel.name}`}
            value={text} disabled={!channel || (p2pChat && p2p?.state !== 'on')} rows={1}
            onChange={e => { setText(e.target.value); if (e.target.value) store.notifyTyping() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
            // A screenshot, a copied picture or copied files: offered for sending. Anything with text in it pastes as text.
            onPaste={e => {
              const files = Array.from(e.clipboardData.files)
              if (files.length === 0 || e.clipboardData.getData('text/plain')) return
              e.preventDefault()
              setPasted(files)
            }}
          />
          <button className="accent" onClick={submit} disabled={!channel || (p2pChat && p2p?.state !== 'on')}>Send</button>
        </div>
        )}
      </div>
    </div>
  )
}

/** An invite link somewhere in a message: this server's invite page, or the app's own kind of link. */
const INVITE_LINK = /(https?:\/\/[^\s<>"']+\/invite\/[A-Za-z0-9]{4,32}(?:\?[^\s<>"']*)?|maplecord:\/\/invite\/[^\s<>"']+)/g

/**
 * A message's text, with any invite link in it made into something to press: it opens the same "join this server?"
 * prompt as an invite opened from outside the app. Nothing else in a message is a link, and nothing is fetched.
 */
function withInviteLinks(text: string, open?: (link: string) => void): React.ReactNode {
  if (!open || !text.includes('invite/')) return text
  const parts = text.split(INVITE_LINK)
  if (parts.length === 1) return text
  // split() with one capturing group puts the links at the odd places.
  return parts.map((part, i) => (i % 2 === 1
    ? <button key={i} className="invitelink" title="Open this invite" onClick={() => open(part)}>{part}</button>
    : part))
}

function Message({ m, color, icon, serverUrl, mention, author, name, onUserMenu, onUserCard, onMenu, onInvite, fileOffer, p2pFiles }: {
  /** The files on a message from a P2P channel, drawn below its text. */
  p2pFiles?: React.ReactNode
  /** Pressed an invite link in the text. */
  onInvite?: (link: string) => void
  m: MessageDto; color?: string; icon?: string | null; serverUrl: string; mention?: boolean
  /** Right-click anywhere on the message that is not the author. */
  onMenu?: (e: React.MouseEvent) => void
  /** Rendered in place of the text when the message is a file offered straight from someone's app. */
  fileOffer?: React.ReactNode
  /** How the author looks, when we know them (null for webhooks and people no longer around). */
  author: Appearance | null; name: string
  onUserMenu?: (e: React.MouseEvent) => void; onUserCard?: (e: React.MouseEvent) => void
}) {
  const time = new Date(m.createdAt)
  const timeText = time.toDateString() === new Date().toDateString() ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className={'message' + (m.ephemeral ? ' ephemeral' : '') + (mention ? ' mention' : '')} onContextMenu={onMenu}>
      <Avatar who={author} name={name} serverUrl={serverUrl} size={32} onClick={onUserCard} onContextMenu={onUserMenu} />
      <div>
        <div className="meta">
          <UserName who={author} label={name} roleColor={color} className="name" onClick={onUserCard} onContextMenu={onUserMenu} />
          {(m.kind === MessageKind.Bot || m.kind === MessageKind.Webhook) && <span className="tag">{m.kind === MessageKind.Bot ? 'BOT' : 'HOOK'}</span>}
          <span className="muted">{timeText}{m.ephemeral ? ' · only you can see this' : ''}</span>
        </div>
        {m.kind === MessageKind.System ? <div className="system">{m.content}</div>
          : m.kind === MessageKind.Roll ? (
            <div className="card">
              <div className="title">{icon && <img className="itemicon" src={icon} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}{m.roll?.item ? `${m.roll.kind === RollKind.NeedGreed ? 'Need / Greed' : 'Roll'} for ${m.roll.item.name}` : m.roll?.kind === RollKind.NeedGreed ? 'Need / Greed' : 'Roll'}{m.roll && !(m.roll.min === 1 && m.roll.max === 100) ? ` (${m.roll.min}–${m.roll.max})` : ''}</div>
              <div>{m.content}</div>
              {m.roll?.entries.map(e => <div key={e.userId} className="line">{e.choice === RollChoice.Pass ? `${e.username} passed` : `${e.username} — ${m.roll?.kind === RollKind.NeedGreed ? ['', 'need ', 'greed ', ''][e.choice] : ''}${e.value}`}</div>)}
            </div>
          ) : m.kind === MessageKind.Rps ? (
            <div className="card" style={{ borderColor: 'var(--accent2)' }}>
              <div className="title">Rock, paper, scissors{m.rps?.tieBreak ? ' — tie-break' : ''}</div>
              <div>{m.content}</div>
              {m.rps?.entries.map(e => <div key={e.userId} className="line">{RPS_ICON[e.choice]} {e.username} — {RPS_NAME[e.choice]}{m.rps?.winnerIds.length === 1 && m.rps.winnerIds[0] === e.userId ? ' 🏆' : ''}</div>)}
            </div>
          ) : m.kind === MessageKind.FileOffer && m.fileOffer ? (
            fileOffer
          ) : m.kind === MessageKind.Call && m.call ? (
            <div className={'calllog' + (m.call.outcome === 'ended' ? '' : ' missed')}>
              📞 {m.call.outcome === 'ended' ? `Call · ${callLength(m.call.seconds)}` : m.call.outcome === 'declined' ? 'Call declined' : 'Missed call'}
              {m.call.direct && <span className="p2ptag">P2P</span>}
            </div>
          ) : m.kind === MessageKind.Dice ? (
            <div className="row">🎲 rolled <b style={{ fontSize: 18 }}>{m.content}</b> <span className="muted">({m.dice?.min ?? 1}–{m.dice?.max ?? 100})</span></div>
          ) : m.kind === MessageKind.CoinFlip ? (
            <div className="row"><img src={import.meta.env.BASE_URL + (m.content === 'Tails' ? 'coin_tails.png' : 'coin_heads.png')} width={40} height={40} alt="" /> flipped a coin — <b>{m.content}</b></div>
          ) : <div className="body">{withInviteLinks(m.content, onInvite)}</div>}
        {m.attachments.map(a => <AttachmentView key={a.id} file={a} />)}
        {p2pFiles}
        {m.embeds?.map((e, i) => (
          <div key={i} className="card" style={{ borderLeftColor: e.color != null ? '#' + e.color.toString(16).padStart(6, '0') : undefined }}>
            {e.title && <div className="title">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{e.title}</a> : e.title}</div>}
            {e.description && <div className="body">{e.description}</div>}
            {e.fields?.map((f, j) => <div key={j} className="line"><b>{f.name}</b> {f.value}</div>)}
            {serverMediaUrl(serverUrl, e.imageUrl) && <img className="attachment" src={serverMediaUrl(serverUrl, e.imageUrl)!} alt="" />}
            {e.footer && <div className="line">{e.footer}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Looks up how this server lets people sign in, then shows the sign-in-again step for allowing P2P. */
function AllowDirectStep({ store, onClose }: { store: Store; onClose: () => void }) {
  const [providers, setProviders] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    store.api.providers(store.settings.serverUrl).then(list => { if (alive) setProviders(list) }).catch(() => { if (alive) setProviders([]) })
    return () => { alive = false }
  }, [store.api, store.settings.serverUrl])
  return <AllowDirectDialog providers={providers} username={store.settings.user?.username ?? ''} onSignIn={store.reauthenticateForDirect} onClose={onClose} />
}

const fileSize = (bytes: number) => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'

/**
 * A file someone is offering straight from their app. It is not on the server: asking for it connects the two
 * apps (through a relay unless both allowed direct connections) and the file streams across.
 */
function FileOfferView({ store, offer, mine }: { store: Store; offer: FileOfferDto; mine: boolean }) {
  const all = store.transfers.filter(t => t.offerId === offer.id)
  // The sender may be sending to several people at once; the receiver has one transfer of their own.
  const active = all.filter(t => t.state === 'waiting' || t.state === 'connecting' || t.state === 'transferring')
  const last = all[all.length - 1]
  const route = (t: TransferView) => (t.relayed === false ? ' · P2P' : '')

  return (
    <div className="fileoffer">
      <div className="row">
        <span className="ico">⇄</span>
        <span className="grow">
          <b>{offer.fileName}</b><span className="muted"> · {fileSize(offer.size)}</span>
          <div className="muted">
            {mine
              ? (offer.withdrawn ? 'You withdrew this.'
                : offer.available ? 'Offered from your computer. People can download it while Maplecord is open here.'
                : 'Not on offer right now. It comes back when Maplecord is open on the computer that has the file, if the file has not been moved or changed.')
              : (offer.withdrawn ? 'The sender withdrew it.'
                : offer.available ? 'Sent from their computer when you download it. Not stored on the server.'
                : 'Not available right now. It comes back when the sender is online again and still has the file.')}
          </div>
        </span>
        {!mine && offer.available && active.length === 0 && last?.state !== 'done' && <button className="accent" onClick={() => void store.downloadFile(offer)}>Download</button>}
        {mine && !offer.withdrawn && <button className="subtle" onClick={() => void store.withdrawFile(offer.id)}>Withdraw</button>}
      </div>
      {active.map(t => (
        <div key={t.key} className="progress">
          <div className="bar"><div style={{ width: `${t.size ? Math.min(100, t.bytes / t.size * 100) : 0}%` }} /></div>
          <span className="muted">
            {t.state === 'transferring'
              ? `${t.direction === 'send' ? 'Sending' : 'Receiving'} ${fileSize(t.bytes)} of ${fileSize(t.size)}${t.bytesPerSecond ? ' · ' + fileSize(t.bytesPerSecond) + '/s' : ''}${route(t)}`
              : t.state === 'waiting' ? 'Asking the sender…' : 'Connecting…'}
          </span>
          <button className="subtle" onClick={() => store.cancelTransfer(t.key)}>Cancel</button>
        </div>
      ))}
      {active.length === 0 && last && last.state === 'done' && <div className="muted ok">{last.direction === 'send' ? 'Sent' : 'Saved'}{route(last)}.</div>}
      {active.length === 0 && last && (last.state === 'failed' || last.state === 'cancelled') && <div className="muted bad">{last.state === 'cancelled' ? 'Cancelled.' : last.error ?? 'The transfer failed.'}</div>}
    </div>
  )
}

/**
 * One file on a message in a P2P channel. It is not on the server: its contents come from the app of someone
 * connected who has them. A picture of an ordinary size is fetched and shown by itself; anything else waits to be
 * asked for. Once fetched it is kept on this device with the message.
 */
function P2PFileChip({ store, channelId, authorId, file }: { store: Store; channelId: string; authorId: string; file: P2PFile }) {
  const view = store.p2pFiles[`${channelId}|${file.hash}`]
  const picture = P2P_PICTURE.test(file.type)
  const byItself = picture && file.size <= 10 * 1024 * 1024
  // Tried again when someone else connects: they may be the one who has it.
  const reachable = store.p2pText?.channelId === channelId ? store.p2pText.reachable : 0
  const { loadP2pFile } = store
  useEffect(() => { void loadP2pFile(channelId, file, authorId, byItself) }, [loadP2pFile, channelId, file.hash, authorId, byItself, reachable]) // eslint-disable-line react-hooks/exhaustive-deps

  if (picture && view?.url) return <img className="attachment" src={view.url} alt={file.name} title={file.name} />
  const fetching = view?.state === 'fetching'
  const note = fetching ? `fetching · ${Math.min(100, Math.round(view.got / file.size * 100))}%`
    : view?.state === 'nobody' ? 'nobody connected has it right now'
    : view?.state === 'relay' ? 'too large to fetch through the relay'
    : view?.state === 'have' ? 'on this device' : 'not fetched yet'
  return (
    <div className="filechip">
      <span className="ico">{picture ? '🖼' : '📄'}</span>
      <span className="grow"><b>{file.name}</b><span className="muted"> · {fileSize(file.size)} · {note}</span></span>
      {!fetching && (view?.state === 'have'
        ? <button className="subtle" onClick={() => void store.saveP2pFile(channelId, file, authorId)}>Save</button>
        : <button className="subtle" onClick={() => void (isElectron() && !picture ? store.saveP2pFile(channelId, file, authorId) : loadP2pFile(channelId, file, authorId, true))}>{picture ? 'Show' : 'Download'}</button>)}
    </div>
  )
}

/**
 * One file on a message. Pictures and videos show in place; anything else is a download.
 * The server only keeps a file for a while. The desktop app shows pictures and videos through its own copies
 * (see electron/fileCache.ts), so one it has shown before still shows after the server has let it go.
 */
function AttachmentView({ file }: { file: AttachmentDto }) {
  const [gone, setGone] = useState(false)
  const desktop = isElectron()
  const kind = file.contentType.startsWith('image/') ? 'image' : file.contentType.startsWith('video/') ? 'video' : file.contentType.startsWith('audio/') ? 'audio' : 'file'
  const src = desktop ? `maplecord-plugin://files/${file.id}/${encodeURIComponent(file.fileName)}?u=${encodeURIComponent(file.url)}` : file.url
  const expired = <div className="filechip expired" title="The server keeps files for a limited time."><span className="ico">⌛</span><span className="grow"><b>{file.fileName}</b><span className="muted"> · no longer available</span></span></div>

  // Without a copy of our own (the web version, or any plain download) an expired file is simply gone.
  if (gone || (file.expired && (!desktop || kind === 'file'))) return expired
  if (kind === 'image') return <img className="attachment" src={src} alt={file.fileName} title={file.fileName} onError={() => setGone(true)} />
  if (kind === 'video') return <video className="attachment" src={src} controls preload={desktop ? 'none' : 'metadata'} title={file.fileName} onError={() => setGone(true)} />
  if (kind === 'audio') return (
    <div className="soundchip" title={file.fileName}>
      <span className="muted">{file.fileName.startsWith('voice-message') ? 'Voice message' : file.fileName} · {fileSize(file.size)}</span>
      <audio src={src} controls preload="metadata" onError={() => setGone(true)} />
    </div>
  )
  return (
    <a className="filechip" href={file.url} download={file.fileName} title={`Download ${file.fileName}`}>
      <span className="ico">📄</span>
      <span className="grow"><b>{file.fileName}</b><span className="muted"> · {fileSize(file.size)}</span></span>
      <span className="get">Download</span>
    </a>
  )
}

function RollPanel({ store, meId }: { store: Store; meId: string }) {
  const ar = store.activeRoll!
  const { session, result } = ar
  const [secondsLeft, setSecondsLeft] = useState(0)
  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000)))
    tick(); const id = window.setInterval(tick, 1000); return () => window.clearInterval(id)
  }, [session.expiresAt])

  const ng = session.kind === RollKind.NeedGreed
  const entries = result?.entries ?? session.entries
  const mine = entries.find(e => e.userId === meId)
  const isParticipant = session.participants.includes(meId)
  const canAct = !result && !mine && isParticipant
  const iWon = result?.winnerId === meId
  const lost = !!result && !!mine && mine.choice !== RollChoice.Pass && !iWon
  const headline = (session.tieBreak ? 'Tie-break: ' : '') + (session.item?.name ?? (ng ? 'Need / Greed' : 'Roll'))
  const winnerText = !result ? '' : result.winnerName ? (iWon ? 'You win!' : `${result.winnerName} wins`) : result.tiedUserIds.length > 1 ? `Tie at ${result.winningValue} — rolling off` : 'Nobody rolled'

  return (
    <div className="rollpanel">
      <div>
        <div className="headline">{store.itemIcon(session.item) && <img className="itemicon" src={store.itemIcon(session.item)!} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}{headline}{session.item && session.item.quantity > 1 ? ` ×${session.item.quantity}` : ''}</div>
        <div className="muted">{ar.channelName}{session.min === 1 && session.max === 100 ? '' : ` · ${session.min}–${session.max}`} · {result ? 'Finished' : `${entries.length}/${session.participants.length} rolled`} · {secondsLeft}s{session.endVotes.length ? ` · ${session.endVotes.length} vote(s) to end` : ''}</div>
        {canAct && (
          <div className="row" style={{ marginTop: 10 }}>
            {!ng && <button className="accent" style={{ width: 90 }} onClick={() => store.roll(RollChoice.Roll)}>Roll</button>}
            {ng && <button className="need" style={{ width: 90 }} onClick={() => store.roll(RollChoice.Need)}>Need</button>}
            {ng && <button className="greed" style={{ width: 90 }} onClick={() => store.roll(RollChoice.Greed)}>Greed</button>}
            <button className="subtle" onClick={() => store.roll(RollChoice.Pass)}>Pass</button>
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          {!result && isParticipant && session.participants.length > 1 && !session.endVotes.includes(meId) && <button className="subtle" onClick={store.voteEnd}>Vote to end</button>}
          {!result && session.endVotes.includes(meId) && <span className="muted">Voted to end</span>}
          {result && <button className="subtle" onClick={store.dismissRoll}>Dismiss</button>}
        </div>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <div style={{ width: 90 }}>
          <div className="label">Your roll</div>
          <div className={'big' + (iWon ? ' won' : lost ? ' lost' : '')}>{mine ? (mine.choice === RollChoice.Pass ? '—' : mine.value) : ''}</div>
          <div className="muted" style={{ textAlign: 'center' }}>{mine ? ['Rolled', 'Need', 'Greed', 'Passed'][mine.choice] : ''}</div>
        </div>
        <div style={{ width: 120 }}>
          <div className="label">Winner</div>
          <div className="big won">{result?.winnerId ? result.winningValue : ''}</div>
          <div style={{ textAlign: 'center', fontWeight: 700, color: iWon ? 'var(--green)' : undefined }}>{winnerText}</div>
        </div>
      </div>
      <div className="entries">
        {[...entries].sort((a, b) => Number(b.choice === RollChoice.Need) - Number(a.choice === RollChoice.Need) || b.value - a.value).map(e => (
          <div key={e.userId} className={'e' + (e.userId === meId ? ' me' : '')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.username}</span>
            <span className="muted">{['', 'need', 'greed', 'pass'][e.choice]}</span>
            <span className="v">{e.choice === RollChoice.Pass ? '—' : e.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RpsPanel({ store, meId }: { store: Store; meId: string }) {
  const ar = store.activeRps!
  const { session, result, myPick } = ar
  const [secondsLeft, setSecondsLeft] = useState(0)
  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000)))
    tick(); const id = window.setInterval(tick, 1000); return () => window.clearInterval(id)
  }, [session.expiresAt])

  const isParticipant = session.participants.includes(meId)
  const canPick = !result && isParticipant && myPick === null
  const iWon = !!result && result.winnerIds.length === 1 && result.winnerIds[0] === meId
  const headline = (session.tieBreak ? 'Tie-break: ' : '') + 'Rock, paper, scissors'
  const status = result
    ? (result.winnerIds.length === 1 ? (iWon ? 'You win!' : `${result.entries.find(e => e.userId === result.winnerIds[0])?.username} wins`) : result.replay ? 'Tie — throwing again' : 'Nobody threw')
    : `${session.pickedUserIds.length}/${session.participants.length} thrown · ${secondsLeft}s`

  return (
    <div className="rpspanel">
      <div>
        <div className="headline" style={{ fontSize: 16, fontWeight: 700 }}>{headline}</div>
        <div className="muted" style={{ color: iWon ? 'var(--green)' : undefined, fontWeight: iWon ? 700 : undefined }}>{status}</div>
        {result ? (
          <div className="picks" style={{ marginTop: 8 }}>
            {result.entries.map(e => <span key={e.userId} className={'p' + (result.winnerIds.length === 1 && result.winnerIds[0] === e.userId ? ' winner' : '')}>{RPS_ICON[e.choice]} {e.username}</span>)}
            <button className="subtle" onClick={store.dismissRps}>Dismiss</button>
          </div>
        ) : (
          <div className="picks" style={{ marginTop: 8 }}>
            {session.participants.map(id => <span key={id} className="p">{session.pickedUserIds.includes(id) ? '✅' : '⏳'} {id === meId ? 'you' : (a => (a ? shownName(a) : '…'))(store.appearanceOf(id))}</span>)}
          </div>
        )}
      </div>
      {!result && isParticipant && (
        <div className="throws">
          {([RpsChoice.Rock, RpsChoice.Paper, RpsChoice.Scissors] as const).map(c => (
            <button key={c} className={myPick === c ? 'picked' : ''} disabled={!canPick} title={RPS_NAME[c]} onClick={() => store.rpsPick(c)}>{RPS_ICON[c]}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- helpers ------------------------------------------------------------------


const callLength = (seconds: number) => seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`

function channelRows(channels: Store['guilds'][number]['channels']) {
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const rows = channels.filter(c => c.type !== ChannelType.Category && !c.parentId).sort(byPos)
  for (const cat of channels.filter(c => c.type === ChannelType.Category).sort(byPos))
    rows.push(cat, ...channels.filter(c => c.parentId === cat.id).sort(byPos))
  return rows
}

/** Color of the member's highest colored role, for names in chat and the member list. */
function roleColor(userId: string, g: Store['guilds'][number]): string | undefined {
  const m = g.members.find(x => x.userId === userId)
  if (!m) return undefined
  const colored = (m.roleIds ?? []).map(id => g.roles?.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r && !!r.color).sort((a, b) => b.position - a.position)
  return colored[0]?.color ?? undefined
}

function roleLabel(m: MemberDto, g: Store['guilds'][number]) {
  if (m.userId === g.guild.ownerId) return 'Owner'
  const named = (m.roleIds ?? []).map(id => g.roles?.find(r => r.id === id)).filter(Boolean).sort((a, b) => b!.position - a!.position)
  return named[0]?.name ?? ''
}

/** "/loot item:Zakum Helmet qty:2" → { item, qty }; a lone positional fills the first required option. */
function parseArgs(command: CommandDto, rest: string): Record<string, string> {
  const args: Record<string, string> = {}
  const re = /(\w+):("([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  let consumed = ''
  while ((m = re.exec(rest))) { args[m[1].toLowerCase()] = m[3] ?? m[4]; consumed += m[0] }
  const leftover = rest.replace(re, '').trim()
  if (leftover && !consumed) {
    const first = command.options.find(o => o.required) ?? command.options[0]
    if (first) args[first.name] = leftover
  }
  return args
}
