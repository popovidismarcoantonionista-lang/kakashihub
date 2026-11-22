import { start } from 'workflow/api'
import { processJobWorkflow, liveMonitorWorkflow, scheduledUploadWorkflow } from '../workflows/jobs.mjs'
import { createJob, flushStore, getState, save, saveJobs } from './store.mjs'

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
  const run = await start(processJobWorkflow, [kind, { ...payload, jobId: job.id }])
  job.workflowRunId = run.runId
  saveJobs()
  return { job, runId: run.runId }
}

export async function startLiveWorkflow(sourceId) {
  await flushStore()
  const run = await start(liveMonitorWorkflow, [sourceId])
  const source = getState().sources.find((item) => item.id === sourceId)
  if (source) {
    source.liveWorkflowId = run.runId
    source.liveStopRequested = false
    save()
  }
  return run.runId
}

export async function startUploadWorkflow(uploadId) {
  await flushStore()
  const run = await start(scheduledUploadWorkflow, [uploadId])
  const upload = getState().uploads.find((item) => item.id === uploadId)
  if (upload) {
    upload.workflowRunId = run.runId
    save()
  }
  return run.runId
}
