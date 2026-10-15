/**
 * When a picture is blurred until it is clicked: what the model on this device (see pictureCheck.ts) says about it.
 * It sorts each picture into five kinds, with how sure it is of each. A picture is blurred when it is at least an
 * even chance that it is pornographic, photographed or drawn. "Sexy" (swimwear, underwear, poses) is not enough on its
 * own: that would blur beach photos.
 *
 * Kept apart from the model so it can be checked without it.
 */
export type PictureKind = 'Drawing' | 'Hentai' | 'Neutral' | 'Porn' | 'Sexy'
export interface PictureGuess { className: PictureKind; probability: number }

export const EXPLICIT_AT = 0.5

/** How sure the model is that a picture is explicit: pornographic, photographed or drawn. */
export function explicitness(guesses: readonly PictureGuess[]): number {
  const of = (kind: PictureKind) => guesses.find(g => g.className === kind)?.probability ?? 0
  return of('Porn') + of('Hentai')
}

export function looksExplicit(guesses: readonly PictureGuess[]): boolean {
  return explicitness(guesses) >= EXPLICIT_AT
}

/**
 * Before a picture goes somewhere public (a public server, a profile, a server's icon or banner, an emoji or a
 * sticker), the app checks it and does not send one it is this sure of. Higher than the blur: refusing to send is
 * a bigger thing than blurring. The server checks again what it is sent.
 */
export const SEND_REFUSE_AT = 0.95
