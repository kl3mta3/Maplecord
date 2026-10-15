/**
 * Just enough of the zip format for sound packs: reading the files out of one (stored or deflated, which is what every
 * zip tool writes), and making one of stored files. No library: the browser unpacks deflate itself.
 */

export interface ZipFile { name: string; data: Uint8Array }

/**
 * The files in a zip whose names <paramref name="wanted"/> keeps, each at most <paramref name="mostEach"/> bytes once
 * unpacked. Anything else in it is not unpacked at all, so a zip cannot make this read more than it was asked for.
 */
export async function readZip(blob: Blob, wanted: (name: string) => boolean, mostEach = 5 * 1024 * 1024): Promise<ZipFile[]> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('That is not a zip file.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out: ZipFile[] = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('That zip file is damaged.')
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extra + comment
    if (name.endsWith('/') || !wanted(name) || size > mostEach) continue
    if (local + 30 > buf.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('That zip file is damaged.')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = buf.subarray(start, start + packed)
    if (method === 0) out.push({ name, data: raw.slice(0, mostEach) })
    else if (method === 8) {
      const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      if (data.length <= mostEach) out.push({ name, data })
    }
  }
  return out
}

let crcTable: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let crc = 0xffffffff
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A zip of these files, kept as they are (sounds do not shrink much). */
export function makeZip(files: ZipFile[]): Blob {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = new TextEncoder().encode(f.name)
    const crc = crc32(f.data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, 0, true)
    head.setUint32(14, crc, true); head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true); head.setUint16(26, name.length, true)
    parts.push(new Uint8Array(head.buffer), name, f.data)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true)
    dir.setUint32(16, crc, true); dir.setUint32(20, f.data.length, true); dir.setUint32(24, f.data.length, true); dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)].map(p => p.slice().buffer as ArrayBuffer), { type: 'application/zip' })
}
