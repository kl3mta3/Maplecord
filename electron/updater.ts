import { app, BrowserWindow, net } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileFor, isNewer, trustedUrl, type LatestRelease, type ReleaseFile } from './updateRules'

/**
 * Updating the desktop app, before its window opens.
 *
 * At start-up the app asks the Maplecord server it was built for whether there is a newer release (the server asks
 * GitHub; the app does not, so starting the app tells nobody else anything). If there is one, the right file is
 * downloaded from that release, checked against its size and digest, and put in place:
 *
 * - an installed copy runs the new installer silently, which replaces it and starts it again;
 * - a portable copy (unzipped somewhere) has the new zip unpacked over its folder by a small script that waits for
 *   the app to close, then starts it again.
 *
 * Anything that goes wrong leaves the app as it was and opens it as usual. A version that was tried and did not
 * take is not tried again for a few hours, so a bad release cannot trap the app in a loop.
 *
 * Windows only, and only for the built app: a development run never updates.
 */
export interface UpdateNotice { version: string; reason: string }

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 4000
/** Set to stop just short of replacing anything: the file is downloaded and checked, and what would run is logged. */
const DRY_RUN = !!process.env.MAPLECORD_UPDATE_DRY_RUN

let logFile: string | null = null
function log(message: string) {
  try {
    logFile ??= path.join(app.getPath('userData'), 'update.log')
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch { /* nowhere to write; carry on */ }
}

function splash(logoPath: string): { say: (text: string, fraction?: number) => void; close: () => void } {
  let logo = ''
  try { logo = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64') } catch { /* no picture */ }
  const win = new BrowserWindow({
    width: 300, height: 340, frame: false, resizable: false, maximizable: false, fullscreenable: false, show: false, center: true,
    backgroundColor: '#0b0b10', title: 'Maplecord', webPreferences: { sandbox: true, contextIsolation: true },
  })
  const page = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0b0b10;color:#e8e8f0;font:14px 'Segoe UI',system-ui,sans-serif;-webkit-app-region:drag;user-select:none}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
    img{width:96px;height:96px;filter:drop-shadow(0 0 18px rgba(144,0,255,.55))}
    #t{color:#9a9ab0;text-align:center;padding:0 16px}
    #bar{width:200px;height:6px;border-radius:3px;background:#1c1c27;overflow:hidden;visibility:hidden}
    #fill{height:100%;width:0;background:#9000ff;transition:width .2s}
  </style>${logo ? `<img src="${logo}" alt="">` : ''}<b>Maplecord</b><div id="t">Checking for updates…</div><div id="bar"><div id="fill"></div></div>
  <script>window.say=(t,f)=>{document.getElementById('t').textContent=t;const b=document.getElementById('bar');b.style.visibility=f==null?'hidden':'visible';if(f!=null)document.getElementById('fill').style.width=Math.round(f*100)+'%'}</script>`
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show() })
  return {
    say: (text, fraction) => { if (!win.isDestroyed()) void win.webContents.executeJavaScript(`window.say&&window.say(${JSON.stringify(text)},${fraction === undefined ? 'null' : fraction})`).catch(() => { /* closing */ }) },
    close: () => { if (!win.isDestroyed()) win.destroy() },
  }
}

async function latestFrom(server: string): Promise<LatestRelease | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS)
  try {
    const reply = await net.fetch(server.replace(/\/$/, '') + '/api/client/latest', { signal: abort.signal, cache: 'no-store' })
    return reply.ok ? await reply.json() as LatestRelease : null
  } catch { return null } finally { clearTimeout(timer) }
}

/** Downloads the file, telling `progress` how far along it is. Throws unless what arrived is exactly what was promised. */
async function download(file: ReleaseFile, to: string, progress: (fraction: number) => void) {
  const reply = await net.fetch(file.url, { cache: 'no-store' })
  if (!reply.ok || !reply.body) throw new Error(`the download answered ${reply.status}`)
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(to)
  let got = 0
  try {
    const reader = reply.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      if (got > file.size) throw new Error('more arrived than the release said there was')
      hash.update(value)
      if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
      progress(got / file.size)
    }
  } finally { await new Promise<void>(resolve => out.end(() => resolve())) }
  if (got !== file.size) throw new Error(`${got} of ${file.size} bytes arrived`)
  if (file.sha256 && hash.digest('hex') !== file.sha256.toLowerCase()) throw new Error('the file does not match its digest')
}

/**
 * Unpacks the zip over the app's folder once this process has gone, then starts the app again with what it was
 * started with. A script does it, because the app cannot replace its own files while it is running.
 *
 * Everything the script needs is handed to it in environment variables, so no folder name (spaces, ampersands) can
 * break the command that starts it. It is started through cmd's "start": started directly from here, Windows never
 * runs it.
 */
function replacePortable(zip: string, appDir: string, exeName: string, args: string[]) {
  const script = path.join(path.dirname(zip), 'apply-update.ps1')
  fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'
$Zip = $env:MAPLECORD_UPDATE_ZIP; $Dir = $env:MAPLECORD_UPDATE_DIR; $Exe = $env:MAPLECORD_UPDATE_EXE; $Log = $env:MAPLECORD_UPDATE_LOG
function Say($m) { try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToUniversalTime().ToString('o') + ' script: ' + $m) } catch {} }
try {
  try { Wait-Process -Id ([int]$env:MAPLECORD_UPDATE_PID) -Timeout 60 -ErrorAction SilentlyContinue } catch {}
  $target = Join-Path $Dir $Exe
  # Until the app's own file can be opened for writing, some part of the app is still closing.
  for ($i = 0; $i -lt 60; $i++) { try { $s = [IO.File]::Open($target, 'Open', 'ReadWrite', 'None'); $s.Close(); break } catch { Start-Sleep -Milliseconds 500 } }
  $tmp = Join-Path (Split-Path $Zip) ('unpacked-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  # Windows' own tar unpacks a zip far faster than Expand-Archive. By its full path: another tar may come first on the PATH.
  $tar = Join-Path $env:SystemRoot 'System32\\tar.exe'
  if (Test-Path -LiteralPath $tar) { & $tar -xf $Zip -C $tmp; if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" } }
  else { Expand-Archive -LiteralPath $Zip -DestinationPath $tmp -Force }
  # The app may be at the top of the zip, or inside the one folder it holds.
  $root = $tmp
  if (-not (Test-Path -LiteralPath (Join-Path $root $Exe))) {
    $inner = @(Get-ChildItem -LiteralPath $tmp)
    if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $root = $inner[0].FullName }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $root $Exe))) { throw 'the zip does not hold the app' }
  Copy-Item -Path (Join-Path $root '*') -Destination $Dir -Recurse -Force
  Say 'replaced the app'
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
} catch { Say ('failed: ' + $_.Exception.Message) }
# Whatever happened, the app comes back: the new one, or the old one untouched.
$rest = @(($env:MAPLECORD_UPDATE_ARGS -split [char]10) | Where-Object { $_ } | ForEach-Object { if ($_ -match ' ') { '"' + $_ + '"' } else { $_ } })
foreach ($name in 'ZIP', 'DIR', 'EXE', 'LOG', 'PID', 'ARGS', 'SCRIPT') { Remove-Item ('Env:MAPLECORD_UPDATE_' + $name) -ErrorAction SilentlyContinue }
if ($rest.Count -gt 0) { Start-Process -FilePath (Join-Path $Dir $Exe) -ArgumentList $rest } else { Start-Process -FilePath (Join-Path $Dir $Exe) }
`)
  spawn('cmd.exe', ['/d /s /c "start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& $env:MAPLECORD_UPDATE_SCRIPT""'], {
    detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    env: {
      ...process.env,
      MAPLECORD_UPDATE_SCRIPT: script, MAPLECORD_UPDATE_ZIP: zip, MAPLECORD_UPDATE_DIR: appDir, MAPLECORD_UPDATE_EXE: exeName,
      MAPLECORD_UPDATE_LOG: logFile ?? path.join(path.dirname(zip), 'update.log'), MAPLECORD_UPDATE_PID: String(process.pid), MAPLECORD_UPDATE_ARGS: args.join('\n'),
    },
  }).unref()
}

/**
 * Checks, and updates if there is something newer. Resolves with `quitting: true` when the app is about to be
 * replaced (the caller must quit and open nothing), otherwise with a notice to show if a newer version exists that
 * could not be put in place by itself.
 */
export async function updateAtStartup(options: { server: string; repo: string; logo: string }): Promise<{ quitting: boolean; notice: UpdateNotice | null; done: () => void }> {
  if (!app.isPackaged || process.platform !== 'win32' || !options.server) return { quitting: false, notice: null, done: () => {} }

  const screen = splash(options.logo)
  // The splash stays until the caller has opened the real window: closing the only window would quit the app.
  const stay = (notice: UpdateNotice | null = null) => ({ quitting: false, notice, done: () => screen.close() })
  try {
    const latest = await latestFrom(options.server)
    const current = app.getVersion()
    if (!latest?.version || !isNewer(latest.version, current)) return stay()
    log(`this is ${current}; the newest release is ${latest.version}`)

    const appDir = path.dirname(process.execPath)
    const installed = fs.existsSync(path.join(appDir, `Uninstall ${app.getName()}.exe`))
    const file = fileFor(latest, installed)
    if (!file || !trustedUrl(file.url, options.repo)) { log('the release has no file this copy can use'); return stay({ version: latest.version, reason: 'no file' }) }

    // Tried already, and still the old version: leave it for now rather than try at every start.
    const statePath = path.join(app.getPath('userData'), 'update.json')
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { attempted?: string; at?: number }
      if (state.attempted === latest.version && Date.now() - (state.at ?? 0) < RETRY_AFTER_MS) { log('already tried this version recently'); return stay({ version: latest.version, reason: 'tried' }) }
    } catch { /* never tried */ }

    if (!installed) {
      // A portable copy has to be able to write to its own folder.
      try { const probe = path.join(appDir, `.update-${process.pid}`); fs.writeFileSync(probe, ''); fs.rmSync(probe) }
      catch { log('this folder cannot be written to'); return stay({ version: latest.version, reason: 'folder' }) }
    }

    const dir = path.join(app.getPath('temp'), 'maplecord-update')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const saved = path.join(dir, path.basename(file.name))
    screen.say(`Downloading version ${latest.version}…`, 0)
    await download(file, saved, fraction => screen.say(`Downloading version ${latest.version}…`, fraction))
    log(`downloaded ${file.name} (${file.size} bytes${file.sha256 ? ', digest checked' : ''})`)
    fs.writeFileSync(statePath, JSON.stringify({ attempted: latest.version, at: Date.now() }))

    screen.say(`Installing version ${latest.version}…`)
    const args = process.argv.slice(1).filter(a => !a.toLowerCase().startsWith('maplecord://'))
    if (DRY_RUN) { log(`dry run: would ${installed ? `run ${saved} --updated /S --force-run` : `unpack ${saved} over ${appDir} and start it again`}`); return stay() }
    if (installed) spawn(saved, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    else replacePortable(saved, appDir, path.basename(process.execPath), args)
    log(installed ? 'started the installer' : 'handed over to the script that replaces the app')
    return { quitting: true, notice: null, done: () => screen.close() }
  } catch (e) {
    log(`update failed: ${e instanceof Error ? e.message : e}`)
    return stay()
  }
}
