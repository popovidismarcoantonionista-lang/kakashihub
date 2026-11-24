import express from 'express'
import { sql } from 'drizzle-orm'
import { handleUpload } from '@vercel/blob/client'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import crypto from 'node:crypto'
import {
  COVERS,
  EXPORTS,
  MEDIA,
  SRC_MEDIA,
  addActivity,
  findClip,
  findSource,
  getJobs,
  getState,
  save,
  storeMiddleware,
} from './store.mjs'
import { blobStorageEnabled, deleteBlobMedia, getPrivateBlob, storeLocalFile } from './media-store.mjs'
import {
  OUTPUT_SIZES, clipFrame, detectCamBoxForClip, detectCamBoxForLive, fetchChannelVideos,
  getLiveHlsUrl, isLiveRunning, liveCapabilities, liveCaptureConfig, liveErrorText, liveFrame,
  liveMediaFile, queueBrowserLiveWindow, stopLive, uniqueClips,
} from './pipeline.mjs'
import { startLiveWorkflow, startProcessJob, startUploadWorkflow } from './jobs.mjs'
import {
  PLATFORMS, disconnect, isConnected, platformLabel, publicConnections,
} from './connections.mjs'
import {
  oauthFinish, oauthStart, saveAppCredentials,
} from './social.mjs'
import { getRadar } from './radar.mjs'
import { db } from './db.mjs'

const app = express()
app.use(express.json({ limit: '6mb' }))

function verifyNetlifySigned(sig, secret) {
  try {
    const parts = String(sig || '').split('.')
    if (parts.length !== 3) return false
    const [h, p, s] = parts
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
    if (header?.alg !== 'HS256') return false
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
    const a = Buffer.from(s)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    if (payload?.iss !== 'netlify') return false
    if (payload?.exp && Date.now() / 1000 > Number(payload.exp) + 30) return false
    return true
  } catch {
    return false
  }
}

app.use((req, res, next) => {
  const secret = String(process.env.PROXY_SECRET || '').trim()
  if (!secret) return next()
  if (req.path === '/api/health') return next()
  const plain = String(req.get('x-fuga-proxy-secret') || '').trim()
  if (plain && plain === secret) return next()
  const signed = String(req.get('x-nf-sign') || '').trim()
  if (signed && verifyNetlifySigned(signed, secret)) return next()
  return res.status(403).json({ error: 'Acesso direto bloqueado.' })
})

app.use('/api', (req, res, next) => {
  // Health precisa responder mesmo se o Postgres estiver indisponível.
  if (req.path === '/health') return next()
  return storeMiddleware(req, res, next)
})

const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024
const UPLOAD_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])

function uploadTitle(raw) {
  const clean = path.basename(String(raw || 'video.mp4'))
    .replace(/[^\w.\- ()[\]À-ÿ]+/g, '_')
    .replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, '')
    .trim()
    .slice(0, 120)
  return clean || 'Vídeo enviado'
}

app.use('/covers', express.static(COVERS, { maxAge: 0 }))
app.use('/media', express.static(MEDIA, { maxAge: 0 }))

function ok(res, data = {}) { res.json(data) }
function fail(res, status, message, extra) { res.status(status).json({ error: message, ...(extra || {}) }) }

async function servePrivateMedia(req, res, next, prefix) {
  try {
    const pathname = `${prefix}/${String(req.params[0] || '')}`
    const result = await getPrivateBlob(pathname, req.headers)
    if (!result) return next()
    if (result.statusCode === 304) {
      res.set('ETag', result.blob.etag).set('Cache-Control', 'private, no-cache')
      return res.status(304).end()
    }
    const contentRange = result.headers.get('content-range')
    res.status(contentRange ? 206 : 200)
      .set('Content-Type', result.blob.contentType)
      .set('ETag', result.blob.etag)
      .set('Accept-Ranges', 'bytes')
      .set('Cache-Control', 'private, no-cache')
    if (contentRange) res.set('Content-Range', contentRange)
    const contentLength = result.headers.get('content-length')
    if (contentLength) res.set('Content-Length', contentLength)
    else if (!contentRange) res.set('Content-Length', String(result.blob.size))
    Readable.fromWeb(result.stream).on('error', next).pipe(res)
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).end()
    console.error('[blob:read]', String(error?.message || error).slice(0, 300))
    fail(res, 502, 'Não foi possível carregar este arquivo agora.')
  }
}

app.get('/media/*', (req, res, next) => servePrivateMedia(req, res, next, 'media'))
app.get('/covers/*', (req, res, next) => servePrivateMedia(req, res, next, 'covers'))

