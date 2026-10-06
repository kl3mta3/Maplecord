import fs from 'node:fs'

/**
 * Files being received from another person, written to disk as they arrive so a large one never has to fit in
 * memory. Each is written beside its final name as "<name>.part" and renamed when complete; one that is
 * abandoned is deleted, so a half-received file is never mistaken for a whole one.
 */
export class SaveStreams {
  private open = new Map<string, { stream: fs.WriteStream; part: string; final: string; failed: Error | null }>()
  private next = 1

  begin(finalPath: string): string {
    const id = String(this.next++)
    const part = finalPath + '.part'
    const stream = fs.createWriteStream(part)
    const entry = { stream, part, final: finalPath, failed: null as Error | null }
    // Remembered rather than thrown: the next write or the end reports it to whoever is sending data.
    stream.on('error', err => { entry.failed = err })
    this.open.set(id, entry)
    return id
  }

  /** Resolves once the data is handed to the disk, waiting when the disk is slower than the network. */
  write(id: string, data: Uint8Array): Promise<void> {
    const entry = this.open.get(id)
    if (!entry) return Promise.reject(new Error('That download is not open.'))
    if (entry.failed) return Promise.reject(entry.failed)
    return new Promise((resolve, reject) => {
      const flushed = entry.stream.write(data, err => { if (err) reject(err) })
      if (flushed) resolve()
      else entry.stream.once('drain', () => resolve())
    })
  }

  async end(id: string): Promise<string> {
    const entry = this.open.get(id)
    if (!entry) throw new Error('That download is not open.')
    this.open.delete(id)
    await new Promise<void>((resolve, reject) => entry.stream.end((err?: Error | null) => (err ? reject(err) : resolve())))
    if (entry.failed) { await fs.promises.rm(entry.part, { force: true }); throw entry.failed }
    await fs.promises.rm(entry.final, { force: true })
    await fs.promises.rename(entry.part, entry.final)
    return entry.final
  }

  async abort(id: string) {
    const entry = this.open.get(id)
    if (!entry) return
    this.open.delete(id)
    await new Promise<void>(resolve => { entry.stream.once('close', () => resolve()); entry.stream.destroy() })
    await fs.promises.rm(entry.part, { force: true })
  }

  /** The app is closing: nothing half-written is left behind. */
  async abortAll() { for (const id of [...this.open.keys()]) await this.abort(id) }
}
