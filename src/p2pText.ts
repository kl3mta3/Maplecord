import { makeSealer, seal, sha256Hex, unseal, verifySignature, type Sealer } from './p2pIdentity'
import { isRelayed } from './transfer'

/**
 * P2P text: what is typed in a P2P channel goes straight from this app to the app of everyone else connected to it,
 * over a connection of its own to each of them. The server introduces the apps to each other (who is there, and the
 * key each signs with) and passes the few set-up messages a connection needs; it never sees a message.
 *
 * Topology, as in voice: the newcomer offers to everyone already there, and those already there only answer.
 *
 * The set-up messages are sealed: encrypted from one app to the other, so the server carries them without being
 * able to read the addresses in them. An app that hands over no properly signed key to seal with is not connected to.
 *
 * Every message is signed by its author's app. A message is only accepted with a signature that checks out against
 * a key the server vouches for as its author's; anything else is dropped without a word.
 *
 * Catching up: nobody but the people in a channel holds its history, so they fill each other in. When two apps
 * connect, each says which messages it holds; each asks the other for the ones it lacks; and an app that is
 * broadcasting hands them over. A message that arrives this way did not come from its author's own app, so it is
 * held to the same test as any other: signed by a key the server says is the author's, by someone who belongs to
 * this server. Whoever passes it on can withhold a message but cannot change one or make one up.
 *
 * Files: a message can carry files. What travels with the message is only each file's name, size, kind and the hash
 * of its contents, all of it signed with the rest. The contents are fetched separately, when wanted, from anyone
 * connected who holds them: the author, or someone who fetched them earlier. Because the hash is signed, it does not
 * matter who hands the contents over; a copy that does not match is thrown away and the next person is asked.
 */

/** Someone connected to a P2P text channel, as the server describes them. */
export interface DirectTextPeer {
  connectionId: string; userId: string; username: string; keyId: string; publicKey: string
  /** Its one-off key for sealing set-up messages, signed with its signing key. */
  seal: string
  /** Said by the server: this is a P2P bot, not a person. */
  bot?: boolean
}

/** A file on a message: what it is called, how big, what kind, and the SHA-256 of its contents. */
export interface P2PFile { hash: string; size: number; type: string; name: string }

/** One message, as it travels and as it is kept: signed over everything but the signature itself. */
export interface P2PMessage {
  id: string; channelId: string; authorId: string; authorName: string; sentAt: string; content: string
  /** The files that came with it, if any. Left out altogether when there are none. */
  files?: P2PFile[]
  /** The author's app key this was signed with, and the signature. */
  keyId: string; signature: string
}

/**
 * Exactly what is signed. Changing any of it afterwards makes the signature wrong. Every part but the last has a
 * fixed shape with no line break in it (see wellFormed), so two different messages never sign to the same text.
 */
export const signedPart = (m: Pick<P2PMessage, 'id' | 'channelId' | 'authorId' | 'sentAt' | 'content' | 'files'>) =>
  [m.id, m.channelId, m.authorId, m.sentAt, JSON.stringify((m.files ?? []).map(f => [f.hash, f.size, f.type, f.name])), m.content].join('\n')

export const MAX_P2P_TEXT = 4000
/** The most one file can be, and how many can go with one message. */
export const MAX_P2P_FILE = 100 * 1024 * 1024
export const MAX_P2P_FILES = 10
/** Pictures that are shown in place. Anything else, whatever it calls itself, is a file to save. */
export const P2P_PICTURE = /^image\/(png|jpeg|gif|webp)$/

const FILE_HASH = /^[0-9a-f]{64}$/
const FILE_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/
/** Nothing that could be read as part of a path, and nothing unprintable. */
// eslint-disable-next-line no-control-regex
const NOT_IN_A_NAME = /[\u0000-\u001f\u007f/\\]/

/** A file as it goes on a message: its name and kind made safe to show and to save under. */
export function describeFile(name: string, type: string, size: number, hash: string): P2PFile {
  const kind = type.toLowerCase().split(';')[0].trim()
  // eslint-disable-next-line no-control-regex
  const shown = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200)
  return { hash, size, type: kind.length <= 100 && FILE_TYPE.test(kind) ? kind : 'application/octet-stream', name: shown || 'file' }
}

const fileOk = (f: P2PFile) => !!f && typeof f === 'object'
  && typeof f.hash === 'string' && FILE_HASH.test(f.hash)
  && Number.isInteger(f.size) && f.size > 0 && f.size <= MAX_P2P_FILE
  && typeof f.type === 'string' && f.type.length <= 100 && FILE_TYPE.test(f.type)
  && typeof f.name === 'string' && f.name.length > 0 && f.name.length <= 200 && !NOT_IN_A_NAME.test(f.name)

/** Why a file could not be fetched: nobody connected holds it, or the only way to them is the relay and it is too big for that. */
export class P2PFileUnavailable extends Error {
  why: 'nobody' | 'relay'
  constructor(why: 'nobody' | 'relay') { super(why === 'relay' ? 'This file is too large to fetch through the relay.' : 'Nobody connected has this file right now.'); this.why = why }
}

