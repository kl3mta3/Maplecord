import { useState } from 'react'
import type { Store } from '../store'
import { UserStatus } from '../types'
import { DEFAULT_THEME, THEMES } from '../theme'
import { isElectron } from '../platform'
import { shownName } from '../profile'
import { Dialog } from './Dialogs'
import { ConnectionsPane } from './Connections'
import { AccountSignIn } from './SignIn'
import { askToInstall, installWay } from '../install'
import { MyBots } from './Integrations'
import { VoiceAudioSettings } from './VoiceAudio'

/** The ways a person can appear, in the order they are offered. */
export const STATUSES: { value: UserStatus; label: string; hint: string; dot: string }[] = [
  { value: UserStatus.Online, label: 'Online', hint: '', dot: 'online' },
  { value: UserStatus.DoNotDisturb, label: 'Do not disturb', hint: 'No sounds or desktop notifications', dot: 'dnd' },
  { value: UserStatus.Invisible, label: 'Invisible', hint: 'You appear offline', dot: 'invisible' },
]

export type Section = 'account' | 'voice' | 'privacy' | 'connections' | 'look' | 'app' | 'bots'
const SECTIONS: [Section, string][] = [['account', 'My account'], ['voice', 'Voice & audio'], ['privacy', 'Status & privacy'], ['connections', 'Connections'], ['look', 'Appearance'], ['app', 'App'], ['bots', 'My bots']]

/**
 * Everything that is about the person rather than about a server, behind the cog at the bottom of the sidebar.
 * The larger editors (profile, voice, overlay, plugins) keep their own windows and are opened from here.
 */
