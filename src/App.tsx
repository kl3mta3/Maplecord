import { useEffect, useState } from 'react'
import Login from './components/Login'
import Overlay from './components/Overlay'
import Shell from './components/Shell'
import { useMaplecord } from './store'
import { hasValidToken } from './settings'
import { ApiError } from './api'
import { CLIENT_PROTOCOL } from './platform'

const isOverlayWindow = new URLSearchParams(window.location.search).get('overlay') === '1'
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
      if (code) {
        try {
          const token = await store.api.exchangeCode(store.settings.serverUrl, code)
          store.updateSettings({ accessToken: token.accessToken, tokenExpires: token.expiresAt, user: token.user })
        } catch (e) { store.setError(e instanceof Error ? e.message : String(e)) }
        window.history.replaceState({}, '', window.location.pathname)
      }
      if (hasValidToken(store.settings) || code) {
        try {
          const me = await store.api.me()
          store.updateSettings({ user: me })
          setSignedIn(true)
        } catch (e) {
          if (e instanceof ApiError && e.unauthorized) store.updateSettings({ accessToken: null, tokenExpires: null, user: null })
        }
      }
      setChecking(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!signedIn || store.ready) return
    store.connect().catch(e => store.setError(`Could not connect: ${e instanceof Error ? e.message : e}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  if (checking) return <div className="login"><div className="card"><h1>Maplecord</h1><div className="muted tagline">Signing in…</div></div></div>
  if (outdated) return (
    <div className="login"><div className="card">
      <h1>Maplecord</h1>
      <div className="tagline">This version of Maplecord is too old for the server it connects to.</div>
      <div className="muted" style={{ textAlign: 'center' }}>Please update to the latest version, then open it again.</div>
    </div></div>
  )
  if (!signedIn) return <Login store={store} onSignedIn={() => setSignedIn(true)} />
  return <Shell store={store} onSignedOut={() => setSignedIn(false)} />
}
