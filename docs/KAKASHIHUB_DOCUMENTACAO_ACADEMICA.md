# KakashiHub
## Plataforma full-stack para captura, edição e publicação de clipes de lives

**Documentação técnica para apresentação acadêmica**  
**Curso:** Engenharia de Software  
**Projeto:** KakashiHub  
**Versão documentada:** 24 de novembro de 2026  
**Repositório:** `popovidismarcoantonionista-lang/kakashihub`

> Este documento apresenta um sistema real, em produção e com público, como estudo de caso de Engenharia de Software. Os nomes de variáveis, endpoints e arquivos citados correspondem à implementação do projeto, mas credenciais, tokens, cookies e dados pessoais foram omitidos.

---

## 1. Resumo

O KakashiHub é uma plataforma web para transformar transmissões ao vivo e vídeos em clipes verticais prontos para publicação. O sistema permite cadastrar fontes de conteúdo, acompanhar lives, capturar janelas de áudio e vídeo, processar mídia com FFmpeg, selecionar trechos, aplicar enquadramento e gerar arquivos de saída para distribuição em redes sociais.

O projeto foi construído a partir de uma necessidade real: reduzir o trabalho manual de acompanhar transmissões, localizar momentos relevantes, recortar o material e preparar publicações. Além do processamento de vídeos comuns, a plataforma precisa lidar com um problema de engenharia mais difícil: lives são fluxos contínuos, com playlists HLS atualizadas constantemente, segmentos que expiram e diferenças de disponibilidade entre provedores.

Este estudo de caso é especialmente útil para Engenharia de Software porque envolve requisitos funcionais e não funcionais, integração com serviços externos, processamento assíncrono, persistência, observabilidade, limitações de infraestrutura, segurança de APIs, deploy contínuo e manutenção de um sistema que atende usuários reais.

### Palavras-chave

`full-stack`, `React`, `Node.js`, `Express`, `FFmpeg`, `HLS`, `live streaming`, `processamento assíncrono`, `Render`, `Netlify`, `PostgreSQL`, `Vercel Blob`, `observabilidade`.

---

## 2. Motivação e problema de negócio

Criadores e operadores de canais precisam acompanhar transmissões longas e transformar momentos relevantes em vídeos curtos. Fazer isso manualmente exige:

1. permanecer acompanhando a transmissão;
2. identificar o momento interessante;
3. encontrar o intervalo correto na gravação;
4. recortar áudio e vídeo sem perder sincronização;
5. adaptar o enquadramento para o formato vertical;
6. gerar uma saída com qualidade adequada;
7. armazenar o arquivo e, eventualmente, publicá-lo.

Esse processo é repetitivo, demorado e sujeito a erros. Um pequeno deslocamento entre áudio e vídeo já compromete a qualidade percebida pelo público. O KakashiHub busca centralizar esse fluxo em um estúdio web, com automação suficiente para acelerar a produção sem retirar do operador o controle editorial.

### Objetivo geral

Desenvolver uma plataforma web que capture, processe e organize clipes de vídeos e transmissões ao vivo, oferecendo uma experiência de estúdio para operação por navegador.

### Objetivos específicos

- cadastrar fontes de conteúdo de diferentes plataformas;
- detectar metadados e status de transmissões;
- capturar segmentos de uma live usando HLS;
- preservar a relação entre áudio e vídeo durante o mux;
- processar vídeos com FFmpeg;
- gerar vídeos verticais em resoluções configuráveis;
- organizar clipes, fontes, jobs e atividades;
- manter o sistema observável e recuperável em produção;
- permitir evolução incremental sem interromper o fluxo principal da live.

---

## 3. Escopo funcional

O sistema é dividido em módulos que cooperam entre si.

| Módulo | Responsabilidade |
|---|---|
| Estúdio | Interface principal para acompanhar fontes, lives e jobs |
| Fontes | Cadastro e gerenciamento de canais, URLs e plataformas |
| Captura | Download de janelas de mídia de lives e ingestão de vídeos |
| Pipeline | Execução de FFmpeg, cortes, enquadramento e composição |
| IA/regras | Apoio à identificação de momentos e geração de metadados |
| Cortes | Organização e revisão dos clipes produzidos |
| Uploads | Entrada de arquivos locais para processamento |
| Publicação | Integrações com contas e redes sociais, quando configuradas |
| Radar | Consulta de itens e eventos relevantes para monitoramento |
| Saúde | Verificação do backend, banco, armazenamento e capacidades de live |

