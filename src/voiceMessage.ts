/**
 * Voice messages: a recording made with the browser's own recorder and sent like any other file. The server shows
 * a sound file as something to play, so there is nothing special about one on the way out or in.
 *
 * The format is whichever of these the browser can record, in this order. MP4 with AAC comes first because every
 * phone and desktop plays it; a desktop browser's usual choice (WebM or Ogg with Opus) does not play in Safari on
 * iPhones.
 */
const FORMATS: { mime: string; type: string; ext: string }[] = [
  { mime: 'audio/mp4;codecs=mp4a.40.2', type: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'webm' },
  { mime: 'audio/ogg;codecs=opus', type: 'audio/ogg', ext: 'ogg' },
]

/** The longest a voice message may be. */
export const VOICE_MESSAGE_SECONDS = 15 * 60

export const voiceMessageFormat = () =>
  typeof MediaRecorder === 'undefined' ? null : FORMATS.find(f => MediaRecorder.isTypeSupported(f.mime)) ?? null

/** Whether this browser can record one at all. */
export const canRecordVoiceMessage = () => voiceMessageFormat() !== null && !!navigator.mediaDevices?.getUserMedia

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export interface VoiceRecording {
  /** Stops and gives back what was recorded, or null if that was nothing. */
  finish(): Promise<File | null>
  /** Stops and throws the recording away. */
  discard(): void
}

/**
 * Starts recording from a microphone. `onProgress` is told how long it has been going; `onLimit` when it stopped
 * itself because it reached the longest allowed (the time above, or `maxBytes`, the server's upload limit).
 */
export async function recordVoiceMessage(options: {
  deviceId: string | null; maxBytes: number
  onProgress: (seconds: number) => void; onLimit: () => void
}): Promise<VoiceRecording> {
  const format = voiceMessageFormat()
  if (!format) throw new Error('This browser cannot record sound.')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: options.deviceId ? { exact: options.deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  })
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 48_000 })
  const chunks: Blob[] = []
  let bytes = 0
  let ended = false
  const started = Date.now()
  let stopped: (() => void) | null = null
  const whenStopped = new Promise<void>(resolve => { stopped = resolve })

  const stop = () => {
    if (ended) return
    ended = true
    window.clearInterval(timer)
    if (recorder.state !== 'inactive') recorder.stop(); else stopped?.()
    for (const track of stream.getTracks()) track.stop()
  }
  recorder.ondataavailable = e => {
    if (!e.data.size) return
    chunks.push(e.data)
    bytes += e.data.size
    // Stop while one more second of sound would still fit under the limit.
    if (!ended && options.maxBytes > 0 && bytes + 16_000 >= options.maxBytes) { stop(); options.onLimit() }
  }
  recorder.onstop = () => stopped?.()
  const timer = window.setInterval(() => {
    const seconds = (Date.now() - started) / 1000
    options.onProgress(Math.min(seconds, VOICE_MESSAGE_SECONDS))
    if (seconds >= VOICE_MESSAGE_SECONDS) { stop(); options.onLimit() }
  }, 250)
  recorder.start(1000)

  return {
    async finish() {
      stop()
      await whenStopped
      if (bytes === 0) return null
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      return new File(chunks, `voice-message-${stamp}.${format.ext}`, { type: format.type })
    },
    discard() { stop(); chunks.length = 0; bytes = 0 },
  }
}
