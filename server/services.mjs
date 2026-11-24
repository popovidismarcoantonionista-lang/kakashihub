/**
 * Adaptadores HTTP para serviços externos de download e metadata.
 *
 *  - Cobalt (imputnet/cobalt): resolve uma URL para arquivos prontos e
 *    devolve tunnels (tunnel / redirect / local-processing).
 *  - yt-dlp-api (fvadicamo): metadata (/api/v1/info) e transcrição
 *    (/api/v1/transcript) sem baixar o vídeo.
 *
 * Tudo é opcional: sem URL configurada o pipeline continua usando yt-dlp,
 * espelhos públicos e a API do YouTube.
 */

const urlOf = (value) => String(value || '').trim().replace(/\/+$/, '')
const keyOf = (value) => String(value || '').trim()
const TIMEOUT = Number(process.env.SERVICE_TIMEOUT_MS || 120000)

export const COBALT_URL = urlOf(process.env.COBALT_API_URL || process.env.FUGA_COBALT_URL)
export const COBALT_KEY = keyOf(process.env.COBALT_API_KEY || process.env.FUGA_COBALT_KEY)
export const YDL_API_URL = urlOf(process.env.YTDLP_API_URL || process.env.FUGA_YTDLP_API_URL)
export const YDL_API_KEY = keyOf(process.env.YTDLP_API_KEY || process.env.FUGA_YTDLP_API_KEY)
// Espelhos de leitura públicos (Invidious). Usados como gambiarra quando o
// yt-dlp é barrado pelo IP de datacenter: eles resolvem o player response por
// conta própria. Vários hosts entram porque alguns bloqueiam IPs de cloud.
const DEFAULT_INVIDIOUS = [
  // Primeiro da lista: é o único espelho testado que devolve `liveNow` e
  // `hlsUrl` para lives do YouTube (testado em z2hktG1zUbs, 2026-11).
  'https://yt.chocolatemoo53.com',
  'https://invidious.slipfox.xyz',
  'https://invidious.tiekoetter.com',
  'https://inv.zoomerville.com',
  'https://invidious.kavin.rocks',
  'https://yewtu.be',
  'https://invidious.privacyredirect.com',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.ducks.party',
  'https://invidious.protokolla.fi',
  'https://invidious.private.coffee',
  'https://invidious.jing.rocks',
  'https://inv.us.projectsegfau.lt',
  'https://invidious.materialio.us',
  'https://invidious.privacydev.net',
  'https://invidious.hostux.net',
  'https://invidious.poast.org',
  'https://invidious.synth.download',
].join(',')

export const INVIDIOUS_URLS = String(process.env.INVIDIOUS_API_URLS || process.env.INVIDIOUS_API_URL || DEFAULT_INVIDIOUS)
  .split(',')
  .map(urlOf)
  .filter(Boolean)
export const INVIDIOUS_URL = INVIDIOUS_URLS[0] || ''

// Piped é outro leitor público de YouTube. Também só lê/resolve mídia.
const DEFAULT_PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi-libre.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.drgns.space',
  'https://pipedapi.owo.si',
  'https://pipedapi.ducks.party',
  'https://piped-api.codespace.cz',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.private.coffee',
  'https://pipedapi.darkness.services',
  'https://pipedapi.orangenet.cc',
  'https://piapi.ggtyler.dev',
].join(',')

export const PIPED_URLS = String(process.env.PIPED_API_URLS || DEFAULT_PIPED)
  .split(',')
  .map(urlOf)
  .filter(Boolean)

export const hasCobalt = () => Boolean(COBALT_URL)
export const hasYtdlpApi = () => Boolean(YDL_API_URL)
export const hasInvidious = () => INVIDIOUS_URLS.length + PIPED_URLS.length > 0

function cobaltHeaders(scheme = 'Api-Key') {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (COBALT_KEY) headers.Authorization = `${scheme} ${COBALT_KEY}`
  return headers
}

function ydlHeaders() {
  const headers = { Accept: 'application/json' }
  if (YDL_API_KEY) headers['X-API-Key'] = YDL_API_KEY
  return headers
}

