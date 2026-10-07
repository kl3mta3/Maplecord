import { useEffect, useRef, useState } from 'react'
import type { Store } from '../store'
import { bridge, type ShareSource } from '../platform'
import { Dialog } from './Dialogs'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { canShareSound, defaultQuality, describeQuality, qualityChoices, type StreamQuality } from '../stream'
import { elementVolumeIgnored, gainContext, wakeGainContext } from '../volume'
import { openPopout, type Popout } from '../popout'

/**
 * Choosing what to share. The desktop app lists this computer's app windows and screens itself, like Discord;
 * a browser can only offer its own picker, so there the choice is "a screen or window" or the camera.
 */
export function SharePicker({ store, onClose }: { store: Store; onClose: () => void }) {
  const desktop = bridge()
  const [sources, setSources] = useState<ShareSource[] | null>(null)
  const [tab, setTab] = useState<'window' | 'screen'>('window')
  const [hint, setHint] = useState<'motion' | 'detail'>('motion')
  // What this channel allows: an ordinary one keeps to the server's ordinary limits, a P2P one has its own.
  const direct = !!store.voice?.directSince
  const choices = qualityChoices(store.streamRules, direct)
  const [quality, setQuality] = useState<StreamQuality>(() => defaultQuality(store.streamRules, direct))
  const picked = choices.find(q => q.height === quality.height && q.fps === quality.fps) ?? defaultQuality(store.streamRules, direct)
  const soundPossible = canShareSound()
  const sound = soundPossible && !!store.settings.shareSound
  const rules = store.streamRules

  // Thumbnails are a moment in time; refresh them while the picker is open so a window opened just now shows up.
  useEffect(() => {
    if (!desktop) return
    let alive = true
    const load = () => desktop.shareSources().then(list => { if (alive) setSources(list) }).catch(() => { if (alive) setSources([]) })
    void load()
    const timer = setInterval(load, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [desktop])

  const pick = (choice: Parameters<Store['startShare']>[0]) => { onClose(); void store.startShare(choice, hint, sound, picked) }
  const shown = (sources ?? []).filter(s => s.kind === tab)

  return (
    <Dialog title="Share with the voice channel" onClose={onClose} wide>
      {rules && (
        <div className="muted">
          {rules.streamServer && !direct
            ? <>Nothing is sent until someone chooses to watch{rules.maxViewersStreamServer ? `; up to ${rules.maxViewersStreamServer} people can watch at once` : ', and anyone in the channel can'}. Your computer sends one copy however many are
                watching: {picked.height}p at {picked.fps} uses up to {(picked.kbps / 1000).toFixed(1)} Mbps of your upload.</>
            : <>Nothing is sent until someone chooses to watch
                {rules.maxViewersDirect ? `; up to ${rules.maxViewersDirect} people can watch at once` : ''}. Each viewer gets a copy of their own
                from your computer, so {picked.height}p at {picked.fps} uses up to {(picked.kbps / 1000).toFixed(1)} Mbps of your upload per viewer.</>}
        </div>
      )}
      {desktop ? (
        <>
          <div className="row tabs">
            <button className={tab === 'window' ? 'accent' : 'subtle'} onClick={() => setTab('window')}>Applications</button>
            <button className={tab === 'screen' ? 'accent' : 'subtle'} onClick={() => setTab('screen')}>Screens</button>
            <span className="grow" />
          </div>
          <div className="sharegrid">
            {sources === null && <div className="muted">Looking for windows…</div>}
            {sources !== null && shown.length === 0 && <div className="muted">{tab === 'window' ? 'No app windows found. Minimised windows cannot be shared; restore the window first.' : 'No screens found.'}</div>}
            {shown.map(s => (
              <button key={s.id} className="sharetile" title={s.name} onClick={() => pick({ type: 'display', sourceId: s.id, kind: s.kind })}>
                {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div className="nothumb" />}
                <span className="row">{s.icon && <img className="appicon" src={s.icon} alt="" />}<span className="grow">{s.name}</span></span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="row" style={{ gap: 12 }}>
          <button className="accent" onClick={() => pick({ type: 'display', sourceId: null, kind: null })}>🖥 A screen or window…</button>
        </div>
      )}
      <label className="row" style={{ gap: 8 }}>
        <span className="muted">Quality</span>
        <select value={`${picked.height}x${picked.fps}`} disabled={choices.length < 2}
          onChange={e => { const [h, f] = e.target.value.split('x').map(Number); setQuality(choices.find(q => q.height === h && q.fps === f) ?? picked) }}>
          {choices.map(q => <option key={`${q.height}x${q.fps}`} value={`${q.height}x${q.fps}`}>{q.height}p at {q.fps} frames a second</option>)}
        </select>
        {direct && <span className="muted">P2P channel: higher qualities are allowed here</span>}
      </label>
      <label className="row" style={{ gap: 8 }}>
        <span className="muted">When the connection is slow, keep</span>
        <select value={hint} onChange={e => setHint(e.target.value as 'motion' | 'detail')}>
          <option value="motion">motion smooth (games, video)</option>
          <option value="detail">text sharp (documents, code)</option>
        </select>
      </label>
      {soundPossible ? (
        <label className="row" style={{ gap: 8 }} title="Everything this computer plays, apart from Maplecord itself, so the call is not sent back to the people in it.">
          <input type="checkbox" checked={sound} onChange={e => store.updateSettings({ shareSound: e.target.checked })} />
          <span>Share this computer's sound too</span>
          <span className="muted">everything it plays except Maplecord</span>
        </label>
      ) : <div className="muted">Only the picture is sent from this browser. Your microphone carries on as normal.</div>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button></div>
    </Dialog>
  )
}

const toggleFullScreen = (el: HTMLElement | null) => {
  if (!el) return
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => { /* already left */ }); return }
  if (typeof el.requestFullscreen === 'function') { void el.requestFullscreen().catch(() => { /* refused: nothing to do */ }); return }
  // An iPhone only lets a video itself fill the screen, in its own player.
  const video = (el instanceof HTMLVideoElement ? el : el.querySelector('video')) as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
  video?.webkitEnterFullscreen?.()
}

/** A finger, not a mouse: there is no right-click and no hovering. */
const touchScreen = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

/**
 * The shape the picture's box is given. A stream's frames do not always arrive at exactly one size: some senders
 * and decoders flip between two that differ by a few lines (1080 and 1088, say) many times a second. Following every
 * frame made the whole tile jump. So the shape only changes when the picture really changes shape (by more than 3%),
 * and between near-identical sizes the widest is kept, which is the one without the extra lines.
 */
const steadyShape = (current: number | null, width: number, height: number): number | null => {
  if (!width || !height) return current
  const shape = width / height
  if (current === null || Math.abs(shape - current) / current > 0.03) return shape
  return shape > current ? shape : current
}

/** A video element bound to a live stream (React cannot set srcObject through a prop). Double-click for full screen. */
function Video({ stream, elRef, volume = 0, muted = true, sinkId = null, onBlocked, onShape }: {
  stream: MediaStream | null; elRef?: React.RefObject<HTMLVideoElement | null>
  /** Told the picture's steady shape (width over height) whenever it really changes. */
  onShape?: (shape: number) => void
  /** The stream's own sound: silent unless the tile says otherwise (your own preview never plays). */
  volume?: number; muted?: boolean; sinkId?: string | null
  /** The browser would not start it by itself: with sound ('sound', now playing silently) or at all ('play'). */
  onBlocked?: (what: 'sound' | 'play') => void
}) {
  const blocked = useRef(onBlocked)
  useEffect(() => { blocked.current = onBlocked })
  const own = useRef<HTMLVideoElement>(null)
  const ref = elRef ?? own
  const [shape, setShape] = useState<number | null>(null)
  const shapeListener = useRef(onShape)
  useEffect(() => { shapeListener.current = onShape })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setShape(cur => steadyShape(cur, el.videoWidth, el.videoHeight))
    el.addEventListener('resize', measure)
    el.addEventListener('loadedmetadata', measure)
    measure()
    return () => { el.removeEventListener('resize', measure); el.removeEventListener('loadedmetadata', measure) }
  }, [ref])
  useEffect(() => { if (shape) shapeListener.current?.(shape) }, [shape])
  // A phone pauses video while its browser is in the background; start it again when the page is back.
  useEffect(() => {
    const onBack = () => { const el = ref.current; if (!document.hidden && el?.srcObject && el.paused) void el.play().catch(() => { /* the tile's tap button covers it */ }) }
    document.addEventListener('visibilitychange', onBack)
    return () => document.removeEventListener('visibilitychange', onBack)
  }, [ref])
  // An iPhone ignores the element's volume (see volume.ts): there the sound is played through a gain node instead,
  // and the element only shows the picture.
  const viaGain = elementVolumeIgnored()
  const gain = useRef<GainNode | null>(null)
  const level = useRef(volume)
  useEffect(() => { level.current = volume })
  useEffect(() => {
    if (!viaGain || !stream || muted || stream.getAudioTracks().length === 0) return
    const ctx = gainContext()
    if (!ctx) return
    const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    const node = ctx.createGain()
    node.gain.value = Math.max(0, Math.min(1, level.current))
    source.connect(node)
    node.connect(ctx.destination)
    gain.current = node
    // Not allowed to make a sound until the page is tapped: the tile asks for that tap.
    const check = window.setTimeout(() => { if (ctx.state !== 'running') blocked.current?.('sound') }, 700)
    return () => { window.clearTimeout(check); source.disconnect(); node.disconnect(); gain.current = null }
  }, [viaGain, stream, muted])
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!el) return
    el.muted = muted || viaGain
    el.volume = Math.max(0, Math.min(1, volume))
    if (gain.current) gain.current.gain.value = Math.max(0, Math.min(1, volume))
    if (!muted) void el.setSinkId?.(sinkId ?? '').catch(() => { /* plays on the default speakers */ })
  }, [ref, muted, viaGain, volume, sinkId, stream])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (!stream) return
    void el.play().catch(() => {
      // Phones do not start a video with sound unless it was just tapped, and some (in low power mode) do not start
      // one at all. Start it silent; if even that is refused, the tile asks for a tap.
      if (el.muted) { blocked.current?.('play'); return }
      el.muted = true
      el.play().then(() => blocked.current?.('sound'), () => blocked.current?.('play'))
    })
  }, [ref, stream])
  return (
    <div className="videobox" style={shape ? { '--a': String(shape) } as React.CSSProperties : undefined} onDoubleClick={e => toggleFullScreen(e.currentTarget)}>
      <video ref={ref} autoPlay playsInline muted={muted || viaGain} />
    </div>
  )
}

