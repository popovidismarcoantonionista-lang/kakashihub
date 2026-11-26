import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, Clapperboard, Plus, Radio, Scissors,
  Search, Settings2, Sparkles, UploadCloud, Youtube, ChevronRight, X,
} from 'lucide-react'
import { DIRECT_API, directPost, publicGet, useApp } from './store'
import { navigate, useRoute } from './router'
import { Logo, Modal, Dot } from './ui'
import { todayLabel } from './lib/format'
import type { Page } from './types'

const TABS: { key: Page; label: string; icon: React.ReactNode }[] = [
  { key: 'videos', label: 'Vídeos', icon: <Youtube size={13} /> },
  { key: 'cortes', label: 'Cortes', icon: <Scissors size={13} /> },
  { key: 'estudio', label: 'Estúdio', icon: <Clapperboard size={13} /> },
  { key: 'uploads', label: 'Uploads', icon: <UploadCloud size={13} /> },
  { key: 'ia', label: 'IA', icon: <Sparkles size={13} /> },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const { state, setIngestOpen, setIngestTab } = useApp()
  const route = useRoute()
  const jobs = state?.jobs || []
  const running = jobs.filter((j) => j.status === 'running')
  const counts: Partial<Record<Page, number>> = {
    cortes: state?.clips.length || 0,
    uploads: state?.uploads.filter((u) => u.status === 'agendado' || u.status === 'enviando').length || 0,
    videos: state?.sources.length || 0,
  }

  return (
    <div className="shell">
      <header className="head">
        <div className="topbar">
          <button className="brand" onClick={() => navigate('cortes')} aria-label="Início">
            <Logo size={30} />
            <div className="brand-word">
              <b>KAKASHI</b>
              <span>HUB</span>
            </div>
          </button>
          <div className="top-sep" />
          <button className="workspace" onClick={() => navigate('ia')}>
            <span className="ws-avatar">RF</span>
            <span className="ws-text">
              <b>{state?.project.name || 'Meu estúdio'}</b>
              <em>{state?.project.niche || 'Cortes de fuga e enquadro'}</em>
            </span>
            <Settings2 size={13} className="ws-gear" />
          </button>

          <div className="grow" />
          <SearchBox />
          <div className={`radar ${running.length ? 'busy' : ''}`} title={running.length ? 'Estúdio processando uma fonte' : 'Tudo pronto por aqui'}>
            <Dot tone={running.length ? 'amber' : 'green'} pulse />
            {running.length ? `Processando ${running.length} fonte${running.length > 1 ? 's' : ''}` : 'Estúdio pronto'}
          </div>
          <button className="btn-icon" aria-label="Notificações"><Bell size={15} /><i className="notif" /></button>
          <button className="btn-icon" aria-label="Ajustes" onClick={() => navigate('ia')}><Settings2 size={15} /></button>
          <button className="avatar" aria-label="Perfil"><Logo size={22} className="avatar-eye" /></button>
          <button
            className="btn btn-primary btn-sm mobile-new-source"
            aria-label="Adicionar vídeo ou live"
            onClick={() => { setIngestTab('upload'); setIngestOpen(true) }}
          >
            <Plus size={14} />
            <span className="label-full">Adicionar vídeo ou live</span>
            <span className="label-short">Adicionar</span>
          </button>
        </div>

        <div className="tabbar">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${route.page === t.key ? 'active' : ''}`}
                onClick={() => navigate(t.key)}
              >
                {t.icon}
                <span>{t.label}</span>
                {counts[t.key] != null && counts[t.key]! > 0 && <i className="tab-count">{String(counts[t.key]).padStart(2, '0')}</i>}
              </button>
            ))}
          </nav>
          <div className="tab-right">
            <span className="date-chip mono">{todayLabel()} · 2026</span>
            <button className="btn btn-primary btn-sm" aria-label="Adicionar vídeo ou live" onClick={() => { setIngestTab('upload'); setIngestOpen(true) }}>
              <Plus size={14} />
              <span className="label-full">Adicionar vídeo ou live</span>
              <span className="label-short">Adicionar</span>
            </button>
          </div>
        </div>
      </header>

      <main className="main">{children}</main>
      <IngestModal />
    </div>
  )
}

function SearchBox() {
  const { state } = useApp()
  const [q, setQ] = useState('')
  const [focus, setFocus] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current?.focus()
      }
      if (e.key === 'Escape') { ref.current?.blur(); setFocus(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setFocus(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (query.length < 2 || !state) return []
    const clips = state.clips
      .filter((c) => c.hook.toLowerCase().includes(query) || c.hashtags.join(' ').toLowerCase().includes(query))
      .slice(0, 5)
      .map((c) => ({ kind: 'Corte', label: c.hook, sub: `${c.type} · ${Math.round(c.end - c.start)}s`, action: () => navigate('estudio', { clip: c.id }) }))
    const sources = state.sources
      .filter((s) => s.title.toLowerCase().includes(query) || s.channel.toLowerCase().includes(query))
      .slice(0, 3)
      .map((s) => ({ kind: 'Fonte', label: s.title, sub: s.channel, action: () => navigate('videos') }))
    return [...clips, ...sources]
  }, [q, state])

  return (
    <div className="search" ref={boxRef}>
      <Search size={14} />
      <input
        ref={ref}
        value={q}
        placeholder="Buscar cortes e fontes…"
        onChange={(e) => { setQ(e.target.value); setFocus(true) }}
        onFocus={() => setFocus(true)}
      />
      {q ? (
        <button className="search-clear" onClick={() => setQ('')} aria-label="Limpar"><X size={12} /></button>
      ) : (
        <kbd>⌘K</kbd>
      )}
      {focus && results.length > 0 && (
        <div className="search-pop">
          {results.map((r, i) => (
            <button key={i} className="search-row" onClick={() => { r.action(); setFocus(false); setQ(''); }}>
              <span className="sr-kind">{r.kind}</span>
              <span className="sr-main"><b>{r.label}</b><em>{r.sub}</em></span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IngestModal() {
  const { ingestOpen, setIngestOpen, api, refresh, ingestTab, setIngestTab } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const isUpload = ingestTab === 'upload'

  const close = () => {
    if (busy) return
    setIngestOpen(false)
    setError('')
  }

  const chooseFile = (picked?: File | null) => {
    if (!picked) return
    setFile(picked)
    setError('')
  }

  const submitUpload = async () => {
    if (!file) {
      setError('Escolha um vídeo para começar.')
      return
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setError('O arquivo passa de 2 GB. Envie um vídeo menor.')
      return
    }
    setBusy(true)
    setUploadProgress(0)
    setError('')
    try {
      const { source, upload } = await directPost('/api/sources/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
      })
      const chunkSize = Number(upload?.chunkSize) || 4 * 1024 * 1024
      const totalParts = Math.max(1, Math.ceil(file.size / chunkSize))
      for (let part = 0; part < totalParts; part += 1) {
        const start = part * chunkSize
        const chunk = file.slice(start, Math.min(file.size, start + chunkSize))
        const res = await fetch(
          `${DIRECT_API}/api/sources/upload-chunk?sourceId=${encodeURIComponent(source.id)}&part=${part}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-upload-token': String(upload.token),
            },
            body: chunk,
          },
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || 'Não foi possível enviar este pedaço do vídeo.')
        }
        setUploadProgress(Math.round(((part + 1) / totalParts) * 95))
      }
      try {
        await directPost('/api/sources/upload-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: source.id, token: upload.token }),
        })
        setUploadProgress(100)
      } catch (error) {
        // Uma falha transitória ao persistir não pode virar erro na tela se o
        // servidor já iniciou a análise: o job está na fila e vai aparecer.
        const fresh = await publicGet('/api/state')
          .then((res) => res.json()).catch(() => null)
        const started = fresh?.sources?.some((item: { id: string; status: string }) =>
          item.id === source.id && ['processando', 'pronto'].includes(item.status))
        if (!started) throw error
      }
      await refresh(true)
      setIngestOpen(false)
      setFile(null)
      navigate('videos')
    } catch (e: any) {
      setError(e.message || 'Não foi possível enviar este vídeo.')
    } finally {
      setBusy(false)
      setUploadProgress(0)
    }
  }

  const submitLive = async () => {
    const url = text.trim()
    if (!/^https?:\/\//i.test(url)) {
      setError('Cole o link da transmissão ao vivo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/live', { method: 'POST', body: JSON.stringify({ url }) })
      setIngestOpen(false)
      setText('')
      navigate('videos')
    } catch (e: any) {
      setError(e.message || 'Não foi possível monitorar esta live.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={ingestOpen}
      onClose={close}
      kicker="NOVA FONTE"
      title={isUpload ? 'Envie o vídeo. O estúdio faz o resto.' : 'Cole o link da live. Acompanhe ao vivo.'}
      footer={
        <>
          <div className="grow" />
          <button className="btn btn-ghost" onClick={close} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" onClick={isUpload ? submitUpload : submitLive} disabled={busy}>
            {busy ? <span className="spinner" /> : isUpload ? <UploadCloud size={14} /> : <Radio size={14} />}
            {busy ? isUpload && uploadProgress > 0 ? `Enviando… ${Math.round(uploadProgress)}%` : 'Enviando…' : isUpload ? 'Enviar vídeo' : 'Monitorar live'}
          </button>
        </>
      }
    >
      <div className="segmented ingest-tabs">
        <button className={isUpload ? 'active' : ''} onClick={() => { setIngestTab('upload'); setError('') }} disabled={busy}>
          <UploadCloud size={12} /> Enviar vídeo
        </button>
        <button className={!isUpload ? 'active' : ''} onClick={() => { setIngestTab('live'); setError('') }} disabled={busy}>
          <Radio size={12} /> Monitorar live
        </button>
      </div>
      <div className="ingest-form">
        {isUpload ? (
          <>
            <label className="field-label">Arquivo de vídeo</label>
            <div
              className={`upload-drop ${dragging ? 'dragging' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault()
                setDragging(false)
                chooseFile(e.dataTransfer.files?.[0])
              }}
            >
              <UploadCloud size={19} />
              <b>{file ? file.name : 'Clique ou arraste um vídeo aqui'}</b>
              <span>MP4, MOV, WebM, MKV ou AVI · até 2 GB</span>
              <input
                ref={fileRef}
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                hidden
                onChange={(e) => chooseFile(e.target.files?.[0])}
              />
            </div>
          </>
        ) : (
          <>
            <label className="field-label">Link da transmissão</label>
            <textarea
              className="textarea mono"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'https://www.twitch.tv/canal\nhttps://kick.com/canal'}
              autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
            />
          </>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
