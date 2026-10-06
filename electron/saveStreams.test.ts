// Run with: node electron/saveStreams.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SaveStreams } from './saveStreams.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplecord-save-'))
const streams = new SaveStreams()

{
  const target = path.join(dir, 'movie.bin')
  const id = streams.begin(target)
  const piece = new Uint8Array(1024 * 1024).fill(3)
  for (let i = 0; i < 40; i++) await streams.write(id, piece)
  check(fs.existsSync(target + '.part') && !fs.existsSync(target), 'while it arrives the file is a .part, not yet the real name')
  const saved = await streams.end(id)
  check(saved === target && fs.statSync(target).size === 40 * 1024 * 1024 && !fs.existsSync(target + '.part'), 'when complete it has the real name and every byte (40 MB)')
  const data = fs.readFileSync(target)
  check(data[0] === 3 && data[data.length - 1] === 3, 'with the contents that were sent')
}

{
  const target = path.join(dir, 'half.bin')
  const id = streams.begin(target)
  await streams.write(id, new Uint8Array(5000))
  await streams.abort(id)
  check(!fs.existsSync(target) && !fs.existsSync(target + '.part'), 'an abandoned download leaves nothing behind')
  let refused = false
  try { await streams.write(id, new Uint8Array(1)) } catch { refused = true }
  check(refused, 'and cannot be written to afterwards')
}

{
  const target = path.join(dir, 'again.bin')
  fs.writeFileSync(target, 'old contents')
  const id = streams.begin(target)
  await streams.write(id, Buffer.from('new'))
  await streams.end(id)
  check(fs.readFileSync(target, 'utf8') === 'new', 'saving over an existing file replaces it only once the new one is complete')
}

{
  const id = streams.begin(path.join(dir, 'no-such-folder', 'x.bin'))
  let failed = false
  try { await streams.write(id, new Uint8Array(10)); await streams.end(id) } catch { failed = true }
  check(failed, 'a place that cannot be written to reports the failure')
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
