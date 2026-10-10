import { TagPill } from './Tags'
import { ProfileConnections } from './Connections'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
// The "light" player draws to SVG only and has no expression support, so an animation file cannot run script.
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light'
import { NAME_FONTS, animationColors, assetUrl, decorationUrl, initials, nameStyle, shownName, withAnimationColors, type Appearance } from '../profile'
import type { Store } from '../store'
import { effectFileProblem } from '../effectCheck'
import { Permission, hasPermission, type DecorationDto, type RoleDto, type UserProfileDto } from '../types'
import { Dialog } from './Dialogs'

// ---- Lottie ---------------------------------------------------------------------

const animations = new Map<string, Promise<unknown>>()
const loadAnimation = (src: string) => {
  let pending = animations.get(src)
  if (!pending) {
    pending = fetch(src).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() as Promise<unknown> })
    pending.catch(() => animations.delete(src)) // try again next time
    animations.set(src, pending)
  }
  return pending
}
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Plays a Lottie animation from the server. Paused, it shows its first frame. */
export function LottieView({ src, playing, className, fit = 'meet' }: { src: string; playing: boolean; className?: string; fit?: 'meet' | 'slice' }) {
  const host = useRef<HTMLDivElement>(null)
  const anim = useRef<AnimationItem | null>(null)
  const wanted = useRef(playing)
  wanted.current = playing && !reduceMotion()

  useEffect(() => {
    let cancelled = false
    loadAnimation(src).then(data => {
      if (cancelled || !host.current) return
      // The player rewrites the data it is given, so every instance gets its own copy.
      anim.current = lottie.loadAnimation({
        container: host.current, renderer: 'svg', loop: true, autoplay: false, animationData: structuredClone(data),
        rendererSettings: { preserveAspectRatio: fit === 'slice' ? 'xMidYMid slice' : 'xMidYMid meet' },
      })
      if (wanted.current) anim.current.play(); else anim.current.goToAndStop(0, true)
    }).catch(() => { /* a decoration that will not load is simply not shown */ })
    return () => { cancelled = true; anim.current?.destroy(); anim.current = null }
  }, [src, fit])

  useEffect(() => {
    const a = anim.current
    if (!a) return
    if (playing && !reduceMotion()) a.play(); else a.goToAndStop(0, true)
  }, [playing])

  return <div ref={host} className={className} aria-hidden="true" />
}

// ---- Avatar and name ----------------------------------------------------------------

/**
 * Someone's picture (or their initials), with their decoration around it. In lists the decoration only moves while
 * the pointer is on it; on a profile it always does.
 */
export function Avatar({ who, name, serverUrl, size = 32, animate = 'hover', speaking, className, title, onClick, onContextMenu }: {
  /** Anything that carries a picture path and a decoration id: a user, a member, a profile. */
  who: { avatarUrl?: string | null; decoration?: string | null } | null | undefined
  /** Used for initials when there is no picture. */
  name: string
  serverUrl: string
  size?: number
  animate?: 'hover' | 'always' | 'never'
  speaking?: boolean
  className?: string
  title?: string
  onClick?: (e: MouseEvent) => void
  onContextMenu?: (e: MouseEvent) => void
}) {
  const [hover, setHover] = useState(false)
  const [broken, setBroken] = useState(false)
  const picture = assetUrl(serverUrl, who?.avatarUrl)
  const decoration = decorationUrl(serverUrl, 'avatar', who?.decoration)
  useEffect(() => { setBroken(false) }, [picture])
  return (
    <span className={'av' + (speaking ? ' speaking' : '') + (onClick ? ' clickable' : '') + (className ? ' ' + className : '')} title={title}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }}
      onClick={onClick} onContextMenu={onContextMenu} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {picture && !broken ? <img src={picture} alt="" draggable={false} onError={() => setBroken(true)} /> : <span className="letters">{initials(name)}</span>}
      {decoration && animate !== 'never' && <LottieView className="deco" src={decoration} playing={animate === 'always' || hover} />}
    </span>
  )
}