/** A file's contents travel on a channel of their own beside the messages, named for the file. */
const FILE_LABEL = /^file:[0-9a-f]{64}$/
const FILE_CHUNK = 60_000
/** How many files one app is served at once, and in all while connected; and how long a transfer may stand still. */
const SERVE_AT_ONCE = 2
const MOST_SERVED = 500
const FILE_IDLE = 20_000

/** An id as the server writes them. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * A message's id starts with its author's id. Since the author's id is signed, nobody can give a message of their
 * own the id of someone else's (to make the real one look already seen, or to write over it on a device).
 */
const MESSAGE_ID = /^[0-9a-f-]{36}:[0-9a-f-]{36}$/i
/** When it was sent, exactly as an app writes it. Anything looser is not read as a date at all. */
const SENT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/** How far ahead of this device's clock a message may say it was sent. Further than that it is not taken. */
const AHEAD = 5 * 60_000

/** How many of the newest messages two apps compare when they connect, and the most handed over in one go. */
const COMPARE = 300
const GIVE_AT_ONCE = 25
/** The most one app will take from another in catch-up while connected: a guard against being flooded. */
const MOST_FROM_ONE = 10_000
/** How much of what one app hands over may be no good (not asked for, not signed right) before nothing more is taken from it. */
const MOST_BAD = 50
/** What one app may send as new messages: so many at once, then so many a second. Nobody types faster. */
const BURST = 30
const PER_SECOND = 3
/** How long an app has to hand over what it was asked for before the next one that has it is asked instead. */
const ASK_WAIT = 30_000
/** How many times a connection that failed is tried again, and how long apart. */
const RETRIES = 3
const RETRY_AFTER = 4000

/** What travels between two apps. A bare message (no `t`) is accepted too. */
type Wire =
  | { t: 'msg'; m: P2PMessage }
  /** "These are the messages I hold" (their ids, newest first). Empty from an app that is not broadcasting. */
  | { t: 'have'; ids: string[] }
  /** "Send me these." */
  | { t: 'want'; ids: string[] }
  /** "Here they are." */
  | { t: 'give'; messages: P2PMessage[] }
  /** "What do you hold from before this moment?" Answered with a `have` of the messages just before it. */
  | { t: 'older'; before: string }

export interface P2PTextDeps {
  join(channelId: string, keyId: string, seal: string): Promise<DirectTextPeer[]>
  /**
   * Whether this app connects to someone the server introduced. People: always. A bot: only one the person has
   * agreed to, since whoever runs it can find the address of everyone who connects to it.
   */
  connectsTo(channelId: string, peer: DirectTextPeer): boolean
  /** Someone is in the channel with us: the moment to notice an app this device has not seen them use before. */
  met(channelId: string, peer: DirectTextPeer): void
  leave(channelId: string): Promise<void>
  signal(channelId: string, target: string, kind: 'offer' | 'answer' | 'ice', payload: string): Promise<void>
  /** The servers to connect with for this channel, and whether to go through the relay only. */
  rtcConfig(channelId: string): Promise<RTCConfiguration>
  /** This app's registered key, and how to sign with it. */
  identity(): Promise<{ keyId: string; sign(text: string): Promise<string> }>
  me(): { id: string; name: string }
  /** A message arrived, checked. `caughtUp` when it was passed on by someone other than its author's app. */
  received(message: P2PMessage, caughtUp: boolean): void
  /** Who we are connected to in a channel changed. */
  changed(channelId: string): void
  /** The messages this device holds for a channel (signed ones only), newest last. */
  held(channelId: string): Promise<P2PMessage[]>
  /** The newest message ids this device has dealt with for a channel: the ones it holds, and the ones removed from it. None of these is asked for again. */
  known(channelId: string): Promise<string[]>
  /** Which of these ids this device has dealt with (holds, or removed), however long ago. Asked before anything is fetched from someone else. */
  holds(channelId: string, ids: string[]): Promise<Set<string>>
  /** The messages this device holds for a channel from before a moment, newest last. */
  heldBefore(channelId: string, before: string, limit: number): Promise<P2PMessage[]>
  /** Whether this app hands other people the messages they missed in this channel. */
  broadcasting(channelId: string): boolean
  /** Whose key this is, as the server vouches. Null when the server no longer knows it. */
  keyOwner(keyId: string): Promise<{ userId: string; publicKey: string } | null>
  /** The name to show for someone who belongs to the channel's server, or null if they do not belong to it. */
  member(channelId: string, userId: string): string | null
  /** The contents of a file this device holds for a channel, or null. */
  file(channelId: string, hash: string): Promise<Uint8Array<ArrayBuffer> | null>
  /** The most a file may be to cross a connection that goes through the relay: the server's own limit for a file. */
  relayedFileLimit(): number
}

