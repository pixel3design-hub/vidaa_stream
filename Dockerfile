FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs animesaturn.mjs rolling.mjs downloader.mjs library.mjs ratelimit.mjs streams.mjs ./
COPY public ./public
COPY installer ./installer

# certificato per il trucco vidaahub.com usato dal container di installazione
RUN openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -subj "/CN=vidaahub.com" -addext "subjectAltName=DNS:vidaahub.com" \
      -keyout installer/vidaahub.key -out installer/vidaahub.crt

ENV DATA=/data \
    PORT=8099 \
    CONCURRENCY=2

VOLUME /data
EXPOSE 8099
CMD ["node", "server.mjs"]
