import type { IceServerDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import { elementVolumeIgnored } from './volume'
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
 */
export type IcePolicy = 'relay' | 'direct'

export interface VoiceEngineEvents {
  peerState: (connectionId: string, state: string) => void
  speaking: (connectionId: string | null, speaking: boolean) => void
  level: (connectionId: string | null, level: number) => void
  log: (message: string) => void
}

interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  meter?: Meter
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
    this.setSending(this.talking || !on)
  }

  private setTalking(talking: boolean, keepSending = false) {
    if (talking !== this.talking) { this.talking = talking; this.events.speaking(null, talking) }
    this.setSending(talking || !this.gateOn || keepSending)
  }

  private setSending(sending: boolean) {
    if (sending === this.sending) return
    this.sending = sending
    for (const peer of this.peers.values()) this.tuneSenders(peer.pc)
  }

  /** Sets what one connection sends: the bitrate cap, and whether our voice goes out at all right now. Safe to call more than once. */
  private tuneSenders(pc: RTCPeerConnection) {
    for (const sender of pc.getSenders()) if (sender.track?.kind === 'audio') this.tuneSender(pc, sender)
  }

  private tuning = new WeakSet<RTCRtpSender>()

  private tuneSender(pc: RTCPeerConnection, sender: RTCRtpSender) {
    if (pc.connectionState === 'closed' || this.tuning.has(sender)) return
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) return // not negotiated yet; tried again once connected
    const sending = this.sending
    for (const encoding of params.encodings) {
      encoding.active = sending
      if (this.maxAudioKbps > 0) encoding.maxBitrate = this.maxAudioKbps * 1000
    }
    this.tuning.add(sender)
    void sender.setParameters(params).then(() => true, () => false).then(done => {
      this.tuning.delete(sender)
      // It changed its mind meanwhile, or could not be switched back on: a voice is never left off by accident.
      if (this.sending !== sending) this.tuneSender(pc, sender)
      else if (!done && sending) window.setTimeout(() => this.tuneSender(pc, sender), 200)
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

  /** Returns the policy actually in effect: relay only if a TURN server is available. */
  configure(ice: IceServerDto[], wanted: IcePolicy): IcePolicy {
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
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      const track = fresh.getAudioTracks()[0]
      track.enabled = !this.muted
      for (const peer of this.peers.values()) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio')
        if (sender) await sender.replaceTrack(track)
      }
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

  /**
   * Joins the mesh. If the microphone is unavailable (denied, missing) we still connect receive-only,
   * so you can listen; the error is rethrown after the offers go out so the UI can say "no microphone".
   */
  async join(existing: VoiceParticipantDto[]) {
    await this.leave()
    this.joined = true
    let micError: unknown = null
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.inputDeviceId ? { exact: this.inputDeviceId } : undefined,
          echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
        },
      })
      if (this.muted) for (const t of this.local.getAudioTracks()) t.enabled = false
      this.localMeter = this.makeMeter(this.local)
      void this.listen(this.localMeter)
      this.events.log(`Microphone started (${this.effectivePolicy === 'relay' ? 'relayed' : 'direct'}).`)
    } catch (e) {
      micError = e
      this.local = null
      this.events.log(`No microphone (${e instanceof Error ? e.message : e}); joining receive-only.`)
    }
    this.startMetering()

    for (const p of existing) {
      try { await this.offer(p.connectionId) }
      catch (e) { this.events.log(`Offer to ${p.username} failed: ${e instanceof Error ? e.message : e}`) }
    }
    if (micError) throw micError
  }

  async leave() {
    this.joined = false
    for (const id of [...this.peers.keys()]) await this.removePeer(id)
    window.clearInterval(this.meterTimer)
    if (this.localMeter) { this.localMeter.src.disconnect(); void this.localMeter.ctx.close(); this.localMeter = null }
    if (this.local) { for (const t of this.local.getTracks()) t.stop(); this.local = null }
    this.detector = null
    this.talking = false
    this.sending = true
    this.events.speaking(null, false)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !muted
    if (muted) this.setTalking(false)
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
    const want = { volume: chosen.volume * this.master, muted: chosen.muted || this.deafened }
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
    const peer = this.peers.get(connectionId)
    if (!peer) return
    this.peers.delete(connectionId)
    this.wanted.delete(connectionId)
    try { peer.pc.close() } catch { /* already closed */ }
    if (peer.meter) { peer.meter.src.disconnect(); void peer.meter.ctx.close() }
    peer.audio.srcObject = null
    peer.audio.remove()
    this.events.speaking(connectionId, false)
  }

  async handleSignal(s: VoiceSignalDto) {
    if (!this.joined) return
    try {
      if (s.kind === 'offer') {
        const peer = this.getOrCreatePeer(s.fromConnectionId)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.payload })
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(this.tune(answer))
        await this.hub.signal(s.fromConnectionId, 'answer', peer.pc.localDescription!.sdp)
      } else if (s.kind === 'answer') {
        const peer = this.peers.get(s.fromConnectionId)
        if (peer) await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.payload })
      } else if (s.kind === 'ice') {
        const peer = this.peers.get(s.fromConnectionId)
        const ice = JSON.parse(s.payload) as { candidate: string; sdpMid: string | null; sdpMLineIndex: number }
        if (peer && ice.candidate) await peer.pc.addIceCandidate(ice)
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

  private getOrCreatePeer(remote: string): Peer {
    const existing = this.peers.get(remote)
    if (existing) return existing

    const pc = new RTCPeerConnection(this.config)
    if (this.local) for (const track of this.local.getAudioTracks()) pc.addTrack(track, this.local)
    else pc.addTransceiver('audio', { direction: 'recvonly' })
    this.tuneSenders(pc)
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') this.tuneSenders(pc) })

    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.style.display = 'none'
    document.body.appendChild(audio)
    if (this.outputDeviceId && 'setSinkId' in audio) void (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(this.outputDeviceId).catch(() => {})

    const peer: Peer = { pc, audio }
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
