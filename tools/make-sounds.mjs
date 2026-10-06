// Generates the default sound pack (public/sounds/default/*.wav) from nothing but arithmetic, so every sound that
// ships with Maplecord is original and free to redistribute. Run:  node tools/make-sounds.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 44100
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sounds/default')
fs.mkdirSync(out, { recursive: true })

const note = n => 440 * 2 ** ((n - 69) / 12) // MIDI note number -> Hz
const buffer = seconds => new Float32Array(Math.ceil(seconds * RATE))

/** Adds a tone to `buf` starting at `at` seconds. `slideTo` glides the pitch; `shape` picks the timbre. */
function tone(buf, { at = 0, dur, freq, slideTo = freq, gain = 0.5, shape = 'bell', attack = 0.005 }) {
  const start = Math.floor(at * RATE), n = Math.floor(dur * RATE)
  let phase = 0
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / n
    const f = freq + (slideTo - freq) * t
    phase += (2 * Math.PI * f) / RATE
    const env = Math.min(1, i / (attack * RATE)) * (shape === 'bell' ? Math.exp(-4.5 * t) : shape === 'soft' ? Math.sin(Math.PI * t) ** 0.6 : (1 - t) ** 0.8)
    const wave = shape === 'brass'
      ? Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.28 * Math.sin(3 * phase) + 0.14 * Math.sin(4 * phase)
      : Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase)
    buf[start + i] += gain * env * wave
  }
}

/** Adds a short burst of filtered noise: a click, a knock or a rattle depending on length and tone. */
function thump(buf, { at = 0, dur, gain = 0.5, tone: cutoff = 0.2 }) {
  const start = Math.floor(at * RATE), n = Math.floor(dur * RATE)
  let low = 0
  for (let i = 0; i < n && start + i < buf.length; i++) {
    low += cutoff * (Math.random() * 2 - 1 - low) // one-pole low-pass
    buf[start + i] += gain * Math.exp(-6 * (i / n)) * low * 3
  }
}

function write(name, buf) {
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  const data = Buffer.alloc(buf.length * 2)
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round((buf[i] / peak) * 0.8 * 32767), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(path.join(out, name + '.wav'), Buffer.concat([header, data]))
  console.log(name.padEnd(10), (buf.length / RATE).toFixed(2) + 's')
}

// roll: dice rattling in a cup, then landing
{
  const b = buffer(0.75)
  for (let i = 0; i < 9; i++) thump(b, { at: 0.02 + i * 0.055 + Math.random() * 0.02, dur: 0.035, gain: 0.35 + Math.random() * 0.25, tone: 0.55 })
  thump(b, { at: 0.56, dur: 0.07, gain: 0.8, tone: 0.3 }); thump(b, { at: 0.64, dur: 0.06, gain: 0.5, tone: 0.3 })
  write('roll', b)
}
// win: a bright rising arpeggio
{
  const b = buffer(0.9)
  ;[72, 76, 79, 84].forEach((n, i) => tone(b, { at: i * 0.09, dur: 0.5, freq: note(n), gain: 0.5 }))
  write('win', b)
}
// lose: three notes stepping down
{
  const b = buffer(0.95)
  ;[67, 63, 60].forEach((n, i) => tone(b, { at: i * 0.2, dur: 0.45, freq: note(n), gain: 0.5, shape: 'soft' }))
  write('lose', b)
}
// you100: you rolled the maximum. A fanfare with a sparkle on top.
{
  const b = buffer(1.6)
  ;[60, 64, 67, 72].forEach((n, i) => tone(b, { at: i * 0.1, dur: 0.22, freq: note(n), gain: 0.5, shape: 'brass' }))
  ;[72, 76, 79].forEach(n => tone(b, { at: 0.45, dur: 1.0, freq: note(n), gain: 0.35, shape: 'brass' }))
  ;[96, 100, 103, 108, 103, 108].forEach((n, i) => tone(b, { at: 0.5 + i * 0.07, dur: 0.3, freq: note(n), gain: 0.12 }))
  write('you100', b)
}
// one: you rolled the minimum. A drooping "wah wah wah".
{
  const b = buffer(1.5)
  ;[58, 57, 56].forEach((n, i) => tone(b, { at: i * 0.32, dur: 0.3, freq: note(n), slideTo: note(n - 0.6), gain: 0.5, shape: 'brass', attack: 0.03 }))
  tone(b, { at: 0.96, dur: 0.5, freq: note(55), slideTo: note(50), gain: 0.5, shape: 'brass', attack: 0.03 })
  write('one', b)
}
// sixtyNine: a cheeky slide up and back
{
  const b = buffer(0.7)
  tone(b, { at: 0, dur: 0.28, freq: note(67), slideTo: note(79), gain: 0.5, shape: 'soft' })
  tone(b, { at: 0.3, dur: 0.32, freq: note(79), slideTo: note(72), gain: 0.5, shape: 'soft' })
  write('sixtyNine', b)
}
// they100: someone else rolled the maximum. The fanfare, lower and without the sparkle.
{
  const b = buffer(1.3)
  ;[55, 59, 62, 67].forEach((n, i) => tone(b, { at: i * 0.11, dur: 0.24, freq: note(n), gain: 0.5, shape: 'brass' }))
  ;[62, 67, 71].forEach(n => tone(b, { at: 0.48, dur: 0.75, freq: note(n), gain: 0.35, shape: 'brass' }))
  write('they100', b)
}
// emo: you lost by a hair. A single falling sigh.
{
  const b = buffer(0.85)
  tone(b, { at: 0, dur: 0.8, freq: note(72), slideTo: note(60), gain: 0.5, shape: 'soft', attack: 0.04 })
  tone(b, { at: 0, dur: 0.8, freq: note(75), slideTo: note(63), gain: 0.2, shape: 'soft', attack: 0.04 })
  write('emo', b)
}
// join: two knocks
{
  const b = buffer(0.4)
  thump(b, { at: 0.01, dur: 0.09, gain: 0.9, tone: 0.07 }); thump(b, { at: 0.17, dur: 0.09, gain: 0.8, tone: 0.07 })
  tone(b, { at: 0.01, dur: 0.07, freq: 190, slideTo: 120, gain: 0.5, shape: 'soft' }); tone(b, { at: 0.17, dur: 0.07, freq: 180, slideTo: 115, gain: 0.45, shape: 'soft' })
  write('join', b)
}
// leave: a door closing: one dull thud and a latch
{
  const b = buffer(0.45)
  thump(b, { at: 0.01, dur: 0.16, gain: 1, tone: 0.04 }); tone(b, { at: 0.01, dur: 0.12, freq: 110, slideTo: 60, gain: 0.6, shape: 'soft' })
  thump(b, { at: 0.2, dur: 0.025, gain: 0.35, tone: 0.6 })
  write('leave', b)
}
