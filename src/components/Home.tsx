import { useEffect, useState } from 'react'
import type { Store } from '../store'
import type { UserDto } from '../types'
import { shownName } from '../profile'
import { Avatar, UserName } from './Profile'

/** The chat column at Home when no DM is open: find people, answer requests, and message friends. */
export default function Friends({ store }: { store: Store }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserDto[]>([])
  const serverUrl = store.settings.serverUrl
  const { friends, outgoing } = store.friends
  // Requests from people you ignore are kept out of sight (and uncounted) rather than declined, so un-ignoring brings them back.
  const incoming = store.friends.incoming.filter(f => !store.settings.users?.[f.user.id]?.ignored)
  const known = new Set([...friends, ...incoming, ...outgoing].map(f => f.user.id))

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    const id = window.setTimeout(() => store.searchUsers(q).then(r => { if (!cancelled) setResults(r) }).catch(() => setResults([])), 250)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [query, store])

  return (
    <div className="chat">
      <div className="header"><span>👥</span><span>Friends</span><span className="muted" style={{ marginLeft: 8 }}>{friends.filter(f => f.online).length} online</span></div>
      <div className="friends">
        <div>
          <h4>Add a friend</h4>
          <input placeholder="Search by username…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
          {results.length > 0 && (
            <div className="results" style={{ marginTop: 6 }}>
              {results.map(u => (
                <div key={u.id} className="f">
                  <Avatar who={u} name={shownName(u)} serverUrl={serverUrl} size={28} />
                  <UserName who={null} label={shownName(u)} />{u.displayName && <span className="muted">@{u.username}</span>}
                  <div className="actions">
                    {known.has(u.id) ? <span className="muted">already listed</span> : <button className="accent" onClick={() => { void store.addFriend(u.id); setQuery('') }}>Add</button>}
                    <button className="subtle" onClick={() => store.openDm(u.id)} title="Message (needs a shared server or friendship)">💬</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {incoming.length > 0 && (
          <div>
            <h4>Requests — {incoming.length}</h4>
            {incoming.map(f => (
              <div key={f.user.id} className="f">
                <Avatar who={f.user} name={shownName(f.user)} serverUrl={serverUrl} size={28} />
                <UserName who={store.appearanceOf(f.user.id)} label={shownName(f.user)} /><span className="muted">wants to be friends</span>
                <div className="actions">
                  <button className="accent" onClick={() => store.addFriend(f.user.id)}>Accept</button>
                  <button className="subtle" onClick={() => store.removeFriend(f.user.id)}>Ignore</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div>
            <h4>Sent</h4>
            {outgoing.map(f => (
              <div key={f.user.id} className="f">
                <Avatar who={f.user} name={shownName(f.user)} serverUrl={serverUrl} size={28} />
                <UserName who={store.appearanceOf(f.user.id)} label={shownName(f.user)} /><span className="muted">pending</span>
                <div className="actions"><button className="subtle" onClick={() => store.removeFriend(f.user.id)}>Cancel</button></div>
              </div>
            ))}
          </div>
        )}

        <div>
          <h4>All friends — {friends.length}</h4>
          {friends.length === 0 && <div className="muted" style={{ marginTop: 6 }}>No friends yet. Search for someone above, or right-click a member in a server.</div>}
          {[...friends].sort((a, b) => Number(b.online) - Number(a.online) || a.user.username.localeCompare(b.user.username)).map(f => (
            <div key={f.user.id} className="f" style={{ opacity: f.online ? 1 : 0.55 }}>
              <Avatar who={f.user} name={shownName(f.user)} serverUrl={serverUrl} size={28} />
              <span className={'presence' + (f.online ? ' online' : '')} />
              <UserName who={store.appearanceOf(f.user.id)} label={shownName(f.user)} />
              <div className="actions">
                <button onClick={() => store.openDm(f.user.id)}>💬 Message</button>
                <button className="subtle" onClick={() => store.removeFriend(f.user.id)} title="Remove friend">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
