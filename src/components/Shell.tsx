import { useEffect, useMemo, useRef, useState } from 'react'
import type { Store } from '../store'
import { ChannelType, MessageKind, Permission, RollChoice, RollKind, RollRange, RpsChoice, hasPermission, type CommandDto, type MemberDto, type MessageDto, type RoleDto } from '../types'

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
import { AudioSettingsDialog, ConfirmDialog, CreateChannelDialog, NicknameDialog, PromptDialog, StartRollDialog, VoiceNoticeDialog } from './Dialogs'
import { OverlaySettingsDialog, ServerSettingsDialog } from './Settings'
import Friends from './Home'
import { serverMediaUrl } from '../itemIcons'
import { isElectron } from '../platform'
import { soundPackNames } from '../sounds'
import { DEFAULT_NOTIFY, type NotifyLevel } from '../settings'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { Avatar, ProfileEditor, ProfilePopout, UserName } from './Profile'
import { initials, shownName, type Appearance } from '../profile'
import { DropBanner, PluginsDialog } from './Plugins'

type DialogState =
  | { kind: 'createGuild' } | { kind: 'joinGuild' } | { kind: 'createChannel'; category?: boolean } | { kind: 'startRoll'; rollKind: RollKind }
  | { kind: 'leaveGuild' } | { kind: 'kick'; member: MemberDto } | { kind: 'ban'; member: MemberDto }
  | { kind: 'audio' } | { kind: 'overlay' } | { kind: 'server' } | { kind: 'plugins' } | { kind: 'profile' }
  | { kind: 'nickname'; guildId: string; userId: string } | null

