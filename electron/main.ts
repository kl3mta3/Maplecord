import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, net, powerMonitor, protocol, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PluginHost } from './plugins'
import { listSoundPacks, resolveSound } from './soundPacks'
import { FileCache, respondWithFile } from './fileCache'
import { SaveStreams } from './saveStreams'
import { OfferedFiles } from './offeredFiles'
import { updateAtStartup, type UpdateNotice } from './updater'
import { stopPushKey, watchPushKey } from './pushKey'
import { PLUGIN_ICON_SCHEME, type PluginRuntimeConfig } from '../src/pluginTypes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null
let overlay: BrowserWindow | null = null

// ---- Only the app's own page, in the app's own windows ---------------------------------
// Nothing in the app should ever be able to put another page in these windows, or run script in them that is not the
// app's. These are the second line if something ever does: the windows refuse to go anywhere else, and the main
// process (which can read and write files) answers only the app's own page in one of its two windows.

/** Whether an address is the app's own page: the dev server's while running from source, the built index.html otherwise. */
function isAppPage(url: string): boolean {
  try {
    const at = new URL(url)
    if (VITE_DEV_SERVER_URL) return at.origin === new URL(VITE_DEV_SERVER_URL).origin
    return at.protocol === 'file:' && path.normalize(fileURLToPath(at)).toLowerCase() === path.normalize(path.join(RENDERER_DIST, 'index.html')).toLowerCase()
  } catch { return false }
}

/** Keeps a window on the app's own page: it may load it again, and go nowhere else. */
function stayOnApp(window: BrowserWindow) {
  window.webContents.on('will-navigate', (event, url) => { if (!isAppPage(url)) event.preventDefault() })
}

/** Whether a request to the main process comes from the app's own page, in the top frame of the main window or the overlay. */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !isAppPage(frame.url)) return false
  return (!!win && event.sender === win.webContents) || (!!overlay && event.sender === overlay.webContents)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler says what it takes
const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Refused: this did not come from the app.')
    return listener(event, ...args)
  })
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler says what it takes
const on = (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) =>
  ipcMain.on(channel, (event, ...args) => { if (fromApp(event)) listener(event, ...args) })
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
    // Running from source the picture is in public/; built, it sits beside the page.
    icon: path.join(VITE_DEV_SERVER_URL ? path.join(RENDERER_DIST, '..', 'public') : RENDERER_DIST, 'logo.png'),
    backgroundColor: '#14141c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // A stream popped out into a window of its own (see src/popout.ts): a blank page the app fills in itself.
    if (url === 'about:blank' && frameName.startsWith('maplecord-stream-')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 960, height: 540, minWidth: 320, minHeight: 180, backgroundColor: '#000000', autoHideMenuBar: true, title: 'Maplecord stream' },
      }
    }
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // A popped-out stream never opens anything itself, and never goes anywhere else.
  win.webContents.on('did-create-window', child => {
    child.removeMenu()
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', event => event.preventDefault())
  })

  stayOnApp(win)
  if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  win.on('closed', () => {
    win = null
    overlay?.close()
    // Popped-out streams belong to the main window and go with it.
    for (const other of BrowserWindow.getAllWindows()) other.close()
  })
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
  stayOnApp(overlay)
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (VITE_DEV_SERVER_URL) overlay.loadURL(VITE_DEV_SERVER_URL + '?overlay=1')
  else overlay.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { overlay: '1' } })
  overlay.on('moved', () => { const [x, y] = overlay!.getPosition(); saveOverlayPrefs({ x, y }) })
  overlay.on('closed', () => { overlay = null; clearInterval(overlayTopmostTimer) })
  // Games re-assert their own z-order; nudge ours back up while visible.
  overlayTopmostTimer = setInterval(() => { if (overlay?.isVisible()) overlay.setAlwaysOnTop(true, 'screen-saver') }, 2000)
  return overlay
}

on('overlay-state', (_event, state: unknown) => {
  overlayState = state
  if (state && overlayEnabled) {
    const w = ensureOverlay()
    w.webContents.send('overlay-state', state)
    if (!w.isVisible()) w.showInactive()
  } else {
    overlay?.hide()
  }
})
on('overlay-enabled', (_event, enabled: boolean) => { overlayEnabled = enabled; if (!enabled) overlay?.hide() })
on('overlay-ready', event => event.sender.send('overlay-state', overlayState))
on('overlay-action', (_event, action: string) => win?.webContents.send('overlay-action', action))
// The overlay page asks for the size its current mode needs (pill / launcher / live card); keep the top-left anchored.
on('overlay-resize', (_event, size: { width: number; height: number }) => {
  if (!overlay) return
  const [w, h] = overlay.getContentSize()
  if (w !== size.width || h !== size.height) overlay.setContentSize(Math.round(size.width), Math.round(size.height))
})

/**
 * OAuth for a desktop app: listen on a random loopback port, open the system browser at the
 * server's login URL, and resolve with the one-time code the server redirects back with.
 * The renderer then exchanges the code for a JWT over HTTPS; no provider secret is ever in the app.
 */
