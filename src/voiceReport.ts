// A recording of how a call is going, for finding out where sound goes missing. Off unless switched on (Voice &
// audio settings). While on and in a call, five times a second it notes what this app sent, and for each person it
// hears what arrived, what was lost on the way, and what had to be made up because nothing was there to play. It
// keeps the last ten minutes, on this device only. "Copy voice report" turns that into a short text to send to whoever
// is looking into it: the gaps it found, with what each one was, and every moment marked while it happened.
//
// No addresses are kept: of the connection only whether it is UDP or TCP, what kind of route it took, and its delay.

/** Something to ask for numbers: our own voice going out, or one person's coming in (or both, on a P2P connection). */
export interface VoiceProbe { who: string; name: string; sends: boolean; receives: boolean; stats: () => Promise<RTCStatsReport> }

interface Reading { sent: number; recv: number; lost: number; samples: number; concealed: number; jbDelay: number; jbEmitted: number; level: number; rtt: number | null; route: string | null; theyLost: number | null }
interface Row { at: number; sending: boolean; people: Record<string, Reading> }

const EVERY_MS = 200
const KEEP_MS = 10 * 60_000
/** Shortest stretch of nothing from someone, between moments they were heard, that counts as a gap. */
const GAP_MS = 600
/** A buffer this deep (ms) just after sound comes back means it was held up on the way and arrived in a rush. */
const HELD_MS = 300
/** Voice packets in one tick when someone is talking (a packet every 20 ms is 10), less a little. */
const FULL_RATE = 7
/** Stops by different people this close together (ms) are one stop. */
const TOGETHER_MS = 400

const empty = (): Reading => ({ sent: 0, recv: 0, lost: 0, samples: 0, concealed: 0, jbDelay: 0, jbEmitted: 0, level: 0, rtt: null, route: null, theyLost: null })

async function read(probe: VoiceProbe): Promise<Reading> {
  const r = empty()
  const local = new Map<string, RTCStats & { protocol?: string; candidateType?: string }>()
  let pairLocal: string | null = null
  for (const s of (await probe.stats()).values() as Iterable<RTCStats & Record<string, unknown>>) {
    if (s.type === 'outbound-rtp' && s.kind === 'audio') r.sent += Number(s.packetsSent ?? 0)
    if (s.type === 'inbound-rtp' && s.kind === 'audio') {
      r.recv += Number(s.packetsReceived ?? 0); r.lost += Number(s.packetsLost ?? 0)
      r.samples += Number(s.totalSamplesReceived ?? 0); r.concealed += Number(s.concealedSamples ?? 0)
      r.jbDelay += Number(s.jitterBufferDelay ?? 0); r.jbEmitted += Number(s.jitterBufferEmittedCount ?? 0)
      r.level = Math.max(r.level, Number(s.audioLevel ?? 0))
    }
    // What the other end says it lost of what we sent.
    if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') r.theyLost = (r.theyLost ?? 0) + Number(s.packetsLost ?? 0)
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') { r.rtt = typeof s.currentRoundTripTime === 'number' ? s.currentRoundTripTime : r.rtt; pairLocal = String(s.localCandidateId ?? '') }
    if (s.type === 'local-candidate') local.set(s.id, s as RTCStats & { protocol?: string; candidateType?: string })
  }
  const c = pairLocal ? local.get(pairLocal) : undefined
  if (c) r.route = `${c.protocol ?? '?'}${c.candidateType === 'relay' ? ' via the relay' : c.candidateType === 'host' ? ' direct' : c.candidateType ? ' ' + c.candidateType : ''}`
  return r
}

class VoiceRecorder {
  private rows: Row[] = []
  private marks: number[] = []
  private notes: { at: number; text: string }[] = []
  private names = new Map<string, string>()
  private timer = 0
  private busy = false
  private began = 0
  private how = ''
  private viaServer = false

  get recording() { return this.timer !== 0 }
  get hasAnything() { return this.rows.length > 1 }

