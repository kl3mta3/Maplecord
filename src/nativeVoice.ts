import type { VoiceProbe } from './voiceReport'
import type { IceServerDto, SfuPassDto, VoiceParticipantDto, VoiceSignalDto } from './types'
import type { VoiceHub } from './voiceHub'
import type { IcePolicy, VoiceEngineEvents } from './voice'
import { VoiceConnectError } from './voiceErrors.ts'
import { nativeVoice, type NativeStat, type NativeVoicePlugin } from './native/app.ts'

/**
 * Voice in the iPhone app. The same call as voice.ts makes, with the same set-up messages, the same topology (the
 * newcomer offers, those present answer), the same gate, push to talk, volumes and lights, through the same VoiceHub:
 * nothing on the server or in anyone else's app can tell the two apart. The difference is where the sound is done.
 *
 * A page's microphone and sound stop when an iPhone puts the app in the background or locks its screen. So here the
 * page does none of it. The shell around the page (see Maplecord-iOS) holds the connections, the microphone and the
 * speaker, and tells the phone that a call is on, which is what keeps them running with the screen off, the same way a
 * phone call does. This file is the page's half: it decides, and the shell carries out.
 *
 *  - App to app: the page makes and reads the offer, answer and ICE messages exactly as voice.ts does (down to the
 *    Opus settings written into them), and hands each to the shell, which owns the connection they are about.
 *  - Through a stream server: the page hands the shell the pass (address, token and the room's end-to-end key), and
 *    the shell makes the one connection and encrypts what it sends the same way the page would have.
 *  - The shell reports how loud everyone is a dozen times a second; the page turns that into the lights and the gate,
 *    with the same thresholds as voice.ts, and tells the shell what to send.
 */

const RECONNECT_TRIES = 4
const SPEAKING_THRESHOLD = 0.02
const BOT_SOUND_THRESHOLD = 0.0002
const SILENCE_HOLD_MS = 350

interface Peer {
  /** Whether this is a connection of ours in the mesh (as opposed to a voice from the stream server). */
  mesh: boolean
  /** Whether their voice has started arriving. */
  heard: boolean
  relayed?: boolean | null
  ownRelay?: boolean
  speaking: boolean
  lastAbove: number
}

export class NativeVoiceEngine {
  private hub: VoiceHub
  private events: VoiceEngineEvents
  private shell: NativeVoicePlugin
  private peers = new Map<string, Peer>()
  /** Whether the microphone is open (ours to send). */
  private local = false
  private muted = false
  private listening: Array<{ remove: () => Promise<void> }> = []
  private iceServers: { urls: string[]; username?: string; credential?: string }[] = []
  private relayOnly = true
  private config: RTCConfiguration = {}

  constructor(hub: VoiceHub, events: VoiceEngineEvents, shell: NativeVoicePlugin = nativeVoice()) { this.hub = hub; this.events = events; this.shell = shell }

  get active() { return this.local }
  get sendingNow() { return this.sending && !this.muted }
  get mutedNow() { return this.muted }
  get deafenedNow() { return this.deafened }
  get carriedHow() { return this.viaServer ? 'Voice goes through the stream server (the phone app does the sound).' : 'Voice goes from app to app, or through the relay where it has to (the phone app does the sound).' }
  /** The servers and relay-or-direct choice this call is using; shared video would use the same (none on the phone yet). */
  get rtcConfig(): RTCConfiguration { return this.config }

  reportProbes(nameOf: (connectionId: string) => string): VoiceProbe[] {
    const probes: VoiceProbe[] = []
    if (this.viaServer && this.local) probes.push({ who: 'me', name: 'me', sends: true, receives: false, stats: () => this.shell.roomStats({ id: null }).then(r => asReport(r.stats)) })
    for (const [id, peer] of this.peers) {
      if (peer.mesh) probes.push({ who: id, name: nameOf(id), sends: true, receives: true, stats: () => this.shell.peerStats({ id, part: 'all' }).then(r => asReport(r.stats)) })
      else probes.push({ who: id, name: nameOf(id), sends: false, receives: true, stats: () => this.shell.roomStats({ id }).then(r => asReport(r.stats)) })
    }
    return probes
  }

