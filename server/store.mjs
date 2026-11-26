import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { desc, eq, sql } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { db } from './db.mjs'
import { fugaJobs, fugaState } from './schema.mjs'
import { seedState } from './seed.mjs'
import { isPortugueseCaptionText, portugueseHookOrDefault } from './pt-text.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
const CONFIGURED_DATA_DIR = String(process.env.FUGA_DATA_DIR || '').trim()
const IS_SERVERLESS = Boolean(
  process.env.NETLIFY
  || process.env.NETLIFY_FUNCTIONS_VERSION
  || process.env.VERCEL
  || process.env.AWS_LAMBDA_FUNCTION_NAME,
)
const USE_TEMP_DATA = IS_SERVERLESS || CONFIGURED_DATA_DIR === '/var/data'
export const DATA = USE_TEMP_DATA
  ? path.join('/tmp', 'fuga-data')
  : CONFIGURED_DATA_DIR
    ? path.resolve(CONFIGURED_DATA_DIR)
    : path.join(ROOT, 'data')
export const MEDIA = path.join(DATA, 'media')
export const SRC_MEDIA = path.join(MEDIA, 'src')
export const EXPORTS = path.join(MEDIA, 'exports')
export const COVERS = path.join(DATA, 'covers')
const STATE_FILE = path.join(DATA, 'state.json')
const JOBS_FILE = path.join(DATA, 'jobs.json')
const CONNECTIONS_FILE = path.join(DATA, 'connections.json')
const contextStorage = new AsyncLocalStorage()
let databaseUnavailable = !process.env.DATABASE_URL && !process.env.POSTGRES_URL

for (const dir of [DATA, MEDIA, SRC_MEDIA, EXPORTS, COVERS]) {
  fs.mkdirSync(dir, { recursive: true })
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Reconcilia o estado sem trocar as referências que rotinas longas guardaram
// (state, source, clip, comp). Arrays com itens id preservam a identidade de
// cada item pelo id e mantêm a ordem recebida.
export function assignInPlace(target, source) {
  // A reconciliação pode receber o próprio objeto (mergeChanges devolve `ours`
  // quando `theirs` é igual à base). Copiar um array nele mesmo esvaziaria a
  // lista, então nunca compartilhamos a referência de origem/destino.
  if (target === source) return target
  // Não apagar chaves ausentes: mergedState pode vir de um registro antigo do
  // banco sem `clips`/`settings`, e apagar aqui derruba o ingest (state.clips
  // undefined) e perde configurações.
  for (const key of Object.keys(source)) {
    const next = source[key]
    const current = target[key]
    if (next === current) continue
    if (isObject(next) && isObject(current)) {
      assignInPlace(current, next)
    } else if (Array.isArray(next) && Array.isArray(current)) {
      const byId = (arr) => new Map(
        arr.filter((item) => isObject(item) && typeof item.id === 'string').map((item) => [item.id, item]),
      )
      const currentById = byId(current)
      const nextById = byId(next)
      const keyed = currentById.size === current.length && nextById.size === next.length
      const rebuilt = keyed
        ? next.map((item) => {
          const existing = currentById.get(item.id)
          if (existing) {
            assignInPlace(existing, item)
            return existing
          }
          return item
        })
        : next
      current.length = 0
      current.push(...rebuilt)
    } else {
      target[key] = next
    }
  }
  return target
}

export function mergeChanges(base, ours, theirs) {
  if (isDeepStrictEqual(ours, base)) return theirs
  if (isDeepStrictEqual(theirs, base)) return ours

  if (isObject(base) && isObject(ours) && isObject(theirs)) {
    const result = {}
    const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
    for (const key of keys) {
      const baseHas = Object.hasOwn(base, key)
      const oursHas = Object.hasOwn(ours, key)
      const theirsHas = Object.hasOwn(theirs, key)
      // Nunca omitir uma chave do resultado: um registro antigo do banco sem
      // `clips`/`settings` deve ser completado, não replicado como buraco.
      if (!oursHas) {
        if (theirsHas) result[key] = theirs[key]
        continue
      }
      if (!theirsHas) {
        result[key] = ours[key]
        continue
      }
      result[key] = mergeChanges(baseHas ? base[key] : undefined, ours[key], theirs[key])
    }
    return result
  }

  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs) &&
      [...base, ...ours, ...theirs].every((item) => isObject(item) && typeof item.id === 'string')) {
    const baseById = new Map(base.map((item) => [item.id, item]))
    const oursById = new Map(ours.map((item) => [item.id, item]))
    const theirsById = new Map(theirs.map((item) => [item.id, item]))
    const order = [...ours.map((item) => item.id), ...theirs.map((item) => item.id).filter((id) => !oursById.has(id))]
    const merged = []
    for (const id of order) {
      const baseItem = baseById.get(id)
      const oursItem = oursById.get(id)
      const theirsItem = theirsById.get(id)
      // Item novo criado por outro contexto não existe na base: preserve-o.
      // Exigir baseItem aqui era o que fazia clipes, fontes e compilações
      // recém-criados desaparecerem quando uma tarefa antiga gravava depois.
      if (!oursItem) {
        if (theirsItem && (!baseItem || !isDeepStrictEqual(theirsItem, baseItem))) merged.push(theirsItem)
        continue
      }
      if (!theirsItem) {
        if (!baseItem || !isDeepStrictEqual(oursItem, baseItem)) merged.push(oursItem)
        continue
      }
      merged.push(mergeChanges(baseItem, oursItem, theirsItem))
    }
    return merged
  }

  return ours
}