O sistema não promete que uma API externa forneça diretamente cada um dos streams. Em especial, a captura de lives do YouTube precisa considerar bloqueios de IP de datacenter e a natureza temporária das URLs HLS.

---

## 4. Arquitetura geral

O KakashiHub adota uma arquitetura web full-stack com um backend Express e uma interface React. A implantação atual mantém dois serviços associados ao mesmo repositório:

- **Backend `kakashi-hub`:** Express, API, persistência, jobs e pipeline FFmpeg.
- **Frontend `kakashii-hub`:** versão mais recente do estúdio baseada em TanStack Start, em diretório separado.

A aplicação principal Express também consegue servir os arquivos estáticos compilados do frontend tradicional. Assim, o projeto suporta uma evolução gradual da interface sem exigir a reescrita imediata de o conjunto do backend.

![Arquitetura e fluxo de dados do KakashiHub](KAKASHIHUB_ARQUITETURA.png)

### Componentes principais

```text
Usuário no navegador
        |
        v
Frontend React / TanStack Start
        |
        | HTTP/JSON + upload de janelas HLS
        v
Backend Node.js + Express
   |        |          |
   |        |          +--> PostgreSQL / store de estado
   |        +-------------> Vercel Blob / mídia
   +----------------------> Jobs e pipeline FFmpeg
        |
        +--> YouTube Data API (metadados)
        +--> Espelhos Invidious (HLS de live)
        +--> yt-dlp / Cobalt (vídeos comuns, conforme configuração)
```

### Princípios arquiteturais observados

- **Separação de responsabilidades:** rotas HTTP ficam em `server/index.mjs`; processamento de mídia fica em `server/pipeline.mjs`; persistência e estado ficam em `server/store.mjs`.
- **Processamento assíncrono:** tarefas longas são representadas como jobs e não devem bloquear a requisição web até o fim do processamento.
- **Defesa contra dependências externas:** o sistema possui múltiplas fontes ou caminhos de resolução para determinados recursos e registra erros técnicos para diagnóstico.
- **Configuração por ambiente:** chaves e URLs são fornecidas por variáveis de ambiente, sem serem embutidas no código.
- **Evolução incremental:** o frontend novo pode ser implantado como serviço separado sem abandonar o backend existente.

---

## 5. Fluxo de uma live

A captura de uma live não é igual ao download de um vídeo já finalizado. A transmissão é formada por uma playlist HLS que aponta para segmentos pequenos e recentes.

### 5.1 Detecção da live

A YouTube Data API v3 é utilizada para confirmar se a transmissão está no ar e recuperar metadados como título, canal e thumbnail. Ela não fornece o stream HLS diretamente.

Quando a fonte é identificada como live, o sistema escolhe o modo de captura adequado:

- **YouTube:** captura no navegador (`captureMode = 'browser'`), porque o IP do serviço em datacenter pode ser bloqueado pelo provedor.
- **Twitch e Kick:** captura no servidor (`captureMode = 'server'`), conforme a integração disponível.

### 5.2 Resolução do HLS

O frontend consulta `GET /api/live/capture-config` e recebe a configuração da captura, incluindo espelho, duração da janela e limite de segmentos. Depois, consulta o espelho configurado para obter uma URL HLS temporária.

A URL HLS pode expirar. Por isso, ela não deve ser tratada como um endereço permanente. O projeto utiliza `local=true` quando necessário para que o espelho devolva playlists e segmentos em uma origem acessível ao navegador e sem depender de cookies.

### 5.3 Captura no navegador

O módulo `src/lib/liveCapture.ts` executa o seguinte fluxo:

