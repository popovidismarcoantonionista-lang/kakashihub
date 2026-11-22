# Kakashii Hub

Estúdio de cortes que roda inteiro no navegador: você envia um vídeo, escolhe os
melhores momentos, gera cortes 9:16 ou um vídeo longo 16:9 e salva o resultado.
Não há conta, assinatura ou servidor de processamento de vídeo.

Frontend original importado: https://kakashiihub.onrender.com/

## O que funciona

- **Cinco telas**: Vídeos, Cortes, Estúdio, Uploads e IA (agentes/configurações).
- **Estado persistido** em `localStorage` (`kakashi-hub-state-v2`), incluindo
  fontes, cortes, vídeos longos, agenda, conexões visuais e preferências.
- **Fontes**: upload de MP4/MOV/WEBM com prévia e duração lidas no navegador,
  link de live do YouTube com embed e marcação de momentos.
- **Cortes**: sugestão automática de trechos, ajuste de início/fim, enquadramento
  (webcam sobre o jogo, fundo desfocado ou 9:16), gancho e área segura.
- **Geração e montagem**: `MediaRecorder` + `Canvas.captureStream` produzem o
  vídeo final (WebM/MP4 conforme o navegador), com barra de progresso e cancelamento.
- **Agenda local**: lembretes de publicação por corte/vídeo longo e plataforma.
  Conexões são apenas visuais — o app não publica automaticamente.
- **Responsivo**: layout desktop e celular, com navegação por abas e diálogos adaptados.

## Rodando localmente

Requer Node.js 20 ou superior.

```sh
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite (normalmente `http://localhost:5173`).
Para gerar vídeos, use Chrome ou Edge no computador — é necessário suporte a
`MediaRecorder` e `HTMLCanvasElement.captureStream`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (Nitro, preset `node-server`) |
| `npm run build:static` | Build + snapshot HTML estático em `.output/public/index.html` |
| `npm start` | Sobe o servidor Node gerado em `.output/server/index.mjs` |
| `npm run preview` | Preview do build |
| `npm test` | Testes unitários (Vitest) |
| `npm run typecheck` | Checagem de tipos |
| `npm run lint` | ESLint |

## Deploy no Render

O arquivo `render.yaml` descreve um **Web Service** Node único:

- **Build**: `npm install --no-audit --no-fund && npm run build`
- **Start**: `npm start` (`node .output/server/index.mjs`)
- **Health check**: `/`
- O `vite.config.ts` força `nitro.preset = "node-server"`; sem isso o preset padrão
  do template gera um *worker* da Cloudflare, que não roda no Render.

O processo é o mesmo modelo do Kakashi Hub existente: uma única porta HTTP,
servindo HTML, assets e a aplicação. Todo o processamento de vídeo acontece no
navegador do usuário, então o servidor não precisa de FFmpeg nem de disco extra.

## Estrutura

- `src/routes/index.tsx` — telas, estado e interações do estúdio.
- `src/lib/kakashi-model.ts` — estado persistido e regras de corte.
- `src/lib/kakashi-media.ts` — leitura de arquivos, prévia e geração de vídeo.
- `src/styles/kakashi.css` — identidade visual do estúdio (escopo `.kakashi`).
- `src/styles/source-layout.css` e `src/styles/site.css` — CSS importado do site original.
- `src/test/` — testes de regras e de roteamento.

## Limitações conhecidas

- Publicação automática nas plataformas exige integração com credenciais e APIs
  oficiais; aqui ela é representada por lembretes e conexões visuais.
- Vídeos maiores que ~1 MB não cabem no `localStorage`; ao recarregar a página,
  selecione o arquivo novamente para continuar editando.
- Geração de vídeo depende dos codecs do navegador (melhor suporte no Chrome/Edge).
