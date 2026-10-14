import { useEffect, useMemo, useRef, useState } from 'react'
import { calendarBackground } from '../calendarLooks'
import type { Store } from '../store'
import { EventAnswer, type CalendarEventDto, type PostedEventDto } from '../types'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { Dialog } from './Dialogs'
import { Markdown, MarkdownBox } from './Markdown'

// A calendar channel: a month of days as squares, with what is on each. Anyone who sees the channel reads it and says
// whether they are coming; whoever may post events adds to it by opening a day, and adds the people it is for.

const two = (n: number) => String(n).padStart(2, '0')
/** A day as year-month-day, the way events carry theirs. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const fromKey = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y!, (m ?? 1) - 1, d ?? 1) }

/**
 * The day an event is on for whoever is looking. One with a time is a moment, and falls on whichever day that moment
 * is here; one without is on the day it was put on, everywhere.
 */
export const shownDay = (e: Pick<CalendarEventDto, 'day' | 'at'>) => (e.at ? dayKey(new Date(e.at)) : e.day)
const shownTime = (e: Pick<CalendarEventDto, 'at'>) => (e.at ? new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')

/** The 42 days a month is shown as: six weeks, starting on the Sunday on or before its first day. */
export function monthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - first.getDay() + i))
}

/** Events by the day they are shown on, each day's in order: those with a time by that time, then the rest as they were posted. */
export function byShownDay(events: CalendarEventDto[]): Map<string, CalendarEventDto[]> {
  const days = new Map<string, CalendarEventDto[]>()
  for (const e of events) { const key = shownDay(e); days.set(key, [...(days.get(key) ?? []), e]) }
  for (const list of days.values()) list.sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : b.at ? 1 : a.createdAt.localeCompare(b.createdAt)))
  return days
}

/**
 * What went wrong, in words. A server that has never heard of what was asked answers a bare "Not Found": it is older
 * than this app, and that is what is said.
 */
const told = (e: unknown, otherwise: string) => (!(e instanceof Error) ? otherwise
  : e.message === 'Not Found' ? 'This Maplecord server is older than this app and cannot do that yet. It will work once the server is updated.' : e.message)

/** The colours an event can be given. */
const EVENT_COLORS = ['#9000ff', '#00ddff', '#ff008c', '#2cfc00', '#f19511', '#ff3b3b', '#ffd700', '#1abc9c', '#3498db', '#e8e8f0']
const COLOR = /^#[0-9a-f]{6}$/i
/** How something of an event's colour is drawn: an edge in the colour, and a wash of it behind. Nothing for an event with none. */
const tinted = (color: string | null | undefined): React.CSSProperties | undefined =>
  (color && COLOR.test(color) ? { borderLeft: `3px solid ${color}`, background: `color-mix(in srgb, ${color} 26%, transparent)` } : undefined)

/** The four answers, in the order they are offered, each with its mark and what it says. */
const ANSWERS: { answer: EventAnswer; mark: string; says: string }[] = [
  { answer: EventAnswer.Going, mark: '✅', says: 'I will be there' },
  { answer: EventAnswer.NotGoing, mark: '❌', says: 'I will not be there' },
  { answer: EventAnswer.Unsure, mark: '🤷', says: 'Not sure yet' },
  { answer: EventAnswer.WhyMe, mark: '😠', says: 'Why did you invite me to this?' },
]
const markOf = (answer: EventAnswer) => ANSWERS.find(a => a.answer === answer)?.mark ?? '✉️'
const saysOf = (answer: EventAnswer) => ANSWERS.find(a => a.answer === answer)?.says ?? 'Invited, has not answered'

/** When a posted event is, in this person's own time zone: its day, and its time if it has one. */
export const postedWhen = (event: Pick<PostedEventDto, 'day' | 'at'>) => (event.at
  ? new Date(event.at).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : fromKey(event.day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))

/** An event that was posted into a channel, drawn as a card with its time in this person's own time zone. */
export function EventCard({ event, onOpen }: { event: PostedEventDto; onOpen?: () => void }) {
  const when = postedWhen(event)
  return (
    <div className="card eventcard" style={event.color && COLOR.test(event.color) ? { borderColor: event.color } : undefined}>
      <div className="title">📅 {event.title}</div>
      <div className="line" title={event.at ? 'Shown in your own time zone' : undefined}>{when}</div>
      {event.note && (event.noteMarkdown ? <Markdown text={event.note} className="note" /> : <div className="body note">{event.note}</div>)}
      {onOpen && <div><button className="subtle" onClick={onOpen} title="Open the calendar on this event. What was posted here is the event as it was then">Open in the calendar</button></div>}
    </div>
  )
}

