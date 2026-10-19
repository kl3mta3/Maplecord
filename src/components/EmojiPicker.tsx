import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Apple, Clock, Flag, Gamepad2, Heart, Lamp, Leaf, Plane, Search, Smile } from 'lucide-react'
import type { ExpressionDto } from '../types'
import { CustomEmoji, tokenOf } from '../expressions'
import { Twemoji } from '../emoji'
import { frequentEmojis, loadEmojis, noteEmojiUse, setSkinTone, skinTone } from '../emojiMatch'
import type { EmojiRow } from '../emojiData'

/** A server's custom emojis one may use here, as a part of the picker. */
export interface EmojiGroup { key: string; title: string; icon: string | null; items: ExpressionDto[] }

/** What the picker hands back: an ordinary emoji as it is written, or a custom one. */
export type Picked = string | ExpressionDto

const GROUP_ICONS = [Smile, Leaf, Apple, Gamepad2, Plane, Lamp, Heart, Flag]
const TONE_HANDS = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const FREQUENT = 24
/** Found by a search: at most this many, the best first. */
const MOST_FOUND = 200
/** The sizes the list is laid out in (index.css: .eptitle, .epgrid, .epitem), so that where each part is can be worked out
 *  without drawing it: only the parts near what is in view are drawn. */
const TITLE = 32, CELL = 40, GAP = 2, PAD = 8, NEAR = 300

type Item = { kind: 'u'; emoji: string; name: string } | { kind: 'c'; e: ExpressionDto; from: string }
interface Section { key: string; title: string; icon: React.ReactNode; items: Item[] }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

/**
 * Every emoji one may use, as Discord lays it out: a search, the most used, the custom emojis of each server one may
 * use here, then all of Unicode's in its groups; down the side, a button for each part; at the foot, the one pointed at
 * and its :name:. Picking one with Shift held keeps the picker open for another.
 */
