import { useState } from 'react'
import type { Api } from '../api'
import { ChannelType, Permission, type ChannelDto, type ChannelOverrideDto, type MemberDto, type RoleDto } from '../types'
import { Dialog } from './Dialogs'

/** What a set of overrides says, in a form that can be compared. An override that allows and denies nothing says nothing. */
const said = (overrides: readonly ChannelOverrideDto[] | null | undefined) =>
  (overrides ?? []).filter(o => o.allow || o.deny).map(o => `${o.roleId ?? ''}|${o.userId ?? ''}|${o.allow}|${o.deny}`).sort().join(',')

/** The words for one thing a channel can let people do or keep them from: seeing it, or writing in it. */
interface Wording {
  /** What the section is called. */
  heading: string
  /** The two choices for everyone, each with what it leaves to the list below. */
  open: [string, string]; closed: [string, string]
  allow: string; deny: string
  /** What the list says when it is empty, and what adding to it is called, with the channel open and with it closed. */
  noneOpen: string; noneClosed: string; addOpen: string; addClosed: string
  note: string
}

const SEE: Wording = {
  heading: 'Who can see it',
  open: ['Everyone in the server', 'except anyone shut out below'], closed: ['Private', 'only the roles and people let in below'],
  allow: 'Can see it', deny: 'Cannot see it',
  noneOpen: 'Nobody is shut out.', noneClosed: 'Nobody has been let in yet.', addOpen: 'Shut out a role or person…', addClosed: 'Let in a role or person…',
  note: 'Someone who cannot see a channel is not shown that it exists. The owner and administrators see every channel.',
}

const WRITE: Wording = {
  heading: 'Who can write in it',
  open: ['Everyone who may send messages', 'except anyone held to reading below'], closed: ['Read-only', 'only the roles and people allowed below can write'],
  allow: 'Can write', deny: 'Read-only',
  noneOpen: 'Nobody is held to reading.', noneClosed: 'Nobody has been allowed to write yet.', addOpen: 'Hold a role or person to reading…', addClosed: 'Let a role or person write…',
  note: 'Read-only means reading and reacting, but no messages, replies, posts or files. The owner and administrators can always write.',
}

