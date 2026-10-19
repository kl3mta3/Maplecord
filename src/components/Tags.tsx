import { useEffect, useId, useState } from 'react'
import type { GuildDto, TagCardDto, TagDto } from '../types'
import { assetUrl } from '../profile'
import { Dialog } from './Dialogs'
import { Twemoji } from '../emoji'
import { emojiUrl } from '../emojiMatch'
import { THICKNESSES, readLook, tooDark, writeLook, type TagLook } from '../tagLook'

// Server tags. A server can set one (a symbol and up to five letters or digits); a member can wear the tag of one of
// their servers, and it shows beside their name wherever their name does. Clicking one says whose it is.

/**
 * This Maplecord's own logo, as a tag's symbol. Only the people who run it can give a tag this one. It is the maple
 * leaf with a mark after it that draws nothing, so anything that only knows text shows the leaf.
 */
const LOGO = '🍁\uFE0F'
/**
 * A tag's symbol: the logo as its own picture; any other as its emoji picture (Twemoji, the same on every device), in its
 * own colours or in the tag's style (see tagLook.ts). A style is drawn as a small SVG: the picture's shape (its alpha)
 * filled with one colour or a blend of two, and for a border that shape grown outwards in the border's colour. Done in
 * SVG rather than CSS masks, which a page opened from a file (the desktop app) is not allowed to take from its own files.
 */
function TagSymbol({ symbol, look }: { symbol: string; look?: string | null }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '')
  if (symbol === LOGO) return <img className="taglogo" src={import.meta.env.BASE_URL + 'favicon.png'} alt="" draggable={false} />
  const style = readLook(look)
  if (!style) return <Twemoji emoji={symbol} />
  const mask = 'm' + id, blend = 'g' + id, border = 'f' + id
  const ends = style.kind === 'two' ? { v: ['0', '0', '0', '1'], h: ['0', '0', '1', '0'], d: ['0', '0', '1', '1'] }[style.dir] : null
  // The picture is 36 units square; at a tag's 12 pixels a pixel of border is 3 units.
  return (
    <svg className="tagsil" viewBox="0 0 36 36" role="img" aria-label={symbol}>
      <defs>
        <mask id={mask} style={{ maskType: 'alpha' }}><image href={emojiUrl(symbol)} width="36" height="36" /></mask>
        {style.kind === 'two' && ends && (
          <linearGradient id={blend} x1={ends[0]} y1={ends[1]} x2={ends[2]} y2={ends[3]}>
            <stop offset="0" stopColor={style.a} /><stop offset="1" stopColor={style.b} />
          </linearGradient>
        )}
        {style.kind === 'edge' && (
          <filter id={border} x="-30%" y="-30%" width="160%" height="160%">
            <feMorphology in="SourceAlpha" operator="dilate" radius={style.thick * 3} result="grown" />
            <feFlood floodColor={style.edge} result="colour" />
            <feComposite in="colour" in2="grown" operator="in" result="edge" />
            <feMerge><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      <g filter={style.kind === 'edge' ? `url(#${border})` : undefined}>
        <rect width="36" height="36" mask={`url(#${mask})`} fill={style.kind === 'one' ? style.color : style.kind === 'two' ? `url(#${blend})` : style.fill} />
      </g>
    </svg>
  )
}

/** Asks for the card of the server a tag belongs to. Whoever shows the card (the shell) listens here. */
const listeners = new Set<(guildId: string) => void>()
export const onTagOpened = (listener: (guildId: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const openTag = (guildId: string) => { for (const listener of listeners) listener(guildId) }

/** The tag as it sits beside a name: always the same height, and never wider than five letters and a symbol. */
export function TagPill({ tag, still }: { tag: Pick<TagDto, 'text' | 'symbol' | 'look'> & { guildId?: string }; still?: boolean }) {
  const open = still || !tag.guildId ? undefined : (e: { stopPropagation(): void }) => { e.stopPropagation(); openTag(tag.guildId!) }
  return (
    <span className={'tagpill' + (open ? ' clickable' : '')} title={open ? 'Server tag: see which server' : undefined} onClick={open}
      role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} onKeyDown={open ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e) } } : undefined}>
      {tag.symbol && <span className="sym" aria-hidden="true"><TagSymbol symbol={tag.symbol} look={tag.look} /></span>}{tag.text}
    </span>
  )
}

