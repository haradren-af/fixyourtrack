import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const contentSecurityPolicy = "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com; connect-src 'self' https://tile.openstreetmap.org https://server.arcgisonline.com https://router.project-osrm.org https://brouter.de https://routing.openstreetmap.de https://api.open-elevation.com; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const developmentContentSecurityPolicy = contentSecurityPolicy.replace(
  "script-src 'self' blob:",
  "script-src 'self' blob: 'unsafe-inline'",
)
const securityHeaders = {
  'Content-Security-Policy': contentSecurityPolicy,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}
const developmentSecurityHeaders = {
  ...securityHeaders,
  // Vite's React refresh preamble is an inline module in development. Blocking it
  // prevents React from mounting and leaves only the page background visible.
  'Content-Security-Policy': developmentContentSecurityPolicy,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: developmentSecurityHeaders,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: securityHeaders,
  },
})
