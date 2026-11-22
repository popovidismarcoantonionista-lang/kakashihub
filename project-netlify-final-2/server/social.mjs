import fs from 'node:fs'
import crypto from 'node:crypto'
import { getState, save } from './store.mjs'
import {
  getConnection, saveAuth, setCredentials, platformLabel,
} from './connections.mjs'

const PORT = Number(process.env.PORT) || 4780
const BASE = process.env.PUBLIC_BASE || `http://localhost:${PORT}`
const API_VERSION = 'v21.0'

function pendingStates() {
  const state = getState()
  state.oauthPending ||= {}
  return state.oauthPending
}

export function callbackUrl(platform, base = BASE) {
  return `${String(base || BASE).replace(/\/$/, '')}/api/oauth/${platform}/callback`
}

function assertCredentials(platform) {
  const c = getConnection(platform)
  if (!c?.clientId || !c?.clientSecret) {
    throw new Error(`Configure o acesso do ${platformLabel(platform)} antes de conectar.`)
  }
  return c
}

function newState(platform, returnTo, extra = {}) {
  const state = crypto.randomBytes(18).toString('hex')
  const pending = pendingStates()
  pending[state] = { platform, returnTo, at: Date.now(), ...extra }
  for (const [key, value] of Object.entries(pending)) {
    if (Date.now() - value.at > 15 * 60 * 1000) delete pending[key]
  }
  save()
  return state
}

export function oauthStart(platform, returnTo, base = BASE) {
  const c = assertCredentials(platform)
  const state = newState(platform, safeReturn(returnTo, base))
  if (platform === 'youtube') {
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: callbackUrl('youtube', base),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
  }
  if (platform === 'tiktok') {
    const verifier = crypto.randomBytes(48).toString('base64url')
    pending.get(state).verifier = verifier
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const q = new URLSearchParams({
      client_key: c.clientId,
      redirect_uri: callbackUrl('tiktok', base),
      response_type: 'code',
      scope: 'user.info.basic,video.publish,video.upload',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`
  }
  if (platform === 'facebook') {
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: callbackUrl('facebook', base),
      response_type: 'code',
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video',
      state,
    })
    return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${q}`
  }
  throw new Error('Plataforma não suportada.')
}

function safeReturn(value, base = BASE) {
  try {
    const u = new URL(String(value || ''))
    if (/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return `${u.origin}/#/uploads`
  } catch {}
  return `${String(base || BASE).replace(/\/$/, '')}/#/uploads`
}

export async function oauthFinish(platform, query, base = BASE) {
  if (query?.error) throw new Error('Autorização cancelada.')
  const pending = pendingStates()
  const info = pending[String(query?.state || '')]
  if (!info || info.platform !== platform) throw new Error('Autorização expirada. Tente conectar de novo.')
  delete pending[String(query.state)]
  save()
  const code = String(query?.code || '')
  if (!code) throw new Error('Autorização não concluída.')
  const c = getConnection(platform)

  if (platform === 'youtube') {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: callbackUrl('youtube', base),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error('O YouTube recusou a conexão. Confira as credenciais do app.')
    const token = await tokenRes.json()
    if (!token.refresh_token) throw new Error('Autorize o acesso novamente para liberar a publicação automática.')
    let account = 'Canal do YouTube'
    try {
      const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      const chData = await ch.json()
      account = chData.items?.[0]?.snippet?.title || account
    } catch {}
    saveAuth('youtube', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
      account,
    })
    return { platform, account, returnTo: info.returnTo }
  }

  if (platform === 'tiktok') {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: c.clientId,
        client_secret: c.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl('tiktok', base),
        code_verifier: info.verifier || '',
      }),
    })
    if (!tokenRes.ok) throw new Error('O TikTok recusou a conexão. Confira as credenciais do app.')
    const token = await tokenRes.json()
    if (!token.access_token) throw new Error('O TikTok não devolveu o acesso. Tente conectar de novo.')
    let account = 'Conta do TikTok'
    try {
      const who = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,username', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      const whoData = await who.json()
      const u = whoData.data?.user
      account = u ? `${u.display_name || u.username || 'TikTok'} (@${u.username || ''})` : account
    } catch {}
    saveAuth('tiktok', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
      openId: token.open_id,
      account,
    })
    return { platform, account, returnTo: info.returnTo }
  }

  if (platform === 'facebook') {
    const shortRes = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token?` + new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: callbackUrl('facebook', base),
      code,
    }))
    const short = await shortRes.json()
    if (!short.access_token) throw new Error('O Facebook recusou a conexão. Confira as credenciais do app.')
    const longRes = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      fb_exchange_token: short.access_token,
    }))
    const long = await longRes.json()
    const userToken = long.access_token || short.access_token
    const pagesRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?` + new URLSearchParams({ access_token: userToken }))
    const pages = await pagesRes.json()
    const page = pages.data?.[0]
    if (!page) throw new Error('Nenhuma página do Facebook encontrada nesta conta.')
    saveAuth('facebook', {
      pageToken: page.access_token,
      pageId: page.id,
      account: page.name || 'Página do Facebook',
    })
    return { platform, account: page.name || 'Página do Facebook', returnTo: info.returnTo }
  }

  throw new Error('Plataforma não suportada.')
}

