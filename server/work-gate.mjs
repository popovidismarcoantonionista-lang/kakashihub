// Render free tem CPU/RAM para uma tarefa pesada por vez. Este gate evita que
// um render/trim/compilação rode enquanto a live está gravando uma janela (e
// vice-versa), e serializa os jobs pesados entre si — dois renders concorrentes
// estouravam a memória e derrubavam o processo no meio do corte.
let heavyWork = 0
let liveRecording = 0
let heavyChain = Promise.resolve()
const queuedJobs = new Set()
// Exclusão de fonte/vídeo longo: o job pode estar na fila ou com ffmpeg já
// rodando. O sinal em memória acompanha a execução até o ponto em que ela
// escreve estado/arquivo, para um render cancelado não ressuscitar o que foi
// apagado.
const cancelledJobs = new Set()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function requestJobCancellation(jobId) {
  if (!jobId) return
  cancelledJobs.add(jobId)
  // O sinal só precisa viver até o job terminar. Sem limite, um site rodando
  // há semanas acumularia um id por exclusão sem necessidade.
  if (cancelledJobs.size > 200) {
    for (const id of cancelledJobs) {
      cancelledJobs.delete(id)
      if (cancelledJobs.size <= 100) break
    }
  }
}

export function clearJobCancellation(jobId) {
  if (jobId) cancelledJobs.delete(jobId)
}

export function isJobCancelled(jobId) {
  return Boolean(jobId && cancelledJobs.has(jobId))
}

// Fontes de teste que entraram em loop de reprocessamento. Mesmo que ainda
// existam no banco, o boot/watchdog nunca deve voltar a tocá-las.
const IGNORED_SOURCE_IDS = new Set([
  'src-live-mwv2ywh2-uiq',
  'src-live-mwuvnn13-dot-1.mp4',
])

export function isIgnoredSource(id) {
  return Boolean(id && IGNORED_SOURCE_IDS.has(id))
}

// Um job pode ficar mais de 15 min esperando a fila (uma compilação longa leva
// ~26 min no Render free). O limpador de jobs órfãos precisa saber disso para
// não transformar espera legítima em erro.
export function markJobQueued(jobId) {
  if (jobId) queuedJobs.add(jobId)
}

export function unmarkJobQueued(jobId) {
  if (jobId) queuedJobs.delete(jobId)
}

export function isJobQueued(jobId) {
  return queuedJobs.has(jobId)
}

// Fila exclusiva: o próximo job pesado só começa quando o anterior termina.
// A corrente absorve erros para um job falho não travar toda a fila.
export function runHeavyExclusive(task) {
  const run = heavyChain.then(task, task)
  heavyChain = run.then(() => {}, () => {})
  return run
}

export function beginHeavyWork() {
  heavyWork += 1
}

export function endHeavyWork() {
  heavyWork = Math.max(0, heavyWork - 1)
}

export function heavyWorkActive() {
  return heavyWork > 0
}

export function beginLiveRecording() {
  liveRecording += 1
}

export function endLiveRecording() {
  liveRecording = Math.max(0, liveRecording - 1)
}

// Uma janela da live pode durar até clipMax (38s) + overhead; 26s deixava o
// ingest começar no meio de uma gravação e derrubar o processo no Render free.
export async function waitForLiveRecording(timeoutMs = 70000) {
  const deadline = Date.now() + timeoutMs
  while (liveRecording > 0 && Date.now() < deadline) await sleep(500)
}
