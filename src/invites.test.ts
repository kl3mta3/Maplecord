// Run with: node src/invites.test.ts
import { inviteCodeFrom, inviteIsForAnotherServer, inviteServerFrom } from './invites.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}

check(inviteCodeFrom(' kflrl7xq ') === 'KFLRL7XQ', 'a bare code is taken as it is, in capitals')
check(inviteCodeFrom('https://maplecord.app/invite/KFLRL7XQ') === 'KFLRL7XQ', 'the code is found in an invite link')
check(inviteCodeFrom('https://maplecord.app/invite/kflrl7xq/') === 'KFLRL7XQ', 'with or without a trailing slash')
check(inviteCodeFrom('https://app.maplecord.app/?invite=KFLRL7XQ&x=1') === 'KFLRL7XQ', 'and in the browser version\'s address')
check(inviteCodeFrom('maplecord://invite/KFLRL7XQ?server=https%3A%2F%2Fapi.maplecord.app') === 'KFLRL7XQ', 'and in a link meant for the desktop app')
check(inviteCodeFrom('https://maplecord.app/') === null && inviteCodeFrom('') === null && inviteCodeFrom('not a code!') === null, 'something with no code in it gives none')
check(inviteCodeFrom('https://evil.example/invite/<script>') === null, 'nonsense where the code should be gives none')

const link = 'maplecord://invite/KFLRL7XQ?server=https%3A%2F%2Fapi.maplecord.app'
check(inviteServerFrom(link) === 'https://api.maplecord.app', 'a desktop link says which server it is for')
check(inviteServerFrom('maplecord://invite/KFLRL7XQ') === null, 'or does not')
check(!inviteIsForAnotherServer(link, 'https://api.maplecord.app/'), 'a link for the server the app uses is followed')
check(inviteIsForAnotherServer(link, 'http://localhost:5080'), 'a link for another server is not')
check(!inviteIsForAnotherServer('maplecord://invite/KFLRL7XQ', 'http://localhost:5080'), 'a link that names no server is followed')

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} invite link checks failed`)
