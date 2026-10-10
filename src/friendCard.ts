import { leafPath, leafQr, qrPath, LEAF_CODE, LEAF_DOT, LEAF_EDGE, LEAF_PAPER, type LeafStyle } from './leafQr'
import { NAME_FONTS, type Appearance } from './profile'
import type { QrDto } from './types'

/**
 * A card to hand out with one's friend link on it: the QR code in whichever look was chosen, with who it belongs to
 * and where it leads. Each card keeps a square place for the code, so every look sits in every card.
 *
 * It is drawn on a canvas, not as an SVG like the bare code: a canvas can use the fonts the app has loaded (a
 * person's own name font among them), and what is on it is the picture that gets saved.
 */

/** How the code itself is drawn: one of the leaf's three ways, or a plain square. */
export type QrLook = LeafStyle | 'square'

/** The cards, as they are offered. The first is no card: the code alone. */
export const CARDS = [
  { key: 'none', name: 'None' },
  { key: 'below', name: 'Name below' },
  { key: 'top', name: 'Maplecord on top' },
  { key: 'wide', name: 'Wide' },
  { key: 'pill', name: 'Pill' },
] as const
export type CardKind = typeof CARDS[number]['key']
export type RealCard = Exclude<CardKind, 'none'>

/** How large each card is, in its own units. It is drawn at twice this, so it stays sharp printed or on a stream. */
const SIZES: Record<RealCard, { w: number; h: number }> = {
  below: { w: 520, h: 690 }, top: { w: 520, h: 700 }, wide: { w: 760, h: 400 }, pill: { w: 520, h: 640 },
}
export const CARD_SCALE = 2
export const cardSize = (kind: RealCard) => SIZES[kind]

/** Who the card is for. */
export interface CardWho {
  /** The name they show. */
  name: string
  username: string
  /** Their name's font and colours, as on their profile. */
  look: Pick<Appearance, 'nameFont' | 'nameColor' | 'nameColor2'>
  /** Where the link leads, as people would say it: "maplecord.app". */
  site: string
}

const BG = '#14141c', TEXT = '#ececf4', MUTED = '#9a9ab0', PANEL = '#1d1d28'
const UI = `'Segoe UI', system-ui, sans-serif`
const WORDMARK = `Pacifico, ${UI}`
const HEX = /^#[0-9a-f]{6}$/i

const nameFont = (who: CardWho) => (who.look.nameFont ? NAME_FONTS.find(f => f.id === who.look.nameFont) : undefined)

/** The fonts a card for this person is written in, said the way `document.fonts.load` wants them, to have them ready before drawing. */
export function cardFonts(who: CardWho): string[] {
  const font = nameFont(who)
  return [`400 32px Pacifico`, ...(font ? [`${font.weight} 32px ${font.family}`] : [])]
}

/** Maplecord's two colours, run from one x to another. */
function brand(ctx: CanvasRenderingContext2D, from: number, to: number): CanvasGradient {
  const g = ctx.createLinearGradient(from, 0, to, 0)
  g.addColorStop(0, '#5a8cff'); g.addColorStop(1, '#b45cff')
  return g
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/**
 * A line of text. `at` is its left edge, or its middle when centred. It is made smaller if it would run past
 * `most`. `fill` is a colour, or given the text's own left and right edges, something to fill it with.
 */
function write(ctx: CanvasRenderingContext2D, text: string, at: number, y: number, weight: number, px: number, family: string, most: number,
  fill: string | ((left: number, right: number) => string | CanvasGradient), centred = true) {
  ctx.font = `${weight} ${px}px ${family}`
  let width = ctx.measureText(text).width
  if (width > most) { px *= most / width; ctx.font = `${weight} ${px}px ${family}`; width = ctx.measureText(text).width }
  const left = centred ? at - width / 2 : at
  ctx.fillStyle = typeof fill === 'string' ? fill : fill(left, left + width)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, left, y)
}

/** Their name as their profile shows it: their font, and their colour or their two. */
function writeName(ctx: CanvasRenderingContext2D, who: CardWho, at: number, y: number, px: number, most: number, centred = true) {
  const font = nameFont(who)
  const first = who.look.nameColor && HEX.test(who.look.nameColor) ? who.look.nameColor : null
  const second = who.look.nameColor2 && HEX.test(who.look.nameColor2) ? who.look.nameColor2 : null
  write(ctx, who.name, at, y, font?.weight ?? 700, px * (font?.scale ?? 1), font ? `${font.family}, ${UI}` : UI, most, (left, right) => {
    if (!first) return TEXT
    if (!second) return first
    const g = ctx.createLinearGradient(left, 0, right, 0)
    g.addColorStop(0, first); g.addColorStop(1, second)
    return g
  }, centred)
}

/**
 * The code, in a square `side` across whose corner is at x, y. Every square of it lands on whole pixels, so there
 * are no hairlines between them: it is drawn a touch smaller than the place it is given, in the middle of it.
 */
