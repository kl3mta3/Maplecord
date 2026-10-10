// Run with: node src/leafQr.test.ts
import { leafPath, leafQr, LEAF_BLEND_ROOM, LEAF_CODE, LEAF_DOT, LEAF_EDGE, LEAF_OUT, LEAF_PAPER, LEAF_QUIET } from './leafQr.ts'
import { LEAF_GRID, LEAF_ROWS, LEAF_SQUARE } from './leafShape.ts'
import type { QrDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

/** A made-up code of a given size: its squares need not mean anything for what is checked here. */
function code(size: number, salt = 1): QrDto {
  let modules = ''
  for (let i = 0; i < size * size; i++) modules += ((i * 7919 + salt * 104729 + (i >> 3)) % 5 < 2) ? '1' : '0'
  return { size, modules }
}

check(LEAF_ROWS.length === LEAF_GRID && LEAF_ROWS.every(r => r.length === LEAF_GRID && /^[01]+$/.test(r)), 'the leaf outline is a square grid of leaf and not-leaf')
let whole = true
for (let y = 0; y < LEAF_SQUARE.side; y++) for (let x = 0; x < LEAF_SQUARE.side; x++) if (LEAF_ROWS[LEAF_SQUARE.y + y]![LEAF_SQUARE.x + x] !== '1') whole = false
check(whole && LEAF_SQUARE.side >= 30, 'the square it says is inside the leaf is all leaf')

const qr = code(29)
const leaf = leafQr(qr, 'K7MQ2XW9AB')
const at = (x: number, y: number) => leaf.cells[y * leaf.size + x]!
check(leaf.cells.length === leaf.size * leaf.size && /^[0-4]+$/.test(leaf.cells) && leaf.code.size === 29, 'a leaf is a square grid of the five kinds of square')
let same = true
for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if ((at(leaf.code.x + x, leaf.code.y + y) === LEAF_CODE) !== (qr.modules[y * qr.size + x] === '1')) same = false
check(same, 'the real code sits in it square for square, unchanged')
let clear = true
for (let y = -LEAF_QUIET; y < qr.size + LEAF_QUIET; y++) for (let x = -LEAF_QUIET; x < qr.size + LEAF_QUIET; x++) {
  const inside = x >= 0 && y >= 0 && x < qr.size && y < qr.size
  const cell = at(leaf.code.x + x, leaf.code.y + y)
  if (!inside && cell !== LEAF_PAPER) clear = false
  if (inside && cell !== LEAF_CODE && cell !== LEAF_PAPER) clear = false
}
check(clear, 'with an empty margin all round it, and no dots or rim inside it')
check(Math.abs(leaf.code.x + qr.size / 2 - leaf.size / 2) <= 1, 'in the middle of the leaf, side to side')

let shaped = true, rimOnEdge = true, dots = 0, paper = 0
const leafAt = (x: number, y: number) => x >= 0 && y >= 0 && x < leaf.size && y < leaf.size && LEAF_ROWS[Math.floor((y + 0.5) * LEAF_GRID / leaf.size)]![Math.floor((x + 0.5) * LEAF_GRID / leaf.size)] === '1'
for (let y = 0; y < leaf.size; y++) for (let x = 0; x < leaf.size; x++) {
  const cell = at(x, y)
  if ((cell === LEAF_OUT) === leafAt(x, y)) shaped = false
  const onEdge = leafAt(x, y) && (!leafAt(x - 1, y) || !leafAt(x + 1, y) || !leafAt(x, y - 1) || !leafAt(x, y + 1))
  // The code and its margin are left alone even where they come right up to the rim.
  const inBlock = x >= leaf.code.x - LEAF_QUIET && y >= leaf.code.y - LEAF_QUIET && x < leaf.code.x + qr.size + LEAF_QUIET && y < leaf.code.y + qr.size + LEAF_QUIET
  if (!inBlock && (cell === LEAF_EDGE) !== onEdge) rimOnEdge = false
  if (inBlock && cell === LEAF_EDGE) rimOnEdge = false
  if (cell === LEAF_DOT) dots++
  if (cell === LEAF_PAPER) paper++
}
check(shaped, 'everything outside the leaf is left empty, and everything inside it is drawn')
check(rimOnEdge, 'the rim of the leaf, and only the rim, is solid')
check(dots > 300 && dots > paper * 0.25 && dots < paper * 1.5, `the rest of the leaf is dotted about half and half (${dots} dots)`)

check(leafQr(qr, 'K7MQ2XW9AB').cells === leaf.cells, 'the same link is always the same leaf')
check(leafQr(qr, 'K7MQ2XW9AC').cells !== leaf.cells && leafQr(qr, 'K7MQ2XW9AC').size === leaf.size, 'a different link has different dots in the same leaf')
check([21, 25, 29, 33, 37, 41, 45].every(size => { const l = leafQr(code(size), 'x'); return l.code.size === size && l.size >= size + LEAF_QUIET * 2 }), 'codes from the smallest to a long link all fit, in a finer grid when larger')

const drawn = leafPath(leaf, LEAF_CODE)
check(drawn.startsWith('M') && (drawn.match(/M/g) ?? []).length <= [...qr.modules].filter(m => m === '1').length && leafPath(leaf, '9') === '', 'squares are drawn as bars along each row, and a kind that is not there draws nothing')
let barred = 0
for (const bar of leafPath(leaf, LEAF_CODE + LEAF_DOT + LEAF_EDGE + LEAF_PAPER).matchAll(/h(\d+)v1/g)) barred += Number(bar[1])
check(barred === [...leaf.cells].filter(c => c !== LEAF_OUT).length, 'every square of the leaf is covered once when all kinds are drawn')

if (failures > 0) throw new Error(`${failures} failed`)
// ---- Blended: no margin, the dots come right up to the code ----
const blend = leafQr(qr, 'K7MQ2XW9AB', 'blended')
const bat = (x: number, y: number) => blend.cells[(blend.code.y + y) * blend.size + blend.code.x + x]!
let sameBlended = true
for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if ((bat(x, y) === LEAF_CODE) !== (qr.modules[y * qr.size + x] === '1') || (bat(x, y) !== LEAF_CODE && bat(x, y) !== LEAF_PAPER)) sameBlended = false
check(sameBlended && blend.code.size === 29, 'blended: the real code still sits in it square for square, unchanged')
check(blend.size < leaf.size && LEAF_BLEND_ROOM < LEAF_QUIET, `blended: with no margin the leaf takes fewer squares (${blend.size} against ${leaf.size})`)
// The ring of squares just outside the code: empty beside the three corner squares, dotted elsewhere.
let cornersClear = true, ringDots = 0
for (let v = -1; v <= qr.size; v++) for (const [x, y] of [[v, -1], [v, qr.size], [-1, v], [qr.size, v]] as const) {
  const beside = (x <= 7 && y <= 7) || (x >= qr.size - 8 && y <= 7) || (x <= 7 && y >= qr.size - 8)
  if (beside && bat(x, y) !== LEAF_PAPER) cornersClear = false
  if (!beside && (bat(x, y) === LEAF_DOT || bat(x, y) === LEAF_EDGE)) ringDots++
}
check(cornersClear, 'blended: the squares beside the three corner squares are left empty')
check(ringDots > 8, `blended: everywhere else the dots come right up to the code (${ringDots} of them touch it)`)
check(leafQr(qr, 'K7MQ2XW9AB', 'blended').cells === blend.cells && leafQr(qr, 'K7MQ2XW9AB').cells === leaf.cells, 'blended: the same link is always the same leaf, and the leaf with a margin is as it was')
check([21, 25, 29, 33, 37, 41, 45].every(size => leafQr(code(size), 'x', 'blended').code.size === size), 'blended: codes from the smallest to a long link all fit')

// ---- Thin: one empty square all round the code ----
const thin = leafQr(qr, 'K7MQ2XW9AB', 'thin')
const tat = (x: number, y: number) => thin.cells[(thin.code.y + y) * thin.size + thin.code.x + x]!
let thinRight = thin.code.size === 29
for (let y = -1; y <= qr.size; y++) for (let x = -1; x <= qr.size; x++) {
  const inside = x >= 0 && y >= 0 && x < qr.size && y < qr.size
  if (inside ? (tat(x, y) === LEAF_CODE) !== (qr.modules[y * qr.size + x] === '1') || (tat(x, y) !== LEAF_CODE && tat(x, y) !== LEAF_PAPER) : tat(x, y) !== LEAF_PAPER) thinRight = false
}
check(thinRight, 'thin: the real code sits in it unchanged, with one empty square all round it')
check(thin.size === blend.size && thin.size < leaf.size && thin.cells !== blend.cells, `thin: the leaf takes as few squares as with no margin (${thin.size})`)
check([21, 25, 29, 33, 37, 41, 45].every(size => leafQr(code(size), 'x', 'thin').code.size === size), 'thin: codes from the smallest to a long link all fit')

console.log('leafQr: all passed')
