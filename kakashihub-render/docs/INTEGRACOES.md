# Arquitetura e execução

O Kakashi Hub usa um único servidor Express. Em produção, ele entrega a API em `/api/...` e os assets gerados pelo `npm run build` a partir de `dist/`. Em desenvolvimento, o Vite é conectado como middleware ao mesmo Express, então interface, API, uploads e mídia compartilham a origem e a porta.

## Comandos

```sh
npm install
npm run dev
npm run build
npm start
```

`PORT` é definido pela plataforma de deploy; localmente o padrão é `4780`. O health check fica em `/api/health`.

## Render

O `render.yaml` configura um único serviço web usando o `Dockerfile`. Não é necessário configurar serviço de frontend separado, URL de túnel ou proxy para as chamadas entre frontend e backend.

## Persistência

Os metadados e arquivos de processamento são gravados no diretório de dados configurado pelo servidor. Em ambientes efêmeros, configure um disco persistente no Render se precisar preservar esses arquivos entre reinicializações e deploys.
