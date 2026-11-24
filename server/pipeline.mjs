import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  COVERS,
  DATA,
  EXPORTS,
  MEDIA,
  SRC_MEDIA,
  addActivity,
  createJob,
  getJob,
  findClip,
  findSource,
  finishJob,
  flushStore,
  getState,
  save,
  sourceVideo,
  updateJob,
} from './store.mjs'
import { ensureLocalMedia, mediaPathFromUrl, storeLocalFile } from './media-store.mjs'
import { beginLiveRecording, endLiveRecording, heavyWorkActive, waitForLiveRecording } from './work-gate.mjs'
import { INVIDIOUS_URL, INVIDIOUS_URLS, cobaltResolve, hasCobalt, hasYtdlpApi, hasInvidious, invidiousInfo, ydlInfo, youtubeVideoId } from './services.mjs'

const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PYHOST_DIR = path.join(APP_ROOT, '.pyhost')
const FFMPEG_LOCAL_BIN = path.join(APP_ROOT, '.bin', 'ffmpeg')
const FFPROBE_LOCAL_BIN = path.join(APP_ROOT, '.bin', 'ffprobe')
const FFMPEG_BIN = process.env.FFMPEG_BIN || (fs.existsSync(FFMPEG_LOCAL_BIN) ? FFMPEG_LOCAL_BIN : 'ffmpeg')
const FFPROBE_BIN = process.env.FFPROBE_BIN || (fs.existsSync(FFPROBE_LOCAL_BIN) ? FFPROBE_LOCAL_BIN : 'ffprobe')
const YTDLP_BIN = process.env.YTDLP_BIN || path.join(APP_ROOT, '.bin', 'yt-dlp')
// Render free tem ~512 MB de RAM. Renderizar 4K vertical com split + blur +
// legendas estoura o processo e derruba o estado. Por padrão, limitamos a 720p
// quando estamos no Render; use FUGA_LIGHT_RENDER=false para forçar o perfil cheio.
// Mesmo em 720p o encoder precisa ser rápido (1 thread), mas não precisa ser
// ultrafast/crf 26 — isso deixava o vídeo visivelmente pixelado.
const ON_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_GIT_COMMIT
  || Object.keys(process.env).some((key) => key.startsWith('RENDER_')))
const LIGHT_RENDER = process.env.FUGA_LIGHT_RENDER
  ? !/^(0|false|no)$/i.test(String(process.env.FUGA_LIGHT_RENDER).trim())
  : ON_RENDER

// Arquivos recebidos por ZIP podem perder o bit de execução. Corrija isso
// antes do primeiro spawn para evitar que toda live falhe ainda na sondagem.
function ensureExecutable(file) {
  if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) return
  try {
    const mode = fs.statSync(file).mode
    if ((mode & 0o111) === 0) fs.chmodSync(file, 0o755)
  } catch (error) {
    console.warn(`[media] não foi possível preparar ${path.basename(file)}:`, error?.message || error)
  }
}

ensureExecutable(YTDLP_BIN)
ensureExecutable(FFMPEG_LOCAL_BIN)
ensureExecutable(FFPROBE_LOCAL_BIN)

// Quadro padrão usado quando a detecção automática não encontra um rosto.
const DEFAULT_CAM = { x: 0.68, y: 0.02, w: 0.3, h: 0.36 }

export const OUTPUT_SIZES = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
  '4k': { width: 2160, height: 3840 },
}

function renderSize() {
  const key = String(getState().settings?.resolution || '4k')
  const requested = OUTPUT_SIZES[key] || OUTPUT_SIZES['4k']
  return LIGHT_RENDER ? { width: 720, height: 1280 } : requested
}

function sizeLabel(size) {
  if (size.height >= 3000) return '4K'
  if (size.height >= 1600) return '1080p'
  return '720p'
}

function downloadFormat(maxHeight) {
  const h = Number(maxHeight) || 720
  return `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/b[height<=${h}]/b`
}

function sourceMaxHeight() {
  const key = String(getState().settings?.resolution || '4k')
  const requested = key === '4k' ? 2160 : key === '1080p' ? 1080 : 720
  return LIGHT_RENDER ? Math.min(requested, 720) : requested
}

const NICHES = {
  fuga: {
    typeWords: {
      fuga: ['fugiu', 'fuga', 'correu', 'correr', 'escapou', 'escapar', 'sumiu', 'acelerou', 'apagou', 'desapareceu', 'corrida'],
      enquadro: ['enquadro', 'enquadraram', 'enquadrou', 'suspeito', 'revista', 'documento', 'parado', 'encostou', 'abordado'],
      perseguicao: ['perseguicao', 'perseguiu', 'perseguindo', 'sirene', 'giroflex', 'viatura', 'cerco', 'bloqueio', 'radio', 'moto', 'corredor'],
      abordagem: ['abordagem', 'abordar', 'rendido', 'imobilizado', 'prisao', 'detido', 'voz de comando', 'maos na direcao', 'flagrante'],
    },
    hashtags: {
      fuga: ['#fuga', '#perseguicao', '#flagrante', '#madrugada'],
      enquadro: ['#enquadro', '#abordagem', '#flagrante', '#policia'],
      perseguicao: ['#perseguicao', '#cerco', '#viatura', '#rua'],
      abordagem: ['#abordagem', '#bloqueio', '#flagrante', '#policia'],
      momento: ['#flagrante', '#naocreditou', '#rua', '#policia'],
    },
    hooks: {
      fuga: ['A fuga que ninguém conseguiu explicar', 'Ele apagou o farol e acelerou', 'Não tinha por onde passar'],
      enquadro: ['O enquadro que mudou a madrugada', 'O detalhe que ninguém viu', 'Parecia rotina. Não era'],
      perseguicao: ['A perseguição que parou a rua', 'A curva que quase acabou tudo', 'A moto entrou onde a viatura não passava'],
      abordagem: ['O bloqueio estava esperando ele', 'A abordagem durou vinte segundos', 'A rádio avisou antes'],
      momento: ['O momento que a câmera não perdeu', 'Você não viu isso no noticiário', 'O que aconteceu depois da curva'],
    },
  },
  games: {
    typeWords: {
      jogada: ['jogada', 'kill', 'matou', 'headshot', 'ace', 'rush', 'flank', 'noscope', 'no scope', '1v', 'quadra', 'tripla', 'double', 'wipe', 'clutch', 'ganhou', 'virada'],
      clutch: ['clutch', '1v1', '1v2', '1v3', '1v4', '1v5', 'ultima bala', 'defuse', 'bomb', 'ace', 'clutchou', 'salvou'],
      reacao: ['nao acredito', 'que isso', 'meu deus', 'gritei', 'gritou', 'susto', 'assustei', 'risada', 'morrendo de rir', 'rage', 'surtei', 'chorando', 'pulou da cadeira'],
      treta: ['treta', 'chat', 'toxico', 'discussao', 'brigou', 'xingou', 'baniu', 'banido', 'reclamei', 'flamewar', 'cancelou'],
    },
    hashtags: {
      jogada: ['#gameplay', '#jogada', '#clutch', '#gamer'],
      clutch: ['#clutch', '#gameplay', '#insano', '#gamer'],
      reacao: ['#reacao', '#streamer', '#gamer', '#live'],
      treta: ['#treta', '#streamer', '#chat', '#live'],
      momento: ['#gameplay', '#streamer', '#gamer', '#live'],
    },
    hooks: {
      jogada: ['A jogada que virou o jogo', 'Ele viu tudo antes', 'Ninguém esperava essa'],
      clutch: ['O clutch que ninguém acreditou', 'Um contra todos', 'A última bala era dele'],
      reacao: ['A reação que viralizou', 'Ele não acreditou no que viu', 'A tela quase quebrou'],
      treta: ['A treta que tomou o chat', 'O chat inteiro viu', 'Discutiu ao vivo'],
      momento: ['O momento que o chat explodiu', 'Isso não estava no script', 'Ao vivo, sem corte'],
    },
  },
  gta: {
    typeWords: {
      jogada: ['mapa', 'cidade', 'mundo', ' Vice City', 'estado', 'ilha', 'rua', 'open world'],
      clutch: ['212 gb', 'pre download', 'pré-download', 'armazenamento', 'console', 'ps5', 'xbox', 'espaço'],
      reacao: ['lançamento', 'data', 'meia-noite', 'trailer', 'rockstar', '2026', 'anúncio', 'revelação'],
      treta: ['polícia', 'policia', 'carro', 'lembra', 'cadeia', 'prisão', 'milícia', 'procurado'],
      momento: ['gta', 'gta 6', 'grand theft auto', 'jogo', 'gameplay', 'personagem', ' protagonista'],
    },
    hashtags: {
      jogada: ['#gta6', '#gta', '#mapa', '#rockstar'],
      clutch: ['#gta6', '#predownload', '#console', '#gamer'],
      reacao: ['#gta6', '#lançamento', '#trailer', '#rockstar'],
      treta: ['#gta6', '#policia', '#gameplay', '#gamer'],
      momento: ['#gta6', '#gta', '#gameplay', '#shorts'],
    },
    hooks: {
      jogada: ['O detalhe do mapa que ninguém viu', 'Essa cidade é maior do que parece', 'O mundo do GTA 6 começou aqui'],
      clutch: ['Seu console vai precisar de 212 GB livres', 'O pré-download já está dando o que falar', 'Esse é o tamanho real do GTA 6'],
      reacao: ['A data de lançamento pode ter mudado', 'O trailer escondeu esse detalhe', 'A Rockstar confirmou sem avisar'],
      treta: ['A polícia agora lembra do seu carro', 'Esse sistema muda a perseguição', 'Ser procurado ficou diferente'],
      momento: ['O momento do GTA 6 que explodiu a internet', 'Isso estava escondido no trailer', 'Você não viu esse detalhe'],
    },
  },
}

function nicheConfig(state) {
  return NICHES[state.settings?.niche] || NICHES.fuga
}

const wordRes = new Map()
function matchesWord(text, word) {
  if (word.includes(' ')) return text.includes(word)
  let re = wordRes.get(word)
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`)
    wordRes.set(word, re)
  }
  return re.test(text)
}

function norm(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd, env: opts.env || process.env })
    const binary = opts.encoding === 'buffer'
    const outChunks = []
    const errChunks = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('timeout'))
    }, opts.timeout || 1000 * 60 * 12)
    child.stdout?.on('data', (d) => {
      if (binary) outChunks.push(d)
      else if (size < 40 * 1024 * 1024) { outChunks.push(d); size += d.length }
      opts.onStdout?.(d.toString())
    })
    child.stderr?.on('data', (d) => {
      if (errChunks.length < 400) errChunks.push(d)
      opts.onStderr?.(d.toString())
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = binary ? Buffer.concat(outChunks) : Buffer.concat(outChunks).toString()
      const stderr = Buffer.concat(errChunks).toString()
      if (code === 0) resolve({ stdout, stderr })
      else reject(Object.assign(new Error(stderr.slice(-1200) || `exit ${code}`), { code, stderr }))
    })
  })
}

function prepareYouTubeCookies() {
  const configured = String(process.env.FUGA_COOKIES || '').trim()
  const cookiePath = configured || path.join(DATA, 'cookies.txt')
  const encoded = String(process.env.FUGA_COOKIES_B64 || '').trim()
  if (encoded && !fs.existsSync(cookiePath)) {
    try {
      const contents = Buffer.from(encoded, 'base64').toString('utf8')
      if (contents.includes('# Netscape HTTP Cookie File') || contents.includes('\t.youtube.com\t')) {
        fs.mkdirSync(path.dirname(cookiePath), { recursive: true })
        fs.writeFileSync(cookiePath, contents, { mode: 0o600 })
      }
    } catch (err) {
      console.warn('[youtube] não foi possível preparar cookies:', err?.message || err)
    }
  }
  return cookiePath
}

const YT_COOKIES = prepareYouTubeCookies()
const INVIDIOUS_INSTANCE = process.env.INVIDIOUS_INSTANCE
const PLAYER_CLIENTS = (process.env.YTDLP_PLAYER_CLIENTS || 'mweb,tv,web_safari,web_embedded,android_vr').trim()
const IMPERSONATE = (process.env.YTDLP_IMPERSONATE ?? 'chrome').trim()
const VERBOSE = /^(1|true|yes)$/i.test(process.env.YTDLP_VERBOSE || '')
const POT_URL = String(process.env.BGUTIL_POT_URL || process.env.YT_POT_URL || 'http://127.0.0.1:4416').trim()
const POT_ENABLED = /^(1|true|yes)$/i.test(process.env.YT_POT_ENABLED || '')
  || Boolean(process.env.BGUTIL_POT_URL || process.env.YT_POT_URL)
const watchUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`

export function ytdlp(args, opts = {}) {
  const extra = fs.existsSync(YT_COOKIES) ? ['--cookies', YT_COOKIES] : []
  const youtubeArgs = []
  if (INVIDIOUS_INSTANCE) youtubeArgs.push(`invidious_instance=${INVIDIOUS_INSTANCE}`)
  if (PLAYER_CLIENTS) youtubeArgs.push(`player_client=${PLAYER_CLIENTS}`)
  const extractorArgs = []
  if (youtubeArgs.length) extractorArgs.push(`youtube:${youtubeArgs.join(';')}`)
  if (POT_ENABLED) extractorArgs.push(`youtubepot-bgutilhttp:base_url=${POT_URL}`)
  const bundledYtDlp = fs.existsSync(YTDLP_BIN)
  // `plain` remove os argumentos de POT/impersonate: em alguns IPs de
  // datacenter (ex.: Render) eles quebram a extração antes mesmo do YouTube.
  const useExtras = !opts.plain
  return run(bundledYtDlp ? YTDLP_BIN : PYTHON, [
    ...(bundledYtDlp ? [] : ['-m', 'yt_dlp']),
    ...extra,
    ...(useExtras && extractorArgs.length ? ['--extractor-args', extractorArgs.join(';')] : []),
    '--force-ipv4',
    '--js-runtimes', 'node',
    ...(useExtras && IMPERSONATE ? ['--impersonate', IMPERSONATE] : []),
    ...(VERBOSE ? ['--verbose'] : []),
    ...args,
  ], opts)
}

// Executa um comando de live e, se falhar com os argumentos normais, tenta
// uma segunda vez sem POT/impersonate antes de desistir.
async function ytdlpLive(args, timeout, plain = false) {
  try {
    return await ytdlp(args, { timeout, plain })
  } catch (err) {
    if (!plain) {
      console.error('[live:yt-dlp] retry sem argumentos extras:', String(err?.message || err).slice(0, 200))
      return ytdlpLive(args, timeout, true)
    }
    throw err
  }
}

function bestThumb(list) {
  if (!Array.isArray(list) || !list.length) return null
  const sorted = [...list].filter((t) => t?.url).sort((a, b) => (b.width || 0) - (a.width || 0))
  return sorted[0]?.url || null
}

export function isChannelUrl(raw) {
  try {
    const u = new URL(raw)
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return false
    return /^\/(@[^/]+|channel\/|c\/|user\/)/i.test(u.pathname) || /\/(videos|shorts|streams)\/?$/i.test(u.pathname)
  } catch {
    return false
  }
}

export async function fetchChannelVideos(raw) {
  let target = String(raw || '').trim()
  if (/^@[\w.-]+$/.test(target)) target = `https://www.youtube.com/${target}`
  if (!isChannelUrl(target)) throw new Error('not-channel')
  const u = new URL(target)
  if (!/\/(videos|shorts|streams)\/?$/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/+$/, '') + '/videos'
  }
  u.search = ''
  u.hash = ''
  let data
  try {
    const { stdout } = await ytdlp([
      '-J', '--flat-playlist', '--playlist-end', '24',
      '--no-warnings', '--socket-timeout', '20', u.toString(),
    ], { timeout: 1000 * 90 })
    data = JSON.parse(stdout)
  } catch {
    throw new Error('channel-unavailable')
  }
  const entries = (data.entries || []).filter((e) => e && e.id)
  const videos = entries.map((e) => ({
    id: e.id,
    title: e.title || 'Vídeo sem título',
    duration: Math.round(Number(e.duration) || 0),
    thumb: bestThumb(e.thumbnails) || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    views: Number(e.view_count) || 0,
    published: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
    url: `https://www.youtube.com/watch?v=${e.id}`,
  }))
  return {
    channel: data.channel || data.uploader || data.title || 'Canal',
    avatar: bestThumb(data.thumbnails) || null,
    videos,
  }
}

