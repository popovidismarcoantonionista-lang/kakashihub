// No Render a aplicação é um único processo Express. O SDK de Workflows exige
// uma transformação de build (Nitro/Next) que não existe nesse modelo, então
// as tarefas são executadas como promises em background no mesmo processo.
// Cada step chama withStore(), que carrega e persiste o contexto isoladamente.
let counter = 0
// Registro das promises vivas. O watchdog de lives precisa saber se o
// monitoramento já está rodando antes de religar uma fonte: sem isso, o boot
// iniciava a captura e o timer 15s iniciava uma segunda logo em seguida.
const activeRuns = new Map()

export function runBackground(name, task, args = []) {
  const runId = `local-${name}-${Date.now().toString(36)}-${(counter++).toString(36)}`
  activeRuns.set(runId, { name, args, startedAt: Date.now() })
  setImmediate(() => {
    Promise.resolve()
      .then(() => task(...args))
      .catch((error) => {
        console.error(`[background:${name}]`, error?.stack || error?.message || String(error))
      })
      .finally(() => activeRuns.delete(runId))
  })
  return runId
}

export function hasActiveRun(name, arg) {
  for (const run of activeRuns.values()) {
    if (run.name !== name) continue
    if (arg !== undefined && run.args[0] !== arg) continue
    return true
  }
  return false
}
