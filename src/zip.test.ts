// Plain-Node checks for the zip reader and writer (sound packs): `node src/zip.test.ts`. Checked with the app's own
// (browser) types, so only what a browser has is used here: a deflated zip is made with CompressionStream.
import { makeZip, readZip } from './zip.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++ }
const bytes = (text: string) => new TextEncoder().encode(text)
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

// What this writes, it reads back; and only the files asked for.
const made = makeZip([{ name: 'win.wav', data: bytes('a winning sound') }, { name: 'pack/lose.mp3', data: bytes('a losing sound') }, { name: 'README.txt', data: bytes('words') }])
const back = await readZip(made, name => /\.(wav|mp3)$/.test(name))
check(back.length === 2 && same(back[0].data, bytes('a winning sound')) && back[1].name === 'pack/lose.mp3', 'a zip it makes reads back, with only the files asked for')

// A zip from another tool, with a deflated file in it, made here by hand the way zip tools write one: the stored zip
// this module writes, with the file swapped for its deflated form (the reader does not check the CRC).
async function deflatedZip(name: string, content: Uint8Array): Promise<Blob> {
  const packed = new Uint8Array(await new Response(new Blob([content.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
  const n = bytes(name)
  const local = new DataView(new ArrayBuffer(30)); local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 8, true); local.setUint32(18, packed.length, true); local.setUint32(22, content.length, true); local.setUint16(26, n.length, true)
  const dir = new DataView(new ArrayBuffer(46)); dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(10, 8, true); dir.setUint32(20, packed.length, true); dir.setUint32(24, content.length, true); dir.setUint16(28, n.length, true)
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + n.length, true); end.setUint32(16, 30 + n.length + packed.length, true)
  return new Blob([local.buffer, n.slice().buffer as ArrayBuffer, packed.slice().buffer as ArrayBuffer, dir.buffer, n.slice().buffer as ArrayBuffer, end.buffer])
}
const sound = bytes('x'.repeat(5000))
const unpacked = await readZip(await deflatedZip('emo.ogg', sound), () => true)
check(unpacked.length === 1 && same(unpacked[0].data, sound), 'a deflated file, as zip tools write them, is unpacked')
check((await readZip(await deflatedZip('emo.ogg', sound), () => true, 1000)).length === 0, 'a file bigger than allowed is not unpacked at all')

let refused = ''
try { await readZip(new Blob([bytes('just some text, not a zip').slice().buffer as ArrayBuffer]), () => true) } catch (e) { refused = (e as Error).message }
check(refused.includes('not a zip'), 'something that is not a zip is refused with a reason')

console.log(failures === 0 ? 'zip: all passed' : `zip: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} zip checks failed`)