export function CalendarView({ store, channelId, name, background, mayPost, mayManage, mayShare, nameOf, postTo, members, roles, myRoleIds }: {
  store: Store; channelId: string; name: string
  /** The calendar's background, if it has one (see calendarLooks.ts). */
  background?: string | null
  /** May put events on it, and change or remove their own. */
  mayPost: boolean
  /** May change or remove anyone's (whoever may manage messages). */
  mayManage: boolean
  /** May post an event from here into channels. */
  mayShare: boolean
  nameOf: (userId: string, fallback: string) => string
  /** The text channels and forums this person can write in, to post an event into. */
  postTo: { id: string; name: string; forum: boolean }[]
  /** The people who can see this calendar, to add to an event. */
  members: { userId: string; name: string }[]
  /** The server's roles, to add to an event; and which of them this person has. */
  roles: { id: string; name: string; color: string | null }[]; myRoleIds: string[]
}) {
  const now = new Date()
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [events, setEvents] = useState<CalendarEventDto[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ day: string; event?: CalendarEventDto } | null>(null)
  const [menu, setMenu] = useState<{ event: CalendarEventDto; x: number; y: number } | null>(null)
  const [posting, setPosting] = useState<{ event: CalendarEventDto; forum: boolean } | null>(null)
  const [inviting, setInviting] = useState<string | null>(null)
  const days = useMemo(() => monthDays(month.y, month.m), [month.y, month.m])
  const me = store.settings.user?.id
  const { api, setError } = store
  const fail = (what: string) => (e: unknown) => setError(told(e, what))

  // A day to either side of what is shown: an event with a time can be on the next day over for us.
  useEffect(() => {
    let cancelled = false
    setEvents([])
    api.events(channelId, dayKey(addDays(days[0]!, -1)), dayKey(addDays(days[41]!, 1)))
      .then(list => { if (!cancelled) setEvents(list) }, e => { if (!cancelled) setError(e instanceof Error ? e.message : 'The calendar could not be read.') })
    return () => { cancelled = true }
  }, [api, setError, channelId, days])

  // Someone put an event on it, changed one, answered one or took one off, while we are looking.
  const change = store.calendarChange
  useEffect(() => {
    if (!change || change.channelId !== channelId) return
    setEvents(list => (change.deleted ? list.filter(e => e.id !== change.deleted) : change.changed ? [...list.filter(e => e.id !== change.changed!.id), change.changed] : list))
  }, [change, channelId])

  // Sent here for one event (a link, a posted event, an invitation): its month, with its day opened.
  const target = store.calendarTarget
  const taken = useRef(0)
  useEffect(() => {
    if (!target || target.event.channelId !== channelId || taken.current === target.n) return
    taken.current = target.n
    const day = fromKey(shownDay(target.event))
    setMonth({ y: day.getFullYear(), m: day.getMonth() })
    setOpenDay(shownDay(target.event))
  }, [target, channelId])

  const shown = useMemo(() => byShownDay(events), [events])
  const today = dayKey(now)
  const step = (by: number) => setMonth(at => { const d = new Date(at.y, at.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: 'short' })), [])
  const openList = openDay ? shown.get(openDay) ?? [] : []
  const remove = (e: CalendarEventDto) => { void api.deleteEvent(e.id).catch(fail('The event could not be removed.')) }
  const mayChange = (e: CalendarEventDto) => (e.authorId === me && mayPost) || mayManage
  const forums = postTo.filter(c => c.forum), texts = postTo.filter(c => !c.forum)
  /** What we were invited to on this calendar and have not answered. */
  const waiting = store.invitations.filter(e => e.channelId === channelId)

  const answer = (e: CalendarEventDto, a: EventAnswer) => {
    const mine = (e.participants ?? []).find(p => p.userId === me)?.answer
    // Pressing the answer already given takes it back.
    void api.answerEvent(e.id, mine === a ? null : a).catch(fail('Your answer could not be saved.'))
  }
  const copyLink = async (e: CalendarEventDto) => {
    const link = await store.eventLink(e.id)
    if (!link) { setError('This server does not give links to events.'); return }
    void navigator.clipboard.writeText(link).then(() => setError('A link to the event was copied. Whoever follows it sees the event only if they can see this calendar.'), () => setError('Could not copy. Here it is: ' + link))
  }
  const entriesFor = (e: CalendarEventDto): MenuEntry[] => [
    { kind: 'item', label: 'Post to channels…', icon: '📣', disabled: !mayShare || texts.length === 0, onClick: () => setPosting({ event: e, forum: false }) },
    { kind: 'item', label: 'Create a forum post…', icon: '☰', disabled: !mayShare || forums.length === 0, onClick: () => setPosting({ event: e, forum: true }) },
    { kind: 'item', label: 'Create a link', icon: '🔗', onClick: () => void copyLink(e) },
    ...(mayChange(e) ? [{ kind: 'sep' } as MenuEntry, { kind: 'item', label: 'Participants…', icon: '➕', onClick: () => setInviting(e.id) } as MenuEntry, { kind: 'item', label: 'Edit', icon: '✎', onClick: () => setEditing({ day: shownDay(e), event: e }) } as MenuEntry] : []),
    ...(e.authorId === me || mayManage ? [{ kind: 'item', label: 'Remove', danger: true, onClick: () => remove(e) } as MenuEntry] : []),
  ]
  const openMenu = (e: React.MouseEvent, event: CalendarEventDto) => { e.preventDefault(); e.stopPropagation(); setMenu({ event, x: e.clientX, y: e.clientY }) }
  const invitingEvent = inviting ? events.find(e => e.id === inviting) ?? null : null

  const look = calendarBackground(background)
  return (
    <div className={'chat calendar' + (look ? ' hasbg' : '')} style={look ?? undefined}>
      <div className="header">
        <span className="muted">📅</span> <b>{name}</b>
        <div className="actions">
          <button className="subtle" onClick={() => step(-1)} title="The month before" aria-label="The month before">◀</button>
          <b className="calmonth">{new Date(month.y, month.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
          <button className="subtle" onClick={() => step(1)} title="The month after" aria-label="The month after">▶</button>
          <button onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
        </div>
      </div>
      {waiting.length > 0 && (
        <div className="calwaiting">
          <span className="muted">You were invited:</span>
          {waiting.map(e => (
            <button key={e.id} className="subtle" title="Open it to answer" onClick={() => { const day = fromKey(shownDay(e)); setMonth({ y: day.getFullYear(), m: day.getMonth() }); setOpenDay(shownDay(e)) }}>
              ✉️ {e.title} · {fromKey(shownDay(e)).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
      )}
      <div className="calweek">{weekdays.map(w => <span key={w}>{w}</span>)}</div>
      <div className="calgrid">
        {days.map(d => {
          const key = dayKey(d)
          const list = shown.get(key) ?? []
          return (
            <button key={key} className={'calday' + (d.getMonth() !== month.m ? ' other' : '') + (key === today ? ' today' : '') + (list.length > 0 ? ' has' : '')}
              onClick={() => setOpenDay(key)} title={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + (list.length > 0 ? ` · ${list.length} ${list.length === 1 ? 'event' : 'events'}` : '')}>
              <span className="num">{d.getDate()}</span>
              {list.slice(0, 3).map(e => <span key={e.id} className="calevent" style={tinted(e.color)} onContextMenu={x => openMenu(x, e)}>{shownTime(e) && <i>{shownTime(e)} </i>}{e.title}</span>)}
              {list.length > 3 && <span className="calmore">+{list.length - 3} more</span>}
            </button>
          )
        })}
      </div>

      {openDay && !editing && !posting && !invitingEvent && (
        <Dialog title={fromKey(openDay).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} onClose={() => setOpenDay(null)} scrolls>
          {mayPost && <button className="accent dialogcorner" onClick={() => setEditing({ day: openDay })}>Add an event</button>}
          {openList.length === 0 && <div className="muted">Nothing on this day.</div>}
          {openList.map(e => {
            const people = e.participants ?? []
            const mine = people.find(p => p.userId === me)
            const forRoles = roles.filter(r => (e.roleIds ?? []).includes(r.id))
            // An invite-only event is answered by the people on its list, anyone with one of its roles, and whoever posted it.
            const mayAnswer = !e.inviteOnly || !!mine || e.authorId === me || (e.roleIds ?? []).some(id => myRoleIds.includes(id))
            return (
              <div key={e.id} className="caldetail" style={e.color && COLOR.test(e.color) ? { borderLeft: `4px solid ${e.color}` } : undefined} onContextMenu={x => openMenu(x, e)}>
                <div><b>{e.title}</b>{shownTime(e) && <span className="muted"> · {shownTime(e)}</span>}</div>
                {e.note && (e.noteMarkdown ? <Markdown text={e.note} /> : <div className="note">{e.note}</div>)}
                {mine?.answer === EventAnswer.Invited && <div className="calasked">✉️ You were invited{mine.invitedById ? ` by ${nameOf(mine.invitedById, people.find(p => p.userId === mine.invitedById)?.name ?? e.authorName)}` : ''}. Are you coming?</div>}
                {(e.inviteOnly || forRoles.length > 0) && (
                  <div className="calfor">
                    <span className="muted">{e.inviteOnly ? '🔒 Invite only' : 'Open to all'}{forRoles.length > 0 ? ' · for' : ''}</span>
                    {forRoles.map(r => <span key={r.id} className="chip" style={r.color ? { color: r.color, borderColor: r.color } : undefined}>@{r.name}</span>)}
                  </div>
                )}
                <div className="calanswers">
                  {ANSWERS.map(a => {
                    const count = people.filter(p => p.answer === a.answer).length
                    return (
                      <button key={a.answer} className={'reaction' + (mine?.answer === a.answer ? ' mine' : '')} aria-pressed={mine?.answer === a.answer}
                        disabled={!mayAnswer} title={!mayAnswer ? 'This event is invite only: it is for the people and roles added to it' : mine?.answer === a.answer ? `${a.says} (press again to take it back)` : a.says} onClick={() => answer(e, a.answer)}>{a.mark} <span>{count}</span></button>
                    )
                  })}
                  {mayChange(e) && <button className="subtle" onClick={() => setInviting(e.id)} title="Say who this event is for: open to all or invite only, and add roles and people">➕ Add participant</button>}
                </div>
                {people.length > 0 && (
                  <div className="calpeople">
                    {people.map(p => (
                      <span key={p.userId} className={'chip' + (p.answer === EventAnswer.Invited ? ' waiting' : '')} title={saysOf(p.answer)}>
                        {markOf(p.answer)} {nameOf(p.userId, p.name)}
                        {mayChange(e) && <button className="subtle x" aria-label={`Take ${nameOf(p.userId, p.name)} off the list`} title="Take them off the list"
                          onClick={() => void api.uninviteFromEvent(e.id, p.userId).catch(fail('They could not be taken off the list.'))}>×</button>}
                      </span>
                    ))}
                  </div>
                )}
                <div className="row">
                  <span className="muted grow">by {nameOf(e.authorId, e.authorName)}{e.editedAt ? ' · edited' : ''}</span>
                  <button className="subtle" onClick={x => setMenu({ event: e, x: x.clientX, y: x.clientY })} title="Post it to channels, make a forum post of it, or make a link to it">Post or link…</button>
                  {mayChange(e) && <button className="subtle" onClick={() => setEditing({ day: openDay, event: e })}>Edit</button>}
                  {(e.authorId === me || mayManage) && <button className="subtle danger" onClick={() => remove(e)}>Remove</button>}
                </div>
              </div>
            )
          })}
          <div className="buttons"><button onClick={() => setOpenDay(null)}>Close</button></div>
        </Dialog>
      )}
      {editing && (
        <EventDialog day={editing.day} event={editing.event} onClose={() => setEditing(null)}
          onSave={async body => {
            try { if (editing.event) await api.editEvent(editing.event.id, body); else await api.postEvent(channelId, body); setEditing(null) }
            catch (e) { setError(told(e, 'The event could not be saved.')) }
          }} />
      )}
      {posting && (
        <PostEventDialog event={posting.event} forum={posting.forum} channels={posting.forum ? forums : texts} onClose={() => setPosting(null)}
          onPost={async ids => {
            try { await api.postEventTo(posting.event.id, ids); setPosting(null) }
            catch (e) { setError(told(e, 'The event could not be posted.')) }
          }} />
      )}
      {invitingEvent && (
        <ParticipantsDialog event={invitingEvent} roles={roles} people={members.filter(m => !(invitingEvent.participants ?? []).some(p => p.userId === m.userId))} onClose={() => setInviting(null)}
          onSave={async (inviteOnly, roleIds, userIds) => {
            try {
              const before = [...(invitingEvent.roleIds ?? [])].sort().join(), now = [...roleIds].sort().join()
              if (inviteOnly !== !!invitingEvent.inviteOnly || before !== now) await api.setEventAudience(invitingEvent.id, inviteOnly, roleIds)
              if (userIds.length > 0) await api.inviteToEvent(invitingEvent.id, userIds)
              setInviting(null)
            } catch (e) { setError(told(e, 'That could not be saved.')) }
          }} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entriesFor(menu.event)} onClose={() => setMenu(null)} />}
      {/* What the app has to say (something refused, a link copied): the calendar stands where the conversation would say it. */}
      {store.error && <div className="error"><span className="grow">{store.error}</span><button className="subtle" onClick={() => store.setError(null)}>×</button></div>}
    </div>
  )
}

/**
 * A drop-down that takes several: each row gets a check when picked and loses it when picked again. With as many
 * picked as it takes, the rest cannot be.
 */
function MultiPick({ items, picked, onChange, most, placeholder, startClosed }: {
  items: { id: string; label: string }[]; picked: string[]; onChange: (ids: string[]) => void; most: number; placeholder: string
  /** Shut until it is pressed, where it is one of several in a dialog. */
  startClosed?: boolean
}) {
  const [open, setOpen] = useState(!startClosed)
  const chosen = items.filter(i => picked.includes(i.id))
  return (
    <div className="multipick">
      <button className="pickhead" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="grow">{chosen.length === 0 ? placeholder : chosen.map(c => c.label).join(', ')}</span><span className="muted">{picked.length}/{most} {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="picklist" role="listbox" aria-multiselectable>
          {items.length === 0 && <div className="muted">Nothing to choose from.</div>}
          {items.map(i => {
            const on = picked.includes(i.id)
            return (
              <button key={i.id} role="option" aria-selected={on} className={'pickrow' + (on ? ' on' : '')} disabled={!on && picked.length >= most}
                onClick={() => onChange(on ? picked.filter(id => id !== i.id) : [...picked, i.id])}><span className="tick">{on ? '✓' : ''}</span>{i.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Posting an event into channels: up to five text channels, each ticked in the list; or one forum, as a post of its own. */
function PostEventDialog({ event, forum, channels, onPost, onClose }: {
  event: CalendarEventDto; forum: boolean; channels: { id: string; name: string }[]; onPost: (channelIds: string[]) => void | Promise<void>; onClose: () => void
}) {
  const [picked, setPicked] = useState<string[]>(forum && channels.length === 1 ? [channels[0]!.id] : [])
  const [busy, setBusy] = useState(false)
  const post = async () => { if (picked.length === 0 || busy) return; setBusy(true); await onPost(picked); setBusy(false) }
  return (
    <Dialog title={forum ? `A forum post for "${event.title}"` : `Post "${event.title}"`} onClose={onClose} scrolls>
      <div className="muted">{forum ? 'Forum' : 'Channels'}</div>
      <MultiPick items={channels.map(c => ({ id: c.id, label: (forum ? '☰ ' : '# ') + c.name }))} picked={picked} onChange={setPicked} most={forum ? 1 : 5}
        placeholder={forum ? 'Choose a forum…' : 'Choose channels…'} />
      <div className="muted">
        {forum ? 'It becomes a post of its own there, with the event\'s title.' : 'Up to 5 at once.'} Everyone sees the time in their own time zone. It is posted as it is now: if the event changes later, post it again.
      </div>
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={picked.length === 0 || busy} onClick={() => void post()}>{forum ? 'Create post' : 'Post'}</button>
      </div>
    </Dialog>
  )
}

/**
 * Who an event is for. Open to all: anyone who can see the calendar may answer. Invite only: the people added and
 * everyone with one of the roles added. People added are each told they were invited; a role is one entry however
 * many have it, and nobody is told one by one.
 */
function ParticipantsDialog({ event, people, roles, onSave, onClose }: {
  event: CalendarEventDto; people: { userId: string; name: string }[]; roles: { id: string; name: string }[]
  onSave: (inviteOnly: boolean, roleIds: string[], userIds: string[]) => void | Promise<void>; onClose: () => void
}) {
  const [inviteOnly, setInviteOnly] = useState(!!event.inviteOnly)
  const [roleIds, setRoleIds] = useState<string[]>(event.roleIds ?? [])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const sorted = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name)), [people])
  const save = async () => { if (busy) return; setBusy(true); await onSave(inviteOnly, roleIds, picked); setBusy(false) }
  return (
    <Dialog title={`Participants of "${event.title}"`} onClose={onClose} scrolls>
      <label className="choice"><input type="radio" name="audience" checked={!inviteOnly} onChange={() => setInviteOnly(false)} />
        <span><b>Open to all</b> <span className="muted">anyone who can see this calendar can answer</span></span></label>
      <label className="choice"><input type="radio" name="audience" checked={inviteOnly} onChange={() => setInviteOnly(true)} />
        <span><b>Invite only</b> <span className="muted">only the roles and people added here can answer</span></span></label>
      <div className="muted">Roles</div>
      <MultiPick items={roles.map(r => ({ id: r.id, label: '@' + r.name }))} picked={roleIds} onChange={setRoleIds} most={20} placeholder="Add roles…" startClosed />
      <div className="muted">People</div>
      <MultiPick items={sorted.map(p => ({ id: p.userId, label: p.name }))} picked={picked} onChange={setPicked} most={25} placeholder="Add people…" />
      <div className="muted">Each person added is told they were invited: now if their app is open, and otherwise when they next open it. A role counts everyone who has it as invited, without telling them one by one. Only people who can see this calendar are listed.</div>
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </Dialog>
  )
}

/** A new event for a day, or one being changed: its title, the day, a time if it has one, and a note. */
function EventDialog({ day, event, onSave, onClose }: {
  day: string; event?: CalendarEventDto
  onSave: (body: { title: string; note: string | null; day: string; at: string | null; color: string | null; noteMarkdown: boolean }) => void | Promise<void>
  onClose: () => void
}) {
  const startsAt = event?.at ? new Date(event.at) : null
  const [title, setTitle] = useState(event?.title ?? '')
  const [on, setOn] = useState(event ? shownDay(event) : day)
  const [time, setTime] = useState(startsAt ? `${two(startsAt.getHours())}:${two(startsAt.getMinutes())}` : '')
  const [note, setNote] = useState(event?.note ?? '')
  const [color, setColor] = useState<string | null>(event?.color ?? null)
  const [noteMarkdown, setNoteMarkdown] = useState(!!event?.noteMarkdown)
  const ready = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on)
  const save = () => {
    if (!ready) return
    // The time is this person's own clock on that day; it is sent as the moment it is, so everyone sees it in theirs.
    const at = time ? new Date(`${on}T${time}`) : null
    void onSave({ title: title.trim(), note: note.trim() || null, day: on, at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null, color, noteMarkdown: noteMarkdown && !!note.trim() })
  }
  return (
    <Dialog title={event ? 'Edit the event' : 'Add an event'} onClose={onClose} scrolls>
      <div className="muted">What</div>
      <input autoFocus value={title} maxLength={100} placeholder="Zakum run" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
      <div className="row">
        <label className="grow"><div className="muted">Day</div><input type="date" value={on} onChange={e => setOn(e.target.value)} /></label>
        <label className="grow"><div className="muted">Time, if it has one</div><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      </div>
      <div className="muted">Note, if it needs one</div>
      <MarkdownBox value={note} onChange={setNote} markdown={noteMarkdown} onMarkdown={setNoteMarkdown} rows={4} maxLength={1000} />
      {time && <div className="muted">The time is yours. Everyone sees it in their own time zone.</div>}
      <div className="muted">Colour, if you like</div>
      <div className="calcolors" role="radiogroup" aria-label="Colour">
        <button className={'none' + (color === null ? ' on' : '')} role="radio" aria-checked={color === null} title="No colour" onClick={() => setColor(null)}>∅</button>
        {EVENT_COLORS.map(c => <button key={c} className={color === c ? 'on' : ''} role="radio" aria-checked={color === c} aria-label={c} title={c} style={{ background: c }} onClick={() => setColor(c)} />)}
      </div>
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={!ready} onClick={save}>{event ? 'Save' : 'Add'}</button>
      </div>
    </Dialog>
  )
}