async function probe(file) {
  const { stdout } = await run(FFPROBE_BIN, [
    '-v', 'error',
    '-show_entries', 'stream=width,height,duration:format=duration',
    '-of', 'json', file,
  ])
  const data = JSON.parse(stdout) || {}
  const s = data.streams?.find((stream) => stream.width) || data.streams?.[0] || {}
  return {
    width: s.width || 1280,
    height: s.height || 720,
    duration: Number(s.duration) || Number(data.format?.duration) || 0,
  }
}

export function parseVtt(raw) {
  const txt = raw.replace(/\r/g, '')
  const blocks = txt.split(/\n\n+/)
  const cues = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx === -1) continue
    const [a, b] = lines[idx].split('-->')
    const start = timeToSec(a)
    const end = timeToSec(b)
    if (start == null || end == null) continue
    const text = lines.slice(idx + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  cues.sort((x, y) => x.start - y.start)
  const out = []
  for (const cue of cues) {
    const prev = out[out.length - 1]
    if (prev && norm(prev.text) === norm(cue.text)) {
      prev.end = Math.max(prev.end, cue.end)
      continue
    }
    if (prev && cue.start < prev.start + 0.2 && norm(cue.text).includes(norm(prev.text)) && cue.text.length > prev.text.length + 4) {
      prev.text = cue.text
      prev.end = cue.end
      continue
    }
    out.push({ ...cue })
  }
  return out.filter((c) => c.end - c.start > 0.5 && c.text.length > 1)
}

function timeToSec(t) {
  const m = t.trim().match(/(\d+):(\d{2}):(\d{2})[.,](\d{3})/) || t.trim().match(/(\d+):(\d{2})[.,](\d{3})/)
  if (!m) return null
  if (m.length === 5) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
  return +m[1] * 60 + +m[2] + +m[3] / 1000
}

function classify(text, cfg = NICHES.fuga) {
  const n = norm(text)
  let best = 'momento'
  let bestScore = 0
  for (const [type, words] of Object.entries(cfg.typeWords)) {
    let score = 0
    for (const w of words) if (matchesWord(n, w)) score += w.includes(' ') ? 2 : 1
    if (score > bestScore) { bestScore = score; best = type }
  }
  return bestScore > 0 ? best : 'momento'
}

function cleanHook(text) {
  let t = text.replace(/\s+/g, ' ').trim().replace(/^[,.!?…-]+|[,.!?…-]+$/g, '')
  if (!t) return null
  if (t.length > 68) {
    t = t.slice(0, 68)
    const cut = t.lastIndexOf(' ')
    if (cut > 34) t = t.slice(0, cut)
    t = t.replace(/[,.!?…-]+$/g, '')
  }
  t = t.charAt(0).toUpperCase() + t.slice(1)
  return t.length >= 16 ? t : null
}

function pickHook(type, cues, seedText, cfg = NICHES.fuga) {
  const options = cues.slice(0, 6).map((c) => cleanHook(c.text)).filter(Boolean)
  const complete = options.find(
    (t) => t.length >= 20 && t.length <= 58 &&
      !/\b(com|de|da|do|das|dos|que|e|a|o|em|para|por|no|na|nos|nas|foi)$/i.test(t),
  )
  if (complete) return complete
  const list = cfg.hooks[type] || cfg.hooks.momento
  let h = 0
  for (const ch of seedText) h = (h * 31 + ch.charCodeAt(0)) % 997
  return list[h % list.length]
}

function scoreWindow(cues, min, max, cfg = NICHES.fuga) {
  const text = cues.map((c) => c.text).join(' ')
  const n = norm(text)
  let hits = 0
  for (const words of Object.values(cfg.typeWords)) for (const w of words) if (matchesWord(n, w)) hits++
  const dur = cues[cues.length - 1].end - cues[0].start
  const durFit = dur >= min && dur <= max ? 8 : Math.max(0, 8 - Math.abs(dur - (min + max) / 2) * 0.6)
  const speech = Math.min(14, cues.length * 1.6)
  const keywords = Math.min(32, hits * 5)
  const score = Math.round(Math.min(97, 48 + keywords + speech + durFit))
  return { score, hits, text }
}

function detectFromCues(cues, min, max, cfg = NICHES.fuga) {
  const windows = []
  for (let i = 0; i < cues.length; i++) {
    const startT = cues[i].start
    let j = i
    while (j + 1 < cues.length && cues[j].end - startT < min) j++
    if (j + 1 < cues.length && cues[j + 1].end - startT <= Math.min(max, min + 8)) j++
    const slice = cues.slice(i, j + 1)
    if (!slice.length) continue
    const dur = slice[slice.length - 1].end - startT
    if (dur < min * 0.82 || dur > max * 1.15) continue
    const { score, hits, text } = scoreWindow(slice, min, max, cfg)
    windows.push({ start: startT, end: Math.min(startT + max, slice[slice.length - 1].end), cues: slice, score, hits, text })
  }
  windows.sort((a, b) => b.score - a.score || b.hits - a.hits)
  const chosen = []
  for (const w of windows) {
    if (chosen.length >= 8) break
    if (chosen.some((c) => w.start < c.end + 3 && w.end > c.start - 3)) continue
    chosen.push(w)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

async function detectFromAudio(video, job) {
  updateJob(job, { step: 'Lendo o áudio em busca de movimento' })
  try {
    const { stderr } = await run(FFMPEG_BIN, [
      '-hide_banner',
      ...(LIGHT_RENDER ? ['-threads', '1'] : []),
      '-i', video, '-af', 'silencedetect=noise=-32dB:d=1.4', '-f', 'null', '-',
    ], { timeout: 1000 * 60 * 8 })
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
    const { duration } = await probe(video)
    const silences = starts.map((s, i) => [s, ends[i] ?? duration])
    const active = []
    let cursor = 0
    for (const [s, e] of silences) {
      if (s - cursor > 6) active.push([cursor, s])
      cursor = Math.max(cursor, e)
    }
    if (duration - cursor > 6) active.push([cursor, duration])
    active.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
    return active.slice(0, 5).map(([s, e], i) => {
      const len = Math.min(Math.max(e - s, 20), 34)
      const start = Math.max(0, s + Math.min(3, (e - s - len) / 2))
      return {
        start,
        end: start + len,
        cues: [],
        score: 72 - i * 3,
        hits: 0,
        text: '',
      }
    })
  } catch {
    return []
  }
}

function spreadWindows(duration, min, max) {
  const len = Math.min(Math.max(min + 6, 22), max)
  const count = 6
  const first = Math.min(15, duration * 0.05)
  const span = Math.max(0, duration - first - len - 2)
  const out = []
  for (let i = 0; i < count; i++) {
    const start = first + (span * i) / (count - 1)
    out.push({
      start,
      end: Math.min(duration - 0.4, start + len),
      cues: [],
      score: 72 - i * 2,
      hits: 0,
      text: '',
    })
  }
  return out
}

async function extractCover(video, time, outFile, width = 432) {
  await run(FFMPEG_BIN, [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...(LIGHT_RENDER ? ['-threads', '1', '-filter_threads', '1'] : []),
    '-ss', time.toFixed(2), '-i', video, '-frames:v', '1',
    '-vf', `crop=ih*9/16:ih,scale=${width}:-2`, '-q:v', '3', outFile,
  ], { timeout: 1000 * 60 })
}

async function extractWide(video, time, outFile) {
  await run(FFMPEG_BIN, [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...(LIGHT_RENDER ? ['-threads', '1', '-filter_threads', '1'] : []),
    '-ss', time.toFixed(2), '-i', video, '-frames:v', '1',
    '-vf', 'scale=960:-2', '-q:v', '3', outFile,
  ], { timeout: 1000 * 60 })
}

/** Detecta a webcam do streamer por pele + contraste, sem dependências externas. */
async function detectCamBox(video, start = 0) {
  try {
    const { stdout } = await run(FFMPEG_BIN, [
      '-v', 'error', '-ss', Math.max(0, Number(start) || 0).toFixed(2), '-i', video,
      '-frames:v', '1', '-vf', 'scale=160:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], { timeout: 1000 * 30, encoding: 'buffer' })
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '')
    const w = 160
    const h = Math.floor(buf.length / (w * 3))
    if (h < 40) return null
    const cell = 8
    const gw = Math.floor(w / cell)
    const gh = Math.floor(h / cell)
    const grid = new Float32Array(gw * gh)
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let skin = 0
        let edge = 0
        let total = 0
        for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) {
          for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
            const i = (y * w + x) * 3
            const r = buf[i]
            const g = buf[i + 1]
            const b = buf[i + 2]
            const mx = Math.max(r, g, b)
            const mn = Math.min(r, g, b)
            if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) skin++
            const lum = 0.299 * r + 0.587 * g + 0.114 * b
            const j = (y * w + Math.min(w - 1, x + 2)) * 3
            edge += Math.abs(lum - (0.299 * buf[j] + 0.587 * buf[j + 1] + 0.114 * buf[j + 2]))
            total++
          }
        }
        grid[gy * gw + gx] = (skin / Math.max(1, total)) * 0.8
          + Math.min(1, edge / Math.max(1, total * 45)) * 0.2
      }
    }
    let best = null
    for (const wf of [0.26, 0.32, 0.38]) {
      for (const hf of [0.32, 0.4, 0.48]) {
        const bw = Math.max(2, Math.round(gw * wf))
        const bh = Math.max(2, Math.round(gh * hf))
        for (let gy = 0; gy + bh <= gh; gy++) {
          for (let gx = 0; gx + bw <= gw; gx++) {
            const cx = (gx + bw / 2) / gw
            const cy = (gy + bh / 2) / gh
            // Webcam fica numa borda; o meio é gameplay.
            if (cx > 0.36 && cx < 0.64) continue
            if (cy > 0.35 && cy < 0.65) continue
            let sum = 0
            for (let y = gy; y < gy + bh; y++) {
              for (let x = gx; x < gx + bw; x++) sum += grid[y * gw + x]
            }
            const score = sum / (bw * bh) + (cy < 0.25 ? 0.02 : 0)
            if (!best || score > best.score) {
              best = { score, x: gx / gw, y: gy / gh, w: bw / gw, h: bh / gh }
            }
          }
        }
      }
    }
    if (!best || best.score < 0.12) return null
    return {
      x: +Math.min(1 - best.w, Math.max(0, best.x)).toFixed(4),
      y: +Math.min(1 - best.h, Math.max(0, best.y)).toFixed(4),
      w: +best.w.toFixed(4),
      h: +best.h.toFixed(4),
    }
  } catch {
    return null
  }
}

/** Média de vários quadros: evita que um movimento ponto mude a caixa. */
async function detectCamBoxMulti(video, times) {
  const boxes = []
  for (const t of times) {
    const box = await detectCamBox(video, Math.max(0, t))
    if (box) boxes.push(box)
  }
  if (!boxes.length) return null
  const avg = (key) => boxes.reduce((sum, b) => sum + b[key], 0) / boxes.length
  const x = +avg('x').toFixed(4)
  const y = +avg('y').toFixed(4)
  const w = +avg('w').toFixed(4)
  const h = +avg('h').toFixed(4)
  return {
    x: Math.min(1 - w, x),
    y: Math.min(1 - h, y),
    w,
    h,
  }
}

/**
 * Blur de rosto é detector + ffmpeg: o ffmpeg sozinho só blurá uma região fixa.
 * O detector roda em Python (OpenCV, grátis) antes do ffmpeg e é liberado da
 * memória antes da codificação — importante no Render free.
 */
async function detectFaceBoxes(video, start, duration, cam) {
  const script = path.join(APP_ROOT, 'downloader', 'face_boxes.py')
  if (!fs.existsSync(script)) return []
  try {
    const pyPath = [PYHOST_DIR, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter)
    const { stdout } = await run(PYTHON, [
      script, video, String(Math.max(0, start)), String(Math.max(1, duration)),
      cam ? JSON.stringify(cam) : '',
    ], {
      env: { ...process.env, PYTHONPATH: pyPath },
      timeout: 120000,
    })
    const list = JSON.parse(stdout.trim() || '[]')
    if (!Array.isArray(list)) return []
    return list.slice(0, 6).map((b) => {
      // yuv420p exige coordenadas e dimensões pares no crop/overlay.
      const x = Math.max(0, Math.floor(Number(b.x) || 0) / 2) * 2
      const y = Math.max(0, Math.floor(Number(b.y) || 0) / 2) * 2
      const w = Math.max(8, Math.floor(Number(b.w) || 0) / 2) * 2
      const h = Math.max(8, Math.floor(Number(b.h) || 0) / 2) * 2
      const s = Math.max(0, Number(b.start) || 0)
      const e = Math.max(s + 0.2, Number(b.end) || s + 1)
      return { x, y, w, h, start: +s.toFixed(2), end: +e.toFixed(2) }
    })
  } catch (err) {
    console.warn('[face-detect]', String(err?.message || err).slice(-300))
    return []
  }
}

/** Monta a cadeia que blurá só as regiões detectadas, antes do split/9:16. */
function faceBlurFilter(regions) {
  if (!regions.length) return null
  const parts = []
  const srcLabels = regions.map((_, i) => `[fsrc${i}]`)
  parts.push(`[0:v]split=${regions.length + 1}[fbase]${srcLabels.join('')}`)
  regions.forEach((r, i) => {
    const radius = Math.max(6, Math.min(18, Math.round(Math.min(r.w, r.h) * 0.34)))
    parts.push(`[fsrc${i}]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=${radius}:2,format=yuv420p[fb${i}]`)
  })
  let current = 'fbase'
  regions.forEach((r, i) => {
    const out = i === regions.length - 1 ? 'fblurred' : `fover${i}`
    parts.push(`[${current}][fb${i}]overlay=${r.x}:${r.y}:enable='between(t,${r.start},${r.end})'[${out}]`)
    current = out
  })
  return parts.join(';') + ';'
}

/** Detecta a webcam analisando o vídeo real do corte em três momentos. */
export async function detectCamBoxForClip(clipId) {
  try {
    const clip = findClip(clipId)
    if (!clip) return null
    const liveSrc = clip.media
      ? await ensureLocalMedia(clip.mediaKey || mediaPathFromUrl(clip.media), liveMediaFile(clip), `${clip.id}.mp4`)
      : null
    const source = findSource(clip.sourceId)
    const src = liveSrc || await ensureLocalMedia(source?.mediaKey, sourceVideo(clip.sourceId), `${clip.sourceId}.mp4`)
    if (!src) return null
    const len = Math.max(1, clip.end - clip.start)
    const base = liveSrc ? 0 : clip.start
    return await detectCamBoxMulti(src, [0.2, 0.5, 0.8].map((p) => base + Math.min(len - 0.2, len * p)))
  } catch {
    return null
  }
}

/** Detecta a webcam na janela ao vivo mais recente, em três quadros. */
export async function detectCamBoxForLive(sourceId) {
  try {
    const files = []
    const pending = browserLiveWindows.get(sourceId)
    if (pending?.file && fs.existsSync(pending.file)) files.push(pending.file)
    const clips = (getState().clips || [])
      .filter((c) => c.sourceId === sourceId)
      .slice(-4)
      .reverse()
    for (const clip of clips) {
      const file = liveMediaFile(clip)
      if (file) files.push(file)
    }
    for (const file of files) {
      const box = await detectCamBoxMulti(file, [0.8, 1.2, 1.6])
      if (box) return box
    }
  } catch {}
  return null
}

export async function computeFraming(video, start, end) {
  try {
    const { width, height } = await probe(video)
    if (width / height <= 9 / 16 + 0.02) return 0.5
    const sampleW = 120
    const cropFrac = (9 / 16) / (width / height)
    const maxX = 1 - cropFrac
    const positions = []
    for (const p of [0.25, 0.55, 0.8]) {
      const t = start + (end - start) * p
      const { stdout } = await run(FFMPEG_BIN, [
        '-v', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1',
        '-vf', `scale=${sampleW}:-2`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
      ], { timeout: 1000 * 60, encoding: 'buffer' }).then((r) => ({ stdout: Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout) }))
      const buf = stdout
      const h = Math.floor(buf.length / sampleW)
      if (!h) continue
      const col = new Array(sampleW).fill(0)
      for (let y = 1; y < h; y++) {
        for (let x = 1; x < sampleW; x++) {
          const i = y * sampleW + x
          const gx = Math.abs(buf[i] - buf[i - 1])
          const gy = Math.abs(buf[i] - buf[i - sampleW])
          col[x] += gx + gy * 0.6
        }
      }
      const win = Math.max(4, Math.round(sampleW * cropFrac))
      let bestX = 0
      let best = -1
      for (let x = 0; x <= sampleW - win; x++) {
        let s = 0
        for (let k = 0; k < win; k++) s += col[x + k]
        if (s > best) { best = s; bestX = x }
      }
      const center = (bestX + win / 2) / sampleW
      positions.push(Math.min(1, Math.max(0, (center - cropFrac / 2) / maxX)))
    }
    if (!positions.length) return 0.5
    const avg = positions.reduce((a, b) => a + b, 0) / positions.length
    return Math.min(0.92, Math.max(0.06, avg))
  } catch {
    return 0.5
  }
}

