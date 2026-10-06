import type { IceServerDto, TransferSettingsDto } from './types'

/**
 * Sends a file straight from one app to another over a WebRTC data channel: directly, or through a relay when the
 * sender or receiver keeps their IP address private. The file is never stored on the Maplecord server.
 *
 * Memory stays small whatever the file's size. The sender reads the file a piece at a time and never runs more
 * than a few megabytes ahead of what the receiver has confirmed writing; the receiver writes each piece to its
 * sink (the disk, in the desktop app) as it arrives.
 *
 * On the wire (one ordered, reliable channel): text messages are JSON control messages, binary messages are file
 * data in order.
 *   sender   → {t:'head', name, size}  then the data  then {t:'end'}
 *   receiver → {t:'ack', n} as it writes (n = bytes written so far)  then {t:'done'}
 *   either   → {t:'stop', reason}
 */

export interface FileSource { name: string; size: number; read(offset: number, length: number): Promise<ArrayBuffer> }
export interface FileSink { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }

export const fileSource = (file: File): FileSource => ({ name: file.name, size: file.size, read: (offset, length) => file.slice(offset, offset + length).arrayBuffer() })

/**
 * A file the desktop app remembered offering before it was last closed: read from disk through the main process.
 * A megabyte is fetched at a time and handed out in the smaller pieces the transfer asks for.
 */
export function rememberedSource(offerId: string, name: string, size: number, read: (offerId: string, offset: number, length: number) => Promise<Uint8Array>): FileSource {
  const BLOCK = 1024 * 1024
  let held: Uint8Array | null = null, heldAt = 0
  return {
    name, size,
    read: async (offset, length) => {
      if (!held || offset < heldAt || offset + length > heldAt + held.byteLength) {
        held = await read(offerId, offset, Math.min(Math.max(length, BLOCK), size - offset))
        heldAt = offset
      }
      const from = held.byteOffset + (offset - heldAt)
      return held.buffer.slice(from, from + length) as ArrayBuffer
    },
  }
}

export type TransferState = 'waiting' | 'connecting' | 'transferring' | 'done' | 'failed' | 'cancelled'

export interface TransferView {
  key: string
  offerId: string
  direction: 'send' | 'receive'
  name: string
  size: number
  bytes: number
  state: TransferState
  /** Through a relay (true), straight between the two apps (false), or not connected yet (null). */
  relayed: boolean | null
  bytesPerSecond: number
  error: string | null
}

export interface TransferDeps {
  signal(offerId: string, target: string, kind: 'offer' | 'answer' | 'ice' | 'cancel', payload: string): Promise<void>
  /** Connection details for the transfer of this offer to one requester (named by its connection id). */
  ice(offerId: string, requester: string): Promise<IceServerDto[]>
  /** This app's own connection id, which is how the server knows us as a requester. */
  self(): string | null
  settings(): Promise<TransferSettingsDto>
  /** The person keeps their IP address private: only ever connect through a relay. */
  wantRelay(): boolean
  changed(views: TransferView[]): void
}

const CHUNK = 64 * 1024
/** How far the sender may run ahead of what the receiver has written. */
const WINDOW = 8 * 1024 * 1024
const ACK_EVERY = 1024 * 1024
const CONNECT_TIMEOUT = 30_000
const STALL_TIMEOUT = 30_000

const megabytes = (bytes: number) => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + ' GB' : Math.round(bytes / 1048576) + ' MB'
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

interface Session {
  view: TransferView
  peer: string | null
  /** The connection id of whoever asked for the file: the other side when we send, ourselves when we receive. */
  requester: string | null
  pc: RTCPeerConnection | null
  dc: RTCDataChannel | null
  source: FileSource | null
  sink: FileSink | null
  /** ICE candidates that arrived before the other side's description did. */
  pendingIce: RTCIceCandidateInit[]
  acked: number
  onAck: (() => void) | null
  written: number
  lastAck: number
  /** Receiver: messages are handled one after another, in order. */
  tail: Promise<void>
  timer: ReturnType<typeof setTimeout> | null
  closed: boolean
  speedAt: number
  speedBytes: number
}

