import {
  captureLiveWindowStep,
  failJobStep,
  getUploadScheduleStep,
  processJobStep,
  publishUploadStep,
  sourceBecameLiveStep,
  startLiveWorkflowStep,
} from './steps.mjs'
import {
  beginHeavyWork,
  endHeavyWork,
  clearJobCancellation,
  isJobCancelled,
  markJobQueued,
  runHeavyExclusive,
  unmarkJobQueued,
  waitForLiveRecording,
} from '../server/work-gate.mjs'
import { runBackground } from '../server/background.mjs'
import {
  addActivity,
  createJob,
  findClip,
  flushStore,
  save,
  saveJobs,
  withStore,
} from '../server/store.mjs'

// `use workflow` / `sleep` do SDK exigem um build Nitro/Next. Aqui as funções
// são orquestrações comuns executadas por server/background.mjs no mesmo
// processo do Express (modelo de deploy do Render).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Depois da análise, os cortes sugeridos entram na mesma fila exclusiva dos
// renders manuais. Nada roda em paralelo: o runHeavyExclusive abaixo recebe os
// novos jobs enquanto o job de análise ainda está concluindo.
async function enqueueAutoRenders(clips, options) {
  return withStore(async () => {
    const aspect = options?.aspect === '16:9' ? '16:9' : '9:16'
    const limit = Math.min(40, Math.max(1, Number(options?.limit) || 12))
    const list = (Array.isArray(clips) ? clips : [])
      .filter((clip) => clip && findClip(clip.id))
      .slice(0, limit)
    if (!list.length) return 0
    const started = []
    for (const item of list) {
      const clip = findClip(item.id)
      clip.aspect = aspect
      const job = createJob('render', { clipId: clip.id, sourceId: clip.sourceId })
      const runId = runBackground('job', processJobWorkflow, ['render', {
        clipId: clip.id,
        jobId: job.id,
        ...(options?.muteAudio === true ? { muteAudio: true } : {}),
      }])
      job.workflowRunId = runId
      started.push(runId)
    }
    addActivity('agent', `${started.length} cortes enfileirados automaticamente em ${aspect}`)
    save()
    saveJobs()
    try {
      await flushStore()
    } catch (error) {
      console.error('[auto-cortes] falha transitória ao persistir fila:', String(error?.message || error).slice(0, 300))
    }
    return started.length
  })
}

export async function processJobWorkflow(kind, payload) {
  // Render/trim/compilação e análise de vídeo não podem concorrer com a gravação
  // da live no Render free: era isso que derrubava o ingest no meio do corte.
  const heavy = kind === 'render' || kind === 'trim' || kind === 'compilation'
    || kind === 'ingest' || kind === 'analyze'

  const execute = async () => {
    if (isJobCancelled(payload.jobId)) return { status: 'cancelado' }
    unmarkJobQueued(payload.jobId)
    let heavyStarted = false
    if (heavy) {
      beginHeavyWork()
      heavyStarted = true
    }
    try {
      if (heavy) await waitForLiveRecording()
      // Pode ter sido cancelado enquanto esperava a fila ou a gravação da live.
      if (isJobCancelled(payload.jobId)) return { status: 'cancelado' }
      const result = await processJobStep(kind, payload)
      if (kind === 'analyze' && payload.autoRender && Array.isArray(result)) {
        await enqueueAutoRenders(result, payload.autoRender)
      }
      if (kind === 'analyze' && await sourceBecameLiveStep(payload.sourceId)) {
        await startLiveWorkflowStep(payload.sourceId)
      }
      return result
    } catch (error) {
      if (!isJobCancelled(payload.jobId)) {
        await failJobStep(payload.jobId, error?.message || 'O processamento falhou.')
      }
      throw error
    } finally {
      if (heavyStarted) endHeavyWork()
      clearJobCancellation(payload.jobId)
    }
  }

  // Um job pesado por vez. Sem a fila, dois renders rodavam juntos, estouravam
  // RAM/CPU no Render free e o processo reiniciava com o corte pela metade.
  if (!heavy) return execute()
  markJobQueued(payload.jobId)
  return runHeavyExclusive(execute)
}

export async function liveMonitorWorkflow(sourceId) {
  for (;;) {
    const result = await captureLiveWindowStep(sourceId)
    if (!result?.continue) return result
    await sleep(5000)
  }
}

export async function scheduledUploadWorkflow(uploadId) {
  for (;;) {
    const schedule = await getUploadScheduleStep(uploadId)
    if (!schedule || schedule.status !== 'agendado') return { status: schedule?.status || 'missing' }
    if (schedule.due) return publishUploadStep(uploadId)
    const dueAt = Date.parse(schedule.scheduledAt)
    const waitMs = Number.isFinite(dueAt) ? Math.min(Math.max(dueAt - Date.now(), 1000), 60000) : 5000
    await sleep(waitMs)
  }
}
