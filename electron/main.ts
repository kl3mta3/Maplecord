import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, shell } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PluginHost } from './plugins'
import { listSoundPacks, resolveSound } from './soundPacks'
import { PLUGIN_ICON_SCHEME, type PluginRuntimeConfig } from '../src/pluginTypes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let overlayState: unknown = null
let overlayEnabled = true
let overlayTopmostTimer: NodeJS.Timeout | undefined

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    title: 'Maplecord',
    backgroundColor: '#14141c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  win.on('closed', () => { win = null; overlay?.close() })
}

// ---- In-game overlay ----------------------------------------------------------
// A small always-on-top window that never takes focus from the game (focusable: false ⇒ WS_EX_NOACTIVATE
// on Windows). It is driven entirely by the main window over IPC, so there is one server connection.
// Exclusive-fullscreen games still cover it; borderless/windowed modes and the global hotkeys cover that case.

const overlayPrefsPath = () => path.join(app.getPath('userData'), 'overlay.json')
const loadOverlayPrefs = (): { x?: number; y?: number } => {
  try { return JSON.parse(fs.readFileSync(overlayPrefsPath(), 'utf8')) } catch { return {} }
}
const saveOverlayPrefs = (prefs: { x: number; y: number }) => {
  try { fs.writeFileSync(overlayPrefsPath(), JSON.stringify(prefs)) } catch { /* ignore */ }
}

function ensureOverlay(): BrowserWindow {
  if (overlay) return overlay
  const prefs = loadOverlayPrefs()
  const area = screen.getPrimaryDisplay().workArea
  const width = 270, height = 72
  overlay = new BrowserWindow({
    width, height,
    x: prefs.x ?? area.x + area.width - width - 24,
    y: prefs.y ?? area.y + 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    show: false,
    title: 'Maplecord overlay',
    webPreferences: { preload: path.join(__dirname, 'preload.mjs'), contextIsolation: true, nodeIntegration: false },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (VITE_DEV_SERVER_URL) overlay.loadURL(VITE_DEV_SERVER_URL + '?overlay=1')
  else overlay.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { overlay: '1' } })
  overlay.on('moved', () => { const [x, y] = overlay!.getPosition(); saveOverlayPrefs({ x, y }) })
  overlay.on('closed', () => { overlay = null; clearInterval(overlayTopmostTimer) })
  // Games re-assert their own z-order; nudge ours back up while visible.
  overlayTopmostTimer = setInterval(() => { if (overlay?.isVisible()) overlay.setAlwaysOnTop(true, 'screen-saver') }, 2000)
  return overlay
}

ipcMain.on('overlay-state', (_event, state: unknown) => {
  overlayState = state
  if (state && overlayEnabled) {
    const w = ensureOverlay()
    w.webContents.send('overlay-state', state)
    if (!w.isVisible()) w.showInactive()
  } else {
    overlay?.hide()
  }
})
ipcMain.on('overlay-enabled', (_event, enabled: boolean) => { overlayEnabled = enabled; if (!enabled) overlay?.hide() })
ipcMain.on('overlay-ready', event => event.sender.send('overlay-state', overlayState))
ipcMain.on('overlay-action', (_event, action: string) => win?.webContents.send('overlay-action', action))
// The overlay page asks for the size its current mode needs (pill / launcher / live card); keep the top-left anchored.
ipcMain.on('overlay-resize', (_event, size: { width: number; height: number }) => {
  if (!overlay) return
  const [w, h] = overlay.getContentSize()
  if (w !== size.width || h !== size.height) overlay.setContentSize(Math.round(size.width), Math.round(size.height))
})

/**
 * OAuth for a desktop app: listen on a random loopback port, open the system browser at the
 * server's login URL, and resolve with the one-time code the server redirects back with.
 * The renderer then exchanges the code for a JWT over HTTPS; no provider secret is ever in the app.
 */
ipcMain.handle('oauth-login', (_event, serverUrl: string, provider: string) =>
  new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') { res.statusCode = 404; res.end(); return }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<html><body style="font-family:Segoe UI,sans-serif;background:#14141c;color:#e8e8f0;text-align:center;padding-top:80px">
        <h2>${code ? 'Signed in to Maplecord' : 'Sign-in failed'}</h2><p>You can close this tab and return to the app.</p></body></html>`)
      server.close()
      if (code) resolve(code); else reject(new Error(error ?? 'login_failed'))
      win?.focus()
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      const redirect = `http://127.0.0.1:${port}/callback`
      shell.openExternal(`${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(redirect)}`)
    })
    setTimeout(() => { server.close(); reject(new Error('Sign-in timed out.')) }, 5 * 60 * 1000)
  }),
)

