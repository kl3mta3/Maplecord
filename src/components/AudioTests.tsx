import { useEffect, useRef, useState } from 'react'
import { gateThreshold, DEFAULT_GATE_LEVEL } from '../settings'

type SinkableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

/**
 * Test the microphone: while it is on, the chosen microphone is opened (with the same clean-up a call uses) and a bar
 * shows how loud it hears you, marked where talking starts to count. Nothing is sent anywhere or played back.
 */
export function MicTest({ deviceId, gateLevel }: { deviceId: string | null; gateLevel?: number }) {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [problem, setProblem] = useState('')
  const threshold = gateThreshold(gateLevel ?? DEFAULT_GATE_LEVEL)

  useEffect(() => {
    if (!on) { setLevel(0); return }
    let stopped = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let timer: number | undefined
    setProblem('')
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += v * v
          setLevel(Math.sqrt(sum / buf.length))
        }, 60)
      } catch (e) {
        if (!stopped) { setProblem(e instanceof Error ? `The microphone could not be opened: ${e.message}` : 'The microphone could not be opened.'); setOn(false) }
      }
    })()
    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach(t => t.stop())
      void ctx?.close().catch(() => {})
    }
  }, [on, deviceId])

  // The same scale the voice lights use (rms × 4), so the mark sits where talking starts to count in a call.
  const shown = Math.min(1, level * 4)
  const mark = Math.min(1, threshold * 4)
  const talking = level >= threshold
  return (
    <div className="audiotest">
      <button onClick={() => setOn(o => !o)}>{on ? 'Stop the test' : 'Test microphone'}</button>
      {on && (
        <>
          <div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
            <div className={'fill' + (talking ? ' talking' : '')} style={{ width: `${shown * 100}%` }} />
            <div className="mark" style={{ left: `${mark * 100}%` }} title="Where talking starts to count" />
          </div>
          <span className="muted">{talking ? 'Hearing you' : level > 0.0005 ? 'Too quiet to count as talking' : 'Nothing heard yet: say something'}</span>
        </>
      )}
      {problem && <div className="muted">{problem}</div>}
    </div>
  )
}

/** Test the speakers: plays a short two-note chime on the chosen speakers, at the chosen output volume. */
export function SpeakerTest({ deviceId, volume }: { deviceId: string | null; volume: number }) {
  const [playing, setPlaying] = useState(false)
  const [problem, setProblem] = useState('')
  const ctxRef = useRef<AudioContext | null>(null)
  useEffect(() => () => { void ctxRef.current?.close().catch(() => {}) }, [])

  const play = async () => {
    setProblem('')
    setPlaying(true)
    const ctx: SinkableContext = new AudioContext()
    ctxRef.current = ctx
    try {
      // A context told the device plays there; a plain sound element only says it does (see voice.ts, applyAudio).
      if (deviceId) {
        if (!ctx.setSinkId) throw new Error('This browser cannot choose where sound plays; it plays on the system default.')
        await ctx.setSinkId(deviceId)
      }
      await ctx.resume()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      const loud = Math.max(0, Math.min(1, volume)) * 0.35
      const note = (freq: number, at: number, length: number) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq
        const env = ctx.createGain()
        env.gain.setValueAtTime(0, ctx.currentTime + at)
        env.gain.linearRampToValueAtTime(loud, ctx.currentTime + at + 0.02)
        env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length)
        osc.connect(env).connect(gain)
        osc.start(ctx.currentTime + at)
        osc.stop(ctx.currentTime + at + length + 0.05)
      }
      note(660, 0, 0.35)
      note(880, 0.28, 0.5)
      await new Promise(r => window.setTimeout(r, 900))
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      void ctx.close().catch(() => {})
      if (ctxRef.current === ctx) ctxRef.current = null
      setPlaying(false)
    }
  }

  return (
    <div className="audiotest">
      <button onClick={() => void play()} disabled={playing}>{playing ? 'Playing…' : 'Play test sound'}</button>
      {problem && <span className="muted">{problem}</span>}
    </div>
  )
}
