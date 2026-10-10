/**
 * Noticing that the app has gone unused, so that someone who chose Online can be shown as idle.
 *
 * "Unused" is nothing typed, clicked or moved for ten minutes: in the desktop app anywhere on the computer (so
 * someone playing a game with Maplecord behind it is not idle), in a browser in Maplecord's own page. Someone in a
 * voice channel or a call is there whatever the keyboard says.
 *
 * Nothing here talks to the server on a timer. The one timer is the wait for the ten minutes to pass; the server is
 * told when the answer changes, and only then.
 */

/** How long the app goes unused before its owner is shown as idle. */
export const IDLE_AFTER_MS = 10 * 60 * 1000
/** While idle, how often the desktop app looks at whether the keyboard and mouse are in use again. */
export const LOOK_AGAIN_MS = 15 * 1000

export interface IdleDeps {
  now(): number
  later(run: () => void, ms: number): unknown
  cancel(timer: unknown): void
  /** Desktop only: seconds since the keyboard or mouse was last used, anywhere on the computer. */
  systemIdleSeconds?: () => Promise<number>
  /** In a voice channel or a call. */
  busy(): boolean
  /** The app has gone unused (true), or is in use again (false). Called only when that changes. */
  changed(idle: boolean): void
}

export class IdleWatch {
  idle = false
  private last: number
  private timer: unknown = null
  private stopped = false
  private readonly deps: IdleDeps

  constructor(deps: IdleDeps) {
    this.deps = deps
    this.last = deps.now()
    this.wait(IDLE_AFTER_MS)
  }

  /** Something was typed, clicked or moved in the app, or a voice channel or call was joined or left. */
  used() {
    this.last = this.deps.now()
    if (this.idle) this.set(false)
  }

  stop() {
    this.stopped = true
    this.deps.cancel(this.timer)
    this.timer = null
  }

  private wait(ms: number) {
    this.deps.cancel(this.timer)
    this.timer = this.deps.later(() => { void this.look() }, Math.max(1000, ms))
  }

  private set(idle: boolean) {
    this.idle = idle
    this.deps.changed(idle)
    // In a browser there is nothing to look at while idle: the next thing typed or clicked here says they are back.
    if (!idle) this.wait(IDLE_AFTER_MS)
    else if (this.deps.systemIdleSeconds) this.wait(LOOK_AGAIN_MS)
    else { this.deps.cancel(this.timer); this.timer = null }
  }

  private async look() {
    if (this.deps.busy()) this.last = this.deps.now()
    let unused = this.deps.now() - this.last
    if (this.deps.systemIdleSeconds) {
      // The whole computer's keyboard and mouse, where that can be asked: someone using another window is not idle.
      // Whichever was the more recent counts, so that leaving a call (which is "used" here) starts the wait afresh.
      const seconds = await this.deps.systemIdleSeconds().catch(() => null)
      if (seconds !== null) unused = Math.min(unused, seconds * 1000)
    }
    if (this.stopped) return
    if (unused >= IDLE_AFTER_MS) { if (this.idle) this.wait(LOOK_AGAIN_MS); else this.set(true) }
    else if (this.idle) this.set(false)
    else this.wait(IDLE_AFTER_MS - unused)
  }
}
