import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /oc/* is forwarded to `opencode serve` (npm run opencode), so the browser never hits CORS.
const OPENCODE = process.env.OPENCODE_URL ?? 'http://127.0.0.1:4096'

export default defineConfig({
  base: './', // relative asset paths so the packaged app can load dist/index.html from disk
  plugins: [react()],
  server: {
    proxy: {
      '/oc': { target: OPENCODE, changeOrigin: true, rewrite: (p) => p.replace(/^\/oc/, '') },
    },
  },
})
