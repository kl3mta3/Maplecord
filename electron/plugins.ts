import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import vm from 'node:vm'
import type { PluginDrop, PluginInfo, PluginItem, PluginRuntimeConfig, WatchState } from '../src/pluginTypes'

/**
 * Game plugins for the desktop client. A plugin is a folder of data, never code:
 *
 *   my-game/
 *     manifest.json   id, name, gameName, optional logWatcher
 *     items.json      [{ id, name, iconPath?, rarity?, category? }]
 *     icons/          images referenced by iconPath
 *
 * Drop detection is declarative. The manifest names a log file the game writes and a list of regular
 * expressions; this process tails the file and reports a drop when a line matches an item in the plugin's
 * own catalog. Nothing a plugin ships is executed, the file's contents never leave this process (only
 * "item X dropped" does), and patterns run under a time limit so a bad one cannot hang the app.
 *
 * No Electron imports here, so this file runs under plain Node for tests.
 */

export const PLUGIN_API_VERSION = 1

const LIMITS = {
  manifestBytes: 256 * 1024,
  itemsBytes: 32 * 1024 * 1024,
  items: 200_000,
  patterns: 50,
  patternLength: 500,
  lineLength: 2000,
  /** Most we read from the log per poll; a bigger burst skips ahead rather than falling behind. */
  chunkBytes: 256 * 1024,
  batchTimeoutMs: 150,
  patternTimeoutMs: 60,
  contextLength: 80,
}
const POLL_MS = 750
const ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
/** Only data files are copied on install; anything else in the source folder is left behind. */
const INSTALL_EXTENSIONS = new Set([...ICON_EXTENSIONS, '.json', '.md', '.txt'])
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,99}$/i

interface PatternSpec { regex: string; flags?: string; itemId?: string; quantity?: number }
interface LogWatcherSpec { path: string; encoding?: string; cooldownSeconds?: number; patterns: PatternSpec[] }
interface Manifest {
  id: string; name: string; version: string; gameName: string
  author?: string | null; description?: string | null
  itemsFile?: string; apiVersion?: number
  logWatcher?: LogWatcherSpec | null
}

interface CompiledPattern { regex: RegExp | null; itemId: string | null; quantity: number | null; source: string }

interface Loaded {
  info: PluginInfo
  dir: string
  byId: Map<string, PluginItem>
  byName: Map<string, PluginItem>
  watcher: { spec: LogWatcherSpec; patterns: CompiledPattern[]; encoding: BufferEncoding; cooldownMs: number } | null
  tailer: LogTailer | null
  lastDrop: Map<string, number>
}

export interface PluginHostEvents {
  drop(drop: PluginDrop): void
  changed(): void
  log(message: string): void
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Expands %VAR% (Windows), $VAR / ${VAR} and a leading ~ so a manifest can say "%LOCALAPPDATA%/Game/chat.log". */
export function expandPath(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE ?? env.HOME ?? ''
  let p = raw.trim()
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = home + p.slice(1)
  p = p.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, (m, name: string) => env[name] ?? env[name.toUpperCase()] ?? m)
  p = p.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a?: string, b?: string) => env[a ?? b ?? ''] ?? m)
  return path.normalize(p)
}

/** A "*" in the file name picks the most recently written match, for games that start a new log per session. */
function newestMatch(pattern: string): string | null {
  const dir = path.dirname(pattern)
  const base = path.basename(pattern)
  if (!base.includes('*')) return fs.existsSync(pattern) ? pattern : null
  if (dir.includes('*')) return null
  const re = new RegExp('^' + base.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
  let best: { file: string; mtime: number } | null = null
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return null }
  for (const name of names) {
    if (!re.test(name)) continue
    try {
      const stat = fs.statSync(path.join(dir, name))
      if (stat.isFile() && (!best || stat.mtimeMs > best.mtime)) best = { file: path.join(dir, name), mtime: stat.mtimeMs }
    } catch { /* vanished */ }
  }
  return best?.file ?? null
}

