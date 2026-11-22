import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workflow } from 'workflow/vite'

export default defineConfig({
  plugins: [nitro(), workflow(), react()],
  nitro: {
    serverDir: './',
    preset: 'netlify',
    routes: {
      '/api/**': { handler: './server/index.mjs', format: 'node' },
      '/media/**': { handler: './server/index.mjs', format: 'node' },
      '/covers/**': { handler: './server/index.mjs', format: 'node' },
    },
    workflow: { runtime: 'nodejs24.x' },
  },
  server: {
    host: true,
    port: 4780,
    allowedHosts: ['.vercel.run'],
  },
})
