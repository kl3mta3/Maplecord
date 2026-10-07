import { useEffect, useState, type ReactNode } from 'react'
import { ChannelType, RollKind, RollRange, type ChannelDto, type RollItemDto } from '../types'
import type { CatalogHit } from '../store'

/** What P2P means, in a sentence or two, wherever it is mentioned. Shows on hover, on focus, and on click (for touch). */
export function P2PInfo() {
  const [open, setOpen] = useState(false)
  return (
    <span className={'infotip' + (open ? ' open' : '')}>
      <button type="button" className="infodot" aria-label="What is P2P?" aria-expanded={open} onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }} onBlur={() => setOpen(false)}>i</button>
      <span className="infobubble" role="tooltip">
        <b>P2P</b> means peer-to-peer: your app connects straight to the other person's app instead of going through Maplecord's relay.
        To connect that way, each side has to be told the other's IP address. Maplecord never shows it, but anyone you connect to
        can find it with ordinary tools. An IP address shows roughly where you are and can be used to knock your connection offline.
      </span>
    </span>
  )
}

/**
 * Stands between a person and a P2P voice channel. "warn" is the once-per-channel warning; "blocked" is what they
 * see when their account does not allow P2P at all. Neither joins anything by itself.
 */
export function DirectChannelDialog({ kind, channelName, onJoin, onSettings, onClose }: {
  kind: 'warn' | 'blocked'; channelName: string; onJoin: () => void; onSettings: () => void; onClose: () => void
}) {
  return (
    <Dialog title={kind === 'warn' ? `Join ${channelName}? It is a P2P channel` : `${channelName} is a P2P channel`} onClose={onClose}>
      <div>
        In a P2P channel your app connects straight to everyone else's, not through the relay. <b>Everyone in it can find your IP address</b>,
        and so can anyone who joins while you are there. <P2PInfo />
      </div>
      {kind === 'warn' ? (
        <>
          <div className="muted">Only join if you trust this server's owner and the people in this channel. You will not be asked again for this channel unless it is changed.</div>
          <div className="buttons">
            <button className="subtle" style={{ marginRight: 'auto' }} onClick={() => { onClose(); onSettings() }}>Settings</button>
            <button onClick={onClose}>Cancel</button>
            <button className="accent" onClick={onJoin}>Join anyway</button>
          </div>
        </>
      ) : (
        <>
          <div className="muted">Your account does not allow P2P connections, so you cannot join it. You can change that in Audio &amp; privacy settings; you will be asked to sign in again first.</div>
          <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onClose(); onSettings() }}>Open settings</button></div>
        </>
      )}
    </Dialog>
  )
}

/** Before a P2P call is placed: what it means, said once more, so one is never placed in passing. */
export function P2PCallDialog({ name, onCall, onClose }: { name: string; onCall: () => void; onClose: () => void }) {
  return (
    <Dialog title={`Call ${name} over P2P?`} onClose={onClose}>
      <div>
        Your apps will connect straight to each other, not through the relay. <b>{name} will be able to find your IP address</b>, and you theirs. <P2PInfo />
      </div>
      <div className="muted">It only rings if {name} allows P2P connections too.</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onClose(); onCall() }}>Call over P2P</button></div>
    </Dialog>
  )
}

/**
 * A friend is calling. A P2P call says so before it can be answered, and cannot be answered at all by an account
 * that does not allow P2P.
 */
export function IncomingCallDialog({ name, direct, allowed, onAnswer, onDecline, onSettings }: {
  name: string; direct: boolean; allowed: boolean; onAnswer: () => void; onDecline: () => void; onSettings: () => void
}) {
  return (
    // Only its buttons answer or decline: a stray click beside it, or Escape pressed for something else, does neither.
    <Dialog title={`${name} is calling`} onClose={() => { /* stays until answered or declined */ }}>
      {direct ? (
        <div>
          <span className="p2ptag">P2P</span> This is a P2P call: your apps would connect straight to each other. <b>{name} will be able to find your IP address</b>, and you theirs. <P2PInfo />
        </div>
      ) : null}
      {!allowed && <div className="muted">Your account does not allow P2P connections, so you cannot answer it. You can change that in Audio &amp; privacy settings, or ask {name} to place an ordinary call.</div>}
      <div className="buttons">
        {!allowed && <button className="subtle" style={{ marginRight: 'auto' }} onClick={onSettings}>Settings</button>}
        <button className="danger" onClick={onDecline}>Decline</button>
        {allowed && <button className="accent" onClick={onAnswer}>{direct ? 'Answer P2P call' : 'Answer'}</button>}
      </div>
    </Dialog>
  )
}

/**
 * Allowing P2P takes a fresh sign-in, so that it is certainly the account's owner deciding and not just whoever has
 * the app open. The server enforces that; this is only how the person gets there.
 */
