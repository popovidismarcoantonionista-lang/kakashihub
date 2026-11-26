import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ExternalLink, Facebook, KeyRound, Link2,
  Music2, Play, Plus, Send, ShieldCheck, Trash2, Unplug, UploadCloud, Youtube,
} from 'lucide-react'
import { friendlyMessage, publicGet, useApp } from '../store'
import { navigate } from '../router'
import { Cover, EmptyState, Modal, PageHead, Select, StatCard } from '../ui'
import { dayLabel } from '../lib/format'
import type { Connection, Platform, Upload } from '../types'

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'facebook']

const INFO: Record<Platform, { label: string; hint: string; setup: string }> = {
  youtube: {
    label: 'YouTube',
    hint: 'Shorts e vídeos no canal',
    setup: 'Crie um acesso no Google Cloud, ative o envio de vídeos e cole as chaves abaixo.',
  },
  tiktok: {
    label: 'TikTok',
    hint: 'Publicação direta no perfil',
    setup: 'Crie um app no TikTok for Developers e cole as chaves. A postagem direta precisa estar liberada no app.',
  },
  facebook: {
    label: 'Facebook',
    hint: 'Reels e vídeos na página',
    setup: 'Crie um app na Meta, libere a publicação em páginas e cole as chaves abaixo. A primeira página da conta é usada.',
  },
}

const platformIcon = (p: Platform, size = 12) =>
  p === 'youtube' ? <Youtube size={size} /> : p === 'tiktok' ? <Music2 size={size} /> : <Facebook size={size} />

const STATUS_LABEL: Record<Upload['status'], string> = {
  agendado: 'agendado',
  enviando: 'publicando',
  publicado: 'publicado',
  erro: 'atenção',
}

type Target = 'corte' | 'longo'

