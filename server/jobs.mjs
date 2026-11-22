import {
  liveMonitorWorkflow,
  processJobWorkflow,
  scheduledUploadWorkflow,
} from '../workflows/jobs.mjs'
import { runBackground } from './background.mjs'
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
