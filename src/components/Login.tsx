import { useEffect, useState } from 'react'
import { bridge, DEFAULT_SERVER_URL } from '../platform'
import type { Store } from '../store'
import { ADD_ONLY_SIGN_INS, SIGN_IN_NAMES, signInProblem } from './SignIn'

/** Where a browser keeps the ticket of a sign-in that is waiting on an email, across the trip to the sign-in service and back. */
export const PENDING_SIGN_IN = 'maplecord.pendingSignIn'
type Waiting = { ticket: string; email: string }
/** The services shown straight away; any others the server offers are behind "More ways to sign in". */
const SHOWN_FIRST = ['google', 'github', 'microsoft']
const BEHIND_MORE = ['twitch', 'steam', 'battlenet']

function waitingSignIn(): Waiting | null {
  try { const kept = sessionStorage.getItem(PENDING_SIGN_IN); return kept ? JSON.parse(kept) as Waiting : null } catch { return null }
}

export default function Login({ store, onSignedIn }: { store: Store; onSignedIn: () => void }) {
  // The server this app was made for. There is no choosing another one here.
  const serverUrl = DEFAULT_SERVER_URL
  const [providers, setProviders] = useState<string[] | null>(null)
  const [more, setMore] = useState(false)
  const [devUsername, setDevUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // A new person on a server that wants the email confirmed first: nothing more happens here until the link is opened.
  const [waiting, setWaitingState] = useState<Waiting | null>(waitingSignIn)
  const setWaiting = (w: Waiting | null) => {
    setWaitingState(w)
    try { if (w) sessionStorage.setItem(PENDING_SIGN_IN, JSON.stringify(w)); else sessionStorage.removeItem(PENDING_SIGN_IN) } catch { /* private browsing: it is only kept while this page is open */ }
  }

  const check = async () => {
    setBusy(true); setStatus('Checking server…')
    try {
      const list = await store.api.providers(serverUrl)
      setProviders(list)
      setStatus(list.length === 0 ? 'Server has no sign-in providers configured.' : '')
      store.updateSettings({ serverUrl: serverUrl.replace(/\/$/, '') })
    } catch (e) {
      setProviders(null)
      setStatus(`Could not reach Maplecord: ${e instanceof Error ? e.message : e}`)
    } finally { setBusy(false) }
  }
  useEffect(() => { void check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (token: { accessToken: string; expiresAt: string; user: Store['settings']['user'] }) => {
    store.updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
    onSignedIn()
  }

  const loginWith = async (provider: string) => {
    setBusy(true); setStatus('Waiting for sign-in in your browser…')
    try {
      const b = bridge()
      if (b) {
        const result = await b.oauthSignIn(serverUrl, provider)
        if (result.code) finish(await store.api.exchangeCode(serverUrl, result.code))
        else if (result.pending) setWaiting({ ticket: result.pending, email: result.email ?? '' })
        setStatus(result.code || result.pending ? '' : signInProblem(result.error ?? 'login_failed'))
        return
      } else {
        // Plain browser: round-trip through the provider and come back to this page with ?code=.
        const redirect = window.location.origin + window.location.pathname
        window.location.href = `${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(redirect)}`
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  // Has the link been opened? Asked when the button is pressed and when this window is come back to, never on a timer.
  const checkWaiting = async (quiet = false) => {
    if (!waiting) return
    try {
      const answer = await store.api.pendingSignIn(serverUrl, waiting.ticket)
      if (answer === 'waiting') { if (!quiet) setStatus('Not confirmed yet. Open the link in the message, then press this again.') }
      else { setWaiting(null); finish(answer) }
    } catch (e) { setWaiting(null); setStatus(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    if (!waiting) return
    const back = () => { if (document.visibilityState === 'visible') void checkWaiting(true) }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked afresh each time the window is come back to
  }, [waiting?.ticket, serverUrl])

  const devLogin = async () => {
    if (!devUsername.trim()) { setStatus('Enter a username.'); return }
    setBusy(true)
    try { finish(await store.api.devLogin(serverUrl, devUsername.trim())) }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const first = SHOWN_FIRST.filter(p => providers?.includes(p))
  const rest = BEHIND_MORE.filter(p => providers?.includes(p))
  // With none of the first three on offer, the others are simply shown.
  const open = more || first.length === 0
  const button = (p: string) => (
    <button key={p} className="provider" onClick={() => loginWith(p)} disabled={busy}
      title={ADD_ONLY_SIGN_INS.includes(p) ? `For accounts that have added ${SIGN_IN_NAMES[p]} as a way to sign in. It cannot start a new account.` : undefined}>Sign in with {SIGN_IN_NAMES[p]}</button>
  )

  return (
    <div className="login">
      <div className="card">
        <div className="brand"><img src={import.meta.env.BASE_URL + 'logo.png'} alt="" /><h1>Maplecord</h1></div>
        <div className="muted tagline">Loot rolling, chat and voice for your party</div>

        {waiting ? (
          <>
            <h3 style={{ margin: '8px 0 0' }}>Check your email</h3>
            <div className="muted">A link was sent to {waiting.email || 'your address'}. Open it to finish making your account, then come back here.</div>
            <button className="provider" onClick={() => void checkWaiting()} disabled={busy}>I have opened the link</button>
            <button className="subtle" onClick={() => { setWaiting(null); setStatus('') }}>Start again</button>
          </>
        ) : (
          <>
            {first.map(button)}
            {first.length > 0 && rest.length > 0 && (
              <button className="subtle more" onClick={() => setMore(on => !on)} aria-expanded={open}>{open ? 'Fewer ways to sign in' : 'More ways to sign in'}</button>
            )}
            {open && rest.map(button)}
          </>
        )}
        {!waiting && providers?.includes('dev') && (
          <>
            <div className="muted" style={{ marginTop: 8 }}>Development login (no OAuth app needed)</div>
            <div className="row">
              <input className="grow" placeholder="Username" value={devUsername} onChange={e => setDevUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && devLogin()} disabled={busy} />
              <button className="accent" onClick={devLogin} disabled={busy}>Sign in</button>
            </div>
          </>
        )}

        {(status || store.farewell || store.error) && <div className="muted" style={{ marginTop: 8 }}>{status || store.farewell || store.error}</div>}
        {providers === null && !busy && <button onClick={() => void check()}>Try again</button>}
      </div>
    </div>
  )
}
