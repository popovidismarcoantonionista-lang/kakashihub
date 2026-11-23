import type { CamBox } from '../types'

type Api = (path: string, init?: RequestInit) => Promise<any>

/** Detecta a webcam no servidor, analisando o vídeo real em vários quadros. */
export async function detectCamBoxAuto(
  kind: 'clip' | 'live',
  id: string,
  api: Api,
): Promise<CamBox | null> {
  try {
    const path = kind === 'clip' ? `/api/clips/${id}/detect-cam` : `/api/live/${id}/detect-cam`
    const data = await api(path, { method: 'POST' })
    const cam = data?.cam
    if (!cam || ![cam.x, cam.y, cam.w, cam.h].every((n) => Number.isFinite(n))) return null
    return cam as CamBox
  } catch {
    return null
  }
}

/** Detecta a webcam num quadro 16:9 usando a faixa de pele, no navegador. */
export async function detectCamBoxFromImage(url: string): Promise<CamBox | null> {
  try {
    const img = new Image()
    img.src = url
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('frame indisponível'))
    })
    const w = 160
    const h = Math.max(1, Math.round((img.height / img.width) * w))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let left = 0
    let right = 0
    let sx = 0
    let sy = 0
    let n = 0
    for (let y = 0; y < Math.floor(h * 0.72); y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const skin = r > 95 && g > 40 && b > 20
          && Math.max(r, g, b) - Math.min(r, g, b) > 15
          && Math.abs(r - g) > 15 && r > g && r > b
        if (!skin) continue
        if (x < w / 2) left++; else right++
        sx += x / w
        sy += y / h
        n++
      }
    }
    if (n < 12) return null
    const preferRight = right >= left
    const cx = preferRight ? Math.max(0.62, sx / n) : Math.min(0.38, sx / n)
    const cy = Math.min(0.42, Math.max(0.1, sy / n))
    const bw = 0.3
    const bh = 0.36
    return {
      x: Math.min(1 - bw - 0.01, Math.max(0.01, cx - bw / 2)),
      y: Math.min(0.66 - bh, Math.max(0.01, cy - bh / 2)),
      w: bw,
      h: bh,
    }
  } catch {
    return null
  }
}