export class TransferEngine {
  private deps: TransferDeps
  private offers = new Map<string, FileSource>()
  private sessions = new Map<string, Session>()
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: TransferDeps) { this.deps = deps }

  // ---- Sender ---------------------------------------------------------------------------------------------------

  /** Remember the file behind an offer this app has made. */
  addOffer(offerId: string, source: FileSource) { this.offers.set(offerId, source) }
  hasOffer(offerId: string) { return this.offers.has(offerId) }
  /** Every offer this app still holds the file for, live on the server or not. */
  offerIds() { return [...this.offers.keys()] }

  /** Withdraw an offer: stops anyone still receiving it. */
  removeOffer(offerId: string) {
    this.offers.delete(offerId)
    for (const [key, s] of this.sessions) if (s.view.offerId === offerId && s.view.direction === 'send' && !s.closed) this.finish(key, 'cancelled', 'You withdrew the file.', true)
  }

  /** Signing out: nothing this app was offering is offered any more. */
  dropOffers() { for (const id of [...this.offers.keys()]) this.removeOffer(id) }

  /** Someone asked for one of our files: connect to them and send it. */
  async requested(offerId: string, requester: string) {
    const source = this.offers.get(offerId)
    if (!source) { void this.deps.signal(offerId, requester, 'cancel', 'That file is no longer on offer.').catch(() => {}); return }
    const key = `${offerId}>${requester}`
    if (this.sessions.get(key) && !this.sessions.get(key)!.closed) return
    const s = this.open(key, offerId, 'send', source.name, source.size)
    s.peer = requester
    s.requester = requester
    s.source = source
    try {
      const pc = await this.connect(s)
      const dc = pc.createDataChannel('file', { ordered: true })
      this.attach(s, dc)
      await pc.setLocalDescription(await pc.createOffer())
      await this.deps.signal(offerId, requester, 'offer', JSON.stringify(pc.localDescription))
    } catch (e) { this.finish(key, 'failed', message(e), true) }
  }

  // ---- Receiver -------------------------------------------------------------------------------------------------

  /** Get ready to receive an offered file into `sink`. Call this, then ask the server for the file. */
  receive(offerId: string, name: string, size: number, sink: FileSink) {
    const key = `${offerId}<`
    const old = this.sessions.get(key)
    if (old && !old.closed) this.finish(key, 'cancelled', null, true)
    const s = this.open(key, offerId, 'receive', name, size)
    s.sink = sink
    s.requester = this.deps.self()
    s.view.state = 'waiting'
    s.timer = setTimeout(() => this.finish(key, 'failed', 'The sender did not answer.', true), CONNECT_TIMEOUT)
    this.notify()
  }

  /** Stop a transfer from either end. */
  cancel(key: string) { if (this.sessions.get(key) && !this.sessions.get(key)!.closed) this.finish(key, 'cancelled', null, true) }

  /** Forget finished transfers of one offer (the UI calls this when their message goes away). */
  forget(key: string) { if (this.sessions.get(key)?.closed) { this.sessions.delete(key); this.notify() } }

  views(): TransferView[] { return [...this.sessions.values()].map(s => ({ ...s.view })) }

  // ---- Signalling from the other app -----------------------------------------------------------------------------

  async signal(offerId: string, from: string, kind: string, payload: string) {
    const sending = this.sessions.get(`${offerId}>${from}`)
    const receiving = this.sessions.get(`${offerId}<`)
    const s = sending && !sending.closed ? sending : receiving && !receiving.closed ? receiving : null
    if (!s) return
    try {
      if (kind === 'cancel') { this.finish(s.view.key, s.view.direction === 'receive' ? 'failed' : 'cancelled', payload || 'The other side stopped the transfer.', false); return }
      if (kind === 'offer' && s.view.direction === 'receive') {
        s.peer = from
        if (s.timer) clearTimeout(s.timer)
        const pc = await this.connect(s)
        pc.ondatachannel = e => this.attach(s, e.channel)
        await pc.setRemoteDescription(JSON.parse(payload))
        await this.drainIce(s)
        await pc.setLocalDescription(await pc.createAnswer())
        await this.deps.signal(offerId, from, 'answer', JSON.stringify(pc.localDescription))
      } else if (kind === 'answer' && s.view.direction === 'send' && s.pc) {
        await s.pc.setRemoteDescription(JSON.parse(payload))
        await this.drainIce(s)
      } else if (kind === 'ice') {
        const candidate = JSON.parse(payload) as RTCIceCandidateInit
        if (s.pc?.remoteDescription) await s.pc.addIceCandidate(candidate)
        else s.pendingIce.push(candidate)
      }
    } catch (e) { this.finish(s.view.key, 'failed', message(e), true) }
  }

  // ---- Connection ------------------------------------------------------------------------------------------------

  private open(key: string, offerId: string, direction: 'send' | 'receive', name: string, size: number): Session {
    const s: Session = {
      view: { key, offerId, direction, name, size, bytes: 0, state: 'connecting', relayed: null, bytesPerSecond: 0, error: null },
      peer: null, requester: null, pc: null, dc: null, source: null, sink: null, pendingIce: [], acked: 0, onAck: null, written: 0, lastAck: 0,
      tail: Promise.resolve(), timer: null, closed: false, speedAt: performance.now(), speedBytes: 0,
    }
    this.sessions.set(key, s)
    this.notify()
    return s
  }

  private async connect(s: Session): Promise<RTCPeerConnection> {
    const ice = await this.deps.ice(s.view.offerId, s.requester ?? '')
    const hasRelay = ice.some(server => server.urls.some(u => /^turns?:/i.test(u)))
    // The server decides, for this pair, whether the transfer may be P2P, and says so by what it hands out: only a
    // pair that may is given the means to find each other. Anything else goes through the relay and no other way,
    // whatever this account allows in general: allowing P2P with friends is not allowing it with everyone.
    const mayBeDirect = ice.some(server => server.urls.some(u => /^stuns?:/i.test(u)))
    const relayOnly = this.deps.wantRelay() || !mayBeDirect
    // Never fall back to a direct connection behind the person's back: that would show their IP address to the other side.
    if (relayOnly && !hasRelay) throw new Error('No relay is available right now, so the file cannot be sent. It will not fall back to a direct connection.')
    const pc = new RTCPeerConnection({
      iceServers: ice.map(server => ({ urls: server.urls, username: server.username ?? undefined, credential: server.credential ?? undefined })),
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
    })
    s.pc = pc
    s.view.state = 'connecting'
    pc.onicecandidate = e => { if (e.candidate && s.peer) void this.deps.signal(s.view.offerId, s.peer, 'ice', JSON.stringify(e.candidate.toJSON())).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      if (s.closed) return
      if (pc.connectionState === 'failed') this.finish(s.view.key, 'failed', 'Could not connect to the other person.', true)
      // 'disconnected' can recover; a transfer that really is dead is caught by the stall timer.
    }
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => { if (!s.closed && s.view.state === 'connecting') this.finish(s.view.key, 'failed', 'Could not connect to the other person.', true) }, CONNECT_TIMEOUT)
    this.notify()
    return pc
  }

  private async drainIce(s: Session) {
    const waiting = s.pendingIce.splice(0)
    for (const candidate of waiting) await s.pc!.addIceCandidate(candidate)
  }

  private attach(s: Session, dc: RTCDataChannel) {
    s.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = 512 * 1024
    dc.onclose = () => { if (!s.closed) this.finish(s.view.key, 'failed', 'The connection closed before the file finished.', false) }
    if (s.view.direction === 'send') {
      dc.onopen = () => { void this.send(s).catch(e => this.finish(s.view.key, 'failed', message(e), true)) }
      dc.onmessage = e => { if (typeof e.data === 'string') this.senderControl(s, e.data) }
    } else {
      dc.onmessage = e => {
        s.tail = s.tail.then(() => this.receiveOne(s, e.data)).catch(err => this.finish(s.view.key, 'failed', message(err), true))
      }
    }
  }


  // ---- Sending ---------------------------------------------------------------------------------------------------

  private async send(s: Session) {
    const dc = s.dc!, source = s.source!
    const [relayed, limits] = await Promise.all([isRelayed(s.pc!), this.deps.settings()])
    s.view.relayed = relayed
    const cap = relayed ? limits.maxRelayedBytes : limits.maxDirectBytes
    if (cap > 0 && source.size > cap) {
      throw new Error(`${source.name} is ${megabytes(source.size)}; the most that can be sent ${relayed ? 'here' : 'over P2P here'} is ${megabytes(cap)}.` + (relayed && (limits.maxDirectBytes === 0 || limits.maxDirectBytes >= source.size) ? ' Friends who both allow P2P can send larger files to each other.' : ''))
    }
    // Relayed transfers share the relay with everyone's voice, so they are paced.
    const bytesPerSecond = relayed && limits.relayedKbps > 0 ? limits.relayedKbps * 1000 / 8 : 0

    if (s.timer) clearTimeout(s.timer)
    s.view.state = 'transferring'
    dc.send(JSON.stringify({ t: 'head', name: source.name, size: source.size }))
    const started = performance.now()
    let offset = 0
    while (offset < source.size) {
      if (s.closed) return
      if (offset - s.acked > WINDOW) { await this.waitFor(s, resolve => { s.onAck = resolve }, 'The other side stopped receiving.'); continue }
      if (dc.bufferedAmount > 1024 * 1024) { await this.waitFor(s, resolve => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; resolve() } }, 'The connection stalled.'); continue }
      const piece = await source.read(offset, Math.min(CHUNK, source.size - offset))
      if (s.closed) return
      if (piece.byteLength === 0) throw new Error('The file could not be read. Was it moved or deleted?')
      dc.send(piece)
      offset += piece.byteLength
      this.progress(s, offset)
      if (bytesPerSecond > 0) {
        const ahead = started + offset / bytesPerSecond * 1000 - performance.now()
        if (ahead > 5) await sleep(ahead)
      }
    }
    dc.send(JSON.stringify({ t: 'end' }))
    // Finished only when the receiver says every byte is written.
    s.timer = setTimeout(() => this.finish(s.view.key, 'failed', 'The other side did not confirm the file.', true), STALL_TIMEOUT * 2)
  }

  /** Waits for `arm`'s callback, giving up if the transfer closes or nothing happens for a long while. */
  private waitFor(s: Session, arm: (resolve: () => void) => void, stalled: string) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(stalled)), STALL_TIMEOUT)
      const poll = setInterval(() => { if (s.closed) { clearTimeout(timer); clearInterval(poll); resolve() } }, 250)
      arm(() => { clearTimeout(timer); clearInterval(poll); resolve() })
    })
  }

  private senderControl(s: Session, text: string) {
    let m: { t?: string; n?: number; reason?: string }
    try { m = JSON.parse(text) } catch { return }
    if (m.t === 'ack' && typeof m.n === 'number') {
      s.acked = Math.max(s.acked, m.n)
      const wake = s.onAck; s.onAck = null; wake?.()
    } else if (m.t === 'done') this.finish(s.view.key, 'done', null, false)
    else if (m.t === 'stop') this.finish(s.view.key, 'failed', m.reason || 'The other side stopped the transfer.', false)
  }

  // ---- Receiving -------------------------------------------------------------------------------------------------

  private async receiveOne(s: Session, data: string | ArrayBuffer) {
    if (s.closed) return
    if (typeof data === 'string') {
      const m = JSON.parse(data) as { t?: string; name?: string; size?: number; reason?: string }
      if (m.t === 'head') {
        if (typeof m.size !== 'number' || m.size !== s.view.size) throw new Error('The file is not the size that was offered.')
        if (s.timer) clearTimeout(s.timer)
        s.view.relayed = await isRelayed(s.pc!)
        s.view.state = 'transferring'
        this.notify()
      } else if (m.t === 'end') {
        if (s.written !== s.view.size) throw new Error('The file arrived incomplete.')
        await s.sink!.close()
        s.sink = null
        s.dc?.send(JSON.stringify({ t: 'ack', n: s.written }))
        s.dc?.send(JSON.stringify({ t: 'done' }))
        this.finish(s.view.key, 'done', null, false)
      } else if (m.t === 'stop') this.finish(s.view.key, 'failed', m.reason || 'The sender stopped the transfer.', false)
      return
    }
    if (s.view.state !== 'transferring') throw new Error('The sender sent data before saying what it was.')
    if (s.written + data.byteLength > s.view.size) throw new Error('The sender sent more than the file that was offered.')
    await s.sink!.write(new Uint8Array(data))
    s.written += data.byteLength
    this.progress(s, s.written)
    if (s.written - s.lastAck >= ACK_EVERY) { s.lastAck = s.written; s.dc?.send(JSON.stringify({ t: 'ack', n: s.written })) }
  }

  // ---- Shared ----------------------------------------------------------------------------------------------------

  private progress(s: Session, bytes: number) {
    s.view.bytes = bytes
    const now = performance.now()
    if (now - s.speedAt >= 1000) {
      s.view.bytesPerSecond = (bytes - s.speedBytes) / (now - s.speedAt) * 1000
      s.speedAt = now
      s.speedBytes = bytes
    }
    this.notify()
  }

  private finish(key: string, state: 'done' | 'failed' | 'cancelled', error: string | null, tellPeer: boolean) {
    const s = this.sessions.get(key)
    if (!s || s.closed) return
    s.closed = true
    if (s.timer) clearTimeout(s.timer)
    s.view.state = state
    s.view.error = state === 'done' ? null : error
    s.view.bytesPerSecond = 0
    if (state === 'done') s.view.bytes = s.view.size
    if (tellPeer) {
      const reason = state === 'cancelled' ? 'The other side cancelled.' : error ?? ''
      try { if (s.dc?.readyState === 'open') s.dc.send(JSON.stringify({ t: 'stop', reason })) } catch { /* closing anyway */ }
      if (s.peer) void this.deps.signal(s.view.offerId, s.peer, 'cancel', reason).catch(() => {})
    }
    const wake = s.onAck; s.onAck = null; wake?.()
    // A file that did not finish is not left half-written.
    if (s.sink) { void s.sink.abort().catch(() => {}); s.sink = null }
    // Give the last control message a moment to leave before the channel goes.
    setTimeout(() => { try { s.dc?.close() } catch { /* already closed */ } try { s.pc?.close() } catch { /* already closed */ } }, state === 'done' ? 500 : 150)
    this.notify(true)
  }

  private notify(now = false) {
    if (now) { if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null } this.deps.changed(this.views()); return }
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => { this.notifyTimer = null; this.deps.changed(this.views()) }, 200)
  }
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Whether the connection that was actually established goes through a relay at either end. */
export async function isRelayed(pc: RTCPeerConnection): Promise<boolean> {
  const stats = await pc.getStats()
  let pairId: string | undefined
  stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId })
  let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined
  stats.forEach(r => { if (r.type === 'candidate-pair' && (pairId ? r.id === pairId : r.nominated && r.state === 'succeeded')) pair = r })
  if (!pair) return false
  let relayed = false
  stats.forEach(r => { if ((r.id === pair!.localCandidateId || r.id === pair!.remoteCandidateId) && r.candidateType === 'relay') relayed = true })
  return relayed
}