  maxAudioKbps = 0
  relayedAudioKbps = 0

  // ---- The gate, push to talk ------------------------------------------------------------------------------------
  //
  // On the phone the gate does not hold the voice back: it is sent whenever the microphone is on (the phone's own
  // noise suppression cleans it, and silence costs next to nothing to send). How loud counts as talking still decides
  // when our light shows. Holding the voice back until it was heard is what kept the phone silent: the stream server
  // way measured our voice from what we sent, so once held back it could never be heard starting again. Push to talk
  // still sends only while held.

  private gateThreshold = SPEAKING_THRESHOLD
  private talking = false
  private sending = true
  private push = false

  setGate(_on: boolean, threshold: number) {
    this.gateThreshold = threshold
    if (!this.push) this.setSending(true)
  }

  /** The shell keeps listening for speech whether the page is showing or not: nothing changes here when it is hidden. */
  setBackground(_hidden: boolean) { /* the shell does not stop in the background */ }

  setPushToTalk(on: boolean, held: boolean) {
    this.push = on
    if (!on) { this.setSending(true); return }
    const talking = held && !this.muted && this.local
    if (talking !== this.talking) { this.talking = talking; this.events.speaking(null, talking) }
    this.setSending(talking)
  }

  private setTalking(talking: boolean) {
    if (this.push) return
    if (talking !== this.talking) { this.talking = talking; this.events.speaking(null, talking) }
    this.setSending(true)
  }

  private setSending(sending: boolean) {
    if (sending === this.sending) return
    this.sending = sending
    for (const [id, peer] of this.peers) if (peer.mesh) this.tuneSender(id, peer)
    this.tuneRoom()
  }

  /** What one connection may carry: our own rate when it is direct, the server's when it is on the relay. */
  private kbpsFor(peer: Peer) {
    return peer.relayed !== false ? Math.min(this.maxAudioKbps || Infinity, this.relayedAudioKbps > 0 ? this.relayedAudioKbps : 32) : this.maxAudioKbps
  }

  private tuneSender(id: string, peer: Peer) {
    const most = this.kbpsFor(peer)
    void this.shell.peerSetSending({ id, active: this.sending, maxBitrate: most > 0 && Number.isFinite(most) ? most * 1000 : 0 }).catch(() => { /* closed meanwhile */ })
  }

  private tuneRoom() {
    if (!this.viaServer || !this.roomUp) return
    void this.shell.roomSetSending({ active: this.sending, maxBitrate: this.roomBitrate() }).catch(() => { /* gone meanwhile */ })
  }

  private roomBitrate() { return (this.maxAudioKbps > 0 ? this.maxAudioKbps : 32) * 1000 }

  // ---- Which way ----------------------------------------------------------------------------------------------------

  effectivePolicy: IcePolicy = 'direct'
  private wantedPolicy: IcePolicy = 'relay'

  reconfigure(ice: IceServerDto[]) { if (this.joined) this.configure(ice, this.wantedPolicy) }

  configure(ice: IceServerDto[], wanted: IcePolicy): IcePolicy {
    this.wantedPolicy = wanted
    const hasTurn = ice.some(s => s.urls.some(u => /^turns?:/i.test(u)))
    const policy: IcePolicy = wanted === 'relay' && hasTurn ? 'relay' : 'direct'
    this.iceServers = ice.map(s => ({ urls: s.urls, username: s.username ?? undefined, credential: s.credential ?? undefined }))
    this.relayOnly = wanted === 'relay'
    this.config = { iceServers: this.iceServers, iceTransportPolicy: this.relayOnly ? 'relay' : 'all' }
    this.effectivePolicy = policy
    return policy
  }

