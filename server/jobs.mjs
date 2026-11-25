import {
  liveMonitorWorkflow,
  processJobWorkflow,
  scheduledUploadWorkflow,
} from '../workflows/jobs.mjs'
import { runBackground } from './background.mjs'
import { createJob, flushStore, getJobs, getState, save, saveJobs, withStore } from './store.mjs'

const JOB_TYPES = {
  analyze: 'ingest',
  ingest: 'ingest',
  render: 'render',
  trim: 'render',
  compilation: 'compile',
}

export async function startProcessJob(kind, payload, metadata = {}) {
  const job = createJob(JOB_TYPES[kind] || kind, metadata)
  await flushStore()
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
      && ['render', 'compile'].includes(job.kind))
    for (const job of pending) {
      const targetId = job.kind === 'compile' ? job.compilationId : job.clipId
      if (!targetId) continue
      const payload = job.kind === 'compile'
        ? { compilationId: job.compilationId }
        : { clipId: job.clipId }
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
