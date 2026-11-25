import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from './index.mjs'
import { withStore, closeOrphanWork, getState, save, sweepStaleJobs } from './store.mjs'
import { startLiveWorkflow, resumePendingJobs, recoverLiveWorkflows } from './jobs.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const port = Number(process.env.PORT) || 4780

const serveFrontend = !['1', 'true', 'yes'].includes(String(process.env.BACKEND_ONLY || '').toLowerCase())
  && !['0', 'false', 'no'].includes(String(process.env.SERVE_FRONTEND || 'true').toLowerCase())

if (serveFrontend && fs.existsSync(DIST)) {
  app.use((await import('express')).default.static(DIST, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/covers/')) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

const resumeLiveIds = await withStore(() => {
  closeOrphanWork()
  return getState().sources.filter((s) => s.liveResumePending).map((s) => s.id)
})

for (const id of resumeLiveIds) {
  await withStore(() => {
    const source = getState().sources.find((s) => s.id === id)
    if (source) {
      delete source.liveResumePending
      save()
    }
  })
  try {
    await startLiveWorkflow(id)
    console.log(`[live] monitoramento retomado após reinício: ${id}`)
  } catch (err) {
    console.error('[live] falha ao retomar monitoramento:', id, err?.message || err)
  }
}

async function liveActive() {
  return withStore(() => getState().sources.some((source) => (
    source.mode === 'live'
    && ['ao-vivo', 'processando'].includes(source.status)
    && !source.liveStopRequested
    && !source.liveEndedAt
    && !source.liveResumePending
  )))
}

async function resumePendingWhenIdle() {
  // Antes de filar jobs pesados, verifica se alguma live ainda está no ar com
  // o monitoramento parado silenciosamente e religa essa captura.
  await recoverLiveWorkflows()
  if (await liveActive()) return
  await resumePendingJobs()
}

await withStore(() => sweepStaleJobs())
await resumePendingWhenIdle()
const resumeTimer = setInterval(() => {
  withStore(() => sweepStaleJobs())
    .then(() => resumePendingWhenIdle())
    .catch((error) => {
      console.error('[jobs] falha ao retomar trabalhos pendentes:', error?.message || error)
    })
}, 15000)
resumeTimer.unref?.()

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] Kakashi Hub ouvindo em 0.0.0.0:${port}`)
})
