import { del, get, put } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { DATA } from './store.mjs'

const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL)
const PRIVATE_ACCESS = 'private'
const downloadedFiles = new Map()

function cleanPathname(value) {
  const pathname = String(value || '').replace(/^\/+/, '')
  if (!pathname || pathname.includes('\\') || pathname.split('/').some((part) => !part || part === '.' || part === '..')) return null
  if (!/^(media|covers)\//.test(pathname)) return null
  return pathname
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
    if (process.env.VERCEL) throw new Error('O armazenamento Blob não está configurado.')
    return null
  }
  const result = await put(safePath, fs.createReadStream(filePath), {
    access: PRIVATE_ACCESS,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
    cacheControlMaxAge: 0,
  })
  return result.pathname
}

export async function downloadBlobToTemp(pathname, filename = 'media.bin') {
  const safePath = cleanPathname(pathname)
  if (!safePath) throw new Error('Caminho de mídia inválido.')
  if (!USE_BLOB) throw new Error('O armazenamento Blob não está configurado.')
  const result = await get(safePath, { access: PRIVATE_ACCESS })
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error('O arquivo não foi encontrado no Blob.')
  const tempDir = path.join(DATA, 'tmp')
  fs.mkdirSync(tempDir, { recursive: true })
  const name = path.basename(String(filename || 'media.bin')).replace(/[^\w.-]/g, '_') || 'media.bin'
  const localPath = path.join(tempDir, `${randomUUID()}-${name}`)
  await pipeline(Readable.fromWeb(result.stream), fs.createWriteStream(localPath, { flags: 'wx' }))
  return localPath
}

export async function ensureLocalMedia(pathname, localFallback, filename) {
  if (localFallback && fs.existsSync(localFallback)) return localFallback
  const safePath = cleanPathname(pathname)
  if (!safePath) return null
  if (!USE_BLOB) return null
  const cached = downloadedFiles.get(safePath)
  if (cached) {
    const filePath = await cached
    if (fs.existsSync(filePath)) return filePath
    downloadedFiles.delete(safePath)
  }
  const pending = downloadBlobToTemp(safePath, filename || path.basename(safePath))
  downloadedFiles.set(safePath, pending)
  try {
    const filePath = await pending
    downloadedFiles.set(safePath, Promise.resolve(filePath))
    return filePath
  } catch (error) {
    downloadedFiles.delete(safePath)
    throw error
  }
}

export async function getPrivateBlob(pathname, requestHeaders = {}) {
  const safePath = cleanPathname(pathname)
  if (!safePath || !USE_BLOB) return null
  const range = requestHeaders.range || requestHeaders.Range
  const result = await get(safePath, {
    access: PRIVATE_ACCESS,
    ifNoneMatch: requestHeaders['if-none-match'] || requestHeaders['If-None-Match'],
    headers: range ? { Range: String(range) } : undefined,
  })
  return result
}

export async function deleteBlobMedia(pathnames) {
  if (!USE_BLOB) return
  const safePaths = (Array.isArray(pathnames) ? pathnames : [pathnames])
    .map(cleanPathname)
    .filter(Boolean)
  if (safePaths.length) await del(safePaths)
}
