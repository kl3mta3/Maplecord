import { explicitness, looksExplicit, SEND_REFUSE_AT, type PictureGuess } from './pictureRule'

/**
 * Looks at a picture on this device before it is shown, to blur it if it may be explicit (see pictureRule.ts).
 * The model (NSFWJS's MobileNetV2, about 3.5 MB) and TensorFlow.js come with the app and are only loaded the first
 * time a picture is checked; nothing is fetched from anywhere else, and the picture is not sent anywhere.
 *
 * Pictures are checked one at a time, from their bytes (fetched from where the picture is shown from, as saving one
 * is), shrunk to the model's size first. A moving picture is judged by its first frame. Each answer is kept for as
 * long as the app is open. A picture that cannot be checked (the model would not load, or the picture would not
 * read) is "unknown", and shown.
 */
export type Verdict = 'ok' | 'explicit' | 'unknown'

let on = true
/** Whether pictures are checked: the person's setting, kept here by the app as it draws (see Shell). */
export function setPictureCheckOn(value: boolean) { on = value }
export const pictureCheckOn = () => on

interface Model { classify(img: unknown): Promise<PictureGuess[]> }
type Tf = typeof import('@tensorflow/tfjs')

let loading: Promise<{ tf: Tf; model: Model } | null> | null = null
const answers = new Map<string, Promise<Verdict>>()
let queue: Promise<unknown> = Promise.resolve()
const SIZE = 224

function load() {
  loading ??= (async () => {
    try {
      const [tf, core, mobilenet] = await Promise.all([import('@tensorflow/tfjs'), import('nsfwjs/core'), import('nsfwjs/models/mobilenet_v2')])
      // The graphics card where there is one; otherwise the processor, which is slower but works anywhere.
      try { if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu') } catch { await tf.setBackend('cpu') }
      await tf.ready()
      tf.enableProdMode()
      const model = await core.load('MobileNetV2', { modelDefinitions: [mobilenet.MobileNetV2Model] }) as unknown as Model
      // The first picture through the model takes seconds (the graphics card has its programs built then); a blank
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

/** What the model says of a picture's bytes; null if the check cannot run or the picture cannot be read. */
async function guess(picture: Blob): Promise<PictureGuess[] | null> {
  const ready = await load()
  if (!ready) return null
  try {
    const bitmap = await createImageBitmap(picture, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'medium' })
    const pixels = ready.tf.browser.fromPixels(bitmap)
    bitmap.close()
    try { return await ready.model.classify(pixels) }
    finally { pixels.dispose() }
  } catch (e) {
    console.warn('A picture could not be checked; it is shown.', e)
    return null
  }
}

async function judge(src: string): Promise<Verdict> {
  try {
    const reply = await fetch(src)
    if (!reply.ok) return 'unknown'
    const guesses = await guess(await reply.blob())
    return guesses === null ? 'unknown' : looksExplicit(guesses) ? 'explicit' : 'ok'
  } catch (e) {
    console.warn('A picture could not be fetched to be checked; it is shown.', e)
    return 'unknown'
  }
}

/**
 * Before a picture goes somewhere public: checked here first, so one that is plainly explicit is not sent at all.
 * Throws with the reason. `place` finishes "can't be used …", as in "in a public server". Not a picture, or one this
 * cannot read: left to the server, which checks everything it is sent anyway.
 */
export async function checkBeforeSending(file: Blob, place: string): Promise<void> {
  if (file.type && !file.type.startsWith('image/')) return
  const answer = queue.then(() => guess(file))
  queue = answer.catch(() => null)
  const guesses = await answer
  if (guesses && explicitness(guesses) >= SEND_REFUSE_AT) throw new Error(`This picture looks explicit, so it can't be used ${place}.`)
}

/**
 * Gets the check ready in the background: called a little after the app opens, so it is ready before the first
 * picture. It loads the model (about 4.6 MB with what runs it, from the app itself) and does nothing more.
 */
export function readyPictureCheck() { if (on) void load() }

/** What the check makes of a picture. `key` names the picture when its address changes over time (a signed link). */
export function checkPicture(src: string, key = src.split('?')[0]): Promise<Verdict> {
  let answer = answers.get(key)
  if (!answer) {
    answer = queue.then(() => judge(src))
    queue = answer.catch(() => null)
    answers.set(key, answer)
  }
  return answer
}
