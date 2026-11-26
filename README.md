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

Para Netlify, o `netlify.toml` publica `dist/`, faz proxy de `/api`, `/media` e `/covers` para o Render com assinatura `PROXY_SECRET` e registra as Functions de relay usadas pelas lives.

O processo usa `PORT` quando definido (Render), ou `4780` por padrão. `/api/health` é o endpoint de health check e informa quais fontes estão configuradas (`live.youtubeDataApi`, `live.cobalt`, `live.ytDlpApi`, `live.mirrors`, `live.fixedStream`). `live.cobalt` é apenas um resolvedor interno de lives Twitch/Kick; o download da busca é feito no navegador.

## Lives: apenas Twitch e Kick

O monitoramento aceita **somente** links de Twitch e Kick, com `captureMode: 'server'`. Um link comum do YouTube não é transformado em live; vídeos gravados entram pela busca ou pelo upload. Não há captura no navegador, cookies de conta nem proxy de terceiros no fluxo padrão.

O YouTube Data API v3 (quando configurado) só confirma metadados; o stream das lives Twitch/Kick é resolvido no servidor por yt-dlp/espelhos/Cobalt. `FUGA_LIVE_STREAM`, quando disponível, é uma URL HLS já autorizada — o HLS assinado expira e nunca é fixado no front.

Para ativar no Render:

1. Preencha no painel os segredos declarados com `sync: false` em `render.yaml`: `PROXY_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` e, se usada, `YOUTUBE_API_KEY`.
2. `INVIDIOUS_API_URLS` e `COBALT_API_URL` são opcionais; "`yt.chocolatemoo53.com`" aparece apenas no JSON interno de `/api/downloads/prepare`, nunca na interface.
3. Verifique em `GET /api/health` se o backend responde e se as variáveis esperadas estão presentes (sem expor valores).

Erros de live ficam só em diagnóstico interno (`source.liveLastError`/`job.debug`); a interface mostra mensagens neutras. `source.liveMetadataSource` indica se os metadados vieram da Data API, da busca por canal ou da sondagem com yt-dlp.

## Download da busca

O navegador busca os bytes no IP do usuário (faixas de 512 KB, no máximo 4 em paralelo) e envia as partes ao Render. O servidor junta 720p H264 + AAC e serve `/api/downloads/:id/file.mp4` com `Content-Length` real, suporte a `Range` e sem query string. Vídeos "720p60" gigantes são recusados acima de 180 MB. Nenhuma URL do provedor/CDN aparece na interface.

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
