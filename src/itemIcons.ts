/** Server-relative path of an item icon held by the Maplecord server (see ItemIconEndpoints.cs). */
const SERVER_ICON = /^\/api\/item-icons\/[0-9a-f]{64}\.png$/

/**
 * URL for an icon a roll carries, or null. Only paths on the Maplecord server are accepted, so a roll can never make
 * this client load a picture from somewhere else.
 */
export const serverIconUrl = (serverUrl: string, iconUrl: string | null | undefined) =>
  iconUrl && SERVER_ICON.test(iconUrl) ? serverUrl.replace(/\/$/, '') + iconUrl : null

/** Server-relative path of a picture the server copied from a webhook or bot message (see MediaProxy.cs). */
const SERVER_MEDIA = /^\/api\/media\/[0-9a-f]{64}\.(png|jpg|gif|webp)$/

/**
 * URL for a picture in a webhook or bot embed, or null. The server replaces whatever URL the sender gave with a copy
 * it holds; anything else is refused here too, because loading it would tell the sender's host who is reading.
 */
export const serverMediaUrl = (serverUrl: string, path: string | null | undefined) =>
  path && SERVER_MEDIA.test(path) ? serverUrl.replace(/\/$/, '') + path : null

const SIZE = 64

/** Draws any plugin icon (png, svg, ...) into a 64x64 PNG: small, one format, and nothing but pixels leaves this machine. */
async function rasterize(url: string): Promise<Blob | null> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE
  const scale = Math.min(SIZE / w, SIZE / h)
  ctx.drawImage(img, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

const shared = new Map<string, Promise<string | null>>()

/**
 * Makes a local plugin icon available to the rest of the party: uploads a small PNG of it (once per session) and
 * returns the server path to put on the roll. Null if anything goes wrong; the roll just has no shared icon then.
 */
export function shareIcon(localUrl: string, upload: (png: Blob) => Promise<{ path: string }>): Promise<string | null> {
  let pending = shared.get(localUrl)
  if (!pending) {
    pending = (async () => {
      try {
        const png = await rasterize(localUrl)
        return png ? (await upload(png)).path : null
      } catch {
        shared.delete(localUrl) // try again next time
        return null
      }
    })()
    shared.set(localUrl, pending)
  }
  return pending
}

/** Never hold a roll up for an icon. */
export const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>(resolve => window.setTimeout(() => resolve(fallback), ms))])
