const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
const TWITCH_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const CACHE_MS = 60_000

const STREAMERS = [
  ['gaules', 'Gaules'],
  ['alanzoka', 'Alanzoka'],
  ['casimito', 'Casimito'],
  ['cellbit', 'Cellbit'],
  ['baiano', 'Baiano'],
  ['yoda', 'Yoda'],
  ['felps', 'Felps'],
  ['loud_coringa', 'Loud Coringa'],
  ['mount', 'Mount'],
  ['brksedu', 'BRKsEDU'],
  ['lubatv', 'LubaTV'],
  ['goularte', 'Goularte'],
  ['nobru', 'Nobru'],
  ['bak', 'Bak'],
  ['t3ddy', 'T3ddy'],
  ['viniccius13', 'Viniccius13'],
  ['rezendeevil', 'Rezende Evil'],
  ['authenticgames', 'AuthenticGames'],
  ['jukes', 'Jukes'],
]

let cache = { at: 0, payload: null }

async function twitchChunk(group) {
  const parts = group.map(([login], i) =>
    `a${i}: user(login: "${login}") { displayName profileImageURL(width: 96) stream { title viewersCount game { name } } }`,
  )
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query: `query { ${parts.join(' ')} }` }),
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`twitch ${res.status}`)
  const data = (await res.json())?.data || {}
  const items = []
  group.forEach(([login, name], i) => {
    const user = data[`a${i}`]
    if (!user) return
    const stream = user.stream
    items.push({
      platform: 'twitch',
      login,
      name: user.displayName || name,
      avatar: user.profileImageURL || '',
      live: Boolean(stream),
      title: stream?.title || '',
      game: stream?.game?.name || '',
      viewers: stream?.viewersCount || 0,
      thumb: stream ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg` : '',
    })
  })
  return items
}

async function twitchItems() {
  const chunks = []
  for (let i = 0; i < STREAMERS.length; i += 12) chunks.push(STREAMERS.slice(i, i + 12))
  const results = await Promise.allSettled(chunks.map((group) => twitchChunk(group)))
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (!items.length && results.every((r) => r.status === 'rejected')) throw new Error('twitch unavailable')
  return items
}

async function kickItems() {
  const items = []
  let failures = 0
  for (const [login, name] of STREAMERS) {
    if (failures >= 3) break
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(login)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      })
      if (!res.ok) { failures += 1; continue }
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { failures += 1; continue }
      failures = 0
      if (!data || data.is_banned) continue
      const stream = data.livestream
      items.push({
        platform: 'kick',
        login,
        name,
        avatar: data.user?.profile_pic || '',
        live: Boolean(stream && stream.is_live),
        title: stream?.session_title || '',
        game: stream?.categories?.[0]?.name || '',
        viewers: stream?.viewer_count || 0,
        thumb: stream?.thumbnail?.url || '',
      })
    } catch {
      failures += 1
    }
  }
  if (!items.length) throw new Error(`kick unavailable (${failures} falhas)`)
  return items
}

export async function getRadar() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload

  const [twitch, kick] = await Promise.allSettled([twitchItems(), kickItems()])
  const ok = twitch.status === 'fulfilled' || kick.status === 'fulfilled'
  if (kick.status === 'rejected') console.error('[radar] kick:', kick.reason?.message || kick.reason)
  if (twitch.status === 'rejected') console.error('[radar] twitch:', twitch.reason?.message || twitch.reason)
  const all = [
    ...(twitch.status === 'fulfilled' ? twitch.value : []),
    ...(kick.status === 'fulfilled' ? kick.value : []),
  ]

  const best = new Map()
  for (const item of all) {
    const current = best.get(item.login)
    const better = !current
      || (item.live && !current.live)
      || (item.live === current.live && item.viewers > current.viewers)
    if (better) best.set(item.login, item)
  }

  const items = [...best.values()].sort((a, b) =>
    Number(b.live) - Number(a.live) || b.viewers - a.viewers || a.name.localeCompare(b.name, 'pt-BR'))

  const payload = {
    ok,
    kickOk: kick.status === 'fulfilled',
    items,
    liveCount: items.filter((i) => i.live).length,
    updatedAt: new Date().toISOString(),
  }
  if (ok) cache = { at: Date.now(), payload }
  return payload
}
