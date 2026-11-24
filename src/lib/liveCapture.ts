import type { Source } from '../types'

export interface CaptureConfig {
  mirror: string
  mirrors?: string[]
  relay?: string
  useRelay?: boolean
  windowSeconds: number
  maxSegments: number
}

type Api = (path: string, init?: RequestInit) => Promise<any>

interface PlaylistRefs {
  at: number
  masterUrl: string
  video: string
  audio: string
}

export interface CaptionCue { t: number; text: string }
interface VttCue { start: number; end: number; text: string }

const CACHE_KEY = 'kakashi:live-playlists:v1'
const CACHE_TTL = 5 * 60 * 1000
const SEGMENT_MARKER = '/playlist/index.m3u8'

const clean = (value: string) => String(value || '').trim()
const mirrorBase = (mirror: string) => clean(mirror).replace(/\/$/, '')
// Sem este parâmetro o espelho devolve URLs absolutas de googlevideo (sem CORS).
const withLocal = (url: string) => `${url}${url.includes('?') ? '&' : '?'}local=true`

/** No mobile, busca o HLS pela mesma origem para evitar CORS/rede do espelho. */
function relayUrl(url: string, config?: CaptureConfig): string {
  if (!config?.relay || config.useRelay === false) return url
  try {
    const parsed = new URL(url, window.location.href)
    if (parsed.protocol !== 'https:') return url
    const hosts = [config.mirror, ...(config.mirrors || [])]
      .map((mirror) => { try { return new URL(mirror).hostname } catch { return '' } })
      .filter(Boolean)
    if (!hosts.includes(parsed.hostname) && !/^(yt-comp\d+|yt)\.chocolatemoo53\.com$/i.test(parsed.hostname)) return url
    return `${config.relay}?url=${encodeURIComponent(parsed.toString())}`
  } catch {
    return url
  }
}

export function youtubeId(url: string): string | null {
  const match = clean(url).match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)
  return match?.[1] || null
}

/** Invidious devolve playlists em www.youtube.com; o espelho repassa o mesmo caminho. */
function normalizeUrl(raw: string, mirror: string, base?: string): string {
  let url = clean(raw)
  if (!url) return ''
  if (url.startsWith('//')) url = `https:${url}`
  if (!/^https?:\/\//i.test(url) && base) {
    try { url = new URL(url, base).toString() } catch { return '' }
  }
  const proxied = url.match(/^https?:\/\/(?:www\.)?youtube\.com(\/api\/.*)$/i)
  if (proxied) return `${mirrorBase(mirror)}${proxied[1]}`
  return url
}

/** O segmento é o sufixo da URL do playlist proxied; montamos a URL no espelho. */
function proxySegment(segment: string, playlistUrl: string, mirror: string): string {
  const url = normalizeUrl(segment, mirror, playlistUrl)
  const segIndex = url.indexOf(SEGMENT_MARKER)
  const baseIndex = playlistUrl.indexOf(SEGMENT_MARKER)
  if (segIndex >= 0 && baseIndex >= 0) {
    return `${playlistUrl.slice(0, baseIndex + SEGMENT_MARKER.length)}${url.slice(segIndex + SEGMENT_MARKER.length)}`
  }
  return url
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string, config?: CaptureConfig): Promise<string> {
  const target = relayUrl(url, config)
  const relayTarget = config?.relay ? relayUrl(url, { ...config, useRelay: true }) : target
  const targets = relayTarget !== target ? [target, relayTarget] : [target]
  let last = 'falha de rede'
  for (const t of targets) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(t, { cache: 'no-store' }, 15000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (!text.trim()) throw new Error('resposta vazia')
        return text
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }
  throw new Error(last)
}

function parseMaster(text: string, masterUrl: string, mirror: string): Pick<PlaylistRefs, 'video' | 'audio'> {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  let audio = ''
  let video = ''
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/i.test(line) && !audio) {
      const uri = line.match(/URI="([^"]+)"/)?.[1]
      if (uri) audio = normalizeUrl(uri, mirror, masterUrl)
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const next = lines[i + 1] || ''
      if (!next || next.startsWith('#')) continue
      const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1]) || 720
      // Prefere a maior resolução até 720p; acima disso o upload fica pesado.
      const score = height <= 720 ? 720 - height : 10000 + height
      if (score < best) {
        best = score
        video = normalizeUrl(next, mirror, masterUrl)
      }
    }
  }
  return { video, audio }
}