/**
 * A channel's own permissions, or those of one group of channels: who can see it, and who can write in it.
 *
 * A channel everyone can see is open; a private one is hidden from everyone except the roles and people let in.
 * Either way single roles and people can be let in or shut out. Someone who cannot see a channel is not told it
 * exists. Writing works the same way: open to everyone who may send messages, or read-only except for the roles and
 * people allowed. The owner and administrators see and write everywhere.
 *
 * Underneath these are the channel's permission overrides, of which only "View channels" and "Send messages" are
 * touched here: whatever else an override allows or denies is kept.
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
  const isGroup = channel.type === ChannelType.Category
  const follows = !!group && said(overrides) === said(group.overrides)
  const standAlone = isGroup ? (inside ?? []).filter(c => said(c.overrides) !== said(overrides)) : []
  // A calendar carries no messages. And what is written in a P2P channel goes between people's apps and never passes
  // the server, so the server cannot hold anyone to reading there.
  const p2p = channel.directSince != null
  const writable = channel.type !== ChannelType.Calendar && !p2p

  const matchGroup = async () => {
    setProblem(''); setBusy(true)
    try { await api.matchGroupAccess(channel.id) } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /** Sets or clears one permission of one override, leaving the rest of it alone; an override left empty is removed. */
  const set = async (bit: number, kind: 'role' | 'user', id: string, existing: ChannelOverrideDto | undefined, state: 'allow' | 'deny' | 'none') => {
    setProblem(''); setBusy(true)
    try {
      const allow = ((existing?.allow ?? 0) & ~bit) | (state === 'allow' ? bit : 0)
      const deny = ((existing?.deny ?? 0) & ~bit) | (state === 'deny' ? bit : 0)
      if (allow === 0 && deny === 0) { if (existing) await api.deleteChannelOverride(channel.id, existing.id) }
      else await api.setChannelOverride(channel.id, kind, id, allow, deny)
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /** One of the two sections: the choice for everyone, then the roles and people it makes an exception of. */
  const section = (bit: number, words: Wording, name: string) => {
    const stateOf = (o: ChannelOverrideDto | undefined): 'allow' | 'deny' | 'none' => ((o?.allow ?? 0) & bit ? 'allow' : (o?.deny ?? 0) & bit ? 'deny' : 'none')
    const closed = !!everyone && ((forRole(everyone.id)?.deny ?? 0) & bit) !== 0
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
      // Where it is closed the point of adding someone is to let them; where it is open, to keep them from it.
      void set(bit, kind, id, kind === 'role' ? forRole(id) : forUser(id), closed ? 'allow' : 'deny')
    }
    return (
      <>
        <h4>{words.heading}</h4>
        <label className="choice"><input type="radio" name={name} checked={!closed} disabled={busy || !everyone} onChange={() => everyone && void set(bit, 'role', everyone.id, forRole(everyone.id), 'none')} />
          <span><b>{words.open[0]}</b> <span className="muted">{words.open[1]}</span></span></label>
        <label className="choice"><input type="radio" name={name} checked={closed} disabled={busy || !everyone} onChange={() => everyone && void set(bit, 'role', everyone.id, forRole(everyone.id), 'deny')} />
          <span><b>{words.closed[0]}</b> <span className="muted">{words.closed[1]}</span></span></label>
        <div className="muted">{words.note}</div>
        {listed.length === 0 && <div className="muted">{closed ? words.noneClosed : words.noneOpen}</div>}
        {listed.map(row => (
          <div className="row entry" key={row.kind + row.id}>
            <span className="grow" style={{ color: row.color ?? undefined }}>{row.kind === 'role' ? 'Role: ' : ''}{row.name}</span>
            <select value={stateOf(row.o)} disabled={busy} aria-label={`${words.heading}: ${row.name}`} onChange={e => void set(bit, row.kind, row.id, row.o, e.target.value as 'allow' | 'deny' | 'none')}>
              <option value="allow">{words.allow}</option>
              <option value="deny">{words.deny}</option>
              <option value="none">Remove (same as everyone)</option>
            </select>
          </div>
        ))}
        {addable.length > 0 && (
          <select value="" disabled={busy} aria-label={closed ? words.addClosed : words.addOpen} onChange={e => { if (e.target.value) add(e.target.value) }}>
            <option value="">{closed ? words.addClosed : words.addOpen}</option>
            {addable.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        )}
      </>
    )
  }

  return (
    <Dialog title={isGroup ? `Permissions for the group ${channel.name}` : `Permissions for ${channel.name}`} onClose={onClose} scrolls>
      <div className="access">
        {isGroup && (
          <div className="muted">
            {standAlone.length === 0
              ? 'Every channel in this group follows these settings.'
              : `Channels in this group follow these settings, except ${standAlone.map(c => c.name).join(', ')}: ${standAlone.length === 1 ? 'it has its' : 'they have their'} own.`}
          </div>
        )}
        {group && (
          <div className="row entry">
            <span className="grow muted">
              {follows
                ? `Same as its group, ${group.name}. Changing the group changes this channel too, until you change something here.`
                : `This channel has its own settings. Changes to its group, ${group.name}, do not reach it.`}
            </span>
            {!follows && <button disabled={busy} onClick={() => void matchGroup()}>Match the group</button>}
          </div>
        )}
        {section(Permission.ViewChannels, SEE, 'access-see')}
        {writable && section(Permission.SendMessages, channel.type === ChannelType.Voice ? { ...WRITE, heading: 'Who can write in its chat' } : WRITE, 'access-write')}
        {p2p && channel.type !== ChannelType.Calendar && (
          <div className="muted">What is written in a P2P {isGroup ? 'group' : 'channel'} goes between people's apps and never passes the server, so nobody can be held to reading there.</div>
        )}
        {problem && <div className="muted bad">{problem}</div>}
      </div>
      <div className="buttons"><button onClick={onClose}>Done</button></div>
    </Dialog>
  )
}
