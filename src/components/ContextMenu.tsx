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
  /** A row that opens a little menu of its own beside this one. */
  | { kind: 'submenu'; label: string; entries: MenuEntry[] }

/**
 * A menu at the pointer. Closes on a click elsewhere, Escape, or picking an action; ticks and sliders keep it open
 * so several things can be changed in one visit. `entries` is rebuilt by the caller on every render, so ticks and
 * slider values follow the state they change.
 *
 * A row can open a second menu beside the first (to the right, or to the left where there is no room). It opens when
 * the pointer rests on the row or the row is pressed, and closes with the main menu or when another row takes over.
 */
export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  /** The side menu that is open: which row it belongs to, and where that row is on screen. */
  const [side, setSide] = useState<{ label: string; top: number } | null>(null)
  const [sidePos, setSidePos] = useState<{ left: number; top: number } | null>(null)
  const sideEntries = side ? entries.find((e): e is Extract<MenuEntry, { kind: 'submenu' }> => e.kind === 'submenu' && e.label === side.label)?.entries ?? null : null

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - height - 4)) })
  }, [x, y, entries.length])

  // The side menu sits against its row: to the right of the main menu, or to its left when that would run off screen.
  useLayoutEffect(() => {
    const el = sideRef.current, main = ref.current
    if (!side || !el || !main) { setSidePos(null); return }
    const mine = el.getBoundingClientRect(), menu = main.getBoundingClientRect()
    const right = menu.right + 2
    const left = right + mine.width <= window.innerWidth - 4 ? right : Math.max(4, menu.left - mine.width - 2)
    setSidePos({ left, top: Math.max(4, Math.min(side.top - 6, window.innerHeight - mine.height - 4)) })
  }, [side, sideEntries?.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const row = (entry: MenuEntry, i: number, inSide: boolean) => {
    // Resting on any other row of the main menu puts the side menu away.
    const leave = inSide ? undefined : () => setSide(null)
    if (entry.kind === 'sep') return <div key={i} className="sep" />
    if (entry.kind === 'label') return <div key={i} className="heading">{entry.text}</div>
    if (entry.kind === 'slider') {
      return (
        <div key={i} className="sliderrow" onMouseEnter={leave}>
          <div className="row"><span className="grow">{entry.label}</span><span className="muted">{entry.format(entry.value)}</span></div>
          <input type="range" min={entry.min} max={entry.max} step={entry.step} value={entry.value} onChange={e => entry.onChange(Number(e.target.value))} />
        </div>
      )
    }
    if (entry.kind === 'submenu') {
      const openHere = side?.label === entry.label
      const show = (e: React.SyntheticEvent<HTMLElement>) => setSide({ label: entry.label, top: e.currentTarget.getBoundingClientRect().top })
      return (
        <button key={i} role="menuitem" aria-haspopup="menu" aria-expanded={openHere} className={'item' + (openHere ? ' opened' : '')} onMouseEnter={show} onClick={show}>
          <span>{entry.label}</span>
          <span className="ico">▸</span>
        </button>
      )
    }
    const toggle = entry.checked !== undefined
    return (
      <button key={i} role={toggle ? 'menuitemcheckbox' : 'menuitem'} aria-checked={toggle ? entry.checked : undefined} disabled={entry.disabled}
        className={'item' + (entry.danger ? ' danger' : '')} onMouseEnter={leave} onClick={() => { entry.onClick(); if (!toggle) onClose() }}>
        <span>{entry.label}</span>
        <span className="ico">{toggle ? (entry.checked ? '✓' : '') : entry.icon}</span>
      </button>
    )
  }

  return (
    <>
      <div className="menubackdrop" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div ref={ref} className="menu contextmenu" role="menu" style={pos} onContextMenu={e => e.preventDefault()}>
        {entries.map((entry, i) => row(entry, i, false))}
      </div>
      {side && sideEntries && (
        // Placed once it has been measured; until then it is laid out where it cannot be seen.
        <div ref={sideRef} className="menu contextmenu sidemenu" role="menu" onContextMenu={e => e.preventDefault()}
          style={sidePos ?? { left: 0, top: 0, visibility: 'hidden' }}>
          {sideEntries.map((entry, i) => row(entry, i, true))}
        </div>
      )}
    </>
  )
}
