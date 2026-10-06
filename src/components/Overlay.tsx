import { useEffect, useLayoutEffect, useState } from 'react'
import { bridge, type OverlayAction, type OverlayState } from '../platform'

/**
 * The in-game overlay page (Electron loads the app with ?overlay=1 in a separate always-on-top,
 * non-focusing window). It owns no state and no server connection: the main window pushes a
 * snapshot over IPC and we send button presses back.
 *
 * Modes: a tiny pill (the die + a grab handle) while nothing is happening → click the die to open the
 * launcher (Roll, Need/Greed, Flip, RPS → three throws; the channel name switches channels) → a live card
 * while a roll or RPS round is open → back to the pill.
 */
export default function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'rps' | 'channels'>('closed')
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    const b = bridge()
    if (!b) return
    const off = b.onOverlayState(s => setState(s))
    b.overlayReady()
    return off
  }, [])

  // Any live game closes the launcher.
  useEffect(() => { if (state && state.kind !== 'idle') setMenu('closed') }, [state])

  useEffect(() => {
    if (!state || state.kind === 'idle' || state.kind === 'drop') return
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(state.expiresAt).getTime() - Date.now()) / 1000)))
    tick(); const id = window.setInterval(tick, 1000); return () => window.clearInterval(id)
  }, [state])

  // Not in a party yet: the launcher offers the voice channels to join instead of the roll buttons.
  const needParty = state?.kind === 'idle' && !state.canStart
  const view = menu === 'closed' ? 'closed' : needParty || menu === 'channels' ? 'channels' : menu

  // Ask the window for the size this mode needs.
  const mode = !state ? 'hidden' : state.kind !== 'idle' ? state.kind : view === 'closed' ? 'pill' : view
  const channelCount = state?.kind === 'idle' ? state.channels.length : 0
  useLayoutEffect(() => {
    const size = mode === 'pill' ? [78, 46]
      : mode === 'open' ? [270, 118]
      : mode === 'channels' ? [270, (needParty ? 76 : 52) + Math.max(1, Math.min(channelCount, 8)) * 26]
      : mode === 'drop' ? [270, 118]
      : mode === 'rps' ? [270, 176] : [270, 196]
    bridge()?.overlayResize(size[0], size[1])
  }, [mode, channelCount, needParty])

  const act = (a: OverlayAction) => { bridge()?.overlayAction(a); setMenu('closed') }
  if (!state) return <div className="overlay empty" />

  if (state.kind === 'idle') {
    if (menu === 'closed') {
      return (
        <div className="overlay pill">
          <button className="pillbtn" onClick={() => setMenu('open')} title="Maplecord — start a roll">🎲</button>
          <span className="handle drag" title="Drag to move">⋮</span>
        </div>
      )
    }
    return (
      <div className="overlay">
        <div className="drag">
          <div className="headline">
            {view === 'rps' ? 'Throw' : view === 'channels' ? 'Roll with' : 'Start'}{' '}
            <button className="subtle channelbtn" onClick={() => setMenu(view === 'channels' ? 'open' : 'channels')} title="Change who you roll with">
              {state.channelName || 'nobody yet'} ▾
            </button>
          </div>
          <button className="subtle close" onClick={() => setMenu('closed')} title="Collapse">–</button>
        </div>
        {view === 'open' ? (
          <div className="launcher">
            <button className="accent" onClick={() => act('start-roll')}>🎲 Roll</button>
            <button onClick={() => act('start-need')}>Need / Greed</button>
            <button onClick={() => act('flip')}>🪙 Flip</button>
            <button onClick={() => setMenu('rps')}>✊ RPS</button>
          </div>
        ) : view === 'channels' ? (
          <div className="channellist">
            {needParty && <div className="muted">Rolls go to the people in voice with you. Join a channel:</div>}
            {state.channels.length === 0 && <div className="muted center">No voice channels here</div>}
            {state.channels.map(c => (
              <button key={c.id} className={'subtle' + (c.current ? ' current' : '')} onClick={() => { bridge()?.overlayAction(`select-channel:${c.id}`); setMenu('open') }}>{c.name}</button>
            ))}
          </div>
        ) : (
          <div className="throws">
            <button onClick={() => act('rps-rock')} title="Rock">✊</button>
            <button onClick={() => act('rps-paper')} title="Paper">✋</button>
            <button onClick={() => act('rps-scissors')} title="Scissors">✌️</button>
            <button className="subtle" onClick={() => setMenu('open')}>back</button>
          </div>
        )}
      </div>
    )
  }

  if (state.kind === 'drop') {
    return (
      <div className="overlay">
        <div className="drag">
          {state.iconUrl && <img className="itemicon" src={state.iconUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
          <div className="headline">{state.itemName}{state.quantity > 1 && <span className="muted"> ×{state.quantity}</span>}</div>
          <button className="subtle close" onClick={() => act('drop-dismiss')} title="Ignore">×</button>
        </div>
        <div className="muted">Dropped in {state.gameName} · {state.channelName ? `roll with ${state.channelName}` : 'join voice to roll'}</div>
        <div className="buttons">
          <button className="need" onClick={() => act('drop-need')}>Need / Greed</button>
          <button className="accent" onClick={() => act('drop-roll')}>Roll</button>
          <button className="subtle" onClick={() => act('drop-dismiss')}>Ignore</button>
        </div>
        <div className="muted hint">Ctrl+Alt+R roll for it · P ignore</div>
      </div>
    )
  }

  if (state.kind === 'rps') {
    const icons = ['✊', '✋', '✌️']
    return (
      <div className="overlay">
        <div className="drag">
          <div className="headline">{state.headline}</div>
          <button className="subtle close" onClick={() => act('dismiss')} title="Hide">×</button>
        </div>
        <div className="muted">{state.channelName} · {state.status}{state.ended ? '' : ` · ${secondsLeft}s`}</div>
        <div className="picks">{state.throws.map((t, i) => <span key={i}>{t}</span>)}</div>
        {state.resultText && <div className={'winner' + (state.iWon ? ' won' : '')}>{state.resultText}</div>}
        {state.canPick && (
          <div className="throws">
            <button onClick={() => act('rps-rock')} title="Rock">✊</button>
            <button onClick={() => act('rps-paper')} title="Paper">✋</button>
            <button onClick={() => act('rps-scissors')} title="Scissors">✌️</button>
          </div>
        )}
        {!state.canPick && state.myPick !== null && !state.ended && <div className="muted center">You threw {icons[state.myPick]} — waiting for the others</div>}
      </div>
    )
  }

  return (
    <div className="overlay">
      <div className="drag">
        {state.iconUrl && <img className="itemicon" src={state.iconUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
        <div className="headline">{state.headline}{state.range && <span className="muted"> · {state.range}</span>}</div>
        <button className="subtle close" onClick={() => act('dismiss')} title="Hide">×</button>
      </div>
      <div className="muted">{state.channelName} · {state.status}{state.ended ? '' : ` · ${secondsLeft}s`}</div>
      <div className="numbers">
        <div><div className="muted">Your roll</div><div className={'big' + (state.iWon ? ' won' : state.lost ? ' lost' : '')}>{state.myValueText}</div><div className="muted">{state.myChoiceText}</div></div>
        <div><div className="muted">Winner</div><div className="big won">{state.winningValueText}</div></div>
      </div>
      {state.winnerText && <div className={'winner' + (state.iWon ? ' won' : '')}>{state.winnerText}</div>}
      {state.canAct && (
        <div className="buttons">
          {!state.isNeedGreed && <button className="accent" onClick={() => act('primary')}>Roll</button>}
          {state.isNeedGreed && <button className="need" onClick={() => act('primary')}>Need</button>}
          {state.isNeedGreed && <button className="greed" onClick={() => act('greed')}>Greed</button>}
          <button className="subtle" onClick={() => act('pass')}>Pass</button>
        </div>
      )}
      <div className="muted hint">Ctrl+Alt+R roll/need · G greed · P pass</div>
    </div>
  )
}