app.get('/api/health', async (req, res) => {
  let downloader = 'off'
  if (process.env.DOWNLOAD_API_URL) {
    try {
      const r = await fetch(`${String(process.env.DOWNLOAD_API_URL).replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(2500) })
      downloader = r.ok ? 'ok' : `http-${r.status}`
    } catch {
      downloader = 'sem-resposta'
    }
  }
  let dbProbe = 'sem-config'
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    try {
      await db.execute(sql`select 1`)
      dbProbe = 'ok'
    } catch (error) {
      dbProbe = `erro:${error?.code || 'conexao'}`
    }
  }
  ok(res, {
    ok: true,
    commit: process.env.RENDER_GIT_COMMIT || null,
    downloader,
    storage: {
      blob: blobStorageEnabled(),
      database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      dbProbe,
    },
    live: liveCapabilities(),
  })
})

app.get('/api/radar', async (req, res) => {
  try {
    ok(res, await getRadar())
  } catch (err) {
    console.error('[radar]', err?.message || err)
    ok(res, { ok: false, items: [], liveCount: 0 })
  }
})

app.get('/api/state', (req, res) => {
  const state = getState()
  const sources = state.sources.map((s) => ({
    ...s,
    hasMedia: s.mode === 'live'
      ? (state.clips || []).some((c) => c.sourceId === s.id && Boolean(c.mediaKey || c.media || liveMediaFile(c)))
      : Boolean(s.mediaKey) || fs.existsSync(path.join(SRC_MEDIA, `${s.id}.mp4`)),
  }))
  ok(res, { ...state, sources, jobs: getJobs() })
})

const NICHE_LABELS = {
  fuga: 'Fuga · Enquadro · Perseguição',
  games: 'Games',
  gta: 'GTA 6 · Streamer + jogo',
  geral: 'Geral · Melhores momentos',
}

app.post('/api/settings', (req, res) => {
  const state = getState()
  const body = req.body || {}
  if (body.niche !== undefined && !NICHE_LABELS[body.niche]) delete body.niche
  if (body.resolution !== undefined && !OUTPUT_SIZES[body.resolution]) delete body.resolution
  state.settings = {
    ...state.settings,
    ...body,
    agents: { ...state.settings.agents, ...(body.agents || {}) },
  }
  state.project.niche = NICHE_LABELS[state.settings.niche] || state.project.niche
  save()
  ok(res, { settings: state.settings, project: state.project })
})

function parseLogoDataUrl(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^data:(image\/png|image\/webp|image\/gif);base64,(.+)$/i)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > 2 * 1024 * 1024) return null
  const ext = mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.png'
  return { buf, mime, ext }
}

app.post('/api/project/logo', async (req, res) => {
  try {
    const parsed = parseLogoDataUrl(req.body?.dataUrl || req.body?.image || req.body?.data)
    if (!parsed) return fail(res, 400, 'Envie uma logo PNG transparente (até 2 MB).')
    const state = getState()
    const prev = state.project?.logo
    const prevPath = prev?.url ? String(prev.url).replace(/^\/covers\//, 'covers/') : null
    const fileName = `channel-logo-${Date.now()}${parsed.ext}`
    const abs = path.join(COVERS, fileName)
    fs.writeFileSync(abs, parsed.buf)
    let url = `/covers/${fileName}`
    try {
      const key = await storeLocalFile(abs, `covers/${fileName}`, parsed.mime)
      if (key) url = `/covers/${fileName}`
    } catch (err) {
      console.warn('[logo:blob]', err?.message || err)
    }
    if (prevPath && prevPath !== `covers/${fileName}`) {
      try {
        const prevAbs = path.join(COVERS, path.basename(prevPath))
        if (fs.existsSync(prevAbs)) fs.unlinkSync(prevAbs)
      } catch {}
      try { await deleteBlobMedia([prevPath]) } catch {}
    }
    state.project.logo = {
      url,
      x: Math.max(0, Math.min(1, Number(prev?.x) || 0.5)),
      y: Math.max(0, Math.min(1, Number(prev?.y) || 0.88)),
      w: Math.max(0.05, Math.min(0.8, Number(prev?.w) || 0.28)),
      opacity: Math.max(0.1, Math.min(1, Number(prev?.opacity) || 1)),
    }
    save()
    ok(res, { project: state.project })
  } catch (err) {
    console.error('[logo]', err?.message || err)
    fail(res, 500, 'Não foi possível salvar a logo.')
  }
})

app.post('/api/project', (req, res) => {
  const state = getState()
  const body = req.body || {}
  for (const key of ['name', 'channel']) {
    if (typeof body[key] === 'string') state.project[key] = body[key].trim().slice(0, 48)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'logo')) {
    const logo = body.logo
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
  }
  save()
  ok(res, { project: state.project })
})

app.post('/api/channels', async (req, res) => {
  const url = String(req.body?.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return fail(res, 400, 'Cole o link do canal.')
  try {
    const data = await fetchChannelVideos(url)
    if (!data.videos.length) return fail(res, 404, 'Este canal não tem vídeos públicos no momento.')
    ok(res, data)
  } catch (err) {
    console.error('[channels]', err?.message || err)
    fail(res, 422, 'Não encontrei vídeos neste canal. Confira o link e tente de novo.')
  }
})

app.post('/api/sources', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [req.body?.url]
  const list = urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim())).map((url) => url.trim())
  if (!list.length) return fail(res, 400, 'Cole um link válido para analisar.')
  const state = getState()
  const created = []
  for (const url of list.slice(0, 5)) {
    const id = `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
    const source = {
      id,
      title: 'Lendo fonte…',
      channel: '',
      duration: 0,
      thumb: '',
      status: 'processando',
      progress: 2,
      clips: 0,
      addedAt: new Date().toISOString(),
      url,
    }
    state.sources.unshift(source)
    created.push(source)
  }
  addActivity('agent', `${created.length} fonte(s) enviadas para análise`)
  save()
  for (const source of created) {
    try {
      const { runId } = await startProcessJob('ingest', { sourceId: source.id, url: source.url }, { sourceId: source.id })
      source.workflowRunId = runId
      save()
    } catch (error) {
      source.status = 'erro'
      source.error = 'Não foi possível iniciar a ingestão durável.'
      save()
      console.error('[ingest:start]', String(error?.message || error).slice(0, 300))
    }
  }
  res.status(202).json({ sources: created })
})

app.post('/api/sources/upload', (req, res) => {
  const name = path.basename(String(req.body?.name || '')).slice(0, 160)
  const type = String(req.body?.type || '').trim().toLowerCase()
  const size = Number(req.body?.size)
  const extension = path.extname(name).toLowerCase()
  if (!name || !Number.isFinite(size) || size < 1024) return fail(res, 400, 'Escolha um arquivo de vídeo válido.')
  if (size > UPLOAD_MAX_BYTES) return fail(res, 413, 'O arquivo passa de 2 GB. Envie um vídeo menor.')
  if (extension && !UPLOAD_EXTS.has(extension)) return fail(res, 400, 'Use um arquivo de vídeo (MP4, MOV, WebM, MKV ou AVI).')
  if (type && !/^video\//i.test(type) && !/octet-stream/i.test(type)) {
    return fail(res, 400, 'Use um arquivo de vídeo (MP4, MOV, WebM, MKV ou AVI).')
  }

  const id = `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const title = uploadTitle(name)
  const source = {
    id,
    title,
    channel: 'Upload local',
    duration: 0,
    thumb: '',
    status: 'processando',
    progress: 2,
    clips: 0,
    addedAt: new Date().toISOString(),
    mode: 'vod',
    uploaded: false,
    uploading: true,
    url: '',
    upload: { name, size, type },
  }
  getState().sources.unshift(source)
  addActivity('agent', `Vídeo enviado para análise · ${title}`)
  save()
  ok(res, { source })
})

app.post('/api/sources/upload-token', async (req, res) => {
  try {
    const result = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload
        try { payload = JSON.parse(clientPayload || '{}') } catch { throw new Error('Dados de upload inválidos.') }
        const source = findSource(String(payload.sourceId || ''))
        if (!source?.uploading) throw new Error('Este upload não está mais ativo.')
        if (pathname !== `media/src/${source.id}.mp4`) throw new Error('Caminho de upload inválido.')
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-matroska', 'video/x-msvideo', 'video/avi', 'application/octet-stream'],
          maximumSizeInBytes: UPLOAD_MAX_BYTES,
          validUntil: Date.now() + 30 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ sourceId: source.id }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload
        try { payload = JSON.parse(tokenPayload || '{}') } catch { throw new Error('Dados de conclusão inválidos.') }
        const source = findSource(String(payload.sourceId || ''))
        if (!source?.uploading || blob.pathname !== `media/src/${source.id}.mp4`) {
          throw new Error('O arquivo enviado não corresponde à fonte ativa.')
        }
        source.mediaKey = blob.pathname
        source.uploaded = true
        source.uploading = false
        source.hasMedia = true
        source.status = 'processando'
        source.progress = 4
        save()
        const { runId } = await startProcessJob('ingest', {
          sourceId: source.id,
          url: '',
          options: { metaHint: { title: source.title, uploader: 'Upload local', description: '' } },
        }, { sourceId: source.id })
        source.workflowRunId = runId
        save()
      },
    })
    ok(res, result)
  } catch (error) {
    console.error('[blob:upload]', String(error?.message || error).slice(0, 300))
    fail(res, 400, error?.message || 'Não foi possível concluir o upload.')
  }
})

app.post('/api/sources/:id/analyze', async (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (!source.url && !source.uploaded) return fail(res, 400, 'Conecte um link ou envie um vídeo para analisar esta fonte.')
  if (getJobs().some((j) => j.status === 'running' && j.sourceId === source.id)) {
    return fail(res, 409, 'Esta fonte já está sendo analisada.')
  }
  source.status = 'processando'
  source.progress = 2
  source.error = null
  save()
  const { runId } = await startProcessJob('analyze', { sourceId: source.id }, { sourceId: source.id })
  source.workflowRunId = runId
  save()
  ok(res, { ok: true })
})

app.patch('/api/sources/:id', (req, res) => {
  const state = getState()
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  const body = req.body || {}
  const clamp = (v, lo, hi, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  if (body.cam) {
    const w = clamp(body.cam.w, 0.08, 1, 0.3)
    const h = clamp(body.cam.h, 0.08, 1, 0.42)
    source.cam = {
      w: +w.toFixed(4),
      h: +h.toFixed(4),
      x: +clamp(body.cam.x, 0, 1 - w, 0.02).toFixed(4),
      y: +clamp(body.cam.y, 0, 1 - h, 0.5).toFixed(4),
    }
  }
  if (body.applyCam && source.cam) {
    for (const clip of state.clips.filter((c) => c.sourceId === source.id)) {
      clip.framing = 'cam'
      clip.cam = { ...source.cam }
    }
  }
  save()
  ok(res, { source })
})

function livePlatform(raw) {
  if (/^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(raw)) return 'twitch'
  if (/^https?:\/\/([^/]*\.)?kick\.com\//i.test(raw)) return 'kick'
  return null
}

app.post('/api/live', async (req, res) => {
  const raw = String(req.body?.url || '').trim()
  if (!/^https?:\/\//i.test(raw)) return fail(res, 400, 'Cole o link da transmissão…')
  const platform = livePlatform(raw)
  if (!platform) return fail(res, 400, 'Use o link de uma live da Twitch ou da Kick.')
  const state = getState()
  const already = state.sources.find((s) => s.mode === 'live' && s.url === raw && isLiveRunning(s.id))
  if (already) return fail(res, 409, 'Esta live já está sendo monitorada.')
  const id = `src-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const source = {
    id,
    title: 'Procurando a transmissão…',
    channel: '',
    duration: 0,
    thumb: '',
    status: 'processando',
    progress: 2,
    clips: 0,
    addedAt: new Date().toISOString(),
    url: raw,
    mode: 'live',
    platform,
    captureMode: 'server',
  }
  state.sources.unshift(source)
  addActivity('agent', 'Nova transmissão enviada para monitoramento')
  save()
  source.liveWorkflowId = await startLiveWorkflow(id)
  save()
  ok(res, { source })
})

app.post('/api/live/:id/stop', (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  // Idempotente: se já parou, responde ok para o mobile não ficar sem feedback.
  if (!isLiveRunning(source.id)) return ok(res, { ok: true, alreadyStopped: true })
  stopLive(source.id)
  ok(res, { ok: true })
})

app.post('/api/live/:id/capture-error', (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (source.mode !== 'live') return fail(res, 400, 'Esta fonte não é uma transmissão ao vivo.')
  const message = String(req.body?.error || '').trim().slice(0, 300)
  if (message) {
    source.liveLastError = message
    source.liveCheckedAt = new Date().toISOString()
    save()
  }
  ok(res, { ok: true })
})

app.post('/api/live/:id/start', async (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (source.mode !== 'live' || !source.url) return fail(res, 400, 'Esta fonte não é uma transmissão ao vivo.')
  if (isLiveRunning(source.id)) return fail(res, 409, 'Esta transmissão já está sendo monitorada.')
  source.status = 'processando'
  source.progress = 2
  source.error = null
  delete source.liveEndedAt
  source.liveStopRequested = false
  save()
  source.liveWorkflowId = await startLiveWorkflow(source.id)
  save()
  ok(res, { ok: true })
})

app.get('/api/live/capture-config', (req, res) => {
  ok(res, liveCaptureConfig())
})

// Relay dos HLS dos espelhos: no celular alguns navegadores/redes bloqueiam o
// fetch cross-origin. O servidor busca o recurso e repassa na mesma origem.
const RELAY_TTL = 4000
const RELAY_MAX_BYTES = 24 * 1024 * 1024
const relayCache = new Map()

function relayHosts() {
  const hosts = new Set()
  for (const mirror of liveCaptureConfig().mirrors || []) {
    try { hosts.add(new URL(mirror).hostname) } catch {}
  }
  return hosts
}

app.get('/api/live/relay', async (req, res) => {
  const raw = String(req.query.url || '')
  let target
  try { target = new URL(raw) } catch { return fail(res, 400, 'URL inválida.') }
  if (target.protocol !== 'https:') return fail(res, 400, 'Só HTTPS é permitido.')
  const hosts = relayHosts()
  if (!hosts.has(target.hostname) && !/^(yt-comp\d+|yt)\.chocolatemoo53\.com$/i.test(target.hostname)) {
    return fail(res, 403, 'Host não permitido.')
  }
  const cached = relayCache.get(raw)
  if (cached && Date.now() - cached.at < RELAY_TTL) {
    res.set('Content-Type', cached.type)
    res.set('Cache-Control', 'no-store')
    res.set('X-Relay-Cache', 'hit')
    return res.send(cached.buf)
  }
  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(45000),
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' },
    })
    if (!upstream.ok) {
      console.warn(`[relay] upstream ${upstream.status} ${target.hostname}${target.pathname.slice(0, 80)}`)
      return fail(res, 502, `espelho HTTP ${upstream.status}`)
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > RELAY_MAX_BYTES) return fail(res, 413, 'Recurso grande demais.')
    const type = upstream.headers.get('content-type') || 'application/octet-stream'
    relayCache.set(raw, { at: Date.now(), buf, type })
    if (relayCache.size > 40) relayCache.delete(relayCache.keys().next().value)
    res.set('Content-Type', type)
    res.set('Cache-Control', 'no-store')
    res.set('X-Relay-Cache', 'miss')
    res.send(buf)
  } catch (e) {
    const msg = e?.name === 'TimeoutError' || /timeout|aborted/i.test(String(e?.message || e))
      ? 'Espelho demorou para responder.'
      : 'Espelho indisponível.'
    console.warn(`[relay] ${target.hostname}${target.pathname.slice(0, 80)}: ${String(e?.message || e).slice(0, 160)}`)
    fail(res, 502, msg)
  }
})

