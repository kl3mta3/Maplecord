import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../api'
import { ChannelType, type ApplicationDto, type ChannelDto, type WebhookDto } from '../types'

/** Something shown once and never again (a webhook's address, a bot's token), with a button to copy it. */
function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })
  return (
    <div className="row idrow">
      <span className="muted">{label}</span><code className="grow">{value}</code>
      <button className="subtle" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

/** A button that asks once more before doing something that cannot be undone. */
function ConfirmButton({ label, sure, onConfirm }: { label: string; sure: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const timer = window.setTimeout(() => setAsking(false), 4000)
    return () => window.clearTimeout(timer)
  }, [asking])
  return asking
    ? <button className="danger" onClick={() => { setAsking(false); onConfirm() }}>{sure}</button>
    : <button className="subtle" onClick={() => setAsking(true)}>{label}</button>
}

/** Runs something against the server and keeps what went wrong, if anything, to show under the list. */
function useRun() {
  const [problem, setProblem] = useState('')
  const run = useCallback(async (work: () => Promise<void>) => {
    setProblem('')
    try { await work() } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
  }, [])
  return { problem, run }
}

/**
 * Server settings: webhooks. A webhook is an address that anything able to make a web request can post to, and what
 * it posts shows up as a message in one channel.
 */
export function WebhooksTab({ api, guildId, channels }: { api: Api; guildId: string; channels: ChannelDto[] }) {
  const text = channels.filter(c => c.type === ChannelType.Text)
  const [hooks, setHooks] = useState<WebhookDto[] | null>(null)
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState(text[0]?.id ?? '')
  /** The address of the one just made or renewed. The server does not keep it, so this is the only time it is seen. */
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null)
  const { problem, run } = useRun()

  useEffect(() => { void run(async () => setHooks(await api.webhooks(guildId))) }, [api, guildId, run])

  const create = () => run(async () => {
    const made = await api.createWebhook(channelId, name.trim())
    setHooks(list => [...(list ?? []), made])
    setFresh(made.url ? { id: made.id, url: made.url } : null)
    setName('')
  })
  const patch = (id: string, change: { name?: string; channelId?: string }) => run(async () => {
    const saved = await api.updateWebhook(id, change)
    setHooks(list => (list ?? []).map(h => (h.id === id ? saved : h)))
  })
  const renew = (id: string) => run(async () => {
    const renewed = await api.regenerateWebhook(id)
    setFresh(renewed.url ? { id, url: renewed.url } : null)
  })
  const remove = (id: string) => run(async () => {
    await api.deleteWebhook(id)
    setHooks(list => (list ?? []).filter(h => h.id !== id))
    setFresh(f => (f?.id === id ? null : f))
  })

  return (
    <div className="integrations">
      <div className="muted">
        A webhook is an address other tools can post to. What they post shows up as a message in the channel you pick.
        Anyone who has the address can post, so treat it like a password.
      </div>
      <div className="row">
        <input className="grow" placeholder="Name, shown as the author" value={name} maxLength={80} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim() && channelId) void create() }} />
        <select value={channelId} onChange={e => setChannelId(e.target.value)}>{text.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
        <button className="accent" disabled={!name.trim() || !channelId} onClick={() => void create()}>Create webhook</button>
      </div>

      {hooks === null && !problem && <div className="muted">Loading…</div>}
      {hooks?.length === 0 && <div className="muted">This server has no webhooks yet.</div>}
      {hooks?.map(h => (
        <div className="entry" key={h.id}>
          <div className="row">
            <input className="grow" defaultValue={h.name} maxLength={80} aria-label="Webhook name"
              onBlur={e => { const next = e.target.value.trim(); if (next && next !== h.name) void patch(h.id, { name: next }); else e.target.value = h.name }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <select value={h.channelId} aria-label="Channel" onChange={e => void patch(h.id, { channelId: e.target.value })}>
              {text.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
            <ConfirmButton label="New address" sure="Replace the address?" onConfirm={() => void renew(h.id)} />
            <ConfirmButton label="Delete" sure="Delete it?" onConfirm={() => void remove(h.id)} />
          </div>
          {fresh?.id === h.id && (
            <>
              <Secret label="Address" value={fresh.url} />
              <div className="muted">Copy it now: it is not shown again. Post JSON such as <code>{'{ "content": "hello" }'}</code> to it.</div>
            </>
          )}
        </div>
      ))}
      {problem && <div className="muted bad">{problem}</div>}
    </div>
  )
}

/** Server settings: the bots that have been added to this server. Adding or removing one needs Manage Server. */
export function ServerBotsTab({ api, guildId, canManage, onRoles }: {
  api: Api; guildId: string; canManage: boolean
  /** Opens the roles of one bot (by its member id), when the person may manage roles. */
  onRoles?: (botUserId: string) => void
}) {
  const [bots, setBots] = useState<ApplicationDto[] | null>(null)
  const [mine, setMine] = useState<ApplicationDto[]>([])
  const [id, setId] = useState('')
  const { problem, run } = useRun()

  useEffect(() => {
    void run(async () => setBots(await api.guildApplications(guildId)))
    api.applications().then(setMine).catch(() => { /* only used to offer your own bots */ })
  }, [api, guildId, run])

  const add = (appId: string) => run(async () => {
    const added = await api.addGuildApplication(guildId, appId.trim())
    setBots(list => [...(list ?? []).filter(b => b.id !== added.id), added])
    setId('')
  })
  const remove = (appId: string) => run(async () => {
    await api.removeGuildApplication(guildId, appId)
    setBots(list => (list ?? []).filter(b => b.id !== appId))
  })
  const addable = mine.filter(m => !(bots ?? []).some(b => b.id === m.id))

  return (
    <div className="integrations">
      <div className="muted">
        A bot joins the server as a member. What it may see and do is set with roles, like anyone else: it starts with
        what everyone has, and you can give it more or less. Bots are made under Settings, My bots; whoever made one
        can give you its ID.
      </div>
      {canManage && (
        <div className="row">
          <input className="grow" placeholder="Bot ID" value={id} onChange={e => setId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && id.trim()) void add(id) }} />
          <button className="accent" disabled={!id.trim()} onClick={() => void add(id)}>Add bot</button>
          {addable.length > 0 && (
            <select value="" onChange={e => { if (e.target.value) void add(e.target.value) }} aria-label="Add one of your bots">
              <option value="">Add one of yours…</option>
              {addable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      )}

      {bots === null && !problem && <div className="muted">Loading…</div>}
      {bots?.length === 0 && <div className="muted">No bots have been added to this server.</div>}
      {bots?.map(b => (
        <div className="entry" key={b.id}>
          <div className="row">
            <div className="grow">
              <b>{b.name}</b> <span className="muted">@{b.botUsername}</span>
              {b.description && <div className="muted">{b.description}</div>}
            </div>
            {onRoles && <button className="subtle" onClick={() => onRoles(b.botUserId)}>Roles</button>}
            {canManage && <ConfirmButton label="Remove" sure="Remove it from this server?" onConfirm={() => void remove(b.id)} />}
          </div>
        </div>
      ))}
      {problem && <div className="muted bad">{problem}</div>}
    </div>
  )
}

/** Settings: the bots this person has made. This is where a bot is created and where its token comes from. */
export function MyBots({ api }: { api: Api }) {
  const [bots, setBots] = useState<ApplicationDto[] | null>(null)
  const [name, setName] = useState('')
  /** Shown once, straight after making a bot or renewing its token. */
  const [fresh, setFresh] = useState<{ id: string; token: string; secret: string | null } | null>(null)
  const { problem, run } = useRun()

  useEffect(() => { void run(async () => setBots(await api.applications())) }, [api, run])

  const keep = (saved: ApplicationDto) => {
    setBots(list => ((list ?? []).some(b => b.id === saved.id) ? (list ?? []).map(b => (b.id === saved.id ? { ...saved, token: null, interactionsSecret: null } : b)) : [...(list ?? []), saved]))
    if (saved.token) setFresh({ id: saved.id, token: saved.token, secret: saved.interactionsSecret ?? null })
  }
  const [direct, setDirect] = useState(false)
  const [inVoice, setInVoice] = useState(false)
  const create = () => run(async () => { keep(await api.createApplication(name.trim(), direct, inVoice)); setName(''); setDirect(false); setInVoice(false) })
  const patch = (id: string, change: { name?: string; description?: string; interactionsUrl?: string; voice?: boolean }) => run(async () => keep(await api.updateApplication(id, change)))
  const renew = (id: string) => run(async () => keep(await api.regenerateApplication(id)))
  const remove = (id: string) => run(async () => {
    await api.deleteApplication(id)
    setBots(list => (list ?? []).filter(b => b.id !== id))
    setFresh(f => (f?.id === id ? null : f))
  })

  return (
    <div className="integrations">
      <h4>My bots</h4>
      <div className="muted">
        A bot is a program with an account of its own. Make one here, give it the token to sign in with, then add it to
        a server from that server's settings (Bots) using its ID.
      </div>
      <div className="row">
        <input className="grow" placeholder="Name for a new bot" value={name} maxLength={80} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim().length >= 2) void create() }} />
        <button className="accent" disabled={name.trim().length < 2} onClick={() => void create()}>Create bot</button>
      </div>
      <label className="row"><input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} /> <span>Make it a P2P bot</span></label>
      <div className="muted">
        {direct
          ? 'A P2P bot connects straight to people\'s apps in the P2P channels it is let into, one channel at a time, in private servers only. It has no commands, cannot read or post in ordinary channels, and each person is asked before their app connects to it. This cannot be changed after the bot is made.'
          : 'An ordinary bot talks to the server: slash commands, messages in ordinary channels. It is never in a P2P channel. This cannot be changed after the bot is made.'}
      </div>
      <label className="row"><input type="checkbox" checked={inVoice} onChange={e => setInVoice(e.target.checked)} /> <span>{direct ? 'Let it join P2P voice channels' : 'Let it join voice channels'}</span></label>
      <div className="muted">
        {direct
          ? 'Only the P2P voice channels it is let into, never an ordinary one. It can be heard there and can never share video. Each person is asked before their app connects to it. You can change this later.'
          : 'Ordinary voice channels only, never a P2P one. It can be heard there and can never share video. You can change this later.'}
      </div>

      {bots === null && !problem && <div className="muted">Loading…</div>}
      {bots?.length === 0 && <div className="muted">You have not made any bots.</div>}
      {bots?.map(b => (
        <div className="entry" key={b.id}>
          <div className="row">
            <input className="grow" defaultValue={b.name} maxLength={80} aria-label="Bot name"
              onBlur={e => { const next = e.target.value.trim(); if (next.length >= 2 && next !== b.name) void patch(b.id, { name: next }); else e.target.value = b.name }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <span className="muted">@{b.botUsername}</span>
            {b.direct && <span className="p2ptag">P2P bot</span>}
            <ConfirmButton label="New token" sure="Replace the token?" onConfirm={() => void renew(b.id)} />
            <ConfirmButton label="Delete" sure="Delete this bot?" onConfirm={() => void remove(b.id)} />
          </div>
          <Secret label="Bot ID" value={b.id} />
          {(b.banned || b.suspended) && (
            <div className="muted bad">
              {b.banned
                ? 'Whoever runs this Maplecord has banned this bot. It was taken out of its servers and cannot connect or be added to one.'
                : 'Whoever runs this Maplecord has suspended this bot. It cannot connect until they restore it.'}
            </div>
          )}
          <label className="row">
            <input type="checkbox" checked={!!b.voice} onChange={e => void patch(b.id, { voice: e.target.checked })} />
            <span>{b.direct ? 'May join the P2P voice channels it is let into' : 'May join voice channels'}</span>
          </label>
          {!b.direct && (
            <div className="row">
              <input className="grow" defaultValue={b.interactionsUrl ?? ''} placeholder="Web address to send its slash commands to (optional)" aria-label="Slash command address"
                onBlur={e => { const next = e.target.value.trim(); if (next !== (b.interactionsUrl ?? '')) void patch(b.id, { interactionsUrl: next }) }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            </div>
          )}
          {fresh?.id === b.id && (
            <>
              <Secret label="Token" value={fresh.token} />
              {fresh.secret && <Secret label="Signing secret" value={fresh.secret} />}
              <div className="muted">
                Copy these now: they are not shown again. The bot signs in by sending <code>Authorization: Bot &lt;token&gt;</code>.
                Slash commands sent to its web address are signed with the signing secret.
              </div>
            </>
          )}
        </div>
      ))}
      {problem && <div className="muted bad">{problem}</div>}
    </div>
  )
}
