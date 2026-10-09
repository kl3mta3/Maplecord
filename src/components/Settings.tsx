import { TagSettings } from './Tags'
import { useEffect, useRef, useState } from 'react'
import { isElectron } from '../platform'
import { Permission, hasPermission, type ChannelDto, type GuildDto, type MemberDto, type RoleDto } from '../types'
import type { Api } from '../api'
import { Dialog } from './Dialogs'
import { ServerBotsTab, WebhooksTab } from './Integrations'
import { ListingSettings } from './Servers'

// ---- Overlay / roll settings ---------------------------------------------------

export function OverlaySettingsDialog({ settings, onChange, packs, onOpenSounds, onReloadSounds, onClose }: {
  settings: { soundEnabled: boolean; soundProfile: string; overlayEnabled: boolean }
  onChange: (patch: Partial<{ soundEnabled: boolean; soundProfile: string; overlayEnabled: boolean }>) => void
  /** "Default" plus the packs the user added. */
  packs: string[]; onOpenSounds: () => void; onReloadSounds: () => void
  onClose: () => void
}) {
  const desktop = isElectron()
  const chosen = packs.includes(settings.soundProfile) ? settings.soundProfile : packs[0]
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
        {desktop && <button className="subtle" onClick={onOpenSounds} title="Each folder in here is a pack: roll.wav, win.wav, lose.wav, you100.wav, one.wav, sixtyNine.wav, they100.wav, emo.wav, join.wav, leave.wav">Open sounds folder</button>}
        {desktop && <button className="subtle" onClick={onReloadSounds}>Reload</button>}
      </div>
      {desktop && <div className="muted">Add your own: put a folder of sounds in the sounds folder and press Reload. They stay on this computer.</div>}
      <div className="muted" style={{ marginTop: 6 }}>Hotkeys while a game has focus: <b>Ctrl+Alt+R</b> roll / need (or start a roll), <b>Ctrl+Alt+G</b> greed, <b>Ctrl+Alt+P</b> pass.</div>
      <div className="buttons"><button className="accent" onClick={onClose}>Done</button></div>
    </Dialog>
  )
}

// ---- Server settings ---------------------------------------------------------------

export const PERMISSION_LABELS: { bit: number; name: string; hint: string }[] = [
  { bit: Permission.ViewChannels, name: 'View channels', hint: 'See channels and read messages' },
  { bit: Permission.SendMessages, name: 'Send messages', hint: '' },
  { bit: Permission.AttachFiles, name: 'Attach files', hint: 'Images and uploads' },
  { bit: Permission.ManageMessages, name: 'Manage messages', hint: 'Delete other people\'s messages' },
  { bit: Permission.StartRolls, name: 'Start rolls', hint: 'Rolls, need/greed, flips, RPS, /dice' },
  { bit: Permission.JoinVoice, name: 'Join voice', hint: '' },
  { bit: Permission.Speak, name: 'Speak', hint: '' },
  { bit: Permission.Stream, name: 'Stream', hint: 'Share screen' },
  { bit: Permission.CreateInvites, name: 'Create invites', hint: '' },
  { bit: Permission.ManageChannels, name: 'Manage channels', hint: 'Create, rename, delete, overrides' },
  { bit: Permission.ManageRoles, name: 'Manage roles', hint: 'Only roles below your own' },
  { bit: Permission.ManageWebhooks, name: 'Manage webhooks', hint: '' },
  { bit: Permission.ManageGuild, name: 'Manage server', hint: 'Name, icon, bots' },
  { bit: Permission.KickMembers, name: 'Kick members', hint: '' },
  { bit: Permission.BanMembers, name: 'Ban members', hint: '' },
  { bit: Permission.MuteMembers, name: 'Mute members', hint: '' },
  { bit: Permission.DisconnectMembers, name: 'Disconnect members', hint: 'Take someone out of a voice channel (right-click them). They can join again' },
  { bit: Permission.ManageDirectChannels, name: 'Create P2P channels', hint: 'Make a voice channel P2P or relayed (also needs Manage channels)' },
  { bit: Permission.JoinDirectVoice, name: 'Join P2P channels', hint: 'Join a P2P voice channel (also needs Join voice, and P2P allowed on their own account)' },
  { bit: Permission.UseRelayInDirect, name: 'Use the relay in P2P channels', hint: 'Connect through the relay there when a direct connection cannot be made, or to keep their address from the others. Relayed limits apply. Without it, P2P channels are direct only' },
  { bit: Permission.StreamDirect, name: 'Stream in P2P channels', hint: 'Share screen or camera in a P2P channel (also needs Stream)' },
  { bit: Permission.Administrator, name: 'Administrator', hint: 'Every permission, bypasses channel overrides' },
]

const ROLE_SWATCHES = ['#9000ff', '#00ddff', '#ff008c', '#2cfc00', '#f19511', '#ff3b3b', '#ffd700', '#1abc9c', '#e91e63', '#3498db', '#95a5a6', '#ffffff']

