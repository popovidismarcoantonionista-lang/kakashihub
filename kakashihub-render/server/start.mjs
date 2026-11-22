import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from './index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const port = Number(process.env.PORT) || 4780

if (fs.existsSync(DIST)) {
  app.use((await import('express')).default.static(DIST, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/covers/')) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] Kakashi Hub ouvindo em 0.0.0.0:${port}`)
})
