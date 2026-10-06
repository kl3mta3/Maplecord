import type { PluginDrop, PluginInfo, PluginRuntimeConfig } from './pluginTypes'
import type { SoundPack } from './soundTypes'

/** What the main window pushes to the overlay window. Plain data: it crosses IPC. */
export type OverlayState =
  /** Nothing in progress. `channelName` is the party a roll would go to; without one (`canStart` false) you must join voice first. */
  | { kind: 'idle'; channelName: string; canStart: boolean; channels: { id: string; name: string; current: boolean }[] }
  | {
      kind: 'roll'
      iconUrl: string | null
      sessionId: string
      headline: string
      channelName: string
      range: string
      expiresAt: string
      status: string
      isNeedGreed: boolean
      canAct: boolean
      myValueText: string
      myChoiceText: string
      winningValueText: string
      winnerText: string
      iWon: boolean
      lost: boolean
      ended: boolean
    }
  | {
      /** A plugin saw a drop and the user has not chosen auto-roll: ask what to do. */
      kind: 'drop'
      key: string
      itemName: string
      quantity: number
      gameName: string
      iconUrl: string | null
      channelName: string
    }
  | {
      kind: 'rps'
      sessionId: string
      headline: string
      channelName: string
      expiresAt: string
      status: string
      canPick: boolean
      myPick: number | null
      throws: string[]
      resultText: string
      iWon: boolean
      ended: boolean
    }

/** Overlay → main window. Hotkeys use the first four. */
export type OverlayAction =
  | 'primary' | 'greed' | 'pass' | 'dismiss'
  | 'start-roll' | 'start-need' | 'flip'
  | 'rps-rock' | 'rps-paper' | 'rps-scissors'
  | `select-channel:${string}`
  | 'drop-roll' | 'drop-need' | 'drop-dismiss'

/** What the Electron preload exposes. In a plain browser `window.maplecord` is undefined and we fall back gracefully. */
export interface MaplecordBridge {
  isElectron: true
  platform: string
  oauthLogin(serverUrl: string, provider: string): Promise<string>
  openExternal(url: string): Promise<void>
  onHotkey(handler: (key: OverlayAction) => void): () => void
  // main window → overlay
  setOverlayState(state: OverlayState | null): void
  setOverlayEnabled(enabled: boolean): void
  onOverlayAction(handler: (action: OverlayAction) => void): () => void
  // overlay window
  overlayReady(): void
  onOverlayState(handler: (state: OverlayState | null) => void): () => void
  overlayAction(action: OverlayAction): void
  overlayResize(width: number, height: number): void
  // game plugins
  pluginsList(): Promise<PluginInfo[]>
  pluginsReload(): Promise<PluginInfo[]>
  pluginsConfigure(config: Record<string, PluginRuntimeConfig>): void
  pluginsInstall(): Promise<{ installed: boolean; error: string | null }>
  pluginsOpenFolder(): Promise<unknown>
  pluginsPickLog(): Promise<string | null>
  onPluginsChanged(handler: (list: PluginInfo[]) => void): () => void
  onPluginDrop(handler: (drop: PluginDrop) => void): () => void
  // the user's own sound packs
  soundPacks(): Promise<SoundPack[]>
  soundsOpenFolder(): Promise<unknown>
}

declare global {
  interface Window { maplecord?: MaplecordBridge }
}

/**
 * The version of the client-server protocol this build speaks. The server says the oldest it still accepts
 * (GET /api/meta); a build older than that tells the user to update instead of misbehaving. Raise it together with
 * ProtocolInfo.Version on the server whenever a change would break older clients.
 */
export const CLIENT_PROTOCOL = 1

export const bridge = (): MaplecordBridge | undefined => window.maplecord
export const isElectron = () => !!window.maplecord

/**
 * The public Maplecord server every install connects to. Set VITE_SERVER_URL at build time for release.
 * Users never see this unless they open "Advanced" on the login screen or the default server is unreachable.
 */
export const DEFAULT_SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:5080'
