import type { Room, RemoteParticipant, RemoteTrackPublication } from 'livekit-client'
import type { SfuPassDto, StreamSettingsDto } from './types'
import { isRelayed } from './transfer'

/**
 * Sharing a screen, an app window or a camera with the voice channel you are in.
 *
 * Nothing is sent until someone chooses to watch. Each viewer then gets a connection of their own from the
 * sharer's app, separate from the voice call so that starting or stopping video can never disturb the audio.
 * It uses the same servers and the same relay-or-direct choice as the call, so sharing never shows anyone an
 * IP address that voice would have kept private.
 *
 * Every viewer costs the sharer another encode and another upload, which is why the server sets small viewer
 * limits and caps on resolution, frame rate and bitrate. They are applied here, on what is sent.
 *
 * Where the voice channel has a stream server, none of that connecting happens here. The sharer's app sends the
 * video to the stream server once, with a pass this server hands it, and each viewer's app collects it from there
 * with a pass of its own. Nobody's app talks to anybody else's, and a second viewer costs the sharer nothing.
 */

/** The stream server library is only fetched (from this app's own files) the first time a stream goes through one. */
const streamServer = () => import('livekit-client')
import { letGo, openRoom } from './sealedRoom'
import { makeGuard, READ_EVERY_MS } from './streamLimit'

/** Tried this many times in a row before a stream that keeps losing the stream server is given up on. */
const RESEND_TRIES = 3

export type StreamKind = 'screen' | 'window' | 'camera'

/** What a sharer sends: picture height, frames a second, and the most kilobits a second per viewer. */
export interface StreamQuality { height: number; fps: number; kbps: number }

const PRESETS: StreamQuality[] = [
  { height: 480, fps: 30, kbps: 1200 },
  { height: 720, fps: 30, kbps: 2500 },
  { height: 720, fps: 60, kbps: 4000 },
  { height: 1080, fps: 30, kbps: 5000 },
  { height: 1080, fps: 60, kbps: 8000 },
  { height: 1440, fps: 30, kbps: 9000 },
  { height: 1440, fps: 60, kbps: 15000 },
]

/**
 * The qualities a sharer may pick from here. An ordinary channel is held to the server's ordinary limits; a P2P
 * channel or call has limits of its own, usually higher, because nothing there crosses the relay.
 */
export function qualityChoices(rules: StreamSettingsDto | null, direct: boolean): StreamQuality[] {
  const cap: StreamQuality = !rules ? { height: 720, fps: 30, kbps: 2500 }
    : direct ? { height: rules.directMaxHeight ?? 1080, fps: rules.directMaxFps ?? 60, kbps: rules.directMaxKbps ?? 8000 }
    : { height: rules.maxHeight, fps: rules.maxFps, kbps: rules.maxKbps }
  // Each quality is sent at the rate the server's owner set for it (or, on a server from before there was such a
  // table, a usual rate of our own), and never at more than the limit. The best one allowed is the exception on such
  // an older server: it is given the limit itself, which there is the one rate its owner set.
  const table = rules?.rates?.length ? rules.rates : null
  const fit = (table ?? PRESETS).filter(p => p.height <= cap.height && p.fps <= cap.fps)
    .map(p => ({ height: p.height, fps: p.fps, kbps: !table && p.height === cap.height && p.fps === cap.fps ? cap.kbps : Math.min(p.kbps, cap.kbps) }))
  return fit.length > 0 ? fit : [cap]
}

/** What is used when the sharer did not choose: 720p at 30 if that is allowed, otherwise the best that is. */
export function defaultQuality(rules: StreamSettingsDto | null, direct: boolean): StreamQuality {
  const all = qualityChoices(rules, direct)
  return all.find(q => q.height === 720 && q.fps === 30) ?? all[all.length - 1]
}

/**
 * What a shared video sends each viewer. Ordinarily that is the picked quality's own bitrate. In a P2P channel or
 * call a person may have chosen a rate of their own (their connection carries it, no relay does): that is used
 * instead, held to what the server allows for P2P.
 */
export function p2pVideoRate(usual: number, direct: boolean, own: number | undefined, rules: StreamSettingsDto | null): number {
  if (!direct || !own || own <= 0) return usual
  return Math.max(300, Math.min(own, rules?.directMaxKbps ?? 8000))
}

