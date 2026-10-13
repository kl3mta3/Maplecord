// Community polls: questions put to everyone by whoever runs this Maplecord, about features and where it should go.
// (Not the polls people post in channels.) The app shows a new one once; it is answered once, for good, or put off
// with "not now", after which it can still be found under Settings, App. This file is the part with no screen in it.

import type { CommunityPollAnswerDto, CommunityPollDto, CommunityPollQuestionDto } from './types'

export const PICK_ONE = 0, PICK_SEVERAL = 1, RATE = 2

/** What someone has filled in so far: for each option, 1 if it is picked, or the number they gave it. */
export type Filled = Record<string, number>

/** Whether a poll should be put in front of someone by itself: it is open, they may answer it, and they have neither answered nor said "not now". */
export const shouldAsk = (poll: CommunityPollDto | null | undefined) => !!poll && !poll.ended && poll.mayAnswer && poll.mine === 'none'

/** Picking an answer: on a "pick one" question it takes the place of the one picked before; on "pick several" it is ticked or unticked. */
export function pick(filled: Filled, question: CommunityPollQuestionDto, optionId: string): Filled {
  const next = { ...filled }
  if (question.kind === PICK_ONE) {
    for (const o of question.options) delete next[o.id]
    next[optionId] = 1
  } else if (next[optionId]) delete next[optionId]
  else next[optionId] = 1
  return next
}

/** Giving something a number from 1 to 10. */
export const rate = (filled: Filled, optionId: string, value: number): Filled => ({ ...filled, [optionId]: Math.min(10, Math.max(1, Math.round(value))) })

/** Whether one question has been answered as its kind asks. */
export function answered(question: CommunityPollQuestionDto, filled: Filled): boolean {
  const given = question.options.filter(o => filled[o.id] !== undefined)
  if (question.kind === PICK_ONE) return given.length === 1
  if (question.kind === PICK_SEVERAL) return given.length >= 1
  return given.length === question.options.length
}

/** Whether every question has been: only then can the poll be sent. */
export const complete = (poll: CommunityPollDto, filled: Filled) => poll.questions.every(q => answered(q, filled))

/** What is sent: only what belongs to this poll's questions. */
export function toAnswers(poll: CommunityPollDto, filled: Filled): CommunityPollAnswerDto[] {
  return poll.questions.flatMap(q => q.options.filter(o => filled[o.id] !== undefined).map(o => ({ optionId: o.id, value: q.kind === RATE ? filled[o.id]! : 1 })))
}

/** What someone answered before, in the shape the screen fills in. */
export const fromAnswers = (answers: CommunityPollAnswerDto[] | null | undefined): Filled => Object.fromEntries((answers ?? []).map(a => [a.optionId, a.value]))

/** How wide an option's bar is, out of 100: its share of the people who answered, or for a rating its average out of ten. Null when the totals are not shown. */
export function share(poll: CommunityPollDto, question: CommunityPollQuestionDto, option: { votes?: number | null; average?: number | null }): number | null {
  if (poll.answered === null || poll.answered === undefined || option.votes === null || option.votes === undefined) return null
  if (question.kind === RATE) return Math.min(100, Math.max(0, (option.average ?? 0) * 10))
  return poll.answered === 0 ? 0 : Math.min(100, option.votes * 100 / poll.answered)
}

/** The words beside a bar: "12 · 40%", or "7.5 of 10". */
export function totalWords(poll: CommunityPollDto, question: CommunityPollQuestionDto, option: { votes?: number | null; average?: number | null }): string | null {
  const width = share(poll, question, option)
  if (width === null) return null
  return question.kind === RATE ? `${(option.average ?? 0).toFixed(1)} of 10` : `${option.votes} · ${Math.round(width)}%`
}
