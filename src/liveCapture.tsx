import { useEffect, useRef, useState } from 'react'
import { LiveCaptureSession, type CaptureConfig } from './lib/liveCapture'
import { useApp } from './store'
import type { Source } from './types'

// Silêncio de 0,1 s em WAV. Mantém a aba "audível" para o navegador não
// suspender os timers quando o usuário troca de app no celular.
const SILENT_WAV = 'UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/** Mantém uma sessão de captura por live do YouTube marcada para captura no navegador. */
export function LiveCapture() {
  const { state, api } = useApp()
  const [config, setConfig] = useState<CaptureConfig | null>(null)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const sessions = useRef(new Map<string, LiveCaptureSession>())
  const keepAlive = useRef<HTMLAudioElement | null>(null)
  const latest = useRef<Source[]>([])
  latest.current = (state?.sources || []) as Source[]
  const liveCount = latest.current.filter((s) =>
    s.captureMode === 'browser' && s.status === 'ao-vivo' && !s.liveEndedAt,
  ).length

  useEffect(() => {
    let alive = true
    const load = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch('/api/live/capture-config', { cache: 'no-store' })
          if (res.ok) {
            const value = await res.json()
            if (alive && value?.mirror) { setConfig(value); return }
          }
        } catch {}
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800))
      }
    }
    void load()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!config) return
    const wanted = new Set<string>()
    for (const source of latest.current) {
      if (source.captureMode !== 'browser' || source.status !== 'ao-vivo' || source.liveEndedAt) continue
      wanted.add(source.id)
      if (sessions.current.has(source.id)) continue
      const session = new LiveCaptureSession(
        source.id,
        () => latest.current.find((item) => item.id === source.id),
        api,
        config,
        (id, message) => setStatuses((old) => ({ ...old, [id]: message })),
      )
      sessions.current.set(source.id, session)
      session.start()
    }
    for (const [id, session] of sessions.current) {
      if (wanted.has(id)) continue
      session.stop()
      sessions.current.delete(id)
      setStatuses((old) => {
        const next = { ...old }
        delete next[id]
        return next
      })
    }
  }, [config, api, state?.sources])

  // Com áudio ativo o Android não congela os timers da aba em segundo plano.
  useEffect(() => {
    if (!config || !liveCount) {
      keepAlive.current?.pause()
      keepAlive.current = null
      return
    }
    if (!keepAlive.current) {
      const audio = new Audio(`data:audio/wav;base64,${SILENT_WAV}`)
      audio.loop = true
      audio.volume = 0.01
      keepAlive.current = audio
    }
    const play = () => { void keepAlive.current?.play().catch(() => {}) }
    play()
    document.addEventListener('visibilitychange', play)
    return () => document.removeEventListener('visibilitychange', play)
  }, [config, liveCount])

  useEffect(() => () => {
    for (const session of sessions.current.values()) session.stop()
    sessions.current.clear()
    keepAlive.current?.pause()
    keepAlive.current = null
  }, [])

  const entries = Object.entries(statuses)
  if (!entries.length) return null
  return (
    <div className="capture-status" title="Mantenha esta aba aberta para capturar a transmissão">
      {entries.slice(0, 2).map(([id, message]) => (
        <div key={id}><b>●</b> {message}</div>
      ))}
    </div>
  )
}
