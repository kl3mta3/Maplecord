// Run with: node src/memberPaging.test.ts
import { inBatches, membersToAsk, mergeMembers } from './memberPaging.ts'
import type { MemberDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }
const m = (userId: string, online = false, nickname: string | null = null): MemberDto => ({ userId, username: userId, avatarUrl: null, nickname, role: 0, online } as MemberDto)
const ids = (list: MemberDto[]) => list.map(x => x.userId).join(',')

console.log('Members added to the ones we hold')
const held = [m('ann', true), m('bob'), m('cat', true)]
check(mergeMembers(held, []) === held, 'nothing found changes nothing')
check(ids(mergeMembers(held, [m('dan'), m('eve')])) === 'ann,bob,cat,dan,eve', 'new people go on the end')
const again = mergeMembers(held, [m('bob', true, 'Bobby'), m('dan')])
check(ids(again) === 'ann,bob,cat,dan' && again[1]!.online && again[1]!.nickname === 'Bobby', 'someone we hold is replaced where they stand')
check(ids(mergeMembers(held, [m('dan'), m('dan', true)])) === 'ann,bob,cat,dan', 'the same person found twice is there once')
check(ids(held) === 'ann,bob,cat' && !held[1]!.online, 'the list given is left as it was')

console.log('Whom to ask about')
const asked = new Set<string>()
check(membersToAsk(held, ['ann', 'dan', 'dan', '', 'eve'], asked).join(',') === 'dan,eve', 'only those we do not hold, each once, never an empty id')
check(membersToAsk(held, ['dan', 'eve', 'fay'], asked).join(',') === 'fay', 'nobody is asked about twice')
check(membersToAsk(held, ['ann', 'bob'], asked).length === 0, 'nobody to ask about when we hold them all')

console.log('In pieces')
check(inBatches([1, 2, 3, 4, 5], 2).map(b => b.join('')).join(' ') === '12 34 5', 'pieces of at most so many')
check(inBatches([], 100).length === 0, 'nothing gives no pieces')

console.log(failures === 0 ? 'memberPaging: all passed' : `memberPaging: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} memberPaging checks failed`)