function normalizeState(value) {
  const state = isObject(value) ? value : seedState()
  state.project ||= {}
  // Um estado antigo no banco pode vir sem settings ou com apenas alguns
  // campos. Sempre complete com os defaults, senão rotinas longas (ingest,
  // render) quebram ao ler clipMin/autoApprove/captions/watermark.
  const defaultSettings = seedState().settings
  state.settings = {
    ...defaultSettings,
    ...(isObject(state.settings) ? state.settings : {}),
    agents: {
      ...defaultSettings.agents,
      ...(isObject(state.settings?.agents) ? state.settings.agents : {}),
    },
  }
  state.project.channel = typeof state.project.channel === 'string' ? state.project.channel : ''
  const logo = state.project.logo
  if (logo && typeof logo === 'object' && typeof logo.url === 'string' && logo.url) {
    state.project.logo = {
      url: String(logo.url).slice(0, 500),
      x: Math.max(0, Math.min(1, Number(logo.x) || 0.5)),
      y: Math.max(0, Math.min(1, Number(logo.y) || 0.88)),
      w: Math.max(0.05, Math.min(0.8, Number(logo.w) || 0.28)),
      opacity: Math.max(0.1, Math.min(1, Number(logo.opacity) || 1)),
    }
  } else {
    state.project.logo = null
  }
  state.sources = Array.isArray(state.sources) ? state.sources : []
  // Estados antigos podem guardar título/legenda em inglês alucinados pelo
  // Whisper. Reescreve na leitura para o front e o render nunca mostrarem isso.
  const lineText = (line) => (typeof line === 'string' ? line : isObject(line) ? line.text : '')
  const ptLines = (lines) => (Array.isArray(lines) ? lines.filter((line) => isPortugueseCaptionText(lineText(line))) : lines)
  state.clips = Array.isArray(state.clips) ? state.clips.map((clip) => {
    if (!isObject(clip)) return clip
    const hook = portugueseHookOrDefault(clip.hook, clip.type, clip.niche)
    return {
      ...clip,
      aspect: clip.aspect === '16:9' ? '16:9' : '9:16',
      hook,
      description: isPortugueseCaptionText(clip.description) ? clip.description : hook,
      contextCaption: isPortugueseCaptionText(clip.contextCaption) ? clip.contextCaption : '',
      captionBlocks: ptLines(clip.captionBlocks),
      captionLines: ptLines(clip.captionLines),
    }
  }) : []
  state.compilations = Array.isArray(state.compilations) ? state.compilations.map((comp) => (
    isObject(comp) ? { ...comp, aspect: comp.aspect === '9:16' ? '9:16' : '16:9' } : comp
  )) : []
  state.uploads = Array.isArray(state.uploads) ? state.uploads : []
  state.activity = Array.isArray(state.activity) ? state.activity : []
  state.connections = isObject(state.connections) ? state.connections : {}
  state.oauthPending = isObject(state.oauthPending) ? state.oauthPending : {}
  return state
}

