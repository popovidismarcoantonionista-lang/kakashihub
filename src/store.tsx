import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { State } from './types'

export type IngestTab = 'upload' | 'live'

interface Ctx {
  state: State | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
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
export function friendlyMessage(message: unknown) {
  const text = String(message || '').trim()
  if (!text || TECHNICAL_ERROR.test(text)) return 'Não foi possível concluir agora. Tente novamente.'
  return text
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [ingestTab, setIngestTab] = useState<IngestTab>('upload')
  const emptyStreak = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (!res.ok) throw new Error('offline')
      const data = await res.json()
      if (!isUsableState(data)) throw new Error('estado-invalido')

      // Um wipe completo e isolado (ex.: fallback de DB após restart) não deve
      // apagar a tela. Só aceitamos depois de algumas leituras consistentes.
      if (hasContent(state) && !hasContent(data)) {
        emptyStreak.current += 1
        if (emptyStreak.current < 3) {
          setError('O acervo está temporariamente indisponível. Tentando novamente…')
          return
        }
      } else {
        emptyStreak.current = 0
      }

      setState(data)
      setError(null)
    } catch {
      setError('Não foi possível falar com o estúdio.')
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 7000)
    return () => clearInterval(t)
  }, [refresh])

  const running = state?.jobs?.some((j) => j.status === 'running')
    || state?.uploads?.some((u) => u.status === 'enviando')
  useEffect(() => {
    if (!running) return
    const t = setInterval(refresh, 1400)
    return () => clearInterval(t)
  }, [running, refresh])

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    const res = await fetch(path, {
      ...init,
      headers: isForm ? { ...(init?.headers || {}) } : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(friendlyMessage(data?.error))
    }
    refresh()
    return data
  }, [refresh])

  const value = useMemo(() => ({
    state, loading, error, refresh, api, ingestOpen, setIngestOpen, ingestTab, setIngestTab,
  }), [state, loading, error, refresh, api, ingestOpen])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  return useContext(AppCtx)
}
