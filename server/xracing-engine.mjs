/**
 * Motor de edição automática estilo XRacing.
 *
 * Entrada: palavras com timestamp (faster-whisper) + duração da fonte.
 * Saída: corte principal, janela de replay, legenda verde e bipes.
 *
 * Tudo é determinístico e local: nenhuma API paga e nenhum dado sai do Render.
 */

// Palavras de AÇÃO valem mais que a explicação depois do susto. Palavrões
// sozinhos não definem o corte (ex.: "caralho" de comemoração no fim do vídeo).
const TENSION_WORDS = {
  jogar: 4, jogou: 4, jogando: 2, cima: 1, fechou: 4, fechar: 2, quase: 3,
  bateu: 3, atropelou: 4, atropelar: 3, freada: 4, freiou: 4, freia: 3,
  buzinou: 3, buzina: 3, buzinar: 3, colisão: 4, colisao: 4, proibido: 1.5,
  contínua: 1.5, continua: 1, invadiu: 3, invadir: 2, conversão: 2, conversao: 2,
  vermelho: 2, contramão: 4, contramao: 4, corredor: 1.5, ônibus: 2, onibus: 2,
  surgiu: 3, desesperar: 3, espatifar: 4, perigoso: 1, perigo: 1, louco: 1,
  discussão: 1, discussao: 1, atravessou: 3, pedestre: 2, faixa: 1,
  errado: 1, return: 1, virar: 1,
}

const PHRASE_BONUS = [
  { re: /jogar pra cima|jogou pra cima|jogando pra cima/i, value: 9 },
  { re: /quase (?:me )?(?:atropelou|bateu|colidiu)/i, value: 8 },
  { re: /freada|freou bruscamente/i, value: 7 },
  { re: /buzin/i, value: 5 },
  { re: /fechou/i, value: 5 },
  { re: /surgiu do nada/i, value: 6 },
  { re: /faixa contínua|faixa continua|proibido/i, value: 2 },
]

const PROFANITY = [
  { re: /\b(?:cara(?:lho|io)|caralhos|caramba)\b/i, weight: 4, label: 'caralho' },
  { re: /\b(?:porra|porras)\b/i, weight: 3, label: 'porra' },
  { re: /\b(?:merda|merdas)\b/i, weight: 3, label: 'merda' },
  { re: /\b(?:viad[oa]s?|bichas?)\b/i, weight: 4, label: 'viado' },
  { re: /\b(?:imbecil|imbecis|idiota|estupido|estúpido)\b/i, weight: 3, label: 'imbecil' },
  { re: /\b(?:foda|fude|fodid[oa]|f\*\*\*)\b/i, weight: 4, label: 'f***' },
  { re: /\b(?:p\*\*\*|puta|putaria)\b/i, weight: 4, label: 'p***' },
  { re: /\b(?:arrombado|cuzão|cuzao|desgraçado|desgracado)\b/i, weight: 4, label: 'ofensa' },
  { re: /\bfia da peste\b/i, weight: 4, label: 'fia da peste' },
  { re: /\bfilho da puta\b/i, weight: 4, label: 'filho da puta' },
]

function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function wordParts(word) {
  const text = tidy(word?.w).replace(/[^\p{L}*]/gu, '').toLowerCase()
  if (!text) return { action: 0, profanity: 0 }
  let action = TENSION_WORDS[text] || 0
  let profanity = 0
  for (const rule of PROFANITY) if (rule.re.test(text)) profanity += rule.weight
  return { action, profanity }
}

function wordWeight(word) {
  const { action, profanity } = wordParts(word)
  return action + Math.min(profanity, 8) * 0.4
}

function mergeRanges(ranges, gap = 0.35) {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, Number(r.start) || 0), end: Math.max(0, Number(r.end) || 0) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)
  const out = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start - last.end <= gap) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

