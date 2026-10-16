import { nativeApp } from './app.ts'

/** What a sign-in started from the iPhone app comes back with: the same things the desktop app's listener gets. */
export interface NativeSignInResult { code?: string; pending?: string; email?: string; error?: string }

/** Where the server sends the phone back to; only the app answers to this address (see the server's IsAllowedRedirect). */
export const PHONE_SIGN_IN_RETURN = 'maplecord://signed-in'

/**
 * Signs in from the iPhone app: the phone's own sign-in sheet opens the server's sign-in page for the service, the
 * person signs in there (with their Safari sign-ins to hand), and the sheet comes back to the app with the answer.
 */
export async function nativeSignIn(serverUrl: string, provider: string): Promise<NativeSignInResult> {
  const url = `${serverUrl.replace(/\/$/, '')}/auth/login/${encodeURIComponent(provider)}?redirect_uri=${encodeURIComponent(PHONE_SIGN_IN_RETURN)}`
  const back = await nativeApp().signIn({ url })
  return parseSignInReturn(back.url)
}

export function parseSignInReturn(url: string): NativeSignInResult {
  const query = new URL(url).searchParams
  const pick = (name: string) => query.get(name) ?? undefined
  return { code: pick('code'), pending: pick('pending'), email: pick('email'), error: pick('error') }
}