function stateHasContent(state) {
  return Boolean(state && (
    state.sources?.length || state.clips?.length || state.uploads?.length || state.compilations?.length
  ))
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(temp, file)
}

function legacyState() {
  const state = readJson(STATE_FILE, seedState())
  if (!state.connections) state.connections = readJson(CONNECTIONS_FILE, {})
  return normalizeState(state)
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function jobFromRow(row) {
  return {
    ...(row.payload || {}),
    id: row.id,
    kind: row.kind,
    sourceId: row.sourceId,
    clipId: row.clipId,
    workflowRunId: row.workflowRunId,
    status: row.status,
    progress: row.progress,
    step: row.step,
    error: row.error,
    log: row.log || [],
    startedAt: row.startedAt?.toISOString?.() || null,
    finishedAt: row.finishedAt?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toISOString?.() || null,
  }
}

function jobToRow(job) {
  const { id, kind, sourceId, clipId, workflowRunId, status, progress, step, error, log, startedAt, finishedAt, updatedAt, ...payload } = job
  return {
    id,
    kind,
    sourceId: sourceId || null,
    clipId: clipId || null,
    workflowRunId: workflowRunId || null,
    status,
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    step: step || null,
    error: error || null,
    log: Array.isArray(log) ? log : [],
    payload,
    startedAt: toDate(startedAt) || new Date(),
    finishedAt: toDate(finishedAt),
    updatedAt: new Date(),
  }
}

function localContext() {
  return {
    state: legacyState(),
    baseState: legacyState(),
    revision: 0,
    stateDirty: false,
    jobs: readJson(JOBS_FILE, []).slice(-40),
    dirtyJobIds: new Set(),
    clearJobs: false,
    local: true,
    pendingStateWrites: Promise.resolve(),
    pendingJobWrites: Promise.resolve(),
  }
}

async function loadContext() {
  // Sem banco configurado (dev local) o JSON é a fonte de verdade. Quando há
  // DATABASE_URL, uma falha transitória NÃO pode virar estado local vazio:
  // isso sobrescreveria o acervo salvo no Postgres depois de um restart.
  if (databaseUnavailable) return localContext()

  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Só insere se o registro não existir. Fazer INSERT em toda request
      // multiplica timeouts quando o banco está indisponível.
      let row = (await db.select().from(fugaState).where(eq(fugaState.id, 'primary')).limit(1))[0]
      if (!row) {
        const inserted = await db.insert(fugaState)
          .values({ id: 'primary', revision: 1, data: legacyState() })
          .onConflictDoNothing()
          .returning({ id: fugaState.id })

        if (inserted.length) {
          const legacyJobs = readJson(JOBS_FILE, [])
          if (Array.isArray(legacyJobs) && legacyJobs.length) {
            for (const job of legacyJobs.slice(-40)) {
              if (job?.id && job.kind && job.status) {
                await db.insert(fugaJobs).values(jobToRow(job)).onConflictDoNothing()
              }
            }
          }
        }
        row = (await db.select().from(fugaState).where(eq(fugaState.id, 'primary')).limit(1))[0]
      }
      if (!row) throw new Error('O registro de estado do Kakashi Hub não pôde ser inicializado.')
      const rows = await db.select().from(fugaJobs).orderBy(desc(fugaJobs.startedAt)).limit(40)
      let rawState = clone(row.data)

      // Recuperação: se o banco foi semeado vazio enquanto o acervo real vivia
      // no JSON local (modo antigo), importamos esse JSON uma única vez.
      if (!stateHasContent(normalizeState(clone(rawState)))) {
        const local = legacyState()
        if (stateHasContent(local)) {
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(742195910822::bigint)`)
              const [current] = await tx.select().from(fugaState).where(eq(fugaState.id, 'primary')).limit(1)
              if (!current || stateHasContent(normalizeState(clone(current.data)))) return
              await tx.update(fugaState).set({
                data: local,
                revision: current.revision + 1,
                updatedAt: new Date(),
              }).where(eq(fugaState.id, 'primary'))
              rawState = clone(local)
              row.revision = current.revision + 1
            })
          } catch (error) {
            console.warn('[store] não foi possível importar estado local:', error?.message || error)
          }
        }
      }

      const state = normalizeState(clone(rawState))
      const baseState = clone(state)
      return {
        state,
        // A normalização não é alteração do usuário. Se o banco estiver com um
        // estado antigo sem alguns campos, um GET não deve agendar uma escrita
        // (e muito menos transformar falha de escrita em 503 no /api/state).
        baseState,
        revision: row.revision,
        stateDirty: false,
        jobs: rows.reverse().map(jobFromRow),
        dirtyJobIds: new Set(),
        clearJobs: false,
        pendingStateWrites: Promise.resolve(),
        pendingJobWrites: Promise.resolve(),
      }
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
  console.error('[store] PostgreSQL indisponível:', lastError?.message || lastError)
  throw new Error('Banco de dados indisponível. Tente novamente em instantes.')
}

async function persistState(context) {
  if (!context.stateDirty) return
  if (context.local) {
    writeJson(STATE_FILE, normalizeState(clone(context.state)))
    context.baseState = clone(context.state)
    context.stateDirty = false
    return
  }
  const baseState = clone(context.baseState)
  const snapshot = clone(context.state)

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(742195910822::bigint)`)
    const [current] = await tx.select().from(fugaState).where(eq(fugaState.id, 'primary')).limit(1)
    if (!current) throw new Error('O registro de estado do Kakashi Hub desapareceu.')
    const updatedAt = new Date().toISOString()
    const mergedState = mergeChanges(baseState, snapshot, current.data)
    mergedState.updatedAt = updatedAt
    await tx.update(fugaState)
      .set({ data: mergedState, revision: current.revision + 1, updatedAt: new Date(updatedAt) })
      .where(eq(fugaState.id, 'primary'))

    context.baseState = clone(mergedState)
    context.revision = current.revision + 1
    // Não trocar a identidade de context.state: ingest/compilação/live guardam
    // referências a state/source/comp durante execuções longas. Se trocarmos o
    // objeto aqui, essas referências continuam apontando para o estado antigo e
    // as alterações finais (clips, status, progresso) nunca chegam ao banco.
    const unchanged = isDeepStrictEqual(context.state, snapshot)
    const nextState = unchanged ? mergedState : mergeChanges(snapshot, context.state, mergedState)
    assignInPlace(context.state, nextState)
    context.stateDirty = !unchanged
  })
}