function readJson(file: string, maxBytes: number): unknown {
  const stat = fs.statSync(file)
  if (stat.size > maxBytes) throw new Error(`${path.basename(file)} is too large.`)
  // Tolerate a UTF-8 BOM; editors on Windows add one.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
}

/** Resolves `relative` inside `root`, refusing anything (including symlinks) that escapes it. */
function inside(root: string, relative: string): string | null {
  const full = path.resolve(root, relative)
  const rootWithSep = path.resolve(root) + path.sep
  if (!full.startsWith(rootWithSep)) return null
  try {
    const real = fs.realpathSync(full)
    return real.startsWith(fs.realpathSync(root) + path.sep) ? real : null
  } catch { return null }
}

function parseManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest.json must be an object.')
  const m = raw as Record<string, unknown>
  const id = str(m.id, 100), name = str(m.name, 80), gameName = str(m.gameName, 80)
  if (!id || !ID_PATTERN.test(id)) throw new Error('manifest.id must be 2-100 letters, digits, dots, dashes or underscores.')
  if (!name) throw new Error('manifest.name is required.')
  if (!gameName) throw new Error('manifest.gameName is required.')
  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : 1
  if (apiVersion > PLUGIN_API_VERSION) throw new Error(`Plugin needs API v${apiVersion}; this app supports v${PLUGIN_API_VERSION}. Update Maplecord.`)
  return {
    id, name, gameName, apiVersion,
    version: str(m.version, 30) ?? '0.0.0',
    author: str(m.author, 80),
    description: str(m.description, 500),
    itemsFile: str(m.itemsFile, 200) ?? 'items.json',
    logWatcher: m.logWatcher && typeof m.logWatcher === 'object' ? (m.logWatcher as LogWatcherSpec) : null,
  }
}

function parseItems(raw: unknown): PluginItem[] {
  if (!Array.isArray(raw)) throw new Error('items.json must be an array.')
  if (raw.length > LIMITS.items) throw new Error(`items.json has more than ${LIMITS.items} items.`)
  const items: PluginItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'number' ? String(e.id) : str(e.id, 100)
    const name = str(e.name, 100)
    if (!id || !name) continue
    items.push({ id, name, iconPath: str(e.iconPath, 300), rarity: str(e.rarity, 30), category: str(e.category, 60) })
  }
  return items
}

function compileWatcher(spec: LogWatcherSpec): NonNullable<Loaded['watcher']> {
  if (!str(spec.path, 500)) throw new Error('logWatcher.path is required.')
  if (!Array.isArray(spec.patterns) || spec.patterns.length === 0) throw new Error('logWatcher.patterns must list at least one pattern.')
  if (spec.patterns.length > LIMITS.patterns) throw new Error(`logWatcher has more than ${LIMITS.patterns} patterns.`)
  const encoding = (spec.encoding ?? 'utf8').toLowerCase().replace('-', '')
  if (encoding !== 'utf8' && encoding !== 'utf16le' && encoding !== 'latin1') throw new Error('logWatcher.encoding must be utf8, utf16le or latin1.')
  const patterns = spec.patterns.map((p, i): CompiledPattern => {
    const source = str(p?.regex, LIMITS.patternLength + 1)
    if (!source || source.length > LIMITS.patternLength) throw new Error(`logWatcher.patterns[${i}].regex is missing or longer than ${LIMITS.patternLength} characters.`)
    // No g/y: those make exec() stateful between lines.
    const flags = [...new Set((p.flags ?? '').split(''))].filter(f => f === 'i' || f === 'u').join('')
    let regex: RegExp
    try { regex = new RegExp(source, flags) } catch (e) { throw new Error(`logWatcher.patterns[${i}]: ${(e as Error).message}`) }
    return { regex, source, itemId: str(p.itemId, 100), quantity: typeof p.quantity === 'number' ? p.quantity : null }
  })
  const cooldown = typeof spec.cooldownSeconds === 'number' ? Math.min(600, Math.max(0, spec.cooldownSeconds)) : 2
  return { spec, patterns, encoding: encoding as BufferEncoding, cooldownMs: cooldown * 1000 }
}

