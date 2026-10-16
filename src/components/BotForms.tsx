import { useState } from 'react'
import type { ModalRequestDto, SelectDto } from '../types'

/**
 * The menus under a bot's message. One that takes a single choice is a plain drop-down: choosing sends it. One that
 * takes several opens a list of boxes to tick, sent with its button once enough are ticked.
 */
export function MessageMenus({ selects, onChoose }: { selects: SelectDto[]; onChoose?: (selectId: string, values: string[]) => void }) {
  return (
    <div className="msgmenus">
      {selects.map(s => ((s.maxValues ?? 1) === 1 && (s.minValues ?? 1) === 1
        ? <SingleMenu key={s.id} select={s} onChoose={onChoose} />
        : <ManyMenu key={s.id} select={s} onChoose={onChoose} />))}
    </div>
  )
}

function SingleMenu({ select, onChoose }: { select: SelectDto; onChoose?: (selectId: string, values: string[]) => void }) {
  return (
    // Back to the placeholder after each choice: a menu is something to choose from again, not a setting that stays.
    <select value="" disabled={!onChoose} aria-label={select.placeholder ?? 'Choose'}
      onChange={e => { const v = e.target.value; e.target.value = ''; if (v) onChoose?.(select.id, [v]) }}>
      <option value="" disabled>{select.placeholder || 'Choose…'}</option>
      {select.options.map(o => <option key={o.value} value={o.value} title={o.description ?? undefined}>{o.label}</option>)}
    </select>
  )
}

function ManyMenu({ select, onChoose }: { select: SelectDto; onChoose?: (selectId: string, values: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const least = select.minValues ?? 1, most = select.maxValues ?? 1
  const toggle = (v: string) => setPicked(p => (p.includes(v) ? p.filter(x => x !== v) : p.length < most ? [...p, v] : p))
  const says = least === most ? `Choose ${most}` : least === 0 ? `Choose up to ${most}` : `Choose ${least} to ${most}`
  return (
    <div className="manymenu">
      <button className="subtle" disabled={!onChoose} aria-expanded={open} onClick={() => setOpen(o => !o)}>{select.placeholder || says} ▾</button>
      {open && (
        <div className="manymenu-list" role="group" aria-label={select.placeholder ?? says}>
          {select.options.map(o => (
            <label key={o.value} className="row" title={o.description ?? undefined}>
              <input type="checkbox" checked={picked.includes(o.value)} onChange={() => toggle(o.value)} disabled={!picked.includes(o.value) && picked.length >= most} />
              <span>{o.label}{o.description && <span className="muted"> · {o.description}</span>}</span>
            </label>
          ))}
          <div className="row">
            <span className="muted grow">{says}</span>
            <button className="accent" disabled={picked.length < least || picked.length > most}
              onClick={() => { onChoose?.(select.id, picked); setPicked([]); setOpen(false) }}>Send</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A form a bot asked this person to fill in. Sent with the button; what the server turns down (a box left empty, too
 * long) is shown here and the form stays open to be put right.
 */
export function BotFormDialog({ request, onSubmit, onClose }: { request: ModalRequestDto; onSubmit: (fields: Record<string, string>) => Promise<void>; onClose: () => void }) {
  const { modal } = request
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(modal.fields.map(f => [f.id, f.value ?? ''])))
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true); setProblem('')
    try { await onSubmit(values) }
    catch (e) { setProblem((e instanceof Error ? e.message : String(e)).replace(/^.*HubException: /, '')) }
    finally { setBusy(false) }
  }
  return (
    <div className="backdrop" onClick={onClose}>
      <form className="dialog" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void send() }} aria-label={modal.title}>
        <h3>{modal.title}</h3>
        <div className="muted">Asked by {request.botName}. What you enter is sent to it.</div>
        {modal.fields.map(f => (
          <label key={f.id} className="formfield">
            <span>{f.label}{f.required !== false && <span className="muted"> *</span>}</span>
            {f.paragraph
              ? <textarea rows={4} value={values[f.id] ?? ''} placeholder={f.placeholder ?? undefined} maxLength={f.maxLength ?? 4000} required={f.required !== false}
                  onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} disabled={busy} />
              : <input value={values[f.id] ?? ''} placeholder={f.placeholder ?? undefined} maxLength={f.maxLength ?? 4000} required={f.required !== false}
                  onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} disabled={busy} />}
          </label>
        ))}
        {problem && <div className="error">{problem}</div>}
        <div className="buttons">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="accent" disabled={busy}>Send</button>
        </div>
      </form>
    </div>
  )
}
