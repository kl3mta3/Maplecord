// node src/nativeVoice.test.ts
// The page's half of voice in the iPhone app (nativeVoice.ts), against a stand-in for the shell: the same set-up
// messages, topology and decisions as voice.ts, handed to the shell instead of a browser's RTCPeerConnection.
import { NativeVoiceEngine, ownEndRelayedIn, relayedIn } from './nativeVoice.ts'
import type { NativeVoiceEvents, NativeVoicePlugin } from './native/app'
import type { VoiceHub } from './voiceHub'
import type { VoiceEngineEvents } from './voice'
import type { SfuPassDto, VoiceParticipantDto } from './types'

let failed = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failed++ }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

type Handler = (data: unknown) => void

/** A shell that remembers what it was asked and can be made to say things. */
function makeShell() {
  const calls: Array<{ name: string; args: unknown }> = []
  const listeners = new Map<string, Handler[]>()
  const named = (name: string) => calls.filter(c => c.name === name).map(c => c.args as Record<string, unknown>)
  const emit = <K extends keyof NativeVoiceEvents>(event: K, data: NativeVoiceEvents[K]) => { for (const h of listeners.get(event) ?? []) h(data) }
  const shell = new Proxy({} as NativeVoicePlugin, {
    get(_t, name: string) {
      if (name === 'addListener') return async (event: string, handler: Handler) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler])
        return { remove: async () => listeners.set(event, (listeners.get(event) ?? []).filter(h => h !== handler)) }
      }
      if (name === 'removeAllListeners') return async () => listeners.clear()
      return async (args: unknown) => {
        calls.push({ name, args })
        if (name === 'microphoneOpen') return { ok: !shell_noMic }
        if (name === 'peerCreateOffer') return { sdp: SDP }
        if (name === 'peerCreateAnswer') return { sdp: SDP }
        if (name === 'peerSetLocal') return { sdp: (args as { sdp: string }).sdp + '\r\na=set-by-shell' }
        if (name === 'peerStats' || name === 'roomStats') return { stats: shell_stats }
        return {}
      }
    },
  })
  return { shell, calls, named, emit, reset: () => { calls.length = 0 } }
}
let shell_noMic = false
let shell_stats: Array<Record<string, unknown> & { id: string; type: string; timestamp: number }> = []

const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n'

function makeHub(pass: SfuPassDto | null = null) {
  const signals: Array<{ target: string; kind: string; payload: string }> = []
  const hub = { signal: async (target: string, kind: string, payload: string) => { signals.push({ target, kind, payload }) }, voicePass: async () => pass } as unknown as VoiceHub
  return { hub, signals }
}

function makeEvents() {
  const seen: Array<{ what: string; id: string | null; value: unknown }> = []
  const events: VoiceEngineEvents = {
    peerState: (id, state) => seen.push({ what: 'peerState', id, value: state }),
    speaking: (id, speaking) => seen.push({ what: 'speaking', id, value: speaking }),
    level: () => {},
    log: m => seen.push({ what: 'log', id: null, value: m }),
    lost: reason => seen.push({ what: 'lost', id: null, value: reason }),
    overCap: (id, kbps) => seen.push({ what: 'overCap', id, value: kbps }),
    onRelay: on => seen.push({ what: 'onRelay', id: null, value: on }),
    muteAsked: muted => seen.push({ what: 'muteAsked', id: null, value: muted }),
    hangUpAsked: () => seen.push({ what: 'hangUpAsked', id: null, value: true }),
  }
  return { events, seen }
}

const person = (connectionId: string, extra: Partial<VoiceParticipantDto> = {}): VoiceParticipantDto =>
  ({ userId: 'u-' + connectionId, username: connectionId, connectionId, muted: false, ...extra }) as VoiceParticipantDto

