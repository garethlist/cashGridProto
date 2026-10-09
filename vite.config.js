import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Served from '/' locally and for the inlined single-file artifact; the GitHub
  // Pages build sets BASE_PATH=/cashGridProto/ so asset URLs resolve under the
  // project page (https://<user>.github.io/cashGridProto/).
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: {
    // inline.mjs only carries the JS and CSS bundles, so imported assets (the
    // ~9 kB brand marks) must be inlined as data URIs rather than emitted as files.
    assetsInlineLimit: 64 * 1024,
  },
  server: {
    port: 5173,
    open: true,
  },
})
