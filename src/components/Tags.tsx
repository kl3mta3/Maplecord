import { useEffect, useState } from 'react'
import type { GuildDto, TagCardDto, TagDto } from '../types'
import { assetUrl } from '../profile'
import { Dialog } from './Dialogs'

// Server tags. A server can set one (a symbol and up to four letters or digits); a member can wear the tag of one of
// their servers, and it shows beside their name wherever their name does. Clicking one says whose it is.

/** Asks for the card of the server a tag belongs to. Whoever shows the card (the shell) listens here. */
const listeners = new Set<(guildId: string) => void>()
export const onTagOpened = (listener: (guildId: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const openTag = (guildId: string) => { for (const listener of listeners) listener(guildId) }

/** The tag as it sits beside a name: always the same height, and never wider than four letters and a symbol. */
export function TagPill({ tag, still }: { tag: Pick<TagDto, 'text' | 'symbol'> & { guildId?: string }; still?: boolean }) {
  const open = still || !tag.guildId ? undefined : (e: { stopPropagation(): void }) => { e.stopPropagation(); openTag(tag.guildId!) }
  return (
    <span className={'tagpill' + (open ? ' clickable' : '')} title={open ? 'Server tag: see which server' : undefined} onClick={open}
      role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} onKeyDown={open ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e) } } : undefined}>
      {tag.symbol && <span className="sym" aria-hidden="true">{tag.symbol}</span>}{tag.text}
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

/** Server settings: the tag this server's members may wear. */
export function TagSettings({ guild, people, symbols, onSave, onRemove }: {
  guild: GuildDto; people: number; symbols: () => Promise<string[]>
  onSave: (text: string, symbol: string | null) => Promise<void>; onRemove: () => Promise<void>
}) {
  const [text, setText] = useState(guild.tagText ?? '')
  const [symbol, setSymbol] = useState<string | null>(guild.tagSymbol ?? null)
  const [list, setList] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(guild.tagText ?? ''); setSymbol(guild.tagSymbol ?? null) }, [guild.tagText, guild.tagSymbol])
  const pick = async () => { setPicking(p => !p); if (!list) setList(await symbols().catch(() => [])) }
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNote('')
    try { await work() } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  const changed = clean !== (guild.tagText ?? '') || symbol !== (guild.tagSymbol ?? null)
  if (guild.noTag) return <div className="tagsettings"><div className="muted">Server tag</div><div className="muted">Tags have been turned off for this server.</div></div>
  return (
    <div className="tagsettings">
      <div className="muted">Server tag <span>— members can wear it beside their name, everywhere. Up to 4 letters or digits, and a symbol if you like.</span></div>
      {people < 3 && !guild.tagText && <div className="muted">A server needs at least 3 members before it can have a tag.</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button onClick={() => void pick()} aria-label="Choose a symbol" title="Choose a symbol">{symbol ?? '＋'}</button>
        <input value={clean} maxLength={4} placeholder="TAG" aria-label="Server tag" style={{ width: '7ch', textTransform: 'uppercase' }} onChange={e => setText(e.target.value)} />
        {clean && <TagPill tag={{ text: clean, symbol }} still />}
        <button className="accent" disabled={busy || !clean || !changed} onClick={() => void act(() => onSave(clean, symbol))}>Save tag</button>
        {guild.tagText && <button className="subtle" disabled={busy} onClick={() => void act(onRemove)}>Remove tag</button>}
      </div>
      {picking && (
        <div className="symbols" role="listbox" aria-label="Symbols">
          <button className={symbol === null ? 'sel' : ''} onClick={() => { setSymbol(null); setPicking(false) }}>None</button>
          {(list ?? []).map(s => <button key={s} className={symbol === s ? 'sel' : ''} aria-label={s} onClick={() => { setSymbol(s); setPicking(false) }}>{s}</button>)}
        </div>
      )}
      {note && <div className="error">{note}</div>}
    </div>
  )
}