// Runs every pattern over a batch of lines inside one timed vm call; the first pattern to match a line wins.
const MATCH_SCRIPT = new vm.Script(`(() => {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    for (let p = 0; p < regexes.length; p++) {
      const re = regexes[p]
      if (!re) continue
      const m = re.exec(lines[i])
      if (!m) continue
      const g = m.groups || {}
      out.push([i, p, g.itemId, g.itemName, g.quantity, g.context])
      break
    }
  }
  return out
})()`)

type RawMatch = [line: number, pattern: number, itemId?: string, itemName?: string, quantity?: string, context?: string]

/**
 * Matches lines against plugin-supplied patterns. A pattern that backtracks catastrophically is cut off by the
 * vm timeout, identified, and switched off for the rest of the session; the others keep working.
 */
export function matchLines(lines: string[], patterns: CompiledPattern[], onDisabled: (source: string) => void): RawMatch[] {
  const run = (regexes: (RegExp | null)[], timeout: number) =>
    MATCH_SCRIPT.runInContext(vm.createContext({ lines, regexes }), { timeout }) as RawMatch[]
  try {
    return run(patterns.map(p => p.regex), LIMITS.batchTimeoutMs)
  } catch {
    for (const [i, p] of patterns.entries()) {
      if (!p.regex) continue
      try { run(patterns.map((x, j) => (j === i ? x.regex : null)), LIMITS.patternTimeoutMs) }
      catch { p.regex = null; onDisabled(p.source) }
    }
    try { return run(patterns.map(p => p.regex), LIMITS.batchTimeoutMs) } catch { return [] }
  }
}

/** Follows a growing text file by polling its size (fs.watch misses appends from games on Windows). */
class LogTailer {
  private timer: NodeJS.Timeout | null = null
  private file: string | null = null
  private offset = 0
  private partial = ''
  private decoder: StringDecoder
  private busy = false
  private ticks = 0
  private readonly pathPattern: string
  private readonly encoding: BufferEncoding
  private readonly onLines: (lines: string[]) => void
  private readonly onState: (state: WatchState, file: string | null, message: string | null) => void

  constructor(pathPattern: string, encoding: BufferEncoding, onLines: (lines: string[]) => void,
    onState: (state: WatchState, file: string | null, message: string | null) => void) {
    this.pathPattern = pathPattern
    this.encoding = encoding
    this.onLines = onLines
    this.onState = onState
    this.decoder = new StringDecoder(encoding)
  }

  start() {
    this.pick(true)
    this.timer = setInterval(() => { void this.poll() }, POLL_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** `fromEnd`: an existing log is history, so start at its end; a file that appears later is read from the top. */
  private pick(fromEnd: boolean) {
    const next = newestMatch(this.pathPattern)
    if (next === this.file) return
    this.file = next
    this.partial = ''
    this.decoder = new StringDecoder(this.encoding)
    this.offset = 0
    if (next && fromEnd) { try { this.offset = fs.statSync(next).size } catch { /* raced */ } }
    this.onState(next ? 'watching' : 'missing', next, next ? null : 'The log file does not exist yet. Start the game, or choose the file.')
  }

  private async poll() {
    if (this.busy) return
    this.busy = true
    try {
      // Re-resolve now and then: the file may have appeared, or a wildcard may have a newer match.
      if (!this.file || ++this.ticks % 8 === 0) this.pick(false)
      if (!this.file) return
      let size: number
      try { size = (await fs.promises.stat(this.file)).size } catch { this.file = null; this.pick(false); return }
      if (size < this.offset) { this.offset = 0; this.partial = ''; this.decoder = new StringDecoder(this.encoding) } // truncated or rotated
      if (size === this.offset) return
      if (size - this.offset > LIMITS.chunkBytes) { this.offset = size - LIMITS.chunkBytes; this.partial = ''; this.decoder = new StringDecoder(this.encoding) }
      const length = size - this.offset
      const handle = await fs.promises.open(this.file, 'r')
      let text: string
      try {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, this.offset)
        this.offset += bytesRead
        text = this.partial + this.decoder.write(buffer.subarray(0, bytesRead))
      } finally { await handle.close() }
      const lines = text.split(/\r?\n/)
      this.partial = lines.pop() ?? ''
      if (this.partial.length > LIMITS.lineLength) this.partial = ''
      const usable = lines.filter(l => l.length > 0 && l.length <= LIMITS.lineLength)
      if (usable.length > 0) this.onLines(usable)
    } catch (e) {
      this.onState('error', this.file, (e as Error).message)
    } finally {
      this.busy = false
    }
  }
}

export class PluginHost {
  private plugins: Loaded[] = []
  private config: Record<string, PluginRuntimeConfig> = {}
  readonly directory: string
  private readonly events: PluginHostEvents

