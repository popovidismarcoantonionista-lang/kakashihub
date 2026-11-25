// Prepara o download da busca com tamanho real: o leitor público devolve o
// vídeo 720p e o áudio em faixas separadas; o ffmpeg junta os dois em um MP4
// progressivo servido por /api/downloads/:id/file.mp4. A URL do CDN nunca é
// devolvida ao navegador, e nenhum `?` aparece no link de download.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { DATA } from './store.mjs'
import { INVIDIOUS_URL, INVIDIOUS_URLS, youtubeVideoId } from './services.mjs'
import {
  beginHeavyWork, endHeavyWork, runHeavyExclusive, waitForLiveRecording,
} from './work-gate.mjs'

const DOWNLOADS = path.join(DATA, 'downloads')
fs.mkdirSync(DOWNLOADS, { recursive: true })

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_FFMPEG = path.join(APP_ROOT, '.bin', 'ffmpeg')
const FFMPEG_BIN = process.env.FFMPEG_BIN || (fs.existsSync(LOCAL_FFMPEG) ? LOCAL_FFMPEG : 'ffmpeg')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const STREAM_HEADERS = {
  'user-agent': UA,
  accept: '*/*',
  'accept-encoding': 'identity',
  // O companion quebra com `bytes=0-1023`; o range aberto devolve o arquivo
  // inteiro com Content-Length e Content-Range exatos.
  range: 'bytes=0-',
}
const API_TIMEOUT = 18000
const STREAM_TIMEOUT = 150000
const FFMPEG_TIMEOUT = 10 * 60 * 1000
const TTL = 30 * 60 * 1000
const MAX_FILES = 12
const ID_RE = /^dl-[a-z0-9-]+$/i

const preferred = String(process.env.SEARCH_DOWNLOAD_INVIDIOUS_URL || '').trim().replace(/\/+$/, '')
const HOSTS = [...new Set([
  preferred,
  INVIDIOUS_URL,
  ...INVIDIOUS_URLS.slice(0, 3),
].filter(Boolean))]

function asAbsolute(value, base) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw, base)
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function pickFormats(json) {
  const adaptive = Array.isArray(json?.adaptiveFormats) ? json.adaptiveFormats : []
  const videos = adaptive.filter((fmt) => {
    const type = String(fmt?.type || '')
    return type.startsWith('video/mp4')
      && type.includes('avc1')
      && /720/i.test(String(fmt?.qualityLabel || ''))
      && Number(fmt?.clen) > 0
  }).sort((a, b) => Number(b.clen) - Number(a.clen))
  const audios = adaptive.filter((fmt) => {
    const type = String(fmt?.type || '')
    return type.startsWith('audio/mp4')
      && type.includes('mp4a.40.2')
      && Number(fmt?.clen) > 0
  }).sort((a, b) => Number(b.clen) - Number(a.clen))
  return { video: videos[0] || null, audio: audios[0] || null }
}

async function resolveFormats(id) {
  let lastError = new Error('invidious-unreachable')
  for (const base of HOSTS) {
    try {
      const endpoint = new URL(`${base}/api/v1/videos/${encodeURIComponent(id)}`)
      endpoint.searchParams.set('local', 'true')
      const res = await fetch(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(API_TIMEOUT),
      })
      if (!res.ok) throw new Error(`invidious-${res.status}`)
      const json = await res.json()
      if (!json || typeof json !== 'object') throw new Error('invidious-invalid')
      if (json.error) throw new Error('invidious-error')
      if (json.liveNow || json.isUpcoming) throw new Error('invidious-live')
      const { video, audio } = pickFormats(json)
      if (!video || !audio) throw new Error('invidious-no-format')
      const videoUrl = asAbsolute(video.url, base)
      const audioUrl = asAbsolute(audio.url, base)
      if (!videoUrl || !audioUrl) throw new Error('invidious-no-url')
      console.log('[download:resolve]', `${new URL(base).host} → 720p`)
      return {
        base,
        title: String(json.title || 'Vídeo do YouTube').slice(0, 120),
        video: { url: videoUrl, size: Number(video.clen) },
        audio: { url: audioUrl, size: Number(audio.clen) },
      }
    } catch (error) {
      lastError = error
      console.warn('[download:resolve]', `${new URL(base).host}: ${String(error?.message || error).slice(0, 120)}`)
    }
  }
  throw lastError
}

