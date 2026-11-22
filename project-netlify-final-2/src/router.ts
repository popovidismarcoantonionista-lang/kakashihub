import { useCallback, useEffect, useState } from 'react'
import type { Page } from './types'

export interface Route {
  page: Page
  params: URLSearchParams
}

const PAGES: Page[] = ['cortes', 'videos', 'estudio', 'uploads', 'ia']

export function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [route, encodedParams] = raw.split('~', 2)
  const p = (PAGES.includes(route as Page) ? route : 'cortes') as Page
  let params = new URLSearchParams()
  if (encodedParams) {
    try {
      const base64 = encodedParams.replace(/-/g, '+').replace(/_/g, '/')
      params = new URLSearchParams(atob(base64))
    } catch {
      params = new URLSearchParams()
    }
  }
  return { page: p, params }
}

export function navigate(page: Page, params?: Record<string, string | undefined>) {
  const query = new URLSearchParams()
  if (params) for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const serializedParams = query.toString()
  const encodedParams = serializedParams
    ? btoa(serializedParams).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    : ''
  window.location.hash = `#${page}${encodedParams ? `~${encodedParams}` : ''}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function useNavigate() {
  return useCallback(navigate, [])
}
