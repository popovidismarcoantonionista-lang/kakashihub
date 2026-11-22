import { runBackground } from '../server/background.mjs'
import { runAnalyze, runCompilation, runIngest, runRender, runTrim, captureLiveWindow } from '../server/pipeline.mjs'
import { finishJob, getJob, getState, save, withStore } from '../server/store.mjs'
import { publishScheduledUpload } from '../server/publishing.mjs'
import { liveMonitorWorkflow } from './jobs.mjs'

export async function processJobStep(kind, payload) {
  'use step'

  return withStore(async () => {
    switch (kind) {
      case 'analyze':
        return runAnalyze(payload.sourceId, { jobId: payload.jobId })
      case 'ingest':
        return runIngest(payload.sourceId, payload.url || '', {
          ...(payload.options || {}),
          jobId: payload.jobId,
        })
      case 'render':
        return runRender(payload.clipId, { jobId: payload.jobId })
      case 'trim': {
        const clip = await runTrim(payload.clipId, payload.start, payload.end, { jobId: payload.jobId })
        await renderTrimmedClipStep(clip.id)
        return clip
      }
      case 'compilation':
        return runCompilation(payload.compilationId, { jobId: payload.jobId })
      default:
        throw new Error('Tipo de processamento não suportado.')
    }
  })
}

async function renderTrimmedClipStep(clipId) {
  'use step'

  return withStore(() => runRender(clipId))
}

export async function sourceBecameLiveStep(sourceId) {
  'use step'

  return withStore(() => getState().sources.some((source) => source.id === sourceId && source.mode === 'live'))
}

export async function failJobStep(jobId, message) {
  'use step'

  if (!jobId) return
  await withStore(() => {
    const job = getJob(jobId)
    if (job && job.status === 'running') finishJob(job, new Error(String(message).slice(0, 400)))
  })
}

export async function captureLiveWindowStep(sourceId) {
  'use step'

  return withStore(() => captureLiveWindow(sourceId))
}

export async function startLiveWorkflowStep(sourceId) {
  'use step'

  // Persiste a liberação antes de iniciar o loop para ele não herdar uma
  // solicitação de parada de uma execução anterior.
  await withStore(() => {
    const source = getState().sources.find((item) => item.id === sourceId)
    if (source) {
      source.liveStopRequested = false
      save()
    }
  })
  const runId = runBackground('live', liveMonitorWorkflow, [sourceId])
  await withStore(() => {
    const source = getState().sources.find((item) => item.id === sourceId)
    if (source) {
      source.liveWorkflowId = runId
      save()
    }
  })
  return runId
}

export async function getUploadScheduleStep(uploadId) {
  'use step'

  return withStore(() => {
    const upload = getState().uploads.find((item) => item.id === uploadId)
    if (!upload) return null
    const scheduledAt = Date.parse(upload.scheduledAt)
    return { status: upload.status, scheduledAt: upload.scheduledAt, due: Number.isFinite(scheduledAt) && scheduledAt <= Date.now() }
  })
}

export async function publishUploadStep(uploadId) {
  'use step'

  return publishScheduledUpload(uploadId)
}
