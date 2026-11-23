import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X, Info } from 'lucide-react'
import { useApp } from './store'
import type { ClipType } from './types'

export function Logo({ size = 30, className = '' }: { size?: number; className?: string }) {
  const tomoe = 'M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z'
  return (
    <div className={`logo-mark sharingan ${className}`.trim()} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id="sharingan-iris" cx="50%" cy="42%" r="62%">
            <stop offset="0" stopColor="#ff6b5e" />
            <stop offset="0.5" stopColor="#e03131" />
            <stop offset="1" stopColor="#8b0f0f" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="16.2" fill="url(#sharingan-iris)" stroke="#2a0505" strokeWidth="2" />
        <circle cx="20" cy="20" r="3.4" fill="#0b0404" />
        <g fill="#0b0404">
          {[0, 120, 240].map((a) => (
            <g key={a} transform={`translate(20 20) rotate(${a}) translate(0 -9.4)`}>
              <path d={tomoe} />
            </g>
          ))}
        </g>
      </svg>
      <span className="logo-glow" />
    </div>
  )
}

export function TypeBadge({ type, size = 'sm' }: { type: ClipType; size?: 'sm' | 'md' }) {
  const labels: Record<ClipType, string> = {
    fuga: 'FUGA',
    enquadro: 'ENQUADRO',
    perseguicao: 'PERSEGUIÇÃO',
    abordagem: 'ABORDAGEM',
    jogada: 'JOGADA',
    clutch: 'CLUTCH',
    reacao: 'REAÇÃO',
    treta: 'TRETA',
    momento: 'MOMENTO',
  }
  return (
    <span className={`type-badge type-${type} ${size === 'md' ? 'type-md' : ''}`}>
      <i />
      {labels[type]}
    </span>
  )
}

export function StagePill({ stage }: { stage: string }) {
  const map: Record<string, string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', renderizado: 'Renderizado' }
  return <span className={`stage-pill stage-${stage}`}>{map[stage] || stage}</span>
}

export function ScoreRing({ score, size = 38 }: { score: number; size?: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(100, score) / 100)
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size}>
        <circle cx="18" cy="18" r={r} fill="rgba(8,5,14,.55)" stroke="rgba(255,255,255,.16)" strokeWidth="2.2" />
        <circle
          cx="18" cy="18" r={r} fill="none"
          stroke="url(#scoreGrad)" strokeWidth="2.6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 18 18)"
        />
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff6b6b" />
            <stop offset="100%" stopColor="#ffb02e" />
          </linearGradient>
        </defs>
      </svg>
      <b>{score}</b>
    </div>
  )
}

export function ProgressBar({ value, tone = 'violet', animated = false }: { value: number; tone?: 'violet' | 'amber' | 'green'; animated?: boolean }) {
  return (
    <div className={`pbar pbar-${tone} ${animated ? 'is-animated' : ''}`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

interface Option<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

export function Select<T extends string>({
  value, options, onChange, align = 'right', className = '',
}: { value: T; options: Option<T>[]; onChange: (v: T) => void; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`select ${className}`} ref={ref}>
      <button type="button" className={`select-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        {current?.icon}
        <span>{current?.label || 'Selecionar'}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`select-pop ${align === 'left' ? 'left' : ''}`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`select-opt ${o.value === value ? 'active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.icon}
              <span className="opt-main">
                <span>{o.label}</span>
                {o.hint && <em>{o.hint}</em>}
              </span>
              {o.value === value && <Check size={13} className="opt-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Modal({
  open, onClose, kicker, title, subtitle, children, footer, width = 540,
}: {
  open: boolean
  onClose: () => void
  kicker?: string
  title: string
  subtitle?: string
  children?: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function StatCard({
  label, value, hint, delta, tone = 'violet', spark,
}: { label: string; value: ReactNode; hint?: string; delta?: string; tone?: 'violet' | 'amber' | 'green' | 'red'; spark?: number[] }) {
  return (
    <div className={`stat panel tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {delta && <span className={`stat-delta ${delta.startsWith('-') ? 'neg' : ''}`}>{delta}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
      {spark && <Sparkline points={spark} tone={tone} />}
    </div>
  )
}

export function Sparkline({ points, tone = 'violet' }: { points: number[]; tone?: string }) {
  const max = Math.max(...points)
  const min = Math.min(...points)
  const norm = points.map((p) => (max === min ? 0.5 : (p - min) / (max - min)))
  const path = norm.map((p, i) => `${(i / (points.length - 1)) * 100},${28 - p * 24}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={path} fill="none" stroke={`var(--tone-${tone})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,30 ${path} 100,30`} fill={`var(--tone-${tone})`} opacity=".08" />
    </svg>
  )
}

export function PageHead({ kicker, title, sub, actions }: { kicker?: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, text = '', action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useApp()
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          <Info size={16} />
          <span>{t.text}</span>
          <X size={13} className="toast-x" />
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function Cover({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <div className={`cover-fallback ${className}`} aria-label={alt}><Logo size={28} /></div>
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

export function Dot({ tone = 'green', pulse = false }: { tone?: string; pulse?: boolean }) {
  return <i className={`dot dot-${tone} ${pulse ? 'pulse' : ''}`} />
}
