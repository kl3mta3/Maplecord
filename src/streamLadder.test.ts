// Run with: node src/streamLadder.test.ts
import { bestOption, judge, ladderLevels, ladderOptions, newHealth, optionAbove, optionBelow, sameOption } from './streamLadder.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

// What a P2P channel allows on a server with the usual table.
const choices = [
  { height: 480, fps: 30, kbps: 1200 }, { height: 720, fps: 30, kbps: 2500 }, { height: 720, fps: 60, kbps: 4000 },
  { height: 1080, fps: 30, kbps: 5000 }, { height: 1080, fps: 60, kbps: 8000 },
]
const say = (list: { height: number; fps: number; kbps: number }[]) => list.map(l => `${l.height}p${l.fps}@${l.kbps}`).join(' ')

console.log('The levels')
check(say(ladderLevels({ height: 1080, fps: 30, kbps: 5000 }, choices)) === '1080p30@5000 720p30@2500 480p30@1200', 'the choice and the two sizes below it, at their own rates')
check(say(ladderLevels({ height: 720, fps: 30, kbps: 2500 }, choices)) === '720p30@2500 480p30@1200', 'a 720p stream offers 720p and 480p')
check(say(ladderLevels({ height: 480, fps: 30, kbps: 1200 }, choices)) === '480p30@1200', 'the smallest size has nothing below it')
check(say(ladderLevels({ height: 1080, fps: 60, kbps: 8000 }, choices)) === '1080p60@8000 720p60@4000 480p60@1920', 'at 60 every level is at 60; a size with no rate at 60 has its 30 rate scaled')
check(say(ladderLevels({ height: 1080, fps: 30, kbps: 20000 }, choices)) === '1080p30@20000 720p30@2500 480p30@1200', 'a rate of the sharer\'s own is the top level\'s only')
check(say(ladderLevels({ height: 720, fps: 30, kbps: 1000 }, choices)) === '720p30@1000 480p30@800', 'a level never costs as much as the one above it')
check(ladderLevels({ height: 1440, fps: 30, kbps: 9000 }, [...choices, { height: 1440, fps: 30, kbps: 9000 }]).map(l => l.height).join() === '1440,1080,720', 'three levels at most')

console.log('What is offered')
const thirty = ladderOptions(ladderLevels({ height: 1080, fps: 30, kbps: 5000 }, choices))
check(say(thirty) === '1080p30@5000 720p30@2500 480p30@1200' && thirty.every(o => !o.half), 'a 30-a-second stream is offered at 30 only')
const sixty = ladderOptions(ladderLevels({ height: 1080, fps: 60, kbps: 8000 }, choices))
check(say(sixty) === '1080p60@8000 1080p30@5200 720p60@4000 720p30@2600 480p60@1920 480p30@1248', 'a 60-a-second stream is offered at 60 and at 30, each size')
check(sixty.filter(o => o.half).every(o => o.fps === 30) && sixty.find(o => o.height === 720 && o.half)!.level === 1, 'the 30s are the same levels with every other frame left out')

check(say(ladderOptions(ladderLevels({ height: 1080, fps: 60, kbps: 8000 }, choices), () => false)) === '1080p60@8000 720p60@4000 480p60@1920', 'no 30s where the encoder does not make frames that can be left out')
check(say(ladderOptions(ladderLevels({ height: 1080, fps: 60, kbps: 8000 }, choices), level => level === 1)) === '1080p60@8000 720p60@4000 720p30@2600 480p60@1920', 'and only for the levels where it does')

