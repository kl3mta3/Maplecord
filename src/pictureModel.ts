import type { PictureGuess } from './pictureRule'

/**
 * The model the picture check uses (NSFWJS's MobileNetV2, about 3.5 MB, with TensorFlow.js): loaded once, then given
 * pictures. It runs in a worker of its own (pictureWorker.ts), so loading it, which takes seconds, never holds the
 * app up; pictureCheck.ts runs it here in the window only if a worker cannot be started.
 */
interface Model { classify(img: unknown): Promise<PictureGuess[]> }
type Tf = typeof import('@tensorflow/tfjs')

const SIZE = 224
let loading: Promise<{ tf: Tf; model: Model } | null> | null = null

/** Loads the model the first time it is asked for; null if it cannot start. */
export function loadModel() {
  loading ??= (async () => {
    try {
      const [tf, core, mobilenet] = await Promise.all([import('@tensorflow/tfjs'), import('nsfwjs/core'), import('nsfwjs/models/mobilenet_v2')])
      // The graphics card where there is one; otherwise the processor, which is slower but works anywhere.
      try { if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu') } catch { await tf.setBackend('cpu') }
      await tf.ready()
      tf.enableProdMode()
      const model = await core.load('MobileNetV2', { modelDefinitions: [mobilenet.MobileNetV2Model] }) as unknown as Model
      // The first picture through the model takes longer (the graphics card has its programs built then); a blank
      // one takes that time here instead, so the first real picture is not held blurred while it happens.
      const blank = tf.zeros([SIZE, SIZE, 3], 'int32') as import('@tensorflow/tfjs').Tensor3D
      try { await model.classify(blank) } finally { blank.dispose() }
      return { tf, model }
    } catch (e) {
      console.warn('The picture check could not start; pictures are shown without it.', e)
      return null
    }
  })()
  return loading
}

/** Frames of a moving picture looked at: the first, the last, and others spread evenly between. */
export const FRAMES_LOOKED = 8

/** What kind of picture the bytes are, for one that can move (GIF, WebP, PNG); null for any other. */
async function movingKind(picture: Blob): Promise<string | null> {
  const head = new Uint8Array(await picture.slice(0, 12).arrayBuffer())
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  if (text(0, 4) === 'GIF8') return 'image/gif'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  if (head[0] === 0x89 && text(1, 4) === 'PNG') return 'image/png'
  return null
}

/**
 * The frames of a picture to look at, shrunk to the model's size: one for a still picture; for a moving one, up to
 * FRAMES_LOOKED spread through it, so that a harmless first frame hides nothing. Where the browser cannot take a moving
 * picture apart (no ImageDecoder), only its first frame.
 */
async function framesOf(picture: Blob): Promise<ImageBitmap[]> {
  const shrink = (from: ImageBitmapSource) => createImageBitmap(from, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'medium' })
  const kind = await movingKind(picture)
  if (kind && typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported(kind).catch(() => false)) {
    const decoder = new ImageDecoder({ data: await picture.arrayBuffer(), type: kind })
    try {
      await decoder.tracks.ready
      await decoder.completed
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1
      if (count > 1) {
        const looked = Math.min(FRAMES_LOOKED, count)
        const which = [...new Set(Array.from({ length: looked }, (_, i) => Math.round(i * (count - 1) / (looked - 1))))]
        const frames: ImageBitmap[] = []
        for (const frameIndex of which) {
          const { image } = await decoder.decode({ frameIndex })
          try { frames.push(await shrink(image)) } finally { image.close() }
        }
        return frames
      }
    } finally { decoder.close() }
  }
  return [await shrink(picture)]
}

/**
 * What the model says of a picture's bytes, for each frame looked at (one for a still picture); null if the check
 * cannot run or the picture cannot be read. Each frame's pixels are read from a canvas off screen, which works in a
 * worker as in a window.
 */
export async function guessPicture(picture: Blob): Promise<PictureGuess[][] | null> {
  const ready = await loadModel()
  if (!ready) return null
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE)
    const context = canvas.getContext('2d')
    if (!context) return null
    const answers: PictureGuess[][] = []
    for (const bitmap of await framesOf(picture)) {
      context.clearRect(0, 0, SIZE, SIZE)
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pixels = ready.tf.browser.fromPixels(context.getImageData(0, 0, SIZE, SIZE))
      try { answers.push(await ready.model.classify(pixels)) }
      finally { pixels.dispose() }
    }
    return answers
  } catch (e) {
    console.warn('A picture could not be checked; it is shown.', e)
    return null
  }
}
