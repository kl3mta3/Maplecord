// The red dot on the icon beside the clock that says there is something new to read. It is drawn onto the app's own
// picture here, pixel by pixel, so there is no second picture to keep in step with the first.

/** The dot's colour and the dark ring round it that keeps it apart from the picture, as red, green, blue. */
const DOT = [0xff, 0x3b, 0x3b] as const
const RING = [0x14, 0x14, 0x1c] as const

/** Where the dot goes in a picture of a given size: small, in the bottom right corner, with a thin ring round it. */
export function dotPlace(size: number): { centre: number; radius: number; ring: number } {
  const radius = size * 0.17, ring = radius + Math.max(1, size / 20)
  return { centre: size - ring, radius, ring }
}

/**
 * A copy of a square picture with the dot in its bottom right corner. The picture is rows of four bytes a pixel with
 * the opacity last and blue first, which is what Electron hands over and takes back.
 */
export function withDot(pixels: Uint8Array, size: number): Uint8Array {
  if (pixels.length !== size * size * 4) throw new Error('The picture is not the size it was said to be.')
  const out = new Uint8Array(pixels)
  const { centre, radius, ring } = dotPlace(size)
  // How much of a pixel lies inside a circle, from a few points within it: the edge comes out smooth.
  const inside = (x: number, y: number, r: number) => {
    let hits = 0
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const dx = x + (i + 0.5) / 4 - centre, dy = y + (j + 0.5) / 4 - centre
      if (dx * dx + dy * dy <= r * r) hits++
    }
    return hits / 16
  }
  const paint = (at: number, [r, g, b]: readonly [number, number, number], share: number) => {
    if (share <= 0) return
    // What is there already is weighted by how solid it is, as these pictures keep it.
    out[at] = Math.round(b * share + out[at]! * (1 - share))
    out[at + 1] = Math.round(g * share + out[at + 1]! * (1 - share))
    out[at + 2] = Math.round(r * share + out[at + 2]! * (1 - share))
    out[at + 3] = Math.round(255 * share + out[at + 3]! * (1 - share))
  }
  for (let y = Math.max(0, Math.floor(centre - ring)); y < size; y++) for (let x = Math.max(0, Math.floor(centre - ring)); x < size; x++) {
    const at = (y * size + x) * 4
    paint(at, RING, inside(x, y, ring))
    paint(at, DOT, inside(x, y, radius))
  }
  return out
}

/** The sizes the icon is made in, and how dense a screen each is for (16 pixels on an ordinary one). */
export const TRAY_SIZES: readonly { size: number; scaleFactor: number }[] = [
  { size: 16, scaleFactor: 1 }, { size: 20, scaleFactor: 1.25 }, { size: 24, scaleFactor: 1.5 }, { size: 32, scaleFactor: 2 },
]