// Falas que não são conteúdo: abertura, patrocínio e chamadas para engajamento.
// São combinadas em português e inglês porque o YouTube entrega legendas
// automáticas em inglês mesmo quando o vídeo falado é português.
const SKIP_RULES = [
  {
    kind: 'intro',
    re: /\b(?:sej[ao]m?\s+bem[- ]?vind[oa]s?|bem[- ]?vindo\s+ao\s+canal|abertura\s+do\s+canal|na\s+abertura|chegou\s+mais\s+um|come[cç]ou\s+mais\s+um|antes\s+de\s+come[cç]ar|primeiro\s+de\s+tudo|hoje\s+a\s+gente\s+vai|welcome\s+(?:back|to)|what'?s\s+up(?:\s+guys)?|hey\s+guys|before\s+we\s+(?:start|begin|get)|today\s+we(?:'re|\s+are)\s+going)\b/i,
  },
  {
    kind: 'patrocinio',
    re: /\b(?:patrocinad[oa]s?|patroc[ií]nio|apoiado\s+por|publicidade|parceria|cupom|desconto|link\s+na\s+descri[cç][aã]o|use\s+(?:o|nosso)\s+cupom|c[oó]digo\s+promocional|sponsored\s+by|this\s+video\s+is\s+sponsored|promo\s+code|discount\s+code|thanks\s+to\s+(?:our\s+)?sponsors?)\b/i,
  },
  {
    kind: 'engajamento',
    re: /\b(?:inscreva[-\s]?se|inscreva\s+a[ií]|inscrevam[-\s]?se|se\s+inscreva|se\s+inscrever|curta\s+o\s+v[ií]deo|curte\s+a[ií]|d[aá]\s+um\s+like|deixe\s+(?:o\s+|seu\s+)?like|ativar\s+o\s+sininho|ative\s+o\s+sino|at[ié]\s+a\s+pr[oó]xima|at[ié]\s+logo|obrigad[oa]\s+por\s+assistir|tchau|subscribe|like\s+and\s+subscribe|hit\s+the\s+bell|thanks\s+for\s+watching|see\s+you\s+next|smash\s+that\s+like)\b/i,
  },
]

function normalizedWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((w) => ({ w: tidy(w?.w), s: Number(w?.s), e: Number(w?.e) }))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e))
}

/** Encontra trechos de abertura/patrocínio/engajamento com tempo absoluto. */
export function detectSkippableRanges(words, duration = 0) {
  const list = normalizedWords(words)
  if (!list.length) return []
  const total = Math.max(0, Number(duration) || list[list.length - 1].e)
  const found = []
  for (let i = 0; i < list.length; i++) {
    const win = []
    let phrase = ''
    let matched = false
    // CTAs longos e com pausas ("... inscreva-se ... até a próxima") não
    // cabiam na janela de 7 palavras/1,1s e escapavam do corte.
    for (let j = i; j < Math.min(list.length, i + 14); j++) {
      if (j > i && list[j].s - list[j - 1].e > 2.6) break
      win.push(list[j])
      phrase += (phrase ? ' ' : '') + list[j].w
      for (const rule of SKIP_RULES) {
        const m = rule.re.exec(phrase)
        if (!m) continue
        const before = phrase.slice(0, m.index).trim()
        const from = before ? before.split(/\s+/).length - 1 : 0
        const through = phrase.slice(0, m.index + m[0].length).trim().split(/\s+/).length - 1
        const last = Math.min(win.length - 1, Math.max(from, through))
        found.push({
          start: Math.max(0, Math.round((win[from].s - 0.2) * 100) / 100),
          end: Math.min(total, Math.round((win[last].e + 0.35) * 100) / 100),
          reason: rule.kind,
        })
        matched = true
        break
      }
      if (matched) break
    }
  }
  // Abertura sem fala (só vinheta/música): o primeiro som já é conteúdo.
  if (!found.some((r) => r.reason === 'intro') && list[0].s > 4) {
    // Vinhetas sem fala podem passar de 6s; remover até 12s quando há silêncio
    // inicial claro, sem atingir o começo do conteúdo falado.
    found.push({ start: 0, end: Math.min(12, Math.round((list[0].s - 0.3) * 100) / 100), reason: 'intro' })
  }
  const sorted = found.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const merged = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start - last.end <= 1.2) {
      last.end = Math.max(last.end, r.end)
      last.reason = last.reason === r.reason ? last.reason : 'diversos'
    } else merged.push({ ...r })
  }
  return merged
}

