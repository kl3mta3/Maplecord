import { contextBridge, ipcRenderer } from 'electron'

type Action = string

const subscribe = <T,>(channel: string, handler: (payload: T) => void) => {
  const listener = (_e: unknown, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** The only bridge between the web UI and the OS. Keep it tiny and typed (see src/platform.ts). */
contextBridge.exposeInMainWorld('maplecord', {
  isElectron: true,
  platform: process.platform,
  oauthLogin: (serverUrl: string, provider: string): Promise<string> => ipcRenderer.invoke('oauth-login', serverUrl, provider),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  onHotkey: (handler: (key: Action) => void) => subscribe<Action>('hotkey', handler),

  // main window → overlay
  setOverlayState: (state: unknown) => ipcRenderer.send('overlay-state', state),
  setOverlayEnabled: (enabled: boolean) => ipcRenderer.send('overlay-enabled', enabled),
  onOverlayAction: (handler: (action: Action) => void) => subscribe<Action>('overlay-action', handler),

  // overlay window
  overlayReady: () => ipcRenderer.send('overlay-ready'),
  onOverlayState: (handler: (state: unknown) => void) => subscribe<unknown>('overlay-state', handler),
  overlayAction: (action: Action) => ipcRenderer.send('overlay-action', action),
  overlayResize: (width: number, height: number) => ipcRenderer.send('overlay-resize', { width, height }),

  // game plugins (see electron/plugins.ts)
  pluginsList: (): Promise<unknown> => ipcRenderer.invoke('plugins-list'),
  pluginsReload: (): Promise<unknown> => ipcRenderer.invoke('plugins-reload'),
  pluginsConfigure: (config: unknown) => ipcRenderer.send('plugins-configure', config),
  pluginsInstall: (): Promise<unknown> => ipcRenderer.invoke('plugins-install'),
  pluginsOpenFolder: (): Promise<unknown> => ipcRenderer.invoke('plugins-open-folder'),
  pluginsPickLog: (): Promise<string | null> => ipcRenderer.invoke('plugins-pick-log'),
  onPluginsChanged: (handler: (list: unknown) => void) => subscribe<unknown>('plugins-changed', handler),
  onPluginDrop: (handler: (drop: unknown) => void) => subscribe<unknown>('plugin-drop', handler),

  // the user's own sound packs (see electron/soundPacks.ts)
  soundPacks: (): Promise<unknown> => ipcRenderer.invoke('sound-packs'),
  soundsOpenFolder: (): Promise<unknown> => ipcRenderer.invoke('sounds-open-folder'),
})