export function UploadsPage() {
  const { state, api } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Upload | null>(null)
  const [publishTarget, setPublishTarget] = useState<Upload | null>(null)
  const [conns, setConns] = useState<Record<Platform, Connection> | null>(null)
  const [credsFor, setCredsFor] = useState<Platform | null>(null)
  const [creds, setCreds] = useState({ clientId: '', clientSecret: '' })
  const [savingCreds, setSavingCreds] = useState(false)
  const [disconnectFor, setDisconnectFor] = useState<Platform | null>(null)
  const [form, setForm] = useState({
    target: 'corte' as Target,
    clipId: '',
    compilationId: '',
    platform: 'tiktok' as Platform,
    scheduledAt: defaultDate(),
  })

  const uploads = state?.uploads || []
  const clips = state?.clips || []
  const comps = (state?.compilations || []).filter((c) => c.status === 'pronto')
  const published = uploads.filter((u) => u.status === 'publicado')
  const queued = uploads.filter((u) => u.status === 'agendado')
  const sending = uploads.filter((u) => u.status === 'enviando')
  const failed = uploads.filter((u) => u.status === 'erro')
  const connected = PLATFORMS.filter((p) => conns?.[p]?.connected)

  const loadConnections = useCallback(async () => {
    try {
      const res = await publicGet('/api/connections')
      const data = await res.json()
      setConns(data.connections)
    } catch {}
  }, [])

  useEffect(() => { loadConnections() }, [loadConnections])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const ok = query.get('connected') as Platform | null
    const bad = query.get('connect_error') as Platform | null
    if (ok || bad) {
      query.delete('connected')
      query.delete('connect_error')
      const search = query.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
      loadConnections()
    }
  }, [loadConnections])

  const sorted = useMemo(
    () => [...uploads].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)),
    [uploads],
  )

  const openSchedule = () => {
    setForm({
      target: clips.length || !comps.length ? 'corte' : 'longo',
      clipId: clips[0]?.id || '',
      compilationId: comps[0]?.id || '',
      platform: connected[0] || 'tiktok',
      scheduledAt: defaultDate(),
    })
    setOpen(true)
  }

  const schedule = async () => {
    if (form.target === 'corte' && !form.clipId) {
      return
    }
    if (form.target === 'longo' && !form.compilationId) {
      return
    }
    if (!conns?.[form.platform]?.connected) {
      return
    }
    setBusy(true)
    try {
      await api('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({
          platform: form.platform,
          clipId: form.target === 'corte' ? form.clipId : undefined,
          compilationId: form.target === 'longo' ? form.compilationId : undefined,
          scheduledAt: new Date(form.scheduledAt).toISOString(),
        }),
      })
      setOpen(false)
    } catch (e: any) {
    } finally {
      setBusy(false)
    }
  }

  const publishNow = async () => {
    if (!publishTarget) return
    try {
      await api(`/api/uploads/${publishTarget.id}/publish`, { method: 'POST' })
      setPublishTarget(null)
    } catch (e: any) {
    }
  }

  const remove = async () => {
    if (!confirm) return
    try {
      await api(`/api/uploads/${confirm.id}`, { method: 'DELETE' })
      setConfirm(null)
    } catch (e: any) {
    }
  }

  const startConnect = (p: Platform) => {
    if (!conns?.[p]?.credentials) {
      setCreds({ clientId: '', clientSecret: '' })
      setCredsFor(p)
      return
    }
    window.location.href = `/api/oauth/${p}/start?returnTo=${encodeURIComponent(window.location.href)}`
  }

  const saveCreds = async () => {
    if (!credsFor) return
    if (!creds.clientId.trim() || !creds.clientSecret.trim()) {
      return
    }
    setSavingCreds(true)
    try {
      await api(`/api/connections/${credsFor}`, { method: 'PUT', body: JSON.stringify(creds) })
      await loadConnections()
      window.location.href = `/api/oauth/${credsFor}/start?returnTo=${encodeURIComponent(window.location.href)}`
    } catch (e: any) {
      setSavingCreds(false)
    }
  }

  const confirmDisconnect = async () => {
    if (!disconnectFor) return
    try {
      await api(`/api/connections/${disconnectFor}`, { method: 'DELETE' })
      setDisconnectFor(null)
      loadConnections()
    } catch (e: any) {
    }
  }

  return (
    <div className="page">
      <PageHead
        kicker="PUBLICAÇÃO"
        title="Uploads"
        actions={
          <button className="btn btn-primary" onClick={openSchedule}>
            <Plus size={14} /> Agendar publicação
          </button>
        }
      />

      <div className="conn-grid">
        {PLATFORMS.map((p) => {
          const c = conns?.[p]
          return (
            <div className={`conn-card ${c?.connected ? 'on' : ''}`} key={p}>
              <div className="conn-top">
                <span className={`conn-ico ${p}`}>{platformIcon(p, 16)}</span>
                <div className="conn-name">
                  <b>{INFO[p].label}</b>
                  <em>{c?.connected ? (c.account || 'Conta conectada') : c?.credentials ? 'Acesso pronto' : INFO[p].hint}</em>
                </div>
                <span className={`conn-dot ${c?.connected ? 'on' : c?.credentials ? 'ready' : ''}`} />
              </div>
              <div className="conn-actions">
                {c?.connected ? (
                  <>
                    <span className="chip chip-mini"><ShieldCheck size={10} /> automático</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => startConnect(p)}>Reconectar</button>
                    <button className="btn-icon sm" title="Desconectar" onClick={() => setDisconnectFor(p)}>
                      <Unplug size={12} />
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-xs" onClick={() => startConnect(p)}>
                    {c?.credentials ? <Link2 size={12} /> : <KeyRound size={12} />}
                    {c?.credentials ? 'Conectar' : 'Configurar'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="stats-row">
        <StatCard label="Publicados" value={String(published.length).padStart(2, '0')} tone="green" spark={published.map((_, i) => i + 1)} />
        <StatCard label="Na fila" value={String(queued.length).padStart(2, '0')} tone="amber" spark={queued.map(() => 2)} />
        <StatCard label="Publicando agora" value={String(sending.length).padStart(2, '0')} tone="violet" spark={[0, 1, 1, 2]} />
        <StatCard label="Contas conectadas" value={`${connected.length}/3`} tone={connected.length ? 'green' : 'red'} spark={PLATFORMS.map((p) => (conns?.[p]?.connected ? 3 : 0))} />
      </div>

      <div className="section-head">
        <h2>Agenda <span className="mono">{String(uploads.length).padStart(2, '0')}</span></h2>
        {failed.length > 0 && <span className="chip chip-mini warn">{failed.length} com atenção</span>}
      </div>

      {sorted.length ? (
        <div className="panel table-panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vídeo</th>
                  <th>Plataforma</th>
                  <th>Quando</th>
                  <th>Status</th>
                  <th className="act" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => {
                  const clip = clips.find((c) => c.id === u.clipId)
                  const comp = comps.find((c) => c.id === u.compilationId)
                    || (state?.compilations || []).find((c) => c.id === u.compilationId)
                  const cover = clip?.cover || comp?.cover || ''
                  const duration = clip ? `${Math.round(clip.end - clip.start)}s` : comp ? clock(comp.duration) : ''
                  const kind = clip ? `Corte ${clip.aspect || '9:16'}` : comp ? `Vídeo longo ${comp.aspect || '16:9'}` : 'Vídeo removido'
                  return (
                    <tr key={u.id}>
                      <td data-label="Vídeo">
                        <div className="up-clip">
                          {cover ? <Cover src={cover} alt={u.title} className="up-thumb" /> : <div className="up-thumb empty" />}
                          <div>
                            <b>{u.title}</b>
                            <em>{kind}{duration ? ` · ${duration}` : ''}{u.error ? ` · ${friendlyMessage(u.error)}` : ''}</em>
                          </div>
                        </div>
                      </td>
                      <td data-label="Plataforma"><span className={`platform p-${u.platform}`}>{platformIcon(u.platform)} {INFO[u.platform]?.label || u.platform}</span></td>
                      <td className="mono dim" data-label="Quando">{dayLabel(u.scheduledAt)}</td>
                      <td data-label="Status"><span className={`status ${u.status}`}>{STATUS_LABEL[u.status]}</span></td>
                      <td className="act" data-label="Ações">
                        <div className="row-actions">
                          {u.status === 'publicado' && u.externalUrl && (
                            <a className="btn-icon sm" title="Abrir no perfil" href={u.externalUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} />
                            </a>
                          )}
                          {(u.status === 'agendado' || u.status === 'erro') && (
                            <button className="btn-icon sm" title="Publicar agora" onClick={() => setPublishTarget(u)}>
                              <Send size={13} />
                            </button>
                          )}
                          {u.status === 'enviando' && <span className="spinner" />}
                          {clip && (
                            <button className="btn-icon sm" title="Abrir corte" onClick={() => navigate('estudio', { clip: clip.id })}>
                              <Play size={13} />
                            </button>
                          )}
                          {comp && (
                            <button className="btn-icon sm" title="Abrir vídeo longo" onClick={() => navigate('cortes')}>
                              <Play size={13} />
                            </button>
                          )}
                          <button className="btn-icon sm danger" title="Remover" onClick={() => setConfirm(u)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="up-summary">
            <div><ShieldCheck size={13} /><span>{connected.length ? `Publicação automática ativa em ${connected.length} ${connected.length === 1 ? 'conta' : 'contas'}` : 'Conecte uma conta para publicar sozinho'}</span></div>
            <div className="grow" />
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<UploadCloud size={22} />}
          title="Nada agendado"
          action={<button className="btn btn-primary" onClick={openSchedule}><Plus size={14} /> Agendar publicação</button>}
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        kicker="AGENDAR"
        title="Programar publicação"
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button
              className="btn btn-primary"
              onClick={schedule}
              disabled={busy || !connected.length || (form.target === 'corte' ? !clips.length : !comps.length)}
            >
              {busy && <span className="spinner" />} Agendar
            </button>
          </>
        }
      >
        <div className="ingest-form">
          {!connected.length && (
            <div className="inline-warn">
              <Link2 size={14} /> Conecte uma conta acima para liberar a publicação automática.
            </div>
          )}
          <label className="field-label">O que publicar</label>
          <div className="segmented">
            <button
              className={form.target === 'corte' ? 'active' : ''}
              disabled={!clips.length}
              onClick={() => setForm({ ...form, target: 'corte' })}
            >
              Corte
            </button>
            <button
              className={form.target === 'longo' ? 'active' : ''}
              disabled={!comps.length}
              onClick={() => setForm({ ...form, target: 'longo' })}
            >
              Vídeo longo
            </button>
          </div>
          {form.target === 'corte' ? (
            <Select
              value={form.clipId}
              onChange={(v) => setForm({ ...form, clipId: v })}
              align="left"
              options={clips.map((c) => ({
                value: c.id,
                label: c.hook,
                hint: `${Math.round(c.end - c.start)}s · ${c.type} · score ${c.score}`,
              }))}
            />
          ) : (
            <Select
              value={form.compilationId}
              onChange={(v) => setForm({ ...form, compilationId: v })}
              align="left"
              options={comps.map((c) => ({
                value: c.id,
                label: c.title,
                hint: `${clock(c.duration)} · pronto`,
              }))}
            />
          )}
          <label className="field-label">Conta</label>
          <div className="segmented">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                className={form.platform === p ? 'active' : ''}
                disabled={!conns?.[p]?.connected}
                title={conns?.[p]?.connected ? INFO[p].label : `Conecte o ${INFO[p].label} primeiro`}
                onClick={() => setForm({ ...form, platform: p })}
              >
                {platformIcon(p)} {INFO[p].label}
              </button>
            ))}
          </div>
          <label className="field-label">Data e hora</label>
          <input
            type="datetime-local"
            className="input mono"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(credsFor)}
        onClose={() => setCredsFor(null)}
        kicker={credsFor ? INFO[credsFor].label.toUpperCase() : 'ACESSO'}
        title="Configurar acesso"
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setCredsFor(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={saveCreds} disabled={savingCreds}>
              {savingCreds && <span className="spinner" />} Salvar e conectar
            </button>
          </>
        }
      >
        <div className="ingest-form">
          <label className="field-label">Identificador do app</label>
          <input
            className="input mono"
            value={creds.clientId}
            onChange={(e) => setCreds({ ...creds, clientId: e.target.value })}
            placeholder="Client ID / Client key"
            autoComplete="off"
          />
          <label className="field-label">Segredo do app</label>
          <input
            className="input mono"
            type="password"
            value={creds.clientSecret}
            onChange={(e) => setCreds({ ...creds, clientSecret: e.target.value })}
            placeholder="Client secret"
            autoComplete="off"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(publishTarget)}
        onClose={() => setPublishTarget(null)}
        kicker="AGORA"
        title="Publicar este vídeo agora?"
        subtitle={publishTarget?.title}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setPublishTarget(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={publishNow}><Send size={14} /> Publicar agora</button>
          </>
        }
      >
      </Modal>

      <Modal
        open={Boolean(disconnectFor)}
        onClose={() => setDisconnectFor(null)}
        kicker="CONTA"
        title="Desconectar esta conta?"
        subtitle={disconnectFor ? INFO[disconnectFor].label : ''}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setDisconnectFor(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={confirmDisconnect}><Unplug size={14} /> Desconectar</button>
          </>
        }
      >
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        kicker="AGENDAMENTO"
        title="Remover este agendamento?"
        subtitle={confirm?.title}
        footer={
          <>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={remove}><Trash2 size={14} /> Remover</button>
          </>
        }
      >
      </Modal>
    </div>
  )
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function defaultDate() {
  const d = new Date(Date.now() + 24 * 3600e3)
  d.setHours(19, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