  /** Starts (or carries on) recording, asking `probes` each time for what there is to ask. */
  start(probes: () => VoiceProbe[], sending: () => boolean, how: () => string) {
    if (this.timer) return
    this.began ||= Date.now()
    this.timer = window.setInterval(() => {
      if (this.busy) return
      this.busy = true
      const at = Date.now()
      const list = probes()
      this.how = how()
      this.viaServer = this.how.includes('stream server')
      void Promise.all(list.map(p => read(p).then(r => [p, r] as const, () => [p, null] as const))).then(results => {
        const people: Record<string, Reading> = {}
        for (const [p, r] of results) { if (r) { people[p.who] = r; this.names.set(p.who, p.name) } }
        this.rows.push({ at, sending: sending(), people })
        while (this.rows.length > 0 && at - this.rows[0]!.at > KEEP_MS) this.rows.shift()
        this.marks = this.marks.filter(m => at - m < KEEP_MS)
        this.notes = this.notes.filter(n => at - n.at < KEEP_MS)
      }).finally(() => { this.busy = false })
    }, EVERY_MS)
  }

  stop() { window.clearInterval(this.timer); this.timer = 0 }

  /** "I just heard a gap": the moment is in the report, with what happened around it. */
  mark() { this.marks.push(Date.now()) }

  /** Something the voice side said along the way (reconnecting, could not decrypt): it goes in the report as it is. */
  note(text: string) { if (this.recording) this.notes.push({ at: Date.now(), text }) }

  clear() { this.rows = []; this.marks = []; this.notes = []; this.began = 0 }

  /** What the five seconds before a mark show, in one sentence. */
  private atMark(m: number, steps: Map<string, { at: number; recv: number; real: number; concealed: number }[]>): string {
    const nothing: string[] = [], unplayable: string[] = []
    let anyone = false
    for (const [who, list] of steps) {
      if (who === 'me') continue
      const near = list.filter(x => x.at > m - 5000 && x.at <= m + 400)
      if (near.some(x => x.recv >= FULL_RATE)) anyone = true
      // The longest run of each kind of silence there, after they had been heard.
      let none = 0, bad = 0, runNone = 0, runBad = 0, heard = false
      for (const x of near) {
        const total = x.real + x.concealed
        if (x.recv > 0) heard = true
        runNone = heard && x.recv === 0 ? runNone + 1 : 0
        runBad = x.recv >= FULL_RATE && total > 0 && x.real / total < 0.1 ? runBad + 1 : 0
        none = Math.max(none, runNone); bad = Math.max(bad, runBad)
      }
      const name = this.names.get(who) ?? who
      if (none * EVERY_MS >= GAP_MS) nothing.push(`${name} (${(none * EVERY_MS / 1000).toFixed(1)} s)`)
      if (bad * EVERY_MS >= GAP_MS) unplayable.push(`${name} (${(bad * EVERY_MS / 1000).toFixed(1)} s)`)
    }
    if (nothing.length > 0) return `nothing arrived from ${nothing.join(', ')} just before this (unless they had just stopped talking): it stopped before reaching this app (their side, the network, or the stream server).`
    if (unplayable.length > 0) return `voice kept arriving from ${unplayable.join(', ')} but could not be played: it reached this app and went wrong here.`
    if (anyone) return 'everyone talking kept arriving and was played normally just before this: if the sound dropped out, it went after this app had it (on the way to the speakers or headset).'
    return 'nobody was talking in the five seconds before this, as far as this app could tell.'
  }

