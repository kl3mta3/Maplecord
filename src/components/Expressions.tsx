import { useEffect, useMemo, useRef, useState } from 'react'
import type { Api } from '../api'
import type { ExpressionDto, ExpressionLibraryDto, GuildExpressionsDto, UsableExpressionsDto } from '../types'
import { CustomEmoji, nameFromFile, soundToWav } from '../expressions'
import { ChevronDown, Search, Star, Volume2, VolumeX } from 'lucide-react'
import { ConfirmDialog } from './Dialogs'
import { checkBeforeSending } from '../pictureCheck'

const KIND_NAMES = ['emoji', 'sticker', 'sound'] as const
const KIND_TITLES = ['Emojis', 'Stickers', 'Sounds'] as const

/** A box opened where the pointer was (centred on it, or starting from it), kept inside the window, closed by Escape or a click outside it. */
function Popover({ x, y, fromLeft, className, label, onClose, children }: { x: number; y: number; fromLeft?: boolean; className: string; label: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: x, top: y })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(fromLeft ? x : x - r.width / 2, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y - r.height - 8, window.innerHeight - r.height - 8)) })
  }, [x, y, fromLeft])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pickerback" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} className={className} role="dialog" aria-label={label} style={{ left: at.left, top: at.top }}>{children}</div>
    </div>
  )
}

/**
 * Emojis and stickers to put in a message: this server's, one's own and one's other servers' (where the server allows
 * those), and the ordinary emojis. An emoji goes into the message box as :name:, a sticker is sent at once.
 */
