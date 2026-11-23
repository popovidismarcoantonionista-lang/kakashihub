import type { Source } from '../types'

export interface CaptureConfig {
  mirror: string
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

const CACHE_KEY = 'kakashi:live-playlists:v1'
const CACHE_TTL = 5 * 60 * 1000
const SEGMENT_MARKER = '/playlist/index.m3u8'

const clean = (value: string) => String(value || '').trim()
const mirrorBase = (mirror: string) => clean(mirror).replace(/\/$/, '')
// Sem este parâmetro o espelho devolve URLs absolutas de googlevideo (sem CORS).
const withLocal = (url: string) => `${url}${url.includes('?') ? '&' : '?'}local=true`

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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim()) throw new Error('resposta vazia')
  return text
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

function cacheKey(videoId: string, mirror: string) {
  return `${CACHE_KEY}:${mirrorBase(mirror)}:${videoId}`
}

function readCache(videoId: string, mirror: string): PlaylistRefs | null {
  try {
    const raw = localStorage.getItem(cacheKey(videoId, mirror))
    if (!raw) return null
    const value = JSON.parse(raw) as PlaylistRefs
    if (!value || Date.now() - Number(value.at) > CACHE_TTL) return null
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
  const cached = readCache(videoId, config.mirror)
  if (cached) return cached
  const apiUrl = `${mirrorBase(config.mirror)}/api/v1/videos/${encodeURIComponent(videoId)}?local=true`
  const res = await fetch(apiUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`espelho HTTP ${res.status}`)
  const json = await res.json()
  if (json?.liveNow === false) throw new Error('a transmissão saiu do ar')
  const masterUrl = withLocal(normalizeUrl(json?.hlsUrl || '', config.mirror, `${mirrorBase(config.mirror)}/`))
  if (!masterUrl) throw new Error('o espelho não devolveu HLS')
  const tracks = parseMaster(await fetchText(masterUrl), masterUrl, config.mirror)
  if (!tracks.video || !tracks.audio) throw new Error('o manifesto não trouxe vídeo e áudio')
  const value = { at: Date.now(), masterUrl, ...tracks }
  writeCache(videoId, config.mirror, value)
  return value
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

async function fetchSegments(urls: string[]): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < urls.length; i += 4) {
    const group = urls.slice(i, i + 4)
    const parts = await Promise.all(group.map(async (url) => {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`segmento HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    }))
    chunks.push(...parts)
  }
  return concat(chunks)
}

function packWindow(video: Uint8Array<ArrayBuffer>, audio: Uint8Array<ArrayBuffer>): Blob {
  const header = new Uint8Array(13)
  header.set(new TextEncoder().encode('LWIN'), 0)
  header[4] = 1
  const view = new DataView(header.buffer)
  view.setUint32(5, video.length, false)
  view.setUint32(9, audio.length, false)
  return new Blob([header, video, audio], { type: 'application/octet-stream' })
}

export async function captureLiveWindow(source: Source, api: Api, config: CaptureConfig): Promise<void> {
  const id = source.liveId || youtubeId(source.url || '')
  if (!id) throw new Error('link de YouTube inválido')
  const refs = await resolvePlaylists(id, config)
  const [videoList, audioList] = await Promise.all([
    fetchText(withLocal(refs.video)).then((text) => parseSegments(text, refs.video, config.mirror, config.maxSegments)),
    fetchText(withLocal(refs.audio)).then((text) => parseSegments(text, refs.audio, config.mirror, config.maxSegments)),
  ])
  if (!videoList.length || !audioList.length) throw new Error('playlist sem segmentos')
  const [video, audio] = await Promise.all([fetchSegments(videoList), fetchSegments(audioList)])
  if (video.length < 1024 || audio.length < 1024) throw new Error('janela vazia')
  await api(`/api/live/${source.id}/window`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: packWindow(video, audio),
  })
}

export class LiveCaptureSession {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private stopped = true

  constructor(
    private readonly sourceId: string,
    private readonly getSource: () => Source | undefined,
    private readonly api: Api,
    private readonly config: CaptureConfig,
    private readonly onStatus: (sourceId: string, message: string) => void,
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    const interval = Math.max(10000, (this.config.windowSeconds - 8) * 1000)
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, interval)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick() {
    if (this.busy || this.stopped) return
    const source = this.getSource()
    if (!source || source.status !== 'ao-vivo') return
    this.busy = true
    try {
      await captureLiveWindow(source, this.api, this.config)
      this.onStatus(this.sourceId, 'Janela enviada ao estúdio')
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 140)
      this.onStatus(this.sourceId, `Captura no navegador: ${message}`)
    } finally {
      this.busy = false
    }
  }
}