export async function clipFrame(clipId) {
  const clip = findClip(clipId)
  if (!clip) throw new Error('Corte não encontrado')
  const liveSrc = clip.media
    ? await ensureLocalMedia(clip.mediaKey || mediaPathFromUrl(clip.media), liveMediaFile(clip), `${clip.id}.mp4`)
    : null
  const source = findSource(clip.sourceId)
  const src = liveSrc || await ensureLocalMedia(source?.mediaKey, sourceVideo(clip.sourceId), `${clip.sourceId}.mp4`)
  if (!src) throw new Error('Sem vídeo para esta fonte')
  const len = Math.max(1, clip.end - clip.start)
  const t = liveSrc ? Math.min(1.5, len / 3) : clip.start + Math.min(2.5, len / 2)
  const { stdout } = await run(FFMPEG_BIN, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', t.toFixed(2), '-i', src, '-frames:v', '1',
    '-vf', 'scale=960:-2', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-',
  ], { timeout: 1000 * 60, encoding: 'buffer' })
  if (!stdout?.length) throw new Error('Sem quadro')
  return stdout
}

/** Quadro recente da live para o ajuste manual de enquadramento em andamento. */
export async function liveFrame(sourceId) {
  const candidates = []
  const pending = browserLiveWindows.get(sourceId)
  if (pending?.file && fs.existsSync(pending.file)) candidates.push(pending.file)
  const clips = (getState().clips || [])
    .filter((clip) => clip.sourceId === sourceId)
    .slice(-4)
    .reverse()
  for (const clip of clips) {
    const file = liveMediaFile(clip)
    if (file) candidates.push(file)
  }
  for (const src of candidates) {
    try {
      const { stdout } = await run(FFMPEG_BIN, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', '1.2', '-i', src, '-frames:v', '1',
        '-vf', 'scale=960:-2', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-',
      ], { timeout: 1000 * 40, encoding: 'buffer' })
      if (stdout?.length) return stdout
    } catch {}
  }
  throw new Error('Sem quadro disponível para esta live')
}

async function findSubFile(sourceId) {
  const files = fs.readdirSync(SRC_MEDIA).filter((f) => f.startsWith(sourceId) && f.endsWith('.vtt'))
  if (!files.length) return null
  files.sort((a, b) => {
    const pa = /\.pt/i.test(a) ? 0 : 1
    const pb = /\.pt/i.test(b) ? 0 : 1
    return pa - pb
  })
  return path.join(SRC_MEDIA, files[0])
}

function isBlocked(err) {
  return /not a bot|Sign in to confirm|confirm your age/i.test(String(err?.message || err))
}

function isOffline(err) {
  return /channel is offline|not currently live|is offline|live stream (?:has )?ended/i.test(String(err?.message || err))
}

// Erros de IP/datacenter e de live fora do ar também precisam cair nos espelhos.
function canMirror(err) {
  return isBlocked(err) || isOffline(err)
    || /Failed to extract any player response|HTTP Error 403/i.test(String(err?.message || err))
}

const FRIENDLY = [
  'Este vídeo não está disponível agora. Tente de novo daqui a pouco ou use outro link…',
  'A análise demorou mais que o esperado. Tente novamente.',
  'Este vídeo não está disponível publicamente.',
  'Não encontramos esse vídeo. Confira o link.',
  'Não foi possível processar este link agora. Tente novamente.',
  'Não foi possível pegar este vídeo agora. Tente de novo…',
  'Essa transmissão ainda não começou. Volte quando estiver ao vivo…',
  'Essa fonte não está ao vivo agora. Cole o link de uma transmissão em andamento…',
  'O arquivo enviado está vazio ou inválido.',
  'Não foi possível ler este arquivo de vídeo. Envie um MP4, MOV, WebM ou MKV válido.',
]

const UPLOAD_EMPTY = FRIENDLY[8]
const UPLOAD_INVALID = FRIENDLY[9]

function friendlyError(err) {
  const s = String(err?.message || err)
  if (FRIENDLY.includes(s)) return s
  if (isBlocked(err) || /HTTP Error 403/i.test(s)) return FRIENDLY[0]
  if (/timeout/i.test(s)) return FRIENDLY[1]
  if (/^service/i.test(s)) return FRIENDLY[5]
  if (/will begin|premieres in/i.test(s)) return FRIENDLY[6]
  if (/channel is offline|not currently live/i.test(s)) return FRIENDLY[7]
  if (/Private video|Sign in|login|not available/i.test(s)) return FRIENDLY[2]
  if (/Video unavailable|HTTP Error 404/i.test(s)) return FRIENDLY[3]
  return FRIENDLY[4]
}

const DL_API = (process.env.DOWNLOAD_API_URL || '').trim().replace(/\/+$/, '')
const DL_KEY = (process.env.DOWNLOAD_API_KEY || '').trim()
const DL_ONLY = /^(1|true|yes)$/i.test(process.env.DOWNLOAD_API_ONLY || '')
const YT_API_KEY = (process.env.YOUTUBE_API_KEY || '').trim()

/** Resumo das fontes configuradas, exposto em /api/health para diagnóstico no Render. */
export function liveCapabilities() {
  return {
    youtubeDataApi: Boolean(YT_API_KEY),
    cobalt: hasCobalt(),
    ytDlpApi: hasYtdlpApi(),
    mirrors: hasInvidious(),
    fixedStream: Boolean(process.env.FUGA_LIVE_STREAM),
  }
}

/** Evita vazar chaves de API em mensagens salvas em source.liveLastError. */
export function liveErrorText(error, limit = 300) {
  return String(error?.message || error)
    .replace(/([?&]key=)[^&\s]+/gi, '$1***')
    .replace(/(x-api-key|api-key)\s*[:=]\s*[^\s,;]+/gi, '$1=***')
    .slice(0, limit)
}

function canUseService() {
  return Boolean(DL_API)
}

function videoIdFromUrl(url) {
  const m = String(url || '').match(/(?:[?&]v=|\/live\/|\/shorts\/|\/embed\/|youtu\.be\/)([\w-]{6,})/)
  return m ? m[1] : ''
}

async function ytApiMeta(videoId) {
  if (!YT_API_KEY) return null
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,status&id=${videoId}&key=${YT_API_KEY}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) return null
    const json = await res.json()
    const item = json.items?.[0]
    if (!item) return null
    const isLive = item.liveStreamingDetails?.actualStartTime && !item.liveStreamingDetails?.actualEndTime
    return {
      id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      description: item.snippet.description || '',
      thumbnail: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
      duration: item.contentDetails.duration ? parseISO8601Duration(item.contentDetails.duration) : 0,
      is_live: isLive,
      liveId: isLive ? item.id : undefined,
      liveChannel: item.snippet.channelId,
    }
  } catch {
    return null
  }
}

function youtubeChannelRef(url) {
  try {
    const u = new URL(String(url || ''))
    const handle = u.pathname.match(/^\/@([\w.-]+)/)
    if (handle) return { handle: `@${handle[1]}` }
    const channel = u.pathname.match(/^\/channel\/(UC[\w-]{20,})/)
    if (channel) return { id: channel[1] }
    const user = u.pathname.match(/^\/(?:c|user)\/([^/]+)/)
    if (user) return { username: decodeURIComponent(user[1]) }
  } catch {}
  return null
}

async function ytApiGet(endpoint, params) {
  if (!YT_API_KEY) return null
  const qs = new URLSearchParams({ ...params, key: YT_API_KEY })
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const SEARCH_CACHE = new Map()
const SEARCH_TTL = 5 * 60 * 1000

/** Busca vídeos gravados no YouTube para o achador de temas. Nunca retorna lives. */
export async function searchYoutubeVideos(query, limit = 12) {
  const q = String(query || '').trim().slice(0, 100)
  if (q.length < 2) return []
  const cacheKey = q.toLocaleLowerCase('pt-BR')
  const cached = SEARCH_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.items

  const maxResults = String(Math.min(16, Math.max(4, limit)))
  const search = await ytApiGet('search', {
    part: 'snippet', type: 'video', maxResults, q, order: 'relevance', videoEmbeddable: 'true',
  })
  const found = (search?.items || []).filter((item) => {
    const broadcast = item?.snippet?.liveBroadcastContent
    return Boolean(item?.id?.videoId) && broadcast !== 'live' && broadcast !== 'upcoming'
  })
  if (!found.length) return []

  const ids = [...new Set(found.map((item) => item.id.videoId))]
  const details = await ytApiGet('videos', {
    part: 'contentDetails,statistics', id: ids.join(','),
  })
  const byId = new Map((details?.items || []).map((video) => [video.id, video]))
  const items = found.map((item) => {
    const id = item.id.videoId
    const snippet = item.snippet || {}
    const detail = byId.get(id)
    return {
      id,
      title: String(snippet.title || 'Vídeo sem título'),
      channel: String(snippet.channelTitle || ''),
      thumb: snippet.thumbnails?.medium?.url || snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: detail?.contentDetails?.duration ? parseISO8601Duration(detail.contentDetails.duration) : 0,
      views: Number(detail?.statistics?.viewCount) || 0,
      published: snippet.publishedAt || null,
      url: `https://www.youtube.com/watch?v=${id}`,
    }
  })

  SEARCH_CACHE.set(cacheKey, { at: Date.now(), items })
  if (SEARCH_CACHE.size > 40) {
    const oldest = [...SEARCH_CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) SEARCH_CACHE.delete(oldest[0])
  }
  return items
}

async function youtubeChannelId(url) {
  const ref = youtubeChannelRef(url)
  if (!ref) return ''
  if (ref.id) return ref.id
  const json = ref.handle
    ? await ytApiGet('channels', { part: 'id', forHandle: ref.handle })
    : await ytApiGet('channels', { part: 'id', forUsername: ref.username })
  const id = json?.items?.[0]?.id
  if (id) return String(id)
  if (ref.username) {
    const search = await ytApiGet('search', { part: 'snippet', type: 'channel', maxResults: '1', q: ref.username })
    return String(search?.items?.[0]?.snippet?.channelId || '')
  }
  return ''
}

async function youtubeLiveId(channelId) {
  if (!channelId) return ''
  const json = await ytApiGet('search', {
    part: 'snippet', channelId, eventType: 'live', type: 'video', maxResults: '1',
  })
  return String(json?.items?.[0]?.id?.videoId || '')
}

/** Resolve o vídeo ao vivo de uma URL de canal (@handle, /c/, /channel/). */
async function youtubeLiveMeta(url) {
  const id = await youtubeLiveId(await youtubeChannelId(url))
  if (!id) return null
  const meta = await ytApiMeta(id)
  if (!meta?.is_live) return null
  return { ...meta, sourceUrl: watchUrl(id) }
}

function parseISO8601Duration(d) {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), s = parseInt(m[3] || 0)
  return h * 3600 + min * 60 + s
}

async function oembedMeta(url) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(FRIENDLY[0])
  const j = await res.json()
  return { title: j.title, channel: j.author_name, thumbnail: j.thumbnail_url, duration: 0 }
}

async function serviceMediaUrl(url) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (DL_KEY) {
    headers.Authorization = `Api-Key ${DL_KEY}`
    headers['X-Api-Key'] = DL_KEY
  }
  const res = await fetch(DL_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, videoQuality: '720', downloadMode: 'auto' }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`service-${res.status}`)
  const json = await res.json()
  if (json.status === 'error' || json.error) throw new Error('service-error')
  if (json.status === 'picker') throw new Error('service-picker')
  const link = json.url || json.link || json.download || json.downloadUrl || json.video || json.mp4
  if (!link || typeof link !== 'string') throw new Error('service-no-link')
  return link
}

async function downloadHttp(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(1000 * 60 * 20) })
  if (!res.ok || !res.body) throw new Error(`service-${res.status}`)
  await streamPipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath))
  const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
  if (size < 1024) throw new Error('service-empty')
}

async function downloadViaService(url, destPath) {
  const link = await serviceMediaUrl(url)
  await downloadHttp(link, destPath)
}

