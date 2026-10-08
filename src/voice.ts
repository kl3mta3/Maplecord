import type { LocalAudioTrack, RemoteParticipant, RemoteTrackPublication, Room } from 'livekit-client'
import type { IceServerDto, SfuPassDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import { elementVolumeIgnored } from './volume'
import { isRelayed } from './transfer'
import { detectorUrl } from './voiceDetector'
import type { VoiceHub } from './voiceHub'

/**
 * Browser WebRTC voice: one RTCPeerConnection per other participant (full mesh), Opus with DTX
 * (silence costs ~nothing), VAD-style speaking detection on every stream.
 *
 * The gate: unless it is turned off, our voice is only sent while we are talking, so what goes out is what the
 * "speaking" light shows and the room's background does not. It works by pausing what each connection sends, never
 * by touching the microphone, and every way it can fail leaves the voice being sent.
 *
 * Topology (same as the server's contract): the newcomer offers to everyone already present;
 * existing participants only answer, so there is no offer glare.
 *
 * Privacy: when the server advertises a TURN relay and `relay` is requested, ICE is restricted to
 * relay candidates, so peers only ever see the relay's address, never yours. Without a relay the
 * connection is direct and the UI shows the one-time notice first.
 *
 * Through a stream server: where the voice channel has one, joining comes with a pass to it, and none of the
 * connecting above happens. This app makes one connection, to the stream server; it sends our voice there once and
 * collects everyone else's from it. Nobody's app talks to anybody else's. Everything after that is the same as in
 * the mesh: the gate, push to talk, each person's volume, the meters.
 */

/** The stream server library is only fetched (from this app's own files) the first time it is needed. */
const streamServer = () => import('livekit-client')
import { letGo, openRoom } from './sealedRoom'

/** How someone's voice is named in a stream server room: "a:" and their voice connection. */
const voiceOf = (identity: string) => (identity.startsWith('a:') ? identity.slice(2) : null)

/** Tried this many times in a row before a voice channel that keeps losing the stream server is given up on. */
const RECONNECT_TRIES = 4

/** Joining could not reach the stream server at all: there is no call to be in. */
export class VoiceConnectError extends Error {}
export type IcePolicy = 'relay' | 'direct'

export interface VoiceEngineEvents {
  peerState: (connectionId: string, state: string) => void
  speaking: (connectionId: string | null, speaking: boolean) => void
  level: (connectionId: string | null, level: number) => void
  log: (message: string) => void
  /** The stream server carrying this channel's voice was lost and could not be reached again: we are out of the call. */
  lost: (reason: string) => void
}

interface Peer {
  /** Our connection to this person, in the mesh. Null when their voice comes from the stream server. */
  pc: RTCPeerConnection | null
  audio: HTMLAudioElement
  meter?: Meter
  /** Whether our connection to them goes through the relay; null until it is connected and we can tell. */
  relayed?: boolean | null
}

interface Meter { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer>; speaking: boolean; lastAbove: number; src: MediaStreamAudioSourceNode; gain?: GainNode }

export const SPEAKING_THRESHOLD = 0.02
const SILENCE_HOLD_MS = 350

export class VoiceEngine {
  private hub: VoiceHub
  private events: VoiceEngineEvents
  private peers = new Map<string, Peer>()
  private local: MediaStream | null = null
  private localMeter: Meter | null = null
  private config: RTCConfiguration = {}
  private muted = false
  private meterTimer: number | undefined
  private outputDeviceId: string | null = null

  constructor(hub: VoiceHub, events: VoiceEngineEvents) { this.hub = hub; this.events = events }

  get active() { return this.local !== null }

  /** The servers and relay-or-direct choice this call is using; shared video uses exactly the same. */
  get rtcConfig(): RTCConfiguration { return this.config }

  /** The most our microphone may send to each person, in kilobits per second; 0 = leave it to the browser. Set by the server. */
  maxAudioKbps = 0

  /**
   * The server's own voice setting, in kilobits per second (0 = automatic). In a P2P channel a person may have
   * chosen a higher rate of their own; anyone they reach through the relay is sent no more than this instead.
   */
  relayedAudioKbps = 0

  private gateOn = true
  private gateThreshold = SPEAKING_THRESHOLD
  /** Whether we are talking, as far as the detector (or, failing that, the meter) can tell. */
  private talking = false
  /** Whether our voice is going out right now. With the gate off it always is. */
  private sending = true
  private detector: { node: AudioWorkletNode; heard: number } | null = null

  /** Whether to send our voice only while we are talking, and how loud counts as talking. */
  setGate(on: boolean, threshold: number) {
    this.gateOn = on
    this.gateThreshold = threshold
    this.detector?.node.port.postMessage({ threshold })
    if (!this.push) this.setSending(this.talking || !on)
  }

  private push = false

  /**
   * Push to talk. While it is on, the microphone is sent exactly while the key is held (and we are not muted),
   * whatever the detector hears; the "speaking" light follows the key. Turning it off hands the decision back to
   * the detector.
   */
  setPushToTalk(on: boolean, held: boolean) {
    this.push = on
    if (!on) { this.setSending(this.talking || !this.gateOn); return }
    const talking = held && !this.muted && !!this.local
    if (talking !== this.talking) { this.talking = talking; this.events.speaking(null, talking) }
    this.setSending(talking)
  }

  private setTalking(talking: boolean, keepSending = false) {
    if (this.push) return // the key decides, not the sound
    if (talking !== this.talking) { this.talking = talking; this.events.speaking(null, talking) }
    this.setSending(talking || !this.gateOn || keepSending)
  }

  private setSending(sending: boolean) {
    if (sending === this.sending) return
    this.sending = sending
    for (const peer of this.peers.values()) if (peer.pc) this.tuneSenders(peer.pc)
    this.tuneRoom()
  }

  /** Sets what one connection sends: the bitrate cap, and whether our voice goes out at all right now. Safe to call more than once. */
  private tuneSenders(pc: RTCPeerConnection) {
    // What this one connection may carry: our own rate when it is direct, the server's when it is on the relay.
    const peer = [...this.peers.values()].find(p => p.pc === pc)
    const kbps = () => (peer && peer.relayed !== false ? Math.min(this.maxAudioKbps || Infinity, this.relayedAudioKbps > 0 ? this.relayedAudioKbps : 32) : this.maxAudioKbps)
    for (const sender of pc.getSenders()) if (sender.track?.kind === 'audio') this.tuneSender(sender, () => pc.connectionState === 'closed', kbps)
  }

  /** The same for the one thing we send to a stream server. Asked for afresh each time: reconnecting gives it a new one. */
  private tuneRoom() {
    const room = this.room
    const sender = this.roomTrack?.sender
    if (room && sender) this.tuneSender(sender, () => this.room !== room)
  }

  private tuning = new WeakSet<RTCRtpSender>()

  private tuneSender(sender: RTCRtpSender, closed: () => boolean, kbps: () => number = () => this.maxAudioKbps) {
    if (closed() || this.tuning.has(sender)) return
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) return // not negotiated yet; tried again once connected
    const sending = this.sending
    for (const encoding of params.encodings) {
      encoding.active = sending
      const most = kbps()
      if (most > 0 && Number.isFinite(most)) encoding.maxBitrate = most * 1000
    }
    this.tuning.add(sender)
    void sender.setParameters(params).then(() => true, () => false).then(done => {
      this.tuning.delete(sender)
      // It changed its mind meanwhile, or could not be switched back on: a voice is never left off by accident.
      if (this.sending !== sending) this.tuneSender(sender, closed, kbps)
      else if (!done && sending) window.setTimeout(() => this.tuneSender(sender, closed, kbps), 200)
    })
  }

  /**
   * Starts the detector for this microphone (see voiceDetector.ts). Where it cannot run, the meter's timer stands in
   * for it, which is good enough while the window is showing.
   */
  private async listen(meter: Meter) {
    this.detector = null
    try {
      await meter.ctx.audioWorklet.addModule(detectorUrl())
      if (this.localMeter !== meter) return
      const node = new AudioWorkletNode(meter.ctx, 'voice-detector')
      const detector = { node, heard: Date.now() }
      node.port.onmessage = e => {
        if (this.detector !== detector) return
        detector.heard = Date.now()
        if (!this.muted) this.setTalking(e.data === true)
      }
      node.port.postMessage({ threshold: this.gateThreshold })
      // A node is only run while it leads somewhere, so this one is joined to the output through a gain of nothing.
      const nowhere = meter.ctx.createGain()
      nowhere.gain.value = 0
      meter.src.connect(node)
      node.connect(nowhere)
      nowhere.connect(meter.ctx.destination)
      this.detector = detector
    } catch (e) {
      this.events.log(`Listening for speech on a timer (${e instanceof Error ? e.message : e}).`)
    }
  }
  effectivePolicy: IcePolicy = 'direct'
  private wantedPolicy: IcePolicy = 'relay'

  /**
   * The relay's sign-in details run out after a while. Connections already made are not affected, but one made later
   * in the same call needs current ones: fresh details, the same rules as when the call was joined.
   */
  reconfigure(ice: IceServerDto[]) { if (this.joined) this.configure(ice, this.wantedPolicy) }

  /** Returns the policy actually in effect: relay only if a TURN server is available. */
  configure(ice: IceServerDto[], wanted: IcePolicy): IcePolicy {
    this.wantedPolicy = wanted
    const hasTurn = ice.some(s => s.urls.some(u => /^turns?:/i.test(u)))
    const policy: IcePolicy = wanted === 'relay' && hasTurn ? 'relay' : 'direct'
    this.config = {
      iceServers: ice.map(s => ({ urls: s.urls, username: s.username ?? undefined, credential: s.credential ?? undefined })),
      // Asked for relayed, it is relay-only even with no relay to use: such a call fails to connect rather than connecting some other way.
      iceTransportPolicy: wanted === 'relay' ? 'relay' : 'all',
    }
    this.effectivePolicy = policy
    return policy
  }

  setDevices(inputDeviceId: string | null, outputDeviceId: string | null) {
    this.outputDeviceId = outputDeviceId
    this.inputDeviceId = inputDeviceId
  }

  /**
   * Change microphone or speakers without leaving the call. False if the microphone could not be swapped in place
   * (there was none to begin with, or the new one would not open); the choice is still remembered for next time.
   */
  async switchDevices(inputDeviceId: string | null, outputDeviceId: string | null): Promise<boolean> {
    if (outputDeviceId !== this.outputDeviceId) {
      this.outputDeviceId = outputDeviceId
      for (const peer of this.peers.values()) {
        const audio = peer.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        void audio.setSinkId?.(outputDeviceId ?? '').catch(() => {})
        const ctx = peer.meter?.gain ? peer.meter.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> } : null
        void ctx?.setSinkId?.(outputDeviceId ?? '').catch(() => {})
      }
    }
    if (inputDeviceId === this.inputDeviceId) return true
    this.inputDeviceId = inputDeviceId
    if (!this.joined) return true
    if (!this.local) return false
    return this.reopenMicrophone()
  }

  /**
   * The app is in front again. A phone stops a page's microphone and its sound while the browser is in the
   * background, and does not always hand them back by itself: start the sound again, and open the microphone again
   * if it was ended.
   */
  async recover(): Promise<void> {
    if (!this.joined) return
    for (const peer of this.peers.values()) {
      void peer.audio.play().catch(() => { /* needs a tap; the next one anywhere does it */ })
      void peer.meter?.ctx.resume().catch(() => { /* closed */ })
    }
    void this.localMeter?.ctx.resume().catch(() => { /* closed */ })
    const track = this.local?.getAudioTracks()[0]
    if (this.local && (!track || track.readyState === 'ended')) await this.reopenMicrophone()
  }

  private async reopenMicrophone(): Promise<boolean> {
    if (!this.local) return false
    const inputDeviceId = this.inputDeviceId
    const sitting = this.sitting
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      // The call was left while the microphone was opening: it is closed again.
      if (this.sitting !== sitting || !this.local) { for (const t of fresh.getTracks()) t.stop(); return false }
      const track = fresh.getAudioTracks()[0]
      track.enabled = !this.muted && !this.silencedSelf
      for (const peer of this.peers.values()) {
        const sender = peer.pc?.getSenders().find(s => s.track?.kind === 'audio')
        if (sender) await sender.replaceTrack(track)
      }
      // Through a stream server there is one thing being sent; it is swapped in place (or sent for the first time).
      if (this.roomTrack) { await this.roomTrack.replaceTrack(track, true); this.tuneRoom() }
      else if (this.room && !this.silencedSelf) await this.sendMicrophone(this.room, track)
      for (const old of this.local.getTracks()) old.stop()
      if (this.localMeter) { this.localMeter.src.disconnect(); void this.localMeter.ctx.close() }
      this.local = fresh
      this.localMeter = this.makeMeter(fresh)
      void this.listen(this.localMeter)
      return true
    } catch (e) {
      this.events.log(`Could not open the microphone: ${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  private master = 1
  private deafened = false
  /** Everyone at once: how loud they are played (0 to 1), or not at all. */
  setOutput(volume: number, deafened: boolean) {
    this.master = Math.max(0, Math.min(1, volume))
    this.deafened = deafened
    for (const [id, peer] of this.peers) this.applyAudio(id, peer)
  }
  private inputDeviceId: string | null = null

  private joined = false
  /** Goes up with every join and every leave, so work begun for one call can tell that it is no longer the current one. */
  private sitting = 0
  /** Set while a join is opening the microphone. Set-up messages from other apps that arrive meanwhile wait for it. */
  private opening: Promise<void> | null = null

  /**
   * Joins the mesh. If the microphone is unavailable (denied, missing) we still connect receive-only,
   * so you can listen; the error is rethrown after the offers go out so the UI can say "no microphone".
   *
   * Opening the microphone can take as long as the person takes to answer the browser's question. If the call is left
   * (or another one joined) in that time, the microphone is closed again and nothing is sent anywhere.
   */
  async join(existing: VoiceParticipantDto[], pass: SfuPassDto | null = null, silenced = false) {
    await this.leave()
    this.silencedSelf = silenced
    for (const p of existing) if (p.silenced) this.silencedPeers.add(p.connectionId)
    const sitting = ++this.sitting
    this.joined = true
    this.viaServer = pass !== null
    let micError: unknown = null
    let opened!: () => void
    const opening = new Promise<void>(resolve => { opened = resolve })
    this.opening = opening
    try {
      const local = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.inputDeviceId ? { exact: this.inputDeviceId } : undefined,
          echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
        },
      })
      if (this.sitting !== sitting) { for (const t of local.getTracks()) t.stop(); return }
      this.local = local
      if (this.muted || this.silencedSelf) for (const t of this.local.getAudioTracks()) t.enabled = false
      this.localMeter = this.makeMeter(this.local)
      void this.listen(this.localMeter)
      this.events.log(`Microphone started (${this.effectivePolicy === 'relay' ? 'relayed' : 'direct'}).`)
    } catch (e) {
      if (this.sitting !== sitting) return
      micError = e
      this.local = null
      this.events.log(`No microphone (${e instanceof Error ? e.message : e}); joining receive-only.`)
    } finally {
      if (this.opening === opening) this.opening = null
      opened()
    }
    this.startMetering()

    if (pass) {
      // One connection, to the stream server; nobody is offered anything.
      try { await this.connectRoom(pass) }
      catch (e) {
        if (this.sitting !== sitting) return
        this.events.log(`Could not reach the stream server: ${e instanceof Error ? e.message : e}`)
        await this.leave()
        throw new VoiceConnectError('Could not connect to this voice channel. Try again in a moment.')
      }
      if (this.sitting !== sitting) return
    } else {
      for (const p of existing) {
        if (this.sitting !== sitting) return
        try { await this.offer(p.connectionId) }
        catch (e) { this.events.log(`Offer to ${p.username} failed: ${e instanceof Error ? e.message : e}`) }
      }
    }
    if (micError) throw micError
  }

  // ---- Through a stream server -------------------------------------------------------------------------------------

  /** This call's voice goes through a stream server rather than from app to app. */
  private viaServer = false
  private room: Room | null = null
  /** Our microphone as the stream server library holds it. */
  private roomTrack: LocalAudioTrack | null = null

  /** Connects to the channel's room, sends our microphone there, and starts collecting everyone else's voice. */
  private async connectRoom(pass: SfuPassDto) {
    const { RoomEvent, Track } = await streamServer()
    const sitting = this.sitting
    // The microphone is ours: the library must neither stop it nor open another by itself. What is sent into the
    // room is encrypted here first, with the key that came with the pass (see sealedRoom).
    const room = await openRoom({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: false }, pass,
      why => this.events.log(`Something from the stream server could not be decrypted (${why}).`))
    // Left while the room was being made ready: it is let go of unused.
    if (this.sitting !== sitting || this.room) { letGo(room); return }
    this.room = room
    // Whether this room ever connected. One that never did also reports itself "disconnected"; whoever asked for it
    // hears that as an error and decides what happens next, so it must not also start a round of retries here.
    let up = false
    const mine = () => this.room === room
    const want = (publication: RemoteTrackPublication, from: RemoteParticipant) => {
      // Voices only: a shared screen in the same room is collected by the stream engine, and only when watched.
      if (voiceOf(from.identity) && publication.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone) publication.setSubscribed(true)
    }
    room.on(RoomEvent.ParticipantConnected, who => { const id = voiceOf(who.identity); if (id && mine()) this.events.peerState(id, 'connected') })
    room.on(RoomEvent.TrackPublished, (publication, who) => { if (mine()) want(publication, who) })
    room.on(RoomEvent.TrackSubscribed, (track, _publication, who) => {
      const id = voiceOf(who.identity)
      if (id && mine() && track.kind === Track.Kind.Audio) this.hear(id, track.mediaStreamTrack)
    })
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, who) => {
      const id = voiceOf(who.identity)
      if (id && mine() && track.kind === Track.Kind.Audio) this.dropPeer(id)
    })
    room.on(RoomEvent.Reconnected, () => { if (mine()) this.tuneRoom() })
    // The stream server stopped taking our microphone, or takes it again (see setSilenced).
    room.on(RoomEvent.ParticipantPermissionsChanged, (_before, who) => {
      if (!mine() || who !== room.localParticipant) return
      if (!who.permissions?.canPublish) { this.roomTrack = null; return }
      const microphone = this.local?.getAudioTracks()[0]
      if (!this.silencedSelf && !this.roomTrack && microphone) void this.sendMicrophone(room, microphone).catch(() => { /* it is offered again when we are told we may speak */ })
    })
    room.on(RoomEvent.Disconnected, () => {
      if (!mine() || !up) return
      // Dropped without our asking. Whatever we were hearing is gone with it; try to get back in.
      this.room = null
      this.roomTrack = null
      for (const id of [...this.peers.keys()]) { this.dropPeer(id); this.events.peerState(id, 'connecting') }
      void this.reconnectRoom(1)
    })
    // No address-finding servers of anyone's: the stream server has a public address and we simply connect to it.
    await room.connect(pass.url, pass.token, { autoSubscribe: false, rtcConfig: { iceServers: [] } })
    up = true
    if (!mine()) { void room.disconnect(); return }

    const microphone = this.local?.getAudioTracks()[0]
    // Someone who cannot be heard here has a pass that takes no microphone: nothing is offered.
    if (microphone && !this.silencedSelf) await this.sendMicrophone(room, microphone)
    if (!mine()) return
    for (const who of room.remoteParticipants.values()) {
      const id = voiceOf(who.identity)
      if (!id) continue
      this.events.peerState(id, 'connected')
      for (const publication of who.trackPublications.values()) want(publication, who)
    }
  }

  private async sendMicrophone(room: Room, microphone: MediaStreamTrack) {
    const { Track } = await streamServer()
    // Speech settings: silence costs next to nothing, and the bitrate is the server's (or 32 kbps left to ourselves).
    const published = await room.localParticipant.publishTrack(microphone, {
      source: Track.Source.Microphone, dtx: true, red: false, forceStereo: false, stopMicTrackOnMute: false,
      audioPreset: { maxBitrate: (this.maxAudioKbps > 0 ? this.maxAudioKbps : 32) * 1000 },
    })
    if (this.room !== room) return
    this.roomTrack = (published.track as LocalAudioTrack | undefined) ?? null
    this.tuneRoom()
  }

  /** The stream server dropped us mid-call: ask for a new pass and go back in, a few times at most. */
  private async reconnectRoom(attempt: number) {
    await new Promise(r => setTimeout(r, 1000 * attempt))
    if (!this.joined || !this.viaServer || this.room) return
    try {
      const pass = await this.hub.voicePass()
      if (!this.joined || !this.viaServer || this.room) return
      if (!pass) throw new Error('This channel no longer has a stream server.')
      await this.connectRoom(pass)
    } catch (e) {
      if (!this.joined || !this.viaServer) return
      const room = this.room as Room | null
      this.room = null
      this.roomTrack = null
      void room?.disconnect()
      this.events.log(`Could not get back to the stream server (${e instanceof Error ? e.message : e}).`)
      if (attempt < RECONNECT_TRIES) void this.reconnectRoom(attempt + 1)
      else this.events.lost('The connection to this voice channel was lost.')
    }
  }

  /** Someone's voice arrived from the stream server: play it, meter it, at the volume chosen for them. */
  private hear(connectionId: string, track: MediaStreamTrack) {
    this.dropPeer(connectionId)
    const audio = this.makeAudio()
    const peer: Peer = { pc: null, audio }
    const stream = new MediaStream([track])
    audio.srcObject = stream
    void audio.play().catch(() => {})
    peer.meter = this.makeMeter(stream)
    this.peers.set(connectionId, peer)
    this.applyAudio(connectionId, peer)
    this.events.peerState(connectionId, 'connected')
  }

  /** Stops playing one person, keeping what was chosen for their volume in case they come back. */
  private dropPeer(connectionId: string) {
    const peer = this.peers.get(connectionId)
    if (!peer) return
    this.peers.delete(connectionId)
    try { peer.pc?.close() } catch { /* already closed */ }
    if (peer.meter) { peer.meter.src.disconnect(); void peer.meter.ctx.close() }
    peer.audio.srcObject = null
    peer.audio.remove()
    this.events.speaking(connectionId, false)
  }

  private makeAudio(): HTMLAudioElement {
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.style.display = 'none'
    document.body.appendChild(audio)
    if (this.outputDeviceId && 'setSinkId' in audio) void (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(this.outputDeviceId).catch(() => {})
    return audio
  }

  async leave() {
    this.sitting++
    this.joined = false
    this.viaServer = false
    const room = this.room
    this.room = null
    this.roomTrack = null
    void room?.disconnect()
    for (const id of [...this.peers.keys()]) await this.removePeer(id)
    window.clearInterval(this.meterTimer)
    if (this.localMeter) { this.localMeter.src.disconnect(); void this.localMeter.ctx.close(); this.localMeter = null }
    if (this.local) { for (const t of this.local.getTracks()) t.stop(); this.local = null }
    this.detector = null
    this.talking = false
    this.silencedSelf = false
    this.silencedPeers.clear()
    // With push to talk on, nothing is sent until the key is held, from the first moment of the next call.
    this.sending = !this.push
    this.events.speaking(null, false)
  }

  // ---- Not being heard: no right to speak in this channel, or muted by a moderator ------------------------------------
  // Three things make it hold. Our own app sends nothing while we are silenced. Where voice goes through a stream
  // server, that server takes no microphone from someone silenced, whatever their app does. And every app plays
  // nothing from someone the server marks as silenced, which is what holds it in app-to-app calls.

  private silencedSelf = false
  private silencedPeers = new Set<string>()

  /** Whether we ourselves can be heard in this call. When not, nothing is sent, whatever the mute button says. */
  setSilenced(silenced: boolean) {
    if (this.silencedSelf === silenced) return
    this.silencedSelf = silenced
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !this.muted && !silenced
    if (silenced) { this.roomTrack = null; if (!this.push) this.setTalking(false); return }
    // Heard again. Through a stream server the microphone has to be offered afresh; if the server there has not
    // caught up yet, it is offered when it has (see ParticipantPermissionsChanged).
    const microphone = this.local?.getAudioTracks()[0]
    if (this.room && !this.roomTrack && microphone) void this.sendMicrophone(this.room, microphone).catch(() => {})
  }

  /** Whether someone else in the call can be heard. When not, nothing of theirs is played here. */
  setPeerSilenced(connectionId: string, silenced: boolean) {
    if (silenced) this.silencedPeers.add(connectionId); else this.silencedPeers.delete(connectionId)
    const peer = this.peers.get(connectionId)
    if (peer) this.applyAudio(connectionId, peer)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !muted && !this.silencedSelf
    if (muted) { if (this.push) this.setPushToTalk(true, false); else this.setTalking(false) }
  }

  private wanted = new Map<string, { volume: number; muted: boolean }>()

  /** How loud to play one person (0 to 2, 1 = as sent), or not at all. Remembered until they leave, applied as soon as their audio arrives. */
  setPeerAudio(connectionId: string, volume: number, muted: boolean) {
    this.wanted.set(connectionId, { volume: Math.max(0, Math.min(2, volume)), muted })
    const peer = this.peers.get(connectionId)
    if (peer) this.applyAudio(connectionId, peer)
  }

  private applyAudio(connectionId: string, peer: Peer) {
    const chosen = this.wanted.get(connectionId) ?? { volume: 1, muted: false }
    const want = { volume: chosen.volume * this.master, muted: chosen.muted || this.deafened || this.silencedPeers.has(connectionId) }
    const meter = peer.meter
    // An iPhone ignores the element's volume altogether (see volume.ts), so there quieter goes the same way as louder,
    // as long as the context is allowed to make a sound; if it is not, full volume beats silence.
    const quieterHere = want.volume < 1 && elementVolumeIgnored() && meter?.ctx.state === 'running'
    if (!want.muted && (want.volume > 1 || quieterHere) && meter) {
      // An audio element cannot go above 100%, so louder than that is played through a gain node instead. The
      // element stays attached but silent: Chromium only feeds a remote stream to Web Audio while one is playing it.
      if (!meter.gain) {
        meter.gain = meter.ctx.createGain()
        meter.src.connect(meter.gain)
        meter.gain.connect(meter.ctx.destination)
        const sinkable = meter.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
        if (this.outputDeviceId && sinkable.setSinkId) void sinkable.setSinkId(this.outputDeviceId).catch(() => {})
      }
      meter.gain.gain.value = want.volume
      peer.audio.muted = true
      return
    }
    if (meter?.gain) { meter.gain.disconnect(); meter.gain = undefined }
    peer.audio.muted = want.muted
    peer.audio.volume = Math.min(1, want.volume)
  }

  async removePeer(connectionId: string) {
    this.wanted.delete(connectionId)
    this.silencedPeers.delete(connectionId)
    this.dropPeer(connectionId)
  }

  async handleSignal(s: VoiceSignalDto) {
    // Through a stream server no app sets anything up with another.
    if (!this.joined || this.viaServer) return
    // We may have only just joined, with our own microphone still opening. The connection is made once it is open, so
    // that it carries our voice as well as theirs. (Messages that wait here are handled in the order they came.)
    if (this.opening) { await this.opening; if (!this.joined || this.viaServer) return }
    try {
      if (s.kind === 'offer') {
        const peer = this.getOrCreatePeer(s.fromConnectionId)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.payload })
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(this.tune(answer))
        await this.hub.signal(s.fromConnectionId, 'answer', peer.pc.localDescription!.sdp)
      } else if (s.kind === 'answer') {
        const peer = this.peers.get(s.fromConnectionId)
        if (peer?.pc) await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.payload })
      } else if (s.kind === 'ice') {
        const peer = this.peers.get(s.fromConnectionId)
        const ice = JSON.parse(s.payload) as { candidate: string; sdpMid: string | null; sdpMLineIndex: number }
        if (peer?.pc && ice.candidate) await peer.pc.addIceCandidate(ice)
      }
    } catch (e) {
      this.events.log(`Signal ${s.kind} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  // ---- internals ----------------------------------------------------------

  private async offer(remote: string) {
    const peer = this.getOrCreatePeer(remote)
    const offer = await peer.pc.createOffer({ offerToReceiveAudio: true })
    await peer.pc.setLocalDescription(this.tune(offer))
    await this.hub.signal(remote, 'offer', peer.pc.localDescription!.sdp)
  }

  private getOrCreatePeer(remote: string): Peer & { pc: RTCPeerConnection } {
    const existing = this.peers.get(remote)
    if (existing?.pc) return existing as Peer & { pc: RTCPeerConnection }

    const pc = new RTCPeerConnection(this.config)
    if (this.local) for (const track of this.local.getAudioTracks()) pc.addTrack(track, this.local)
    else pc.addTransceiver('audio', { direction: 'recvonly' })
    this.tuneSenders(pc)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'connected') return
      this.tuneSenders(pc)
      // Once connected we can tell whether this person is reached through the relay, and set the rate to match.
      void isRelayed(pc).catch(() => true).then(relayed => { const peer = this.peers.get(remote); if (peer?.pc === pc) { peer.relayed = relayed; this.tuneSenders(pc) } })
    })

    const audio = this.makeAudio()

    const peer: Peer & { pc: RTCPeerConnection } = { pc, audio }
    pc.ontrack = ev => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track])
      audio.srcObject = stream
      void audio.play().catch(() => {})
      peer.meter = this.makeMeter(stream)
      this.applyAudio(remote, peer)
    }
    pc.onicecandidate = ev => {
      if (!ev.candidate) return
      const c = ev.candidate
      void this.hub.signal(remote, 'ice', JSON.stringify({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex ?? 0 }))
    }
    pc.onconnectionstatechange = () => {
      this.events.peerState(remote, pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') void this.removePeer(remote)
    }
    this.peers.set(remote, peer)
    this.events.peerState(remote, 'connecting')
    return peer
  }

  /** Opus: DTX on (silence is nearly free), 24 kbps cap, mono. Done by SDP munging, which every browser honours. */
  private tune(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    const sdp = (desc.sdp ?? '').replace(/a=fmtp:(\d+) (.*minptime=10.*)/g, (_m, pt, rest) =>
      `a=fmtp:${pt} ${rest};usedtx=1;maxaveragebitrate=24000;stereo=0;sprop-stereo=0`)
    return { type: desc.type, sdp }
  }

  private makeMeter(stream: MediaStream): Meter {
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    return { ctx, analyser, buf: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>, speaking: false, lastAbove: 0, src }
  }

  private startMetering() {
    window.clearInterval(this.meterTimer)
    this.meterTimer = window.setInterval(() => {
      if (this.localMeter && !this.muted) {
        this.measure(this.localMeter, null)
        // The detector decides while it is running. This timer only stands in for it, and not in a hidden window,
        // where timers are slowed down too far to follow speech: there the voice is simply sent.
        const detecting = !!this.detector && Date.now() - this.detector.heard < 800
        if (!detecting) this.setTalking(this.localMeter.speaking, document.hidden)
      }
      for (const [id, peer] of this.peers) if (peer.meter) this.measure(peer.meter, id)
    }, 80)
  }

  private measure(m: Meter, id: string | null) {
    m.analyser.getFloatTimeDomainData(m.buf)
    let sum = 0
    for (const v of m.buf) sum += v * v
    const rms = Math.sqrt(sum / m.buf.length)
    this.events.level(id, Math.min(1, rms * 4))
    const now = Date.now()
    // Our own light is set by setTalking, so that it shows exactly when our voice is being sent.
    if (rms >= (id === null ? this.gateThreshold : SPEAKING_THRESHOLD)) {
      m.lastAbove = now
      if (!m.speaking) { m.speaking = true; if (id !== null) this.events.speaking(id, true) }
    } else if (m.speaking && now - m.lastAbove > SILENCE_HOLD_MS) {
      m.speaking = false
      if (id !== null) this.events.speaking(id, false)
    }
  }
}

export async function listAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return { inputs: all.filter(d => d.kind === 'audioinput'), outputs: all.filter(d => d.kind === 'audiooutput') }
}
