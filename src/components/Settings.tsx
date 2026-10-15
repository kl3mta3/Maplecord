import { SoundCustomizer, type SoundChoice } from './SoundSettings'
import { defaultPackZip } from '../soundPackZip'
import type { SoundEvent } from '../soundTypes'
import type { ExpressionGroupDto } from '../types'
import { GuildExpressionsTab } from './Expressions'
import { TagSettings } from './Tags'
import { Fragment, useEffect, useRef, useState } from 'react'
import { isElectron } from '../platform'
import { ChannelType, Permission, hasPermission, type ApplicationDto, type ChannelDto, type GuildDto, type MemberDto, type RoleDto } from '../types'
import type { Api } from '../api'
import { Dialog } from './Dialogs'
import { BotCommandsDialog, ServerBotsTab, WebhooksTab } from './Integrations'
import { ListingSettings } from './Servers'

// ---- Overlay / roll settings ---------------------------------------------------

export function OverlaySettingsDialog({ settings, onChange, packs, onOpenSounds, onReloadSounds, onImport, onDelete, loadSounds, onClose }: {
  settings: { soundEnabled: boolean; soundProfile: string; overlayEnabled: boolean; soundChoices?: Partial<Record<SoundEvent, SoundChoice>> }
  onChange: (patch: Partial<{ soundEnabled: boolean; soundProfile: string; overlayEnabled: boolean; soundChoices: Partial<Record<SoundEvent, SoundChoice>> }>) => void
  /** "Default" plus the packs the user added. */
  packs: string[]; onOpenSounds: () => void; onReloadSounds: () => void
  /** A pack from a zip (desktop app), and taking one away. */
  onImport: (zip: File) => Promise<void>; onDelete: (name: string) => Promise<void>
  /** The soundboard sounds one can choose for a moment. */
  loadSounds: () => Promise<ExpressionGroupDto[]>
  onClose: () => void
}) {
  const desktop = isElectron()
  const chosen = packs.includes(settings.soundProfile) ? settings.soundProfile : packs[0]
  const [customizing, setCustomizing] = useState(false)
  const zipRef = useRef<HTMLInputElement>(null)
  const choices = settings.soundChoices ?? {}
  const downloadDefault = async () => {
    const zip = await defaultPackZip()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(zip); link.download = 'Maplecord default sounds.zip'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  }
  if (customizing) return <SoundCustomizer pack={chosen} chosen={choices} loadSounds={loadSounds} onChange={soundChoices => onChange({ soundChoices })} onClose={() => setCustomizing(false)} />
  return (
    <Dialog title="Overlay settings" onClose={onClose}>
      <label className="row">
        <input type="checkbox" checked={settings.overlayEnabled} onChange={e => onChange({ overlayEnabled: e.target.checked })} />
        <span>In-game overlay <span className="muted">— a small die stays on top of your game; click it to roll, flip or throw (desktop app only)</span></span>
      </label>
      <label className="row">
        <input type="checkbox" checked={settings.soundEnabled} onChange={e => onChange({ soundEnabled: e.target.checked })} />
        <span>Roll sounds</span>
      </label>
      <div className="muted">Sound pack</div>
      <div className="row">
        <select className="grow" value={chosen} onChange={e => onChange({ soundProfile: e.target.value })}>
          {packs.map(p => <option key={p}>{p}</option>)}
        </select>
        {desktop && <button className="subtle" onClick={onOpenSounds} title="Each folder in here is a pack: roll.wav, win.wav, lose.wav, you100.wav, one.wav, sixtyNine.wav, they100.wav, emo.wav, join.wav, leave.wav, message.wav, drop.wav, removed.wav, watch.wav, unwatch.wav">Open sounds folder</button>}
        {desktop && <button className="subtle" onClick={onReloadSounds}>Reload</button>}
      </div>
      <div className="row">
        <button onClick={() => setCustomizing(true)}>Customize sounds{Object.keys(choices).length > 0 ? ` (${Object.keys(choices).length} chosen)` : ''}</button>
        <span className="muted small grow">Choose a soundboard sound for any moment: a win, a 100, a message.</span>
      </div>
      {desktop && (
        <div className="row">
          <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await onImport(f) }} />
          <button onClick={() => zipRef.current?.click()}>Import a pack (.zip)</button>
          <button className="subtle" onClick={() => void downloadDefault()}>Download the default pack</button>
          {chosen !== 'Default' && <button className="subtle danger" onClick={() => void onDelete(chosen)}>Delete {chosen}</button>}
        </div>
      )}
      {desktop && <div className="muted">A pack is a zip of sounds named after their moments (win.wav, lose.mp3, emo.ogg…). The default pack shows every name; change the sounds, zip them again and import. Packs stay on this computer.</div>}
      <div className="muted" style={{ marginTop: 6 }}>Hotkeys while a game has focus: <b>Ctrl+Alt+R</b> roll / need (or start a roll), <b>Ctrl+Alt+G</b> greed, <b>Ctrl+Alt+P</b> pass.</div>
      <div className="buttons"><button className="accent" onClick={onClose}>Done</button></div>
    </Dialog>
  )
}

