import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { MicOff } from 'lucide-react'

const SIZE = 64
const MARGIN = 12
/** How far a finger may move and still count as a tap rather than a drag. */
const TAP_SLOP = 6
const KEY = 'maplecord.callbubble'

interface Spot { side: 'left' | 'right'; top: number }

function loadSpot(): Spot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const spot = JSON.parse(raw) as Spot
    return (spot.side === 'left' || spot.side === 'right') && typeof spot.top === 'number' ? spot : null
  } catch { return null }
}

function saveSpot(spot: Spot) {
  try { localStorage.setItem(KEY, JSON.stringify(spot)) } catch { /* private mode: it starts at the bottom right next time */ }
}

/** Kept clear of the top bar and the message box, whatever the screen's height. */
function clampTop(top: number) {
  const least = 72
  const most = Math.max(least, window.innerHeight - SIZE - 120)
  return Math.min(most, Math.max(least, top))
}

/**
 * On a phone, while in a call but looking at something else: a round button floating over the screen with the face
 * of whoever is talking (ours when nobody is), ringed while someone speaks. A tap goes back to the call; it can be
 * dragged anywhere, and settles against the nearer side, where it is remembered on this device.
 */
export function CallBubble({ face, speaking, muted, label, onOpen }: {
  /** The avatar to show (already sized to fill the bubble). */
  face: ReactNode
  speaking: boolean
  muted: boolean
  /** What a screen reader says, and the tooltip. */
  label: string
  onOpen: () => void
}) {
  const [spot, setSpot] = useState<Spot>(() => loadSpot() ?? { side: 'right', top: clampTop(window.innerHeight - SIZE - 140) })
  /** Where it is while a finger holds it: left and top in pixels. */
  const [held, setHeld] = useState<{ left: number; top: number } | null>(null)
  const drag = useRef<{ startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null)

  // A screen turned on its side, or a window resized: keep it on screen.
  useEffect(() => {
    const keep = () => setSpot(s => ({ ...s, top: clampTop(s.top) }))
    window.addEventListener('resize', keep)
    return () => window.removeEventListener('resize', keep)
  }, [])

  const leftOf = (s: Spot) => (s.side === 'left' ? MARGIN : window.innerWidth - SIZE - MARGIN)

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, left: leftOf(spot), top: spot.top, moved: false }
  }
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return
    d.moved = true
    setHeld({
      left: Math.min(window.innerWidth - SIZE, Math.max(0, d.left + dx)),
      top: Math.min(window.innerHeight - SIZE, Math.max(0, d.top + dy)),
    })
  }
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (!d.moved) { onOpen(); return }
    const at = held ?? { left: d.left, top: d.top }
    const settled: Spot = { side: at.left + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right', top: clampTop(at.top) }
    setHeld(null)
    setSpot(settled)
    saveSpot(settled)
  }

  const style = held ? { left: held.left, top: held.top } : { left: leftOf(spot), top: spot.top }
  return (
    <button className={'callbubble' + (speaking ? ' speaking' : '') + (held ? ' held' : '')} style={style}
      aria-label={label} title={label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setHeld(null) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      onClick={e => e.preventDefault()}>
      {face}
      {muted && <span className="callbubble-muted" aria-hidden="true"><MicOff size={13} /></span>}
    </button>
  )
}
