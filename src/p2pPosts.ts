import type { MessageDto, PollDto, ReactionDto, ReplyToDto } from './types.ts'

/**
 * Posts, threads, replies, reactions, edits, pins and polls in a P2P channel.
 *
 * A P2P message is its text and its files, signed (see p2pText.ts), and that is all the apps pass around and all a
 * bot that keeps a channel's history holds. So what makes a message a post, part of a thread, an answer to another
 * message, a poll, or a note about another message (a reaction, an edit, a pin, a vote, a poll being closed) is
 * written at the start of its text, inside what is signed. Nothing about how messages travel or are kept changes,
 * and whatever hands a channel's history back hands all of this back with it.
 *
 * Nothing is ever taken away or rewritten. An edit is a second message saying what the first now reads; a like that
 * was taken back is a second message saying so. The apps work out what to show from the messages they hold, and the
 * last word counts. Who sent each one is known (every message is signed), so only its author's edit changes a
 * message. There is no referee, though: the time on a message is its sender's own clock.
 */
export interface P2PMeta {
  /** A post's title. */
  t?: string
  /** The post this was said about, or the message whose thread this is in. */
  th?: string
  /** The message this one answers. */
  re?: string
  /** A poll: its choices, whether several may be picked, and for how many hours it is open. The text is the question. */
  pl?: { o: string[]; m: boolean; h: number | null }
  /** A reaction to a message, put there or taken back. */
  rx?: { id: string; e: string; on: boolean }
  /** What a message now reads: the text of this one replaces the text of that one, and its title (if it sends one) a post's title. */
  ed?: string
  /** A message pinned to the channel, or no longer. */
  pin?: { id: string; on: boolean }
  /** Someone's choices in a poll. None is a vote taken back. */
  v?: { id: string; o: number[] }
  /** A poll closed by hand. */
  pc?: string
}

const START = '\u0002'
const END = '\u0003'
/** Room for what is written before the text of anything but a poll; the text itself may be this much shorter than a P2P message may be. */
export const P2P_META_ROOM = 300
/** The most that can be written before any text: a poll's choices are the long case. */
const LONGEST_HEAD = 2200
export const P2P_TITLE = 100
export const P2P_POLL_CHOICES = 10
export const P2P_POLL_CHOICE = 80
export const P2P_POLL_HOURS = 336
/**
 * Polls under a post of a P2P gallery are switched off: a gallery the server keeps has none, and the two should be
 * alike. Everything for them is still here (they are counted like any other poll); with this off the app offers no
 * way to ask one there, and one that arrives anyway shows as an ordinary comment with its question.
 */
export const P2P_GALLERY_POLLS = false
/** How many messages a channel shows as pinned, as on the server. */
export const MOST_P2P_PINS = 50
const LONGEST_ID = 120
/** What p2pText.ts calls a picture. */
const PICTURE = /^image\/(png|jpeg|gif|webp)$/

/** What can be reacted with in a P2P channel: the same choices the server gives for the channels it keeps. */
export const P2P_REACTIONS = [
  '👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '✅', '❌', '💯', '🙏', '👏', '🤔',
  '😀', '😁', '😅', '🤣', '😊', '😍', '😎', '😴', '😭', '😱', '🤯', '🥳', '😇', '🙃', '😬', '🤝',
  '💀', '👻', '🤖', '💩', '🙌', '💪', '🤞', '✌️', '👋', '🫡', '⭐', '✨', '⚡', '💥', '💎', '🏆',
  '🎲', '🎯', '🎮', '🍀', '🍁', '🌙', '☀️', '🌈', '❄️', '🍕', '🍺', '☕', '🎁', '🚀', '💤', '❓',
]
/** How many different reactions one message shows, as on the server. */
export const MOST_P2P_REACTIONS = 20

const idOk = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= LONGEST_ID
/** Without anything that would be written out longer than it is: what goes in front has to fit its room. */
const oneLine = (s: string, most: number) => s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, most)
const choicesOk = (o: unknown, most: number): o is number[] =>
  Array.isArray(o) && o.length <= P2P_POLL_CHOICES && o.every(i => Number.isInteger(i) && i >= 0 && i < most) && new Set(o).size === o.length

