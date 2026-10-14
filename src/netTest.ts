// The connection test: how far away each of the server's relays is, and how fast this line is to one of them.
//
// Everything goes to the Maplecord server's own relays and nowhere else. A ping is an empty answer from a relay's
// test service, which it gives anyone. The speed test needs a pass, which the Maplecord server hands out one every
// few minutes for each account, for the least used of the relays near us: download first (meaningless bytes sent to
// us for a few seconds), then upload (meaningless bytes sent from here and thrown away there).
//
// What it measures is the line between this computer and the relay. A stream in a P2P channel goes to each viewer
// by a path of its own, so the "about so many viewers" it ends with is a good estimate and not a promise.

import type { StreamSettingsDto } from './types'

/** One reading while a half of the test runs: milliseconds since it began, and bytes moved so far. */
export interface Sample { ms: number; bytes: number }

/** Megabits a second for bytes moved in a time. */
export const mbps = (bytes: number, ms: number) => (ms > 0 ? bytes * 8 / 1000 / ms : 0)

/**
 * The speed a run of readings shows once it had got going: a connection takes a moment to reach its speed, so the
 * first quarter of the time is left out. With too little to go on, the whole run is used.
 */
export function steadyMbps(samples: Sample[]): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]!
  const from = samples.find(s => s.ms >= last.ms * 0.25) ?? samples[0]!
  if (last.ms - from.ms < 500) return mbps(last.bytes - samples[0]!.bytes, last.ms - samples[0]!.ms)
  return mbps(last.bytes - from.bytes, last.ms - from.ms)
}

/** The part of an upload that is counted on for video: the rest is left for voice, a game and everything else. */
export const UPLOAD_SHARE = 0.8

/** How many viewers an upload carries when each is sent a copy at so many kilobits a second. */
export const viewersAt = (uploadMbps: number, kbpsEach: number) => (kbpsEach > 0 ? Math.max(0, Math.floor(uploadMbps * UPLOAD_SHARE * 1000 / kbpsEach)) : 0)

/** What one viewer of a quality is sent on this server, in kilobits a second: the rate its owner set, or the usual one. */
export function rateFor(rules: StreamSettingsDto | null, height: number, fps: number, usual: number): number {
  return rules?.rates?.find(r => r.height === height && r.fps === fps)?.kbps ?? usual
}

/** Whether a measured speed ran into the most the relay lets a test go, so the line may be faster than it shows. */
export const atTheCap = (measured: number, capMbps: number | null) => capMbps !== null && capMbps > 0 && measured >= capMbps * 0.93

/** How a connection is described, by its download speed, and the speeds that description covers. */
export interface Rating { label: 'Great' | 'Above average' | 'Average' | 'Below average' | 'Poor'; range: string }

/** The description for a download speed. `overMbps` = the test could go no faster than that, so the line is taken as faster than it. */
export function rating(downMbps: number, overMbps: number | null = null): Rating {
  const n = overMbps !== null ? Math.round(overMbps) + 1 : Math.round(downMbps)
  if (n > 200) return { label: 'Great', range: 'over 200 Mbps' }
  if (n > 150) return { label: 'Above average', range: '151 to 200 Mbps' }
  if (n > 50) return { label: 'Average', range: '51 to 150 Mbps' }
  if (n > 10) return { label: 'Below average', range: '11 to 50 Mbps' }
  return { label: 'Poor', range: '10 Mbps or less' }
}

/** A measured speed in words: "38 Mbps", or "over 200 Mbps" when the test could go no faster than that. */
export const speedInWords = (measured: number, capMbps: number | null) => (atTheCap(measured, capMbps) ? `over ${Math.round(capMbps!)} Mbps` : `${showMbps(measured)} Mbps`)

/** A speed for showing: one decimal under 10, none above. */
export const showMbps = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)))

