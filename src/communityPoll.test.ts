// Run with: node src/communityPoll.test.ts
import { answered, complete, fromAnswers, pick, rate, share, shouldAsk, toAnswers, totalWords } from './communityPoll.ts'
import type { CommunityPollDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const poll = (over: Partial<CommunityPollDto> = {}): CommunityPollDto => ({
  id: 'p', title: 'What next?', intro: null, openedAt: '2026-10-13T00:00:00Z', endsAt: null, ended: false, mine: 'none', mayAnswer: true, whyNot: null, myAnswers: null, answered: 4, page: null,
  questions: [
    { id: 'q1', text: 'Pick one', kind: 0, options: [{ id: 'a', text: 'A', votes: 3 }, { id: 'b', text: 'B', votes: 1 }] },
    { id: 'q2', text: 'Pick several', kind: 1, options: [{ id: 'x', text: 'X', votes: 4 }, { id: 'y', text: 'Y', votes: 0 }] },
    { id: 'q3', text: 'Rate', kind: 2, options: [{ id: 's', text: 'Speed', votes: 4, average: 7.5 }, { id: 'l', text: 'Looks', votes: 4, average: 4 }] },
  ],
  ...over,
})
const p = poll(), [q1, q2, q3] = p.questions as [typeof p.questions[0], typeof p.questions[0], typeof p.questions[0]]

console.log('Whether to bring it up')
check(shouldAsk(p) && !shouldAsk(null), 'an open poll they may answer and have not: yes')
check(!shouldAsk(poll({ mine: 'declined' })) && !shouldAsk(poll({ mine: 'answered' })), 'not once they have answered, or said not now')
check(!shouldAsk(poll({ ended: true })) && !shouldAsk(poll({ mayAnswer: false })), 'not one that is over, or that they may not answer')

console.log('Filling it in')
check(same(pick({}, q1, 'a'), { a: 1 }) && same(pick({ a: 1 }, q1, 'b'), { b: 1 }), 'on "pick one" a second pick takes the place of the first')
check(same(pick({ a: 1 }, q2, 'x'), { a: 1, x: 1 }) && same(pick({ x: 1, y: 1 }, q2, 'x'), { y: 1 }), 'on "pick several" each is ticked and unticked by itself')
check(same(rate({}, 's', 8), { s: 8 }) && rate({}, 's', 14).s === 10 && rate({}, 's', 0).s === 1 && rate({}, 's', 6.6).s === 7, 'a rating is a whole number from 1 to 10')
check(!answered(q1, {}) && answered(q1, { a: 1 }) && !answered(q2, {}) && answered(q2, { y: 1 }) && !answered(q3, { s: 5 }) && answered(q3, { s: 5, l: 9 }), 'each kind of question is answered in its own way')
check(!complete(p, { a: 1, x: 1, s: 5 }) && complete(p, { a: 1, x: 1, s: 5, l: 9 }), 'the poll is ready when every question is')
check(same(toAnswers(p, { a: 1, x: 1, y: 1, s: 5, l: 9, stray: 3 }), [{ optionId: 'a', value: 1 }, { optionId: 'x', value: 1 }, { optionId: 'y', value: 1 }, { optionId: 's', value: 5 }, { optionId: 'l', value: 9 }]),
  'what is sent: picks as 1, ratings as their number, and nothing that is not this poll\'s')
check(same(fromAnswers([{ optionId: 'a', value: 1 }, { optionId: 's', value: 5 }]), { a: 1, s: 5 }) && same(fromAnswers(null), {}), 'what was answered before, back as it was filled in')

console.log('The totals')
check(share(p, q1, q1.options[0]!) === 75 && totalWords(p, q1, q1.options[0]!) === '3 · 75%', 'a pick: its share of the people who answered')
check(share(p, q2, q2.options[0]!) === 100 && share(p, q2, q2.options[1]!) === 0, 'on "pick several" the shares do not have to add up to a hundred')
check(share(p, q3, q3.options[0]!) === 75 && totalWords(p, q3, q3.options[1]!) === '4.0 of 10', 'a rating: its average out of ten')
check(share(poll({ answered: 0 }), q1, { votes: 0 }) === 0, 'nobody has answered: nothing, not a division by nothing')
check(share(poll({ answered: null }), q1, { votes: null }) === null && totalWords(poll({ answered: null }), q1, {}) === null, 'totals that are being kept back are not drawn at all')

console.log(failures === 0 ? 'communityPoll: all passed' : `communityPoll: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} communityPoll checks failed`)