/** The text of a P2P message that is more than plain text. */
export function packP2p(meta: P2PMeta, text: string): string {
  const head: P2PMeta = {}
  if (meta.t) head.t = oneLine(meta.t, P2P_TITLE)
  if (meta.th) head.th = meta.th
  if (meta.re) head.re = meta.re
  if (meta.pl) head.pl = { o: meta.pl.o.map(o => oneLine(o, P2P_POLL_CHOICE)), m: meta.pl.m, h: meta.pl.h }
  if (meta.rx) head.rx = { id: meta.rx.id, e: meta.rx.e, on: meta.rx.on }
  if (meta.ed) head.ed = meta.ed
  if (meta.pin) head.pin = { id: meta.pin.id, on: meta.pin.on }
  if (meta.v) head.v = { id: meta.v.id, o: meta.v.o }
  if (meta.pc) head.pc = meta.pc
  return Object.keys(head).length === 0 ? text : START + JSON.stringify(head) + END + text.trim()
}

/**
 * What a P2P message's text says it is, and the text that is left. Anything not understood is plain text. A note
 * about another message (a reaction, an edit, a pin, a vote, a poll being closed) is that one thing and nothing else.
 */
export function unpackP2p(content: string): { meta: P2PMeta; text: string } {
  const plain = { meta: {}, text: content }
  if (!content.startsWith(START)) return plain
  const end = content.indexOf(END)
  if (end < 0 || end > LONGEST_HEAD) return plain
  let read: unknown
  try { read = JSON.parse(content.slice(1, end)) } catch { return plain }
  if (typeof read !== 'object' || read === null || Array.isArray(read)) return plain
  const from = read as Record<string, unknown>
  const text = content.slice(end + 1)
  const part = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined)

  const rx = part(from.rx)
  if (rx && idOk(rx.id) && typeof rx.e === 'string' && P2P_REACTIONS.includes(rx.e) && typeof rx.on === 'boolean') return { meta: { rx: { id: rx.id, e: rx.e, on: rx.on } }, text }
  if (idOk(from.ed)) return { meta: { ed: from.ed, ...(typeof from.t === 'string' && from.t.trim().length > 0 ? { t: from.t.trim().slice(0, P2P_TITLE) } : {}) }, text }
  const pin = part(from.pin)
  if (pin && idOk(pin.id) && typeof pin.on === 'boolean') return { meta: { pin: { id: pin.id, on: pin.on } }, text }
  const v = part(from.v)
  if (v && idOk(v.id) && choicesOk(v.o, P2P_POLL_CHOICES)) return { meta: { v: { id: v.id, o: v.o } }, text }
  if (idOk(from.pc)) return { meta: { pc: from.pc }, text }

  const meta: P2PMeta = {}
  if (typeof from.t === 'string' && from.t.trim().length > 0) meta.t = from.t.trim().slice(0, P2P_TITLE)
  if (idOk(from.th)) meta.th = from.th
  if (idOk(from.re)) meta.re = from.re
  const pl = part(from.pl)
  if (pl && Array.isArray(pl.o) && pl.o.length >= 2 && pl.o.length <= P2P_POLL_CHOICES && pl.o.every(o => typeof o === 'string' && o.trim().length > 0 && o.length <= P2P_POLL_CHOICE)
    && new Set((pl.o as string[]).map(o => o.trim().toLowerCase())).size === pl.o.length
    && (pl.h === null || pl.h === undefined || (Number.isInteger(pl.h) && (pl.h as number) >= 1 && (pl.h as number) <= P2P_POLL_HOURS))) {
    meta.pl = { o: (pl.o as string[]).map(o => o.trim()), m: pl.m === true, h: (pl.h as number | null | undefined) ?? null }
  }
  return { meta, text }
}

