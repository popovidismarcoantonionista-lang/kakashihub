import {
  liveMonitorWorkflow,
  processJobWorkflow,
  scheduledUploadWorkflow,
} from '../workflows/jobs.mjs'
import { runBackground } from './background.mjs'
import { createJob, finishJob, flushStore, getJob, getJobs, getState, save, saveJobs, withStore } from './store.mjs'

const JOB_TYPES = {
  analyze: 'ingest',
  ingest: 'ingest',
  render: 'render',
  trim: 'render',
  compilation: 'compile',
}

export async function startProcessJob(kind, payload, metadata = {}) {
  const job = createJob(JOB_TYPES[kind] || kind, metadata)
  // O job já existe em memória. Uma falha transitória do Postgres aqui não
  // pode impedir o processamento nem fazer a API responder erro para o front
  // (o upload-complete, por exemplo, mostraria "Não foi possível concluir").
  try {
    await flushStore()
  } catch (error) {
    console.error('[jobs] falha ao antecipar persistência:', String(error?.message || error).slice(0, 300))
  }
  const runId = runBackground('job', processJobWorkflow, [kind, { ...payload, jobId: job.id }])
  job.workflowRunId = runId
  saveJobs()
  return { job, runId }
}

export async function startLiveWorkflow(sourceId) {
  const source = getState().sources.find((item) => item.id === sourceId)
  if (source) {
    source.liveStopRequested = false
    save()
  }
  await flushStore()
  const runId = runBackground('live', liveMonitorWorkflow, [sourceId])
  const target = getState().sources.find((item) => item.id === sourceId)
  if (target) {
    target.liveWorkflowId = runId
    save()
  }
  return runId
}

export async function startUploadWorkflow(uploadId) {
  await flushStore()
  const runId = runBackground('upload', scheduledUploadWorkflow, [uploadId])
  const upload = getState().uploads.find((item) => item.id === uploadId)
  if (upload) {
    upload.workflowRunId = runId
    save()
  }
  return runId
}

// O workflow da live roda em memória. Se o processo cair ou a promise morrer
// sem chamar finishLiveStep, a fonte continua "ao vivo" mas para de gerar
// cortes. Este watchdog religa o monitoramento quando isso acontece.
const LIVE_STALE_MS = 3 * 60 * 1000
let recoveringLives = false

export async function recoverLiveWorkflows() {
  if (recoveringLives) return 0
  recoveringLives = true
  try {
    const snapshot = await withStore(() => ({
      sources: getState().sources.map((s) => ({ ...s })),
      jobs: getJobs(),
    }))
    const restartIds = []
    for (const source of snapshot.sources) {
      if (source.mode !== 'live') continue
      if (!['ao-vivo', 'processando'].includes(source.status)) continue
      if (source.liveEndedAt || source.liveStopRequested) continue
      const job = snapshot.jobs.find((item) => item.id === source.liveJobId)
      const paused = /pausado durante o processamento/i.test(job?.step || '')
      if (paused) continue
      const checked = Date.parse(source.liveCheckedAt || source.liveStartedAt || 0)
      const started = Date.parse(job?.startedAt || 0)
      const freshJob = Number.isFinite(started) && Date.now() - started < LIVE_STALE_MS
      const stale = job?.status !== 'running'
        || (!freshJob && (!Number.isFinite(checked) || Date.now() - checked > LIVE_STALE_MS))
      if (!stale) continue
      await withStore(() => {
        const old = getJob(source.liveJobId)
        if (old && old.status === 'running') finishJob(old, new Error('Monitoramento reiniciado.'))
        const current = getState().sources.find((item) => item.id === source.id)
        if (current) {
          current.liveJobId = ''
          current.status = 'ao-vivo'
          current.error = null
          save()
        }
      })
      restartIds.push(source.id)
    }
    for (const id of restartIds) await startLiveWorkflow(id)
    return restartIds.length
  } finally {
    recoveringLives = false
  }
}

let resumingJobs = false

// Render free reinicia o processo no meio de um render/compilação. Esses trabalhos
// são locais (não dependem de download externo), então são refeitos no boot em vez
// de virarem um erro genérico. Só entra na fila quando não há mais nada rodando.
export async function resumePendingJobs() {
  if (resumingJobs) return 0
  resumingJobs = true
  try {
    const jobs = await withStore(() => getJobs())
    const busy = jobs.some((job) => job.status === 'running'
      && ['render', 'compile', 'ingest'].includes(job.kind))
    if (busy) return 0
    const pending = jobs.filter((job) => job.status === 'pendente'
      && job.retryPending === true
      && ['render', 'compile', 'ingest', 'analyze'].includes(job.kind))
    for (const job of pending) {
      const isIngest = job.kind === 'ingest' || job.kind === 'analyze'
      const targetId = job.kind === 'compile'
        ? job.compilationId
        : isIngest ? job.sourceId : job.clipId
      if (!targetId) continue
      const payload = job.kind === 'compile'
        ? { compilationId: job.compilationId }
        : isIngest ? { sourceId: job.sourceId } : { clipId: job.clipId }
      await withStore(() => startProcessJob(job.kind, payload, {
        id: job.id,
        sourceId: job.sourceId,
        clipId: job.clipId,
        compilationId: job.compilationId,
        retryPending: false,
      }))
    }
    return pending.length
  } finally {
    resumingJobs = false
  }
}
