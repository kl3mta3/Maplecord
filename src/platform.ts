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

/** Something on this computer that can be shared: a whole screen or one app's window. */
export interface ShareSource { id: string; name: string; kind: 'screen' | 'window'; thumbnail: string | null; icon: string | null }

/** What the Electron preload exposes. In a plain browser `window.maplecord` is undefined and we fall back gracefully. */
export interface MaplecordBridge {
  isElectron: true
  platform: string
  oauthLogin(serverUrl: string, provider: string): Promise<string>
  /** Signs in through the system browser: a code to exchange, a ticket to wait with while an email is confirmed, or why it did not go through. */
  oauthSignIn(serverUrl: string, provider: string): Promise<{ code?: string; pending?: string; email?: string; error?: string }>
  openExternal(url: string): Promise<void>
  onHotkey(handler: (key: OverlayAction) => void): () => void
  /**
   * Push to talk while another window is in front: start watching this key (or stop, with null). Resolves false when
   * this computer cannot watch it system-wide; it then only works while Maplecord is in front.
   */
  watchPushKey(key: { kind: 'key' | 'mouse'; code: string; label: string } | null): Promise<boolean>
  /** Told each time the watched key goes down (true) or up (false). */
  onPushKey(handler: (held: boolean) => void): () => void
  /** A newer version of the app that could not install itself at start-up, once; null when there is none to mention. */
  takeUpdateNotice(): Promise<{ version: string; reason: string } | null>
  /** The maplecord:// invite link the app was started or woken by, once; null when there is none waiting. */
  takeInviteLink(): Promise<string | null>
  /** Told when such a link arrives while the app is running; take it with takeInviteLink. */
  onInviteLink(handler: () => void): () => void
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
  // sharing a screen or an app window: list what there is, say which one, then call getDisplayMedia()
  shareSources(): Promise<ShareSource[]>
  shareChoose(id: string | null): Promise<void>
  /** Seconds since the keyboard or mouse was last used, anywhere on the computer. */
  systemIdleSeconds(): Promise<number>
  // saving a file as it arrives from another person; saveBegin shows the Save dialog and is null if cancelled
  saveBegin(name: string): Promise<string | null>
  saveWrite(id: string, data: Uint8Array): Promise<void>
  saveEnd(id: string): Promise<void>
  saveAbort(id: string): Promise<void>
  // files this computer has offered, remembered so the offers come back after a restart. `scope` is whose they are.
  offerRemember(offerId: string, file: File, scope: string): Promise<boolean>
  /** The remembered offers whose file is still there, unchanged. */
  offerList(scope: string): Promise<{ offerId: string; name: string; size: number }[]>
  offerRead(offerId: string, offset: number, length: number): Promise<Uint8Array>
  offerForget(offerId: string): Promise<void>
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

/** A phone or tablet's browser: where a page in the background is slowed down or stopped, and comes back later. */
export const isHandheld = () => !isElectron() && (appleTouch() || /Android/i.test(navigator.userAgent))

/** An iPhone or iPad, in any browser (they are all Safari underneath). An iPad says it is a Mac; a real Mac has no touch screen. */
export const appleTouch = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

/**
 * The public Maplecord server every install connects to. Set VITE_SERVER_URL at build time for release.
 * The sign-in screen offers no other: an app belongs to the server it was built for.
 */
export const DEFAULT_SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)
  // A Maplecord server that hosts this page says who it is as it hands the page out.
  ?? (window as unknown as { __MAPLECORD_SERVER__?: string }).__MAPLECORD_SERVER__
  ?? 'http://localhost:5080'