async function youtubeToken() {
  const c = getConnection('youtube')
  if (c?.accessToken && c.expiresAt && c.expiresAt > Date.now() + 60000) return c.accessToken
  if (!c?.refreshToken) throw new Error('Conecte o YouTube antes de publicar.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error('A conexão com o YouTube expirou. Conecte de novo antes de publicar.')
  const d = await r.json()
  saveAuth('youtube', { accessToken: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 })
  return d.access_token
}

async function tiktokToken() {
  const c = getConnection('tiktok')
  if (c?.accessToken && c.expiresAt && c.expiresAt > Date.now() + 60000) return c.accessToken
  if (!c?.refreshToken) throw new Error('Conecte o TikTok antes de publicar.')
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
    }),
  })
  if (!r.ok) throw new Error('A conexão com o TikTok expirou. Conecte de novo antes de publicar.')
  const d = await r.json()
  saveAuth('tiktok', {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || c.refreshToken,
    expiresAt: Date.now() + (d.expires_in || 3600) * 1000,
  })
  return d.access_token
}

async function publishYouTube(file, meta) {
  const token = await youtubeToken()
  const size = fs.statSync(file).size
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: {
        title: String(meta.title || 'Corte').slice(0, 100),
        description: meta.description || '',
        tags: (meta.tags || []).slice(0, 15),
        categoryId: '25',
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }),
  })
  if (!init.ok) throw new Error('O YouTube recusou o envio. Confira a conexão e tente de novo.')
  const location = init.headers.get('location')
  if (!location) throw new Error('O YouTube não abriu o envio do vídeo. Tente de novo.')
  const up = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: fs.createReadStream(file),
    duplex: 'half',
  })
  if (!up.ok) throw new Error('O envio para o YouTube falhou no meio. Tente publicar de novo.')
  const data = await up.json()
  return { id: data.id, url: data.id ? `https://youtu.be/${data.id}` : '' }
}