/**
 * One stream being watched. It shows in the stage, can fill the screen, or can be popped out into a window of its
 * own; while it is out, the stage keeps a small placeholder so it can be put back or closed from here too.
 */
function WatchedTile({ store, streamer, userId, title, detail, state, error, canRetry }: {
  store: Store; streamer: string; userId: string | null; title: string; detail: string; state: 'connecting' | 'live' | 'failed'; error: string | null; canRetry: boolean
}) {
  const stream = store.streamOf(streamer)
  // Right-click: this stream's sound, and how much of it we ask to be sent.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [limitKbps, setLimitKbps] = useState(0)
  // What the browser refused to start by itself, until the person taps (see Video).
  const [needsTap, setNeedsTap] = useState<'sound' | 'play' | null>(null)
  const shapeRef = useRef<number | null>(null)
  const [size, setSize] = useState<{ height: number } | null>(null)
  const prefs = (userId && store.settings.users?.[userId]) || {}
  const hasSound = !!stream && stream.getAudioTracks().length > 0
  const volume = prefs.streamVolume ?? 1
  const silent = !!prefs.streamMuted || store.deafened
  const setPrefs = (patch: { streamVolume?: number; streamMuted?: boolean }) => { if (userId) store.setUserPrefs(userId, patch) }
  // Asked again whenever the stream (re)connects: the sharer's app only remembers it for the connection it was asked on.
  const sendLimit = useRef(store.setStreamLimit)
  useEffect(() => { sendLimit.current = store.setStreamLimit })
  useEffect(() => { if (state === 'live' && limitKbps > 0) sendLimit.current(streamer, limitKbps) }, [state, limitKbps, streamer])
  const chooseLimit = (kbps: number) => { setLimitKbps(kbps); store.setStreamLimit(streamer, kbps) }
  const most = store.streamRules?.maxKbps ?? 2500
  const menuEntries = (): MenuEntry[] => [
    { kind: 'label', text: title },
    ...(hasSound
      ? [
          { kind: 'item', label: 'Mute this stream', checked: !!prefs.streamMuted, onClick: () => setPrefs({ streamMuted: !prefs.streamMuted }) } as MenuEntry,
          { kind: 'slider', label: 'Stream volume', min: 0, max: 100, step: 5, value: Math.round(volume * 100), format: (v: number) => v + '%', onChange: (v: number) => setPrefs({ streamVolume: v / 100 }) } as MenuEntry,
        ]
      : [{ kind: 'item', label: 'This stream has no sound', disabled: true, onClick: () => {} } as MenuEntry]),
    { kind: 'sep' },
    { kind: 'label', text: 'Quality sent to you' },
    { kind: 'item', label: 'Best available', checked: limitKbps === 0, onClick: () => chooseLimit(0) },
    ...[1500, 800, 400].filter(k => k < most).map(k => ({ kind: 'item', label: `Up to ${k >= 1000 ? (k / 1000).toFixed(1) + ' Mbps' : k + ' kbps'}${k === 400 ? ' · slow connections' : ''}`, checked: limitKbps === k, onClick: () => chooseLimit(k) } as MenuEntry)),
    { kind: 'sep' },
    { kind: 'item', label: 'Full screen', icon: '⛶', onClick: () => { setMenu(null); toggleFullScreen(videoRef.current?.parentElement ?? null) } },
    { kind: 'item', label: 'Stop watching', icon: '✕', onClick: () => { void store.unwatchStream(streamer) } },
  ]
  const videoRef = useRef<HTMLVideoElement>(null)
  const popRef = useRef<Popout | null>(null)
  const [poppedOut, setPoppedOut] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const putBack = () => { popRef.current?.close(); popRef.current = null; setPoppedOut(false) }

  const popOut = async () => {
    setNote(null)
    // Seen again whenever either window is shown or hidden, so watching is only paused when nothing is on screen.
    const recheck = () => document.dispatchEvent(new Event('visibilitychange'))
    const pop = openPopout(streamer, title + ' — Maplecord', () => { popRef.current = null; setPoppedOut(false); recheck() }, recheck)
    if (pop) { popRef.current = pop; if (shapeRef.current) pop.setShape(shapeRef.current); pop.setStream(stream); setPoppedOut(true); return }
    // A pop-up blocker said no. A floating picture-in-picture window is the next best thing.
    try { await videoRef.current?.requestPictureInPicture() }
    catch {
      setNote('This browser blocked the pop-out window. Allow pop-ups for Maplecord and try again.')
      window.setTimeout(() => setNote(null), 8000)
    }
  }

  // The window follows the stream: a reconnect swaps the video in place, and a stream that ends takes its window with it.
  useEffect(() => { popRef.current?.setStream(state === 'failed' ? null : stream) }, [stream, state])
  useEffect(() => { popRef.current?.setTitle(title + ' — Maplecord') }, [title])
  useEffect(() => { popRef.current?.setAudio(volume, silent || !hasSound) }, [volume, silent, hasSound, poppedOut])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const h = videoRef.current?.videoHeight ?? 0
      setSize(cur => (h > 0 ? (cur?.height === h ? cur : { height: h }) : cur))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => () => { popRef.current?.close(); popRef.current = null }, [])

  return (
    <div className={'tile' + (poppedOut ? ' out' : '')} onContextMenu={e => { if (state === 'failed') return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
      onClick={e => {
        if (state === 'failed' || menu || !touchScreen()) return
        if ((e.target as HTMLElement).closest('.videobox')) setMenu({ x: e.clientX, y: e.clientY })
      }}>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />}
      {state === 'failed'
        ? <div className="waiting bad">{error ?? 'The stream could not be shown.'}</div>
        : poppedOut
          ? <div className="waiting">Showing in its own window.</div>
          : <><Video stream={stream} elRef={videoRef} volume={volume} muted={silent || !hasSound || needsTap !== null} sinkId={store.settings.audioOutputDeviceId} onBlocked={setNeedsTap} onShape={a => { shapeRef.current = a; popRef.current?.setShape(a) }} />
              {needsTap && state === 'live' && (
                <button className="taptoplay accent" onClick={() => {
                  // Done here, in the tap itself: that is what lets a phone start the sound.
                  const el = videoRef.current
                  wakeGainContext()
                  if (el) { el.muted = silent || !hasSound || elementVolumeIgnored(); void el.play().catch(() => { /* still refused; the button stays */ }) }
                  setNeedsTap(null)
                }}>{needsTap === 'sound' ? '🔊 Tap for sound' : '▶ Tap to play'}</button>
              )}
              {state === 'connecting' && <div className="waiting">Connecting…</div>}</>}
      <div className="bar">
        <span className="live">LIVE</span>
        <span className="grow" title={note ?? (touchScreen() ? 'Tap the picture for sound and quality' : 'Right-click for sound and quality')}>{note ?? `${title}${detail}${size && state === 'live' ? ' · ' + size.height + 'p' : ''}`}{hasSound && !note && <span title={silent ? 'Muted' : 'This stream has sound'}> {silent ? '🔇' : '🔊'}</span>}</span>
        {state !== 'failed' && (poppedOut
          ? <button className="subtle" onClick={putBack} title="Close its window and show it here again">Put back</button>
          : <>
              <button className="subtle" onClick={() => void popOut()} title="Show this stream in a window of its own">⧉ Pop out</button>
              <button className="subtle" onClick={() => toggleFullScreen(videoRef.current?.parentElement ?? null)} title="Fill the screen (or double-click the video). Esc to leave.">⛶ Full screen</button>
            </>)}
        {state === 'failed' && canRetry && <button className="subtle" onClick={() => void store.watchStream(streamer)}>Try again</button>}
        <button className="subtle" onClick={() => void store.unwatchStream(streamer)}>{state === 'failed' ? 'Close' : 'Stop watching'}</button>
      </div>
    </div>
  )
}

