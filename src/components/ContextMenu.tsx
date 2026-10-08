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
 *
 * From the keyboard: up and down move through the rows (Home and End jump to the ends), Enter or Space picks one,
 * right opens a row's side menu and left comes back out of it, Escape or Tab closes the menu. When it closes the
 * keyboard goes back to whatever had it before.
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

  /** Set when a side menu was opened from the keyboard, so the keyboard follows into it once it is on screen. */
  const intoSide = useRef(false)
  const rowsOf = (menu: HTMLElement | null) => (menu ? [...menu.querySelectorAll<HTMLElement>('button.item:not(:disabled), input[type="range"]')] : [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab') { e.preventDefault(); onClose(); return }
      const at = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const inSide = !!at && !!sideRef.current?.contains(at)
      const rows = rowsOf(inSide ? sideRef.current : ref.current)
      const i = at ? rows.indexOf(at) : -1
      const go = (to: number) => { e.preventDefault(); rows[(to + rows.length) % rows.length]?.focus() }
      if (rows.length === 0) return
      if (e.key === 'ArrowDown') go(i + 1)
      else if (e.key === 'ArrowUp') go(i < 0 ? rows.length - 1 : i - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(rows.length - 1)
      else if (e.key === 'ArrowRight' && !inSide && at?.getAttribute('aria-haspopup') === 'menu') { e.preventDefault(); intoSide.current = true; at.click() }
      else if (e.key === 'ArrowLeft' && inSide && at?.tagName !== 'INPUT') {
        e.preventDefault()
        const opener = ref.current?.querySelector<HTMLElement>('[aria-expanded="true"]')
        setSide(null)
        opener?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The menu takes the keyboard as it opens, and hands it back as it closes.
  useEffect(() => {
    const before = document.activeElement
    ref.current?.focus()
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus() }
  }, [])
  useEffect(() => {
    if (!intoSide.current || !sidePos) return
    intoSide.current = false
    rowsOf(sideRef.current)[0]?.focus()
  }, [sidePos])

  const row = (entry: MenuEntry, i: number, inSide: boolean) => {
    // Resting on any other row of the main menu puts the side menu away.
    const leave = inSide ? undefined : () => setSide(null)
    if (entry.kind === 'sep') return <div key={i} className="sep" />
    if (entry.kind === 'label') return <div key={i} className="heading">{entry.text}</div>
    if (entry.kind === 'slider') {
      return (
        <div key={i} className="sliderrow" onMouseEnter={leave}>
          <div className="row"><span className="grow">{entry.label}</span><span className="muted">{entry.format(entry.value)}</span></div>
          <input type="range" aria-label={entry.label} aria-valuetext={entry.format(entry.value)} min={entry.min} max={entry.max} step={entry.step} value={entry.value} onChange={e => entry.onChange(Number(e.target.value))} />
        </div>
      )
    }
    if (entry.kind === 'submenu') {
      const openHere = side?.label === entry.label
      const show = (e: React.SyntheticEvent<HTMLElement>) => setSide({ label: entry.label, top: e.currentTarget.getBoundingClientRect().top })
      // Pressed from the keyboard (a click with no pointer behind it), the keyboard goes into the side menu.
      const press = (e: React.MouseEvent<HTMLElement>) => { if (e.detail === 0) intoSide.current = true; show(e) }
      return (
        <button key={i} role="menuitem" aria-haspopup="menu" aria-expanded={openHere} className={'item' + (openHere ? ' opened' : '')} onMouseEnter={show} onClick={press}>
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
      <div ref={ref} className="menu contextmenu" role="menu" tabIndex={-1} style={pos} onContextMenu={e => e.preventDefault()}>
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