interface Peer {
  info: DirectTextPeer; pc: RTCPeerConnection; channel: RTCDataChannel | null; pendingIce: RTCIceCandidateInit[]
  /** Whether the connection is ours to offer (we came after them), and how many times it has been tried again. */
  offerer: boolean; tries: number
  /** How many messages this app has handed us in catch-up, how many of them were no good, and which ones we asked it for. */
  taken: number; bad: number; asked: Set<string>
  /** What it said it holds (null until it has said), how many times it has asked us for messages, and when what we asked of it is given up on. */
  has: string[] | null; wants: number; askTimer: number
  /** Lists of older messages we asked it for and are still owed, and how many requests for messages it may still make of us. */
  expecting: number; wantsLeft: number
  /** The moment it last asked us for messages from before. */
  lastOlder?: string
  /** What it may still send as new messages right now. */
  budget: number; budgetAt: number
  /** Whether the connection to it goes through the relay (null until that is known), and the files it is being, and has been, served. */
  relayed: boolean | null; serving: number; served: number
  /** The file being fetched from it right now, if any: the next one waits for that. */
  fetching: Promise<unknown>
  /** The key set-up messages to and from it are sealed with, and its own one-off public key. Null if it gave none that holds. */
  sealed: Promise<{ key: CryptoKey; theirs: string } | null>
}
interface Room {
  peers: Map<string, Peer>; config: RTCConfiguration; seen: Set<string>; asked: Set<string>
  /** Set-up messages from each app are handled one after another, in the order they came. */
  inbox: Map<string, Promise<void>>
}

export class P2PTextEngine {
  private deps: P2PTextDeps
  private rooms = new Map<string, Room>()

  constructor(deps: P2PTextDeps) { this.deps = deps }

  /** This app's one-off key for sealing set-up messages, made once per run. */
  private sealing: Promise<Sealer> | null = null
  private sealer(): Promise<Sealer> {
    if (!this.sealing) {
      const made = this.deps.identity().then(mine => makeSealer(mine.sign))
      this.sealing = made
      made.catch(() => { if (this.sealing === made) this.sealing = null })
    }
    return this.sealing
  }

  /** Sends one set-up message to one app, sealed. Fails if that app gave no key to seal with. */
  private async tell(channelId: string, peer: Peer, kind: 'offer' | 'answer' | 'ice', payload: string) {
    const [mine, theirs] = [await this.sealer(), await peer.sealed]
    if (!theirs) throw new Error('That app gave no key to seal set-up messages with.')
    await this.deps.signal(channelId, peer.info.connectionId, kind, await seal(theirs.key, payload, `${kind}\n${mine.publicKey}`))
  }

  /** Whether we are connected to this channel at all (even if nobody else is there). */
  isIn(channelId: string) { return this.rooms.has(channelId) }

  joined(): string[] { return [...this.rooms.keys()] }

  /** The people here whose app we can reach right now, by user. One person on two apps is one person. */
  reachable(channelId: string): { userId: string; username: string }[] {
    const room = this.rooms.get(channelId)
    if (!room) return []
    const people = new Map<string, string>()
    for (const p of room.peers.values()) if (p.channel?.readyState === 'open') people.set(p.info.userId, p.info.username)
    return [...people].map(([userId, username]) => ({ userId, username }))
  }

  /** How many others are in the channel, whether or not the connection to them is up yet. */
  present(channelId: string): number {
    return new Set([...(this.rooms.get(channelId)?.peers.values() ?? [])].map(p => p.info.userId)).size
  }

  /** Connect to a channel: ask the server who is there, then offer a connection to each of them. */
  async join(channelId: string) {
    if (this.rooms.has(channelId)) return
    const [mine, config, known] = await Promise.all([this.deps.identity(), this.deps.rtcConfig(channelId), this.deps.known(channelId).catch(() => [])])
    if (this.rooms.has(channelId)) return
    // What we already hold, or removed, is never asked for or shown again.
    const room: Room = { peers: new Map(), config, seen: new Set(known), asked: new Set(), inbox: new Map() }
    this.rooms.set(channelId, room)
    let others: DirectTextPeer[]
    try { others = await this.deps.join(channelId, mine.keyId, (await this.sealer()).hello) }
    catch (e) { if (this.rooms.get(channelId) === room) this.rooms.delete(channelId); throw e }
    if (this.rooms.get(channelId) !== room) return
    for (const other of others) {
      if (!this.deps.connectsTo(channelId, other)) continue
      this.deps.met(channelId, other)
      void this.offer(channelId, room, other)
    }
    this.deps.changed(channelId)
  }

  async leave(channelId: string) {
    const room = this.rooms.get(channelId)
    if (!room) return
    this.rooms.delete(channelId)
    for (const peer of room.peers.values()) { window.clearTimeout(peer.askTimer); this.close(peer) }
    try { await this.deps.leave(channelId) } catch { /* the server already let go of us */ }
    this.deps.changed(channelId)
  }

  /** The server took us out (lost access, P2P switched off), or forgot us across a reconnect: let go without telling it. */
  closed(channelId: string) {
    const room = this.rooms.get(channelId)
    if (!room) return
    this.rooms.delete(channelId)
    for (const peer of room.peers.values()) { window.clearTimeout(peer.askTimer); this.close(peer) }
    this.deps.changed(channelId)
  }

