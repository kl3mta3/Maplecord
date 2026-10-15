// Plain-Node checks for sound pack discovery: `node electron/soundPacks.test.ts` (Node 24 strips the types).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deletePack, listSoundPacks, resolveSound, savePack } from './soundPacks.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maplecord-sounds-'))
let failures = 0
const check = (ok: boolean, what: string) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++ }
const put = (pack: string, file: string) => { fs.mkdirSync(path.join(root, pack), { recursive: true }); fs.writeFileSync(path.join(root, pack, file), 'x') }

put('Arcade', 'win.wav'); put('Arcade', 'LOSE.MP3'); put('Arcade', 'notes.txt'); put('Arcade', 'explosion.wav')
put('Quiet', 'roll.ogg')
put('_backup', 'win.wav')
put('Empty', 'readme.txt')
fs.writeFileSync(path.join(root, 'loose.wav'), 'x')
fs.writeFileSync(path.join(os.tmpdir(), 'maplecord-outside.wav'), 'x')

const packs = listSoundPacks(root)
check(packs.map(p => p.name).join(',') === 'Arcade,Quiet', `packs are the folders that hold at least one known sound (${packs.map(p => p.name).join(', ')})`)
const arcade = packs.find(p => p.name === 'Arcade')!
check(arcade.events.win === 'win.wav' && arcade.events.lose === 'LOSE.MP3' && Object.keys(arcade.events).length === 2, 'files are matched to events by name, any case, wav / mp3 / ogg; other files are ignored')
check(!packs.some(p => p.name.startsWith('_')), 'folders starting with an underscore are left alone')
check(listSoundPacks(path.join(root, 'does', 'not', 'exist')).length === 0, 'a missing sounds folder is simply empty (and gets created)')

check(resolveSound(root, 'Arcade', 'win.wav') !== null, 'a sound in a pack resolves')
check(resolveSound(root, 'Arcade', 'notes.txt') === null, 'only audio files are served')
check(resolveSound(root, '..', path.basename(os.tmpdir()) + '/maplecord-outside.wav') === null && resolveSound(root, 'Arcade', '../../maplecord-outside.wav') === null, 'nothing outside the sounds folder is served')
check(resolveSound(root, 'Arcade', 'missing.wav') === null, 'a missing file is not served')

const bytes = new Uint8Array([1, 2, 3])
const saved = savePack(root, 'Arcade', [{ event: 'win', ext: 'wav', data: bytes }, { event: '../../evil', ext: 'wav', data: bytes }, { event: 'lose', ext: 'exe', data: bytes }])
check(saved === 'Arcade (2)' && fs.readdirSync(path.join(root, 'Arcade (2)')).join(',') === 'win.wav', 'an imported pack gets a folder of its own, a new name if taken, and only the files named for a moment')
check(savePack(root, '../../outside', [{ event: 'win', ext: 'wav', data: bytes }]) === 'outside' && !fs.existsSync(path.join(root, '..', 'outside')), 'a pack name cannot reach outside the sounds folder')
check(savePack(root, 'Nothing', [{ event: 'notes', ext: 'txt', data: bytes }]) === null, 'a pack with nothing usable is not saved')
check(deletePack(root, 'Arcade (2)') && !fs.existsSync(path.join(root, 'Arcade (2)')) && !deletePack(root, '..') && !deletePack(root, 'Missing'), 'a pack folder can be deleted, and nothing outside the sounds folder')

fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(path.join(os.tmpdir(), 'maplecord-outside.wav'), { force: true })
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