async function saveStream(url, expected, dest) {
  const res = await fetch(url, {
    headers: STREAM_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(STREAM_TIMEOUT),
  })
  if (!res.ok) throw new Error(`stream-${res.status}`)
  if (!res.body) throw new Error('stream-empty')
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared !== expected) throw new Error('stream-size')
  await streamPipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
  const saved = fs.statSync(dest).size
  if (saved !== expected) throw new Error('stream-size')
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

function safeFilename(title) {
  const clean = String(title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${clean || 'video'}-720p.mp4`
}

export function cleanupPreparedDownloads() {
  try {
    const entries = fs.readdirSync(DOWNLOADS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name))
      .map((entry) => {
        const dir = path.join(DOWNLOADS, entry.name)
        let createdAt = fs.statSync(dir).mtimeMs
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
          if (Number.isFinite(meta?.createdAt)) createdAt = Number(meta.createdAt)
        } catch {}
        return { dir, createdAt }
      })
      .sort((a, b) => a.createdAt - b.createdAt)
    const now = Date.now()
    const keepFrom = Math.max(0, entries.length - MAX_FILES)
    for (let i = 0; i < entries.length; i += 1) {
      const item = entries[i]
      if (now - item.createdAt > TTL || i < keepFrom) {
        fs.rmSync(item.dir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    console.warn('[download:cleanup]', String(error?.message || error).slice(0, 160))
  }
}

export function findPreparedDownload(id) {
  if (!ID_RE.test(String(id || ''))) return null
  const dir = path.join(DOWNLOADS, id)
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    const file = path.join(dir, 'final.mp4')
    if (!Number.isFinite(Number(meta?.size)) || !fs.existsSync(file)) return null
    const size = fs.statSync(file).size
    if (size !== Number(meta.size)) return null
    return { ...meta, size, file }
  } catch {
    return null
  }
}

async function prepare(url) {
  const id = youtubeVideoId(url)
  if (!id) throw new Error('invidious-no-id')
  cleanupPreparedDownloads()
  const meta = await resolveFormats(id)

  const token = `dl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(DOWNLOADS, token)
  const videoFile = path.join(dir, 'video.mp4')
  const audioFile = path.join(dir, 'audio.m4a')
  const finalFile = path.join(dir, 'final.mp4')
  fs.mkdirSync(dir, { recursive: true })
  try {
    await saveStream(meta.video.url, meta.video.size, videoFile)
    await saveStream(meta.audio.url, meta.audio.size, audioFile)
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', videoFile, '-i', audioFile,
      '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart', '-shortest', finalFile,
    ])
    const size = fs.statSync(finalFile).size
    if (size < 1024 * 100) throw new Error('ffmpeg-empty')
    const result = {
      id: token,
      size,
      title: meta.title,
      filename: safeFilename(meta.title),
      createdAt: Date.now(),
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(result))
    fs.rmSync(videoFile, { force: true })
    fs.rmSync(audioFile, { force: true })
    return result
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

export function prepareSearchDownload(url) {
  const execute = async () => {
    beginHeavyWork()
    await waitForLiveRecording()
    try {
      return await prepare(url)
    } finally {
      endHeavyWork()
    }
  }
  return runHeavyExclusive(execute)
}

export function friendlyDownloadError(error) {
  const message = String(error?.message || '')
  if (message.includes('invidious-live')) return 'Este vídeo está ao vivo ou ainda não foi publicado.'
  if (message.includes('invidious-no-format')) return 'Este vídeo não tem uma versão 720p com áudio disponível.'
  if (message.includes('invidious-no-id')) return 'Cole um link de vídeo do YouTube.'
  return 'Não foi possível preparar o download agora. Tente de novo em instantes.'
}
