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

export function applyTheme(choice: ThemeChoice | undefined) {
  const root = document.documentElement.style
  for (const name of ALL_VARS) root.removeProperty(name)
  const vars = choice?.preset === 'custom' ? ownColors(choice.custom) : (THEMES[choice?.preset ?? 'maple'] ?? THEMES.maple).vars
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value)
  if (choice?.accent && HEX.test(choice.accent)) root.setProperty('--accent', choice.accent)
}
