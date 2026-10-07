import { useEffect, useState } from 'react'
import type { Store } from '../store'
import { arrivedToInstall, installWay, onInstallAsked, promptInstall } from '../install'

const cameToInstall = typeof window !== 'undefined' && arrivedToInstall()

/**
 * The card that says how to put Maplecord on a phone's home screen. It shows itself once on a phone or tablet, when
 * someone arrives from the front page's button, and whenever Settings asks for it.
 */
export default function InstallHint({ store }: { store: Store }) {
  const [asked, setAsked] = useState(cameToInstall)
  const [, setTick] = useState(0)
  useEffect(() => onInstallAsked(() => setAsked(true), () => setTick(t => t + 1)), [])

  const way = installWay()
  const firstTime = !store.settings.installHintSeen && window.matchMedia?.('(pointer: coarse)').matches
  if (!way || !(asked || firstTime)) return null
  const close = () => { setAsked(false); store.updateSettings({ installHintSeen: true }) }

  return (
    <div className="installhint" role="dialog" aria-label="Add Maplecord to your Home Screen">
      <img src={import.meta.env.BASE_URL + 'icon-192.png'} alt="" />
      <div className="grow">
        <b>Add Maplecord to your Home Screen</b>
        {way === 'share' && <div className="muted">Tap <span className="sharemark" aria-label="Share">⬆</span> <b>Share</b> in your browser's toolbar, then <b>Add to Home Screen</b>.</div>}
        {way === 'menu' && <div className="muted">Open your browser's menu, then choose <b>Add to Home screen</b> or <b>Install app</b>.</div>}
        {way === 'prompt' && <div className="muted">It opens full screen, like an app of its own.</div>}
        {way !== 'prompt' && <div className="muted">It then opens full screen, like an app of its own. You sign in once more there.</div>}
      </div>
      {way === 'prompt' && <button className="accent" onClick={() => void promptInstall().finally(close)}>Install</button>}
      <button className="subtle" onClick={close}>{way === 'prompt' ? 'Not now' : 'Got it'}</button>
    </div>
  )
}
