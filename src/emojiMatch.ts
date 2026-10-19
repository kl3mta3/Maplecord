// Emojis without React: which text is one, where its picture is, the pickers' list, and what is kept on this device
// (the most used, the skin tone). Apart from emoji.tsx (which draws them) so that the P2P rules and their tests can use it.

/** The file of an emoji's Twemoji picture: its code points, without the presentation selector unless the emoji is joined (ZWJ). */
export function emojiFile(emoji: string): string {
  const cps = [...emoji].map(c => c.codePointAt(0)!.toString(16))
  return (emoji.includes('\u200d') ? cps : cps.filter(c => c !== 'fe0f')).join('-')
}

export const emojiUrl = (emoji: string) => `${import.meta.env.BASE_URL}emoji/${emojiFile(emoji)}.svg`

// Where the browser knows Unicode's list of emojis (Chromium, Safari 17 on, Node 20 on), that is what is used;
// elsewhere, anything shaped like one that shows as a picture.
const ROUGH = String.raw`(?:\p{RI}\p{RI}|[#*0-9]\uFE0F\u20E3|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)\p{EMod}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{EMod}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)`
function pattern(flags: string): RegExp {
  try { return new RegExp(String.raw`\p{RGI_Emoji}`, flags + 'v') } catch { return new RegExp(ROUGH, flags + 'u') }
}
const ONE = (() => { const p = pattern(''); return new RegExp('^(?:' + p.source + ')$', p.flags) })()
const IN_TEXT = pattern('g')

/** Whether this is one emoji, and nothing else. */
export const isEmoji = (s: string) => s.length > 0 && s.length <= 32 && ONE.test(s)
/** The emojis in a text, where each is. */
export const emojisIn = (text: string) => text.matchAll(new RegExp(IN_TEXT.source, IN_TEXT.flags))

// ---- The pickers' list, fetched when one first opens -------------------------------------------------------------

type Data = typeof import('./emojiData')
let data: Promise<Data> | null = null
export const loadEmojis = () => (data ??= import('./emojiData').catch(e => { data = null; throw e }))

// ---- Kept on this device: what is used most, and the skin tone ------------------------------------------------------

const USE_KEY = 'maplecord.emojiUse'
const TONE_KEY = 'maplecord.skinTone'
/** Shown as the most used until enough has been. */
const STARTERS = ['👍', '❤️', '😂', '🎉', '👀', '🔥', '😭', '🙏', '💯', '😮', '😢', '✅']
const MOST_KEPT = 60

function readUse(): Record<string, [number, number]> {
  try { return JSON.parse(localStorage.getItem(USE_KEY) ?? '{}') as Record<string, [number, number]> } catch { return {} }
}
/** An emoji (or a custom one, as its <:name:id>) was picked: counted, with when. */
export function noteEmojiUse(emoji: string) {
  const use = readUse()
  const [n] = use[emoji] ?? [0, 0]
  use[emoji] = [n + 1, Date.now()]
  // The least used and longest ago are forgotten past a point.
  const kept = Object.entries(use).sort((a, b) => score(b[1]) - score(a[1])).slice(0, MOST_KEPT)
  try { localStorage.setItem(USE_KEY, JSON.stringify(Object.fromEntries(kept))) } catch { /* not kept here */ }
}
/** Counts fade over a few weeks, so that what is used now comes before what was used a lot long ago. */
const score = ([n, at]: [number, number]) => n * Math.pow(0.5, (Date.now() - at) / (21 * 24 * 3600 * 1000))
/** The most used, most first, filled up with the usual ones. */
export function frequentEmojis(count: number): string[] {
  const used = Object.entries(readUse()).sort((a, b) => score(b[1]) - score(a[1])).map(([e]) => e)
  return [...new Set([...used, ...STARTERS])].slice(0, count)
}

/** 0: none (the yellow), 1–5: light to dark. */
export function skinTone(): number {
  try { const n = Number(localStorage.getItem(TONE_KEY)); return n >= 0 && n <= 5 ? n : 0 } catch { return 0 }
}
export function setSkinTone(tone: number) { try { localStorage.setItem(TONE_KEY, String(tone)) } catch { /* not kept here */ } }