/** Whose tag is that: what anyone may know about the server it belongs to. */
export function TagCardDialog({ guildId, serverUrl, load, onJoin, onClose }: {
  guildId: string; serverUrl: string; load: (guildId: string) => Promise<TagCardDto>; onJoin: (guildId: string) => Promise<void>; onClose: () => void
}) {
  const [card, setCard] = useState<TagCardDto | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    load(guildId).then(c => { if (!cancelled) setCard(c) }, () => { if (!cancelled) setNote('That tag no longer belongs to a server.') })
    return () => { cancelled = true }
  }, [guildId, load])
  const join = async () => {
    setBusy(true); setNote('')
    try { await onJoin(guildId); onClose() } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const icon = card ? assetUrl(serverUrl, card.iconUrl) : null
  return (
    <Dialog title="Server tag" onClose={onClose}>
      {!card ? <div className="muted">{note || 'Loading…'}</div> : (
        <div className="tagcard">
          <div className="row">
            {icon && <img className="icon" src={icon} alt="" />}
            <div className="grow">
              <div className="name">{card.name} <TagPill tag={card} still /></div>
              <div className="muted">{card.private ? 'A private server' : 'A public server'}{card.joined ? ' · you are in it' : ''}</div>
            </div>
          </div>
          {card.description && <div className="about">{card.description}</div>}
          <div className="facts muted">
            <span>{card.online} online</span><span>{card.members} {card.members === 1 ? 'member' : 'members'}</span>
            <span>Established {new Date(card.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}</span>
          </div>
          {card.private && !card.joined && <div className="muted">Its name is hidden from people who are not in it, and it can only be joined with an invite.</div>}
          {note && <div className="error">{note}</div>}
          <div className="buttons">
            <button onClick={onClose}>Close</button>
            {card.canJoin && <button className="accent" disabled={busy} onClick={() => void join()}>Join</button>}
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** The style editor's controls, all kept while switching between styles. */
interface Styling { kind: 'normal' | TagLook['kind']; one: string; a: string; b: string; dir: 'v' | 'h' | 'd'; fill: string; edge: string; thick: number }
function styling(look?: string | null): Styling {
  const s: Styling = { kind: 'normal', one: '#7cf5a8', a: '#ffd23f', b: '#ff4f8b', dir: 'v', fill: '#1b1b28', edge: '#4fd8ff', thick: 1 }
  const l = readLook(look)
  if (l?.kind === 'one') return { ...s, kind: 'one', one: l.color }
  if (l?.kind === 'two') return { ...s, kind: 'two', a: l.a, b: l.b, dir: l.dir }
  if (l?.kind === 'edge') return { ...s, kind: 'edge', fill: l.fill, edge: l.edge, thick: l.thick }
  return s
}
function lookOf(s: Styling): TagLook | null {
  if (s.kind === 'one') return { kind: 'one', color: s.one }
  if (s.kind === 'two') return { kind: 'two', a: s.a, b: s.b, dir: s.dir }
  if (s.kind === 'edge') return { kind: 'edge', fill: s.fill, edge: s.edge, thick: s.thick }
  return null
}

/** Server settings: the tag this server's members may wear. */
export function TagSettings({ guild, people, symbols, onSave, onRemove }: {
  guild: GuildDto; people: number; symbols: () => Promise<string[]>
  onSave: (text: string, symbol: string | null, look: string | null) => Promise<void>; onRemove: () => Promise<void>
}) {
  const [text, setText] = useState(guild.tagText ?? '')
  const [symbol, setSymbol] = useState<string | null>(guild.tagSymbol ?? null)
  const [style, setStyle] = useState<Styling>(() => styling(guild.tagLook))
  const [list, setList] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(guild.tagText ?? ''); setSymbol(guild.tagSymbol ?? null); setStyle(styling(guild.tagLook)) }, [guild.tagText, guild.tagSymbol, guild.tagLook])
  const pick = async () => { setPicking(p => !p); if (!list) setList(await symbols().catch(() => [])) }
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNote('')
    try { await work() } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  // The logo keeps its own look, and with no symbol there is nothing to draw in a style.
  const styleable = !!symbol && symbol !== LOGO
  const look = styleable ? lookOf(style) : null
  const written = writeLook(look)
  const dark = tooDark(look)
  const changed = clean !== (guild.tagText ?? '') || symbol !== (guild.tagSymbol ?? null) || written !== (guild.tagLook ?? null)
  const set = (change: Partial<Styling>) => setStyle(s => ({ ...s, ...change }))
  if (guild.noTag) return <div className="tagsettings"><div className="muted">Server tag</div><div className="muted">Tags have been turned off for this server.</div></div>
  return (
    <div className="tagsettings">
      <div className="muted">Server tag <span>— members can wear it beside their name, everywhere. Up to 5 letters or digits, and a symbol if you like.</span></div>
      {people < 3 && !guild.tagText && <div className="muted">A server needs at least 3 members before it can have a tag.</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button onClick={() => void pick()} aria-label="Choose a symbol" title="Choose a symbol">{symbol ? <TagSymbol symbol={symbol} /> : '＋'}</button>
        <input value={clean} maxLength={5} placeholder="TAG" aria-label="Server tag" style={{ width: '8ch', textTransform: 'uppercase' }} onChange={e => setText(e.target.value)} />
        {clean && <TagPill tag={{ text: clean, symbol, look: written }} still />}
        <button className="accent" disabled={busy || !clean || !changed || !!dark} onClick={() => void act(() => onSave(clean, symbol, written))}>Save tag</button>
        {guild.tagText && <button className="subtle" disabled={busy} onClick={() => void act(onRemove)}>Remove tag</button>}
      </div>
      {styleable && (
        <div className="row tagstyle" style={{ flexWrap: 'wrap' }}>
          <select value={style.kind} aria-label="How the symbol is drawn" onChange={e => set({ kind: e.target.value as Styling['kind'] })}>
            <option value="normal">Its own colours</option>
            <option value="one">One colour</option>
            <option value="two">Two colours</option>
            <option value="edge">Fill and border</option>
          </select>
          {style.kind === 'one' && <input type="color" value={style.one} aria-label="Colour" onChange={e => set({ one: e.target.value })} />}
          {style.kind === 'two' && (
            <>
              <input type="color" value={style.a} aria-label="First colour" onChange={e => set({ a: e.target.value })} />
              <input type="color" value={style.b} aria-label="Second colour" onChange={e => set({ b: e.target.value })} />
              <select value={style.dir} aria-label="Which way the colours blend" onChange={e => set({ dir: e.target.value as 'v' | 'h' | 'd' })}>
                <option value="v">Top to bottom</option>
                <option value="h">Left to right</option>
                <option value="d">Corner to corner</option>
              </select>
            </>
          )}
          {style.kind === 'edge' && (
            <>
              <span className="muted">Fill</span><input type="color" value={style.fill} aria-label="Fill colour" onChange={e => set({ fill: e.target.value })} />
              <span className="muted">Border</span><input type="color" value={style.edge} aria-label="Border colour" onChange={e => set({ edge: e.target.value })} />
              <input type="range" min={0} max={THICKNESSES.length - 1} step={1} value={Math.max(0, THICKNESSES.indexOf(style.thick))} aria-label="Border thickness"
                onChange={e => set({ thick: THICKNESSES[Number(e.target.value)] ?? 1 })} />
              <span className="muted">{style.thick} px</span>
            </>
          )}
        </div>
      )}
      {dark && <div className="error">{dark}</div>}
      {picking && (
        <div className="symbols" role="listbox" aria-label="Symbols">
          <button className={symbol === null ? 'sel' : ''} onClick={() => { setSymbol(null); setPicking(false) }}>None</button>
          {(list ?? []).map(s => <button key={s} className={symbol === s ? 'sel' : ''} aria-label={s === LOGO ? 'The Maplecord logo' : s} title={s === LOGO ? 'The Maplecord logo' : undefined} onClick={() => { setSymbol(s); setPicking(false) }}><TagSymbol symbol={s} /></button>)}
        </div>
      )}
      {note && <div className="error">{note}</div>}
    </div>
  )
}
