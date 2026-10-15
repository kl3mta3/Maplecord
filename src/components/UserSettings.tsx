import { ExpressionLibrary } from './Expressions'
import { useState } from 'react'
import type { Store } from '../store'
import { UserStatus } from '../types'
import { DEFAULT_THEME, EDITABLE, MOST_SAVED_THEMES, SAVED_THEME_NAME, THEMES, colorsOf, contrast, fromThemeCode, ownColors, themeCode, withSaved } from '../theme'
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
  { value: UserStatus.Idle, label: 'Idle', hint: 'You appear away', dot: 'idle' },
  { value: UserStatus.DoNotDisturb, label: 'Do not disturb', hint: 'No sounds or desktop notifications', dot: 'dnd' },
  { value: UserStatus.Invisible, label: 'Invisible', hint: 'You appear offline', dot: 'invisible' },
]

export type Section = 'account' | 'voice' | 'privacy' | 'connections' | 'look' | 'expressions' | 'app' | 'bots'
const SECTIONS: [Section, string][] = [['account', 'My account'], ['voice', 'Voice & audio'], ['privacy', 'Status & privacy'], ['connections', 'Connections'], ['look', 'Appearance'], ['expressions', 'Emojis & sounds'], ['app', 'App'], ['bots', 'My bots']]

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
  // One's own theme: the colours kept for it, or, before there are any, the ones of the theme in use (where it starts from).
  const own = ownColors(theme.custom ?? colorsOf(theme.preset))
  const setOwn = (name: string, value: string) => store.updateSettings({ theme: { ...theme, preset: 'custom', accent: null, custom: { ...own, [name]: value } } })
  const hardToRead = contrast(own['--text']!, own['--bg1']!) < 4.5 || contrast(own['--text']!, own['--bg0']!) < 4.5
  // The theme in use as a code, to copy (a built-in one with its accent if one was picked), and one pasted to use.
  const inUse = theme.preset === 'custom' ? own : { ...colorsOf(theme.preset), ...(theme.accent ? { '--accent': theme.accent } : {}) }
  const [codeCopied, setCodeCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteProblem, setPasteProblem] = useState<string | null>(null)
  const copyThemeCode = () => { void navigator.clipboard.writeText(themeCode(inUse)).then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1500) }) }
  // Themes saved on this device under names. Each is kept as its code; using one makes it the Custom theme.
  const saved = store.settings.savedThemes ?? []
  const codeInUse = themeCode(inUse)
  const [saveName, setSaveName] = useState('')
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const saveTheme = () => {
    const next = withSaved(saved, saveName, codeInUse)
    if (!next) { setSaveProblem(`You can keep ${MOST_SAVED_THEMES} themes. Delete one first, or save over one by using its name.`); return }
    store.updateSettings({ savedThemes: next }); setSaveName(''); setSaveProblem(null)
  }
  const useSaved = (code: string) => { const colors = fromThemeCode(code); if (colors) store.updateSettings({ theme: { ...theme, preset: 'custom', accent: null, custom: colors } }) }
  const usePasted = () => {
    const colors = fromThemeCode(pasted)
    if (!colors) { setPasteProblem('That is not a Maplecord theme code. Copy all of it and try again.'); return }
    store.updateSettings({ theme: { ...theme, preset: 'custom', accent: null, custom: colors } })
    setPasted(''); setPasteProblem(null)
  }
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
              <div className="muted">On Online, you are shown as idle by itself after 10 minutes without using the keyboard or mouse (anywhere on your computer in the desktop app, in Maplecord in a browser), unless you are in a voice channel or a call.</div>

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
                  <button key={id} className={'themetile' + (theme.preset === id ? ' on' : '')} onClick={() => store.updateSettings({ theme: { ...theme, preset: id, accent: null } })}
                    style={{ background: t.vars['--bg1'] ?? '#14141c', borderColor: theme.preset === id ? (t.vars['--accent'] ?? '#9000ff') : (t.vars['--border'] ?? '#2e2e3e') }}>
                    <span className="swatches">
                      <i style={{ background: t.vars['--accent'] ?? '#9000ff' }} /><i style={{ background: t.vars['--accent2'] ?? '#00ddff' }} /><i style={{ background: t.vars['--bg3'] ?? '#262634' }} />
                    </span>
                    <span>{t.name}</span>
                  </button>
                ))}
                {/* One's own: it starts from the theme in use, and every colour can then be changed. */}
                <button className={'themetile' + (theme.preset === 'custom' ? ' on' : '')} onClick={() => store.updateSettings({ theme: { ...theme, preset: 'custom', accent: null, custom: own } })}
                  style={{ background: own['--bg1'], color: own['--text'], borderColor: theme.preset === 'custom' ? own['--accent'] : own['--border'] }}>
                  <span className="swatches">
                    <i style={{ background: own['--accent'] }} /><i style={{ background: own['--accent2'] }} /><i style={{ background: own['--bg3'] }} />
                  </span>
                  <span>Custom</span>
                </button>
              </div>
              <h4>Saved themes</h4>
              {saved.length > 0 && (
                <div className="savedthemes">
                  {saved.map(t => {
                    const c = fromThemeCode(t.code)
                    if (!c) return null
                    const using = theme.preset === 'custom' && t.code === codeInUse
                    return (
                      <div key={t.name} className={'savedtheme' + (using ? ' on' : '')} style={{ background: c['--bg1'], color: c['--text'], borderColor: using ? c['--accent'] : c['--border'] }}>
                        <span className="swatches"><i style={{ background: c['--accent'] }} /><i style={{ background: c['--accent2'] }} /><i style={{ background: c['--bg3'] }} /></span>
                        <span className="grow" title={t.name}>{t.name}</span>
                        {using ? <span className="small">In use</span> : <button className="subtle" onClick={() => useSaved(t.code)}>Use</button>}
                        <button className="subtle" title={`Copy the code of ${t.name}`} aria-label={`Copy the code of ${t.name}`} onClick={() => void navigator.clipboard.writeText(t.code)}>Copy</button>
                        <button className="subtle danger" title={`Delete ${t.name}`} aria-label={`Delete ${t.name}`} onClick={() => store.updateSettings({ savedThemes: saved.filter(x => x.name !== t.name) })}>×</button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="row">
                <input className="grow" value={saveName} maxLength={SAVED_THEME_NAME} placeholder="A name for the theme in use" aria-label="Name to save the theme under"
                  onChange={e => { setSaveName(e.target.value); setSaveProblem(null) }} onKeyDown={e => e.key === 'Enter' && saveName.trim() && saveTheme()} />
                <button disabled={!saveName.trim()} onClick={saveTheme}>Save</button>
              </div>
              {saveProblem ? <div className="muted">{saveProblem}</div>
                : <div className="muted small">Kept on this device, up to {MOST_SAVED_THEMES}. Saving under a name that is already there replaces it.</div>}
              <h4>Theme code</h4>
              <div className="row">
                <button onClick={copyThemeCode}>{codeCopied ? 'Copied' : 'Copy theme code'}</button>
                <span className="grow muted">The theme in use, as a code to paste on another device or give to a friend.</span>
              </div>
              <div className="row">
                <input className="grow" value={pasted} placeholder="Paste a theme code" spellCheck={false} aria-label="Theme code"
                  onChange={e => { setPasted(e.target.value); setPasteProblem(null) }} onKeyDown={e => e.key === 'Enter' && pasted.trim() && usePasted()} />
                <button className="accent" disabled={!pasted.trim()} onClick={usePasted}>Use it</button>
              </div>
              {pasteProblem && <div className="muted">{pasteProblem}</div>}
              {theme.preset === 'custom' ? (
                <>
                  <h4>Your theme</h4>
                  <div className="themeeditor">
                    {EDITABLE.map(e => (
                      <label key={e.name} className="fxcolor"><input type="color" value={own[e.name]} onChange={ev => setOwn(e.name, ev.target.value)} aria-label={e.label} /><span>{e.label}</span></label>
                    ))}
                  </div>
                  {hardToRead && <div className="muted"><b>Text is hard to read on these colours.</b> Choose a lighter text colour, or darker panels and window.</div>}
                  <div className="row">
                    <span className="muted">Start again from</span>
                    <select value="" onChange={e => { if (e.target.value) store.updateSettings({ theme: { ...theme, preset: 'custom', accent: null, custom: colorsOf(e.target.value) } }) }} aria-label="Start again from a theme">
                      <option value="">a theme…</option>
                      {Object.entries(THEMES).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
                    </select>
                    <span className="grow muted">Kept on this device.</span>
                  </div>
                </>
              ) : (
                <>
                  <h4>Accent colour</h4>
                  <div className="row">
                    <input type="color" value={theme.accent ?? THEMES[theme.preset]?.vars['--accent'] ?? '#9000ff'} onChange={e => store.updateSettings({ theme: { ...theme, accent: e.target.value } })} />
                    <span className="grow muted">Buttons, highlights and switches. Kept on this device.</span>
                    {theme.accent && <button className="subtle" onClick={() => store.updateSettings({ theme: { ...theme, accent: null } })}>Use the theme's</button>}
                  </div>
                </>
              )}
            </>
          )}

          {section === 'bots' && <MyBots api={store.api} />}
          {section === 'expressions' && <ExpressionLibrary api={store.api} />}
          {section === 'voice' && <VoiceAudioSettings store={store} onAllowDirect={onAllowDirect} />}

          {section === 'app' && (
            <>
              {store.communityPoll && (
                <>
                  <h4>Polls</h4>
                  <div className="row">
                    <button onClick={() => { onClose(); void store.showCommunityPoll() }}>Latest poll: {store.communityPoll.title}</button>
                    <span className="muted">{store.communityPoll.mine === 'answered' ? 'You have answered it.' : store.communityPoll.ended ? 'It has ended.' : store.communityPoll.mayAnswer ? 'You have not answered it yet.' : ''}</span>
                  </div>
                </>
              )}
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