// Janela de vídeo capturada no navegador: body = LWIN + versão + tamanhos (u32 BE) + vídeo.ts + áudio.ts
app.post('/api/live/:id/window', express.raw({ type: 'application/octet-stream', limit: '80mb' }), async (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (source.mode !== 'live' || !isLiveRunning(source.id)) return fail(res, 409, 'Esta transmissão não está sendo monitorada.')
  if (source.captureMode !== 'browser') return fail(res, 400, 'Esta fonte não usa captura no navegador.')
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (body.length < 13 || body.toString('ascii', 0, 4) !== 'LWIN') return fail(res, 400, 'Janela inválida.')
  const version = body[4]
  const videoLen = body.readUInt32BE(5)
  const audioLen = body.readUInt32BE(9)
  let captions = []
  let offset = 13
  if (version >= 2) {
    if (body.length < 17) return fail(res, 400, 'Janela inválida.')
    const captionsLen = body.readUInt32BE(13)
    offset = 17
    if (videoLen + audioLen + captionsLen + offset !== body.length) return fail(res, 400, 'Janela incompleta.')
    try {
      const parsed = JSON.parse(body.toString('utf8', offset + videoLen + audioLen))
      if (Array.isArray(parsed)) {
        captions = parsed.slice(0, 80).map((cue) => ({
          t: Math.max(0, Number(cue?.t) || 0),
          text: String(cue?.text || '').slice(0, 220),
        })).filter((cue) => cue.text)
      }
    } catch {}
  } else if (videoLen + audioLen + offset !== body.length) {
    return fail(res, 400, 'Janela incompleta.')
  }
  try {
    const result = await queueBrowserLiveWindow(
      source.id,
      body.subarray(offset, offset + videoLen),
      body.subarray(offset + videoLen, offset + videoLen + audioLen),
      captions,
    )
    source.liveCaptureLastAt = Date.now()
    source.liveLastError = null
    source.liveCheckedAt = new Date().toISOString()
    save()
    ok(res, { accepted: true, bytes: result.bytes })
  } catch (e) {
    console.error('[live window]', e?.message || e)
    fail(res, 500, 'Não foi possível processar a janela recebida.', { detail: liveErrorText(e, 300) })
  }
})