1. consulta ou recupera do cache a playlist da live;
2. identifica as trilhas de vídeo e áudio;
3. lê os segmentos recentes da playlist;
4. baixa os segmentos de áudio e vídeo;
5. concatena os bytes de cada trilha;
6. envia uma janela binária para `POST /api/live/:id/window`;
7. repete o processo enquanto a aba do estúdio permanecer aberta.

A captura por janela reduz a necessidade de manter um arquivo único e infinito. Também permite que o backend processe partes recentes da live e que o sistema detecte quando a sessão deixou de enviar dados.

### 5.4 Processamento da janela

O backend recebe a janela, valida o formato e utiliza FFmpeg para muxar áudio e vídeo. A captura reaproveita o caminho de processamento usado pelos demais clipes, incluindo as funções de criação de clipe e análise de volume quando aplicável.

O objetivo do mux é preservar os streams e suas marcações temporais, evitando reprocessamento desnecessário. Qualquer alteração futura de sincronização deve ser isolada, testada e autorizada separadamente, pois a captura é uma parte sensível do sistema.

### 5.5 Encerramento

A live é encerrada quando o operador para o monitoramento ou quando o sistema não recebe janelas suficientes dentro do limite esperado. O estado da fonte registra a condição e `liveLastError` armazena uma mensagem técnica sanitizada para diagnóstico.

---

## 6. Pipeline de mídia

O pipeline central está em `server/pipeline.mjs`. Ele combina lógica de negócio, execução de processos externos e regras de compatibilidade com o ambiente de produção.

### Etapas típicas

1. **Entrada:** URL, arquivo enviado ou janela de live.
2. **Resolução:** obtenção de mídia, metadados e trilhas.
3. **Preparação:** criação de arquivos temporários e validação.
4. **Análise:** duração, áudio, frames, enquadramento e metadados.
5. **Processamento:** corte, escala, composição vertical, legenda ou marca d’água, quando configurados.
6. **Saída:** arquivo final e registro do clipe.
7. **Persistência:** armazenamento local temporário, Vercel Blob e estado do projeto.
8. **Acompanhamento:** atualização do job e do histórico de atividades.

### Resoluções

O sistema possui perfis de `720p`, `1080p` e `4K` para a saída vertical. Em ambientes com pouca memória, como o plano gratuito do Render, o pipeline pode adotar um perfil leve limitado a 720p para reduzir o risco de o processo ser encerrado por consumo de RAM.

Essa decisão ilustra um trade-off clássico: qualidade máxima não é sempre a melhor escolha operacional. A plataforma precisa produzir uma saída suficientemente boa sem comprometer disponibilidade e estabilidade.

### Áudio e vídeo

O áudio é tratado como parte inseparável do clipe. O pipeline deve evitar que uma transformação de vídeo descarte ou desloque a trilha de áudio. Na manutenção documentada neste caso, uma tentativa de alterar a seleção temporal de segmentos e reancorar timestamps foi revertida porque interferia no funcionamento da live. A solução publicada posteriormente foi defensiva e localizada: inicializar e acessar com segurança a coleção de clipes antes de aplicar filtros.

---

## 7. Persistência e modelo de estado

O projeto trabalha com um estado de aplicação que reúne, entre outros elementos:

- `sources`: fontes cadastradas e seu status;
- `clips`: clipes gerados e suas relações com fontes;
- `jobs`: tarefas em execução ou concluídas;
- `settings`: configurações de nicho, resolução e agentes;
- `project`: identidade do projeto, canal e logo;
- histórico de atividades e referências de mídia.

A persistência usa banco PostgreSQL quando configurado e armazenamento de objetos para mídia. O endpoint de saúde expõe somente informações operacionais, como a disponibilidade do banco e do armazenamento, sem retornar credenciais.

### Lição de consistência de estado

Em sistemas que evoluem por migrações e reconciliação, não se pode pressupor que uma chave exista em cada um dos estados históricos. A expressão abaixo é segura:

```js
const clips = Array.isArray(getState().clips) ? getState().clips : []
const previous = clips.filter((clip) => clip.sourceId === sourceId)
```

Já uma chamada direta a `getState().clips.filter(...)` pode quebrar quando uma versão antiga ou incompleta do estado não possui `clips`.

A correção publicada no commit `9521704` protegeu os acessos do pipeline e eliminou o erro:

