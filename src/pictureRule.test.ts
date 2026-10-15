// Plain-Node checks for when a picture is blurred: `node src/pictureRule.test.ts`.
import { explicitness, looksExplicit, SEND_REFUSE_AT, type PictureGuess, type PictureKind } from './pictureRule.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++ }
const guess = (sure: Partial<Record<PictureKind, number>>): PictureGuess[] =>
  (['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as PictureKind[]).map(k => ({ className: k, probability: sure[k] ?? 0 }))

check(!looksExplicit(guess({ Neutral: 0.97, Drawing: 0.03 })), 'an ordinary photo is shown')
check(!looksExplicit(guess({ Drawing: 0.9, Neutral: 0.1 })), 'an ordinary drawing is shown')
check(looksExplicit(guess({ Porn: 0.8, Sexy: 0.2 })), 'a photo that is likely pornographic is blurred')
check(looksExplicit(guess({ Hentai: 0.7, Drawing: 0.3 })), 'a drawing that is likely pornographic is blurred')
check(looksExplicit(guess({ Porn: 0.3, Hentai: 0.25, Neutral: 0.45 })), 'photographed and drawn count together: an even chance between them is blurred')
check(!looksExplicit(guess({ Sexy: 0.95, Neutral: 0.05 })), 'swimwear and the like on their own are shown')
check(!looksExplicit([]), 'with no answer at all, nothing is blurred by this rule')
check(explicitness(guess({ Porn: 0.9, Hentai: 0.06 })) >= SEND_REFUSE_AT && explicitness(guess({ Porn: 0.8, Sexy: 0.2 })) < SEND_REFUSE_AT, 'only a picture the model is very sure of is kept from being sent somewhere public; one it would only blur is still sent')

console.log(failures === 0 ? 'pictureRule: all passed' : `pictureRule: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} pictureRule checks failed`)
