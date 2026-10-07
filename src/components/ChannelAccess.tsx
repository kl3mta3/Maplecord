import { useState } from 'react'
import type { Api } from '../api'
import { ChannelType, Permission, type ChannelDto, type ChannelOverrideDto, type MemberDto, type RoleDto } from '../types'
import { Dialog } from './Dialogs'

const VIEW = Permission.ViewChannels

/** What a set of overrides says, in a form that can be compared. An override that allows and denies nothing says nothing. */
const said = (overrides: readonly ChannelOverrideDto[] | null | undefined) =>
  (overrides ?? []).filter(o => o.allow || o.deny).map(o => `${o.roleId ?? ''}|${o.userId ?? ''}|${o.allow}|${o.deny}`).sort().join(',')

/**
 * Who can see one channel, or one group of channels. A channel everyone can see is open; a private one is hidden from everyone except the
 * roles and people let in. Either way single roles and people can be let in or shut out. Someone who cannot see a
 * channel is not told it exists. The owner and administrators see every channel.
 *
 * Underneath these are the channel's permission overrides, of which only "View channels" is touched here: whatever
 * else an override allows or denies is kept.
 *
 * A group has a setting of its own. The channels in it are kept the same as the group until one is given its own
 * setting; from then on that channel stands alone, until it is told to match the group again.
 */
export function ChannelAccessDialog({ api, channel, group, inside, roles, members, onClose }: {
  api: Api; channel: ChannelDto
  /** The group this channel is in, if any. */
  group?: ChannelDto
  /** When this is a group: the channels in it. */
  inside?: ChannelDto[]
  roles: RoleDto[]; members: MemberDto[]; onClose: () => void
}) {
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const overrides = channel.overrides ?? []
  const everyone = roles.find(r => r.isEveryone)
  const forRole = (id: string) => overrides.find(o => o.roleId === id)
  const forUser = (id: string) => overrides.find(o => o.userId === id)
  const isPrivate = !!everyone && ((forRole(everyone.id)?.deny ?? 0) & VIEW) !== 0
  const isGroup = channel.type === ChannelType.Category
  const follows = !!group && said(overrides) === said(group.overrides)
  const standAlone = isGroup ? (inside ?? []).filter(c => said(c.overrides) !== said(overrides)) : []

  const matchGroup = async () => {
    setProblem(''); setBusy(true)
    try { await api.matchGroupAccess(channel.id) } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /** Sets or clears the "view" bit of one override, leaving the rest of it alone; an override left empty is removed. */
  const set = async (kind: 'role' | 'user', id: string, existing: ChannelOverrideDto | undefined, state: 'allow' | 'deny' | 'none') => {
    setProblem(''); setBusy(true)
    try {
      const allow = ((existing?.allow ?? 0) & ~VIEW) | (state === 'allow' ? VIEW : 0)
      const deny = ((existing?.deny ?? 0) & ~VIEW) | (state === 'deny' ? VIEW : 0)
      if (allow === 0 && deny === 0) { if (existing) await api.deleteChannelOverride(channel.id, existing.id) }
      else await api.setChannelOverride(channel.id, kind, id, allow, deny)
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const stateOf = (o: ChannelOverrideDto | undefined): 'allow' | 'deny' | 'none' => ((o?.allow ?? 0) & VIEW ? 'allow' : (o?.deny ?? 0) & VIEW ? 'deny' : 'none')
  const listed = [
    ...roles.filter(r => !r.isEveryone && stateOf(forRole(r.id)) !== 'none').map(r => ({ kind: 'role' as const, id: r.id, name: r.name, color: r.color, o: forRole(r.id) })),
    ...members.filter(m => stateOf(forUser(m.userId)) !== 'none').map(m => ({ kind: 'user' as const, id: m.userId, name: m.nickname || m.displayName || m.username, color: null, o: forUser(m.userId) })),
  ]
  const addable = [
    ...roles.filter(r => !r.isEveryone && stateOf(forRole(r.id)) === 'none').sort((a, b) => b.position - a.position).map(r => ({ value: 'role:' + r.id, label: 'Role: ' + r.name })),
    ...members.filter(m => stateOf(forUser(m.userId)) === 'none').sort((a, b) => a.username.localeCompare(b.username)).map(m => ({ value: 'user:' + m.userId, label: (m.nickname || m.displayName || m.username) + (m.isBot ? ' (bot)' : '') })),
  ]
  const add = (value: string) => {
    const [kind, id] = value.split(':') as ['role' | 'user', string]
    // In a private channel the point of adding someone is to let them in; in an open one, to shut them out.
    void set(kind, id, kind === 'role' ? forRole(id) : forUser(id), isPrivate ? 'allow' : 'deny')
  }

  return (
    <Dialog title={isGroup ? `Who can see the group ${channel.name}` : `Who can see ${channel.name}`} onClose={onClose}>
      <div className="access">
        <label className="choice"><input type="radio" name="access" checked={!isPrivate} disabled={busy || !everyone} onChange={() => everyone && void set('role', everyone.id, forRole(everyone.id), 'none')} />
          <span><b>Everyone in the server</b> <span className="muted">except anyone shut out below</span></span></label>
        <label className="choice"><input type="radio" name="access" checked={isPrivate} disabled={busy || !everyone} onChange={() => everyone && void set('role', everyone.id, forRole(everyone.id), 'deny')} />
          <span><b>Private</b> <span className="muted">only the roles and people let in below</span></span></label>
        <div className="muted">Someone who cannot see a channel is not shown that it exists. The owner and administrators see every channel.</div>
        {isGroup && (
          <div className="muted">
            {standAlone.length === 0
              ? 'Every channel in this group follows this setting.'
              : `Channels in this group follow this setting, except ${standAlone.map(c => c.name).join(', ')}: ${standAlone.length === 1 ? 'it has its' : 'they have their'} own.`}
          </div>
        )}
        {group && (
          <div className="row entry">
            <span className="grow muted">
              {follows
                ? `Same as its group, ${group.name}. Changing the group changes this channel too, until you change something here.`
                : `This channel has its own setting. Changes to its group, ${group.name}, do not reach it.`}
            </span>
            {!follows && <button disabled={busy} onClick={() => void matchGroup()}>Match the group</button>}
          </div>
        )}

        {listed.length === 0 && <div className="muted">{isPrivate ? 'Nobody has been let in yet.' : 'Nobody is shut out.'}</div>}
        {listed.map(row => (
          <div className="row entry" key={row.kind + row.id}>
            <span className="grow" style={{ color: row.color ?? undefined }}>{row.kind === 'role' ? 'Role: ' : ''}{row.name}</span>
            <select value={stateOf(row.o)} disabled={busy} aria-label={`Access for ${row.name}`} onChange={e => void set(row.kind, row.id, row.o, e.target.value as 'allow' | 'deny' | 'none')}>
              <option value="allow">Can see it</option>
              <option value="deny">Cannot see it</option>
              <option value="none">Remove (same as everyone)</option>
            </select>
          </div>
        ))}
        {addable.length > 0 && (
          <select value="" disabled={busy} aria-label="Add a role or person" onChange={e => { if (e.target.value) add(e.target.value) }}>
            <option value="">{isPrivate ? 'Let in a role or person…' : 'Shut out a role or person…'}</option>
            {addable.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        )}
        {problem && <div className="muted bad">{problem}</div>}
      </div>
      <div className="buttons"><button onClick={onClose}>Done</button></div>
    </Dialog>
  )
}
