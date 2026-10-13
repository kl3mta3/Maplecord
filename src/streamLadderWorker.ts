// The copying for a shared P2P stream (see streamLadder.ts), kept off the app's own thread so that a busy screen
// never holds a frame up.
//
// It is handed two kinds of thing by stream.ts, each as the encoded frames coming out of an encoder and the way to
// put frames onto that encoder's connection:
//   a level  - an encoder for one quality. Its frames go where they were going (to an end inside this app that only
//              exists to keep the encoder running), and a copy of each goes to every viewer on that level.
//   a viewer - the connection to one viewer. While the viewer is "on its own" the frames of its own encoder go
//              through untouched, as if none of this were here. While it is on a level, its own encoder is kept
//              nearly idle by stream.ts and what it makes is dropped; the level's frames are sent in its place.
// What is written to a viewer's connection normally goes at once. If a connection stops taking frames, no more than
// a few are left waiting for it: the rest are dropped, and it is started again on the next keyframe, since the
// frames in between were built on ones it never got.
//
// A viewer only ever changes to something on a keyframe of it, and the frames it is sent are numbered and timed so
// that they follow on from the ones before, whichever encoder made them: to the viewer's app it is one stream.

type Frame = RTCEncodedVideoFrame
/** What a frame says about itself that matters here. */
interface Meta { frameId?: number; dependencies?: number[]; rtpTimestamp?: number; temporalIndex?: number }
const Copy = RTCEncodedVideoFrame as unknown as { new (frame: Frame, options?: { metadata: Record<string, unknown> }): Frame }

const OWN = 'own'
/** A keyframe is asked for again at most this often. */
const ASK_EVERY_MS = 400

interface Viewer {
  writer: WritableStreamDefaultWriter<Frame>; reader: ReadableStreamDefaultReader<Frame>
  /** What it is being sent: "own", or a level's id. */
  on: string
  /** What it is to change to at that one's next keyframe. */
  next: string | null
  /** On a level: sent every other frame only. */
  half: boolean
  /** Added to the numbers and times of the frames it is being sent, so that they follow on from what came before. */
  shift: { id: number; ts: number }
  last: { id: number; ts: number; at: number } | null
  /** Frames handed to its connection that have not gone yet. */
  waiting: number
  /** Frames were dropped: nothing more is sent until a keyframe of what it is on. */
  broken: boolean
}
interface Level {
  writer: WritableStreamDefaultWriter<Frame>; reader: ReadableStreamDefaultReader<Frame>
  waiting: number
  /** Counted over a run of frames: how many there were, and how many of them nothing else is built on. */
  seen: number; upper: number
  /** What stream.ts was last told about this level's layering. */
  layered: boolean | null
}

/** The most frames left waiting for one connection: about half a second of a 60-a-second stream. */
const MOST_WAITING = 30
/** A level's layering is judged over this many frames at first, and looked at again every so many after. */
const JUDGE_AFTER = 45
const JUDGE_AGAIN = 300

export type ToWorker =
  | { t: 'level'; id: string; readable: ReadableStream<Frame>; writable: WritableStream<Frame> }
  | { t: 'viewer'; id: string; readable: ReadableStream<Frame>; writable: WritableStream<Frame> }
  /** Something that only has to pass through (a viewer's sound). */
  | { t: 'pipe'; readable: ReadableStream<unknown>; writable: WritableStream<unknown> }
  /** What a viewer is to be sent from now on: a level's id, or null for its own encoder. */
  | { t: 'set'; viewer: string; source: string | null; half: boolean }
  | { t: 'dropViewer'; id: string }
  | { t: 'dropLevel'; id: string }
export type FromWorker =
  /** A level's encoder is asked for a keyframe: a viewer is waiting to start on it, or asked for one. */
  | { t: 'key'; level: string }
  /** The same of a viewer's own encoder. */
  | { t: 'ownKey'; viewer: string }
  /** A viewer is now being sent this (a level's id, or "own"). */
  | { t: 'on'; viewer: string; source: string }
  /** The frames here cannot be renumbered, so they cannot be shared. */
  | { t: 'unsupported' }
  /** Whether a level's encoder really makes every other frame one that can be left out. Only then can it be sent at half its frames a second. */
  | { t: 'layers'; level: string; layered: boolean }

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage(message: FromWorker): void }
const viewers = new Map<string, Viewer>()
const levels = new Map<string, Level>()
const asked = new Map<string, number>()
let unsupported = false

const WRAP = 2 ** 32
const wrapped = (n: number) => ((n % WRAP) + WRAP) % WRAP

function askKey(target: string, message: FromWorker) {
  const now = performance.now()
  if (now - (asked.get(target) ?? -ASK_EVERY_MS) < ASK_EVERY_MS) return
  asked.set(target, now)
  scope.postMessage(message)
}
const askFor = (source: string, viewer: string) => (source === OWN ? askKey('own:' + viewer, { t: 'ownKey', viewer }) : askKey(source, { t: 'key', level: source }))

/** From this keyframe on the viewer is sent this source, numbered and timed to follow what it was sent last. */
function changeTo(id: string, v: Viewer, source: string, md: Meta) {
  const now = performance.now()
  v.shift = v.last
    ? { id: v.last.id + 1 - (md.frameId ?? 0), ts: wrapped(v.last.ts + Math.max(1, Math.round((now - v.last.at) * 90)) - (md.rtpTimestamp ?? 0)) }
    : { id: 0, ts: 0 }
  v.on = source
  v.next = null
  scope.postMessage({ t: 'on', viewer: id, source })
}

