import path from 'node:path'
import { EXPORTS, addActivity, findClip, getState, save, withStore } from './store.mjs'
import { ensureLocalMedia, mediaPathFromUrl } from './media-store.mjs'
import { claimUploadForPublishing } from './store.mjs'
import { platformLabel } from './connections.mjs'
import { publishToPlatform } from './social.mjs'

async function uploadTarget(upload) {
  if (upload.compilationId) {
    const compilation = (getState().compilations || []).find((item) => item.id === upload.compilationId)
    if (!compilation || compilation.status !== 'pronto' || !compilation.url) {
      throw new Error('O vídeo longo deste agendamento ainda não está pronto.')
    }
    const file = await ensureLocalMedia(
      compilation.mediaKey || mediaPathFromUrl(compilation.url),
      path.join(EXPORTS, `${compilation.id}.mp4`),
      `${compilation.id}.mp4`,
    )
    if (!file) throw new Error('O vídeo longo deste agendamento não está disponível no Blob.')
    return { file, vertical: false, clip: null }
  }

  const clip = findClip(upload.clipId)
  if (!clip?.renderedUrl) throw new Error('O corte deste agendamento ainda não está pronto.')
  const file = await ensureLocalMedia(
    clip.renderedKey || mediaPathFromUrl(clip.renderedUrl),
    path.join(EXPORTS, `${clip.id}.mp4`),
    `${clip.id}.mp4`,
  )
  if (!file) throw new Error('O corte deste agendamento não está disponível no Blob.')
  return { file, vertical: true, clip }
}

function uploadMeta(upload, target) {
  const tags = (target.clip?.hashtags || []).map((tag) => String(tag).replace(/^#/, '')).filter(Boolean)
  const parts = [upload.title]
  if (tags.length) parts.push(tags.map((tag) => `#${tag}`).join(' '))
  parts.push('Cortes de fuga e enquadro.')
  return { title: upload.title, description: parts.join('\n\n'), tags, vertical: target.vertical }
}

export async function publishScheduledUpload(uploadId) {
  const claimed = await claimUploadForPublishing(uploadId)
  if (!claimed) return { status: 'skipped' }

  return withStore(async () => {
    const upload = getState().uploads.find((item) => item.id === uploadId)
    if (!upload) return { status: 'skipped' }
    upload.status = 'enviando'
    upload.error = null
    save()

    try {
      const target = await uploadTarget(upload)
      const result = await publishToPlatform(upload.platform, target.file, uploadMeta(upload, target))
      upload.status = 'publicado'
      upload.publishedAt = new Date().toISOString()
      upload.externalUrl = result.url || ''
      upload.externalId = result.id || ''
      addActivity('upload', `"${upload.title}" publicado no ${platformLabel(upload.platform)}`)
      save()
      return { status: upload.status, externalId: upload.externalId }
    } catch (error) {
      console.error('[publish]', upload.id, error?.stack || error)
      upload.status = 'erro'
      upload.error = error?.message || 'Não foi possível publicar agora.'
      save()
      return { status: upload.status, error: upload.error }
    }
  })
}
