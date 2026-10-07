import { useEffect, useRef, useState } from 'react'
import { Send, Square, Trash2 } from 'lucide-react'
import { VOICE_MESSAGE_SECONDS, clock, recordVoiceMessage, type VoiceRecording } from '../voiceMessage'

/**
 * Takes the message box's place while a voice message is being made: it records as soon as it appears, then offers
 * to send what was recorded or throw it away. Stopping first lets the person listen before deciding.
 */
export function VoiceMessageBar({ deviceId, maxBytes, onSend, onClose }: {
  deviceId: string | null
  /** The server's upload limit; the recording stops by itself before passing it. */
  maxBytes: number
  onSend: (file: File) => Promise<void>
  onClose: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const [state, setState] = useState<'starting' | 'recording' | 'stopped' | 'sending'>('starting')
  const [note, setNote] = useState('')
  const [take, setTake] = useState<{ file: File; url: string } | null>(null)
  const recording = useRef<VoiceRecording | null>(null)
  const closed = useRef(false)

  const keep = async () => {
    const file = await recording.current?.finish()
    recording.current = null
    if (!file) { onClose(); return null }
    const made = { file, url: URL.createObjectURL(file) }
    setTake(made)
    setState('stopped')
    return made
  }

  useEffect(() => {
    closed.current = false
    recordVoiceMessage({
      deviceId, maxBytes,
      onProgress: setSeconds,
      onLimit: () => { setNote('Maximum length reached.'); void keep() },
    }).then(started => {
      if (closed.current) { started.discard(); return }
      recording.current = started
      setState('recording')
    }).catch(e => { setNote(`Could not use the microphone: ${e instanceof Error ? e.message : e}`); setState('stopped') })
    return () => { closed.current = true; recording.current?.discard(); recording.current = null }
    // Started once, when the bar appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url) }, [take])

  const send = async () => {
    const made = take ?? await keep()
    if (!made) return
    setState('sending')
    await onSend(made.file)
    onClose()
  }
  const discard = () => { recording.current?.discard(); recording.current = null; onClose() }

  return (
    <div className="composer voicebar" role="group" aria-label="Voice message">
      <button onClick={discard} disabled={state === 'sending'} title="Throw the recording away" aria-label="Discard voice message"><Trash2 size={17} /></button>
      {state === 'stopped' && take
        ? <audio className="grow" src={take.url} controls preload="metadata" />
        : (
          <div className="grow status">
            {state === 'recording' && <span className="recdot" aria-hidden="true" />}
            <span>{state === 'starting' ? 'Starting the microphone…' : state === 'sending' ? 'Sending…' : state === 'recording' ? `Recording ${clock(seconds)}` : ''}</span>
            {state === 'recording' && <span className="muted">of {clock(VOICE_MESSAGE_SECONDS)}</span>}
          </div>
        )}
      {note && <span className="muted note">{note}</span>}
      {state === 'recording' && <button onClick={() => void keep()} title="Stop and listen before sending" aria-label="Stop recording"><Square size={15} /></button>}
      <button className="accent" onClick={() => void send()} disabled={state === 'starting' || state === 'sending' || (state === 'stopped' && !take)} title="Send the voice message" aria-label="Send voice message"><Send size={17} /></button>
    </div>
  )
}
