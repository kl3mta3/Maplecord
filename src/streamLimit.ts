/**
 * Holding a stream to what its sharer may send, from the watching side.
 *
 * Every app is told the quality and rate it may share at, and keeps to it. A stream server has no way to refuse
 * more, so an app altered to send more would get it there. What it cannot do is get anyone to watch: with their pass
 * to a stream, a viewer's app is told what that stream's sharer may send, measures what actually arrives, and stops
 * watching a stream that stays over it. Nothing here depends on what the sharer's app says about itself.
 */

/** What a stream's sharer may send: a quality, and the kilobits a second that go with it. */
export interface StreamLimit { height: number; fps: number; kbps: number }

/** One reading of what is arriving: the picture's size, how many pictures a second, and the rate since the last reading. */
export interface StreamReading { width: number; height: number; fps: number; kbps: number }

/** How often what arrives is read, and how many readings in a row have to be over before the stream is let go. */
export const READ_EVERY_MS = 5000
export const READINGS_OVER = 3

// How far over counts. An honest app lands at or under its limit; the margins are for what a connection adds on its
// own account: packets sent again after loss, a burst after a pause, a frame rate that wobbles.
const RATE_MARGIN = 1.25
const SIZE_MARGIN = 1.05
const FPS_MARGIN = 5

/**
 * Whether one reading is over the limit, and in what. The picture is judged by its shorter side: a quality is named
 * for its height, an app scales a capture down by that, and a tall window or a turned phone has it as its width.
 */
export function overLimit(reading: StreamReading, limit: StreamLimit): 'rate' | 'size' | 'frames' | null {
  if (reading.kbps > limit.kbps * RATE_MARGIN) return 'rate'
  const shorter = Math.min(reading.width || reading.height, reading.height || reading.width)
  if (shorter > limit.height * SIZE_MARGIN) return 'size'
  if (reading.fps > limit.fps + FPS_MARGIN) return 'frames'
  return null
}

/** Keeps count of readings in a row that were over. Returns true when the stream should be let go. */
export function makeGuard(limit: StreamLimit): (reading: StreamReading) => boolean {
  let over = 0
  return reading => {
    over = overLimit(reading, limit) ? over + 1 : 0
    return over >= READINGS_OVER
  }
}
