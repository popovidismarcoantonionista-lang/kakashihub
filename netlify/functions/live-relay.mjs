const ALLOWED_HOSTS = new Set([
  'inv.nadeko.net',
  'yewtu.be',
  'invidious.nerdvpn.de',
  'invidious.privacyredirect.com',
  'invidious.fdn.fr',
  'invidious.slipfox.xyz',
  'yt.chocolatemoo53.com',
])

function hostAllowed(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true
  return /^yt-comp\d+\.chocolatemoo53\.com$/i.test(hostname)
}

export default async (req) => {
  const u = new URL(req.url)
  const raw = u.searchParams.get('url') || ''
  let target
  try { target = new URL(raw) } catch {
    return new Response(JSON.stringify({ error: 'URL inválida.' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }
  if (target.protocol !== 'https:') {
    return new Response(JSON.stringify({ error: 'Só HTTPS é permitido.' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }
  if (!hostAllowed(target.hostname)) {
    return new Response(JSON.stringify({ error: 'Host não permitido.' }), { status: 403, headers: { 'content-type': 'application/json' } })
  }
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' },
    })
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `espelho HTTP ${upstream.status}` }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
    const buf = await upstream.arrayBuffer()
    if (buf.byteLength > 6 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Recurso grande demais.' }), { status: 413, headers: { 'content-type': 'application/json' } })
    }
    const type = upstream.headers.get('content-type') || 'application/octet-stream'
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': type,
        'cache-control': 'no-store',
        'x-relay-cache': 'miss',
      },
    })
  } catch (e) {
    const msg = e?.name === 'TimeoutError' || /timeout|aborted/i.test(String(e?.message || e))
      ? 'Espelho demorou para responder.'
      : 'Espelho indisponível.'
    return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { 'content-type': 'application/json' } })
  }
}

export const config = { path: '/api/live/relay' }
