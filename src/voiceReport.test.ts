// Run with: node src/voiceReport.test.ts
import { voiceRecorder } from './voiceReport.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

// A made-up call, five readings a second: two people talking all along (as a music bot does), each heard through the
// stream server. `quiet(t, who)` says when nothing arrives from someone; `unplayable(t, who)` when it arrives and
// cannot be played.
type R = { sent: number; recv: number; lost: number; samples: number; concealed: number; jbDelay: number; jbEmitted: number; level: number; rtt: number | null; route: string | null; theyLost: number | null }
function call(seconds: number, quiet: (t: number, who: string) => boolean, unplayable: (t: number, who: string) => boolean = () => false, sends: (t: number) => number = () => 10) {
  const start = Date.UTC(2026, 9, 14, 12, 0, 0)
  const sum: Record<string, R> = {}
  const rows = []
  for (let i = 0; i <= seconds * 5; i++) {
    const t = i * 0.2
    const people: Record<string, R> = {}
    for (const who of ['me', 'alex', 'bot']) {
      const r = sum[who] ??= { sent: 0, recv: 0, lost: 0, samples: 0, concealed: 0, jbDelay: 0, jbEmitted: 0, level: 0, rtt: 0.05, route: 'udp direct', theyLost: 0 }
      if (who === 'me') r.sent += sends(t)
      else if (!quiet(t, who)) {
        r.recv += 10; r.samples += 9600; r.jbEmitted += 9600; r.jbDelay += 9600 * 0.04
        if (unplayable(t, who)) r.concealed += 9600
      } else { r.samples += 9600; r.concealed += 9600 }
      people[who] = { ...r }
    }
    rows.push({ at: start + i * 200, sending: true, people })
  }
  const rec = voiceRecorder as any
  rec.clear(); rec.rows = rows; rec.names = new Map([['me', 'me'], ['alex', 'alex'], ['bot', 'music bot']]); rec.how = 'Voice goes through the stream server.'; rec.viaServer = true
  return { rec, at: (t: number) => start + t * 1000 }
}

console.log('The voice report')
{
  const { rec, at } = call(30, t => t >= 10 && t < 13)
  rec.marks = [at(13.4)]
  const text: string = rec.report('test')
  check(/alex, music bot · all went silent at the same moment/.test(text) || /music bot, alex · all went silent at the same moment/.test(text), 'two voices stopping together are reported as one stop of something they share')
  check(/Marked at [^:]+:[^:]+:[^:]+: nothing arrived from alex \(3\.0 s\), music bot \(3\.0 s\)/.test(text), 'the mark says nothing arrived, from whom, and for how long')
}
{
  const { rec } = call(30, (t, who) => who === 'alex' && t >= 10 && t < 13)
  const text: string = rec.report('test')
  check(!/same moment/.test(text) && /left out/.test(text), 'one person going quiet with nothing lost is counted as a pause, not listed')
}
{
  const { rec, at } = call(30, () => false)
  rec.marks = [at(20)]
  const text: string = rec.report('test')
  check(/kept arriving and was played normally/.test(text), 'a mark where everything arrived and played says it went after this app had it')
}
{
  const { rec, at } = call(30, () => false, (t, who) => who === 'bot' && t >= 5 && t < 7)
  rec.marks = [at(7.2)]
  const text: string = rec.report('test')
  check(/music bot · 2\.\d s · their voice kept arriving, but almost none of it could be played/.test(text), 'voice arriving that cannot be played is listed')
  check(/voice kept arriving from music bot .* but could not be played/.test(text), 'and the mark says so')
}
{
  const { rec } = call(30, () => false)
  rec.rows = rec.rows.slice(0, 1)
  check(/Nothing recorded yet/.test(rec.report('test')), 'with nothing recorded it says so')
}

{
  // In a quiet moment the app sends a packet every 400 ms (DTX): every other reading has nothing. That is not a stop.
  const { rec } = call(30, () => false, () => false, t => (Math.round(t * 5) % 2 === 0 ? 1 : 0))
  check(!/meant to send and sent nothing/.test(rec.report('test')), 'our own quiet moments (a packet every 400 ms) are not taken for the app stopping')
}
{
  const { rec, at } = call(30, () => false, () => false, t => (t >= 10 && t < 11 ? 0 : 10))
  const text: string = rec.report('test')
  check(/meant to send and sent nothing for 0.6 s or more: (\d\d:){2}\d\d\.\d$/m.test(text) && text.includes(new Date(at(10.2)).toLocaleTimeString([], { hour12: false })), 'a second in which the app meant to send and sent nothing is listed, once')
}

console.log(failures === 0 ? 'voiceReport: all passed' : `voiceReport: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} voiceReport checks failed`)
