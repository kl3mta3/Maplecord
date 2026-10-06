import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// `vite --mode web` builds/serves the renderer as a plain web app (phone roll page, browser testing).
// Any other mode wraps it in Electron.
export default defineConfig(({ mode }) => ({
  // Relative, so the same build works installed (loaded from a file) and on a web server at any path.
  base: './',
  plugins: [
    react(),
    ...(mode === 'web'
      ? []
      : [
          electron({
            main: { entry: 'electron/main.ts' },
            preload: { input: 'electron/preload.ts' },
            renderer: {},
          }),
        ]),
  ],
  // The installer is assembled in release/; watching it makes the packager's file moves fail on Windows.
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/release/**'] } },
  build: { outDir: 'dist' },
}))
