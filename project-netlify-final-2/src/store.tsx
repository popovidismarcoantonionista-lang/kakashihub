import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { State } from './types'

type Tone = 'success' | 'error' | 'info'
export type IngestTab = 'upload' | 'live'
interface Toast { id: number; text: string; tone: Tone }

interface Ctx {
  state: State | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  api: (path: string, init?: RequestInit) => Promise<any>
  toast: (text: string, tone?: Tone) => void
  toasts: Toast[]
  dismiss: (id: number) => void
  ingestOpen: boolean
  setIngestOpen: (v: boolean) => void
  ingestTab: IngestTab
  setIngestTab: (tab: IngestTab) => void
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [ingestOpen, setIngestOpen] = useState(false)
  const [ingestTab, setIngestTab] = useState<IngestTab>('upload')
  const toastId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback((text: string, tone: Tone = 'info') => {
    const id = toastId.current++
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state')
      if (!res.ok) throw new Error('offline')
      const data = await res.json()
      setState(data)
      setError(null)
    } catch {
      setError('Não foi possível falar com o estúdio.')
    } finally {
      setLoading(false)
    }
  }, [])

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
      const msg = data?.error || 'Algo deu errado. Tente novamente.'
      throw new Error(msg)
    }
    refresh()
    return data
  }, [refresh])

  const value = useMemo(() => ({
    state, loading, error, refresh, api, toast, toasts, dismiss, ingestOpen, setIngestOpen, ingestTab, setIngestTab,
  }), [state, loading, error, refresh, api, toast, toasts, dismiss, ingestOpen])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  return useContext(AppCtx)
}
