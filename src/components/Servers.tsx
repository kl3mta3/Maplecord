import { useEffect, useState } from 'react'
import { ChevronRight, Compass, Link, Plus, Search } from 'lucide-react'
import type { Api } from '../api'
import type { DiscoverGuildDto } from '../types'
import { Dialog } from './Dialogs'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

/** "Add a server": the one way in, which then asks how. */
export function AddServerDialog({ onCreate, onJoin, onDiscover, onClose }: { onCreate: () => void; onJoin: () => void; onDiscover: () => void; onClose: () => void }) {
  const choice = (icon: React.ReactNode, title: string, hint: string, onClick: () => void) => (
    <button className="bigchoice" onClick={onClick}>
      <span className="ico">{icon}</span>
      <span className="grow"><b>{title}</b><span className="muted">{hint}</span></span>
      <ChevronRight size={18} />
    </button>
  )
  return (
    <Dialog title="Add a server" onClose={onClose}>
      <div className="muted">A server is where you and your group talk, call and roll.</div>
      {choice(<Plus size={20} />, 'Create my own', 'Start a new server and invite people to it', onCreate)}
      {choice(<Link size={20} />, 'Join a server', 'You have an invite link or code', onJoin)}
      {choice(<Compass size={20} />, 'Find a public server', 'Browse servers anyone can join', onDiscover)}
      <div className="buttons"><button onClick={onClose}>Cancel</button></div>
    </Dialog>
  )
}

/**
 * Making a server: its name, who can join it, and for a private one how its voice and video travel. A public server
 * is always the standard kind, because P2P is for people who know each other.
 */
export function CreateServerDialog({ onCreate, onClose }: { onCreate: (name: string, isPublic: boolean, kind: 'standard' | 'hybrid' | 'p2p') => void; onClose: () => void }) {
  const [name, setName] = useState('')
  // Public unless they say otherwise.
  const [open, setOpen] = useState(true)
  const [kind, setKind] = useState<'standard' | 'hybrid' | 'p2p'>('standard')
  const submit = () => { if (name.trim()) { onCreate(name.trim(), open, open ? 'standard' : kind); onClose() } }
  return (
    <Dialog title="Create a server" onClose={onClose}>
      <div className="listing">
        <div className="muted">Server name</div>
        <input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} aria-label="Server name" />
        <div className="muted">Who can join</div>
        <label className="choice"><input type="radio" name="newlisting" checked={open} onChange={() => setOpen(true)} /><span><b>Public</b> <span className="muted">Listed for everyone to find and join *</span></span></label>
        <label className="choice"><input type="radio" name="newlisting" checked={!open} onChange={() => setOpen(false)} /><span><b>Private</b> <span className="muted">Only people with an invite</span></span></label>
        {!open && (
          <>
            <div className="muted">Kind of server</div>
            <label className="choice"><input type="radio" name="newkind" checked={kind === 'standard'} onChange={() => setKind('standard')} /><span><b>Standard</b> <span className="muted">Voice and video go through the relay. Nobody sees anyone's IP address.</span></span></label>
            <label className="choice"><input type="radio" name="newkind" checked={kind === 'hybrid'} onChange={() => setKind('hybrid')} /><span><b>Hybrid</b> <span className="muted">Text is kept by the server. Voice and video are P2P: people in the voice channel connect straight to each other and can find each other's IP address.</span></span></label>
            <label className="choice"><input type="radio" name="newkind" checked={kind === 'p2p'} onChange={() => setKind('p2p')} /><span><b>Full P2P</b> <span className="muted">Text, voice and video are all P2P. What is typed is kept only on people's own devices: the server keeps none of it, so someone who was not connected at the time does not get it.</span></span></label>
          </>
        )}
        <div className="muted">You can add and change channels afterwards.</div>
        <div className="muted">* A public server cannot have P2P channels.</div>
      </div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" disabled={!name.trim()} onClick={submit}>Create</button></div>
    </Dialog>
  )
}

/** Joining with an invite: a link or the bare code, with what they look like. */
export function JoinServerDialog({ example, onJoin, onBack, onClose }: {
  /** What an invite link starts with on this server, to show a true example. */
  example: string | null
  onJoin: (invite: string) => Promise<void>; onBack: () => void; onClose: () => void
}) {
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const start = example ?? 'https://…/invite/'
  const go = async () => {
    if (!invite.trim() || busy) return
    setBusy(true)
    try { await onJoin(invite.trim()); onClose() } finally { setBusy(false) }
  }
  return (
    <Dialog title="Join a server" onClose={onClose}>
      <div className="muted">Enter the invite link or code to join an existing server.</div>
      <input autoFocus placeholder="Invite link or code" value={invite} onChange={e => setInvite(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void go() }} aria-label="Invite link or code" />
      <div className="muted">Invites look like</div>
      <div className="row examples"><code>KFLRL7XQ</code><code>{start}KFLRL7XQ</code></div>
      <div className="buttons">
        <button className="subtle" onClick={onBack}>Back</button>
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="accent" disabled={!invite.trim() || busy} onClick={() => void go()}>Join server</button>
      </div>
    </Dialog>
  )
}

