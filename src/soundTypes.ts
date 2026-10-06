// Shared by the Electron main process and the UI. Types and constants only.

/**
 * Every moment Maplecord plays a sound. A sound pack is a folder with a file named after each of these
 * (roll.wav, win.wav, ...); see the README.
 */
export const SOUND_EVENTS = ['roll', 'win', 'lose', 'you100', 'one', 'sixtyNine', 'they100', 'emo', 'join', 'leave'] as const
export type SoundEvent = (typeof SOUND_EVENTS)[number]

/** A pack the user added: its folder name, and the file it has for each event it covers. */
export interface SoundPack { name: string; events: Partial<Record<SoundEvent, string>> }

export const DEFAULT_SOUND_PACK = 'Default'