export function ExpressionPicker({ x, y, fromLeft, usable, unicode, startOn, onEmoji, onSticker, onClose }: {
  x: number; y: number; fromLeft?: boolean; usable: UsableExpressionsDto | null; unicode: string[]; startOn: 'emoji' | 'sticker'
  onEmoji: (emoji: string | ExpressionDto) => void; onSticker?: (sticker: ExpressionDto) => void; onClose: () => void
}) {
  const [tab, setTab] = useState(startOn)
  const [find, setFind] = useState('')
  const kind = tab === 'emoji' ? 0 : 1
  const groups = useMemo(() => {
    if (!usable) return []
    const match = (e: ExpressionDto) => e.kind === kind && (!find || e.name.toLowerCase().includes(find.toLowerCase()))
    const out: { title: string; items: ExpressionDto[] }[] = [{ title: 'This server', items: usable.here.filter(match) }]
    if (usable.outside) {
      out.push({ title: 'Yours', items: usable.mine.filter(match) })
      for (const g of usable.others) out.push({ title: g.name, items: g.items.filter(match) })
    }
    return out.filter(g => g.items.length > 0)
  }, [usable, kind, find])
  const stickers = !!usable?.stickers && !!onSticker
  return (
    <Popover x={x} y={y} fromLeft={fromLeft} className="exprpicker" label={tab === 'emoji' ? 'Emojis' : 'Stickers'} onClose={onClose}>
      <div className="row">
        {stickers ? (
          <div className="tabs">
            <button className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>Emojis</button>
            <button className={tab === 'sticker' ? 'on' : ''} onClick={() => setTab('sticker')}>Stickers</button>
          </div>
        ) : <b className="grow">Emojis</b>}
        <input className="grow" placeholder="Find by name" value={find} onChange={e => setFind(e.target.value)} aria-label="Find by name" autoFocus />
      </div>
      <div className="exprgroups">
        {!usable && <div className="muted">Loading…</div>}
        {groups.map(g => (
          <section key={g.title}>
            <div className="exprtitle">{g.title}</div>
            <div className={tab === 'emoji' ? 'emojigrid' : 'stickergrid'}>
              {g.items.map(e => (
                <button key={e.id} title={`:${e.name}:`} aria-label={e.name} onClick={() => { if (tab === 'emoji') onEmoji(e); else { onSticker?.(e); onClose() } }}>
                  <img src={e.url} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          </section>
        ))}
        {usable && groups.length === 0 && (tab === 'sticker' || find) && (
          <div className="muted small">{find ? 'Nothing by that name.' : usable.outside ? 'No stickers here or in your library yet. Someone who manages a server adds them in its settings, under Emojis & sounds.' : 'This server has no stickers, and only allows its own.'}</div>
        )}
        {tab === 'emoji' && !find && (
          <section>
            <div className="exprtitle">Emoji</div>
            <div className="emojigrid plain">{unicode.map(u => <button key={u} aria-label={u} onClick={() => onEmoji(u)}>{u}</button>)}</div>
          </section>
        )}
      </div>
    </Popover>
  )
}

/**
 * The server's sounds, to play to everyone in the voice channel: found by name, one's favourites first (kept on this
 * device), then the server's, each part folding away; and, behind the speaker, how loud other people's are for oneself.
 */
export function SoundboardPanel({ x, y, server, sounds, favorites, volume, muted, onPlay, onFavorite, onVolume, onMute, onClose }: {
  x: number; y: number; server: string; sounds: ExpressionDto[] | null; favorites: string[]; volume: number; muted: boolean
  onPlay: (sound: ExpressionDto) => void; onFavorite: (id: string, on: boolean) => void
  onVolume: (v: number) => void; onMute: (m: boolean) => void; onClose: () => void
}) {
  const [find, setFind] = useState('')
  const [hearing, setHearing] = useState(false)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const wanted = find.trim().toLowerCase()
  const shown = (sounds ?? []).filter(s => !wanted || s.name.toLowerCase().includes(wanted))
  const faves = shown.filter(s => favorites.includes(s.id))
  const tile = (s: ExpressionDto) => {
    const fave = favorites.includes(s.id)
    return (
      <div key={s.id} className="soundtile">
        <button className="play" onClick={() => onPlay(s)} title={`Play ${s.name} to everyone here`}><Volume2 size={15} /><span>{s.name}</span></button>
        <button className={'fave' + (fave ? ' on' : '')} onClick={() => onFavorite(s.id, !fave)} title={fave ? 'Take out of favourites' : 'Add to favourites'} aria-label={(fave ? 'Take out of favourites: ' : 'Add to favourites: ') + s.name}>
          <Star size={13} fill={fave ? 'currentColor' : 'none'} /></button>
      </div>
    )
  }
  const part = (key: string, title: React.ReactNode, items: ExpressionDto[]) => (
    <section key={key}>
      <button className="soundpart" onClick={() => setFolded(f => ({ ...f, [key]: !f[key] }))} aria-expanded={!folded[key]}>
        {title}<ChevronDown size={14} className={folded[key] ? 'folded' : ''} /></button>
      {!folded[key] && <div className="soundgrid">{items.map(tile)}</div>}
    </section>
  )
  return (
    <Popover x={x} y={y} className="soundboard" label="Soundboard" onClose={onClose}>
      <div className="row soundtop">
        <label className="soundfind grow"><Search size={15} />
          <input autoFocus placeholder="Find a sound" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a sound" /></label>
        <button className={'iconbtn' + (hearing ? ' on' : '')} onClick={() => setHearing(h => !h)} title="How loud other people's sounds are for you" aria-label="Soundboard volume"
          aria-expanded={hearing}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
      </div>
      {hearing && (
        <div className="soundhear">
          <label className="row small">Volume for you
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => onVolume(Number(e.target.value))} className="grow" aria-label="Soundboard volume" />
          </label>
          <label className="row small"><input type="checkbox" checked={muted} onChange={e => onMute(e.target.checked)} /> Mute soundboards: hear nobody's sounds</label>
        </div>
      )}
      <div className="soundlist">
        {!sounds && <div className="muted">Loading…</div>}
        {sounds?.length === 0 && <div className="muted small">This server has no sounds yet. Someone who manages the server adds them in its settings, under Emojis & sounds.</div>}
        {sounds && sounds.length > 0 && shown.length === 0 && <div className="muted small">No sound here is called that.</div>}
        {faves.length > 0 && part('faves', <><Star size={13} fill="currentColor" /> Favourites</>, faves)}
        {shown.length > 0 && part('server', server, shown)}
      </div>
    </Popover>
  )
}

/** One of a server's (or one's library's) emojis, stickers or sounds, drawn. */
function Preview({ e }: { e: ExpressionDto }) {
  if (e.kind === 2) return <button className="soundpreview" title="Hear it" onClick={() => void new Audio(e.url).play()}>▶</button>
  return e.kind === 0 ? <CustomEmoji name={e.name} id={e.id} /> : <img className="stickerpreview" src={e.url} alt="" />
}

/**
 * A server's settings, Emojis & sounds: what it has, new ones uploaded (kept in the uploader's library and counted
 * there), ones from one's library added, and whether members may use ones from outside it.
 */
export function GuildExpressionsTab({ api, guildId, meId, mayManage, mayGuild, isPublic, onOutside }: {
  api: Api; guildId: string; meId: string; mayManage: boolean; mayGuild: boolean; isPublic: boolean; onOutside: (allowed: boolean) => Promise<void>
}) {
  const [data, setData] = useState<GuildExpressionsDto | null>(null)
  const [library, setLibrary] = useState<ExpressionLibraryDto | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ kind: number; file: File; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickingKind = useRef(0)
  const load = async () => {
    try { setData(await api.guildExpressions(guildId)); setLibrary(await api.myExpressions()) }
    catch (err) { setProblem(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { void load() }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: () => Promise<unknown>) => {
    setBusy(true); setProblem(null)
    try { await what(); await load() } catch (err) { setProblem(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  const upload = () => adding && act(async () => {
    const file = adding.kind === 2 ? await soundToWav(adding.file) : adding.file
    if (adding.kind !== 2) await checkBeforeSending(file, adding.kind === 0 ? 'as an emoji' : 'as a sticker')
    await api.uploadExpression(guildId, KIND_NAMES[adding.kind], adding.name.trim(), file, adding.kind === 2 ? 'sound.wav' : adding.file.name)
    setAdding(null)
  })
  if (!data) return <div className="muted">{problem ?? 'Loading…'}</div>
  const on = [data.emojis, data.stickers, data.sounds]
  const most = [data.mostEmojis, data.mostStickers, data.mostSounds]
  const libraryMost = library ? [library.mostEmojis, library.mostStickers, library.mostSounds] : [0, 0, 0]
  if (!on.some(Boolean)) return <div className="muted">Custom emojis, stickers and sounds are switched off on this Maplecord.</div>
  return (
    <div className="exprtab">
      <input ref={fileRef} type="file" hidden accept={pickingKind.current === 2 ? 'audio/*' : 'image/png,image/jpeg,image/gif,image/webp'}
        onChange={e => { const f = e.target.files?.[0]; if (f) setAdding({ kind: pickingKind.current, file: f, name: nameFromFile(f.name) }); e.target.value = '' }} />
      {problem && <div className="error">{problem}</div>}
      {mayGuild && (on[0] || on[1]) && (
        <label className="choice"><input type="checkbox" checked={data.outside} disabled={busy} onChange={e => void act(() => onOutside(e.target.checked))} />
          <span><b>Members may use emojis and stickers from outside this server</b> <span className="muted">Their own, and those of the other servers they are in. {isPublic ? 'Off unless switched on, as this server is public.' : 'On unless switched off, as this server is private.'}</span></span></label>
      )}
      {[0, 1, 2].filter(k => on[k]).map(kind => {
        const items = data.items.filter(e => e.kind === kind)
        const mine = (library?.items ?? []).filter(e => e.kind === kind && !items.some(i => i.id === e.id))
        const mineCount = (library?.items ?? []).filter(e => e.kind === kind).length
        return (
          <section key={kind}>
            <h4>{KIND_TITLES[kind]} <span className="muted small">{items.length} of {most[kind]}</span></h4>
            <div className="exprlist">
              {items.map(e => (
                <div key={e.id} className="expritem">
                  <Preview e={e} /><span className="grow">{e.kind === 0 ? `:${e.name}:` : e.name}</span>
                  {(mayManage || e.ownerId === meId) && <button className="subtle" disabled={busy} title="Take it off this server (it stays in its owner's library)" onClick={() => void act(() => api.removeGuildExpression(guildId, e.id))}>Remove</button>}
                </div>
              ))}
              {items.length === 0 && <div className="muted small">None yet.</div>}
            </div>
            {mayManage && (
              adding?.kind === kind ? (
                <div className="row">
                  <span className="muted small">{adding.file.name}</span>
                  <input className="grow" value={adding.name} maxLength={32} onChange={e => setAdding({ ...adding, name: e.target.value })} aria-label="Name" placeholder="Name: letters, digits, _" />
                  <button className="accent" disabled={busy || !/^[A-Za-z0-9_]{2,32}$/.test(adding.name.trim())} onClick={() => void upload()}>{busy ? 'Adding…' : 'Add'}</button>
                  <button className="subtle" onClick={() => setAdding(null)}>Cancel</button>
                </div>
              ) : (
                <div className="row">
                  <button disabled={busy || items.length >= most[kind] || mineCount >= libraryMost[kind]} onClick={() => { pickingKind.current = kind; setTimeout(() => fileRef.current?.click()) }}>Upload {KIND_NAMES[kind] === 'emoji' ? 'an emoji' : 'a ' + KIND_NAMES[kind]}</button>
                  <span className="muted small grow">{kind === 2 ? 'Any sound file: its first 5 seconds are kept, set to the same loudness as every other sound.' : `PNG, JPEG, GIF or WebP, moving or not, up to ${kind === 0 ? data.emojiKb : data.stickerKb} KB.`} Your library: {mineCount} of {libraryMost[kind]}.</span>
                </div>
              )
            )}
            {mayManage && mine.length > 0 && items.length < most[kind] && (
              <details className="fromlibrary">
                <summary>Add from your library ({mine.length})</summary>
                <div className="exprlist">
                  {mine.map(e => (
                    <div key={e.id} className="expritem"><Preview e={e} /><span className="grow">{e.name}</span>
                      <button disabled={busy} onClick={() => void act(() => api.addGuildExpression(guildId, e.id))}>Add here</button></div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Settings, Emojis & sounds: one's own library. Renamed here; removed here, from every server it is on. */
export function ExpressionLibrary({ api }: { api: Api }) {
  const [data, setData] = useState<ExpressionLibraryDto | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<ExpressionDto | null>(null)
  const load = async () => { try { setData(await api.myExpressions()) } catch (err) { setProblem(err instanceof Error ? err.message : String(err)) } }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (what: () => Promise<unknown>) => { setProblem(null); try { await what(); await load() } catch (err) { setProblem(err instanceof Error ? err.message : String(err)) } }
  if (!data) return <div className="muted">{problem ?? 'Loading…'}</div>
  const most = [data.mostEmojis, data.mostStickers, data.mostSounds]
  return (
    <div className="exprtab">
      <p className="muted small">The emojis, stickers and sounds you uploaded. Each is kept once here, however many of your servers it is on, and counts towards your library. You add new ones in a server's settings, under Emojis & sounds, where you can also add these to your other servers.</p>
      {problem && <div className="error">{problem}</div>}
      {[0, 1, 2].map(kind => {
        const items = data.items.filter(e => e.kind === kind)
        return (
          <section key={kind}>
            <h4>{KIND_TITLES[kind]} <span className="muted small">{items.length} of {most[kind]}</span></h4>
            <div className="exprlist">
              {items.map(e => (
                <div key={e.id} className="expritem">
                  <Preview e={e} />
                  {renaming?.id === e.id ? (
                    <>
                      <input className="grow" value={renaming.name} maxLength={32} onChange={x => setRenaming({ ...renaming, name: x.target.value })} aria-label="New name" autoFocus />
                      <button className="accent" disabled={!/^[A-Za-z0-9_]{2,32}$/.test(renaming.name.trim())} onClick={() => void act(async () => { await api.renameExpression(e.id, renaming.name.trim()); setRenaming(null) })}>Save</button>
                      <button className="subtle" onClick={() => setRenaming(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="grow">{e.name} <span className="muted small">on {e.servers} server{e.servers === 1 ? '' : 's'}</span></span>
                      <button className="subtle" onClick={() => setRenaming({ id: e.id, name: e.name })}>Rename</button>
                      <button className="subtle danger" onClick={() => setRemoving(e)}>Delete</button>
                    </>
                  )}
                </div>
              ))}
              {items.length === 0 && <div className="muted small">None yet.</div>}
            </div>
          </section>
        )
      })}
      {removing && <ConfirmDialog title={`Delete ${removing.name}?`} message={`It is taken off ${removing.servers === 1 ? 'the server' : `all ${removing.servers} servers`} it is on, and out of your library. Messages that used it show its name instead.`}
        onConfirm={() => void act(() => api.deleteExpression(removing.id))} onClose={() => setRemoving(null)} />}
    </div>
  )
}

/** A sticker in a message: its picture, or its name if it has since been taken away. */
export function StickerView({ name, url }: { name: string; url: string }) {
  const [broken, setBroken] = useState(false)
  return broken ? <div className="muted small">Sticker: {name} (no longer there)</div>
    : <img className="sticker" src={url} alt={name} title={name} draggable={false} onError={() => setBroken(true)} />
}

