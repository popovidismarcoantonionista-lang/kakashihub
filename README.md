# Kakashi Hub

Aplicação full-stack servida por um único processo Express e uma única porta. O Express atende as rotas `/api/...` e, em produção, os arquivos estáticos compilados em `dist/`. Em desenvolvimento, o Vite roda em middleware dentro do Express, sem servidor frontend separado ou proxy de API.

## Requisitos

- Node.js 20 ou superior
- Python 3 e FFmpeg para os fluxos de processamento de vídeo

## Desenvolvimento

```sh
npm install
npm run dev
```

Abra `http://localhost:4780`. O frontend chama as rotas locais diretamente, por exemplo `fetch('/api/state')`.

## Build e produção

```sh
npm run build
npm start
```

Para Netlify, o `netlify.toml` usa o preset Netlify do Nitro, publica `dist/` e registra a função gerada em `.netlify/v1/functions/`.

O processo usa `PORT` quando definido (Render), ou `4780` por padrão. `/api/health` é o endpoint de health check e informa quais fontes estão configuradas (`live.youtubeDataApi`, `live.cobalt`, `live.ytDlpApi`, `live.mirrors`, `live.fixedStream`). Para lives, o que importa é `live.youtubeDataApi` (metadados) e `live.mirrors` (stream HLS); `live.cobalt` vale apenas para VOD.

## Lives e YouTube Data API v3

A YouTube Data API v3 é usada para **detectar** a live e ler título, canal e thumbnail antes de tentar o yt-dlp. Ela **não fornece o stream HLS**. O stream vem do yt-dlp ou, quando o IP de datacenter do Render é bloqueado, de um espelho Invidious que devolva `liveNow` + `hlsUrl` (atualmente `yt.chocolatemoo53.com`). O Cobalt **não serve para lives** — ele responde `error.api.content.video.live` — e só é usado para vídeos comuns. `FUGA_LIVE_STREAM` é uma URL fixa opcional, mas o HLS dos espelhos é assinado e expira, então precisa ser resolvido a cada janela.

Para ativar no Render:

1. No Google Cloud, habilite a **YouTube Data API v3** e crie uma chave de API.
2. No serviço `kakashi-hub`, adicione a variável `YOUTUBE_API_KEY` com essa chave. O `render.yaml` declara a variável com `sync: false`, mas o valor precisa ser preenchido manualmente no painel do Render (Blueprints já existentes não pedem esse valor novamente).
3. Para **lives**, o `render.yaml` já define `INVIDIOUS_API_URLS=https://yt.chocolatemoo53.com,...` como resolvedor público, testado sem chave e sem cookies na live `z2hktG1zUbs` (`liveNow: true`, HLS gravado com ffmpeg). Se ele ficar instável, troque pelo valor da sua própria instância Invidious que exponha `hlsUrl`, ou use `YTDLP_API_URL`/`YTDLP_API_KEY` ou `FUGA_LIVE_STREAM`. O `COBALT_API_URL` continua configurado apenas para VOD; o `COBALT_API_KEY` só é necessário se a sua instância exigir token.
4. Verifique em `GET /api/health` se `live.youtubeDataApi` e `live.mirrors` estão `true`. (`live.cobalt` indicando `true` não garante captura de live.)

Quando a API v3 confirma que a transmissão está no ar mas o stream falha, a fonte recebe uma mensagem específica e `/api/state` expõe o detalhe técnico em `source.liveLastError` (sem vazar chaves de API). `source.liveMetadataSource` indica se os metadados vieram da Data API, da busca por canal ou da sondagem com yt-dlp.

## Novo frontend (kakashii-hub)

O diretório `kakashii-hub/` contém a versão mais recente do estúdio, construída com
TanStack Start. Ela roda como um **segundo Web Service** no mesmo `render.yaml`, com
`rootDir: kakashii-hub` e um único processo Node (`node .output/server/index.mjs`).
Todo o processamento de vídeo acontece no navegador, então esse serviço não depende
do backend Express nem de FFmpeg. Veja `kakashii-hub/README.md` para detalhes.

## Estrutura

- `src/`: interface React e estilos
- `server/`: API Express, pipeline de mídia e processamento
- `public/`: assets servidos pelo Vite e copiados para `dist/`
- `dist/`: build estático do frontend servido pelo Express

Downloads e análise são iniciados no backend. Não há dependência de ngrok, localtunnel ou proxy de desenvolvimento para a comunicação entre browser e API. O acesso e processamento de conteúdo externo depende da disponibilidade e dos termos de cada serviço de origem.