/** A name in the person's own font and color. `label` overrides the text (a server nickname); `roleColor` wins over their own color. */
export function UserName({ who, label, roleColor, className, style, onClick, onContextMenu }: {
  who: Appearance | null | undefined; label: string; roleColor?: string | null; className?: string; style?: CSSProperties
  onClick?: (e: MouseEvent) => void; onContextMenu?: (e: MouseEvent) => void
}) {
  return (
    <>
      <span className={'uname' + (onClick ? ' clickable' : '') + (className ? ' ' + className : '')} style={{ ...nameStyle(who, roleColor), ...style }}
        onClick={onClick} onContextMenu={onContextMenu}>{label}</span>
      {who?.tag && <TagPill tag={who.tag} />}
    </>
  )
}

// ---- Profile card ---------------------------------------------------------------------

/** The card itself: used in the popout and, with a draft, as the live preview in the editor. */
export function ProfileCardBody({ profile, serverUrl, roles, nickname, serverName, children }: {
  profile: UserProfileDto; serverUrl: string; roles?: RoleDto[]; nickname?: string | null; serverName?: string; children?: ReactNode
}) {
  const banner = assetUrl(serverUrl, profile.bannerUrl)
  const effect = decorationUrl(serverUrl, 'effect', profile.effect)
  const since = new Date(profile.createdAt)
  const who: Appearance = { userId: profile.id, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl,
    nameFont: profile.nameFont, nameColor: profile.nameColor, nameColor2: profile.nameColor2, decoration: profile.decoration, tag: profile.tag ?? null }
  return (
    <div className="profilecard">
      <div className="banner" style={banner ? { backgroundImage: `url("${banner}")` } : { background: profile.accentColor ?? undefined }} />
      <div className="top">
        <Avatar who={who} name={shownName(profile)} serverUrl={serverUrl} size={84} animate="always" className="big" />
      </div>
      <div className="body">
        <div className="names">
          <UserName who={who} label={shownName(profile)} className="display" />
          <div className="muted handle">@{profile.username}{profile.isBot ? ' · bot' : ''}{profile.pronouns ? ` · ${profile.pronouns}` : ''}</div>
        </div>
        {nickname && <div className="muted handle">Goes by <b>{nickname}</b>{serverName ? ` on ${serverName}` : ''}</div>}
        {profile.bio && (<><h5>About me</h5><div className="bio">{profile.bio}</div></>)}
        {profile.connections && profile.connections.length > 0 && (<><h5>Connections</h5><ProfileConnections connections={profile.connections} /></>)}
        {roles && roles.length > 0 && (
          <><h5>Roles</h5><div className="rolechips">{roles.map(r => <span key={r.id} className="chip"><span className="swatch" style={{ background: r.color ?? 'var(--muted)' }} />{r.name}</span>)}</div></>
        )}
        <h5>Member since</h5>
        <div className="muted">{isNaN(since.getTime()) ? '' : since.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        {children}
      </div>
      {effect && <LottieView className="effect" src={effect} playing fit="slice" />}
    </div>
  )
}

/** What we can show before the full profile arrives (and all we show if it cannot be fetched). */
const sketch = (a: Appearance): UserProfileDto => ({
  id: a.userId, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, bannerUrl: null, accentColor: null, bio: null, pronouns: null,
  nameFont: a.nameFont, nameColor: a.nameColor, nameColor2: a.nameColor2, decoration: a.decoration, effect: null, createdAt: '', isBot: false,
})

/** A profile card at the pointer. */
export function ProfilePopout({ store, userId, fallbackName, x, y, roles, nickname, serverName, onClose, onEdit }: {
  store: Store; userId: string; fallbackName: string; x: number; y: number; roles?: RoleDto[]
  /** Their nickname on the server being looked at, if any. */
  nickname?: string | null; serverName?: string
  onClose: () => void; onEdit: () => void
}) {
  const known = store.appearanceOf(userId)
  const [profile, setProfile] = useState<UserProfileDto>(() => sketch(known ?? { userId, username: fallbackName, displayName: null, avatarUrl: null, nameFont: null, nameColor: null, nameColor2: null, decoration: null }))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const me = store.me()
  const isMe = me?.id === userId

  useEffect(() => {
    let cancelled = false
    store.loadProfile(userId).then(p => { if (!cancelled && p) setProfile(p) })
    return () => { cancelled = true }
  }, [store, userId])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) })
  }, [x, y, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isFriend = store.friends.friends.some(f => f.user.id === userId)
  const pending = store.friends.outgoing.some(f => f.user.id === userId)
  return (
    <>
      <div className="menubackdrop" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div ref={ref} className="profilepop" style={pos}>
        <ProfileCardBody profile={profile} serverUrl={store.settings.serverUrl} roles={roles} nickname={nickname} serverName={serverName}>
          <div className="actions">
            {isMe && <button className="accent" onClick={() => { onClose(); onEdit() }}>Edit profile</button>}
            {!isMe && !profile.isBot && <button className="accent" onClick={() => { void store.openDm(userId); onClose() }}>💬 Message</button>}
            {!isMe && !profile.isBot && !isFriend && <button disabled={pending} onClick={() => store.addFriend(userId)}>{pending ? 'Request sent' : '➕ Add friend'}</button>}
          </div>
        </ProfileCardBody>
      </div>
    </>
  )
}