/** A note about another message: counted, never shown as a message of its own. */
export const isP2pNote = (m: MessageDto): boolean => !!(m.p2pReaction || m.p2pEdit || m.p2pPin || m.p2pVote || m.p2pPollClose)
/** The same, asked of a message's text as it arrived. */
export const isP2pNoteText = (content: string): boolean => { const { meta } = unpackP2p(content); return !!(meta.rx || meta.ed || meta.pin || meta.v || meta.pc) }

/** What a P2P message's text makes of it, in the shape the chat screen draws every message in. */
export function p2pShape(content: string): Pick<MessageDto, 'content'> & Partial<MessageDto> {
  const { meta, text } = unpackP2p(content)
  return {
    content: text,
    ...(meta.t ? { title: meta.t } : {}), ...(meta.th ? { threadId: meta.th } : {}), ...(meta.re ? { p2pReplyTo: meta.re } : {}), ...(meta.pl ? { p2pPoll: meta.pl } : {}),
    ...(meta.rx ? { p2pReaction: meta.rx } : {}), ...(meta.ed ? { p2pEdit: meta.ed } : {}), ...(meta.pin ? { p2pPin: meta.pin } : {}),
    ...(meta.v ? { p2pVote: meta.v } : {}), ...(meta.pc ? { p2pPollClose: meta.pc } : {}),
  }
}

const later = (a: MessageDto, b: MessageDto) => a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id)

/** A P2P gallery's messages as its posts, what was said about each, and which are pinned. */
export interface P2PFold {
  /** The posts, oldest first, each as it now reads, with its reactions, whether it is pinned, and how much was said about it. */
  posts: MessageDto[]
  /** What was said about a post, by the post's id, oldest first, each as it now reads, with its reactions and its poll. */
  said: Map<string, MessageDto[]>
  /** The pinned posts, the latest pinned first. */
  pins: MessageDto[]
}

/**
 * Works a P2P gallery's messages (as p2pToMessage hands them over) into posts and what is said about them. It is
 * worked out as a text channel is (see foldP2pChat): a post is a message of the channel that has a title and a
 * picture, and what is said about it is its thread. Anything else typed straight into the channel is not shown.
 * Only what this device holds is counted, so a number can grow as more of the channel's history arrives.
 */
export function foldP2p(messages: MessageDto[], me: string | undefined, mayManage: (authorId: string) => boolean = () => false, now: string = new Date().toISOString()): P2PFold {
  const chat = foldP2pChat(messages, me, mayManage, now)
  const byTime = (a: MessageDto, b: MessageDto) => a.createdAt.localeCompare(b.createdAt)
  const isPost = (m: MessageDto) => !m.threadId && !!m.title && (m.p2pFiles ?? []).some(f => PICTURE.test(f.type))
  const said = new Map<string, MessageDto[]>()
  const posts = chat.main.filter(isPost).sort(byTime).map(m => {
    const about = (chat.threads.get(m.id) ?? []).slice().sort(byTime)
    if (about.length > 0) said.set(m.id, about)
    return { ...m, threadCount: about.length, threadLastAt: about.at(-1)?.createdAt ?? null }
  })
  return { posts, said, pins: posts.filter(m => m.pinnedAt).sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!)) }
}

/** The posts of a P2P gallery and what is said about them that say something, newest first. */
export const searchP2pGallery = (fold: P2PFold, q: string): MessageDto[] => matching([...fold.posts, ...[...fold.said.values()].flat()], q)

/** A P2P text channel's messages as the channel itself and the threads off its messages. */
export interface P2PChat {
  /** What shows in the channel, in the order given, each as it now reads, with its reactions, the message it answers, its poll, whether it is pinned, and how much is in its thread. */
  main: MessageDto[]
  /** A thread's messages, by the id of the message it hangs off, in the order given. */
  threads: Map<string, MessageDto[]>
  /** The pinned messages, the latest pinned first. */
  pins: MessageDto[]
}

/**
 * Works a P2P text channel's messages into the channel and its threads. A note about another message is counted and
 * never shown. A message in a thread shows in that thread; if this device does not hold the message the thread
 * hangs off, it shows in the channel instead, so nothing that was said is ever out of sight.
 *
 * `mayManage` says who may pin, and close someone else's poll: the people the server lets manage messages in this
 * channel, as far as the app knows. `now` decides whether a poll's time is up.
 */