async function publishTikTok(file, meta) {
  const token = await tiktokToken()
  const size = fs.statSync(file).size
  const chunkSize = Math.min(Math.max(size <= 64 * 1024 * 1024 ? size : 10 * 1024 * 1024, 1), 64 * 1024 * 1024)
  const total = Math.max(1, Math.ceil(size / chunkSize))
  const init = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: [meta.title, (meta.tags || []).map((t) => `#${t}`).join(' ')].filter(Boolean).join(' ').slice(0, 2000),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: total,
      },
    }),
  })
  const data = await init.json().catch(() => ({}))
  if (!init.ok || !data.data?.upload_url) {
    const code = data?.error?.code || ''
    if (/unaudited|private/i.test(code)) {
      throw new Error('O TikTok ainda não liberou a postagem direta para este app.')
    }
    throw new Error('O TikTok recusou o envio. Confira a conexão e tente de novo.')
  }
  const uploadUrl = data.data.upload_url
  const publishId = data.data.publish_id
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize
    const end = Math.min(size, start + chunkSize)
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(end - start),
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: fs.createReadStream(file, { start, end: end - 1 }),
      duplex: 'half',
    })
    if (!res.ok) throw new Error('O envio para o TikTok falhou no meio. Tente publicar de novo.')
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 5000))
    const st = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId }),
    })
    const stData = await st.json().catch(() => ({}))
    const status = stData.data?.status
    if (status === 'PUBLISH_COMPLETE') {
      return { id: publishId, url: '' }
    }
    if (status === 'FAILED') {
      throw new Error('O TikTok não concluiu a publicação. Tente de novo.')
    }
  }
  throw new Error('O TikTok está demorando para concluir. Confira o perfil em instantes.')
}

async function publishFacebook(file, meta) {
  const c = getConnection('facebook')
  if (!c?.pageToken || !c?.pageId) throw new Error('Conecte o Facebook antes de publicar.')
  const size = fs.statSync(file).size
  if (meta.vertical) {
    const startRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${c.pageId}/video_reels?` + new URLSearchParams({
      upload_phase: 'start',
      access_token: c.pageToken,
    }), { method: 'POST' })
    const start = await startRes.json()
    if (!start.video_id || !start.upload_url) throw new Error('O Facebook não abriu o envio do Reels. Tente de novo.')
    const up = await fetch(start.upload_url, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${c.pageToken}`,
        offset: '0',
        file_size: String(size),
        'Content-Length': String(size),
        'Content-Type': 'video/mp4',
      },
      body: fs.createReadStream(file),
      duplex: 'half',
    })
    if (!up.ok) throw new Error('O envio para o Facebook falhou no meio. Tente publicar de novo.')
    const finRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${c.pageId}/video_reels?` + new URLSearchParams({
      upload_phase: 'finish',
      video_id: start.video_id,
      video_state: 'PUBLISHED',
      description: meta.description || meta.title || '',
      access_token: c.pageToken,
    }), { method: 'POST' })
    const fin = await finRes.json()
    if (!finRes.ok) throw new Error('O Facebook recusou a publicação do Reels.')
    return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` }
  }
  if (size > 512 * 1024 * 1024) throw new Error('Este vídeo é grande demais para publicar no Facebook aqui.')
  const fd = new FormData()
  fd.append('access_token', c.pageToken)
  fd.append('title', String(meta.title || 'Vídeo').slice(0, 100))
  fd.append('description', meta.description || '')
  fd.append('source', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), 'video.mp4')
  const res = await fetch(`https://graph-video.facebook.com/${API_VERSION}/${c.pageId}/videos`, {
    method: 'POST',
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.id) throw new Error('O Facebook recusou o envio do vídeo. Tente de novo.')
  return { id: data.id, url: `https://www.facebook.com/${data.id}` }
}

export async function publishToPlatform(platform, file, meta) {
  if (!fs.existsSync(file)) throw new Error('O vídeo deste agendamento não está mais disponível.')
  if (platform === 'youtube') return publishYouTube(file, meta)
  if (platform === 'tiktok') return publishTikTok(file, meta)
  if (platform === 'facebook') return publishFacebook(file, meta)
  throw new Error('Plataforma não suportada.')
}

export function saveAppCredentials(platform, clientId, clientSecret) {
  if (!['youtube', 'tiktok', 'facebook'].includes(platform)) throw new Error('Plataforma não suportada.')
  if (!clientId || !clientSecret) throw new Error('Informe o identificador e o segredo do app.')
  setCredentials(platform, clientId, clientSecret)
}