```text
Cannot read properties of undefined (reading 'filter')
```

Essa falha é um exemplo de como uma alteração aparentemente simples pode revelar uma incompatibilidade entre o código atual e estados persistidos anteriormente.

---

## 8. API e endpoints relevantes

| Endpoint | Verbo HTTP | Finalidade |
|---|---:|---|
| `/api/health` | GET | Verificar saúde do backend e capacidades configuradas |
| `/api/state` | GET | Consultar estado da aplicação e jobs autorizados |
| `/api/live/capture-config` | GET | Obter configuração da captura de live |
| `/api/live/:id/window` | POST | Enviar uma janela de áudio e vídeo capturada no navegador |
| `/api/live/:id/capture-error` | POST | Registrar falha de captura da live |
| `/api/live/:id/...` | POST/GET | Operar e consultar o ciclo de vida da live |
| `/api/settings` | POST | Atualizar configurações do projeto |
| `/api/project` | POST | Atualizar metadados do projeto |
| `/api/radar` | GET | Consultar itens de monitoramento |
| `/media/*` | GET | Servir ou recuperar arquivos de mídia autorizados |
| `/covers/*` | GET | Servir capas e imagens do projeto |

### Health check

O endpoint `/api/health` é usado pelo Render e também serve para diagnóstico. Ele informa:

- `ok`: se a API respondeu;
- `commit`: SHA implantado;
- `storage.database` e `dbProbe`: configuração e teste do banco;
- `storage.blob`: disponibilidade do armazenamento de objetos;
- `live`: capacidades de metadados, espelhos e serviços auxiliares.

Em uma operação real, o SHA do commit é importante porque conecta o comportamento observado em produção ao código exato implantado.

---

## 9. Segurança e proteção operacional

O sistema adota algumas medidas importantes:

- chaves de API e URLs sensíveis são configuradas por variáveis de ambiente;
- o health check é mantido acessível para o provedor de deploy;
- o backend pode bloquear acesso direto e aceitar requisições autenticadas pelo proxy configurado;
- mensagens de erro são sanitizadas para não vazar chaves ou URLs de conexão;
- mídia privada pode ser recuperada por armazenamento de objetos com cabeçalhos apropriados;
- uploads possuem limite de tamanho e extensões permitidas;
- cookies de provedores não são necessários para o caminho principal de captura de live no navegador.

Segurança não é apenas autenticação. Neste projeto, também envolve evitar vazamento de segredos em logs, limitar arquivos recebidos, controlar processos externos e manter o sistema funcionando quando um provedor de conteúdo fica indisponível.

---

## 10. Deploy e infraestrutura

O backend é implantado no Render por Docker, com deploy automático a partir da branch `main`. O frontend mais recente é configurado como outro serviço no mesmo arquivo `render.yaml`.

### Backend

- runtime: Docker;
- comando de inicialização: `node server/start.mjs`;
- health check: `/api/health`;
- branch: `main`;
- processamento de mídia: Node.js, Python e FFmpeg;
- armazenamento: PostgreSQL e Vercel Blob, quando configurados.

### Frontend

- diretório: `kakashii-hub/`;
- build: `npm install --no-audit --no-fund && npm run build`;
- runtime: Node.js/TanStack Start;
- deploy automático independente do backend.

### Desenvolvimento local

```bash
npm install
npm run dev
```

A aplicação fica disponível em `http://localhost:4780` conforme o README do projeto.

### Produção local ou build

```bash
npm run build
npm start
```

O projeto requer Node.js 20 ou superior, Python 3 e FFmpeg para os fluxos de processamento.

---

## 11. Incidente técnico estudado: áudio, live e estado inconsistente

O problema inicial percebido pelo usuário era áudio atrasado ou adiantado. A investigação mostrou que uma correção inicial tentou modificar o recorte de segmentos HLS e reancorar timestamps. Como a live deixou de funcionar após essa mudança, a alteração foi revertida imediatamente para preservar o fluxo de captura.

### Linha do tempo resumida

