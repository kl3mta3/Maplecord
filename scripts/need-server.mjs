// Run before an installer is built. The desktop app is told at build time which Maplecord server it belongs to
// (VITE_SERVER_URL): that is the server it opens on, and the one it asks at start-up whether there is a newer
// release. Built without it, the app would open on http://localhost:5080 and would never update itself, and nothing
// about the installer would say so. So an installer is not built without it.
const url = (process.env.VITE_SERVER_URL ?? '').trim()
let ok = false
try { const parsed = new URL(url); ok = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0 } catch { /* not an address */ }
if (!ok) {
  console.error([
    '',
    'VITE_SERVER_URL is not set, so this installer would open on http://localhost:5080 and never update itself.',
    'Set it to your Maplecord server and build again, for example:',
    '',
    '  VITE_SERVER_URL=https://chat.example.com npm run dist:win        (bash)',
    '  $env:VITE_SERVER_URL = "https://chat.example.com"; npm run dist:win   (PowerShell)',
    '',
  ].join('\n'))
  process.exit(1)
}
console.log(`Building the app for ${url}`)
