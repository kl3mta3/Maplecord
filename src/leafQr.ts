import { LEAF_GRID, LEAF_ROWS, LEAF_SQUARE } from './leafShape.ts'
import type { QrDto } from './types.ts'

/**
 * A QR code in the shape of the app's maple leaf.
 *
 * The real code is an ordinary square one, set in the widest part of the leaf with an empty margin round it, and is
 * all a phone reads. The rest of the leaf is filled with dots that mean nothing: they are only there so that the
 * whole thing looks like one leaf made of code. The dots are worked out from the link itself, so the same link is
 * always the same leaf.
 *
 * That is "boxed". Two other ways draw the code in the leaf's own colours, so that it reads as one leaf:
 * - "thin": one empty square all round the code instead of two.
 * - "blended": no margin, the dots come right up to the code. Only the squares beside the code's three corner squares
 *   are left empty, because those corners are what a phone finds the code by.
 */
export type LeafStyle = 'boxed' | 'thin' | 'blended'

/** The empty margin kept between the real code and the dots around it, in squares. */
export const LEAF_QUIET = 2
/** Thin or blended, how far the code is kept from the leaf's edge instead, in squares: the thin margin, or room for the empty squares beside its corners. */
export const LEAF_BLEND_ROOM = 1
/** How far along each side a corner square of a QR code reaches: seven squares of it, and one of the empty line round it. */
const CORNER_REACH = 7

/** What each square of the leaf's grid is. */
export const LEAF_OUT = '0', LEAF_PAPER = '1', LEAF_DOT = '2', LEAF_CODE = '3', LEAF_EDGE = '4'

export interface LeafQr {
  /** Squares across (and down). */
  size: number
  /** `size` rows of `size` squares, each one of the five kinds above. */
  cells: string
  /** Where the real code sits: its corner and its size, in squares. */
  code: { x: number; y: number; size: number }
}

/** A small repeatable source of numbers from a piece of text: the same text always gives the same run. */
function numbersFrom(text: string): () => number {
  let a = 2166136261
  for (let i = 0; i < text.length; i++) { a ^= text.charCodeAt(i); a = Math.imul(a, 16777619) }
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function leafQr(qr: QrDto, seed: string, style: LeafStyle = 'boxed'): LeafQr {
  const blended = style === 'blended'
  const room = style === 'boxed' ? LEAF_QUIET : LEAF_BLEND_ROOM
  const need = qr.size + room * 2
  // Whether a square just outside the code runs beside one of its three corner squares (it has none bottom right).
  const near = (v: number) => v <= CORNER_REACH, far = (v: number) => v >= qr.size - CORNER_REACH - 1
  const besideCorner = (cx: number, cy: number) => (near(cx) && near(cy)) || (far(cx) && near(cy)) || (near(cx) && far(cy))
  // The grid is made just fine enough for the code and its margin to fit in the leaf's widest square, and one finer
  // at a time until they do (rounding can leave the first try a square short).
  for (let n = Math.ceil(need * LEAF_GRID / LEAF_SQUARE.side); n <= LEAF_GRID * 4; n++) {
    const leaf = new Uint8Array(n * n)
    for (let y = 0; y < n; y++) {
      const row = LEAF_ROWS[Math.floor((y + 0.5) * LEAF_GRID / n)]!
      for (let x = 0; x < n; x++) leaf[y * n + x] = row[Math.floor((x + 0.5) * LEAF_GRID / n)] === '1' ? 1 : 0
    }
    // How much leaf lies above and to the left of each square, to ask "is this whole block leaf?" at a glance.
    const sums = new Int32Array((n + 1) * (n + 1))
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sums[(y + 1) * (n + 1) + x + 1] = leaf[y * n + x]! + sums[y * (n + 1) + x + 1]! + sums[(y + 1) * (n + 1) + x]! - sums[y * (n + 1) + x]!
    const allLeaf = (x: number, y: number) => sums[(y + need) * (n + 1) + x + need]! - sums[y * (n + 1) + x + need]! - sums[(y + need) * (n + 1) + x]! + sums[y * (n + 1) + x]! === need * need
    // Of the places it fits, the one nearest the middle of the leaf, side to side first.
    let at: { x: number; y: number } | null = null
    let nearest = Infinity
    for (let y = 0; y + need <= n; y++) for (let x = 0; x + need <= n; x++) {
      if (!allLeaf(x, y)) continue
      const off = Math.abs(x + need / 2 - n / 2) * 4 + Math.abs(y + need / 2 - n / 2)
      if (off < nearest) { nearest = off; at = { x, y } }
    }
    if (!at) continue

    const next = numbersFrom(seed)
    const isLeaf = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && leaf[y * n + x] === 1
    const cells = new Array<string>(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x
      if (!leaf[i]) { cells[i] = LEAF_OUT; continue }
      const cx = x - at.x - room, cy = y - at.y - room
      if (x >= at.x && y >= at.y && x < at.x + need && y < at.y + need) {
        const inCode = cx >= 0 && cy >= 0 && cx < qr.size && cy < qr.size
        // Blended, the squares round the code are dotted like the rest of the leaf, except beside its corners.
        if (inCode || !blended || besideCorner(cx, cy)) {
          cells[i] = inCode && qr.modules[cy * qr.size + cx] === '1' ? LEAF_CODE : LEAF_PAPER
          continue
        }
      }
      // The rim of the leaf is drawn solid, so the shape reads on any background.
      const rim = !isLeaf(x - 1, y) || !isLeaf(x + 1, y) || !isLeaf(x, y - 1) || !isLeaf(x, y + 1)
      // A number is taken for every square, rim or not, so the dots do not shift if the rim rule ever changes.
      const dot = next() < 0.46
      cells[i] = rim ? LEAF_EDGE : dot ? LEAF_DOT : LEAF_PAPER
    }
    return { size: n, cells: cells.join(''), code: { x: at.x + room, y: at.y + room, size: qr.size } }
  }
  throw new Error('That code is too large to draw as a leaf.')
}

/** One path that draws every dark square of a plain QR code, each one unit across, starting `at` units in from the corner. */
export function qrPath(qr: QrDto, at = 0): string {
  let d = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x] !== '1') continue
      // Runs of dark squares in a row are drawn as one bar.
      let run = 1
      while (x + run < qr.size && qr.modules[y * qr.size + x + run] === '1') run++
      d += `M${x + at} ${y + at}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return d
}

/** One path that draws every square of the given kinds, each one unit across. Runs along a row are one bar. */
export function leafPath(leaf: LeafQr, kinds: string): string {
  let d = ''
  for (let y = 0; y < leaf.size; y++) {
    for (let x = 0; x < leaf.size; x++) {
      if (!kinds.includes(leaf.cells[y * leaf.size + x]!)) continue
      let run = 1
      while (x + run < leaf.size && kinds.includes(leaf.cells[y * leaf.size + x + run]!)) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return d
}
