// Mídia persistida no Netlify Blobs: free/sem cartão, aceita MP4 grandes e não
// depende do store do Vercel (suspenso por limite de banda). O container mantém
// uma cópia local em DATA para leitura rápida e para não pagar egress de novo a
// cada reprodução. As URLs brutas do Blob nunca são expostas ao front.
import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { COVERS, MEDIA } from './store.mjs'

const SITE_ID = String(process.env.NETLIFY_SITE_ID || '282dc099-565e-4c4f-a9be-44c3461e81e9').trim()
const TOKEN = String(
  process.env.NETLIFY_BLOBS_TOKEN
  || process.env.NETLIFY_AUTH_TOKEN
  || process.env.NETLIFY_TOKEN
  || '',
).trim()
const STORE_NAME = String(process.env.NETLIFY_BLOB_STORE || 'kakashihub').trim()
const API_URL = 'https://api.netlify.com/api/v1/blobs'
// getStore usa este prefixo para stores de site (não deploy-specific).
const STORE_PREFIX = `site:${STORE_NAME}`
const USE_BLOB = Boolean(SITE_ID && TOKEN && STORE_NAME)
const pendingDownloads = new Map()
const SYNC_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|jpg|jpeg|png|webp|gif)$/i

function cleanPathname(value) {
  const pathname = String(value || '').replace(/^\/+/, '')
  if (!pathname || pathname.includes('\\') || pathname.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!/^(media|covers)\//.test(pathname)) return null
  return pathname
}

function blobStore() {
  return getStore(STORE_NAME, { siteID: SITE_ID, token: TOKEN, consistency: 'strong' })
}

function apiKeyUrl(key) {
  const segments = String(key).split('/').map((part) => encodeURIComponent(part)).join('/')
  return `${API_URL}/${encodeURIComponent(SITE_ID)}/${STORE_PREFIX}/${segments}`
}

function contentTypeFor(pathname) {
  const ext = path.extname(String(pathname || '')).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.m4v') return 'video/x-m4v'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.avi') return 'video/x-msvideo'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function localPathFor(pathname) {
  const safePath = cleanPathname(pathname)
  if (!safePath) return null
  const root = safePath.startsWith('media/') ? MEDIA : COVERS
  const relative = safePath.slice(safePath.indexOf('/') + 1)
  return path.join(root, ...relative.split('/'))
}

async function signedGetUrl(key) {
  const response = await fetch(apiKeyUrl(key), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json;type=signed-url',
    },
  })
  if (!response.ok) {
    const error = new Error(`Netlify Blobs: HTTP ${response.status}`)
    error.statusCode = response.status
    throw error
  }
  const data = await response.json().catch(() => null)
  if (!data?.url) throw new Error('Netlify Blobs não devolveu URL de leitura.')
  return data.url
}

export function mediaPathFromUrl(value) {
  const pathname = String(value || '')
  if (pathname.startsWith('/media/')) return cleanPathname(`media/${pathname.slice('/media/'.length)}`)
  if (pathname.startsWith('/covers/')) return cleanPathname(`covers/${pathname.slice('/covers/'.length)}`)
  return null
}

export function blobStorageEnabled() {
  return USE_BLOB
}

export async function storeLocalFile(filePath, pathname, contentType) {
  const safePath = cleanPathname(pathname)
  if (!safePath) throw new Error('Caminho de mídia inválido.')
  if (!USE_BLOB) {
    if (process.env.NETLIFY || process.env.VERCEL) throw new Error('O armazenamento Netlify Blobs não está configurado.')
    return null
  }
  const metadata = Buffer.from(JSON.stringify({ contentType: contentType || contentTypeFor(safePath) })).toString('base64')
  const body = Readable.toWeb(fs.createReadStream(filePath))
  const response = await fetch(apiKeyUrl(safePath), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': contentType || contentTypeFor(safePath),
      'netlify-blobs-metadata': `b64;${metadata}`,
    },
    body,
    duplex: 'half',
  })
  if (!response.ok) throw new Error(`Netlify Blobs: falha ao enviar (${response.status})`)
  await response.arrayBuffer().catch(() => {})
  return safePath
}