export default function Shell({ store, onSignedOut }: { store: Store; onSignedOut: () => void }) {
  const [dialog, setDialog] = useState<DialogState>(null)
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
  const speakingUsers = new Set(voice?.participants.filter(p => p.speaking).map(p => p.userId) ?? [])
  const voiceChannelName = voice ? store.guilds.flatMap(x => x.channels).find(c => c.id === voice.channelId)?.name ?? '' : ''
  const peers = voice?.participants.filter(p => p.userId !== me?.id) ?? []
  const voiceStatus = voice?.status || (voice
    ? `${voice.policy === 'relay' ? 'relayed' : 'direct'} · ${peers.length === 0 ? 'alone in channel' : `${peers.filter(p => p.state === 'connected').length}/${peers.length} connected`}`
    : '')
  const colorOf = (userId: string) => (g ? roleColor(userId, g) : undefined)
  const desktop = isElectron()

  // ---- Right-click menus ------------------------------------------------------
  // What they change about other people and servers is yours alone and kept on this device; nobody is told.
  const [menu, setMenu] = useState<({ kind: 'guild'; guildId: string } | { kind: 'user'; userId: string; username: string }) & { x: number; y: number } | null>(null)
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
  const ignored = (userId: string) => !!prefsOf(userId).ignored
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
      ...(allowed(Permission.CreateInvites) ? [{ kind: 'item', label: 'Invite people', icon: '✉', onClick: () => { void store.createInvite(guildId) } } as MenuEntry] : []),
      ...(me ? [{ kind: 'item', label: 'Change nickname', onClick: () => { store.selectGuild(guildId); setDialog({ kind: 'nickname', guildId, userId: me.id }) } } as MenuEntry] : []),
      { kind: 'sep' },
      { kind: 'item', label: 'Mute server', checked: !!prefs.muted, onClick: () => store.setGuildPrefs(guildId, { muted: !prefs.muted }) },
      { kind: 'label', text: 'Desktop notifications' },
      notify('all', 'All messages'),
      notify('mentions', 'Only @mentions'),
      notify('none', 'Nothing'),
      { kind: 'sep' },
      ...(allowed(Permission.ManageGuild) || allowed(Permission.ManageRoles) ? [{ kind: 'item', label: 'Server settings', icon: '⚙', onClick: open('server') } as MenuEntry] : []),
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
      entries.push(isFriend ? { kind: 'item', label: 'Remove friend', onClick: () => { void store.removeFriend(userId) } }
        : theyAsked ? { kind: 'item', label: 'Accept friend request', icon: '➕', onClick: () => { void store.addFriend(userId) } }
        : iAsked ? { kind: 'item', label: 'Cancel friend request', onClick: () => { void store.removeFriend(userId) } }
        : { kind: 'item', label: 'Add friend', icon: '➕', onClick: () => { void store.addFriend(userId) } })
      entries.push({ kind: 'sep' })
      entries.push({ kind: 'item', label: 'Mute their voice', checked: !!prefs.muted, onClick: () => store.setUserPrefs(userId, { muted: !prefs.muted }) })
      entries.push({ kind: 'slider', label: 'Voice volume', min: 0, max: 200, step: 5, value: Math.round((prefs.volume ?? 1) * 100), format: v => v + '%', onChange: v => store.setUserPrefs(userId, { volume: v / 100 }) })
    }
    entries.push({ kind: 'item', label: 'Ignore', checked: !!prefs.ignored, onClick: () => store.setUserPrefs(userId, { ignored: !prefs.ignored }) })
    if (member && g && userId !== g.guild.ownerId && can(Permission.ManageGuild)) {
      entries.push({ kind: 'sep' })
      entries.push({ kind: 'item', label: 'Change nickname', onClick: () => setDialog({ kind: 'nickname', guildId: g.guild.id, userId }) })
    }
    if (member && g && userId !== g.guild.ownerId && !isBot && (can(Permission.KickMembers) || can(Permission.BanMembers))) {
      entries.push({ kind: 'sep' })
      if (can(Permission.KickMembers)) entries.push({ kind: 'item', label: 'Kick from ' + g.guild.name, danger: true, onClick: () => setDialog({ kind: 'kick', member }) })
      if (can(Permission.BanMembers)) entries.push({ kind: 'item', label: 'Ban from ' + g.guild.name, danger: true, onClick: () => setDialog({ kind: 'ban', member }) })
    }
    return entries
  }
  const dmUnreadTotal = Object.values(store.dmUnread).reduce((a, b) => a + b, 0) + requests.length
  const s = store.stats

  /** Voice channel click: join (if not already there) and open its chat. */
  const openVoice = (channelId: string) => {
    store.selectChannel(channelId)
    if (voice?.channelId !== channelId) void store.joinVoice(channelId)
  }

  return (
    <div className="shell">
      {/* ===== Guild rail ===== */}
      <div className="rail">
        <button className={'guild home' + (store.home ? ' active' : '')} title="Friends & direct messages" onClick={store.openHome}>
          🏠{dmUnreadTotal > 0 && <span className="badge">{dmUnreadTotal}</span>}
        </button>
        <div className="sep" />
        {store.guilds.map(x => (
          <button key={x.guild.id} className={'guild' + (x.guild.id === g?.guild.id ? ' active' : '') + (store.settings.guilds?.[x.guild.id]?.muted ? ' muted' : '')}
            title={x.guild.name + (store.settings.guilds?.[x.guild.id]?.muted ? ' (muted)' : '') + ' — right-click for options'}
            onClick={() => store.selectGuild(x.guild.id)} onContextMenu={e => openGuildMenu(e, x.guild.id)}>
            {x.guild.iconUrl ? <img src={x.guild.iconUrl} alt="" /> : initials(x.guild.name)}
            {x.unread > 0 && <span className="badge">{x.unread}</span>}
          </button>
        ))}
        <div className="spacer" />
        <button className="guild" title="Create a server" onClick={() => setDialog({ kind: 'createGuild' })}>+</button>
        <button className="guild" title="Join with an invite code" onClick={() => setDialog({ kind: 'joinGuild' })}>⇲</button>
      </div>

      {/* ===== Channels (or DMs) + user panel ===== */}
      <div className="sidebar">
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
                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: (store.dmUnread[d.channelId] ?? 0) > 0 ? 600 : undefined }}><UserName who={store.appearanceOf(d.other.id)} label={shownName(d.other)} /></span>
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
              const settings = can(Permission.ManageGuild) || can(Permission.ManageRoles)
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
              {g && channelRows(g.channels).map(c => c.type === ChannelType.Category
                ? <div key={c.id} className="category">{c.name}</div>
                : (
                  <div key={c.id}>
                    <div
                      className={'channel' + (c.id === store.selectedChannel?.id ? ' active' : '') + ((g.channelUnread[c.id] ?? 0) > 0 ? ' unread' : '')}
                      style={c.id === voice?.channelId ? { color: 'var(--green)' } : undefined}
                      title={c.type === ChannelType.Voice ? 'Click to join voice and open its chat' : undefined}
                      onClick={() => c.type === ChannelType.Text ? store.selectChannel(c.id) : openVoice(c.id)}>
                      <span className="muted">{c.type === ChannelType.Text ? '#' : '🔊'}</span>
                      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
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
                              {p.muted && <span title="Microphone muted">🔇</span>}
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

        <div className="userpanel">
          <div className="row">
            <Avatar who={mine} name={me ? shownName(me) : '?'} serverUrl={serverUrl} size={34} animate="always" speaking={store.isSpeaking} title="Your profile · right-click for more"
              onClick={e => me && openCard(e, me.id, shownName(me))} onContextMenu={e => me && openUserMenu(e, me.id, shownName(me))} />
            <div className="grow self" title="Your profile · right-click for more" onClick={e => me && openCard(e, me.id, shownName(me))} onContextMenu={e => me && openUserMenu(e, me.id, shownName(me))}>
              <div className="selfname"><UserName who={mine} label={me ? nameIn(me.id, shownName(me)) : ''} /></div>
              <div className="muted">{me?.displayName ? '@' + me.username + ' · ' : ''}{store.status}</div>
            </div>
            <button className="subtle" onClick={async () => { await store.signOut(); onSignedOut() }}>Sign out</button>
          </div>
          {voice && (
            <div className="voicepanel">
              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔊 {voiceChannelName}</div>
                <div className="muted" style={{ fontSize: 10 }}>{voiceStatus}</div>
              </div>
              <button className="subtle" onClick={store.leaveVoice}>Leave</button>
            </div>
          )}
          <div className="row">
            <button className="subtle" style={store.isMuted ? { color: 'var(--red)' } : undefined} onClick={store.toggleMute} title="Mute / unmute microphone">{store.isMuted ? '🔇 Unmute' : '🎙 Mute'}</button>
            <span className="grow" />
            <button className="subtle" onClick={() => setDialog({ kind: 'audio' })} title="Microphone, speakers, privacy">🎧 Audio</button>
          </div>
          <div className="statsline" title="Your roll stats on this device">
            <span>Avg {s.totalRolls ? (s.rollSum / s.totalRolls).toFixed(1) : '0.0'}</span>
            <span>W/L {s.losses ? (s.wins / s.losses).toFixed(2) : s.wins}</span>
            <span>100s {s.perfect100s}</span>
            <span>1s {s.ones}</span>
            <span>Rolls {s.totalRolls}</span>
          </div>
          <div className="toggles">
            <label className={'switch' + (desktop ? '' : ' disabled')} title={desktop ? 'Keep the small roll overlay on top of your game' : 'The in-game overlay needs the desktop app'}>
              <input type="checkbox" disabled={!desktop} checked={desktop && store.settings.overlayEnabled} onChange={e => store.updateSettings({ overlayEnabled: e.target.checked })} />
              <span className="track" /><span>Overlay</span>
            </label>
            <label className="switch" title="Show Roll, Need / Greed, Flip and RPS at the top of the chat. Slash commands, the overlay and hotkeys work either way.">
              <input type="checkbox" checked={store.settings.showRollButtons !== false} onChange={e => store.updateSettings({ showRollButtons: e.target.checked })} />
              <span className="track" /><span>Roll buttons</span>
            </label>
          </div>
        </div>
      </div>

      {/* ===== Chat / friends ===== */}
      {store.home && !store.selectedChannel
        ? <Friends store={store} />
        : <Chat store={store} openRollDialog={(rollKind: RollKind) => setDialog({ kind: 'startRoll', rollKind })} canRoll={g ? can(Permission.StartRolls) : !!store.selectedDm} colorOf={colorOf} onUserMenu={openUserMenu} isIgnored={ignored} onUserCard={openCard} nameIn={nameIn} />}

      {/* ===== Members ===== */}
      <div className="members">
        {store.home ? (
          <>
            <div className="header">Friends <span className="muted">{store.friends.friends.filter(f => f.online).length} online</span></div>
            <div className="list">
              {[...store.friends.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.user.username.localeCompare(b.user.username)).map(f => (
                <div key={f.user.id} className={'member' + (f.online ? ' online' : ' offline')} title="Click to message · right-click for options" onClick={() => store.openDm(f.user.id)} onContextMenu={e => openUserMenu(e, f.user.id, shownName(f.user))}>
                  <div className="row" style={{ gap: 0 }}><Avatar who={f.user} name={shownName(f.user)} serverUrl={serverUrl} size={28} /><div className="presence" /></div>
                  <div className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><UserName who={store.appearanceOf(f.user.id)} label={shownName(f.user)} /></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="header">Members <span className="muted">{g?.members.filter(m => m.online).length ?? 0} online</span></div>
            <div className="list">
              {g && [...g.members].sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)).map(m => (
                <div key={m.userId} className={'member' + (m.online ? ' online' : ' offline') + (ignored(m.userId) ? ' ignoredmember' : '')} title={'@' + m.username + ' — click for profile, right-click for options'}
                  onClick={e => openCard(e, m.userId, memberName(m))} onContextMenu={e => openUserMenu(e, m.userId, memberName(m))}>
                  <div className="row" style={{ gap: 0 }}><Avatar who={m} name={memberName(m)} serverUrl={serverUrl} size={28} speaking={speakingUsers.has(m.userId)} /><div className="presence" /></div>
                  <div className="grow" style={{ overflow: 'hidden' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><UserName who={store.appearanceOf(m.userId)} label={memberName(m)} roleColor={roleColor(m.userId, g)} /> {m.isBot && <span className="tag" style={{ fontSize: 10, background: 'var(--accent)', borderRadius: 3, padding: '0 4px', color: '#fff' }}>BOT</span>}</div>
                    <div className="role">{roleLabel(m, g)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {dialog?.kind === 'createGuild' && <PromptDialog title="Create a server" label="Server name" onSubmit={store.createGuild} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'joinGuild' && <PromptDialog title="Join a server" label="Invite code" onSubmit={store.joinGuild} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'createChannel' && g && <CreateChannelDialog initialType={dialog.category ? ChannelType.Category : ChannelType.Text} categories={g.channels.filter(c => c.type === ChannelType.Category)} onSubmit={store.createChannel} onClose={() => setDialog(null)} />}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.kind === 'guild' ? guildEntries(menu.guildId) : userEntries(menu.userId, menu.username)} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'kick' && <ConfirmDialog title={`Kick ${dialog.member.username}?`} message="They can rejoin with an invite." onConfirm={() => store.kickMember(dialog.member)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'ban' && <ConfirmDialog title={`Ban ${dialog.member.username}?`} message="They will not be able to rejoin." onConfirm={() => store.banMember(dialog.member)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'audio' && (
        <AudioSettingsDialog inputId={store.settings.audioInputDeviceId} outputId={store.settings.audioOutputDeviceId} protectIp={store.settings.protectIp}
          onSave={store.setAudioDevices} onProtectIp={store.setProtectIp} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'overlay' && (
        <OverlaySettingsDialog settings={store.settings} onChange={store.updateSettings} packs={soundPackNames(store.soundPacks)}
          onOpenSounds={store.openSoundsFolder} onReloadSounds={store.reloadSoundPacks} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'server' && g && (
        <ServerSettingsDialog guild={g.guild} roles={g.roles ?? []} members={g.members} myPermissions={myPerms} meId={me?.id ?? ''}
          onRename={store.renameGuild} onIcon={store.setGuildIcon} onCreateRole={store.createRole} onUpdateRole={store.updateRole} onDeleteRole={store.deleteRole} onSetMemberRoles={store.setMemberRoles}
          onClose={() => setDialog(null)} />
      )}
      {store.voiceNotice && <VoiceNoticeDialog reason={store.voiceNotice.reason} onContinue={store.acknowledgeVoiceNotice} onClose={store.dismissVoiceNotice} />}
    </div>
  )
}

// ---- Chat column ------------------------------------------------------------

function Chat({ store, openRollDialog, canRoll, colorOf, onUserMenu, isIgnored, onUserCard, nameIn }: {
  store: Store; openRollDialog: (kind: RollKind) => void; canRoll: boolean; colorOf: (userId: string) => string | undefined
  onUserMenu: (e: React.MouseEvent, userId: string, username: string) => void; isIgnored: (userId: string) => boolean
  onUserCard: (e: React.MouseEvent, userId: string, name: string) => void; nameIn: (userId: string, fallback: string) => string
}) {
  // Messages from someone you ignore are folded away; this remembers the ones you chose to look at anyway.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const channel = store.selectedChannel
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

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    for (const f of Array.from(e.dataTransfer.files)) if (f.type.startsWith('image/')) await store.sendImage(f)
  }

  return (
    <div className="chat" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <div className="header">
        <span className="muted">{channel?.type === ChannelType.Voice ? '🔊' : channel?.type === ChannelType.DirectMessage ? '@' : '#'}</span><span>{channel?.name ?? 'Pick a channel'}</span>
        {channel?.type === ChannelType.DirectMessage && <span style={{ width: 8, height: 8, borderRadius: 4, background: store.selectedDm?.online ? 'var(--green)' : '#555566', display: 'inline-block' }} title={store.selectedDm?.online ? 'Online' : 'Offline'} />}
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
          : <Message key={m.id} m={m} color={colorOf(m.authorId)} icon={store.itemIcon(m.roll?.item)} serverUrl={store.settings.serverUrl}
              author={m.webhookId ? null : store.appearanceOf(m.authorId)} name={m.webhookId ? m.authorName : nameIn(m.authorId, m.authorName)}
              mention={m.authorId !== me?.id && store.mentionsMe(m.content)}
              onUserMenu={m.webhookId ? undefined : e => onUserMenu(e, m.authorId, m.authorName)} onUserCard={m.webhookId ? undefined : e => onUserCard(e, m.authorId, m.authorName)} />)}
      </div>

      {store.pendingDrops[0] && !store.pendingDrops[0].auto && <DropBanner drop={store.pendingDrops[0]} more={store.pendingDrops.length - 1} channel={store.partyChannel} onAccept={store.acceptDrop} onDismiss={store.dismissDrop} />}
      {store.activeRoll && <RollPanel store={store} meId={me?.id ?? ''} />}
      {store.activeRps && <RpsPanel store={store} meId={me?.id ?? ''} />}

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
        <div className="composer">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) await store.sendImage(f); e.target.value = '' }} />
          <button title="Send an image (or drop one here)" onClick={() => fileRef.current?.click()} disabled={!channel}>📎</button>
          <textarea
            placeholder={channel ? `Message ${channel.type === ChannelType.DirectMessage ? '@' : '#'}${channel.name}  —  type / for commands` : ''}
            value={text} disabled={!channel} rows={1}
            onChange={e => { setText(e.target.value); if (e.target.value) store.notifyTyping() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
          />
          <button className="accent" onClick={submit} disabled={!channel}>Send</button>
        </div>
      </div>
    </div>
  )
}

function Message({ m, color, icon, serverUrl, mention, author, name, onUserMenu, onUserCard }: {
  m: MessageDto; color?: string; icon?: string | null; serverUrl: string; mention?: boolean
  /** How the author looks, when we know them (null for webhooks and people no longer around). */
  author: Appearance | null; name: string
  onUserMenu?: (e: React.MouseEvent) => void; onUserCard?: (e: React.MouseEvent) => void
}) {
  const time = new Date(m.createdAt)
  const timeText = time.toDateString() === new Date().toDateString() ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className={'message' + (m.ephemeral ? ' ephemeral' : '') + (mention ? ' mention' : '')}>
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
          ) : m.kind === MessageKind.Dice ? (
            <div className="row">🎲 rolled <b style={{ fontSize: 18 }}>{m.content}</b> <span className="muted">({m.dice?.min ?? 1}–{m.dice?.max ?? 100})</span></div>
          ) : m.kind === MessageKind.CoinFlip ? (
            <div className="row"><img src={m.content === 'Tails' ? '/coin_tails.png' : '/coin_heads.png'} width={40} height={40} alt="" /> flipped a coin — <b>{m.content}</b></div>
          ) : <div className="body">{m.content}</div>}
        {m.attachments.filter(a => a.contentType.startsWith('image/')).map(a => <img key={a.id} className="attachment" src={a.url} alt={a.fileName} title={a.fileName} />)}
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
