import { DEFAULT_SERVER_URL } from './platform'
import type { PushKey } from './pushToTalk'
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
  /** When the microphone is sent: while talking (the default), or while a key is held. */
  voiceMode?: 'activity' | 'push'
  /**
   * In P2P channels and P2P calls, where nothing crosses a relay: the most this person's microphone sends, and the
   * most their shared video sends each viewer, in kilobits per second. 0 or unset leaves it to the server's setting
   * (voice) or to the quality they pick when sharing (video).
   */
  /** Join P2P voice channels through the relay rather than directly: nobody there learns this person's address, and the relayed limits apply to them. */
  p2pViaRelay?: boolean
  /**
   * P2P channels this person has subscribed to: their app stays connected to these whenever it is open, not only while
   * they are being read, so messages arrive as they are sent.
   */
  p2pSubscribed?: Record<string, boolean>
  /**
   * The P2P bots this person has agreed to connect to, by the bot's account, with the name it had then. A bot's host
   * can find the address of whoever connects to it, so nobody's app connects to one until they have said so.
   */
  p2pBotsAccepted?: Record<string, string>
  /** P2P channels where this app does NOT hand other members the messages they missed. Unset means it does. */
  p2pNoBroadcast?: Record<string, boolean>
  p2pAudioKbps?: number
  p2pVideoKbps?: number
  /** The key or mouse button held to talk (see pushToTalk.ts). */
  pushKey?: PushKey
  /** The "add to your Home Screen" card has been seen on this device. */
  installHintSeen?: boolean
  /** Send the microphone only while talking (on unless set to false), and how loud counts as talking, 1 (a whisper) to 10. */
  voiceGate?: boolean
  voiceGateLevel?: number
  /** The app's colours on this device (see theme.ts). */
  theme?: { preset: string; accent: string | null }
  /** How the QR code of the friend link was last drawn on this device (see FriendLink.tsx). */
  qrLook?: string
  /** Per user id: how you hear them in voice and whether you see what they write. Yours alone; they are never told. */
  users: Record<string, UserPrefs>
  /** Per server id. */
  guilds: Record<string, GuildPrefs>
  /** Channels you have muted on this device: no unread mark, sound or notification from them. */
  mutedChannels?: Record<string, boolean>
  /** Groups of channels this person has folded shut, by id. Theirs alone: nobody else's list changes. */
  collapsedGroups?: Record<string, boolean>
  /** Folders of servers in the rail, in no particular order: a folder sits where its first server would. */
  guildFolders?: GuildFolder[]
  /** Per game plugin, by plugin id. Detection and auto-rolling are both off until the user turns them on. */
  plugins: Record<string, PluginSettings>
  /** How wide this person dragged the channel list and the member list, in pixels. Unset = as the app comes. */
  columnWidths?: { sidebar?: number; members?: number }
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

/** How loud counts as talking until someone chooses, and what each step means to the voice engine (4 is its own default). */
export const DEFAULT_GATE_LEVEL = 4
export const gateThreshold = (level: number) => 0.005 * Math.max(1, Math.min(10, level))

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
