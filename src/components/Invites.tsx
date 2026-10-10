import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { InviteDto } from '../types'
import { Dialog } from './Dialogs'

/** How long an invite can be made to last, in minutes, and how it is put. */
const LASTS: [number | null, string][] = [[null, 'Never'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [360, 'After 6 hours'], [1440, 'After 1 day'], [10080, 'After 7 days']]
/** How many people an invite can be made to let in. */
const USES: [number | null, string][] = [[null, 'Any number of times'], [1, 'Once'], [5, '5 times'], [10, '10 times'], [25, '25 times'], [100, '100 times']]

const when = (moment: string) => new Date(moment).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Inviting people to a server: make a link, choosing when it stops working, and see the links that still work so
 * that one can be taken back. Someone who manages the server sees everyone's links; anyone else sees their own.
 */
export function InviteDialog({ store, guildId, onClose }: { store: Store; guildId: string; onClose: () => void }) {
  const name = store.guilds.find(g => g.guild.id === guildId)?.guild.name ?? 'this server'
  const [lasts, setLasts] = useState<number | null>(null)
  const [uses, setUses] = useState<number | null>(null)
  const [base, setBase] = useState<string | null>(null)
  const [made, setMade] = useState<InviteDto | null>(null)
  const [list, setList] = useState<InviteDto[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { loadInvites, inviteBase } = store

  useEffect(() => {
    let alive = true
    void inviteBase().then(b => { if (alive) setBase(b) })
    void loadInvites(guildId).then(l => { if (alive) setList(l ?? []) })
    return () => { alive = false }
  }, [guildId, loadInvites, inviteBase])

  // A link to click where the server gives them out; the bare code otherwise.
  const link = (invite: InviteDto) => (base ? base + invite.code : invite.code)
  const copy = (invite: InviteDto) => {
    void navigator.clipboard.writeText(link(invite)).then(
      () => { setCopied(invite.code); window.setTimeout(() => setCopied(c => (c === invite.code ? null : c)), 1500) },
      () => store.setError('Could not copy. Select the link and copy it yourself.'))
  }
  const make = async () => {
    setBusy(true)
    const invite = await store.makeInvite(guildId, lasts, uses)
    setBusy(false)
    if (!invite) return
    setMade(invite)
    setList(l => [invite, ...(l ?? [])])
    copy(invite)
  }
  const takeBack = async (invite: InviteDto) => {
    if (!await store.revokeInvite(invite.code)) return
    setList(l => (l ?? []).filter(i => i.code !== invite.code))
    setMade(m => (m?.code === invite.code ? null : m))
  }
  const ends = (i: InviteDto) => [
    i.expiresAt ? `stops working ${when(i.expiresAt)}` : 'does not run out',
    i.maxUses ? `used ${i.uses} of ${i.maxUses}` : `used ${i.uses} ${i.uses === 1 ? 'time' : 'times'}`,
  ].join(' · ')

  return (
    <Dialog title={`Invite people to ${name}`} onClose={onClose} scrolls>
      <div className="muted">Anyone with the link can join. Choose when it stops working, then make it.</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="row"><span className="muted">Stops working</span>
          <select value={lasts ?? ''} onChange={e => setLasts(e.target.value ? Number(e.target.value) : null)} aria-label="When the link stops working">
            {LASTS.map(([v, text]) => <option key={text} value={v ?? ''}>{text}</option>)}
          </select>
        </label>
        <label className="row"><span className="muted">Can be used</span>
          <select value={uses ?? ''} onChange={e => setUses(e.target.value ? Number(e.target.value) : null)} aria-label="How many times the link can be used">
            {USES.map(([v, text]) => <option key={text} value={v ?? ''}>{text}</option>)}
          </select>
        </label>
        <button className="accent" disabled={busy} onClick={() => void make()}>Make a link</button>
      </div>
      {made && (
        <div className="row">
          <input className="grow" readOnly value={link(made)} onFocus={e => e.target.select()} aria-label="The new invite link" />
          <button onClick={() => copy(made)}>{copied === made.code ? 'Copied' : 'Copy'}</button>
        </div>
      )}

      <h4>Links that still work</h4>
      {list === null && <div className="muted">Loading…</div>}
      {list?.length === 0 && <div className="muted">None. A link that has run out or been used up is removed.</div>}
      {list?.map(i => (
        <div key={i.code} className="connectionrow">
          <b>{i.code}</b>
          <span className="grow muted">{i.createdBy ? `by ${i.createdBy} · ` : ''}{ends(i)}</span>
          <button className="subtle" onClick={() => copy(i)}>{copied === i.code ? 'Copied' : 'Copy'}</button>
          <button className="subtle" onClick={() => void takeBack(i)} title="The link stops working at once. People who already joined with it stay.">Take back</button>
        </div>
      ))}
      <div className="buttons"><button onClick={onClose}>Done</button></div>
    </Dialog>
  )
}
