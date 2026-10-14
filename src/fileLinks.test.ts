// Run with: node src/fileLinks.test.ts
import { linkRanOut } from './fileLinks.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

const now = Date.UTC(2026, 9, 14, 12, 0, 0)
const at = (seconds: number) => `https://api.example/files/abc/picture.png?ex=${Math.floor(now / 1000) + seconds}&sig=AAAA`

console.log('Whether a file address has run out')
check(!linkRanOut(at(3600), now) && !linkRanOut(at(86400 * 2), now), 'one with time left has not')
check(linkRanOut(at(-1), now) && linkRanOut(at(0), now), 'one whose time has passed has')
check(linkRanOut(at(30), now) && !linkRanOut(at(90), now), 'one with under a minute left counts as run out: it would not last the fetch')
check(!linkRanOut('https://api.example/files/abc/picture.png', now) && !linkRanOut('https://api.example/files/abc/ex=1.png', now), 'one that says no time (an older server) never has')
check(linkRanOut('https://api.example/files/abc/a.png?sig=AAAA&ex=5', now), 'wherever in the address the time is')

console.log(failures === 0 ? 'fileLinks: all passed' : `fileLinks: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} fileLinks checks failed`)