/**
 * Puts a frame onto a viewer's connection. `theirs` = it is the frame their own encoder made, which can go as it is.
 * Returns false when the frame was not sent because the viewer has to start again on a keyframe: whoever called
 * asks the encoder for one.
 */
function send(v: Viewer, frame: Frame, md: Meta, theirs: boolean, key: boolean): boolean {
  if (v.waiting >= MOST_WAITING) v.broken = true
  if (v.broken) {
    // Started again only on a keyframe, and only once most of what was waiting has gone.
    if (!key || v.waiting > MOST_WAITING / 2) return false
    v.broken = false
  }
  const id = (md.frameId ?? 0) + v.shift.id, ts = wrapped((md.rtpTimestamp ?? 0) + v.shift.ts)
  const asItIs = v.shift.id === 0 && v.shift.ts === 0
  try {
    const out = asItIs ? (theirs ? frame : new Copy(frame))
      : new Copy(frame, { metadata: { ...md, frameId: id, dependencies: (md.dependencies ?? []).map(d => d + v.shift.id), rtpTimestamp: ts } })
    v.waiting++
    v.writer.write(out).then(() => { v.waiting-- }, () => { v.waiting-- /* that viewer's connection has closed */ })
    v.last = { id, ts, at: performance.now() }
    return true
  } catch {
    // A frame that could not be copied leaves a hole the following frames are built over: a fresh start is needed.
    v.broken = true
    return false
  }
}

/** Counts a level's frames and tells stream.ts whether every other one can be left out, when that is first known or changes. */
function judgeLayers(id: string, level: Level, md: Meta) {
  level.seen++
  if ((md.temporalIndex ?? 0) > 0) level.upper++
  if (level.seen < (level.layered === null ? JUDGE_AFTER : JUDGE_AGAIN)) return
  // With two layers about half the frames are in the upper one; a fifth is taken as enough to be sure.
  const layered = level.upper >= level.seen / 5
  level.seen = 0
  level.upper = 0
  if (layered === level.layered) return
  level.layered = layered
  scope.postMessage({ t: 'layers', level: id, layered })
}

/** Whether a frame can be renumbered at all. Where it cannot, nothing is shared and stream.ts is told so, once. */
function usable(md: Meta) {
  if (md.frameId !== undefined && md.rtpTimestamp !== undefined) return true
  if (!unsupported) { unsupported = true; scope.postMessage({ t: 'unsupported' }) }
  return false
}

async function runLevel(id: string, level: Level) {
  for (;;) {
    const { value: frame, done } = await level.reader.read().catch(() => ({ value: undefined, done: true as const }))
    if (done || !frame) return
    const md = frame.getMetadata() as Meta
    const key = frame.type === 'key'
    if (usable(md)) {
      judgeLayers(id, level, md)
      for (const [viewerId, v] of viewers) {
        if (v.next === id) { if (key) changeTo(viewerId, v, id, md); else askFor(id, viewerId) }
        if (v.on !== id) continue
        // The frames that can be left out are the ones nothing else is built on.
        if (v.half && (md.temporalIndex ?? 0) > 0) continue
        if (!send(v, frame, md, false, key)) askFor(id, viewerId)
      }
    }
    // Last, because a frame that has been written is spent and can no longer be copied. The end this goes to only
    // keeps the encoder running, so when it falls behind, frames for it are simply left out.
    if (level.waiting >= MOST_WAITING * 2) continue
    level.waiting++
    level.writer.write(frame).then(() => { level.waiting-- }, () => { level.waiting-- /* the level is being closed */ })
  }
}

async function runViewer(id: string, v: Viewer) {
  for (;;) {
    const { value: frame, done } = await v.reader.read().catch(() => ({ value: undefined, done: true as const }))
    if (done || !frame) return
    const md = frame.getMetadata() as Meta
    const key = frame.type === 'key'
    if (v.next === OWN) { if (key) changeTo(id, v, OWN, md); else askFor(OWN, id) }
    if (v.on === OWN) { if (!send(v, frame, md, true, key)) askFor(OWN, id); continue }
    // On a level: what its own encoder makes is dropped. A keyframe from it means the viewer's app asked for a fresh
    // start (their picture broke), which is passed on to the encoder they are really being sent.
    if (key) askFor(v.next ?? v.on, id)
  }
}

scope.onmessage = e => {
  const m = e.data
  if (m.t === 'pipe') { void m.readable.pipeTo(m.writable).catch(() => { /* the connection closed */ }); return }
  if (m.t === 'level') {
    const level: Level = { reader: m.readable.getReader(), writer: m.writable.getWriter(), waiting: 0, seen: 0, upper: 0, layered: null }
    levels.set(m.id, level)
    void runLevel(m.id, level)
  } else if (m.t === 'viewer') {
    const v: Viewer = { reader: m.readable.getReader(), writer: m.writable.getWriter(), on: OWN, next: null, half: false, shift: { id: 0, ts: 0 }, last: null, waiting: 0, broken: false }
    viewers.set(m.id, v)
    void runViewer(m.id, v)
  } else if (m.t === 'set') {
    const v = viewers.get(m.viewer)
    if (!v) return
    const source = m.source ?? OWN
    v.half = source !== OWN && m.half
    if (v.on === source) { v.next = null; return }
    v.next = source
    askFor(source, m.viewer)
  } else if (m.t === 'dropViewer') {
    const v = viewers.get(m.id)
    viewers.delete(m.id)
    void v?.reader.cancel().catch(() => {})
  } else if (m.t === 'dropLevel') {
    const level = levels.get(m.id)
    levels.delete(m.id)
    asked.delete(m.id)
    void level?.reader.cancel().catch(() => {})
  }
}