async function downloadViaCobalt(url, destPath) {
  const resolved = await cobaltResolve(url, { quality: '720' })
  if (resolved.kind === 'single' || resolved.kind === 'hls') {
    await downloadHttp(resolved.url, destPath)
    return
  }
  if (resolved.kind === 'merge') {
    const dir = fs.mkdtempSync(path.join(DATA, 'cobalt-'))
    const video = path.join(dir, 'video.mp4')
    const audio = path.join(dir, 'audio.m4a')
    try {
      await downloadHttp(resolved.video, video)
      await downloadHttp(resolved.audio, audio)
      await run(FFMPEG_BIN, ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-i', audio, '-c', 'copy', '-shortest', destPath], { timeout: 1000 * 60 * 20 })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) throw new Error('service-empty')
    return
  }
  throw new Error('cobalt-unsupported')
}

async function downloadViaInvidious(url, destPath) {
  const info = await invidiousInfo(url)
  if (info.hls) {
    await run(FFMPEG_BIN, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', info.hls, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', destPath,
    ], { timeout: 1000 * 60 * 20 })
    const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
    if (size < 1024) throw new Error('invidious-empty')
    return
  }
  if (info.video && info.audio) {
    const dir = fs.mkdtempSync(path.join(DATA, 'invidious-'))
    const video = path.join(dir, 'video.mp4')
    const audio = path.join(dir, 'audio.m4a')
    try {
      await downloadHttp(info.video, video)
      await downloadHttp(info.audio, audio)
      await run(FFMPEG_BIN, ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-i', audio, '-c', 'copy', '-shortest', destPath], { timeout: 1000 * 60 * 20 })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
    if (size < 1024) throw new Error('invidious-empty')
    return
  }
  if (info.video) {
    await downloadHttp(info.video, destPath)
    return
  }
  throw new Error('invidious-no-stream')
}

async function probeMeta(url, job) {
  // No Render/datacenter o yt-dlp demora ~3 min e ainda cai no bloqueio do YouTube.
  // Quando há chave Data API v3, ela resolve título/live/duração em ~300 ms.
  if (YT_API_KEY) {
    const apiId = videoIdFromUrl(url)
    if (apiId) {
      if (job) updateJob(job, { step: 'Lendo as informações da fonte' })
      const apiMeta = await ytApiMeta(apiId)
      if (apiMeta) return apiMeta
    }
    if (isChannelUrl(url)) {
      if (job) updateJob(job, { step: 'Procurando a transmissão' })
      const live = await youtubeLiveMeta(url)
      if (live) return live
    }
  }
  const args = ['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20', url]
  const waits = [0, 6000, 18000]
  let lastErr
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) {
      if (job) updateJob(job, { step: 'Estabilizando a conexão. Tentando de novo' })
      await new Promise((r) => setTimeout(r, waits[i]))
      if (job) updateJob(job, { step: 'Abrindo o link e lendo a fonte' })
    }
    try {
      return JSON.parse((await ytdlp(args, { timeout: 1000 * 90 })).stdout)
    } catch (err) {
      lastErr = err
      if (!canMirror(err)) {
        if (hasYtdlpApi()) {
          try { return await ydlInfo(url) } catch {}
        }
        if (isOffline(err)) {
          const live = await youtubeLiveMeta(url)
          if (live) return live
        }
        throw err
      }
    }
  }
  if (hasYtdlpApi()) {
    try { return await ydlInfo(url) } catch {}
  }
  if (isChannelUrl(url)) {
    const live = await youtubeLiveMeta(url)
    if (live) return live
  }
  if (hasInvidious()) {
    try {
      const inv = await invidiousInfo(url)
      if (inv.title || inv.is_live || inv.id) {
        if (job) updateJob(job, { step: 'Lendo as informações da fonte' })
        return inv
      }
    } catch {}
  }
  // Try YouTube Data API v3 as fallback for metadata
  const videoId = url.match(/(?:[?&]v=|\/live\/|youtu\.be\/)([\w-]{6,})/)?.[1]
  if (videoId && YT_API_KEY) {
    if (job) updateJob(job, { step: 'Lendo as informações da fonte…' })
    const apiMeta = await ytApiMeta(videoId)
    if (apiMeta) return apiMeta
  }
  throw lastErr
}

export async function runIngest(sourceId, url, opts = {}) {
  const state = getState()
  if (!Array.isArray(state.clips)) state.clips = []
  if (!Array.isArray(state.sources)) state.sources = []
  const source = findSource(sourceId)
  const job = createJob('ingest', { sourceId, ...(opts.jobId ? { id: opts.jobId } : {}) })
  const localFile = typeof opts.localFile === 'string'
    ? path.resolve(opts.localFile)
    : (source.uploaded ? await ensureLocalMedia(source.mediaKey, sourceVideo(sourceId), `${sourceId}.mp4`) : null)
  const metaHint = opts.metaHint || {}
  try {
    updateJob(job, { progress: 4, step: localFile ? 'Lendo o vídeo enviado' : 'Abrindo o link e lendo a fonte' })
    let viaService = DL_ONLY && (canUseService() || hasCobalt())
    let viaInvidious = false
    const videoId = videoIdFromUrl(url || '')
    let meta = { ...metaHint }
    const videoPath = localFile || path.join(SRC_MEDIA, `${sourceId}.mp4`)
    let cues = []

    if (localFile) {
      if (!fs.existsSync(localFile) || fs.statSync(localFile).size < 1024) throw new Error(UPLOAD_EMPTY)
      let info
      try { info = await probe(localFile) } catch { throw new Error(UPLOAD_INVALID) }
      source.title = String(meta.title || source.title || 'Vídeo enviado').slice(0, 140)
      source.channel = String(meta.uploader || source.channel || 'Upload local').slice(0, 90)
      if (meta.description) source.description = String(meta.description).slice(0, 4000)
      source.duration = Math.round(info.duration || 0)
      source.url = ''
      source.mode = 'vod'
      source.uploaded = true
      source.demo = false
      source.status = 'processando'
      source.progress = 16
      source.clips = 0
      source.error = null
      save()
      updateJob(job, { progress: 16, step: 'Vídeo enviado. Preparando o material' })
    } else {
      if (viaService) {
        meta = (videoId ? await ytApiMeta(videoId) : null)
          || (!videoId && isChannelUrl(url) ? await youtubeLiveMeta(url) : null)
        if (!meta) {
          try { meta = await oembedMeta(url) } catch { meta = await probeMeta(url, job) }
        }
        updateJob(job, { step: 'Preparando o material' })
      } else {
        try {
          meta = await probeMeta(url, job)
        } catch (err) {
          if (!canMirror(err) || !(canUseService() || hasCobalt() || hasInvidious())) throw new Error(friendlyError(err))
          try {
            const live = isChannelUrl(url) ? await youtubeLiveMeta(url) : null
            if (live) meta = live
            else {
              if (!hasInvidious()) throw new Error('invidious-disabled')
              meta = await invidiousInfo(url)
            }
            updateJob(job, { step: 'Lendo as informações da fonte' })
          } catch {
            try { meta = hasYtdlpApi() ? await ydlInfo(url) : await oembedMeta(url) } catch { meta = await oembedMeta(url) }
            viaService = true
            updateJob(job, { step: 'Preparando o material' })
          }
        }
      }
      if (meta.is_live) {
        source.mode = 'live'
        source.platform = /kick\.com/i.test(url) ? 'kick' : /twitch\.tv/i.test(url) ? 'twitch' : 'youtube'
        source.title = String(meta.title || 'Transmissão ao vivo').slice(0, 140)
        source.channel = String(meta.uploader || meta.channel || source.channel || 'Transmissão').slice(0, 90)
        if (meta.thumbnail) source.thumb = meta.thumbnail
        source.originalUrl = url
        source.url = meta.sourceUrl || (meta.liveId && /youtube\.com|youtu\.be/i.test(url) ? watchUrl(meta.liveId) : url)
        if (meta.liveId) source.liveId = meta.liveId
        if (meta.liveChannel) source.liveChannel = meta.liveChannel
        source.status = 'processando'
        source.progress = 2
        source.error = null
        save()
        addActivity('agent', `Transmissão ao vivo detectada · ${source.channel}`)
        updateJob(job, { progress: 100, step: 'Ao vivo. Acompanhando a transmissão' })
        finishJob(job)
        return []
      }
      if (meta.is_upcoming) throw new Error(FRIENDLY[6])
      const youtubeId = meta.id
      source.title = meta.title || source.title
      // A descrição dos compilados (ex.: XRacing) traz a frase que descreve
      // cada ocorrência. Guardamos para virar legenda contextual, sem AI paga.
      if (meta.description) source.description = String(meta.description).slice(0, 4000)
      source.channel = meta.channel || meta.uploader || source.channel || 'Fonte conectada'
      source.duration = Math.round(meta.duration || 0)
      source.url = url
      source.youtubeId = youtubeId || videoId
      source.demo = false
      source.status = 'processando'
      source.progress = 10
      source.clips = 0
      source.thumb = meta.thumbnail || source.thumb
      save()
      updateJob(job, { progress: 12, step: 'Fonte reconhecida. Preparando o material' })
    }

    if (localFile) {
      updateJob(job, { progress: 68, step: 'Vídeo pronto. Lendo o áudio' })
      source.progress = 68
      save()
    } else {
      updateJob(job, { progress: 16, step: 'Baixando o vídeo em qualidade de corte' })
      let lastPct = 0
      const onProgress = (chunk) => {
        const m = chunk.match(/\[download\]\s+([\d.]+)%/)
        if (m) {
          const pct = Number(m[1])
          if (pct - lastPct >= 8) {
            lastPct = pct
            const p = Math.round(16 + pct * 0.5)
            job.progress = p
            source.progress = p
            save()
          }
        }
      }
      let dlError
      if (!viaService) {
        try {
          await ytdlp([
            '-f', downloadFormat(sourceMaxHeight()),
            '--merge-output-format', 'mp4',
            '--no-playlist', '--newline', '--no-warnings',
            '--socket-timeout', '20', '--retries', '3',
            '-o', videoPath, url,
          ], {
            timeout: 1000 * 60 * 20,
            onStderr: onProgress,
            onStdout: onProgress,
          })
        } catch (err) {
          dlError = err
          if (!canMirror(err)) throw new Error(friendlyError(err))
          if (hasInvidious()) {
            try {
              console.log('[download:invidious] yt-dlp bloqueado; tentando espelho público')
              updateJob(job, { step: 'Baixando o vídeo' })
              await downloadViaInvidious(url, videoPath)
              viaInvidious = true
            } catch (invErr) {
              console.error('[download:invidious]', String(invErr?.message || invErr).slice(0, 400))
              dlError = invErr
            }
          }
          if (!viaInvidious) {
            if (!(canUseService() || hasCobalt())) throw new Error(friendlyError(dlError))
            viaService = true
          }
        }
      }
      if (viaService) {
        updateJob(job, { step: 'Baixando o vídeo' })
        // Motivo de cada tentativa fica só em job.debug (não aparece no front).
        const attempts = []
        try {
          let downloaded = false
          if (!downloaded && hasCobalt()) {
            try {
              await downloadViaCobalt(url, videoPath)
              downloaded = true
            } catch (err) {
              const reason = String(err?.message || err).slice(0, 300)
              attempts.push(`cobalt:${reason}`)
              console.error('[download:cobalt]', reason)
            }
          }
          if (!downloaded && canUseService()) {
            try {
              await downloadViaService(url, videoPath)
              downloaded = true
            } catch (err) {
              const reason = String(err?.message || err).slice(0, 300)
              attempts.push(`servico:${reason}`)
              console.error('[download:servico]', reason)
            }
          }
          if (!downloaded && hasInvidious()) {
            try {
              await downloadViaInvidious(url, videoPath)
              viaInvidious = true
              downloaded = true
            } catch (err) {
              const reason = String(err?.message || err).slice(0, 300)
              attempts.push(`invidious:${reason}`)
              console.error('[download:invidious]', reason)
            }
          }
          if (!downloaded) {
            const error = new Error(FRIENDLY[5])
            error.debug = attempts.join(' | ')
            throw error
          }
        } catch (err) {
          console.error('[download:servico]', String(err?.message || err).slice(0, 400))
          const error = new Error(FRIENDLY[5])
          error.debug = err?.debug || attempts.join(' | ')
          throw error
        }
      }
      const downloaded = fs.existsSync(videoPath) && fs.statSync(videoPath).size > 1024
      if (!downloaded) throw new Error(friendlyError(dlError))
      source.mediaKey = await storeLocalFile(videoPath, `media/src/${sourceId}.mp4`, 'video/mp4') || source.mediaKey || null
      source.hasMedia = true
      if (!source.duration) {
        try { source.duration = Math.round((await probe(videoPath)).duration) } catch {}
      }
      updateJob(job, { progress: 68, step: 'Vídeo pronto. Buscando a transcrição' })
      source.progress = 68
      save()

      if (!viaService) {
        try {
          await ytdlp([
            '--write-auto-subs', '--write-subs',
            '--sub-langs', 'pt.*,pt,pt-BR,en.*,en',
            '--sub-format', 'vtt/best', '--convert-subs', 'vtt',
            '--skip-download', '--no-warnings', '--socket-timeout', '20',
            '-o', path.join(SRC_MEDIA, `${sourceId}.%(ext)s`), url,
          ], { timeout: 1000 * 60 * 4 })
        } catch {}
      }
      const subFile = await findSubFile(sourceId)
      if (subFile) cues = parseVtt(fs.readFileSync(subFile, 'utf8'))
    }
    updateJob(job, {
      progress: cues.length ? 76 : 74,
      step: cues.length ? `Transcrição pronta · ${cues.length} falas` : 'Sem transcrição. Lendo o áudio',
    })

    updateJob(job, { progress: 80, step: 'Encontrando os melhores momentos' })
    // Nunca confiar em state.settings cru: estados antigos no banco podem vir
    // sem autoApprove/clipMin/clipMax e derrubar o ingest no meio do corte.
    const settings = {
      clipMin: 18,
      clipMax: 38,
      niche: 'fuga',
      autoApprove: false,
      ...(getState().settings || {}),
    }
    const niche = NICHES[settings.niche] ? settings.niche : 'fuga'
    const cfg = nicheConfig(state)
    let windows = cues.length > 4 ? detectFromCues(cues, settings.clipMin, settings.clipMax, cfg) : []
    if (!windows.length) windows = await detectFromAudio(videoPath, job)
    if ((niche === 'games' || niche === 'gta') && windows.length < 3 && source.duration > 120) {
      updateJob(job, { step: 'Sem transcrição. Marcando blocos para revisão' })
      windows = spreadWindows(source.duration, settings.clipMin, settings.clipMax)
    }
    if (!windows.length) throw new Error('Não encontramos momentos suficientes neste vídeo.')

    updateJob(job, { progress: 88, step: 'Enquadrando os cortes em 9:16' })
    const created = []
    for (let i = 0; i < windows.length; i++) {
      if (!findSource(sourceId)) throw new Error('Fonte removida durante a análise.')
      const w = windows[i]
      const type = w.type || classify(`${w.text} ${meta.title || ''} ${meta.description || ''}`, cfg)
      const clipId = `clip-${sourceId}-${i + 1}`
      const coverRel = `/covers/${clipId}.jpg`
      const coverAbs = path.join(COVERS, `${clipId}.jpg`)
      try {
        await extractCover(videoPath, w.start + Math.min(1.5, (w.end - w.start) / 3), coverAbs)
      } catch {}
      let coverKey = null
      if (fs.existsSync(coverAbs)) {
        try { coverKey = await storeLocalFile(coverAbs, `covers/${clipId}.jpg`, 'image/jpeg') } catch (error) {
          console.error('[blob:cover]', String(error?.message || error).slice(0, 200))
        }
      }
      const clip = {
        id: clipId,
        sourceId,
        niche,
        hook: pickHook(type, w.cues, `${sourceId}${i}`, cfg),
        type,
        start: Math.round(w.start * 10) / 10,
        end: Math.round(w.end * 10) / 10,
        score: Math.min(97, Math.max(58, w.score)),
        stage: settings.autoApprove && w.score >= 80 ? 'aprovado' : 'rascunho',
        framing: 'cam',
        framingBias: 0.5,
        cover: fs.existsSync(coverAbs) ? coverRel : '',
        coverKey,
        hashtags: cfg.hashtags[type] || cfg.hashtags.momento,
        captionLines: w.cues.length
          ? w.cues.map((c) => ({ t: Math.max(0, c.start - w.start), text: c.text })).slice(0, 60)
          : [],
        description: (w.cues.length ? w.cues.map((c) => c.text).join(' ') : (meta.description || '')).slice(0, 220),
        createdAt: new Date().toISOString(),
      }
      state.clips.push(clip)
      created.push(clip)
      source.progress = 88 + Math.round(((i + 1) / windows.length) * 8)
      save()
    }

    const wideAbs = path.join(COVERS, `src-${sourceId}.jpg`)
    try {
      await extractWide(videoPath, Math.min(20, (source.duration || 30) * 0.1), wideAbs)
      const coverKey = await storeLocalFile(wideAbs, `covers/src-${sourceId}.jpg`, 'image/jpeg')
      source.thumb = fs.existsSync(wideAbs) ? `/covers/src-${sourceId}.jpg` : ''
      source.thumbKey = coverKey || null
    } catch (error) {
      console.error('[blob:source-cover]', String(error?.message || error).slice(0, 200))
    }

    source.status = 'pronto'
    source.progress = 100
    source.clips = created.length
    source.analyzedAt = new Date().toISOString()
    addActivity('agent', `${created.length} cortes encontrados em "${source.title}"`)
    save()
    await flushStore()
    updateJob(job, { progress: 99, step: 'Cortes prontos para revisão' })
    finishJob(job)
    return created
  } catch (err) {
    // O usuário vê só a mensagem curta; o motivo real fica no log do Render
    // e em job.debug (diagnóstico interno, não mostrado na interface).
    const detail = String(err?.debug || err?.stderr || err?.stack || err?.message || err).slice(-1600)
    console.error('[ingest-error]', sourceId, detail)
    updateJob(job, { debug: detail })
    source.status = 'erro'
    source.error = friendlyError(err)
    source.progress = 0
    save()
    finishJob(job, new Error(friendlyError(err)))
    throw err
  }
}

export async function runAnalyze(sourceId, opts = {}) {
  const source = findSource(sourceId)
  if (!source) throw new Error('Fonte não encontrada')
  const localFile = source.uploaded
    ? await ensureLocalMedia(source.mediaKey, sourceVideo(sourceId), `${sourceId}.mp4`)
    : null
  if (!source.url && !localFile) throw new Error('Conecte um link ou envie um vídeo para analisar esta fonte.')
  const existing = getState().clips.filter((c) => c.sourceId === sourceId)
  getState().clips = getState().clips.filter((c) => c.sourceId !== sourceId)
  getState().sources = getState().sources.map((s) => s.id === sourceId ? { ...s, clips: 0 } : s)
  save()
  try {
    if (localFile) {
      return await runIngest(sourceId, '', {
        localFile,
        metaHint: { title: source.title, uploader: source.channel || 'Upload local', description: '' },
        jobId: opts.jobId,
      })
    }
    return await runIngest(sourceId, source.url, { jobId: opts.jobId })
  } catch (err) {
    getState().clips.push(...existing)
    save()
    throw err
  }
}

function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function assEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitCaptionWords(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function cleanContextText(raw) {
  return String(raw || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .replace(/[@#]\w+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Os compilados estilo XRacing já descrevem a ocorrência na descrição:
// "04:55 Cavalcante - DESVIO SUSPEITO NA OPERAÇÃO...". A frase após o nome
// do canal é exatamente a legenda contextual que queremos queimar no corte.
function parseCreditCaption(description, start) {
  const text = String(description || '')
  if (!text) return ''
  let best = { t: -1, text: '' }
  let first = ''
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—)?\s*(.+)$/)
    if (!m) continue
    const pieces = m[2].split(/\s+(?:-|–|—)\s+/)
    let phrase = cleanContextText(pieces.length > 1 ? pieces.slice(1).join(' ') : pieces[0])
      .replace(/^(arquivo pessoal|previamente autorizado|envie seus vídeos)\b/i, '')
      .replace(/^[-–—:•\s]+/, '')
      .trim()
    // Descrições de compilados costumam só creditar o autor ("Arquivo
    // Pessoal" / link). Isso não é contexto; descartar para não virar legenda.
    if (/^(aviso inicial|arquivo pessoal|previamente autorizado|envie seus|créditos|música|loja|contato)\b/i.test(phrase)) continue
    if (splitCaptionWords(phrase).length < 2 || phrase.length < 8 || phrase.length > 130) continue
    const [h, mi, s] = m[1].split(':').map(Number)
    const t = h * 3600 + mi * 60 + (s || 0)
    if (!first) first = phrase
    if (t <= Number(start || 0) + 2 && t > best.t) best = { t, text: phrase }
  }
  return (best.text || first || '').slice(0, 110)
}

function contextWindow(duration, wordCount) {
  // Comentário escrito: 15s para frase curta; textos maiores ganham tempo
  // para serem lidos, sem passar de 30s (e sem exceder o próprio corte).
  const target = 12 + Math.max(1, wordCount) * 1.2
  const wanted = Math.max(15, Math.min(30, target))
  return Math.max(1, Math.min(duration - 0.3, wanted))
}

function contextChunks(text, duration) {
  // A frase completa fica visível na janela; só a palavra amarela muda.
  const words = splitCaptionWords(text).slice(0, 16)
  if (!words.length) return []
  const start = 0.3
  return [{ start, end: Math.min(duration, start + contextWindow(duration, words.length)), words }]
}

function buildCaptionChunks(clip, duration, gta = false, forcedText = '') {
  const forced = cleanContextText(forcedText)
  if (forced) return contextChunks(forced, duration)
  const lines = Array.isArray(clip?.captionLines) ? clip.captionLines : []
  const raw = lines
    .map((line) => ({ t: Number(line?.t), text: String(line?.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text && Number.isFinite(line.t))
    .sort((a, b) => a.t - b.t)
  const cues = []
  if (raw.length) {
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i]
      const next = raw[i + 1]
      const start = Math.max(0, cur.t)
      const endLimit = Math.max(start + 0.5, Math.min(duration, next ? Math.max(start + 0.5, next.t) : duration))
      const end = Math.min(duration, Math.max(start + 0.6, Math.min(endLimit, start + 3.2)))
      if (end - start < 0.25) continue
      cues.push({ start, end, text: cur.text })
    }
  } else {
    const fallback = String(clip?.hook || clip?.description || '').replace(/\s+/g, ' ').trim()
    if (!fallback) return []
    const words = fallback.split(/\s+/).filter(Boolean)
    const chunkSize = 4
    let t = 0.2
    for (let i = 0; i < words.length && t < duration - 0.2; i += chunkSize) {
      const text = words.slice(i, i + chunkSize).join(' ')
      const end = Math.min(duration, t + Math.max(1.2, Math.min(2.8, text.split(/\s+/).length * 0.45)))
      cues.push({ start: t, end, text })
      t = end + 0.08
    }
  }

  // Quebra cues longos em blocos curtos estilo TikTok.
  const chunks = []
  for (const cue of cues) {
    const words = splitCaptionWords(cue.text)
    if (!words.length) continue
    const maxWords = gta ? 3 : 4
    const total = Math.max(0.6, cue.end - cue.start)
    const parts = []
    for (let i = 0; i < words.length; i += maxWords) parts.push(words.slice(i, i + maxWords))
    const partDur = total / parts.length
    parts.forEach((part, i) => {
      const start = cue.start + i * partDur
      const end = Math.min(duration, i === parts.length - 1 ? cue.end : cue.start + (i + 1) * partDur)
      if (end - start >= 0.2) chunks.push({ start, end, words: part })
    })
  }
  return chunks.filter((c) => c.words.length && c.end > c.start).slice(0, 160)
}

function buildCaptionAss(clip, duration, outW, outH, gta = false, watermark = false, contextText = '') {
  const contextual = Boolean(cleanContextText(contextText))
  const chunks = buildCaptionChunks(clip, duration, gta, contextText)
  if (!chunks.length) return null
  const fontSize = contextual
    ? Math.max(38, Math.round(outH * 0.045))
    : Math.max(42, Math.round(outH * (gta ? 0.062 : 0.055)))
  const marginV = contextual
    ? Math.max(90, Math.round(outH * 0.22))
    : gta
      ? Math.max(70, Math.round(outH * 0.5 - fontSize * 0.5))
      : Math.max(70, Math.round(outH * 0.14))
  const outline = Math.max(3, Math.round(fontSize * 0.12))
  const shadow = Math.max(1, Math.round(outline * 0.5))
  const playResX = outW
  const playResY = outH
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    `Style: Default,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,60,60,${marginV},1`,
    // BorderStyle=3 desenha a caixa escura atrás do texto (comentário escrito).
    `Style: Context,DejaVu Sans,${fontSize + (contextual ? 2 : 0)},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,3,${outline + 5},0,2,60,60,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ]

  const events = []
  for (const chunk of chunks) {
    const words = chunk.words
    const total = Math.max(0.2, chunk.end - chunk.start)
    const step = total / words.length
    for (let i = 0; i < words.length; i++) {
      const start = chunk.start + i * step
      const end = Math.min(chunk.end, i === words.length - 1 ? chunk.end : chunk.start + (i + 1) * step)
      if (end - start < 0.08) continue
      // Estilo máquina-cortes-gta: caixa alta, palavra falada em amarelo (#FFD400).
      const text = words.map((w, idx) => {
        const word = assEscape(String(w).toUpperCase())
        if (idx === i) return `{\\c&H0000D4FF&\\3c&H00000000&\\bord${outline + 1}}${word}{\\r}`
        return `{\\c&H00FFFFFF&\\3c&H00000000&}${word}`
      }).join(' ')
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${contextual ? 'Context' : 'Default'},,0,0,0,,${text}`)
    }
  }
  if (gta && watermark) {
    const project = getState().project || {}
    const name = String(project.name || project.handle || '').replace(/^@/, '').trim()
    if (name) {
      const wmSize = Math.max(24, Math.round(outH * 0.032))
      const wmX = outW - Math.max(20, Math.round(outW * 0.05))
      const wmY = Math.round(outH * 0.175)
      const wmBorder = Math.max(3, Math.round(wmSize * 0.18))
      events.push(`Dialogue: 0,0:00:00.00,${assTime(duration)},Default,,0,0,0,,{\\an9\\pos(${wmX},${wmY})\\fs${wmSize}\\c&H00FFFFFF&\\3c&H00000000&\\bord${wmBorder}}${assEscape(name.toUpperCase().slice(0, 28))}`)
    }
  }
  return events.length ? header.concat(events).join('\n') + '\n' : null
}

function ffmpegFilterPath(file) {
  return String(file)
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):\//, '$1\\:/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

export async function runRender(clipId, opts = {}) {
  const clip = findClip(clipId)
  if (!clip) throw new Error('Corte não encontrado')
  const liveLocal = clip.media
    ? await ensureLocalMedia(clip.mediaKey || mediaPathFromUrl(clip.media), liveMediaFile(clip), `${clip.id}.mp4`)
    : null
  const source = findSource(clip.sourceId)
  const src = liveLocal || await ensureLocalMedia(source?.mediaKey, sourceVideo(clip.sourceId), `${clip.sourceId}.mp4`)
  if (!src) throw new Error('Esta fonte ainda não tem vídeo. Conecte um link para renderizar de verdade.')
  const from = liveLocal ? 0 : clip.start
  const duration = Math.max(1, Number(clip.end) - Number(clip.start) || 0)
  const job = createJob('render', { clipId, sourceId: clip.sourceId, ...(opts.jobId ? { id: opts.jobId } : {}) })
  try {
    updateJob(job, { progress: 8, step: 'Preparando o corte' })
    const out = path.join(EXPORTS, `${clip.id}.mp4`)
    const size = renderSize()
    const gta = clip.niche === 'gta' || getState().settings?.niche === 'gta'
    // Texto no vídeo só se o usuário ligar explicitamente nas configurações.
    // O estilo XRacing liga a legenda contextual junto, mas continua desligado
    // por padrão (settings.xracing = false).
    const renderSettings = getState().settings || {}
    const xracing = renderSettings.xracing === true
    const wantCaptions = renderSettings.captions === true || xracing
    const wantWatermark = renderSettings.watermark === true
    const wantBgBlur = renderSettings.bgBlur === true || xracing
    const wantFaceBlur = renderSettings.faceBlur === true
    const contextText = xracing
      ? (cleanContextText(clip.contextCaption) || parseCreditCaption(source?.description, from) || cleanContextText(clip.hook))
      : ''
    updateJob(job, { progress: 22, step: 'Calculando o enquadramento' })
    let cam = clip.cam || source?.cam || null
    const wantsSplit = gta || clip.framing === 'cam' || clip.framing === 'auto' || !clip.framing
    if (!cam && wantsSplit) {
      updateJob(job, { progress: 26, step: 'Localizando a webcam' })
      const spanSec = Math.max(1, clip.end - clip.start)
      cam = await detectCamBox(src, from + Math.min(1.5, spanSec / 3))
        || await detectCamBox(src, from + Math.min(spanSec - 0.2, spanSec / 2))
        || { ...DEFAULT_CAM }
      clip.cam = cam
    }
    const split = wantsSplit && cam && cam.w >= 0.05 && cam.h >= 0.05
    if (split && clip.framing !== 'cam') clip.framing = 'cam'
    if (gta) clip.framing = 'cam'
    // Sem webcam detectada, o estilo pede o fundo desfocado em vez do crop seco.
    if (wantBgBlur && !split) clip.framing = 'preencher'
    let frac = 0.5
    if (!split) {
      if (clip.framing === 'auto') {
        if (typeof clip.framingBias === 'number' && clip.framingBias !== 0.5) frac = clip.framingBias
        else frac = await computeFraming(src, from, from + (clip.end - clip.start))
      } else if (clip.framing === 'esquerda') frac = 0.05
      else if (clip.framing === 'direita') frac = 0.95
    }
    clip.framingBias = frac

    const { width, height } = await probe(src)
    const { width: outW, height: outH } = size
    const bandH = Math.round(outH / 2)
    const blur = Math.max(8, Math.round(26 * outH / 1280))
    const faceCam = cam
      ? { x: Math.round(cam.x * width), y: Math.round(cam.y * height), w: Math.round(cam.w * width), h: Math.round(cam.h * height) }
      : null
    const faceRegions = wantFaceBlur
      ? await detectFaceBoxes(src, from, duration, faceCam)
      : []
    let vf = ''
    let filterComplex = null
    if (split) {
      const cw = Math.max(2, Math.round(cam.w * width))
      const ch = Math.max(2, Math.round(cam.h * height))
      const cx = Math.round(Math.min(width - cw, Math.max(0, cam.x * width)))
      const cy = Math.round(Math.min(height - ch, Math.max(0, cam.y * height)))
      filterComplex = '[0:v]split=2[camf][gamef];'
        + `[camf]crop=${cw}:${ch}:${cx}:${cy},scale=${outW}:${bandH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${bandH},setsar=1[ct];`
        + `[gamef]scale=${outW}:${bandH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${outW}:${bandH},setsar=1[gt];`
        + `[ct][gt]vstack=2,setsar=1[vout]`
    } else if (clip.framing === 'preencher') {
      filterComplex = '[0:v]split=2[bgs][fgs];'
        + `[bgs]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=${blur}[bg];`
        + `[fgs]scale=${outW}:-2:flags=lanczos[fg];`
        + `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vout]`
    } else if (width / height >= 9 / 16) {
      const cropW = Math.floor((height * 9) / 16 / 2) * 2
      const maxX = Math.max(0, width - cropW)
      const x = Math.round(maxX * frac)
      vf = `crop=${cropW}:${height}:${x}:0,scale=${outW}:${outH}:flags=lanczos,setsar=1`
    } else {
      vf = `scale=-2:${outH}:flags=lanczos,crop=${outW}:${outH}:(iw-${outW})/2:0,setsar=1`
    }
    const faceFc = faceRegions.length ? faceBlurFilter(faceRegions) : ''
    if (faceFc) {
      // A cadeia de rosto roda antes do split/9:16, para o rosto continuar
      // desfocado tanto na faixa da webcam como no quadro do jogo.
      filterComplex = faceFc + (filterComplex ? filterComplex.replace(/\[0:v\]/g, '[fblurred]') : `[fblurred]${vf}[vout]`)
      vf = ''
    }
    updateJob(job, {
      progress: 34,
      step: gta ? `Split GTA · ${sizeLabel(size)}` : split ? `Split · ${sizeLabel(size)}` : `9:16 · ${sizeLabel(size)}`,
    })
    const ass = wantCaptions ? buildCaptionAss(clip, duration, outW, outH, gta, wantWatermark, contextText) : null
    const assFile = ass ? path.join(EXPORTS, `${clip.id}.captions.ass`) : null
    if (assFile) fs.writeFileSync(assFile, ass, 'utf8')

    const savedLogo = getState().project?.logo
    // No modo GTA, se a logo ainda está na posição padrão, vai para o topo à direita.
    const projectLogo = gta && savedLogo?.url && savedLogo.x === 0.5 && savedLogo.y === 0.88
      ? { ...savedLogo, x: 0.86, y: 0.08 }
      : savedLogo
    let logoFile = null
    if (projectLogo?.url) {
      try {
        const logoPathname = mediaPathFromUrl(projectLogo.url)
        const localLogo = logoPathname
          ? path.join(DATA, logoPathname)
          : (projectLogo.url.startsWith('/covers/') ? path.join(COVERS, path.basename(projectLogo.url)) : null)
        logoFile = await ensureLocalMedia(logoPathname, localLogo, path.basename(projectLogo.url || 'logo.png'))
      } catch (error) {
        console.warn('[render-logo]', error?.message || error)
        logoFile = null
      }
    }

    // Não compete com a gravação da live: no Render free, os dois juntos
    // estouram a memória e derrubam o processo no meio do render.
    await waitForLiveRecording()

    // Com -loglevel error o ffmpeg não reporta andamento: o job ficava preso
    // em 34% no front durante toda a codificação (vários minutos no free).
    // Este heartbeat só move o número; o passo real continua em 34% até terminar.
    let tickProgress = 34
    const progressTimer = setInterval(() => {
      tickProgress = Math.min(80, tickProgress + 4)
      updateJob(job, { progress: tickProgress })
    }, 15000)

    try {
      const assName = assFile ? path.basename(assFile).replace(/'/g, "\\'") : null
      const logoInputArgs = logoFile ? ['-loop', '1', '-t', String(duration), '-i', logoFile] : []
      const videoInputIdx = 0
      const logoInputIdx = 1

      let baseFc = filterComplex
      if (!baseFc) baseFc = `[${videoInputIdx}:v]${vf}[vout]`
      if (gta) {
        // Faixa escura na divisa (estilo máquina-cortes-gta), em três camadas
        // para dar a sensação de degradê sem custo de blur.
        const bandY = Math.max(0, Math.round(outH * 0.37))
        const bandH = Math.round(outH * 0.26)
        baseFc = baseFc.replace(/\[vout\]\s*$/, '')
        baseFc += `,drawbox=x=0:y=${bandY}:w=${outW}:h=${bandH}:color=black@0.20:t=fill`
        baseFc += `,drawbox=x=0:y=${bandY + Math.round(bandH * 0.25)}:w=${outW}:h=${Math.round(bandH * 0.5)}:color=black@0.18:t=fill[vout]`
      }

      let outLabel = 'vout'
      let fc = baseFc
      if (logoFile) {
        const lw = Math.max(24, Math.round(outW * Math.max(0.05, Math.min(0.8, Number(projectLogo.w) || 0.28))))
        const opacity = Math.max(0.1, Math.min(1, Number(projectLogo.opacity) || 1))
        const cx = Math.round(outW * Math.max(0, Math.min(1, Number(projectLogo.x) || 0.5)))
        const cy = Math.round(outH * Math.max(0, Math.min(1, Number(projectLogo.y) || 0.88)))
        const overlayX = `max(0,min(main_w-overlay_w,${cx}-overlay_w/2))`
        const overlayY = `max(0,min(main_h-overlay_h,${cy}-overlay_h/2))`
        fc = fc.replace(/\[vout\]\s*$/, '[vbase]')
        fc += `;[${logoInputIdx}:v]format=rgba,scale=${lw}:-1,colorchannelmixer=aa=${opacity}[logo]`
        fc += `;[vbase][logo]overlay=${overlayX}:${overlayY}[vlogo]`
        outLabel = 'vlogo'
      }
      if (assName) {
        fc = fc.replace(new RegExp(`\\[${outLabel}\\]\\s*$`), '[vpre]')
        fc += `;[vpre]subtitles='${assName}'[vout]`
        outLabel = 'vout'
      }

      const outArgs = ['-filter_complex', fc, '-map', `[${outLabel}]`, '-map', `${videoInputIdx}:a?`]
      const ffmpegArgs = (args, withLogo = Boolean(logoFile)) => [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...(LIGHT_RENDER ? ['-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1'] : []),
        '-ss', String(from), '-t', String(duration), '-i', src,
        ...(withLogo ? logoInputArgs : []),
        ...args,
        '-c:v', 'libx264',
        ...(LIGHT_RENDER ? ['-x264-params', 'threads=1:rc-lookahead=0'] : []),
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        ...(LIGHT_RENDER ? ['-r', '30'] : []),
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
        '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
        '-max_muxing_queue_size', '256',
        '-movflags', '+faststart', '-shortest',
        path.basename(out),
      ]
      const ffmpegTimeout = 1000 * 60 * (size.height >= 2000 ? 40 : size.height >= 1000 ? 25 : 15)
      try {
        await run(FFMPEG_BIN, ffmpegArgs(outArgs, Boolean(logoFile)), { cwd: EXPORTS, timeout: ffmpegTimeout })
      } catch (err) {
        if (!assName && !logoFile) throw err
        const msg = String(err?.stderr || err?.message || '').toLowerCase()
        const captionFilterIssue = assName && /subtitles|libass|ass filter|no such filter|invalid argument|error parsing|caption/.test(msg)
        if (captionFilterIssue) {
          console.error('[render-captions-fallback]', msg.slice(0, 240))
          let plainFc = baseFc
          let plainLabel = 'vout'
          if (logoFile) {
            const lw = Math.max(24, Math.round(outW * Math.max(0.05, Math.min(0.8, Number(projectLogo.w) || 0.28))))
            const opacity = Math.max(0.1, Math.min(1, Number(projectLogo.opacity) || 1))
            const cx = Math.round(outW * Math.max(0, Math.min(1, Number(projectLogo.x) || 0.5)))
            const cy = Math.round(outH * Math.max(0, Math.min(1, Number(projectLogo.y) || 0.88)))
            const overlayX = `max(0,min(main_w-overlay_w,${cx}-overlay_w/2))`
            const overlayY = `max(0,min(main_h-overlay_h,${cy}-overlay_h/2))`
            plainFc = plainFc.replace(/\[vout\]\s*$/, '[vbase]')
            plainFc += `;[${logoInputIdx}:v]format=rgba,scale=${lw}:-1,colorchannelmixer=aa=${opacity}[logo]`
            plainFc += `;[vbase][logo]overlay=${overlayX}:${overlayY}[vlogo]`
            plainLabel = 'vlogo'
          }
          const plainArgs = ['-filter_complex', plainFc, '-map', `[${plainLabel}]`, '-map', `${videoInputIdx}:a?`]
          await run(FFMPEG_BIN, ffmpegArgs(plainArgs, Boolean(logoFile)), { cwd: EXPORTS, timeout: ffmpegTimeout })
        } else if (logoFile) {
          console.error('[render-logo-fallback]', msg.slice(0, 240))
          // fallback: render without logo
          let noLogoFc = baseFc
          let noLogoLabel = 'vout'
          if (assName) {
            noLogoFc = noLogoFc.replace(/\[vout\]\s*$/, '[vpre]')
            noLogoFc += `;[vpre]subtitles='${assName}'[vout]`
            noLogoLabel = 'vout'
          }
          const noLogoArgs = ['-filter_complex', noLogoFc, '-map', `[${noLogoLabel}]`, '-map', `${videoInputIdx}:a?`]
          try {
            await run(FFMPEG_BIN, ffmpegArgs(noLogoArgs, false), { cwd: EXPORTS, timeout: ffmpegTimeout })
          } catch {
            // final fallback: no logo, no subs
            const plainArgs = ['-filter_complex', baseFc, '-map', '[vout]', '-map', `${videoInputIdx}:a?`]
            await run(FFMPEG_BIN, ffmpegArgs(plainArgs, false), { cwd: EXPORTS, timeout: ffmpegTimeout })
          }
        } else {
          throw err
        }
      }
    } finally {
      clearInterval(progressTimer)
      if (assFile) try { fs.unlinkSync(assFile) } catch {}
    }
    clip.renderedKey = await storeLocalFile(out, `media/exports/${clip.id}.mp4`, 'video/mp4')
    updateJob(job, { progress: 88, step: 'Gerando a capa do corte' })
    const renderCover = path.join(COVERS, `${clip.id}-render.jpg`)
    try {
      await run(FFMPEG_BIN, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', '1.2', '-i', out, '-frames:v', '1',
        '-vf', 'scale=432:-2', '-q:v', '3',
        renderCover,
      ], { timeout: 1000 * 60 })
      clip.cover = `/covers/${clip.id}-render.jpg`
      clip.coverKey = await storeLocalFile(renderCover, `covers/${clip.id}-render.jpg`, 'image/jpeg')
    } catch {}
    clip.renderedUrl = `/media/exports/${clip.id}.mp4`
    clip.stage = 'renderizado'
    clip.renderedAt = new Date().toISOString()
    clip.framingBias = frac
    addActivity('render', `Corte "${clip.hook}" renderizado em 9:16 · ${sizeLabel(size)}`)
    save()
    await flushStore()
    updateJob(job, { progress: 99, step: 'Corte finalizado' })
    finishJob(job)
    return clip
  } catch (err) {
    // O usuário vê só a mensagem curta; o motivo real fica no log do Render.
    console.error('[render-error]', clipId, String(err?.stderr || err?.message || err).slice(-1800))
    finishJob(job, new Error('Não foi possível renderizar este corte agora.'))
    throw new Error('Não foi possível renderizar este corte agora.')
  }
}

/**
 * Recorte manual dentro de um corte já existente. Para vídeos enviados apenas
 * ajustamos o intervalo absoluto na fonte; para clipes de live o arquivo gravado
 * já é o corte, então ele é fisicamente recortado com ffmpeg.
 * `start` e `end` são segundos relativos ao corte atual.
 */
export async function runTrim(clipId, startInput, endInput, opts = {}) {
  const clip = findClip(clipId)
  if (!clip) throw new Error('Corte não encontrado')
  const liveSrc = clip.media
    ? await ensureLocalMedia(clip.mediaKey || mediaPathFromUrl(clip.media), liveMediaFile(clip), `${clip.id}.mp4`)
    : null
  const source = findSource(clip.sourceId)
  const src = liveSrc || await ensureLocalMedia(source?.mediaKey, sourceVideo(clip.sourceId), `${clip.sourceId}.mp4`)
  if (!src) throw new Error('O vídeo deste corte não está mais disponível para recorte.')

  const total = Math.max(1, Number(clip.end) - Number(clip.start) || 0)
  const wantedStart = Number(startInput)
  const wantedEnd = Number(endInput)
  const start = Math.max(0, Math.min(total - 1, Number.isFinite(wantedStart) ? wantedStart : 0))
  const end = Math.min(total, Math.max(start + 1, Number.isFinite(wantedEnd) ? wantedEnd : total))
  const length = Math.round((end - start) * 10) / 10

  const job = createJob('render', { clipId, sourceId: clip.sourceId, ...(opts.jobId ? { id: opts.jobId } : {}) })
  try {
    updateJob(job, { progress: 12, step: 'Ajustando o trecho' })
    if (liveSrc) {
      const tmp = path.join(LIVE_DIR, `${clip.id}-cut-${Date.now()}.mp4`)
      await run(FFMPEG_BIN, [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...(LIGHT_RENDER ? ['-threads', '1', '-filter_threads', '1'] : []),
        '-ss', String(start), '-t', String(length), '-i', liveSrc,
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', '-avoid_negative_ts', 'make_zero',
        tmp,
      ], { timeout: 1000 * 60 * (LIGHT_RENDER ? 5 : 20) })
      let measured = length
      try { measured = (await probe(tmp)).duration || length } catch {}
      fs.copyFileSync(tmp, liveSrc)
      fs.rmSync(tmp, { force: true })
      clip.mediaKey = await storeLocalFile(liveSrc, clip.mediaKey || mediaPathFromUrl(clip.media), 'video/mp4') || clip.mediaKey || null
      clip.start = 0
      clip.end = Math.round(measured * 10) / 10
      try {
        const coverFile = path.join(COVERS, `${clip.id}.jpg`)
        await extractCover(liveSrc, Math.min(2, Math.max(0.3, measured / 3)), coverFile)
        clip.cover = `/covers/${clip.id}.jpg`
        clip.coverKey = await storeLocalFile(coverFile, `covers/${clip.id}.jpg`, 'image/jpeg')
      } catch {}
    } else {
      const nextStart = Math.round((Number(clip.start) + start) * 10) / 10
      clip.end = Math.round((Number(clip.start) + end) * 10) / 10
      clip.start = nextStart
    }
    if (Array.isArray(clip.captionLines) && clip.captionLines.length) {
      clip.captionLines = clip.captionLines
        .map((line) => ({ t: Math.round((Number(line?.t) - start) * 10) / 10, text: String(line?.text || '') }))
        .filter((line) => line.text && line.t < length && line.t > -6)
        .map((line) => ({ ...line, t: Math.max(0, line.t) }))
        .slice(0, 60)
    }
    clip.cut = { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 }
    clip.renderedUrl = undefined
    clip.renderedAt = undefined
    if (clip.stage === 'renderizado') clip.stage = 'rascunho'
    for (const file of [
      path.join(EXPORTS, `${clip.id}.mp4`),
      path.join(COVERS, `${clip.id}-render.jpg`),
    ]) { try { fs.unlinkSync(file) } catch {} }
    addActivity('agent', `Corte "${clip.hook}" reduzido para ${Math.round(length)}s`)
    save()
    await flushStore()
    updateJob(job, { progress: 45, step: 'Recorte aplicado' })
    finishJob(job)
    return clip
  } catch (err) {
    finishJob(job, new Error('Não foi possível recortar este corte agora.'))
    throw new Error('Não foi possível recortar este corte agora.')
  }
}

export function uniqueClips(list) {
  const picked = []
  for (const clip of list) {
    const duplicate = picked.some((kept) => {
      const overlap = Math.min(kept.end, clip.end) - Math.max(kept.start, clip.start)
      const shorter = Math.min(kept.end - kept.start, clip.end - clip.start)
      const sameScene = kept.sourceId === clip.sourceId
        || String(kept.hook || '').trim().toLowerCase() === String(clip.hook || '').trim().toLowerCase()
      return sameScene && shorter > 0 && overlap / shorter >= 0.7
    })
    if (!duplicate) picked.push(clip)
  }
  return picked
}

export async function runCompilation(compilationId, opts = {}) {
  const state = getState()
  const comp = (state.compilations || []).find((c) => c.id === compilationId)
  if (!comp) throw new Error('Compilação não encontrada')
  const clips = uniqueClips(comp.clipIds.map((id) => findClip(id)).filter(Boolean))
  if (!clips.length) throw new Error('Nenhum corte válido nesta compilação')
  if (comp.clipIds.length !== clips.length) comp.clipIds = clips.map((c) => c.id)
  const job = createJob('compile', { compilationId, ...(opts.jobId ? { id: opts.jobId } : {}) })
  const work = path.join(EXPORTS, `comp-${compilationId}`)
  try {
    comp.status = 'processando'
    comp.progress = 2
    comp.error = null
    save()
    updateJob(job, { progress: 3, step: 'Preparando a compilação' })
    fs.rmSync(work, { recursive: true, force: true })
    fs.mkdirSync(work, { recursive: true })

    updateJob(job, { progress: 5, step: 'Preparando os blocos' })
    const parts = []
    let total = 0

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      const liveFile = clip.media
        ? await ensureLocalMedia(clip.mediaKey || mediaPathFromUrl(clip.media), liveMediaFile(clip), `${clip.id}.mp4`)
        : null
      const source = findSource(clip.sourceId)
      const src = liveFile || await ensureLocalMedia(source?.mediaKey, sourceVideo(clip.sourceId), `${clip.sourceId}.mp4`)
      if (!src) continue
      const from = liveFile ? 0 : clip.start
      const dur = Math.max(2, Math.round((clip.end - clip.start) * 10) / 10)
      const seg = path.join(work, `${String(i + 1).padStart(2, '0')}-seg.mp4`)
      const step = Math.min(84, 6 + Math.round(((i + 1) / clips.length) * 76))
      updateJob(job, { progress: step, step: `Montando bloco ${i + 1} de ${clips.length}` })
      comp.progress = step
      save()
      const vf = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1'
      await run(FFMPEG_BIN, [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...(LIGHT_RENDER ? ['-threads', '1', '-filter_threads', '1'] : []),
        '-ss', String(from), '-t', String(dur), '-i', src,
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        path.basename(seg),
      ], { cwd: work, timeout: 1000 * 60 * (LIGHT_RENDER ? 5 : 10) })
      parts.push(seg)
      total += dur
    }

    if (parts.length < 2) throw new Error('Nenhum corte válido nesta compilação')
    updateJob(job, { progress: 90, step: 'Unindo os blocos do vídeo' })
    comp.progress = 92
    save()

    const out = path.join(EXPORTS, `${compilationId}.mp4`)
    let joinArgs
    if (LIGHT_RENDER) {
      // xfade mantém todos os blocos decodificados ao mesmo tempo; com muitos
      // cortes isso estoura a RAM do Render free. Concat por stream copy é leve.
      const listFile = path.join(work, 'parts.txt')
      fs.writeFileSync(listFile, parts.map((p) => `file '${path.basename(p)}'`).join('\n'))
      joinArgs = ['-f', 'concat', '-safe', '0', '-i', path.basename(listFile), '-c', 'copy', '-avoid_negative_ts', 'make_zero']
    } else {
      const TD = 0.45
      const durs = []
      for (const p of parts) {
        try {
          durs.push(Math.max(TD + 0.2, (await probe(p)).duration || 0))
        } catch {
          durs.push(3.5)
        }
      }
      const inputs = parts.flatMap((p) => ['-i', p])
      const graph = []
      let vIn = '[0:v]'
      let aIn = '[0:a]'
      let offset = 0
      for (let i = 1; i < parts.length; i++) {
        offset += durs[i - 1] - TD
        const vOut = `[v${i}]`
        const aOut = `[a${i}]`
        graph.push(`${vIn}[${i}:v]xfade=transition=hblur:duration=${TD}:offset=${offset.toFixed(3)}${vOut}`)
        graph.push(`${aIn}[${i}:a]acrossfade=d=${TD}:c1=tri:c2=tri${aOut}`)
        vIn = vOut
        aIn = aOut
      }
      joinArgs = [
        ...inputs,
        '-filter_complex', graph.join(';'),
        '-map', vIn, '-map', aIn,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      ]
    }
    await run(FFMPEG_BIN, [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...(LIGHT_RENDER ? ['-threads', '1'] : []),
      ...joinArgs,
      '-movflags', '+faststart',
      out,
    ], { cwd: work, timeout: 1000 * 60 * (LIGHT_RENDER ? 10 : 20) })
    if (!fs.existsSync(out)) throw new Error('Arquivo final não gerado')
    comp.mediaKey = await storeLocalFile(out, `media/exports/${compilationId}.mp4`, 'video/mp4')

    let finalDur = total
    try {
      finalDur = (await probe(out)).duration || total
    } catch {}

    const coverFile = path.join(COVERS, `${compilationId}.jpg`)
    try {
      await extractCover(out, Math.min(5, Math.max(1, total / 3)), coverFile, 640)
      comp.cover = `/covers/${compilationId}.jpg`
      comp.coverKey = await storeLocalFile(coverFile, `covers/${compilationId}.jpg`, 'image/jpeg')
    } catch {}
    comp.url = `/media/exports/${compilationId}.mp4`
    comp.duration = Math.round(finalDur)
    comp.status = 'pronto'
    comp.progress = 100
    comp.finishedAt = new Date().toISOString()
    addActivity('render', `Vídeo longo "${comp.title}" pronto com ${clips.length} cortes`)
    save()
    await flushStore()
    updateJob(job, { progress: 99, step: 'Vídeo longo finalizado' })
    finishJob(job)
    fs.rmSync(work, { recursive: true, force: true })
    return comp
  } catch (err) {
    const detail = String(err?.stderr || err?.stack || err?.message || err).slice(-1200)
    console.error('[compilation-error]', compilationId, detail)
    updateJob(job, { debug: detail })
    comp.status = 'erro'
    comp.error = 'Não foi possível montar este vídeo longo agora.'
    comp.progress = 0
    save()
    finishJob(job, new Error('Não foi possível montar este vídeo longo agora.'))
    fs.rmSync(work, { recursive: true, force: true })
    throw new Error('Não foi possível montar este vídeo longo agora.')
  }
}

