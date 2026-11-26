/**
 * Relay do resolvedor Cobalt.
 *
 * O Render sai de um IP de datacenter e a instância pública começa a exigir
 * JWT (error.api.auth.jwt.missing). Esta Function roda no IP do Netlify e só
 * encaminha o pedido apenas para lives Twitch/Kick. Não há segredo fixo no
 * repositório: o allowlist de host impede que o relay vire proxy aberto.
 */
const COBALT = process.env.COBALT_API_URL || 'https://rue-cobalt.xenon.zone/'
const ALLOWED_LIVE = /^https?:\/\/([a-z0-9-]+\.)*(twitch\.tv|kick\.com)(?:[/?]|$)/i

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

export default async function handler(request) {
  if (request.method !== 'POST') return reply({ status: 'error', error: { code: 'relay-method' } }, 405)

  let payload
  try {
    payload = await request.json()
  } catch {
    return reply({ status: 'error', error: { code: 'relay-invalid' } }, 400)
  }
  if (!payload || typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) {
    return reply({ status: 'error', error: { code: 'relay-invalid-url' } }, 400)
  }
  if (!ALLOWED_LIVE.test(payload.url)) {
    return reply({ status: 'error', error: { code: 'relay-host-not-allowed' } }, 403)
  }

  try {
    const res = await fetch(COBALT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: payload.url,
        videoQuality: payload.videoQuality || '720',
        downloadMode: payload.downloadMode || 'auto',
        youtubeVideoCodec: payload.youtubeVideoCodec || 'h264',
        youtubeVideoContainer: payload.youtubeVideoContainer || 'mp4',
        alwaysProxy: true,
        disableMetadata: true,
      }),
      signal: AbortSignal.timeout(1000 * 90),
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch (error) {
    console.error('[cobalt-relay]', String(error?.message || error).slice(0, 200))
    return reply({ status: 'error', error: { code: 'relay-unreachable' } }, 502)
  }
}
