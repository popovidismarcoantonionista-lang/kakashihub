const ALLOWED_HOSTS = new Set([
  'inv.nadeko.net','yewtu.be','invidious.nerdvpn.de','invidious.privacyredirect.com',
  'invidious.fdn.fr','invidious.slipfox.xyz','invidious.privacydev.net','inv.zoomerville.com','yt.chocolatemoo53.com',
])
function hostAllowed(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true
  return /^yt-comp\d+\.chocolatemoo53\.com$/i.test(hostname)
}
async function handleRelay(rawUrl) {
  let target
  try { target = new URL(rawUrl || '') } catch {
    return { status: 400, body: JSON.stringify({ error: 'URL inválida.' }), type: 'application/json' }
  }
  if (target.protocol !== 'https:') return { status: 400, body: JSON.stringify({ error: 'Só HTTPS é permitido.' }), type: 'application/json' }
  if (!hostAllowed(target.hostname)) return { status: 403, body: JSON.stringify({ error: 'Host não permitido.' }), type: 'application/json' }
  try {
    const upstream = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' } })
    if (!upstream.ok) return { status: 502, body: JSON.stringify({ error: `espelho HTTP ${upstream.status}` }), type: 'application/json' }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.byteLength > 6 * 1024 * 1024) return { status: 413, body: JSON.stringify({ error: 'Recurso grande demais.' }), type: 'application/json' }
    return { status: 200, body: buf, type: upstream.headers.get('content-type') || 'application/octet-stream' }
  } catch (e) {
    const msg = e?.name === 'TimeoutError' || /timeout|aborted/i.test(String(e?.message || e)) ? 'Espelho demorou para responder.' : 'Espelho indisponível.'
    return { status: 502, body: JSON.stringify({ error: msg }), type: 'application/json' }
  }
}

// v2 (Netlify Functions)
export default async (req) => {
  const u = new URL(req.url)
  const r = await handleRelay(u.searchParams.get('url') || '')
  const headers = { 'content-type': r.type, 'cache-control': 'no-store' }
  if (r.status === 200 && Buffer.isBuffer(r.body)) return new Response(r.body, { status: 200, headers })
  return new Response(r.body, { status: r.status, headers })
}

// v1 fallback
export const handler = async (event) => {
  const raw = event?.queryStringParameters?.url || ''
  const r = await handleRelay(raw)
  if (r.status === 200 && Buffer.isBuffer(r.body)) {
    return { statusCode: 200, headers: { 'content-type': r.type, 'cache-control': 'no-store' }, body: r.body.toString('base64'), isBase64Encoded: true }
  }
  return { statusCode: r.status, headers: { 'content-type': r.type, 'cache-control': 'no-store' }, body: String(r.body) }
}

export const config = { path: '/api/live/relay' }

