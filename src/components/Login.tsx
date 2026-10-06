import { useEffect, useState } from 'react'
import { bridge, DEFAULT_SERVER_URL } from '../platform'
import { usesCustomServer } from '../settings'
import type { Store } from '../store'

export default function Login({ store, onSignedIn }: { store: Store; onSignedIn: () => void }) {
  const [serverUrl, setServerUrl] = useState(store.settings.serverUrl)
  const [showServer, setShowServer] = useState(usesCustomServer(store.settings))
  const [providers, setProviders] = useState<string[] | null>(null)
  const [devUsername, setDevUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const check = async (url = serverUrl) => {
    setBusy(true); setStatus('Checking server…')
    try {
      const list = await store.api.providers(url)
      setProviders(list)
      setStatus(list.length === 0 ? 'Server has no sign-in providers configured.' : '')
      store.updateSettings({ serverUrl: url.replace(/\/$/, '') })
    } catch (e) {
      setProviders(null); setShowServer(true)
      setStatus(`Could not reach the Maplecord server (${url}): ${e instanceof Error ? e.message : e}`)
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
        const code = await b.oauthLogin(serverUrl, provider)
        finish(await store.api.exchangeCode(serverUrl, code))
      } else {
        // Plain browser: round-trip through the provider and come back to this page with ?code=.
        const redirect = window.location.origin + window.location.pathname
        window.location.href = `${serverUrl.replace(/\/$/, '')}/auth/login/${provider}?redirect_uri=${encodeURIComponent(redirect)}`
      }
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const devLogin = async () => {
    if (!devUsername.trim()) { setStatus('Enter a username.'); return }
    setBusy(true)
    try { finish(await store.api.devLogin(serverUrl, devUsername.trim())) }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="login">
      <div className="card">
        <h1>Maplecord</h1>
        <div className="muted tagline">Loot rolling, chat and voice for your party</div>

        {showServer && (
          <>
            <div className="muted">Server (advanced)</div>
            <div className="row">
              <input className="grow" value={serverUrl} onChange={e => setServerUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} disabled={busy} />
              <button onClick={() => check()} disabled={busy}>Connect</button>
            </div>
            <button className="subtle" style={{ alignSelf: 'flex-start' }} onClick={() => { setServerUrl(DEFAULT_SERVER_URL); void check(DEFAULT_SERVER_URL) }}>Use the default server</button>
          </>
        )}

        {providers?.includes('google') && <button className="provider" onClick={() => loginWith('google')} disabled={busy}>Sign in with Google</button>}
        {providers?.includes('github') && <button className="provider" onClick={() => loginWith('github')} disabled={busy}>Sign in with GitHub</button>}
        {providers?.includes('dev') && (
          <>
            <div className="muted" style={{ marginTop: 8 }}>Development login (no OAuth app needed)</div>
            <div className="row">
              <input className="grow" placeholder="Username" value={devUsername} onChange={e => setDevUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && devLogin()} disabled={busy} />
              <button className="accent" onClick={devLogin} disabled={busy}>Sign in</button>
            </div>
          </>
        )}

        {status && <div className="muted" style={{ marginTop: 8 }}>{status}</div>}
        <button className="subtle" style={{ alignSelf: 'flex-end', fontSize: 10, marginTop: 8 }} onClick={() => setShowServer(s => !s)} title="Connect to a self-hosted server">Advanced</button>
      </div>
    </div>
  )
}
