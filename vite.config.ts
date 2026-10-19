import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /oc/* is forwarded to `opencode serve` (npm run opencode), so the browser never hits CORS.
const OPENCODE = process.env.OPENCODE_URL ?? 'http://127.0.0.1:4096'

// The version the About pane shows.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: './', // relative asset paths so the packaged app can load dist/index.html from disk
  plugins: [react()],
  server: {
    proxy: {
      '/oc': { target: OPENCODE, changeOrigin: true, rewrite: (p) => p.replace(/^\/oc/, '') },
    },
  },
})