// ---- Profile editor ---------------------------------------------------------------------

const SWATCHES = ['#9000ff', '#00ddff', '#ff008c', '#2cfc00', '#f19511', '#ff3b3b', '#ffd700', '#1abc9c', '#3498db', '#e8e8f0']

function ColorRow({ label, value, onChange, hint }: { label: string; value: string | null; onChange: (v: string | null) => void; hint?: string }) {
  return (
    <div>
      <div className="muted">{label}{hint ? <span> — {hint}</span> : null}</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
        <span className={'swatch pick none' + (value === null ? ' sel' : '')} title="None" onClick={() => onChange(null)} />
        {SWATCHES.map(c => <span key={c} className={'swatch pick' + (value?.toLowerCase() === c ? ' sel' : '')} style={{ background: c }} onClick={() => onChange(c)} />)}
        <input type="color" value={value ?? '#9000ff'} onChange={e => onChange(e.target.value)} title="Any color" style={{ width: 36, height: 24, padding: 0 }} />
      </div>
    </div>
  )
}

/** One color of an animation, to swap for another. The choice is passed on once the picker has settled, not for every shade dragged through. */
function SwapColor({ value, label, onPick }: { value: string; label: string; onPick: (hex: string) => void }) {
  const [shown, setShown] = useState(value)
  const timer = useRef(0)
  useEffect(() => { setShown(value) }, [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <input type="color" title="Change this color" aria-label={label} value={shown}
      onChange={e => { const v = e.target.value; setShown(v); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onPick(v), 300) }} />
  )
}

