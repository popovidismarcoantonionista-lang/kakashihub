FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates fontconfig fonts-dejavu-core \
     libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PYTHON=python3 \
    FUGA_COOKIES=/app/cookies.txt \
    YOUTUBE_API_KEY="" \
    YT_POT_ENABLED=false \
    XRACING_MODEL=tiny \
    XRACING_MAX_AUDIO_SEC=600 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    HF_HOME=/app/.cache/huggingface
# Transcrição local do motor XRacing: sem API paga e sem enviar áudio para fora.
# tiny + int8 + 1 thread cabem no free do Render (o modelo base derrubava o
# serviço por OOM). O modelo entra na imagem para não baixar no upload.
RUN pip3 install --no-cache-dir --break-system-packages \
      "yt-dlp[default,curl-cffi]==2026.11.17.232707.dev0" \
      "yt-dlp-ejs==0.8.0" \
      "faster-whisper==1.2.1" \
  && OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8', cpu_threads=1, num_workers=1)"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/workflows ./workflows
EXPOSE 10000
CMD ["node", "server/start.mjs"]