export function foldP2pChat(messages: MessageDto[], me: string | undefined, mayManage: (authorId: string) => boolean = () => false, now: string = new Date().toISOString()): P2PChat {
  const reactionsOf = countReactions(messages, me)
  const said = messages.filter(m => !isP2pNote(m))
  const byId = new Map(said.map(m => [m.id, m]))
  // A thread hangs off a message of the channel itself, never off one that is inside a thread.
  const inThread = (m: MessageDto) => { const root = m.threadId ? byId.get(m.threadId) : undefined; return !!root && !root.threadId && root.id !== m.id }

  // What each message now reads: its author's last edit. A poll's question stays as it was asked.
  const edits = new Map<string, MessageDto>()
  for (const e of messages) {
    const to = e.p2pEdit ? byId.get(e.p2pEdit) : undefined
    if (!to || to.authorId !== e.authorId || to.p2pPoll || e.createdAt <= to.createdAt) continue
    if (!e.content.trim() && (to.p2pFiles ?? []).length === 0) continue
    const had = edits.get(to.id)
    if (!had || later(e, had)) edits.set(to.id, e)
  }
  const reads = (m: MessageDto): MessageDto => { const e = edits.get(m.id); return e ? { ...m, content: e.content, editedAt: e.createdAt, ...(m.title && e.title ? { title: e.title } : {}) } : m }

  // What is pinned: the last word of anyone who may pin, about a message of the channel itself.
  const pinNotes = new Map<string, MessageDto>()
  for (const p of messages) {
    const to = p.p2pPin ? byId.get(p.p2pPin.id) : undefined
    if (!to || inThread(to) || !mayManage(p.authorId)) continue
    const had = pinNotes.get(to.id)
    if (!had || later(p, had)) pinNotes.set(to.id, p)
  }
  const pinnedAt = new Map([...pinNotes.entries()].filter(([, p]) => p.p2pPin!.on).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt)).slice(0, MOST_P2P_PINS).map(([id, p]) => [id, p.createdAt]))

  // Polls: when each stopped taking votes, and everyone's last choices from before then.
  const closedBy = new Map<string, string>()
  for (const c of messages) {
    const poll = c.p2pPollClose ? byId.get(c.p2pPollClose) : undefined
    if (!poll?.p2pPoll || c.createdAt <= poll.createdAt || (c.authorId !== poll.authorId && !mayManage(c.authorId))) continue
    const had = closedBy.get(poll.id)
    if (!had || c.createdAt < had) closedBy.set(poll.id, c.createdAt)
  }
  const votes = new Map<string, Map<string, MessageDto>>()
  const closesAt = (poll: MessageDto) => (poll.p2pPoll!.h ? new Date(Date.parse(poll.createdAt) + poll.p2pPoll!.h * 3600000).toISOString() : null)
  for (const v of messages) {
    const poll = v.p2pVote ? byId.get(v.p2pVote.id) : undefined
    if (!poll?.p2pPoll || v.createdAt <= poll.createdAt) continue
    const picks = v.p2pVote!.o
    if (!choicesOk(picks, poll.p2pPoll.o.length) || (!poll.p2pPoll.m && picks.length > 1)) continue
    const [timeUp, closed] = [closesAt(poll), closedBy.get(poll.id)]
    if ((timeUp && v.createdAt > timeUp) || (closed && v.createdAt > closed)) continue
    const of = votes.get(poll.id) ?? new Map<string, MessageDto>()
    votes.set(poll.id, of)
    const had = of.get(v.authorId)
    if (!had || later(v, had)) of.set(v.authorId, v)
  }
  const pollOf = (m: MessageDto): PollDto | null => {
    if (!m.p2pPoll) return null
    const cast = [...(votes.get(m.id)?.values() ?? [])].filter(v => v.p2pVote!.o.length > 0)
    const timeUp = closesAt(m)
    return {
      options: m.p2pPoll.o.map((text, i) => ({ text, votes: cast.filter(v => v.p2pVote!.o.includes(i)).length, mine: cast.some(v => v.authorId === me && v.p2pVote!.o.includes(i)) })),
      multi: m.p2pPoll.m, closesAt: timeUp, voters: cast.length, closed: closedBy.has(m.id) || (!!timeUp && now > timeUp),
    }
  }

  const quote = (m: MessageDto): ReplyToDto | null => {
    if (!m.p2pReplyTo) return null
    const held = byId.get(m.p2pReplyTo)
    if (!held) return { id: m.p2pReplyTo, authorId: '', authorName: '', snippet: '', gone: true }
    const to = reads(held)
    const files = to.p2pFiles ?? []
    const snippet = to.content.replace(/\s+/g, ' ').trim().slice(0, 100) || (files.length > 0 ? (files.every(f => PICTURE.test(f.type)) ? 'A picture' : files[0]!.name) : '')
    return { id: to.id, authorId: to.authorId, authorName: to.authorName, snippet }
  }
  const threads = new Map<string, MessageDto[]>()
  const channel: MessageDto[] = []
  for (const m of said) {
    const shown = { ...reads(m), reactions: reactionsOf(m.id), replyTo: quote(m), poll: pollOf(m), pinnedAt: pinnedAt.get(m.id) ?? null }
    if (!inThread(m)) { channel.push(shown); continue }
    const list = threads.get(m.threadId!) ?? []
    threads.set(m.threadId!, list)
    list.push(shown)
  }
  const main = channel.map(m => { const t = threads.get(m.id); return t ? { ...m, threadCount: t.length, threadLastAt: t.map(x => x.createdAt).sort().at(-1) ?? null } : m })
  return { main, threads, pins: main.filter(m => m.pinnedAt).sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!)) }
}