/** The choices offered for a person's own P2P rates, in kilobits per second. */
export const P2P_VOICE_RATES = [32, 64, 96, 128, 192, 256]
export const P2P_VIDEO_RATES = [1500, 2500, 5000, 8000, 12000, 15000, 20000, 30000, 50000]

export const describeQuality = (q: StreamQuality) => `${q.height}p · ${q.fps} fps`

export interface StreamDeps {
  signal(target: string, kind: 'offer' | 'answer' | 'ice' | 'stop' | 'limit', payload: string): Promise<void>
  /** The voice call's own servers and relay policy. */
  rtcConfig(): RTCConfiguration
  settings(): StreamSettingsDto | null
  changed(): void
  /** The capture ended by itself: the shared window was closed, or the browser's own "stop sharing" was pressed. */
  captureEnded(): void
  /** A stream we were watching arrived at more than its sharer may send, and we stopped watching it. */
  overLimit(streamer: string): void
  /** A fresh pass to send what we are already sharing, after the stream server was lost. Null if it no longer goes through one. */
  sharePass(kind: StreamKind): Promise<SfuPassDto | null>
  /** Sending through the stream server failed for good; the share is over. */
  shareLost(reason: string): void
}

export interface Watching { streamer: string; state: 'connecting' | 'live' | 'failed'; relayed: boolean | null; error: string | null }

interface Outgoing {
  pc: RTCPeerConnection; relayed: boolean | null; pendingIce: RTCIceCandidateInit[]
  /** The most this viewer asked to be sent, in kilobits a second. 0 = no wish of their own. */
  capKbps: number
}

/** Whether this app can capture the computer's sound without also capturing the sound it is playing itself. */
export const canShareSound = () => !!(navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined)?.restrictOwnAudio

/** The computer's sound for a shared app or screen: as it is (no voice processing), minus what this app plays. */
export const soundConstraints = (): MediaTrackConstraints =>
  ({ restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } as MediaTrackConstraints)
interface Incoming {
  pc: RTCPeerConnection | null; stream: MediaStream | null; view: Watching; pendingIce: RTCIceCandidateInit[]; timer: ReturnType<typeof setTimeout> | null
  /** Collected from the stream server rather than sent to us by the sharer's app. */
  viaServer?: boolean
  /** Asked for the smaller picture (a slow connection). */
  small?: boolean
}

const CONNECT_TIMEOUT = 25_000

export class StreamEngine {
  private deps: StreamDeps
  private local: MediaStream | null = null
  private kind: StreamKind | null = null
  private chosen: StreamQuality | null = null
  private out = new Map<string, Outgoing>()
  private incoming = new Map<string, Incoming>()
  /** Our connection to the stream server for what we are sharing, when it goes through one. */
  private sendRoom: Room | null = null
  /** Our connection to the stream server for what we are watching. One serves every stream in the channel. */
  /**
   * Each stream that goes through a stream server has a room of its own there, and a pass from the server lets us
   * into that one room and no other. So there is one connection per stream being watched, by its sharer.
   */
  private watchRooms = new Map<string, { room: Room | null; ready: Promise<Room> }>()

  constructor(deps: StreamDeps) { this.deps = deps }

  // ---- Sharing ---------------------------------------------------------------------------------------------------

  get sharing(): StreamKind | null { return this.kind }
  get localStream(): MediaStream | null { return this.local }
  /** What we are sending: the chosen limits, and never more than the capture really gives. */
  get quality(): StreamQuality | null {
    if (!this.local || !this.chosen) return null
    const settings = this.local.getVideoTracks()[0]?.getSettings() ?? {}
    return {
      height: Math.min(this.chosen.height, settings.height ?? this.chosen.height),
      fps: Math.round(Math.min(this.chosen.fps, settings.frameRate ?? this.chosen.fps)),
      kbps: this.chosen.kbps,
    }
  }

  /** Whether what we share is going through a stream server rather than straight to each viewer. */
  get viaServer(): boolean { return this.sendRoom !== null }

