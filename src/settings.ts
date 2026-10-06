import { DEFAULT_SERVER_URL } from './platform'
import type { UserDto } from './types'

/** Per-install settings in localStorage (Electron's is per app, a browser's is per origin). */
export interface Settings {
  serverUrl: string
  accessToken: string | null
  tokenExpires: string | null
  user: UserDto | null
  soundEnabled: boolean
  soundProfile: string
  overlayEnabled: boolean
  /** Show Roll / Need-Greed / Flip / RPS in the channel header. Slash commands, the overlay and hotkeys work either way. */
  showRollButtons: boolean
  lastGuildId: string | null
  lastChannelId: string | null
  /**
   * P2P voice channels whose warning this person has read and accepted on this device: channel id → the moment that
   * channel became P2P. A channel switched back and forth has a new moment, so it warns again.
   */
  directAcknowledged: Record<string, string>
  audioInputDeviceId: string | null
  audioOutputDeviceId: string | null
  /** Send this computer's sound along with a shared app or screen. Remembered from the last time. */
  shareSound?: boolean
  /** How loud everyone in voice is played, 0 to 1. */
  outputVolume?: number
  /** The app's colours on this device (see theme.ts). */
  theme?: { preset: string; accent: string | null }
  /** Per user id: how you hear them in voice and whether you see what they write. Yours alone; they are never told. */
  users: Record<string, UserPrefs>
  /** Per server id. */
  guilds: Record<string, GuildPrefs>
  /** Folders of servers in the rail, in no particular order: a folder sits where its first server would. */
  guildFolders?: GuildFolder[]
  /** Per game plugin, by plugin id. Detection and auto-rolling are both off until the user turns them on. */
  plugins: Record<string, PluginSettings>
}

/** Servers grouped together in the rail on this device. `open` shows its servers; closed shows a small grid of their icons. */
export interface GuildFolder { id: string; name: string; guildIds: string[]; open: boolean }

export interface UserPrefs {
  /** Voice volume for this person, 0 to 2 (1 = as sent). */
  volume?: number
  /** Do not play their voice at all. */
  muted?: boolean
  /** How loud the sound of a stream they share is played, 0 to 1, and whether it is played at all. */
  streamVolume?: number
  streamMuted?: boolean
  /** Hide their messages, typing and friend requests, and never be notified about them. */
  ignored?: boolean
}

/** 'all' = a desktop notification for every message, 'mentions' = only when someone writes @you, 'none' = never. */
export type NotifyLevel = 'all' | 'mentions' | 'none'

export interface GuildPrefs {
  /** No unread badge, sounds or notifications from this server. */
  muted?: boolean
  notify?: NotifyLevel
}

export const DEFAULT_NOTIFY: NotifyLevel = 'mentions'

export interface PluginSettings {
  /** Read the game's log file to detect drops. */
  watch: boolean
  /** Start a roll as soon as a drop is detected instead of asking. */
  autoRoll: boolean
  /** RollKind used for auto-rolls: 0 = roll, 1 = need / greed. */
  rollKind: 0 | 1
  /** Overrides the log path from the plugin's manifest. */
  logPath: string | null
}

export const defaultPluginSettings = (): PluginSettings => ({ watch: false, autoRoll: false, rollKind: 1, logPath: null })

const KEY = 'maplecord.settings'

const defaults = (): Settings => ({
  serverUrl: DEFAULT_SERVER_URL,
  accessToken: null,
  tokenExpires: null,
  user: null,
  soundEnabled: true,
  soundProfile: 'Default',
  overlayEnabled: true,
  showRollButtons: true,
  lastGuildId: null,
  lastChannelId: null,
  directAcknowledged: {},
  audioInputDeviceId: null,
  audioOutputDeviceId: null,
  users: {},
  guilds: {},
  plugins: {},
})

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults()
  } catch {
    return defaults()
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export const hasValidToken = (s: Settings) =>
  !!s.accessToken && !!s.tokenExpires && new Date(s.tokenExpires).getTime() > Date.now() + 5 * 60_000

export const usesCustomServer = (s: Settings) =>
  s.serverUrl.replace(/\/$/, '').toLowerCase() !== DEFAULT_SERVER_URL.replace(/\/$/, '').toLowerCase()
