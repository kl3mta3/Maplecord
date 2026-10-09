import { LEAF_GRID, LEAF_ROWS, LEAF_SQUARE } from './leafShape.ts'
import type { QrDto } from './types.ts'

/**
 * A QR code in the shape of the app's maple leaf.
 *
 * The real code is an ordinary square one, set in the widest part of the leaf with an empty margin round it, and is
 * all a phone reads. The rest of the leaf is filled with dots that mean nothing: they are only there so that the
 * whole thing looks like one leaf made of code. The dots are worked out from the link itself, so the same link is
 * always the same leaf.
 */

/** The empty margin kept between the real code and the dots around it, in squares. */
export const LEAF_QUIET = 2

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

export function leafQr(qr: QrDto, seed: string): LeafQr {
  const need = qr.size + LEAF_QUIET * 2
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
      const cx = x - at.x - LEAF_QUIET, cy = y - at.y - LEAF_QUIET
      if (x >= at.x && y >= at.y && x < at.x + need && y < at.y + need) {
        const inCode = cx >= 0 && cy >= 0 && cx < qr.size && cy < qr.size
        cells[i] = inCode && qr.modules[cy * qr.size + cx] === '1' ? LEAF_CODE : LEAF_PAPER
        continue
      }
      // The rim of the leaf is drawn solid, so the shape reads on any background.
      const rim = !isLeaf(x - 1, y) || !isLeaf(x + 1, y) || !isLeaf(x, y - 1) || !isLeaf(x, y + 1)
      // A number is taken for every square, rim or not, so the dots do not shift if the rim rule ever changes.
      const dot = next() < 0.46
      cells[i] = rim ? LEAF_EDGE : dot ? LEAF_DOT : LEAF_PAPER
    }
    return { size: n, cells: cells.join(''), code: { x: at.x + LEAF_QUIET, y: at.y + LEAF_QUIET, size: qr.size } }
  }
  throw new Error('That code is too large to draw as a leaf.')
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