async function downloadBlobToCache(pathname, filename) {
  const safePath = cleanPathname(pathname)
  if (!safePath) throw new Error('Caminho de mídia inválido.')
  if (!USE_BLOB) throw new Error('O armazenamento Netlify Blobs não está configurado.')
  const target = localPathFor(safePath)
  if (!target) throw new Error('Caminho de mídia inválido.')
  const name = path.basename(String(filename || path.basename(safePath))).replace(/[^\w.-]/g, '_') || 'media.bin'
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temp = path.join(path.dirname(target), `${name}.${randomUUID()}.part`)
  try {
    const url = await signedGetUrl(safePath)
    const response = await fetch(url)
    if (response.status === 404) throw new Error('arquivo-inexistente')
    if (!response.ok || !response.body) throw new Error(`Netlify Blobs: HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp, { flags: 'wx' }))
    if (fs.existsSync(target)) {
      fs.rmSync(temp, { force: true })
      return target
    }
    fs.renameSync(temp, target)
    return target
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

export async function ensureLocalMedia(pathname, localFallback, filename) {
  if (localFallback && fs.existsSync(localFallback)) return localFallback
  const safePath = cleanPathname(pathname)
  if (!safePath) return null
  const target = localPathFor(safePath)
  if (target && fs.existsSync(target) && fs.statSync(target).size > 0) return target
  if (!USE_BLOB) return null
  const cached = pendingDownloads.get(safePath)
  if (cached) {
    try { return await cached } catch { pendingDownloads.delete(safePath) }
  }
  const pending = downloadBlobToCache(safePath, filename)
  pendingDownloads.set(safePath, pending)
  try {
    const filePath = await pending
    pendingDownloads.set(safePath, Promise.resolve(filePath))
    return filePath
  } catch (error) {
    pendingDownloads.delete(safePath)
    throw error
  }
}

export async function blobMediaExists(pathname) {
  const safePath = cleanPathname(pathname)
  if (!safePath || !USE_BLOB) return false
  try {
    return Boolean(await blobStore().getMetadata(safePath))
  } catch {
    return false
  }
}

export async function deleteBlobMedia(pathnames) {
  if (!USE_BLOB) return
  const safePaths = (Array.isArray(pathnames) ? pathnames : [pathnames])
    .map(cleanPathname)
    .filter(Boolean)
  for (const key of safePaths) {
    try { await blobStore().delete(key) } catch {}
  }
}

/** Uploads arquivos já presentes no disco (útil na primeira migração). */
export async function syncLocalMediaToBlobs() {
  if (!USE_BLOB) return { enabled: false, checked: 0, uploaded: 0, errors: 0 }
  const files = []
  for (const root of [MEDIA, COVERS]) {
    const stack = [root]
    while (stack.length && files.length < 400) {
      const dir = stack.pop()
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) stack.push(abs)
        else if (entry.isFile() && SYNC_EXTENSIONS.test(entry.name) && fs.statSync(abs).size > 0) files.push(abs)
      }
    }
  }
  const stats = { enabled: true, checked: files.length, uploaded: 0, skipped: 0, errors: 0 }
  let cursor = 0
  const worker = async () => {
    while (cursor < files.length) {
      const abs = files[cursor++]
      const relative = abs.startsWith(`${MEDIA}${path.sep}`)
        ? `media/${path.relative(MEDIA, abs).split(path.sep).join('/')}`
        : `covers/${path.relative(COVERS, abs).split(path.sep).join('/')}`
      try {
        if (await blobMediaExists(relative)) stats.skipped += 1
        else {
          await storeLocalFile(abs, relative, contentTypeFor(relative))
          stats.uploaded += 1
        }
      } catch (error) {
        stats.errors += 1
        console.warn('[blobs:sync]', relative, String(error?.message || error).slice(0, 160))
      }
    }
  }
  await Promise.all([worker(), worker()])
  return stats
}
