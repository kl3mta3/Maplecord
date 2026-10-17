/**
 * The iPhone app: this same page inside a native shell (Capacitor), where voice is done by the shell rather than
 * the page, so that it carries on with the screen off or another app in front (see nativeVoice.ts).
 *
 * Nothing of the shell is imported here. The shell puts `window.Capacitor` on the page as it loads, and that is how
 * the page tells it is inside one; the page then asks it for the voice plugin by name. On the web and in the desktop
 * app there is no such thing, and none of this is used.
 */

export interface NativeIceServer { urls: string[]; username?: string; credential?: string }

/** One line of a WebRTC statistics report, as the shell hands them over: the same fields a browser's would have. */
export interface NativeStat { id: string; type: string; timestamp: number; [key: string]: unknown }

export type NativeSdpType = 'offer' | 'answer'

/** What the voice plugin in the shell does. Every call answers when it is done; what goes wrong is thrown. */
export interface NativeVoicePlugin {
  // ---- The microphone (one; a phone has no choice of them)
  /** Asks for the microphone, if it has not been asked for yet, and opens it. Not ok: joined listening only. */
  microphoneOpen(): Promise<{ ok: boolean; error?: string }>
  /** Whether our voice goes out at all (the mute button, or being silenced). */
  microphoneSetEnabled(o: { enabled: boolean }): Promise<void>
  microphoneClose(): Promise<void>

  // ---- App to app (one connection per other person; the page does the set-up messages, the shell the sound)
  peerOpen(o: { id: string; iceServers: NativeIceServer[]; relayOnly: boolean }): Promise<void>
  peerCreateOffer(o: { id: string }): Promise<{ sdp: string }>
  peerCreateAnswer(o: { id: string }): Promise<{ sdp: string }>
  /** Sets what we say to the other side; answers with it as it was set. */
  peerSetLocal(o: { id: string; type: NativeSdpType; sdp: string }): Promise<{ sdp: string }>
  peerSetRemote(o: { id: string; type: NativeSdpType; sdp: string }): Promise<void>
  peerAddIce(o: { id: string; candidate: string; sdpMid: string | null; sdpMLineIndex: number }): Promise<void>
  /** Whether our voice is sent on this connection right now, and the most it may use (bits a second; 0 = no cap). Kept and applied once the connection can take it. */
  peerSetSending(o: { id: string; active: boolean; maxBitrate: number }): Promise<void>
  /** How loud this person is played (0 to 2, 1 = as sent), or not at all. */
  peerSetVolume(o: { id: string; volume: number; muted: boolean }): Promise<void>
  peerStats(o: { id: string; part: 'all' | 'sender' | 'receiver' }): Promise<{ stats: NativeStat[] }>
  peerClose(o: { id: string }): Promise<void>

  // ---- Through a stream server (one connection, to it)
  /** `key` is the room's end-to-end key as it came with the pass (base64), or null for a room without one. */
  roomConnect(o: { url: string; token: string; key: string | null; sendMicrophone: boolean; maxBitrate: number }): Promise<void>
  roomSendMicrophone(o: { maxBitrate: number }): Promise<void>
  roomStopMicrophone(): Promise<void>
  roomSetSending(o: { active: boolean; maxBitrate: number }): Promise<void>
  roomSetVolume(o: { id: string; volume: number; muted: boolean }): Promise<void>
  /** Our own voice going out (id null), or one person's coming in. */
  roomStats(o: { id: string | null }): Promise<{ stats: NativeStat[] }>
  roomDisconnect(): Promise<void>

  // ---- The call as the phone sees it: on the lock screen, kept running in the background
  callBegin(o: { title: string }): Promise<void>
  callEnd(): Promise<void>
  setSpeaker(o: { on: boolean }): Promise<void>

  addListener<K extends keyof NativeVoiceEvents>(event: K, handler: (data: NativeVoiceEvents[K]) => void): Promise<{ remove: () => Promise<void> }>
  removeAllListeners(): Promise<void>
}

