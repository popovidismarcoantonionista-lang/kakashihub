import {
  captureLiveWindowStep,
  failJobStep,
  getUploadScheduleStep,
  processJobStep,
  publishUploadStep,
  sourceBecameLiveStep,
  startLiveWorkflowStep,
} from './steps.mjs'
import { beginHeavyWork, endHeavyWork, runHeavyExclusive, waitForLiveRecording } from '../server/work-gate.mjs'

// `use workflow` / `sleep` do SDK exigem um build Nitro/Next. Aqui as funções
// são orquestrações comuns executadas por server/background.mjs no mesmo
// processo do Express (modelo de deploy do Render).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function processJobWorkflow(kind, payload) {
  // Render/trim/compilação e análise de vídeo não podem concorrer com a gravação
  // da live no Render free: era isso que derrubava o ingest no meio do corte.
  const heavy = kind === 'render' || kind === 'trim' || kind === 'compilation'
    || kind === 'ingest' || kind === 'analyze'

  const execute = async () => {
    if (heavy) {
      beginHeavyWork()
      await waitForLiveRecording()
    }
    try {
      const result = await processJobStep(kind, payload)
      if (kind === 'analyze' && await sourceBecameLiveStep(payload.sourceId)) {
        await startLiveWorkflowStep(payload.sourceId)
      }
      return result
    } catch (error) {
      await failJobStep(payload.jobId, error?.message || 'O processamento falhou.')
      throw error
    } finally {
      if (heavy) endHeavyWork()
    }
  }

  // Um job pesado por vez. Sem a fila, dois renders rodavam juntos, estouravam
  // RAM/CPU no Render free e o processo reiniciava com o corte pela metade.
  return heavy ? runHeavyExclusive(execute) : execute()
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
