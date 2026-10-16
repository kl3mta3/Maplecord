import type { Settings } from './settings'
import type { PushChoices } from './types'

/**
 * What this phone wants to be told of while the app is closed, from the same choices the app keeps for its own
 * notifications: servers and channels muted here, each server's level (all, mentions, none), and whether the words
 * of a message may show on the lock screen. Sent to the server with the phone's push token (see store.ts).
 */
export function phoneChoices(s: Settings): PushChoices {
  const notify: PushChoices['notify'] = {}
  const mutedGuilds: string[] = []
  for (const [guildId, prefs] of Object.entries(s.guilds ?? {})) {
    if (prefs.muted) mutedGuilds.push(guildId)
    if (prefs.notify && prefs.notify !== 'mentions') notify[guildId] = prefs.notify
  }
  return {
    showText: s.pushShowText !== false,
    mutedGuilds,
    mutedChannels: Object.entries(s.mutedChannels ?? {}).filter(([, muted]) => muted).map(([id]) => id),
    notify,
  }
}
