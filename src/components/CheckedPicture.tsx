import { useEffect, useState } from 'react'
import { checkPicture, pictureCheckOn, type Verdict } from '../pictureCheck'

/**
 * A picture that is looked at on this device before it is shown (see pictureCheck.ts): blurred while that happens,
 * which is a moment, and left blurred with a button to show it if it may be explicit. With the check switched off
 * in Settings (Status & privacy) the picture is shown as it is.
 */
export function CheckedPicture({ src, checkKey, children }: { src: string; checkKey?: string; children: React.ReactNode }) {
  const on = pictureCheckOn()
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!on) return
    let current = true
    void checkPicture(src, checkKey).then(v => { if (current) setVerdict(v) })
    return () => { current = false }
  }, [src, checkKey, on])
  if (!on || shown || verdict === 'ok' || verdict === 'unknown') return <>{children}</>
  return (
    // While it is blurred, a click shows it (when it may be explicit) and goes no further: not to the picture, which
    // would open it full size, nor to whatever it sits in.
    <span className={'checkedpic' + (verdict === 'explicit' ? ' explicit' : ' checking')}
      onClickCapture={e => { e.stopPropagation(); e.preventDefault(); if (verdict === 'explicit') setShown(true) }}
      role={verdict === 'explicit' ? 'button' : undefined} tabIndex={verdict === 'explicit' ? 0 : undefined} aria-label={verdict === 'explicit' ? 'A picture that may be explicit or revealing. Show it' : undefined}
      onKeyDown={e => { if (verdict === 'explicit' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setShown(true) } }}>
      {children}
      {verdict === 'explicit' && <span className="revealpic" title="Checked on this device: it may be explicit or revealing">May be sensitive · Show</span>}
    </span>
  )
}