export function ServerSettingsDialog({ api, channels, guild, roles, members, myPermissions, meId, onRename, onIcon, onListing, tagSymbols, onSetTag, onRemoveTag, onCreateRole, onUpdateRole, onDeleteRole, onSetMemberRoles, onClose }: {
  api: Api; channels: ChannelDto[]
  guild: GuildDto; roles: RoleDto[]; members: MemberDto[]; myPermissions: number; meId: string
  onRename: (name: string) => Promise<void>
  onIcon: (file: File | null) => Promise<void>
  onListing: (patch: { isPublic: boolean; description: string; topics: string[] }) => Promise<void>
  /** The server's tag: the symbols one can carry, setting it, and taking it away. */
  tagSymbols: () => Promise<string[]>
  onSetTag: (guildId: string, text: string, symbol: string | null) => Promise<void>
  onRemoveTag: (guildId: string) => Promise<void>
  onCreateRole: (name: string, color: string | null, permissions: number) => Promise<void>
  onUpdateRole: (roleId: string, patch: { name?: string; color?: string | null; permissions?: number }) => Promise<void>
  onDeleteRole: (roleId: string) => Promise<void>
  onSetMemberRoles: (userId: string, roleIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const canGuild = hasPermission(myPermissions, Permission.ManageGuild)
  const canRoles = hasPermission(myPermissions, Permission.ManageRoles)
  const canHooks = hasPermission(myPermissions, Permission.ManageWebhooks)
  const [tab, setTab] = useState<'overview' | 'roles' | 'members' | 'webhooks' | 'bots'>(canGuild ? 'overview' : canRoles ? 'roles' : 'webhooks')
  const [name, setName] = useState(guild.name)
  const fileRef = useRef<HTMLInputElement>(null)
  const sorted = [...roles].sort((a, b) => b.position - a.position)
  const [roleId, setRoleId] = useState<string>(sorted[0]?.id ?? '')
  const role = roles.find(r => r.id === roleId) ?? null
  // Local edits for the selected role, written back on "Save role".
  const [draft, setDraft] = useState<{ name: string; color: string | null; permissions: number } | null>(null)
  useEffect(() => { setDraft(role ? { name: role.name, color: role.color, permissions: role.permissions } : null) }, [role])
  const [memberId, setMemberId] = useState<string>('')
  const member = members.find(m => m.userId === memberId) ?? null

  return (
    <Dialog title={`Server settings — ${guild.name}`} onClose={onClose} wide scrolls>
      <div className="tabs">
        {canGuild && <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>}
        {canRoles && <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles</button>}
        {canRoles && <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>}
        {canHooks && <button className={tab === 'webhooks' ? 'active' : ''} onClick={() => setTab('webhooks')}>Webhooks</button>}
        {canGuild && <button className={tab === 'bots' ? 'active' : ''} onClick={() => setTab('bots')}>Bots</button>}
      </div>

      {tab === 'webhooks' && <WebhooksTab api={api} guildId={guild.id} channels={channels} />}
      {tab === 'bots' && <ServerBotsTab api={api} guildId={guild.id} canManage={canGuild}
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
          <div className="muted">Server name</div>
          <div className="row">
            <input className="grow" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && onRename(name.trim())} />
            <button className="accent" disabled={!name.trim() || name.trim() === guild.name} onClick={() => onRename(name.trim())}>Save</button>
          </div>
          <ListingSettings key={`${guild.isPublic}|${guild.description ?? ''}|${(guild.topics ?? []).join(',')}`} isPublic={!!guild.isPublic} description={guild.description ?? ''} topics={guild.topics ?? []} onSave={onListing} />
          <TagSettings guild={guild} people={members.filter(m => !m.isBot).length} symbols={tagSymbols}
            onSave={(text, symbol) => onSetTag(guild.id, text, symbol)} onRemove={() => onRemoveTag(guild.id)} />
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
                {PERMISSION_LABELS.map(p => (
                  <label key={p.bit} className="row" title={p.hint}>
                    <input type="checkbox" checked={(draft.permissions & p.bit) !== 0} onChange={e => setDraft({ ...draft, permissions: e.target.checked ? draft.permissions | p.bit : draft.permissions & ~p.bit })} />
                    <span>{p.name}</span>
                  </label>
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
            {/* People first, then bots: a bot is a member, and what it may do is set with roles like anyone else. */}
            {[...members].sort((a, b) => Number(!!a.isBot) - Number(!!b.isBot) || a.username.localeCompare(b.username)).map(m => (
              <div key={m.userId} className={'r' + (m.userId === memberId ? ' sel' : '')} onClick={() => setMemberId(m.userId)}>
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nickname || m.username}{m.userId === guild.ownerId ? ' 👑' : ''}</span>
                {m.isBot && <span className="bottag">BOT</span>}
              </div>
            ))}
          </div>
          {member ? (
            <div className="roleedit">
              <div className="muted">Roles for {member.username}{member.userId === meId ? ' (you)' : ''}</div>
              {sorted.filter(r => !r.isEveryone).map(r => {
                const has = (member.roleIds ?? []).includes(r.id)
                return (
                  <label key={r.id} className="row">
                    <input type="checkbox" checked={has} onChange={e => onSetMemberRoles(member.userId, e.target.checked ? [...(member.roleIds ?? []), r.id] : (member.roleIds ?? []).filter(x => x !== r.id))} />
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