const turn = [{ urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' }]

async function meshJoin() {
  const s = makeShell(), h = makeHub(), ev = makeEvents()
  const engine = new NativeVoiceEngine(h.hub, ev.events, s.shell)
  engine.maxAudioKbps = 32
  engine.relayedAudioKbps = 24
  const policy = engine.configure(turn, 'relay')
  check(policy === 'relay' && engine.rtcConfig.iceTransportPolicy === 'relay' && true, 'mesh: relayed when asked and a relay is there, like voice.ts')
  await engine.join([person('A'), person('B')], null, false, [], [])
  const order = s.calls.map(c => c.name)
  check(order[0] === 'callBegin' && (s.named('callBegin')[0].title === 'Maplecord'), 'mesh: the phone is told a call is on before anything else')
  check(order.indexOf('microphoneOpen') === 1 && s.named('microphoneSetEnabled')[0]?.enabled === true, 'mesh: then the microphone is opened, and sending (not muted)')
  const opened = s.named('peerOpen')
  check(opened.length === 2 && opened.every(o => o.relayOnly === true && (o.iceServers as unknown[]).length === 1), 'mesh: one connection per person already there, relay-only, with the relay given')
  check(h.signals.length === 2 && h.signals.every(x => x.kind === 'offer') && h.signals.map(x => x.target).join() === 'A,B', 'mesh: the newcomer offers to everyone present, and only offers')
  const set = s.named('peerSetLocal')
  check(set.every(x => String(x.sdp).includes('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=24000;stereo=0;sprop-stereo=0')), 'mesh: the Opus settings voice.ts asks for are written into the offer')
  check(h.signals.every(x => x.payload.endsWith('a=set-by-shell')), 'mesh: what is sent is what the shell set, not what the page asked for')
  const sending = s.named('peerSetSending')
  check(sending.length >= 2 && sending.every(x => x.active === true && x.maxBitrate === 24000), 'mesh: each connection starts sending at the relayed rate (24 kbps) until known direct')
  return { s, h, ev, engine }
}

async function main() {
  // ---- Mesh: joining, answering, ICE both ways
  {
    const { s, h, ev, engine } = await meshJoin()
    s.reset(); h.signals.length = 0
    await engine.handleSignal({ fromUserId: 'u-A', fromConnectionId: 'A', kind: 'answer', payload: 'v=0 answer' })
    check(s.named('peerSetRemote')[0]?.type === 'answer' && s.named('peerSetRemote')[0]?.id === 'A', 'mesh: an answer is given to the connection it is for')
    await engine.handleSignal({ fromUserId: 'u-A', fromConnectionId: 'A', kind: 'ice', payload: JSON.stringify({ candidate: 'candidate:1 1 udp 1 relay.example 3478 typ relay', sdpMid: '0', sdpMLineIndex: 0 }) })
    check(String(s.named('peerAddIce')[0]?.candidate).startsWith('candidate:1') && s.named('peerAddIce')[0]?.sdpMid === '0', 'mesh: their ICE goes to the shell')
    s.emit('peerIce', { id: 'A', candidate: 'candidate:9 1 udp 1 relay.example 3478 typ relay', sdpMid: '0', sdpMLineIndex: 0 })
    await tick()
    check(h.signals.length === 1 && h.signals[0].kind === 'ice' && JSON.parse(h.signals[0].payload).candidate.startsWith('candidate:9'), 'mesh: our ICE from the shell is sent as the same JSON voice.ts sends')
    s.emit('peerIce', { id: 'Z', candidate: 'candidate:9', sdpMid: '0', sdpMLineIndex: 0 })
    await tick()
    check(h.signals.length === 1, 'mesh: ICE for a connection that is not ours is dropped')
    s.reset(); h.signals.length = 0
    await engine.handleSignal({ fromUserId: 'u-C', fromConnectionId: 'C', kind: 'offer', payload: 'v=0 offer' })
    const names = s.calls.map(c => c.name)
    check(names.indexOf('peerOpen') < names.indexOf('peerSetRemote') && names.indexOf('peerSetRemote') < names.indexOf('peerCreateAnswer') && names.indexOf('peerCreateAnswer') < names.indexOf('peerSetLocal'),
      'mesh: a newcomer\'s offer makes a connection, takes the offer, answers')
    check(h.signals.length === 1 && h.signals[0].kind === 'answer' && h.signals[0].target === 'C', 'mesh: and the answer goes back to them')
    check(ev.seen.some(e => e.what === 'peerState' && e.id === 'C' && e.value === 'connecting'), 'mesh: they show as connecting meanwhile')

    // Connected: told, the rate is looked at again, and whether we are on the relay is said.
    s.reset(); ev.seen.length = 0
    shell_stats = [
      { id: 'T', type: 'transport', timestamp: 1, selectedCandidatePairId: 'P' },
      { id: 'P', type: 'candidate-pair', timestamp: 1, localCandidateId: 'L', remoteCandidateId: 'R', nominated: true, state: 'succeeded' },
      { id: 'L', type: 'local-candidate', timestamp: 1, candidateType: 'relay' },
      { id: 'R', type: 'remote-candidate', timestamp: 1, candidateType: 'host' },
    ]
    s.emit('peerState', { id: 'A', state: 'connected' })
    await tick(); await tick()
    check(ev.seen.some(e => e.what === 'peerState' && e.id === 'A' && e.value === 'connected'), 'mesh: connected is passed on')
    check(ev.seen.some(e => e.what === 'onRelay' && e.value === true), 'mesh: on the relay (relay-only) is said to the server once connected')
    check(relayedIn(shell_stats) && ownEndRelayedIn(shell_stats), 'stats: the chosen pair tells relayed and own end relayed, as transfer.ts does')
    shell_stats[2].candidateType = 'host'
    check(!relayedIn(shell_stats) && !ownEndRelayedIn(shell_stats), 'stats: and not relayed when neither end is')

    // Their voice arriving: played at the volume chosen for them.
    s.reset()
    engine.setPeerAudio('A', 1.5, false)
    engine.setOutput(0.5, false)
    s.emit('peerTrack', { id: 'A' })
    await tick()
    const vol = s.named('peerSetVolume').filter(v => v.id === 'A').pop()
    check(vol?.volume === 0.75 && vol?.muted === false, 'volume: a person at 150% with the master at 50% plays at 0.75')
    engine.setOutput(0.5, true)
    check(s.named('peerSetVolume').pop()?.muted === true, 'volume: deafened mutes everyone')
    engine.setOutput(1, false)
    engine.setPeerSilenced('A', true)
    check(s.named('peerSetVolume').pop()?.muted === true, 'volume: someone silenced by a moderator is not played')
    engine.setPeerSilenced('A', false)

    // The gate, from the shell's levels.
    s.reset(); ev.seen.length = 0
    s.emit('levels', { me: 0.1, peers: { A: 0.0, B: 0.05 } })
    check(ev.seen.some(e => e.what === 'speaking' && e.id === null && e.value === true), 'gate: loud enough, our light comes on')
    check(ev.seen.some(e => e.what === 'speaking' && e.id === 'B' && e.value === true) && !ev.seen.some(e => e.what === 'speaking' && e.id === 'A'), 'lights: B is heard speaking, A is not')
    check(s.named('peerSetSending').length === 0, 'gate: nothing changes while we were sending already')
    s.emit('levels', { me: 0.0, peers: { A: 0.0, B: 0.0 } })
    check(s.named('peerSetSending').length === 0 && !ev.seen.some(e => e.what === 'speaking' && e.id === null && e.value === false), 'gate: a moment of quiet does not switch us off yet')
    await tick(400)
    s.emit('levels', { me: 0.0, peers: {} })
    // On the phone the gate only sets the light: going quiet must never stop the voice going out (that left the phone
    // unable to be heard again, since the stream server way measured our voice from what we sent).
    check(ev.seen.some(e => e.what === 'speaking' && e.id === null && e.value === false), 'light: quiet for long enough, our light goes out')
    check(s.named('peerSetSending').length === 0, 'gate: quiet for long enough, our voice still goes out')
    engine.setGate(true, 0.02)
    check(s.named('peerSetSending').every(x => x.active === true), 'gate: turning it on does not hold the voice back')
    engine.setPushToTalk(true, false)
    check(s.named('peerSetSending').slice(-3).every(x => x.active === false), 'push to talk: nothing is sent until the key is held')
    engine.setPushToTalk(true, true)
    check(s.named('peerSetSending').slice(-3).every(x => x.active === true), 'push to talk: held, it is sent')
    engine.setPushToTalk(false, false)

    // The microphone and output chosen on the page go to the phone ("" is the phone's own choice).
    s.reset()
    engine.setDevices('mic-1', 'receiver')
    check(s.named('audioChoose').pop()?.input === 'mic-1' && s.named('audioChoose')[0]?.output === 'receiver', 'devices: the chosen microphone and output go to the phone')
    check(await engine.switchDevices(null, 'speaker') === true && s.named('audioChoose').pop()?.input === '' && s.named('audioChoose').pop()?.output === 'speaker', 'devices: switched in a call, on the spot; the system default is ""')

    // Mute and silence go to the microphone, not to the connections.
    s.reset()
    engine.setMuted(true)
    check(s.named('microphoneSetEnabled').pop()?.enabled === false && engine.mutedNow, 'mute: the microphone is switched off')
    engine.setMuted(false)
    engine.setSilenced(true)
    check(s.named('microphoneSetEnabled').pop()?.enabled === false, 'silenced: the microphone is switched off too')
    engine.setSilenced(false)
    check(s.named('microphoneSetEnabled').pop()?.enabled === true, 'silenced no more: it is on again')

    // The phone's own call screen.
    ev.seen.length = 0
    s.emit('callMute', { muted: true })
    s.emit('callEnd', {})
    check(ev.seen.some(e => e.what === 'muteAsked' && e.value === true) && ev.seen.some(e => e.what === 'hangUpAsked'), 'lock screen: mute and hang up are passed to the app')

    // A bot in a P2P call is asked for stereo.
    engine.setPeerMusic('M', true)
    s.reset(); h.signals.length = 0
    await engine.connectTo('M')
    check(String(s.named('peerSetLocal')[0]?.sdp).includes(';stereo=1;sprop-stereo=0') && !String(s.named('peerSetLocal')[0]?.sdp).includes('usedtx'), 'mesh: a music bot is asked for stereo and no cap')

    // Leaving closes everything, in the shell too.
    s.reset()
    await engine.leave()
    const closed = s.named('peerClose').map(c => c.id).sort().join()
    check(closed === 'A,B,C,M' && s.calls.some(c => c.name === 'microphoneClose') && s.calls.some(c => c.name === 'callEnd') && !s.calls.some(c => c.name === 'roomDisconnect'),
      'leave: every connection, the microphone and the phone\'s call are ended')
    check(!engine.active, 'leave: the microphone is no longer ours')
  }

  // ---- No microphone: joined listening only, and the error is thrown after the offers go out.
  {
    shell_noMic = true
    const s = makeShell(), h = makeHub(), ev = makeEvents()
    const engine = new NativeVoiceEngine(h.hub, ev.events, s.shell)
    engine.configure(turn, 'relay')
    let thrown: unknown = null
    try { await engine.join([person('A')]) } catch (e) { thrown = e }
    check(thrown instanceof Error && h.signals.length === 1 && !engine.active, 'no microphone: the offer still goes out, then the error says so')
    await engine.leave()
    shell_noMic = false
  }

  // ---- Through a stream server
  {
    const pass = { url: 'wss://sfu.example', token: 't0k', key: 'c2VjcmV0' } as unknown as SfuPassDto
    const s = makeShell(), h = makeHub(pass), ev = makeEvents()
    const engine = new NativeVoiceEngine(h.hub, ev.events, s.shell)
    engine.maxAudioKbps = 48
    engine.configure([], 'relay')
    await engine.join([person('A')], pass)
    const room = s.named('roomConnect')[0]
    check(!!room && room.url === pass.url && room.token === pass.token && room.key === 'c2VjcmV0' && room.sendMicrophone === true && room.maxBitrate === 48000,
      'room: the shell is given the pass as it came, with the room key, and sends our microphone at the server\'s rate')
    check(s.named('peerOpen').length === 0 && h.signals.length === 0, 'room: nobody is offered anything')
    check(s.named('roomSetSending').some(x => x.active === true), 'room: sending is set once in')
    s.emit('roomPeer', { id: 'A', state: 'connected' })
    s.emit('roomTrack', { id: 'A', on: true })
    await tick()
    check(ev.seen.some(e => e.what === 'peerState' && e.id === 'A' && e.value === 'connected') && s.named('roomSetVolume').some(v => v.id === 'A'), 'room: someone heard from it shows connected and is played')
    s.reset()
    engine.setSilenced(true)
    check(s.calls.some(c => c.name === 'roomStopMicrophone'), 'room: silenced, our microphone is withdrawn from the room')
    engine.setSilenced(false)
    check(s.calls.some(c => c.name === 'roomSendMicrophone'), 'room: let speak again, it is offered again')
    s.reset()
    s.emit('roomPublish', { canPublish: true })
    await tick()
    check(s.calls.some(c => c.name === 'roomSendMicrophone'), 'room: told we may publish, the microphone is offered')
    // Dropped without our asking: a new pass, and back in.
    s.reset(); ev.seen.length = 0
    s.emit('roomState', { state: 'disconnected' })
    check(ev.seen.some(e => e.what === 'peerState' && e.id === 'A' && e.value === 'connecting'), 'room: dropped, everyone shows connecting')
    await tick(1200)
    check(s.named('roomConnect').length === 1, 'room: a second later it is joined again with a fresh pass')
    s.reset()
    await engine.leave()
    check(s.calls.some(c => c.name === 'roomDisconnect') && s.calls.some(c => c.name === 'callEnd') && s.calls.some(c => c.name === 'microphoneClose'), 'room: leaving disconnects, closes the microphone, ends the call')
  }

  // ---- A stream server that cannot be reached: no call.
  {
    const pass = { url: 'wss://sfu.example', token: 't', key: null } as unknown as SfuPassDto
    const s = makeShell(), h = makeHub(pass), ev = makeEvents()
    const failing = new Proxy(s.shell, { get: (t, name: string) => name === 'roomConnect' ? async () => { throw new Error('no route') } : (t as unknown as Record<string, unknown>)[name] })
    const engine = new NativeVoiceEngine(h.hub, ev.events, failing)
    let thrown: unknown = null
    try { await engine.join([], pass) } catch (e) { thrown = e }
    check(thrown instanceof Error && /Could not connect/.test(String((thrown as Error).message)) && s.calls.some(c => c.name === 'callEnd'), 'room: unreachable, the join fails and the phone\'s call is ended')
  }

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  if (failed > 0) throw new Error(`${failed} checks failed`)
}

void main()
