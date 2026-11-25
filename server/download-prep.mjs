// Download da busca: o IP do Render/Netlify é bloqueado pelo YouTube e pelos
// espelhos públicos, então quem busca os bytes é o navegador do usuário (IP
// residencial). O Render só recebe as partes, junta 720p + áudio com ffmpeg e
// serve o MP4 final em /api/downloads/:id/file.mp4, com Content-Length real e
// sem query string. Nenhuma URL do provedor/CDN aparece na interface.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DATA } from './store.mjs'
import { youtubeVideoId } from './services.mjs'
import {
  beginHeavyWork, endHeavyWork, runHeavyExclusive, waitForLiveRecording,
} from './work-gate.mjs'

const DOWNLOADS = path.join(DATA, 'downloads')
fs.mkdirSync(DOWNLOADS, { recursive: true })

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_FFMPEG = path.join(APP_ROOT, '.bin', 'ffmpeg')
const FFMPEG_BIN = process.env.FFMPEG_BIN || (fs.existsSync(LOCAL_FFMPEG) ? LOCAL_FFMPEG : 'ffmpeg')
const PROVIDER = String(process.env.SEARCH_DOWNLOAD_PROVIDER || 'https://yt.chocolatemoo53.com')
  .trim().replace(/\/+$/, '')
const FFMPEG_TIMEOUT = 10 * 60 * 1000
const TTL = 30 * 60 * 1000
const MAX_FILES = 12
const ID_RE = /^dl-[a-z0-9-]+$/i
const PARTS = new Set(['video', 'audio'])

const sessionDir = (id) => path.join(DOWNLOADS, id)
const metaPath = (id) => path.join(sessionDir(id), 'meta.json')

function readMeta(id) {
  if (!ID_RE.test(String(id || ''))) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), 'utf8'))
  } catch {
    return null
  }
}

function safeFilename(title, quality) {
  const clean = String(title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const label = String(quality || '').match(/(\d+)p/i)?.[1] || '720'
  return `${clean || 'video'}-${label}p.mp4`
}

export function cleanupPreparedDownloads() {
  try {
    const entries = fs.readdirSync(DOWNLOADS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name))
      .map((entry) => {
        const dir = path.join(DOWNLOADS, entry.name)
        let createdAt = fs.statSync(dir).mtimeMs
        let status = 'pending'
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
          if (Number.isFinite(meta?.createdAt)) createdAt = Number(meta.createdAt)
          if (meta?.status) status = String(meta.status)
        } catch {}
        return { dir, createdAt, status }
      })
      .sort((a, b) => a.createdAt - b.createdAt)
    const now = Date.now()
    const keepFrom = Math.max(0, entries.length - MAX_FILES)
    for (let i = 0; i < entries.length; i += 1) {
      const item = entries[i]
      // Sessões pending podem levar vários minutos (proxy lento); só expiram
      // por inatividade. Concluídas também respeitam o limite de arquivos.
      const expired = now - item.createdAt > TTL
      if (expired || (item.status !== 'pending' && i < keepFrom)) {
        fs.rmSync(item.dir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    console.warn('[download:cleanup]', String(error?.message || error).slice(0, 160))
  }
}

export function findPreparedDownload(id) {
  const meta = readMeta(id)
  if (!meta || meta.status !== 'done') return null
  const file = path.join(sessionDir(id), 'final.mp4')
  if (!Number.isFinite(Number(meta.size)) || !fs.existsSync(file)) return null
  const size = fs.statSync(file).size
  if (size !== Number(meta.size)) return null
  return { ...meta, size, file }
}

/** Abre uma sessão de upload. O front busca os bytes e envia em partes. */
export function createPreparedDownload(url, title) {
  const videoId = youtubeVideoId(url)
  if (!videoId) throw new Error('invidious-no-id')
  cleanupPreparedDownloads()
  const id = `dl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  fs.mkdirSync(sessionDir(id), { recursive: true })
  fs.writeFileSync(metaPath(id), JSON.stringify({
    id,
    status: 'pending',
    title: String(title || 'Vídeo do YouTube').slice(0, 120),
    createdAt: Date.now(),
  }))
  return {
    id,
    videoId,
    provider: PROVIDER,
    url: `/api/downloads/${id}/file.mp4`,
  }
}

export function appendDownloadPart(id, part, buffer) {
  const meta = readMeta(id)
  if (!meta || meta.status !== 'pending') throw new Error('download-sessao-invalida')
  if (!PARTS.has(String(part || ''))) throw new Error('download-parte-invalida')
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('download-vazio')
  if (buffer.length > 8 * 1024 * 1024) throw new Error('download-parte-grande')
  const target = path.join(sessionDir(id), `${part}.part`)
  fs.appendFileSync(target, buffer)
  // Cada upload reinicia o TTL, para um download longo não ser apagado no meio.
  fs.writeFileSync(metaPath(id), JSON.stringify({ ...meta, createdAt: Date.now() }))
  return { ok: true, size: fs.statSync(target).size }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT)
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1200) })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg-${code}: ${stderr.trim().slice(-300)}`))
    })
  })
}

/** Junta as partes e publica o MP4 final. */
export function finalizePreparedDownload(id, payload) {
  const meta = readMeta(id)
  if (!meta || meta.status !== 'pending') throw new Error('download-sessao-invalida')
  const videoFile = path.join(sessionDir(id), 'video.part')
  const audioFile = path.join(sessionDir(id), 'audio.part')
  const finalFile = path.join(sessionDir(id), 'final.mp4')
  const videoSize = Number(payload?.videoSize)
  const audioSize = Number(payload?.audioSize)
  if (!Number.isFinite(videoSize) || !Number.isFinite(audioSize)
    || videoSize <= 0 || audioSize <= 0
    || fs.statSync(videoFile).size !== videoSize
    || fs.statSync(audioFile).size !== audioSize) {
    throw new Error('download-tamanho')
  }

  const execute = async () => {
    beginHeavyWork()
    await waitForLiveRecording()
    try {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', videoFile, '-i', audioFile,
        '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-movflags', '+faststart', '-shortest', finalFile,
      ])
      const size = fs.statSync(finalFile).size
      if (size < 1024 * 100) throw new Error('ffmpeg-empty')
      const result = {
        ...meta,
        status: 'done',
        size,
        filename: safeFilename(meta.title, payload?.quality),
      }
      fs.writeFileSync(metaPath(id), JSON.stringify(result))
      fs.rmSync(videoFile, { force: true })
      fs.rmSync(audioFile, { force: true })
      console.log('[download:ready]', `${id} → ${size} bytes`)
      return result
    } finally {
      endHeavyWork()
    }
  }
  return runHeavyExclusive(execute)
}

export function friendlyDownloadError(error) {
  const message = String(error?.message || '')
  if (message.includes('invidious-no-id')) return 'Cole um link de vídeo do YouTube.'
  if (message.includes('download-sessao')) return 'Este download expirou. Tente de novo.'
  return 'Não foi possível preparar o download agora. Tente de novo em instantes.'
}
