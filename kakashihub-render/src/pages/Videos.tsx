import { useEffect, useState } from 'react'
import {
  AlertTriangle, Clapperboard,
  Play, Plus, Radio, RefreshCw, Square, Trash2, UploadCloud, Youtube,
} from 'lucide-react'
import { useApp } from '../store'
import { navigate } from '../router'
import { PlayerModal } from '../components'
import { Cover, EmptyState, Logo, Modal, PageHead, ProgressBar, TypeBadge } from '../ui'
import { fmtTime, fmtViews, relTime } from '../lib/format'
import type { Source } from '../types'

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

function normalizeLink(raw: string) {
  const t = raw.trim()
  if (/^@[\w.-]+$/.test(t)) return `https://www.youtube.com/${t}`
  if (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(t)) return `https://${t}`
  return t
}

function platformName(source: Source) {
  if (source.platform === 'twitch') return 'Twitch'
  if (source.platform === 'kick') return 'Kick'
  return 'YouTube'
}

function liveEmbed(source: Source): string | null {
  const host = window.location.hostname
  const origin = window.location.origin
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
  if (source.platform === 'youtube') {
    const id = source.liveId || source.url?.match(/(?:[?&]v=|\/live\/|youtu\.be\/)([\w-]{6,})/)?.[1] || ''
    if (!id) return null
    return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`
  }
  return null
}

export function VideosPage() {
  const { state, api, toast, setIngestOpen, setIngestTab } = useApp()
  const [url, setUrl] = useState('')
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveActing, setLiveActing] = useState('')
  const [watching, setWatching] = useState<Source | null>(null)
  const [liveWatching, setLiveWatching] = useState<Source | null>(null)
  const [confirm, setConfirm] = useState<Source | null>(null)
  const [removing, setRemoving] = useState(false)
  const [radar, setRadar] = useState<RadarData | null>(null)
  const [radarBusy, setRadarBusy] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/radar')
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

  const startLive = async () => {
    const target = normalizeLink(url)
    if (!/^https?:\/\//i.test(target)) {
      toast('Cole o link da transmissão ao vivo.', 'error')
      return
    }
    if (!/twitch\.tv|youtube\.com|youtu\.be|kick\.com/i.test(target)) {
      toast('Use o link de uma live da Twitch, do YouTube ou da Kick.', 'error')
      return
    }
    setLiveBusy(true)
    try {
      await api('/api/live', { method: 'POST', body: JSON.stringify({ url: target }) })
      setUrl('')
      toast('Monitorando a live. Os cortes aparecem aqui em instantes.', 'success')
    } catch (e: any) {
      toast(e.message || 'Não foi possível monitorar esta live.', 'error')
    } finally {
      setLiveBusy(false)
    }
  }

  const radarOn = (item: RadarItem) => sources.some((s) =>
    s.mode === 'live'
    && s.platform === item.platform
    && (s.url || '').toLowerCase().includes(`/${item.login.toLowerCase()}`)
    && s.status !== 'pronto'
    && s.status !== 'erro',
  )

  const monitorRadar = async (item: RadarItem) => {
    const key = `${item.platform}:${item.login}`
    setRadarBusy(key)
    try {
      await api('/api/live', {
        method: 'POST',
        body: JSON.stringify({ url: `https://www.${item.platform}.com/${item.login}` }),
      })
      toast(`Monitorando ${item.name}. Os cortes aparecem aqui em instantes.`, 'success')
    } catch (e: any) {
      toast(e.message || 'Não foi possível monitorar agora.', 'error')
    } finally {
      setRadarBusy('')
    }
  }

  const stopMonitoring = async (source: Source) => {    setLiveActing(source.id)
    try {
      await api(`/api/live/${source.id}/stop`, { method: 'POST' })
      toast('Monitoramento encerrado. Os cortes já estão no acervo.', 'info')
    } catch (e: any) {
      toast(e.message || 'Não foi possível encerrar agora.', 'error')
    } finally {
      setLiveActing('')
    }
  }

  const resumeMonitoring = async (source: Source) => {
    setLiveActing(source.id)
    try {
      await api(`/api/live/${source.id}/start`, { method: 'POST' })
      toast('Voltamos a monitorar a transmissão.', 'success')
    } catch (e: any) {
      toast(e.message || 'Não foi possível retomar agora.', 'error')
    } finally {
      setLiveActing('')
    }
  }

  const openStudio = (source: Source) => {
    const first = state?.clips.filter((c) => c.sourceId === source.id).sort((a, b) => a.start - b.start)[0]
    if (!first) return toast('Esta fonte ainda não tem cortes.', 'error')
    navigate('estudio', { clip: first.id })
  }

  const reanalyze = async (source: Source) => {
    try {
      await api(`/api/sources/${source.id}/analyze`, { method: 'POST' })
      toast('Analisando a fonte de novo. Os cortes serão atualizados.', 'info')
    } catch (e: any) {
      toast(e.message || 'Não foi possível analisar agora.', 'error')
    }
  }

  const remove = async () => {
    if (!confirm) return
    setRemoving(true)
    try {
      await api(`/api/sources/${confirm.id}`, { method: 'DELETE' })
      toast('Fonte removida do acervo.', 'success')
      setConfirm(null)
    } catch (e: any) {
      toast(e.message || 'Não foi possível remover a fonte.', 'error')
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
          <p>Envie seus vídeos gravados. Para lives, cole o link.</p>
          <form className="hero-form" onSubmit={(e) => { e.preventDefault(); startLive() }}>
            <Radio size={15} />
            <input
              id="hero-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Link da live (YouTube, Twitch ou Kick)"
              spellCheck={false}
            />
            <button className="btn btn-live" disabled={liveBusy} type="submit">
              {liveBusy ? <span className="spinner" /> : <Radio size={14} />}
              {liveBusy ? 'Conectando…' : 'Monitorar live'}
            </button>
          </form>
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

      {running.length > 0 && (
        <div className="running-panel panel">
          <div className="running-head">
            <span className="live-dot"><i /> ANALISANDO</span>
            <span className="mono">{running.length} tarefa{running.length > 1 ? 's' : ''} em andamento</span>
          </div>
          {running.map((j) => {
            const src = sources.find((s) => s.id === j.sourceId)
            return (
              <div className="running-row" key={j.id}>
                <div className="rr-main">
                  <b>{j.kind === 'render' ? 'Preparando corte' : j.kind === 'compile' ? 'Montando vídeo longo' : j.kind === 'live' ? 'Monitorando a live' : src?.title || 'Analisando vídeo'}</b>
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
                        <>
                          <span className="mono">{fmtViews(item.viewers)}</span>
                          {radarOn(item) ? (
                            <span className="radar-on">monitorando</span>
                          ) : (
                            <button className="btn btn-live btn-sm" onClick={() => monitorRadar(item)} disabled={radarBusy === key}>
                              {radarBusy === key ? <span className="spinner" /> : <Radio size={12} />} Monitorar
                            </button>
                          )}
                        </>
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
              : source.status === 'pronto' ? 'PRONTA' : source.status === 'erro' ? 'ATENÇÃO' : 'ANALISANDO'
            const embed = isLive ? liveEmbed(source) : null
            return (
              <article className={`source-card panel ${processing || source.status === 'ao-vivo' ? 'is-processing' : ''}`} key={source.id}>
                <div className="src-thumb">
                  <Cover src={source.thumb} alt={source.title} className="src-img" />
                  <div className="src-grad" />
                  {processing && !isLive && (
                    <div className="src-loading" aria-hidden="true"><Logo size={44} className="src-spin" /></div>
                  )}
                  <span className={`src-badge ${source.status} ${isLive ? 'live' : ''}`}>{badge}</span>
                  <span className="src-dur mono">{fmtTime(source.duration)}</span>
                  {(processing || source.status === 'ao-vivo') && (
                    <div className="src-progress">
                      <div className="sp-head">
                        <span className="mono">{job?.step || (source.status === 'ao-vivo' ? 'Ao vivo · acompanhando a transmissão' : 'Preparando a fonte')}</span>
                        {source.status !== 'ao-vivo' && <span className="mono">{source.progress}%</span>}
                      </div>
                      {source.status === 'ao-vivo'
                        ? <div className="live-bar"><i /></div>
                        : <ProgressBar value={source.progress} animated />}
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
                    <i />
                    <span className="mono">{isLive && source.status === 'ao-vivo' && source.liveStartedAt
                      ? `monitorando ${relTime(source.liveStartedAt)}`
                      : isLive && source.liveEndedAt
                        ? `encerrada ${relTime(source.liveEndedAt)}`
                        : relTime(source.addedAt)}</span>
                    {source.lastClipAt && <><i /><span className="mono">último corte {relTime(source.lastClipAt)}</span></>}
                    {!isLive && clips[0] && <TypeBadge type={clips[0].type} />}
                  </div>
                  {source.error && (
                    <div className="src-error"><AlertTriangle size={13} /> {source.error}</div>
                  )}
                  <div className="src-actions">
                    <button className="btn btn-soft btn-sm" onClick={() => openStudio(source)} disabled={!clips.length}>
                      <Clapperboard size={13} /> Abrir estúdio
                    </button>
                    {isLive ? (
                      liveOn ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => stopMonitoring(source)} disabled={liveActing === source.id}>
                          {liveActing === source.id ? <span className="spinner" /> : <Square size={12} />} Parar
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => resumeMonitoring(source)} disabled={liveActing === source.id}>
                          {liveActing === source.id ? <span className="spinner" /> : <Radio size={12} />} Monitorar de novo
                        </button>
                      )
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => reanalyze(source)} disabled={processing}>
                        <RefreshCw size={13} /> Analisar de novo
                      </button>
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
