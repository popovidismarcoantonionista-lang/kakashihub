import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Frame, Pause, Play, Radio, Sparkles, Youtube } from 'lucide-react'
import type { Clip, Source } from './types'
import { fmtRange, fmtTime } from './lib/format'
import { Cover, Modal, ScoreRing, StagePill, TypeBadge } from './ui'

export function ClipCard({ clip, source, onOpen, onPlay }: { clip: Clip; source?: Source; onOpen: () => void; onPlay?: () => void }) {
  return (
    <article className="clip-card" onClick={onOpen} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="clip-thumb">
        <Cover src={clip.cover} alt={clip.hook} className="clip-img" />
        <div className="clip-grad" />
        <div className="clip-top">
          <TypeBadge type={clip.type} />
          <ScoreRing score={clip.score} size={36} />
        </div>
        <button
          type="button"
          className="clip-play"
          aria-label="Assistir agora"
          onClick={(e) => { e.stopPropagation(); (onPlay || onOpen)() }}
        >
          <Play size={16} fill="currentColor" />
        </button>
        <div className="clip-bot">
          <span className="tc">{fmtRange(clip.start, clip.end)}{clip.live ? ' da live' : ''}</span>
          <span className="dur">{Math.round(clip.end - clip.start)}s</span>
        </div>
      </div>
      <h3>{clip.hook}</h3>
      <div className="clip-meta">
        {source?.mode === 'live' ? <Radio size={11} /> : <Youtube size={11} />}
        <span>{source?.channel || 'Fonte'} · {source?.title ? source.title.slice(0, 34) + (source.title.length > 34 ? '…' : '') : 'sem fonte'}</span>
      </div>
      <div className="clip-foot">
        <div className="clip-hash">{clip.hashtags.slice(0, 2).join('  ')}</div>
        <StagePill stage={clip.stage} />
      </div>
    </article>
  )
}

export function PlayerModal({
  open, onClose, kicker, title, subtitle, width = 860, children, footer,
}: {
  open: boolean
  onClose: () => void
  kicker?: string
  title: string
  subtitle?: string
  width?: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker={kicker}
      title={title}
      subtitle={subtitle}
      width={width}
      footer={footer ?? (<><div className="grow" /><button className="btn btn-ghost" onClick={onClose}>Fechar</button></>)}
    >
      <div className="player-stage">{children}</div>
    </Modal>
  )
}

export function ClipPlayer({ clip, source }: { clip: Clip; source?: Source }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const live = Boolean(clip.media)
  const raw = !clip.renderedUrl && !live && source?.hasMedia ? `/media/src/${source.id}.mp4` : null
  const src = clip.renderedUrl || clip.media || raw

  if (!src || failed) {
    return (
      <div className="player-empty">
        <Play size={20} />
        <b>Este corte ainda não tem vídeo para assistir.</b>
        <span>Gere o corte no estúdio e ele aparece aqui, pronto para assistir.</span>
      </div>
    )
  }

  return (
    <video
      ref={ref}
      className="player-video"
      src={src}
      poster={clip.cover}
      controls
      autoPlay
      playsInline
      onLoadedMetadata={() => { const v = ref.current; if (v && raw) v.currentTime = clip.start }}
      onTimeUpdate={() => { const v = ref.current; if (v && raw && v.currentTime >= clip.end) v.pause() }}
      onError={() => setFailed(true)}
    />
  )
}