/** Public servers: search by name, narrow by topic, join without an invite. */
export function DiscoverDialog({ api, onJoin, onOpen, onBack, onClose }: {
  api: Api
  onJoin: (guildId: string) => Promise<void>
  /** Go to a server you are already in. */
  onOpen: (guildId: string) => void
  onBack?: () => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [topics, setTopics] = useState<string[]>([])
  const [found, setFound] = useState<DiscoverGuildDto[] | null>(null)
  const [problem, setProblem] = useState('')

  useEffect(() => { api.discoverTopics().then(setTopics).catch(() => setTopics([])) }, [api])
  // Asked again a moment after the typing stops, not on every key.
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      api.discover(query.trim(), topic ?? '').then(list => { if (alive) { setFound(list); setProblem('') } }).catch(e => { if (alive) setProblem(e instanceof Error ? e.message : String(e)) })
    }, 250)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [api, query, topic])

  const join = async (g: DiscoverGuildDto) => {
    setProblem('')
    try { await onJoin(g.id); onClose() } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <Dialog title="Find a public server" onClose={onClose} wide>
      <div className="discover">
        <div className="row searchrow">
          <Search size={16} />
          <input autoFocus className="grow" placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search public servers" />
        </div>
        {topics.length > 0 && (
          <div className="topics">
            <button className={'chip' + (topic === null ? ' on' : '')} onClick={() => setTopic(null)}>All</button>
            {topics.map(t => <button key={t} className={'chip' + (topic === t ? ' on' : '')} onClick={() => setTopic(topic === t ? null : t)}>{t}</button>)}
          </div>
        )}
        <div className="results">
          {found === null && !problem && <div className="muted">Looking…</div>}
          {found?.length === 0 && <div className="muted">{query || topic ? 'No public server matches that.' : 'There are no public servers yet. Whoever runs a server can make it public in its settings.'}</div>}
          {found?.map(g => (
            <div className="entry" key={g.id}>
              <div className="guildicon">{g.iconUrl ? <img src={g.iconUrl} alt="" /> : <span>{initials(g.name)}</span>}</div>
              <div className="grow">
                <b>{g.name}</b> <span className="muted">{g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}</span>
                {g.description && <div className="muted">{g.description}</div>}
                {g.topics.length > 0 && <div className="topics small">{g.topics.map(t => <span key={t} className="chip">{t}</span>)}</div>}
              </div>
              {g.joined
                ? <button className="subtle" onClick={() => { onOpen(g.id); onClose() }}>Open</button>
                : <button className="accent" onClick={() => void join(g)}>Join</button>}
            </div>
          ))}
        </div>
        {problem && <div className="muted bad">{problem}</div>}
      </div>
      <div className="buttons">
        {onBack && <button className="subtle" onClick={onBack}>Back</button>}
        <span className="grow" />
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}

/** Server settings: whether the server is public, and what the list of public servers says about it. */
export function ListingSettings({ isPublic, description, topics, onSave }: {
  isPublic: boolean; description: string; topics: string[]
  onSave: (patch: { isPublic: boolean; description: string; topics: string[] }) => Promise<void>
}) {
  const [open, setOpen] = useState(isPublic)
  const [about, setAbout] = useState(description)
  const [tags, setTags] = useState(topics.join(', '))
  const [saved, setSaved] = useState(false)
  const list = tags.split(',').map(t => t.trim()).filter(Boolean)
  const changed = open !== isPublic || about.trim() !== description || list.join(',').toLowerCase() !== topics.join(',')
  const save = async () => { await onSave({ isPublic: open, description: about.trim(), topics: list }); setSaved(true); window.setTimeout(() => setSaved(false), 1500) }
  return (
    <div className="listing">
      <div className="muted">Who can join</div>
      <label className="choice"><input type="radio" name="listing" checked={!open} onChange={() => setOpen(false)} /><span><b>Private</b> <span className="muted">Only people with an invite</span></span></label>
      <label className="choice"><input type="radio" name="listing" checked={open} onChange={() => setOpen(true)} /><span><b>Public</b> <span className="muted">Listed for everyone to find and join. A public server cannot have P2P channels.</span></span></label>
      <div className="muted">Description (shown in the list of public servers)</div>
      <textarea rows={2} maxLength={300} value={about} onChange={e => setAbout(e.target.value)} aria-label="Server description" />
      <div className="muted">Topics, separated by commas (up to 5), for example: maplestory, raids, casual</div>
      <input value={tags} onChange={e => setTags(e.target.value)} aria-label="Server topics" />
      <div className="row"><button className="accent" disabled={!changed} onClick={() => void save()}>{saved ? 'Saved' : 'Save'}</button></div>
    </div>
  )
}
