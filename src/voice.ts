import type { IceServerDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import type { VoiceHub } from './voiceHub'

/**
 * Browser WebRTC voice: one RTCPeerConnection per other participant (full mesh), Opus with DTX
 * (silence costs ~nothing), VAD-style speaking detection on every stream.
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

const SPEAKING_THRESHOLD = 0.02
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
  effectivePolicy: IcePolicy = 'direct'

  /** Returns the policy actually in effect: relay only if a TURN server is available. */
  configure(ice: IceServerDto[], wanted: IcePolicy): IcePolicy {
    const hasTurn = ice.some(s => s.urls.some(u => /^turns?:/i.test(u)))
    const policy: IcePolicy = wanted === 'relay' && hasTurn ? 'relay' : 'direct'
    this.config = {
      iceServers: ice.map(s => ({ urls: s.urls, username: s.username ?? undefined, credential: s.credential ?? undefined })),
      iceTransportPolicy: policy === 'relay' ? 'relay' : 'all',
    }
    this.effectivePolicy = policy
    return policy
  }

  setDevices(inputDeviceId: string | null, outputDeviceId: string | null) {
    this.outputDeviceId = outputDeviceId
    this.inputDeviceId = inputDeviceId
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
    this.events.speaking(null, false)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !muted
    if (muted) this.events.speaking(null, false)
  }

  private wanted = new Map<string, { volume: number; muted: boolean }>()

  /** How loud to play one person (0 to 2, 1 = as sent), or not at all. Remembered until they leave, applied as soon as their audio arrives. */
  setPeerAudio(connectionId: string, volume: number, muted: boolean) {
    this.wanted.set(connectionId, { volume: Math.max(0, Math.min(2, volume)), muted })
    const peer = this.peers.get(connectionId)
    if (peer) this.applyAudio(connectionId, peer)
  }

  private applyAudio(connectionId: string, peer: Peer) {
    const want = this.wanted.get(connectionId) ?? { volume: 1, muted: false }
    const meter = peer.meter
    if (!want.muted && want.volume > 1 && meter) {
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
      if (this.localMeter && !this.muted) this.measure(this.localMeter, null)
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
    if (rms >= SPEAKING_THRESHOLD) {
      m.lastAbove = now
      if (!m.speaking) { m.speaking = true; this.events.speaking(id, true) }
    } else if (m.speaking && now - m.lastAbove > SILENCE_HOLD_MS) {
      m.speaking = false
      this.events.speaking(id, false)
    }
  }
}

export async function listAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return { inputs: all.filter(d => d.kind === 'audioinput'), outputs: all.filter(d => d.kind === 'audiooutput') }
}
