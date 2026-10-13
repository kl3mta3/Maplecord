import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { NAME_EFFECTS, chooseEffect, effectCss, lookOf, withLook, type EffectId, type NameLook } from '../nameEffects'
import { nameStyle } from '../profile'

type Colors = { nameColor: string | null; nameColor2: string | null; nameEffect: string | null }

/** A name drawn in a given look, wherever one is wanted outside the app's own name component: the examples in the editor. */
export function NameSample({ text, look, font }: { text: string; look: NameLook; font: string | null }) {
  const css = effectCss(look)
  return (
    <span className={'uname ' + css.className} data-text={css.layered ? text : undefined}
      style={{ ...nameStyle({ nameFont: font, nameColor: null, nameColor2: null }), ...css.vars } as CSSProperties}>{text}</span>
  )
}

/** One colour of an effect: a picker for any colour. */
function EffectColor({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  return (
    <label className="fxcolor" title={label}>
      <input type="color" value={value} onChange={e => onPick(e.target.value)} aria-label={label} />
      <span>{label}</span>
    </label>
  )
}

/**
 * Choosing how one's name is drawn: a drop-down in which every effect is shown as an example on the person's own
 * name, and under it whatever the chosen one can be changed in (its colours, its angle, ready-made sets of colours).
 */
export function NameEffectEditor({ name, font, value, onChange }: { name: string; font: string | null; value: Colors; onChange: (patch: Colors) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const look = lookOf(value)
  const kind = look.kind

  // Closed by a click anywhere else, or Escape (without closing the editor it is in).
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', key, true) }
  }, [open])

  const pick = (id: EffectId) => { onChange(chooseEffect(id, value)); setOpen(false) }
  /** Each example is the effect in its own usual colours, except the one in use, which is shown as it is. */
  const example = (id: EffectId) => (id === kind.id ? look : lookOf(chooseEffect(id, {})))

  return (
    <div className="fxeditor">
      <div className="muted">Name effect <span>— a server's role color takes its place there</span></div>
      <div className="fxdrop" ref={box}>
        <button type="button" className="fxhead" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <NameSample text={name} look={look} font={font} />
          <small>{kind.label}</small>
          <span className="fxarrow" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="fxlist" role="listbox" aria-label="Name effect">
            {NAME_EFFECTS.map(e => (
              <button type="button" key={e.id} role="option" aria-selected={e.id === kind.id} className={'fxchoice' + (e.id === kind.id ? ' sel' : '')} onClick={() => pick(e.id)}>
                <NameSample text={name} look={example(e.id)} font={font} />
                <small>{e.label}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="fxoptions">
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {kind.id === 'solid' && (
            <button type="button" className={'subtle' + (look.plain ? ' sel' : '')} onClick={() => onChange({ nameColor: null, nameColor2: null, nameEffect: null })}>No color</button>
          )}
          {kind.colors.map((c, i) => (
            <EffectColor key={kind.id + i} label={c.label} value={look.colors[i]!} onPick={hex => onChange(withLook(look, { color: [i, hex] }))} />
          ))}
        </div>
        {look.angle !== null && (
          <label className="fxangle">
            <span className="muted">Angle</span>
            <input type="range" min={0} max={355} step={5} value={look.angle} onChange={e => onChange(withLook(look, { angle: Number(e.target.value) }))} />
            <span className="muted">{look.angle}°</span>
          </label>
        )}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {kind.presets.map((colors, i) => (
            <button type="button" key={i} className="fxpreset" title="Use these colors" aria-label={`Colors ${i + 1}`}
              style={{ background: colors.length > 1 ? `linear-gradient(90deg, ${colors.join(', ')})` : colors[0] }}
              onClick={() => onChange(withLook(look, { colors }))} />
          ))}
        </div>
      </div>
    </div>
  )
}
