import { createRequire } from 'node:module'
import { hookKeyName, hookMouseButton, type PushKey } from '../src/pushToTalk'

/**
 * The desktop half of push to talk: knowing whether one chosen key (or mouse button) is held while some other window,
 * a game usually, is in front. A window only hears keys while it is the one being typed into, so this uses a
 * system-wide listener (uiohook, the library other voice apps use for the same job).
 *
 * The listener only runs while it is wanted: push to talk is on and the person is in voice. It looks at nothing but
 * whether the chosen key went down or up; no other key is recorded, kept or passed on.
 *
 * If the listener cannot be loaded on this computer, push to talk still works while Maplecord is in front.
 */
type Hook = typeof import('uiohook-napi')

let hook: Hook | null = null
let listening = false
let wantedKey: number | null = null
let wantedButton: number | null = null
let held = false
let tell: (held: boolean) => void = () => {}

function set(now: boolean) {
  if (now === held) return
  held = now
  tell(now)
}

async function load(): Promise<Hook | null> {
  if (hook) return hook
  try {
    // Loaded as it sits in node_modules, by name at run time: it is a compiled library, and folded into this file by
    // the bundler it can no longer find its own compiled half.
    hook = createRequire(import.meta.url)('uiohook-napi') as Hook
    hook.uIOhook.on('keydown', e => { if (wantedKey !== null && e.keycode === wantedKey) set(true) })
    hook.uIOhook.on('keyup', e => { if (wantedKey !== null && e.keycode === wantedKey) set(false) })
    hook.uIOhook.on('mousedown', e => { if (wantedButton !== null && Number(e.button) === wantedButton) set(true) })
    hook.uIOhook.on('mouseup', e => { if (wantedButton !== null && Number(e.button) === wantedButton) set(false) })
    return hook
  } catch (e) {
    console.error('[push to talk] no system-wide key listener on this computer:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Starts watching `key`, or stops watching with null. `onChange` is told each time the key goes down or up.
 * Resolves false when the key cannot be watched system-wide (the listener would not load, or it does not know the key).
 */
export async function watchPushKey(key: PushKey | null, onChange: (held: boolean) => void): Promise<boolean> {
  tell = onChange
  wantedKey = null
  wantedButton = null
  set(false)
  if (key) {
    const lib = await load()
    if (lib) {
      if (key.kind === 'mouse') wantedButton = hookMouseButton(key.code)
      else {
        const name = hookKeyName(key.code)
        const code = name ? (lib.UiohookKey as Record<string, number>)[name] : undefined
        wantedKey = typeof code === 'number' ? code : null
      }
    }
  }
  const wanted = wantedKey !== null || wantedButton !== null
  if (wanted && !listening) { hook!.uIOhook.start(); listening = true }
  if (!wanted && listening) { hook!.uIOhook.stop(); listening = false }
  return wanted
}

/** On the way out: the listener must not outlive the app. */
export function stopPushKey() {
  if (listening) { try { hook?.uIOhook.stop() } catch { /* already stopped */ } listening = false }
}
