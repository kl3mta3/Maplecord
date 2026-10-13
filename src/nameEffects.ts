// How a name is drawn beyond a plain colour: a glow, an outline, several colours running into each other, and so on.
//
// A person has two name colours (as they always had) and, new, an effect: which way of drawing, an angle for the
// ones that have a direction, and up to three more colours for the ones that use them. The server keeps the effect
// as a short text ("neon", "gradient;135", "prism;90;#22c55e,#3b82f6,#a855f7") and checks it is one of these; the
// drawing is all here and in index.css (.fx-…). An app from before effects shows the two colours as it always did.

export type EffectId = 'solid' | 'gradient' | 'neon' | 'toon' | 'pop' | 'gummy' | 'prism' | 'outline' | 'shadow' | 'glitch' | 'chrome' | 'aurora' | 'shimmer'

export interface EffectKind {
  id: EffectId
  label: string
  /** The colours it is drawn with, in order: what each is for, and what it is until the person picks one. */
  colors: { label: string; usual: string }[]
  /** For the ones with a direction: the angle it has until the person turns it. */
  angle?: number
  /** Ready-made sets of colours for it. */
  presets: string[][]
}

export const NAME_EFFECTS: EffectKind[] = [
  { id: 'solid', label: 'Solid', colors: [{ label: 'Color', usual: '#ffffff' }], presets: [['#ffffff'], ['#f87171'], ['#fbbf24'], ['#34d399'], ['#60a5fa'], ['#c084fc']] },
  { id: 'gradient', label: 'Gradient', colors: [{ label: 'From', usual: '#34d399' }, { label: 'To', usual: '#fcd34d' }], angle: 90,
    presets: [['#34d399', '#fcd34d'], ['#c084fc', '#60a5fa'], ['#f9a8d4', '#fda4af'], ['#f87171', '#a78bfa'], ['#4ade80', '#22d3ee'], ['#fb923c', '#f472b6']] },
  { id: 'neon', label: 'Neon', colors: [{ label: 'Letters', usual: '#ffffff' }, { label: 'Glow', usual: '#a855f7' }],
    presets: [['#ffffff', '#a855f7'], ['#ffffff', '#22d3ee'], ['#fff7ed', '#f97316'], ['#f0fdf4', '#22c55e'], ['#fdf2f8', '#ec4899'], ['#fefce8', '#eab308']] },
  { id: 'toon', label: 'Toon', colors: [{ label: 'Letters', usual: '#ff7ab8' }, { label: 'Outline', usual: '#a3195b' }],
    presets: [['#ff7ab8', '#a3195b'], ['#fde047', '#422006'], ['#7dd3fc', '#0c2a4a'], ['#86efac', '#052e16'], ['#ffffff', '#111111'], ['#fdba74', '#431407']] },
  { id: 'pop', label: 'Pop', colors: [{ label: 'Letters', usual: '#ffffff' }, { label: 'Behind', usual: '#22c55e' }],
    presets: [['#ffffff', '#22c55e'], ['#ffffff', '#ef4444'], ['#fde047', '#7c3aed'], ['#22d3ee', '#be185d'], ['#ffffff', '#3b82f6'], ['#fda4af', '#1e3a8a']] },
  { id: 'gummy', label: 'Gummy', colors: [{ label: 'From', usual: '#ff8fd0' }, { label: 'To', usual: '#8fc5ff' }], angle: 90,
    presets: [['#ff8fd0', '#8fc5ff'], ['#fda4af', '#f0abfc'], ['#fdba74', '#fb7185'], ['#bef264', '#4ade80'], ['#93c5fd', '#5eead4'], ['#d8b4fe', '#f0abfc']] },
  { id: 'prism', label: 'Prism', angle: 90,
    colors: [{ label: 'Color 1', usual: '#f97316' }, { label: 'Color 2', usual: '#22c55e' }, { label: 'Color 3', usual: '#eab308' }, { label: 'Color 4', usual: '#ec4899' }, { label: 'Color 5', usual: '#6366f1' }],
    presets: [['#f97316', '#22c55e', '#eab308', '#ec4899', '#6366f1'], ['#ef4444', '#f97316', '#eab308', '#f97316', '#ef4444'], ['#22d3ee', '#818cf8', '#c084fc', '#f472b6', '#fb7185'],
      ['#4ade80', '#22d3ee', '#3b82f6', '#22d3ee', '#4ade80'], ['#fde68a', '#fca5a5', '#f0abfc', '#a5b4fc', '#99f6e4'], ['#7f1d1d', '#ef4444', '#fbbf24', '#ef4444', '#7f1d1d']] },
  { id: 'outline', label: 'Outline', colors: [{ label: 'Line', usual: '#ffffff' }], presets: [['#ffffff'], ['#22d3ee'], ['#f472b6'], ['#facc15'], ['#4ade80'], ['#c084fc']] },
  { id: 'shadow', label: 'Shadow', colors: [{ label: 'Letters', usual: '#ffffff' }, { label: 'Shadow', usual: '#6366f1' }],
    presets: [['#ffffff', '#6366f1'], ['#ffffff', '#000000'], ['#fde047', '#7c2d12'], ['#a5f3fc', '#164e63'], ['#fbcfe8', '#831843'], ['#bbf7d0', '#14532d'], ['#e9d5ff', '#3b0764']] },
  { id: 'glitch', label: 'Glitch', colors: [{ label: 'Letters', usual: '#ffffff' }, { label: 'Left', usual: '#00e5ff' }, { label: 'Right', usual: '#ff2bd6' }],
    presets: [['#ffffff', '#00e5ff', '#ff2bd6'], ['#ffffff', '#22c55e', '#ef4444'], ['#fef08a', '#3b82f6', '#ef4444'], ['#e0e7ff', '#a855f7', '#22d3ee'], ['#ffffff', '#f97316', '#3b82f6'], ['#d1fae5', '#facc15', '#ec4899']] },
  { id: 'chrome', label: 'Chrome', colors: [{ label: 'Metal', usual: '#b9c4da' }], presets: [['#b9c4da'], ['#d4af37'], ['#b87333'], ['#7dd3fc'], ['#f0abfc'], ['#86efac']] },
  { id: 'aurora', label: 'Aurora', colors: [{ label: 'From', usual: '#34d399' }, { label: 'To', usual: '#60a5fa' }], angle: 90,
    presets: [['#34d399', '#60a5fa'], ['#c084fc', '#f472b6'], ['#fbbf24', '#f87171'], ['#22d3ee', '#a78bfa'], ['#a3e635', '#2dd4bf'], ['#fda4af', '#fdba74']] },
  { id: 'shimmer', label: 'Shimmer', colors: [{ label: 'Letters', usual: '#8b5cf6' }, { label: 'Shine', usual: '#ffffff' }],
    presets: [['#8b5cf6', '#ffffff'], ['#9ca3af', '#ffffff'], ['#b45309', '#fde68a'], ['#7c3aed', '#e9d5ff'], ['#0e7490', '#a5f3fc'], ['#be185d', '#fbcfe8'], ['#15803d', '#bbf7d0']] },
]