const LIVE_DIR = path.join(MEDIA, 'live')
fs.mkdirSync(LIVE_DIR, { recursive: true })

const LIVE_WINDOW = Math.max(20, Number(process.env.FUGA_LIVE_WINDOW) || 20)
const LIVE_MAX_CLIPS = 60
const liveStops = new Map()
// Resolver o stream é caro (yt-dlp + vários espelhos) e as URLs são assinadas.
// Guardamos o resultado por alguns minutos para não repetir a busca a cada janela.
const LIVE_STREAM_CACHE = new Map()
const LIVE_STREAM_TTL = Math.max(60, Number(process.env.LIVE_STREAM_TTL_MS) || 5 * 60 * 1000)
const LIVE_STREAM_RETRY_MS = Math.max(10, Number(process.env.LIVE_STREAM_RETRY_MS) || 60 * 1000)

// Captura no navegador: o IP do Render é bloqueado pelo YouTube e pelos espelhos
// públicos. O frontend resolve o HLS no IP do usuário e envia janelas já em .ts.
const browserLiveWindows = new Map()
const BROWSER_WINDOW_TIMEOUT = Math.max(180, LIVE_WINDOW * 4) * 1000

const LIVE_CAPTURE_FALLBACKS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
]

export function liveCaptureConfig() {
  return {
    mirror: INVIDIOUS_URL,
    mirrors: [...new Set([INVIDIOUS_URL, ...INVIDIOUS_URLS.slice(1), ...LIVE_CAPTURE_FALLBACKS])].filter(Boolean),
    relay: '/api/live/relay',
    windowSeconds: LIVE_WINDOW,
    maxSegments: Math.ceil(LIVE_WINDOW / 5),
  }
}