// ---- Where a received file goes ------------------------------------------------------------------------------------

/** The most a browser without a way to write straight to disk will hold in memory before saving. */
export const MEMORY_SINK_LIMIT = 512 * 1024 * 1024

interface DesktopSave {
  saveBegin(name: string): Promise<string | null>
  saveWrite(id: string, data: Uint8Array): Promise<void>
  saveEnd(id: string): Promise<void>
  saveAbort(id: string): Promise<void>
}

/**
 * Asks where to save the file and returns somewhere to write it; null if the person cancelled the dialog.
 * The desktop app and Chromium browsers write to disk as the file arrives. Other browsers have to hold it in
 * memory first, so there it is limited in size.
 */
export async function openSink(name: string, size: number, desktop: DesktopSave | undefined): Promise<FileSink | null> {
  if (desktop) {
    const id = await desktop.saveBegin(name)
    if (!id) return null
    // Pieces are gathered into about a megabyte before each trip to the main process.
    let parts: Uint8Array[] = [], held = 0
    const flush = async () => {
      if (held === 0) return
      const all = new Uint8Array(held)
      let at = 0
      for (const p of parts) { all.set(p, at); at += p.byteLength }
      parts = []; held = 0
      await desktop.saveWrite(id, all)
    }
    return {
      write: async chunk => { parts.push(chunk); held += chunk.byteLength; if (held >= 1024 * 1024) await flush() },
      close: async () => { await flush(); await desktop.saveEnd(id) },
      abort: async () => { parts = []; held = 0; await desktop.saveAbort(id) },
    }
  }

  const picker = (window as unknown as { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }> }).showSaveFilePicker
  if (picker) {
    let handle
    try { handle = await picker({ suggestedName: name }) }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return null; throw e }
    const out = await handle.createWritable()
    return { write: chunk => out.write(chunk), close: () => out.close(), abort: () => out.abort() }
  }

  if (size > MEMORY_SINK_LIMIT) throw new Error(`This browser can only receive files up to ${megabytes(MEMORY_SINK_LIMIT)} this way. Use the desktop app for larger ones.`)
  const kept: Uint8Array[] = []
  return {
    write: async chunk => { kept.push(chunk) },
    close: async () => {
      const url = URL.createObjectURL(new Blob(kept as BlobPart[]))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    abort: async () => { kept.length = 0 },
  }
}
