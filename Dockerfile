FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS pot
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates build-essential python3 pkg-config \
     libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /bgutil \
  && cd /bgutil/server \
  && npm ci --no-audit --no-fund \
  && npx tsc \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# Nightly necessario para os clientes YouTube atuais; [default] instala curl_cffi/requests/websockets.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates fontconfig fonts-dejavu-core \
     libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages --pre "yt-dlp[default,curl-cffi]==2026.11.17.232707.dev0" "yt-dlp-ejs==0.8.0" bgutil-ytdlp-pot-provider==2.0.2
ENV NODE_ENV=production \
    PYTHON=python3 \
    FUGA_COOKIES=/app/cookies.txt \
    YOUTUBE_API_KEY="" \
    YT_POT_ENABLED=true \
    BGUTIL_POT_URL=http://127.0.0.1:4416
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=pot /bgutil/server/build /opt/bgutil/build
COPY --from=pot /bgutil/server/node_modules /opt/bgutil/node_modules
COPY --from=pot /bgutil/server/package.json /opt/bgutil/package.json
EXPOSE 10000
CMD ["sh", "-c", "node /opt/bgutil/build/main.js --host 127.0.0.1 --port 4416 & node -e \"(async()=>{for(let i=0;i<20;i++){try{await fetch('http://127.0.0.1:4416/');return}catch{}await new Promise(r=>setTimeout(r,500))}})()\"; exec node server/start.mjs"]
