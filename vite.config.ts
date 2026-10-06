import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// `vite --mode web` builds/serves the renderer as a plain web app (phone roll page, browser testing).
// Any other mode wraps it in Electron.
export default defineConfig(({ mode }) => ({
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
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
}))
