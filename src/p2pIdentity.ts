/**
 * What this app keeps on this device for P2P text channels: its own signing key, and the history of the P2P channels
 * it has been in.
 *
 * The key: every message sent in a P2P channel is signed by its author's app. The private half never leaves this
 * device (it cannot even be read back out of the browser's key store); the public half is registered with the
 * server, which tells everyone else's app whose it is.
 *
 * The history: the server keeps nothing said in a P2P channel, so each person's app keeps its own copy. It is
 * encrypted on disk with a second key that also never leaves this device. Files sent in a P2P channel are kept the
 * same way, beside the messages they came with. In a browser this lives in the site's own
 * storage, which the browser may clear; the desktop app's does not get cleared that way.
 */

const DB = 'maplecord-p2p'
const KEYS = 'keys'
const MESSAGES = 'messages'
const FILES = 'files'

let opened: Promise<IDBDatabase> | null = null

/** This device's P2P storage, opened once and kept open. */
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS)
      if (!db.objectStoreNames.contains(MESSAGES)) {
        const store = db.createObjectStore(MESSAGES, { keyPath: ['channelId', 'id'] })
        store.createIndex('byChannel', ['channelId', 'at'])
      }
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: ['channelId', 'hash'] })
    }
    request.onsuccess = () => {
      const db = request.result
      // Another window of the app wants to change the storage's layout, or it was closed under us: let go, and open afresh next time.
      db.onversionchange = () => { db.close(); opened = null }
      db.onclose = () => { opened = null }
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('This device would not open its P2P storage.'))
    request.onblocked = () => reject(new Error('Close the other Maplecord windows in this browser, then try again.'))
  })
  opened.catch(() => { opened = null })
  return opened
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
const unb64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))
const utf8 = (text: string) => new TextEncoder().encode(text)

interface Stored { signing: CryptoKeyPair; storage: CryptoKey; publicKey: string }

/** This app's own keys, made the first time they are needed. */
export interface P2PIdentity {
  /** The public half of the signing key, as registered with the server. */
  publicKey: string
  sign(text: string): Promise<string>
  /** The key this device encrypts its P2P history with. */
  storage: CryptoKey
}

let identity: Promise<P2PIdentity> | null = null

/** Whether this app can do P2P text at all: it needs the browser's cryptography and its database. */
export const p2pTextSupported = () => typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle

export function loadIdentity(): Promise<P2PIdentity> {
  identity ??= (async () => {
    const db = await open()
    let stored = await done(db.transaction(KEYS).objectStore(KEYS).get('identity')) as Stored | undefined
    if (!stored) {
      // Neither private key can be exported: they can be used here, and nowhere else.
      const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
      const storage = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      stored = { signing, storage, publicKey: b64(await crypto.subtle.exportKey('spki', signing.publicKey)) }
      await done(db.transaction(KEYS, 'readwrite').objectStore(KEYS).put(stored, 'identity'))
    }
    const mine = stored
    return {
      publicKey: mine.publicKey,
      storage: mine.storage,
      sign: async text => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mine.signing.privateKey, utf8(text))),
    }
  })()
  identity.catch(() => { identity = null })
  return identity
}

/** Whether `signature` over `text` was made with the private half of `publicKey`. Anything malformed is simply "no". */
export async function verifySignature(publicKey: string, text: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', unb64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), utf8(text))
  } catch { return false }
}

// ---- History on this device -----------------------------------------------------------------------------------------

interface Row { channelId: string; id: string; at: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

/** Keeps one entry of a P2P channel's history. `entry` can be anything that survives JSON; it is encrypted before it is written. */
export async function keep(channelId: string, id: string, at: string, entry: unknown): Promise<void> {
  const me = await loadIdentity()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, me.storage, utf8(JSON.stringify(entry)))
  const db = await open()
  await done(db.transaction(MESSAGES, 'readwrite').objectStore(MESSAGES).put({ channelId, id, at, iv, data } satisfies Row))
}

/** The newest `limit` entries kept for a channel, oldest first. An entry this device can no longer read is skipped. */
export function kept<T>(channelId: string, limit = 300): Promise<T[]> { return keptBefore<T>(channelId, '￿', limit) }

/** The newest `limit` entries kept for a channel from before a moment (an ISO time), oldest first. */
export async function keptBefore<T>(channelId: string, before: string, limit = 300): Promise<T[]> {
  const me = await loadIdentity()
  const db = await open()
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const found: Row[] = []
    const range = IDBKeyRange.bound([channelId, ''], [channelId, before], false, true)
    const cursor = db.transaction(MESSAGES).objectStore(MESSAGES).index('byChannel').openCursor(range, 'prev')
    cursor.onsuccess = () => {
      const at = cursor.result
      if (!at || found.length >= limit) { resolve(found.reverse()); return }
      found.push(at.value as Row)
      at.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })
  const entries: T[] = []
  for (const row of rows) {
    try { entries.push(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, me.storage, row.data))) as T) }
    catch { /* written with a key this device no longer has */ }
  }
  return entries
}

/** Which of these ids this device has an entry for in a channel (a message, or the note that one was removed), however old. */
export async function holds(channelId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const db = await open()
  const store = db.transaction(MESSAGES).objectStore(MESSAGES)
  const found = await Promise.all(ids.map(id => done(store.getKey([channelId, id]))))
  return new Set(ids.filter((_, i) => found[i] !== undefined))
}

