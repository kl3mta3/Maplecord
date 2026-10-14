// How far each of the server's relays is from here, measured once each time the app starts (for each account signed
// in): a few empty requests to each relay's test service, a few kilobytes in all, not a speed test. The server gives a
// voice channel nobody is in yet the relay nearest the first person into it, by what their app measured.

import type { Api } from './api'
import { pingRelay } from './netTest'

/** The account the relays were measured for in this run of the app. */
let measuredFor: string | null = null

/** Measures the relays and tells the server, unless that was done already in this run. Never fails: without it the server chooses as before. */
export async function measureRelaysOnce(api: Api, userId: string): Promise<void> {
  if (measuredFor === userId) return
  measuredFor = userId
  try {
    const relays = await api.voiceRelays()
    // With one relay there is nothing to choose between.
    if (relays.length < 2) return
    const pings = await Promise.all(relays.map(async r => ({ name: r.name, ms: await pingRelay(r.url) })))
    const answered = pings.filter((p): p is { name: string; ms: number } => p.ms !== null)
    if (answered.length > 0) await api.reportRelayPings(answered)
  } catch { /* an older server, or no answer: the server chooses as it did before */ }
}
