// O stream do GenDownload é chunked (sem Content-Length) e ignora Range, então o
// Chrome mostra "?". Este módulo faz o último trecho na nossa infra: resolve no
// GenDownload, guarda o arquivo temporariamente e serve com tamanho real/Ranges.
// O preparo entra na mesma fila de trabalhos pesados e respeita a captura da
// live para não derrubar o processo do Render free.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DATA } from './store.mjs'
import {
  beginHeavyWork, endHeavyWork, runHeavyExclusive, waitForLiveRecording,
} from './work-gate.mjs'

const EXTRACT_URL = 'https://gendownload.com/api/extract'
const STREAM_HOST = 'dl.gendownload.com'
const DIR = path.join(DATA, 'downloads')
const MAX_BYTES = 600 * 1024 * 1024
const TTL_MS = 30 * 60 * 1000
const PREPARE_TIMEOUT_MS = 10 * 60 * 1000

fs.mkdirSync(DIR, { recursive: true })

const jobs = new Map()
const bySource = new Map()

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    ...(job.status === 'pronto' ? { size: job.size, filename: job.filename } : {}),
  }
}

function safeFilename(title, ext) {
  const base = String(title || 'video')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'video'}.${ext}`
}

function allowedStreamUrl(raw) {
  let url
  try {
    url = new URL(String(raw || ''))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  // A API pode devolver o host apex no exemplo da documentação; normalizamos
  // para o host de download antes de validar. Nenhum outro domínio é aceito.
  if (url.hostname === 'gendownload.com') url.hostname = STREAM_HOST
  if (url.hostname !== STREAM_HOST || url.pathname !== '/api/stream') return null
  const allowedParams = ['t', 'i']
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.includes(key)) return null
  }
  const token = url.searchParams.get('t') || ''
  const index = url.searchParams.get('i') || ''
  if (!/^[a-f0-9]{16,64}$/i.test(token) || !/^\d{1,3}$/.test(index)) return null
  return url.toString()
}

async function resolveGenDownload(sourceUrl) {
  const res = await fetch(EXTRACT_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error('extract-falhou')
  const json = await res.json()
  const formats = Array.isArray(json?.formats) ? json.formats : []
  const videos = formats.filter((f) => (
    f?.type === 'video' && /^https?:\/\//i.test(String(f?.url || ''))
  ))
  const picked = videos.find((f) => /720/i.test(String(f?.label))) || videos[0]
  if (!picked) throw new Error('sem-formato')
  const streamUrl = allowedStreamUrl(picked.url)
  if (!streamUrl) throw new Error('url-invalida')
  const audio = /audio|\bm4a\b/i.test(`${picked.label || ''} ${picked.ext || ''}`)
  return { streamUrl, title: json?.title, ext: audio ? 'm4a' : 'mp4' }
}

async function bufferStream(job, streamUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREPARE_TIMEOUT_MS)
  try {
    const res = await fetch(streamUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`stream-http-${res.status}-${detail.slice(0, 80)}`)
    }
    let received = 0
    async function* counted(source) {
      for await (const chunk of source) {
        received += chunk.byteLength || chunk.length
        job.received = received
        if (received > MAX_BYTES) throw new Error('arquivo-muito-grande')
        yield chunk
      }
    }
    await pipeline(
      counted(Readable.fromWeb(res.body)),
      fs.createWriteStream(job.file, { flags: 'wx' }),
    )
    if (!received) throw new Error('arquivo-vazio')
    job.size = received
  } finally {
    clearTimeout(timer)
  }
}

async function prepare(job) {
  try {
    await runHeavyExclusive(async () => {
      beginHeavyWork()
      try {
        await waitForLiveRecording()
        // O token do stream expira rápido: resolver depois do gate evita que
        // uma fila de render ou uma janela da live queime o link antes do fetch.
        const { streamUrl, title, ext } = await resolveGenDownload(job.sourceUrl)
        await bufferStream(job, streamUrl)
        job.filename = safeFilename(title, ext)
      } finally {
        endHeavyWork()
      }
    })
    job.status = 'pronto'
    job.readyAt = Date.now()
  } catch (error) {
    job.status = 'erro'
    job.errorAt = Date.now()
    console.error('[download:prepare]', String(error?.message || error).slice(0, 200))
    try { fs.unlinkSync(job.file) } catch {}
  }
}

export function createDownload(sourceUrl) {
  const url = String(sourceUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('link-invalido')
  const cachedId = bySource.get(url)
  const cached = cachedId ? jobs.get(cachedId) : null
  if (cached && cached.status !== 'erro') return publicJob(cached)

  const id = crypto.randomUUID()
  const job = {
    id,
    sourceUrl: url,
    status: 'preparando',
    createdAt: Date.now(),
    file: path.join(DIR, `${id}.mp4`),
  }
  jobs.set(id, job)
  bySource.set(url, id)
  void prepare(job)
  return publicJob(job)
}

export function getDownload(id) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) return null
  const job = jobs.get(String(id).toLowerCase())
  return job ? publicJob(job) : null
}

export function getDownloadFile(id) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) return null
  const job = jobs.get(String(id).toLowerCase())
  if (job?.status !== 'pronto') return null
  try {
    return {
      file: job.file,
      size: fs.statSync(job.file).size,
      filename: job.filename || 'video.mp4',
    }
  } catch {
    return null
  }
}

export function sweepDownloads() {
  const now = Date.now()
  const active = new Set()
  for (const [id, job] of jobs) {
    if (job.status === 'preparando') active.add(id)
    const at = job.readyAt || job.errorAt || job.createdAt
    if ((job.status === 'pronto' || job.status === 'erro') && now - at > TTL_MS) {
      jobs.delete(id)
      if (bySource.get(job.sourceUrl) === id) bySource.delete(job.sourceUrl)
      if (job.status === 'pronto') {
        try { fs.unlinkSync(job.file) } catch {}
      }
    }
  }
  let names = []
  try { names = fs.readdirSync(DIR) } catch { return }
  for (const name of names) {
    const match = /^([a-f0-9-]{36})\.mp4$/i.exec(name)
    if (!match || active.has(match[1].toLowerCase())) continue
    const file = path.join(DIR, name)
    try {
      if (now - fs.statSync(file).mtimeMs > TTL_MS) fs.unlinkSync(file)
    } catch {}
  }
}
