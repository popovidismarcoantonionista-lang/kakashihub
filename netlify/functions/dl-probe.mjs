// TEMP: diagnóstico interno para testar espelhos a partir do IP do Netlify.
const KEY = 'kakashi-relay-2026'

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})

export default async function handler(request) {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405)
  if (request.headers.get('x-relay-key') !== KEY) return reply({ error: 'forbidden' }, 403)
  let payload
  try {
    payload = await request.json()
  } catch {
    return reply({ error: 'invalid' }, 400)
  }
  const id = String(payload.id || '5fxUjqly8oM').slice(0, 11)
  const hosts = Array.isArray(payload.hosts) ? payload.hosts.slice(0, 20) : []
  const out = []
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  for (const raw of hosts) {
    const base = String(raw || '').trim().replace(/\/+$/, '')
    const host = (() => { try { return new URL(base).host } catch { return base } })()
    try {
      const url = new URL(`${base}/api/v1/videos/${encodeURIComponent(id)}`)
      url.searchParams.set('local', 'true')
      const r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': ua },
        signal: AbortSignal.timeout(12000),
      })
      const text = await r.text().catch(() => '')
      let json = false
      let n = 0
      let has720 = false
      let stream = ''
      try {
        const parsed = JSON.parse(text)
        json = true
        const formats = Array.isArray(parsed?.adaptiveFormats) ? parsed.adaptiveFormats : []
        n = formats.length
        has720 = formats.some((f) => /720/i.test(String(f?.qualityLabel || '')) && /avc1/.test(String(f?.type || '')))
        const video = formats.find((f) => String(f?.itag) === '136' && f?.url)
        if (video) {
          const sr = await fetch(video.url, {
            headers: { 'User-Agent': ua, Accept: '*/*', Range: 'bytes=0-1023' },
            signal: AbortSignal.timeout(15000),
          })
          await sr.arrayBuffer().catch(() => {})
          stream = `${sr.status}/${sr.headers.get('content-range') || sr.headers.get('content-length') || ''}`
        }
      } catch {}
      out.push({ host, status: r.status, json, n, has720, stream, head: text.slice(0, 40) })
    } catch (error) {
      out.push({ host, error: String(error?.message || error).slice(0, 90) })
    }
  }
  return reply({ out })
}
