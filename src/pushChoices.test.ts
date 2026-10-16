// node src/pushChoices.test.ts
// What the phone tells the server it wants to be told of (pushChoices.ts), and how a sign-in comes back to it (native/signIn.ts).
import { phoneChoices } from './pushChoices.ts'
import { parseSignInReturn, PHONE_SIGN_IN_RETURN } from './native/signIn.ts'
import type { Settings } from './settings.ts'

let failed = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failed++ }

const settings = (more: Partial<Settings>): Settings => ({ guilds: {}, ...more }) as Settings

const plain = phoneChoices(settings({}))
check(plain.showText && plain.mutedGuilds.length === 0 && plain.mutedChannels.length === 0 && Object.keys(plain.notify).length === 0, 'nothing chosen: words shown, nothing muted, every server at mentions (said by leaving it out)')
const chosen = phoneChoices(settings({
  pushShowText: false,
  guilds: { g1: { muted: true }, g2: { notify: 'all' }, g3: { notify: 'none', muted: false }, g4: { notify: 'mentions' } },
  mutedChannels: { c1: true, c2: false },
}))
check(!chosen.showText && chosen.mutedGuilds.join() === 'g1' && chosen.mutedChannels.join() === 'c1' && JSON.stringify(chosen.notify) === '{"g2":"all","g3":"none"}',
  'the phone\'s choices carry over: muted servers and channels, all/none levels, and the words switched off')

check(PHONE_SIGN_IN_RETURN === 'maplecord://signed-in', 'the phone\'s return address is the one the server allows')
check(JSON.stringify(parseSignInReturn('maplecord://signed-in/?code=ABC123')) === '{"code":"ABC123"}', 'a code comes back as a code')
const pending = parseSignInReturn('maplecord://signed-in?pending=T1&email=s%2A%2A%40example.test')
check(pending.pending === 'T1' && pending.email === 's**@example.test' && pending.code === undefined, 'a sign-in waiting on an email comes back as its ticket and the masked address')
check(parseSignInReturn('maplecord://signed-in?error=login_failed').error === 'login_failed', 'a refusal comes back as its reason')

console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
if (failed > 0) throw new Error(`${failed} checks failed`)
