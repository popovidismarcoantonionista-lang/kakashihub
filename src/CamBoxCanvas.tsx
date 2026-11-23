import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CamBox } from './types'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Drag = { mode: 'move' | Corner; x: number; y: number; box: CamBox }

const MIN = 0.08
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => +v.toFixed(4)

/** Preview com caixa arrastável e cantos redimensionáveis (mouse ou toque). */
export function CamBoxCanvas({
  imageUrl,
  value,
  onChange,
  emptyLabel = 'Aguardando o primeiro corte…',
}: {
  imageUrl: string
  value: CamBox
  onChange: (box: CamBox) => void
  emptyLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<Drag | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    // Imagem em cache pode disparar o load antes do efeito; confere o estado real.
    const img = imgRef.current
    if (img?.complete) {
      if (img.naturalWidth > 0) setLoaded(true)
      else setFailed(true)
    }
  }, [imageUrl])

  // Escutas na janela inteira: no celular o dedo sai da caixa pequena e o
  // pointer capture nem sempre é suportado. Assim o arraste não trava.
  const moveRef = useRef<(e: PointerEvent) => void>(() => {})
  moveRef.current = (e) => {
    const d = drag.current
    const rect = ref.current?.getBoundingClientRect()
    if (!d || !rect) return
    e.preventDefault()
    const dx = (e.clientX - d.x) / rect.width
    const dy = (e.clientY - d.y) / rect.height
    const b = d.box
    let next: CamBox
    if (d.mode === 'move') {
      next = {
        ...b,
        x: round(clamp(b.x + dx, 0, 1 - b.w)),
        y: round(clamp(b.y + dy, 0, 1 - b.h)),
      }
    } else {
      const left = d.mode === 'nw' || d.mode === 'sw'
      const top = d.mode === 'nw' || d.mode === 'ne'
      let x = left ? b.x + dx : b.x
      let y = top ? b.y + dy : b.y
      let w = left ? b.w - dx : b.w + dx
      let h = top ? b.h - dy : b.h + dy
      if (w < MIN) { if (left) x = b.x + b.w - MIN; w = MIN }
      if (h < MIN) { if (top) y = b.y + b.h - MIN; h = MIN }
      x = clamp(x, 0, 1 - MIN)
      y = clamp(y, 0, 1 - MIN)
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      next = { x: round(x), y: round(y), w: round(w), h: round(h) }
    }
    onChange(next)
  }
  const endRef = useRef<() => void>(() => {})
  endRef.current = () => { drag.current = null }

  useEffect(() => {
    const onMove = (e: PointerEvent) => moveRef.current(e)
    const onEnd = () => endRef.current()
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [])

  const start = (e: ReactPointerEvent, mode: Drag['mode']) => {
    if (!loaded) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { mode, x: e.clientX, y: e.clientY, box: { ...value } }
  }

  return (
    <>
      <div className={`cam-preview ${loaded ? 'is-loaded' : ''}`} ref={ref}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Quadro para ajuste da webcam"
          draggable={false}
          onLoad={() => { setLoaded(true); setFailed(false) }}
          onError={() => { setFailed(true); setLoaded(false) }}
        />
        {loaded && (
          <div
            className="cbc-box"
            role="button"
            tabIndex={0}
            aria-label="Mover caixa da webcam"
            style={{
              left: `${value.x * 100}%`,
              top: `${value.y * 100}%`,
              width: `${value.w * 100}%`,
              height: `${value.h * 100}%`,
            }}
            onPointerDown={(e) => start(e, 'move')}
          >
            {CORNERS.map((corner) => (
              <span
                key={corner}
                className={`cbc-handle cbc-handle-${corner}`}
                role="button"
                tabIndex={0}
                aria-label={`Redimensionar canto ${corner}`}
                onPointerDown={(e) => start(e, corner)}
              />
            ))}
          </div>
        )}
        {!loaded && (
          <span className="cam-preview-empty">{failed ? emptyLabel : 'Carregando quadro…'}</span>
        )}
      </div>
    </>
  )
}