const LIVE_TEXT = {
  offline: 'Essa fonte não está ao vivo agora. Cole o link de uma transmissão em andamento…',
  gone: 'A transmissão saiu do ar. O monitoramento foi encerrado…',
  noStream: 'Não foi possível acessar a transmissão. Verifique se é pública e sem restrição de idade/região…',
  recordFail: 'Falha ao acompanhar a transmissão. Ela pode ter proteção ou instabilidade…',
  streamBlocked: 'A live está no ar, mas o servidor não conseguiu acessar o stream. Configure um resolvedor de mídia no Render…',
  browserClosed: 'A captura no navegador foi interrompida. Deixe a aba do estúdio aberta para continuar…',
  failed: 'Não foi possível acompanhar esta transmissão agora. Tente de novo…',
}

export function liveMediaFile(clip) {
  if (!clip?.media) return null
  const abs = path.join(MEDIA, String(clip.media).replace(/^\/media\//, ''))
  return fs.existsSync(abs) ? abs : null
}

export function isLiveRunning(sourceId) {
  const source = findSource(sourceId)
  return Boolean(source?.mode === 'live' && !source.liveEndedAt && ['processando', 'ao-vivo'].includes(source.status))
}

export function stopLive(sourceId) {
  const source = findSource(sourceId)
  if (!source || !isLiveRunning(sourceId)) return false
  source.liveStopRequested = true
  // Atualiza já para a UI refletir no próximo refresh; o workflow termina em seguida.
  source.status = 'pronto'
  source.progress = 100
  source.liveEndedAt = new Date().toISOString()
  const stop = liveStops.get(sourceId)
  if (stop) {
    stop.flag = true
    if (stop.child) { try { stop.child.kill() } catch {} }
  }
  save()
  return true
}

function liveStamp(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

async function mediaDuration(file) {
  try {
    const { stdout } = await run(FFPROBE_BIN, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file,
    ], { timeout: 1000 * 60 })
    const d = Number(JSON.parse(stdout).format?.duration) || 0
    if (d > 0) return d
  } catch {}
  try { return (await probe(file)).duration || 0 } catch { return 0 }
}

/** Nível de áudio da janela, sem decodizar vídeo: usado pelo medidor da live. */
async function liveAudioLevel(file) {
  let log = ''
  try {
    await run(FFMPEG_BIN, [
      '-hide_banner', '-nostats', '-i', file, '-vn',
      '-af', 'volumedetect', '-f', 'null', '-',
    ], {
      timeout: 1000 * 60,
      onStderr: (chunk) => { if (log.length < 20000) log += chunk },
    })
  } catch (error) {
    log = String(error?.stderr || log)
  }
  const mean = Number(log.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1])
  const peak = Number(log.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1])
  if (!Number.isFinite(mean)) return null
  return {
    mean: Math.round(mean * 10) / 10,
    peak: Number.isFinite(peak) ? Math.round(peak * 10) / 10 : null,
    silent: mean <= -45,
  }
}