/** The messages of a P2P text channel that say something, newest first: everything in the channel and its threads, as each now reads. */
export const searchP2pChat = (chat: P2PChat, q: string): MessageDto[] => matching([...chat.main, ...[...chat.threads.values()].flat()], q)

/** The ones whose words, title or poll choices have this in them, newest first. */
function matching(all: MessageDto[], q: string): MessageDto[] {
  const wanted = q.trim().toLowerCase()
  if (!wanted) return []
  return all.filter(m => m.content.toLowerCase().includes(wanted) || (m.title ?? '').toLowerCase().includes(wanted) || (m.p2pPoll?.o ?? []).some(o => o.toLowerCase().includes(wanted)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Who reacted to what, from the reaction messages among these: asked for one message at a time. */
function countReactions(messages: MessageDto[], me: string | undefined): (id: string) => ReactionDto[] | null {
  // The last thing each person said about each reaction on each message.
  const last = new Map<string, MessageDto>()
  for (const m of messages) {
    const rx = m.p2pReaction
    if (!rx) continue
    const key = `${rx.id}\n${m.authorId}\n${rx.e}`
    const had = last.get(key)
    if (!had || had.createdAt < m.createdAt || (had.createdAt === m.createdAt && had.id < m.id)) last.set(key, m)
  }
  const reacted = new Map<string, Map<string, { count: number; mine: boolean; first: string }>>()
  for (const m of last.values()) {
    const rx = m.p2pReaction!
    if (!rx.on) continue
    const on = reacted.get(rx.id) ?? new Map<string, { count: number; mine: boolean; first: string }>()
    reacted.set(rx.id, on)
    const one = on.get(rx.e) ?? { count: 0, mine: false, first: m.createdAt }
    on.set(rx.e, { count: one.count + 1, mine: one.mine || m.authorId === me, first: one.first < m.createdAt ? one.first : m.createdAt })
  }
  return (id: string): ReactionDto[] | null => {
    const on = reacted.get(id)
    if (!on) return null
    return [...on.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first)).slice(0, MOST_P2P_REACTIONS).map(([emoji, r]) => ({ emoji, count: r.count, mine: r.mine }))
  }
}
