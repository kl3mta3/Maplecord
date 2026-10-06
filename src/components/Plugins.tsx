import { useState } from 'react'
import { isElectron } from '../platform'
import type { PluginInfo } from '../pluginTypes'
import { defaultPluginSettings } from '../settings'
import type { PendingDrop, Store } from '../store'
import { ChannelType, RollKind, type ChannelDto } from '../types'
import { Dialog } from './Dialogs'

const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }

/** Shown above the composer when a plugin saw a drop and the user has not chosen auto-roll for it. */
export function DropBanner({ drop, more, channel, onAccept, onDismiss }: {
  drop: PendingDrop; more: number; channel: ChannelDto | null; onAccept: (kind?: RollKind) => void; onDismiss: () => void
}) {
  return (
    <div className="dropbanner">
      {drop.iconUrl && <img className="itemicon large" src={drop.iconUrl} alt="" onError={hideBroken} />}
      <div className="grow">
        <div className={'name rarity-' + (drop.rarity ?? 'none').toLowerCase()}>{drop.name}{drop.quantity > 1 ? ` ×${drop.quantity}` : ''}</div>
        <div className="muted">
          Dropped in {drop.gameName}{drop.context ? ` · ${drop.context}` : ''}{more > 0 ? ` · ${more} more waiting` : ''}
          {channel ? ` · roll with ${channel.type === ChannelType.DirectMessage ? '@' : '🔊 '}${channel.name}` : ' · join a voice channel to roll for it'}
        </div>
      </div>
      <button className="need" disabled={!channel} onClick={() => onAccept(RollKind.NeedGreed)}>Need / Greed</button>
      <button className="accent" disabled={!channel} onClick={() => onAccept(RollKind.Standard)}>Roll</button>
      <button className="subtle" onClick={onDismiss}>Ignore</button>
    </div>
  )
}

const WATCH_LABEL: Record<PluginInfo['watch']['state'], string> = {
  none: '', off: 'Off', watching: 'Watching', missing: 'Waiting for the log file', error: 'Problem',
}

export function PluginsDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const desktop = isElectron()
  const guard = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  return (
    <Dialog title="Game plugins" onClose={onClose} wide>
      <div className="muted">
        A plugin is a folder of data for one game: an item list with icons, and optionally the name of a log file to watch for drops.
        Plugins contain no code, and what a watched log says never leaves this computer — only "this item dropped" becomes a roll.
      </div>

      {!desktop && <div className="muted">Plugins and drop detection need the Maplecord desktop app. In a browser you can still roll for any item by typing its name.</div>}

      {desktop && store.plugins.length === 0 && (
        <div className="muted">No plugins installed yet. Use <b>Install from folder…</b> and choose a plugin folder (the one that contains manifest.json).</div>
      )}

      <div className="pluginlist">
        {store.plugins.map(p => {
          const cfg = store.settings.plugins[p.id] ?? defaultPluginSettings()
          const watch = p.watch
          return (
            <div key={p.folder} className="plugin">
              <div className="row">
                <div className="grow">
                  <b>{p.name}</b> <span className="muted">v{p.version}{p.author ? ` · ${p.author}` : ''}</span>
                  <div className="muted">{p.error ? '' : `${p.gameName} · ${p.items.length.toLocaleString()} item${p.items.length === 1 ? '' : 's'}`}</div>
                </div>
                {!p.error && p.items[0] && <button className="subtle" title="Pretend the first item just dropped, to see what happens" onClick={() => { store.simulateDrop(p.id, p.items[0].id); onClose() }}>Test a drop</button>}
              </div>
              {p.error && <div className="pluginerror">Could not load: {p.error}</div>}
              {!p.error && p.description && <div className="muted">{p.description}</div>}

              {!p.error && watch.state === 'none' && <div className="muted">Item list only — this plugin does not detect drops. Start rolls for its items from the roll dialog (right-click Roll).</div>}

              {!p.error && watch.state !== 'none' && (
                <div className="watch">
                  <label className="row">
                    <input type="checkbox" checked={cfg.watch} disabled={watch.patterns === 0} onChange={e => store.setPluginSettings(p.id, { watch: e.target.checked })} />
                    <span>Detect drops by reading the game's log file</span>
                    {cfg.watch && <span className={'state ' + watch.state}>{WATCH_LABEL[watch.state]}</span>}
                  </label>
                  <div className="row">
                    <span className="path grow" title={cfg.logPath ?? watch.defaultPath ?? ''}>{cfg.logPath ?? watch.defaultPath ?? '(no path)'}</span>
                    <button className="subtle" onClick={() => store.pickPluginLog(p.id)}>Choose file…</button>
                    {cfg.logPath && <button className="subtle" onClick={() => store.setPluginSettings(p.id, { logPath: null })}>Reset</button>}
                  </div>
                  {watch.message && <div className={watch.state === 'error' ? 'pluginerror' : 'muted'}>{watch.message}</div>}
                  <label className="row">
                    <input type="checkbox" checked={cfg.autoRoll} disabled={!cfg.watch} onChange={e => store.setPluginSettings(p.id, { autoRoll: e.target.checked })} />
                    <span>Start the roll automatically <span className="muted">— otherwise you are asked first, in the app and on the overlay</span></span>
                  </label>
                  <div className="row">
                    <span className="muted">Roll type for the hotkey and automatic rolls</span>
                    <select value={cfg.rollKind} onChange={e => store.setPluginSettings(p.id, { rollKind: e.target.value === '0' ? 0 : 1 })}>
                      <option value={1}>Need / Greed</option>
                      <option value={0}>Roll (highest wins)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="buttons" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          {desktop && <button disabled={busy} onClick={() => guard(store.installPlugin)}>Install from folder…</button>}
          {desktop && <button className="subtle" onClick={store.openPluginsFolder}>Open plugins folder</button>}
          {desktop && <button className="subtle" disabled={busy} onClick={() => guard(store.reloadPlugins)}>Reload</button>}
        </div>
        <button className="accent" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  )
}