const KIND: Record<string, string> = { screen: 'screen', window: 'app', camera: 'camera' }

/**
 * What is being shared in the voice channel you are in: your own stream (as a small preview) and the ones you chose
 * to watch. Sits above the chat. Double-click a video for full screen.
 */
export function StreamStage({ store, nameOf }: { store: Store; nameOf: (userId: string, fallback: string) => string }) {
  const voice = store.voice
  if (!voice) return null
  const watching = store.watching
  const mine = store.sharing
  if (!mine && watching.length === 0) return null
  const who = (connectionId: string) => voice.participants.find(p => p.connectionId === connectionId)
  const viewers = store.shareViewers

  return (
    <div className="stage">
      {mine && (
        <div className="tile own">
          <Video stream={store.localStream} />
          <div className="bar">
            <span className="live">LIVE</span>
            <span className="grow">You are sharing your {KIND[mine] ?? mine}{store.shareQuality ? ' · ' + describeQuality(store.shareQuality) : ''} · {viewers.total === 0 ? 'nobody is watching yet' : `${viewers.total} watching`}</span>
            <button className="subtle" onClick={() => void store.stopShare()}>Stop sharing</button>
          </div>
        </div>
      )}
      {watching.map(w => {
        const p = who(w.streamer)
        const name = p ? nameOf(p.userId, p.username) : 'Someone'
        const detail = (p?.stream ? ` · ${KIND[p.stream] ?? p.stream}` : '') + (w.state === 'live' && w.relayed !== null ? (w.relayed ? '' : ' · P2P') : '')
        return <WatchedTile key={w.streamer} store={store} streamer={w.streamer} userId={p?.userId ?? null} title={name} detail={detail} state={w.state} error={w.error} canRetry={!!p?.stream} />
      })}
    </div>
  )
}
