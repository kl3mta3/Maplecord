import { useEffect, useMemo, useState } from 'react'
import type { Store } from '../store'
import type { CalendarEventDto } from '../types'
import { Dialog } from './Dialogs'

// A calendar channel: a month of days as squares, with what is on each. Anyone who sees the channel reads it; whoever
// may post events adds to it by opening a day.

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

export function CalendarView({ store, channelId, name, mayPost, mayManage, nameOf }: {
  store: Store; channelId: string; name: string
  /** May put events on it, and change or remove their own. */
  mayPost: boolean
  /** May change or remove anyone's (whoever may manage messages). */
  mayManage: boolean
  nameOf: (userId: string, fallback: string) => string
}) {
  const now = new Date()
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [events, setEvents] = useState<CalendarEventDto[]>([])
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ day: string; event?: CalendarEventDto } | null>(null)
  const days = useMemo(() => monthDays(month.y, month.m), [month.y, month.m])
  const me = store.settings.user?.id
  const { api, setError } = store

  // A day to either side of what is shown: an event with a time can be on the next day over for us.
  useEffect(() => {
    let cancelled = false
    setEvents([])
    api.events(channelId, dayKey(addDays(days[0]!, -1)), dayKey(addDays(days[41]!, 1)))
      .then(list => { if (!cancelled) setEvents(list) }, e => { if (!cancelled) setError(e instanceof Error ? e.message : 'The calendar could not be read.') })
    return () => { cancelled = true }
  }, [api, setError, channelId, days])

  // Someone put an event on it, changed one or took one off, while we are looking.
  const change = store.calendarChange
  useEffect(() => {
    if (!change || change.channelId !== channelId) return
    setEvents(list => (change.deleted ? list.filter(e => e.id !== change.deleted) : change.changed ? [...list.filter(e => e.id !== change.changed!.id), change.changed] : list))
  }, [change, channelId])

  const shown = useMemo(() => byShownDay(events), [events])
  const today = dayKey(now)
  const step = (by: number) => setMonth(at => { const d = new Date(at.y, at.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: 'short' })), [])
  const openList = openDay ? shown.get(openDay) ?? [] : []
  const remove = (e: CalendarEventDto) => { void api.deleteEvent(e.id).catch(err => setError(err instanceof Error ? err.message : 'The event could not be removed.')) }

  return (
    <div className="chat calendar">
      <div className="header">
        <span className="muted">📅</span> <b>{name}</b>
        <div className="actions">
          <button className="subtle" onClick={() => step(-1)} title="The month before" aria-label="The month before">◀</button>
          <b className="calmonth">{new Date(month.y, month.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
          <button className="subtle" onClick={() => step(1)} title="The month after" aria-label="The month after">▶</button>
          <button onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
        </div>
      </div>
      <div className="calweek">{weekdays.map(w => <span key={w}>{w}</span>)}</div>
      <div className="calgrid">
        {days.map(d => {
          const key = dayKey(d)
          const list = shown.get(key) ?? []
          return (
            <button key={key} className={'calday' + (d.getMonth() !== month.m ? ' other' : '') + (key === today ? ' today' : '') + (list.length > 0 ? ' has' : '')}
              onClick={() => setOpenDay(key)} title={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + (list.length > 0 ? ` · ${list.length} ${list.length === 1 ? 'event' : 'events'}` : '')}>
              <span className="num">{d.getDate()}</span>
              {list.slice(0, 3).map(e => <span key={e.id} className="calevent">{shownTime(e) && <i>{shownTime(e)} </i>}{e.title}</span>)}
              {list.length > 3 && <span className="calmore">+{list.length - 3} more</span>}
            </button>
          )
        })}
      </div>

      {openDay && !editing && (
        <Dialog title={fromKey(openDay).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} onClose={() => setOpenDay(null)}>
          {openList.length === 0 && <div className="muted">Nothing on this day.</div>}
          {openList.map(e => (
            <div key={e.id} className="caldetail">
              <div><b>{e.title}</b>{shownTime(e) && <span className="muted"> · {shownTime(e)}</span>}</div>
              {e.note && <div className="note">{e.note}</div>}
              <div className="row">
                <span className="muted grow">by {nameOf(e.authorId, e.authorName)}{e.editedAt ? ' · changed' : ''}</span>
                {((e.authorId === me && mayPost) || mayManage) && <button className="subtle" onClick={() => setEditing({ day: openDay, event: e })}>Change</button>}
                {(e.authorId === me || mayManage) && <button className="subtle danger" onClick={() => remove(e)}>Remove</button>}
              </div>
            </div>
          ))}
          <div className="buttons">
            {mayPost && <button className="accent" onClick={() => setEditing({ day: openDay })}>Add an event</button>}
            <button onClick={() => setOpenDay(null)}>Close</button>
          </div>
        </Dialog>
      )}
      {editing && (
        <EventDialog day={editing.day} event={editing.event} onClose={() => setEditing(null)}
          onSave={async body => {
            try { if (editing.event) await api.editEvent(editing.event.id, body); else await api.postEvent(channelId, body); setEditing(null) }
            catch (e) { setError(e instanceof Error ? e.message : 'The event could not be saved.') }
          }} />
      )}
    </div>
  )
}

/** A new event for a day, or one being changed: its title, the day, a time if it has one, and a note. */
function EventDialog({ day, event, onSave, onClose }: {
  day: string; event?: CalendarEventDto
  onSave: (body: { title: string; note: string | null; day: string; at: string | null }) => void | Promise<void>
  onClose: () => void
}) {
  const startsAt = event?.at ? new Date(event.at) : null
  const [title, setTitle] = useState(event?.title ?? '')
  const [on, setOn] = useState(event ? shownDay(event) : day)
  const [time, setTime] = useState(startsAt ? `${two(startsAt.getHours())}:${two(startsAt.getMinutes())}` : '')
  const [note, setNote] = useState(event?.note ?? '')
  const ready = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on)
  const save = () => {
    if (!ready) return
    // The time is this person's own clock on that day; it is sent as the moment it is, so everyone sees it in theirs.
    const at = time ? new Date(`${on}T${time}`) : null
    void onSave({ title: title.trim(), note: note.trim() || null, day: on, at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null })
  }
  return (
    <Dialog title={event ? 'Change the event' : 'Add an event'} onClose={onClose}>
      <div className="muted">What</div>
      <input autoFocus value={title} maxLength={100} placeholder="Zakum run" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
      <div className="row">
        <label className="grow"><div className="muted">Day</div><input type="date" value={on} onChange={e => setOn(e.target.value)} /></label>
        <label className="grow"><div className="muted">Time, if it has one</div><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      </div>
      <div className="muted">Note, if it needs one</div>
      <textarea value={note} maxLength={1000} rows={3} onChange={e => setNote(e.target.value)} />
      {time && <div className="muted">The time is yours. Everyone sees it in their own time zone.</div>}
      <div className="buttons">
        <button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={!ready} onClick={save}>{event ? 'Save' : 'Add'}</button>
      </div>
    </Dialog>
  )
}
