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

A YouTube Data API v3 é usada para **detectar** a live e ler título, canal e thumbnail. Ela **não fornece o stream HLS**. Como o IP de datacenter do Render é bloqueado pelo YouTube (`Sign in to confirm you're not a bot`) e por todos os espelhos Invidious públicos (`403`), lives do YouTube usam **captura no navegador**: o frontend resolve `hlsUrl` no espelho, baixa os segmentos `.ts` com `local=true` e envia uma janela ao Render. Nenhum cookie é usado. O Cobalt **não serve para lives** (`error.api.content.video.live`) e só é usado para vídeos comuns. `FUGA_LIVE_STREAM` é uma URL fixa opcional, mas o HLS é assinado e expira.

Para ativar no Render:

1. No Google Cloud, habilite a **YouTube Data API v3** e crie uma chave de API.
2. No serviço `kakashi-hub`, adicione a variável `YOUTUBE_API_KEY` com essa chave. O `render.yaml` declara a variável com `sync: false`, mas o valor precisa ser preenchido manualmente no painel do Render (Blueprints já existentes não pedem esse valor novamente).
3. Para **lives**, o `render.yaml` define `INVIDIOUS_API_URLS=https://yt.chocolatemoo53.com,...`. O frontend consulta `GET /api/live/capture-config` para saber qual espelho usar; se ele ficar instável, troque a primeira URL da variável (ou aponte para sua própria instância Invidious, que deve devolver `hlsUrl` e aceitar `local=true`). O `COBALT_API_URL` continua configurado apenas para VOD; o `COBALT_API_KEY` só é necessário se a sua instância exigir token.
4. Verifique em `GET /api/health` se `live.youtubeDataApi` e `live.mirrors` estão `true`. (`live.cobalt` indicando `true` não garante captura de live.)

Quando a API v3 confirma que a transmissão está no ar mas o stream falha, a fonte recebe uma mensagem específica e `/api/state` expõe o detalhe técnico em `source.liveLastError` (sem vazar chaves de API). `source.liveMetadataSource` indica se os metadados vieram da Data API, da busca por canal ou da sondagem com yt-dlp.

## Captura de lives no navegador

Para fontes `youtube`, a criação marca `source.captureMode = 'browser'`. Enquanto houver uma fonte ao vivo nesse modo, o frontend mantém uma sessão por live:

1. `GET /api/live/capture-config` devolve `{ mirror, windowSeconds, maxSegments }`.
2. `GET {mirror}/api/v1/videos/{id}?local=true` devolve `hlsUrl`; o resultado fica em `localStorage` por 5 minutos — **a busca não se repete a cada janela**.
3. O manifesto é buscado com `local=true`, o que faz o espelho devolver playlists e segmentos no próprio domínio, com CORS liberado e sem cookies.
4. Os últimos N segmentos de vídeo e áudio são baixados e concatenados; o navegador envia `POST /api/live/:id/window` com um cabeçalho binário `LWIN` e os dois `.ts`.
5. O Render muxa vídeo e áudio com `ffmpeg -c copy` e reaproveita `loudSpan`/`makeLiveClip`, exatamente como na captura feita no servidor.

**A aba do estúdio precisa ficar aberta** enquanto a live é monitorada. Se nenhuma janela chegar em `4 × windowSeconds`, o monitoramento é encerrado com uma mensagem explicando isso. Twitch e Kick continuam usando a captura no servidor (`captureMode: 'server'`).

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
