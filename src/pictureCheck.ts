import { explicitness, looksExplicit, SEND_REFUSE_AT, type PictureGuess } from './pictureRule'
import { guessPicture } from './pictureModel'

/**
 * Looks at a picture on this device before it is shown, to blur it if it may be explicit (see pictureRule.ts).
 * The model (NSFWJS's MobileNetV2, about 3.5 MB) and TensorFlow.js come with the app and are only loaded the first
 * time a picture is checked, in a worker of their own so the app is never held up (see pictureModel.ts); nothing is
 * fetched from anywhere else, and the picture is not sent anywhere.
 *
 * Pictures are checked one at a time, from their bytes (fetched from where the picture is shown from, as saving one
 * is), shrunk to the model's size first. A moving picture is judged by its worst frame of up to eight spread through it (see pictureModel.ts). Each answer is kept for as
 * long as the app is open. A picture that cannot be checked (the model would not load, or the picture would not
 * read) is "unknown", and shown.
 */
export type Verdict = 'ok' | 'explicit' | 'unknown'

let on = true
/** Whether pictures are checked: the person's setting, kept here by the app as it draws (see Shell). */
export function setPictureCheckOn(value: boolean) { on = value }
export const pictureCheckOn = () => on

const answers = new Map<string, Promise<Verdict>>()
let queue: Promise<unknown> = Promise.resolve()

// The worker the model runs in, started the first time it is needed. If it cannot be started (or stops), the model
// runs here in the window instead: slower to start, but the check still works.
let worker: Promise<Worker | null> | null = null
let asked = 0
const waiting = new Map<number, (guesses: PictureGuess[][] | null) => void>()
function startWorker() {
  worker ??= import('./pictureWorker?worker').then(({ default: PictureWorker }) => {
    const w = new PictureWorker()
    w.onmessage = (e: MessageEvent<{ id: number; guesses: PictureGuess[][] | null }>) => { waiting.get(e.data.id)?.(e.data.guesses); waiting.delete(e.data.id) }
    w.onerror = e => {
      console.warn('The picture check\'s worker stopped; pictures are checked in the window instead.', e.message)
      worker = Promise.resolve(null)
      for (const [, answer] of waiting) answer(null)
      waiting.clear()
    }
    return w
  }).catch(e => { console.warn('The picture check\'s worker could not start; pictures are checked in the window instead.', e); return null })
  return worker
}

/** What the model says of each frame looked at (one for a still picture); null if the check cannot run or the picture cannot be read. */
async function guess(picture: Blob): Promise<PictureGuess[][] | null> {
  const w = await startWorker()
  if (!w) return guessPicture(picture)
  const id = ++asked
  return new Promise(resolve => { waiting.set(id, resolve); w.postMessage({ id, picture }) })
}

async function judge(src: string): Promise<Verdict> {
  try {
    const reply = await fetch(src)
    if (!reply.ok) return 'unknown'
    const guesses = await guess(await reply.blob())
    // A moving picture is as bad as its worst frame.
    return guesses === null ? 'unknown' : guesses.some(looksExplicit) ? 'explicit' : 'ok'
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
  if (guesses && Math.max(...guesses.map(explicitness)) >= SEND_REFUSE_AT) throw new Error(`This picture looks explicit, so it can't be used ${place}.`)
}

/**
 * Gets the check ready in the background: called a little after the app opens, so it is ready before the first
 * picture. It loads the model (about 4.6 MB with what runs it, from the app itself) and does nothing more.
 */
export function readyPictureCheck() {
  if (!on) return
  void startWorker().then(w => { if (w) { const id = ++asked; waiting.set(id, () => {}); w.postMessage({ id }) } })
}

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