| Commit | Evento |
|---|---|
| `cb25854` | Tentativa inicial de correção de sincronização HLS |
| `9d1e9f5` | Reversão da alteração para restaurar o fluxo da live |
| `9521704` | Correção defensiva para estado sem `clips` |

### Causa concreta do erro da live

O erro registrado em produção foi:

```text
Cannot read properties of undefined (reading 'filter')
```

A causa não era uma nova regra de sincronização em execução, e sim o acesso direto a `getState().clips.filter(...)` em um estado carregado que não possuía a propriedade `clips`.

### Correção aplicada

A correção foi deliberadamente pequena:

- proteger o processamento da janela ao vivo;
- proteger a inicialização e contagem de clipes anteriores;
- não alterar a seleção HLS;
- não alterar timestamps de áudio ou vídeo;
- validar sintaxe com `node --check server/pipeline.mjs`;
- validar whitespace com `git diff --check`;
- publicar no `main` e confirmar o SHA pelo health check.

### Aprendizados de engenharia

1. **Preservar o fluxo crítico:** em uma live com público, o primeiro objetivo é restaurar disponibilidade.
2. **Isolar mudanças de alto risco:** sincronização temporal deve ser alterada somente em uma mudança separada, com testes específicos.
3. **Investigar o erro observado:** o erro salvo no estado foi mais útil que uma hipótese sobre o áudio.
4. **Tratar dados persistidos como não confiáveis:** estados antigos podem não possuir todas as chaves atuais.
5. **Usar o commit implantado como evidência:** o health check confirmou que o backend público estava rodando exatamente `9521704`.

---

## 12. Estratégia de testes e validação

### Testes estáticos e de integração

- checagem de sintaxe com `node --check`;
- verificação de alterações com `git diff --check`;
- build do frontend com `npm run build`;
- inicialização do servidor com configuração de teste;
- verificação do endpoint `/api/health`;
- validação do SHA de produção;
- teste de uma nova live após o deploy;
- conferência de que `liveLastError` não recebe o erro antigo durante uma nova execução.

### Cenários de teste recomendados

| Cenário | Resultado esperado |
|---|---|
| Fonte sem `clips` no estado | Pipeline inicializa coleção vazia e continua |
| Live do YouTube disponível | Frontend resolve HLS e envia janelas |
| Espelho indisponível | Sistema tenta alternativa ou registra erro compreensível |
| Playlist sem áudio | Janela é rejeitada sem corromper o estado |
| Aba fechada durante captura | Monitoramento encerra após timeout controlado |
| Render com pouca memória | Perfil leve evita processamento excessivo |
| Banco indisponível | `/api/health` informa falha sem ocultar o diagnóstico |
| Upload acima do limite | Requisição é rejeitada antes do processamento |
| Nova versão implantada | SHA do health check corresponde ao commit esperado |

### O que ainda merece evolução

- testes automatizados de contrato para os endpoints de live;
- testes com playlists HLS sintéticas, incluindo descontinuidade e mudança de segmento;
- métricas de atraso entre captura, mux e disponibilidade do clipe;
- testes de sincronização usando arquivos com marcadores de áudio conhecidos;
- filas persistentes para jobs longos;
- testes de carga para múltiplas lives simultâneas;
- rastreamento distribuído entre frontend, backend e FFmpeg.

---

## 13. Requisitos não funcionais

| Requisito | Aplicação no projeto |
|---|---|
| Disponibilidade | Health check, deploy automático e caminhos alternativos de captura |
| Desempenho | Captura por janelas, processamento assíncrono e perfil leve no Render |
| Confiabilidade | Jobs, estado persistido, mensagens de erro e validações defensivas |
| Manutenibilidade | Separação entre API, pipeline, store e frontend |
| Segurança | Segredos por ambiente, limites de upload e sanitização de erros |
| Escalabilidade | Serviços separados, armazenamento externo e possibilidade de workers |
| Observabilidade | `/api/health`, `liveLastError`, atividades e SHA do deploy |
| Portabilidade | Docker, Node.js, Python e FFmpeg |

---

## 14. Decisões, trade-offs e limitações

### Captura no navegador versus servidor