  constructor(directory: string, events: PluginHostEvents) {
    this.directory = directory
    this.events = events
  }

  list(): PluginInfo[] { return this.plugins.map(p => p.info) }

  /** Reads every plugin folder again and restarts the watchers the user has switched on. */
  reload(): PluginInfo[] {
    this.stopAll()
    this.plugins = []
    fs.mkdirSync(this.directory, { recursive: true })
    const seen = new Set<string>()
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(this.directory, entry.name)
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue
      const loaded = this.load(dir, entry.name)
      if (!loaded.info.error && seen.has(loaded.info.id.toLowerCase())) loaded.info.error = `Another installed plugin already uses the id "${loaded.info.id}".`
      seen.add(loaded.info.id.toLowerCase())
      this.plugins.push(loaded)
    }
    this.plugins.sort((a, b) => a.info.name.localeCompare(b.info.name))
    this.applyConfig()
    return this.list()
  }

  private load(dir: string, folder: string): Loaded {
    const blank = (error: string | null): Loaded => ({
      dir, byId: new Map(), byName: new Map(), watcher: null, tailer: null, lastDrop: new Map(),
      info: {
        id: folder, name: folder, version: '?', author: null, description: null, gameName: '?', folder, error, items: [],
        watch: { state: 'none', defaultPath: null, activePath: null, patterns: 0, message: null },
      },
    })
    try {
      const manifest = parseManifest(readJson(path.join(dir, 'manifest.json'), LIMITS.manifestBytes))
      const itemsFile = inside(dir, manifest.itemsFile ?? 'items.json')
      const items = itemsFile ? parseItems(readJson(itemsFile, LIMITS.itemsBytes)) : []
      const loaded = blank(null)
      Object.assign(loaded.info, {
        id: manifest.id, name: manifest.name, version: manifest.version, author: manifest.author ?? null,
        description: manifest.description ?? null, gameName: manifest.gameName, items,
      })
      for (const item of items) {
        loaded.byId.set(item.id.toLowerCase(), item)
        loaded.byName.set(item.name.toLowerCase(), item)
      }
      if (manifest.logWatcher) {
        try {
          loaded.watcher = compileWatcher(manifest.logWatcher)
          loaded.info.watch = { state: 'off', defaultPath: expandPath(loaded.watcher.spec.path), activePath: null, patterns: loaded.watcher.patterns.length, message: null }
        } catch (e) {
          // The catalog is still useful for manual rolls; only detection is unavailable.
          loaded.info.watch = { state: 'error', defaultPath: null, activePath: null, patterns: 0, message: (e as Error).message }
        }
      }
      return loaded
    } catch (e) {
      return blank((e as Error).message)
    }
  }

  configure(config: Record<string, PluginRuntimeConfig>) {
    this.config = config
    this.applyConfig()
    this.events.changed()
  }

