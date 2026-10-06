import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** One row of a right-click menu. */
export type MenuEntry =
  | { kind: 'label'; text: string }
  | { kind: 'sep' }
  | {
      kind: 'item'; label: string; icon?: string; onClick: () => void
      danger?: boolean; disabled?: boolean
      /** Draws a tick (or an empty box) and keeps the menu open, for switches and one-of-several choices. */
      checked?: boolean
    }
  | { kind: 'slider'; label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }

/**
 * A menu at the pointer. Closes on a click elsewhere, Escape, or picking an action; ticks and sliders keep it open
 * so several things can be changed in one visit. `entries` is rebuilt by the caller on every render, so ticks and
 * slider values follow the state they change.
 */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - height - 4)) })
  }, [x, y, entries.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="menubackdrop" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div ref={ref} className="menu contextmenu" role="menu" style={pos} onContextMenu={e => e.preventDefault()}>
        {entries.map((entry, i) => {
          if (entry.kind === 'sep') return <div key={i} className="sep" />
          if (entry.kind === 'label') return <div key={i} className="heading">{entry.text}</div>
          if (entry.kind === 'slider') {
            return (
              <div key={i} className="sliderrow">
                <div className="row"><span className="grow">{entry.label}</span><span className="muted">{entry.format(entry.value)}</span></div>
                <input type="range" min={entry.min} max={entry.max} step={entry.step} value={entry.value} onChange={e => entry.onChange(Number(e.target.value))} />
              </div>
            )
          }
          const toggle = entry.checked !== undefined
          return (
            <button key={i} role={toggle ? 'menuitemcheckbox' : 'menuitem'} aria-checked={toggle ? entry.checked : undefined} disabled={entry.disabled}
              className={'item' + (entry.danger ? ' danger' : '')} onClick={() => { entry.onClick(); if (!toggle) onClose() }}>
              <span>{entry.label}</span>
              <span className="ico">{toggle ? (entry.checked ? '✓' : '') : entry.icon}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