console.log('What a viewer gets')
check(bestOption(sixty)!.kbps === 8000, 'with no limit, the best')
check(say([bestOption(sixty, { kbps: 3000 })!]) === '720p30@2600', 'within a rate')
check(say([bestOption(sixty, { height: 720, fps: 30, kbps: 2500 })!]) === '480p30@1248' && say([bestOption(sixty, { height: 720, fps: 30, kbps: 2600 })!]) === '720p30@2600', 'within a size, frames a second and a rate together')
check(say([bestOption(sixty, { height: 720 }, { kbps: 2000 })!]) === '480p60@1920', 'within several limits at once')
check(bestOption(sixty, { kbps: 500 }) === null, 'nothing, when nothing is small enough')
check(bestOption(sixty, null, { kbps: 0 })!.kbps === 8000, 'a rate of 0 is no limit')
check(say([optionBelow(sixty, sixty[0]!)!]) === '1080p30@5200' && optionBelow(sixty, sixty[sixty.length - 1]!) === null, 'the next one down, and none below the last')
check(say([optionAbove(sixty, sixty[2]!)!]) === '1080p30@5200' && optionAbove(sixty, sixty[0]!) === null, 'the next one up, and none above the first')
check(sameOption(sixty[1]!, { ...sixty[1]! }) && !sameOption(sixty[0]!, sixty[1]!) && sameOption(null, null) && !sameOption(null, sixty[0]!), 'two options are the same when they are the same level sent the same way')

console.log('Moving a viewer')
const on = thirty[1]!, above = thirty[0]!
let h = newHealth()
check(judge(h, { availableKbps: 2000, lost: 0 }, on, above) === null && judge(h, { availableKbps: 2000, lost: 0 }, on, above) === 'down', 'short of the rate twice in a row: down')
h = newHealth()
check(judge(h, { availableKbps: 2000, lost: 0 }, on, above) === null && judge(h, { availableKbps: 3000, lost: 0 }, on, above) === null && judge(h, { availableKbps: 2000, lost: 0 }, on, above) === null, 'once is not enough, and a good look between starts the count again')
h = newHealth()
check(judge(h, { availableKbps: 9000, lost: 0.2 }, on, above) === null && judge(h, { availableKbps: 9000, lost: 0.2 }, on, above) === 'down', 'a great deal lost counts as short too')
h = newHealth()
const ups = Array.from({ length: 6 }, () => judge(h, { availableKbps: 7000, lost: 0 }, on, above))
check(ups.slice(0, 5).every(u => u === null) && ups[5] === 'up', 'room to spare for the level above, six looks in a row: up')
h = newHealth()
const slow = Array.from({ length: 15 }, () => judge(h, { availableKbps: 2600, lost: 0 }, on, above))
check(slow.slice(0, 14).every(u => u === null) && slow[14] === 'up', 'carrying what it is sent without trouble, and no sign of more: tried on the level above after a longer while')
h = newHealth()
check(Array.from({ length: 30 }, () => judge(h, { availableKbps: 2600, lost: 0.05 }, on, above)).every(u => u === null), 'not while a little is being lost')
h = newHealth()
check(Array.from({ length: 12 }, () => judge(h, { availableKbps: 9000, lost: 0 }, above, null)).every(u => u === null), 'nothing above the top')
h = newHealth()
judge(h, { availableKbps: 100, lost: 0 }, above, null); judge(h, { availableKbps: 100, lost: 0 }, above, null)
const after = Array.from({ length: 12 }, () => judge(h, { availableKbps: 9000, lost: 0 }, on, above))
check(after.slice(0, 11).every(u => u === null) && after[11] === 'up', 'after being moved down, moving up again takes twice as long')
h = newHealth()
check(Array.from({ length: 6 }, () => judge(h, { availableKbps: null, lost: null }, on, above)).every(u => u === null), 'nothing known about the connection: nothing is done')

h = newHealth()
check(Array.from({ length: 5 }, () => judge(h, { availableKbps: 2000, lost: 0.1 }, on, above, true)).every(u => u === null), 'while the connection is settling, a little short is let be')
h = newHealth()
check(judge(h, { availableKbps: 1000, lost: 0 }, on, above, true) === null && judge(h, { availableKbps: 1000, lost: 0 }, on, above, true) === 'down', 'while settling, far short still means down')

console.log(failures === 0 ? 'streamLadder: all passed' : `streamLadder: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} streamLadder checks failed`)
