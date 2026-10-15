import { useEffect, useState } from 'react'
import type { Api } from '../api'
import { Dialog } from './Dialogs'

/**
 * Agreeing to the terms of service of this Maplecord: asked once the app opens if this account agreed to an older
 * version, or none (accounts made before there were terms). It cannot be closed: agree, or sign out. A new account
 * agreed already, on the page where its username was chosen.
 */
export function TermsGate({ api, serverUrl, onSignOut }: { api: Api; serverUrl: string; onSignOut: () => void }) {
  const [due, setDue] = useState<{ current: number; updated: string; first: boolean } | null>(null)
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    // A server without terms (an older one) answers 404: nothing to agree to there.
    void api.terms().then(t => { if (t.accepted < t.current) setDue({ current: t.current, updated: t.updated, first: t.accepted === 0 }) }).catch(() => {})
  }, [api])
  if (!due) return null
  const base = serverUrl.replace(/\/$/, '')
  const agree = async () => {
    setBusy(true); setProblem(null)
    try { await api.agreeToTerms(due.current); setDue(null) }
    catch (e) { setProblem(e instanceof Error ? e.message : 'It could not be saved. Try again.') }
    finally { setBusy(false) }
  }
  return (
    <Dialog title={due.first ? 'Terms of service' : 'The terms have changed'} onClose={() => {}}>
      <div>{due.first ? 'To keep using Maplecord, read and agree to its terms of service.' : `The terms of service were updated on ${due.updated}. To keep using Maplecord, read and agree to them.`}</div>
      <div className="row" style={{ gap: 12 }}>
        <a href={`${base}/terms`} target="_blank" rel="noreferrer noopener">Terms of service</a>
        <a href={`${base}/privacy`} target="_blank" rel="noreferrer noopener">Privacy page</a>
      </div>
      <label className="row" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} />
        <span>I agree to the terms of service and have read the privacy page.</span>
      </label>
      {problem && <div className="error">{problem}</div>}
      <div className="buttons">
        <button className="subtle" style={{ marginRight: 'auto' }} onClick={onSignOut}>Sign out</button>
        <button className="accent" disabled={!ticked || busy} onClick={() => void agree()}>Agree and continue</button>
      </div>
    </Dialog>
  )
}
