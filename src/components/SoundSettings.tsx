import { useEffect, useState } from 'react'
import { SOUND_EVENTS, SOUND_LABELS, type SoundEvent } from '../soundTypes'
import type { ExpressionDto, ExpressionGroupDto } from '../types'
import { packSoundUrl, previewSound } from '../sounds'
import { Dialog } from './Dialogs'

/** A sound chosen for one moment in place of the pack's: a soundboard sound, by id, name and address. */
export type SoundChoice = { id: string; name: string; url: string }

/**
 * Customize sounds: for each moment the app plays a sound (a win, a 100, a message), the pack's sound or one of the
 * soundboard sounds this person can reach (their own library, and the servers they are in). Kept on this device;
 * nothing is played to anyone else.
 */
export function SoundCustomizer({ pack, chosen, loadSounds, onChange, onClose }: {
  pack: string; chosen: Partial<Record<SoundEvent, SoundChoice>>
  loadSounds: () => Promise<ExpressionGroupDto[]>
  onChange: (chosen: Partial<Record<SoundEvent, SoundChoice>>) => void
  onClose: () => void
}) {
  const [groups, setGroups] = useState<ExpressionGroupDto[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { void loadSounds().then(setGroups).catch(e => setProblem(e instanceof Error ? e.message : String(e))) }, [loadSounds])
  const all: ExpressionDto[] = (groups ?? []).flatMap(g => g.items)
  const pick = (event: SoundEvent, id: string) => {
    const next = { ...chosen }
    const sound = all.find(s => s.id === id)
    if (sound) next[event] = { id: sound.id, name: sound.name, url: sound.url }
    else delete next[event]
    onChange(next)
  }
  return (
    <Dialog title="Customize sounds" onClose={onClose} scrolls>
      <p className="muted small">Each moment plays the sound of your pack ({pack}) unless you choose a soundboard sound for it: one of your own, or one from a server you are in. This is only on this device; nobody else hears it.</p>
      {problem && <div className="error">{problem}</div>}
      {groups && all.length === 0 && <p className="muted small">There are no soundboard sounds to choose from yet. Add one to a server you manage (its settings, Emojis &amp; sounds) and it shows up here.</p>}
      <div className="soundmoments">
        {SOUND_EVENTS.map(event => {
          const current = chosen[event]
          const missing = current && groups && !all.some(s => s.id === current.id)
          return (
            <div key={event} className="soundmoment">
              <div className="grow">
                <div>{SOUND_LABELS[event]}</div>
                <div className="muted small">{event}{missing ? ' · the chosen sound is no longer there; the pack\'s plays' : ''}</div>
              </div>
              <select value={current && !missing ? current.id : ''} onChange={e => pick(event, e.target.value)} aria-label={`Sound for: ${SOUND_LABELS[event]}`} disabled={!groups}>
                <option value="">The pack's sound</option>
                {(groups ?? []).map(g => (
                  <optgroup key={g.guildId} label={g.name}>
                    {g.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <button className="subtle" title="Hear it" aria-label={`Hear the sound for: ${SOUND_LABELS[event]}`}
                onClick={() => previewSound(current && !missing ? current.url : packSoundUrl(event, pack))}>▶</button>
            </div>
          )
        })}
      </div>
      <div className="buttons">
        {Object.keys(chosen).length > 0 && <button className="subtle" onClick={() => onChange({})}>Use the pack's for all</button>}
        <button className="accent" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  )
}
