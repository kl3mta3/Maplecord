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
 * In a P2P channel or call, from the third viewer on, the encodes are shared: the picture is encoded once for each
 * of a few qualities and every viewer is sent a copy of one of them (see streamLadder.ts). The upload is still one
 * copy for each viewer.
 *
 * Where the voice channel has a stream server, none of that connecting happens here. The sharer's app sends the
 * video to the stream server once, with a pass this server hands it, and each viewer's app collects it from there
 * with a pass of its own. Nobody's app talks to anybody else's, and a second viewer costs the sharer nothing.
 */

/** The stream server library is only fetched (from this app's own files) the first time a stream goes through one. */
const streamServer = () => import('livekit-client')
import { letGo, openRoom } from './sealedRoom'
import { makeGuard, READ_EVERY_MS } from './streamLimit'
import { HEALTH_EVERY_MS, LADDER_AT, LADDER_OFF, SETTLE_MS, bestOption, judge, ladderLevels, ladderOptions, newHealth, optionAbove, optionBelow, sameOption, type Health, type LadderOption } from './streamLadder'
import type { FromWorker, ToWorker } from './streamLadderWorker'

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

export const describeQuality = (q: { height: number; fps: number }) => `${q.height}p · ${q.fps} fps`

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
  /** What is sent to them passes through the copying worker, so they can be sent a shared level. Only in a P2P channel, in an app that can. */
  tapped: boolean
  video: RTCRtpSender | null
  /** Connected, and it is known whether through a relay. */
  admitted: boolean
  /** The shared level they are to be sent, and how; null = an encode of their own, as it always was. */
  option: LadderOption | null
  /** What the worker says they are being sent right now: "own", or a level's id. It follows `option` a moment later. */
  sentFrom: string
  /** When they were last put on something new. */
  sentSince: number
  /** The most they asked for by name ("up to 720p at 30"), over the stream's own channel. */
  want: { height: number; fps: number } | null
  /** The most their connection has shown it can take, in kilobits a second; 0 = not held. Moved by the looks at their connection. */
  heldKbps: number
  health: Health
  /** Where they are told what they can choose from, and say what they chose. */
  channel: RTCDataChannel | null
}

/** One shared level being encoded: a connection from this app to an end inside this app, which exists to keep the encoder running. */
interface OpenLevel {
  id: string; a: RTCPeerConnection; b: RTCPeerConnection; sender: RTCRtpSender | null
  asking: boolean; askedAt: number
  /** Since when nobody has been on it. It is closed a few seconds after. */
  unusedSince: number | null
}

/** A viewer on a shared level keeps an encoder of their own that makes next to nothing: a picture this many lines tall, this often. */
const IDLE_HEIGHT = 90
const IDLE_FPS = 5
/** A level nobody is on is kept this long, in case someone comes back to it. */
const LEVEL_LINGER_MS = 5000
const OWN = 'own'

type Tapped = { createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } }

/**
 * Whether this app can send one encode to several viewers: it has to be able to take encoded frames off a
 * connection and put copies of them onto others. The desktop app and Chrome can.
 */
export const canShareFrames = (): boolean =>
  typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype && typeof Worker === 'function'
  && typeof RTCEncodedVideoFrame === 'function' && (RTCEncodedVideoFrame as unknown as { length: number }).length >= 1

