import { useCallback, useEffect, useId, useState } from 'react'
import type { Api } from '../api'
import { ChannelType, type ApplicationDto, type ChannelDto, type CommandRuleDto, type CommandRulesDto, type MemberDto, type RoleDto, type WebhookDto } from '../types'
import { Dialog } from './Dialogs'

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
export function ServerBotsTab({ api, guildId, canManage, onRoles, onManage, fullP2P = false, hasP2PChannels = false }: {
  api: Api; guildId: string; canManage: boolean
  /** A server takes the bots it has channels for. A full P2P server has only P2P channels, so P2P bots only. */
  fullP2P?: boolean
  /** A server with P2P channels in it takes P2P bots; one that is not a full P2P server takes ordinary bots too. */
  hasP2PChannels?: boolean
  /** Opens the roles of one bot (by its member id), when the person may manage roles. */
  onRoles?: (botUserId: string) => void
  /** Opens who may use one bot's slash commands, and where. */
  onManage?: (bot: ApplicationDto) => void
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
  const addable = mine.filter(m => (m.direct ? fullP2P || hasP2PChannels : !fullP2P) && !(bots ?? []).some(b => b.id === m.id))

  return (
    <div className="integrations">
      <div className="muted">
        A bot joins the server as a member. What it may see and do is set with roles, like anyone else: it starts with
        what everyone has, and you can give it more or less. Bots are made under Settings, My bots; whoever made one
        can give you its ID. Manage sets who can use a bot's commands, and where.
      </div>
      <div className="muted">
        {fullP2P
          ? 'This is a full P2P server, so only P2P bots can be added to it. A P2P bot sees nothing until it is let into a channel (right-click the channel).'
          : hasP2PChannels
            ? 'This server has ordinary channels and P2P channels, so both kinds of bot can be added. An ordinary bot is only ever in the ordinary channels. A P2P bot is only ever in the P2P channels it is let into (right-click the channel).'
            : 'Only ordinary bots can be added to this server. A P2P bot is for a server that has P2P channels.'}
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
            {/* For an ordinary bot, its slash commands; for a P2P bot, the commands people type to it. */}
            {onManage && <button className="subtle" onClick={() => onManage(b)}>Manage</button>}
            {onRoles && <button className="subtle" onClick={() => onRoles(b.botUserId)}>Roles</button>}
            {canManage && <ConfirmButton label="Remove" sure="Remove it from this server?" onConfirm={() => void remove(b.id)} />}
          </div>
        </div>
      ))}
      {problem && <div className="muted bad">{problem}</div>}
    </div>
  )
}

const OPEN_RULE: CommandRuleDto = { everyone: true, roleIds: [], userIds: [], allChannels: true, channelIds: [] }

/** A rule as the server keeps it: nothing named where everyone or everywhere is chosen, and in one order, so two can be compared. */
function tidy(rule: CommandRuleDto | null): string {
  if (!rule) return ''
  return JSON.stringify([rule.everyone, rule.everyone ? [] : [...rule.roleIds].sort(), rule.everyone ? [] : [...rule.userIds].sort(), rule.allChannels, rule.allChannels ? [] : [...rule.channelIds].sort()])
}
/** What is missing from a rule before it can be saved, if anything. */
function lacking(rule: CommandRuleDto | null): string | null {
  if (!rule) return null
  if (!rule.everyone && rule.roleIds.length + rule.userIds.length === 0) return 'Choose at least one role or person, or let everyone use it.'
  if (!rule.allChannels && rule.channelIds.length === 0) return 'Choose at least one channel, or allow it in all of them.'
  return null
}

