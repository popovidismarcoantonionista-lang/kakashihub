import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { State } from './types'

export type IngestTab = 'upload' | 'live'

interface Ctx {
  state: State | null
  loading: boolean
  error: string | null
  refresh: (force?: boolean) => Promise<void>
  api: (path: string, init?: RequestInit) => Promise<any>
  ingestOpen: boolean
  setIngestOpen: (v: boolean) => void
  ingestTab: IngestTab
  setIngestTab: (tab: IngestTab) => void
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx)

function isUsableState(data: unknown): data is State {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const candidate = data as Partial<State>
  return Boolean(candidate.project && typeof candidate.project === 'object'
    && candidate.settings && typeof candidate.settings === 'object'
    && Array.isArray(candidate.sources)
    && Array.isArray(candidate.clips)
    && Array.isArray(candidate.uploads)
    && Array.isArray(candidate.activity)
    && Array.isArray(candidate.compilations)
    && Array.isArray(candidate.jobs))
}

const hasContent = (value: State | null) => Boolean(
  value && (value.sources?.length || value.clips?.length || value.uploads?.length || value.compilations?.length),
)

const TECHNICAL_ERROR = /banco|postgres|database|indisponível|proxy|render|ffmpeg|servidor|api|workflow|cobalt|yt-dlp|invidious|relay|store|job|502|503/i
const RATE_LIMIT_ERROR = /429|muitas requisi|too many requests|rate limit/i
export const RATE_LIMIT_MESSAGE = 'Muitas requisições em instantes. Aguarde um pouco e tente novamente.'

export function friendlyMessage(message: unknown) {
  const text = String(message || '').trim()
  if (RATE_LIMIT_ERROR.test(text)) return RATE_LIMIT_MESSAGE
  if (!text || TECHNICAL_ERROR.test(text)) return 'Não foi possível concluir agora. Tente novamente.'
  return text
}

// O domínio compartilhado do container limita a 100 requisições/minuto por IP.
// Várias abas não devem multiplicar esse número: uma busca por vez, no máximo
// a cada poucos segundos, compartilhada entre as abas pelo BroadcastChannel.
const STATE_CHANNEL = 'kakashihub-state'
const LAST_FETCH_KEY = 'kakashihub:lastFetchAt'
const MIN_FETCH_GAP = 2000

// Leituras públicas vão direto ao container (IP do visitante), evitando o IP
// compartilhado do proxy Netlify. Escritas continuam passando pelo proxy.
export const DIRECT_API = 'https://kakashihub-b283a.containers.snapdeploy.app'

export async function publicGet(path: string): Promise<Response> {
  try {
    const res = await fetch(`${DIRECT_API}${path}`, { cache: 'no-store' })
    // 403 (gate antigo), 429 e 503 (container acordando) ainda podem usar o proxy.
    const fallback = res.status === 403 || res.status === 429 || res.status >= 500
    if (!fallback) return res
  } catch {}
  return fetch(path, { cache: 'no-store' })
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [ingestTab, setIngestTab] = useState<IngestTab>('upload')
  const emptyStreak = useRef(0)
  const stateRef = useRef<State | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const applyState = useCallback((data: State) => {
    // Um wipe completo e isolado (ex.: fallback de DB após restart) não deve
    // apagar a tela. Só aceitamos depois de algumas leituras consistentes.
    if (hasContent(stateRef.current) && !hasContent(data)) {
      emptyStreak.current += 1
      if (emptyStreak.current < 3) {
        setError('O acervo está temporariamente indisponível. Tentando novamente…')
        return
      }
    } else {
      emptyStreak.current = 0
    }
    stateRef.current = data
    setState(data)
    setError(null)
  }, [])

  const refresh = useCallback(async (force = false) => {
    try {
      const now = Date.now()
      if (!force && now - Number(localStorage.getItem(LAST_FETCH_KEY) || 0) < MIN_FETCH_GAP) return
      const res = await publicGet('/api/state')
      if (res.status === 429) {
        setError(RATE_LIMIT_MESSAGE)
        return
      }
      if (!res.ok) throw new Error('offline')
      const data = await res.json()
      if (!isUsableState(data)) throw new Error('estado-invalido')

      localStorage.setItem(LAST_FETCH_KEY, String(Date.now()))
      applyState(data)
      channelRef.current?.postMessage({ type: 'state', data, at: Date.now() })
    } catch {
      setError('Não foi possível falar com o estúdio.')
    } finally {
      setLoading(false)
    }
  }, [applyState])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(STATE_CHANNEL)
    channelRef.current = channel
    channel.onmessage = (event) => {
      const data = event.data?.data
      const at = Number(event.data?.at || 0)
      if (isUsableState(data) && Date.now() - at < 10000) {
        localStorage.setItem(LAST_FETCH_KEY, String(Date.now()))
        applyState(data)
      }
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [applyState])

  // Um único timer (o antigo tinha dois simultâneos) e mais espaçado: o backend
  // fica no domínio compartilhado do SnapDeploy, com limite de 100 req/min/IP.
  const running = state?.jobs?.some((j) => j.status === 'running')
    || state?.uploads?.some((u) => u.status === 'enviando')
  useEffect(() => {
    const delay = running ? 3000 : 10000
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (document.visibilityState === 'visible') await refresh()
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [refresh, running])

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    const res = await fetch(path, {
      ...init,
      headers: isForm ? { ...(init?.headers || {}) } : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 429) throw new Error(RATE_LIMIT_MESSAGE)
      throw new Error(friendlyMessage(data?.error))
    }
    refresh(true)
    return data
  }, [refresh])

  const value = useMemo(() => ({
    state, loading, error, refresh, api, ingestOpen, setIngestOpen, ingestTab, setIngestTab,
  }), [state, loading, error, refresh, api, ingestOpen, ingestTab])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  return useContext(AppCtx)
}
