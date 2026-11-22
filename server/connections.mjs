import { getState, save } from './store.mjs'

export const PLATFORMS = ['youtube', 'tiktok', 'facebook']

function ensure() {
  const state = getState()
  state.connections ||= {}
  return state.connections
}

export function saveConnections() {
  save()
}

export function getConnection(platform) {
  return ensure()[platform] || null
}

export function platformLabel(platform) {
  return { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook' }[platform] || platform
}

export function isConnected(platform) {
  const c = getConnection(platform)
  if (!c) return false
  if (platform === 'youtube') return Boolean(c.refreshToken || c.accessToken)
  if (platform === 'tiktok') return Boolean(c.refreshToken || c.accessToken)
  if (platform === 'facebook') return Boolean(c.pageToken)
  return false
}

export function hasCredentials(platform) {
  const c = getConnection(platform)
  return Boolean(c?.clientId && c?.clientSecret)
}

export function setCredentials(platform, clientId, clientSecret) {
  const s = ensure()
  s[platform] = { ...(s[platform] || {}), clientId: String(clientId || '').trim(), clientSecret: String(clientSecret || '').trim() }
  delete s[platform].connectedAt
  saveConnections()
}

export function saveAuth(platform, patch) {
  const s = ensure()
  s[platform] = { ...(s[platform] || {}), ...patch, connectedAt: new Date().toISOString() }
  saveConnections()
}

export function disconnect(platform) {
  const s = ensure()
  if (s[platform]) {
    s[platform] = { clientId: s[platform].clientId, clientSecret: s[platform].clientSecret }
    saveConnections()
  }
}

export function publicConnections() {
  const out = {}
  for (const platform of PLATFORMS) {
    const c = getConnection(platform)
    out[platform] = {
      platform,
      label: platformLabel(platform),
      connected: isConnected(platform),
      credentials: hasCredentials(platform),
      account: c?.account || '',
      pageId: c?.pageId || '',
      connectedAt: c?.connectedAt || null,
    }
  }
  return out
}