// ---- Server settings ---------------------------------------------------------------

/** Everything a role can allow, in the groups the role editor shows them under. */
export const PERMISSION_LABELS: { group: string; bit: number; name: string; hint: string }[] = [
  { group: 'General', bit: Permission.ViewChannels, name: 'View channels', hint: 'See channels and read messages' },
  { group: 'General', bit: Permission.CreateInvites, name: 'Create invites', hint: '' },
  { group: 'General', bit: Permission.StartRolls, name: 'Start rolls', hint: 'Rolls, need/greed, flips, RPS, /dice' },
  { group: 'General', bit: Permission.WearTag, name: 'Wear the server tag', hint: 'Pick this server\'s tag to show beside their name. Someone who loses this stops wearing it' },
  { group: 'Text', bit: Permission.SendMessages, name: 'Send messages', hint: '' },
  { group: 'Text', bit: Permission.AttachFiles, name: 'Attach files', hint: 'Images and uploads' },
  { group: 'Server', bit: Permission.ManageExpressions, name: 'Manage emojis, stickers and sounds', hint: 'Add the server\'s own (new ones, or from their library) and take them off it' },
  { group: 'Voice', bit: Permission.UseSoundboard, name: 'Use the soundboard', hint: 'Play the server\'s sounds in its voice channels' },
  { group: 'Text', bit: Permission.ManageMessages, name: 'Manage messages', hint: 'Delete other people\'s messages' },
  { group: 'Voice', bit: Permission.JoinVoice, name: 'Join voice', hint: '' },
  { group: 'Voice', bit: Permission.Speak, name: 'Speak', hint: '' },
  { group: 'Voice', bit: Permission.Stream, name: 'Stream', hint: 'Share screen' },
  { group: 'Calendar', bit: Permission.PostEvents, name: 'Post events', hint: 'Put events on a calendar channel, and change or remove their own' },
  { group: 'Calendar', bit: Permission.ShareEvents, name: 'Share events', hint: 'Post an event from a calendar into text channels and forums they can write in' },
  { group: 'P2P', bit: Permission.ManageDirectChannels, name: 'Create P2P channels', hint: 'Make a voice channel P2P or relayed (also needs Manage channels)' },
  { group: 'P2P', bit: Permission.JoinDirectVoice, name: 'Join P2P channels', hint: 'Join a P2P voice channel (also needs Join voice, and P2P allowed on their own account)' },
  { group: 'P2P', bit: Permission.UseRelayInDirect, name: 'Use the relay in P2P channels', hint: 'Connect through the relay there when a direct connection cannot be made, or to keep their address from the others. Relayed limits apply. Without it, P2P channels are direct only' },
  { group: 'P2P', bit: Permission.StreamDirect, name: 'Stream in P2P channels', hint: 'Share screen or camera in a P2P channel (also needs Stream)' },
  { group: 'Moderation', bit: Permission.KickMembers, name: 'Kick members', hint: '' },
  { group: 'Moderation', bit: Permission.BanMembers, name: 'Ban members', hint: '' },
  { group: 'Moderation', bit: Permission.MuteMembers, name: 'Mute members', hint: '' },
  { group: 'Moderation', bit: Permission.DisconnectMembers, name: 'Disconnect members', hint: 'Take someone out of a voice channel (right-click them). They can join again' },
  { group: 'Moderation', bit: Permission.MoveMembers, name: 'Move members', hint: 'Drag someone from one voice channel onto another. Never into or out of a P2P channel' },
  { group: 'Server', bit: Permission.ManageChannels, name: 'Manage channels', hint: 'Create, rename, delete, overrides' },
  { group: 'Server', bit: Permission.ManageRoles, name: 'Manage roles', hint: 'Only roles below your own' },
  { group: 'Server', bit: Permission.ManageWebhooks, name: 'Manage webhooks', hint: '' },
  { group: 'Server', bit: Permission.ManageGuild, name: 'Manage server', hint: 'Name, icon, bots' },
  { group: 'Server', bit: Permission.Administrator, name: 'Administrator', hint: 'Every permission, bypasses channel overrides' },
]
/** The groups, in the order they are shown. */
export const PERMISSION_GROUPS = [...new Set(PERMISSION_LABELS.map(p => p.group))]

