/**
 * Invite links. An invite is still a code; a link is the same code in a clickable form:
 *
 *   https://…/invite/CODE            the page a server shows for it, offering the app or the browser
 *   https://…/?invite=CODE           how that page hands the code to the browser version
 *   maplecord://invite/CODE?server=… how it hands the code to the desktop app
 */
const PENDING = 'maplecord.pendingInvite'

/** The invite code in whatever was pasted or clicked: a bare code or any of the links above. Null when there is none. */
export function inviteCodeFrom(text: string): string | null {
  const given = text.trim()
  const found = /(?:\/invite\/|[?&]invite=)([A-Za-z0-9]{4,32})(?![A-Za-z0-9])/.exec(given) ?? /^([A-Za-z0-9]{4,32})$/.exec(given)
  return found ? found[1].toUpperCase() : null
}

/** The server a maplecord:// invite link says it is for (its origin), when it says. */
export function inviteServerFrom(link: string): string | null {
  const found = /[?&]server=([^&#]+)/.exec(link)
  if (!found) return null
  try { return new URL(decodeURIComponent(found[1])).origin } catch { return null }
}

/** True when the link names a server other than the one this app is using. */
export function inviteIsForAnotherServer(link: string, serverUrl: string): boolean {
  const named = inviteServerFrom(link)
  if (!named) return false
  try { return new URL(serverUrl).origin !== named } catch { return false }
}

/**
 * The browser version was opened from an invite link: keep the code until the person is signed in (which may mean
 * leaving for the sign-in page and coming back), and take it out of the address bar.
 */
export function rememberInviteFromAddress() {
  const params = new URLSearchParams(window.location.search)
  const code = inviteCodeFrom(params.get('invite') ?? '')
  if (!params.has('invite')) return
  params.delete('invite')
  const rest = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''))
  try { if (code) sessionStorage.setItem(PENDING, code) } catch { /* private browsing: the invite is simply not followed */ }
}

/** The code kept by {@link rememberInviteFromAddress}, once. */
export function takeRememberedInvite(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING)
    sessionStorage.removeItem(PENDING)
    return code
  } catch { return null }
}
