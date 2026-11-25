import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check, Clapperboard, Crop, Download, Play, Scissors,
} from 'lucide-react'
import { useApp } from '../store'
import { CamBoxCanvas } from '../CamBoxCanvas'
import { navigate, useRoute } from '../router'
import { Preview } from '../components'
import { Dot, EmptyState, Logo, PageHead, ProgressBar, ScoreRing, Select, StagePill, TypeBadge } from '../ui'
import { fmtRange, fmtTime } from '../lib/format'
import { detectCamBoxAuto } from '../lib/camBox'
import type { CamBox, Clip, Source } from '../types'

const FRAMING_LABEL: Record<string, string> = {
  auto: '9:16 automático',
  preencher: 'Fundo desfocado',
  cam: 'Split',
  esquerda: 'Fundo à esquerda',
  centro: 'Fundo centralizado',
  direita: 'Fundo à direita',
}

const DEFAULT_CAM: CamBox = { x: 0.68, y: 0.02, w: 0.3, h: 0.36 }

export function EstudioPage() {
  const { state, api } = useApp()
  const route = useRoute()
  const clips = state?.clips || []

  const requested = route.params.get('clip')
  const clip: Clip | undefined = clips.find((c) => c.id === requested) || clips[0]
  const source = state?.sources.find((s) => s.id === clip?.sourceId)
  const sourceClips = useMemo(
    () => clips.filter((c) => c.sourceId === clip?.sourceId).sort((a, b) => a.start - b.start),
    [clips, clip?.sourceId],
  )
  const index = clip ? sourceClips.findIndex((c) => c.id === clip.id) : -1
  const duration = source?.duration || Math.max(...sourceClips.map((c) => c.end), 60)
  const jobs = state?.jobs || []
  const renderJob = clip ? jobs.find((j) => j.clipId === clip.id && j.status === 'running') : undefined
  // URL estável por corte: trocar o quadro a cada render derrubaria a caixa no meio do arraste.
  const frameUrl = useMemo(
    () => (clip ? `/api/clips/${clip.id}/frame?t=${Date.now()}` : ''),
    [clip?.id],
  )

  const [hook, setHook] = useState('')
  const [contextDraft, setContextDraft] = useState('')
  const [cutStart, setCutStart] = useState('0')
  const [cutEnd, setCutEnd] = useState('')
  const [trimming, setTrimming] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [camDraft, setCamDraft] = useState<CamBox>(DEFAULT_CAM)
  const [camBusy, setCamBusy] = useState(false)
  const autoCamDone = useRef<Set<string>>(new Set())
  const apiRef = useRef(api)
  apiRef.current = api
  const games = state?.settings?.niche === 'games'
  // Perseguição tem corte próprio: 9:16 ou 16:9, sempre sem caixa de crop.
  const chase = clip?.type === 'perseguicao'
  const aspect: '9:16' | '16:9' = chase && clip?.aspect === '16:9' ? '16:9' : '9:16'
  // Depende dos valores, não da identidade do objeto: o refresh periódico troca
  // a referência de clip.cam e clobberaria o ajuste manual a cada 1,4s.
  const camSig = clip?.cam
    ? `${clip.cam.x},${clip.cam.y},${clip.cam.w},${clip.cam.h}`
    : source?.cam
      ? `${source.cam.x},${source.cam.y},${source.cam.w},${source.cam.h}`
      : ''

  useEffect(() => {
    setHook(clip?.hook || '')
  }, [clip?.id, clip?.hook])

  useEffect(() => {
    setContextDraft(clip?.contextCaption || '')
  }, [clip?.id, clip?.contextCaption])

  useEffect(() => {
    setCamDraft({ ...(clip?.cam || source?.cam || DEFAULT_CAM) })
  }, [clip?.id, camSig])

  useEffect(() => {
    setCutStart('0')
    setCutEnd(String(Math.round((clip?.end || 0) - (clip?.start || 0))))
  }, [clip?.id, clip?.start, clip?.end])

  useEffect(() => {
    if (!clip || !source || autoCamDone.current.has(clip.id)) return
    if (clip.type === 'perseguicao') return
    autoCamDone.current.add(clip.id)
    // Nunca sobrescreve um ajuste manual (ou um ajuste já detectado). O auto
    // só roda uma vez, para clipes que ainda não têm caixa salva.
    if (clip.cam || source?.cam) return
    const call = apiRef.current
    void detectCamBoxAuto('clip', clip.id, call).then(async (cam) => {
      if (!cam) return
      setCamDraft(cam)
      // Salva só neste clipe: gravar na fonte espalharia a caixa para os
      // outros cortes e faria ela "andar" sozinha em cada reprocessamento.
      await call(`/api/clips/${clip.id}`, { method: 'PATCH', body: JSON.stringify({ cam }) })
    }).catch(() => {})
  }, [clip?.id, clip?.type, source?.id])

  const patchClip = async (patch: Partial<Clip>) => {
    if (!clip) return
    try {
      await api(`/api/clips/${clip.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1400)
    } catch (e: any) {
    }
  }

  const applyCamManual = async () => {
    if (!clip) return
    setCamBusy(true)
    try {
      await api(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cam: camDraft, framing: 'cam' }),
      })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1400)
    } catch {} finally {
      setCamBusy(false)
    }
  }

  const applyCamAll = async () => {
    if (!clip || !source) return
    setCamBusy(true)
    try {
      await api(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cam: camDraft, framing: 'cam' }),
      })
      await api(`/api/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cam: camDraft, applyCam: true }),
      })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1400)
    } catch {} finally {
      setCamBusy(false)
    }
  }

  const redetectCam = async () => {
    if (!clip) return
    setCamBusy(true)
    try {
      const cam = await detectCamBoxAuto('clip', clip.id, api)
      if (cam) {
        setCamDraft(cam)
        await api(`/api/clips/${clip.id}`, { method: 'PATCH', body: JSON.stringify({ cam }) })
      }
    } catch {} finally {
      setCamBusy(false)
    }
  }

  const render = async () => {
    if (!clip) return
    try {
      await api(`/api/clips/${clip.id}/render`, { method: 'POST' })
    } catch (e: any) {
    }
  }

  const trim = async (from?: number, to?: number) => {
    if (!clip) return
    const start = from ?? Number(cutStart)
    const end = to ?? Number(cutEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) {
      return
    }
    setTrimming(true)
    try {
      await api(`/api/clips/${clip.id}/trim`, {
        method: 'POST',
        body: JSON.stringify({ start, end }),
      })
    } catch (e: any) {
    } finally {
      setTrimming(false)
    }
  }

  if (!clip || !source) {
    return (
      <div className="page">
        <PageHead kicker="ESTÚDIO" title="Estúdio de cortes" />
        <EmptyState
          icon={<Clapperboard size={22} />}
          title="Nada no estúdio ainda"
          action={<button className="btn btn-primary" onClick={() => navigate('videos')}>Conectar fonte</button>}
        />
      </div>
    )
  }

  return (
    <div className="page page-studio">
      <PageHead
        kicker={`ESTÚDIO · ${source.channel || 'FONTE'}`}
        title={source.title}
        sub={`${sourceClips.length} cortes · ${fmtTime(duration)} de vídeo · corte ${index + 1} de ${sourceClips.length}`}
        actions={
          <>
            <Select
              value={source.id}
              onChange={(id) => {
                const first = clips.filter((c) => c.sourceId === id).sort((a, b) => a.start - b.start)[0]
                if (first) navigate('estudio', { clip: first.id })
              }}
              options={(state?.sources || []).map((s) => ({
                value: s.id,
                label: s.title,
                hint: `${s.clips} cortes · ${s.channel}`,
              }))}
              align="left"
            />
          </>
        }
      />

      <div className="studio-grid">
        <div className="studio-left">
          <div className="panel preview-panel">
            <div className="panel-head tight">
              <span className="mono">PRÉVIA {aspect}</span>
              <StagePill stage={clip.stage} />
            </div>
            <Preview clip={clip} source={source} aspect={aspect} />
            <div className="sp-meta">
              <TypeBadge type={clip.type} />
              <span className="mono">{fmtRange(clip.start, clip.end)}</span>
              <span className="mono">{Math.round(clip.end - clip.start)}s</span>
            </div>
          </div>
        </div>

        <div className="studio-center">
          <TimelineCanvas
            clip={clip}
            sourceClips={sourceClips}
            duration={duration}
            onSelect={(id) => navigate('estudio', { clip: id })}
            contextCaption={contextDraft}
            onContextCaptionChange={setContextDraft}
            onContextCaptionCommit={() => {
              if (contextDraft !== (clip.contextCaption || '')) void patchClip({ contextCaption: contextDraft })
            }}
          />
        </div>

        <div className="studio-right">
          <div className="panel">
            <div className="panel-head">
              <h3>Agentes</h3>
              {renderJob ? (
                <span className="chip chip-amber"><Dot tone="amber" pulse /> executando</span>
              ) : (
                <span className="chip chip-green"><Dot tone="green" /> prontos</span>
              )}
            </div>
            <div className="agent-list">
              <div className="agent-row">
                <span className="agent-ico"><Crop size={14} /></span>
                <div>
                  <b>Enquadramento</b>
                  <em>{chase ? `Sem caixa · ${aspect}` : (FRAMING_LABEL[clip.framing] || 'Split')}</em>
                </div>
                <span className="agent-state">pronto</span>
              </div>
            </div>
            {renderJob && (
              <div className="render-live">
                <div className="rl-head">
                  <span className="rl-title"><Logo size={16} className="rl-spin" /><span className="mono">Preparando o vídeo…</span></span>
                  <span className="mono">{renderJob.progress}%</span>
                </div>
                <ProgressBar value={renderJob.progress} animated />
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Ajustes do corte</h3>
              <span className="mono muted">#{String(index + 1).padStart(2, '0')}</span>
            </div>

            {clip.style === 'xracing' && <XracingEditor clip={clip} patchClip={patchClip} />}

            {chase ? (
              <>
                <label className="field-label">Formato do corte</label>
                <div className="segmented small">
                  {(['9:16', '16:9'] as const).map((a) => (
                    <button
                      key={a}
                      className={aspect === a ? 'active' : ''}
                      onClick={() => patchClip({ aspect: a, framing: 'centro' })}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <span className="cam-hint">
                  Sem caixa de crop: {aspect === '16:9'
                    ? 'o quadro inteiro é mantido, sem cortar as laterais.'
                    : 'o centro do quadro é enquadrado em vertical, sem caixa manual.'}
                </span>
              </>
            ) : (
              <>
                <label className="field-label">Enquadramento</label>
                {games ? (
                  <div className="segmented small">
                    <button className="active">Split</button>
                  </div>
                ) : (
                  <div className="segmented small scrollable">
                    {(['auto', 'preencher', 'cam', 'esquerda', 'centro', 'direita'] as const).map((f) => (
                      <button
                        key={f}
                        className={clip.framing === f ? 'active' : ''}
                        onClick={() => patchClip({ framing: f })}
                      >
                        {f === 'auto' ? 'Auto' : f === 'preencher' ? 'Fundo' : f === 'esquerda' ? 'Esq.' : f === 'direita' ? 'Dir.' : f === 'cam' ? 'Split' : 'Centro'}
                      </button>
                    ))}
                  </div>
                )}

                {clip.framing === 'cam' && (
                  <div className="cam-manual">
                    <div className="cam-manual-head">
                      <span className="field-label">Caixa da webcam</span>
                      <button type="button" className="btn btn-soft btn-sm" disabled={camBusy} onClick={redetectCam}>
                        {camBusy ? '…' : 'Detectar automaticamente'}
                      </button>
                    </div>
                    <CamBoxCanvas
                      imageUrl={frameUrl}
                      value={camDraft}
                      onChange={setCamDraft}
                    />
                    <span className="cam-hint">Arraste a caixa para mover e os cantos para redimensionar.</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-soft btn-sm" style={{ flex: 1 }} disabled={camBusy} onClick={applyCamManual}>
                        Aplicar neste corte
                      </button>
                      <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={camBusy} onClick={applyCamAll}>
                        Aplicar a todos os clipes
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <label className="field-label">Gancho do corte</label>
            <textarea
              className="hook-input"
              rows={3}
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              onBlur={() => { if (hook.trim() && hook !== clip.hook) patchClip({ hook: hook.trim() }) }}
            />
            <div className="hook-meta">
              <span className="mono">{hook.length} caract.</span>
              <span className={`mono ${savedFlash ? 'saved' : ''}`}>{savedFlash ? 'salvo' : 'salva ao sair'}</span>
            </div>

            <div className="trim-box">
              <div className="trim-head"><Scissors size={13} /><b>Ajustar o trecho</b></div>
              <span className="fine">Se ficou grande, mantenha só o trecho que importa.</span>
              {' '}
              <span className="mono muted">{Math.round(clip.end - clip.start)}s no total</span>
              <div className="trim-row">
                <label>
                  <span className="mono">DE (S)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.5"
                    value={cutStart}
                    onChange={(e) => setCutStart(e.target.value)}
                  />
                </label>
                <label>
                  <span className="mono">ATÉ (S)</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="0.5"
                    value={cutEnd}
                    onChange={(e) => setCutEnd(e.target.value)}
                  />
                </label>
              </div>
              <div className="trim-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => trim(0, Math.min(15, Math.round(clip.end - clip.start)))}
                  disabled={trimming || Boolean(renderJob) || !(source.hasMedia || clip.media || clip.renderedUrl)}
                >
                  Manter 15s
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => trim()}
                  disabled={trimming || Boolean(renderJob) || !(source.hasMedia || clip.media || clip.renderedUrl)}
                >
                  {trimming ? <Logo size={13} className="btn-spin" /> : <Scissors size={14} />}
                  {trimming ? 'Recortando…' : 'Aplicar recorte'}
                </button>
              </div>
              {!(source.hasMedia || clip.media || clip.renderedUrl) && (
                <span className="fine center">O vídeo deste corte não está disponível.</span>
              )}
            </div>

            <div className="approve-row">
              <StagePill stage={clip.stage} />
              <button
                className="link-btn"
                onClick={() => patchClip({ stage: clip.stage === 'rascunho' ? 'aprovado' : 'rascunho' })}
              >
                {clip.stage === 'rascunho' ? <><Check size={12} /> Aprovar corte</> : 'Voltar para rascunho'}
              </button>
            </div>

            <div className="render-box">
              {source.hasMedia || clip.renderedUrl || clip.media ? (
                <>
                  <button
                    className="btn btn-primary w-full"
                    onClick={render}
                    disabled={Boolean(renderJob) || !(source.hasMedia || clip.renderedUrl)}
                  >
                    {renderJob ? <Logo size={13} className="btn-spin" /> : <Play size={14} fill="currentColor" />}
                    {renderJob ? 'Preparando…' : clip.renderedUrl ? 'Atualizar vídeo' : 'Gerar corte'}
                  </button>
                  {(clip.renderedUrl || clip.media) && (
                    <a
                      className="btn btn-ghost w-full"
                      href={clip.renderedUrl || clip.media}
                      download={`${clip.id}.mp4`}
                    >
                      <Download size={14} /> {clip.renderedUrl ? 'Salvar corte final' : 'Baixar corte'}
                    </a>
                  )}
                  {!clip.renderedUrl && !clip.media && source.hasMedia && (
                    <a
                      className="btn btn-ghost w-full"
                      href={`/media/src/${source.id}.mp4`}
                      download={`${source.id}.mp4`}
                    >
                      <Download size={14} /> Baixar vídeo original
                    </a>
                  )}
                </>
              ) : (
                <>
                  <button className="btn btn-ghost w-full" disabled>
                    <Play size={14} /> Gerar corte
                  </button>
                  <span className="fine center">A fonte deste corte não está mais disponível. Conecte o link de novo.</span>
                  <button className="link-btn center" onClick={() => navigate('videos')}>Conectar fonte</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Ajustes finos do corte gerado pelo motor XRacing (tudo em segundos da fonte). */
function XracingEditor({
  clip, patchClip,
}: {
  clip: Clip
  patchClip: (patch: Partial<Clip>) => Promise<void>
}) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [speed, setSpeed] = useState('0.5')
  const [zoom, setZoom] = useState('1.3')
  const [bleeps, setBleeps] = useState('')

  const replay = clip.replay
  const bleepSig = (clip.bleeps || []).map((b) => `${b.start}-${b.end}`).join(', ')
  const signature = `${replay?.start}|${replay?.end}|${replay?.speed}|${replay?.zoom}|${bleepSig}`
  useEffect(() => {
    setStart(replay ? String(replay.start) : '')
    setEnd(replay ? String(replay.end) : '')
    setSpeed(String(replay?.speed ?? 0.5))
    setZoom(String(replay?.zoom ?? 1.3))
    setBleeps(bleepSig)
  }, [signature])

  const num = (v: string) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
  }
  const commitReplay = () => {
    const s = num(start)
    const e = num(end)
    if (s === null || e === null || e - s < 0.5) return
    void patchClip({
      replay: {
        start: s, end: e,
        speed: Math.min(0.9, Math.max(0.5, num(speed) ?? 0.5)),
        zoom: Math.min(2, Math.max(1, num(zoom) ?? 1.3)),
      },
    })
  }
  const commitBleeps = () => {
    const next = bleeps.split(',').map((part) => {
      const [a, b] = part.split('-').map((x) => Number(x.trim()))
      return Number.isFinite(a) && Number.isFinite(b) && b > a
        ? { start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100 }
        : null
    }).filter((b): b is { start: number; end: number } => Boolean(b)).slice(0, 60)
    void patchClip({ bleeps: next })
  }

  return (
    <div className="trim-box">
      <div className="trim-head"><Clapperboard size={13} /><b>Motor XRacing</b></div>
      <span className="fine">Replay do pico em câmera lenta com zoom, bipes e legenda verde.</span>

      <label className="field-label">Replay (segundos da fonte)</label>
      <div className="trim-row">
        <label>
          <span className="mono">DE</span>
          <input className="input" type="number" step="0.5" value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitReplay} />
        </label>
        <label>
          <span className="mono">ATÉ</span>
          <input className="input" type="number" step="0.5" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commitReplay} />
        </label>
      </div>
      <div className="trim-row">
        <label>
          <span className="mono">VELOCIDADE</span>
          <select className="input" value={speed} disabled={!replay} onChange={(e) => { setSpeed(e.target.value); void patchClip({ replay: { ...(replay || { start: 0, end: 0 }), speed: Number(e.target.value) } }) }}>
            <option value="0.5">0,5x</option>
            <option value="0.75">0,75x</option>
          </select>
        </label>
        <label>
          <span className="mono">ZOOM</span>
          <select className="input" value={zoom} disabled={!replay} onChange={(e) => { setZoom(e.target.value); void patchClip({ replay: { ...(replay || { start: 0, end: 0 }), zoom: Number(e.target.value) } }) }}>
            <option value="1">1,0x</option>
            <option value="1.3">1,3x</option>
            <option value="1.6">1,6x</option>
          </select>
        </label>
      </div>

      <label className="field-label">Bipes (intervalos: 139.11-139.77, 153.97-154.73)</label>
      <textarea
        className="hook-input"
        rows={2}
        value={bleeps}
        placeholder="Sem palavrões detectados"
        onChange={(e) => setBleeps(e.target.value)}
        onBlur={commitBleeps}
      />
      <span className="cam-hint">Legenda: caixa alta, verde, até 3 linhas e 15–30s na tela. Edite em “Legenda da ocorrência”.</span>
    </div>
  )
}

function TimelineCanvas({
  clip, sourceClips, duration, onSelect, contextCaption, onContextCaptionChange, onContextCaptionCommit,
}: {
  clip: Clip
  sourceClips: Clip[]
  duration: number
  onSelect: (id: string) => void
  contextCaption: string
  onContextCaptionChange: (value: string) => void
  onContextCaptionCommit: () => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const segRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [lines, setLines] = useState<{ id: string; d: string; active: boolean }[]>([])
  const [svgH, setSvgH] = useState(400)

  const recalc = useCallback(() => {
    const canvas = canvasRef.current
    const strip = stripRef.current
    if (!canvas || !strip) return
    const cRect = canvas.getBoundingClientRect()
    const sRect = strip.getBoundingClientRect()
    const next: { id: string; d: string; active: boolean }[] = []
    for (const c of sourceClips) {
      const seg = segRefs.current[c.id]
      const card = cardRefs.current[c.id]
      if (!seg || !card) continue
      const sr = seg.getBoundingClientRect()
      const cr = card.getBoundingClientRect()
      const cx = cr.left + cr.width / 2
      if (cx < sRect.left + 2 || cx > sRect.right - 2) continue
      const x1 = sr.left + sr.width / 2 - cRect.left
      const y1 = sr.bottom - cRect.top
      const x2 = cx - cRect.left
      const y2 = cr.top - cRect.top
      const midY = (y1 + y2) / 2
      next.push({
        id: c.id,
        d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${midY.toFixed(1)}, ${x2.toFixed(1)} ${midY.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
        active: c.id === clip.id,
      })
    }
    setLines((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
    setSvgH((prev) => Math.round(cRect.height) === prev ? prev : cRect.height)
  }, [sourceClips, clip.id])

  useLayoutEffect(() => {
    recalc()
    const t = setTimeout(recalc, 80)
    window.addEventListener('resize', recalc)
    return () => { clearTimeout(t); window.removeEventListener('resize', recalc) }
  }, [recalc])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    strip.addEventListener('scroll', recalc, { passive: true })
    return () => strip.removeEventListener('scroll', recalc)
  }, [recalc])

  useEffect(() => {
    const strip = stripRef.current
    const card = cardRefs.current[clip.id]
    if (!strip || !card) return
    const left = card.offsetLeft - strip.clientWidth / 2 + card.clientWidth / 2
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [clip.id])

  const ticks = Array.from({ length: 9 }, (_, i) => ({ pct: (i / 8) * 100, label: fmtTime((duration * i) / 8.01) }))

  return (
    <div className="panel studio-canvas">
      <div className="cv-head">
        <div>
          <span className="kicker">LINHA DO TEMPO</span>
          <b>{sourceClips.length} cortes · {fmtTime(duration)}</b>
        </div>
        <div className="cv-legend">
          <span><i className="lg-hold" /> corte</span>
          <span><i className="lg-sel" /> selecionado</span>
        </div>
      </div>

      <div className="canvas" ref={canvasRef}>
        <div className="lane-zone">
          <div className="ruler">
            {ticks.map((t, i) => (
              <span key={i} className="tick" style={{ left: `${t.pct}%` }}>
                <i />{t.label}
              </span>
            ))}
          </div>
          <div className="lane">
            <div className="lane-dots" />
            {sourceClips.map((c, i) => {
              const left = (c.start / duration) * 100
              const width = Math.max(1.4, ((c.end - c.start) / duration) * 100)
              return (
                <button
                  key={c.id}
                  ref={(el) => { segRefs.current[c.id] = el }}
                  className={`hold ${c.id === clip.id ? 'active' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onClick={() => onSelect(c.id)}
                  title={c.hook}
                >
                  <span className="hold-tag">{String(i + 1).padStart(2, '0')}</span>
                  <span className="hold-fill" />
                </button>
              )
            })}
          </div>
        </div>

        <svg className="connectors" width="100%" height={svgH} aria-hidden>
          {lines.map((l) => (
            <g key={l.id} className={l.active ? 'active' : ''}>
              <path d={l.d} fill="none" strokeDasharray="3 6" />
              <circle cx={l.d.split(' ')[1]} cy={l.d.split(' ')[2]} r="2.4" />
            </g>
          ))}
        </svg>

        <div className="strip-zone">
          <div className="strip" ref={stripRef}>
            {sourceClips.map((c, i) => (
              <button
                key={c.id}
                ref={(el) => { cardRefs.current[c.id] = el }}
                className={`strip-card ${c.id === clip.id ? 'active' : ''}`}
                onClick={() => onSelect(c.id)}
              >
                <div className="sc-thumb">
                  <img src={c.cover} alt={c.hook} loading="lazy" />
                  <span className="sc-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="sc-dur mono">{Math.round(c.end - c.start)}s</span>
                </div>
                <span className="sc-title">{c.hook}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cv-foot">
        <div className="cf-main">
          <div className="cf-row">
            <TypeBadge type={clip.type} size="md" />
            <span className="mono">{fmtRange(clip.start, clip.end)}</span>
            <span className="cf-score"><ScoreRing score={clip.score} size={30} /></span>
          </div>
          <p>{clip.hook}</p>
        </div>
        <div className="cf-transcript">
          <span className="kicker mono">LEGENDA DA OCORRÊNCIA</span>
          <input
            className="input"
            value={contextCaption}
            maxLength={110}
            placeholder="Ex.: Deu pinote e não bancou a curva"
            onChange={(e) => onContextCaptionChange(e.target.value)}
            onBlur={onContextCaptionCommit}
          />
          <span className="fine">Fica 15–30s na tela; textos maiores ganham mais tempo.</span>
          <span className="kicker mono">LEGENDAS</span>
          {clip.captionLines?.length ? clip.captionLines.slice(-5).map((line, i) => (
            <div className="tr-line" key={`${line.t}-${i}`}>
              <span className="mono">{fmtTime(line.t)}</span>
              <em>{line.text}</em>
            </div>
          )) : <span className="fine">Sem legendas para este corte.</span>}
        </div>
      </div>
    </div>
  )
}
