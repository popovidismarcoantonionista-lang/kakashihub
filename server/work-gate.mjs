// Render free tem CPU/RAM para uma tarefa pesada por vez. Este gate evita que
// um render/trim/compilação rode enquanto a live está gravando uma janela (e
// vice-versa), que era o que derrubava o processo no meio do render.
let heavyWork = 0
let liveRecording = 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

export async function waitForLiveRecording(timeoutMs = 26000) {
  const deadline = Date.now() + timeoutMs
  while (liveRecording > 0 && Date.now() < deadline) await sleep(500)
}
