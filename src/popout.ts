/**
 * A stream in a window of its own: resizable, movable to another monitor, and able to go full screen there.
 *
 * The window is a blank page this app fills in itself. It is opened by, and belongs to, the main window, so the
 * live video can simply be handed across; nothing is loaded from anywhere and the stream is not sent a second time.
 */

const open = new Set<Window>()

/** True while any popped-out stream is on screen. A stream being watched there must not be paused just because the main window is hidden. */
export function anyPopoutVisible(): boolean {
  for (const w of open) {
    if (w.closed) { open.delete(w); continue }
    if (!w.document.hidden) return true
  }
  return false
}

export interface Popout {
  window: Window
  setStream(stream: MediaStream | null): void
  /** How loud the stream's sound is played in this window, 0 to 1, or not at all. */
  setAudio(volume: number, muted: boolean): void
  setTitle(title: string): void
  close(): void
}

const STYLE = `
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; }
  video { width: 100vw; height: 100vh; object-fit: contain; display: block; background: #000; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 8px; align-items: center; padding: 8px 10px;
         background: linear-gradient(transparent, rgba(0, 0, 0, 0.8)); color: #e8e8f0; font-size: 13px; opacity: 0; transition: opacity 0.15s; }
  body:hover .bar, .bar:focus-within { opacity: 1; }
  .bar .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar button { font: inherit; color: inherit; cursor: pointer; background: rgba(38, 38, 52, 0.9); border: 1px solid #2e2e3e; border-radius: 4px; padding: 5px 10px; font-weight: 600; }
  .bar button:hover { filter: brightness(1.2); }
  .wait { position: fixed; inset: 0; display: grid; place-items: center; color: #9a9ab0; font-size: 14px; }
`

/**
 * Opens the window. Returns null when the browser refuses to open one (a pop-up blocker); the caller can then fall
 * back to something else. `onClosed` runs when the person closes the window themselves.
 */
export function openPopout(key: string, title: string, onClosed: () => void, onVisibility: () => void): Popout | null {
  const w = window.open('about:blank', 'maplecord-stream-' + key.replace(/[^A-Za-z0-9_-]/g, ''), 'popup,width=960,height=540')
  if (!w) return null
  const doc = w.document
  doc.title = title
  doc.head.append(Object.assign(doc.createElement('style'), { textContent: STYLE }))

  const video = doc.createElement('video')
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  const waiting = Object.assign(doc.createElement('div'), { className: 'wait', textContent: 'Connecting…' })
  const label = Object.assign(doc.createElement('span'), { className: 'grow', textContent: title })
  const full = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'Full screen' })
  const back = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'Put back' })
  const bar = Object.assign(doc.createElement('div'), { className: 'bar' })
  bar.append(label, full, back)
  doc.body.append(video, waiting, bar)

  const toggleFull = () => { void (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen()).catch(() => {}) }
  full.addEventListener('click', toggleFull)
  video.addEventListener('dblclick', toggleFull)
  doc.addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') toggleFull() })
  doc.addEventListener('fullscreenchange', () => { full.textContent = doc.fullscreenElement ? 'Leave full screen' : 'Full screen' })
  doc.addEventListener('visibilitychange', onVisibility)

  let closedByUs = false
  const finish = () => {
    window.clearInterval(watch)
    open.delete(w)
    if (!closedByUs) onClosed()
  }
  back.addEventListener('click', () => w.close())
  // There is no dependable "closed" event for a window opened this way, so it is looked at twice a second.
  const watch = window.setInterval(() => { if (w.closed) finish() }, 500)
  open.add(w)

  return {
    window: w,
    setStream(stream) {
      if (video.srcObject !== stream) video.srcObject = stream
      waiting.style.display = stream ? 'none' : 'grid'
      if (stream) void video.play().catch(() => { /* starts by itself when data arrives */ })
    },
    setAudio(volume, muted) { video.muted = muted; video.volume = Math.max(0, Math.min(1, volume)) },
    setTitle(text) { doc.title = text; label.textContent = text },
    close() {
      closedByUs = true
      window.clearInterval(watch)
      open.delete(w)
      if (!w.closed) w.close()
    },
  }
}
