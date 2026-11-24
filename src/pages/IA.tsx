import { useEffect, useState } from 'react'
import {
  AudioLines, Check, CheckCircle2, Clapperboard, Crop, ImagePlus, Lightbulb,
  RefreshCw, Scissors, Sparkles, Trash2, UploadCloud, Youtube,
} from 'lucide-react'
import { useApp } from '../store'
import { navigate } from '../router'
import { PageHead, ProgressBar, Select, Switch } from '../ui'
import { relTime } from '../lib/format'
import { NICHE_OPTIONS } from '../types'
import type { Niche } from '../types'

export function IAPage() {
  const { state, api } = useApp()
  const settings = state?.settings
  const [draft, setDraft] = useState({
    clipMin: settings?.clipMin ?? 18,
    clipMax: settings?.clipMax ?? 38,
  })
  const [saving, setSaving] = useState(false)
  const [channel, setChannel] = useState(state?.project?.channel ?? '')
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoDraft, setLogoDraft] = useState(() => ({
    x: state?.project?.logo?.x ?? 0.5,
    y: state?.project?.logo?.y ?? 0.88,
    w: state?.project?.logo?.w ?? 0.28,
    opacity: state?.project?.logo?.opacity ?? 1,
  }))

  useEffect(() => {
    if (!settings) return
    setDraft({
      clipMin: settings.clipMin,
      clipMax: settings.clipMax,
    })
  }, [settings?.clipMin, settings?.clipMax])

  useEffect(() => {
    setChannel(state?.project?.channel ?? '')
  }, [state?.project?.channel])

  useEffect(() => {
    const logo = state?.project?.logo
    if (!logo) return
    setLogoDraft({ x: logo.x, y: logo.y, w: logo.w, opacity: logo.opacity })
  }, [state?.project?.logo?.url, state?.project?.logo?.x, state?.project?.logo?.y, state?.project?.logo?.w, state?.project?.logo?.opacity])

  if (!state || !settings) return null

  const agents = settings.agents || {}
  const running = state.jobs.filter((j) => j.status === 'running')

  const setAgent = async (key: string, value: boolean) => {
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ agents: { [key]: value } }),
      })
    } catch (e: any) {
    }
  }

  const saveChannel = async () => {
    const value = channel.trim()
    if (value === (state.project?.channel ?? '')) return
    try {
      await api('/api/project', { method: 'POST', body: JSON.stringify({ channel: value }) })
    } catch (e: any) {
    }
  }

  const uploadLogo = async (file: File | null) => {
    if (!file) return
    if (!/^image\/(png|webp|gif)$/i.test(file.type)) return
    if (file.size > 2 * 1024 * 1024) return
    setLogoBusy(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('read'))
        reader.readAsDataURL(file)
      })
      await api('/api/project/logo', { method: 'POST', body: JSON.stringify({ dataUrl }) })
    } catch {}
    finally { setLogoBusy(false) }
  }

  const saveLogoPatch = async (patch: Partial<{ x: number; y: number; w: number; opacity: number }>) => {
    const current = state.project?.logo
    if (!current?.url) return
    const next = {
      url: current.url,
      x: Math.max(0, Math.min(1, patch.x ?? logoDraft.x)),
      y: Math.max(0, Math.min(1, patch.y ?? logoDraft.y)),
      w: Math.max(0.05, Math.min(0.8, patch.w ?? logoDraft.w)),
      opacity: Math.max(0.1, Math.min(1, patch.opacity ?? logoDraft.opacity)),
    }
    setLogoDraft({ x: next.x, y: next.y, w: next.w, opacity: next.opacity })
    try {
      await api('/api/project', { method: 'POST', body: JSON.stringify({ logo: next }) })
    } catch {}
  }

  const removeLogo = async () => {
    setLogoBusy(true)
    try {
      await api('/api/project', { method: 'POST', body: JSON.stringify({ logo: null }) })
    } catch {}
    finally { setLogoBusy(false) }
  }

  const saveStyle = async () => {
    setSaving(true)
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify(draft) })
    } catch (e: any) {
    } finally {
      setSaving(false)
    }
  }

  const setNiche = async (niche: Niche) => {
    if (niche === settings.niche) return
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ niche }) })
      const label = NICHE_OPTIONS.find((o) => o.key === niche)?.label || ''
    } catch (e: any) {
    }
  }

  const nodes = [
    { icon: <Youtube size={15} />, label: 'Fonte', status: `${state.sources.length} conectadas` },
    { icon: <AudioLines size={15} />, label: 'Leitura', status: `${state.sources.filter((s) => s.status === 'pronto').length} lidas` },
    { icon: <Scissors size={15} />, label: 'Momentos', status: `${state.clips.length} cortes` },
    { icon: <Crop size={15} />, label: 'Enquadramento', status: agents.enquadramento ? '9:16 auto' : 'manual' },
  ]

  return (
    <div className="page">
      <PageHead
        kicker="IA · FLUXO DO CORTE"
        title="Agentes"
        actions={
          <button className="btn btn-primary" onClick={saveStyle} disabled={saving}>
            {saving ? <span className="spinner" /> : <Check size={14} />} Aplicar estilo
          </button>
        }
      />

      <section className="panel pipeline-panel">
        <div className="pipe-head">
          <div>
            <span className="kicker">FLUXO ATIVO</span>
            <b>{running.length ? `Analisando ${running.length} ${running.length > 1 ? 'vídeos' : 'vídeo'}` : 'Tudo pronto para o próximo corte'}</b>
          </div>
          <span className={`chip ${running.length ? 'chip-amber' : 'chip-green'}`}>
            <i className="live-dot"><i /></i> {running.length ? 'em execução' : 'estável'}
          </span>
        </div>
        <div className="pipe">
          {nodes.map((n, i) => (
            <div className="pipe-unit" key={n.label}>
              <div className="pipe-node">
                <span>{n.icon}</span>
                <b>{n.label}</b>
                <em>{n.status}</em>
              </div>
              {i < nodes.length - 1 && <div className="pipe-line" />}
            </div>
          ))}
        </div>
        {running.length > 0 && (
          <div className="pipe-running">
            {running.slice(0, 2).map((j) => (
              <div key={j.id}>
                <div className="pr-head"><span>{j.step}</span><span className="mono">{j.progress}%</span></div>
                <ProgressBar value={j.progress} animated />
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="ia-grid">
        <div className="ia-main">
          <div className="section-head">
            <h2>Agentes do estúdio</h2>
            <span className="fine">{[agents.enquadramento, settings.autoApprove && 'auto'].filter(Boolean).length} ativos</span>
          </div>

          <div className="agent-cards">
            <AgentCard
              icon={<Crop size={16} />}
              tone="violet"
              name="Enquadramento"
              desc="Deixa cada corte em 9:16, seguindo o que acontece na tela."
              stat={`${state.clips.length} cortes enquadrados`}
              checked={Boolean(agents.enquadramento)}
              onChange={(v) => setAgent('enquadramento', v)}
            />
            <AgentCard
              icon={<CheckCircle2 size={16} />}
              tone="red"
              name="Aprovação"
              desc="Aprova sozinha os cortes com melhor score."
              stat={settings.autoApprove ? 'aprovando sozinho' : 'revisão manual'}
              checked={Boolean(settings.autoApprove)}
              onChange={(v) => api('/api/settings', { method: 'POST', body: JSON.stringify({ autoApprove: v }) })}
            />
          </div>

          <div className="section-head">
            <h2>Atividade</h2>
          </div>
          <div className="panel activity">
            {state.activity.slice(0, 8).map((a) => (
              <div className="act-row" key={a.id}>
                <span className={`act-ico act-${a.kind}`}>{actIcon(a.kind)}</span>
                <span className="act-text">{a.text}</span>
                <span className="mono act-time">{relTime(a.at)}</span>
              </div>
            ))}
            {!state.activity.length && <p className="fine">Sem atividade recente.</p>}
          </div>
        </div>

        <aside className="ia-side">
          <div className="panel channel-panel">
            <div className="panel-head"><h3>Seu canal</h3><Youtube size={14} className="muted" /></div>
            <label className="field-label">Nome do canal</label>
            <input
              className="input"
              value={channel}
              maxLength={40}
              placeholder="Ex.: Pelo Olhar do Bombeiro"
              onChange={(e) => setChannel(e.target.value)}
              onBlur={saveChannel}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />

            <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 14 }}>
              <div className="panel-head" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 13 }}>Logo do canal</h3>
                <ImagePlus size={14} className="muted" />
              </div>
              <p className="fine" style={{ marginBottom: 10 }}>PNG transparente. Aparece nos cortes renderizados.</p>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ width: 132, aspectRatio: '9 / 16', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, position: 'relative', overflow: 'hidden', flex: '0 0 auto' }}>
                  {state.project?.logo?.url ? (
                    <img
                      src={state.project.logo.url}
                      alt="Logo do canal"
                      style={{
                        position: 'absolute',
                        left: `${logoDraft.x * 100}%`,
                        top: `${logoDraft.y * 100}%`,
                        width: `${logoDraft.w * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        opacity: logoDraft.opacity,
                        pointerEvents: 'none',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.35)', fontSize: 12, textAlign: 'center', padding: 10 }}>Sem logo</div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 180 }}>
                  <label className="btn btn-soft btn-sm" style={{ display: 'inline-flex', cursor: logoBusy ? 'wait' : 'pointer', marginBottom: 8 }}>
                    {logoBusy ? <span className="spinner" /> : <UploadCloud size={13} />}
                    {state.project?.logo?.url ? 'Trocar logo' : 'Enviar logo'}
                    <input
                      type="file"
                      accept="image/png,image/webp,image/gif"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null
                        e.currentTarget.value = ''
                        void uploadLogo(f)
                      }}
                    />
                  </label>
                  {state.project?.logo?.url && (
                    <>
                      <button className="btn btn-soft btn-sm" style={{ marginLeft: 8, marginBottom: 8 }} onClick={() => void removeLogo()} disabled={logoBusy}>
                        <Trash2 size={13} /> Remover
                      </button>

                      <div className="range-field" style={{ marginTop: 6 }}>
                        <div className="rf-head"><span>Tamanho</span><b className="mono">{Math.round(logoDraft.w * 100)}%</b></div>
                        <input type="range" min={5} max={80} value={Math.round(logoDraft.w * 100)}
                          onChange={(e) => setLogoDraft((d) => ({ ...d, w: Number(e.target.value) / 100 }))}
                          onMouseUp={(e) => void saveLogoPatch({ w: Number((e.target as HTMLInputElement).value) / 100 })}
                          onTouchEnd={(e) => void saveLogoPatch({ w: Number((e.target as HTMLInputElement).value) / 100 })} />
                      </div>
                      <div className="range-field">
                        <div className="rf-head"><span>Opacidade</span><b className="mono">{Math.round(logoDraft.opacity * 100)}%</b></div>
                        <input type="range" min={10} max={100} value={Math.round(logoDraft.opacity * 100)}
                          onChange={(e) => setLogoDraft((d) => ({ ...d, opacity: Number(e.target.value) / 100 }))}
                          onMouseUp={(e) => void saveLogoPatch({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
                          onTouchEnd={(e) => void saveLogoPatch({ opacity: Number((e.target as HTMLInputElement).value) / 100 })} />
                      </div>
                      <div className="range-field">
                        <div className="rf-head"><span>Posição X</span><b className="mono">{Math.round(logoDraft.x * 100)}%</b></div>
                        <input type="range" min={0} max={100} value={Math.round(logoDraft.x * 100)}
                          onChange={(e) => setLogoDraft((d) => ({ ...d, x: Number(e.target.value) / 100 }))}
                          onMouseUp={(e) => void saveLogoPatch({ x: Number((e.target as HTMLInputElement).value) / 100 })}
                          onTouchEnd={(e) => void saveLogoPatch({ x: Number((e.target as HTMLInputElement).value) / 100 })} />
                      </div>
                      <div className="range-field">
                        <div className="rf-head"><span>Posição Y</span><b className="mono">{Math.round(logoDraft.y * 100)}%</b></div>
                        <input type="range" min={0} max={100} value={Math.round(logoDraft.y * 100)}
                          onChange={(e) => setLogoDraft((d) => ({ ...d, y: Number(e.target.value) / 100 }))}
                          onMouseUp={(e) => void saveLogoPatch({ y: Number((e.target as HTMLInputElement).value) / 100 })}
                          onTouchEnd={(e) => void saveLogoPatch({ y: Number((e.target as HTMLInputElement).value) / 100 })} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="panel style-panel">
            <div className="panel-head"><h3>Estilo de corte</h3><Sparkles size={14} className="muted" /></div>

            <label className="field-label">Nicho do estúdio</label>
            <div className="segmented">
              {NICHE_OPTIONS.map((o) => (
                <button key={o.key} className={settings.niche === o.key ? 'active' : ''} onClick={() => setNiche(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>

            <div className="range-field">
              <div className="rf-head"><span>Duração mínima</span><b className="mono">{draft.clipMin}s</b></div>
              <input
                type="range" min={10} max={45} value={draft.clipMin}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setDraft((d) => ({ ...d, clipMin: v, clipMax: Math.max(d.clipMax, v + 6) }))
                }}
              />
            </div>
            <div className="range-field">
              <div className="rf-head"><span>Duração máxima</span><b className="mono">{draft.clipMax}s</b></div>
              <input
                type="range" min={20} max={90} value={draft.clipMax}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setDraft((d) => ({ ...d, clipMax: v, clipMin: Math.min(d.clipMin, v - 6) }))
                }}
              />
            </div>
            <div className="duration-viz">
              <span className="mono">{draft.clipMin}s</span>
              <div className="dv-bar"><i style={{ left: `${(draft.clipMin / 90) * 100}%`, right: `${100 - (draft.clipMax / 90) * 100}%` }} /></div>
              <span className="mono">{draft.clipMax}s</span>
            </div>

            <label className="field-label">Resolução do corte</label>
            <div className="segmented">
              {(['720p', '1080p', '4k'] as const).map((r) => (
                <button
                  key={r}
                  className={settings.resolution === r ? 'active' : ''}
                  onClick={() => api('/api/settings', { method: 'POST', body: JSON.stringify({ resolution: r }) })}
                >
                  {r === '4k' ? '4K' : r}
                </button>
              ))}
            </div>

            <div className="style-note">
              <Sparkles size={13} />
              <span>
                {settings.niche === 'gta'
                  ? 'Modo GTA: streamer em cima, jogo embaixo, legenda amarela na divisa e logo no topo.'
                  : 'As mudanças valem para os próximos cortes analisados.'}
              </span>
            </div>
          </div>

          <div className="panel reanalyze">
            <div className="re-head"><RefreshCw size={14} /><b>Analisar uma fonte de novo</b></div>
            <p>Revise um vídeo com o estilo atual do estúdio.</p>
            <Select
              value={state.sources[0]?.id || ''}
              align="left"
              onChange={async (id) => {
                if (!id) return
                try {
                  await api(`/api/sources/${id}/analyze`, { method: 'POST' })
                } catch (e: any) {
                }
              }}
              options={[
                ...state.sources.map((s) => ({ value: s.id, label: s.title, hint: s.channel })),
                ...(state.sources.length ? [] : [{ value: '', label: 'Nenhuma fonte ainda', hint: 'envie um vídeo ou cole um link' }]),
              ]}
            />
            {!state.sources.length && (
              <button className="btn btn-soft btn-sm w-full" onClick={() => navigate('videos')}>
                <Clapperboard size={13} /> Conectar fonte
              </button>
            )}
          </div>

          <div className="side-tip">
            <Lightbulb size={14} />
            <span>{settings.niche === 'games'
              ? 'Cortes de 15 a 30 segundos seguram melhor em jogadas e reações de live.'
              : settings.niche === 'geral'
                ? 'Cortes de 20 a 40 segundos seguram melhor os melhores momentos de qualquer vídeo.'
                : 'Cortes de 18 a 38 segundos prendem mais a atenção.'}</span>
          </div>
        </aside>
      </div>
    </div>
  )
}

function AgentCard({
  icon, tone, name, desc, stat, checked, onChange,
}: { icon: React.ReactNode; tone: string; name: string; desc: string; stat: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`agent-card panel ${checked ? 'on' : ''}`}>
      <div className="ac-top">
        <span className={`ac-ico tone-${tone}`}>{icon}</span>
        <Switch checked={checked} onChange={onChange} label={name} />
      </div>
      <h3>{name}</h3>
      <p>{desc}</p>
      <div className="ac-foot">
        <span className={`ac-state ${checked ? 'on' : ''}`}>{checked ? 'habilitado' : 'desligado'}</span>
        <span className="mono muted">{stat}</span>
      </div>
    </div>
  )
}

function actIcon(kind: string) {
  if (kind === 'render') return <Clapperboard size={13} />
  if (kind === 'upload') return <UploadCloud size={13} />
  return <Sparkles size={13} />
}
