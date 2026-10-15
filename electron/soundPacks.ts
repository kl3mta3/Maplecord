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

/** A pack imported from a zip (see src/soundPackZip.ts): one file for each moment it covers. */
export interface PackFileIn { event: string; ext: string; data: Uint8Array }

/**
 * Saves an imported pack as a folder of its own, named after it and made different from the folders there already.
 * Only files named for a moment, as WAV, MP3 or OGG of up to 2 MB, are written; the name cannot reach outside the
 * sounds folder. Returns the folder's name, or null if there was nothing to save.
 */
export function savePack(root: string, wanted: string, files: PackFileIn[]): string | null {
  const keep = files.filter(f => (SOUND_EVENTS as readonly string[]).includes(f.event) && EXTENSIONS.includes('.' + f.ext) && f.data?.length > 0 && f.data.length <= 2 * 1024 * 1024)
  if (keep.length === 0) return null
  const clean = String(wanted).replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().replace(/^[._]+/, '').slice(0, 40) || 'My pack'
  fs.mkdirSync(root, { recursive: true })
  let name = clean
  for (let n = 2; fs.existsSync(path.join(root, name)); n++) name = `${clean} (${n})`
  const folder = path.join(root, name)
  if (path.dirname(path.resolve(folder)) !== path.resolve(root)) return null
  fs.mkdirSync(folder)
  for (const f of keep) fs.writeFileSync(path.join(folder, `${f.event}.${f.ext}`), Buffer.from(f.data))
  return name
}

/** Deletes a pack's folder: only a folder directly in the sounds folder. */
export function deletePack(root: string, name: string): boolean {
  const folder = path.resolve(root, String(name))
  if (path.dirname(folder) !== path.resolve(root) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return false
  fs.rmSync(folder, { recursive: true, force: true })
  return true
}
