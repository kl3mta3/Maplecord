// Plain-Node checks for when a picture is blurred: `node src/pictureRule.test.ts`.
import { BLUR_AT, explicitness, looksExplicit, SEND_REFUSE_AT, type PictureGuess, type PictureKind } from './pictureRule.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++ }
const guess = (sure: Partial<Record<PictureKind, number>>): PictureGuess[] =>
  (['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as PictureKind[]).map(k => ({ className: k, probability: sure[k] ?? 0 }))

check(BLUR_AT === 0.25 && SEND_REFUSE_AT === 0.99, 'blurring starts at 25%; refusing to send only at 99%')
check(!looksExplicit(guess({ Neutral: 0.97, Drawing: 0.03 })), 'an ordinary photo is shown')
check(!looksExplicit(guess({ Drawing: 0.9, Neutral: 0.1 })), 'an ordinary drawing is shown')
check(!looksExplicit(guess({ Neutral: 0.8, Sexy: 0.1, Porn: 0.05, Hentai: 0.05 })), 'a little of everything, under the line, is shown')
check(looksExplicit(guess({ Porn: 0.8, Sexy: 0.2 })), 'a photo that is likely pornographic is blurred')
check(looksExplicit(guess({ Hentai: 0.3, Drawing: 0.7 })), 'a drawing with a fair chance of being pornographic is blurred')
check(looksExplicit(guess({ Sexy: 0.99, Porn: 0.01 })), 'swimwear, underwear and nudity the model files as revealing are blurred')
check(looksExplicit(guess({ Sexy: 0.15, Porn: 0.1, Neutral: 0.75 })), 'revealing and explicit count together')
check(!looksExplicit([]), 'with no answer at all, nothing is blurred by this rule')
check(explicitness(guess({ Porn: 0.98, Hentai: 0.015 })) >= SEND_REFUSE_AT && explicitness(guess({ Porn: 0.97 })) < SEND_REFUSE_AT && explicitness(guess({ Sexy: 0.99 })) < SEND_REFUSE_AT,
  'only a picture the model is very sure is pornographic is kept from being sent somewhere public; a revealing one is only blurred')

console.log(failures === 0 ? 'pictureRule: all passed' : `pictureRule: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} pictureRule checks failed`)
