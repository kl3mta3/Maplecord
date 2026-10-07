import { useEffect, useState } from 'react'
import type { Store } from '../store'
import { DEFAULT_GATE_LEVEL } from '../settings'
import { listAudioDevices } from '../voice'
import { isElectron } from '../platform'
import { DEFAULT_PUSH_KEY, pushKeyFrom, setChoosingPushKey, type PushKey } from '../pushToTalk'
import { P2PInfo } from './Dialogs'

/**
 * Settings → Voice & audio: which microphone and speakers, how loud everyone is, when the microphone is sent (while
 * talking, or while a key is held), and whether P2P is allowed. The same things are in the little menus beside the
 * mute and deafen buttons; everything here takes effect at once.
 */
export function VoiceAudioSettings({ store, onAllowDirect }: {
  store: Store
  /** Asked to change whether P2P is allowed. Allowing it does not happen here: it opens the sign-in-again step. */
  onAllowDirect: (allow: boolean) => void
}) {
  const s = store.settings
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] })
  const [note, setNote] = useState('')
  const [choosing, setChoosing] = useState(false)
  const push = s.voiceMode === 'push'
  const gate = s.voiceGate !== false
  const pushKey: PushKey = s.pushKey ?? DEFAULT_PUSH_KEY

  useEffect(() => {
    (async () => {
      try {
        // Device names are only given out once the microphone has been allowed.
        try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()) } catch { setNote('Microphone permission was not granted.') }
        setDevices(await listAudioDevices())
      } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    })()
  }, [])

  // Choosing a key: the next key or mouse button pressed becomes it. Escape leaves it as it was.
  useEffect(() => {
    if (!choosing) return
    setChoosingPushKey(true)
    const take = (event: KeyboardEvent | MouseEvent) => {
      // Nothing else gets this press: not the window behind (Escape would close Settings), not push to talk itself.
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      if ('code' in event && event.code === 'Escape') { setChoosing(false); return }
      const key = pushKeyFrom(event)
      if (!key) return
      store.updateSettings({ pushKey: key })
      setChoosing(false)
    }
    window.addEventListener('keydown', take, true)
    window.addEventListener('mousedown', take, true)
    return () => { window.removeEventListener('keydown', take, true); window.removeEventListener('mousedown', take, true); setChoosingPushKey(false) }
  }, [choosing, store])

  const pick = (kind: 'in' | 'out', id: string) => void store.setAudioDevices(kind === 'in' ? id || null : s.audioInputDeviceId, kind === 'out' ? id || null : s.audioOutputDeviceId)

  return (
    <>
      <h4>Voice &amp; audio</h4>
      <div className="muted">Microphone</div>
      <select value={s.audioInputDeviceId ?? ''} onChange={e => pick('in', e.target.value)} aria-label="Microphone">
        <option value="">System default</option>
        {devices.inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
      </select>
      <div className="muted">Speakers / headset</div>
      <select value={s.audioOutputDeviceId ?? ''} onChange={e => pick('out', e.target.value)} aria-label="Speakers">
        <option value="">System default</option>
        {devices.outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speakers'}</option>)}
      </select>
      <label className="row sensitivity">
        <span className="muted">Output volume</span>
        <input className="grow" type="range" min={0} max={100} step={5} value={Math.round((s.outputVolume ?? 1) * 100)} aria-label="Output volume" onChange={e => store.updateSettings({ outputVolume: Number(e.target.value) / 100 })} />
        <b>{Math.round((s.outputVolume ?? 1) * 100)}%</b>
      </label>
      {note && <div className="muted">{note}</div>}

      <h4>When your microphone is sent</h4>
      <label className="choice"><input type="radio" name="voicemode" checked={!push} onChange={() => store.updateSettings({ voiceMode: 'activity' })} /><span><b>Voice activity</b> <span className="muted">while you are talking</span></span></label>
      <label className="choice"><input type="radio" name="voicemode" checked={push} onChange={() => store.updateSettings({ voiceMode: 'push' })} /><span><b>Push to talk</b> <span className="muted">while you hold a key</span></span></label>

      {!push && (
        <>
          <label className="row">
            <input type="checkbox" checked={gate} onChange={e => store.updateSettings({ voiceGate: e.target.checked })} />
            <span>Only send my voice while I talk</span>
          </label>
          {gate && (
            <label className="row sensitivity">
              <span className="muted">Whisper</span>
              <input className="grow" type="range" min={1} max={10} step={1} value={s.voiceGateLevel ?? DEFAULT_GATE_LEVEL} aria-label="How loud counts as talking" onChange={e => store.updateSettings({ voiceGateLevel: Number(e.target.value) })} />
              <span className="muted">Raised voice</span>
              <b>{s.voiceGateLevel ?? DEFAULT_GATE_LEVEL}</b>
            </label>
          )}
          <div className="muted">
            {gate
              ? 'How loud you have to be before your microphone is sent. Move it right if background noise gets through, left if your words are cut off.'
              : 'Your microphone is sent the whole time you are unmuted, background noise included.'}
          </div>
        </>
      )}
      {push && (
        <>
          <div className="row">
            <span className="muted">Key</span>
            <code className="keycap">{choosing ? 'Press a key or mouse button…' : pushKey.label}</code>
            <button onClick={() => setChoosing(c => !c)}>{choosing ? 'Cancel' : 'Change key'}</button>
          </div>
          <div className="muted">
            {isElectron()
              ? 'Hold it to talk. It works while a game or another window is in front, too.'
              : 'Hold it to talk. In a browser it only works while this tab is in front; the desktop app hears it everywhere.'}
          </div>
        </>
      )}

      <h4>P2P</h4>
      <div className="row">
        <label className="row">
          <input type="checkbox" checked={!store.allowDirect} onChange={e => onAllowDirect(!e.target.checked)} />
          <span>Do not allow P2P connections</span>
        </label>
        <P2PInfo />
      </div>
      <div className="muted">
        {store.allowDirect
          ? 'P2P is allowed: you can join P2P voice channels and connect straight to friends who allow it too.'
          : 'Unticking this asks you to sign in again.'}
      </div>
    </>
  )
}