export function Preview({ clip, source, compact = false }: { clip: Clip; source?: Source; compact?: boolean }) {
  const duration = Math.max(1, clip.end - clip.start)
  const rendered = Boolean(clip.renderedUrl)
  const liveSrc = clip.media || null
  const rawSrc = liveSrc || (source?.hasMedia ? `/media/src/${source.id}.mp4` : null)
  const from = liveSrc ? 0 : clip.start
  const plain = rendered || Boolean(liveSrc)
  const src = clip.renderedUrl || rawSrc
  const videoRef = useRef<HTMLVideoElement>(null)
  const gameRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [guide, setGuide] = useState(false)
  const [natAspect, setNatAspect] = useState(16 / 9)
  const cam = clip.framing === 'cam'
    ? (clip.cam || source?.cam || (clip.niche === 'games'
      ? { x: 0.71, y: 0.26, w: 0.27, h: 0.4 }
      : { x: 0.68, y: 0.02, w: 0.3, h: 0.36 }))
    : null
  const split = Boolean(cam && src)

  useEffect(() => {
    setElapsed(0)
    setPlaying(false)
    const v = videoRef.current
    if (v && rawSrc) {
      v.currentTime = from
      v.pause()
    }
  }, [clip.id, from, clip.renderedUrl, rawSrc])

  useEffect(() => {
    if (src) return
    if (!playing) return
    const t = setInterval(() => {
      setElapsed((e) => (e + 0.1 >= duration ? 0 : e + 0.1))
    }, 100)
    return () => clearInterval(t)
  }, [playing, src, duration])

  const syncGame = (t: number) => {
    const g = gameRef.current
    if (g && Math.abs(g.currentTime - t) > 0.3) { try { g.currentTime = t } catch {} }
  }

  const toggle = () => {
    const v = videoRef.current
    if (v && src) {
      if (v.paused) {
        if (rawSrc && (v.currentTime < from || v.currentTime > from + duration - 0.2)) v.currentTime = from
        syncGame(v.currentTime)
        v.play().catch(() => {})
        gameRef.current?.play().catch(() => {})
        setPlaying(true)
      } else {
        v.pause()
        gameRef.current?.pause()
        setPlaying(false)
      }
      return
    }
    setPlaying((p) => !p)
  }

  const onTime = () => {
    const v = videoRef.current
    if (!v) return
    if (rawSrc && !rendered) {
      const e = v.currentTime - from
      setElapsed(Math.max(0, Math.min(duration, e)))
      if (e >= duration) { v.pause(); gameRef.current?.pause(); setPlaying(false) }
    } else {
      setElapsed(v.currentTime)
      if (v.currentTime >= duration) { v.pause(); gameRef.current?.pause(); setPlaying(false) }
    }
    syncGame(v.currentTime)
  }

  const onMeta = () => {
    const v = videoRef.current
    if (v && v.videoWidth && v.videoHeight) setNatAspect(v.videoWidth / v.videoHeight)
    const g = gameRef.current
    if (v && rawSrc) { try { v.currentTime = from } catch {} }
    if (g && rawSrc) { try { g.currentTime = from } catch {} }
  }

  const splitStyles = () => {
    if (!cam) return null
    const band = 720 / 640
    const camW = cam.w * natAspect
    const s = Math.max(band / camW, 1 / cam.h)
    const gameS = Math.max(band / natAspect, 1)
    const gw = (natAspect * gameS / band) * 100
    return {
      cam: {
        width: `${(natAspect * s / band) * 100}%`,
        height: `${s * 100}%`,
        left: `${50 - ((cam.x * natAspect + camW / 2) * s / band) * 100}%`,
        top: `${50 - ((cam.y + cam.h / 2) * s) * 100}%`,
      },
      game: { width: `${gw}%`, height: `${gameS * 100}%`, left: `${(100 - gw) / 2}%`, top: `${(100 - gameS * 100) / 2}%` },
    }
  }
  const panes = splitStyles()

  const pct = Math.min(100, (elapsed / duration) * 100)

  return (
    <div className={`preview ${compact ? 'preview-compact' : ''}`}>
      <div className={`pv-frame ${playing ? 'is-playing' : ''}`}>
        {src && split && panes ? (
          <div className="pv-split" onClick={toggle}>
            <div className="pv-pane">
              <video
                ref={videoRef}
                className="pv-split-video"
                style={panes.cam}
                src={src}
                playsInline
                muted={!plain}
                onLoadedMetadata={onMeta}
                onTimeUpdate={onTime}
                onEnded={() => { setPlaying(false); gameRef.current?.pause() }}
              />
            </div>
            <div className="pv-pane">
              <video
                ref={gameRef}
                className="pv-split-video"
                style={panes.game}
                src={src}
                playsInline
                muted
                preload="auto"
                onLoadedMetadata={() => { const g = gameRef.current; if (g && rawSrc) { try { g.currentTime = from } catch {} } }}
              />
            </div>
          </div>
        ) : src ? (
          <video
            ref={videoRef}
            className="pv-video"
            src={src}
            playsInline
            muted={!plain}
            onClick={toggle}
            onTimeUpdate={onTime}
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <Cover src={clip.cover} alt={clip.hook} className="pv-img" />
        )}
        <div className="pv-shade" />
        <div className="pv-top">
          <span className="chip chip-glass"><Frame size={11} /> 9:16</span>
          {split && <span className="chip chip-glass">Webcam sobre o jogo</span>}
          <span className="chip chip-glass mono">{fmtTime(plain ? elapsed : from + elapsed)}</span>
        </div>
        {guide && (
          <div className="pv-guides" aria-hidden>
            <span className="pg-line pg-top" />
            <span className="pg-line pg-bottom" />
          </div>
        )}
        <div className="pv-progress"><span style={{ width: `${pct}%` }} /></div>
        {!playing && (
          <button className="pv-play" onClick={toggle} aria-label="Reproduzir">
            <Play size={18} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="pv-controls">
        <button className="btn-icon sm" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="mono pv-tc">{fmtTime(plain ? elapsed : from + elapsed)} / {fmtTime(plain ? duration : clip.end)}</span>
        <div className="grow" />
        <button className={`btn-icon sm ${guide ? 'active' : ''}`} onClick={() => setGuide(!guide)} title="Área segura">
          <Frame size={14} />
        </button>
      </div>
    </div>
  )
}

export function AiChip({ children }: { children: React.ReactNode }) {
  return <span className="ai-chip"><Sparkles size={10} />{children}</span>
}

export function OpenStudio({ onClick }: { onClick: () => void }) {
  return (
    <button className="link-btn" onClick={onClick}>
      Abrir no estúdio <ArrowUpRight size={13} />
    </button>
  )
}
