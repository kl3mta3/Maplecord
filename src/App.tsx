import { useEffect, useState } from 'react'
import { PENDING_SIGN_IN } from './components/Login'
import { signInProblem } from './components/SignIn'
import Login from './components/Login'
import Overlay from './components/Overlay'
import Shell from './components/Shell'
import InstallHint from './components/InstallHint'
import { PENDING_DELETE, PENDING_DIRECT, useMaplecord } from './store'
import { hasValidToken } from './settings'
import { ApiError } from './api'
import { CLIENT_PROTOCOL } from './platform'
import { rememberInviteFromAddress } from './invites'

const isOverlayWindow = new URLSearchParams(window.location.search).get('overlay') === '1'
if (!isOverlayWindow) rememberInviteFromAddress()
if (isOverlayWindow) document.documentElement.classList.add('overlay-mode')

export default function App() {
  // The overlay window renders only the compact roll card; it has no store, no connection.
  if (isOverlayWindow) return <Overlay />
  return <MainApp />
}

function MainApp() {
  const store = useMaplecord()
  const [checking, setChecking] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  /** Set when the server no longer accepts this build. */
  const [outdated, setOutdated] = useState(false)

  // Auto-login with a stored token, and finish a browser-mode OAuth redirect (?code=...).
  useEffect(() => {
    (async () => {
      // An old build talking to a newer server fails in confusing ways, so ask first and say "update" plainly.
      const meta = await store.api.meta(store.settings.serverUrl)
      if (meta && meta.minClientProtocol > CLIENT_PROTOCOL) { setOutdated(true); setChecking(false); return }

      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      // The sign-in did not go through, or a new person has to confirm their email first: the sign-in screen says which.
      const refused = params.get('error')
      const pendingTicket = params.get('pending')
      if (refused || pendingTicket) {
        if (refused) store.setError(signInProblem(refused))
        try { if (pendingTicket) sessionStorage.setItem(PENDING_SIGN_IN, JSON.stringify({ ticket: pendingTicket, email: params.get('email') ?? '' })) } catch { /* private browsing */ }
        window.history.replaceState({}, '', window.location.pathname)
      }
      // Set when this page left for the sign-in provider only to prove who is here, so that P2P could be allowed.
      const provingFor = sessionStorage.getItem(PENDING_DIRECT)
      sessionStorage.removeItem(PENDING_DIRECT)
      // The same, when the reason was deleting the account: the question is asked once more on return, never assumed.
      const deletingFor = sessionStorage.getItem(PENDING_DELETE)
      sessionStorage.removeItem(PENDING_DELETE)
      let allowDirectNow = false
      let confirmDeleteNow = false
      if (code) {
        try {
          const token = await store.api.exchangeCode(store.settings.serverUrl, code)
          const expected = provingFor ?? deletingFor
          if (expected !== null && token.user.id !== expected) {
            // Someone else's sign-in proves nothing about this account, and does not replace it.
            store.setError(deletingFor !== null ? 'That sign-in is a different account, so nothing was deleted.' : 'That sign-in is a different account, so P2P was not turned on.')
          } else {
            store.updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
            allowDirectNow = provingFor !== null
            confirmDeleteNow = deletingFor !== null
          }
        } catch (e) { store.setError(e instanceof Error ? e.message : String(e)) }
        window.history.replaceState({}, '', window.location.pathname)
      }
      if (hasValidToken(store.settings) || code) {
        try {
          const me = await store.api.me()
          store.updateSettings({ user: me })
          if (allowDirectNow) await store.setAllowDirect(true).catch(e => store.setError(e instanceof Error ? e.message : String(e)))
          if (confirmDeleteNow) store.openDeleteAccount('confirm')
          setSignedIn(true)
        } catch (e) {
          if (e instanceof ApiError && e.unauthorized) store.updateSettings({ accessToken: null, tokenExpires: null, user: null })
        }
      }
      setChecking(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The store signs out by itself when the server stops accepting this sign-in (expired, or the account was suspended).
  useEffect(() => {
    if (signedIn && !checking && !store.settings.accessToken) setSignedIn(false)
  }, [signedIn, checking, store.settings.accessToken])

  useEffect(() => {
    if (!signedIn || store.ready) return
    store.connect().catch(e => store.setError(`Could not connect: ${e instanceof Error ? e.message : e}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  if (checking) return <div className="login"><div className="card"><div className="brand"><img src={import.meta.env.BASE_URL + 'logo.png'} alt="" /><h1>Maplecord</h1></div><div className="muted tagline">Signing in…</div></div></div>
  if (outdated) return (
    <div className="login"><div className="card">
      <h1>Maplecord</h1>
      <div className="tagline">This version of Maplecord is too old for the server it connects to.</div>
      <div className="muted" style={{ textAlign: 'center' }}>Please update to the latest version, then open it again.</div>
    </div></div>
  )
  if (!signedIn) return <><Login store={store} onSignedIn={() => setSignedIn(true)} /><InstallHint store={store} /></>
  return (
    <>
      <InstallHint store={store} />
      {store.systemMessages.length > 0 && (
        <div className="sysmsgs" role="status">
          {store.systemMessages.map(m => (
            <div className="sysmsg" key={m.id}>
              <div className="grow">
                <div className="from">Message from the server admin</div>
                <div className="text">{m.message}</div>
              </div>
              <button className="subtle" aria-label="Dismiss" onClick={() => store.dismissSystemMessage(m.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <Shell store={store} onSignedOut={() => setSignedIn(false)} />
    </>
  )
}
