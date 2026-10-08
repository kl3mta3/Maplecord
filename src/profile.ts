import type { CSSProperties } from 'react'
import type { MemberDto, UserDto } from './types'

// Name fonts are bundled with the app (open-licensed, via @fontsource) rather than fetched from a font service:
// a request to someone else's server for a font would tell them who is using Maplecord and when.
import '@fontsource/pacifico/latin-400.css'
import '@fontsource/press-start-2p/latin-400.css'
import '@fontsource/orbitron/latin-700.css'
import '@fontsource/cinzel/latin-700.css'
import '@fontsource/bangers/latin-400.css'
import '@fontsource/creepster/latin-400.css'
import '@fontsource/permanent-marker/latin-400.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/vt323/latin-400.css'
import '@fontsource/unifrakturcook/latin-700.css'

/**
 * The fonts a user can pick for their name. Ids are shared with the server (ProfileLimits.Fonts), which refuses
 * anything else. `scale` evens out fonts that run large or small so a styled name sits on the same line as plain text.
 */
export const NAME_FONTS: { id: string; label: string; family: string; weight: number; scale: number }[] = [
  { id: 'pacifico', label: 'Script', family: 'Pacifico', weight: 400, scale: 1.02 },
  { id: 'pixel', label: 'Pixel', family: '"Press Start 2P"', weight: 400, scale: 0.68 },
  { id: 'orbitron', label: 'Sci-fi', family: 'Orbitron', weight: 700, scale: 0.95 },
  { id: 'cinzel', label: 'Fantasy', family: 'Cinzel', weight: 700, scale: 1 },
  { id: 'bangers', label: 'Comic', family: 'Bangers', weight: 400, scale: 1.15 },
  { id: 'creepster', label: 'Spooky', family: 'Creepster', weight: 400, scale: 1.12 },
  { id: 'marker', label: 'Marker', family: '"Permanent Marker"', weight: 400, scale: 1 },
  { id: 'fredoka', label: 'Rounded', family: 'Fredoka', weight: 600, scale: 1.05 },
  { id: 'terminal', label: 'Terminal', family: 'VT323', weight: 400, scale: 1.3 },
  { id: 'blackletter', label: 'Blackletter', family: 'UnifrakturCook', weight: 700, scale: 1.15 },
]

/** How one person appears wherever they are shown. Gathered from members, friends, DMs and yourself. */
export interface Appearance {
  userId: string
  /** The name they registered with; fixed. */
  username: string
  /** The name they chose to be called, if any. */
  displayName: string | null
  avatarUrl: string | null
  nameFont: string | null
  nameColor: string | null
  nameColor2: string | null
  decoration: string | null
}

export const appearanceOfUser = (u: UserDto): Appearance => ({
  userId: u.id, username: u.username, displayName: u.displayName ?? null, avatarUrl: u.avatarUrl ?? null,
  nameFont: u.nameFont ?? null, nameColor: u.nameColor ?? null, nameColor2: u.nameColor2 ?? null, decoration: u.decoration ?? null,
})

export const appearanceOfMember = (m: MemberDto): Appearance => ({
  userId: m.userId, username: m.username, displayName: m.displayName ?? null, avatarUrl: m.avatarUrl ?? null,
  nameFont: m.nameFont ?? null, nameColor: m.nameColor ?? null, nameColor2: m.nameColor2 ?? null, decoration: m.decoration ?? null,
})

/** The name to show for someone: what they chose, or else what they registered with. */
export const shownName = (a: { displayName?: string | null; username: string }) => a.displayName || a.username

const HEX = /^#[0-9a-f]{6}$/i

/**
 * CSS for a name. The font is always the person's own choice. For color, a server's role color wins when there is one
 * (it shows rank there); otherwise their own color, or a gradient if they picked two.
 */
export function nameStyle(a: Pick<Appearance, 'nameFont' | 'nameColor' | 'nameColor2'> | null | undefined, roleColor?: string | null): CSSProperties {
  const style: CSSProperties = {}
  const font = a?.nameFont ? NAME_FONTS.find(f => f.id === a.nameFont) : undefined
  if (font) {
    style.fontFamily = `${font.family}, 'Segoe UI', system-ui, sans-serif`
    style.fontWeight = font.weight
    style.fontSize = font.scale + 'em'
  }
  const first = roleColor ?? (a?.nameColor && HEX.test(a.nameColor) ? a.nameColor : null)
  const second = roleColor ? null : (a?.nameColor2 && HEX.test(a.nameColor2) ? a.nameColor2 : null)
  if (first && second) {
    style.backgroundImage = `linear-gradient(90deg, ${first}, ${second})`
    style.backgroundClip = 'text'
    style.WebkitBackgroundClip = 'text'
    style.color = 'transparent'
  } else if (first) style.color = first
  return style
}

const SERVER_PATH = /^\/api\/[A-Za-z0-9/_.-]+(\?v=\d+)?$/

/**
 * Full URL for a picture path the server gave us (avatar, banner), or null. Only paths on the Maplecord server are
 * accepted, so nothing a user sets can make this client load from another host.
 */
export const assetUrl = (serverUrl: string, path: string | null | undefined) =>
  path && SERVER_PATH.test(path) ? serverUrl.replace(/\/$/, '') + path : null

const DECORATION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** URL of a Lottie decoration by id ("avatar" goes around a picture, "effect" over a profile card), or null. */
export const decorationUrl = (serverUrl: string, kind: 'avatar' | 'effect', id: string | null | undefined) =>
  id && DECORATION_ID.test(id) ? `${serverUrl.replace(/\/$/, '')}/api/decorations/${kind}/${id}.json` : null

/**
 * One of the server's animations can be worn in colors of your own. Its id then says which: the animation's id,
 * "--", and one color for each of its own ("9000ff"), with "x" where one is left as it is.
 */
export function animationColors(id: string | null | undefined): { base: string; colors: (string | null)[] } | null {
  if (!id) return null
  const m = /^(.+?)--((?:[0-9a-f]{6}|x)(?:-(?:[0-9a-f]{6}|x))*)$/.exec(id)
  return m ? { base: m[1]!, colors: m[2]!.split('-').map(c => (c === 'x' ? null : c)) } : { base: id, colors: [] }
}

/** The id of an animation with some of its colors swapped. With none swapped it is just the animation's own id. */
export function withAnimationColors(base: string, colors: (string | null)[]): string {
  const kept = [...colors]
  while (kept.length > 0 && kept[kept.length - 1] === null) kept.pop()
  return kept.length === 0 ? base : base + '--' + kept.map(c => c ?? 'x').join('-')
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}

/**
 * Makes a picture a sensible size before it is uploaded: an avatar becomes a 256x256 square (centre-cropped), a banner
 * 900x300. A phone photo is several megabytes and thousands of pixels across, and an avatar is fetched by everyone who
 * sees it, usually to be drawn 32 pixels wide. Animated GIFs are left alone, since redrawing one would keep only a frame.
 */
export async function shrinkPicture(file: File, kind: 'avatar' | 'banner'): Promise<File> {
  if (file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const [width, height] = kind === 'avatar' ? [256, 256] : [900, 300]
    const scale = Math.max(width / bitmap.width, height / bitmap.height)
    if (scale >= 1) return file // already no bigger than we would make it
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    const sw = width / scale, sh = height / scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9))
    return blob ? new File([blob], kind + '.webp', { type: 'image/webp' }) : file
  } catch {
    return file // not something the browser can draw; let the server decide
  }
}
