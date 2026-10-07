/**
 * Decides, on the audio thread, whether the person at the microphone is talking. It is what opens and closes the
 * gate in voice.ts, so it runs where time is kept exactly: a timer in a window that is hidden (behind a game, say) is
 * slowed down far too much to follow speech.
 *
 * It tells the page `true` or `false` whenever that changes, and repeats itself four times a second so the page can
 * tell that it is still running.
 */
const SOURCE = `
class VoiceDetector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.threshold = 0.02
    this.hold = sampleRate * 0.35
    this.quiet = this.hold
    this.energy = 0
    this.open = false
    this.sinceTold = 0
    this.port.onmessage = e => { if (e.data && typeof e.data.threshold === 'number') this.threshold = e.data.threshold }
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    const n = input ? input.length : 128
    let sum = 0
    if (input) for (let i = 0; i < n; i++) sum += input[i] * input[i]
    // Loudness over about the last hundredth of a second: one click does not count as talking, one syllable does.
    const keep = Math.exp(-n / (sampleRate * 0.01))
    this.energy = this.energy * keep + (sum / n) * (1 - keep)
    if (Math.sqrt(this.energy) >= this.threshold) this.quiet = 0
    else this.quiet += n
    const open = this.quiet < this.hold
    this.sinceTold += n
    if (open !== this.open || this.sinceTold >= sampleRate * 0.25) {
      this.open = open
      this.sinceTold = 0
      this.port.postMessage(open)
    }
    return true
  }
}
registerProcessor('voice-detector', VoiceDetector)
`

let url: string | null = null

/** Where the detector's code can be loaded from by `audioWorklet.addModule`. */
export function detectorUrl(): string {
  url ??= URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }))
  return url
}
