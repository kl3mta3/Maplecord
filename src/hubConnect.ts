import { HttpTransportType, type HubConnection, type IHttpConnectionOptions } from '@microsoft/signalr'

// A server that runs as several copies behind a proxy says so (GET /api/meta, webSocketsOnly). Its hubs are then
// connected to straight over a WebSocket: the usual way asks first and connects second, and the two could reach
// different copies. A connection made that way is not told its own id, so it asks for it afterwards.

const asked = new Map<string, Promise<boolean>>()

/** Asked once for each server while the app runs. A server that does not answer, or says nothing of it, is connected to the usual way. */
function straightToSocket(serverUrl: string): Promise<boolean> {
  const base = serverUrl.replace(/\/$/, '')
  let answer = asked.get(base)
  if (!answer) {
    answer = fetch(base + '/api/meta').then(r => (r.ok ? r.json() : null)).then(meta => !!meta?.webSocketsOnly).catch(() => { asked.delete(base); return false })
    asked.set(base, answer)
  }
  return answer
}

/** How to connect to one of a server's hubs. */
export async function hubOptions(serverUrl: string, options: IHttpConnectionOptions): Promise<IHttpConnectionOptions> {
  return (await straightToSocket(serverUrl)) ? { ...options, skipNegotiation: true, transport: HttpTransportType.WebSockets } : options
}

/** A connection's own id: the one it was given as it connected, or, connected straight over a WebSocket, the one the server says. */
export async function connectionIdOf(conn: HubConnection): Promise<string | null> {
  return conn.connectionId ?? (await conn.invoke<string>('Connection').catch(() => null))
}