  closedAll() { for (const channelId of [...this.rooms.keys()]) this.closed(channelId) }

  /**
   * The relay's sign-in details run out after a while. Connections already made are not affected, but one made later
   * (to someone who joins in an hour) needs current ones, so they are fetched again from time to time.
   */
  async refresh() {
    for (const [channelId, room] of this.rooms) {
      try { const config = await this.deps.rtcConfig(channelId); if (this.rooms.get(channelId) === room) room.config = config }
      catch { /* the ones we have are used until the next try */ }
    }
  }

  async leaveAll() { for (const channelId of [...this.rooms.keys()]) await this.leave(channelId) }

  /**
   * Signs a message and sends it to everyone we are connected to here. It is returned whether or not anyone was.
   * Files go as their descriptions only; whoever wants the contents fetches them (see fetchFile), so they must
   * already be held on this device.
   */
  async send(channelId: string, content: string, files: P2PFile[] = []): Promise<P2PMessage> {
    const room = this.rooms.get(channelId)
    if (!room) throw new Error('You are not connected to this channel.')
    const text = content.trim()
    if (!text && files.length === 0) throw new Error('Message is empty.')
    if (text.length > MAX_P2P_TEXT) throw new Error('Message is too long.')
    if (files.length > MAX_P2P_FILES || !files.every(fileOk)) throw new Error('Those files cannot be sent.')
    const [mine, me] = [await this.deps.identity(), this.deps.me()]
    const unsigned = { id: `${me.id}:${crypto.randomUUID()}`, channelId, authorId: me.id, authorName: me.name, sentAt: new Date().toISOString(), content: text, ...(files.length > 0 ? { files } : {}) }
    const message: P2PMessage = { ...unsigned, keyId: mine.keyId, signature: await mine.sign(signedPart(unsigned)) }
    room.seen.add(message.id)
    for (const peer of room.peers.values()) this.post(peer, { t: 'msg', m: message })
    return message
  }

  /**
   * Fetches a file's contents from someone connected who holds them: its author first, then anyone else. A copy that
   * does not match the signed hash is thrown away and the next person is asked. Over a connection that goes through
   * the relay only files within the server's own limit are fetched.
   */
  async fetchFile(channelId: string, file: P2PFile, authorId: string, progress: (got: number) => void): Promise<Uint8Array<ArrayBuffer>> {
    const room = this.rooms.get(channelId)
    if (!room) throw new Error('You are not connected to this channel.')
    const open = [...room.peers.values()].filter(p => p.channel?.readyState === 'open')
    let relayOnly = false
    for (const peer of [...open.filter(p => p.info.userId === authorId), ...open.filter(p => p.info.userId !== authorId)]) {
      if (this.rooms.get(channelId) !== room) break
      if (peer.relayed !== false && file.size > this.deps.relayedFileLimit()) { relayOnly = true; continue }
      // One file at a time from each app.
      const turn = peer.fetching.then(() => (room.peers.get(peer.info.connectionId) === peer ? this.fetchFrom(peer, file, progress) : null))
      peer.fetching = turn.catch(() => null)
      const bytes = await turn
      if (bytes) return bytes
    }
    throw new P2PFileUnavailable(relayOnly ? 'relay' : 'nobody')
  }

  /** One attempt, from one app. Null if it does not have the file, stops part way, or hands over something else. */
  private fetchFrom(peer: Peer, file: P2PFile, progress: (got: number) => void): Promise<Uint8Array<ArrayBuffer> | null> {
    return new Promise(resolve => {
      let channel: RTCDataChannel
      try { channel = peer.pc.createDataChannel('file:' + file.hash, { ordered: true }) } catch { resolve(null); return }
      channel.binaryType = 'arraybuffer'
      const parts: Uint8Array<ArrayBuffer>[] = []
      let got = 0, promised = false, over = false, idle = 0
      const finish = (bytes: Uint8Array<ArrayBuffer> | null) => {
        if (over) return
        over = true
        window.clearTimeout(idle)
        try { channel.close() } catch { /* already closed */ }
        resolve(bytes)
      }
      const moving = () => { window.clearTimeout(idle); idle = window.setTimeout(() => finish(null), FILE_IDLE) }
      moving()
      channel.onclose = () => finish(null)
      channel.onerror = () => finish(null)
      channel.onmessage = e => {
        if (over) return
        moving()
        if (typeof e.data === 'string') {
          // First, and only once: "no", or how big what follows is. It has to be the size that was signed.
          let size: unknown = null
          try { size = (JSON.parse(e.data) as { size?: unknown } | null)?.size } catch { /* "no" */ }
          if (promised || size !== file.size) finish(null)
          else promised = true
          return
        }
        if (!promised || !(e.data instanceof ArrayBuffer)) { finish(null); return }
        got += e.data.byteLength
        if (got > file.size) { finish(null); return }
        parts.push(new Uint8Array(e.data))
        progress(got)
        if (got < file.size) return
        // All of it. Nothing more is listened to while it is checked against the hash the author signed.
        window.clearTimeout(idle)
        channel.onclose = null
        channel.onmessage = null
        const all = new Uint8Array(file.size)
        let at = 0
        for (const part of parts) { all.set(part, at); at += part.byteLength }
        void sha256Hex(all).then(hash => finish(hash === file.hash ? all : null), () => finish(null))
      }
    })
  }

