// How a server tag's symbol is drawn: in its own colours, or in a style the server keeps as text (its GuildTags.LookFor,
// which checks it the same way):
//   one:#rrggbb                      its shape in one colour
//   two:#rrggbb:#rrggbb:v|h|d        in two, blended top to bottom, left to right or corner to corner
//   edge:#rrggbb:#rrggbb:0.5|1|1.5|2 filled with the first and edged with the second, that many pixels thick at a tag's size
import { contrast } from './theme'

export type TagLook =
  | { kind: 'one'; color: string }
  | { kind: 'two'; a: string; b: string; dir: 'v' | 'h' | 'd' }
  | { kind: 'edge'; fill: string; edge: string; thick: number }

export const THICKNESSES = [0.5, 1, 1.5, 2]
/** What a tag sits on (the app's raised background); a style's colour must stand out from it at least LOOK_FLOOR to be seen. */
const UNDER = '#262634'
export const LOOK_FLOOR = 2

const COLOUR = /^#[0-9a-f]{6}$/

export function readLook(look?: string | null): TagLook | null {
  const p = (look ?? '').toLowerCase().split(':')
  if (p[0] === 'one' && p.length === 2 && COLOUR.test(p[1]!)) return { kind: 'one', color: p[1]! }
  if (p[0] === 'two' && p.length === 4 && COLOUR.test(p[1]!) && COLOUR.test(p[2]!) && (p[3] === 'v' || p[3] === 'h' || p[3] === 'd')) return { kind: 'two', a: p[1]!, b: p[2]!, dir: p[3] }
  if (p[0] === 'edge' && p.length === 4 && COLOUR.test(p[1]!) && COLOUR.test(p[2]!) && THICKNESSES.includes(Number(p[3]))) return { kind: 'edge', fill: p[1]!, edge: p[2]!, thick: Number(p[3]) }
  return null
}

export function writeLook(look: TagLook | null): string | null {
  if (!look) return null
  if (look.kind === 'one') return `one:${look.color}`
  if (look.kind === 'two') return `two:${look.a}:${look.b}:${look.dir}`
  return `edge:${look.fill}:${look.edge}:${look.thick}`
}

/** Why a style would be refused for being too dark to see, in words, or null. */
export function tooDark(look: TagLook | null): string | null {
  const seen = (c: string) => contrast(c, UNDER) >= LOOK_FLOOR
  if (!look) return null
  if (look.kind === 'one') return seen(look.color) ? null : 'That colour is too dark to see on a tag. Choose a lighter one.'
  if (look.kind === 'two') return seen(look.a) || seen(look.b) ? null : 'Both colours are too dark to see on a tag. Make at least one of them lighter.'
  return seen(look.edge) ? null : 'The border is too dark to see on a tag. Choose a lighter border.'
}
