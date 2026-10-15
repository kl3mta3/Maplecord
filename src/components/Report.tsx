import { useState } from 'react'
import type { Api } from '../api'
import { Dialog } from './Dialogs'

/** What can be reported: a person, a server's pictures, or one of the pictures the server keeps (never anything sent P2P, which it never has). */
export type ReportTarget =
  | { kind: 'person'; userId: string; name: string; messageId?: string; avatar?: boolean; banner?: boolean; nameplate?: boolean }
  | { kind: 'server'; guildId: string; name: string; icon: boolean; banner: boolean }
  | { kind: 'picture'; picture: PictureKind; id: string; what: string }

export type PictureKind = 'attachment' | 'avatar' | 'profile_banner' | 'nameplate' | 'server_icon' | 'server_banner' | 'emoji' | 'sticker'

/** Whether whoever runs this Maplecord lets people report pictures, and people (the admin panel's Switches). */
export interface ReportsOn { pictures: boolean; people: boolean }

const PERSON = [['harassment', 'Harassment or bullying'], ['hateful', 'Hate'], ['threats', 'Threats or violence'], ['spam', 'Spam or scams'],
  ['impersonation', 'Pretending to be someone else'], ['sexual', 'Sexual content'], ['child_safety', 'A child at risk'], ['self_harm', 'Self-harm'],
  ['illegal', 'Something illegal'], ['other', 'Something else']] as const
const PICTURE = [['sexual', 'Sexual or nude'], ['child_safety', 'A child, sexually'], ['violent', 'Violent or gory'], ['hateful', 'Hateful'],
  ['self_harm', 'Self-harm'], ['illegal', 'Something illegal'], ['spam', 'Spam or scams'], ['other', 'Something else']] as const

/** One thing the dialog can send: the person themselves, or one picture. */
type Choice = { label: string; send: 'person' } | { label: string; send: PictureKind; id: string }

/** What can be reported of a target, as this Maplecord allows. */
function choicesOf(target: ReportTarget, on: ReportsOn): Choice[] {
  if (target.kind === 'picture') return on.pictures ? [{ label: target.what, send: target.picture, id: target.id }] : []
  if (target.kind === 'server') return !on.pictures ? [] : [
    ...(target.icon ? [{ label: 'Its icon', send: 'server_icon' as const, id: target.guildId }] : []),
    ...(target.banner ? [{ label: 'Its banner', send: 'server_banner' as const, id: target.guildId }] : []),
  ]
  return [
    ...(on.people ? [{ label: 'Them', send: 'person' as const }] : []),
    ...(on.pictures && target.avatar ? [{ label: 'Their profile picture', send: 'avatar' as const, id: target.userId }] : []),
    ...(on.pictures && target.banner ? [{ label: 'Their banner', send: 'profile_banner' as const, id: target.userId }] : []),
    ...(on.pictures && target.nameplate ? [{ label: 'Their nameplate', send: 'nameplate' as const, id: target.userId }] : []),
  ]
}

/**
 * Reporting a person, a server's pictures or a picture to whoever runs this Maplecord: what is wrong, and a few words
 * if wanted. Nothing is taken down by it; it waits for an admin or moderator to look. Whoever is reported is never told
 * who reported them. For a person, their profile picture, banner or nameplate can be reported instead.
 */
export function ReportDialog({ api, target, on, onClose }: { api: Api; target: ReportTarget; on: ReportsOn; onClose: () => void }) {
  const choices = choicesOf(target, on)
  const [picked, setPicked] = useState(0)
  const choice = choices[Math.min(picked, choices.length - 1)] as Choice | undefined
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const person = choice?.send === 'person'
  const categories = person ? PERSON : PICTURE
  const title = target.kind === 'picture' ? `Report ${target.what}` : `Report ${target.name}`

  const send = async () => {
    if (!choice) return
    setBusy(true); setProblem(null)
    try {
      if (choice.send === 'person') await api.reportPerson((target as { userId: string }).userId, category, note, target.kind === 'person' ? target.messageId : undefined)
      else await api.reportPicture(choice.send, choice.id, category, note)
      setSent(true)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'It could not be sent.')
    } finally { setBusy(false) }
  }

  if (sent) return (
    <Dialog title={title} onClose={onClose}>
      <div>Thank you. It waits for whoever looks after this Maplecord. {person ? 'They are not told who reported them.' : 'Nobody is told who reported it.'}</div>
      <div className="buttons"><button className="accent" autoFocus onClick={onClose}>Close</button></div>
    </Dialog>
  )
  if (!choice) return (
    <Dialog title={title} onClose={onClose}>
      <div>{target.kind === 'person' ? 'Reporting people is switched off on this Maplecord, and they have no picture of their own to report.' : 'There is nothing here that can be reported.'}</div>
      <div className="buttons"><button className="accent" autoFocus onClick={onClose}>Close</button></div>
    </Dialog>
  )
  return (
    <Dialog title={title} onClose={onClose}>
      {choices.length > 1 && (
        <>
          <label className="muted" htmlFor="report-about">What is wrong</label>
          <select id="report-about" value={picked} onChange={e => { setPicked(Number(e.target.value)); setCategory('') }}>
            {choices.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
          </select>
        </>
      )}
      <label className="muted" htmlFor="report-category">{person ? 'What it is about' : 'What is wrong with it'}</label>
      <select id="report-category" value={category} autoFocus onChange={e => setCategory(e.target.value)}>
        <option value="" disabled>Choose one</option>
        {categories.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <label className="muted" htmlFor="report-note">A few words (if you like)</label>
      <textarea id="report-note" value={note} maxLength={500} rows={3} placeholder="What happened, or anything that helps" onChange={e => setNote(e.target.value)} />
      {category === 'child_safety' && <div className="muted small">If a child is in danger right now, contact the police too.</div>}
      {problem && <div className="error">{problem}</div>}
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="danger" disabled={!category || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Report'}</button></div>
    </Dialog>
  )
}