function liveFromMirror(inv) {
  return {
    title: inv.title || 'Transmissão ao vivo',
    channel: inv.channel || inv.uploader || '',
    thumb: inv.thumbnail || null,
    liveId: inv.id || '',
    liveChannel: inv.channel || inv.uploader || '',
    sourceUrl: inv.id ? watchUrl(inv.id) : '',
  }
}

async function liveFromMirrors(id) {
  if (!hasInvidious() || !id) return null
  try {
    const inv = await invidiousInfo(watchUrl(id))
    return inv.is_live ? liveFromMirror(inv) : null
  } catch (err) {
    console.error('[live:invidious]', String(err?.message || err).slice(0, 300))
    return null
  }
}

async function probeLive(url) {
  if (process.env.FUGA_LIVE_STREAM) {
    return { title: 'Transmissão monitorada', channel: '' }
  }
  try {
    const { stdout } = await ytdlpLive([
      '-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20', url,
    ], 1000 * 120)
    const info = JSON.parse(stdout)
    const id = info.id ? String(info.id) : ''
    if (info.is_live) {
      const isYouTube = /youtube\.com|youtu\.be/i.test(url)
      return {
        title: String(info.title || 'Transmissão ao vivo').slice(0, 140),
        channel: String(info.uploader || info.channel || '').slice(0, 90),
        thumb: bestThumb(info.thumbnails),
        liveId: id,
        liveChannel: String(info.uploader_id || '').slice(0, 90),
        sourceUrl: isYouTube ? (id ? watchUrl(id) : '') : (info.webpage_url || info.original_url || url),
      }
    }
    // Em URL de canal, o yt-dlp pode devolver só o id do vídeo ao vivo.
    const viaMirror = await liveFromMirrors(id)
    if (viaMirror) return viaMirror
    const api = id ? await ytApiMeta(id) : null
    if (api?.is_live) return { ...api, sourceUrl: watchUrl(id) }
    if (isChannelUrl(url)) {
      const live = await youtubeLiveMeta(url)
      if (live) return live
    }
    if (!hasInvidious()) return null
  } catch (err) {
    if (!hasInvidious()) {
      if (isChannelUrl(url)) {
        const live = await youtubeLiveMeta(url)
        if (live) return live
      }
      throw err
    }
    console.error('[live:yt-dlp]', String(err?.message || err).slice(0, 300))
  }
  const inv = await invidiousInfo(url)
  return inv.is_live ? liveFromMirror(inv) : null
}

function liveStreamCacheKey(url) {
  const id = youtubeVideoId(url) || String(url || '')
  return id
}

function rememberLiveStream(url, parts) {
  if (LIVE_STREAM_CACHE.size > 40) {
    const oldest = LIVE_STREAM_CACHE.keys().next().value
    if (oldest) LIVE_STREAM_CACHE.delete(oldest)
  }
  LIVE_STREAM_CACHE.set(liveStreamCacheKey(url), { parts, expiresAt: Date.now() + LIVE_STREAM_TTL })
}

async function liveStreamParts(url) {
  const key = liveStreamCacheKey(url)
  const cached = LIVE_STREAM_CACHE.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.parts.length) return cached.parts
    throw new Error(cached.error || 'stream indisponível')
  }
  try {
    const parts = await resolveLiveStreamParts(url)
    if (parts.length) rememberLiveStream(url, parts)
    return parts
  } catch (err) {
    // Falha recente: evita martelar todos os espelhos a cada janela de 30s.
    LIVE_STREAM_CACHE.set(key, {
      parts: [],
      expiresAt: Date.now() + LIVE_STREAM_RETRY_MS,
      error: liveErrorText(err, 300),
    })
    throw err
  }
}

async function resolveLiveStreamParts(url) {
  if (process.env.FUGA_LIVE_STREAM) return [process.env.FUGA_LIVE_STREAM]
  const failures = []
  try {
    const { stdout } = await ytdlpLive([
      '-g', '-f', downloadFormat(sourceMaxHeight()).replace(/\[ext=mp4\]/g, ''),
      '--no-warnings', '--no-playlist', '--socket-timeout', '20', url,
    ], 1000 * 90)
    const parts = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts
    failures.push(`yt-dlp: vazio`)
  } catch (err) {
    failures.push(`yt-dlp: ${liveErrorText(err, 160)}`)
    if (!hasInvidious() && !hasCobalt()) throw err
    console.error('[live:yt-dlp-stream]', String(err?.message || err).slice(0, 300))
  }
  if (hasCobalt()) {
    try {
      const resolved = await cobaltResolve(url, { quality: '720' })
      if (resolved.kind === 'hls' || resolved.kind === 'single') return [resolved.url]
      failures.push(`cobalt: formato ${resolved.kind}`)
      console.error('[live:cobalt] formato não reproduzível em live:', resolved.kind)
    } catch (err) {
      failures.push(`cobalt: ${liveErrorText(err, 160)}`)
      console.error('[live:cobalt]', String(err?.message || err).slice(0, 300))
    }
  }
  if (!hasInvidious()) throw new Error(failures.join(' | ') || 'nenhum resolvedor configurado')
  let mirrorUrl = url
  if (isChannelUrl(url)) {
    const live = await youtubeLiveMeta(url)
    if (live?.sourceUrl) mirrorUrl = live.sourceUrl
  }
  let inv
  try {
    inv = await invidiousInfo(mirrorUrl)
  } catch (err) {
    failures.push(`espelhos: ${liveErrorText(err, 220)}`)
    throw new Error(failures.join(' | '))
  }
  if (inv.hls) {
    console.log('[live:invidious] usando HLS do espelho público')
    return [inv.hls]
  }
  const parts = [inv.video, inv.audio].filter(Boolean)
  if (!parts.length) throw new Error(`${failures.join(' | ')} | espelhos: sem mídia`)
  return parts
}

export async function getLiveHlsUrl(url) {
  const parts = await liveStreamParts(url)
  const hls = parts.find((p) => p.includes('.m3u8') || p.includes('manifest') || p.includes('googlevideo.com'))
  return hls || parts[0] || null
}

function recordWindow(parts, file, seconds, stop) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    // -t antes de -i limita a leitura do stream infinito do relay; como opção
    // de saída, o ffmpeg pode nunca encerrar quando a entrada não tem fim.
    for (const part of parts) args.push('-t', String(seconds), '-i', part)
    if (parts.length > 1) args.push('-map', '0:v:0', '-map', '1:a:0?')
    args.push('-c', 'copy', '-f', 'mpegts', file)
    let child
    try {
      child = spawn(FFMPEG_BIN, args, { windowsHide: true })
    } catch (error) {
      resolve({ ok: false, reason: liveErrorText(error) })
      return
    }
    stop.child = child
    let settled = false
    let timer = null
    let stderr = ''
    let exitCode = null
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000)
    })
    const done = (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (stop.child === child) stop.child = null
      let ok = false
      try { ok = fs.existsSync(file) && fs.statSync(file).size > 1024 * 20 } catch {}
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ')
      const reason = ok
        ? ''
        : liveErrorText(error?.message || tail || (exitCode === null ? '' : `ffmpeg exit ${exitCode}`))
      resolve({ ok, reason })
    }
    timer = setTimeout(() => {
      console.error('[live:record] timeout; encerrando captura')
      try { child.kill('SIGKILL') } catch {}
      setTimeout(() => {
        console.error('[live:record] liberando janela após kill')
        done()
      }, 3000).unref?.()
    }, (seconds + 45) * 1000)
    child.on('error', done)
    child.on('close', (code) => {
      exitCode = code
      done()
    })
  })
}

async function loudSpan(file, min, max) {
  const duration = await mediaDuration(file)
  if (!duration || duration < 6) return null
  let starts = []
  let ends = []
  try {
    const { stderr } = await run(FFMPEG_BIN, [
      '-hide_banner', '-i', file, '-af', 'silencedetect=noise=-30dB:d=1.1', '-f', 'null', '-',
    ], { timeout: 1000 * 180 })
    starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  } catch {}
  const silences = starts.map((s, i) => [s, ends[i] ?? duration])
  const active = []
  let cursor = 0
  for (const [s, e] of silences) {
    if (s - cursor > 3) active.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (duration - cursor > 3) active.push([cursor, duration])
  active.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
  const [s, e] = active[0] || [0, duration]
  const span = e - s
  if (span < 7) return null
  const minLen = Math.min(min, 12)
  const len = Math.min(max, Math.max(minLen, span))
  const start = Math.max(0, Math.min(duration - len, s + Math.min(2.5, Math.max(0, (span - len) / 2))))
  const end = Math.min(duration, start + len)
  if (end - start < 6) return null
  return { start, end }
}

function liveClipType(cfg, index) {
  const types = Object.keys(cfg.typeWords).filter((t) => cfg.hooks[t])
  if (!types.includes('momento')) types.push('momento')
  return types[index % types.length]
}

async function makeLiveClip(source, windowFile, span, session, index, captions = []) {
  const state = getState()
  const settings = state.settings || {}
  const cfg = nicheConfig(state)
  const clipId = `${source.id}-${index}`
  const outFile = path.join(LIVE_DIR, `${clipId}.mp4`)
  // Stream copy é quase instantâneo. Re-encode com libx264 estoura o timeout
  // no Render free (pouca CPU), então só é usado como fallback.
  const cutArgs = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', span.start.toFixed(2), '-i', windowFile, '-t', (span.end - span.start).toFixed(2),
  ]
  try {
    await run(FFMPEG_BIN, [...cutArgs, '-threads', '1', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', outFile], { timeout: 1000 * 60 })
  } catch {}
  let size = 0
  try { size = fs.statSync(outFile).size } catch {}
  if (size < 1024 * 20) {
    try {
      await run(FFMPEG_BIN, [
        ...cutArgs,
        '-threads', '1',
        '-vf', "scale='min(1280,iw)':-2,setsar=1,fps=30",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-movflags', '+faststart',
        outFile,
      ], { timeout: 1000 * 150 })
    } catch {}
    try { size = fs.statSync(outFile).size } catch {}
  }
  if (size < 1024 * 20) throw new Error('live clip vazio')
  const mediaKey = await storeLocalFile(outFile, `media/live/${clipId}.mp4`, 'video/mp4')
  const coverAbs = path.join(COVERS, `${clipId}.jpg`)
  try {
    await extractCover(outFile, Math.min(1.5, (span.end - span.start) / 3), coverAbs)
  } catch {}
  let coverKey = null
  if (fs.existsSync(coverAbs)) {
    try { coverKey = await storeLocalFile(coverAbs, `covers/${clipId}.jpg`, 'image/jpeg') } catch {}
  }
  // O ajuste manual feito enquanto a live roda tem precedência. Na live, evita
  // detecção pesada por clip para reduzir risco de crash no Render free.
  let camBox = source.cam ? { ...source.cam } : { ...DEFAULT_CAM }

  const at = Math.round((session + span.start) * 10) / 10
  // Cues chegam em tempo relativo à janela; recorta os que caem no span e
  // reancora no início do corte, igual ao captionLines dos vídeos.
  const clipCues = captions
    .filter((cue) => Number(cue?.t) <= span.end && Number(cue?.t) + 6 >= span.start)
    .map((cue) => ({ t: Math.round((Number(cue.t) - span.start) * 10) / 10, text: String(cue.text || '') }))
    .filter((cue) => cue.text && cue.t > -6)
  const speech = clipCues.map((cue) => cue.text).join(' ')
  const spokenType = clipCues.length ? classify(speech, cfg) : 'momento'
  const type = spokenType !== 'momento' ? spokenType : liveClipType(cfg, index)
  const description = clipCues.length
    ? speech.replace(/\s+/g, ' ').trim().slice(0, 220)
    : `Cortado ao vivo · ${liveStamp(session + span.start)} da transmissão`
  const clip = {
    id: clipId,
    sourceId: source.id,
    niche: settings.niche === 'games' ? 'games' : 'fuga',
    hook: pickHook(type, clipCues, `${source.id}-${index}`, cfg),
    type,
    start: at,
    end: Math.round((session + span.end) * 10) / 10,
    score: Math.min(92, 72 + (index % 5) * 4),
    stage: 'rascunho',
    framing: 'cam',
    framingBias: 0.5,
    cam: camBox,
    cover: fs.existsSync(coverAbs) ? `/covers/${clipId}.jpg` : '',
    hashtags: cfg.hashtags[type] || cfg.hashtags.momento || [],
    captionLines: clipCues
      .filter((cue) => cue.t >= -1)
      .map((cue) => ({ t: Math.max(0, cue.t), text: cue.text.slice(0, 220) }))
      .slice(0, 60),
    description,
    media: `/media/live/${clipId}.mp4`,
    mediaKey,
    coverKey,
    live: { at, stamp: liveStamp(session + span.start) },
    createdAt: new Date().toISOString(),
  }
  state.clips.push(clip)
  save()
  return clip
}

function finishLiveStep(source, job, error = null) {
  source.status = error ? 'erro' : 'pronto'
  source.progress = error ? 0 : 100
  source.error = error
  source.liveEndedAt = new Date().toISOString()
  source.liveStopRequested = true
  save()
  if (error) finishJob(job, new Error(error))
  else {
    finishJob(job)
    addActivity('agent', `Monitoramento encerrado · ${Number(source.liveMade) || 0} cortes de "${source.title}"`)
  }
  return { continue: false, status: source.status }
}

/** Recebe vídeo e áudio .ts capturados no navegador e monta uma janela muxada. */
export async function queueBrowserLiveWindow(sourceId, video, audio, captions = []) {
  if (!Buffer.isBuffer(video) || !Buffer.isBuffer(audio)) throw new Error('janela inválida')
  if (video.length < 1024 || audio.length < 1024) throw new Error('janela vazia')
  const stamp = `${sourceId}-${Date.now()}`
  const vFile = path.join(LIVE_DIR, `browser-${stamp}-v.ts`)
  const aFile = path.join(LIVE_DIR, `browser-${stamp}-a.ts`)
  const out = path.join(LIVE_DIR, `browser-${stamp}.ts`)
  try {
    fs.writeFileSync(vFile, video)
    fs.writeFileSync(aFile, audio)
    await run(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', vFile, '-i', aFile,
      '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-f', 'mpegts', out,
    ], { timeout: 1000 * 90 })
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0
    if (size < 1024 * 20) throw new Error('janela muxada vazia')
    const previous = browserLiveWindows.get(sourceId)
    if (previous) { try { fs.rmSync(previous.file, { force: true }) } catch {} }
    browserLiveWindows.set(sourceId, { file: out, at: Date.now(), captions: Array.isArray(captions) ? captions : [] })
    return { bytes: size }
  } finally {
    fs.rmSync(vFile, { force: true })
    fs.rmSync(aFile, { force: true })
  }
}

export function takeBrowserLiveWindow(sourceId) {
  const entry = browserLiveWindows.get(sourceId)
  if (!entry) return null
  browserLiveWindows.delete(sourceId)
  if (!fs.existsSync(entry.file)) return null
  if (Date.now() - entry.at > BROWSER_WINDOW_TIMEOUT) {
    try { fs.rmSync(entry.file, { force: true }) } catch {}
    return null
  }
  return { file: entry.file, captions: entry.captions || [] }
}

/** Processa uma janela já gravada (servidor ou navegador) e atualiza a fonte. */
/**
 * A captura da live costuma começar com o mesmo quadro repetido por ~1-2s
 * (o relay still não tem mídia nova). Isso virava "vídeo travado com áudio
 * andando" no início de todo corte. Medimos esse pre-roll em baixa resolução
 * e descartamos antes de recortar o clipe.
 */
async function liveLeadingFreeze(file) {
  try {
    const w = 160
    const h = 90
    const { stdout } = await run(FFMPEG_BIN, [
      '-v', 'error', '-t', '5', '-i', file,
      '-vf', `scale=${w}:${h},fps=10,setsar=1`,
      '-pix_fmt', 'gray', '-f', 'rawvideo', '-',
    ], { timeout: 1000 * 30, encoding: 'buffer' })
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '')
    const frameSize = w * h
    const frames = Math.floor(buf.length / frameSize)
    if (frames < 4) return 0
    const first = buf.subarray(0, frameSize)
    for (let i = 1; i < frames; i += 1) {
      if (!buf.subarray(i * frameSize, (i + 1) * frameSize).equals(first)) {
        return Math.max(0, (i - 1) / 10)
      }
    }
    return 0
  } catch {
    return 0
  }
}

