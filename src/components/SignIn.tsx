import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { ConnectionServiceDto, ContactEmailDto, SignInMethodsDto } from '../types'
import { openOutside } from './Connections'

/** What the server's short reason for a sign-in not going through means, in words. */
export function signInProblem(code: string): string {
  switch (code) {
    case 'login_failed': return 'Sign-in did not finish. Try again.'
    case 'signups_closed': return 'New accounts are closed right now.'
    case 'suspended': return 'This account is suspended.'
    case 'account_too_new': return 'That account is too new to start a Maplecord account with. Sign in another way, or try again when it is older.'
    case 'email_unverified': return 'The email address on that account has not been confirmed with its service. Confirm it there, then try again.'
    case 'email_needed': return 'That account has no email address, and a new Maplecord account needs one here.'
    case 'signup_not_offered': return 'Steam and Battle.net cannot start a Maplecord account. Sign in another way first, then add it in Settings, under My account.'
    case 'mail_failed': return 'The confirmation email could not be sent. Try again later.'
    default: return code
  }
}

/** What each sign-in service is called on a button. */
export const SIGN_IN_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub', microsoft: 'Microsoft', twitch: 'Twitch', steam: 'Steam', battlenet: 'Battle.net' }
/** The services that give no email address: they cannot start an account, only be added to one. */
export const ADD_ONLY_SIGN_INS = ['steam', 'battlenet']

/** What the button that signs in with a service says. */
export const signInLabel = (provider: string) => (SIGN_IN_NAMES[provider] ? `Sign in with ${SIGN_IN_NAMES[provider]}` : provider)

/**
 * Settings, My account: the services this account can be signed in to with (adding one, removing one), and the
 * address Maplecord writes to. Adding a service, and confirming a new address, both finish in a browser; the app is
 * told when they have.
 */
export function AccountSignIn({ store }: { store: Store }) {
  const [ways, setWays] = useState<SignInMethodsDto | null>(null)
  const [email, setEmail] = useState<ContactEmailDto | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [wanted, setWanted] = useState('')
  const { loadSignIn, connectionsEpoch } = store
  useEffect(() => {
    let alive = true
    void loadSignIn().then(got => { if (alive && got) { setWays(got.ways); setEmail(got.email); setWaiting(null) } })
    return () => { alive = false }
  }, [loadSignIn, connectionsEpoch])
  if (!ways || !email) return null

  const add = async (service: ConnectionServiceDto) => { if (await openOutside(store, () => store.startSignInMethod(service.key))) setWaiting(service.key) }
  // Read again afterwards: the service can now be added again, and the address it gave may have been the one shown.
  const remove = async (id: number) => {
    if (!await store.removeSignInMethod(id)) return
    const got = await loadSignIn()
    if (got) { setWays(got.ways); setEmail(got.email) }
  }
  const ask = async () => {
    const saved = await store.setContactEmail(wanted.trim())
    if (saved) { setEmail(saved); setChanging(false); setWanted('') }
  }
  const useGiven = async () => { const saved = await store.clearContactEmail(); if (saved) setEmail(saved) }

  return (
    <>
      <h4>Ways to sign in</h4>
      <div className="muted">Maplecord has no password of yours. You sign in through one of these, and can add another so you are not left with one way in.</div>
      {ways.methods.map(m => (
        <div key={m.id} className="connectionrow">
          <b>{m.serviceName}</b>
          <span className="grow muted">{m.email ?? ''}</span>
          <button className="subtle" disabled={ways.methods.length === 1} title={ways.methods.length === 1 ? 'This is your only way to sign in. Add another before removing it.' : undefined} onClick={() => void remove(m.id)}>Remove</button>
        </div>
      ))}
      {ways.canAdd.map(s => (
        <div key={s.key} className="connectionrow">
          <b>{s.name}</b>
          <span className="grow muted">{waiting === s.key ? 'Finish in your browser, then come back here.' : ADD_ONLY_SIGN_INS.includes(s.key) ? `Anyone who can get into that ${s.name} account could then get into this one.` : 'Not added'}</span>
          <button onClick={() => void add(s)}>Add</button>
        </div>
      ))}

      <h4>Email</h4>
      <div className="muted">Where Maplecord writes to you about your account. It is never a way to sign in.</div>
      <div className="connectionrow">
        <span className="grow">{email.email ?? 'None'}{!email.changed && email.email && <span className="muted"> · from your sign-in</span>}</span>
        {email.canChange && !changing && <button className="subtle" onClick={() => setChanging(true)}>Change</button>}
        {email.changed && <button className="subtle" onClick={() => void useGiven()} title="Go back to the address your sign-in service gave">Use the one from my sign-in</button>}
      </div>
      {email.pending && <div className="muted">Waiting for you to open the link sent to {email.pending}. Until then nothing changes.</div>}
      {!email.canChange && <div className="muted">This server cannot send mail yet, so the address cannot be changed.</div>}
      {changing && (
        <div className="row">
          <input className="grow" type="email" autoFocus placeholder="New address" value={wanted} maxLength={254} onChange={e => setWanted(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && wanted.trim()) void ask() }} />
          <button className="accent" disabled={!wanted.trim()} onClick={() => void ask()}>Send the link</button>
          <button className="subtle" onClick={() => { setChanging(false); setWanted('') }}>Cancel</button>
        </div>
      )}
    </>
  )
}