async function bodyOrNull(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function statusError(res, json, label) {
  if (res.status === 401) return new Error(`${label}-auth`)
  if (res.status === 429) return new Error(`${label}-busy`)
  if (res.status === 404) return new Error(`${label}-not-found`)
  const code = json?.error?.code || json?.error_code || ''
  return new Error(`${label}-${res.status}${code ? `-${code}` : ''}`.slice(0, 180))
}

/** Resolve um vídeo no Cobalt. */
export async function cobaltResolve(url, opts = {}) {
  if (!COBALT_URL) throw new Error('cobalt-disabled')
  const body = JSON.stringify({
    url,
    videoQuality: opts.quality || '720',
    downloadMode: 'auto',
    youtubeVideoCodec: 'h264',
    youtubeVideoContainer: 'mp4',
    // Render sai de IP de datacenter e o YouTube devolve "bot" para o Cobalt.
    // O proxy do próprio Cobalt resolve isso (testado com o mesmo vídeo).
    alwaysProxy: true,
    disableMetadata: true,
  })
  const post = (scheme) => fetch(COBALT_URL, {
    method: 'POST',
    headers: cobaltHeaders(scheme),
    body,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  let res = await post('Api-Key')
  let json = await bodyOrNull(res)
  const authError = (value) => /api\.auth\.jwt\.missing/i.test(String(value?.error?.code || ''))
  // Algumas instâncias exigem Bearer (JWT) em IPs de datacenter. A chave do
  // Render pode ser esse JWT; tentar os dois esquemas evita "jwt.missing".
  if (authError(json) && COBALT_KEY) {
    res = await post('Bearer')
    json = await bodyOrNull(res)
  }

  if (json?.status === 'error') {
    const code = String(json.error?.code || 'unknown')
    if (/bot|sign.?in|captcha|login|age|auth/i.test(code)) throw new Error(`cobalt-blocked-${code}`.slice(0, 180))
    throw new Error(`cobalt-error-${code}`.slice(0, 180))
  }
  if (!res.ok || !json) throw statusError(res, json, 'cobalt')

  if (json.status === 'tunnel' || json.status === 'redirect') {
    if (typeof json.url !== 'string' || !json.url) throw new Error('cobalt-no-url')
    return { kind: json.isHLS ? 'hls' : 'single', url: json.url, filename: json.filename || null }
  }

  if (json.status === 'local-processing') {
    const tunnels = Array.isArray(json.tunnel)
      ? json.tunnel.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
      : []
    if (!tunnels.length) throw new Error('cobalt-no-tunnel')
    const type = String(json.type || '').toLowerCase()
    if (json.isHLS) return { kind: 'hls', url: tunnels[0], filename: json.output?.filename || null }
    // No Cobalt, para YouTube, tunnel[0] é o vídeo e tunnel[1] é o áudio.
    if (type === 'merge' && tunnels.length >= 2) {
      return { kind: 'merge', video: tunnels[0], audio: tunnels[1], filename: json.output?.filename || null }
    }
    if (type === 'audio') throw new Error('cobalt-audio-only')
    return { kind: 'single', url: tunnels[0], filename: json.output?.filename || null }
  }

  if (json.status === 'picker') {
    const items = Array.isArray(json.picker) ? json.picker : []
    const video = items.find((p) => p?.type === 'video' && typeof p.url === 'string')
    if (!video) throw new Error('cobalt-no-video')
    return { kind: 'single', url: video.url, filename: null }
  }

  throw new Error(`cobalt-status-${String(json.status || 'unknown').slice(0, 40)}`)
}

/** Metadata de um vídeo via yt-dlp-api (fvadicamo). */
export async function ydlInfo(url) {
  if (!YDL_API_URL) throw new Error('ydl-disabled')
  const u = new URL(`${YDL_API_URL}/api/v1/info`)
  u.searchParams.set('url', url)
  const res = await fetch(u, { headers: ydlHeaders(), signal: AbortSignal.timeout(TIMEOUT) })
  const json = await bodyOrNull(res)
  if (!res.ok || !json) throw statusError(res, json, 'ydl')
  return {
    id: String(json.video_id || ''),
    title: String(json.title || '').slice(0, 140),
    channel: String(json.author || '').slice(0, 90),
    uploader: String(json.author || '').slice(0, 90),
    duration: Number(json.duration) || 0,
    description: String(json.description || '').slice(0, 500),
    thumbnail: String(json.thumbnail_url || ''),
    is_live: false,
    is_upcoming: false,
  }
}

/** Transcrição em segmentos via yt-dlp-api (fvadicamo). */
export async function ydlTranscript(url, lang = 'pt') {
  if (!YDL_API_URL) throw new Error('ydl-disabled')
  const u = new URL(`${YDL_API_URL}/api/v1/transcript`)
  u.searchParams.set('url', url)
  u.searchParams.set('lang', lang)
  u.searchParams.set('source', 'any')
  u.searchParams.set('fmt', 'json')
  const res = await fetch(u, { headers: ydlHeaders(), signal: AbortSignal.timeout(TIMEOUT) })
  const json = await bodyOrNull(res)
  if (!res.ok || !json) throw statusError(res, json, 'ydl')
  if (!Array.isArray(json.segments)) return []
  return json.segments
    .map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text && s.end > s.start)
    .sort((a, b) => a.start - b.start)
}

const YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i

export function youtubeVideoId(url) {
  return String(url || '').match(YT_ID_RE)?.[1] || ''
}

const absolute = (value, base) => {
  const str = String(value || '')
  if (!str) return ''
  if (/^https?:\/\//i.test(str)) return str
  if (str.startsWith('/')) return `${base}${str}`
  return ''
}

const INVIDIOUS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const INVIDIOUS_TIMEOUT = Math.min(TIMEOUT, Number(process.env.INVIDIOUS_TIMEOUT_MS || 12000))
const INVIDIOUS_LOCAL = String(process.env.INVIDIOUS_LOCAL ?? 'true') === 'false' ? 'false' : 'true'

/** Lê JSON de um espelho público com timeout curto e log de falha. */
async function readMirror(base, pathname, label, params) {
  const endpoint = new URL(`${base}${pathname}`)
  for (const [key, value] of Object.entries(params || {})) endpoint.searchParams.set(key, value)
  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': INVIDIOUS_UA },
    signal: AbortSignal.timeout(INVIDIOUS_TIMEOUT),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  const host = new URL(base).host
  if (!res.ok) throw new Error(`${label}-${res.status}@${host} ${text.slice(0, 80)}`)
  if (!json || typeof json !== 'object') throw new Error(`${label}-invalid-json@${host} ${text.slice(0, 80)}`)
  if (json.error) throw new Error(`${label}-error@${host} ${String(json.error).slice(0, 120)}`)
  return json
}

/** Metadados + URL de HLS resolvidos por espelhos públicos (Invidious/Piped). */
export async function invidiousInfo(url) {
  if (!INVIDIOUS_URLS.length && !PIPED_URLS.length) throw new Error('invidious-disabled')
  const id = youtubeVideoId(url)
  if (!id) throw new Error('invidious-no-id')

  const attempts = [
    ...INVIDIOUS_URLS.map(async (base) => {
      try {
        const json = await readMirror(base, `/api/v1/videos/${encodeURIComponent(id)}`, 'invidious', { local: INVIDIOUS_LOCAL })
        const streams = Array.isArray(json.formatStreams) ? json.formatStreams : []
        const adaptive = Array.isArray(json.adaptiveFormats) ? json.adaptiveFormats : []
        const findStream = (list, re) => list.find((s) => re.test(String(s?.type || '')))
        const video = findStream(streams, /^video\//) || findStream(adaptive, /^video\//)
        const audio = findStream(streams, /^audio\//) || findStream(adaptive, /^audio\//)
        const thumb = Array.isArray(json.videoThumbnails) ? json.videoThumbnails[0]?.url : ''
        console.log('[invidious]', `${base} → ok`)
        return {
          id,
          title: String(json.title || '').slice(0, 140),
          channel: String(json.author || '').slice(0, 90),
          uploader: String(json.author || '').slice(0, 90),
          description: String(json.description || '').slice(0, 500),
          duration: Number(json.lengthSeconds) || 0,
          thumbnail: absolute(thumb, base),
          is_live: Boolean(json.liveNow),
          is_upcoming: Boolean(json.isUpcoming),
          hls: absolute(json.hlsUrl, base),
          video: absolute(video?.url, base),
          audio: absolute(audio?.url, base),
          base,
        }
      } catch (err) {
        console.error('[invidious]', `${base} → ${String(err?.message || err).slice(0, 160)}`)
        throw err
      }
    }),
    ...PIPED_URLS.map(async (base) => {
      try {
        const json = await readMirror(base, `/streams/${encodeURIComponent(id)}`, 'piped')
        const videos = Array.isArray(json.videoStreams) ? json.videoStreams : []
        const audios = Array.isArray(json.audioStreams) ? json.audioStreams : []
        const video = videos.find((s) => !s.videoOnly) || videos[0]
        const audio = audios[0] || videos.find((s) => s.videoOnly) || null
        console.log('[piped]', `${base} → ok`)
        return {
          id,
          title: String(json.title || '').slice(0, 140),
          channel: String(json.uploader || '').slice(0, 90),
          uploader: String(json.uploader || '').slice(0, 90),
          description: String(json.description || '').slice(0, 500),
          duration: Number(json.duration) || 0,
          thumbnail: absolute(json.thumbnailUrl, base),
          is_live: Boolean(json.livestream),
          is_upcoming: false,
          hls: absolute(json.hls, base),
          video: absolute(video?.url, base),
          audio: absolute(audio?.url, base),
          base,
        }
      } catch (err) {
        console.error('[piped]', `${base} → ${String(err?.message || err).slice(0, 160)}`)
        throw err
      }
    }),
  ]

  const settled = await Promise.allSettled(attempts)
  const ok = settled.find((r) => r.status === 'fulfilled')
  if (ok) return ok.value
  const reasons = settled.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason))
  throw new Error(`invidious-unavailable: ${[...new Set(reasons)].slice(0, 4).join(' | ')}`)
}
