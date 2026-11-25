// Filtro leve de idioma para textos gerados pelo motor local. O Whisper,
// quando cai em trecho de ruído/música, inventa frases em inglês
// ("Starting another job here"). Elas não podem virar título nem legenda.
export function isPortugueseCaptionText(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `
  const en = (t.match(/\b(?:the|and|you|with|this|that|was|were|for|from|his|her|their|into|sponsored|subscribe|video|starting|another|job|here|going|get|now|look|okay|yeah|we|are|is|it|in|on|at|to|of|my|your|they|what|how|do|does|did|have|has|had|can|will|just|right|good|nice|welcome|please|thanks|let|its|i)\b/g) || []).length
  const pt = (t.match(/\b(?:que|com|para|por|n[aã]o|dos|das|foi|moto|motoca|motorista|faixa|carro|quase|jogou|atropel\w*|desvio|caiu|ocorreu|enquadro|persegui\w*|o|a|os|as|e|em|de|do|da|na|no|se|ele|ela|est[aá]|estou|vai|vim|vinha|olha|olhe|pessoal|galera|bom|boa|tudo|mesmo|mais|muito|bem|apagou|farol|acelerou)\b/g) || []).length
  return pt > 0 && pt >= en
}

const HOOKS_PT = {
  fuga: 'Ele apagou o farol e acelerou',
  enquadro: 'O enquadro que mudou a madrugada',
  perseguicao: 'A perseguição que parou a rua',
  abordagem: 'O bloqueio estava esperando ele',
  jogada: 'A jogada que virou o jogo',
  clutch: 'O clutch que ninguém acreditou',
  reacao: 'A reação que viralizou',
  treta: 'A treta que tomou o chat',
  momento: 'O momento que a câmera não perdeu',
}

export function portugueseHookOrDefault(text, type, niche) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (raw.length >= 12 && raw.length <= 90 && isPortugueseCaptionText(raw)) {
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }
  return HOOKS_PT[type] || HOOKS_PT[niche] || HOOKS_PT.momento
}