export function ProfileEditor({ store, onClose }: { store: Store; onClose: () => void }) {
  const me = store.me()
  const serverUrl = store.settings.serverUrl
  const [saved, setSaved] = useState<UserProfileDto | null>(null)
  const [draft, setDraft] = useState<UserProfileDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  // "Fill and crop": a profile effect of any shape is taken, and fills the card with what overhangs cut off.
  const [cropEffect, setCropEffect] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const decorationInput = useRef<HTMLInputElement>(null)
  const effectInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!me) return
    let cancelled = false
    store.loadProfile(me.id).then(p => { if (!cancelled && p) { setSaved(p); setDraft(p) } else if (!cancelled) setNote('Could not load your profile.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id])

  if (!me || !draft || !saved) return <Dialog title="Edit profile" onClose={onClose}><div className="muted">{note || 'Loading…'}</div></Dialog>

  // Always build on the latest draft, so two changes close together (or an upload finishing mid-edit) cannot drop one.
  const set = (patch: Partial<UserProfileDto>) => setDraft(d => (d ? { ...d, ...patch } : d))
  const dirty = (['displayName', 'bio', 'pronouns', 'accentColor', 'nameFont', 'nameColor', 'nameColor2', 'decoration', 'effect'] as const).some(k => (draft[k] ?? '') !== (saved[k] ?? ''))
  const shown = draft.displayName?.trim() || draft.username

  const save = async () => {
    setBusy(true); setNote('')
    try {
      // Every field is sent; an empty string clears it.
      const p = await store.saveProfile({
        displayName: draft.displayName ?? '', bio: draft.bio ?? '', pronouns: draft.pronouns ?? '', accentColor: draft.accentColor ?? '',
        nameFont: draft.nameFont ?? '', nameColor: draft.nameColor ?? '', nameColor2: draft.nameColor2 ?? '', decoration: draft.decoration ?? '', effect: draft.effect ?? '',
      })
      setSaved(p); setDraft(p); setNote('Saved.')
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  // Pictures are stored the moment they are chosen; the rest waits for Save.
  const picture = async (kind: 'avatar' | 'banner', file: File | null) => {
    setBusy(true); setNote('')
    try {
      const p = await store.setProfilePicture(kind, file)
      const url = kind === 'avatar' ? { avatarUrl: p.avatarUrl } : { bannerUrl: p.bannerUrl }
      setSaved(v => (v ? { ...v, ...url } : v)); set(url)
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  // An animation of your own (around your picture, or over your profile card) is stored, and worn, the moment it is
  // chosen, like a picture. Taking it away only changes what you wear if you were wearing it.
  const animation = async (kind: 'avatar' | 'effect', file: File | null) => {
    setBusy(true); setNote('')
    try {
      // An effect plays in front of the profile, so one that would hide it is turned away here, before it is sent.
      if (kind === 'effect' && file) { const hides = await effectFileProblem(file); if (hides) { setNote(hides); return } }
      const was = kind === 'avatar' ? draft.ownDecoration : draft.ownEffect
      const p = await store.setProfileAnimation(kind, file, kind === 'effect' && cropEffect)
      const own = { ownDecoration: p.ownDecoration ?? null, ownEffect: p.ownEffect ?? null }
      setSaved(v => (v ? { ...v, ...own, decoration: p.decoration, effect: p.effect } : v))
      if (kind === 'avatar') setDraft(d => (d ? { ...d, ...own, decoration: file ? p.decoration : d.decoration === was ? null : d.decoration } : d))
      else setDraft(d => (d ? { ...d, ...own, effect: file ? p.effect : d.effect === was ? null : d.effect } : d))
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  // A tag is worn, like a picture, the moment it is chosen.
  const wear = async (guildId: string | null) => {
    setBusy(true); setNote('')
    try {
      await store.wearTag(guildId)
      const from = guildId ? store.guilds.find(g => g.guild.id === guildId)?.guild : null
      const tag = from?.tagText ? { guildId: from.id, text: from.tagText, symbol: from.tagSymbol ?? null } : null
      setSaved(v => (v ? { ...v, tag } : v)); setDraft(d => (d ? { ...d, tag } : d))
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const avatarDecorations = store.decorations.filter(d => d.kind === 'avatar')
  const effects = store.decorations.filter(d => d.kind === 'effect')
  // One of the server's is chosen whatever colors it is worn in.
  const chosenDecoration = animationColors(draft.decoration)?.base ?? null
  const choice = (d: DecorationDto | null) => (
    <button key={d?.id ?? 'none'} className={'decochoice' + (chosenDecoration === (d?.id ?? null) ? ' sel' : '')} title={d?.name ?? 'None'} aria-pressed={chosenDecoration === (d?.id ?? null)} onClick={() => set({ decoration: d?.id ?? null })}>
      <Avatar who={{ avatarUrl: draft.avatarUrl, decoration: d?.id ?? null }} name={shown} serverUrl={serverUrl} size={44} animate="hover" />
      <span>{d?.name ?? 'None'}</span>
    </button>
  )
  /** The colors of the server's animation that is chosen, each of which can be swapped for another. Nothing for one of your own. */
  const colorsOf = (kind: 'avatar' | 'effect') => {
    const chosen = animationColors(kind === 'avatar' ? draft.decoration : draft.effect)
    const from = chosen ? store.decorations.find(d => d.kind === kind && d.id === chosen.base) : undefined
    if (!chosen || !from?.colors?.length) return null
    const own = from.colors.map((_, i) => chosen.colors[i] ?? null)
    const put = (colors: (string | null)[]) => { const id = withAnimationColors(from.id, colors); set(kind === 'avatar' ? { decoration: id } : { effect: id }) }
    return (
      <div className="animcolors">
        <span className="muted">Its colors</span>
        {from.colors.map((c, i) => (
          <SwapColor key={from.id + i} value={'#' + (own[i] ?? c)} label={`Color ${i + 1} of ${from.name}`}
            onPick={hex => put(own.map((o, j) => (j === i ? hex.slice(1).toLowerCase() : o)))} />
        ))}
        {own.some(Boolean) && <button className="subtle" onClick={() => put([])}>Back to its own colors</button>}
      </div>
    )
  }
  const ownRow = (kind: 'avatar' | 'effect') => {
    const mine = kind === 'avatar' ? draft.ownDecoration : draft.ownEffect
    const input = kind === 'avatar' ? decorationInput : effectInput
    if (draft.ownAnimationsOff) return <div className="muted">Uploading your own animations has been turned off for this account.</div>
    return (
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => input.current?.click()}>{mine ? 'Replace your own' : 'Upload your own'}</button>
        {mine && <button className="subtle" disabled={busy} onClick={() => animation(kind, null)}>Remove yours</button>}
        {kind === 'effect' && (
          <label className="row" title="Use an animation of any shape: it fills the card, and what does not fit is cut off.">
            <input type="checkbox" checked={cropEffect} onChange={e => setCropEffect(e.target.checked)} />
            <span>Fill and crop</span>
          </label>
        )}
        <span className="muted">A Lottie file (.lottie or .json), {kind === 'avatar' ? 'square' : cropEffect ? 'any shape (it fills the card, cropped)' : '300 × 420 or that shape'}, up to 50 KB, drawn shapes only.{kind === 'effect' ? ' No background, it can hide at most 35% of the card at once, and nothing in it can stay over the picture and the name.' : ''}</span>
        <input ref={input} type="file" accept=".lottie,.json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void animation(kind, f); e.target.value = '' }} />
      </div>
    )
  }

  return (
    <Dialog title="Edit profile" onClose={onClose} wide>
      <div className="profileeditor">
        <div className="form">
          <div className="muted">Display name <span>— what people see. Your username <b>@{draft.username}</b> never changes.</span></div>
          <input value={draft.displayName ?? ''} maxLength={32} placeholder={draft.username} onChange={e => set({ displayName: e.target.value })} />

          <div className="muted">Pronouns</div>
          <input value={draft.pronouns ?? ''} maxLength={40} placeholder="optional" onChange={e => set({ pronouns: e.target.value })} />

          <div className="muted">About me <span>— {(draft.bio ?? '').length}/190</span></div>
          <textarea rows={3} maxLength={190} value={draft.bio ?? ''} onChange={e => set({ bio: e.target.value })} />

          <div className="muted">Picture <span>— PNG, JPEG, WebP or an animated GIF, up to 2 MB</span></div>
          <div className="row">
            <button disabled={busy} onClick={() => avatarInput.current?.click()}>Upload picture</button>
            {draft.avatarUrl && <button className="subtle" disabled={busy} onClick={() => picture('avatar', null)}>Remove</button>}
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void picture('avatar', f); e.target.value = '' }} />
          </div>

          <ColorRow label="Banner color" value={draft.accentColor} onChange={v => set({ accentColor: v })} />
          <div className="muted">Banner picture <span>— PNG, JPEG, WebP or an animated GIF, up to 4 MB</span></div>
          <div className="row">
            <button disabled={busy} onClick={() => bannerInput.current?.click()}>Upload banner picture</button>
            {draft.bannerUrl && <button className="subtle" disabled={busy} onClick={() => picture('banner', null)}>Remove</button>}
            <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void picture('banner', f); e.target.value = '' }} />
          </div>

          <div className="muted">Name font</div>
          <div className="fontgrid">
            <button className={'fontchoice' + (!draft.nameFont ? ' sel' : '')} onClick={() => set({ nameFont: null })}><span>{shown}</span><small>Default</small></button>
            {NAME_FONTS.map(f => (
              <button key={f.id} className={'fontchoice' + (draft.nameFont === f.id ? ' sel' : '')} onClick={() => set({ nameFont: f.id })}>
                <span style={nameStyle({ nameFont: f.id, nameColor: null, nameColor2: null })}>{shown}</span><small>{f.label}</small>
              </button>
            ))}
          </div>

          <ColorRow label="Name color" value={draft.nameColor} onChange={v => set({ nameColor: v, ...(v === null ? { nameColor2: null } : {}) })} hint="a server's role color takes its place there" />
          {draft.nameColor && <ColorRow label="Second color" value={draft.nameColor2} onChange={v => set({ nameColor2: v })} hint="makes a gradient" />}

          <div className="muted">Avatar decoration <span>— animated; hover to preview</span></div>
          <div className="decogrid">
            {choice(null)}{avatarDecorations.map(choice)}
            {draft.ownDecoration && (
              <button className={'decochoice' + (draft.decoration === draft.ownDecoration ? ' sel' : '')} title="The one you uploaded" aria-pressed={draft.decoration === draft.ownDecoration} onClick={() => set({ decoration: draft.ownDecoration ?? null })}>
                <Avatar who={{ avatarUrl: draft.avatarUrl, decoration: draft.ownDecoration }} name={shown} serverUrl={serverUrl} size={44} animate="hover" />
                <span>Yours</span>
              </button>
            )}
          </div>
          {colorsOf('avatar')}
          {ownRow('avatar')}

          <div className="muted">Server tag <span>— shown beside your name everywhere, and tells people you are in that server</span></div>
          <select aria-label="Server tag" value={draft.tag?.guildId ?? ''} disabled={busy} onChange={e => void wear(e.target.value || null)}>
            <option value="">None</option>
            {store.guilds.filter(g => g.guild.tagText && !g.guild.noTag && (hasPermission(g.myPermissions, Permission.WearTag) || g.guild.id === draft.tag?.guildId)).map(g => <option key={g.guild.id} value={g.guild.id}>{(g.guild.tagSymbol ? g.guild.tagSymbol + ' ' : '') + g.guild.tagText} — {g.guild.name}</option>)}
          </select>

          <div className="muted">Profile effect <span>— plays over your profile card</span></div>
          <select aria-label="Profile effect" value={animationColors(draft.effect)?.base ?? ''} onChange={e => set({ effect: e.target.value || null })}>
            <option value="">None</option>
            {effects.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            {draft.ownEffect && <option value={draft.ownEffect}>Yours</option>}
          </select>
          {colorsOf('effect')}
          {ownRow('effect')}
        </div>

        <div className="preview">
          <div className="muted">Preview</div>
          <ProfileCardBody profile={{ ...draft, displayName: draft.displayName?.trim() || null }} serverUrl={serverUrl} />
          <div className="chatpreview">
            <Avatar who={draft} name={shown} serverUrl={serverUrl} size={32} animate="always" />
            <div><UserName who={{ ...draft, userId: draft.id }} label={shown} className="name" /> <span className="muted">in chat</span><div>gg, nice roll!</div></div>
          </div>
        </div>
      </div>
      <div className="buttons" style={{ alignItems: 'center' }}>
        <span className="muted grow">{note}</span>
        <button onClick={onClose}>Close</button>
        <button className="accent" disabled={busy || !dirty} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</button>
      </div>
    </Dialog>
  )
}