export function EmojiBrowser({ groups, loading, onPick }: { groups: EmojiGroup[]; loading?: boolean; onPick: (picked: Picked, more: boolean) => void }) {
  const [rows, setRows] = useState<EmojiRow[] | null>(null)
  const [groupNames, setGroupNames] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [find, setFind] = useState('')
  const [tone, setTone] = useState(skinTone)
  const [choosingTone, setChoosingTone] = useState(false)
  const [pointed, setPointed] = useState<Item | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [frequent] = useState(() => frequentEmojis(FREQUENT))
  const [view, setView] = useState({ top: 0, height: 400, width: 360 })

  useEffect(() => {
    let alive = true
    loadEmojis().then(d => { if (alive) { setRows(d.EMOJIS); setGroupNames(d.EMOJI_GROUPS) } }, () => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])
  // How wide and tall the list is, and where it is scrolled to.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const toned = (row: EmojiRow) => (tone > 0 && row[4] ? row[4][tone - 1]! : row[0])
  const nameOf = (row: EmojiRow) => row[1].split(' ')[0]!

  const sections = useMemo((): Section[] => {
    const customById = new Map<string, { e: ExpressionDto; from: string }>()
    for (const g of groups) for (const e of g.items) customById.set(e.id, { e, from: g.title })
    const byEmoji = new Map<string, EmojiRow>()
    for (const r of rows ?? []) { byEmoji.set(r[0], r); for (const t of r[4] ?? []) byEmoji.set(t, r) }
    const out: Section[] = []
    // The most used: only what can be used here (a custom emoji of a server one may not use here is left out).
    const usual: Item[] = []
    for (const f of frequent) {
      const id = /^<:[A-Za-z0-9_]+:([0-9a-fA-F-]{36})>$/.exec(f)?.[1]
      if (id) { const c = customById.get(id); if (c) usual.push({ kind: 'c', ...c }); continue }
      const row = byEmoji.get(f)
      usual.push({ kind: 'u', emoji: f, name: row ? nameOf(row) : f })
    }
    out.push({ key: 'frequent', title: 'Frequently used', icon: <Clock size={18} />, items: usual })
    for (const g of groups) {
      if (g.items.length === 0) continue
      out.push({ key: 'g:' + g.key, title: g.title, icon: g.icon ? <img src={g.icon} alt="" draggable={false} /> : <i>{initials(g.title)}</i>, items: g.items.map(e => ({ kind: 'c', e, from: g.title })) })
    }
    groupNames.forEach((title, i) => {
      const Icon = GROUP_ICONS[i] ?? Smile
      out.push({ key: 'u:' + i, title, icon: <Icon size={18} />, items: (rows ?? []).filter(r => r[3] === i).map(r => ({ kind: 'u', emoji: toned(r), name: nameOf(r) })) })
    })
    return out.filter(s => s.items.length > 0)
  }, [rows, groupNames, groups, frequent, tone]) // eslint-disable-line react-hooks/exhaustive-deps -- toned and nameOf follow tone

  // Where each part is: its title, then rows of cells as many across as fit.
  const across = Math.max(1, Math.floor((view.width - 2 * PAD + GAP) / (CELL + GAP)))
  const placed = useMemo(() => {
    let at = 0
    return sections.map(s => {
      const height = TITLE + Math.ceil(s.items.length / across) * (CELL + GAP)
      const p = { ...s, top: at, height }
      at += height
      return p
    })
  }, [sections, across])
  const active = [...placed].reverse().find(s => s.top <= view.top + 8)?.key ?? placed[0]?.key

  // A search: every word must be found, in a :name: or the words the emoji is known by; names that start with it first.
  const found = useMemo((): Item[] | null => {
    const words = find.toLowerCase().replace(/:/g, ' ').split(/\s+/).filter(Boolean)
    if (words.length === 0) return null
    const hits: { item: Item; rank: number }[] = []
    for (const g of groups) for (const e of g.items) {
      const name = e.name.toLowerCase()
      if (words.every(w => name.includes(w))) hits.push({ item: { kind: 'c', e, from: g.title }, rank: name.startsWith(words[0]!) ? 0 : 2 })
    }
    for (const r of rows ?? []) {
      const names = r[1], all = names + ' ' + r[2]
      if (!words.every(w => all.includes(w))) continue
      const first = words[0]!
      const rank = names.split(' ').some(n => n.startsWith(first)) ? 1 : (' ' + all).includes(' ' + first) ? 3 : 4
      hits.push({ item: { kind: 'u', emoji: toned(r), name: nameOf(r) }, rank })
    }
    return hits.sort((a, b) => a.rank - b.rank).slice(0, MOST_FOUND).map(h => h.item)
  }, [find, rows, groups, tone]) // eslint-disable-line react-hooks/exhaustive-deps -- toned and nameOf follow tone

  const pick = (item: Item, more: boolean) => {
    if (item.kind === 'u') { noteEmojiUse(item.emoji); onPick(item.emoji, more) } else { noteEmojiUse(tokenOf(item.e)); onPick(item.e, more) }
  }
  const go = (key: string) => {
    setFind('')
    const to = placed.find(s => s.key === key)?.top ?? 0
    window.setTimeout(() => { if (list.current) list.current.scrollTop = to })
  }
  /** A part's rows near what is in view, under its title; the rows above them are empty room. */
  const drawn = (s: { title: string; items: Item[]; top: number }) => {
    const step = CELL + GAP, rowCount = Math.ceil(s.items.length / across)
    const first = Math.max(0, Math.floor((view.top - NEAR - s.top - TITLE) / step))
    const last = Math.min(rowCount, Math.ceil((view.top + view.height + NEAR - s.top - TITLE) / step))
    if (last <= first) return null
    return <><div className="eptitle">{s.title}</div><div style={{ height: first * step }} />{grid(s.items.slice(first * across, last * across), first * across)}</>
  }
  const onScroll = () => { const el = list.current; if (el) setView(v => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop })) }

  const grid = (items: Item[], offset = 0) => (
    <div className="epgrid" style={{ gridTemplateColumns: `repeat(${across}, ${CELL}px)` }}>
      {items.map((item, i) => (
        <button key={item.kind === 'u' ? item.emoji + (offset + i) : item.e.id} className="epitem" aria-label={item.kind === 'u' ? item.name : item.e.name}
          onClick={e => pick(item, e.shiftKey)} onMouseEnter={() => setPointed(item)} onFocus={() => setPointed(item)}>
          {item.kind === 'u' ? <Twemoji emoji={item.emoji} /> : <CustomEmoji name={item.e.name} id={item.e.id} />}
        </button>
      ))}
    </div>
  )

  return (
    <div className="emojibrowser">
      <div className="eptop">
        <label className="epsearch"><Search size={16} />
          <input value={find} onChange={e => setFind(e.target.value)} placeholder="Find the perfect emoji" aria-label="Find an emoji" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && found?.[0]) { e.preventDefault(); pick(found[0], e.shiftKey) } }} />
        </label>
        <div className="eptone">
          <button className="subtle" title="Skin tone" aria-label="Skin tone" onClick={() => setChoosingTone(c => !c)}><Twemoji emoji={TONE_HANDS[tone]!} /></button>
          {choosingTone && (
            <div className="eptones" role="listbox" aria-label="Skin tone">
              {TONE_HANDS.map((hand, i) => <button key={hand} className={i === tone ? 'on' : ''} aria-label={['No skin tone', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'][i]}
                onClick={() => { setTone(i); setSkinTone(i); setChoosingTone(false) }}><Twemoji emoji={hand} /></button>)}
            </div>
          )}
        </div>
      </div>
      <div className="epbody">
        <nav className="eprail" aria-label="Parts">
          {placed.map(s => (
            <button key={s.key} className={'eprailbtn' + (s.key.startsWith('g:') ? ' server' : '') + (active === s.key && !found ? ' on' : '')} title={s.title} aria-label={s.title} onClick={() => go(s.key)}>{s.icon}</button>
          ))}
        </nav>
        <div className="eplist" ref={list} onScroll={onScroll}>
          {found ? (
            found.length > 0 ? <section><div className="eptitle">Found</div>{grid(found)}</section> : <div className="muted epempty">No emoji by that name.</div>
          ) : (
            // Each part takes the room it needs; only the ones near what is in view are drawn into it.
            placed.map(s => (
              <section key={s.key} data-sec={s.key} style={{ height: s.height }}>
                {drawn(s)}
              </section>
            ))
          )}
          {!rows && !failed && <div className="muted epempty">Loading emojis…</div>}
          {failed && <div className="muted epempty">The emojis could not be loaded.</div>}
          {loading && <div className="muted epempty">Loading this server's emojis…</div>}
        </div>
      </div>
      <div className="epfoot">
        {pointed && (pointed.kind === 'u'
          ? <><Twemoji emoji={pointed.emoji} /><b>:{pointed.name}:</b></>
          : <><CustomEmoji name={pointed.e.name} id={pointed.e.id} /><b>:{pointed.e.name}:</b><span className="muted">{pointed.from}</span></>)}
      </div>
    </div>
  )
}
