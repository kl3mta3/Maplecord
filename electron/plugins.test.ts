// Plain-Node checks for the plugin host: `node electron/plugins.test.ts` (Node 24 strips the types).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginHost, expandPath } from './plugins.ts'
import type { PluginDrop } from '../src/pluginTypes.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const example = path.resolve(here, '../plugins/example-game')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'maplecord-plugins-'))
const pluginsDir = path.join(work, 'plugins')
const log = path.join(work, 'game.log')
let failures = 0
const check = (ok: boolean, what: string) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++ }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const drops: PluginDrop[] = []
const logs: string[] = []
const host = new PluginHost(pluginsDir, { drop: d => drops.push(d), changed: () => {}, log: m => logs.push(m) })
const until = async (cond: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(50); return cond() }

// ---- install + load ----
fs.writeFileSync(path.join(example, 'evil.exe'), 'not data') // must not be copied
let list: ReturnType<PluginHost['list']>
try { list = host.install(example) } finally { fs.rmSync(path.join(example, 'evil.exe')) }
const demo = list.find(p => p.id === 'com.example.demo-game')
check(!!demo && !demo.error && demo.items.length === 3, `example plugin installs and loads (${demo?.items.length} items)`)
check(demo?.watch.state === 'off' && demo.watch.patterns === 2, 'log watcher is declared but off until the user enables it')
check(!fs.existsSync(path.join(pluginsDir, 'com.example.demo-game', 'evil.exe')), 'install copies data files only')
check(fs.existsSync(path.join(pluginsDir, 'com.example.demo-game', 'icons', '1002357.svg')), 'icons are copied')

// ---- icons ----
check(!!host.resolveIcon('COM.EXAMPLE.DEMO-GAME', 'icons/1002357.svg'), 'icon resolves (case-insensitive id)')
check(host.resolveIcon('com.example.demo-game', '../../../game.log') === null, 'path traversal is refused')
check(host.resolveIcon('com.example.demo-game', 'manifest.json') === null, 'non-image files are refused')
check(host.resolveIcon('nope', 'icons/1002357.svg') === null, 'unknown plugin has no icons')

// ---- watching ----
fs.writeFileSync(log, '[loot] 1002357\n') // history from before we started: must be ignored
host.configure({ 'com.example.demo-game': { watch: true, logPath: log } })
await until(() => host.list()[0].watch.state === 'watching')
check(host.list()[0].watch.state === 'watching' && host.list()[0].watch.activePath === log, 'watching the chosen file')
await sleep(900)
check(drops.length === 0, 'lines written before watching started are not replayed')

fs.appendFileSync(log, 'some chatter\r\n[loot] 1122000 x3 from Horntail\r\n[loot] 9999999\r\n')
await until(() => drops.length >= 1)
check(drops.length === 1 && drops[0].itemId === '1122000' && drops[0].quantity === 3 && drops[0].context === 'Horntail', 'id pattern: item, quantity and context captured; unknown id ignored')

fs.appendFileSync(log, 'You have gained an item: maple leaf (12)\n')
await until(() => drops.length >= 2)
check(drops[1]?.itemId === '4001126' && drops[1].quantity === 12, 'name pattern resolves the item by name, case-insensitively')

fs.appendFileSync(log, '[loot] 4001126\n')
await sleep(1200)
check(drops.length === 2, 'the same item inside the cooldown is not reported twice')

fs.appendFileSync(log, '[loot] 10023') // a line still being written
await sleep(1000)
fs.appendFileSync(log, '57\n')
await until(() => drops.length >= 3)
check(drops[2]?.itemId === '1002357', 'a line written in two pieces is matched once it is complete')

fs.writeFileSync(log, '') // the game truncates its log
await sleep(1000)
fs.appendFileSync(log, '[loot] 1122000\n')
await until(() => drops.length >= 4)
check(drops[3]?.itemId === '1122000', 'keeps working after the log is truncated')

host.configure({ 'com.example.demo-game': { watch: false, logPath: log } })
fs.appendFileSync(log, '[loot] 1002357\n')
await sleep(1200)
check(drops.length === 4 && host.list()[0].watch.state === 'off', 'switching the watcher off stops detection')

// ---- a hostile pattern ----
const bad = path.join(pluginsDir, 'bad')
fs.mkdirSync(bad)
fs.writeFileSync(path.join(bad, 'items.json'), JSON.stringify([{ id: 'a', name: 'Thing' }]))
fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify({
  id: 'test.bad', name: 'Bad', gameName: 'x', version: '1',
  logWatcher: { path: log, cooldownSeconds: 0, patterns: [{ regex: '^(a+)+$' }, { regex: '^drop (?<itemId>\\w+)$' }] },
}))
host.reload()
host.configure({ 'test.bad': { watch: true, logPath: null } })
await until(() => host.list().find(p => p.id === 'test.bad')?.watch.state === 'watching')
const before = drops.length
const started = Date.now()
fs.appendFileSync(log, 'a'.repeat(60) + '!\ndrop a\n')
await until(() => drops.length > before, 6000)
check(drops.length === before + 1 && drops[drops.length - 1].pluginId === 'test.bad', `runaway regex is cut off and the other pattern still matches (${Date.now() - started} ms)`)
check(logs.some(l => l.includes('pattern disabled')), 'the runaway pattern is reported and switched off')

// ---- bad manifests ----
const broken = path.join(pluginsDir, 'broken')
fs.mkdirSync(broken)
fs.writeFileSync(path.join(broken, 'manifest.json'), JSON.stringify({ id: '../escape', name: 'x', gameName: 'x' }))
const future = path.join(pluginsDir, 'future')
fs.mkdirSync(future)
fs.writeFileSync(path.join(future, 'manifest.json'), JSON.stringify({ id: 'test.future', name: 'x', gameName: 'x', apiVersion: 99 }))
const after = host.reload()
check(!!after.find(p => p.folder === 'broken')?.error, 'an invalid id is reported as an error, not loaded')
check(!!after.find(p => p.folder === 'future')?.error?.includes('Update'), 'a plugin for a newer API asks the user to update')
check(after.filter(p => !p.error).length === 2, 'good plugins still load next to broken ones')

check(expandPath('%NOPE_NOT_SET%/x').includes('%NOPE_NOT_SET%') && !expandPath('%TEMP%/x').includes('%'), 'environment variables expand; unknown ones are left alone')

host.stopAll()
fs.rmSync(work, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
