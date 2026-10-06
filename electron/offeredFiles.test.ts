// Run with: node electron/offeredFiles.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OfferedFiles } from './offeredFiles.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}
const refused = async (work: () => Promise<unknown>) => { try { await work(); return false } catch { return true } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplecord-offered-'))
const list = path.join(dir, 'offered-files.json')
const mine = 'https://example.test|user-1'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const clip = path.join(dir, 'raid clip.mkv')
const bytes = new Uint8Array(3 * 1024 * 1024)
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
fs.writeFileSync(clip, bytes)
const notes = path.join(dir, 'notes.txt')
fs.writeFileSync(notes, 'first version')

{
  const offered = new OfferedFiles(list)
  check(await offered.remember(A, clip, mine) && await offered.remember(B, notes, mine), 'a picked file is remembered against its offer')
  check(!await offered.remember(C, path.join(dir, 'nothing-here.bin'), mine) && !await offered.remember(C, dir, mine), 'something that is not a file is not')
  check(!await offered.remember('../../etc/passwd', clip, mine), 'nor anything under a made-up offer id')
  const mineNow = await offered.list(mine)
  check(mineNow.length === 2 && mineNow.some(o => o.offerId === A && o.name === 'raid clip.mkv' && o.size === bytes.length), 'the list gives the name and size, by offer')
  check(!JSON.stringify(mineNow).includes(dir), 'and never where the file is')
  check((await offered.list('https://example.test|user-2')).length === 0, 'another account on the same computer sees none of them')
  offered.closeAll()
}

{
  // A new run of the app: the list is read back from disk.
  const offered = new OfferedFiles(list)
  check((await offered.list(mine)).length === 2, 'after a restart the offers are still remembered')

  const piece = await offered.read(A, 1024 * 1024 + 7, 70_000)
  check(piece.length === 70_000 && piece.every((b, i) => b === (1024 * 1024 + 7 + i) % 251), 'a piece read from the middle is the right piece')
  const tail = await offered.read(A, bytes.length - 10, 10)
  check(tail.length === 10 && tail[9] === (bytes.length - 1) % 251, 'so is the very end')
  check(await refused(() => offered.read(A, bytes.length - 10, 11)), 'reading past the end is refused')
  check(await refused(() => offered.read(A, -1, 10)) && await refused(() => offered.read(A, 0, OfferedFiles.MaxRead + 1)), 'so are a negative start and an over-large piece')
  check(await refused(() => offered.read(C, 0, 10)), 'an offer that was never remembered cannot be read')

  // The file is edited after it was offered: it is no longer the file people were promised.
  fs.writeFileSync(notes, 'second version, longer')
  check(await refused(() => offered.read(B, 0, 5)), 'a file changed since it was offered cannot be read')
  const after = await offered.list(mine)
  check(after.length === 1 && after[0].offerId === A, 'and its offer is dropped from the list')

  // The file goes missing for a while (a drive that is not plugged in) and comes back untouched.
  offered.closeAll()
  const away = clip + '.away'
  fs.renameSync(clip, away)
  check((await offered.list(mine)).length === 0, 'a missing file is not offered')
  check(await refused(() => offered.read(A, 0, 10)), 'and cannot be read')
  fs.renameSync(away, clip)
  check((await offered.list(mine)).length === 1, 'when it is back, unchanged, so is the offer')

  offered.forget(A)
  check((await offered.list(mine)).length === 0 && await refused(() => offered.read(A, 0, 10)), 'a withdrawn offer is forgotten')
  offered.closeAll()
}

{
  const offered = new OfferedFiles(list)
  check((await offered.list(mine)).length === 0, 'and stays forgotten after a restart')
  fs.writeFileSync(list, '{ not json')
  check((await new OfferedFiles(list).list(mine)).length === 0, 'a damaged list starts empty rather than failing')
  offered.closeAll()
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
