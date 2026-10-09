import { useRef } from 'react'

/** The two columns beside the chat whose width can be changed: the channel list and the member list. */
export const COLUMNS = {
  sidebar: { usual: 236, least: 180, most: 420, label: 'Width of the channel list' },
  members: { usual: 220, least: 160, most: 420, label: 'Width of the member list' },
} as const
export type Column = keyof typeof COLUMNS
/** The least room the chat between them keeps, however wide they are made. */
export const CHAT_LEAST = 360

export const clampColumn = (column: Column, width: number) => Math.round(Math.min(COLUMNS[column].most, Math.max(COLUMNS[column].least, width)))

/**
 * The edge between a column and the chat. Dragged, or moved with the arrow keys while it has the keyboard, it makes
 * its column wider or narrower; double-clicked, it puts the column back as it was made. `onSettle` is told the width
 * to remember once the dragging is over (null = the usual one).
 */
export function ColumnGrip({ column, width, onChange, onSettle }: { column: Column; width: number; onChange: (width: number) => void; onSettle: (width: number | null) => void }) {
  const drag = useRef<{ x: number; from: number; now: number } | null>(null)
  // The channel list grows to the right; the member list, on the other side of the chat, grows to the left.
  const way = column === 'sidebar' ? 1 : -1
  const limits = COLUMNS[column]
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.now !== d.from) onSettle(d.now)
  }
  return (
    <div className={'colgrip ' + column} role="separator" aria-orientation="vertical" aria-label={limits.label} tabIndex={0}
      aria-valuenow={width} aria-valuemin={limits.least} aria-valuemax={limits.most} title="Drag to resize. Double-click to put it back."
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        drag.current = { x: e.clientX, from: width, now: width }
        // So the drag carries on when the pointer leaves this thin strip. (A pointer that cannot be held is still followed while it is over it.)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a pointer that can be held */ }
      }}
      onPointerMove={e => { const d = drag.current; if (!d) return; d.now = clampColumn(column, d.from + way * (e.clientX - d.x)); onChange(d.now) }}
      onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => { onChange(limits.usual); onSettle(null) }}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const next = clampColumn(column, width + way * (e.key === 'ArrowRight' ? 16 : -16))
        onChange(next); onSettle(next)
      }} />
  )
}