function parseSegments(text: string, playlistUrl: string, mirror: string, max: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter((line) => /^https?:\/\//i.test(line))
    .slice(-max)
    .map((line) => proxySegment(line, playlistUrl, mirror))
}

function timeToSec(raw: string): number | null {
  const value = clean(raw)
  const m = value.match(/(\d+):(\d{2}):(\d{2})[.,](\d{3})/) || value.match(/(\d+):(\d{2})[.,](\d{3})/)
  if (!m) return null
  return m.length === 5
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
    : Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000
}

/** VTT do espelho: cues deduplicados, mesma ideia do parseVtt do servidor. */
function parseVtt(raw: string): VttCue[] {
  const cues: VttCue[] = []
  for (const block of String(raw || '').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    const idx = lines.findIndex((line) => line.includes('-->'))
    if (idx < 0) continue
    const [from, to] = lines[idx].split('-->')
    const start = timeToSec(from || '')
    const end = timeToSec((to || '').split(/\s/)[0] || '')
    if (start == null || end == null) continue
    const text = lines.slice(idx + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 1 && end - start > 0.5) cues.push({ start, end, text })
  }
  cues.sort((a, b) => a.start - b.start)
  const out: VttCue[] = []
  for (const cue of cues) {
    const prev = out[out.length - 1]
    if (prev && prev.text === cue.text) {
      prev.end = Math.max(prev.end, cue.end)
      continue
    }
    out.push({ ...cue })
  }
  return out
}

async function fetchCaptions(videoId: string, mirror: string, config?: CaptureConfig): Promise<VttCue[]> {
  try {
    const base = mirrorBase(mirror)
    const url = `${base}/api/v1/captions/${encodeURIComponent(videoId)}`
    const json = JSON.parse(await fetchText(url, config))
    const list = Array.isArray(json?.captions) ? json.captions : []
    if (!list.length) return []
    const track = list.find((c: any) => /^pt(?:-BR)?$/i.test(String(c.languageCode || '')))
      || list.find((c: any) => /portugu/i.test(String(c.label || '')))
      || list[0]
    const vttUrl = normalizeUrl(String(track?.url || ''), mirror, `${base}/`)
    if (!vttUrl) return []
    return parseVtt(await fetchText(vttUrl, config))
  } catch {
    return []
  }
}

/** Cues da ponta da live, já em tempo relativo à janela enviada. */
function captionsForWindow(cues: VttCue[], seconds: number): CaptionCue[] {
  if (!cues.length) return []
  const edge = Math.max(...cues.map((cue) => cue.end))
  const from = Math.max(0, edge - Math.max(5, seconds))
  return cues
    .filter((cue) => cue.end > from)
    .slice(-80)
    .map((cue) => ({ t: Math.round(Math.max(0, cue.start - from) * 10) / 10, text: cue.text.slice(0, 220) }))
}

function playlistDuration(text: string, max: number): number {
  const seconds = Array.from(text.matchAll(/#EXTINF:([\d.]+)/g))
    .map((m) => Number(m[1]))
    .filter((value) => Number.isFinite(value))
    .slice(-max)
  return seconds.reduce((sum, value) => sum + value, 0)
}

function cacheKey(videoId: string, mirror: string) {
  return `${CACHE_KEY}:${mirrorBase(mirror)}:${videoId}`
}

function readCache(videoId: string, mirror: string, allowStale = false): PlaylistRefs | null {
  try {
    const raw = localStorage.getItem(cacheKey(videoId, mirror))
    if (!raw) return null
    const value = JSON.parse(raw) as PlaylistRefs
    if (!value || (!allowStale && Date.now() - Number(value.at) > CACHE_TTL)) return null
    if (!value.video || !value.audio || !value.masterUrl) return null
    return value
  } catch {
    return null
  }
}

function writeCache(videoId: string, mirror: string, value: PlaylistRefs) {
  try { localStorage.setItem(cacheKey(videoId, mirror), JSON.stringify(value)) } catch {}
}

async function resolvePlaylists(videoId: string, config: CaptureConfig): Promise<PlaylistRefs> {
  const mirrors = [config.mirror, ...(config.mirrors || [])]
    .map(mirrorBase)
    .filter((m, i, arr) => m && arr.indexOf(m) === i)
  let lastError: unknown = new Error('o espelho não devolveu HLS')
  for (const mirror of mirrors) {
    const cached = readCache(videoId, mirror)
    if (cached) return cached
  }
  for (const mirror of mirrors) {
    try {
      const apiUrl = `${mirror}/api/v1/videos/${encodeURIComponent(videoId)}?local=true`
      const json = JSON.parse(await fetchText(apiUrl, config))
      if (json?.liveNow === false) throw new Error('a transmissão saiu do ar')
      const hlsRaw = json?.hlsUrl || json?.hls || ''
      const masterUrl = withLocal(normalizeUrl(String(hlsRaw || ''), mirror, `${mirror}/`))
      if (!masterUrl) throw new Error('o espelho não devolveu HLS')
      const tracks = parseMaster(await fetchText(masterUrl, config), masterUrl, mirror)
      if (!tracks.video || !tracks.audio) throw new Error('o manifesto não trouxe vídeo e áudio')
      const value = { at: Date.now(), masterUrl, ...tracks }
      writeCache(videoId, mirror, value)
      return value
    } catch (error) {
      lastError = error
    }
  }
  for (const mirror of mirrors) {
    const stale = readCache(videoId, mirror, true)
    if (stale) return stale
  }
  throw lastError
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function fetchBytes(url: string, config?: CaptureConfig): Promise<Uint8Array<ArrayBuffer>> {
  const target = relayUrl(url, config)
  const relayTarget = config?.relay ? relayUrl(url, { ...config, useRelay: true }) : target
  const targets = relayTarget !== target ? [target, relayTarget] : [target]
  let last = 'falha de rede'
  for (const t of targets) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(t, { cache: 'no-store' }, 20000)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return new Uint8Array(await res.arrayBuffer())
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }
  throw new Error(last)
}

async function fetchSegments(urls: string[], config?: CaptureConfig): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < urls.length; i += 4) {
    const group = urls.slice(i, i + 4)
    const parts = await Promise.all(group.map((url) => fetchBytes(url, config)))
    chunks.push(...parts)
  }
  return concat(chunks)
}

/** v2 = vídeo.ts + áudio.ts + JSON de legendas; o servidor ainda aceita v1. */
function packWindow(video: Uint8Array<ArrayBuffer>, audio: Uint8Array<ArrayBuffer>, captions: CaptionCue[]): Blob {
  const encoder = new TextEncoder()
  const json = encoder.encode(JSON.stringify(captions.slice(0, 80)))
  const header = new Uint8Array(17)
  header.set(encoder.encode('LWIN'), 0)
  header[4] = 2
  const view = new DataView(header.buffer)
  view.setUint32(5, video.length, false)
  view.setUint32(9, audio.length, false)
  view.setUint32(13, json.length, false)
  return new Blob([header, video, audio, json], { type: 'application/octet-stream' })
}

function failure(stage: string, error: unknown, config: CaptureConfig): Error {
  const message = error instanceof Error ? error.message : String(error)
  let host = ''
  try { host = new URL(config.mirror).hostname } catch {}
  const mode = config.useRelay ? 'relay' : 'direto'
  return new Error(`${stage} (${host}/${mode}): ${message}`)
}

export async function captureLiveWindow(source: Source, api: Api, config: CaptureConfig): Promise<void> {
  const id = source.liveId || youtubeId(source.url || '')
  if (!id) throw new Error('link: ID do vídeo não encontrado')
  let refs: PlaylistRefs
  try {
    refs = await resolvePlaylists(id, config)
  } catch (error) {
    throw failure('manifesto', error, config)
  }
  let videoText: string
  let audioText: string
  let cues: VttCue[]
  try {
    [videoText, audioText, cues] = await Promise.all([
      fetchText(withLocal(refs.video), config),
      fetchText(withLocal(refs.audio), config),
      fetchCaptions(id, config.mirror, config),
    ])
  } catch (error) {
    throw failure('playlist', error, config)
  }
  const videoList = parseSegments(videoText, refs.video, config.mirror, config.maxSegments)
  const audioList = parseSegments(audioText, refs.audio, config.mirror, config.maxSegments)
  if (!videoList.length || !audioList.length) throw new Error('playlist: sem segmentos')
  let video: Uint8Array<ArrayBuffer>
  let audio: Uint8Array<ArrayBuffer>
  try {
    [video, audio] = await Promise.all([fetchSegments(videoList, config), fetchSegments(audioList, config)])
  } catch (error) {
    throw failure('segmentos', error, config)
  }
  if (video.length < 1024 || audio.length < 1024) throw new Error('segmentos: janela vazia')
  const seconds = playlistDuration(videoText, config.maxSegments) || config.windowSeconds
  const captions = captionsForWindow(cues, seconds)
  try {
    await api(`/api/live/${source.id}/window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: packWindow(video, audio, captions),
    })
  } catch (error) {
    throw failure('envio', error, config)
  }
}

/**
 * No celular o acesso direto ao espelho é o que funciona (o relay sai pelo IP
 * do Render, bloqueado nas rotas dinâmicas). Tenta direto primeiro e só usa o
 * relay se a rede local bloquear o espelho.
 */
export async function captureLiveWindowWithFallback(
  source: Source,
  api: Api,
  config: CaptureConfig,
): Promise<void> {
  const mirrors = [...new Set([config.mirror, ...(config.mirrors || [])])].filter(Boolean).slice(0, 4)
  let last: unknown = new Error('sem espelhos disponíveis')
  const attempt = async (mirror: string, useRelay: boolean) => {
    try {
      await captureLiveWindow(source, api, { ...config, mirror, useRelay })
      return true
    } catch (error) {
      last = error
      return false
    }
  }
  for (const mirror of mirrors) {
    if (await attempt(mirror, false)) return
  }
  if (config.relay) {
    let relayDown = false
    for (const mirror of mirrors) {
      if (relayDown) break
      const ok = await attempt(mirror, true)
      if (ok) return
      const msg = last instanceof Error ? last.message : String(last || '')
      if (/HTTP 502|HTTP 503|HTTP 504|Espelho indispon/i.test(msg)) relayDown = true
    }
  }
  throw last
}

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

export class LiveCaptureSession {
  private timer: ReturnType<typeof setInterval> | null = null
  private worker: Worker | null = null
  private busy = false
  private stopped = true
  private wakeLock: WakeLockSentinelLike | null = null

  constructor(
    private readonly getSource: () => Source | undefined,
    private readonly api: Api,
    private readonly config: CaptureConfig,
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    const interval = Math.max(10000, (this.config.windowSeconds - 8) * 1000)
    void this.requestWakeLock()
    document.addEventListener('visibilitychange', this.onVisibility)
    void this.tick()
    try {
      const src = `setInterval(() => postMessage('tick'), ${interval});`
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
      this.worker.onmessage = () => { void this.tick() }
    } catch {
      this.timer = setInterval(() => { void this.tick() }, interval)
    }
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.worker) {
      try { this.worker.terminate() } catch {}
      this.worker = null
    }
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.releaseWakeLock()
  }

  private onVisibility = () => {
    if (document.visibilityState !== 'visible' || this.stopped) return
    // O navegador suspende timers em segundo plano; ao voltar, pede a tela de novo
    // e captura imediatamente para não perder a janela seguinte.
    void this.requestWakeLock()
    void this.tick()
  }

  private async requestWakeLock() {
    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock || this.stopped || this.wakeLock) return
    try {
      this.wakeLock = await nav.wakeLock.request('screen')
    } catch {
      // Wake Lock não é obrigatório (iOS Safari não oferece). A aba continua capturando.
    }
  }

  private async releaseWakeLock() {
    const lock = this.wakeLock
    this.wakeLock = null
    if (!lock) return
    try { await lock.release() } catch {}
  }

  private async tick() {
    if (this.busy || this.stopped) return
    const source = this.getSource()
    if (!source || source.status !== 'ao-vivo') return
    this.busy = true
    try {
      await captureLiveWindowWithFallback(source, this.api, this.config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'falha na captura')
      const body = JSON.stringify({ error: message.slice(0, 280) })
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.api(`/api/live/${source.id}/capture-error`, { method: 'POST', body })
          break
        } catch {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800))
        }
      }
    } finally {
      this.busy = false
    }
  }
}