async function persistJobRow(job) {
  const context = contextStorage.getStore()
  if (context?.local) {
    writeJson(JOBS_FILE, context.jobs.slice(-40))
    return
  }
  const values = jobToRow(job)
  await db.insert(fugaJobs).values(values).onConflictDoUpdate({
    target: fugaJobs.id,
    set: {
      kind: values.kind,
      sourceId: values.sourceId,
      clipId: values.clipId,
      workflowRunId: values.workflowRunId,
      status: values.status,
      progress: values.progress,
      step: values.step,
      error: values.error,
      log: values.log,
      payload: values.payload,
      startedAt: values.startedAt,
      finishedAt: values.finishedAt,
      updatedAt: values.updatedAt,
    },
  })
}

function queueStateWrite(context) {
  context.pendingStateWrites = context.pendingStateWrites
    .then(() => persistState(context))
    .catch((error) => {
      context.writeError = context.writeError || error
      console.error('[store] falha ao persistir estado:', error?.message || error)
    })
}

function queueJobWrite(context, job) {
  context.dirtyJobIds.add(job.id)
  const snapshot = clone(job)
  context.pendingJobWrites = context.pendingJobWrites.then(async () => {
    await persistJobRow(snapshot)
    context.dirtyJobIds.delete(job.id)
  }).catch((error) => {
    context.writeError = context.writeError || error
    console.error('[store] falha ao persistir job:', error?.message || error)
  })
}

