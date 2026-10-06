import { useEffect, useRef, useState } from 'react'
import type { Store } from '../store'
import { bridge, type ShareSource } from '../platform'
import { Dialog } from './Dialogs'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { canShareSound } from '../stream'
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

  const pick = (choice: Parameters<Store['startShare']>[0]) => { onClose(); void store.startShare(choice, hint, sound) }
  const shown = (sources ?? []).filter(s => s.kind === tab)

  return (
    <Dialog title="Share with the voice channel" onClose={onClose} wide>
      {rules && (
        <div className="muted">
          Up to {rules.maxHeight}p at {rules.maxFps} frames a second. Nothing is sent until someone chooses to watch
          {rules.maxViewersDirect ? `; up to ${rules.maxViewersDirect} people can watch at once` : ''}.
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
  void (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()).catch(() => { /* refused: nothing to do */ })
}

/** A video element bound to a live stream (React cannot set srcObject through a prop). Double-click for full screen. */
function Video({ stream, elRef, volume = 0, muted = true, sinkId = null }: {
  stream: MediaStream | null; elRef?: React.RefObject<HTMLVideoElement | null>
  /** The stream's own sound: silent unless the tile says otherwise (your own preview never plays). */
  volume?: number; muted?: boolean; sinkId?: string | null
}) {
  const own = useRef<HTMLVideoElement>(null)
  const ref = elRef ?? own
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!el) return
    el.muted = muted
    el.volume = Math.max(0, Math.min(1, volume))
    if (!muted) void el.setSinkId?.(sinkId ?? '').catch(() => { /* plays on the default speakers */ })
  }, [ref, muted, volume, sinkId, stream])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (stream) void el.play().catch(() => { /* starts on its own once data arrives */ })
  }, [ref, stream])
  return <video ref={ref} autoPlay playsInline muted={muted} onDoubleClick={e => toggleFullScreen(e.currentTarget)} />
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
    if (pop) { popRef.current = pop; pop.setStream(stream); setPoppedOut(true); return }
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
  useEffect(() => () => { popRef.current?.close(); popRef.current = null }, [])

  return (
    <div className={'tile' + (poppedOut ? ' out' : '')} onContextMenu={e => { if (state === 'failed') return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries()} onClose={() => setMenu(null)} />}
      {state === 'failed'
        ? <div className="waiting bad">{error ?? 'The stream could not be shown.'}</div>
        : poppedOut
          ? <div className="waiting">Showing in its own window.</div>
          : <><Video stream={stream} elRef={videoRef} volume={volume} muted={silent || !hasSound} sinkId={store.settings.audioOutputDeviceId} />{state === 'connecting' && <div className="waiting">Connecting…</div>}</>}
      <div className="bar">
        <span className="live">LIVE</span>
        <span className="grow" title={note ?? 'Right-click for sound and quality'}>{note ?? `${title}${detail}`}{hasSound && !note && <span title={silent ? 'Muted' : 'This stream has sound'}> {silent ? '🔇' : '🔊'}</span>}</span>
        {state !== 'failed' && (poppedOut
          ? <button className="subtle" onClick={putBack} title="Close its window and show it here again">Put back</button>
          : <>
              <button className="subtle" onClick={() => void popOut()} title="Show this stream in a window of its own">⧉ Pop out</button>
              <button className="subtle" onClick={() => toggleFullScreen(videoRef.current)} title="Fill the screen (or double-click the video). Esc to leave.">⛶ Full screen</button>
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
            <span className="grow">You are sharing your {KIND[mine] ?? mine} · {viewers.total === 0 ? 'nobody is watching yet' : `${viewers.total} watching`}</span>
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
