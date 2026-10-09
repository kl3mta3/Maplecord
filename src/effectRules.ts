/**
 * What a profile effect may cover of the profile card it plays over. The numbers come from drawing the animation
 * and looking at it (see effectCheck.ts); this file is only the deciding, so it can be tested without a screen.
 */

/** The most of the card an effect may hide at any one moment. */
export const MOST_HIDDEN = 0.35
/** Painted over this much of the card at once, however faintly, an animation has a background. */
export const BACKGROUND = 0.7
/** For how long, before it counts: one flash across the whole card is not a background. */
export const BACKGROUND_SECONDS = 0.25

/**
 * The middle of the card that has to stay readable: where the picture, the name and the tag sit. As shares of the
 * card's width and height. A card is as tall as what is written on it, and the effect is cropped to fit, so this is
 * the band those can be in on a short card or a long one, not their exact outline.
 */
export const MIDDLE = { left: 10 / 300, right: 290 / 300, top: 40 / 420, bottom: 200 / 420 }
/** How long any one spot of it may stay hidden. Things may pass over it; nothing may stay. */
export const MIDDLE_SECONDS = 0.5

/**
 * One look at the animation: the share of the card it hides (more than half opaque), the share it paints on at all,
 * and, spot by spot across the protected middle, whether that spot is hidden.
 */
export interface EffectSample { hidden: number; painted: number; middle?: boolean[] }

/** The most looks in a row for which `at` holds. The animation repeats, so its end runs on into its start. */
function longestRun(looks: number, at: (look: number) => boolean): number {
  let longest = 0, all = true
  for (let i = 0, run = 0; i < looks * 2; i++) {
    if (at(i % looks)) run++; else { run = 0; all = false }
    longest = Math.max(longest, run)
  }
  return all ? Infinity : longest
}

const percent = (share: number) => Math.round(share * 100)

/** Why an animation cannot be a profile effect, in words for whoever is uploading it, or null if it can. */
export function effectProblem(samples: EffectSample[], secondsApart: number): string | null {
  if (samples.length === 0) return null
  // A background: most of the card painted, and staying painted.
  if (longestRun(samples.length, i => samples[i]!.painted > BACKGROUND) * secondsApart >= BACKGROUND_SECONDS)
    return `This animation has a background: it paints over ${percent(Math.max(...samples.map(s => s.painted)))}% of the card. A profile effect cannot have one, so the profile shows behind it.`
  const most = Math.max(...samples.map(s => s.hidden))
  if (most > MOST_HIDDEN)
    return `This animation hides up to ${percent(most)}% of the card at once. A profile effect may hide at most ${percent(MOST_HIDDEN)}%, so the profile behind it can still be read.`
  // Something parked over the picture and the name: any one spot of the middle hidden for too long at a stretch.
  const spots = samples[0]!.middle?.length ?? 0
  let parked = 0
  for (let spot = 0; spot < spots; spot++) parked = Math.max(parked, longestRun(samples.length, i => samples[i]!.middle?.[spot] === true))
  if (parked * secondsApart >= MIDDLE_SECONDS) {
    const long = parked === Infinity ? 'the whole time' : `${(parked * secondsApart).toFixed(1)} seconds at a time`
    return `This animation keeps part of the middle of the card covered ${long}, where the picture and the name are. Things can pass over them, but nothing can stay there for more than half a second.`
  }
  return null
}
