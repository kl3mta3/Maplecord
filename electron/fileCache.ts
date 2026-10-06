import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

/**
 * This app's own copies of the pictures and videos it has shown: <userData>/file-cache/<2 chars>/<attachment id>.
 *
 * The server only keeps an uploaded file for a while. The first time a file is shown it is fetched from the server
 * and kept here; after that it is served from here, so it is still there once the server has let it go, and nothing
 * is downloaded twice. When the folder passes its size limit the files not looked at for longest are removed.
 */

export interface CachedFile { path: string; contentType: string }

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Only these are ever served back to the page as something to show. Anything else is treated as bytes. */
const SHOWABLE = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/

export class FileCache {
  private readonly dir: string
  private readonly maxBytes: number
  private readonly fetcher: Fetcher
  private readonly pending = new Map<string, Promise<CachedFile | null>>()
  private total: number | null = null

  constructor(dir: string, fetcher: Fetcher, maxBytes = 2 * 1024 * 1024 * 1024) {
    this.dir = dir
    this.fetcher = fetcher
    this.maxBytes = maxBytes
  }

  private file(id: string) { return path.join(this.dir, id.slice(0, 2).toLowerCase(), id.toLowerCase()) }

  /**
   * The local copy of an attachment, fetching it from `source` if this is the first time. Null when there is no
   * copy here and the server no longer has one either (or the address is not one of the server's file addresses).
   */
  get(id: string, source: string): Promise<CachedFile | null> {
    if (!ID.test(id)) return Promise.resolve(null)
    const running = this.pending.get(id)
    if (running) return running
    const work = this.load(id, source).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }

  private async load(id: string, source: string): Promise<CachedFile | null> {
    const file = this.file(id)
    const meta = file + '.json'
    try {
      const { contentType } = JSON.parse(await fs.promises.readFile(meta, 'utf8')) as { contentType: string }
      await fs.promises.access(file)
      // Touched on use, so "least recently looked at" is simply "oldest modified".
      const now = new Date()
      await fs.promises.utimes(file, now, now).catch(() => {})
      return { path: file, contentType: SHOWABLE.test(contentType) ? contentType : 'application/octet-stream' }
    } catch { /* not here yet */ }

    let url: URL
    try { url = new URL(source) } catch { return null }
    // The page hands us the address; it must be this attachment's own file address and nothing else.
    if (!/^https?:$/.test(url.protocol) || !url.pathname.toLowerCase().startsWith(`/files/${id.toLowerCase()}/`)) return null

    let res
    try { res = await this.fetcher(url.toString()) } catch { return null }
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const data = Buffer.from(await res.arrayBuffer())

    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.promises.writeFile(temp, data)
    await fs.promises.rename(temp, file)
    await fs.promises.writeFile(meta, JSON.stringify({ contentType }))
    if (this.total !== null) this.total += data.length
    void this.trim()
    return { path: file, contentType: SHOWABLE.test(contentType) ? contentType : 'application/octet-stream' }
  }

  private async list() {
    const out: { path: string; size: number; used: number }[] = []
    for (const sub of await fs.promises.readdir(this.dir).catch(() => [] as string[])) {
      const folder = path.join(this.dir, sub)
      for (const name of await fs.promises.readdir(folder).catch(() => [] as string[])) {
        if (name.endsWith('.json') || name.endsWith('.tmp')) continue
        const stat = await fs.promises.stat(path.join(folder, name)).catch(() => null)
        if (stat?.isFile()) out.push({ path: path.join(folder, name), size: stat.size, used: stat.mtimeMs })
      }
    }
    return out
  }

  /** Bytes kept here. */
  async size() {
    if (this.total === null) this.total = (await this.list()).reduce((sum, f) => sum + f.size, 0)
    return this.total
  }

  /** Removes the files not looked at for longest until the folder is comfortably under its limit. */
  async trim() {
    if (await this.size() <= this.maxBytes) return
    const files = (await this.list()).sort((a, b) => a.used - b.used)
    let total = files.reduce((sum, f) => sum + f.size, 0)
    for (const f of files) {
      if (total <= this.maxBytes * 0.9) break
      await fs.promises.rm(f.path, { force: true })
      await fs.promises.rm(f.path + '.json', { force: true })
      total -= f.size
    }
    this.total = total
  }

  async clear() {
    await fs.promises.rm(this.dir, { recursive: true, force: true })
    this.total = 0
  }
}

/**
 * Answers a request for a kept file. A Range header gets just that part back (206), which is what lets a video be
 * skipped through instead of only played from the start.
 */
export function respondWithFile(file: CachedFile, rangeHeader: string | null): Response {
  const size = fs.statSync(file.path).size
  const headers = new Headers({ 'Content-Type': file.contentType, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' })
  const body = (start?: number, end?: number) => Readable.toWeb(fs.createReadStream(file.path, { start, end })) as unknown as ReadableStream<Uint8Array>

  const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null
  if (range && (range[1] || range[2])) {
    // "bytes=500-" is from 500 to the end; "bytes=-500" is the last 500.
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    return new Response(body(start, end), { status: 206, headers })
  }
  headers.set('Content-Length', String(size))
  return new Response(size === 0 ? null : body(), { status: 200, headers })
}
