/**
 * If the app fails before it has drawn anything, says why on the screen instead of leaving it blank. On a phone there
 * is no console to look in (the iPhone app has no developer tools without a Mac), so the words on screen are the only
 * way to learn what went wrong. Imported first in main.tsx, so it is listening before anything else runs. Once the
 * app has drawn itself, it stands aside.
 */
const root = () => document.getElementById('root')
let shown = false

function show(what: string) {
  const at = root()
  if (shown || !at || at.childElementCount > 0) return
  shown = true
  const box = document.createElement('pre')
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;margin:0;padding:calc(24px + env(safe-area-inset-top, 0px)) 16px 24px;white-space:pre-wrap;word-break:break-word;font:13px/1.4 ui-monospace,monospace;color:#ffb4b4;background:#0b0b10;box-sizing:border-box'
  box.textContent = 'Maplecord could not start.\n\n' + what + '\n\n' + navigator.userAgent
  document.body.appendChild(box)
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', e => show(`${e.message}\n${e.filename ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}${e.error instanceof Error && e.error.stack ? '\n' + e.error.stack : ''}`))
  window.addEventListener('unhandledrejection', e => show(e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack ?? ''}` : String(e.reason)))
  // Nothing drawn and nothing thrown after a while: say that too, rather than a blank screen.
  window.setTimeout(() => show('Nothing was drawn within 15 seconds, and no error was reported.'), 15_000)
}

export {}
