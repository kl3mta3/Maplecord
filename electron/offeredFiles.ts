import fs from 'node:fs'

interface Remembered { path: string; name: string; size: number; mtimeMs: number; scope: string; at: number }

/** What the window is told about a remembered offer: never where the file is. */
export interface OfferedFile { offerId: string; name: string; size: number }

const isOfferId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)

/**
 * Files this computer has offered to send straight to other people, remembered so an offer can come back after
 * Maplecord is closed and opened again. Only where the file is and what it looked like (size and date) are kept;
 * the file itself is read where it lies, a piece at a time, when someone asks for it.
 *
 * An offer only comes back for the exact file that was offered. One that has since been edited or replaced is
 * dropped; one that is merely missing (a drive that is not plugged in) is kept in case it returns.
 *
 * The window can only reach files that got here from a file the person picked: it asks by offer, never by path.
 */
export class OfferedFiles {
  static readonly MaxRemembered = 200
  static readonly KeepMs = 30 * 24 * 60 * 60 * 1000
  static readonly MaxRead = 4 * 1024 * 1024

  private file: string
  private entries: Record<string, Remembered> = {}
  private open = new Map<string, { handle: fs.promises.FileHandle; idle: ReturnType<typeof setTimeout> }>()

  constructor(file: string) {
    this.file = file
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Remembered>
      for (const [id, e] of Object.entries(stored)) {
        if (isOfferId(id) && e && typeof e.path === 'string' && typeof e.size === 'number' && typeof e.mtimeMs === 'number' && typeof e.scope === 'string')
          this.entries[id] = { path: e.path, name: String(e.name), size: e.size, mtimeMs: e.mtimeMs, scope: e.scope, at: Number(e.at) || 0 }
      }
    } catch { /* nothing remembered yet, or the list was damaged: start empty */ }
  }

  /** `scope` says whose offer it is (which server, which account), so one account never brings back another's. */
  async remember(offerId: string, filePath: string, scope: string): Promise<boolean> {
    if (!isOfferId(offerId) || !filePath) return false
    let stat: fs.Stats
    try { stat = await fs.promises.stat(filePath) } catch { return false }
    if (!stat.isFile()) return false
    this.entries[offerId] = { path: filePath, name: filePath.split(/[\\/]/).pop() || 'file', size: stat.size, mtimeMs: stat.mtimeMs, scope: String(scope), at: Date.now() }
    const ids = Object.keys(this.entries)
    if (ids.length > OfferedFiles.MaxRemembered) {
      ids.sort((a, b) => this.entries[a].at - this.entries[b].at)
      for (const id of ids.slice(0, ids.length - OfferedFiles.MaxRemembered)) delete this.entries[id]
    }
    this.save()
    return true
  }

  /** The offers of this scope whose file is still there, exactly as it was. */
  async list(scope: string): Promise<OfferedFile[]> {
    const found: OfferedFile[] = []
    let changed = false
    for (const [offerId, e] of Object.entries(this.entries)) {
      if (Date.now() - e.at > OfferedFiles.KeepMs) { delete this.entries[offerId]; changed = true; continue }
      if (e.scope !== scope) continue
      const state = await this.check(e)
      if (state === 'same') found.push({ offerId, name: e.name, size: e.size })
      else if (state === 'changed') { delete this.entries[offerId]; changed = true }
    }
    if (changed) this.save()
    return found
  }

  /** A piece of an offered file. Refused once the file is no longer the one that was offered. */
  async read(offerId: string, offset: number, length: number): Promise<Uint8Array> {
    const e = this.entries[offerId]
    if (!e) throw new Error('That file is no longer on offer.')
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > OfferedFiles.MaxRead || offset + length > e.size)
      throw new Error('That is not part of the file.')
    let entry = this.open.get(offerId)
    if (!entry) {
      if (await this.check(e) !== 'same') throw new Error('The file was moved, changed or deleted.')
      entry = { handle: await fs.promises.open(e.path, 'r'), idle: setTimeout(() => {}, 0) }
      this.open.set(offerId, entry)
    }
    clearTimeout(entry.idle)
    entry.idle = setTimeout(() => this.close(offerId), 30_000)
    const buffer = new Uint8Array(length)
    const { bytesRead } = await entry.handle.read(buffer, 0, length, offset)
    if (bytesRead !== length) { this.close(offerId); throw new Error('The file was moved, changed or deleted.') }
    return buffer
  }

  forget(offerId: string) {
    this.close(offerId)
    if (!this.entries[offerId]) return
    delete this.entries[offerId]
    this.save()
  }

  /** The app is closing: let go of every file. */
  closeAll() { for (const id of [...this.open.keys()]) this.close(id) }

  private close(offerId: string) {
    const entry = this.open.get(offerId)
    if (!entry) return
    this.open.delete(offerId)
    clearTimeout(entry.idle)
    void entry.handle.close().catch(() => { /* already closed */ })
  }

  private async check(e: Remembered): Promise<'same' | 'changed' | 'missing'> {
    try {
      const stat = await fs.promises.stat(e.path)
      return stat.isFile() && stat.size === e.size && stat.mtimeMs === e.mtimeMs ? 'same' : 'changed'
    } catch { return 'missing' }
  }

  private save() {
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.entries))
      fs.renameSync(this.file + '.tmp', this.file)
    } catch { /* remembered for this run only */ }
  }
}