  /**
   * Begin sharing `stream`. With a `pass` it is sent to the channel's stream server, which only takes it while
   * someone is watching. Without one nothing is sent yet, and each viewer is connected when they ask to watch.
   */
  async start(stream: MediaStream, kind: StreamKind, quality: StreamQuality | null = null, pass: SfuPassDto | null = null) {
    this.stopSharing()
    this.local = stream
    this.kind = kind
    this.chosen = quality
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (this.local === stream) this.deps.captureEnded() })
    this.deps.changed()
    if (pass) {
      try { await this.send(stream, kind, pass) }
      catch (e) { if (this.local === stream) this.stopSharing(); throw e }
    }
  }

  /** Connects to the stream server and hands it the picture, and the sound if there is any. */
  private async send(stream: MediaStream, kind: StreamKind, pass: SfuPassDto) {
    const { RoomEvent, Track, VideoPreset } = await streamServer()
    // The capture is ours: the library must neither stop it nor try to open it again by itself. What is sent is
    // encrypted here first, with this stream's own key (see sealedRoom).
    const room = await openRoom({ adaptiveStream: false, dynacast: true, stopLocalTrackOnUnpublish: false }, pass)
    // Stopped while the room was being made ready: it is let go of unused.
    if (this.local !== stream || this.sendRoom) { letGo(room); return }
    this.sendRoom = room
    const mine = () => this.sendRoom === room && this.local === stream
    // A room that never connected reports itself "disconnected" too. Whoever asked for it hears that as an error and
    // decides what happens next; only one that was up and then dropped starts sending again from here.
    let up = false
    room.on(RoomEvent.Disconnected, () => { if (mine() && up) { this.sendRoom = null; void this.resend(stream, kind, 1) } })
    // No address-finding servers of anyone's: the stream server has a public address and we simply connect to it.
    await room.connect(pass.url, pass.token, { autoSubscribe: false, rtcConfig: { iceServers: [] } })
    up = true
    if (!mine()) { void room.disconnect(); return }

    const rules = this.deps.settings()
    const q: StreamQuality = this.chosen ?? (rules ? { height: rules.maxHeight, fps: rules.maxFps, kbps: rules.maxKbps } : { height: 720, fps: 30, kbps: 2500 })
    for (const track of stream.getTracks()) {
      if (track.kind === 'audio') {
        // The computer's sound as it is: no voice processing, no silence detection, both channels.
        await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio, dtx: false, red: false, audioPreset: { maxBitrate: 128_000 }, forceStereo: true })
        continue
      }
      const size = track.getSettings()
      const width = size.width ?? Math.round(q.height * 16 / 9), height = size.height ?? q.height
      // A second, smaller picture for viewers on slow connections. It is only encoded while one of them asks for it.
      const small = q.height >= 720 ? [new VideoPreset(Math.round(width / 2), Math.round(height / 2), Math.max(250_000, Math.round(q.kbps * 250)), Math.min(q.fps, 30))] : []
      const encoding = { maxBitrate: q.kbps * 1000, maxFramerate: q.fps }
      const published = await room.localParticipant.publishTrack(track, {
        source: kind === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare,
        videoCodec: 'vp8', simulcast: small.length > 0,
        videoEncoding: encoding, screenShareEncoding: encoding, videoSimulcastLayers: small, screenShareSimulcastLayers: small,
      })
      // A capture larger than what was chosen (a 1440p screen shared at 720p) is scaled down before it is encoded.
      const sender = published.track?.sender
      if (sender && height > q.height * 1.02) {
        const params = sender.getParameters()
        for (const e of params.encodings ?? []) e.scaleResolutionDownBy = (e.scaleResolutionDownBy ?? 1) * (height / q.height)
        await sender.setParameters(params).catch(() => { /* the capture constraints still hold */ })
      }
    }
    this.deps.changed()
  }

  /** The stream server dropped us while we were sharing: ask for a new pass and send again, a few times at most. */
  private async resend(stream: MediaStream, kind: StreamKind, attempt: number) {
    await new Promise(r => setTimeout(r, 1500 * attempt))
    if (this.local !== stream || this.sendRoom) return
    try {
      const pass = await this.deps.sharePass(kind)
      if (this.local !== stream || this.sendRoom) return
      if (!pass) throw new Error('The stream server is not available.')
      await this.send(stream, kind, pass)
    } catch {
      if (this.local !== stream) return
      const room = this.sendRoom as Room | null
      this.sendRoom = null
      void room?.disconnect()
      if (attempt < RESEND_TRIES) void this.resend(stream, kind, attempt + 1)
      else this.deps.shareLost('Your stream ended because the connection to the stream server was lost.')
    }
  }

  /** Stop sharing: every viewer's connection closes and the capture is released. */
  stopSharing() {
    const room = this.sendRoom
    this.sendRoom = null
    void room?.disconnect()
    for (const [viewer, o] of this.out) { void this.deps.signal(viewer, 'stop', '').catch(() => {}); o.pc.close() }
    this.out.clear()
    this.local?.getTracks().forEach(t => t.stop())
    this.local = null
    this.kind = null
    this.chosen = null
    this.deps.changed()
  }

  /** How many people our video is going to, and how many of them through a relay. */
  viewerCounts() {
    let relayed = 0
    for (const o of this.out.values()) if (o.relayed) relayed++
    return { total: this.out.size, relayed }
  }

  /** Someone asked to watch: connect to them and send the video. */
  async viewerRequested(viewer: string) {
    if (!this.local) { void this.deps.signal(viewer, 'stop', 'That stream has ended.').catch(() => {}); return }
    this.out.get(viewer)?.pc.close()
    const pc = new RTCPeerConnection(this.deps.rtcConfig())
    const o: Outgoing = { pc, relayed: null, pendingIce: [], capKbps: 0 }
    this.out.set(viewer, o)
    pc.onicecandidate = e => { if (e.candidate) void this.deps.signal(viewer, 'ice', JSON.stringify(e.candidate.toJSON())).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      if (this.out.get(viewer) !== o) return
      if (pc.connectionState === 'connected') void this.admit(viewer, o)
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { this.out.delete(viewer); pc.close(); this.deps.changed() }
    }
    try {
      // The picture, and the sound if it was shared with it.
      for (const track of this.local.getTracks()) {
        const sender = pc.addTrack(track, this.local)
        if (track.kind === 'video') await this.limit(sender, track, o)
      }
      await pc.setLocalDescription(await pc.createOffer())
      await this.deps.signal(viewer, 'offer', JSON.stringify(pc.localDescription))
    } catch {
      this.out.delete(viewer)
      pc.close()
    }
    this.deps.changed()
  }

  viewerLeft(viewer: string) {
    const o = this.out.get(viewer)
    if (!o) return
    this.out.delete(viewer)
    o.pc.close()
    this.deps.changed()
  }

  /** Applies the server's caps, and the viewer's own wish if it is lower, to what one viewer is sent. */
  private async limit(sender: RTCRtpSender, track: MediaStreamTrack, o: Outgoing) {
    const rules = this.deps.settings()
    // The sharer's choice (already within what the server allows here), or the server's ordinary limits without one.
    const picked: StreamQuality | null = this.chosen ?? (rules ? { height: rules.maxHeight, fps: rules.maxFps, kbps: rules.maxKbps } : null)
    if (!picked) return
    // In a P2P channel the picked quality may be far above what the relay is meant to carry. A viewer whose
    // connection fell back to the relay (or is not yet known not to have) gets the ordinary relayed limits instead.
    const held = o.relayed !== false && !!rules
    const q: StreamQuality = held
      ? { height: Math.min(picked.height, rules!.maxHeight), fps: Math.min(picked.fps, rules!.maxFps), kbps: Math.min(picked.kbps, rules!.maxKbps) }
      : picked
    const params = sender.getParameters()
    if (!params.encodings?.length) return
    const height = track.getSettings().height ?? 0
    for (const encoding of params.encodings) {
      encoding.maxBitrate = (o.capKbps > 0 ? Math.min(q.kbps, o.capKbps) : q.kbps) * 1000
      encoding.maxFramerate = q.fps
      // A 1440p capture shared at 720p is halved before it is encoded.
      encoding.scaleResolutionDownBy = height > q.height * 1.02 ? height / q.height : 1
    }
    await sender.setParameters(params).catch(() => { /* older engines refuse before negotiation; the capture constraints still hold */ })
  }

  /** Once connected we know whether this viewer came through a relay, and relayed viewers have a limit of their own. */
  private async admit(viewer: string, o: Outgoing) {
    // If how they are reached cannot be told, they are held to the relayed limits rather than given the benefit of the doubt.
    o.relayed = await isRelayed(o.pc).catch(() => true)
    if (this.out.get(viewer) !== o) return
    const rules = this.deps.settings()
    if (rules && o.relayed && this.viewerCounts().relayed > rules.maxViewersRelayed) {
      this.out.delete(viewer)
      void this.deps.signal(viewer, 'stop', rules.maxViewersRelayed === 0
        ? 'This stream cannot take more viewers on this server right now.'
        : 'This stream already has as many relayed viewers as this server allows.').catch(() => {})
      setTimeout(() => o.pc.close(), 300)
      this.deps.changed()
      return
    }
    // Now that we know how this viewer is reached, what they are sent is set again: the full picked quality for a
    // direct viewer, the relayed limits for one on the relay.
    for (const sender of o.pc.getSenders()) if (sender.track?.kind === 'video') await this.limit(sender, sender.track, o)
    this.deps.changed()
  }

  // ---- Watching --------------------------------------------------------------------------------------------------

  /** Get ready to receive someone's stream. Call this, then ask the server to watch. */
  watch(streamer: string) {
    this.drop(streamer)
    const entry: Incoming = { pc: null, stream: null, view: { streamer, state: 'connecting', relayed: null, error: null }, pendingIce: [], timer: null }
    entry.timer = setTimeout(() => this.fail(streamer, 'Could not connect to the stream.'), CONNECT_TIMEOUT)
    this.incoming.set(streamer, entry)
    this.deps.changed()
  }

  /**
   * The stream we just asked to watch is on the channel's stream server: collect it from there. Called after
   * `watch`, with the pass the server answered with.
   */
  async watchVia(streamer: string, pass: SfuPassDto) {
    const entry = this.incoming.get(streamer)
    if (!entry) return
    entry.viaServer = true
    try {
      const room = await this.viewerRoom(streamer, pass)
      if (this.incoming.get(streamer) !== entry) return
      const sharer = room.getParticipantByIdentity(streamer) as RemoteParticipant | undefined
      // What they have put up so far; anything they put up later arrives as an event (see viewerRoom).
      for (const publication of sharer?.trackPublications.values() ?? []) this.take(entry, publication as RemoteTrackPublication)
    } catch (e) {
      if (this.incoming.get(streamer) === entry) this.fail(streamer, e instanceof Error && e.message ? 'Could not connect to the stream.' : 'Could not connect to the stream.')
    }
  }

  private take(entry: Incoming, publication: RemoteTrackPublication) {
    publication.setSubscribed(true)
    if (entry.small && publication.kind === 'video') void streamServer().then(({ VideoQuality }) => publication.setVideoQuality(VideoQuality.LOW))
  }

  /** Our connection to one stream's room on the stream server, made when we start watching it. */
  private viewerRoom(streamer: string, pass: SfuPassDto): Promise<Room> {
    const held = this.watchRooms.get(streamer)
    if (held) return held.ready
    const slot: { room: Room | null; ready: Promise<Room> } = { room: null, ready: null as unknown as Promise<Room> }
    slot.ready = (async () => {
      const { RoomEvent } = await streamServer()
      // Decrypted here with the stream's key, which came with the pass to watch it.
      const room = await openRoom({ adaptiveStream: false, dynacast: false }, pass, () => {
        const entry = this.incoming.get(streamer)
        if (this.watchRooms.get(streamer) === slot && entry?.viaServer && entry.view.state !== 'failed') this.fail(streamer, 'This stream could not be decrypted.')
      })
      slot.room = room
      /** What we hold of the sharer's stream, as something a video element can play. */
      const gather = (sharer: RemoteParticipant) => {
        if (sharer.identity !== streamer) return
        // A room we have let go of still reports its tracks going as it closes. That is not the stream coming back.
        if (this.watchRooms.get(streamer) !== slot) return
        const entry = this.incoming.get(sharer.identity)
        if (!entry?.viaServer) return
        const tracks = [...sharer.trackPublications.values()].map(p => p.track?.mediaStreamTrack).filter((t): t is MediaStreamTrack => !!t)
        entry.stream = tracks.length > 0 ? new MediaStream(tracks) : null
        if (tracks.some(t => t.kind === 'video')) {
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
          entry.view = { ...entry.view, state: 'live', error: null }
        }
        this.deps.changed()
      }
      room.on(RoomEvent.TrackPublished, (publication, sharer) => {
        const entry = sharer.identity === streamer ? this.incoming.get(streamer) : undefined
        if (entry?.viaServer) this.take(entry, publication)
      })
      room.on(RoomEvent.TrackSubscribed, (_track, _publication, sharer) => gather(sharer))
      room.on(RoomEvent.TrackUnsubscribed, (_track, _publication, sharer) => gather(sharer))
      room.on(RoomEvent.Disconnected, () => {
        if (this.watchRooms.get(streamer) !== slot) return
        this.watchRooms.delete(streamer)
        const entry = this.incoming.get(streamer)
        if (entry?.viaServer && entry.view.state !== 'failed') this.fail(streamer, 'The connection to the stream was lost.')
      })
      await room.connect(pass.url, pass.token, { autoSubscribe: false, rtcConfig: { iceServers: [] } })
      if (pass.limit) this.holdToLimit(streamer, slot, room, pass.limit)
      return room
    })()
    this.watchRooms.set(streamer, slot)
    slot.ready.catch(() => { if (this.watchRooms.get(streamer) === slot) this.watchRooms.delete(streamer) })
    return slot.ready
  }

  /**
   * Holds a stream we are watching to what its sharer may send (see streamLimit.ts): what actually arrives is read
   * every few seconds, and a stream that stays over is let go of. Nothing is asked of anyone; it is this app's own
   * connection being measured.
   */
  private holdToLimit(streamer: string, slot: { room: Room | null }, room: Room, limit: { height: number; fps: number; kbps: number }) {
    const over = makeGuard(limit)
    let last: { bytes: number; at: number } | null = null
    const timer = window.setInterval(async () => {
      if (this.watchRooms.get(streamer)?.room !== room || slot.room !== room) { window.clearInterval(timer); return }
      const sharer = room.getParticipantByIdentity(streamer)
      const video = [...(sharer?.trackPublications.values() ?? [])].find(p => p.kind === 'video')?.track
      const report = await video?.getRTCStatsReport().catch(() => undefined)
      let now: { bytes: number; width: number; height: number; fps: number } | null = null
      report?.forEach(s => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') now = { bytes: s.bytesReceived ?? 0, width: s.frameWidth ?? 0, height: s.frameHeight ?? 0, fps: s.framesPerSecond ?? 0 }
      })
      const read = now as { bytes: number; width: number; height: number; fps: number } | null
      if (!read) return
      const at = performance.now()
      // Bytes since the last reading, as kilobits a second.
      const kbps = last && at > last.at && read.bytes >= last.bytes ? (read.bytes - last.bytes) * 8 / (at - last.at) : 0
      last = { bytes: read.bytes, at }
      if (!over({ width: read.width, height: read.height, fps: read.fps, kbps })) return
      window.clearInterval(timer)
      if (this.watchRooms.get(streamer)?.room !== room) return
      this.fail(streamer, 'This stream is being sent at more than its sharer is allowed, so it is not shown.')
      this.deps.overLimit(streamer)
    }, READ_EVERY_MS)
  }

  /** We stopped watching a stream that came through the stream server: let go of its room. */
  private releaseViewerRoom(streamer: string) {
    const held = this.watchRooms.get(streamer)
    if (!held) return
    this.watchRooms.delete(streamer)
    void held.ready.then(room => room.disconnect(), () => { /* it never connected */ })
  }

  unwatch(streamer: string) {
    if (!this.incoming.has(streamer)) return
    this.drop(streamer)
    this.deps.changed()
  }

  /** Ask the person whose stream we are watching to send us no more than this (0 = no limit of ours). */
  requestLimit(streamer: string, kbps: number) {
    const entry = this.incoming.get(streamer)
    if (!entry) return
    if (entry.viaServer) {
      // Through a stream server there are two pictures to choose from: any limit of ours means the smaller one.
      entry.small = kbps > 0
      const sharer = this.watchRooms.get(streamer)?.room?.getParticipantByIdentity(streamer) as RemoteParticipant | undefined
      void streamServer().then(({ VideoQuality }) => {
        for (const publication of sharer?.trackPublications.values() ?? [])
          if (publication.kind === 'video') (publication as RemoteTrackPublication).setVideoQuality(entry.small ? VideoQuality.LOW : VideoQuality.HIGH)
      })
      return
    }
    void this.deps.signal(streamer, 'limit', String(Math.max(0, Math.round(kbps)))).catch(() => { /* the stream is ending */ })
  }

  watching(): Watching[] { return [...this.incoming.values()].map(i => ({ ...i.view })) }
  streamOf(streamer: string): MediaStream | null { return this.incoming.get(streamer)?.stream ?? null }

  private drop(streamer: string) {
    const entry = this.incoming.get(streamer)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.pc?.close()
    this.incoming.delete(streamer)
    if (entry.viaServer) this.releaseViewerRoom(streamer)
  }

  private fail(streamer: string, error: string) {
    const entry = this.incoming.get(streamer)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.pc?.close()
    entry.pc = null
    entry.stream = null
    entry.view = { ...entry.view, state: 'failed', error }
    if (entry.viaServer) this.releaseViewerRoom(streamer)
    this.deps.changed()
  }

  // ---- Set-up messages from the other app --------------------------------------------------------------------------

  async signal(from: string, kind: string, payload: string) {
    const sending = this.out.get(from)
    const receiving = this.incoming.get(from)
    try {
      if (kind === 'stop') {
        if (receiving) this.fail(from, payload || 'The stream ended.')
        if (sending) this.viewerLeft(from)
      } else if (kind === 'limit') {
        // A viewer on a slow connection asks for less. It never raises what the server allows.
        if (!sending) return
        sending.capKbps = Math.max(0, Math.min(1_000_000, parseInt(payload, 10) || 0))
        for (const sender of sending.pc.getSenders()) if (sender.track?.kind === 'video') await this.limit(sender, sender.track, sending)
      } else if (kind === 'offer' && receiving) {
        receiving.pc?.close()
        const pc = new RTCPeerConnection(this.deps.rtcConfig())
        receiving.pc = pc
        pc.onicecandidate = e => { if (e.candidate) void this.deps.signal(from, 'ice', JSON.stringify(e.candidate.toJSON())).catch(() => {}) }
        pc.ontrack = e => {
          if (this.incoming.get(from) !== receiving) return
          receiving.stream = e.streams[0] ?? new MediaStream([e.track])
          this.deps.changed()
        }
        pc.onconnectionstatechange = () => {
          if (this.incoming.get(from) !== receiving || receiving.pc !== pc) return
          if (pc.connectionState === 'connected') {
            if (receiving.timer) clearTimeout(receiving.timer)
            receiving.view = { ...receiving.view, state: 'live', error: null }
            void isRelayed(pc).then(relayed => { if (receiving.pc === pc) { receiving.view = { ...receiving.view, relayed }; this.deps.changed() } }).catch(() => {})
            this.deps.changed()
          } else if (pc.connectionState === 'failed') this.fail(from, 'The connection to the stream was lost.')
        }
        await pc.setRemoteDescription(JSON.parse(payload))
        for (const candidate of receiving.pendingIce.splice(0)) await pc.addIceCandidate(candidate)
        await pc.setLocalDescription(await pc.createAnswer())
        await this.deps.signal(from, 'answer', JSON.stringify(pc.localDescription))
      } else if (kind === 'answer' && sending) {
        await sending.pc.setRemoteDescription(JSON.parse(payload))
        for (const candidate of sending.pendingIce.splice(0)) await sending.pc.addIceCandidate(candidate)
      } else if (kind === 'ice') {
        const candidate = JSON.parse(payload) as RTCIceCandidateInit
        const target = sending ?? receiving
        if (!target) return
        if (target.pc?.remoteDescription) await target.pc.addIceCandidate(candidate)
        else target.pendingIce.push(candidate)
      }
    } catch (e) {
      if (receiving) this.fail(from, e instanceof Error ? e.message : String(e))
    }
  }

  /** Leaving the voice channel: nothing shared, nothing watched. */
  leaveAll() {
    for (const streamer of [...this.incoming.keys()]) this.drop(streamer)
    this.stopSharing()
  }
}

/** What to capture, shaped by the server's limits so the computer does not capture more than it may send. */
export function videoConstraints(q: StreamQuality | null): MediaTrackConstraints {
  return q ? { height: { max: q.height }, frameRate: { max: q.fps, ideal: q.fps } } : {}
}

/** "motion" keeps games and video smooth when bandwidth is short; "detail" keeps text sharp instead. */
export function applyHint(stream: MediaStream, hint: 'motion' | 'detail') {
  for (const track of stream.getVideoTracks()) track.contentHint = hint
}