const BY_ID = new Map(NAME_EFFECTS.map(e => [e.id as string, e]))
const HEX = /^#[0-9a-f]{6}$/i
const hex = (c: string | null | undefined): string | null => (c && HEX.test(c) ? c.toLowerCase() : null)

/** An effect as the server keeps it, read apart; null if it is not one we know. */
export function parseEffect(spec: string | null | undefined): { id: EffectId; angle: number | null; extra: string[] } | null {
  if (!spec) return null
  const [id, angle = '', colors = '', ...more] = spec.trim().toLowerCase().split(';')
  const kind = BY_ID.get(id ?? '')
  if (!kind || kind.id === 'solid' || more.length > 0) return null
  if (angle && !/^\d{1,3}$/.test(angle)) return null
  const degrees = angle ? Number(angle) : null
  if (degrees !== null && degrees > 359) return null
  const extra = colors ? colors.split(',') : []
  if (extra.length > 3 || extra.some(c => !HEX.test(c))) return null
  return { id: kind.id, angle: degrees, extra }
}

/** An effect as it is sent to the server to be kept. Solid is no effect at all. */
export function effectSpec(id: EffectId, angle: number | null, extra: string[]): string {
  if (id === 'solid') return ''
  const colors = extra.map(hex).filter((c): c is string => !!c).slice(0, 3)
  const turn = angle === null ? '' : String(((Math.round(angle) % 360) + 360) % 360)
  return colors.length > 0 ? `${id};${turn};${colors.join(',')}` : turn ? `${id};${turn}` : id
}

