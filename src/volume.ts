import { appleTouch } from './platform'

/**
 * iPhones and iPads play a page's audio and video at full volume whatever the page asks for: setting `volume` on the
 * element does nothing there, only muting works. Sound that needs a volume of its own is played through Web Audio on
 * those devices instead, with the element itself kept silent.
 */
let ignored: boolean | null = null

export function elementVolumeIgnored(): boolean {
  ignored ??= appleTouch()
  return ignored
}

let context: AudioContext | null = null

/** Start it (again). A phone only lets it run once the page has been tapped, and stops it in the background. */
export function wakeGainContext() {
  if (context && context.state !== 'running') void context.resume().catch(() => { /* not until a tap */ })
}

/** The one audio context that sound is played through when it needs a volume the element cannot give it. */
export function gainContext(): AudioContext | null {
  if (!context) {
    try { context = new AudioContext() } catch { return null }
    document.addEventListener('pointerdown', wakeGainContext, true)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeGainContext() })
  }
  wakeGainContext()
  return context
}
