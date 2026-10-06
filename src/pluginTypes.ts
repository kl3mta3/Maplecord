// Shapes shared by the Electron main process (electron/plugins.ts) and the UI. Types only: no DOM, no Node.

/** One entry of a plugin's items.json. */
export interface PluginItem {
  id: string
  name: string
  /** Relative to the plugin folder, e.g. "icons/1002357.png". */
  iconPath: string | null
  rarity: string | null
  category: string | null
}

export type WatchState = 'none' | 'off' | 'watching' | 'missing' | 'error'

/** A loaded plugin as the UI sees it. */
export interface PluginInfo {
  id: string
  name: string
  version: string
  author: string | null
  description: string | null
  gameName: string
  folder: string
  /** Set when the plugin could not be loaded; everything else is then a placeholder. */
  error: string | null
  items: PluginItem[]
  /** Drop detection: 'none' = the plugin declares no log watcher (items only). */
  watch: {
    state: WatchState
    /** The path from the manifest with variables expanded; what is watched unless the user overrides it. */
    defaultPath: string | null
    /** The file being read right now. */
    activePath: string | null
    patterns: number
    message: string | null
  }
}

/** Per-plugin choices the user made, pushed from the UI to the main process. */
export interface PluginRuntimeConfig {
  watch: boolean
  logPath: string | null
}

/** The main process saw a line in the game log that matched one of the plugin's patterns. */
export interface PluginDrop {
  pluginId: string
  itemId: string
  quantity: number
  /** Optional text captured by the pattern. Shown locally only; never sent to the server. */
  context: string | null
  at: string
}

export const PLUGIN_ICON_SCHEME = 'maplecord-plugin'

/** URL the Electron app serves a plugin's icon from (see the protocol handler in electron/main.ts). */
export const pluginIconUrl = (pluginId: string, iconPath: string) =>
  `${PLUGIN_ICON_SCHEME}://icons/${encodeURIComponent(pluginId)}/${iconPath.split(/[\\/]+/).map(encodeURIComponent).join('/')}`