/** How a sign-in in the browser ended: a code to exchange, a ticket to wait with while an email is confirmed, or why it did not go through. */
type SignInResult = { code: string } | { pending: string; email: string } | { error: string }
const signInInBrowser = (serverUrl: string, provider: string) =>
  new Promise<SignInResult>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') { res.statusCode = 404; res.end(); return }
      const code = url.searchParams.get('code')
      const pending = url.searchParams.get('pending')
      const error = url.searchParams.get('error')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<html><body style="font-family:Segoe UI,sans-serif;background:#14141c;color:#e8e8f0;text-align:center;padding-top:80px">
        <h2>${code ? 'Signed in to Maplecord' : pending ? 'One more step: check your email' : 'Sign-in did not go through'}</h2><p>You can close this tab and return to the app.</p></body></html>`)
      server.close()
      resolve(code ? { code } : pending ? { pending, email: url.searchParams.get('email') ?? '' } : { error: error ?? 'login_failed' })
      win?.focus()
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      const redirect = `http://127.0.0.1:${port}/callback`
      shell.openExternal(`${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(redirect)}`)
    })
    setTimeout(() => { server.close(); reject(new Error('Sign-in timed out.')) }, 5 * 60 * 1000)
  })
handle('oauth-sign-in', (_event, serverUrl: string, provider: string) => signInInBrowser(serverUrl, provider))
// The older form, for proving again who is here (before P2P is allowed, or an account deleted): a code or nothing.
handle('oauth-login', async (_event, serverUrl: string, provider: string) => {
  const result = await signInInBrowser(serverUrl, provider)
  if ('code' in result) return result.code
  throw new Error('error' in result ? result.error : 'login_failed')
})

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

// Pictures and videos from messages are kept on this computer once shown, because the server only holds them for a while.
const fileCache = new FileCache(path.join(app.getPath('userData'), 'file-cache'), url => net.fetch(url, { credentials: 'omit' }))

function registerPluginProtocol() {
  // maplecord-plugin://icons/<pluginId>/<path inside the plugin folder>
  protocol.handle(PLUGIN_ICON_SCHEME, async request => {
    const url = new URL(request.url)
    const [first, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    // maplecord-plugin://files/<attachment id>/<name>?u=<the file's address on the server>
    if (url.hostname === 'files') {
      const cached = first ? await fileCache.get(first, url.searchParams.get('u') ?? '') : null
      // The Range header is honoured so a video can be skipped through.
      return cached ? respondWithFile(cached, request.headers.get('Range')) : new Response(null, { status: 404 })
    }
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
handle('sound-packs', () => listSoundPacks(soundsDirectory()))
handle('sounds-open-folder', () => { fs.mkdirSync(soundsDirectory(), { recursive: true }); return shell.openPath(soundsDirectory()) })

handle('plugins-list', () => plugins.list())
handle('plugins-reload', () => plugins.reload())
on('plugins-configure', (_event, config: Record<string, PluginRuntimeConfig>) => plugins.configure(config ?? {}))
handle('plugins-open-folder', () => shell.openPath(plugins.directory))
handle('plugins-install', async () => {
  if (!win) return { installed: false, error: null }
  const picked = await dialog.showOpenDialog(win, { title: 'Choose a plugin folder (the one containing manifest.json)', properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return { installed: false, error: null }
  try { plugins.install(picked.filePaths[0]); return { installed: true, error: null } }
  catch (e) { plugins.reload(); return { installed: false, error: e instanceof Error ? e.message : String(e) } }
  finally { win.webContents.send('plugins-changed', plugins.list()) }
})
handle('plugins-pick-log', async () => {
  if (!win) return null
  const picked = await dialog.showOpenDialog(win, { title: 'Choose the log file the game writes', properties: ['openFile'] })
  return picked.canceled ? null : picked.filePaths[0] ?? null
})

// ---- Sharing a screen or an app window ------------------------------------------
// The page shows its own picker (like Discord's) from this list, tells us which one was chosen, and then asks the
// browser engine for a display capture; the handler below answers that request with the chosen source and nothing else.
let chosenSource: string | null = null
handle('share-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
  return sources
    // Our own overlay is not something to share.
    .filter(s => s.name !== 'Maplecord overlay')
    .map(s => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }))
})
handle('share-choose', (_event, id: string | null) => { chosenSource = typeof id === 'string' ? id : null })
handle('system-idle-seconds', () => powerMonitor.getSystemIdleTime())

function registerDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const id = chosenSource
    chosenSource = null
    const deny = () => { try { callback({}) } catch { /* the page's request simply fails */ } }
    if (!id) { deny(); return }
    desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => {
        const source = sources.find(s => s.id === id)
        // With sound: what this computer is playing. The page asks for it with our own sound left out (see the store's
        // startShare), so the call itself is not sent back to the people in it.
        if (source) callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source })
        else deny()
      })
      .catch(deny)
  })
}