app.get('/api/live/:id/frame', async (req, res) => {
  try {
    const buf = await liveFrame(req.params.id)
    res.set('Cache-Control', 'no-store')
    res.type('image/jpeg').send(buf)
  } catch {
    fail(res, 404, 'Ainda não há quadro desta live. Aguarde o primeiro corte.')
  }
})

app.get('/api/live/:id/hls', async (req, res) => {
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (source.mode !== 'live' || !source.url) return fail(res, 400, 'Esta fonte não é uma transmissão ao vivo.')
  try {
    const hlsUrl = await getLiveHlsUrl(source.url)
    if (!hlsUrl) return fail(res, 404, 'Não foi possível obter o stream da transmissão.')
    ok(res, { hlsUrl })
  } catch (e) {
    console.error('[live hls]', e?.message || e)
    fail(res, 500, 'Erro ao obter stream da live.', { detail: liveErrorText(e, 400) })
  }
})

app.delete('/api/sources/:id', async (req, res) => {
  const state = getState()
  const source = findSource(req.params.id)
  if (!source) return fail(res, 404, 'Fonte não encontrada.')
  if (getJobs().some((j) => j.status === 'running' && j.sourceId === source.id)) {
    if (!isLiveRunning(source.id)) {
      return fail(res, 409, 'Esta fonte ainda está sendo analisada. Tente de novo em instantes.')
    }
    stopLive(source.id)
  }
  const clips = state.clips.filter((c) => c.sourceId === source.id)
  const clipIds = new Set(clips.map((c) => c.id))
  const dropped = (state.compilations || []).filter((c) => c.clipIds?.some((id) => clipIds.has(id)))
  state.clips = state.clips.filter((c) => c.sourceId !== source.id)
  state.uploads = state.uploads.filter((u) => !clipIds.has(u.clipId))
  state.sources = state.sources.filter((s) => s.id !== source.id)
  save()
  try {
    await deleteBlobMedia([
      source.mediaKey,
      source.thumbKey,
      ...clips.flatMap((clip) => [clip.mediaKey, clip.renderedKey, clip.coverKey]),
      ...dropped.flatMap((compilation) => [compilation.mediaKey, compilation.coverKey]),
    ])
  } catch (error) {
    console.error('[blob:delete-source]', String(error?.message || error).slice(0, 300))
  }
  for (const f of [
    path.join(SRC_MEDIA, `${source.id}.mp4`),
    path.join(COVERS, `src-${source.id}.jpg`),
  ]) { try { fs.unlinkSync(f) } catch {} }
  if (fs.existsSync(path.join(MEDIA, 'live'))) {
    for (const f of fs.readdirSync(path.join(MEDIA, 'live'))) {
      if (f.startsWith(`win-${source.id}-`) || clipIds.has(f.replace(/\.mp4$/, ''))) {
        try { fs.unlinkSync(path.join(MEDIA, 'live', f)) } catch {}
      }
    }
  }
  for (const f of fs.readdirSync(SRC_MEDIA)) {
    if (f.startsWith(`${source.id}.`) && f.endsWith('.vtt')) { try { fs.unlinkSync(path.join(SRC_MEDIA, f)) } catch {} }
  }
  for (const clip of clips) {
    for (const f of [
      path.join(COVERS, `${clip.id}.jpg`),
      path.join(COVERS, `${clip.id}-render.jpg`),
      path.join(EXPORTS, `${clip.id}.mp4`),
    ]) { try { fs.unlinkSync(f) } catch {} }
  }
  if (dropped.length) {
    const droppedIds = new Set(dropped.map((c) => c.id))
    state.uploads = state.uploads.filter((u) => !u.compilationId || !droppedIds.has(u.compilationId))
    state.compilations = state.compilations.filter((c) => !dropped.includes(c))
    save()
    for (const comp of dropped) removeCompilationFiles(comp.id)
  }
  ok(res, { ok: true })
})

