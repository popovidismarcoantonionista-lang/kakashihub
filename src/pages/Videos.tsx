import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Clapperboard, Crop, Download,
  Play, Plus, Radio, Search, Square, Trash2, UploadCloud, Youtube,
} from 'lucide-react'
import { RATE_LIMIT_MESSAGE, friendlyMessage, publicGet, useApp } from '../store'
import { CamBoxCanvas } from '../CamBoxCanvas'
import { navigate } from '../router'
import { PlayerModal } from '../components'
import { Cover, EmptyState, Logo, Modal, PageHead, ProgressBar, TypeBadge } from '../ui'
import { detectCamBoxAuto } from '../lib/camBox'
import { fmtTime, fmtViews, relTime } from '../lib/format'
import type { CamBox, Source } from '../types'

type RadarItem = {
  platform: 'twitch' | 'kick'
  login: string
  name: string
  avatar: string
  live: boolean
  title: string
  game: string
  viewers: number
  thumb: string
}

type RadarData = { ok: boolean; kickOk?: boolean; items: RadarItem[]; liveCount: number }

type FoundVideo = {
  id: string
  title: string
  channel: string
  thumb: string
  duration: number
  views: number
  url: string
}

// O Render sai de IP de datacenter e é bloqueado pelo YouTube/espelhos. Quem
// busca os bytes é este navegador (IP do usuário); o Render recebe as partes,
// junta 720p + áudio com ffmpeg e serve o MP4 com Content-Length real. O link
// final é só um caminho interno, sem URL do provedor e sem query string.
type DownloadSession = {
  id: string
  videoId: string
  provider: string
  url: string
}
type PreparedDownload = { url: string }
type ProviderFormat = {
  url: string
  type?: string
  clen: string | number
  qualityLabel?: string
  itag?: string | number
  audioTrack?: {
    id?: string
    displayName?: string
    audioIsDefault?: boolean
    isDefault?: boolean
  }
}

const UPLOAD_CHUNK = 2 * 1024 * 1024
const SOURCE_CHUNK = 512 * 1024
const PARALLEL_RANGES = 4
// Alguns vídeos oferecem "720p60" com mais de 400 MB. Isso não é um download
// razoável e faz o botão parecer travado. Preferimos a faixa 720p normal e,
// quando ela não existe, a melhor faixa abaixo desse limite.
const MAX_VIDEO_BYTES = 180 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 12 * 60 * 1000
const PROXY_HOSTS = [
  'yt-comp2.chocolatemoo53.com',
  'yt-comp3.chocolatemoo53.com',
  'yt-comp6.chocolatemoo53.com',
]

