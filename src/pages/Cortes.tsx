import { useMemo, useState } from 'react'
import {
  AlertTriangle, Check, Download, Film, Filter, Link2, Play, Plus, Scissors, Trash2, Zap,
} from 'lucide-react'
import { friendlyMessage, useApp } from '../store'
import { navigate } from '../router'
import { ClipCard, ClipPlayer, PlayerModal } from '../components'
import { Cover, EmptyState, Logo, Modal, PageHead, ProgressBar, Select, StatCard, Switch } from '../ui'
import { fmtTime } from '../lib/format'
import { CLIP_TYPES } from '../types'
import type { Clip, ClipType, Compilation } from '../types'

export function CortesPage() {
  const { state, api, setIngestOpen, setIngestTab } = useApp()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'todos' | ClipType>('todos')
  const [sort, setSort] = useState<'score' | 'recentes' | 'duracao'>('score')
  const [longOpen, setLongOpen] = useState(false)
  const [longAspect, setLongAspect] = useState<'9:16' | '16:9'>('16:9')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchAspect, setBatchAspect] = useState<'9:16' | '16:9'>('9:16')
  const [batchPicked, setBatchPicked] = useState<string[]>([])
  const [batching, setBatching] = useState(false)
  const [batchNotice, setBatchNotice] = useState('')
  const [exampleStyle, setExampleStyle] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoSourceId, setAutoSourceId] = useState('')
  const [autoAspect, setAutoAspect] = useState<'9:16' | '16:9'>('9:16')
  const [autoLimit, setAutoLimit] = useState('12')
  const [autoStyle, setAutoStyle] = useState(false)
  const [autoStarting, setAutoStarting] = useState(false)
  const [autoNotice, setAutoNotice] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const [removingComp, setRemovingComp] = useState('')
  const [watching, setWatching] = useState<Clip | null>(null)
  const [playingComp, setPlayingComp] = useState<Compilation | null>(null)
  const [addTarget, setAddTarget] = useState<Compilation | null>(null)
  const [addPicked, setAddPicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)

  const clips = state?.clips || []
  const comps = state?.compilations || []
  const autoSources = (state?.sources || []).filter((s) =>
    s.mode !== 'live' && s.status !== 'ao-vivo' && Boolean(s.url || s.uploaded))
  const avg = clips.length ? Math.round(clips.reduce((a, c) => a + (c.end - c.start), 0) / clips.length) : 0
  const best = clips.length ? Math.max(...clips.map((c) => c.score)) : 0

  const filtered = useMemo(() => {
    let list = clips.filter((c) => type === 'todos' || c.type === type)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((c) => c.hook.toLowerCase().includes(q) || c.hashtags.join(' ').toLowerCase().includes(q))
    if (sort === 'score') list = [...list].sort((a, b) => b.score - a.score)
    if (sort === 'recentes') list = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    if (sort === 'duracao') list = [...list].sort((a, b) => (b.end - b.start) - (a.end - a.start))
    return list
  }, [clips, type, query, sort])

  const openLong = () => {
    const ready = clips.filter((c) => c.stage !== 'rascunho')
    setPicked((ready.length >= 2 ? ready : clips).map((c) => c.id))
    setLongOpen(true)
  }

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const buildLong = async () => {
    if (picked.length < 2) return
    setBuilding(true)
    try {
      await api('/api/compilations', { method: 'POST', body: JSON.stringify({ clipIds: picked, aspect: longAspect }) })
      setLongOpen(false)
    } catch (e: any) {
      window.alert(friendlyMessage(e?.message))
    } finally {
      setBuilding(false)
    }
  }

  const openBatch = () => {
    const ready = clips.filter((c) => c.stage !== 'rascunho')
    setBatchPicked((ready.length ? ready : clips).map((c) => c.id))
    setBatchAspect(state?.settings?.format === '16:9' ? '16:9' : '9:16')
    setExampleStyle(Boolean(state?.settings?.bgBlur && state?.settings?.muteAudio))
    setBatchNotice('')
    setBatchOpen(true)
  }

  const toggleBatchPick = (id: string) => {
    setBatchPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const renderBatch = async () => {
    if (!batchPicked.length || batching) return
    setBatching(true)
    setBatchNotice('')
    try {
      const data = await api('/api/clips/render-many', {
        method: 'POST',
        body: JSON.stringify({
          clipIds: batchPicked,
          aspect: batchAspect,
          bgBlur: exampleStyle,
          muteAudio: exampleStyle,
        }),
      })
      const queued = Number(data?.queued) || 0
      const skipped = (Number(data?.skippedBusy) || 0) + (Number(data?.skippedMedia) || 0)
      if (!queued) {
        setBatchNotice('Nenhum corte entrou na fila. Selecione outros cortes disponíveis.')
      } else {
        setBatchNotice(
          `Fila iniciada: ${queued} ${queued === 1 ? 'corte' : 'cortes'} em ${batchAspect}, um por vez.`
          + (skipped ? ` ${skipped} ignorado${skipped === 1 ? '' : 's'} por já estarem em produção ou sem vídeo.` : ''),
        )
      }
    } catch (e: any) {
      setBatchNotice(friendlyMessage(e?.message))
    } finally {
      setBatching(false)
    }
  }

  const openAuto = () => {
    setAutoSourceId(autoSources[0]?.id || '')
    setAutoAspect(state?.settings?.format === '16:9' ? '16:9' : '9:16')
    setAutoLimit('12')
    setAutoStyle(Boolean(state?.settings?.bgBlur && state?.settings?.muteAudio))
    setAutoNotice('')
    setAutoOpen(true)
  }

  const startAuto = async () => {
    if (!autoSourceId || autoStarting) return
    setAutoStarting(true)
    setAutoNotice('')
    try {
      await api(`/api/sources/${autoSourceId}/auto-cortes`, {
        method: 'POST',
        body: JSON.stringify({
          aspect: autoAspect,
          limit: Number(autoLimit),
          bgBlur: autoStyle,
          muteAudio: autoStyle,
        }),
      })
      setAutoNotice(`Análise iniciada. Até ${autoLimit} cortes em ${autoAspect} serão enfileirados um por vez ao terminar.`)
    } catch (e: any) {
      setAutoNotice(friendlyMessage(e?.message))
    } finally {
      setAutoStarting(false)
    }
  }

  const removeLong = async (comp: Compilation) => {
    setRemovingComp(comp.id)
    try {
      await api(`/api/compilations/${comp.id}`, { method: 'DELETE' })
    } catch (e: any) {
      window.alert(friendlyMessage(e?.message))
    } finally {
      setRemovingComp('')
    }
  }

  const openAdd = (comp: Compilation) => {
    setAddTarget(comp)
    setAddPicked([])
  }

  const toggleAdd = (id: string) => {
    setAddPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const addToLong = async () => {
    if (!addTarget || !addPicked.length) return
    setAdding(true)
    try {
      await api(`/api/compilations/${addTarget.id}/clips`, { method: 'POST', body: JSON.stringify({ clipIds: addPicked }) })
      setAddTarget(null)
      setAddPicked([])
    } catch (e: any) {
      window.alert(friendlyMessage(e?.message))
    } finally {
      setAdding(false)
    }
  }

  const addCandidates = addTarget ? clips.filter((c) => !addTarget.clipIds.includes(c.id)) : []

  const typeCount = (t: ClipType) => clips.filter((c) => c.type === t).length
  const niche = state?.settings?.niche || 'fuga'
  const visibleTypes = CLIP_TYPES.filter((t) => t.niche === niche || t.niche === 'both' || typeCount(t.key) > 0)
    .filter((t) => t.key !== 'momento' || typeCount('momento') > 0)

  return (
    <div className="page">
      <PageHead
        kicker={`ACERVO · ${clips.length} CORTES`}
        title="Cortes"
        actions={
          <>
            <button className="btn btn-ghost" onClick={openAuto} disabled={!autoSources.length}>
              <Zap size={14} /> Auto-cortes
            </button>
            <button className="btn btn-ghost" onClick={openBatch} disabled={!clips.length}>
              <Scissors size={14} /> Gerar em massa
            </button>
            <button className="btn btn-ghost" onClick={openLong} disabled={clips.length < 2}>
              <Film size={14} /> Vídeo longo
            </button>
            <button className="btn btn-primary" onClick={() => { setIngestTab('upload'); setIngestOpen(true) }}>
              <Plus size={14} /> Nova fonte
            </button>
          </>
        }
      />

      <div className="stats-row">
        <StatCard label="Cortes no radar" value={String(clips.length).padStart(2, '0')} tone="violet" spark={clips.map((c) => c.score)} />
        <StatCard label="Melhor score" value={best || '—'} tone="amber" spark={clips.map((c) => c.score).sort((a, b) => a - b)} />
        <StatCard label="Duração média" value={`${avg || 0}s`} tone="green" spark={clips.map((c) => c.end - c.start)} />
        <StatCard label="Tipos no acervo" value={new Set(clips.map((c) => c.type)).size} tone="red" spark={CLIP_TYPES.map((t) => typeCount(t.key))} />
      </div>

      {(comps.length > 0 || clips.length > 0) && (
        <section className="longos">
          <div className="section-head">
            <h2>Vídeos longos <span className="mono">{String(comps.length).padStart(2, '0')}</span></h2>
          </div>
          {comps.length ? (
            <div className="longo-grid">
              {comps.map((comp) => (
                <article className={`longo-card panel ${comp.status}`} key={comp.id}>
                  <div className="longo-thumb">
                    <Cover src={comp.cover} alt={comp.title} />
                    <span className={`longo-badge ${comp.status}`}>
                      {comp.status === 'pronto' ? 'PRONTO'
                        : comp.status === 'erro' ? 'ATENÇÃO'
                          : comp.status === 'pendente' ? 'RETOMANDO' : 'MONTANDO'}
                    </span>
                    <span className="longo-dur mono">{fmtTime(comp.duration)}</span>
                    {['processando', 'pendente'].includes(comp.status) && (
                      <div className="longo-prog">
                        <ProgressBar value={comp.progress} animated />
                        <span className="mono">{comp.progress}%</span>
                      </div>
                    )}
                  </div>
                  <div className="longo-body">
                    <div className="longo-meta mono">{comp.clipIds.length} CORTES · {comp.aspect || '16:9'}</div>
                    <h3>{comp.title}</h3>
                    {comp.error && <div className="src-error"><AlertTriangle size={13} /> {friendlyMessage(comp.error)}</div>}
                    <div className="longo-actions">
                      {comp.status === 'pronto' ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => setPlayingComp(comp)}>
                            <Play size={13} fill="currentColor" /> Assistir
                          </button>
                          <a className="btn btn-ghost btn-sm" href={comp.url} download>
                            <Download size={13} /> Salvar vídeo
                          </a>
                        </>
                      ) : (
                        <span className="longo-status mono">
                          {comp.status === 'erro' ? 'TENTE DE NOVO'
                            : comp.status === 'pendente' ? 'RETOMANDO' : 'EM PRODUÇÃO'}
                        </span>
                      )}
                      <div className="grow" />
                      {!['processando', 'pendente'].includes(comp.status) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => openAdd(comp)}>
                          <Plus size={13} /> Adicionar cortes
                        </button>
                      )}
                      <button
                        className="btn-icon danger"
                        onClick={() => removeLong(comp)}
                        disabled={removingComp === comp.id || ['processando', 'pendente'].includes(comp.status)}
                        aria-label="Remover vídeo longo"
                      >
                        {removingComp === comp.id ? <span className="spinner" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="longo-empty panel">
              <div className="lo-ico"><Film size={18} /></div>
              <div className="lo-copy">
                <b>Nenhum vídeo longo ainda</b>
              </div>
              <button className="btn btn-soft btn-sm" onClick={openLong} disabled={clips.length < 2}>
                <Film size={13} /> Montar agora
              </button>
            </div>
          )}
        </section>
      )}

      <div className="toolbar">
        <div className="filter-search">
          <Filter size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por gancho ou hashtag" />
        </div>
        <div className="segmented scrollable">
          <button className={type === 'todos' ? 'active' : ''} onClick={() => setType('todos')}>Todos <i>{clips.length}</i></button>
          {visibleTypes.map((t) => (
            <button key={t.key} className={type === t.key ? 'active' : ''} onClick={() => setType(t.key)}>
              {t.label} <i>{typeCount(t.key)}</i>
            </button>
          ))}
        </div>
        <div className="grow" />
        <span className="tool-label">Ordenar</span>
        <Select
          value={sort}
          onChange={setSort}
          options={[
            { value: 'score', label: 'Score' },
            { value: 'recentes', label: 'Recentes' },
            { value: 'duracao', label: 'Duração' },
          ]}
        />
      </div>

      {filtered.length ? (
        <div className="clip-grid">
          {filtered.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              source={state?.sources.find((s) => s.id === clip.sourceId)}
              onOpen={() => navigate('estudio', { clip: clip.id })}
              onPlay={() => setWatching(clip)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Scissors size={22} />}
          title={clips.length ? 'Nenhum corte com esse filtro' : 'Seu acervo está vazio'}
          action={clips.length
            ? <button className="btn btn-ghost" onClick={() => { setType('todos'); setQuery('') }}>Limpar filtros</button>
            : <button className="btn btn-primary" onClick={() => setIngestOpen(true)}><Link2 size={14} /> Conectar fonte</button>}
        />
      )}

      <div className="cortes-foot">
        <span className="mono">{filtered.length} de {clips.length} cortes</span>
      </div>

      <Modal
        open={autoOpen}
        onClose={() => setAutoOpen(false)}
        kicker={`AUTO-CORTES · ${autoAspect}`}
        title="Cortes automáticos"
        width={560}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setAutoOpen(false)}>Fechar</button>
            <button className="btn btn-primary" onClick={startAuto} disabled={!autoSourceId || autoStarting}>
              {autoStarting ? <Logo size={13} className="btn-spin" /> : <Zap size={14} />} Criar cortes
            </button>
          </>
        }
      >
        <label className="field-label">Vídeo de origem</label>
        <Select
          value={autoSourceId}
          onChange={setAutoSourceId}
          options={autoSources.map((s) => ({
            value: s.id,
            label: `${s.title.slice(0, 42)}${s.title.length > 42 ? '…' : ''} · ${s.clips} cortes`,
          }))}
        />

        <label className="field-label">Formato dos cortes</label>
        <div className="segmented small">
          {(['9:16', '16:9'] as const).map((a) => (
            <button key={a} className={autoAspect === a ? 'active' : ''} onClick={() => setAutoAspect(a)}>
              {a}
            </button>
          ))}
        </div>

        <label className="field-label">Quantidade máxima</label>
        <Select
          value={autoLimit}
          onChange={setAutoLimit}
          options={['8', '12', '20', '40'].map((n) => ({ value: n, label: `${n} cortes` }))}
        />

        <div className="option-row">
          <div><b>Estilo do exemplo</b><em>9:16 com fundo desfocado e sem áudio</em></div>
          <Switch checked={autoStyle} label="Estilo do exemplo" onChange={setAutoStyle} />
        </div>

        {autoNotice && (
          <div className="style-note">
            <AlertTriangle size={13} />
            <span>{autoNotice}</span>
          </div>
        )}
        <div className="style-note">
          <Zap size={13} />
          <span>O vídeo é analisado primeiro. Depois os melhores momentos entram na fila, um por vez.</span>
        </div>
      </Modal>

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        kicker={`FILA AUTOMÁTICA · ${batchAspect}`}
        title="Gerar cortes em massa"
        width={700}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setBatchOpen(false)}>Fechar</button>
            <button className="btn btn-primary" onClick={renderBatch} disabled={!batchPicked.length || batching}>
              {batching ? <Logo size={13} className="btn-spin" /> : <Scissors size={14} />} Enfileirar cortes
            </button>
          </>
        }
      >
        <label className="field-label">Formato dos cortes</label>
        <div className="segmented small">
          {(['9:16', '16:9'] as const).map((a) => (
            <button
              key={a}
              className={batchAspect === a ? 'active' : ''}
              onClick={() => setBatchAspect(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="option-row">
          <div><b>Estilo do exemplo</b><em>9:16 com fundo desfocado e sem áudio</em></div>
          <Switch checked={exampleStyle} label="Estilo do exemplo" onChange={setExampleStyle} />
        </div>
        {batchNotice && (
          <div className="style-note">
            <AlertTriangle size={13} />
            <span>{batchNotice}</span>
          </div>
        )}
        <div className="pick-tools">
          <span className="mono">{batchPicked.length} DE {clips.length} SELECIONADOS · ATÉ 40 POR LOTE</span>
          <button
            className="link-btn"
            onClick={() => setBatchPicked(batchPicked.length === clips.length ? [] : clips.map((c) => c.id))}
          >
            {batchPicked.length === clips.length ? 'Limpar seleção' : 'Selecionar todos'}
          </button>
        </div>
        <div className="pick-list">
          {[...clips].sort((a, b) => b.score - a.score).map((clip) => {
            const on = batchPicked.includes(clip.id)
            const busy = state?.jobs?.some((j) =>
              ['running', 'pendente'].includes(j.status) && j.clipId === clip.id)
            return (
              <button
                type="button"
                key={clip.id}
                className={`pick-row ${on ? 'on' : ''}`}
                onClick={() => toggleBatchPick(clip.id)}
              >
                <span className="pick-check">{on && <Check size={11} />}</span>
                <span className="pick-thumb"><Cover src={clip.cover} alt="" /></span>
                <span className="pick-info">
                  <b>{clip.hook}</b>
                  <em>{fmtTime(clip.end - clip.start)} · {clip.aspect || '9:16'} · score {clip.score}{busy ? ' · em produção' : ''}</em>
                </span>
              </button>
            )
          })}
        </div>
      </Modal>

      <Modal
        open={longOpen}
        onClose={() => setLongOpen(false)}
        kicker={`VÍDEO LONGO · ${longAspect}`}
        title="Montar vídeo longo"
        width={700}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setLongOpen(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={buildLong} disabled={picked.length < 2 || building}>
              {building ? <Logo size={13} className="btn-spin" /> : <Film size={14} />} Montar vídeo
            </button>
          </>
        }
      >
        <label className="field-label">Formato do vídeo longo</label>
        <div className="segmented small">
          {(['16:9', '9:16'] as const).map((a) => (
            <button
              key={a}
              className={longAspect === a ? 'active' : ''}
              onClick={() => setLongAspect(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="pick-tools">
          <span className="mono">{clips.length} CORTES DISPONÍVEIS</span>
          <button
            className="link-btn"
            onClick={() => setPicked(picked.length === clips.length ? [] : clips.map((c) => c.id))}
          >
            {picked.length === clips.length ? 'Limpar seleção' : 'Selecionar todos'}
          </button>
        </div>
        <div className="pick-list">
          {[...clips].sort((a, b) => b.score - a.score).map((clip) => {
            const on = picked.includes(clip.id)
            return (
              <button
                type="button"
                key={clip.id}
                className={`pick-row ${on ? 'on' : ''}`}
                onClick={() => togglePick(clip.id)}
              >
                <span className="pick-check">{on && <Check size={11} />}</span>
                <span className="pick-thumb"><Cover src={clip.cover} alt="" /></span>
                <span className="pick-info">
                  <b>{clip.hook}</b>
                  <em>{fmtTime(clip.end - clip.start)} · {CLIP_TYPES.find((t) => t.key === clip.type)?.label} · score {clip.score}</em>
                </span>
              </button>
            )
          })}
        </div>
      </Modal>

      <Modal
        open={Boolean(addTarget)}
        onClose={() => { setAddTarget(null); setAddPicked([]) }}
        kicker={`VÍDEO LONGO · ${addTarget?.aspect || '16:9'}`}
        title="Adicionar cortes ao vídeo longo"
        width={700}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => { setAddTarget(null); setAddPicked([]) }}>Cancelar</button>
            <button className="btn btn-primary" onClick={addToLong} disabled={!addPicked.length || adding}>
              {adding ? <Logo size={13} className="btn-spin" /> : <Plus size={14} />} Adicionar e montar
            </button>
          </>
        }
      >
        {addCandidates.length ? (
          <>
            <div className="pick-tools">
              <span className="mono">{addCandidates.length} CORTES FORA DESTE VÍDEO</span>
              <button
                className="link-btn"
                onClick={() => setAddPicked(addPicked.length === addCandidates.length ? [] : addCandidates.map((c) => c.id))}
              >
                {addPicked.length === addCandidates.length ? 'Limpar seleção' : 'Selecionar todos'}
              </button>
            </div>
            <div className="pick-list">
              {[...addCandidates].sort((a, b) => b.score - a.score).map((clip) => {
                const on = addPicked.includes(clip.id)
                return (
                  <button
                    type="button"
                    key={clip.id}
                    className={`pick-row ${on ? 'on' : ''}`}
                    onClick={() => toggleAdd(clip.id)}
                  >
                    <span className="pick-check">{on && <Check size={11} />}</span>
                    <span className="pick-thumb"><Cover src={clip.cover} alt="" /></span>
                    <span className="pick-info">
                      <b>{clip.hook}</b>
                      <em>{fmtTime(clip.end - clip.start)} · {CLIP_TYPES.find((t) => t.key === clip.type)?.label} · score {clip.score}</em>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <div className="longo-empty">
            <div className="lo-ico"><Film size={18} /></div>
            <div className="lo-copy">
              <b>Todos os cortes já estão neste vídeo</b>
              <span>Adicione mais fontes para ter cortes novos disponíveis.</span>
            </div>
          </div>
        )}
      </Modal>

      <PlayerModal
        open={Boolean(watching)}
        onClose={() => setWatching(null)}
        kicker={`PLAYER · ${watching?.aspect || '9:16'}`}
        title={watching?.hook || 'Assistir corte'}
        subtitle={watching ? `${CLIP_TYPES.find((t) => t.key === watching.type)?.label || 'Corte'} · ${fmtTime(watching.start)}–${fmtTime(watching.end)}${watching.live ? ' da live' : ''}` : ''}
        width={watching?.aspect === '16:9' ? 880 : 400}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setWatching(null)}>Fechar</button>
            <button
              className="btn btn-primary"
              onClick={() => { const id = watching?.id; setWatching(null); if (id) navigate('estudio', { clip: id }) }}
            >
              Abrir no estúdio
            </button>
          </>
        }
      >
        {watching && <ClipPlayer clip={watching} source={state?.sources.find((s) => s.id === watching.sourceId)} />}
      </PlayerModal>

      <PlayerModal
        open={Boolean(playingComp)}
        onClose={() => setPlayingComp(null)}
        kicker={`PLAYER · ${playingComp?.aspect || '16:9'}`}
        title={playingComp?.title || 'Vídeo longo'}
        subtitle={playingComp ? `${playingComp.clipIds.length} cortes · ${fmtTime(playingComp.duration)}` : ''}
        width={880}
        footer={
          <>
            <a className="btn btn-ghost" href={playingComp?.url} download><Download size={14} /> Salvar vídeo</a>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setPlayingComp(null)}>Fechar</button>
          </>
        }
      >
        {playingComp && (
          <video className="player-video" src={playingComp.url} poster={playingComp.cover} controls autoPlay playsInline />
        )}
      </PlayerModal>
    </div>
  )
}