  /** The report, as text to paste. */
  report(appVersion: string): string {
    const rows = this.rows
    const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false }) + '.' + String(Math.floor((t % 1000) / 100))
    const lines: string[] = []
    const offset = -new Date().getTimezoneOffset() / 60
    lines.push(`Maplecord voice report · app ${appVersion} · ${new Date().toLocaleString([], { hour12: false })} (UTC${offset >= 0 ? '+' : ''}${offset})`)
    if (rows.length < 2) { lines.push('Nothing recorded yet: switch the recording on, then join a call.'); return lines.join('\n') }
    lines.push(`Recorded ${Math.round((rows.at(-1)!.at - rows[0]!.at) / 1000)} s, every ${EVERY_MS} ms. ${this.how}`)
    const last = rows.at(-1)!
    for (const [who, r] of Object.entries(last.people)) lines.push(`  ${this.names.get(who) ?? who}: ${r.route ?? 'route unknown'}, delay ${r.rtt !== null ? Math.round(r.rtt * 1000) + ' ms' : 'unknown'}`)

    // Per tick, per person: what changed since the tick before.
    type Step = { at: number; sending: boolean; sent: number; recv: number; lost: number; real: number; concealed: number; jbMs: number | null; theyLost: number | null }
    const steps = new Map<string, Step[]>()
    for (let i = 1; i < rows.length; i++) {
      const [p, k] = [rows[i - 1]!, rows[i]!]
      for (const [who, now] of Object.entries(k.people)) {
        const was = p.people[who]
        if (!was) continue
        const emitted = now.jbEmitted - was.jbEmitted
        const list = steps.get(who) ?? []
        list.push({
          at: k.at, sending: k.sending, sent: now.sent - was.sent, recv: now.recv - was.recv, lost: Math.max(0, now.lost - was.lost),
          real: (now.samples - was.samples) - (now.concealed - was.concealed), concealed: now.concealed - was.concealed,
          jbMs: emitted > 0 ? Math.round((now.jbDelay - was.jbDelay) / emitted * 1000) : null, theyLost: now.theyLost !== null && was.theyLost !== null ? now.theyLost - was.theyLost : null,
        })
        steps.set(who, list)
      }
    }

    // Gaps: someone was heard, then nothing for GAP_MS or more, then heard again. Most of those are pauses in talking
    // (the app stops sending once it has been quiet a moment), which look the same from here. So a gap is listed when
    // something was lost, when the sound came back in a rush (it was held up on the way, and the buffer jumps), or
    // when it is near a moment someone marked; the rest are only counted. What arrived and what was lost in between,
    // and just after, says what it was.
    lines.push('', 'Gaps (nothing for 0.6 s or more, then heard again; with something lost, held up, or near a mark):')
    let gaps = 0
    let pauses = 0
    // Every stop of 0.6 s or more, listed or not, to find the ones where everyone went quiet at the same moment.
    const stops: { who: string; at: number; ms: number }[] = []
    for (const [who, list] of steps) {
      let start = -1
      for (let i = 0; i < list.length; i++) {
        const heard = list[i]!.recv > 0
        if (!heard && start < 0 && i > 0 && list[i - 1]!.recv > 0) start = i
        if (heard && start >= 0) {
          const span = list.slice(start, i)
          const ms = list[i]!.at - list[start]!.at
          // Lost packets show up when the sound comes back: the numbers skip the ones that never arrived.
          const lost = span.reduce((s, x) => s + x.lost, 0) + list[i]!.lost + (list[i + 1]?.lost ?? 0)
          const heldMs = Math.max(...list.slice(i, i + 6).map(x => x.jbMs ?? 0))
          const marked = this.marks.some(m => m >= list[start]!.at - 3000 && m <= list[i]!.at + 10_000)
          if (ms >= GAP_MS && who !== 'me') stops.push({ who, at: list[start]!.at, ms })
          if (ms >= GAP_MS && lost === 0 && heldMs < HELD_MS && !marked) pauses++
          else if (ms >= GAP_MS) {
            const expected = Math.round(ms / 20)
            const what = lost >= Math.max(5, expected * 0.5) ? `about ${lost} of ~${expected} voice packets were lost on the way to this app (network or relay)`
              : this.viaServer && lost > 0 ? `${lost} of ~${expected} voice packets were lost between the stream server and here; the rest never reached here at all: they stopped sending, or it was held up or lost before or in the stream server (their report says if their side lost it)`
              : this.viaServer ? 'nothing arrived and nothing was lost between the stream server and here: they stopped sending, or it went missing before or in the stream server (their report says if their side lost it)'
                : lost > 0 ? `${lost} packets lost; mostly nothing was sent (their app sent nothing, or they stopped talking)`
                  : 'nothing was lost: their app sent nothing (they stopped talking, or their app or microphone stopped)'
            const held = heldMs >= HELD_MS ? `; then it came in a rush and played ${(heldMs / 1000).toFixed(1)} s late for a while (held up on the way)` : ''
            lines.push(`  ${clock(list[start]!.at)} · ${this.names.get(who) ?? who} · ${(ms / 1000).toFixed(1)} s · ${what}${held}${marked ? ' · marked' : ''}`)
            gaps++
          }
          start = -1
        }
      }
    }
    // The other kind of silence: their voice kept arriving at full rate, but next to none of it could be played (it
    // could not be decrypted or decoded, or came too late to use).
    for (const [who, list] of steps) {
      let start = -1
      for (let i = 0; i <= list.length; i++) {
        const x = list[i]
        const total = x ? x.real + x.concealed : 0
        const unplayable = !!x && x.recv >= FULL_RATE && total > 0 && x.real / total < 0.1
        if (unplayable && start < 0) start = i
        if (!unplayable && start >= 0) {
          const ms = (list[i - 1]!.at - list[start]!.at) + EVERY_MS
          if (ms >= GAP_MS) {
            lines.push(`  ${clock(list[start]!.at)} · ${this.names.get(who) ?? who} · ${(ms / 1000).toFixed(1)} s · their voice kept arriving, but almost none of it could be played (not decrypted, not decoded, or too late)`)
            gaps++
          }
          start = -1
        }
      }
    }
    // Two people or more stopping within a moment of each other is not two pauses: something they share stopped.
    stops.sort((a, b) => a.at - b.at)
    for (let i = 0; i < stops.length; i++) {
      const group = [stops[i]!]
      while (i + 1 < stops.length && stops[i + 1]!.at - stops[i]!.at <= TOGETHER_MS && !group.some(g => g.who === stops[i + 1]!.who)) group.push(stops[++i]!)
      if (group.length < 2) continue
      lines.push(`  ${clock(group[0]!.at)} · ${group.map(g => this.names.get(g.who) ?? g.who).join(', ')} · all went silent at the same moment (${group.map(g => (g.ms / 1000).toFixed(1) + ' s').join(', ')}): something they share stopped, not each of them`)
      gaps++
    }
    if (gaps === 0) lines.push('  none')
    if (pauses > 0) lines.push(`  (and ${pauses} with nothing lost or held up, almost all of them pauses in talking: left out)`)

    // Our own side, with what the other end said it lost of ours.
    const ours = [...steps.values()][0] ?? []
    const offs = []
    // Only a stretch of GAP_MS or more: in a quiet moment our app sends a packet every 400 ms (DTX), so a single
    // reading with nothing sent is ordinary.
    for (let i = 0, run = 0; i < ours.length; i++) {
      run = ours[i]!.sending && ours[i]!.sent === 0 ? run + 1 : 0
      if (run === Math.ceil(GAP_MS / EVERY_MS)) offs.push(ours[i - run + 1]!.at)
    }
    if (offs.length > 0) lines.push('', `Moments this app meant to send and sent nothing for ${GAP_MS / 1000} s or more: ${offs.slice(0, 20).map(clock).join(', ')}`)
    // What the other end (the stream server, or each person app to app) said it lost of what this app sent.
    const outLoss: string[] = []
    for (const [who, list] of steps) {
      for (let i = 0; i < list.length; i++) {
        const n = list[i]!.theyLost
        if (n !== null && n >= 3) outLoss.push(`${clock(list[i]!.at)}: ${n} lost${who === 'me' ? '' : ' (to ' + (this.names.get(who) ?? who) + ')'}`)
      }
    }
    lines.push('', outLoss.length > 0 ? `Lost on the way out from this app, as the other end counted it: ${outLoss.slice(0, 30).join(', ')}`
      : 'Lost on the way out from this app, as the other end counted it: nothing to speak of.')

    if (this.notes.length > 0) { lines.push('', 'Said along the way:'); for (const n of this.notes) lines.push(`  ${clock(n.at)} · ${n.text}`) }

    // Around each moment marked: every tick, six seconds either side.
    for (const m of this.marks) {
      lines.push('', `Marked at ${clock(m)}: ${this.atMark(m, steps)}`)
      lines.push('time | me: sending/sent | each person: arrived lost real-sound% buffer-ms')
      for (let i = 0; i < rows.length; i++) {
        const k = rows[i]!
        if (Math.abs(k.at - m) > 6000) continue
        const parts = [...steps.entries()].map(([who, list]) => {
          const s = list.find(x => x.at === k.at)
          if (!s) return ''
          const total = s.real + s.concealed
          return `${(this.names.get(who) ?? who).slice(0, 12)} ${s.recv} ${s.lost} ${total > 0 ? Math.round(s.real / total * 100) : '-'}% ${s.jbMs ?? '-'}`
        })
        const mine = [...steps.values()][0]?.find(x => x.at === k.at)
        lines.push(`  ${clock(k.at)} | ${k.sending ? 'on' : 'off'}/${mine?.sent ?? 0} | ${parts.join(' | ')}`)
      }
    }
    if (this.marks.length === 0) lines.push('', 'No moments marked. Press "Mark gap" in the voice panel right after hearing one.')
    return lines.join('\n')
  }
}

/** The one recorder there is. */
export const voiceRecorder = new VoiceRecorder()
