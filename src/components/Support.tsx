import { useEffect, useState } from 'react'
import type { Api } from '../api'
import type { SupportReportDto } from '../types'
import { Dialog } from './Dialogs'
import { Markdown } from './Markdown'

const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`

const money = (n: number, currency: string) => {
  try { return n.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }) }
  catch { return n.toFixed(2) + ' ' + currency }
}

/**
 * The support window: what whoever runs this Maplecord wrote, the places to give (each opens that site in the
 * browser; nothing is paid in Maplecord), and, if they chose to show it, what running it costs this month, what has
 * been given and what is still short. Asked of the server when it opens.
 */
export function SupportDialog({ api, onClose }: { api: Api; onClose: () => void }) {
  const [report, setReport] = useState<SupportReportDto | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { void api.support().then(setReport).catch(e => setProblem(e instanceof Error ? e.message : String(e))) }, [api])

  const r = report
  const share = r?.goal && r.goal.cost > 0 ? Math.min(1, (r.raised?.total ?? 0) / r.goal.cost) : 0
  return (
    <Dialog title="Support Maplecord" onClose={onClose}>
      {!r && !problem && <div className="muted">Loading…</div>}
      {problem && <div className="muted">{problem}</div>}
      {r && (
        <div className="support">
          {r.message && <Markdown text={r.message} />}
          {r.links.length > 0 && (
            <div className="supportlinks">
              {r.links.map(l => (
                <a key={l.name + l.url} className="supportlink" href={l.url} target="_blank" rel="noreferrer noopener">
                  <b>{l.name}</b>{l.note && <span className="muted">{l.note}</span>}
                </a>
              ))}
            </div>
          )}
          {r.users && (
            <>
              <h4>People</h4>
              <div>{people(r.users.monthlyUsers)} used Maplecord in the last 30 days.</div>
              {r.users.atOnce != null && <div>The relays have room for about {people(r.users.atOnce)} in voice at once{r.users.monthlyCap != null ? `, or about ${r.users.monthlyCap.toLocaleString()} monthly users` : ''}.</div>}
              {r.users.atOnce != null && <div className="muted small">Estimated from what the relays' lines carry and what people have used on them lately.</div>}
            </>
          )}
          {r.showCosts && r.costs && r.raised && r.goal && (
            <>
              <h4>This month</h4>
              <div className="supportbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}
                aria-label={`${money(r.raised.total, r.currency)} of ${money(r.goal.cost, r.currency)}`}>
                <span style={{ width: `${share * 100}%` }} />
              </div>
              <div className="row">
                <span className="grow"><b>{money(r.raised.total, r.currency)}</b> given of <b>{money(r.goal.cost, r.currency)}</b> for {r.goal.name}</span>
                <span className={r.goal.short > 0 ? '' : 'muted'}>{r.goal.short > 0 ? `${money(r.goal.short, r.currency)} short` : 'Met. Thank you!'}</span>
              </div>
              <details>
                <summary>How it adds up</summary>
                <table className="supporttable">
                  <tbody>
                    <tr><td>Backend</td><td>{money(r.costs.backend, r.currency)}</td></tr>
                    {r.costs.relays.length > 0 && <tr><td>Relays ({r.costs.relays.length})</td><td>{money(r.costs.relays.reduce((sum, c) => sum + c.amount, 0), r.currency)}</td></tr>}
                    {r.costs.other.map(c => <tr key={'other' + c.name}><td>{c.name}</td><td>{money(c.amount, r.currency)}</td></tr>)}
                    <tr className="total"><td>Costs now</td><td>{money(r.costs.total, r.currency)}</td></tr>
                    {r.raised.kofi > 0 && <tr><td>Given on Ko-fi</td><td>{money(r.raised.kofi, r.currency)}</td></tr>}
                    {(r.raised.kofiFees ?? 0) > 0 && <tr><td>Ko-fi and card fees</td><td>−{money(r.raised.kofiFees!, r.currency)}</td></tr>}
                    {r.raised.patreon > 0 && <tr><td>Patreon pledges</td><td>{money(r.raised.patreon, r.currency)}</td></tr>}
                    {(r.raised.patreonFees ?? 0) > 0 && <tr><td>Patreon and card fees</td><td>−{money(r.raised.patreonFees!, r.currency)}</td></tr>}
                    {r.raised.byHand > 0 && <tr><td>Given elsewhere</td><td>{money(r.raised.byHand, r.currency)}</td></tr>}
                  </tbody>
                </table>
                {r.estimates && r.measured && (
                  <>
                    <div className="muted small">What it would cost a month to give everyone the same service at each quality of shared video:</div>
                    <table className="supporttable">
                      <tbody>
                        {r.estimates.map(e => <tr key={e.id}><td>{e.name}{e.id === r.quality ? ' (now)' : ''}</td><td>{e.relays} relay{e.relays === 1 ? '' : 's'}</td><td>{money(e.cost, r.currency)}</td></tr>)}
                      </tbody>
                    </table>
                    <div className="muted small">Estimates: a higher quality needs more relays for the same number of people, and a little more for the backend and running it. This month's busiest: {people(r.measured.peakVoice)} in voice and {people(r.measured.peakViewers)} watching shared video at once, {people(r.measured.monthlyUsers)} in the last 30 days.</div>
                  </>
                )}
              </details>
            </>
          )}
        </div>
      )}
      <div className="buttons"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}