/** What a viewer of a shared stream is told they can choose from, and what they are being sent. */
export interface StreamChoice { options: { height: number; fps: number; kbps: number }[]; on: { height: number; fps: number } | null }

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
  /** The sharer's app is sending shared levels: what we can choose from, and where we say what we chose. */
  choice?: StreamChoice | null
  channel?: RTCDataChannel | null
  want?: { height: number; fps: number } | null
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
  /** What we share is in a P2P channel or call, and goes from this app to each viewer. Only there are encodes shared. */
  private direct = false
  /** The shared levels and what they offer, while encodes are being shared. */
  private ladder: { levels: StreamQuality[]; options: LadderOption[]; timer: number; layered: Map<number, boolean> } | null = null
  /** The levels being encoded right now, by their place in the ladder. They outlast the ladder for a moment while viewers are moved off them. */
  private levels = new Map<number, OpenLevel>()
  private levelRuns = 0
  private worker: Promise<Worker> | null = null
  /** Sharing encodes turned out not to work here; every viewer keeps an encode of their own. */
  private ladderBroken = false
  private tidying: number | null = null

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
  async start(stream: MediaStream, kind: StreamKind, quality: StreamQuality | null = null, pass: SfuPassDto | null = null, direct = false) {
    this.stopSharing()
    this.local = stream
    this.kind = kind
    this.chosen = quality
    this.direct = direct && !pass
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
    this.closeLadder()
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
    const before = this.out.get(viewer)
    if (before) this.forget(viewer, before)
    // In a P2P channel, where this app can, what the viewer is sent goes through the copying worker from the start:
    // untouched while they have an encode of their own, and ready to be swapped for a shared level without connecting again.
    const local = this.local
    const worker = this.direct && !this.ladderBroken && canShareFrames() ? await this.copier().catch(() => null) : null
    if (this.local !== local) return
    const tapped = worker !== null
    const pc = new RTCPeerConnection(tapped ? { ...this.deps.rtcConfig(), encodedInsertableStreams: true } as RTCConfiguration : this.deps.rtcConfig())
    const o: Outgoing = { pc, relayed: null, pendingIce: [], capKbps: 0, tapped, video: null, admitted: false, option: null, sentFrom: OWN, sentSince: 0, want: null, heldKbps: 0, health: newHealth(), channel: null }
    this.out.set(viewer, o)
    pc.onicecandidate = e => { if (e.candidate) void this.deps.signal(viewer, 'ice', JSON.stringify(e.candidate.toJSON())).catch(() => {}) }
    pc.onconnectionstatechange = () => {
      if (this.out.get(viewer) !== o) return
      if (pc.connectionState === 'connected') void this.admit(viewer, o)
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { this.forget(viewer, o); this.deps.changed() }
    }
    try {
      // The picture, and the sound if it was shared with it.
      for (const track of this.local.getTracks()) {
        const sender = pc.addTrack(track, this.local)
        if (worker) {
          const frames = (sender as unknown as Tapped).createEncodedStreams()
          const hand: ToWorker = track.kind === 'video' ? { t: 'viewer', id: viewer, readable: frames.readable, writable: frames.writable } : { t: 'pipe', readable: frames.readable, writable: frames.writable }
          worker.postMessage(hand, [frames.readable, frames.writable])
        }
        if (track.kind !== 'video') continue
        o.video = sender
        // Shared frames are VP8, which is also what a viewer is sent when nothing is said; here it is said.
        if (tapped) this.preferVp8(pc, sender)
        await this.limit(sender, track, o)
      }
      if (tapped) {
        // The stream's own channel, between the two apps: the viewer is told what they can choose, and says what they chose.
        const channel = pc.createDataChannel('quality')
        o.channel = channel
        channel.onopen = () => this.tellViewer(o)
        channel.onmessage = e => this.viewerChose(viewer, o, e.data)
      }
      await pc.setLocalDescription(await pc.createOffer())
      await this.deps.signal(viewer, 'offer', JSON.stringify(pc.localDescription))
    } catch {
      this.forget(viewer, o)
    }
    this.deps.changed()
  }

  viewerLeft(viewer: string) {
    const o = this.out.get(viewer)
    if (!o) return
    this.forget(viewer, o)
    this.deps.changed()
  }

  /** A viewer's connection is over, however it ended. */
  private forget(viewer: string, o: Outgoing) {
    if (this.out.get(viewer) === o) this.out.delete(viewer)
    o.pc.close()
    if (o.tapped) void this.worker?.then(w => w.postMessage({ t: 'dropViewer', id: viewer } satisfies ToWorker), () => {})
    this.rebalance()
  }

  /** Applies the server's caps, and the viewer's own wish if it is lower, to what one viewer is sent. */
  private async limit(sender: RTCRtpSender, track: MediaStreamTrack, o: Outgoing) {
    const rules = this.deps.settings()
    // The sharer's choice (already within what the server allows here), or the server's ordinary limits without one.
    const picked: StreamQuality | null = this.chosen ?? (rules ? { height: rules.maxHeight, fps: rules.maxFps, kbps: rules.maxKbps } : null)
    if (!picked) return
    // On a shared level their own encoder is kept idle (see idle); it is set to this again when they come off it.
    if (o.option) return
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
      if (o.tapped) void this.worker?.then(w => w.postMessage({ t: 'dropViewer', id: viewer } satisfies ToWorker), () => {})
      this.rebalance()
      this.deps.changed()
      return
    }
    // Now that we know how this viewer is reached, what they are sent is set again: the full picked quality for a
    // direct viewer, the relayed limits for one on the relay.
    for (const sender of o.pc.getSenders()) if (sender.track?.kind === 'video') await this.limit(sender, sender.track, o)
    o.admitted = true
    this.rebalance()
    this.deps.changed()
  }

  // ---- Shared encoding in a P2P channel (see streamLadder.ts) -----------------------------------------------------

  /** The worker that copies frames, started the first time it is needed. */
  private copier(): Promise<Worker> {
    this.worker ??= import('./streamLadderWorker?worker').then(({ default: CopyWorker }) => {
      const worker = new CopyWorker()
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.workerSaid(e.data)
      return worker
    })
    return this.worker
  }
  private toWorker(message: ToWorker) { void this.worker?.then(w => w.postMessage(message), () => {}) }

  private preferVp8(pc: RTCPeerConnection, sender: RTCRtpSender) {
    try {
      const all = RTCRtpSender.getCapabilities('video')?.codecs ?? []
      const vp8 = all.filter(c => c.mimeType.toLowerCase() === 'video/vp8')
      if (vp8.length > 0) pc.getTransceivers().find(x => x.sender === sender)?.setCodecPreferences([...vp8, ...all.filter(c => !vp8.includes(c))])
    } catch { /* the engine's own order stands */ }
  }

  /** Whether a viewer can be sent a shared level: connected, tapped, and being sent the kind of video the levels are. */
  private canTake(o: Outgoing) {
    if (!o.tapped || !o.admitted || !o.video) return false
    try { return o.video.getParameters().codecs?.[0]?.mimeType.toLowerCase() === 'video/vp8' } catch { return false }
  }

  /** Starts or ends the sharing of encodes as viewers come and go, and puts every viewer on what they should now be sent. */
  private rebalance() {
    if (!this.local) return
    const able = [...this.out.values()].filter(o => this.canTake(o)).length
    if (!this.ladder && this.direct && !this.ladderBroken && able >= LADDER_AT) this.beginLadder()
    else if (this.ladder && able <= LADDER_OFF) this.endLadder()
    for (const [viewer, o] of this.out) this.place(viewer, o)
    this.tidyLevels()
  }

  private beginLadder() {
    const top = this.quality
    if (!top) return
    const levels = ladderLevels(top, qualityChoices(this.deps.settings(), true))
    // Half the frames a second is not offered until a level's own frames have shown that it can be done (see the worker).
    this.ladder = { levels, options: ladderOptions(levels, () => false), timer: window.setInterval(() => { void this.lookAtViewers() }, HEALTH_EVERY_MS), layered: new Map() }
  }

  /** A level's frames have shown whether every other one can be left out: what is offered follows, and so does everyone on it. */
  private layersKnown(index: number, layered: boolean) {
    const ladder = this.ladder
    if (!ladder || ladder.layered.get(index) === layered) return
    ladder.layered.set(index, layered)
    // A level not yet running is taken to do as the ones that are: it is the same encoder with the same settings.
    const all = [...ladder.layered.values()].every(Boolean)
    ladder.options = ladderOptions(ladder.levels, level => ladder.layered.get(level) ?? all)
    for (const [viewer, o] of this.out) { this.place(viewer, o); this.tellViewer(o) }
    this.tidyLevels()
  }

  /** Everyone goes back to an encode of their own. The levels close once nobody is being sent them. */
  private endLadder() {
    if (!this.ladder) return
    window.clearInterval(this.ladder.timer)
    this.ladder = null
  }

  /** Sharing has stopped: nothing of the ladder is kept. */
  private closeLadder() {
    this.endLadder()
    for (const level of this.levels.values()) { level.a.close(); level.b.close() }
    this.levels.clear()
    if (this.tidying !== null) { window.clearTimeout(this.tidying); this.tidying = null }
    const worker = this.worker
    this.worker = null
    void worker?.then(w => w.terminate(), () => {})
  }

  /** The most a viewer may be sent because of how they are reached: someone on the relay is held to the server's ordinary limits. */
  private relayCeiling(o: Outgoing) {
    const rules = this.deps.settings()
    return o.relayed !== false && rules ? { height: rules.maxHeight, fps: rules.maxFps, kbps: rules.maxKbps } : null
  }

  /** The best a viewer may be sent, leaving aside what their connection has shown. */
  private allowed(o: Outgoing) {
    return this.ladder ? this.ladder.options.filter(option => bestOption([option], this.relayCeiling(o)) !== null) : []
  }

  /** Puts one viewer on the best level they may have and can take, or back on an encode of their own. */
  private place(viewer: string, o: Outgoing) {
    const option = this.ladder && this.canTake(o)
      ? bestOption(this.ladder.options, this.relayCeiling(o), { kbps: o.capKbps }, o.want, { kbps: o.heldKbps })
      : null
    if (sameOption(option, o.option)) return
    o.option = option
    if (option) {
      const level = this.openLevel(option.level)
      this.toWorker({ t: 'set', viewer, source: level.id, half: option.half })
    } else if (o.tapped) {
      // Their own encoder first has to be making the real picture again; the worker changes over on its next keyframe.
      const track = o.video?.track
      void (o.video && track ? this.limit(o.video, track, o) : Promise.resolve()).then(() => this.toWorker({ t: 'set', viewer, source: null, half: false }))
    }
    this.tellViewer(o)
  }

  /** A viewer on a shared level: their own encoder is turned down to nearly nothing. What it makes is not sent. */
  private async idle(o: Outgoing) {
    const sender = o.video
    if (!sender || !this.ladder) return
    try {
      const params = sender.getParameters()
      const height = sender.track?.getSettings().height ?? 720
      for (const encoding of params.encodings ?? []) {
        // The connection still has to be allowed to carry the level's rate, which is not this encoder's.
        encoding.maxBitrate = this.ladder.options[0]!.kbps * 1000
        encoding.maxFramerate = IDLE_FPS
        encoding.scaleResolutionDownBy = Math.max(1, height / IDLE_HEIGHT)
      }
      await sender.setParameters(params)
    } catch { /* it keeps encoding the full picture, unsent: wasteful, not wrong */ }
  }

  private workerSaid(m: FromWorker) {
    if (m.t === 'key') {
      const level = [...this.levels.values()].find(l => l.id === m.level)
      if (level) void this.keyFrame(level)
    } else if (m.t === 'ownKey') {
      const sender = this.out.get(m.viewer)?.video
      if (sender) void this.askKeyFrame(sender)
    } else if (m.t === 'on') {
      const o = this.out.get(m.viewer)
      if (!o) return
      o.sentFrom = m.source
      o.sentSince = performance.now()
      if (m.source !== OWN && o.option) void this.idle(o)
      this.tellViewer(o)
      this.tidyLevels()
    } else if (m.t === 'layers') {
      const index = [...this.levels].find(([, l]) => l.id === m.level)?.[0]
      if (index !== undefined) this.layersKnown(index, m.layered)
    } else if (m.t === 'unsupported') {
      // The frames cannot be shared in this engine after all: everyone keeps an encode of their own from here on.
      this.ladderBroken = true
      this.endLadder()
      for (const [viewer, o] of this.out) this.place(viewer, o)
      this.tidyLevels()
    }
  }

  private async askKeyFrame(sender: RTCRtpSender) {
    try { await (sender.setParameters as (p: RTCRtpSendParameters, o: unknown) => Promise<void>).call(sender, sender.getParameters(), { encodingOptions: [{ keyFrame: true }] }) }
    catch { /* the engine makes one by itself soon enough */ }
  }

  private async keyFrame(level: OpenLevel) {
    if (!level.sender || level.asking || performance.now() - level.askedAt < 300) return
    level.asking = true
    level.askedAt = performance.now()
    await this.askKeyFrame(level.sender)
    level.asking = false
  }

  /** The encoder for one level, started if it is not running. */
  private openLevel(index: number): OpenLevel {
    const open = this.levels.get(index)
    if (open) { open.unusedSince = null; return open }
    // Both ends are in this app, and it reaches itself without anyone's help: no servers are asked for anything.
    const a = new RTCPeerConnection({ iceServers: [], encodedInsertableStreams: true } as RTCConfiguration)
    const b = new RTCPeerConnection({ iceServers: [] })
    const level: OpenLevel = { id: `level${index}.${++this.levelRuns}`, a, b, sender: null, asking: false, askedAt: 0, unusedSince: null }
    this.levels.set(index, level)
    void this.runLevel(index, level).catch(() => {
      // It could not be started: whoever was to be on it goes back to an encode of their own, and nothing more is shared.
      if (this.levels.get(index) === level) this.levels.delete(index)
      a.close(); b.close()
      this.ladderBroken = true
      this.endLadder()
      for (const [viewer, o] of this.out) this.place(viewer, o)
    })
    return level
  }

  private async runLevel(index: number, level: OpenLevel) {
    const quality = this.ladder?.levels[index]
    const track = this.local?.getVideoTracks()[0]
    const worker = await this.copier()
    if (!quality || !track || !this.local || this.levels.get(index) !== level) throw new Error('The stream ended.')
    const { a, b } = level
    a.onicecandidate = e => { if (e.candidate) void b.addIceCandidate(e.candidate).catch(() => {}) }
    b.onicecandidate = e => { if (e.candidate) void a.addIceCandidate(e.candidate).catch(() => {}) }
    const sender = a.addTrack(track, this.local)
    level.sender = sender
    this.preferVp8(a, sender)
    const frames = (sender as unknown as Tapped).createEncodedStreams()
    worker.postMessage({ t: 'level', id: level.id, readable: frames.readable, writable: frames.writable } satisfies ToWorker, [frames.readable, frames.writable])
    const offer = await a.createOffer()
    await a.setLocalDescription(offer)
    await b.setRemoteDescription(offer)
    const answer = await b.createAnswer()
    await b.setLocalDescription(answer)
    // Left to itself the engine starts every stream small and soft and takes many seconds to work up to the rate it
    // was given, in case the line cannot take it. This line is inside the computer: it is told to start at its rate.
    const rate = `x-google-start-bitrate=${quality.kbps};x-google-min-bitrate=${Math.round(quality.kbps / 2)};x-google-max-bitrate=${quality.kbps}`
    const sdp = (answer.sdp ?? '')
      .replace(/a=rtpmap:(\d+) VP8\/90000\r\n/g, (line: string, pt: string) => ((answer.sdp ?? '').includes(`a=fmtp:${pt} `) ? line : `${line}a=fmtp:${pt} ${rate}\r\n`))
    await a.setRemoteDescription({ type: 'answer', sdp })
    const params = sender.getParameters()
    const height = track.getSettings().height ?? 0
    for (const encoding of params.encodings ?? []) {
      encoding.maxBitrate = quality.kbps * 1000
      encoding.maxFramerate = quality.fps
      encoding.scaleResolutionDownBy = height > quality.height * 1.02 ? height / quality.height : 1
      // At 60 a second every other frame is one nothing else is built on, so it can be left out for whoever wants 30.
      if (quality.fps >= 50) (encoding as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode = 'L1T2'
    }
    await sender.setParameters(params)
  }

  /** Closes the levels nobody has been on for a little while. */
  private tidyLevels() {
    const now = performance.now()
    let waiting = false
    for (const [index, level] of this.levels) {
      const used = [...this.out.values()].some(o => o.option?.level === index || o.sentFrom === level.id)
      if (used) { level.unusedSince = null; continue }
      level.unusedSince ??= now
      if (now - level.unusedSince < LEVEL_LINGER_MS) { waiting = true; continue }
      this.levels.delete(index)
      this.toWorker({ t: 'dropLevel', id: level.id })
      level.a.close(); level.b.close()
    }
    if (waiting && this.tidying === null) this.tidying = window.setTimeout(() => { this.tidying = null; this.tidyLevels() }, LEVEL_LINGER_MS + 200)
  }

  /** Every couple of seconds: is each viewer's connection keeping up with what it is being sent? */
  private async lookAtViewers() {
    const ladder = this.ladder
    if (!ladder) return
    for (const [viewer, o] of this.out) {
      const current = o.option
      // Only once they are really being sent the level they were put on.
      if (!current || o.sentFrom !== this.levels.get(current.level)?.id) continue
      let availableKbps: number | null = null, lost: number | null = null
      try {
        const stats = await o.pc.getStats()
        stats.forEach(s => {
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && typeof s.availableOutgoingBitrate === 'number') availableKbps = s.availableOutgoingBitrate / 1000
          if (s.type === 'remote-inbound-rtp' && s.kind === 'video' && typeof s.fractionLost === 'number') lost = s.fractionLost
        })
      } catch { continue }
      if (this.ladder !== ladder || this.out.get(viewer) !== o || o.option !== current) continue
      // What they may have at the most, their connection aside.
      const most = bestOption(ladder.options, this.relayCeiling(o), { kbps: o.capKbps }, o.want)
      const above = optionAbove(ladder.options, current)
      const verdict = judge(o.health, { availableKbps, lost }, current, above && most && above.kbps <= most.kbps ? above : null, performance.now() - o.sentSince < SETTLE_MS)
      if (verdict === 'down') {
        const below = optionBelow(ladder.options, current)
        if (!below) continue
        o.heldKbps = below.kbps
      } else if (verdict === 'up' && above) o.heldKbps = above === most ? 0 : above.kbps
      else continue
      this.place(viewer, o)
    }
  }

  /** Tells a viewer's app what it can choose from and what it is being sent. Nothing to choose from = an encode of their own. */
  private tellViewer(o: Outgoing) {
    if (o.channel?.readyState !== 'open') return
    const on = o.option && o.sentFrom !== OWN ? { height: o.option.height, fps: o.option.fps } : null
    const choice: StreamChoice = { options: o.option ? this.allowed(o).map(({ height, fps, kbps }) => ({ height, fps, kbps })) : [], on }
    try { o.channel.send(JSON.stringify(choice)) } catch { /* the connection is closing */ }
  }

  /** A viewer said the most they want ("up to 720p at 30"), or that they want the best again. */
  private viewerChose(viewer: string, o: Outgoing, said: unknown) {
    if (this.out.get(viewer) !== o || typeof said !== 'string' || said.length > 200) return
    let want: unknown
    try { want = (JSON.parse(said) as { want?: unknown }).want } catch { return }
    const w = want as { height?: unknown; fps?: unknown } | null | undefined
    o.want = w && typeof w.height === 'number' && typeof w.fps === 'number' && w.height > 0 && w.fps > 0 ? { height: w.height, fps: w.fps } : null
    // Their choice is theirs: what their connection showed before is forgotten, and found out again if need be.
    o.heldKbps = 0
    o.health = newHealth()
    this.place(viewer, o)
    this.tellViewer(o)
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

  /** What a stream we are watching can be sent to us at, when its sharer's app is sharing levels; null otherwise. */
  choiceOf(streamer: string): (StreamChoice & { want: { height: number; fps: number } | null }) | null {
    const entry = this.incoming.get(streamer)
    return entry?.choice && entry.choice.options.length > 0 ? { ...entry.choice, want: entry.want ?? null } : null
  }

  /** Say the most we want of a stream ("up to 720p at 30"), or null for the best our connection takes. */
  chooseQuality(streamer: string, want: { height: number; fps: number } | null) {
    const entry = this.incoming.get(streamer)
    if (!entry) return
    entry.want = want
    if (entry.channel?.readyState === 'open') try { entry.channel.send(JSON.stringify({ want })) } catch { /* the stream is ending */ }
    this.deps.changed()
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
        this.place(from, sending)
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
        // The stream's own channel, when the sharer's app opens one: what we can choose from, and where we say what we chose.
        pc.ondatachannel = e => {
          if (e.channel.label !== 'quality' || this.incoming.get(from) !== receiving || receiving.pc !== pc) return
          receiving.channel = e.channel
          e.channel.onopen = () => { if (receiving.want) try { e.channel.send(JSON.stringify({ want: receiving.want })) } catch { /* closing */ } }
          e.channel.onmessage = m => {
            if (typeof m.data !== 'string' || m.data.length > 4000) return
            try {
              const told = JSON.parse(m.data) as StreamChoice
              const sized = (x: unknown): x is { height: number; fps: number; kbps: number } => !!x && typeof (x as { height: unknown }).height === 'number' && typeof (x as { fps: unknown }).fps === 'number'
              receiving.choice = { options: Array.isArray(told.options) ? told.options.filter(sized).slice(0, 12).map(o => ({ height: o.height, fps: o.fps, kbps: Number(o.kbps) || 0 })) : [], on: sized(told.on) ? { height: told.on.height, fps: told.on.fps } : null }
              this.deps.changed()
            } catch { /* not for us */ }
          }
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
