// Press and hold, for touch screens: the right-click menus everywhere in the app open on a finger held still.
//
// Safari on an iPhone or iPad never sends a right-click (contextmenu) at all, so without this every menu that opens on
// right-click (someone in voice, the member list, a name in chat, a channel, a server) could not be reached there. A
// finger held still for HOLD_MS sends the same event a right-click would, at the same spot, so each of those menus
// opens exactly as it does with a mouse. Where the browser already sends one for a long press itself (Android), that
// one is used and this does nothing. Text boxes are left alone: holding in one is for selecting and pasting text.

const HOLD_MS = 500
/** A finger that moves further than this is scrolling or dragging, not holding. */
const STILL_PX = 10

/** Whether a press here is left to the browser: in something written in, where holding selects text. */
export const leftToBrowser = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')

export function installLongPress(doc: Document = document) {
  let timer = 0
  let start: { x: number; y: number; target: EventTarget | null } | null = null
  let nativeSeen = false
  /** The menu was opened by this press. The finger lifting would also count as a tap on what is under it (the menu's
   *  backdrop, which closes it), so that tap is not made: see touchend. */
  let held = false

  const cancel = () => { window.clearTimeout(timer); timer = 0; start = null }

  doc.addEventListener('touchstart', e => {
    cancel()
    if (e.touches.length !== 1 || leftToBrowser(e.target)) return
    const t = e.touches[0]!
    start = { x: t.clientX, y: t.clientY, target: e.target }
    nativeSeen = false
    held = false
    timer = window.setTimeout(() => {
      const at = start
      cancel()
      if (!at || nativeSeen || !(at.target instanceof Element) || !at.target.isConnected) return
      held = true
      at.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 }))
      navigator.vibrate?.(10)
    }, HOLD_MS)
  }, { passive: true })

  doc.addEventListener('touchmove', e => {
    if (!start) return
    const t = e.touches[0]
    if (!t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > STILL_PX) cancel()
  }, { passive: true })
  doc.addEventListener('touchend', e => { if (held) { held = false; e.preventDefault() } cancel() }, { passive: false })
  doc.addEventListener('touchcancel', cancel, { passive: true })
  // The browser sent one of its own for this press (Android does): that is the one, and ours is not sent.
  doc.addEventListener('contextmenu', e => { if (e.isTrusted && timer) { nativeSeen = true; cancel() } }, { capture: true })
}
