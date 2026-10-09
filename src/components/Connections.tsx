import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { ConnectionDto, ConnectionServiceDto, ProfileConnectionDto } from '../types'
import { bridge } from '../platform'

/** How many linked accounts a profile shows before the rest are folded away. */
const SHOWN_FIRST = 3

/**
 * The accounts on other services someone chose to show, on their profile: the first few, and the rest behind a
 * button. A service that has a page for the account links to it; the link opens outside the app.
 */
export function ProfileConnections({ connections }: { connections: ProfileConnectionDto[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? connections : connections.slice(0, SHOWN_FIRST)
  return (
    <div className="connections">
      {shown.map(c => (
        <div key={c.service} className="connection">
          <span className="muted">{c.serviceName}:</span>{' '}
          {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" title={`Open on ${c.serviceName}`}>{c.name}</a> : <span>{c.name}</span>}
        </div>
      ))}
      {connections.length > SHOWN_FIRST && (
        <button className="subtle" onClick={() => setAll(on => !on)} aria-expanded={all}>{all ? 'Show fewer' : `${connections.length - SHOWN_FIRST} more`}</button>
      )}
    </div>
  )
}

/**
 * Settings, Connections: link an account on another service to prove its name is yours, choose which linked accounts
 * show on your profile, and unlink. Linking happens in a browser, at the other service; the app is told when it is done.
 */
export function ConnectionsPane({ store }: { store: Store }) {
  const [services, setServices] = useState<ConnectionServiceDto[] | null>(null)
  const [mine, setMine] = useState<ConnectionDto[]>([])
  const [waiting, setWaiting] = useState<string | null>(null)
  const { loadConnections, connectionsEpoch } = store
  useEffect(() => {
    let alive = true
    void loadConnections().then(got => { if (alive && got) { setServices(got.services); setMine(got.mine); setWaiting(null) } })
    return () => { alive = false }
  }, [loadConnections, connectionsEpoch])

  const link = async (service: ConnectionServiceDto) => {
    // In a browser the new tab has to be opened by the click itself, before the address is known, or it is blocked.
    const desktop = bridge()
    const tab = desktop ? null : window.open('about:blank', '_blank')
    const url = await store.startConnection(service.key)
    if (!url) { tab?.close(); return }
    setWaiting(service.key)
    if (desktop) void desktop.openExternal(url)
    else if (tab) { tab.opener = null; tab.location.href = url }
    else store.setError('Your browser blocked the new tab. Allow pop-ups for Maplecord and try again.')
  }
  const show = async (c: ConnectionDto, shown: boolean) => { const saved = await store.setConnectionShown(c.id, shown); if (saved) setMine(all => all.map(x => (x.id === c.id ? saved : x))) }
  const unlink = async (c: ConnectionDto) => { if (await store.removeConnection(c.id)) setMine(all => all.filter(x => x.id !== c.id)) }

  if (!services) return <><h4>Connections</h4><div className="muted">Loading…</div></>
  // What can be linked here, and anything linked earlier on a service this server no longer offers (it can still be unlinked).
  const rows = [...services, ...mine.filter(c => !services.some(s => s.key === c.service)).map(c => ({ key: c.service, name: c.serviceName, gone: true }))] as (ConnectionServiceDto & { gone?: boolean })[]
  return (
    <>
      <h4>Connections</h4>
      <div className="muted">Link an account you have on another service to show that its name is yours. Maplecord keeps that account's name and ID, and nothing else; unlinking removes both. It is never a way to sign in.</div>
      {rows.length === 0 && <div className="muted">This server has not set up any services to link.</div>}
      {rows.map(s => {
        const linked = mine.find(c => c.service === s.key)
        return (
          <div key={s.key} className="connectionrow">
            <b>{s.name}</b>
            {linked ? (
              <>
                {linked.url ? <a className="grow" href={linked.url} target="_blank" rel="noopener noreferrer">{linked.name}</a> : <span className="grow">{linked.name}</span>}
                <label className="choice" title="Whether people see this on your profile"><input type="checkbox" checked={linked.shown} onChange={e => void show(linked, e.target.checked)} /> <span>On my profile</span></label>
                {!s.gone && <button className="subtle" onClick={() => void link(s)} title="If the name there has changed, or to link a different account">Link again</button>}
                <button className="subtle" onClick={() => void unlink(linked)}>Unlink</button>
              </>
            ) : (
              <>
                <span className="grow muted">{waiting === s.key ? 'Finish in your browser, then come back here.' : 'Not linked'}</span>
                <button className="accent" onClick={() => void link(s)}>Link</button>
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
