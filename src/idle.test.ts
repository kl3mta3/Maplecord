// Run with: node src/idle.test.ts
import { IDLE_AFTER_MS, IdleWatch, LOOK_AGAIN_MS, type IdleDeps } from './idle.ts'

let failed = false
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failed = true
}

/** A clock and its timers, moved along by hand. */
function world(extra: Partial<IdleDeps> = {}) {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const told: boolean[] = []
  const deps: IdleDeps = {
    now: () => now,
    later: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id },
    cancel: timer => { timers.delete(timer as number) },
    busy: () => false,
    changed: idle => { told.push(idle) },
    ...extra,
  }
  const pass = async (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      due[1].run()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    }
    now = end
  }
  return { deps, told, pass, timers }
}
const MINUTE = 60 * 1000

// ---- In a browser: only what happens in the page counts ----
{
  const w = world()
  const watch = new IdleWatch(w.deps)
  await w.pass(9 * MINUTE)
  check(w.told.length === 0 && !watch.idle, 'nine minutes unused is not idle')
  await w.pass(1 * MINUTE)
  check(w.told.join() === 'true' && watch.idle, 'ten minutes unused is')
  check(w.timers.size === 0, 'in a browser nothing is waited for while idle')
  await w.pass(60 * MINUTE)
  check(w.told.join() === 'true', 'and it is said once, however long it lasts')
  watch.used()
  check(w.told.join() === 'true,false' && !watch.idle, 'the next thing typed or clicked ends it')
  await w.pass(10 * MINUTE)
  check(w.told.join() === 'true,false,true', 'and ten more unused minutes start it again')
}
{
  const w = world()
  const watch = new IdleWatch(w.deps)
  for (let i = 0; i < 30; i++) { await w.pass(4 * MINUTE); watch.used() }
  check(w.told.length === 0, 'someone who keeps using the app is never idle, and the server is told nothing')
  await w.pass(9 * MINUTE + 59 * 1000)
  const before = w.told.length
  await w.pass(1000)
  check(before === 0 && w.told.join() === 'true', 'the ten minutes are counted from the last thing they did')
}

// ---- Voice: there, whatever the keyboard says ----
{
  let inVoice = true
  const w = world({ busy: () => inVoice })
  const watch = new IdleWatch(w.deps)
  await w.pass(45 * MINUTE)
  check(w.told.length === 0, 'someone in a voice channel or a call is not idle, however long their hands are off')
  inVoice = false
  watch.used() // leaving is told to it, as joining is
  await w.pass(9 * MINUTE + 59 * 1000)
  const yet = w.told.length
  await w.pass(1000)
  check(yet === 0 && w.told.join() === 'true', 'out of it, the ten minutes start then')
}

// ---- The desktop app: the whole computer's keyboard and mouse ----
{
  let system = 0
  const w = world({ systemIdleSeconds: async () => system })
  const watch = new IdleWatch(w.deps)
  // Playing a game: nothing happens in our window, but the computer is in use.
  await w.pass(30 * MINUTE)
  check(w.told.length === 0, 'desktop: using something else on the computer is not being idle')
  system = 10 * 60
  await w.pass(10 * MINUTE)
  check(w.told.join() === 'true' && watch.idle, 'desktop: ten minutes off the keyboard and mouse is')
  await w.pass(5 * MINUTE)
  check(w.told.join() === 'true', 'desktop: still away, nothing more is said')
  system = 2
  await w.pass(LOOK_AGAIN_MS)
  check(w.told.join() === 'true,false' && !watch.idle, 'desktop: back at the computer, in any window, ends it within a quarter of a minute')
  system = 4 * 60
  await w.pass(IDLE_AFTER_MS)
  const atTen = w.told.length
  system = 10 * 60
  await w.pass(6 * MINUTE - 1000)
  const early = w.told.length
  await w.pass(1000)
  check(atTen === 2 && early === 2 && w.told.join() === 'true,false,true', 'desktop: used four minutes before a look, the next look is six minutes on, when the ten would be up')
}
{
  const w = world({ systemIdleSeconds: async () => { throw new Error('no answer') } })
  new IdleWatch(w.deps)
  await w.pass(10 * MINUTE)
  check(w.told.join() === 'true', 'desktop: if the computer cannot be asked, what happened in the app is used')
}
{
  const w = world()
  const watch = new IdleWatch(w.deps)
  watch.stop()
  await w.pass(30 * MINUTE)
  check(w.told.length === 0 && w.timers.size === 0, 'stopped, it waits for nothing and says nothing')
}

if (failed) throw new Error('idle: some checks failed')
console.log('idle: all passed')
