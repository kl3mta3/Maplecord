/** The app's colours. A theme replaces some of the variables in index.css; anything it leaves out keeps the default. */
export interface ThemeChoice { preset: string; accent: string | null }

export const THEMES: Record<string, { name: string; vars: Record<string, string> }> = {
  maple: { name: 'Maple night', vars: {} },
  midnight: { name: 'Midnight', vars: { '--bg0': '#070a12', '--bg1': '#0d1220', '--bg2': '#141b2e', '--bg3': '#1d2640', '--border': '#28334f', '--accent': '#3d7bff', '--accent2': '#5ad1ff' } },
  forest: { name: 'Forest', vars: { '--bg0': '#08100b', '--bg1': '#0f1a13', '--bg2': '#16251b', '--bg3': '#1f3326', '--border': '#2a4332', '--accent': '#1faa59', '--accent2': '#9be15d' } },
  sakura: { name: 'Sakura', vars: { '--bg0': '#120a10', '--bg1': '#1c111a', '--bg2': '#281826', '--bg3': '#372235', '--border': '#472c44', '--accent': '#e0409a', '--accent2': '#ffb3d9' } },
  ember: { name: 'Ember', vars: { '--bg0': '#110a07', '--bg1': '#1b110c', '--bg2': '#271912', '--bg3': '#35231a', '--border': '#473024', '--accent': '#e8590c', '--accent2': '#ffc078' } },
  slate: { name: 'Slate', vars: { '--bg0': '#0c0d0f', '--bg1': '#141619', '--bg2': '#1c1f23', '--bg3': '#272b31', '--border': '#343941', '--accent': '#5865a8', '--accent2': '#8fa3c7' } },
}

export const DEFAULT_THEME: ThemeChoice = { preset: 'maple', accent: null }

const ALL_VARS = [...new Set(Object.values(THEMES).flatMap(t => Object.keys(t.vars)))]

export function applyTheme(choice: ThemeChoice | undefined) {
  const root = document.documentElement.style
  for (const name of ALL_VARS) root.removeProperty(name)
  const theme = THEMES[choice?.preset ?? 'maple'] ?? THEMES.maple
  for (const [name, value] of Object.entries(theme.vars)) root.setProperty(name, value)
  if (choice?.accent && /^#[0-9a-f]{6}$/i.test(choice.accent)) root.setProperty('--accent', choice.accent)
}