export function AllowDirectDialog({ providers, username, onSignIn, onClose }: {
  providers: string[] | null; username: string; onSignIn: (provider: string, devUsername?: string) => Promise<void>; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const go = async (provider: string) => {
    setBusy(true); setProblem(provider === 'dev' ? '' : 'Waiting for you to sign in…')
    try { await onSignIn(provider, username); onClose() }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const names: Record<string, string> = { google: 'Sign in with Google', github: 'Sign in with GitHub', dev: `Development sign-in as ${username}` }
  return (
    <Dialog title="Allow P2P connections?" onClose={onClose}>
      <div>
        With this allowed you can join P2P voice channels and connect straight to friends who allow it too.
        <b> People you connect to that way can find your IP address.</b> <P2PInfo />
      </div>
      <div className="muted">To make sure it is really you deciding, sign in again:</div>
      {providers === null && <div className="muted">Checking how you can sign in…</div>}
      {providers?.length === 0 && <div className="muted">This server has no way to sign in again.</div>}
      {providers?.map(p => <button key={p} className={p === 'dev' ? '' : 'provider'} disabled={busy} onClick={() => void go(p)}>{names[p] ?? p}</button>)}
      {problem && <div className="muted">{problem}</div>}
      <div className="buttons"><button onClick={onClose} disabled={busy}>Cancel</button></div>
    </Dialog>
  )
}

export function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'dialog' + (wide ? ' wide' : '')}><h3>{title}</h3>{children}</div>
    </div>
  )
}

export function PromptDialog({ title, label, onSubmit, onClose, initial = '' }: { title: string; label: string; onSubmit: (value: string) => void; onClose: () => void; initial?: string }) {
  const [value, setValue] = useState(initial)
  const submit = () => { if (value.trim()) { onSubmit(value.trim()); onClose() } }
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="muted">{label}</div>
      <input autoFocus value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>OK</button></div>
    </Dialog>
  )
}

/** A nickname is a name on one server only. Saving it empty removes it, so the display name shows again. */
export function NicknameDialog({ who, serverName, current, fallback, onSubmit, onClose }: {
  who: string; serverName: string; current: string | null; fallback: string; onSubmit: (nickname: string | null) => void; onClose: () => void
}) {
  const [value, setValue] = useState(current ?? '')
  const submit = () => { onSubmit(value.trim() || null); onClose() }
  return (
    <Dialog title={`Nickname on ${serverName}`} onClose={onClose}>
      <div className="muted">What {who} is called on this server only. Leave it empty to use the display name ({fallback}).</div>
      <input autoFocus value={value} maxLength={32} placeholder={fallback} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <div className="buttons">
        {current && <button className="subtle" style={{ marginRight: 'auto' }} onClick={() => { onSubmit(null); onClose() }}>Remove nickname</button>}
        <button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>Save</button>
      </div>
    </Dialog>
  )
}

export function ConfirmDialog({ title, message, onConfirm, onClose }: { title: string; message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div>{message}</div>
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => { onConfirm(); onClose() }}>Yes</button></div>
    </Dialog>
  )
}

/**
 * Deleting a group of channels takes the channels in it too, so it is asked twice: first what will go, then whether
 * they are sure. The second time the buttons change places, so two quick clicks on one spot cancel rather than delete.
 */
export function DeleteGroupDialog({ name, channels, onConfirm, onClose }: { name: string; channels: string[]; onConfirm: () => void; onClose: () => void }) {
  const [sure, setSure] = useState(false)
  const n = channels.length
  if (n === 0) return <ConfirmDialog title={`Delete the group ${name}?`} message="There are no channels in it. The group is removed for everyone, and this cannot be undone." onConfirm={onConfirm} onClose={onClose} />
  const them = n === 1 ? 'it' : 'them'
  return (
    <Dialog title={sure ? 'Are you sure?' : `Delete the group ${name}?`} onClose={onClose}>
      {sure
        ? <div>The group <b>{name}</b>, {n === 1 ? 'the channel in it' : `all ${n} channels in it`} and everything written in {them} will be gone for everyone. <b>This cannot be undone.</b></div>
        : <div>This also deletes {n === 1 ? 'the channel' : `all ${n} channels`} in it, with everything written in {them}: <b>{channels.join(', ')}</b>.</div>}
      <div className="buttons">
        {sure
          ? <><button className="danger" onClick={() => { onConfirm(); onClose() }}>Delete everything</button><button onClick={onClose}>Cancel</button></>
          : <><button onClick={onClose}>Cancel</button><button className="accent" onClick={() => setSure(true)}>Delete group and channels</button></>}
      </div>
    </Dialog>
  )
}

