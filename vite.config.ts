import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// The one place the version is written down (see scripts/version.mjs).
const version = fs.readFileSync(new URL('./version.txt', import.meta.url), 'utf8').trim()
// "owner/name" on GitHub, from package.json: the only place the built app will take an update from.
const repository = String(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).repository ?? '')
  .replace(/^github:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')

/**
 * What the app's page may run: its own scripts and workers, and nothing written into the page or brought in from
 * anywhere else, so text that slipped past everything else still could not run as a script. (Pictures, sound and
 * connections are not limited here: they come from whichever Maplecord server the app is pointed at.) Built pages
 * only: the development server writes scripts of its own into the page. (capacitor: is where the iPhone app's page
 * comes from; it names that page's own files, nothing outside them.)
 */
const contentSecurityPolicy = "script-src 'self' file: capacitor:; worker-src 'self' file: blob: capacitor:; object-src 'none'; base-uri 'none'"

// `vite --mode web` builds/serves the renderer as a plain web app (phone roll page, browser testing).
// Any other mode wraps it in Electron.
export default defineConfig(({ mode }) => ({
  // Relative, so the same build works installed (loaded from a file) and on a web server at any path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      name: 'content-security-policy',
      apply: 'build',
      transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`),
    },
    ...(mode === 'web'
      ? []
      : [
          electron({
            main: {
              entry: 'electron/main.ts',
              // The server the app is built for is also the one it asks whether it is out of date.
              vite: { define: { __UPDATE_SERVER__: JSON.stringify(process.env.VITE_SERVER_URL ?? ''), __UPDATE_REPO__: JSON.stringify(repository) } },
            },
            preload: { input: 'electron/preload.ts' },
            // No renderer option: the windows have no Node (contextIsolation, no nodeIntegration). With it, imports named
            // like Node's own modules ("buffer", which the picture check uses) were left for a require() that does not
            // exist there, and the picture check never started in the desktop app.
          }),
        ]),
  ],
  // The installer is assembled in release/; watching it makes the packager's file moves fail on Windows.
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/release/**'] } },
  build: { outDir: 'dist' },
}))
