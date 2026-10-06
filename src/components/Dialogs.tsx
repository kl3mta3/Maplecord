import { useEffect, useState, type ReactNode } from 'react'
import { ChannelType, RollKind, RollRange, type ChannelDto, type RollItemDto } from '../types'
import { listAudioDevices } from '../voice'
import type { CatalogHit } from '../store'

/** Shown once per guild before the first direct (non-relayed) voice connection. */
export function VoiceNoticeDialog({ reason, onContinue, onClose }: { reason: 'no-relay' | 'direct-chosen'; onContinue: () => void; onClose: () => void }) {
  return (
    <Dialog title="Voice connects directly" onClose={onClose}>
      <div>
        {reason === 'no-relay'
          ? 'This server has no relay configured, so voice will connect directly between members.'
          : 'You chose direct connections (Protect my IP is off), so voice will connect directly between members.'}
      </div>
      <div className="muted">Other people in this voice channel will be able to see your IP address. Audio itself is always encrypted end to end.</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onContinue(); onClose() }}>Continue</button></div>
    </Dialog>
  )
}

export function AudioSettingsDialog({ inputId, outputId, protectIp, onSave, onProtectIp, onClose }: {
  inputId: string | null; outputId: string | null; protectIp: boolean
  onSave: (input: string | null, output: string | null) => void; onProtectIp: (on: boolean) => void; onClose: () => void
}) {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] })
  const [input, setInput] = useState(inputId ?? '')
  const [output, setOutput] = useState(outputId ?? '')
  const [note, setNote] = useState('')
  useEffect(() => {
    (async () => {
      try {
        // Labels are only available after the mic permission has been granted once.
        try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()) } catch { setNote('Microphone permission was not granted.') }
        setDevices(await listAudioDevices())
      } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    })()
  }, [])
  return (
    <Dialog title="Audio settings" onClose={onClose}>
      <div className="muted">Microphone</div>
      <select value={input} onChange={e => setInput(e.target.value)}>
        <option value="">System default</option>
        {devices.inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
      </select>
      <div className="muted">Speakers / headset</div>
      <select value={output} onChange={e => setOutput(e.target.value)}>
        <option value="">System default</option>
        {devices.outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speakers'}</option>)}
      </select>
      <label className="row" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={protectIp} onChange={e => onProtectIp(e.target.checked)} />
        <span>Protect my IP <span className="muted">— route voice through the server's relay so other members never see your address</span></span>
      </label>
      {note && <div className="muted">{note}</div>}
      <div className="muted">Changes apply the next time you join a voice channel; if you are in one now you will be reconnected.</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onSave(input || null, output || null); onClose() }}>Save</button></div>
    </Dialog>
  )
}

export function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'dialog' + (wide ? ' wide' : '')}><h3>{title}</h3>{children}</div>
    </div>
  )
}

export function PromptDialog({ title, label, onSubmit, onClose }: { title: string; label: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('')
  const submit = () => { if (value.trim()) { onSubmit(value.trim()); onClose() } }
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="muted">{label}</div>
      <input autoFocus value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>OK</button></div>
    </Dialog>
  )
}

/** A nickname is a name on one server only. Saving it empty removes it, so the display name shows again. */
export function NicknameDialog({ who, serverName, current, fallback, onSubmit, onClose }: {
  who: string; serverName: string; current: string | null; fallback: string; onSubmit: (nickname: string | null) => void; onClose: () => void
}) {
  const [value, setValue] = useState(current ?? '')
  const submit = () => { onSubmit(value.trim() || null); onClose() }
  return (
    <Dialog title={`Nickname on ${serverName}`} onClose={onClose}>
      <div className="muted">What {who} is called on this server only. Leave it empty to use the display name ({fallback}).</div>
      <input autoFocus value={value} maxLength={32} placeholder={fallback} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <div className="buttons">
        {current && <button className="subtle" style={{ marginRight: 'auto' }} onClick={() => { onSubmit(null); onClose() }}>Remove nickname</button>}
        <button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>Save</button>
      </div>
    </Dialog>
  )
}

export function ConfirmDialog({ title, message, onConfirm, onClose }: { title: string; message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div>{message}</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onConfirm(); onClose() }}>Yes</button></div>
    </Dialog>
  )
}