export function CreateChannelDialog({ categories, onSubmit, onClose, initialType = ChannelType.Text, canDirect = false }: {
  categories: ChannelDto[]; onSubmit: (name: string, type: number, parentId: string | null, direct: boolean) => void; onClose: () => void; initialType?: number
  /** This person may create P2P voice channels. */
  canDirect?: boolean
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<number>(initialType)
  const [parent, setParent] = useState<string>(categories[0]?.id ?? '')
  const [direct, setDirect] = useState(false)
  const submit = () => { if (name.trim()) { onSubmit(name.trim(), type, type === ChannelType.Category ? null : parent || null, type === ChannelType.Voice && direct); onClose() } }
  return (
    <Dialog title={type === ChannelType.Category ? 'Create category' : 'Create channel'} onClose={onClose}>
      <div className="row">
        <label className="row"><input type="radio" checked={type === ChannelType.Text} onChange={() => setType(ChannelType.Text)} /> # Text</label>
        <label className="row"><input type="radio" checked={type === ChannelType.Voice} onChange={() => setType(ChannelType.Voice)} /> 🔊 Voice</label>
        <label className="row"><input type="radio" checked={type === ChannelType.Category} onChange={() => setType(ChannelType.Category)} /> Category</label>
      </div>
      <div className="muted">Name</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      {type !== ChannelType.Category && (
        <>
          <div className="muted">Category</div>
          <select value={parent} onChange={e => setParent(e.target.value)}>
            <option value="">(none)</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
      {type === ChannelType.Voice && canDirect && (
        <>
          <div className="row">
            <label className="row"><input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} /> <span>P2P channel</span></label>
            <P2PInfo />
          </div>
          {direct && <div className="muted">People in it connect straight to each other and can find each other's IP address. Only people who allow P2P can join, and each is warned first.</div>}
        </>
      )}
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit}>Create</button></div>
    </Dialog>
  )
}

export function StartRollDialog({ kind: initialKind, onSubmit, onClose, searchItems }: {
  kind: RollKind; onSubmit: (kind: RollKind, item: RollItemDto | null, min: number, max: number) => void; onClose: () => void
  /** Looks names up in the installed game plugins; omitted when there are none. */
  searchItems?: (query: string) => CatalogHit[]
}) {
  const [kind, setKind] = useState<RollKind>(initialKind)
  const [item, setItem] = useState('')
  // Set when the name was picked from a plugin catalog, so other clients with that plugin show its icon too.
  const [picked, setPicked] = useState<CatalogHit | null>(null)
  const hits = searchItems && !picked ? searchItems(item) : []
  const [qty, setQty] = useState('1')
  const [min, setMin] = useState('1')
  const [max, setMax] = useState('100')
  const range = { min: parseInt(min, 10), max: parseInt(max, 10) }
  const rangeOk = RollRange.isValid(range.min, range.max)
  const submit = () => {
    if (!rangeOk) return
    const q = Math.max(1, parseInt(qty, 10) || 1)
    const named = picked
      ? { pluginId: picked.pluginId, itemId: picked.item.id, name: picked.item.name, iconUrl: null, quantity: q }
      : item.trim() ? { pluginId: null, itemId: null, name: item.trim(), iconUrl: null, quantity: q } : null
    onSubmit(kind, named, range.min, range.max)
    onClose()
  }
  return (
    <Dialog title="Start a roll" onClose={onClose}>
      <div className="row">
        <label className="row"><input type="radio" checked={kind === RollKind.Standard} onChange={() => setKind(RollKind.Standard)} /> Roll (highest wins)</label>
        <label className="row"><input type="radio" checked={kind === RollKind.NeedGreed} onChange={() => setKind(RollKind.NeedGreed)} /> Need / Greed</label>
      </div>
      <div className="muted">Item (optional)</div>
      <div className="row">
        {picked?.iconUrl && <img className="itemicon" src={picked.iconUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
        <input className="grow" autoFocus placeholder={searchItems ? 'Type a name to search your game plugins' : 'e.g. Zakum Helmet'} value={item}
          onChange={e => { setItem(e.target.value); setPicked(null) }} onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {picked && <div className="muted">From {picked.gameName}{picked.item.rarity ? ` · ${picked.item.rarity}` : ''}</div>}
      {hits.length > 0 && (
        <div className="list">
          {hits.map(h => (
            <div key={h.pluginId + '/' + h.item.id} className="row" onClick={() => { setPicked(h); setItem(h.item.name) }}>
              {h.iconUrl ? <img className="itemicon" src={h.iconUrl} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="itemicon" />}
              <span className={'grow rarity-' + (h.item.rarity ?? 'none').toLowerCase()}>{h.item.name}</span>
              <span className="muted">{h.gameName}</span>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <span className="muted">Qty</span><input style={{ width: 60 }} value={qty} onChange={e => setQty(e.target.value)} />
        <span className="muted" style={{ marginLeft: 12 }}>Range</span>
        <input style={{ width: 80 }} value={min} onChange={e => setMin(e.target.value)} title="Minimum" />
        <span className="muted">–</span>
        <input style={{ width: 80 }} value={max} onChange={e => setMax(e.target.value)} title="Maximum" />
      </div>
      {!rangeOk && <div className="muted" style={{ color: 'var(--red)' }}>Range must be whole numbers with min &lt; max (0 to 1,000,000).</div>}
      <div className="buttons"><button onClick={onClose}>Cancel</button><button className="accent" onClick={submit} disabled={!rangeOk}>Start</button></div>
    </Dialog>
  )
}