/** What the shell tells the page, by name. */
export interface NativeVoiceEvents {
  peerIce: { id: string; candidate: string; sdpMid: string | null; sdpMLineIndex: number }
  /** The connection's state, in the browser's words: connecting, connected, disconnected, failed, closed. */
  peerState: { id: string; state: string }
  /** This person's voice has started arriving. */
  peerTrack: { id: string }
  /** Someone in the stream server's room (their voice connection id), there or gone. */
  roomPeer: { id: string; state: 'connected' | 'left' }
  roomTrack: { id: string; on: boolean }
  roomState: { state: 'reconnecting' | 'signalReconnecting' | 'reconnected' | 'disconnected' }
  /** Whether the stream server takes our microphone (a moderator silenced us, or let us speak again). */
  roomPublish: { canPublish: boolean }
  /** How loud everyone is, a dozen times a second: us (null when no microphone), and each person by id. Linear 0 to 1. */
  levels: { me: number | null; peers: Record<string, number> }
  /** Mute pressed on the lock screen (or in the phone's own call screen). */
  callMute: { muted: boolean }
  /** The call ended from the phone's side: hung up on the lock screen, or another call took over. */
  callEnd: Record<string, never>
}

/** The rest of what the shell does for the page: signing in through the phone's own sheet, and the phone's notifications. */
export interface NativeAppPlugin {
  /** Opens the phone's sign-in sheet at `url`; answers with the address it came back to (maplecord://signed-in?…). Throws if the person closed it. */
  signIn(o: { url: string }): Promise<{ url: string }>
  /**
   * Asks the phone for leave to notify, and for the phone's push token. Null token: not allowed, or no answer from
   * Apple. `sandbox` says whether this build talks to Apple's test push service (one run from Xcode) or the real one.
   */
  pushRegister(): Promise<{ token: string | null; voipToken?: string | null; sandbox: boolean; error?: string }>
  /**
   * The sign-in, for the moments the page is not running: a call that comes in while the app is closed is looked up,
   * and declined if declined, by the shell itself. Given on signing in and whenever the token is renewed; null on signing out.
   */
  setSession(o: { serverUrl: string | null; token: string | null }): Promise<void>
  addListener<K extends keyof NativeAppEvents>(event: K, handler: (data: NativeAppEvents[K]) => void): Promise<{ remove: () => Promise<void> }>
}

export interface NativeAppEvents {
  /** A notification was tapped: which conversation it was about. */
  pushOpened: { channelId?: string; guildId?: string }
  /** A call was answered on the phone's own call screen: the page joins it. */
  callAnswered: { callId: string; channelId: string; direct: boolean; callerName: string }
}

/**
 * What the shell puts on the page (Capacitor's bridge, written into the page by the app before anything else runs).
 * Only these are there: the rest of Capacitor (registerPlugin and so on) lives in its own JavaScript package, which this
 * app does not carry; the two plugins here are reached through the bridge directly instead (see nativePlugin).
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>
  addListener?: (plugin: string, event: string, handler: (data: unknown) => void) => { remove: () => Promise<void> }
}

const capacitor = (): CapacitorGlobal | undefined => (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor

/** Whether this page is the one inside the iPhone (or iPad) app. */
export const isNativeApp = (): boolean => capacitor()?.isNativePlatform?.() === true

/**
 * One of the shell's plugins, by name: each method is a call to it that answers with a promise, and addListener
 * hears the events it tells the page. What Capacitor's registerPlugin does for a plugin the shell has, without it.
 */
function nativePlugin<T>(name: string): T {
  const cap = capacitor()
  if (!cap?.nativePromise || !cap.addListener) throw new Error('Not inside the Maplecord app.')
  const { nativePromise, addListener } = cap
  return new Proxy({}, {
    get(_target, method) {
      // Not a promise itself, whatever is asked of it: "then" is what tells a promise apart.
      if (typeof method !== 'string' || method === 'then') return undefined
      if (method === 'addListener') return (event: string, handler: (data: unknown) => void) => Promise.resolve(addListener(name, event, handler))
      return (options?: unknown) => nativePromise(name, method, options ?? {})
    },
  }) as T
}

let plugin: NativeVoicePlugin | null = null

/** The shell's voice plugin. Only ever asked for inside the app (see isNativeApp). */
export function nativeVoice(): NativeVoicePlugin {
  plugin ??= nativePlugin<NativeVoicePlugin>('MaplecordVoice')
  return plugin
}

/** Puts a stand-in in place of the shell (tests). */
export function useNativeVoice(standIn: NativeVoicePlugin | null) { plugin = standIn }

let appPlugin: NativeAppPlugin | null = null

/** The shell's app plugin (sign-in sheet, notifications). Only ever asked for inside the app. */
export function nativeApp(): NativeAppPlugin {
  appPlugin ??= nativePlugin<NativeAppPlugin>('MaplecordApp')
  return appPlugin
}

export function useNativeApp(standIn: NativeAppPlugin | null) { appPlugin = standIn }