// Files received from other people are written to disk as they arrive (see electron/saveStreams.ts).
const saves = new SaveStreams()
handle('save-begin', async (_event, name: string) => {
  if (!win) return null
  // Only the name: whatever folders the sender's file name claims are not followed.
  const safe = path.basename(String(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'file'
  const picked = await dialog.showSaveDialog(win, { title: 'Save file', defaultPath: path.join(app.getPath('downloads'), safe) })
  return picked.canceled || !picked.filePath ? null : saves.begin(picked.filePath)
})
handle('save-write', (_event, id: string, data: Uint8Array) => saves.write(id, data))
handle('save-end', async (_event, id: string) => { await saves.end(id) })
handle('save-abort', (_event, id: string) => saves.abort(id))

// Files offered to other people are remembered, so the offers come back after a restart (see electron/offeredFiles.ts).
// The window names an offer, never a path: the path only ever comes from a file the person picked (see preload).
const offered = new OfferedFiles(path.join(app.getPath('userData'), 'offered-files.json'))
handle('offer-remember', (_event, offerId: string, filePath: string, scope: string) => offered.remember(offerId, filePath, scope))
handle('offer-list', (_event, scope: string) => offered.list(String(scope)))
handle('offer-read', (_event, offerId: string, offset: number, length: number) => offered.read(offerId, offset, length))
handle('offer-forget', (_event, offerId: string) => offered.forget(offerId))

handle('open-external', (_event, url: string) => { if (/^https?:/.test(url)) shell.openExternal(url) })

// Global roll hotkeys work while a game has focus; the renderer decides what they mean for the active roll.
// ---- Invite links ---------------------------------------------------------------
// The installed app answers maplecord://invite/CODE links (a server's invite page has an "Open in the app" button).
// Windows hands the link to a new copy of the app as an argument, so only one copy runs, and a second one passes
// what it was given to the first and leaves. Only the installed app does this, never a development run.
const INVITE_LINK = 'maplecord://invite/'
// A friend link (maplecord://add/CODE) arrives and is handed over the same way; the window tells the two apart.
const FRIEND_LINK = 'maplecord://add/'
const isAppLink = (text: string) => { const link = text.toLowerCase(); return link.startsWith(INVITE_LINK) || link.startsWith(FRIEND_LINK) }
const inviteLinkIn = (args: string[]) => args.find(isAppLink) ?? null
/** The link the app was started or woken by, kept until the window takes it. */
let waitingInviteLink: string | null = inviteLinkIn(process.argv)

function followInviteLink(link: string | null) {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  if (!link) return
  waitingInviteLink = link
  win?.webContents.send('invite-link')
}

const onlyCopy = !app.isPackaged || app.requestSingleInstanceLock()
if (!onlyCopy) app.quit()
else if (app.isPackaged) {
  app.setAsDefaultProtocolClient('maplecord')
  app.on('second-instance', (_event, argv) => followInviteLink(inviteLinkIn(argv)))
}
// macOS hands links over this way instead.
app.on('open-url', (event, url) => { if (isAppLink(url)) { event.preventDefault(); followInviteLink(url) } })
handle('take-invite-link', () => { const link = waitingInviteLink; waitingInviteLink = null; return link })

function registerHotkeys() {
  const send = (key: string) => () => win?.webContents.send('hotkey', key)
  globalShortcut.register('Control+Alt+R', send('primary'))
  globalShortcut.register('Control+Alt+G', send('greed'))
  globalShortcut.register('Control+Alt+P', send('pass'))
}

// Push to talk: the window says which key to watch while it is in voice, and is told when that key goes down and up.
handle('push-key-watch', (_event, key: unknown) => {
  const wanted = key && typeof key === 'object' && ((key as { kind?: unknown }).kind === 'key' || (key as { kind?: unknown }).kind === 'mouse') && typeof (key as { code?: unknown }).code === 'string'
    ? { kind: (key as { kind: 'key' | 'mouse' }).kind, code: (key as { code: string }).code.slice(0, 32), label: '' }
    : null
  return watchPushKey(wanted, held => { if (win && !win.isDestroyed()) win.webContents.send('push-key', held) })
})

/** A newer version that could not be put in place by itself, for the window to mention once. */
let updateNotice: UpdateNotice | null = null
handle('take-update-notice', () => { const notice = updateNotice; updateNotice = null; return notice })

app.whenReady().then(async () => {
  if (!onlyCopy) return
  // Before anything opens: is there a newer version? (See updater.ts. A development run skips this.)
  const update = await updateAtStartup({
    server: __UPDATE_SERVER__, repo: __UPDATE_REPO__,
    logo: path.join(VITE_DEV_SERVER_URL ? path.join(RENDERER_DIST, '..', 'public') : RENDERER_DIST, 'logo.png'),
  })
  if (update.quitting) { app.quit(); return }
  updateNotice = update.notice
  registerPluginProtocol()
  registerDisplayCapture()
  try { plugins.reload() } catch (e) { console.error('[plugins]', e) }
  createWindow()
  update.done()
  registerHotkeys()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopPushKey(); plugins.stopAll(); void saves.abortAll(); offered.closeAll() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