  /** The microphone and where sound plays, as the phone offers them (see audioDevices.ts): handed to the shell, which
   *  asks the phone for them now if a call is on, otherwise when one begins. */
  setDevices(inputDeviceId: string | null, outputDeviceId: string | null) {
    void this.shell.audioChoose({ input: inputDeviceId ?? '', output: outputDeviceId ?? '' }).catch(() => { /* an older shell */ })
  }
  async switchDevices(inputDeviceId: string | null, outputDeviceId: string | null): Promise<boolean> {
    await this.shell.audioChoose({ input: inputDeviceId ?? '', output: outputDeviceId ?? '' }).catch(() => { /* an older shell */ })
    return true
  }
  /** The shell's sound does not stop while the page is hidden, so there is nothing to start again. */
  async recover(): Promise<void> { /* nothing stopped */ }

  private master = 1
  private deafened = false
  setOutput(volume: number, deafened: boolean) {
    this.master = Math.max(0, Math.min(1, volume))
    this.deafened = deafened
    for (const [id, peer] of this.peers) this.applyAudio(id, peer)
  }

  /** What the phone shows for this call on its lock screen. Set before joining. */
  callTitle = 'Maplecord'

  private joined = false
  private sitting = 0
  private opening: Promise<void> | null = null
  private refused = new Set<string>()

  refuse(connectionId: string) {
    this.refused.add(connectionId)
    this.dropPeer(connectionId)
  }

  async connectTo(connectionId: string) {
    this.refused.delete(connectionId)
    if (!this.joined || this.viaServer) return
    if (this.opening) { await this.opening; if (!this.joined || this.viaServer) return }
    try { await this.offer(connectionId) }
    catch (e) { this.events.log('Offer failed: ' + (e instanceof Error ? e.message : e)) }
  }

