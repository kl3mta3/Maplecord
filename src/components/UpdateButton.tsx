import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { bridge } from '../platform'

/**
 * "Update now", in the desktop app once a newer version has come out while it is open (it looks once an hour; see
 * electron/updater.ts). Pressed, it downloads the new version, closes the app and starts the new one. Nothing is
 * shown in the web app, which is up to date whenever it is loaded.
 */
export function UpdateButton({ onShown, onError }: { onShown: (shown: boolean) => void; onError: (message: string) => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => {
    const desktop = bridge()
    if (!desktop?.updateFound || !desktop.onUpdateFound) return
    void desktop.updateFound().then(v => { if (v) setVersion(v) })
    const stopFound = desktop.onUpdateFound(setVersion)
    const stopProgress = desktop.onUpdateProgress?.(setProgress) ?? (() => {})
    return () => { stopFound(); stopProgress() }
  }, [])
  useEffect(() => { onShown(!!version) }, [version, onShown])
  if (!version) return null
  const update = async () => {
    setProgress(0)
    const result = await bridge()?.updateNow?.()
    // On success the app closes; anything that comes back means it did not.
    if (!result?.ok) { setProgress(null); onError(result?.error ?? 'The update could not be put in place.') }
  }
  const busy = progress !== null
  return (
    <button className="updatebtn" disabled={busy} title={`Maplecord ${version} is out. Download it, then close and start the new version.`} onClick={() => void update()}>
      <Download size={13} /> {busy ? (progress < 1 ? `Downloading ${Math.round(progress * 100)}%` : 'Restarting…') : 'Update now'}
    </button>
  )
}
