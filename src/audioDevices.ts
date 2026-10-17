import { isNativeApp, nativeVoice } from './native/app'

/** A microphone or a place sound can play, as the settings and the in-call menus list them. */
export interface AudioChoice {
  kind: 'audioinput' | 'audiooutput'
  deviceId: string
  label: string
  /** In use right now (the iPhone app knows this; a browser does not say). */
  active?: boolean
}

/**
 * The microphones and outputs that can be chosen. A browser or the desktop app lists its devices. The iPhone app asks
 * the phone, which offers its own microphone, any headset's, the loudspeaker, the earpiece and connected headsets
 * (see the shell's AudioRoutes.swift); a Bluetooth headset's microphone is only offered once the phone is set up for
 * voice (in a call, or while the microphone test runs), so this is asked again then.
 */
export async function listAudioChoices(): Promise<AudioChoice[]> {
  if (isNativeApp()) {
    try {
      const routes = await nativeVoice().audioRoutes()
      return [
        ...routes.inputs.map(r => ({ kind: 'audioinput' as const, deviceId: r.id, label: r.label, active: r.active })),
        ...routes.outputs.map(r => ({ kind: 'audiooutput' as const, deviceId: r.id, label: r.label, active: r.active })),
      ]
    } catch {
      return []
    }
  }
  const all = await navigator.mediaDevices?.enumerateDevices() ?? []
  return all
    .filter(d => (d.kind === 'audioinput' || d.kind === 'audiooutput') && d.deviceId)
    .map(d => ({ kind: d.kind as AudioChoice['kind'], deviceId: d.deviceId, label: d.label }))
}

/** Calls `changed` when something is connected or disconnected; returns the way to stop. */
export function watchAudioChoices(changed: () => void): () => void {
  if (isNativeApp()) {
    let handle: { remove: () => Promise<void> } | null = null
    let stopped = false
    void nativeVoice().addListener('audioRoutes', () => changed()).then(h => { if (stopped) void h.remove(); else handle = h }).catch(() => {})
    return () => { stopped = true; void handle?.remove() }
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', changed)
  return () => navigator.mediaDevices?.removeEventListener?.('devicechange', changed)
}

/** What "System default" means where this runs. */
export function systemDefaultLabel() {
  return isNativeApp() ? 'System default (the phone decides)' : 'System default'
}