async function requestDownloadSession(url: string, title: string): Promise<DownloadSession> {
  const res = await fetch('/api/downloads/prepare', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Não foi possível preparar o download.')
  if (!data?.id || !data?.provider || !data?.videoId) throw new Error('O download não foi iniciado. Tente de novo.')
  return {
    id: String(data.id),
    videoId: String(data.videoId),
    provider: String(data.provider),
    url: String(data.url || `/api/downloads/${data.id}/file.mp4`),
  }
}

function qualityOf(format: ProviderFormat) {
  const match = String(format.qualityLabel || '').match(/(\d+)p/i)
  return match ? Number(match[1]) : 0
}

function pickProviderFormats(json: any) {
  const formats: ProviderFormat[] = Array.isArray(json?.adaptiveFormats) ? json.adaptiveFormats : []
  const videos = formats
    .filter((f) => String(f.type || '').startsWith('video/mp4')
      && /avc1/.test(String(f.type || ''))
      && Number(f.clen) > 0 && /^https:/i.test(String(f.url || '')))
  // Sempre preferimos 720p. Se o vídeo não oferece 720p, usamos a melhor faixa
  // H264 disponível em vez de falhar o download.
  const hd = videos.filter((f) => /720/i.test(String(f.qualityLabel || '')))
  const preferred = hd.length ? hd : videos
  // Começa pelas faixas HD; se a única opção HD for gigante, cai para a melhor
  // faixa menor em vez de baixar centenas de MB sem necessidade.
  const cappedHd = preferred.filter((f) => Number(f.clen) <= MAX_VIDEO_BYTES)
  const cappedAll = videos.filter((f) => Number(f.clen) <= MAX_VIDEO_BYTES)
  const pool = cappedHd.length ? cappedHd : (cappedAll.length ? cappedAll : preferred)
  const video = pool
    .sort((a, b) => qualityOf(b) - qualityOf(a)
      || Number(/60/i.test(String(a.qualityLabel || ''))) - Number(/60/i.test(String(b.qualityLabel || '')))
      || Number(a.clen) - Number(b.clen))[0]
  const audioCandidates = formats
    .filter((f) => String(f.type || '').startsWith('audio/mp4')
      && /mp4a\.40\.2/.test(String(f.type || ''))
      && Number(f.clen) > 0 && /^https:/i.test(String(f.url || '')))
  // O YouTube pode oferecer várias faixas AAC (original, dublada, narração).
  // Ordenar só por tamanho escolhia a dublagem quando ela tinha bitrate maior.
  // A faixa original é a marcada como padrão; o itag 140 é o AAC estéreo
  // original quando o provedor não envia metadados de faixa.
  const audioScore = (f: ProviderFormat) => {
    const track = f.audioTrack || {}
    const isDefault = track.audioIsDefault === true || track.isDefault === true
    const isDub = /\b(?:dub|dubbed|dubl|traduz|translat|narration)\b/i
      .test(`${track.displayName || ''} ${track.id || ''}`)
    return (isDefault ? 1000 : 0)
      - (isDub ? 2000 : 0)
      + (String(f.itag) === '140' ? 10 : 0)
  }
  const audio = audioCandidates.slice()
    .sort((a, b) => audioScore(b) - audioScore(a)
      || audioCandidates.indexOf(a) - audioCandidates.indexOf(b)
      || Number(b.clen) - Number(a.clen))[0]
  if (!video || !audio) throw new Error('Este vídeo não tem faixa H264 com áudio disponível.')
  return { video, audio }
}

async function uploadPart(
  session: DownloadSession,
  part: 'video' | 'audio',
  format: ProviderFormat,
  onProgress?: (received: number) => void,
) {
  // O proxy do provedor devolve 502 em transferências longas. Baixamos em faixas
  // pequenas com retry; cada faixa é enviada ao Render assim que fecha um bloco.
  const expected = Number(format.clen)
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS
  let received = 0
  let pending: Uint8Array[] = []
  let pendingSize = 0
  const flush = async () => {
    if (!pendingSize) return
    const chunk = new Uint8Array(pendingSize)
    let offset = 0
    for (const piece of pending) {
      chunk.set(piece, offset)
      offset += piece.length
    }
    const sent = await fetch(`/api/downloads/${session.id}/upload?part=${part}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    })
    if (!sent.ok) throw new Error('O envio do vídeo falhou. Tente de novo.')
    pending = []
    pendingSize = 0
  }
  const sourceHost = (() => {
    try { return new URL(format.url).host } catch { return '' }
  })()
  const useProxy = /chocolatemoo53\.com$/i.test(sourceHost)
  // Quatro faixas em paralelo, cada uma começando num host diferente, reduz
  // muito o tempo de arquivos grandes sem perder a ordem dos bytes enviados.
  const fetchRange = async (start: number, end: number, hostOffset: number) => {
    const want = end - start + 1
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (Date.now() > deadline) throw new Error('O download demorou demais. Tente de novo.')
      try {
        const url = useProxy
          ? (() => {
            const parsed = new URL(format.url)
            parsed.host = PROXY_HOSTS[(attempt + hostOffset) % PROXY_HOSTS.length]
            return parsed.href
          })()
          : format.url
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(12000),
        })
        const body = new Uint8Array(await res.arrayBuffer())
        const wholeSingleChunk = res.status === 200 && expected <= SOURCE_CHUNK && body.length === want
        if ((res.status === 206 || wholeSingleChunk) && body.length === want) return body
      } catch {
        // O 502 é intermitente; tentamos de novo em outro host do provedor.
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return null
  }
  const chunks = Math.ceil(expected / SOURCE_CHUNK)
  for (let base = 0; base < chunks; base += PARALLEL_RANGES) {
    const group: Promise<Uint8Array | null>[] = []
    for (let i = 0; i < PARALLEL_RANGES && base + i < chunks; i += 1) {
      const start = (base + i) * SOURCE_CHUNK
      const end = Math.min(start + SOURCE_CHUNK - 1, expected - 1)
      group.push(fetchRange(start, end, i))
    }
    const results = await Promise.all(group)
    if (Date.now() > deadline) throw new Error('O download demorou demais. Tente de novo.')
    for (const bytes of results) {
      if (!bytes) throw new Error('O provedor não entregou o arquivo. Tente de novo.')
      pending.push(bytes)
      pendingSize += bytes.length
      received += bytes.length
      onProgress?.(received)
      if (pendingSize >= UPLOAD_CHUNK) await flush()
    }
  }
  await flush()
  if (received !== expected) throw new Error('O arquivo veio incompleto do provedor. Tente de novo.')
}

async function requestPreparedDownload(
  url: string,
  title: string,
  onProgress?: (percent: number) => void,
): Promise<PreparedDownload> {
  const session = await requestDownloadSession(url, title)
  const endpoint = `${session.provider}/api/v1/videos/${encodeURIComponent(session.videoId)}?local=true`
  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error('O provedor não respondeu. Tente de novo em instantes.')
  const { video, audio } = pickProviderFormats(await res.json())
  const total = Number(video.clen) + Number(audio.clen)
  let doneBytes = 0
  const report = (percent: number) => onProgress?.(Math.max(0, Math.min(100, Math.round(percent * 100))))
  await uploadPart(session, 'video', video, (received) => report((doneBytes + received) / total))
  doneBytes = Number(video.clen)
  report(doneBytes / total)
  await uploadPart(session, 'audio', audio, (received) => report((doneBytes + received) / total))
  report(1)
  const done = await fetch(`/api/downloads/${session.id}/finalize`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoSize: Number(video.clen),
      audioSize: Number(audio.clen),
      quality: String(video.qualityLabel || ''),
    }),
  })
  const data = await done.json().catch(() => ({}))
  if (!done.ok || !data?.url) throw new Error(data?.error || 'Não foi possível montar o download. Tente de novo.')
  return { url: String(data.url) }
}

async function triggerDownload(download: PreparedDownload) {
  // O iframe oculto dispara o download pelo Content-Disposition sem abrir aba,
  // sem sair da página e sem depender de pop-up (bloqueado por alguns navegadores).
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.referrerPolicy = 'no-referrer'
  frame.src = download.url
  document.body.appendChild(frame)
  // Não remover o iframe enquanto o download corre: o stream é lento e
  // removê-lo antes do fim aborta a transferência e o navegador retoma.
  // Ele some sozinho quando a página é recarregada/fechada.
}

const FIND_PRESETS = [
  { label: 'Enquadros', query: 'enquadro flagrante engraçado' },
  { label: 'Flagrantes', query: 'flagrante viral engraçado' },
  { label: 'Tiago da Titan 160', query: 'Tiago da Titan 160 enquadro' },
  { label: 'Titan 160', query: 'Titan 160 flagrantes enquadros' },
  // Canais autorizados dos créditos dos vídeos.
  { label: 'CB PM GUIDO', query: 'CB PM GUIDO enquadro' },
  { label: 'Cavalcante', query: 'Cavalcante enquadro' },
  { label: 'Miguelito da b12', query: 'Miguelito da b12 enquadro' },
  { label: 'Cabo Cordeiro', query: 'CABO CORDEIRO enquadro' },
  { label: 'Marcelo Eugenio', query: 'Marcelo Eugenio enquadro' },
  { label: 'Luzivan', query: 'Luzivan enquadro' },
  { label: 'Soldado Mayckon', query: 'Soldado Mayckon fuga enquadro' },
  { label: 'Soldado Henrique', query: 'soldado henriquee enquadro' },
  { label: 'Kesley', query: 'Kesley enquadro' },
  { label: 'Higor Muniz', query: 'Higor Muniz enquadro' },
  // Canais de PM, Polícia Civil/Federal, PRF e Bombeiros confirmados na busca.
  { label: 'PMESP Ocorrências', query: 'Polícia Militar do Estado de São Paulo ocorrência' },
  { label: 'Polícia em Ação', query: 'Polícia Em Ação canal' },
  { label: 'Soldado Madalhano', query: 'Soldado Madalhano' },
  { label: 'TV PMERJ', query: 'TV PMERJ' },
  { label: 'PMCE Ceará', query: 'policiamilitardoceara' },
  { label: 'Realidade PMCE', query: 'Realidade Policial PMCE' },
  { label: 'PMMG Minas', query: 'PMMG Polícia Militar de Minas Gerais' },
  { label: 'Rotam Maringá', query: 'Rotam Maringá' },
  { label: 'Polícia 24 Horas', query: 'Polícia 24 horas' },
  { label: 'Linha de Combate', query: 'Linha de Combate PRF' },
  { label: 'PRF Brasil', query: 'PRF Brasil' },
  { label: 'Delegado da Cunha', query: 'Delegado da Cunha' },
  { label: 'Sargento Fahur', query: 'Sargento Fahur Oficial' },
  { label: 'PF na Tela', query: 'PFnaTela' },
  { label: 'Cortes do Caveira01', query: 'Cortes do Caveira01' },
  { label: 'Bombeiros MG', query: 'Bombeiros MG Oficial' },
  { label: 'Bombeiros RJ', query: 'Corpo de Bombeiros Militar do Rio de Janeiro' },
  { label: 'Bombeiro Pereira BM', query: 'Bombeiro Pereira BM' },
  { label: 'Águia Sorocaba', query: 'Águia Sorocaba bombeiros' },
]

function jobLabel(kind?: string) {
  if (kind === 'live') return 'Acompanhando a transmissão'
  if (kind === 'render') return 'Preparando o corte'
  if (kind === 'compile') return 'Montando o vídeo'
  return 'Preparando a fonte'
}

function platformName(source: Source) {
  if (source.platform === 'twitch') return 'Twitch'
  if (source.platform === 'kick') return 'Kick'
  return 'Live'
}

function audioPercent(level?: number | null): number {
  if (level == null || !Number.isFinite(level)) return 0
  return Math.max(0, Math.min(100, Math.round(((level + 60) / 60) * 100)))
}

function LiveAudioMeter({ level, silent }: { level?: number | null; silent?: boolean }) {
  const pct = audioPercent(level)
  const active = silent === false && pct > 5
  // Quanto mais alto o áudio, mais rápido o equalizador "ouvindo" se move.
  const speed = Math.max(0.32, 1 - pct / 160)
  return (
    <div className={`live-audio ${active ? 'is-listening' : ''}`}>
      <span className="mono">{level == null ? 'áudio —' : active ? 'ouvindo' : 'silêncio'}</span>
      <div className="live-eq" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <i key={i} style={{ animationDelay: `${i * 0.07}s`, animationDuration: `${(speed + (i % 4) * 0.06).toFixed(2)}s` }} />
        ))}
      </div>
      {level != null && <span className="mono">{level} dB</span>}
    </div>
  )
}

function liveEmbed(source: Source): string | null {
  const host = window.location.hostname
  if (source.platform === 'twitch') {
    const login = source.liveChannel || source.url?.match(/twitch\.tv\/([^/?#]+)/i)?.[1] || ''
    if (!login || /^(videos|directory|downloads|search)$/i.test(login)) return null
    return `https://player.twitch.tv/?channel=${encodeURIComponent(login)}&parent=${encodeURIComponent(host)}&autoplay=true&muted=true`
  }
  if (source.platform === 'kick') {
    const slug = source.liveChannel || source.url?.match(/kick\.com\/([^/?#]+)/i)?.[1] || ''
    if (!slug || /^(video|category|search|browse)$/i.test(slug)) return null
    return `https://player.kick.com/${encodeURIComponent(slug)}?autoplay=true&muted=true`
  }
  return null
}

const DEFAULT_CAM: CamBox = { x: 0.68, y: 0.02, w: 0.3, h: 0.36 }

/** Ajuste da caixa da webcam sem sair da live: vale para cortes atuais e futuros. */
function LiveCamEditor({ source }: { source: Source }) {
  const { api } = useApp()
  const [draft, setDraft] = useState<CamBox>({ ...(source.cam || DEFAULT_CAM) })
  const [busy, setBusy] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const apiRef = useRef(api)
  apiRef.current = api

  // A caixa manual do Estúdio é a fonte da verdade: abrir o ajuste não pode
  // sobrescrever o que o usuário já posicionou. A redetecção é explícita.
  useEffect(() => {
    if (source.cam) return
    const call = apiRef.current
    void detectCamBoxAuto('live', source.id, call).then(async (cam) => {
      if (!cam) return
      setDraft(cam)
      await call(`/api/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cam, applyCam: true }),
      })
    }).catch(() => {})
  }, [source.id])

  const redetect = async () => {
    setBusy(true)
    try {
      const cam = await detectCamBoxAuto('live', source.id, api)
      if (cam) {
        setDraft(cam)
        await api(`/api/sources/${source.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ cam, applyCam: true }),
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    try {
      await api(`/api/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cam: draft, applyCam: true }),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cam-manual live-cam">
      <div className="cam-manual-head">
        <span className="field-label">Caixa da webcam · ao vivo</span>
        <div className="live-cam-tools">
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setFrameKey(Date.now())}>
            Atualizar quadro
          </button>
          <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={redetect}>
            {busy ? '…' : 'Detectar automaticamente'}
          </button>
        </div>
      </div>
      <CamBoxCanvas
        imageUrl={`/api/live/${source.id}/frame?t=${frameKey}`}
        value={draft}
        onChange={setDraft}
      />
      <span className="cam-hint">Arraste a caixa para mover e os cantos para redimensionar.</span>
      <button type="button" className="btn btn-primary btn-sm w-full" disabled={busy} onClick={apply}>
        Aplicar à live e aos cortes
      </button>
    </div>
  )
}

export function VideosPage() {
  const { state, api, setIngestOpen, setIngestTab } = useApp()
  const [liveActing, setLiveActing] = useState('')
  const [watching, setWatching] = useState<Source | null>(null)
  const [liveWatching, setLiveWatching] = useState<Source | null>(null)
  const [confirm, setConfirm] = useState<Source | null>(null)
  const [removing, setRemoving] = useState(false)
  const [camEditFor, setCamEditFor] = useState('')
  const [radar, setRadar] = useState<RadarData | null>(null)
  const [findQuery, setFindQuery] = useState('')
  const [found, setFound] = useState<FoundVideo[] | null>(null)
  const [findBusy, setFindBusy] = useState(false)
  const [findError, setFindError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [downloadingIds, setDownloadingIds] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await publicGet('/api/radar')
        if (!res.ok) throw new Error('offline')
        const data = await res.json()
        if (alive) setRadar(data)
      } catch {
        if (alive) setRadar((prev) => prev || { ok: false, items: [], liveCount: 0 })
      }
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const sources = state?.sources || []
  const jobs = state?.jobs || []
  const running = jobs.filter((j) => j.status === 'running')
  const radarItems = radar ? (radar.kickOk === false ? radar.items.filter((i) => i.live) : radar.items) : []

  const openUpload = () => {
    setIngestTab('upload')
    setIngestOpen(true)
  }

  const openLive = () => {
    setIngestTab('live')
    setIngestOpen(true)
  }

  const stopMonitoring = async (source: Source) => {
    setLiveActing(source.id)
    try {
      await api(`/api/live/${source.id}/stop`, { method: 'POST' })
    } catch (e: any) {
      window.alert(e?.message || 'Não foi possível parar a live agora.')
    } finally {
      setLiveActing('')
    }
  }

  const resumeMonitoring = async (source: Source) => {
    setLiveActing(source.id)
    try {
      await api(`/api/live/${source.id}/start`, { method: 'POST' })
    } catch (e: any) {
    } finally {
      setLiveActing('')
    }
  }

  const searchVideos = async (term: string) => {
    const q = term.trim()
    if (q.length < 2) {
      setFindError('Digite um tema ou nome para buscar.')
      return
    }
    setFindQuery(q)
    setFindBusy(true)
    setFindError('')
    try {
      const res = await publicGet(`/api/videos/search?q=${encodeURIComponent(q)}`)
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after') || 0)
        throw new Error(retry > 60
          ? `Muitas requisições em instantes. Aguarde cerca de ${Math.ceil(retry / 60)} minuto(s) e tente novamente.`
          : RATE_LIMIT_MESSAGE)
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Busca indisponível.')
      setFound(Array.isArray(data.items) ? data.items : [])
    } catch (e: any) {
      setFound([])
      setFindError(friendlyMessage(e?.message || 'Não foi possível buscar vídeos agora.'))
    } finally {
      setFindBusy(false)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])
  }

  const downloadFound = async (items: FoundVideo[]) => {
    if (!items.length) return
    setFindError('')
    setDownloadingIds(items.map((item) => item.id))
    setDownloadProgress(0)
    let failed = 0
    let reason = ''
    for (const item of items) {
      try {
        await triggerDownload(await requestPreparedDownload(item.url, item.title, setDownloadProgress))
      } catch (error: any) {
        failed += 1
        reason = friendlyMessage(error?.message || '')
      }
      // O navegador pode bloquear downloads automáticos muito próximos uns dos
      // outros, então mantemos um intervalo entre os vídeos selecionados.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    setDownloadingIds([])
    setDownloadProgress(0)
    if (failed) {
      setFindError(friendlyMessage(reason || `${failed} vídeo(s) não puderam ser baixados. Tente de novo em instantes.`))
    }
  }

  const downloadSelected = () => {
    const items = (found || []).filter((item) => selectedIds.includes(item.id))
    void downloadFound(items)
  }

  const openStudio = (source: Source) => {
    const first = state?.clips.filter((c) => c.sourceId === source.id).sort((a, b) => a.start - b.start)[0]
    if (!first) return
    navigate('estudio', { clip: first.id })
  }

  const remove = async () => {
    if (!confirm) return
    setRemoving(true)
    try {
      await api(`/api/sources/${confirm.id}`, { method: 'DELETE' })
      setConfirm(null)
    } catch (e: any) {
      window.alert(e?.message || 'Não foi possível remover esta fonte agora.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Vídeos"
        actions={
          <button className="btn btn-primary" onClick={openUpload}>
            <Plus size={14} /> Enviar vídeo
          </button>
        }
      />

      <section className="ingest-hero panel">
        <div className="hero-glow" />
        <div className="hero-copy">
          <h2>Envie o vídeo.<br />Ou cole a live.</h2>
          <p>Envie seus vídeos gravados. Para lives, use a opção Nova fonte.</p>
          <div className="hero-form">
            <Radio size={15} />
            <span className="hero-hint">Lives da Twitch e da Kick</span>
            <button className="btn btn-live" type="button" onClick={openLive}>
              <Plus size={14} /> Adicionar live
            </button>
          </div>
          <div className="hero-live">
            <span className="hero-live-dot" />
            <div className="hero-live-copy">
              <b>Já tem um vídeo gravado?</b>
              <span>Envie o arquivo e o estúdio faz o resto.</span>
            </div>
            <button className="btn btn-live" type="button" onClick={openUpload}>
              <UploadCloud size={14} /> Enviar vídeo
            </button>
          </div>
        </div>
      </section>

      <section className="panel finder-panel">
        <div className="finder-head">
          <div>
            <b>Achar vídeos</b>
            <em>Escolha um ou vários vídeos, baixe e envie pelo botão “Enviar vídeo”.</em>
          </div>
          <span className="stage-pill">YouTube · gravados</span>
        </div>
        <form className="finder-form" onSubmit={(e) => { e.preventDefault(); void searchVideos(findQuery) }}>
          <Search size={15} />
          <input
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Ex.: Tiago da Titan 160, enquadros, flagrantes…"
            spellCheck={false}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={findBusy}>
            {findBusy ? <Logo size={13} className="btn-spin" /> : <Search size={14} />}
            {findBusy ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        <div className="finder-presets">
          {FIND_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`finder-chip ${findQuery === preset.query ? 'active' : ''}`}
              disabled={findBusy}
              onClick={() => { void searchVideos(preset.query) }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {findError && <p className="finder-error">{findError}</p>}
        {found && found.length === 0 && !findError && (
          <p className="finder-empty">Nenhum vídeo gravado encontrado para esse termo.</p>
        )}
        {selectedIds.length > 0 && (
          <div className="finder-bulk">
            <span className="mono">{selectedIds.length} selecionado(s)</span>
            <button className="btn btn-soft btn-sm" onClick={() => setSelectedIds([])} disabled={downloadingIds.length > 0}>
              Limpar
            </button>
            <button className="btn btn-primary btn-sm" onClick={downloadSelected} disabled={downloadingIds.length > 0}>
              {downloadingIds.length > 0 ? <Logo size={13} className="btn-spin" /> : <Download size={14} />}
              {downloadingIds.length > 0 ? `Baixando… ${downloadProgress}%` : 'Baixar selecionados'}
            </button>
          </div>
        )}
        {found && found.length > 0 && (
          <>
            <div className="finder-results">
              {found.map((item) => (
                <article className="finder-item" key={item.id}>
                  <label className="finder-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`Selecionar ${item.title}`}
                    />
                  </label>
                  <img className="finder-thumb" src={item.thumb} alt="" loading="lazy" />
                  <div className="finder-meta">
                    <b title={item.title}>{item.title}</b>
                    <em>
                      {item.channel}
                      {item.duration ? ` · ${fmtTime(item.duration)}` : ''}
                      {item.views ? ` · ${fmtViews(item.views)} visualizações` : ''}
                    </em>
                  </div>
                  <button
                    className="btn btn-soft btn-sm finder-add"
                    disabled={downloadingIds.includes(item.id)}
                    onClick={() => { void downloadFound([item]) }}
                  >
                    {downloadingIds.includes(item.id) ? <Logo size={13} className="btn-spin" /> : <Download size={14} />}
                    {downloadingIds.includes(item.id) ? `Baixando… ${downloadProgress}%` : 'Baixar'}
                  </button>
                </article>
              ))}
            </div>
            <p className="finder-empty">Os arquivos são preparados em 720p e baixados no seu navegador. Depois use “Enviar vídeo” para o estúdio cortar.</p>
          </>
        )}
      </section>

      {running.length > 0 && (
        <div className="running-panel panel">
          <div className="running-head">
            <span className="live-dot"><i /> PROCESSANDO</span>
            <span className="mono">{running.length} tarefa{running.length > 1 ? 's' : ''} em andamento</span>
          </div>
          {running.map((j) => {
            const src = sources.find((s) => s.id === j.sourceId)
            return (
              <div className="running-row" key={j.id}>
                <div className="rr-main">
                  <span className="rr-title">
                    <Logo size={14} className="rr-spin" />
                    <b>{j.kind === 'render' ? 'Preparando corte' : j.kind === 'compile' ? 'Montando vídeo longo' : j.kind === 'live' ? 'Monitorando a live' : src?.title || 'Processando vídeo'}</b>
                  </span>
                  <em>{j.kind === 'render' ? 'Ajustando o vídeo' : j.kind === 'compile' ? 'Juntando os melhores momentos' : j.kind === 'live' ? 'Acompanhando a transmissão' : 'Lendo o vídeo enviado'}</em>
                </div>
                <ProgressBar value={j.progress} animated />
                <span className="mono rr-pct">{j.progress}%</span>
              </div>
            )
          })}
        </div>
      )}

      {radar && (radarItems.length > 0 || radar.ok === false) && (
        <section className="panel radar-panel">
          <div className="radar-head">
            <div>
              <b>
                Canais brasileiros
                <em>{radar.ok === false ? 'radar indisponível agora' : radar.liveCount ? `${radar.liveCount} ao vivo agora` : 'nenhum ao vivo agora'}</em>
              </b>
            </div>
          </div>
          {radarItems.length > 0 && (
            <div className="radar-strip">
              {radarItems.map((item) => {
                const key = `${item.platform}:${item.login}`
                return (
                  <article className={`radar-card ${item.live ? 'is-live' : 'is-off'}`} key={key}>
                    {item.live && item.thumb && (
                      <img
                        className="radar-bg"
                        src={item.thumb}
                        alt=""
                        loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <div className="radar-top">
                      {item.avatar ? (
                        <img className="radar-avatar" src={item.avatar} alt="" loading="lazy" />
                      ) : (
                        <span className="radar-avatar radar-avatar-empty">{item.name.slice(0, 1)}</span>
                      )}
                      <span className={`radar-live ${item.live ? 'on' : ''}`}><i />{item.live ? 'ao vivo' : item.platform === 'twitch' ? 'twitch' : 'kick'}</span>
                    </div>
                    <b className="radar-name">{item.name}</b>
                    <em className="radar-game">{item.live ? item.game || 'Transmissão' : 'fora do ar'}</em>
                    <div className="radar-foot">
                      {item.live ? (
                        <span className="mono">{fmtViews(item.viewers)}</span>
                      ) : (
                        <span className="radar-ago">aparece aqui quando entrar ao vivo</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      <div className="section-head">
        <h2>Suas fontes <span className="mono">{String(sources.length).padStart(2, '0')}</span></h2>
      </div>

      {sources.length ? (
        <div className="source-grid">
          {sources.map((source) => {
            const job = jobs.find((j) => j.sourceId === source.id && j.status === 'running')
            const processing = source.status === 'processando'
            const isLive = source.mode === 'live'
            const liveOn = isLive && (source.status === 'ao-vivo' || Boolean(processing && job))
            const clips = (state?.clips || []).filter((c) => c.sourceId === source.id)
            const badge = isLive
              ? source.status === 'ao-vivo' ? 'AO VIVO' : source.status === 'erro' ? 'ATENÇÃO' : source.status === 'pronto' ? 'ENCERRADA' : 'CONECTANDO'
              : source.status === 'pronto' ? 'PRONTA' : source.status === 'erro' ? 'ATENÇÃO' : 'PROCESSANDO'
            const embed = isLive ? liveEmbed(source) : null
            const liveThumb = isLive && !source.thumb && source.liveId
              ? `https://i.ytimg.com/vi/${source.liveId}/hqdefault.jpg`
              : source.thumb
            return (
              <article className={`source-card panel ${processing || source.status === 'ao-vivo' ? 'is-processing' : ''}`} key={source.id}>
                <div className={`src-thumb ${liveOn ? 'is-live' : ''}`}>
                  {liveOn && !liveThumb ? <div className="src-img" /> : (
                    <Cover src={liveThumb} alt={source.title} className="src-img" />
                  )}
                  <div className="src-grad" />
                  {(processing && !isLive) && (
                    <div className="src-loading" aria-hidden="true"><Logo size={44} className="src-spin" /></div>
                  )}
                  {liveOn && (
                    <div className="live-sharingan" aria-hidden="true">
                      <Logo size={64} className="live-sharingan-mark" />
                    </div>
                  )}
                  <span className={`src-badge ${source.status} ${isLive ? 'live' : ''}`}>
                    {isLive && <Logo size={10} className="badge-spin" />}
                    {badge}
                  </span>
                  <span className="src-dur mono">{fmtTime(source.duration)}</span>
                  {(processing || source.status === 'ao-vivo') && (
                    <div className="src-progress">
                      <div className="sp-head">
                        <span className="sp-title">
                          <Logo size={12} className="badge-spin" />
                          <span className="mono">{source.status === 'ao-vivo' ? 'Acompanhando a transmissão' : jobLabel(job?.kind)}</span>
                        </span>
                        {source.status !== 'ao-vivo' && <span className="mono">{source.progress}%</span>}
                      </div>
                      {source.status === 'ao-vivo'
                        ? <div className="live-bar"><i /></div>
                        : <ProgressBar value={source.progress} animated />}
                      {source.status === 'ao-vivo' && source.liveAudioAt && (
                        <LiveAudioMeter level={source.liveAudioLevel} silent={source.liveAudioSilent} />
                      )}
                    </div>
                  )}
                </div>
                <div className="src-body">
                  <div className="src-channel">
                    {isLive ? <Radio size={12} /> : source.uploaded ? <UploadCloud size={12} /> : <Youtube size={12} />}
                    {source.channel || (isLive ? platformName(source) : source.uploaded ? 'Vídeo enviado' : 'Fonte conectada')}
                    {isLive && <span className="chip chip-mini chip-live">live</span>}
                  </div>
                  <h3>{source.title}</h3>
                  <div className="src-meta">
                    <span className="mono">{clips.length} cortes</span>
                    {isLive && typeof source.liveCaptions === 'number' && <><i /><span className="mono">{source.liveCaptions} falas</span></>}
                    <i />
                    <span className="mono">{isLive && source.status === 'ao-vivo' && source.liveStartedAt
                      ? `monitorando ${relTime(source.liveStartedAt)}`
                      : isLive && source.liveEndedAt
                        ? `encerrada ${relTime(source.liveEndedAt)}`
                        : relTime(source.addedAt)}</span>
                    {source.lastClipAt && <><i /><span className="mono">último corte {relTime(source.lastClipAt)}</span></>}
                    {!isLive && clips[0] && <TypeBadge type={clips[0].type} />}
                  </div>
                  {isLive && Boolean(source.liveCaptionLines?.length) && (
                    <div className="live-transcript">
                      {source.liveCaptionLines!.slice(-2).map((line, i) => (
                        <div className="lt-line" key={`${line.t}-${i}`}>
                          <span className="mono">{fmtTime(line.t)}</span>
                          <span>{line.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {source.error && (
                    <div className="src-error"><AlertTriangle size={13} /> {friendlyMessage(source.error)}</div>
                  )}
                  {isLive && !source.error && source.liveEndNote && (
                    <div className="src-note">{source.liveEndNote}</div>
                  )}
                  {isLive && camEditFor === source.id && <LiveCamEditor source={source} />}
                  <div className="src-actions">
                    <button className="btn btn-soft btn-sm" onClick={() => openStudio(source)} disabled={!clips.length}>
                      <Clapperboard size={13} /> Abrir estúdio
                    </button>
                    {isLive && (
                      <button
                        className="btn btn-soft btn-sm"
                        onClick={() => setCamEditFor(camEditFor === source.id ? '' : source.id)}
                      >
                        <Crop size={12} /> {camEditFor === source.id ? 'Fechar caixa' : 'Ajustar webcam'}
                      </button>
                    )}
                    {isLive && (
                      liveOn ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => stopMonitoring(source)} disabled={liveActing === source.id}>
                          {liveActing === source.id ? <span className="spinner" /> : <Square size={12} />} Parar
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => resumeMonitoring(source)} disabled={liveActing === source.id}>
                          {liveActing === source.id ? <span className="spinner" /> : <Radio size={12} />} Retomar acompanhamento
                        </button>
                      )
                    )}
                    {isLive && embed && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setLiveWatching(source)}>
                        <Play size={12} fill="currentColor" /> Assistir live
                      </button>
                    )}
                    {!isLive && source.hasMedia && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setWatching(source)}>
                        <Play size={12} fill="currentColor" /> Assistir
                      </button>
                    )}
                    <div className="grow" />
                    <button className="btn-icon danger" onClick={() => setConfirm(source)} aria-label="Remover fonte">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Youtube size={22} />}
          title="Nenhuma fonte conectada"
        />
      )}

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        kicker="FONTE"
        title="Remover esta fonte?"
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={remove} disabled={removing}>
              {removing ? <span className="spinner" /> : <Trash2 size={14} />} Remover
            </button>
          </>
        }
      >
        <p className="fine">Essa ação não pode ser desfeita.</p>
      </Modal>

      <PlayerModal
        open={Boolean(watching)}
        onClose={() => setWatching(null)}
        kicker="PLAYER · FONTE"
        title={watching?.title || 'Assistir fonte'}
        subtitle={watching ? `${watching.channel || 'Fonte'} · ${fmtTime(watching.duration)}` : ''}
        width={900}
        footer={
          <>
            <a
              className="btn btn-ghost"
              href={watching ? `/media/src/${watching.id}.mp4` : undefined}
              download={watching ? `${watching.id}.mp4` : undefined}
            >
              <Download size={14} /> Baixar vídeo
            </a>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setWatching(null)}>Fechar</button>
          </>
        }
      >
        {watching && (
          <video
            className="player-video"
            src={`/media/src/${watching.id}.mp4`}
            poster={watching.thumb}
            controls
            autoPlay
            playsInline
          />
        )}
      </PlayerModal>

      <PlayerModal
        open={Boolean(liveWatching)}
        onClose={() => setLiveWatching(null)}
        kicker="PLAYER · AO VIVO"
        title={liveWatching?.title || 'Assistir live'}
        subtitle={liveWatching ? `${liveWatching.channel || platformName(liveWatching)} · transmissão ao vivo` : ''}
        width={900}
      >
        {liveWatching && liveEmbed(liveWatching) && (
          <iframe
            className="player-embed"
            src={liveEmbed(liveWatching) || ''}
            title={liveWatching.title}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        )}
      </PlayerModal>
    </div>
  )
}
