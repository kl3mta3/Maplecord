import { useEffect, useRef, useState } from 'react'
import type { AttachmentDto, MediaItem, MessageDto, NewPollDto, PollDto, ReactionDto, ReplyToDto, SearchResultDto } from '../types'
import { isElectron } from '../platform'
import { Dialog } from './Dialogs'

// The parts of the chat that belong to one message beyond its text: what it answers, its reactions, its poll, the
// thread hanging off it. And the lists a channel can be looked at through: its pins, a search, a forum's posts, a
// gallery's pictures.

/** The handful offered straight away; the rest are behind the + button. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀']

const when = (iso: string) => {
  const at = new Date(iso)
  return at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : at.toLocaleDateString([], { month: 'short', day: 'numeric', year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}
const firstLine = (text: string, most = 160) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > most ? line.slice(0, most) + '…' : line }
const isPicture = (a: AttachmentDto) => a.contentType.startsWith('image/') && !a.expired

/** The message another one answers, as a line above it. Clicking goes to that message. */
export function ReplyQuote({ reply, name, onJump, gone = 'The message this answers was deleted' }: { reply: ReplyToDto; name: string; onJump?: () => void; gone?: string }) {
  if (reply.gone) return <div className="replyquote gone">↱ {gone}</div>
  return (
    <button className="replyquote" title="Go to that message" onClick={onJump} disabled={!onJump}>
      ↱ <b>{name}</b> <span>{reply.snippet || '…'}</span>
    </button>
  )
}

/** The reactions under a message: each adds or takes back one's own, and + offers the rest. */
export function Reactions({ reactions, onToggle, onMore }: { reactions: ReactionDto[]; onToggle: (emoji: string, on: boolean) => void; onMore?: (e: React.MouseEvent) => void }) {
  return (
    <div className="reactions">
      {reactions.map(r => (
        <button key={r.emoji} className={'reaction' + (r.mine ? ' mine' : '')} aria-pressed={!!r.mine} title={r.mine ? 'Take your reaction back' : 'React with this too'}
          onClick={() => onToggle(r.emoji, !r.mine)}>{r.emoji} <span>{r.count}</span></button>
      ))}
      {onMore && <button className="reaction add" title="Add a reaction" aria-label="Add a reaction" onClick={onMore}>＋</button>}
    </div>
  )
}

/** Everything a message can be reacted with, opened where the pointer was. */
export function ReactionPicker({ x, y, choices, onPick, onClose }: { x: number; y: number; choices: () => Promise<string[]>; onPick: (emoji: string) => void; onClose: () => void }) {
  const [list, setList] = useState<string[]>(QUICK_REACTIONS)
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: x, top: y })
  useEffect(() => { let alive = true; void choices().then(all => { if (alive && all.length > 0) setList(all) }); return () => { alive = false } }, [choices])
  // Kept inside the window, wherever it was opened.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y, list.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pickerback" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} className="reactpicker" role="listbox" aria-label="React with" style={{ left: at.left, top: at.top }}>
        {list.map(emoji => <button key={emoji} aria-label={emoji} onClick={() => { onPick(emoji); onClose() }}>{emoji}</button>)}
      </div>
    </div>
  )
}