/** Removes one entry from this device's copy. Nobody else's copy is touched. */
export async function forget(channelId: string, id: string): Promise<void> {
  const db = await open()
  await done(db.transaction(MESSAGES, 'readwrite').objectStore(MESSAGES).delete([channelId, id]))
}

// ---- Files on this device -------------------------------------------------------------------------------------------

/** What a file is known by everywhere: the SHA-256 of its contents, in hex. Two copies with the same hash are the same file. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
}

interface FileRow { channelId: string; hash: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

/** Keeps a file that was sent in a P2P channel, encrypted like the messages. */
export async function keepFile(channelId: string, hash: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const me = await loadIdentity()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, me.storage, bytes)
  const db = await open()
  await done(db.transaction(FILES, 'readwrite').objectStore(FILES).put({ channelId, hash, iv, data } satisfies FileRow))
}

/** A file this device kept for a channel, or null if it has none by that hash (or can no longer read it). */
export async function keptFile(channelId: string, hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const me = await loadIdentity()
  const db = await open()
  const row = await done(db.transaction(FILES).objectStore(FILES).get([channelId, hash])) as FileRow | undefined
  if (!row) return null
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, me.storage, row.data)) }
  catch { return null }
}

export async function forgetFile(channelId: string, hash: string): Promise<void> {
  const db = await open()
  await done(db.transaction(FILES, 'readwrite').objectStore(FILES).delete([channelId, hash]))
}

// ---- Sealing set-up messages ----------------------------------------------------------------------------------------
// To connect, two apps pass a few set-up messages through the server, and those carry the addresses the apps can be
// reached at. They are encrypted between the two apps so that the server only carries them. Each app makes a
// one-off key pair when it starts, signs the public half with its registered signing key, and hands that to the
// others through the server's introduction; two apps then arrive at the same secret key without it ever travelling.
// The server cannot swap in a key of its own without also faking the signature, which needs a signing key it would
// have to vouch for; see the note on apps not seen before (knownKeys below) for what guards that.

const SEAL = 'maplecord-seal\n'

export interface Sealer {
  /** This app's one-off public key. */
  publicKey: string
  /** What is handed to the other apps: the public key and its signature. */
  hello: string
  /** The key shared with one other app, or null if what it handed over is not properly signed by its registered key. */
  keyWith(theirHello: string, theirSigningKey: string, channelId: string): Promise<{ key: CryptoKey; theirs: string } | null>
}

export async function makeSealer(sign: (text: string) => Promise<string>): Promise<Sealer> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const publicKey = b64(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    publicKey,
    hello: `${publicKey}.${await sign(SEAL + publicKey)}`,
    keyWith: async (theirHello, theirSigningKey, channelId) => {
      const [theirs, signature] = theirHello.split('.')
      if (!theirs || !signature || theirs === publicKey || !await verifySignature(theirSigningKey, SEAL + theirs, signature)) return null
      try {
        const their = await crypto.subtle.importKey('raw', unb64(theirs), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
        const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: their }, pair.privateKey, 256)
        const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
        // Tied to this channel and to this pair of apps, whichever of the two works it out.
        const info = utf8('maplecord-seal ' + [publicKey, theirs].sort().join(' '))
        const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(channelId), info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        return { key, theirs }
      } catch { return null }
    },
  }
}

/** Encrypts one set-up message. `about` (what kind it is, and who it is from) is not secret but cannot be changed without breaking it. */
export async function seal(key: CryptoKey, text: string, about: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(about) }, key, utf8(text)))
  const all = new Uint8Array(iv.byteLength + data.byteLength)
  all.set(iv); all.set(data, iv.byteLength)
  return b64(all)
}

/** The message inside, or null if it was not sealed with this key for exactly this purpose. */
export async function unseal(key: CryptoKey, sealed: string, about: string): Promise<string | null> {
  try {
    const all = unb64(sealed)
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: utf8(about) }, key, all.slice(12)))
  } catch { return null }
}

// ---- The apps this device has seen people use ------------------------------------------------------------------------
// The server says which signing key belongs to whom. So that it has to say the same thing every time, this device
// remembers the keys it has seen each person use. Someone turning up with one it has not seen is either on a new
// device or browser, or not who the server says: the app points it out and the person decides.

/** A short print of a signing key, for remembering it by. */
export async function keyPrint(publicKey: string): Promise<string> {
  return (await sha256Hex(utf8(publicKey))).slice(0, 32)
}

const knownAt = (account: string, userId: string) => `known|${account}|${userId}`

export async function knownKeys(account: string, userId: string): Promise<string[]> {
  const db = await open()
  return (await done(db.transaction(KEYS).objectStore(KEYS).get(knownAt(account, userId))) as string[] | undefined) ?? []
}

export async function rememberKey(account: string, userId: string, print: string): Promise<void> {
  const db = await open()
  const store = db.transaction(KEYS, 'readwrite').objectStore(KEYS)
  const known = (await done(store.get(knownAt(account, userId))) as string[] | undefined) ?? []
  if (!known.includes(print)) await done(store.put([...known, print].slice(-40), knownAt(account, userId)))
}