async function processLiveWindowFile(sourceId, win, job) {
  // Navegador entrega { file, captions }; captura no servidor entrega o caminho.
  const winFile = typeof win === 'string' ? win : win?.file
  const captions = win && typeof win === 'object' && Array.isArray(win.captions) ? win.captions : []
  let source = findSource(sourceId)
  if (!source || !winFile) {
    if (winFile) { try { fs.rmSync(winFile, { force: true }) } catch {} }
    return { continue: false, status: 'removed' }
  }
  try {
  const session = Math.max(0, Number(source.liveSession) || 0)
  const made = Number(source.liveMade) || 0
  const duration = await mediaDuration(winFile)
  if (!duration || duration < 6) {
    source.liveLastError = `record: janela curta ou vazia (${Math.round(duration)}s)`
    try { fs.rmSync(winFile, { force: true }) } catch {}
    source.liveMisses = (Number(source.liveMisses) || 0) + 1
    save()
    return { continue: true }
  }

  source.liveMisses = 0
  source.liveLastError = null
  // Medidor de áudio da live: sem isso o equalizador "ouvindo" nunca aparece.
  const level = await liveAudioLevel(winFile)
  if (level) {
    source.liveAudioLevel = level.mean
    source.liveAudioPeak = level.peak
    source.liveAudioSilent = level.silent
    source.liveAudioAt = new Date().toISOString()
  }
  source.liveCaptions = captions.length
  if (captions.length) {
    source.liveCaptionLines = captions.slice(-12).map((cue) => ({
      t: Math.round((session + (Number(cue.t) || 0)) * 10) / 10,
      text: String(cue.text || '').slice(0, 220),
    }))
  }
  const settings = getState().settings || {}
  const min = Number(settings.clipMin) || 18
  const max = Number(settings.clipMax) || 38
  // Descarta o quadro parado do começo da gravação para o corte não abrir
  // com imagem congelada enquanto o áudio já está andando.
  const lead = await liveLeadingFreeze(winFile)
  const usable = Math.max(0, duration - lead)
  const maxSpan = Math.max(6, Math.min(max, usable - 0.5))
  const minSpan = Math.max(6, Math.min(min, maxSpan))
  const spanLen = Math.min(maxSpan, Math.max(minSpan, Math.min(20, usable - 0.5)))
  const spanStart = Math.max(0, Math.min(duration - spanLen, Math.max(lead + 0.1, 0.5)))
  const span = duration >= 6 ? { start: spanStart, end: Math.min(duration, spanStart + spanLen) } : null
  const lastEnd = Number(source.liveLastEnd) || -999
  if (span && session + span.start >= lastEnd + 6) {
    try {
      const clip = await makeLiveClip(
        source, winFile, span, session, (Number(source.livePriorClips) || 0) + made + 1, captions,
      )
      source.liveMade = made + 1
      source.liveLastEnd = clip.end
      const currentClips = Array.isArray(getState().clips) ? getState().clips : []
      source.clips = currentClips.filter((item) => item.sourceId === sourceId).length
      source.lastClipAt = new Date().toISOString()
      addActivity('agent', `Novo corte da live: "${clip.hook}"`)
      updateJob(job, {
        step: `Ao vivo · ${liveStamp(session + duration)} · ${source.liveMade} cortes no acervo${level ? ` · áudio ${level.mean} dB` : ''}`,
      })
    } catch (error) {
      const detail = liveErrorText(error, 200)
      console.error('[live] makeLiveClip error:', detail)
      source = findSource(sourceId)
      if (source) {
        source.liveLastError = `clip: ${detail}`
        save()
      }
    }
  }

  source = findSource(sourceId)
  if (!source) {
    try { fs.rmSync(winFile, { force: true }) } catch {}
    return { continue: false, status: 'removed' }
  }
  source.liveSession = session + duration
  source.duration = Math.round(source.liveSession)
  source.progress = 100
  source.liveCheckedAt = new Date().toISOString()
  if (!source.thumb) {
    const thumbAbs = path.join(COVERS, `src-${sourceId}.jpg`)
    try {
      await extractWide(winFile, Math.min(5, duration / 3), thumbAbs)
      source.thumb = `/covers/src-${sourceId}.jpg`
      source.thumbKey = await storeLocalFile(thumbAbs, `covers/src-${sourceId}.jpg`, 'image/jpeg')
    } catch {}
  }
  save()
  try { fs.rmSync(winFile, { force: true }) } catch {}
  if ((Number(source.liveMade) || 0) >= LIVE_MAX_CLIPS) return finishLiveStep(source, job)
  return { continue: true }
  } catch (e) {
    console.error('[live window process]', e?.message || e)
    try { fs.rmSync(winFile, { force: true }) } catch {}
    const src = findSource(sourceId)
    if (src) {
      src.liveLastError = `record: ${liveErrorText(e, 160)}`
      src.liveMisses = (Number(src.liveMisses) || 0) + 1
      save()
    }
    return { continue: true }
  }
}

export async function captureLiveWindow(sourceId) {
  let source = findSource(sourceId)
  if (!source) return { continue: false, status: 'removed' }

  let job = source.liveJobId ? getJob(source.liveJobId) : null
  if (!job) {
    job = createJob('live', { sourceId })
    source.liveJobId = job.id
    save()
  }

  if (source.liveStopRequested) return finishLiveStep(source, job)
  if (!source.url) return finishLiveStep(source, job, LIVE_TEXT.failed)
  if (heavyWorkActive()) {
    if (job.step !== 'Ao vivo · pausado durante o processamento') {
      updateJob(job, { progress: 50, step: 'Ao vivo · pausado durante o processamento' })
    }
    return { continue: true }
  }

  try {
    if (!source.liveReady) {
      const url = source.url
      updateJob(job, { progress: 6, step: 'Procurando a transmissão' })
      let meta = null
      let apiAnswered = false
      let metaSource = ''
      if (YT_API_KEY && /(?:youtube\.com|youtu\.be)/i.test(url)) {
        const liveId = source.liveId || videoIdFromUrl(url)
        const apiMeta = liveId ? await ytApiMeta(liveId) : null
        if (apiMeta) {
          apiAnswered = true
          metaSource = 'youtube-data-api'
          meta = apiMeta.is_live ? { ...apiMeta, sourceUrl: watchUrl(liveId) } : null
          if (!meta && isChannelUrl(url)) {
            meta = await youtubeLiveMeta(url)
            metaSource = 'youtube-data-api-search'
          }
        } else if (isChannelUrl(url)) {
          meta = await youtubeLiveMeta(url)
          metaSource = meta ? 'youtube-data-api-search' : ''
          apiAnswered = Boolean(meta)
        }
      }
      if (!meta && !apiAnswered) {
        meta = await probeLive(url)
        metaSource = meta ? 'probe' : ''
      }
      source = findSource(sourceId)
      if (!source) return { continue: false, status: 'removed' }
      if (!meta) return finishLiveStep(source, job, LIVE_TEXT.offline)

      const priorDuration = Math.max(0, Number(source.duration) || 0)
      const currentClips = Array.isArray(getState().clips) ? getState().clips : []
      const priorClips = currentClips.filter((clip) => clip.sourceId === sourceId).length
      source.url = meta.sourceUrl || (meta.liveId && /youtube\.com|youtu\.be/i.test(url) ? watchUrl(meta.liveId) : url)
      source.title = meta.title || source.title
      source.channel = meta.channel || source.channel
      if (meta.thumb) source.thumb = meta.thumb
      if (meta.liveId) source.liveId = meta.liveId
      if (meta.liveChannel) source.liveChannel = meta.liveChannel
      source.status = 'ao-vivo'
      source.progress = 100
      source.error = null
      source.duration = Math.round(priorDuration)
      source.clips = priorClips
      source.liveStartedAt ||= new Date().toISOString()
      source.liveCheckedAt = source.liveStartedAt
      source.liveSession = priorDuration
      source.livePriorClips = priorClips
      source.liveMade = 0
      source.liveMisses = 0
      source.liveLastEnd = priorDuration > 0 ? priorDuration : -999
      source.liveReady = true
      source.liveMetadataSource = metaSource || 'probe'
      save()
      updateJob(job, { progress: 20, step: 'Ao vivo · acompanhando a transmissão' })
      addActivity('agent', `Monitorando a live "${source.title}"`)
      return { continue: true }
    }

    if ((Number(source.liveMade) || 0) >= LIVE_MAX_CLIPS) return finishLiveStep(source, job)

    if (source.captureMode === 'browser') {
      const win = takeBrowserLiveWindow(sourceId)
      if (win) return processLiveWindowFile(sourceId, win, job)
      const last = Number(source.liveCaptureLastAt) || 0
      const started = new Date(source.liveStartedAt || source.addedAt || Date.now()).getTime()
      const browserStale = last
        ? Date.now() - last > BROWSER_WINDOW_TIMEOUT
        : Date.now() - started > Math.max(90, LIVE_WINDOW + 30) * 1000
      if (browserStale && !source.liveLastError) {
        source.liveLastError = last
          ? 'Aguardando captura do navegador. Mantenha a aba do Kakashi aberta.'
          : 'Aguardando captura do navegador. Abra a aba do Kakashi e mantenha-a em primeiro plano.'
      }
      updateJob(job, { progress: 50, step: 'Monitorando a transmissão' })
      source.liveCheckedAt = new Date().toISOString()
      save()
      return { continue: true }
    }

    const apiConfirmed = () => Boolean(
      liveCapabilities().youtubeDataApi
      && (source?.platform === 'youtube' || /youtube/i.test(source?.url || ''))
    )
    let streamError = ''
    const parts = await liveStreamParts(source.url).catch((error) => {
      streamError = liveErrorText(error)
      console.error('[live] liveStreamParts error:', streamError)
      return []
    })
    if (!parts.length) {
      source.liveMisses = (Number(source.liveMisses) || 0) + 1
      source.liveLastError = `stream: ${streamError || 'nenhuma URL de mídia retornada'}`
      if (source.liveMisses >= 3) {
        return finishLiveStep(source, job, apiConfirmed() ? LIVE_TEXT.streamBlocked : LIVE_TEXT.noStream)
      }
      updateJob(job, { step: 'Reconectando na transmissão' })
      save()
      return { continue: true }
    }

    const session = Math.max(0, Number(source.liveSession) || 0)
    const made = Number(source.liveMade) || 0
    const win = path.join(LIVE_DIR, `win-${sourceId}-${Date.now()}.ts`)
    const stop = { flag: false, child: null }
    liveStops.set(sourceId, stop)
    updateJob(job, { progress: 50, step: `Ao vivo · ${liveStamp(session)} acompanhados · ${made} cortes` })
    let rec
    beginLiveRecording()
    try {
      rec = await recordWindow(parts, win, LIVE_WINDOW, stop)
    } finally {
      endLiveRecording()
      if (stop.child) { try { stop.child.kill() } catch {} }
      liveStops.delete(sourceId)
    }
    if (source.liveStopRequested || stop.flag) {
      try { fs.rmSync(win, { force: true }) } catch {}
      return finishLiveStep(source, job)
    }

    return processLiveWindowFile(sourceId, win, job)
  } catch (error) {
    source = findSource(sourceId)
    if (!source) return { continue: false, status: 'removed' }
    const raw = liveErrorText(error, 300)
    console.error('[live]', raw)
    // Guarda o erro bruto no estado para diagnóstico (`/api/state`).
    source.liveLastError = raw.slice(0, 300)
    let message = LIVE_TEXT.failed
    if ([LIVE_TEXT.offline, LIVE_TEXT.gone, LIVE_TEXT.noStream, LIVE_TEXT.recordFail, LIVE_TEXT.streamBlocked, LIVE_TEXT.failed].includes(raw)) message = raw
    else if (isBlocked(error)) message = FRIENDLY[0]
    else if (/will begin|premieres in/i.test(raw)) message = FRIENDLY[6]
    else if (/not currently live|channel is offline|is offline/i.test(raw)) message = LIVE_TEXT.offline
    else if (/timed? ?out|timeout/i.test(raw)) message = FRIENDLY[1]
    else if (/HTTP Error 403|Forbidden/i.test(raw)) message = FRIENDLY[0]
    else if (/Video unavailable|HTTP Error 404/i.test(raw)) message = FRIENDLY[3]
    else if (/live stream.*(?:has )?ended|broadcast.*ended/i.test(raw)) message = LIVE_TEXT.gone
    return finishLiveStep(source, job, message)
  }
}
