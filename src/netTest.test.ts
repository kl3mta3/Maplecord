// Run with: node src/netTest.test.ts
import { atTheCap, mbps, rateFor, rating, showMbps, showWait, speedInWords, steadyMbps, viewersAt } from './netTest.ts'
import type { StreamSettingsDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

console.log('Speeds')
check(near(mbps(1_250_000, 1000), 10) && mbps(100, 0) === 0, 'megabits a second from bytes and time')
// A line that takes a second to get going, then holds 20 Mbit/s for three more.
const run = [{ ms: 0, bytes: 0 }, { ms: 500, bytes: 200_000 }, { ms: 1000, bytes: 800_000 }, { ms: 2000, bytes: 3_300_000 }, { ms: 3000, bytes: 5_800_000 }, { ms: 4000, bytes: 8_300_000 }]
check(near(steadyMbps(run), 20), `the slow start is left out of the reckoning (${steadyMbps(run).toFixed(1)})`)
check(near(steadyMbps([{ ms: 0, bytes: 0 }, { ms: 400, bytes: 500_000 }]), 10), 'with very little to go on, all of it is used')
check(steadyMbps([]) === 0 && steadyMbps([{ ms: 0, bytes: 0 }]) === 0, 'nothing measured is no speed')
check(atTheCap(190, 200) && !atTheCap(150, 200) && !atTheCap(500, null) && !atTheCap(5, 0), 'a speed near the most a test may go is marked as such')
check(showMbps(7.46) === '7.5' && showMbps(93.6) === '94', 'shown with a decimal only when small')
check(showWait(130) === '2 min 10 s' && showWait(45) === '45 s' && showWait(-3) === '0 s', 'a wait in words')

console.log('What a connection is called')
check(rating(430).label === 'Great' && rating(201).label === 'Great' && rating(200).label === 'Above average' && rating(151).label === 'Above average', 'great over 200, above average from 151')
check(rating(150).label === 'Average' && rating(51).label === 'Average' && rating(50).label === 'Below average' && rating(11).label === 'Below average', 'average from 51, below average from 11')
check(rating(10).label === 'Poor' && rating(0.4).label === 'Poor' && rating(10.4).label === 'Poor' && rating(10.6).label === 'Below average', 'poor at 10 and under, by the rounded speed')
check(rating(199, 200).label === 'Great' && rating(199, 200).range === 'over 200 Mbps' && rating(37, 38).label === 'Below average', 'a test that could go no faster than its limit counts as over that limit')
check(speedInWords(38.2, 200) === '38 Mbps' && speedInWords(198, 200) === 'over 200 Mbps' && speedInWords(7.26, null) === '7.3 Mbps', 'a speed in words, "over" when the test ran into its limit')

console.log('Viewers')
check(viewersAt(25, 2500) === 8 && viewersAt(25, 5000) === 4, 'a fifth of the upload is kept back, the rest is shared out')
check(viewersAt(2, 2500) === 0 && viewersAt(10, 0) === 0, 'too little for one, and no rate at all')
const rules = { rates: [{ height: 720, fps: 30, kbps: 2000 }, { height: 1080, fps: 30, kbps: 6000 }] } as StreamSettingsDto
check(rateFor(rules, 720, 30, 2500) === 2000 && rateFor(rules, 1080, 60, 8000) === 8000 && rateFor(null, 720, 30, 2500) === 2500, 'the rate is the server\'s own for that quality, or the usual one')

console.log(failures === 0 ? 'netTest: all passed' : `netTest: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} netTest checks failed`)
