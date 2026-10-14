import { useEffect, useRef, useState } from 'react'
import type { Api } from '../api'
import type { StreamSettingsDto, TestRelayDto } from '../types'
import { atTheCap, measureDown, measureUp, pingRelay, rateFor, rating, showMbps, showWait, speedInWords, viewersAt } from '../netTest'
import { Dialog } from './Dialogs'

/** What the last test found, kept while the app is open so it can be shown again during the wait for the next one. */
interface Found { down: number; up: number; /** The most the test could go, each way; null if the relay did not say. */ downCap: number | null; upCap: number | null; relay: string; at: number }
let lastFound: Found | null = null

type Step = 'looking' | 'pinging' | 'download' | 'upload' | 'done' | 'none'

/** Where a relay is, as its owner described it, or its name. */
const placeOf = (r: { name: string; region?: string | null }) => r.region?.trim() || r.name

/**
 * The connection test (see netTest.ts): opened, it pings the server's relays and, unless a test was run in the last
 * few minutes, measures the download and the upload against the one the server picks.
 */
export function ConnectionTestDialog({ api, rules, onClose }: { api: Api; rules: StreamSettingsDto | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>('looking')
  const [relays, setRelays] = useState<TestRelayDto[]>([])
  const [pings, setPings] = useState<Record<string, number | null>>({})
  const [live, setLive] = useState(0)
  const [found, setFound] = useState<Found | null>(lastFound)
  const [wait, setWait] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const stop = useRef<AbortController | null>(null)
  // How long ago the speeds shown were measured, reckoned when they are put on screen.
  const [ago, setAgo] = useState(() => (lastFound ? Date.now() - lastFound.at : 0))

  useEffect(() => {
    const control = new AbortController()
    stop.current = control
    const gone = () => control.signal.aborted
    void (async () => {
      setProblem(null); setLive(0); setStep('looking')
      try {
        const said = await api.voiceTest()
        if (gone()) return
        setRelays(said.relays)
        setWait(said.waitSeconds)
        if (said.relays.length === 0) { setStep('none'); return }
        setStep('pinging')
        const measured: Record<string, number | null> = {}
        await Promise.all(said.relays.map(async r => { measured[r.name] = await pingRelay(r.url, control.signal); if (!gone()) setPings(p => ({ ...p, [r.name]: measured[r.name]! })) }))
        if (gone()) return
        // A test was run a moment ago: the pings are new, the speeds are the ones from then.
        if (said.waitSeconds > 0) { setStep('done'); return }
        const pass = await api.voiceTestPass(said.relays.filter(r => measured[r.name] != null).map(r => ({ name: r.name, ms: measured[r.name]! })))
        if (gone()) return
        setStep('download')
        const down = await measureDown(pass.url, pass.pass, setLive, control.signal)
        if (gone()) return
        setLive(0); setStep('upload')
        const up = await measureUp(pass.url, pass.pass, down.seconds ?? 4, setLive, control.signal)
        if (gone()) return
        lastFound = { down: down.mbps, up: up.mbps, downCap: down.capMbps, upCap: up.capMbps ?? down.capMbps, relay: placeOf(pass), at: Date.now() }
        setFound(lastFound)
        setAgo(0)
        setStep('done')
        setWait((await api.voiceTest().catch(() => null))?.waitSeconds ?? 0)
      } catch (e) {
        if (gone()) return
        setProblem(e instanceof Error ? e.message : String(e))
        setStep('done')
        setWait((await api.voiceTest().catch(() => null))?.waitSeconds ?? 0)
      }
    })()
    return () => control.abort()
  }, [api, round])

  // The button to test again comes back when the wait is over. Nothing is asked of the server in the meantime.
  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait(0), wait * 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  // What one viewer of each quality is sent on this server.
  const at60 = { small: rateFor(rules, 720, 60, 4000), large: rateFor(rules, 1080, 60, 8000) }
  const at30 = { small: rateFor(rules, 720, 30, 2500), large: rateFor(rules, 1080, 30, 5000) }
  const called = found ? rating(found.down, atTheCap(found.down, found.downCap) ? found.downCap : null) : null
  const running = step === 'download' || step === 'upload'
  const listed = [...relays].sort((a, b) => (pings[a.name] ?? Infinity) - (pings[b.name] ?? Infinity))

  return (
    <Dialog title="Connection test" onClose={onClose}>
      {step === 'looking' && <div className="muted">Looking for relays…</div>}
      {step === 'none' && <div className="muted">This server has no relay that a connection test can be run against.</div>}

      {relays.length > 0 && (
        <div className="nettest-relays">
          <div className="muted">How far away each relay is</div>
          {listed.map(r => (
            <div key={r.name} className="row"><span className="grow">{placeOf(r)}</span>
              <span className="muted">{r.name in pings ? (pings[r.name] == null ? 'no answer' : `${Math.round(pings[r.name]!)} ms`) : '…'}</span></div>
          ))}
        </div>
      )}

      {running && (
        <div className="nettest-live">
          <div className="muted">{step === 'download' ? 'Testing download…' : 'Testing upload…'}</div>
          <div className="nettest-speed">{showMbps(live)} <span>Mbps</span></div>
        </div>
      )}

      {step === 'done' && found && called && (
        <div className="nettest-found">
          <div className="nettest-rating">Connection to {found.relay}: {called.label} <span>({called.range})</span></div>
          <div className="nettest-speeds">
            <div>Download from the {found.relay} relay: {speedInWords(found.down, found.downCap)}</div>
            <div>Upload to the {found.relay} relay: {speedInWords(found.up, found.upCap)}</div>
          </div>
          <div className="muted">This is your speed to this relay, which is what calls and shared video here go through. A speed test website can show more: it measures to a server much nearer to you.</div>
          <hr />
          <div className="nettest-supports">
            <div>This connection supports (estimates):</div>
            <div><b>{viewersAt(found.up, at60.small)}</b> of 720p · 60 fps</div>
            <div><b>{viewersAt(found.up, at60.large)}</b> of 1080p · 60 fps P2P streams.</div>
            <div><i>At 30 fps: <b>{viewersAt(found.up, at30.small)}</b> of 720p and <b>{viewersAt(found.up, at30.large)}</b> of 1080p.</i></div>
          </div>
          {ago > 15_000 && <div className="muted">Measured {Math.max(1, Math.round(ago / 60_000))} min ago.</div>}
        </div>
      )}
      {step === 'done' && !found && !problem && wait > 0 && <div className="muted">A speed test was run a moment ago on this account.</div>}
      {problem && <div className="error">{problem}</div>}

      <div className="row">
        {step === 'done' && wait > 0 && <span className="muted">You can test the speed again in {showWait(wait)}.</span>}
        <span className="grow" />
        {step === 'done' && wait <= 0 && <button onClick={() => setRound(n => n + 1)}>Test again</button>}
        <button className={running ? '' : 'accent'} onClick={onClose}>{running || step === 'pinging' ? 'Cancel' : 'Close'}</button>
      </div>
    </Dialog>
  )
}