  /** Someone connected asked for a file by its hash: hand it over if this device holds it for this channel. */
  private async serve(channelId: string, room: Room, peer: Peer, channel: RTCDataChannel) {
    const here = () => this.rooms.get(channelId) === room && room.peers.get(peer.info.connectionId) === peer && channel.readyState === 'open'
    const no = () => { try { if (channel.readyState === 'open') channel.send('no') } catch { /* gone */ } try { channel.close() } catch { /* gone */ } }
    channel.binaryType = 'arraybuffer'
    if (channel.readyState === 'connecting') await new Promise<void>(resolve => { channel.onopen = () => resolve(); channel.onclose = () => resolve() })
    if (peer.serving >= SERVE_AT_ONCE || peer.served >= MOST_SERVED) { no(); return }
    peer.serving++
    peer.served++
    try {
      const bytes = await this.deps.file(channelId, channel.label.slice(5)).catch(() => null)
      // Through the relay, only what the server would itself take as a file.
      if (!bytes || !here() || (peer.relayed !== false && bytes.byteLength > this.deps.relayedFileLimit())) { no(); return }
      channel.send(JSON.stringify({ size: bytes.byteLength }))
      channel.bufferedAmountLowThreshold = 1024 * 1024
      for (let at = 0; at < bytes.byteLength; at += FILE_CHUNK) {
        // No faster than the connection takes it.
        if (channel.bufferedAmount > 4 * 1024 * 1024) {
          await new Promise<void>(resolve => {
            const go = () => { window.clearTimeout(stuck); channel.onbufferedamountlow = null; resolve() }
            const stuck = window.setTimeout(go, FILE_IDLE)
            channel.onbufferedamountlow = go
          })
          if (channel.bufferedAmount > 4 * 1024 * 1024) { try { channel.close() } catch { /* gone */ } return }
        }
        if (!here()) return
        channel.send(bytes.slice(at, at + FILE_CHUNK))
      }
      // Whoever asked closes it once they have everything; if they never do, we let go after a while.
      await new Promise<void>(resolve => { const late = window.setTimeout(resolve, 60_000); channel.onclose = () => { window.clearTimeout(late); resolve() } })
      try { channel.close() } catch { /* gone */ }
    } catch { try { channel.close() } catch { /* gone */ } }
    finally { peer.serving-- }
  }

  /**
   * Asks everyone connected what they hold from before a moment. Whoever is handing things on answers with a list,
   * and what this device lacks from it is asked for and arrives like any caught-up message. Returns how many were asked.
   */
  askOlder(channelId: string, before: string): number {
    const room = this.rooms.get(channelId)
    if (!room || !SENT_AT.test(before)) return 0
    let asked = 0
    for (const peer of room.peers.values()) {
      if (peer.channel?.readyState !== 'open' || peer.expecting >= 3) continue
      peer.expecting++
      this.post(peer, { t: 'older', before })
      asked++
    }
    return asked
  }

  // ---- What the server tells us ---------------------------------------------------------------------------------------

  /** Someone connected after us: they will offer; we wait. */
  peerJoined(channelId: string, info: DirectTextPeer) {
    const room = this.rooms.get(channelId)
    if (!room || !this.deps.connectsTo(channelId, info)) return
    this.make(channelId, room, info, false)
    this.deps.met(channelId, info)
    this.deps.changed(channelId)
  }

  peerLeft(channelId: string, connectionId: string) {
    const room = this.rooms.get(channelId)
    const peer = room?.peers.get(connectionId)
    if (!room || !peer) return
    room.peers.delete(connectionId)
    room.inbox.delete(connectionId)
    this.release(channelId, room, peer)
    this.close(peer)
    this.deps.changed(channelId)
  }

  /** A set-up message from another app, as the server passed it on. They are taken one at a time per app, in order. */
  signal(channelId: string, from: string, kind: string, payload: string): Promise<void> {
    const room = this.rooms.get(channelId)
    if (!room || !room.peers.has(from)) return Promise.resolve()
    const next = (room.inbox.get(from) ?? Promise.resolve()).then(() => this.setUp(channelId, room, from, kind, payload)).catch(() => {})
    room.inbox.set(from, next)
    return next
  }