export function CreateChannelDialog({ categories, onSubmit, onClose, initialType = ChannelType.Text }: {
  categories: ChannelDto[]; onSubmit: (name: string, type: number, parentId: string | null) => void; onClose: () => void; initialType?: number
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<number>(initialType)
  const [parent, setParent] = useState<string>(categories[0]?.id ?? '')
  const submit = () => { if (name.trim()) { onSubmit(name.trim(), type, type === ChannelType.Category ? null : parent || null); onClose() } }
  return (
    <Dialog title={type === ChannelType.Category ? 'Create category' : 'Create channel'} onClose={onClose}>
      <div className="row">
        <label className="row"><input type="radio" checked={type === ChannelType.Text} onChange={() => setType(ChannelType.Text)} /> # Text</label>
        <label className="row"><input type="radio" checked={type === ChannelType.Voice} onChange={() => setType(ChannelType.Voice)} /> 🔊 Voice</label>
        <label className="row"><input type="radio" checked={type === ChannelType.Category} onChange={() => setType(ChannelType.Category)} /> Category</label>
      </div>
      <div className="muted">Name</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      {type !== ChannelType.Category && (
        <>
          <div className="muted">Category</div>
          <select value={parent} onChange={e => setParent(e.target.value)}>
            <option value="">(none)</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>Create</button></div>
    </Dialog>
  )
}

export function StartRollDialog({ kind: initialKind, onSubmit, onClose, searchItems }: {
  kind: RollKind; onSubmit: (kind: RollKind, item: RollItemDto | null, min: number, max: number) => void; onClose: () => void
  /** Looks names up in the installed game plugins; omitted when there are none. */
  searchItems?: (query: string) => CatalogHit[]
}) {
  const [kind, setKind] = useState<RollKind>(initialKind)
  const [item, setItem] = useState('')
  // Set when the name was picked from a plugin catalog, so other clients with that plugin show its icon too.
  const [picked, setPicked] = useState<CatalogHit | null>(null)
  const hits = searchItems && !picked ? searchItems(item) : []
  const [qty, setQty] = useState('1')
  const [min, setMin] = useState('1')
  const [max, setMax] = useState('100')
  const range = { min: parseInt(min, 10), max: parseInt(max, 10) }
  const rangeOk = RollRange.isValid(range.min, range.max)
  const submit = () => {
    if (!rangeOk) return
    const q = Math.max(1, parseInt(qty, 10) || 1)
    const named = picked
      ? { pluginId: picked.pluginId, itemId: picked.item.id, name: picked.item.name, iconUrl: null, quantity: q }
      : item.trim() ? { pluginId: null, itemId: null, name: item.trim(), iconUrl: null, quantity: q } : null
    onSubmit(kind, named, range.min, range.max)
    onClose()
  }
  return (
    <Dialog title="Start a roll" onClose={onClose}>
      <div className="row">
        <label className="row"><input type="radio" checked={kind === RollKind.Standard} onChange={() => setKind(RollKind.Standard)} /> Roll (highest wins)</label>
        <label className="row"><input type="radio" checked={kind === RollKind.NeedGreed} onChange={() => setKind(RollKind.NeedGreed)} /> Need / Greed</label>
      </div>
      <div className="muted">Item (optional)</div>
      <div className="row">
        {picked?.iconUrl && <img className="itemicon" src={picked.iconUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
        <input className="grow" autoFocus placeholder={searchItems ? 'Type a name to search your game plugins' : 'e.g. Zakum Helmet'} value={item}
          onChange={e => { setItem(e.target.value); setPicked(null) }} onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {picked && <div className="muted">From {picked.gameName}{picked.item.rarity ? ` · ${picked.item.rarity}` : ''}</div>}
      {hits.length > 0 && (
        <div className="list">
          {hits.map(h => (
            <div key={h.pluginId + '/' + h.item.id} className="row" onClick={() => { setPicked(h); setItem(h.item.name) }}>
              {h.iconUrl ? <img className="itemicon" src={h.iconUrl} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="itemicon" />}
              <span className={'grow rarity-' + (h.item.rarity ?? 'none').toLowerCase()}>{h.item.name}</span>
              <span className="muted">{h.gameName}</span>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <span className="muted">Qty</span><input style={{ width: 60 }} value={qty} onChange={e => setQty(e.target.value)} />
        <span className="muted" style={{ marginLeft: 12 }}>Range</span>
        <input style={{ width: 80 }} value={min} onChange={e => setMin(e.target.value)} title="Minimum" />
        <span className="muted">–</span>
        <input style={{ width: 80 }} value={max} onChange={e => setMax(e.target.value)} title="Maximum" />
      </div>
      {!rangeOk && <div className="muted" style={{ color: 'var(--red)' }}>Range must be whole numbers with min &lt; max (0 to 1,000,000).</div>}
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit} disabled={!rangeOk}>Start</button></div>
    </Dialog>
  )
}
