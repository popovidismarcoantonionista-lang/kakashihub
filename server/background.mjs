// No Render a aplicação é um único processo Express. O SDK de Workflows exige
// uma transformação de build (Nitro/Next) que não existe nesse modelo, então
// as tarefas são executadas como promises em background no mesmo processo.
// Cada step chama withStore(), que carrega e persiste o contexto isoladamente.
let counter = 0

export function runBackground(name, task, args = []) {
  const runId = `local-${name}-${Date.now().toString(36)}-${(counter++).toString(36)}`
  setImmediate(() => {
    Promise.resolve(task(...args)).catch((error) => {
      console.error(`[background:${name}]`, error?.stack || error?.message || String(error))
    })
  })
  return runId
}
