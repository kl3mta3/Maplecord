// A shared stream in a P2P channel, sent to several viewers without encoding it once for each of them.
//
// Ordinarily every viewer of a P2P stream costs the sharer's computer another encode. From the third viewer on, the
// picture is instead encoded once for each of a few qualities ("levels": the sharer's own choice and up to two
// smaller ones), and every viewer is sent a copy of the frames of one of them. A level encoded at 60 frames a second
// can also be sent at 30, by leaving out every other frame, with nothing encoded again. Which one a viewer gets is
// the best their connection takes, or less if they asked for less.
//
// This file is the deciding: which levels, which is offered to whom, when to move a viewer down or up. The frames
// themselves are copied in streamLadderWorker.ts, and stream.ts holds the connections.

import type { StreamQuality } from './stream'

/** Shared encoding starts when a stream has this many viewers who can take it, and ends when it is down to `LADDER_OFF`. */
export const LADDER_AT = 3
export const LADDER_OFF = 1

/** How many levels there are at most: the sharer's choice and two below it. */
export const MOST_LEVELS = 3

/** How often each viewer's connection is looked at while frames are shared. */
export const HEALTH_EVERY_MS = 2000

/** For this long after a viewer is put on something, their connection is still settling (see judge). */
export const SETTLE_MS = 10_000

/** Something a viewer can be sent: a level as it is encoded, or a 60-a-second level with every other frame left out. */
export interface LadderOption {
  height: number; fps: number; kbps: number
  /** Which level it is a copy of (0 = the sharer's own choice). */
  level: number
  /** Sent with every other frame left out. */
  half: boolean
}

/** What a 60-a-second level costs when it is sent at 30: the frames left out are the cheap ones. */
const HALF_RATE = 0.65

/**
 * The levels for a stream: what the sharer chose, then the next two smaller picture sizes this channel allows, each
 * at the sharer's own frames a second. `choices` is what a sharer may pick from here (see qualityChoices).
 */
export function ladderLevels(chosen: StreamQuality, choices: StreamQuality[]): StreamQuality[] {
  const levels: StreamQuality[] = [{ ...chosen }]
  const smaller = [...new Set(choices.map(c => c.height))].filter(h => h < chosen.height).sort((a, b) => b - a).slice(0, MOST_LEVELS - 1)
  for (const height of smaller) {
    const same = choices.find(c => c.height === height && c.fps === chosen.fps)
    // No rate is set for this size at these frames a second: the rate of the size at 30 is scaled to it.
    const other = choices.filter(c => c.height === height).sort((a, b) => Math.abs(a.fps - chosen.fps) - Math.abs(b.fps - chosen.fps))[0]
    const rate = same ? same.kbps : other ? Math.round(other.kbps * (chosen.fps > other.fps ? 1.6 : chosen.fps < other.fps ? 0.625 : 1)) : 0
    const above = levels[levels.length - 1]!.kbps
    // A smaller picture never costs as much as the one above it.
    levels.push({ height, fps: chosen.fps, kbps: Math.max(150, Math.min(rate || above, Math.round(above * 0.8))) })
  }
  return levels
}

/**
 * Everything a viewer can be sent from these levels, the costliest first. A level at 60 a second is also offered at
 * 30 where `halves` says its encoder really makes every other frame one that can be left out: that has to be seen
 * in the frames themselves, since an encoder asked for it does not always do it.
 */
export function ladderOptions(levels: StreamQuality[], halves: (level: number) => boolean = () => true): LadderOption[] {
  const options: LadderOption[] = []
  levels.forEach((l, level) => {
    options.push({ height: l.height, fps: l.fps, kbps: l.kbps, level, half: false })
    if (l.fps >= 50 && halves(level)) options.push({ height: l.height, fps: Math.round(l.fps / 2), kbps: Math.round(l.kbps * HALF_RATE), level, half: true })
  })
  return options.sort((a, b) => b.kbps - a.kbps || b.height - a.height)
}

/** The most a viewer may be sent. Null = no limit of that kind. */
export interface Ceiling { height?: number | null; fps?: number | null; kbps?: number | null }

/** The best option within every ceiling given, or null when none fits. */
export function bestOption(options: LadderOption[], ...ceilings: (Ceiling | null | undefined)[]): LadderOption | null {
  const fits = (o: LadderOption) => ceilings.every(c => !c || ((c.height == null || o.height <= c.height) && (c.fps == null || o.fps <= c.fps) && (c.kbps == null || c.kbps <= 0 || o.kbps <= c.kbps)))
  return options.find(fits) ?? null
}

/** The next option down from this one (the next cheaper), or null at the bottom. */
export const optionBelow = (options: LadderOption[], current: LadderOption): LadderOption | null =>
  options.find(o => o.kbps < current.kbps) ?? null

/** The next option up, or null at the top. */
export const optionAbove = (options: LadderOption[], current: LadderOption): LadderOption | null =>
  [...options].reverse().find(o => o.kbps > current.kbps) ?? null

export const sameOption = (a: LadderOption | null, b: LadderOption | null) => a === b || (!!a && !!b && a.level === b.level && a.half === b.half)

// ---- Whether a viewer's connection is keeping up ---------------------------------------------------------------

/** One look at a viewer's connection: what the engine reckons it can carry, and the share of what was sent that was lost. */
export interface HealthReading { availableKbps: number | null; lost: number | null }

/** What is remembered about one viewer between looks. */
export interface Health { bad: number; good: number; downs: number }
export const newHealth = (): Health => ({ bad: 0, good: 0, downs: 0 })

const BAD_IN_A_ROW = 2
const ROOMY_IN_A_ROW = 6
const STEADY_IN_A_ROW = 15

/**
 * Whether a viewer should be moved after this look: down when the connection has been short of what it is being sent
 * twice in a row; up when it has plainly had room for the option above for a while, or, more slowly, when it has
 * simply been carrying what it is sent without trouble (while little is sent, the engine does not always find out
 * how much more a connection could take; the only way to know is to try). Each move down makes the next move up
 * take longer, so a connection that cannot hold a level is not tried on it over and over.
 */
export function judge(health: Health, reading: HealthReading, current: LadderOption, above: LadderOption | null, settling = false): 'down' | 'up' | null {
  // In the first seconds on something new the engine is still finding out what the connection carries, and its
  // reckoning runs low. Only being far short counts then.
  const short = settling
    ? (reading.availableKbps !== null && reading.availableKbps < current.kbps * 0.5) || (reading.lost !== null && reading.lost > 0.15)
    : (reading.availableKbps !== null && reading.availableKbps < current.kbps * 0.85) || (reading.lost !== null && reading.lost > 0.08)
  if (short) {
    health.good = 0
    if (++health.bad < BAD_IN_A_ROW) return null
    health.bad = 0
    health.downs++
    return 'down'
  }
  health.bad = 0
  const clean = reading.lost === null || reading.lost < 0.02
  const steady = reading.availableKbps !== null && reading.availableKbps >= current.kbps
  if (!above || !clean || !steady) { health.good = 0; return null }
  const roomy = reading.availableKbps! > above.kbps * 1.25
  if (++health.good < (roomy ? ROOMY_IN_A_ROW : STEADY_IN_A_ROW) * Math.min(8, 2 ** health.downs)) return null
  health.good = 0
  return 'up'
}

export const describeOption = (o: { height: number; fps: number }) => `${o.height}p · ${o.fps} fps`