/** What a name is drawn with: which effect, every one of its colours (the person's, or the effect's usual ones), and its angle. */
export interface NameLook { kind: EffectKind; colors: string[]; angle: number | null; /** The person picked no colour at all: a plain name in the app's own text colour. */ plain: boolean }

/** How someone's name is to be drawn, from their two colours and their effect. With no effect: a gradient if they have two colours, else solid. */
export function lookOf(a: { nameColor?: string | null; nameColor2?: string | null; nameEffect?: string | null } | null | undefined): NameLook {
  const first = hex(a?.nameColor), second = hex(a?.nameColor2)
  const parsed = parseEffect(a?.nameEffect)
  const kind = BY_ID.get(parsed?.id ?? (first && second ? 'gradient' : 'solid'))!
  const given = [first, second, ...(parsed?.extra ?? [])]
  return {
    kind,
    colors: kind.colors.map((c, i) => given[i] ?? c.usual),
    angle: kind.angle === undefined ? null : parsed?.angle ?? kind.angle,
    plain: kind.id === 'solid' && !first,
  }
}

/** The class and the values index.css draws a look with. `layered` = it needs the name's own text handed to it (a second copy is drawn behind). */
export function effectCss(look: NameLook): { className: string; vars: Record<string, string>; layered: boolean } {
  if (look.kind.id === 'solid') return { className: '', vars: look.plain ? {} : { color: look.colors[0]! }, layered: false }
  const vars: Record<string, string> = {}
  look.colors.forEach((c, i) => { vars[`--n${i + 1}`] = c })
  if (look.angle !== null) vars['--na'] = `${look.angle}deg`
  vars['--ng'] = look.colors.join(', ')
  return { className: `fx fx-${look.kind.id}`, vars, layered: look.kind.id === 'gummy' || look.kind.id === 'aurora' }
}

/**
 * What to keep when someone picks an effect in the editor: the colours they already have stay where the new effect
 * has a place for them, the rest are the effect's usual ones, and a second colour the effect has no use for is let go.
 */
export function chooseEffect(id: EffectId, now: { nameColor?: string | null; nameColor2?: string | null; nameEffect?: string | null }): { nameColor: string | null; nameColor2: string | null; nameEffect: string | null } {
  const kind = BY_ID.get(id)!
  const first = hex(now.nameColor), second = hex(now.nameColor2)
  if (id === 'solid') return { nameColor: first, nameColor2: null, nameEffect: null }
  const was = parseEffect(now.nameEffect)
  const colors = kind.colors.map((c, i) => (i === 0 ? first : i === 1 ? second : was?.id === id ? was.extra[i - 2] : null) ?? c.usual)
  return { nameColor: colors[0]!, nameColor2: colors[1] ?? null, nameEffect: effectSpec(id, kind.angle === undefined ? null : was?.id === id ? was.angle : null, colors.slice(2)) }
}

/** The same, for changing one colour or the angle of the effect someone has. */
export function withLook(look: NameLook, change: { color?: [number, string]; angle?: number; colors?: string[] }): { nameColor: string | null; nameColor2: string | null; nameEffect: string | null } {
  const colors = change.colors ? look.kind.colors.map((c, i) => hex(change.colors![i]) ?? look.colors[i] ?? c.usual) : [...look.colors]
  if (change.color) colors[change.color[0]] = hex(change.color[1]) ?? colors[change.color[0]]!
  const angle = look.kind.angle === undefined ? null : change.angle ?? look.angle
  // An angle that is the effect's usual one is not kept: there is nothing to say.
  return { nameColor: colors[0]!, nameColor2: colors[1] ?? null, nameEffect: effectSpec(look.kind.id, angle === look.kind.angle ? null : angle, colors.slice(2)) || null }
}
