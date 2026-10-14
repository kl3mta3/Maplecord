/** The app's colours. A theme replaces some of the variables in index.css; anything it leaves out keeps the default. */
export interface ThemeChoice {
  preset: string
  accent: string | null
  /** The colours of the person's own theme (preset 'custom'), every one of EDITABLE. Kept when they pick another theme, so it is there to go back to. */
  custom?: Record<string, string> | null
}

export const THEMES: Record<string, { name: string; vars: Record<string, string> }> = {
  maple: { name: 'Maple night', vars: {} },
  midnight: { name: 'Midnight', vars: { '--bg0': '#070a12', '--bg1': '#0d1220', '--bg2': '#141b2e', '--bg3': '#1d2640', '--border': '#28334f', '--accent': '#3d7bff', '--accent2': '#5ad1ff' } },
  forest: { name: 'Forest', vars: { '--bg0': '#08100b', '--bg1': '#0f1a13', '--bg2': '#16251b', '--bg3': '#1f3326', '--border': '#2a4332', '--accent': '#1faa59', '--accent2': '#9be15d' } },
  sakura: { name: 'Sakura', vars: { '--bg0': '#120a10', '--bg1': '#1c111a', '--bg2': '#281826', '--bg3': '#372235', '--border': '#472c44', '--accent': '#e0409a', '--accent2': '#ffb3d9' } },
  ember: { name: 'Ember', vars: { '--bg0': '#110a07', '--bg1': '#1b110c', '--bg2': '#271912', '--bg3': '#35231a', '--border': '#473024', '--accent': '#e8590c', '--accent2': '#ffc078' } },
  slate: { name: 'Slate', vars: { '--bg0': '#0c0d0f', '--bg1': '#141619', '--bg2': '#1c1f23', '--bg3': '#272b31', '--border': '#343941', '--accent': '#5865a8', '--accent2': '#8fa3c7' } },
}

/** The colours a person's own theme is made of, what each is called in the editor, and Maple night's value of each (as in index.css). */
export const EDITABLE: { name: string; label: string; usual: string }[] = [
  { name: '--bg0', label: 'Window', usual: '#0b0b10' },
  { name: '--bg1', label: 'Panels', usual: '#14141c' },
  { name: '--bg2', label: 'Boxes', usual: '#1c1c27' },
  { name: '--bg3', label: 'Raised', usual: '#262634' },
  { name: '--border', label: 'Borders', usual: '#2e2e3e' },
  { name: '--text', label: 'Text', usual: '#e8e8f0' },
  { name: '--muted', label: 'Quiet text', usual: '#9a9ab0' },
  { name: '--accent', label: 'Accent', usual: '#9000ff' },
  { name: '--accent2', label: 'Second accent', usual: '#00ddff' },
]

export const DEFAULT_THEME: ThemeChoice = { preset: 'maple', accent: null }

const HEX = /^#[0-9a-f]{6}$/i
const ALL_VARS = [...new Set([...Object.values(THEMES).flatMap(t => Object.keys(t.vars)), ...EDITABLE.map(e => e.name)])]

/** Every colour of a theme, the ones it leaves to the default included: where a person's own theme starts from. */
export function colorsOf(preset: string): Record<string, string> {
  const vars = THEMES[preset]?.vars ?? {}
  return Object.fromEntries(EDITABLE.map(e => [e.name, vars[e.name] ?? e.usual]))
}

/** A person's own theme as kept: only real colours, and each one there is (a missing one is taken from Maple night). */
export function ownColors(custom: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(EDITABLE.map(e => [e.name, custom?.[e.name] && HEX.test(custom[e.name]!) ? custom[e.name]!.toLowerCase() : e.usual]))
}

/** How much two colours differ in lightness (WCAG contrast ratio, 1 to 21). Text wants at least 4.5 against what is behind it. */
export function contrast(a: string, b: string): number {
  const light = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [light(a), light(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// ---- A theme as a code, to copy to another device or give to a friend -----------------------------------------------
// The nine colours, in the order of EDITABLE, three bytes each, after a mark saying which kind of code this is and
// followed by a check over all of it, written out in letters and digits (base64). A code that was cut short, mistyped
// or is not one of these is refused rather than read as some other colours. Nothing in it can be anything but colours.

const CODE_MARK = 0x4d

/** The theme code for these colours. */
export function themeCode(colors: Record<string, string>): string {
  const own = ownColors(colors)
  const bytes = [CODE_MARK, ...EDITABLE.flatMap(e => [1, 3, 5].map(i => parseInt(own[e.name]!.slice(i, i + 2), 16)))]
  bytes.push(bytes.reduce((sum, b, i) => (sum + b * (i + 1)) % 251, 0))
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '')
}

/** The colours in a theme code, or null if it is not one. Spaces and line breaks in what was pasted are ignored. */
export function fromThemeCode(code: string): Record<string, string> | null {
  const text = code.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]{30,60}$/.test(text)) return null
  let raw: string
  try { raw = atob(text + '='.repeat((4 - (text.length % 4)) % 4)) } catch { return null }
  const bytes = [...raw].map(c => c.charCodeAt(0))
  if (bytes.length !== 2 + EDITABLE.length * 3 || bytes[0] !== CODE_MARK) return null
  const check = bytes.pop()!
  if (bytes.reduce((sum, b, i) => (sum + b * (i + 1)) % 251, 0) !== check) return null
  const hex = (b: number) => b.toString(16).padStart(2, '0')
  return Object.fromEntries(EDITABLE.map((e, i) => [e.name, '#' + hex(bytes[1 + i * 3]!) + hex(bytes[2 + i * 3]!) + hex(bytes[3 + i * 3]!)]))
}

/** How many themes can be saved on one device, and how long a saved one's name can be. */
export const MOST_SAVED_THEMES = 30, SAVED_THEME_NAME = 40

/**
 * The saved themes with one saved: under a name of its own (tidied), replacing one of the same name, newest first.
 * Null when there is no name, or the list is full and this would be a new one.
 */
export function withSaved(saved: { name: string; code: string }[] | undefined, name: string, code: string): { name: string; code: string }[] | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, SAVED_THEME_NAME)
  if (!clean || !fromThemeCode(code)) return null
  const others = (saved ?? []).filter(t => t.name.toLowerCase() !== clean.toLowerCase())
  if (others.length >= MOST_SAVED_THEMES) return null
  return [{ name: clean, code }, ...others]
}

export function applyTheme(choice: ThemeChoice | undefined) {
  const root = document.documentElement.style
  for (const name of ALL_VARS) root.removeProperty(name)
  const vars = choice?.preset === 'custom' ? ownColors(choice.custom) : (THEMES[choice?.preset ?? 'maple'] ?? THEMES.maple).vars
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value)
  if (choice?.accent && HEX.test(choice.accent)) root.setProperty('--accent', choice.accent)
}
