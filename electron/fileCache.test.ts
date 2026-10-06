// Run with: node electron/fileCache.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileCache, respondWithFile } from './fileCache.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplecord-cache-'))
const id = '0a1b2c3d-1111-2222-3333-444455556666'
const other = '9f8e7d6c-1111-2222-3333-444455556666'
const source = (which: string) => `https://chat.example/files/${which}/shot.png`

let fetched: string[] = []
let serverHasIt = true
const respond = (bytes: number, type: string) => async (url: string) => {
  fetched.push(url)
  return serverHasIt
    ? { ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => new Uint8Array(bytes).fill(7).buffer as ArrayBuffer }
    : { ok: false, status: 410, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
}

{
  const cache = new FileCache(dir, respond(1000, 'image/png'))
  const first = await cache.get(id, source(id))
  check(first?.contentType === 'image/png' && fs.statSync(first.path).size === 1000, 'the first look fetches the file and keeps it')
  const again = await cache.get(id, source(id))
  check(again?.path === first?.path && fetched.length === 1, 'the second look is served from the copy, with no download')

  serverHasIt = false
  const afterExpiry = await cache.get(id, source(id))
  check(afterExpiry?.path === first?.path, 'once the server has let it go, the copy still shows')
  check(await cache.get(other, source(other)) === null, 'a file never seen here, and gone from the server, is simply unavailable')
  serverHasIt = true

  fetched = []
  const both = await Promise.all([cache.get(other, source(other)), cache.get(other, source(other))])
  check(fetched.length === 1 && both[0]?.path === both[1]?.path, 'two requests for the same file at once share one download')

  check(await cache.get('../../etc/passwd', source(id)) === null, 'an id that is not an id is refused')
  check(await cache.get('aaaaaaaa-1111-2222-3333-444455556666', 'https://elsewhere.example/steal') === null, 'only the attachment’s own file address is ever fetched')
  check(await cache.get('aaaaaaaa-1111-2222-3333-444455556666', `file:///files/aaaaaaaa-1111-2222-3333-444455556666/x`) === null, 'and only over http(s)')
}

{
  const cache = new FileCache(path.join(dir, 'typed'), respond(10, 'text/html'))
  const page = await cache.get(id, source(id))
  check(page?.contentType === 'application/octet-stream', 'anything that is not a picture or video is never handed back as something to show')
}

{
  // A limit of 2500 bytes holds two 1000-byte files; the third pushes out whichever was looked at longest ago.
  const small = path.join(dir, 'small')
  const cache = new FileCache(small, respond(1000, 'image/png'), 2500)
  const ids = ['11111111-1111-2222-3333-444455556666', '22222222-1111-2222-3333-444455556666', '33333333-1111-2222-3333-444455556666']
  const a = await cache.get(ids[0], source(ids[0]))
  const b = await cache.get(ids[1], source(ids[1]))
  // Make the first one clearly the oldest, then look at it again so the second becomes the oldest.
  fs.utimesSync(a!.path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  fs.utimesSync(b!.path, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000))
  await cache.get(ids[0], source(ids[0]))
  await cache.get(ids[2], source(ids[2]))
  await cache.trim()
  check(fs.existsSync(a!.path) && !fs.existsSync(b!.path), 'over the limit, the file not looked at for longest goes first')
  check(await cache.size() <= 2500, 'and the folder ends up under its limit')
}

{
  const sample = path.join(dir, 'sample.bin')
  fs.writeFileSync(sample, Buffer.from('0123456789abcdefghij'))
  const file = { path: sample, contentType: 'video/mp4' }
  const text = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString()

  const whole = respondWithFile(file, null)
  check(whole.status === 200 && whole.headers.get('accept-ranges') === 'bytes' && await text(whole) === '0123456789abcdefghij', 'without a range the whole file is sent, and says ranges are welcome')
  const middle = respondWithFile(file, 'bytes=5-9')
  check(middle.status === 206 && middle.headers.get('content-range') === 'bytes 5-9/20' && await text(middle) === '56789', 'a range gets exactly that part back')
  const tail = respondWithFile(file, 'bytes=15-')
  check(tail.status === 206 && tail.headers.get('content-range') === 'bytes 15-19/20' && await text(tail) === 'fghij', 'an open-ended range runs to the end')
  const last = respondWithFile(file, 'bytes=-3')
  check(last.status === 206 && await text(last) === 'hij', 'a suffix range is the last bytes')
  const beyond = respondWithFile(file, 'bytes=10-999')
  check(beyond.status === 206 && beyond.headers.get('content-range') === 'bytes 10-19/20', 'a range past the end is cut to what exists')
  check(respondWithFile(file, 'bytes=50-60').status === 416, 'a range entirely past the end is refused')
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
