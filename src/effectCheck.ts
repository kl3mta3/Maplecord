import { MIDDLE, effectProblem, type EffectSample } from './effectRules'

/**
 * Looks at an animation before it is uploaded as a profile effect: draws it, small and off-screen, the way it will
 * sit on a profile card, and measures how much of the card it covers (the rules are in effectRules.ts). An effect
 * plays in front of the profile, so one with a background, or one that fills the card, would hide whoever wears it.
 *
 * The app does this, not the server: the server reads what an animation is made of, and would have to draw it to
 * know what it covers. A file this cannot read or draw is passed on as it is, and the server says what is wrong.
 */

// The shape of a profile card (300 × 420), at half its size: small things still show, and a look takes under a millisecond.
const WIDTH = 150, HEIGHT = 210
const LOOKS_A_SECOND = 10
const MOST_LOOKS = 300
/** Opacity (of 255) from which a spot counts as hidden, and from which it counts as painted on at all. */
const HIDDEN = 128, PAINTED = 24
const MOST_UNPACKED = 4 * 1024 * 1024
// The protected middle is looked at in spots this many pixels across (twice that on a real card).
const SPOT = 10
const MIDDLE_LEFT = Math.round(MIDDLE.left * WIDTH), MIDDLE_TOP = Math.round(MIDDLE.top * HEIGHT)
const SPOTS_ACROSS = Math.floor((Math.round(MIDDLE.right * WIDTH) - MIDDLE_LEFT) / SPOT)
const SPOTS_DOWN = Math.floor((Math.round(MIDDLE.bottom * HEIGHT) - MIDDLE_TOP) / SPOT)

type Animation = { fr: number; ip: number; op: number; layers: unknown[] } & Record<string, unknown>

const isAnimation = (value: unknown): value is Animation => {
  const a = value as Animation | null
  return !!a && typeof a === 'object' && typeof a.fr === 'number' && typeof a.ip === 'number' && typeof a.op === 'number' && Array.isArray(a.layers)
}

/** One file out of a zip (which is what a .lottie file is), unpacked, or null if it is not there or cannot be. */
async function fromZip(bytes: Uint8Array, pick: (names: string[]) => string | null): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The list of what is inside is at the end of the file.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) return null
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const inside = new Map<string, { method: number; packed: number; size: number; header: number }>()
  for (let i = 0; i < count && i < 64; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null
    const nameLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    inside.set(name, { method: view.getUint16(at + 10, true), packed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true), header: view.getUint32(at + 42, true) })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  const name = pick([...inside.keys()])
  const entry = name === null ? undefined : inside.get(name)
  if (!entry || entry.size > MOST_UNPACKED || entry.header + 30 > bytes.length || view.getUint32(entry.header, true) !== 0x04034b50) return null
  const start = entry.header + 30 + view.getUint16(entry.header + 26, true) + view.getUint16(entry.header + 28, true)
  const packed = bytes.subarray(start, start + entry.packed)
  if (entry.method === 0) return packed
  if (entry.method !== 8 || typeof DecompressionStream !== 'function') return null
  const unpacked = new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(unpacked).arrayBuffer())
}

const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes))

/** The animation in a file someone picked: a .json one as it is, or the one a .lottie file names first, as the server takes it. */
export async function animationIn(file: Blob): Promise<Animation | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const packed = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
    if (!packed) { const plain = parse(bytes); return isAnimation(plain) ? plain : null }
    let first: string | null = null
    try {
      const list = await fromZip(bytes, names => (names.includes('manifest.json') ? 'manifest.json' : null))
      const id = list ? (parse(list) as { animations?: { id?: unknown }[] }).animations?.[0]?.id : null
      if (typeof id === 'string') first = id
    } catch { /* a list that cannot be read: the first animation there is */ }
    const json = await fromZip(bytes, names => {
      const named = first === null ? undefined : [`animations/${first}.json`, `a/${first}.json`].find(n => names.includes(n))
      return named ?? names.filter(n => (n.startsWith('animations/') || n.startsWith('a/')) && n.endsWith('.json')).sort()[0] ?? null
    })
    const inside = json ? parse(json) : null
    return isAnimation(inside) ? inside : null
  } catch { return null }
}

/** Draws the animation over a card ten times a second of its length, and says what it covered each time. */
export async function measureEffect(animation: Animation): Promise<{ samples: EffectSample[]; secondsApart: number } | null> {
  const frames = animation.op - animation.ip
  if (!(animation.fr > 0) || !(frames > 0)) return null
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH; canvas.height = HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  // The drawing kind of the player, fetched only now: profiles themselves are shown with the lighter one.
  const { default: lottie } = await import('lottie-web/build/player/lottie_light_canvas')
  const player = lottie.loadAnimation({
    renderer: 'canvas', loop: false, autoplay: false, animationData: structuredClone(animation),
    // An effect fills the card and is cropped to it, whatever its own shape.
    rendererSettings: { context, clearCanvas: true, preserveAspectRatio: 'xMidYMid slice', dpr: 1 },
  } as unknown as Parameters<typeof lottie.loadAnimation>[0])
  try {
    if (!player.isLoaded) await new Promise<void>((resolve, reject) => {
      const giveUp = setTimeout(() => reject(new Error('the animation did not load')), 3000)
      player.addEventListener('DOMLoaded', () => { clearTimeout(giveUp); resolve() })
    })
    const looks = Math.min(MOST_LOOKS, Math.max(1, Math.ceil(frames / animation.fr * LOOKS_A_SECOND)))
    const samples: EffectSample[] = []
    const spots = WIDTH * HEIGHT
    for (let i = 0; i < looks; i++) {
      player.goToAndStop(frames * i / looks, true)
      const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data
      let hidden = 0, painted = 0
      for (let p = 3; p < pixels.length; p += 4) { const opacity = pixels[p]!; if (opacity >= PAINTED) { painted++; if (opacity >= HIDDEN) hidden++ } }
      // The middle, spot by spot: a spot is hidden when more than half of it is.
      const middle: boolean[] = []
      for (let row = 0; row < SPOTS_DOWN; row++) for (let column = 0; column < SPOTS_ACROSS; column++) {
        let covered = 0
        for (let y = 0; y < SPOT; y++) for (let x = 0; x < SPOT; x++)
          if (pixels[((MIDDLE_TOP + row * SPOT + y) * WIDTH + MIDDLE_LEFT + column * SPOT + x) * 4 + 3]! >= HIDDEN) covered++
        middle.push(covered * 2 > SPOT * SPOT)
      }
      samples.push({ hidden: hidden / spots, painted: painted / spots, middle })
    }
    return { samples, secondsApart: frames / animation.fr / looks }
  } finally { player.destroy() }
}

/** Why the file someone picked cannot be their profile effect because of what it covers, or null. */
export async function effectFileProblem(file: Blob): Promise<string | null> {
  try {
    const animation = await animationIn(file)
    const measured = animation ? await measureEffect(animation) : null
    return measured ? effectProblem(measured.samples, measured.secondsApart) : null
  } catch { return null }
}