/** Ajusta um corte para não sobrepor os trechos removidos. */
export function avoidSkippableRanges(start, end, ranges, minLen = 8, total = 0) {
  const list = mergeRanges(ranges, 0.2)
  let s = Math.max(0, Number(start) || 0)
  let e = Math.max(s + 1, Number(end) || s + 1)
  const limit = Math.max(1, Number(total) || e)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (const r of list) {
      if (r.end <= s || r.start >= e) continue
      // Prefere encerrar antes do trecho removido a descartar o começo do
      // vídeo: um corte de 15s é melhor que perder 20s de conteúdo.
      if (s < r.start && e > r.end && r.start - s >= Math.min(minLen, 8)) {
        e = Math.max(s + 1, r.start - 0.2)
      } else {
        s = r.end + 0.2
        e = Math.max(e, s + minLen)
      }
      changed = true
    }
    if (!changed) break
  }
  s = Math.min(s, Math.max(0, limit - 1))
  e = Math.min(limit, Math.max(s + 1, e))
  return { start: Math.round(s * 10) / 10, end: Math.round(e * 10) / 10 }
}

/** Junta palavras em falas curtas, usadas como fallback de legenda falada. */
export function wordsToCues(words) {
  const cues = []
  let current = null
  for (const w of words) {
    const start = Number(w?.s)
    const end = Number(w?.e)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const text = tidy(w?.w)
    if (!text) continue
    const gap = current ? start - current.end : 99
    if (!current || gap > 1.1 || current.words.length >= 9) {
      if (current) cues.push({ start: current.start, end: current.end, text: cuesText(current.words) })
      current = { start, end, words: [text] }
    } else {
      current.end = Math.max(current.end, end)
      current.words.push(text)
    }
  }
  if (current) cues.push({ start: current.start, end: current.end, text: cuesText(current.words) })
  return cues
}

function cuesText(words) {
  return tidy(words.join(' ')).replace(/^\W+|\W+$/g, '').slice(0, 220)
}

/** Encontra todos os palavrões/ofensas e devolve intervalos com folga para o bip. */
export function findBleeps(words) {
  const ranges = []
  const list = words.filter((w) => Number.isFinite(Number(w?.s)))
  for (let i = 0; i < list.length; i++) {
    const win = list.slice(i, i + 3)
    const parts = win.map((w) => tidy(w.w))
    const text = parts.join(' ')
    let hit = null
    for (const rule of PROFANITY) {
      const m = rule.re.exec(text)
      if (!m) continue
      let index = 0
      let acc = 0
      for (let k = 0; k < parts.length; k++) {
        if (acc + parts[k].length >= m.index) { index = k; break }
        acc += parts[k].length + 1
      }
      const count = Math.max(1, m[0].split(/\s+/).length)
      const last = Math.min(win.length - 1, index + count - 1)
      hit = { first: win[index], last: win[last] }
      break
    }
    if (!hit) continue
    const start = Math.max(0, Number(hit.first.s) - 0.12)
    const end = Math.max(start + 0.3, Number(hit.last.e) + 0.12)
    ranges.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 })
  }
  return mergeRanges(ranges).map(({ start, end }) => ({ start, end }))
}

