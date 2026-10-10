import { useEffect, useState } from 'react'
import type { Store } from '../store'
import { ApiError } from '../api'
import type { AccountDeletionDto } from '../types'
import { Dialog } from './Dialogs'
import { signInLabel } from './SignIn'

/**
 * Deleting your own account, in two steps: what it means and a fresh sign-in to prove it is you, then typing your
 * username to say you mean it. In a browser the sign-in leaves the page and comes back; the store reopens this at
 * the second step when it does.
 */
export function DeleteAccountDialog({ store }: { store: Store }) {
  const me = store.settings.user
  const step = store.deleteStep
  const [providers, setProviders] = useState<string[] | null>(null)
  const [losing, setLosing] = useState<AccountDeletionDto | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let alive = true
    store.api.providers(store.settings.serverUrl).then(list => { if (alive) setProviders(list) }).catch(() => { if (alive) setProviders([]) })
    store.api.deletionPreview().then(preview => { if (alive) setLosing(preview) }).catch(() => { /* shown without the list */ })
    return () => { alive = false }
  }, [store.api, store.settings.serverUrl])

  if (!step || !me) return null
  const close = () => store.closeDeleteAccount()

  const signIn = async (provider: string) => {
    setBusy(true); setProblem(provider === 'dev' ? '' : 'Waiting for you to sign in…')
    try { await store.reauthenticateForDelete(provider, me.username); setProblem('') }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setProblem('')
    try { await store.deleteAccount(typed) }
    catch (e) {
      // Took too long between the two steps: the sign-in has to be fresh.
      if (e instanceof ApiError && e.code === 'reauth') store.openDeleteAccount('explain')
      setProblem(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Delete your account" onClose={close}>
      {step === 'explain' ? (
        <>
          <div><b>This cannot be undone.</b> Your profile, your sign-in, your friends and your place in every server are removed.</div>
          {losing && losing.ownedServers.length > 0 && (
            <div>
              {losing.ownedServers.length === 1 ? 'This server is yours and will be deleted for everyone in it:' : 'These servers are yours and will be deleted for everyone in them:'}
              <ul className="plainlist">{losing.ownedServers.map(name => <li key={name}><b>{name}</b></li>)}</ul>
            </div>
          )}
          {losing && losing.bots > 0 && <div>{losing.bots === 1 ? 'Your bot is deleted too.' : `Your ${losing.bots} bots are deleted too.`}</div>}
          <div className="muted">
            What you wrote in other people's servers and conversations stays, shown as written by "Deleted user". Anything
            already seen or downloaded in someone's app can still exist there.
          </div>
          <div className="muted">To make sure it is really you, sign in again:</div>
          {providers === null && <div className="muted">Checking how you can sign in…</div>}
          {providers?.length === 0 && <div className="muted">This server has no way to sign in again.</div>}
          {providers?.map(p => <button key={p} className={p === 'dev' ? '' : 'provider'} disabled={busy} onClick={() => void signIn(p)}>{p === 'dev' ? `Development sign-in as ${me.username}` : signInLabel(p)}</button>)}
        </>
      ) : (
        <>
          <div>You are signed in. To delete your account for good, type your username: <b>{me.username}</b></div>
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder={me.username} aria-label="Your username" disabled={busy}
            onKeyDown={e => { if (e.key === 'Enter' && typed.trim()) void remove() }} />
        </>
      )}
      {problem && <div className="muted">{problem}</div>}
      <div className="buttons">
        <button onClick={close} disabled={busy}>Cancel</button>
        {step === 'confirm' && <button className="danger" disabled={busy || typed.trim().replace(/^@/, '').toLowerCase() !== me.username.toLowerCase()} onClick={() => void remove()}>Delete my account</button>}
      </div>
    </Dialog>
  )
}
