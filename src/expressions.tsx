/**
 * Custom emojis, stickers and sounds (see the server's Expressions). A message carries a custom emoji in its text as
 * <:name:id>; here it is drawn as its picture, from the server it came from. Where only words fit (a notification, a
 * reply's preview) it is written :name:. Someone typing :name: gets the emoji of that name they may use there.
 */
import type { ReactNode } from 'react'
import type { ExpressionDto, UsableExpressionsDto } from './types'
import { Twemoji } from './emoji'
import { emojisIn } from './emojiMatch'

/** One custom emoji in a message's text. */
export const EMOJI_TOKEN = /<:([A-Za-z0-9_]{2,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g
const ONE_TOKEN = new RegExp('^' + EMOJI_TOKEN.source + '$')

let base = ''
/** The server the pictures come from: set as the app knows it. */
export function setExpressionServer(serverUrl: string) { base = serverUrl.replace(/\/$/, '') }
export const expressionUrl = (id: string) => `${base}/api/expressions/${id}`

export const tokenOf = (e: Pick<ExpressionDto, 'id' | 'name'>) => `<:${e.name}:${e.id}>`
export function parseToken(text: string): { name: string; id: string } | null {
  const m = ONE_TOKEN.exec(text)
  return m ? { name: m[1], id: m[2] } : null
}

/** A custom emoji, drawn. */
export function CustomEmoji({ name, id, big }: { name: string; id: string; big?: boolean }) {
  return <img className={'cemoji' + (big ? ' big' : '')} src={expressionUrl(id)} alt={`:${name}:`} title={`:${name}:`} draggable={false} loading="lazy" data-emoji={id} data-emoji-name={name} />
}

/** A reaction: an ordinary emoji or a custom one, drawn. */
export function ReactionGlyph({ emoji }: { emoji: string }) {
  const custom = parseToken(emoji)
  return custom ? <CustomEmoji name={custom.name} id={custom.id} /> : <Twemoji emoji={emoji} />
}

/** What a reaction is called, for a label. */
export const reactionLabel = (emoji: string) => { const custom = parseToken(emoji); return custom ? `:${custom.name}:` : emoji }

/** Text with its emojis drawn, custom and ordinary; plain text stays a string. `big`: they are drawn large (the text is nothing else). */
export function withEmojis(text: string, big = false): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  const plain = (to: number) => {
    const from = last
    for (const m of emojisIn(text.slice(from, to))) {
      const at = from + m.index!
      if (at > last) out.push(text.slice(last, at))
      out.push(<Twemoji key={'u' + at} emoji={m[0]} big={big} />)
      last = at + m[0].length
    }
    if (to > last) out.push(text.slice(last, to))
    last = to
  }
  if (text.includes('<:')) for (const m of text.matchAll(EMOJI_TOKEN)) {
    plain(m.index!)
    out.push(<CustomEmoji key={'e' + m.index} name={m[1]} id={m[2]} big={big} />)
    last = m.index! + m[0].length
  }
  plain(text.length)
  return out.length === 1 && typeof out[0] === 'string' ? out[0] : out
}

/** A message that is only emojis (and spaces), and not many of them, is drawn with them large. */
export function onlyEmojis(text: string): boolean {
  let count = 0
  const rest = text.replace(EMOJI_TOKEN, () => { count++; return ' ' })
  let left = '', last = 0
  for (const m of emojisIn(rest)) { count++; left += rest.slice(last, m.index); last = m.index! + m[0].length }
  left += rest.slice(last)
  return count > 0 && count <= 27 && left.trim() === ''
}

/** The text with each custom emoji written :name:, for where pictures cannot go. */
export const plainEmojis = (text: string) => text.replace(EMOJI_TOKEN, (_, name: string) => `:${name}:`)

/**
 * What was typed, with each :name: that names an emoji one may use here made into it: the server's own first, then
 * one's own, then one's other servers'. Emojis already written out, and names nothing goes by, are left as they are.
 */
export function toTokens(text: string, usable: UsableExpressionsDto | null): string {
  if (!usable?.emojis || !text.includes(':')) return text
  const byName = new Map<string, ExpressionDto>()
  const offer = (list: ExpressionDto[]) => { for (const e of list) if (e.kind === 0 && !byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e) }
  offer(usable.here)
  if (usable.outside) { offer(usable.mine); for (const g of usable.others) offer(g.items) }
  if (byName.size === 0) return text
  // Only in the text between emojis already written out (whose own :name: is part of them).
  return text.split(/(<:[A-Za-z0-9_]{2,32}:[0-9a-fA-F-]{36}>)/).map((part, i) =>
    i % 2 === 1 ? part : part.replace(/:([A-Za-z0-9_]{2,32}):/g, (whole, name: string) => { const e = byName.get(name.toLowerCase()); return e ? tokenOf(e) : whole })).join('')
}

/**
 * A sound picked to upload, made into what the server takes: one channel of 16-bit WAV at 24 kHz, its first five
 * seconds. (The server cuts and levels it again whatever it is sent, so this only saves sending more than is kept.)
 */
export async function soundToWav(file: Blob): Promise<Blob> {
  const RATE = 24000, SECONDS = 5
  const decoder = new AudioContext()
  let decoded: AudioBuffer
  try { decoded = await decoder.decodeAudioData(await file.arrayBuffer()) }
  catch { throw new Error('That file is not a sound this device can read. Try an MP3, OGG or WAV.') }
  finally { void decoder.close() }
  const length = Math.max(1, Math.min(Math.ceil(decoded.duration * RATE), RATE * SECONDS))
  const offline = new OfflineAudioContext(1, length, RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const samples = (await offline.startRendering()).getChannelData(0)
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, RATE, true); out.setUint32(28, RATE * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  text(36, 'data'); out.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true))
  return new Blob([out.buffer], { type: 'audio/wav' })
}

/** A name for an upload, from its file's name: letters, digits and underscores, 2 to 32 of them. */
export function nameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  return name.length >= 2 ? name : 'emoji_' + Math.random().toString(36).slice(2, 6)
}

// ---- Sounds played in voice ------------------------------------------------------------------------------------------

const played = new Map<string, HTMLAudioElement>()
/** Plays a sound someone played in voice, from this device's own copy, at this person's soundboard volume. */
export function playSound(url: string, volume: number, sinkId: string | null) {
  let audio = played.get(url)
  if (!audio) { audio = new Audio(url); audio.preload = 'auto'; played.set(url, audio) }
  const a = audio
  a.volume = Math.max(0, Math.min(1, volume))
  const go = () => { a.currentTime = 0; void a.play().catch(() => { /* the browser would not play it now */ }) }
  const withSink = a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }
  if (sinkId && withSink.setSinkId && withSink.sinkId !== sinkId) void withSink.setSinkId(sinkId).catch(() => undefined).then(go)
  else go()
}
