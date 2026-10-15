/**
 * Sound packs as zips (desktop app only; the web app has the built-in sounds and soundboard sounds). A pack is a zip
 * of files named after the moments they are for (win.wav, lose.mp3, emo.ogg, ...; see SOUND_EVENTS), at its top or in
 * one folder inside it. Importing one unpacks those files into a folder of its own in the sounds folder; anything else
 * in the zip is ignored.
 */
import { SOUND_EVENTS, SOUND_LABELS, type SoundEvent } from './soundTypes'
import { makeZip, readZip } from './zip'

export interface PackFile { event: SoundEvent; ext: 'wav' | 'mp3' | 'ogg'; data: Uint8Array }
export interface PackFromZip { name: string; files: PackFile[] }

const EXTENSIONS = ['wav', 'mp3', 'ogg'] as const

/** The moment a file in a zip is for, from its name (in any folder), or null. */
function eventOf(path: string): { event: SoundEvent; ext: PackFile['ext'] } | null {
  const file = path.split('/').pop() ?? ''
  const dot = file.lastIndexOf('.')
  if (dot <= 0) return null
  const base = file.slice(0, dot).toLowerCase(), ext = file.slice(dot + 1).toLowerCase()
  const event = SOUND_EVENTS.find(e => e.toLowerCase() === base)
  return event && (EXTENSIONS as readonly string[]).includes(ext) ? { event, ext: ext as PackFile['ext'] } : null
}

/**
 * What a pack zip holds: one file for each moment it covers, each at most 2 MB, and a name for it from the zip's own.
 * Throws, with a reason to show, when it is not a pack.
 */
export async function readPackZip(zip: File): Promise<PackFromZip> {
  if (zip.size > 40 * 1024 * 1024) throw new Error('That zip is over 40 MB. A sound pack is a few short sounds.')
  const files: PackFile[] = []
  for (const f of await readZip(zip, name => !!eventOf(name), 2 * 1024 * 1024)) {
    const found = eventOf(f.name)!
    if (!files.some(x => x.event === found.event)) files.push({ ...found, data: f.data })
  }
  if (files.length === 0) throw new Error(`Nothing in that zip is named for a sound. Name each file after its moment, like win.wav or lose.mp3: ${SOUND_EVENTS.join(', ')}.`)
  const name = zip.name.replace(/\.zip$/i, '').replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().slice(0, 40) || 'My pack'
  return { name, files }
}

/** The built-in sounds as a pack: each file under the name the app knows it by, and a README of what each is for. */
export async function defaultPackZip(): Promise<Blob> {
  const files = await Promise.all(SOUND_EVENTS.map(async event => {
    const r = await fetch(`${import.meta.env.BASE_URL}sounds/default/${event}.wav`)
    return { name: `${event}.wav`, data: new Uint8Array(await r.arrayBuffer()) }
  }))
  const guide = ['Maplecord sound pack', '',
    'Each file is named after the moment it plays. Change any of them (WAV, MP3 or OGG, a few seconds each), keep the',
    'names, zip them again and import the zip in the desktop app (Overlay settings, Import a pack). A pack does not need',
    'every file: the built-in sound plays for any it leaves out.', '',
    ...SOUND_EVENTS.map(e => `${e}  -  ${SOUND_LABELS[e]}`)].join('\r\n')
  return makeZip([...files, { name: 'README.txt', data: new TextEncoder().encode(guide) }])
}