async function persistContext(context) {
  await context.pendingStateWrites
  await context.pendingJobWrites
  if (context.writeError) {
    const error = context.writeError
    context.writeError = null
    throw error
  }
  if (context.clearJobs) {
    if (context.local) {
      writeJson(JOBS_FILE, [])
      context.clearJobs = false
      context.dirtyJobIds.clear()
    } else {
      await db.delete(fugaJobs)
      context.clearJobs = false
      context.dirtyJobIds.clear()
    }
  }
  if (context.stateDirty) await persistState(context)
  for (const id of context.dirtyJobIds) {
    const job = context.jobs.find((item) => item.id === id)
    if (job) await persistJobRow(job)
  }
  context.dirtyJobIds.clear()
}

function stateScope() {
  return contextStorage.getStore() || { state: seedState(), jobs: [], dirtyJobIds: new Set(), stateDirty: false }
}

export function storeMiddleware(req, res, next) {
  loadContext().then((context) => {
    let ending = false
    const originalEnd = res.end
    res.end = function (...args) {
      if (ending) return this
      ending = true
      persistContext(context).then(
        () => originalEnd.apply(this, args),
        (error) => {
          console.error('[store] falha ao persistir estado:', error?.message || error)
          if (!res.headersSent) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            return originalEnd.call(this, JSON.stringify({ error: 'Não foi possível salvar os dados agora.' }))
          }
          return originalEnd.apply(this, args)
        },
      )
      return this
    }
    contextStorage.run(context, () => next())
  }).catch(next)
}

export async function withStore(callback) {
  const context = await loadContext()
  return contextStorage.run(context, async () => {
    try {
      return await callback()
    } finally {
      await persistContext(context)
    }
  })
}

export async function flushStore() {
  const context = contextStorage.getStore()
  if (context) await persistContext(context)
}