  private applyConfig() {
    for (const plugin of this.plugins) {
      plugin.tailer?.stop()
      plugin.tailer = null
      const watcher = plugin.watcher
      if (!watcher || plugin.info.error) continue
      const cfg = this.config[plugin.info.id]
      const watch = plugin.info.watch
      if (!cfg?.watch) { watch.state = 'off'; watch.activePath = null; watch.message = null; continue }
      const target = cfg.logPath ? path.normalize(cfg.logPath) : expandPath(watcher.spec.path)
      if (!path.isAbsolute(target)) { watch.state = 'error'; watch.message = 'The log path must be absolute.'; continue }
      plugin.tailer = new LogTailer(target, watcher.encoding,
        lines => this.onLines(plugin, lines),
        (state, file, message) => {
          if (watch.state === state && watch.activePath === file && watch.message === message) return
          watch.state = state; watch.activePath = file; watch.message = message
          this.events.changed()
        })
      plugin.tailer.start()
    }
  }

  private onLines(plugin: Loaded, lines: string[]) {
    const watcher = plugin.watcher
    if (!watcher) return
    const matches = matchLines(lines, watcher.patterns, source => {
      plugin.info.watch.message = `A pattern was switched off because it took too long: ${source.slice(0, 60)}`
      this.events.log(`[${plugin.info.id}] pattern disabled (timeout): ${source}`)
      this.events.changed()
    })
    for (const [, patternIndex, groupId, groupName, groupQuantity, groupContext] of matches) {
      const pattern = watcher.patterns[patternIndex]
      const wantedId = pattern.itemId ?? groupId
      const item = (wantedId ? plugin.byId.get(wantedId.trim().toLowerCase()) : undefined)
        ?? (groupName ? plugin.byName.get(groupName.trim().toLowerCase()) : undefined)
      if (!item) continue // not in this plugin's catalog: ignore
      const now = Date.now()
      if (now - (plugin.lastDrop.get(item.id) ?? 0) < watcher.cooldownMs) continue
      plugin.lastDrop.set(item.id, now)
      const quantity = Math.min(9999, Math.max(1, Math.trunc(Number(groupQuantity ?? pattern.quantity ?? 1)) || 1))
      this.events.drop({
        pluginId: plugin.info.id, itemId: item.id, quantity,
        context: groupContext ? groupContext.trim().slice(0, LIMITS.contextLength) : null,
        at: new Date(now).toISOString(),
      })
    }
  }

  /** Absolute path of an icon inside a plugin folder, or null if it is missing, not an image, or outside the folder. */
  resolveIcon(pluginId: string, relative: string): string | null {
    const plugin = this.plugins.find(p => p.info.id.toLowerCase() === pluginId.toLowerCase())
    if (!plugin || !ICON_EXTENSIONS.has(path.extname(relative).toLowerCase())) return null
    return inside(plugin.dir, relative)
  }

  /** Copies a plugin folder (data files only) into the plugins directory, replacing an older copy of the same id. */
  install(source: string): PluginInfo[] {
    const manifest = parseManifest(readJson(path.join(source, 'manifest.json'), LIMITS.manifestBytes))
    const target = path.join(this.directory, manifest.id.toLowerCase())
    if (path.resolve(source) === path.resolve(target)) return this.reload()
    this.stopAll()
    fs.rmSync(target, { recursive: true, force: true })
    let files = 0
    fs.cpSync(source, target, {
      recursive: true,
      filter: src => {
        const stat = fs.lstatSync(src)
        if (stat.isSymbolicLink()) return false
        if (stat.isDirectory()) return true
        if (!INSTALL_EXTENSIONS.has(path.extname(src).toLowerCase())) return false
        if (++files > 50_000) throw new Error('That folder has too many files to be a plugin.')
        return true
      },
    })
    return this.reload()
  }

  stopAll() {
    for (const plugin of this.plugins) { plugin.tailer?.stop(); plugin.tailer = null }
  }
}
