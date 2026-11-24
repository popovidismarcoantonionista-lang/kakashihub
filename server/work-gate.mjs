// Render free tem CPU/RAM para uma tarefa pesada por vez. Este gate evita que
// um render/trim/compilação rode enquanto a live está gravando uma janela (e
// vice-versa), e serializa os jobs pesados entre si — dois renders concorrentes
// estouravam a memória e derrubavam o processo no meio do corte.
let heavyWork = 0
let liveRecording = 0
let heavyChain = Promise.resolve()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
