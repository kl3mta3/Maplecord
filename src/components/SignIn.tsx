import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { ConnectionServiceDto, ContactEmailDto, SignInMethodsDto } from '../types'
import { openOutside } from './Connections'
import { bridge } from '../platform'

/** What the server's short reason for a sign-in not going through means, in words. */
export function signInProblem(code: string): string {
  switch (code) {
    case 'login_failed': return 'Sign-in did not finish. Try again.'
    case 'signups_closed': return 'New accounts are closed right now.'
    case 'suspended': return 'This account is suspended.'
    case 'signin_off': return 'That way of signing in is switched off on this server. Sign in another way.'
    case 'account_too_new': return 'That account is too new to start a Maplecord account with. Sign in another way, or try again when it is older.'
    case 'email_unverified': return 'The email address on that account has not been confirmed with its service. Confirm it there, then try again.'
    case 'email_needed': return 'That account has no email address, and a new Maplecord account needs one here.'
    case 'signup_not_offered': return 'Steam and Battle.net cannot start a Maplecord account. Sign in another way first, then add it in Settings, under My account.'
    case 'mail_failed': return 'The confirmation email could not be sent. Try again later.'
    default: return code
  }
}

/** What each sign-in service is called on a button. */
export const SIGN_IN_NAMES: Record<string, string> = { apple: 'Apple', google: 'Google', github: 'GitHub', microsoft: 'Microsoft', twitch: 'Twitch', steam: 'Steam', battlenet: 'Battle.net' }
/** The services that give no email address: they cannot start an account, only be added to one. */
export const ADD_ONLY_SIGN_INS = ['steam', 'battlenet']

/** What the button that signs in with a service says. */
export const signInLabel = (provider: string) => (SIGN_IN_NAMES[provider] ? `Sign in with ${SIGN_IN_NAMES[provider]}` : provider)

/**
 * Apple's mark, for its button: Apple's rules for "Sign in with Apple" ask for the logo beside the words, on a black
 * (or white) button in the system's own face. Used nowhere else.
 */
export const AppleMark = () => (
  <svg className="applemark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
)

/** The class of a sign-in button for a service, and what goes inside it (Apple's gets its mark). */
export const providerButtonClass = (provider: string) => (provider === 'apple' ? 'provider apple' : 'provider')
export const ProviderButtonBody = ({ provider }: { provider: string }) => <>{provider === 'apple' && <AppleMark />}{signInLabel(provider)}</>

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
  // A change the server would only make after a sign-in from just now: asked for here, then the change is made again.
  const [proving, setProving] = useState<{ change: () => Promise<unknown>; opensTab: boolean } | null>(null)
  const [provedNote, setProvedNote] = useState('')
  const [provers, setProvers] = useState<string[] | null>(null)
  const [provingProblem, setProvingProblem] = useState('')
  const [leaving, setLeaving] = useState(false)
  const { loadSignIn, connectionsEpoch } = store
  useEffect(() => {
    let alive = true
    void loadSignIn().then(got => { if (alive && got) { setWays(got.ways); setEmail(got.email); setWaiting(null) } })
    return () => { alive = false }
  }, [loadSignIn, connectionsEpoch])
  if (!ways || !email) return null

  /** Makes a change, or asks for a sign-in from just now first when the server wants one (see SignInEndpoints.SignInAgain). */
  const guarded = async (change: () => Promise<unknown>, opensTab = false) => {
    setProvedNote('')
    const outcome = await store.accountChange(change)
    if (outcome !== 'reauth') return
    setProving({ change, opensTab }); setProvingProblem('')
    store.reauthProviders().then(setProvers).catch(() => setProvers([]))
  }
  const prove = async (provider: string) => {
    setProvingProblem(provider === 'dev' ? '' : 'Waiting for you to sign in…')
    try {
      // From the desktop app it comes back here; a browser goes off to sign in, and the change is made again on return.
      if (!await store.reauthenticateForAccount(provider, store.settings.user?.username ?? '')) return
      const again = proving
      setProving(null)
      // A browser only opens a new tab straight from a click: one that would, is left for the person to press again.
      if (again?.opensTab && !bridge()) setProvedNote('Signed in again. Press Add once more.')
      else if (again) await guarded(again.change, again.opensTab)
    } catch (e) { setProvingProblem(e instanceof Error ? e.message : String(e)) }
  }
  const add = (service: ConnectionServiceDto) => guarded(async () => {
    let refused: unknown = null
    const opened = await openOutside(store, async () => { try { return (await store.api.startSignInMethod(service.key)).url } catch (e) { refused = e; return null } })
    if (refused) throw refused
    if (opened) setWaiting(service.key)
  }, true)
  // Read again afterwards: the service can now be added again, and the address it gave may have been the one shown.
  const remove = (id: number) => guarded(async () => {
    await store.api.removeSignInMethod(id)
    const got = await loadSignIn()
    if (got) { setWays(got.ways); setEmail(got.email) }
  })
  const ask = () => guarded(async () => {
    const saved = await store.api.setContactEmail(wanted.trim())
    setEmail(saved); setChanging(false); setWanted('')
  })
  const leaveEverywhere = () => guarded(async () => { await store.signOutEverywhere() })
  const backToGiven = () => guarded(async () => { setEmail(await store.api.clearContactEmail()) })

  return (
    <>
      <h4>Ways to sign in</h4>
      <div className="muted">Maplecord has no password of yours. You sign in through one of these, and can add another so you are not left with one way in.</div>
      {proving && (
        <div className="notice">
          <div>To change how you sign in, first sign in again, so it is really you making the change.</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {provers === null && <span className="muted">Checking how you can sign in…</span>}
            {provers?.length === 0 && <span className="muted">This server has no way to sign in again.</span>}
            {provers?.map(p => <button key={p} className={p === 'dev' ? '' : providerButtonClass(p)} onClick={() => void prove(p)}>{p === 'dev' ? `Development sign-in as ${store.settings.user?.username ?? ''}` : <ProviderButtonBody provider={p} />}</button>)}
            <button className="subtle" onClick={() => setProving(null)}>Cancel</button>
          </div>
          {provingProblem && <div className="muted">{provingProblem}</div>}
        </div>
      )}
      {provedNote && <div className="muted">{provedNote}</div>}
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
        {email.changed && <button className="subtle" onClick={() => void backToGiven()} title="Go back to the address your sign-in service gave">Use the one from my sign-in</button>}
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

      <h4>Signed in elsewhere</h4>
      <div className="muted">Signs out every other device and browser at once. Use it if you signed in somewhere you no longer trust, or think someone else has your sign-in. This device stays signed in.</div>
      <div className="connectionrow">
        <span className="grow" />
        {leaving
          ? <><button className="danger" onClick={() => { setLeaving(false); void leaveEverywhere() }}>Sign out everywhere else</button><button className="subtle" onClick={() => setLeaving(false)}>Cancel</button></>
          : <button className="subtle" onClick={() => setLeaving(true)}>Sign out everywhere</button>}
      </div>
    </>
  )
}
