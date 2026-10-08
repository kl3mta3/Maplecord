// Run with: node src/streamLimit.test.ts
import { makeGuard, overLimit, READINGS_OVER } from './streamLimit.ts'

let failed = 0
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

const usual = { height: 720, fps: 30, kbps: 2500 }

check(overLimit({ width: 1280, height: 720, fps: 30, kbps: 2400 }, usual) === null, 'a stream at its limit is fine')
check(overLimit({ width: 1280, height: 720, fps: 31, kbps: 2900 }, usual) === null, 'and so is one a little over, as a connection makes it')
check(overLimit({ width: 1280, height: 720, fps: 30, kbps: 9000 }, usual) === 'rate', 'a stream arriving at several times its rate is over')
check(overLimit({ width: 2560, height: 1440, fps: 30, kbps: 2400 }, usual) === 'size', 'a larger picture squeezed into the same rate is over')
check(overLimit({ width: 1280, height: 720, fps: 60, kbps: 2400 }, usual) === 'frames', 'twice the frame rate is over')
check(overLimit({ width: 1720, height: 720, fps: 30, kbps: 2400 }, usual) === null, 'a very wide screen at the right height is fine')
check(overLimit({ width: 405, height: 720, fps: 30, kbps: 2400 }, usual) === null, 'a tall window is fine')
check(overLimit({ width: 720, height: 1280, fps: 30, kbps: 2400 }, usual) === null, 'a phone turned on its side mid-stream is fine')
check(overLimit({ width: 0, height: 0, fps: 0, kbps: 0 }, usual) === null, 'nothing arriving yet is fine')
check(overLimit({ width: 2560, height: 1440, fps: 60, kbps: 15000 }, { height: 1440, fps: 60, kbps: 15000 }) === null, 'someone allowed 1440p at 60 may send it')

const guard = makeGuard(usual)
const over = { width: 1280, height: 720, fps: 30, kbps: 9000 }, fine = { width: 1280, height: 720, fps: 30, kbps: 2400 }
const first = Array.from({ length: READINGS_OVER - 1 }, () => guard(over))
check(first.every(x => !x), 'a burst is not enough to let a stream go')
check(!guard(fine) && !guard(over) && !guard(over), 'a reading under the limit starts the count again')
check(guard(over), `only ${READINGS_OVER} readings over in a row let it go`)

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failed > 0) throw new Error(`${failed} stream limit checks failed`)