/** A poll on a message: the choices as buttons, each with how many picked it. */
export function PollView({ poll, mayClose, onVote, onClose }: { poll: PollDto; mayClose: boolean; onVote: (options: number[]) => void; onClose: () => void }) {
  const votes = poll.options.reduce((sum, o) => sum + o.votes, 0)
  const mine = poll.options.map((o, i) => (o.mine ? i : -1)).filter(i => i >= 0)
  const pick = (i: number) => {
    if (poll.closed) return
    // One choice: picking it again takes the vote back. Several: each is its own switch.
    if (poll.multi) onVote(mine.includes(i) ? mine.filter(x => x !== i) : [...mine, i])
    else onVote(mine.includes(i) ? [] : [i])
  }
  const closes = poll.closesAt ? new Date(poll.closesAt) : null
  return (
    <div className={'poll' + (poll.closed ? ' closed' : '')}>
      {poll.options.map((o, i) => (
        <button key={i} className={'option' + (o.mine ? ' mine' : '')} disabled={poll.closed} aria-pressed={!!o.mine} onClick={() => pick(i)}>
          <span className="bar" style={{ width: votes > 0 ? `${Math.round(o.votes / votes * 100)}%` : 0 }} />
          <span className="text">{o.mine ? '✓ ' : ''}{o.text}</span>
          <span className="count">{o.votes}</span>
        </button>
      ))}
      <div className="muted pollfoot">
        <span>{poll.voters} {poll.voters === 1 ? 'person' : 'people'} voted{poll.multi ? ' · pick as many as you like' : ''}</span>
        <span>{poll.closed ? 'Closed' : closes ? `Closes ${closes.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        {mayClose && !poll.closed && <button className="subtle" onClick={onClose}>Close poll</button>}
      </div>
    </div>
  )
}

/** Asking a question with choices. The question goes as the message's text. */
export function PollDialog({ onSubmit, onClose }: { onSubmit: (question: string, poll: NewPollDto) => void; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [hours, setHours] = useState('24')
  const filled = options.map(o => o.trim()).filter(Boolean)
  const same = new Set(filled.map(o => o.toLowerCase())).size !== filled.length
  const ok = question.trim().length > 0 && filled.length >= 2 && !same
  return (
    <Dialog title="Start a poll" onClose={onClose}>
      <input autoFocus placeholder="What are you asking?" maxLength={300} value={question} onChange={e => setQuestion(e.target.value)} />
      {options.map((o, i) => (
        <div className="row" key={i}>
          <input className="grow" placeholder={`Choice ${i + 1}`} maxLength={80} value={o} onChange={e => setOptions(all => all.map((x, j) => (j === i ? e.target.value : x)))} />
          {options.length > 2 && <button className="subtle" aria-label="Remove this choice" onClick={() => setOptions(all => all.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      {options.length < 10 && <button className="subtle" onClick={() => setOptions(all => [...all, ''])}>＋ Add a choice</button>}
      <label className="row"><input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} /> People can pick more than one</label>
      <label className="row">Open for
        <select value={hours} onChange={e => setHours(e.target.value)}>
          <option value="1">1 hour</option><option value="4">4 hours</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">1 week</option><option value="">Until I close it</option>
        </select>
      </label>
      {same && <div className="error">Two of the choices are the same.</div>}
      <div className="buttons"><button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={!ok} onClick={() => { onSubmit(question.trim(), { options: filled, multi, hours: hours ? Number(hours) : null }); onClose() }}>Post poll</button></div>
    </Dialog>
  )
}

/** A new post in a forum (a title and what it says) or a gallery (a title and its pictures). */
export function NewPostDialog({ gallery, mostPictures, mostText = 4000, onSubmit, onClose }: {
  gallery: boolean; mostPictures: number; mostText?: number; onSubmit: (title: string, text: string, files: File[]) => Promise<boolean>; onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const urls = files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''))
    setPreviews(urls)
    return () => { for (const u of urls) if (u) URL.revokeObjectURL(u) }
  }, [files])
  const add = (picked: File[]) => setFiles(all => [...all, ...picked.filter(f => !gallery || f.type.startsWith('image/'))].slice(0, mostPictures))
  const ok = title.trim().length > 0 && (gallery ? files.length > 0 : text.trim().length > 0 || files.length > 0) && !busy
  const post = async () => { setBusy(true); try { if (await onSubmit(title.trim(), text, files)) onClose() } finally { setBusy(false) } }
  return (
    <Dialog title={gallery ? 'Post pictures' : 'New post'} onClose={onClose} wide scrolls>
      <input autoFocus placeholder="Title" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} />
      <textarea rows={gallery ? 2 : 6} placeholder={gallery ? 'Say something about them (optional)' : 'What do you want to say?'} maxLength={mostText} value={text} onChange={e => setText(e.target.value)}
        onPaste={e => { const pasted = Array.from(e.clipboardData.files); if (pasted.length > 0 && !e.clipboardData.getData('text/plain')) { e.preventDefault(); add(pasted) } }} />
      <input ref={pickRef} type="file" hidden multiple accept={gallery ? 'image/png,image/jpeg,image/gif,image/webp' : undefined} onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <div className="postfiles" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); add(Array.from(e.dataTransfer.files)) }}>
        {files.map((f, i) => (
          <div className="postfile" key={i} title={f.name}>
            {previews[i] ? <img src={previews[i]} alt="" /> : <span className="muted">{f.name}</span>}
            <button className="subtle" aria-label={`Remove ${f.name}`} onClick={() => setFiles(all => all.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {files.length < mostPictures && <button className="postfile add" onClick={() => pickRef.current?.click()}>{gallery ? '＋ Picture' : '＋ File'}</button>}
      </div>
      <div className="muted">{gallery ? `Up to ${mostPictures} pictures. You can also paste them or drop them here.` : 'Files are optional.'}</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" disabled={!ok} onClick={() => void post()}>{busy ? 'Posting…' : 'Post'}</button></div>
    </Dialog>
  )
}

/**
 * Just the pictures and videos of a channel, newest first, as a grid. Clicking one goes to the message it is on.
 * A video is a tile with its name, not a frame of it: showing a frame would mean fetching part of every video.
 */
export function MediaGrid({ items, more, busy, nameOf, onOpen, onMore, picture }: {
  items: MediaItem[]; more: boolean; busy: boolean; nameOf: (item: MediaItem) => string; onOpen: (item: MediaItem) => void; onMore: () => void
  /** Draws a picture that is not on the server (one held by people's apps in a P2P channel). */
  picture?: (item: MediaItem) => React.ReactNode
}) {
  if (items.length === 0) return <div className="muted emptyposts">{busy ? 'Looking…' : 'There are no pictures or videos here.'}</div>
  return (
    <>
      <div className="mediagrid">
        {items.map(item => {
          const name = item.file?.fileName ?? item.p2pFile?.name ?? ''
          const video = (item.file?.contentType ?? item.p2pFile?.type ?? '').startsWith('video/')
          return (
            <button key={item.key} className="mediatile" onClick={() => onOpen(item)} title={`${name} · ${nameOf(item)}, ${new Date(item.at).toLocaleString()} · go to the message`}>
              {video ? <span className="video"><span className="play">▶</span><span className="name">{name}</span></span>
                : item.file ? <MediaPicture file={item.file} /> : picture?.(item)}
            </button>
          )
        })}
      </div>
      {more && <div style={{ textAlign: 'center' }}><button className="subtle" disabled={busy} onClick={onMore}>{busy ? 'Loading…' : 'Load more'}</button></div>}
    </>
  )
}

/** A picture the server holds. The desktop app shows it through its own copies, as it does in the chat. */
function MediaPicture({ file }: { file: AttachmentDto }) {
  const [gone, setGone] = useState(false)
  const src = isElectron() ? `maplecord-plugin://files/${file.id}/${encodeURIComponent(file.fileName)}?u=${encodeURIComponent(file.url)}` : file.url
  return gone ? <span className="muted">No longer kept</span> : <img src={src} alt={file.fileName} loading="lazy" onError={() => setGone(true)} />
}

/** One message as a line in a list (pins, search results): who, when, and the start of what it says. */
function ListedMessage({ m, name, onJump, action }: { m: MessageDto; name: string; onJump: () => void; action?: React.ReactNode }) {
  return (
    <div className="listedmessage">
      <button className="grow" onClick={onJump} title="Go to this message">
        <div><b>{name}</b> <span className="muted">{when(m.createdAt)}{m.threadId ? ' · in a thread' : ''}</span></div>
        {m.title && <div className="posttitle">{m.title}</div>}
        <div className="said">{firstLine(m.content) || (m.attachments.length > 0 ? (m.attachments.every(isPicture) ? 'A picture' : m.attachments[0]!.fileName) : m.poll ? 'A poll' : '')}</div>
      </button>
      {action}
    </div>
  )
}

/** What is pinned in the channel on screen. */
export function PinsDialog({ load, nameOf, onJump, onUnpin, onClose }: {
  load: () => Promise<MessageDto[]>; nameOf: (m: MessageDto) => string; onJump: (m: MessageDto) => void; onUnpin?: (m: MessageDto) => Promise<void>; onClose: () => void
}) {
  const [pins, setPins] = useState<MessageDto[] | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => { let alive = true; load().then(p => { if (alive) setPins(p) }, e => { if (alive) setNote(e instanceof Error ? e.message : String(e)) }); return () => { alive = false } }, [load])
  return (
    <Dialog title="Pinned messages" onClose={onClose} wide scrolls>
      {note ? <div className="error">{note}</div> : !pins ? <div className="muted">Loading…</div>
        : pins.length === 0 ? <div className="muted">Nothing is pinned here. Right-click a message to pin it.</div>
        : pins.map(m => <ListedMessage key={m.id} m={m} name={nameOf(m)} onJump={() => { onJump(m); onClose() }}
            action={onUnpin && <button className="subtle" title="Unpin" onClick={() => void onUnpin(m).then(() => setPins(all => (all ?? []).filter(x => x.id !== m.id)))}>Unpin</button>} />)}
      <div className="buttons"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}

/** Searching the channel on screen. The server looks back a stretch at a time, so there is a way to go on from where it stopped. */
export function SearchDialog({ where, search, nameOf, onJump, onClose }: {
  where: string; search: (q: string, before: string | null) => Promise<SearchResultDto>; nameOf: (m: MessageDto) => string; onJump: (m: MessageDto) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [found, setFound] = useState<MessageDto[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const run = async (text: string, before: string | null) => {
    setBusy(true); setNote('')
    try {
      const result = await search(text, before)
      setFound(all => (before ? [...all, ...result.messages] : result.messages))
      setNext(result.more ? result.before : null)
      setAsked(text)
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Search ${where}`} onClose={onClose} wide scrolls>
      <form className="row" onSubmit={e => { e.preventDefault(); if (q.trim().length >= 2 && !busy) void run(q.trim(), null) }}>
        <input autoFocus className="grow" placeholder="Words to look for" value={q} onChange={e => setQ(e.target.value)} />
        <button className="accent" type="submit" disabled={q.trim().length < 2 || busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {note && <div className="error">{note}</div>}
      {asked && !busy && found.length === 0 && !note && <div className="muted">Nothing here says “{asked}”{next ? ' in the messages looked at so far' : ''}.</div>}
      {found.map(m => <ListedMessage key={m.id} m={m} name={nameOf(m)} onJump={() => { onJump(m); onClose() }} />)}
      {next && <button className="subtle" disabled={busy} onClick={() => void run(asked, next)}>Look further back (before {when(next)})</button>}
      <div className="buttons"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}

/** A forum's posts: the one last spoken in first. */
export function ForumList({ posts, nameOf, onOpen }: { posts: MessageDto[]; nameOf: (m: MessageDto) => string; onOpen: (m: MessageDto) => void }) {
  const ordered = [...posts].sort((a, b) => Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || (b.threadLastAt ?? b.createdAt).localeCompare(a.threadLastAt ?? a.createdAt))
  if (ordered.length === 0) return <div className="muted emptyposts">Nothing has been posted here yet.</div>
  return (
    <div className="forumlist">
      {ordered.map(m => (
        <button key={m.id} className="forumpost" onClick={() => onOpen(m)}>
          <div className="posttitle">{m.pinnedAt && <span title="Pinned">📌 </span>}{m.title ?? firstLine(m.content, 80)}</div>
          <div className="said muted">{firstLine(m.content) || (m.attachments.length > 0 ? 'Files attached' : m.poll ? 'A poll' : '')}</div>
          <div className="postfoot muted">
            <span>{nameOf(m)}</span>
            <span>💬 {m.threadCount ?? 0}</span>
            {(m.reactions ?? []).slice(0, 4).map(r => <span key={r.emoji}>{r.emoji} {r.count}</span>)}
            <span className="grow" />
            <span>{m.threadLastAt ? `last reply ${when(m.threadLastAt)}` : when(m.createdAt)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

/** A gallery's posts: the pictures themselves, the newest first. */
export function GalleryGrid({ posts, nameOf, onOpen, onLike, cover }: {
  posts: MessageDto[]; nameOf: (m: MessageDto) => string; onOpen: (m: MessageDto) => void; onLike?: (m: MessageDto, on: boolean) => void
  /** Draws a post's picture when it is not one the server holds (a P2P gallery's are fetched from other people's apps). */
  cover?: (m: MessageDto) => React.ReactNode
}) {
  const ordered = [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (ordered.length === 0) return <div className="muted emptyposts">No pictures have been posted here yet.</div>
  return (
    <div className="gallerygrid">
      {ordered.map(m => {
        const pictures = m.attachments.filter(isPicture)
        const many = cover ? (m.p2pFiles ?? []).length : pictures.length
        const liked = (m.reactions ?? []).find(r => r.emoji === '❤️')
        const others = (m.reactions ?? []).filter(r => r.emoji !== '❤️').reduce((sum, r) => sum + r.count, 0)
        return (
          <div key={m.id} className="gallerypost">
            <button className="cover" onClick={() => onOpen(m)} title={`${m.title ?? ''} — by ${nameOf(m)}`}>
              {cover ? cover(m) : pictures[0] ? <img src={pictures[0].url} alt={m.title ?? ''} loading="lazy" /> : <span className="muted">This picture is no longer kept</span>}
              {many > 1 && <span className="more">+{many - 1}</span>}
            </button>
            <div className="posttitle" title={m.title ?? ''}>{m.title}</div>
            <div className="postfoot muted">
              <button className={'reaction' + (liked?.mine ? ' mine' : '')} aria-pressed={!!liked?.mine} title={liked?.mine ? 'Take your like back' : 'Like'} disabled={!onLike} onClick={() => onLike?.(m, !liked?.mine)}>❤️ <span>{liked?.count ?? 0}</span></button>
              {others > 0 && <span title="Other reactions">✨ {others}</span>}
              <button className="reaction" title="Open what is said about it" onClick={() => onOpen(m)}>💬 <span>{m.threadCount ?? 0}</span></button>
              <span className="grow" />
              <span className="by">{nameOf(m)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
