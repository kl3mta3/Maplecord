import type { ReactNode } from 'react'

/** A name cut into the letters a person would count: an emoji or an accented letter stays whole. */
export function lettersOf(text: string): string[] {
  const Cutter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter
  return Cutter ? [...new Cutter(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.segment) : Array.from(text)
}

/** How long after the first letter the last one begins to move. */
const SPREAD_SECONDS = 0.09

/**
 * What goes inside a name: the text as it is, or, for an effect drawn a letter at a time (Jelly), each letter in a
 * piece of its own with the next of the colours, so that each can be squashed and stretched by itself. The pieces
 * are for the eye only; whoever uses a screen reader is given the name whole by the element around them.
 */
export function nameContent(label: string, palette: string[] | null | undefined): ReactNode {
  if (!palette || palette.length === 0) return label
  const letters = lettersOf(label)
  // The whole name is squashed nearly at once, the left end a moment before the right, however long the name is.
  const apart = SPREAD_SECONDS / Math.max(1, letters.length - 1)
  return letters.map((letter, i) => (
    <span key={i} className="fxl" aria-hidden="true" style={{ color: palette[i % palette.length], animationDelay: `${(i * apart).toFixed(3)}s` }}>{letter}</span>
  ))
}