  async join(existing: VoiceParticipantDto[], pass: SfuPassDto | null = null, silenced = false, refused: readonly string[] = [], music: readonly string[] = []) {
    await this.leave()
    this.refused = new Set(refused)
    this.musicPeers = new Set(music)
    this.silencedSelf = silenced
    for (const p of existing) if (p.silenced) this.silencedPeers.add(p.connectionId)
    const sitting = ++this.sitting
    this.joined = true
    this.viaServer = pass !== null
    await this.listen()
    // The phone is told a call is on first: that is what gives the microphone and the speaker the right to run with
    // the screen off, and puts the call on the lock screen.
    try { await this.shell.callBegin({ title: this.callTitle }) }
    catch (e) { this.events.log(`The phone would not start a call (${e instanceof Error ? e.message : e}); carrying on without the lock screen.`) }
    let micError: unknown = null
    let opened!: () => void
    const opening = new Promise<void>(resolve => { opened = resolve })
    this.opening = opening
    try {
      const got = await this.shell.microphoneOpen()
      if (this.sitting !== sitting) { void this.shell.microphoneClose().catch(() => {}); return }
      if (!got.ok) throw new Error(got.error || 'The microphone could not be opened.')
      this.local = true
      await this.shell.microphoneSetEnabled({ enabled: !this.muted && !this.silencedSelf })
      this.events.log(`Microphone started (${this.effectivePolicy === 'relay' ? 'relayed' : 'direct'}; phone app).`)
    } catch (e) {
      if (this.sitting !== sitting) return
      micError = e
      this.local = false
      this.events.log(`No microphone (${e instanceof Error ? e.message : e}); joining receive-only.`)
    } finally {
      if (this.opening === opening) this.opening = null
      opened()
    }
    this.startCapTimer()

    if (pass) {
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
        if (this.refused.has(p.connectionId)) continue
        try { await this.offer(p.connectionId) }
        catch (e) { this.events.log(`Offer to ${p.username} failed: ${e instanceof Error ? e.message : e}`) }
      }
    }
    if (micError) throw micError
  }

  // ---- What the shell tells us ------------------------------------------------------------------------------------

  private async listen() {
    await this.unlisten()
    const on = async <K extends keyof import('./native/app').NativeVoiceEvents>(event: K, handler: (data: import('./native/app').NativeVoiceEvents[K]) => void) => {
      this.listening.push(await this.shell.addListener(event, handler))
    }
    await on('peerIce', e => {
      if (!this.joined || !this.peers.get(e.id)?.mesh || !e.candidate) return
      void this.hub.signal(e.id, 'ice', JSON.stringify({ candidate: e.candidate, sdpMid: e.sdpMid, sdpMLineIndex: e.sdpMLineIndex ?? 0 }))
    })
    await on('peerState', e => {
      const peer = this.peers.get(e.id)
      if (!this.joined || !peer?.mesh) return
      this.events.peerState(e.id, e.state)
      if (e.state === 'connected') {
        this.tuneSender(e.id, peer)
        // Once connected we can tell whether this person is reached through the relay, and set the rate to match.
        void this.shell.peerStats({ id: e.id, part: 'all' }).then(r => {
          const now = this.peers.get(e.id)
          if (now !== peer) return
          peer.relayed = relayedIn(r.stats)
          peer.ownRelay = this.relayOnly || ownEndRelayedIn(r.stats)
          this.tuneSender(e.id, peer)
          this.tellRelay()
        }).catch(() => { /* closed meanwhile */ })
      }
      if (e.state === 'failed' || e.state === 'closed') void this.removePeer(e.id)
    })
    await on('peerTrack', e => { const peer = this.peers.get(e.id); if (peer?.mesh) { peer.heard = true; this.applyAudio(e.id, peer) } })
    await on('roomPeer', e => {
      if (!this.joined || !this.viaServer) return
      if (e.state === 'connected') { if (!this.peers.has(e.id)) this.peers.set(e.id, { mesh: false, heard: false, speaking: false, lastAbove: 0 }); this.events.peerState(e.id, 'connected') }
      else this.dropPeer(e.id)
    })
    await on('roomTrack', e => {
      if (!this.joined || !this.viaServer) return
      if (!e.on) { this.dropPeer(e.id); return }
      const peer = this.peers.get(e.id) ?? { mesh: false, heard: false, speaking: false, lastAbove: 0 }
      peer.heard = true
      this.peers.set(e.id, peer)
      this.applyAudio(e.id, peer)
      this.events.peerState(e.id, 'connected')
    })
    await on('roomState', e => {
      if (!this.joined || !this.viaServer) return
      if (e.state === 'reconnected') { this.events.log('The connection to the stream server came back.'); this.tuneRoom() }
      else if (e.state === 'reconnecting') this.events.log('The connection to the stream server dropped; reconnecting.')
      else if (e.state === 'signalReconnecting') this.events.log('The stream server\'s sign-in connection dropped; reconnecting (sound may carry on).')
      else if (e.state === 'disconnected' && this.roomUp) {
        // Dropped without our asking. Whatever we were hearing is gone with it; try to get back in.
        this.roomUp = false
        for (const id of [...this.peers.keys()]) { this.dropPeer(id); this.events.peerState(id, 'connecting') }
        void this.reconnectRoom(1)
      }
    })
    await on('roomPublish', e => {
      if (!this.joined || !this.viaServer || !this.roomUp) return
      if (e.canPublish && this.local && !this.silencedSelf) void this.shell.roomSendMicrophone({ maxBitrate: this.roomBitrate() }).catch(() => { /* offered again when we are told we may speak */ })
    })
    await on('levels', e => {
      if (!this.joined) return
      if (e.me !== null && this.local && !this.muted) this.measure(null, e.me)
      for (const [id, level] of Object.entries(e.peers)) if (this.peers.has(id)) this.measure(id, level)
    })
    await on('callMute', e => this.events.muteAsked?.(e.muted))
    await on('callEnd', () => { if (this.joined) this.events.hangUpAsked?.() })
  }

  private async unlisten() {
    const had = this.listening
    this.listening = []
    for (const h of had) await h.remove().catch(() => {})
  }

  private speakingMe = { speaking: false, lastAbove: 0 }

  /** The same as voice.ts does with its meters, on the numbers the shell sends. */
  private measure(id: string | null, rms: number) {
    this.events.level(id, Math.min(1, rms * 4))
    const m = id === null ? this.speakingMe : this.peers.get(id)
    if (!m) return
    const now = Date.now()
    if (rms >= (id === null ? this.gateThreshold : this.botPeers.has(id) ? BOT_SOUND_THRESHOLD : SPEAKING_THRESHOLD)) {
      m.lastAbove = now
      if (!m.speaking) { m.speaking = true; if (id === null) this.setTalking(true); else this.events.speaking(id, true) }
    } else if (m.speaking && now - m.lastAbove > SILENCE_HOLD_MS) {
      m.speaking = false
      if (id === null) this.setTalking(false); else this.events.speaking(id, false)
    }
  }

  // ---- Through a stream server -------------------------------------------------------------------------------------

  private viaServer = false
  private roomUp = false

  private async connectRoom(pass: SfuPassDto) {
    const sitting = this.sitting
    await this.shell.roomConnect({ url: pass.url, token: pass.token, key: pass.key ?? null, sendMicrophone: this.local && !this.silencedSelf, maxBitrate: this.roomBitrate() })
    if (this.sitting !== sitting) { void this.shell.roomDisconnect().catch(() => {}); return }
    this.roomUp = true
    this.tuneRoom()
  }

  private async reconnectRoom(attempt: number) {
    await new Promise(r => setTimeout(r, 1000 * attempt))
    if (!this.joined || !this.viaServer || this.roomUp) return
    try {
      const pass = await this.hub.voicePass()
      if (!this.joined || !this.viaServer || this.roomUp) return
      if (!pass) throw new Error('This channel no longer has a stream server.')
      await this.connectRoom(pass)
    } catch (e) {
      if (!this.joined || !this.viaServer) return
      this.roomUp = false
      void this.shell.roomDisconnect().catch(() => {})
      this.events.log(`Could not get back to the stream server (${e instanceof Error ? e.message : e}).`)
      if (attempt < RECONNECT_TRIES) void this.reconnectRoom(attempt + 1)
      else this.events.lost('The connection to this voice channel was lost.')
    }
  }

  private dropPeer(connectionId: string) {
    const peer = this.peers.get(connectionId)
    if (!peer) return
    this.peers.delete(connectionId)
    this.tellRelay()
    if (peer.mesh) void this.shell.peerClose({ id: connectionId }).catch(() => { /* already closed */ })
    this.events.speaking(connectionId, false)
  }

  async leave() {
    this.sitting++
    const was = this.joined
    this.joined = false
    this.viaServer = false
    const roomUp = this.roomUp
    this.roomUp = false
    for (const id of [...this.peers.keys()]) await this.removePeer(id)
    if (this.capTimer !== undefined) { clearInterval(this.capTimer); this.capTimer = undefined }
    if (roomUp) await this.shell.roomDisconnect().catch(() => {})
    if (this.local) { this.local = false; await this.shell.microphoneClose().catch(() => {}) }
    if (was) await this.shell.callEnd().catch(() => {})
    await this.unlisten()
    this.talking = false
    this.speakingMe = { speaking: false, lastAbove: 0 }
    this.silencedSelf = false
    this.silencedPeers.clear()
    this.musicPeers.clear()
    this.caps.clear(); this.capSeen.clear(); this.overCap.clear()
    this.botPeers.clear()
    this.relayNow = false
    this.sending = !this.push
    this.events.speaking(null, false)
  }

  // ---- Not being heard ---------------------------------------------------------------------------------------------

  private silencedSelf = false
  private silencedPeers = new Set<string>()

  setSilenced(silenced: boolean) {
    if (this.silencedSelf === silenced) return
    this.silencedSelf = silenced
    if (this.local) void this.shell.microphoneSetEnabled({ enabled: !this.muted && !silenced }).catch(() => {})
    if (silenced) {
      if (this.viaServer && this.roomUp) void this.shell.roomStopMicrophone().catch(() => {})
      if (!this.push) this.setTalking(false)
      return
    }
    if (this.viaServer && this.roomUp && this.local) void this.shell.roomSendMicrophone({ maxBitrate: this.roomBitrate() }).catch(() => {})
  }

  private musicPeers = new Set<string>()
  setPeerMusic(connectionId: string, music: boolean) {
    if (music) this.musicPeers.add(connectionId); else this.musicPeers.delete(connectionId)
  }

  private relayNow = false
  private tellRelay() {
    const now = this.joined && [...this.peers.values()].some(p => p.ownRelay === true)
    if (now === this.relayNow) return
    this.relayNow = now
    this.events.onRelay?.(now)
  }

  private botPeers = new Set<string>()
  setPeerBot(connectionId: string, bot: boolean) {
    if (bot) this.botPeers.add(connectionId); else this.botPeers.delete(connectionId)
  }

  // ---- A bot's sound limit (see voice.ts) ----
  private caps = new Map<string, number>()
  private capSeen = new Map<string, { bytes: number; at: number; over: number }>()
  private overCap = new Set<string>()
  private capTimer: ReturnType<typeof setInterval> | undefined

  setPeerCap(connectionId: string, kbps: number | null) {
    if (kbps && kbps > 0) this.caps.set(connectionId, kbps); else this.caps.delete(connectionId)
    this.capSeen.delete(connectionId)
    const peer = this.peers.get(connectionId)
    if (this.overCap.delete(connectionId) && peer) this.applyAudio(connectionId, peer)
  }

  private startCapTimer() {
    if (this.capTimer !== undefined) clearInterval(this.capTimer)
    this.capTimer = setInterval(() => { if (this.caps.size > 0) void this.checkCaps() }, 2500)
  }

  private async checkCaps() {
    for (const [id, cap] of this.caps) {
      const peer = this.peers.get(id)
      if (!peer || this.overCap.has(id) || this.silencedPeers.has(id)) { this.capSeen.delete(id); continue }
      let bytes = 0
      try {
        const { stats } = peer.mesh ? await this.shell.peerStats({ id, part: 'receiver' }) : await this.shell.roomStats({ id })
        for (const s of stats) if (s.type === 'inbound-rtp') bytes += Number(s.bytesReceived ?? 0)
      } catch { continue }
      const now = Date.now(), before = this.capSeen.get(id)
      if (!before) { this.capSeen.set(id, { bytes, at: now, over: 0 }); continue }
      if (now - before.at < 1000) continue
      const kbps = (bytes - before.bytes) * 8 / (now - before.at)
      const over = kbps > cap * 1.25 + 4 ? before.over + 1 : 0
      if (over < 2) { this.capSeen.set(id, { bytes, at: now, over }); continue }
      this.capSeen.delete(id)
      this.overCap.add(id)
      this.applyAudio(id, peer)
      this.events.overCap?.(id, Math.round(kbps))
    }
  }

  setPeerSilenced(connectionId: string, silenced: boolean) {
    if (silenced) this.silencedPeers.add(connectionId); else this.silencedPeers.delete(connectionId)
    const peer = this.peers.get(connectionId)
    if (peer) this.applyAudio(connectionId, peer)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.local) void this.shell.microphoneSetEnabled({ enabled: !muted && !this.silencedSelf }).catch(() => {})
    if (muted) { if (this.push) this.setPushToTalk(true, false); else this.setTalking(false) }
  }

  private wanted = new Map<string, { volume: number; muted: boolean }>()

  setPeerAudio(connectionId: string, volume: number, muted: boolean) {
    this.wanted.set(connectionId, { volume: Math.max(0, Math.min(2, volume)), muted })
    const peer = this.peers.get(connectionId)
    if (peer) this.applyAudio(connectionId, peer)
  }

  private applyAudio(connectionId: string, peer: Peer) {
    const chosen = this.wanted.get(connectionId) ?? { volume: 1, muted: false }
    const want = { id: connectionId, volume: chosen.volume * this.master, muted: chosen.muted || this.deafened || this.silencedPeers.has(connectionId) || this.overCap.has(connectionId) }
    void (peer.mesh ? this.shell.peerSetVolume(want) : this.shell.roomSetVolume(want)).catch(() => { /* gone meanwhile */ })
  }

  async removePeer(connectionId: string) {
    this.wanted.delete(connectionId)
    this.silencedPeers.delete(connectionId)
    this.musicPeers.delete(connectionId)
    this.caps.delete(connectionId); this.capSeen.delete(connectionId); this.overCap.delete(connectionId)
    this.botPeers.delete(connectionId)
    this.refused.delete(connectionId)
    this.dropPeer(connectionId)
  }

  async handleSignal(s: VoiceSignalDto) {
    if (!this.joined || this.viaServer) return
    if (this.refused.has(s.fromConnectionId)) return
    if (this.opening) { await this.opening; if (!this.joined || this.viaServer) return }
    try {
      if (s.kind === 'offer') {
        await this.ensurePeer(s.fromConnectionId)
        await this.shell.peerSetRemote({ id: s.fromConnectionId, type: 'offer', sdp: s.payload })
        const answer = await this.shell.peerCreateAnswer({ id: s.fromConnectionId })
        const set = await this.shell.peerSetLocal({ id: s.fromConnectionId, type: 'answer', sdp: this.tune(answer.sdp, s.fromConnectionId) })
        await this.hub.signal(s.fromConnectionId, 'answer', set.sdp)
      } else if (s.kind === 'answer') {
        if (this.peers.get(s.fromConnectionId)?.mesh) await this.shell.peerSetRemote({ id: s.fromConnectionId, type: 'answer', sdp: s.payload })
      } else if (s.kind === 'ice') {
        const ice = JSON.parse(s.payload) as { candidate: string; sdpMid: string | null; sdpMLineIndex: number }
        if (this.peers.get(s.fromConnectionId)?.mesh && ice.candidate) await this.shell.peerAddIce({ id: s.fromConnectionId, candidate: ice.candidate, sdpMid: ice.sdpMid ?? null, sdpMLineIndex: ice.sdpMLineIndex ?? 0 })
      }
    } catch (e) {
      this.events.log(`Signal ${s.kind} failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  private async offer(remote: string) {
    await this.ensurePeer(remote)
    const offer = await this.shell.peerCreateOffer({ id: remote })
    const set = await this.shell.peerSetLocal({ id: remote, type: 'offer', sdp: this.tune(offer.sdp, remote) })
    await this.hub.signal(remote, 'offer', set.sdp)
  }

  private async ensurePeer(remote: string): Promise<Peer> {
    const existing = this.peers.get(remote)
    if (existing?.mesh) return existing
    const peer: Peer = { mesh: true, heard: false, speaking: false, lastAbove: 0 }
    this.peers.set(remote, peer)
    this.events.peerState(remote, 'connecting')
    await this.shell.peerOpen({ id: remote, iceServers: this.iceServers, relayOnly: this.relayOnly })
    this.tuneSender(remote, peer)
    this.applyAudio(remote, peer)
    return peer
  }

  /** The same Opus settings voice.ts writes into what it asks the other side for (see voice.ts tune). */
  private tune(sdp: string, remote: string): string {
    const asked = this.musicPeers.has(remote) ? 'stereo=1;sprop-stereo=0' : 'usedtx=1;maxaveragebitrate=24000;stereo=0;sprop-stereo=0'
    return sdp.replace(/a=fmtp:(\d+) (.*minptime=10.*)/g, (_m, pt, rest) => `a=fmtp:${pt} ${rest};${asked}`)
  }
}

/** A browser-shaped statistics report out of the shell's lines, for the voice report. */
const asReport = (stats: NativeStat[]): RTCStatsReport => new Map(stats.map(s => [s.id, s])) as unknown as RTCStatsReport

const chosenPair = (stats: NativeStat[]) => {
  const pairId = stats.find(r => r.type === 'transport' && r.selectedCandidatePairId)?.selectedCandidatePairId
  return stats.find(r => r.type === 'candidate-pair' && (pairId ? r.id === pairId : r.nominated && r.state === 'succeeded'))
}

/** Whether the connection that was made goes through a relay at either end (as transfer.ts tells on a browser's). */
export function relayedIn(stats: NativeStat[]): boolean {
  const pair = chosenPair(stats)
  if (!pair) return false
  return stats.some(r => (r.id === pair.localCandidateId || r.id === pair.remoteCandidateId) && r.candidateType === 'relay')
}

/** Whether our own end of it does. */
export function ownEndRelayedIn(stats: NativeStat[]): boolean {
  const pair = chosenPair(stats)
  if (!pair) return false
  return stats.some(r => r.id === pair.localCandidateId && r.candidateType === 'relay')
}
