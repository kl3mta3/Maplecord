import { effectProblem, type EffectSample } from './effectRules.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }
const looks = (n: number, at: (i: number) => EffectSample) => Array.from({ length: n }, (_, i) => at(i))
const clear: EffectSample = { hidden: 0.04, painted: 0.06 }

console.log('What a profile effect may cover')
check(effectProblem(looks(60, () => clear), 0.1) === null, 'small things moving about are fine')
check(effectProblem(looks(60, () => ({ hidden: 0.35, painted: 0.5 })), 0.1) === null, 'hiding exactly as much as is allowed is fine')
check(/hides up to 36%.*at most 35%/.test(effectProblem(looks(60, i => (i === 30 ? { hidden: 0.36, painted: 0.4 } : clear)), 0.1) ?? ''), 'hiding more than that, even for one look, is refused, and the words say how much')
check(/has a background/.test(effectProblem(looks(60, () => ({ hidden: 1, painted: 1 })), 0.1) ?? ''), 'a solid background is refused as a background')
check(/has a background: it paints over 100%/.test(effectProblem(looks(60, () => ({ hidden: 0, painted: 1 })), 0.1) ?? ''), 'so is a faint one that hides nothing')
check(effectProblem(looks(60, i => (i === 10 || i === 11 ? { hidden: 0.1, painted: 0.9 } : clear)), 0.1) === null, 'a flash across the card (two looks, 0.2 s) is not a background')
check(/has a background/.test(effectProblem(looks(60, i => (i >= 10 && i <= 12 ? { hidden: 0.1, painted: 0.9 } : clear)), 0.1) ?? ''), 'three looks in a row (0.3 s) is')
check(/has a background/.test(effectProblem(looks(60, i => (i === 0 || i >= 58 ? { hidden: 0.1, painted: 0.9 } : clear)), 0.1) ?? ''), 'and so is one that runs from the end of the animation into its start')
check(/has a background/.test(effectProblem(looks(1, () => ({ hidden: 0.2, painted: 0.95 })), 0.05) ?? ''), 'an animation of one moment that fills the card has a background')
check(effectProblem(looks(60, () => ({ hidden: 0.2, painted: 0.7 })), 0.1) === null, 'painting on 70% of the card faintly is still not a background')
check(effectProblem([], 0.1) === null, 'nothing measured, nothing refused')

console.log('The middle of the card, where the picture and the name are')
const small: EffectSample = { hidden: 0.05, painted: 0.06 }
const middle = (n: number, hiddenAt: (look: number, spot: number) => boolean) => looks(n, i => ({ ...small, middle: Array.from({ length: 12 }, (_, spot) => hiddenAt(i, spot)) }))
check(effectProblem(middle(60, () => false), 0.1) === null, 'nothing over it is fine')
check(effectProblem(middle(60, (i, spot) => spot === i % 12), 0.1) === null, 'something passing over it, a spot at a time, is fine')
check(effectProblem(middle(60, (i, spot) => spot === 3 && i >= 10 && i < 14), 0.1) === null, 'so is one spot hidden for four looks (0.4 s)')
check(/covered 0.5 seconds at a time/.test(effectProblem(middle(60, (i, spot) => spot === 3 && i >= 10 && i < 15), 0.1) ?? ''), 'one spot hidden for five looks (0.5 s) is refused, and the words say for how long')
check(/covered the whole time/.test(effectProblem(middle(60, (_, spot) => spot === 7), 0.1) ?? ''), 'something that never leaves is refused')
check(/covered 0.6 seconds/.test(effectProblem(middle(60, (i, spot) => spot === 0 && (i >= 57 || i < 3)), 0.1) ?? ''), 'and so is something that stays from the end of the animation into its start')
check(/hides up to 50%/.test(effectProblem(looks(60, () => ({ hidden: 0.5, painted: 0.5, middle: [true] })), 0.1) ?? ''), 'an animation that also hides too much of the card is told that first')

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} profile effect checks failed`)