/** "2 min 10 s", "45 s". */
export const showWait = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.max(0, seconds)} s`)

// ---- The measuring itself -------------------------------------------------------------------------------------

/** How long a relay's test service takes to answer, in milliseconds: the quickest of a few tries, after one that only opens the connection. Null if it does not answer. */
export async function pingRelay(url: string, signal?: AbortSignal): Promise<number | null> {
  let best: number | null = null
  for (let i = 0; i < 5; i++) {
    const began = performance.now()
    try {
      const reply = await fetch(`${url}/ping`, { cache: 'no-store', signal })
      if (!reply.ok) return null
    } catch { return null }
    const took = performance.now() - began
    if (i > 0) best = best === null ? took : Math.min(best, took)
  }
  return best
}

/** How many connections a test uses at once over plain HTTP (a relay from before WebSockets). */
const CONNECTIONS = 3
/**
 * How many WebSockets a test uses at once. Each is a connection of its own (requests over HTTPS share one when the
 * relay's proxy speaks HTTP/2), and one alone does not fill a fast line to a relay far away. The relay holds the
 * whole test to its limit however many there are.
 */
const SOCKETS = 4
const READ_EVERY_MS = 200

export interface HalfResult { mbps: number; capMbps: number | null; seconds: number | null }

/** The relay does not take the test over WebSockets (one from before them): the plain HTTP way is used instead. */
class NoSockets extends Error {}

/** What the relay says on one of a test's WebSockets. */
interface Said { error?: string; maxMbps?: number; seconds?: number; got?: number; bytes?: number }

/**
 * One WebSocket of a test: it opens, hands over the pass, and reports what the relay says and sends until it closes.
 * `started` is told once the pass is taken, with the socket. Resolves with the relay's refusal, if it refused, or null;
 * rejects with NoSockets if the relay never answered on it (it takes no WebSockets).
 */
function testSocket(address: string, pass: string, signal: AbortSignal, on: { started: (said: Said, ws: WebSocket) => void; bytes?: (n: number) => void; said?: (said: Said) => void }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let heard = false, refused: string | null = null
    const ws = new WebSocket(address)
    ws.binaryType = 'arraybuffer'
    const stop = () => ws.close()
    signal.addEventListener('abort', stop)
    ws.onopen = () => ws.send(pass)
    ws.onmessage = e => {
      if (typeof e.data !== 'string') { on.bytes?.((e.data as ArrayBuffer).byteLength); return }
      let said: Said
      try { said = JSON.parse(e.data) as Said } catch { return }
      if (!heard) { heard = true; if (said.error) refused = said.error; else on.started(said, ws); return }
      on.said?.(said)
    }
    ws.onclose = () => {
      signal.removeEventListener('abort', stop)
      if (!heard && !signal.aborted) reject(new NoSockets()); else resolve(refused)
    }
  })
}

/** Where a half of the test is, as a WebSocket address. */
const socketAddress = (url: string, half: 'down' | 'up') => url.replace(/^http/i, 'ws') + '/' + half

/** The download half: bytes are sent to us for as long as the relay's test lasts. `live` is told the speed as it goes. */
export async function measureDown(url: string, pass: string, live: (mbps: number) => void, signal: AbortSignal): Promise<HalfResult> {
  let bytes = 0, capMbps: number | null = null, seconds: number | null = null
  const began = performance.now()
  const samples: Sample[] = [{ ms: 0, bytes: 0 }]
  const note = window.setInterval(() => { samples.push({ ms: performance.now() - began, bytes }); live(steadyMbps(samples)) }, READ_EVERY_MS)
  let results: PromiseSettledResult<string | null>[]
  try {
    results = await Promise.allSettled(Array.from({ length: SOCKETS }, () => testSocket(socketAddress(url, 'down'), pass, signal, {
      started: said => { capMbps = said.maxMbps ?? capMbps; seconds = said.seconds ?? seconds },
      bytes: n => { bytes += n },
    })))
  } finally { window.clearInterval(note) }
  if (results.every(r => r.status === 'rejected')) return measureDownHttp(url, pass, live, signal)
  const refused = results.map(r => (r.status === 'fulfilled' ? r.value : null)).find(r => r !== null)
  if (refused && bytes === 0) throw new Error(refused)
  samples.push({ ms: performance.now() - began, bytes })
  return { mbps: steadyMbps(samples), capMbps, seconds }
}

/**
 * The upload half: meaningless bytes are sent from here on each WebSocket for as long as the relay's test lasts. What
 * counts is what the relay says arrived, not what left here (much can wait in this computer's buffers).
 */
export async function measureUp(url: string, pass: string, seconds: number, live: (mbps: number) => void, signal: AbortSignal): Promise<HalfResult> {
  const piece = new Uint8Array(64 << 10)
  crypto.getRandomValues(piece)
  const began = performance.now()
  const got = new Array<number>(SOCKETS).fill(0)
  const moved = () => got.reduce((a, b) => a + b, 0)
  let capMbps: number | null = null, lasts = seconds
  const samples: Sample[] = [{ ms: 0, bytes: 0 }]
  const note = window.setInterval(() => { samples.push({ ms: performance.now() - began, bytes: moved() }); live(steadyMbps(samples)) }, READ_EVERY_MS)
  let results: PromiseSettledResult<string | null>[]
  try {
    results = await Promise.allSettled(Array.from({ length: SOCKETS }, (_, slot) => testSocket(socketAddress(url, 'up'), pass, signal, {
      started: (said, ws) => {
        capMbps = said.maxMbps ?? capMbps
        lasts = said.seconds ?? lasts
        // Kept a little ahead of what the connection takes, never far: the relay holds the pace.
        const send = () => {
          if (ws.readyState !== WebSocket.OPEN) return
          while (ws.bufferedAmount < (1 << 20)) ws.send(piece)
          window.setTimeout(send, 10)
        }
        send()
      },
      said: said => { got[slot] = said.bytes ?? said.got ?? got[slot]! },
    })))
  } finally { window.clearInterval(note) }
  if (results.every(r => r.status === 'rejected')) return measureUpHttp(url, pass, seconds, live, signal)
  const refused = results.map(r => (r.status === 'fulfilled' ? r.value : null)).find(r => r !== null)
  if (refused && moved() === 0) throw new Error(refused)
  samples.push({ ms: Math.min(performance.now() - began, lasts * 1000 + 500), bytes: moved() })
  return { mbps: steadyMbps(samples), capMbps, seconds: lasts }
}

// ---- The same over plain HTTP, against a relay from before WebSockets ----------------------------------------------

async function measureDownHttp(url: string, pass: string, live: (mbps: number) => void, signal: AbortSignal): Promise<HalfResult> {
  let bytes = 0, capMbps: number | null = null, seconds: number | null = null
  const began = performance.now()
  const samples: Sample[] = [{ ms: 0, bytes: 0 }]
  const note = window.setInterval(() => { samples.push({ ms: performance.now() - began, bytes }); live(steadyMbps(samples)) }, READ_EVERY_MS)
  try {
    const refusals = await Promise.all(Array.from({ length: CONNECTIONS }, async () => {
      const reply = await fetch(`${url}/down`, { headers: { Authorization: `Bearer ${pass}` }, cache: 'no-store', signal })
      if (!reply.ok || !reply.body) return ((await reply.json().catch(() => null)) as { error?: string } | null)?.error ?? 'The relay refused the test.'
      capMbps = Number(reply.headers.get('X-Test-Max-Mbps')) || capMbps
      seconds = Number(reply.headers.get('X-Test-Seconds')) || seconds
      const reader = reply.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return null
        bytes += value.byteLength
      }
    }))
    const refused = refusals.find(r => r !== null)
    if (refused && bytes === 0) throw new Error(refused)
  } finally { window.clearInterval(note) }
  samples.push({ ms: performance.now() - began, bytes })
  return { mbps: steadyMbps(samples), capMbps, seconds }
}

/**
 * The upload half: meaningless bytes are sent from here, one piece after another on each connection, for `seconds`.
 * The pieces grow while they go through quickly, so a slow line is not handed more than it can send in the time.
 */
async function measureUpHttp(url: string, pass: string, seconds: number, live: (mbps: number) => void, signal: AbortSignal): Promise<HalfResult> {
  const filler = new Uint8Array(8 << 20)
  for (let at = 0; at < filler.length; at += 65536) crypto.getRandomValues(filler.subarray(at, at + 65536))
  const began = performance.now()
  const until = began + seconds * 1000
  // Bytes of pieces that arrived whole, and how far each piece on its way has got.
  let whole = 0
  const under = new Array<number>(CONNECTIONS).fill(0)
  let capMbps: number | null = null, refused: string | null = null
  const moved = () => whole + under.reduce((a, b) => a + b, 0)
  const samples: Sample[] = [{ ms: 0, bytes: 0 }]
  const note = window.setInterval(() => { samples.push({ ms: performance.now() - began, bytes: moved() }); live(steadyMbps(samples)) }, READ_EVERY_MS)

  const piece = (slot: number, size: number) => new Promise<boolean>(resolve => {
    const xhr = new XMLHttpRequest()
    const stop = () => xhr.abort()
    const over = window.setTimeout(stop, Math.max(0, until - performance.now()))
    signal.addEventListener('abort', stop)
    const end = (ok: boolean) => { window.clearTimeout(over); signal.removeEventListener('abort', stop); resolve(ok) }
    xhr.open('POST', `${url}/up`)
    xhr.setRequestHeader('Authorization', `Bearer ${pass}`)
    xhr.upload.onprogress = e => { under[slot] = e.loaded }
    xhr.onload = () => {
      capMbps = Number(xhr.getResponseHeader('X-Test-Max-Mbps')) || capMbps
      if (xhr.status === 200) { whole += size; under[slot] = 0; end(true); return }
      try { refused = (JSON.parse(xhr.responseText) as { error?: string }).error ?? refused } catch { /* no reason given */ }
      under[slot] = 0
      end(false)
    }
    // Cut off (the time is up, or the pop-up was closed): what had gone by then still counts, and is left in `under`.
    xhr.onerror = () => end(false)
    xhr.onabort = () => end(false)
    xhr.send(filler.subarray(0, size))
  })

  try {
    await Promise.all(Array.from({ length: CONNECTIONS }, async (_, slot) => {
      let size = 256 << 10
      while (performance.now() < until && !signal.aborted) {
        const started = performance.now()
        if (!(await piece(slot, size))) return
        if (performance.now() - started < 300 && size < filler.length) size = Math.min(filler.length, size * 2)
      }
    }))
  } finally { window.clearInterval(note) }
  if (refused && moved() === 0) throw new Error(refused)
  samples.push({ ms: Math.min(performance.now() - began, seconds * 1000 + 500), bytes: moved() })
  return { mbps: steadyMbps(samples), capMbps, seconds }
}