export function UserSettingsDialog({ store, initial, onOpen, onAllowDirect, onSignOut, onClose }: {
  store: Store
  /** The section to open at. */
  initial?: Section
  onOpen: (what: 'profile' | 'overlay' | 'plugins') => void
  /** Asked to change whether P2P is allowed (see VoiceAudioSettings). */
  onAllowDirect: (allow: boolean) => void
  onSignOut: () => void
  onClose: () => void
}) {
  const [section, setSection] = useState<Section>(initial ?? 'account')
  const [copied, setCopied] = useState(false)
  const me = store.settings.user
  const prefs = store.preferences
  const theme = store.settings.theme ?? DEFAULT_THEME
  const desktop = isElectron()
  const copyId = () => { if (me) void navigator.clipboard.writeText(me.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }

  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="usersettings">
        <nav>
          {SECTIONS.map(([id, label]) => <button key={id} className={section === id ? 'accent' : 'subtle'} onClick={() => setSection(id)}>{label}</button>)}
          <span className="grow" />
          <button className="danger" onClick={onSignOut}>Sign out</button>
        </nav>

        <div className="pane">
          {section === 'account' && me && (
            <>
              <h4>{shownName(me)}</h4>
              <div className="muted">@{me.username}</div>
              <div className="row idrow">
                <span className="muted">User ID</span><code>{me.id}</code>
                <button className="subtle" onClick={copyId}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <div className="row">
                <button onClick={() => onOpen('profile')}>Edit profile</button>
                <button onClick={() => setSection('voice')}>Voice &amp; audio</button>
              </div>
              <AccountSignIn store={store} />
              <h4>Leaving</h4>
              <div className="row"><button className="danger" onClick={() => { onClose(); store.openDeleteAccount() }}>Delete account…</button></div>
            </>
          )}

          {section === 'connections' && <ConnectionsPane store={store} />}

          {section === 'privacy' && (
            <>
              <h4>Status</h4>
              {STATUSES.map(s => (
                <label key={s.value} className="choice">
                  <input type="radio" name="status" checked={prefs.status === s.value} onChange={() => void store.savePreferences({ status: s.value })} />
                  <span className={'statusdot ' + s.dot} /><span>{s.label}</span>{s.hint && <span className="muted">{s.hint}</span>}
                </label>
              ))}

              <h4>Friend requests</h4>
              <label className="switch">
                <input type="checkbox" checked={prefs.ignoreFriendRequests} onChange={e => void store.savePreferences({ ignoreFriendRequests: e.target.checked })} />
                <span className="track" /><span>Ignore all friend requests</span>
              </label>
              <label className={'switch' + (prefs.ignoreFriendRequests ? ' disabled' : '')}>
                <input type="checkbox" disabled={prefs.ignoreFriendRequests} checked={prefs.friendRequestsSharedOnly} onChange={e => void store.savePreferences({ friendRequestsSharedOnly: e.target.checked })} />
                <span className="track" /><span>Only from people I share a server with</span>
              </label>

              <h4>P2P connections</h4>
              <div className="row">
                <span className="grow muted">{store.allowDirect ? 'Allowed on this account.' : 'Not allowed on this account.'}</span>
                <button onClick={() => setSection('voice')}>Change…</button>
              </div>

              <h4>Blocked people</h4>
              {store.blocked.length === 0 && <div className="muted">Nobody. Right-click someone and choose Block: they can no longer message you, call you or send you friend requests, and are not told.</div>}
              {store.blocked.map(u => (
                <div key={u.id} className="row blockedrow">
                  <span className="grow">{shownName(u)} <span className="muted">@{u.username}</span></span>
                  <button className="subtle" onClick={() => void store.setBlocked(u.id, false)}>Unblock</button>
                </div>
              ))}
            </>
          )}

          {section === 'look' && (
            <>
              <h4>Theme</h4>
              <div className="themes">
                {Object.entries(THEMES).map(([id, t]) => (
                  <button key={id} className={'themetile' + (theme.preset === id ? ' on' : '')} onClick={() => store.updateSettings({ theme: { preset: id, accent: null } })}
                    style={{ background: t.vars['--bg1'] ?? '#14141c', borderColor: theme.preset === id ? (t.vars['--accent'] ?? '#9000ff') : (t.vars['--border'] ?? '#2e2e3e') }}>
                    <span className="swatches">
                      <i style={{ background: t.vars['--accent'] ?? '#9000ff' }} /><i style={{ background: t.vars['--accent2'] ?? '#00ddff' }} /><i style={{ background: t.vars['--bg3'] ?? '#262634' }} />
                    </span>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
              <h4>Accent colour</h4>
              <div className="row">
                <input type="color" value={theme.accent ?? THEMES[theme.preset]?.vars['--accent'] ?? '#9000ff'} onChange={e => store.updateSettings({ theme: { preset: theme.preset, accent: e.target.value } })} />
                <span className="grow muted">Buttons, highlights and switches. Kept on this device.</span>
                {theme.accent && <button className="subtle" onClick={() => store.updateSettings({ theme: { preset: theme.preset, accent: null } })}>Use the theme's</button>}
              </div>
            </>
          )}

          {section === 'bots' && <MyBots api={store.api} />}
          {section === 'voice' && <VoiceAudioSettings store={store} onAllowDirect={onAllowDirect} />}

          {section === 'app' && (
            <>
              {installWay() && (
                <>
                  <h4>On this device</h4>
                  <div className="row"><button onClick={() => { onClose(); askToInstall() }}>Add to Home Screen…</button></div>
                </>
              )}
              <h4>Sounds</h4>
              <label className="switch">
                <input type="checkbox" checked={store.settings.soundEnabled} onChange={e => store.updateSettings({ soundEnabled: e.target.checked })} />
                <span className="track" /><span>Play sounds</span>
              </label>
              <h4>Rolls</h4>
              <label className="switch" title="Show Roll, Need / Greed, Flip and RPS at the top of the chat. Slash commands, the overlay and hotkeys work either way.">
                <input type="checkbox" checked={store.settings.showRollButtons !== false} onChange={e => store.updateSettings({ showRollButtons: e.target.checked })} />
                <span className="track" /><span>Roll buttons at the top of the chat</span>
              </label>
              <label className={'switch' + (desktop ? '' : ' disabled')} title={desktop ? 'Keep the small roll overlay on top of your game' : 'The in-game overlay needs the desktop app'}>
                <input type="checkbox" disabled={!desktop} checked={desktop && store.settings.overlayEnabled} onChange={e => store.updateSettings({ overlayEnabled: e.target.checked })} />
                <span className="track" /><span>In-game overlay</span>
              </label>
              <div className="row">
                <button onClick={() => onOpen('overlay')}>Overlay &amp; sound settings</button>
                <button onClick={() => onOpen('plugins')}>Game plugins</button>
              </div>
              <div className="muted">Maplecord {__APP_VERSION__}{desktop ? ' · updates itself when it starts' : ''}</div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
