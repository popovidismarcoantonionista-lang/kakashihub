import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workflow } from 'workflow/vite'

// O deploy no Render é um único processo Express que serve `dist/` diretamente.
// O plugin nitro (preset netlify) consumia index.html como template de renderer
// e não gerava dist/index.html, deixando a aplicação sem frontend.
export default defineConfig({
  plugins: [workflow(), react()],
  server: {
    host: true,
    port: 4780,
    allowedHosts: ['.vercel.run'],
  },
})
