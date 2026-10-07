import { appleTouch, isElectron } from './platform'

/**
 * Putting the web app on a phone's home screen, where it opens full screen like an app of its own.
 *
 * An iPhone gives a page no way to do this itself: the person has to use Share, then "Add to Home Screen", so all
 * the app can do there is say how. Chrome (Android, and desktop) hands the page an install prompt it may show later.
 */
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let offered: InstallPrompt | null = null
const ASK = 'maplecord-install'

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offered = e as InstallPrompt; window.dispatchEvent(new Event(ASK + '-ready')) })
  window.addEventListener('appinstalled', () => { offered = null })
}

/** Already opened from the home screen (or installed), so there is nothing to offer. */
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** How this device adds the app: by its own prompt, by the iPhone's Share menu, by the browser's menu, or not at all. */
export type InstallWay = 'prompt' | 'share' | 'menu' | null

export function installWay(): InstallWay {
  if (isElectron() || isInstalled()) return null
  if (offered) return 'prompt'
  if (appleTouch()) return 'share'
  return window.matchMedia?.('(pointer: coarse)').matches ? 'menu' : null
}

/** Shows the browser's own install prompt. True if the person said yes. */
export async function promptInstall(): Promise<boolean> {
  const prompt = offered
  if (!prompt) return false
  offered = null
  await prompt.prompt()
  return (await prompt.userChoice).outcome === 'accepted'
}

/** Ask for the "add to home screen" card to be shown (from Settings, say). */
export const askToInstall = () => window.dispatchEvent(new Event(ASK))

/** Runs `show` whenever the card is asked for, and `changed` when what can be offered changes. */
export function onInstallAsked(show: () => void, changed: () => void): () => void {
  window.addEventListener(ASK, show)
  window.addEventListener(ASK + '-ready', changed)
  return () => { window.removeEventListener(ASK, show); window.removeEventListener(ASK + '-ready', changed) }
}

/** The front page's "Add to Home Screen" button lands here with ?install=1: the card is wanted at once. */
export function arrivedToInstall(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('install') !== '1') return false
  params.delete('install')
  const rest = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''))
  return true
}
