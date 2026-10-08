import type { Room, RoomOptions } from 'livekit-client'
import type { SfuPassDto } from './types'

/**
 * Rooms on a stream server, with what is sent into them encrypted by this app.
 *
 * A stream server takes each person's sound or picture once and hands it to everyone else in the room. To do that it
 * has to handle the stream itself, so the ordinary encryption of a connection ends at it. What keeps it from hearing
 * or seeing anything is a second layer underneath: every frame is encrypted here, before it leaves the app, with a
 * key the stream server is never given, and decrypted in the apps that receive it. The key comes from the Maplecord
 * server with the pass to the room (one per voice channel sitting, one per stream).
 *
 * The encrypting runs in a worker of its own, built into the app like everything else: nothing is loaded from
 * anywhere.
 */

/**
 * Whether this browser can encrypt sound and picture itself before sending them. The app says so when it connects for
 * voice; one that cannot is never sent through a stream server.
 */
export const canEncryptMedia = (): boolean =>
  typeof RTCRtpSender !== 'undefined'
  && ('createEncodedStreams' in RTCRtpSender.prototype || typeof (globalThis as { RTCRtpScriptTransform?: unknown }).RTCRtpScriptTransform !== 'undefined')

const workers = new WeakMap<Room, Worker>()

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0))

/**
 * A room ready to connect to, encrypting with the key that came with the pass. `undecryptable` is called if
 * something that arrives cannot be decrypted (which with the right key does not happen).
 */
export async function openRoom(given: RoomOptions, pass: SfuPassDto, undecryptable?: (why: string) => void): Promise<Room> {
  const { Room, RoomEvent, ExternalE2EEKeyProvider } = await import('livekit-client')
  // Left to itself the library disconnects, and stops whatever we were sending (our microphone included), the moment
  // the browser says the page is being hidden. A phone says that whenever its browser goes to the background, where
  // a call is supposed to carry on. A page that is really closed takes its connections with it anyway.
  const options: RoomOptions = { ...given, disconnectOnPageLeave: false }
  // A server from before this was built hands out no key, and its rooms are as they were.
  if (!pass.key) return new Room(options)
  const { default: CryptoWorker } = await import('livekit-client/e2ee-worker?worker')
  const worker = new CryptoWorker()
  try {
    const keys = new ExternalE2EEKeyProvider()
    await keys.setKey(bytesOf(pass.key).buffer)
    const room = new Room({ ...options, encryption: { keyProvider: keys, worker } })
    await room.setE2EEEnabled(true)
    workers.set(room, worker)
    // The worker is ours to end; a room that has disconnected is never used again.
    room.on(RoomEvent.Disconnected, () => { worker.terminate(); workers.delete(room) })
    room.on(RoomEvent.EncryptionError, error => undecryptable?.(error.message))
    return room
  } catch (e) {
    worker.terminate()
    throw e
  }
}

/** Lets go of a room that was made ready and then not wanted (the person left while it was being set up). */
export function letGo(room: Room) {
  void room.disconnect()
  workers.get(room)?.terminate()
  workers.delete(room)
}