function removeCompilationFiles(id) {
  for (const f of [
    path.join(EXPORTS, `${id}.mp4`),
    path.join(COVERS, `${id}.jpg`),
  ]) { try { fs.unlinkSync(f) } catch {} }
  try { fs.rmSync(path.join(EXPORTS, `comp-${id}`), { recursive: true, force: true }) } catch {}
}

app.post('/api/compilations', async (req, res) => {
  const state = getState()
  const ids = Array.isArray(req.body?.clipIds)
    ? [...new Set(req.body.clipIds.filter((v) => typeof v === 'string'))]
    : []
  const clips = uniqueClips(ids.map((id) => findClip(id)).filter(Boolean))
  if (clips.length < 2) return fail(res, 400, 'Selecione pelo menos dois cortes para montar o vídeo longo.')
  if (clips.length > 40) return fail(res, 400, 'Use até 40 cortes por vídeo longo.')
  const missing = clips.find((clip) => {
    const source = findSource(clip.sourceId)
    return !(clip.mediaKey || liveMediaFile(clip) || source?.mediaKey || fs.existsSync(path.join(SRC_MEDIA, `${clip.sourceId}.mp4`)))
  })
  if (missing) return fail(res, 400, 'Um dos cortes selecionados ainda não tem vídeo disponível.')
  const id = `comp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const title = String(req.body?.title || '').trim().slice(0, 80) ||
    `Compilado · ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`
  const duration = Math.round(clips.reduce((a, c) => a + (c.end - c.start), 0) + 7)
  const comp = {
    id,
    title,
    clipIds: clips.map((c) => c.id),
    duration,
    status: 'processando',
    progress: 1,
    url: '',
    cover: clips[0]?.cover || '',
    error: null,
    createdAt: new Date().toISOString(),
  }
  state.compilations = state.compilations || []
  state.compilations.unshift(comp)
  addActivity('agent', `Vídeo longo iniciado com ${clips.length} cortes`)
  save()
  const { runId } = await startProcessJob('compilation', { compilationId: id }, { compilationId: id })
  comp.workflowRunId = runId
  save()
  ok(res, { compilation: comp })
})

app.post('/api/compilations/:id/clips', async (req, res) => {
  const state = getState()
  const comp = (state.compilations || []).find((c) => c.id === req.params.id)
  if (!comp) return fail(res, 404, 'Vídeo longo não encontrado.')
  if (comp.status === 'processando' || getJobs().some((j) => j.compilationId === comp.id && j.status === 'running')) {
    return fail(res, 409, 'Este vídeo longo ainda está sendo montado.')
  }
  const extra = Array.isArray(req.body?.clipIds)
    ? [...new Set(req.body.clipIds.filter((v) => typeof v === 'string'))]
    : []
  const fresh = extra.filter((id) => !(comp.clipIds || []).includes(id)).map((id) => findClip(id)).filter(Boolean)
  if (!fresh.length) return fail(res, 400, 'Escolha pelo menos um corte novo para adicionar.')
  const clips = uniqueClips([...(comp.clipIds || []).map((id) => findClip(id)).filter(Boolean), ...fresh])
  if (clips.length > 40) return fail(res, 400, 'Use até 40 cortes por vídeo longo.')
  const missing = fresh.find((clip) => {
    const source = findSource(clip.sourceId)
    return !(clip.mediaKey || liveMediaFile(clip) || source?.mediaKey || fs.existsSync(path.join(SRC_MEDIA, `${clip.sourceId}.mp4`)))
  })
  if (missing) return fail(res, 400, 'Um dos cortes selecionados ainda não tem vídeo disponível.')
  comp.clipIds = clips.map((c) => c.id)
  comp.duration = Math.round(clips.reduce((a, c) => a + (c.end - c.start), 0) + 7)
  comp.status = 'processando'
  comp.progress = 1
  comp.error = null
  addActivity('agent', `${fresh.length} cortes adicionados ao vídeo longo`)
  save()
  const { runId } = await startProcessJob('compilation', { compilationId: comp.id }, { compilationId: comp.id })
  comp.workflowRunId = runId
  save()
  ok(res, { compilation: comp })
})

app.delete('/api/compilations/:id', async (req, res) => {
  const state = getState()
  const comp = (state.compilations || []).find((c) => c.id === req.params.id)
  if (!comp) return fail(res, 404, 'Vídeo longo não encontrado.')
  if (comp.status === 'processando' || getJobs().some((j) => j.compilationId === comp.id && j.status === 'running')) {
    return fail(res, 409, 'Este vídeo longo ainda está sendo montado.')
  }
  state.compilations = state.compilations.filter((c) => c.id !== comp.id)
  state.uploads = state.uploads.filter((u) => u.compilationId !== comp.id)
  save()
  try { await deleteBlobMedia([comp.mediaKey, comp.coverKey]) } catch (error) {
    console.error('[blob:delete-compilation]', String(error?.message || error).slice(0, 300))
  }
  removeCompilationFiles(comp.id)
  ok(res, { ok: true })
})

app.patch('/api/clips/:id', (req, res) => {
  const state = getState()
  const clip = findClip(req.params.id)
  if (!clip) return fail(res, 404, 'Corte não encontrado.')
  const allowed = ['hook', 'type', 'start', 'end', 'stage', 'framing', 'hashtags', 'description', 'captionLines']
  for (const key of allowed) {
    if (req.body[key] !== undefined) clip[key] = req.body[key]
  }
  if (req.body.cam) {
    const num = (v, lo, hi, d) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
    }
    const w = num(req.body.cam.w, 0.08, 1, 0.3)
    const h = num(req.body.cam.h, 0.08, 1, 0.42)
    clip.cam = {
      w: +w.toFixed(4),
      h: +h.toFixed(4),
      x: +num(req.body.cam.x, 0, 1 - w, 0.02).toFixed(4),
      y: +num(req.body.cam.y, 0, 1 - h, 0.5).toFixed(4),
    }
  }
  if (state.settings?.niche === 'games') clip.framing = 'cam'
  if (req.body.stage) {
    addActivity('agent', `Corte "${clip.hook}" marcado como ${clip.stage}`)
  }
  save()
  ok(res, { clip })
})

app.get('/api/clips/:id/frame', async (req, res) => {
  try {
    const buf = await clipFrame(req.params.id)
    res.set('Cache-Control', 'no-store')
    res.type('image/jpeg').send(buf)
  } catch {
    fail(res, 404, 'Não foi possível carregar o quadro desta fonte.')
  }
})

app.post('/api/clips/:id/detect-cam', async (req, res) => {
  try {
    const cam = await detectCamBoxForClip(req.params.id)
    if (!cam) return fail(res, 404, 'Não foi possível localizar a webcam neste corte.')
    ok(res, { cam })
  } catch (error) {
    fail(res, 500, 'Falha ao detectar a webcam.', { detail: liveErrorText(error, 200) })
  }
})

app.post('/api/live/:id/detect-cam', async (req, res) => {
  try {
    const cam = await detectCamBoxForLive(req.params.id)
    if (!cam) return fail(res, 404, 'Ainda não há quadro da live para detectar a webcam.')
    ok(res, { cam })
  } catch (error) {
    fail(res, 500, 'Falha ao detectar a webcam.', { detail: liveErrorText(error, 200) })
  }
})

app.delete('/api/clips/:id', async (req, res) => {
  const state = getState()
  const clip = findClip(req.params.id)
  if (!clip) return fail(res, 404, 'Corte não encontrado.')
  state.clips = state.clips.filter((c) => c.id !== clip.id)
  state.uploads = state.uploads.filter((u) => u.clipId !== clip.id)
  const source = findSource(clip.sourceId)
  if (source) source.clips = state.clips.filter((c) => c.sourceId === source.id).length
  save()
  try { await deleteBlobMedia([clip.mediaKey, clip.renderedKey, clip.coverKey]) } catch (error) {
    console.error('[blob:delete-clip]', String(error?.message || error).slice(0, 300))
  }
  for (const f of [
    clip.media ? path.join(MEDIA, String(clip.media).replace(/^\/media\//, '')) : null,
    path.join(COVERS, `${clip.id}.jpg`),
    path.join(COVERS, `${clip.id}-render.jpg`),
    path.join(EXPORTS, `${clip.id}.mp4`),
  ]) { if (f) try { fs.unlinkSync(f) } catch {} }
  ok(res, { ok: true })
})

app.post('/api/clips/:id/render', async (req, res) => {
  const clip = findClip(req.params.id)
  if (!clip) return fail(res, 404, 'Corte não encontrado.')
  if (getJobs().some((j) => j.status === 'running' && j.clipId === clip.id)) {
    return fail(res, 409, 'Este corte já está sendo renderizado.')
  }
  const { runId } = await startProcessJob('render', { clipId: clip.id }, { clipId: clip.id, sourceId: clip.sourceId })
  clip.workflowRunId = runId
  save()
  ok(res, { ok: true })
})

app.post('/api/clips/:id/trim', async (req, res) => {
  const clip = findClip(req.params.id)
  if (!clip) return fail(res, 404, 'Corte não encontrado.')
  if (getJobs().some((j) => j.status === 'running' && j.clipId === clip.id)) {
    return fail(res, 409, 'Este corte já está sendo processado.')
  }
  const { runId } = await startProcessJob('trim', {
    clipId: clip.id,
    start: req.body?.start,
    end: req.body?.end,
  }, { clipId: clip.id, sourceId: clip.sourceId })
  clip.workflowRunId = runId
  save()
  ok(res, { clip, queued: true })
})

function requestOrigin(req) {
  if (process.env.PUBLIC_BASE) return String(process.env.PUBLIC_BASE).replace(/\/$/, '')
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  return `${proto}://${req.headers.host}`
}

app.get('/api/connections', (req, res) => ok(res, { connections: publicConnections() }))

app.put('/api/connections/:platform', (req, res) => {
  try {
    saveAppCredentials(req.params.platform, req.body?.clientId, req.body?.clientSecret)
    ok(res, { connections: publicConnections() })
  } catch (err) {
    fail(res, 400, err?.message || 'Não foi possível salvar o acesso.')
  }
})

app.delete('/api/connections/:platform', (req, res) => {
  if (!PLATFORMS.includes(req.params.platform)) return fail(res, 404, 'Plataforma não encontrada.')
  disconnect(req.params.platform)
  ok(res, { connections: publicConnections() })
})

app.get('/api/oauth/:platform/start', (req, res) => {
  if (!PLATFORMS.includes(req.params.platform)) return fail(res, 404, 'Plataforma não encontrada.')
  try {
    res.redirect(oauthStart(req.params.platform, req.query.returnTo, requestOrigin(req)))
  } catch (err) {
    fail(res, 400, err?.message || 'Configure o acesso antes de conectar.')
  }
})

app.get('/api/oauth/:platform/callback', async (req, res) => {
  const platform = req.params.platform
  if (!PLATFORMS.includes(platform)) return fail(res, 404, 'Plataforma não encontrada.')
  try {
    const result = await oauthFinish(platform, req.query, requestOrigin(req))
    const url = new URL(result.returnTo)
    url.searchParams.set('connected', platform)
    res.redirect(url.toString())
  } catch (err) {
    console.error('[oauth]', platform, err?.message || err)
    const fallback = new URL(requestOrigin(req) + '/#/uploads')
    fallback.searchParams.set('connect_error', platform)
    res.redirect(fallback.toString())
  }
})


app.post('/api/uploads', async (req, res) => {
  const state = getState()
  const body = req.body || {}
  const platform = PLATFORMS.includes(body.platform) ? body.platform : 'tiktok'
  if (!isConnected(platform)) {
    return fail(res, 409, `Conecte o ${platformLabel(platform)} antes de agendar.`)
  }
  let clip = null
  let comp = null
  if (body.compilationId) {
    comp = (state.compilations || []).find((c) => c.id === body.compilationId)
    if (!comp) return fail(res, 400, 'Escolha um vídeo para agendar.')
    if (comp.status !== 'pronto') return fail(res, 409, 'Este vídeo ainda está sendo montado.')
  } else {
    clip = findClip(body.clipId)
    if (!clip) return fail(res, 400, 'Escolha um corte para agendar.')
  }
  const scheduledDate = new Date(body.scheduledAt || Date.now() + 3600e3)
  if (!Number.isFinite(scheduledDate.getTime())) return fail(res, 400, 'Escolha uma data válida para agendar.')
  const upload = {
    id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    clipId: clip?.id || null,
    compilationId: comp?.id || null,
    platform,
    title: String(body.title || clip?.hook || comp?.title || 'Novo vídeo').slice(0, 200),
    scheduledAt: scheduledDate.toISOString(),
    status: 'agendado',
    createdAt: new Date().toISOString(),
  }
  state.uploads.unshift(upload)
  addActivity('upload', `"${upload.title}" agendado no ${platformLabel(platform)}`)
  save()
  try {
    upload.workflowRunId = await startUploadWorkflow(upload.id)
    save()
  } catch (error) {
    upload.status = 'erro'
    upload.error = 'Não foi possível iniciar o agendamento durável.'
    save()
    console.error('[schedule:start]', String(error?.message || error).slice(0, 300))
    return fail(res, 503, upload.error)
  }
  ok(res, { upload })
})

app.post('/api/uploads/:id/publish', async (req, res) => {
  const upload = getState().uploads.find((u) => u.id === req.params.id)
  if (!upload) return fail(res, 404, 'Agendamento não encontrado.')
  if (upload.status === 'publicado') return fail(res, 409, 'Este vídeo já foi publicado.')
  if (upload.status === 'enviando') return fail(res, 409, 'Este vídeo já está sendo publicado.')
  if (!isConnected(upload.platform)) {
    return fail(res, 409, `Conecte o ${platformLabel(upload.platform)} antes de publicar.`)
  }
  upload.scheduledAt = new Date().toISOString()
  upload.status = 'agendado'
  upload.error = null
  save()
  try {
    upload.workflowRunId = await startUploadWorkflow(upload.id)
    save()
  } catch (error) {
    upload.status = 'erro'
    upload.error = 'Não foi possível iniciar a publicação durável.'
    save()
    console.error('[schedule:publish]', String(error?.message || error).slice(0, 300))
    return fail(res, 503, upload.error)
  }
  ok(res, { upload })
})

app.patch('/api/uploads/:id', async (req, res) => {
  const state = getState()
  const upload = state.uploads.find((u) => u.id === req.params.id)
  if (!upload) return fail(res, 404, 'Agendamento não encontrado.')
  if (upload.status === 'enviando') return fail(res, 409, 'Aguarde a publicação terminar.')
  if (req.body.platform !== undefined) {
    if (!PLATFORMS.includes(req.body.platform)) return fail(res, 400, 'Plataforma não suportada.')
    if (!isConnected(req.body.platform)) {
      return fail(res, 409, `Conecte o ${platformLabel(req.body.platform)} antes de agendar.`)
    }
  }
  if (req.body.scheduledAt !== undefined) {
    const scheduledDate = new Date(req.body.scheduledAt)
    if (!Number.isFinite(scheduledDate.getTime())) return fail(res, 400, 'Escolha uma data válida para agendar.')
    upload.scheduledAt = scheduledDate.toISOString()
  }
  for (const key of ['platform', 'title']) {
    if (req.body[key] !== undefined) upload[key] = req.body[key]
  }
  if (upload.status === 'erro' && req.body.scheduledAt) {
    upload.status = 'agendado'
    upload.error = null
  }
  save()
  if (upload.status === 'agendado' && req.body.scheduledAt !== undefined) {
    try {
      upload.workflowRunId = await startUploadWorkflow(upload.id)
      save()
    } catch (error) {
      upload.status = 'erro'
      upload.error = 'Não foi possível atualizar o agendamento durável.'
      save()
      console.error('[schedule:update]', String(error?.message || error).slice(0, 300))
      return fail(res, 503, upload.error)
    }
  }
  ok(res, { upload })
})

app.delete('/api/uploads/:id', (req, res) => {
  const state = getState()
  state.uploads = state.uploads.filter((u) => u.id !== req.params.id)
  save()
  ok(res, { ok: true })
})

app.get('/api/jobs', (req, res) => ok(res, { jobs: getJobs() }))

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  console.error(err)
  fail(res, 500, 'Algo deu errado. Tente novamente.')
})

export default app