function drawCode(ctx: CanvasRenderingContext2D, look: QrLook, qr: QrDto, seed: string, x: number, y: number, side: number, scale: number) {
  const leaf = look === 'square' ? null : leafQr(qr, seed, look)
  const across = leaf ? leaf.size : qr.size + 6
  const each = Math.max(1, Math.floor(side * scale / across))
  const spare = side * scale - each * across
  ctx.save()
  ctx.setTransform(each, 0, 0, each, Math.round(x * scale + spare / 2), Math.round(y * scale + spare / 2))
  if (leaf) {
    const ink = ctx.createLinearGradient(0, 0, across, 0)
    ink.addColorStop(0, '#2f6bff'); ink.addColorStop(1, '#a020f0')
    ctx.fillStyle = '#ffffff'; ctx.fill(new Path2D(leafPath(leaf, LEAF_PAPER + LEAF_DOT + LEAF_CODE + LEAF_EDGE)))
    ctx.fillStyle = ink; ctx.fill(new Path2D(leafPath(leaf, LEAF_DOT + LEAF_EDGE)))
    ctx.fillStyle = look === 'boxed' ? BG : ink; ctx.fill(new Path2D(leafPath(leaf, LEAF_CODE)))
  } else {
    ctx.fillStyle = '#ffffff'; box(ctx, 0, 0, across, across, 1.5); ctx.fill()
    ctx.fillStyle = BG; ctx.fill(new Path2D(qrPath(qr, 3)))
  }
  ctx.restore()
}

/** Draws a card onto a canvas that is `cardSize(kind)` times `scale` in each direction. */
export function drawCard(ctx: CanvasRenderingContext2D, kind: RealCard, look: QrLook, qr: QrDto, seed: string, who: CardWho, scale = CARD_SCALE) {
  const { w, h } = SIZES[kind]
  const mid = w / 2
  const handle = '@' + who.username
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = BG; box(ctx, 0, 0, w, h, 28); ctx.fill()
  const border = () => { ctx.strokeStyle = brand(ctx, 0, w); ctx.lineWidth = 3; box(ctx, 3, 3, w - 6, h - 6, 26); ctx.stroke() }
  const code = (x: number, y: number, side: number) => drawCode(ctx, look, qr, seed, x, y, side, scale)

  if (kind === 'below') {
    border()
    code(70, 40, 380)
    ctx.globalAlpha = 0.35; ctx.fillStyle = MUTED; ctx.fillRect(60, 452, w - 120, 2); ctx.globalAlpha = 1
    writeName(ctx, who, mid, 522, 52, w - 80)
    write(ctx, handle, mid, 558, 400, 20, UI, w - 80, MUTED)
    // "Scan to add me on Maplecord", the last word as the wordmark: the two are measured so the pair sits in the middle.
    const lead = 'Scan to add me on '
    ctx.font = `400 21px ${UI}`; const leadWidth = ctx.measureText(lead).width
    ctx.font = `400 26px ${WORDMARK}`; const markWidth = ctx.measureText('Maplecord').width
    const start = mid - (leadWidth + markWidth) / 2
    write(ctx, lead, start, 636, 400, 21, UI, w, TEXT, false)
    write(ctx, 'Maplecord', start + leadWidth, 636, 400, 26, WORDMARK, w, (l, r) => brand(ctx, l, r), false)
  } else if (kind === 'top') {
    ctx.fillStyle = brand(ctx, 0, w); ctx.beginPath(); ctx.roundRect(0, 0, w, 90, [28, 28, 0, 0]); ctx.fill()
    write(ctx, who.site, mid, 60, 400, 38, WORDMARK, w - 60, '#ffffff')
    ctx.fillStyle = PANEL; box(ctx, 50, 116, w - 100, 420, 22); ctx.fill()
    code(75, 141, 370)
    writeName(ctx, who, mid, 606, 50, w - 80)
    write(ctx, `${handle}  ·  scan to add me`, mid, 644, 400, 20, UI, w - 60, MUTED)
  } else if (kind === 'wide') {
    border()
    code(34, 34, 332)
    write(ctx, who.site, 400, 120, 400, 40, WORDMARK, 330, (l, r) => brand(ctx, l, r), false)
    writeName(ctx, who, 400, 212, 64, 330, false)
    write(ctx, handle, 402, 252, 400, 22, UI, 330, MUTED, false)
    write(ctx, 'Scan to add me as a friend', 402, 330, 400, 21, UI, 330, TEXT, false)
  } else {
    border()
    code(70, 40, 380)
    ctx.fillStyle = PANEL; box(ctx, mid - 160, 462, 320, 56, 28); ctx.fill()
    ctx.strokeStyle = brand(ctx, mid - 160, mid + 160); ctx.lineWidth = 2.5; ctx.stroke()
    write(ctx, handle, mid, 499, 600, 26, UI, 290, TEXT)
    write(ctx, who.site, mid, 584, 400, 32, WORDMARK, w - 80, (l, r) => brand(ctx, l, r))
  }
}
