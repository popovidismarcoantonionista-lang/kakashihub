import {
  captureLiveWindowStep,
  failJobStep,
  getUploadScheduleStep,
  processJobStep,
  publishUploadStep,
  sourceBecameLiveStep,
  startLiveWorkflowStep,
} from './steps.mjs'
import { beginHeavyWork, endHeavyWork } from '../server/work-gate.mjs'

// `use workflow` / `sleep` do SDK exigem um build Nitro/Next. Aqui as funções
// são orquestrações comuns executadas por server/background.mjs no mesmo
// processo do Express (modelo de deploy do Render).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function processJobWorkflow(kind, payload) {
  // Render/trim/compilação não podem concorrer com a gravação da live no Render free.
  const heavy = kind === 'render' || kind === 'trim' || kind === 'compilation'
  if (heavy) beginHeavyWork()
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
