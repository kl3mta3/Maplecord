import fs from 'node:fs'
import path from 'node:path'
import { SOUND_EVENTS, type SoundPack } from '../src/soundTypes.ts'

/**
 * Sound packs the user added themselves: <userData>/sounds/<Pack name>/<event>.wav (or .mp3 / .ogg), where <event> is
 * one of SOUND_EVENTS. A pack does not have to cover every event; the built-in sound plays for the rest.
 * Maplecord ships only its own generated sounds. Packs live on the user's machine and are never uploaded or shared.
 *
 * No Electron imports here, so this runs under plain Node for tests.
 */
const EXTENSIONS = ['.wav', '.mp3', '.ogg']

export function listSoundPacks(root: string): SoundPack[] {
  let entries: fs.Dirent[]
  try { fs.mkdirSync(root, { recursive: true }); entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return [] }
  const packs: SoundPack[] = []
  for (const entry of entries) {
    // Folders starting with "_" or "." are for the user's own bookkeeping.
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name.length > 40) continue
    let files: string[]
    try { files = fs.readdirSync(path.join(root, entry.name)) } catch { continue }
    const events: SoundPack['events'] = {}
    for (const event of SOUND_EVENTS) {
      const file = files.find(f => EXTENSIONS.some(ext => f.toLowerCase() === (event + ext).toLowerCase()))
      if (file) events[event] = file
    }
    if (Object.keys(events).length > 0) packs.push({ name: entry.name, events })
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name))
}

/** Absolute path of one sound file inside a pack, or null if it is not an audio file there (or tries to leave the folder). */
export function resolveSound(root: string, pack: string, file: string): string | null {
  if (!EXTENSIONS.includes(path.extname(file).toLowerCase())) return null
  const base = path.resolve(root)
  const full = path.resolve(base, pack, file)
  if (!full.startsWith(base + path.sep)) return null
  try {
    const real = fs.realpathSync(full)
    return real.startsWith(fs.realpathSync(base) + path.sep) && fs.statSync(real).isFile() ? real : null
  } catch { return null }
}