A captura no navegador foi escolhida para YouTube porque o provedor trata IPs de datacenter de maneira diferente. O navegador também pode acessar uma origem HLS liberada pelo espelho, enquanto o servidor Render pode receber bloqueios.

**Benefício:** maior chance de obter o stream.  
**Custo:** a aba precisa permanecer aberta e o processamento depende do dispositivo do operador.

### FFmpeg local versus serviço externo

O FFmpeg local oferece controle sobre codecs, cortes e composição.

**Benefício:** flexibilidade e menor dependência de uma API de vídeo.  
**Custo:** consumo de CPU/memória, necessidade de binários e tratamento de falhas de processo.

### Render gratuito versus qualidade máxima

O ambiente gratuito reduz custos, mas possui recursos limitados.

**Benefício:** custo operacional baixo para validar o produto real.  
**Custo:** necessidade de perfil leve e maior cuidado com jobs concorrentes.

### Estado simples versus fila especializada

O estado e os jobs atuais são adequados para uma operação inicial e pequena.

**Benefício:** menos infraestrutura e implementação rápida.  
**Custo:** uma futura escala exigirá fila dedicada, locks distribuídos e workers independentes.

---

## 15. Roadmap técnico sugerido

### Curto prazo

- ampliar testes automatizados do ciclo de vida da live;
- adicionar métricas de captura e processamento;
- registrar duração e tamanho de cada janela;
- criar uma tela de diagnóstico para operadores;
- documentar contratos JSON dos endpoints.

### Médio prazo

- mover jobs longos para workers dedicados;
- adicionar fila persistente com retry e backoff;
- criar testes de sincronização com fixtures HLS;
- separar mais claramente domínio, infraestrutura e adaptadores externos;
- adicionar controle de concorrência por fonte.

### Longo prazo

- suportar múltiplas regiões e provedores de armazenamento;
- adotar observabilidade com logs estruturados, métricas e traces;
- desenvolver um mecanismo de seleção de momentos baseado em sinais de áudio, chat e eventos;
- oferecer publicação agendada com confirmação e auditoria;
- evoluir para uma arquitetura orientada a eventos caso o volume justifique.

---

## 16. Conclusão

O KakashiHub demonstra como conceitos de Engenharia de Software aparecem em um produto real: levantamento de requisitos, modularização, integração com APIs, processamento assíncrono, tolerância a falhas, segurança, deploy contínuo, observabilidade e manutenção evolutiva.

O maior aprendizado do caso não é apenas como capturar um stream HLS. É como fazer uma mudança em um sistema vivo sem comprometer seu caminho crítico. Ao identificar que a primeira alteração de sincronização afetava a operação, ela foi revertida. Em seguida, a investigação baseada no erro real encontrou a causa concreta: um estado sem a coleção `clips`. A correção final foi pequena, defensiva, testada e confirmada em produção.

Esse ciclo — observar, formular hipótese, isolar a mudança, validar, publicar e medir — é uma prática central de engenharia de software aplicada a sistemas que precisam continuar funcionando para usuários reais.

---

## 17. Referências internas do projeto

- `README.md` — visão geral, requisitos, desenvolvimento e captura de lives.
- `render.yaml` — definição dos serviços e variáveis de ambiente do Render.
- `server/index.mjs` — API Express e health check.
- `server/pipeline.mjs` — pipeline FFmpeg, captura e processamento de mídia.
- `server/store.mjs` — estado e persistência da aplicação.
- `src/lib/liveCapture.ts` — captura de playlists e segmentos HLS no navegador.
- `docs/INTEGRACOES.md` — integrações externas do projeto.
- Commits `cb25854`, `9d1e9f5` e `9521704` — histórico do incidente e da correção defensiva.

---

## Perguntas para discussão em sala

1. Em que momento a captura no navegador deixa de ser uma solução adequada e passa a exigir um worker especializado?
2. Como testar sincronização de áudio e vídeo de forma automatizada?
3. Quais propriedades deveriam ser garantidas por um schema de estado versionado?
4. Que métricas indicariam que o sistema precisa sair do plano gratuito?
5. Como transformar o processamento atual em uma arquitetura orientada a eventos?
6. Quais são os riscos de depender de espelhos e APIs externas para um produto de público real?