/** One rule being edited: everyone or only these roles and people, every channel or only these. */
function RuleEditor({ rule, onChange, roles, people, places }: {
  rule: CommandRuleDto; onChange: (next: CommandRuleDto) => void
  roles: RoleDto[]; people: MemberDto[]; places: ChannelDto[]
}) {
  const group = useId()
  const flip = (list: string[], id: string, on: boolean) => (on ? [...list.filter(x => x !== id), id] : list.filter(x => x !== id))
  const nameOf = (id: string) => { const m = people.find(p => p.userId === id); return m ? m.nickname || m.username : 'Someone' }
  const missing = lacking(rule)
  return (
    <div className="ruleedit">
      <div className="muted">Who can use it</div>
      <label className="choice"><input type="radio" name={group + 'who'} checked={rule.everyone} onChange={() => onChange({ ...rule, everyone: true })} /> Everyone</label>
      <label className="choice"><input type="radio" name={group + 'who'} checked={!rule.everyone} onChange={() => onChange({ ...rule, everyone: false })} /> Only these roles and people</label>
      {!rule.everyone && (
        <div className="picks">
          {roles.map(r => (
            <label key={r.id} className="choice">
              <input type="checkbox" checked={rule.roleIds.includes(r.id)} onChange={e => onChange({ ...rule, roleIds: flip(rule.roleIds, r.id, e.target.checked) })} />
              <span className="swatch" style={{ background: r.color ?? 'var(--muted)' }} /><span style={{ color: r.color ?? undefined }}>{r.name}</span>
            </label>
          ))}
          {roles.length === 0 && <div className="muted">This server has no roles yet.</div>}
          <select value="" aria-label="Add a person" onChange={e => { if (e.target.value) onChange({ ...rule, userIds: flip(rule.userIds, e.target.value, true) }) }}>
            <option value="">Add a person…</option>
            {people.filter(p => !rule.userIds.includes(p.userId)).map(p => <option key={p.userId} value={p.userId}>{p.nickname ? `${p.nickname} (@${p.username})` : p.username}</option>)}
          </select>
          {rule.userIds.length > 0 && (
            <div className="named">
              {rule.userIds.map(id => (
                <span key={id} className="person">{nameOf(id)}
                  <button className="subtle" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange({ ...rule, userIds: flip(rule.userIds, id, false) })}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="muted">Where</div>
      <label className="choice"><input type="radio" name={group + 'where'} checked={rule.allChannels} onChange={() => onChange({ ...rule, allChannels: true })} /> All channels</label>
      <label className="choice"><input type="radio" name={group + 'where'} checked={!rule.allChannels} onChange={() => onChange({ ...rule, allChannels: false })} /> Only these channels</label>
      {!rule.allChannels && (
        <div className="picks">
          {places.map(c => (
            <label key={c.id} className="choice">
              <input type="checkbox" checked={rule.channelIds.includes(c.id)} onChange={e => onChange({ ...rule, channelIds: flip(rule.channelIds, c.id, e.target.checked) })} />
              <span>{c.type === ChannelType.Voice ? '🔊 ' : '#'}{c.name}</span>
            </label>
          ))}
          {places.length === 0 && <div className="muted">This server has no channel a command can be typed in.</div>}
        </div>
      )}
      {missing && <div className="muted bad">{missing}</div>}
    </div>
  )
}

/**
 * Server settings, Bots, Manage: who may use one bot's slash commands in this server, and where. There is one
 * setting for the bot as a whole, and any command can be given its own instead.
 */
export function BotCommandsDialog({ api, guildId, bot, roles, members, channels, onClose }: {
  api: Api; guildId: string; bot: ApplicationDto
  /** The server's roles, without the one everyone has. */
  roles: RoleDto[]; members: MemberDto[]; channels: ChannelDto[]
  onClose: () => void
}) {
  const people = members.filter(m => !m.isBot)
  // Where a command can be used at all. An ordinary bot's slash commands go through the server, so not in a P2P
  // channel; what is typed to a P2P bot goes straight to it, so only in one.
  const typed = !!bot.direct
  const places = channels.filter(c => c.type !== ChannelType.Category && !!c.directSince === typed)
  const [saved, setSaved] = useState<CommandRulesDto | null>(null)
  const [whole, setWhole] = useState<CommandRuleDto>(OPEN_RULE)
  const [own, setOwn] = useState<Record<string, CommandRuleDto | null>>({})
  const [done, setDone] = useState(false)
  const { problem, run } = useRun()

  /** A role since deleted, someone who has left, a channel that is gone: left out, so what is saved names only what is here. */
  const here = useCallback((rule: CommandRuleDto): CommandRuleDto => ({
    ...rule,
    roleIds: rule.roleIds.filter(id => roles.some(r => r.id === id)),
    userIds: rule.userIds.filter(id => members.some(m => m.userId === id)),
    channelIds: rule.channelIds.filter(id => channels.some(c => c.id === id)),
  }), [roles, members, channels])
  const take = useCallback((r: CommandRulesDto) => {
    const clean: CommandRulesDto = { bot: here(r.bot), commands: r.commands.map(c => ({ ...c, rule: c.rule ? here(c.rule) : null })) }
    setSaved(clean); setWhole(clean.bot); setOwn(Object.fromEntries(clean.commands.map(c => [c.name, c.rule])))
  }, [here])
  // Asked once, when the dialog opens: what is being edited must not be replaced because a member list changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(async () => take(await api.commandRules(guildId, bot.id))) }, [api, guildId, bot.id, run])

  const changedWhole = !!saved && tidy(whole) !== tidy(saved.bot)
  const changedOwn = (saved?.commands ?? []).filter(c => tidy(own[c.name] ?? null) !== tidy(c.rule))
  const missing = lacking(whole) ?? (saved?.commands ?? []).map(c => lacking(own[c.name] ?? null)).find(x => x) ?? null
  const save = () => run(async () => {
    if (!saved) return
    setDone(false)
    let latest: CommandRulesDto | null = null
    try {
      if (changedWhole) latest = await api.setCommandRule(guildId, bot.id, null, whole)
      for (const c of changedOwn) latest = await api.setCommandRule(guildId, bot.id, c.name, own[c.name] ?? null)
      if (latest) { take(latest); setDone(true) }
    } catch (e) {
      // Whatever was saved before the one that failed stays saved; what is on screen is kept to be put right.
      if (latest) setSaved(latest)
      throw e
    }
  })
  const edit = (change: () => void) => { setDone(false); change() }

  return (
    <Dialog title={`Manage ${bot.name}`} onClose={onClose} wide scrolls>
      <div className="integrations">
        <div className="muted">
          {typed
            ? 'Who can use the commands people type to this bot in this server, and where. What is typed to a P2P bot goes straight to it and never through the server, so the bot is told what you set here and applies it itself. Anyone who can manage the server can use all of them everywhere.'
            : 'Who can use this bot\'s slash commands in this server, and where. People are only offered the commands they can use. Anyone who can manage the server can use all of them everywhere.'}
        </div>
        {saved === null && !problem && <div className="muted">Loading…</div>}
        {saved && (
          <>
            <div className="entry">
              <b>All of its commands</b>
              <RuleEditor rule={whole} onChange={next => edit(() => setWhole(next))} roles={roles} people={people} places={places} />
            </div>
            {saved.commands.length === 0 && <div className="muted">{typed ? 'This bot has not listed any commands yet. What is set above applies to any it lists.' : 'This bot has no slash commands here yet. What is set above applies to any it adds.'}</div>}
            {saved.commands.map(c => {
              const mine = own[c.name] ?? null
              return (
                <div className="entry" key={c.name}>
                  <div className="row">
                    <div className="grow"><b>{typed ? '' : '/'}{c.name}</b>{c.description && <div className="muted">{c.description}</div>}</div>
                    <select value={mine ? 'own' : 'bot'} aria-label={`Settings for ${c.name}`}
                      onChange={e => edit(() => setOwn(all => ({ ...all, [c.name]: e.target.value === 'own' ? { ...whole } : null })))}>
                      <option value="bot">Same as all of its commands</option>
                      <option value="own">Its own settings</option>
                    </select>
                  </div>
                  {mine && <RuleEditor rule={mine} onChange={next => edit(() => setOwn(all => ({ ...all, [c.name]: next })))} roles={roles} people={people} places={places} />}
                </div>
              )
            })}
          </>
        )}
        {problem && <div className="muted bad">{problem}</div>}
      </div>
      <div className="buttons">
        {done && <span className="muted" style={{ alignSelf: 'center' }}>Saved</span>}
        <button onClick={onClose}>Close</button>
        <button className="accent" disabled={!saved || !!missing || (!changedWhole && changedOwn.length === 0)} onClick={() => void save()}>Save</button>
      </div>
    </Dialog>
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
          ? 'A P2P bot connects straight to people\'s apps in the P2P channels it is let into, one channel at a time, in one server only, which has to be one with P2P channels. It has no slash commands, cannot read or post in ordinary channels, and each person is asked before their app connects to it. This cannot be changed after the bot is made.'
          : 'An ordinary bot talks to the server: slash commands, messages in ordinary channels. It is never in a P2P channel, and cannot be added to a full P2P server. This cannot be changed after the bot is made.'}
      </div>
      <label className="row"><input type="checkbox" checked={inVoice} onChange={e => setInVoice(e.target.checked)} /> <span>{direct ? 'Let it join P2P voice channels' : 'Let it join voice channels'}</span></label>
      <div className="muted">
        {direct
          ? 'Only the P2P voice channels it is let into, never an ordinary one. It is heard there, and shares video only if whoever runs this Maplecord lets bots. Each person is asked before their app connects to it. You can change this later.'
          : 'Ordinary voice channels only, never a P2P one, and not in a server that has P2P channels. It listens there. It is heard only where whoever runs this Maplecord lets bots be heard, and then for a short time at once; the same goes for sharing video. You can change this later.'}
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
