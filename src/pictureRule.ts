/**
 * When a picture is blurred until it is clicked: what the model on this device (see pictureCheck.ts) says about it.
 * It sorts each picture into five kinds, with how sure it is of each. A picture is blurred when there is even a fair
 * chance it is pornographic (photographed or drawn) or revealing ("Sexy": swimwear, underwear, nudity the model files
 * there, poses): anything that is not plainly fine. A click shows it.
 *
 * Kept apart from the model so it can be checked without it.
 */
export type PictureKind = 'Drawing' | 'Hentai' | 'Neutral' | 'Porn' | 'Sexy'
export interface PictureGuess { className: PictureKind; probability: number }

/** Blurred from here: anything the model gives this much to being explicit or revealing, together. */
export const BLUR_AT = 0.25

const of = (guesses: readonly PictureGuess[], kind: PictureKind) => guesses.find(g => g.className === kind)?.probability ?? 0

/** How sure the model is that a picture is explicit: pornographic, photographed or drawn. */
export function explicitness(guesses: readonly PictureGuess[]): number {
  return of(guesses, 'Porn') + of(guesses, 'Hentai')
}

/** How sure the model is that a picture is explicit or revealing: what blurring goes by. */
export function questionable(guesses: readonly PictureGuess[]): number {
  return explicitness(guesses) + of(guesses, 'Sexy')
}

export function looksExplicit(guesses: readonly PictureGuess[]): boolean {
  return questionable(guesses) >= BLUR_AT
}

/**
 * Before a picture goes somewhere public (a public server, a profile, a server's icon or banner, an emoji or a
 * sticker), the app checks it, and refuses to send it only when it is all but certain it is pornographic. A revealing picture
 * is blurred for people, not refused. The server checks again what it is sent.
 */
export const SEND_REFUSE_AT = 0.99