function bestWindow(words, duration, span = 4) {
  if (!words.length) return 0
  const all = words.map((w) => ({ s: Number(w.s), text: tidy(w.w), ...wordParts(w) }))
    .filter((w) => Number.isFinite(w.s))
  const scored = all.filter((w) => w.action > 0 || w.profanity > 0)
  if (!scored.length) return 0
  const limit = Math.max(0, Number(duration) - span)
  let best = 0
  let bestScore = -1
  for (let t = 0; t <= limit; t += 0.5) {
    let action = 0
    let profanity = 0
    const phraseWords = []
    for (const w of all) {
      if (w.s < t - 0.4 || w.s > t + span) continue
      if (w.action || w.profanity) {
        action += w.action
        profanity += w.profanity
      }
      phraseWords.push(w.text)
    }
    if (action < 2) continue
    let score = action + Math.min(profanity, 8) * 0.4
    const phrase = phraseWords.join(' ')
    for (const bonus of PHRASE_BONUS) if (bonus.re.test(phrase)) score += bonus.value
    if (score > bestScore) { bestScore = score; best = t }
  }
  return Math.round(best * 10) / 10
}

export function debugScores(words, duration, span = 8) {
  const scored = (Array.isArray(words) ? words : []).map((w) => ({ s: Number(w.s), text: tidy(w.w), ...wordParts(w) }))
    .filter((w) => Number.isFinite(w.s) && (w.action > 0 || w.profanity > 0))
  const out = []
  for (let t = 0; t <= Math.max(0, Number(duration) - span); t += 0.5) {
    let action = 0, profanity = 0, phrase = ''
    for (const w of scored) {
      if (w.s < t - 0.4 || w.s > t + span) continue
      action += w.action; profanity += w.profanity; phrase += ` ${w.text}`
    }
    if (action < 2) continue
    let score = action + Math.min(profanity, 8) * 0.4
    for (const b of PHRASE_BONUS) if (b.re.test(phrase)) score += b.value
    out.push({ t, score: Math.round(score * 10) / 10, action, profanity, phrase: phrase.trim().slice(0, 110) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 400)
}

function infractionFor(text) {
  // Cita o CTB só quando a fala descreve a infração; os artigos foram conferidos
  // na Lei 9.503/97 (196 = não sinalizar deslocamento lateral, 207 = conversão
  // em local proibido, 208 = avançar sinal vermelho).
  if (/faixa contínua|continua|mudança de faixa|mudanca de faixa|vindo pra faixa/i.test(text)) return 'MUDANÇA DE FAIXA SEM SINALIZAR (CTB ART. 196)'
  if (/sinal vermelho|vermelho/i.test(text)) return 'AVANÇAR SINAL VERMELHO (CTB ART. 208)'
  if (/proibido|return|virar|conversão|conversao/i.test(text)) return 'CONVERSÃO PROIBIDA (CTB ART. 207)'
  if (/contramão|contramao/i.test(text)) return 'CONTRAMÃO'
  if (/corredor|ônibus|onibus/i.test(text)) return 'CORREDOR ENTRE FAIXAS SEM CAUTELA'
  if (/pedestre|faixa de pedestre/i.test(text)) return 'DAR PASSAGEM A PEDESTRE'
  return 'DIREÇÃO DEFENSIVA'
}

function actionFor(text) {
  if (/jogar|jogou|jogando/i.test(text)) return 'JOGOU O CARRO PARA CIMA DELE'
  if (/atropelou|atropelar/i.test(text)) return 'QUASE ATROPELOU'
  if (/freada|freou|freiou|freia/i.test(text)) return 'FREIOU BRUSCAMENTE'
  if (/buzina|buzinou/i.test(text)) return 'BUZINOU'
  if (/fechou|fechar/i.test(text)) return 'FECHOU A MOTO'
  if (/surgiu do nada|surgiu/i.test(text)) return 'SURGIU DO NADA NA FAIXA'
  return 'CRIOU RISCO DE COLISÃO'
}

function titleCaseWords(text) {
  return tidy(text).split(/\s+/).filter(Boolean)
}

function buildCaption(text, who = 'O MOTOCA') {
  const infraction = infractionFor(text)
  const action = actionFor(text)
  const lane = /faixa contínua|faixa continua|vindo pra faixa/i.test(text) ? ' VINHA EM FAIXA CONTÍNUA' : ' ESTAVA NA VIA'
  const raw = `${who}${lane} QUANDO O MOTORISTA ${action}. ${infraction}. ELE AINDA CULPOU ${who}.`
  let words = titleCaseWords(raw).map((w) => w.toUpperCase())
  if (words.length > 32) words = words.slice(0, 32)
  if (words.length < 15) {
    const extra = 'A MOTO ERA O VEÍCULO MAIS VULNERÁVEL DA CENA.'.split(/\s+/)
    words = words.concat(extra).slice(0, 32)
  }
  const caption = words.join(' ')
  const perLine = Math.ceil(words.length / 3)
  const lines = []
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '))
  return { caption, lines: lines.slice(0, 3), words: words.length }
}

/**
 * @param {Array<{w:string,s:number,e:number}>} words
 * @param {number} duration duração total da fonte em segundos
 * @param {{clipMin?:number, clipMax?:number}} settings
 */
export function analyzeXracing(words, duration, settings = {}) {
  const clean = (Array.isArray(words) ? words : [])
    .map((w) => ({ w: tidy(w?.w), s: Number(w?.s), e: Number(w?.e) }))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e))
  if (clean.length < 6) return null

  const total = Math.max(1, Number(duration) || 0)
  const clipMin = Math.max(12, Number(settings.clipMin) || 18)
  const clipMax = Math.max(clipMin + 4, Number(settings.clipMax) || 38)
  // A janela de pontuação é maior que o replay: assim a discussão inteira
  // entra na decisão e um único "fechou" isolado não rouba o corte.
  // Abertura, patrocínio e "inscreva-se" não podem virar pico nem legenda.
  const skipRanges = detectSkippableRanges(clean, total)
  const usable = clean.filter((w) => !skipRanges.some((r) => w.s >= r.start && w.s <= r.end))
  const pool = usable.length >= 6 ? usable : clean

  const span = 8
  const peak = bestWindow(pool, total, span)
  const rawStart = Math.max(0, Math.round((peak - 5) * 10) / 10)

  const within = pool.filter((w) => w.s >= peak && w.s <= peak + clipMax)
  const strong = within.filter((w) => wordWeight(w) > 0)
  const reactionEnd = strong.length
    ? Math.max(...strong.map((w) => w.e)) + 1.6
    : peak + 16
  const rawEnd = Math.min(total, Math.round(Math.max(peak + clipMin, Math.min(reactionEnd, peak + clipMax)) * 10) / 10)
  const cut = avoidSkippableRanges(rawStart, rawEnd, skipRanges, clipMin, total)
  const start = cut.start
  const end = cut.end

  // O replay é curto (2,5–4s); os 8s acima servem só para escolher o pico.
  const replaySpan = 4
  const replayRawStart = Math.max(start, Math.round((peak - 1) * 10) / 10)
  const replayRawEnd = Math.min(end, Math.round((replayRawStart + replaySpan) * 10) / 10)
  const replayCut = avoidSkippableRanges(replayRawStart, replayRawEnd, skipRanges, Math.min(2.5, end - start), end)
  const replayStart = replayCut.start
  const replayEnd = replayCut.end
  const spoken = pool.filter((w) => w.s >= start && w.s <= end).map((w) => w.w).join(' ')
  const female = /\b(?:motociclista|mulher|moça|moca)\b/i.test(spoken)
  const caption = buildCaption(spoken, female ? 'A MOTOCICLISTA' : 'O MOTOCA')

  return {
    start,
    end,
    peak: { start: Math.round(peak * 10) / 10, end: replayEnd },
    replay: { start: replayStart, end: replayEnd, speed: 0.5, zoom: 1.3 },
    skippedSegments: skipRanges,
    bleeps: findBleeps(pool.filter((w) => w.s >= start && w.s <= end)),
    caption: caption.caption,
    captionLines: caption.lines,
    captionWords: caption.words,
    generatedAt: new Date().toISOString(),
  }
}
