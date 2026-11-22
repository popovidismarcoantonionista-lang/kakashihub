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

O processo usa `PORT` quando definido (Render), ou `4780` por padrão. `/api/health` é o endpoint de health check. A configuração `render.yaml` descreve apenas um serviço web.

## Estrutura

- `src/`: interface React e estilos
- `server/`: API Express, pipeline de mídia e processamento
- `public/`: assets servidos pelo Vite e copiados para `dist/`
- `dist/`: build estático do frontend servido pelo Express

Downloads e análise são iniciados no backend. Não há dependência de ngrok, localtunnel ou proxy de desenvolvimento para a comunicação entre browser e API. O acesso e processamento de conteúdo externo depende da disponibilidade e dos termos de cada serviço de origem.
