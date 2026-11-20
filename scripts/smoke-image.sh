#!/bin/sh
# Smoke test dentro l'immagine: file, moduli, server HTTP e HTTPS con il certificato incluso.
# Uso: docker run --rm -v "$PWD/scripts:/s:ro" <immagine> sh /s/smoke-image.sh
set -e

test -f installer/tv-install.mjs
test -f installer/dns.mjs
test -f installer/install.html
test -f installer/vidaahub.crt
test -f installer/vidaahub.key
test -f public/tv.html
test -f server.mjs

node --check server.mjs
node --check installer/tv-install.mjs
node --check installer/dns.mjs
node -e 'import("./installer/dns.mjs").then(m => { if (typeof m.buildReply !== "function") process.exit(1) })'

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

DATA=/tmp/smoke PORT=8099 TLS_PORT=8443 \
  TLS_KEY=installer/vidaahub.key TLS_CERT=installer/vidaahub.crt \
  node server.mjs &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT

node --no-warnings -e '
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const attendi = async (url) => {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(url)).json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error("nessuna risposta da " + url);
};
(async () => {
  const http = await attendi("http://127.0.0.1:8099/health");
  if (!http.ok) throw new Error("health HTTP non ok");
  const https = await attendi("https://127.0.0.1:8443/health");
  if (!https.ok) throw new Error("health HTTPS non ok");
  console.log("smoke ok: node " + http.node + ", HTTP 8099 e HTTPS 8443");
})();
'
