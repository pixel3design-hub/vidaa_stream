#!/usr/bin/env bash
# Installa l'app vidaa_stream su una TV Hisense/VIDAA.
# Uso: bash scripts/install-tv.sh [IP]        (IP=… PORT=… APPNAME=… APPID=… NO_RUN=1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.installer"
HELPER="$WORK/vidaa-appstore"
TPL="$ROOT/installer/install.html"

PORT="${PORT:-8099}"
APPID="${APPID:-vidaa_anime}"
APPNAME="${APPNAME:-Anime}"
IP="${IP:-${1:-}}"
NO_RUN="${NO_RUN:-0}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf 'errore: %s\n' "$*" >&2; exit 1; }

say "1/4 controlli"
command -v python3 >/dev/null || die "serve python3 (servizio di installazione)"
python3 -c "import dnslib" 2>/dev/null || die "serve dnslib: python3 -m pip install dnslib"
command -v node >/dev/null || die "serve Node >= 24 (il server)"
[ -f "$TPL" ] || die "manca $TPL"

if [ -z "$IP" ]; then
  IP="$(node -e 'const os=require("os");const a=[];for(const l of Object.values(os.networkInterfaces()))for(const x of l||[])if(x.family==="IPv4"&&!x.internal)a.push(x.address);console.log(a[0]||"")')"
fi
[ -n "$IP" ] || die "IP non rilevato: rilancia con IP=192.168.x.x $0"
URL="http://$IP:$PORT/tv"
ICON="http://$IP:$PORT/icon.png"
printf 'server: %s   app: %s\n' "$IP" "$URL"
curl -fsS -m 3 "http://$IP:$PORT/health" >/dev/null 2>&1 \
  || printf 'attenzione: %s non risponde, avvia prima "node server.mjs"\n' "http://$IP:$PORT/health"

say "2/4 preparo il servizio di installazione"
if [ ! -d "$HELPER" ]; then
  mkdir -p "$WORK"
  if command -v git >/dev/null; then
    git clone --depth 1 -q https://github.com/trialuser/vidaa-appstore "$HELPER"
  else
    curl -fsSL https://github.com/trialuser/vidaa-appstore/archive/refs/heads/main.tar.gz | tar -xz -C "$WORK"
    mv "$WORK/vidaa-appstore-main" "$HELPER"
  fi
fi
[ -f "$HELPER/ssl/vidaahub.com.key" ] || die "certificato mancante in $HELPER/ssl"

IP="$IP" PORT="$PORT" node -e '
  const fs = require("fs");
  const ip = process.env.IP, port = Number(process.env.PORT);
  fs.writeFileSync(process.argv[1], JSON.stringify({
    enable_dns_server: true,
    enable_https_server: true,
    enable_http_server: false,
    server_address: ip,
    http_port: 8080,
    https_port: 443,
    ssl_keyfile: "ssl/vidaahub.com.key",
    ssl_certfile: "ssl/vidaahub.com.crt",
    html_file: "install.html",
    dns_records: [{ hostname: "vidaahub.com", type: "A", address: ip }],
  }, null, 4));
' "$HELPER/config.json"

NAME="$APPNAME" APPID="$APPID" APPURL="$URL" ICONURL="$ICON" node -e '
  const fs = require("fs");
  const s = fs.readFileSync(process.argv[1], "utf8")
    .replaceAll("{{NAME}}", process.env.NAME)
    .replaceAll("{{APPID}}", process.env.APPID)
    .replaceAll("{{URL}}", process.env.APPURL)
    .replaceAll("{{ICON}}", process.env.ICONURL);
  fs.writeFileSync(process.argv[2], s);
' "$TPL" "$HELPER/install.html"

say "3/4 preparato"
cat <<EOF
Sulla TV:
  1. Impostazioni → Rete → DNS = $IP   (secondario: vuoto)
  2. apri il browser della TV su https://vidaahub.com/ e accetta il certificato
  3. "Installa" → poi rimetti il DNS automatico e riavvia la TV
EOF

if [ "$NO_RUN" = "1" ]; then
  say "4/4 fermo qui (NO_RUN=1): config.json e install.html sono pronti in $HELPER"
  exit 0
fi

say "4/4 avvio (porte 53 e 443: servono i privilegi di root)"
cd "$HELPER"
if [ "$(id -u)" = "0" ]; then
  exec python3 server.py
else
  exec sudo python3 server.py
fi