export async function claimUploadForPublishing(uploadId) {
  if (databaseUnavailable) {
    return withStore(() => {
      const state = getState()
      const upload = state.uploads.find((item) => item.id === uploadId)
      if (!upload || upload.status !== 'agendado') return null
      if (!Number.isFinite(Date.parse(upload.scheduledAt)) || Date.parse(upload.scheduledAt) > Date.now()) return null
      upload.status = 'enviando'
      upload.error = null
      upload.publishingStartedAt = new Date().toISOString()
      save()
      return clone(upload)
    })
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(742195910822::bigint)`)
    const [row] = await tx.select().from(fugaState).where(eq(fugaState.id, 'primary')).limit(1)
    if (!row) return null
    const state = normalizeState(clone(row.data))
    const upload = state.uploads.find((item) => item.id === uploadId)
    if (!upload || upload.status !== 'agendado') return null
    if (!Number.isFinite(Date.parse(upload.scheduledAt)) || Date.parse(upload.scheduledAt) > Date.now()) return null
    upload.status = 'enviando'
    upload.error = null
    upload.publishingStartedAt = new Date().toISOString()
    const updatedAt = new Date().toISOString()
    state.updatedAt = updatedAt
    await tx.update(fugaState)
      .set({ data: state, revision: row.revision + 1, updatedAt: new Date(updatedAt) })
      .where(eq(fugaState.id, 'primary'))
    return clone(upload)
  })
}

export function getState() {
  return stateScope().state
}

export function save() {
  const context = contextStorage.getStore()
  const state = getState()
  state.updatedAt = new Date().toISOString()
  if (context) {
    context.stateDirty = true
    queueStateWrite(context)
  }
}

export function getJobs() {
  return stateScope().jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    sourceId: job.sourceId,
    clipId: job.clipId,
    compilationId: job.compilationId,
    retryPending: job.retryPending,
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
    // Diagnóstico interno: não é exibido no front, mas fica disponível em /api/state.
    debug: job.debug,
    log: (job.log || []).slice(-14),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }))
}

export function saveJobs() {
  const context = contextStorage.getStore()
  if (!context) return
  for (const job of context.jobs) queueJobWrite(context, job)
}

export function getJob(id) {
  return stateScope().jobs.find((job) => job.id === id) || null
}

export function createJob(kind, extra = {}) {
  const context = contextStorage.getStore()
  if (!context) throw new Error('createJob requer um contexto de persistência.')
  const existing = extra.id ? context.jobs.find((job) => job.id === extra.id) : null
  if (existing) {
    Object.assign(existing, { kind, status: 'running', progress: 0, step: 'iniciando', finishedAt: null, ...extra })
    queueJobWrite(context, existing)
    return existing
  }
  const job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    status: 'running',
    progress: 0,
    step: 'iniciando',
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...extra,
  }
  context.jobs.push(job)
  queueJobWrite(context, job)
  return job
}

export function updateJob(job, patch) {
  Object.assign(job, patch)
  if (patch.step) job.log = [...(job.log || []), { at: new Date().toISOString(), text: patch.step }]
  // A página de vídeos mostra source.progress, não o progresso do job. Sem
  // espelhar aqui, a transcrição longa parecia travada em 68% no painel.
  if (Number.isFinite(Number(patch.progress)) && job.kind === 'ingest' && job.sourceId) {
    const source = stateScope().state.sources?.find((item) => item.id === job.sourceId)
    if (source && source.status === 'processando') {
      source.progress = Math.max(Number(source.progress) || 0, Number(patch.progress))
    }
  }
  const context = contextStorage.getStore()
  if (context) {
    queueJobWrite(context, job)
    if (patch.progress != null) save()
  }
}

export function finishJob(job, error) {
  job.status = error ? 'erro' : 'concluido'
  job.retryPending = false
  job.error = error ? String(error.message || error) : null
  job.progress = error ? job.progress : 100
  job.finishedAt = new Date().toISOString()
  const context = contextStorage.getStore()
  if (context) queueJobWrite(context, job)
}

// Um deploy/restart mata os processos em andamento. Sem isso, jobs ficam
// "running" para sempre e o front continua atualizando em alta frequência.
export function closeOrphanWork() {
  const now = new Date().toISOString()
  const context = contextStorage.getStore()
  const allJobs = stateScope().jobs
  const retryableKinds = new Set(['render', 'compile'])
  for (const job of allJobs) {
    if (job.status === 'running') {
      // Se outro job para o mesmo alvo já concluiu depois deste começar, este
      // ficou órfão na fila (nenhum log) e não deve ser reexecutado no boot.
      const superseded = allJobs.some((other) => other.id !== job.id
        && other.status === 'concluido'
        && ((job.clipId && other.clipId === job.clipId)
          || (job.compilationId && other.compilationId === job.compilationId))
        && Date.parse(other.finishedAt || 0) > Date.parse(job.startedAt || 0))
      if (retryableKinds.has(job.kind) && !superseded) {
        // Trabalho local (sem download externo): pode ser refeito no boot.
        Object.assign(job, {
          status: 'pendente',
          error: null,
          finishedAt: null,
          retryPending: true,
        })
      } else {
        Object.assign(job, {
          status: 'erro',
          error: superseded
            ? 'Trabalho substituído por uma execução mais recente.'
            : 'Não foi possível concluir. Tente novamente.',
          finishedAt: now,
          retryPending: false,
        })
      }
      if (context) queueJobWrite(context, job)
    }
  }
  const mediaFileExists = (rel) => {
    if (!rel) return false
    const file = path.join(DATA, String(rel).replace(/^\/+/, ''))
    try { return fs.existsSync(file) && fs.statSync(file).size > 1024 } catch { return false }
  }
  const state = getState()
  for (const source of state.sources) {
    // Um deploy/restart não deve encerrar uma transmissão que ainda está no ar.
    // Guardamos a intenção de retomar e o start.mjs reinicia o workflow depois.
    if (source.mode === 'live' && ['ao-vivo', 'processando'].includes(source.status)) {
      source.status = 'processando'
      source.progress = Math.max(2, Number(source.progress) || 2)
      source.error = null
      source.liveStopRequested = false
      source.liveResumePending = true
      delete source.liveEndedAt
      delete source.liveJobId
    } else if (source.status === 'processando') {
      source.status = 'erro'
      source.error = 'Não foi possível concluir. Tente novamente.'
      if (source.mode === 'live') source.liveStopRequested = true
      if (source.uploading) source.uploading = false
    }
    if (source.hasMedia && !source.mediaKey
      && !mediaFileExists(`media/src/${source.id}.mp4`)
      && !mediaFileExists(`media/live/${source.id}.mp4`)) {
      source.hasMedia = false
    }
  }
  for (const clip of state.clips) {
    if (clip.renderedUrl && !clip.mediaKey && !mediaFileExists(clip.renderedUrl)) clip.renderedUrl = undefined
    if (clip.media && !clip.mediaKey && !mediaFileExists(clip.media)) clip.media = undefined
  }
  const pendingCompIds = new Set(
    stateScope().jobs
      .filter((job) => job.status === 'pendente' && job.retryPending && job.compilationId)
      .map((job) => job.compilationId),
  )
  for (const comp of state.compilations || []) {
    if (comp.status === 'processando') {
      if (pendingCompIds.has(comp.id)) {
        Object.assign(comp, { status: 'pendente', error: null })
      } else {
        Object.assign(comp, {
          status: 'erro',
          error: 'Não foi possível concluir. Monte o vídeo novamente.',
          progress: 0,
        })
      }
    }
    if (comp.url && !comp.mediaKey && !mediaFileExists(comp.url)) {
      comp.url = ''
      if (comp.status === 'pronto') {
        comp.status = 'erro'
        comp.error = 'O vídeo não está mais disponível. Monte novamente.'
      }
    }
  }
  save()
}

//Jobs em fila sem nenhum passo executado podem ficar "running" para sempre se
//o processo cair antes do setImmediate do background. Limpamos quando outro
//job do mesmo alvo conclui (ou depois de 15 minutos sem log).
export function sweepStaleJobs() {
  const now = Date.now()
  const allJobs = stateScope().jobs
  const context = contextStorage.getStore()
  let changed = false
  for (const job of allJobs) {
    if (job.status !== 'running' || (job.log || []).length) continue
    const started = Date.parse(job.startedAt || '')
    const aged = Number.isFinite(started) && now - started > 15 * 60 * 1000
    const superseded = allJobs.some((other) => other.id !== job.id
      && other.status === 'concluido'
      && ((job.clipId && other.clipId === job.clipId)
        || (job.compilationId && other.compilationId === job.compilationId))
      && Date.parse(other.finishedAt || 0) > (Number.isFinite(started) ? started : 0))
    if (!aged && !superseded) continue
    Object.assign(job, {
      status: 'erro',
      error: superseded
        ? 'Trabalho substituído por uma execução mais recente.'
        : 'Não foi possível concluir. Tente novamente.',
      finishedAt: new Date().toISOString(),
      retryPending: false,
    })
    if (context) queueJobWrite(context, job)
    changed = true
  }
  if (changed) save()
  return changed
}

export function addActivity(kind, text) {
  const state = getState()
  state.activity.unshift({ id: `act-${Date.now()}`, at: new Date().toISOString(), kind, text })
  state.activity = state.activity.slice(0, 30)
}

export function findSource(id) {
  return getState().sources.find((source) => source.id === id)
}

export function findClip(id) {
  return getState().clips.find((clip) => clip.id === id)
}

export function sourceVideo(sourceId) {
  const file = path.join(SRC_MEDIA, `${sourceId}.mp4`)
  return fs.existsSync(file) ? file : null
}

export function resetData() {
  const context = contextStorage.getStore()
  if (!context) throw new Error('resetData requer um contexto de persistência.')
  context.state = normalizeState(seedState())
  context.state.compilations = []
  context.stateDirty = true
  context.jobs = []
  context.clearJobs = true
  context.dirtyJobIds.clear()
}
