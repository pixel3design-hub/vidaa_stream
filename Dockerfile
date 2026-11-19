FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs animesaturn.mjs rolling.mjs downloader.mjs library.mjs ./
COPY public ./public

ENV DATA=/data \
    PORT=8099 \
    CONCURRENCY=2

VOLUME /data
EXPOSE 8099
CMD ["node", "server.mjs"]
