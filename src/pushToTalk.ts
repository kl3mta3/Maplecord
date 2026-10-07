/**
 * Push to talk: the microphone is only sent while a chosen key (or mouse button) is held.
 *
 * In a browser the page only hears keys while it is in front. The desktop app also listens for that one key while
 * another window (a game) is in front; see electron/pushKey.ts.
 */

/** The key or mouse button held to talk. `code` is KeyboardEvent.code, or the mouse button as a browser numbers it. */
export interface PushKey { kind: 'key' | 'mouse'; code: string; label: string }

export const DEFAULT_PUSH_KEY: PushKey = { kind: 'key', code: 'Backquote', label: '`' }

/** How long the microphone stays open after the key is let go, so the end of a word is not cut off. */
export const PUSH_RELEASE_MS = 180

/** A key press or a mouse press, by the one thing about it that matters here. (Named this way so the desktop's own code, which knows no browser types, can read this file.) */
export type Press = { code: string } | { button: number }

const KEY_LABELS: Record<string, string> = {
  Backquote: '`', Space: 'Space', CapsLock: 'Caps Lock', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Win', MetaRight: 'Right Win', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
}
const MOUSE_LABELS: Record<string, string> = { '1': 'Middle mouse button', '3': 'Mouse button 4', '4': 'Mouse button 5' }

const keyLabel = (code: string) =>
  KEY_LABELS[code] ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : code.replace(/^Numpad/, 'Numpad '))

/**
 * The key this press would choose, or null if it cannot be one: Escape (which cancels choosing) and the left and
 * right mouse buttons (which are needed for everything else).
 */
export function pushKeyFrom(event: Press): PushKey | null {
  if ('code' in event) return event.code && event.code !== 'Escape' ? { kind: 'key', code: event.code, label: keyLabel(event.code) } : null
  const button = String(event.button)
  return MOUSE_LABELS[button] ? { kind: 'mouse', code: button, label: MOUSE_LABELS[button] } : null
}

export const isPushKey = (key: PushKey, event: Press) =>
  'code' in event ? key.kind === 'key' && event.code === key.code : key.kind === 'mouse' && String(event.button) === key.code

/** The same key under the name the desktop's global listener knows it by (uiohook's), or null if it has none. */
export function hookKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  const renamed: Record<string, string> = { ControlLeft: 'Ctrl', ControlRight: 'CtrlRight', ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', AltLeft: 'Alt', AltRight: 'AltRight', MetaLeft: 'Meta', MetaRight: 'MetaRight' }
  return renamed[code] ?? code
}

/** A browser's mouse button number as the desktop's global listener numbers it (1 left, 2 right, 3 middle, 4, 5). */
export const hookMouseButton = (code: string): number | null => ({ '1': 3, '3': 4, '4': 5 } as Record<string, number>)[code] ?? null

// While Settings is waiting for a new key to be pressed, that press must not also open the microphone.
let choosing = false
export const setChoosingPushKey = (on: boolean) => { choosing = on }
export const isChoosingPushKey = () => choosing
