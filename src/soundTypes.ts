// Shared by the Electron main process and the UI. Types and constants only.

/**
 * Every moment Maplecord plays a sound. A sound pack is a folder with a file named after each of these
 * (roll.wav, win.wav, ...); see the README.
 */
export const SOUND_EVENTS = ['roll', 'win', 'lose', 'you100', 'one', 'sixtyNine', 'they100', 'emo', 'join', 'leave', 'message', 'drop', 'removed', 'watch', 'unwatch'] as const
export type SoundEvent = (typeof SOUND_EVENTS)[number]

/** What each is for, in words (the sound settings, and the README of a pack). */
export const SOUND_LABELS: Record<SoundEvent, string> = {
  roll: 'A roll you are in starts',
  win: 'You win a roll',
  lose: 'You lose a roll',
  you100: 'You win with a 100',
  one: 'You roll a 1',
  sixtyNine: 'You roll a 69',
  they100: 'Someone else wins with a 100',
  emo: 'Emotional damage: you lose by 5 or less',
  join: 'Someone joins your voice channel',
  leave: 'Someone leaves your voice channel',
  message: 'A message arrives',
  drop: 'A game plugin spots a loot drop',
  removed: 'You are taken out of a voice channel or call',
  watch: 'Someone starts watching your stream',
  unwatch: 'Someone stops watching your stream',
}

/** A pack the user added: its folder name, and the file it has for each event it covers. */
export interface SoundPack { name: string; events: Partial<Record<SoundEvent, string>> }

export const DEFAULT_SOUND_PACK = 'Default'
