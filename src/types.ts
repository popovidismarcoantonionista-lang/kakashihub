export type ClipType =
  | 'fuga' | 'enquadro' | 'perseguicao' | 'abordagem'
  | 'jogada' | 'clutch' | 'reacao' | 'treta'
  | 'momento'
export type Niche = 'fuga' | 'games' | 'geral'
export type Page = 'cortes' | 'videos' | 'estudio' | 'uploads' | 'ia'

export interface CamBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Source {
  id: string
  title: string
  channel: string
  duration: number
  thumb: string
  status: 'pronto' | 'processando' | 'erro' | 'ao-vivo'
  progress: number
  clips: number
  addedAt: string
  url?: string
  originalUrl?: string
  youtubeId?: string
  error?: string
  hasMedia?: boolean
  analyzedAt?: string
  cam?: CamBox
  mode?: 'live' | 'vod'
  uploaded?: boolean
  upload?: { name: string; size: number; type: string }
  platform?: 'twitch' | 'youtube' | 'kick'
  liveStartedAt?: string
  liveCheckedAt?: string
  liveEndedAt?: string
  lastClipAt?: string
  liveId?: string
  liveChannel?: string
  captureMode?: 'browser' | 'server'
  liveCaptureLastAt?: number
  liveLastError?: string | null
  liveAudioLevel?: number | null
  liveAudioPeak?: number | null
  liveAudioSilent?: boolean
  liveAudioAt?: string
  liveCaptions?: number
  liveCaptionLines?: CaptionLine[]
}

export interface CaptionLine {
  t: number
  text: string
}

export interface Clip {
  id: string
  sourceId: string
  hook: string
  type: ClipType
  start: number
  end: number
  score: number
  niche?: Niche
  stage: 'rascunho' | 'aprovado' | 'renderizado'
  framing: 'auto' | 'preencher' | 'esquerda' | 'centro' | 'direita' | 'cam'
  framingBias?: number
  cam?: CamBox
  cover: string
  hashtags: string[]
  captionLines: CaptionLine[]
  description: string
  createdAt: string
  renderedUrl?: string
  renderedAt?: string
  cut?: { start: number; end: number }
  media?: string
  live?: { at: number; stamp: string }
}

export type Platform = 'youtube' | 'tiktok' | 'facebook'

export interface Upload {
  id: string
  clipId: string | null
  compilationId?: string | null
  platform: Platform
  title: string
  scheduledAt: string
  status: 'agendado' | 'enviando' | 'publicado' | 'erro'
  externalUrl?: string
  externalId?: string
  error?: string | null
  createdAt?: string
  publishedAt?: string
}

export interface Connection {
  platform: Platform
  label: string
  connected: boolean
  credentials: boolean
  account: string
  pageId: string
  connectedAt: string | null
}

export interface Compilation {
  id: string
  title: string
  clipIds: string[]
  duration: number
  status: 'processando' | 'pronto' | 'erro'
  progress: number
  url: string
  cover: string
  error?: string | null
  createdAt: string
  finishedAt?: string
}

export interface Settings {
  niche: Niche
  clipMin: number
  clipMax: number
  framing: string
  format: string
  resolution: '720p' | '1080p' | '4k'
  autoApprove: boolean
  agents: Record<string, boolean>
}

export interface Job {
  id: string
  kind: 'ingest' | 'render' | 'analyze' | 'compile' | 'live'
  sourceId?: string
  clipId?: string
  compilationId?: string
  status: 'running' | 'concluido' | 'erro'
  progress: number
  step: string
  error?: string
  log: { at: string; text: string }[]
  startedAt: string
  finishedAt?: string | null
}

export interface Activity {
  id: string
  at: string
  kind: string
  text: string
}

export interface ChannelLogo {
  url: string
  x: number
  y: number
  w: number
  opacity: number
}

export interface State {
  project: { name: string; handle: string; niche: string; channel: string; logo?: ChannelLogo | null }
  settings: Settings
  sources: Source[]
  clips: Clip[]
  uploads: Upload[]
  activity: Activity[]
  compilations: Compilation[]
  jobs: Job[]
  updatedAt: string
}

export const CLIP_TYPES: { key: ClipType; label: string; niche: Niche | 'both' }[] = [
  { key: 'fuga', label: 'Fuga', niche: 'fuga' },
  { key: 'enquadro', label: 'Enquadro', niche: 'fuga' },
  { key: 'perseguicao', label: 'Perseguição', niche: 'fuga' },
  { key: 'abordagem', label: 'Abordagem', niche: 'fuga' },
  { key: 'jogada', label: 'Jogada', niche: 'games' },
  { key: 'clutch', label: 'Clutch', niche: 'games' },
  { key: 'reacao', label: 'Reação', niche: 'games' },
  { key: 'treta', label: 'Treta', niche: 'games' },
  { key: 'momento', label: 'Momento', niche: 'both' },
]

export const NICHE_OPTIONS: { key: Niche; label: string; hint: string }[] = [
  { key: 'fuga', label: 'Perseguições', hint: 'fuga, enquadro e abordagem' },
  { key: 'games', label: 'Games', hint: 'jogadas, clutch e reações de live' },
  { key: 'geral', label: 'Geral', hint: 'melhores momentos de qualquer vídeo' },
]
