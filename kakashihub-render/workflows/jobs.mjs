import { sleep } from 'workflow'
import {
  captureLiveWindowStep,
  failJobStep,
  getUploadScheduleStep,
  processJobStep,
  publishUploadStep,
  sourceBecameLiveStep,
  startLiveWorkflowStep,
} from './steps.mjs'

export async function processJobWorkflow(kind, payload) {
  'use workflow'

  try {
    const result = await processJobStep(kind, payload)
    if (kind === 'analyze' && await sourceBecameLiveStep(payload.sourceId)) {
      await startLiveWorkflowStep(payload.sourceId)
    }
    return result
  } catch (error) {
    await failJobStep(payload.jobId, error?.message || 'O processamento falhou.')
    throw error
  }
}

export async function liveMonitorWorkflow(sourceId) {
  'use workflow'

  while (true) {
    const result = await captureLiveWindowStep(sourceId)
    if (!result?.continue) return result
    await sleep('5s')
  }
}

export async function scheduledUploadWorkflow(uploadId) {
  'use workflow'

  while (true) {
    const schedule = await getUploadScheduleStep(uploadId)
    if (!schedule || schedule.status !== 'agendado') return { status: schedule?.status || 'missing' }
    if (schedule.due) return publishUploadStep(uploadId)
    await sleep(new Date(schedule.scheduledAt))
  }
}