  private async setUp(channelId: string, room: Room, from: string, kind: string, sealedPayload: string) {
    let peer = room.peers.get(from)
    if (this.rooms.get(channelId) !== room || !peer) return
    // Sealed by that app, for us, as this kind of message; anything else is not read.
    const theirs = await peer.sealed
    const payload = theirs ? await unseal(theirs.key, sealedPayload, `${kind}\n${theirs.theirs}`) : null
    if (payload === null || this.rooms.get(channelId) !== room || room.peers.get(from) !== peer) return
    try {
      if (kind === 'offer') {
        // A second offer from the same app means its side started the connection over (the first one failed): so do we.
        if (peer.pc.remoteDescription || peer.pc.signalingState !== 'stable') {
          room.peers.delete(from)
          this.release(channelId, room, peer)
          this.close(peer)
          peer = this.make(channelId, room, peer.info, false)
        }
        await peer.pc.setRemoteDescription(JSON.parse(payload))
        for (const candidate of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(candidate)
        await peer.pc.setLocalDescription(await peer.pc.createAnswer())
        await this.tell(channelId, peer, 'answer', JSON.stringify(peer.pc.localDescription))
      } else if (kind === 'answer') {
        await peer.pc.setRemoteDescription(JSON.parse(payload))
        for (const candidate of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(candidate)
      } else if (kind === 'ice') {
        const candidate = JSON.parse(payload) as RTCIceCandidateInit
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate)
        else peer.pendingIce.push(candidate)
      }
    } catch { /* a set-up message we could not use: that connection simply does not come up */ }
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private make(channelId: string, room: Room, info: DirectTextPeer, offerer: boolean, tries = 0): Peer {
    const existing = room.peers.get(info.connectionId)
    if (existing) return existing
    // A bot is reached directly or not at all: the relay is not there to carry what a bot fetches and hands out.
    const pc = new RTCPeerConnection(info.bot ? withoutRelay(room.config) : room.config)
    const peer: Peer = { info, pc, channel: null, pendingIce: [], offerer, tries, taken: 0, bad: 0, asked: new Set(), has: null, wants: 0, askTimer: 0, expecting: 0, wantsLeft: 3, budget: BURST, budgetAt: Date.now(), relayed: null, serving: 0, served: 0, fetching: Promise.resolve(),
      sealed: this.sealer().then(mine => mine.keyWith(info.seal ?? '', info.publicKey, channelId)).catch(() => null) }
    room.peers.set(info.connectionId, peer)
    pc.onicecandidate = e => { if (e.candidate) void this.tell(channelId, peer, 'ice', JSON.stringify(e.candidate.toJSON())).catch(() => {}) }
    // One channel for messages per connection: a second one opened by the other app is not listened to. A channel
    // named for a file is that app asking for the file's contents.
    pc.ondatachannel = e => {
      if (FILE_LABEL.test(e.channel.label)) void this.serve(channelId, room, peer, e.channel)
      else if (peer.channel) { try { e.channel.close() } catch { /* already closed */ } }
      else this.wire(channelId, room, peer, e.channel)
    }
    pc.onconnectionstatechange = () => {
      if (room.peers.get(info.connectionId) !== peer) return
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        const failed = pc.connectionState === 'failed'
        room.peers.delete(info.connectionId)
        this.release(channelId, room, peer)
        this.close(peer)
        if (failed) this.again(channelId, room, peer)
      }
      this.deps.changed(channelId)
    }
    return peer
  }

  /**
   * The connection to someone failed while both of us are still in the channel. Whoever offered it offers again, a few
   * times; the other side stays ready for that offer.
   */
  private again(channelId: string, room: Room, old: Peer) {
    if (!old.offerer) { this.make(channelId, room, old.info, false); return }
    if (old.tries >= RETRIES) return
    window.setTimeout(() => {
      if (this.rooms.get(channelId) !== room || room.peers.has(old.info.connectionId)) return
      void this.offer(channelId, room, old.info, old.tries + 1)
    }, RETRY_AFTER * (old.tries + 1))
  }

  private async offer(channelId: string, room: Room, info: DirectTextPeer, tries = 0) {
    const peer = this.make(channelId, room, info, true, tries)
    try {
      this.wire(channelId, room, peer, peer.pc.createDataChannel('text', { ordered: true }))
      await peer.pc.setLocalDescription(await peer.pc.createOffer())
      await this.tell(channelId, peer, 'offer', JSON.stringify(peer.pc.localDescription))
    } catch { room.peers.delete(info.connectionId); this.close(peer); this.deps.changed(channelId) }
  }

  private wire(channelId: string, room: Room, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel
    const opened = () => {
      // Whether this connection goes through the relay decides how big a file may cross it. Until that is known it is treated as if it does.
      void isRelayed(peer.pc).then(relayed => { peer.relayed = relayed }, () => { peer.relayed = true })
      this.deps.changed(channelId)
      void this.announce(channelId, peer)
    }
    channel.onopen = opened
    channel.onclose = () => this.deps.changed(channelId)
    channel.onmessage = e => { if (typeof e.data === 'string') void this.take(channelId, room, peer, e.data) }
    if (channel.readyState === 'open') opened()
  }

  private post(peer: Peer, wire: Wire) {
    if (peer.channel?.readyState !== 'open') return
    try { peer.channel.send(JSON.stringify(wire)) } catch { /* that connection just went */ }
  }

  /** On connecting: tell the other app which messages we hold, so it can ask for the ones it lacks. Nothing, if we are not broadcasting. */
  private async announce(channelId: string, peer: Peer) {
    const held = this.deps.broadcasting(channelId) ? await this.deps.held(channelId).catch(() => []) : []
    this.post(peer, { t: 'have', ids: held.slice(-COMPARE).reverse().map(m => m.id) })
  }

  /** Something arrived from one app. */
  private async take(channelId: string, room: Room, peer: Peer, text: string) {
    if (text.length > 200_000) return
    let wire: Wire
    try {
      const parsed = JSON.parse(text) as Wire | P2PMessage
      if (!parsed || typeof parsed !== 'object') return
      wire = 't' in parsed ? parsed : { t: 'msg', m: parsed as P2PMessage }
    } catch { return }
    const here = () => this.rooms.get(channelId) === room && room.peers.get(peer.info.connectionId) === peer

    if (wire.t === 'msg') {
      // Straight from its author's own app: it must be theirs, signed with the key the server gave us for that app.
      const m = wire.m
      if (!this.allowed(peer)) return
      if (!wellFormed(m, channelId) || m.authorId !== peer.info.userId || m.keyId !== peer.info.keyId) return
      if (room.seen.has(m.id)) return
      if (!await verifySignature(peer.info.publicKey, signedPart(m), m.signature)) return
      if (!here() || room.seen.has(m.id)) return
      // One this device already dealt with long ago (kept, or removed) is not taken a second time.
      const dealtWith = await this.deps.holds(channelId, [m.id]).then(held => held.has(m.id), () => false)
      if (!here() || room.seen.has(m.id)) return
      room.seen.add(m.id)
      if (dealtWith) return
      // The name shown is the one the server gave for them, not whatever the message claims.
      this.deps.received({ ...clean(m), authorName: peer.info.username }, false)
    } else if (wire.t === 'have') {
      // Said once, when the connection opens, and after that only in answer to our asking for older messages.
      if (!Array.isArray(wire.ids)) return
      if (peer.has !== null) { if (peer.expecting <= 0) return; peer.expecting-- }
      peer.has = wire.ids.filter(id => typeof id === 'string' && MESSAGE_ID.test(id)).slice(0, COMPARE)
      await this.ask(channelId, room, peer)
    } else if (wire.t === 'want') {
      // Asked once for the list we gave, and perhaps again after someone else let them down. Not over and over.
      // As many requests as the lists we have given it, and a couple to spare. Not over and over.
      if (!Array.isArray(wire.ids) || !this.deps.broadcasting(channelId) || peer.wantsLeft-- <= 0) return
      peer.wants++
      const wanted = new Set(wire.ids.filter(id => typeof id === 'string').slice(0, COMPARE))
      // Looked for among the newest first; anything not there is from further back, and is found from its own date.
      let found = (await this.deps.held(channelId).catch(() => [])).filter(m => wanted.has(m.id))
      if (found.length < wanted.size && peer.lastOlder) found = [...found, ...(await this.deps.heldBefore(channelId, peer.lastOlder, COMPARE).catch(() => [])).filter(m => wanted.has(m.id) && !found.some(f => f.id === m.id))]
      for (let i = 0; i < found.length; i += GIVE_AT_ONCE) this.post(peer, { t: 'give', messages: found.slice(i, i + GIVE_AT_ONCE) })
    } else if (wire.t === 'older') {
      // Someone scrolling back: tell them what we hold from before that moment, if we are handing things on.
      if (typeof wire.before !== 'string' || !SENT_AT.test(wire.before) || !this.deps.broadcasting(channelId) || !this.allowed(peer)) return
      const older = await this.deps.heldBefore(channelId, wire.before, COMPARE).catch(() => [])
      if (!here()) return
      peer.lastOlder = wire.before
      peer.wantsLeft = Math.min(peer.wantsLeft + 2, 6)
      this.post(peer, { t: 'have', ids: older.reverse().map(m => m.id) })
    } else if (wire.t === 'give') {
      if (!Array.isArray(wire.messages)) return
      for (const m of wire.messages.slice(0, GIVE_AT_ONCE * 2)) {
        if (peer.taken >= MOST_FROM_ONE || peer.bad >= MOST_BAD) return
        peer.taken++
        // Passed on by someone else: only what we asked this app for, and only if its author's signature holds.
        if (!wellFormed(m, channelId) || !peer.asked.has(m.id)) { peer.bad++; continue }
        if (room.seen.has(m.id)) continue
        const name = this.deps.member(channelId, m.authorId)
        if (name === null) continue
        const owner = await this.deps.keyOwner(m.keyId).catch(() => null)
        if (!owner || owner.userId !== m.authorId || !await verifySignature(owner.publicKey, signedPart(m), m.signature)) { peer.bad++; continue }
        if (!here() || room.seen.has(m.id)) continue
        room.seen.add(m.id)
        this.deps.received({ ...clean(m), authorName: name }, true)
      }
      // Still handing things over: it gets its time again for the rest.
      if (here() && [...peer.asked].some(id => !room.seen.has(id))) this.waitFor(channelId, room, peer)
    }
  }

  /** Whether this app may send another new message right now (see BURST). */
  private allowed(peer: Peer): boolean {
    const now = Date.now()
    peer.budget = Math.min(BURST, peer.budget + (now - peer.budgetAt) / 1000 * PER_SECOND)
    peer.budgetAt = now
    if (peer.budget < 1) return false
    peer.budget -= 1
    return true
  }

  /**
   * Asks one app for whatever it said it holds that this device has not dealt with and nobody else has been asked
   * for. "Dealt with" is checked against what is kept on this device, however old: a message removed here stays
   * removed. If that check cannot be made, nothing is asked for.
   */
  private async ask(channelId: string, room: Room, peer: Peer) {
    const here = () => this.rooms.get(channelId) === room && room.peers.get(peer.info.connectionId) === peer
    const open = () => (peer.has ?? []).filter(id => !room.seen.has(id) && !room.asked.has(id))
    if (open().length === 0) return
    let held: Set<string>
    try { held = await this.deps.holds(channelId, open()) } catch { return }
    if (!here()) return
    for (const id of held) room.seen.add(id)
    const missing = open()
    if (missing.length === 0) return
    for (const id of missing) { room.asked.add(id); peer.asked.add(id) }
    this.post(peer, { t: 'want', ids: missing })
    this.waitFor(channelId, room, peer)
  }

  /** Gives an app so long to hand over what it was asked for. After that it is not asked for those again, and others are. */
  private waitFor(channelId: string, room: Room, peer: Peer) {
    window.clearTimeout(peer.askTimer)
    peer.askTimer = window.setTimeout(() => {
      if (this.rooms.get(channelId) !== room || room.peers.get(peer.info.connectionId) !== peer) return
      const owed = new Set([...peer.asked].filter(id => !room.seen.has(id)))
      if (owed.size === 0) { peer.asked.clear(); return }
      peer.has = (peer.has ?? []).filter(id => !owed.has(id))
      this.release(channelId, room, peer)
    }, ASK_WAIT)
  }

  /** What we asked this app for and never got is asked of the others that said they have it. */
  private release(channelId: string, room: Room, peer: Peer) {
    window.clearTimeout(peer.askTimer)
    let freed = false
    for (const id of peer.asked) if (!room.seen.has(id)) { room.asked.delete(id); freed = true }
    peer.asked.clear()
    if (!freed || this.rooms.get(channelId) !== room) return
    for (const other of room.peers.values()) if (other !== peer) void this.ask(channelId, room, other)
  }

  private close(peer: Peer) {
    try { peer.channel?.close() } catch { /* already closed */ }
    try { peer.pc.close() } catch { /* already closed */ }
  }
}

/**
 * The shape and limits every message has to meet before anything else is looked at: ids that are ids and nothing
 * else (a key's id is used to ask the server whose it is), an id of its own that begins with its author's, a date
 * written the one way apps write it and not from the future, and nothing longer than it can honestly be.
 */
function wellFormed(m: P2PMessage, channelId: string): boolean {
  if (!m || typeof m !== 'object') return false
  if (typeof m.id !== 'string' || typeof m.content !== 'string' || typeof m.sentAt !== 'string' || typeof m.signature !== 'string'
    || typeof m.authorId !== 'string' || typeof m.keyId !== 'string') return false
  if (m.channelId !== channelId || !ID.test(m.authorId) || !ID.test(m.keyId)) return false
  if (m.id.length !== 73 || m.id.slice(0, 37) !== m.authorId + ':' || !ID.test(m.id.slice(37))) return false
  if (m.signature.length === 0 || m.signature.length > 200) return false
  // Files, when there are any, are a short list of well-formed descriptions; "no files" is the field left out.
  if (m.files !== undefined && !(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= MAX_P2P_FILES && m.files.every(fileOk))) return false
  if ((m.content.trim().length === 0 && !m.files) || m.content.length > MAX_P2P_TEXT || !SENT_AT.test(m.sentAt)) return false
  const at = Date.parse(m.sentAt)
  return !Number.isNaN(at) && at <= Date.now() + AHEAD
}

/** Only the fields a message has: nothing extra someone tucked in travels further or is kept. */
const clean = (m: P2PMessage): P2PMessage => ({
  id: m.id, channelId: m.channelId, authorId: m.authorId, authorName: '', sentAt: m.sentAt, content: m.content,
  ...(m.files ? { files: m.files.map(f => ({ hash: f.hash, size: f.size, type: f.type, name: f.name })) } : {}),
  keyId: m.keyId, signature: m.signature,
})

/** The same ways to connect with every relay taken out, and no insisting on one. */
function withoutRelay(config: RTCConfiguration): RTCConfiguration {
  const direct = (config.iceServers ?? [])
    .map(s => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => !/^turns?:/i.test(u)) }))
    .filter(s => s.urls.length > 0)
    .map(s => ({ urls: s.urls }))
  return { ...config, iceServers: direct, iceTransportPolicy: 'all' }
}
