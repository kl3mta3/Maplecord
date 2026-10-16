import { useEffect, useState } from 'react'
import { ApiError, TERMS_CHECK_EVENT, type Api } from '../api'
import { Dialog } from './Dialogs'

/**
 * Agreeing to the terms of service of this Maplecord: asked if this account agreed to an older version, or none
 * (accounts made before there were terms), when the app opens or, if the terms change while it is open, as soon as
 * the server says so. It cannot be closed: agree, or sign out. A new account
 * agreed already, on the page where its username was chosen.
 */
export function TermsGate({ api, serverUrl, onSignOut }: { api: Api; serverUrl: string; onSignOut: () => void }) {
  const [due, setDue] = useState<{ current: number; updated: string; first: boolean } | null>(null)
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    // Asked when the app opens, and again whenever the server refuses something until the terms are agreed to, or the
    // live connection drops (new terms come with an updated server, which drops it). A server without terms (an older
    // one) answers 404: nothing to agree to there. Anything else (offline, the server restarting) is asked again, a
    // little later each time, until it answers.
    let stopped = false
    let asking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = (wait: number) => {
      asking = true
      api.terms()
        .then(t => { asking = false; if (!stopped && t.accepted < t.current) setDue({ current: t.current, updated: t.updated, first: t.accepted === 0 }) })
        .catch(e => {
          if (stopped || (e instanceof ApiError && (e.status === 404 || e.unauthorized))) { asking = false; return }
          timer = setTimeout(() => ask(Math.min(wait * 2, 60_000)), wait)
        })
    }
    const again = () => { if (!asking && !stopped) ask(2000) }
    ask(2000)
    window.addEventListener(TERMS_CHECK_EVENT, again)
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener(TERMS_CHECK_EVENT, again) }
  }, [api])
  if (!due) return null
  const base = serverUrl.replace(/\/$/, '')
  const agree = async () => {
    setBusy(true); setProblem(null)
    // Started again once agreed: whatever the server refused before (the servers, the live connection) loads afresh.
    try { await api.agreeToTerms(due.current); window.location.reload() }
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
      <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} style={{ marginTop: 3, flex: 'none' }} />
        <span style={{ flex: 1 }}>I agree to the terms of service and have read the privacy page.</span>
      </label>
      {problem && <div className="error">{problem}</div>}
      <div className="buttons">
        <button className="subtle" style={{ marginRight: 'auto' }} onClick={onSignOut}>Sign out</button>
        <button className="accent" disabled={!ticked || busy} onClick={() => void agree()}>Agree and continue</button>
      </div>
    </Dialog>
  )
}
