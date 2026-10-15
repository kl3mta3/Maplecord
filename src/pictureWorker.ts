// The picture check's model, in a worker of its own (see pictureModel.ts and pictureCheck.ts): loading it takes
// seconds, and here that never holds the app up. It is sent a picture's bytes with a number, and answers with that
// number and what the model said (null if the picture could not be checked). Sent no picture, it only gets ready.
import { guessPicture, loadModel } from './pictureModel'

self.onmessage = async (e: MessageEvent<{ id: number; picture?: Blob }>) => {
  const { id, picture } = e.data
  if (!picture) { await loadModel(); self.postMessage({ id, guesses: null }); return }
  self.postMessage({ id, guesses: await guessPicture(picture) })
}