// ---- Game plugins -------------------------------------------------------------
// Plugins are folders of data under <userData>/plugins. The host reads catalogs and tails game logs; the UI only
// ever sees the parsed result. Icons are served through a private scheme so the page never gets file:// access.

// corsEnabled: without it a page cannot read an icon back from a canvas, which is how icons are shared with the party.
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]) // stream: <audio> can play from it

const plugins = new PluginHost(path.join(app.getPath('userData'), 'plugins'), {
  drop: drop => win?.webContents.send('plugin-drop', drop),
  changed: () => win?.webContents.send('plugins-changed', plugins.list()),
  log: message => console.log('[plugins]', message),
})

function registerPluginProtocol() {
  // maplecord-plugin://icons/<pluginId>/<path inside the plugin folder>
  protocol.handle(PLUGIN_ICON_SCHEME, request => {
    const url = new URL(request.url)
    const [first, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    // maplecord-plugin://sounds/<pack>/<file> serves a sound from one of the user's own packs.
    const file = url.hostname === 'icons' && first && rest.length > 0 ? plugins.resolveIcon(first, rest.join('/'))
      : url.hostname === 'sounds' && first && rest.length === 1 ? resolveSound(soundsDirectory(), first, rest[0])
      : null
    if (!file) return new Response(null, { status: 404 })
    // CORS-readable so the app can draw an icon to a canvas and share a small PNG of it with the party.
    return net.fetch(pathToFileURL(file).toString()).then(res => {
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers })
    })
  })
}

// Sound packs the user added: <userData>/sounds/<Pack>/<event>.wav. Maplecord itself ships only generated sounds.
const soundsDirectory = () => path.join(app.getPath('userData'), 'sounds')
ipcMain.handle('sound-packs', () => listSoundPacks(soundsDirectory()))
ipcMain.handle('sounds-open-folder', () => { fs.mkdirSync(soundsDirectory(), { recursive: true }); return shell.openPath(soundsDirectory()) })

ipcMain.handle('plugins-list', () => plugins.list())
ipcMain.handle('plugins-reload', () => plugins.reload())
ipcMain.on('plugins-configure', (_event, config: Record<string, PluginRuntimeConfig>) => plugins.configure(config ?? {}))
ipcMain.handle('plugins-open-folder', () => shell.openPath(plugins.directory))
ipcMain.handle('plugins-install', async () => {
  if (!win) return { installed: false, error: null }
  const picked = await dialog.showOpenDialog(win, { title: 'Choose a plugin folder (the one containing manifest.json)', properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return { installed: false, error: null }
  try { plugins.install(picked.filePaths[0]); return { installed: true, error: null } }
  catch (e) { plugins.reload(); return { installed: false, error: e instanceof Error ? e.message : String(e) } }
  finally { win.webContents.send('plugins-changed', plugins.list()) }
})
ipcMain.handle('plugins-pick-log', async () => {
  if (!win) return null
  const picked = await dialog.showOpenDialog(win, { title: 'Choose the log file the game writes', properties: ['openFile'] })
  return picked.canceled ? null : picked.filePaths[0] ?? null
})

ipcMain.handle('open-external', (_event, url: string) => { if (/^https?:/.test(url)) shell.openExternal(url) })

// Global roll hotkeys work while a game has focus; the renderer decides what they mean for the active roll.
function registerHotkeys() {
  const send = (key: string) => () => win?.webContents.send('hotkey', key)
  globalShortcut.register('Control+Alt+R', send('primary'))
  globalShortcut.register('Control+Alt+G', send('greed'))
  globalShortcut.register('Control+Alt+P', send('pass'))
}

app.whenReady().then(() => {
  registerPluginProtocol()
  try { plugins.reload() } catch (e) { console.error('[plugins]', e) }
  createWindow()
  registerHotkeys()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('will-quit', () => { globalShortcut.unregisterAll(); plugins.stopAll() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