const ROLE_SWATCHES = ['#9000ff', '#00ddff', '#ff008c', '#2cfc00', '#f19511', '#ff3b3b', '#ffd700', '#1abc9c', '#e91e63', '#3498db', '#95a5a6', '#ffffff']

export function ServerSettingsDialog({ api, channels, guild, roles, members, findMembers, moreMembers, myPermissions, meId, onRename, onIcon, onBanner, onOutside, onExpressionsChanged, onListing, tagSymbols, onSetTag, onRemoveTag, onCountRolls, onHideOwner, onWelcome, onCreateRole, onUpdateRole, onDeleteRole, onSetMemberRoles, onClose }: {
  api: Api; channels: ChannelDto[]
  guild: GuildDto; roles: RoleDto[]; members: MemberDto[]; myPermissions: number; meId: string
  /**
   * In a server with a great many members, `members` is not everyone. These fetch the ones whose name starts with
   * what was typed, and the next part of the list; whoever they bring arrives in `members`. `moreMembers` is left
   * out once the whole list was read.
   */
  findMembers?: (q: string) => Promise<unknown>
  moreMembers?: () => void
  onRename: (name: string) => Promise<void>
  onIcon: (file: File | null) => Promise<void>
  onBanner: (file: File | null) => Promise<void>
  /** Whether members may use emojis and stickers from outside this server. */
  onOutside: (allowed: boolean) => Promise<void>
  /** Something was added to the server or taken off it: pickers ask again. */
  onExpressionsChanged: () => void
  onListing: (patch: { isPublic: boolean; description: string; topics: string[]; featurable: boolean }) => Promise<void>
  /** The server's tag: the symbols one can carry, setting it, and taking it away. */
  tagSymbols: () => Promise<string[]>
  onSetTag: (guildId: string, text: string, symbol: string | null) => Promise<void>
  onRemoveTag: (guildId: string) => Promise<void>
  /** Whether rolls in this server's P2P channels add to people's roll totals. */
  onCountRolls: (guildId: string, countRolls: boolean) => Promise<void>
  onHideOwner: (guildId: string, hide: boolean) => Promise<void>
  /** The channel a line is posted in when someone joins (null for none), and whether one is posted. */
  onWelcome: (guildId: string, channelId: string | null, messages: boolean) => Promise<void>
  onCreateRole: (name: string, color: string | null, permissions: number) => Promise<void>
  onUpdateRole: (roleId: string, patch: { name?: string; color?: string | null; permissions?: number }) => Promise<void>
  onDeleteRole: (roleId: string) => Promise<void>
  onSetMemberRoles: (userId: string, roleIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const canGuild = hasPermission(myPermissions, Permission.ManageGuild)
  const canRoles = hasPermission(myPermissions, Permission.ManageRoles)
  const canHooks = hasPermission(myPermissions, Permission.ManageWebhooks)
  const canExpressions = hasPermission(myPermissions, Permission.ManageExpressions)
  const [tab, setTab] = useState<'overview' | 'roles' | 'members' | 'webhooks' | 'bots' | 'expressions'>(canGuild ? 'overview' : canRoles ? 'roles' : canHooks ? 'webhooks' : 'expressions')
  const [name, setName] = useState(guild.name)
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const sorted = [...roles].sort((a, b) => b.position - a.position)
  const [roleId, setRoleId] = useState<string>(sorted[0]?.id ?? '')
  const role = roles.find(r => r.id === roleId) ?? null
  // Local edits for the selected role, written back on "Save role".
  const [draft, setDraft] = useState<{ name: string; color: string | null; permissions: number } | null>(null)
  useEffect(() => { setDraft(role ? { name: role.name, color: role.color, permissions: role.permissions } : null) }, [role])
  const [memberId, setMemberId] = useState<string>('')
  const member = members.find(m => m.userId === memberId) ?? null
  const [memberQuery, setMemberQuery] = useState('')
  useEffect(() => {
    const q = memberQuery.trim()
    if (!findMembers || !q) return
    // Asked once the typing pauses, not at every letter.
    const wait = window.setTimeout(() => { void findMembers(q) }, 300)
    return () => window.clearTimeout(wait)
  }, [findMembers, memberQuery])
  const starts = memberQuery.trim().replace(/^@/, '').toLowerCase()
  const listedMembers = !findMembers || !starts ? members : members.filter(m => [m.username, m.nickname, m.displayName].some(n => n?.toLowerCase().startsWith(starts)))
  /** The bot whose command permissions are open. It takes the place of this dialog, and closing it comes back here. */
  const [managing, setManaging] = useState<ApplicationDto | null>(null)

  if (managing) return <BotCommandsDialog api={api} guildId={guild.id} bot={managing} roles={sorted.filter(r => !r.isEveryone)} members={members} channels={channels} onClose={() => setManaging(null)} />
  return (
    <Dialog title={`Server settings — ${guild.name}`} onClose={onClose} wide scrolls>
      <div className="tabs">
        {canGuild && <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>}
        {canRoles && <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles</button>}
        {canRoles && <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>}
        {canHooks && <button className={tab === 'webhooks' ? 'active' : ''} onClick={() => setTab('webhooks')}>Webhooks</button>}
        {canGuild && <button className={tab === 'bots' ? 'active' : ''} onClick={() => setTab('bots')}>Bots</button>}
        {(canExpressions || canGuild) && <button className={tab === 'expressions' ? 'active' : ''} onClick={() => setTab('expressions')}>Emojis & sounds</button>}
      </div>

      {tab === 'expressions' && <GuildExpressionsTab api={api} guildId={guild.id} meId={meId} mayManage={canExpressions} mayGuild={canGuild} isPublic={!!guild.isPublic}
        onOutside={async allowed => { await onOutside(allowed); onExpressionsChanged() }} />}

      {tab === 'webhooks' && <WebhooksTab api={api} guildId={guild.id} channels={channels} />}
      {tab === 'bots' && <ServerBotsTab api={api} guildId={guild.id} canManage={canGuild} onManage={canGuild ? setManaging : undefined}
        fullP2P={!!guild.fullP2P} hasP2PChannels={channels.some(c => !!c.directSince)}
        onRoles={canRoles ? botUserId => { setMemberId(botUserId); setTab('members') } : undefined} />}

      {tab === 'overview' && (
        <>
          <div className="row" style={{ gap: 14 }}>
            <div className="guildicon big" onClick={() => fileRef.current?.click()} title="Change icon">
              {guild.iconUrl ? <img src={guild.iconUrl} alt="" /> : <span>{initialsOf(guild.name)}</span>}
            </div>
            <div className="grow">
              <div className="muted">Server icon (png / jpg / gif / webp, up to 2 MB)</div>
              <div className="row" style={{ marginTop: 4 }}>
                <button onClick={() => fileRef.current?.click()}>Upload</button>
                {guild.iconUrl && <button className="subtle" onClick={() => onIcon(null)}>Remove</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) await onIcon(f); e.target.value = '' }} />
            </div>
          </div>
          {/* The banner: the picture over the top of the channel list, with the server's name on it. */}
          <div className="bannerpick" onClick={() => bannerRef.current?.click()} title="Change banner"
            style={guild.bannerUrl ? { backgroundImage: `url("${guild.bannerUrl}")` } : undefined}>
            {!guild.bannerUrl && <span className="muted">No banner</span>}
          </div>
          <div className="muted">Server banner, shown over the channel list (png / jpg / gif / webp, moving or not, up to 4 MB; about 960 × 540 looks best)</div>
          <div className="row">
            <button onClick={() => bannerRef.current?.click()}>Upload</button>
            {guild.bannerUrl && <button className="subtle" onClick={() => onBanner(null)}>Remove</button>}
            <input ref={bannerRef} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) await onBanner(f); e.target.value = '' }} />
          </div>
          <div className="muted">Server name</div>
          <div className="row">
            <input className="grow" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && onRename(name.trim())} />
            <button className="accent" disabled={!name.trim() || name.trim() === guild.name} onClick={() => onRename(name.trim())}>Save</button>
          </div>
          <ListingSettings key={`${guild.isPublic}|${guild.description ?? ''}|${(guild.topics ?? []).join(',')}|${!!guild.noFeature}`} isPublic={!!guild.isPublic} description={guild.description ?? ''} topics={guild.topics ?? []} featurable={!guild.noFeature} onSave={onListing} />
          <TagSettings guild={guild} people={members.filter(m => !m.isBot).length} symbols={tagSymbols}
            onSave={(text, symbol) => onSetTag(guild.id, text, symbol)} onRemove={() => onRemoveTag(guild.id)} />
          {/* Where newcomers are greeted. Only an ordinary text channel can be it: nothing can be posted for anyone in a P2P one. */}
          {(() => {
            const places = channels.filter(c => c.type === ChannelType.Text && !c.directSince)
            const picked = places.find(c => c.id === guild.welcomeChannelId)?.id ?? ''
            return (
              <div className="tagsettings">
                <div className="muted">Welcome</div>
                {places.length === 0 ? <div className="muted">This server has no ordinary text channel to welcome people in.</div> : (
                  <>
                    <label className="row">
                      <span>Welcome channel</span>
                      <select value={picked} onChange={e => void onWelcome(guild.id, e.target.value || null, !!e.target.value && !!guild.welcomeMessages)} aria-label="Welcome channel">
                        <option value="">None</option>
                        {places.map(c => <option key={c.id} value={c.id}># {c.name}</option>)}
                      </select>
                    </label>
                    <div className="muted">Someone who has just joined is taken to this channel first, if they can see it.</div>
                    <label className="row" style={{ alignItems: 'flex-start' }}>
                      <input type="checkbox" disabled={!picked} checked={!!picked && !!guild.welcomeMessages} onChange={e => void onWelcome(guild.id, picked || null, e.target.checked)} />
                      <span>Post a welcome message there when someone joins
                        <span className="muted" style={{ display: 'block' }}>A line such as "@Name has joined the server.", one of a few picked at random. Bots are not welcomed.</span>
                      </span>
                    </label>
                  </>
                )}
              </div>
            )
          })()}
          {/* The owner's own choice, so it is only offered to the owner. */}
          {guild.ownerId === meId && (
            <div className="tagsettings">
              <div className="muted">Owner</div>
              <label className="row" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={!!guild.hideOwnerRole} onChange={e => void onHideOwner(guild.id, e.target.checked)} />
                <span>Do not show me as the owner in the member list
                  <span className="muted" style={{ display: 'block' }}>Under your name the list shows your highest role instead of "Owner", as it does for everyone else. You still own the server and can do everything an owner can.</span>
                </span>
              </label>
            </div>
          )}
          {/* Only a server with P2P channels has this to decide: everywhere else rolls are counted, as their results are kept. */}
          {channels.some(c => c.directSince) && (
            <div className="tagsettings">
              <div className="muted">Roll stats</div>
              <label className="row" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={!guild.noRollStats} onChange={e => void onCountRolls(guild.id, e.target.checked)} />
                <span>Count rolls in this server's P2P channels towards people's roll stats
                  <span className="muted" style={{ display: 'block' }}>The server keeps each person's own running totals (rolls, average, wins and losses) and nothing else about a roll here: not what it was for, who else was in it, or when.</span>
                </span>
              </label>
            </div>
          )}
        </>
      )}

      {tab === 'roles' && (
        <div className="roles">
          <div className="rolelist">
            {sorted.map(r => (
              <div key={r.id} className={'r' + (r.id === roleId ? ' sel' : '')} onClick={() => setRoleId(r.id)}>
                <span className="swatch" style={{ background: r.color ?? 'var(--muted)' }} />
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.color ?? undefined }}>{r.name}</span>
              </div>
            ))}
            <button className="subtle" style={{ margin: 4 }} onClick={() => onCreateRole('new role', null, Permission.ViewChannels | Permission.SendMessages)}>+ New role</button>
          </div>
          {role && draft ? (
            <div className="roleedit">
              <div className="muted">Name</div>
              <input value={draft.name} disabled={role.isEveryone} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              <div className="muted">Color</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className={'swatch pick' + (draft.color === null ? ' sel' : '')} style={{ background: 'var(--muted)' }} title="No color" onClick={() => setDraft({ ...draft, color: null })} />
                {ROLE_SWATCHES.map(c => <span key={c} className={'swatch pick' + (draft.color?.toLowerCase() === c ? ' sel' : '')} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} />)}
                <input type="color" value={draft.color ?? '#9000ff'} onChange={e => setDraft({ ...draft, color: e.target.value })} title="Custom color" style={{ width: 36, height: 24, padding: 0 }} />
              </div>
              <div className="muted">Permissions</div>
              <div className="perms">
                {PERMISSION_GROUPS.map(group => (
                  <Fragment key={group}>
                    <div className="permgroup">{group}</div>
                    {PERMISSION_LABELS.filter(p => p.group === group).map(p => (
                      <label key={p.bit} className="row" title={p.hint}>
                        <input type="checkbox" checked={(draft.permissions & p.bit) !== 0} onChange={e => setDraft({ ...draft, permissions: e.target.checked ? draft.permissions | p.bit : draft.permissions & ~p.bit })} />
                        <span>{p.name}</span>
                      </label>
                    ))}
                  </Fragment>
                ))}
              </div>
              <div className="buttons" style={{ justifyContent: 'space-between' }}>
                {!role.isEveryone ? <button className="subtle" style={{ color: 'var(--red)' }} onClick={() => onDeleteRole(role.id)}>Delete role</button> : <span className="muted">@everyone is the baseline for all members</span>}
                <button className="accent" onClick={() => onUpdateRole(role.id, { name: draft.name.trim() || role.name, color: draft.color, permissions: draft.permissions })}>Save role</button>
              </div>
            </div>
          ) : <div className="muted">Pick a role</div>}
        </div>
      )}

      {tab === 'members' && (
        <div className="roles">
          <div className="rolelist">
            {findMembers && <input value={memberQuery} onChange={e => setMemberQuery(e.target.value)} placeholder="Find a member" maxLength={32} spellCheck={false} style={{ marginBottom: 6 }} />}
            {/* People first, then bots: a bot is a member, and what it may do is set with roles like anyone else. */}
            {[...listedMembers].sort((a, b) => Number(!!a.isBot) - Number(!!b.isBot) || a.username.localeCompare(b.username)).map(m => (
              <div key={m.userId} className={'r' + (m.userId === memberId ? ' sel' : '')} onClick={() => setMemberId(m.userId)}>
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nickname || m.username}{m.userId === guild.ownerId ? ' 👑' : ''}</span>
                {m.isBot && <span className="bottag">BOT</span>}
              </div>
            ))}
            {findMembers && starts && listedMembers.length === 0 && <div className="muted" style={{ padding: 6 }}>Nobody by that name</div>}
            {moreMembers && !starts && <button className="subtle" style={{ marginTop: 6 }} onClick={moreMembers}>Show more people</button>}
          </div>
          {member ? (
            <div className="roleedit">
              <div className="muted">Roles for {member.username}{member.userId === meId ? ' (you)' : ''}</div>
              {/* The owner's roles change nothing of what they may do; they are only how the owner looks to others, so only the owner sets them. */}
              {member.userId === guild.ownerId && <div className="muted small">{meId === guild.ownerId
                ? 'As the owner you can do everything whatever roles you have. Roles only change how you look to others.'
                : 'Only the owner chooses the owner\'s roles.'}</div>}
              {sorted.filter(r => !r.isEveryone).map(r => {
                const has = (member.roleIds ?? []).includes(r.id)
                return (
                  <label key={r.id} className="row">
                    <input type="checkbox" checked={has} disabled={member.userId === guild.ownerId && meId !== guild.ownerId} onChange={e => onSetMemberRoles(member.userId, e.target.checked ? [...(member.roleIds ?? []), r.id] : (member.roleIds ?? []).filter(x => x !== r.id))} />
                    <span className="swatch" style={{ background: r.color ?? 'var(--muted)' }} /><span style={{ color: r.color ?? undefined }}>{r.name}</span>
                  </label>
                )
              })}
              {sorted.filter(r => !r.isEveryone).length === 0 && <div className="muted">No roles yet — create one on the Roles tab.</div>}
            </div>
          ) : <div className="muted">Pick a member</div>}
        </div>
      )}
      <div className="buttons"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}
