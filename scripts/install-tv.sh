#!/usr/bin/env bash
# Installa l'app AniSat VIDAA Streamer su una TV Hisense/VIDAA.
# TUI: bash scripts/install-tv.sh          (flag: --ip 1.2.3.4 --port 8099 --name Anime --prepare)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.installer"
HELPER="$WORK/vidaa-appstore"
TPL="$ROOT/installer/install.html"
UGCLI_URL="https://osswaf.ugnas.com/pro/ugcli/download/ugcli-v1.1.0.25-linux-amd64"

PORT="${PORT:-8099}"
APPID="${APPID:-vidaa_anime}"
APPNAME="${APPNAME:-Anime}"
IP="${IP:-}"
PREPARE_ONLY="${NO_RUN:-0}"
NONINTERACTIVE=0
PYRUN=()   # comando python, riempito da ensure_python

# --- argomenti -----------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --name) APPNAME="${2:-}"; shift 2 ;;
    --appid) APPID="${2:-}"; shift 2 ;;
    --prepare) PREPARE_ONLY=1; shift ;;
    --yes|-y) NONINTERACTIVE=1; shift ;;
    -h|--help)
      echo "uso: $0 [--ip 192.168.1.20] [--port 8099] [--name Anime] [--appid vidaa_anime] [--prepare] [--yes]"
      exit 0 ;;
    *) echo "argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

# --- uscita a video ------------------------------------------------------
B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$OFF" "$*"; }
err()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*"; }
box()  { printf '%s\n' "${B}──────────────────────────────────────────────────────────${OFF}"; }
die()  { err "$*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() { # ask "domanda" [default s/n] -> 0 se sì
  local q="$1" def="${2:-n}" a
  if [ "$NONINTERACTIVE" = "1" ]; then return 0; fi
  if [ "$def" = "s" ]; then read -r -p "$q [S/n] " a </dev/tty; a="${a:-s}"
  else read -r -p "$q [s/N] " a </dev/tty; a="${a:-n}"; fi
  case "$a" in s|S|si|sì|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

pause() { [ "$NONINTERACTIVE" = "1" ] && return 0; read -r -p "${DIM}Invio per continuare${OFF}" _ </dev/tty; }

as_root() {
  if [ "$(id -u)" = "0" ]; then "$@"; return $?; fi
  if have sudo; then sudo "$@"; return $?
  fi
  err "serve root (o sudo) per: $*"
  return 1
}

is_root() { [ "$(id -u)" = "0" ]; }

# --- pacchetti di sistema ------------------------------------------------
detect_pm() {
  for pm in apt-get dnf pacman zypper apk brew; do have "$pm" && { echo "$pm"; return; }; done
}
install_pkg() { # install_pkg pacchetto...
  local pm; pm="$(detect_pm)"
  [ -n "$pm" ] || { err "non riconosco il gestore di pacchetti"; return 1; }
  say "${DIM}→ $pm: installo $*${OFF}"
  case "$pm" in
    apt-get) as_root apt-get install -y "$@" ;;
    dnf)     as_root dnf install -y "$@" ;;
    pacman)  as_root pacman -S --noconfirm --needed "$@" ;;
    zypper)  as_root zypper --non-interactive install "$@" ;;
    apk)     as_root apk add "$@" ;;
    brew)    brew install "$@" ;;
  esac
}

# --- rilevamento IP (senza node) -----------------------------------------
detect_ip() {
  local ip=""
  if have ip; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  if [ -z "$ip" ] && have hostname; then ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
  if [ -z "$ip" ] && have ipconfig; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
  fi
  if [ -z "$ip" ] && have ifconfig; then
    ip="$(ifconfig 2>/dev/null | awk '/inet /&&$2!="127.0.0.1"{print $2; exit}' | tr -d 'addr:')"
  fi
  printf '%s' "$ip"
}

http_ok() {
  if have curl; then curl -fsS -m 3 "$1" >/dev/null 2>&1; return $?; fi
  if [ ${#PYRUN[@]} -gt 0 ]; then
    "${PYRUN[@]}" - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=3).read()
PY
    return $?
  fi
  return 1
}

# --- dipendenze ----------------------------------------------------------
ensure_python() {
  [ ${#PYRUN[@]} -gt 0 ] && return 0

  if have uv; then PYRUN=("$(command -v uv)" run --quiet --with dnslib python); return 0; fi
  if have python3 && python3 -c 'import dnslib' 2>/dev/null; then PYRUN=("$(command -v python3)"); return 0; fi
  if have python && python -c 'import dnslib' 2>/dev/null; then PYRUN=("$(command -v python)"); return 0; fi

  say ""
  warn "serve un Python con dnslib per il servizio di installazione: uv è il modo più semplice"
  if [ "$NONINTERACTIVE" = "1" ]; then
    err "modalità automatica: installa uv o dnslib prima di rilanciare"
    return 1
  fi
  say "  1) installa uv (consigliato, senza toccare il sistema)"
  say "  2) installa dnslib nel Python di sistema"
  say "  3) lo faccio io, esci"
  local scelta; read -r -p "Scelta [1]: " scelta </dev/tty; scelta="${scelta:-1}"

  case "$scelta" in
    1)
      if ! have curl; then
        warn "manca curl, provo a installarlo"
        ask "installo curl con il gestore di pacchetti?" s && install_pkg curl
      fi
      if have curl; then
        say "${DIM}→ curl -LsSf https://astral.sh/uv/install.sh | sh${OFF}"
        curl -LsSf https://astral.sh/uv/install.sh | sh
        for p in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
          [ -x "$p" ] && ! have uv && export PATH="$(dirname "$p"):$PATH"
        done
      fi
      if have uv; then PYRUN=("$(command -v uv)" run --quiet --with dnslib python); return 0; fi
      warn "uv non disponibile dopo l'installazione"
      ;;
    2)
      if have python3 || have python; then
        local py; py="$(command -v python3 || command -v python)"
        say "${DIM}→ $py -m pip install --user dnslib${OFF}"
        "$py" -m pip install --user dnslib && { PYRUN=("$py"); return 0; }
      else
        warn "nemmeno python c'è: provo a installarlo"
        install_pkg python3 && PYRUN=("$(command -v python3 || command -v python)")
        [ ${#PYRUN[@]} -gt 0 ] && return 0
      fi
      ;;
  esac

  err "senza uv o Python+dnslib l'installazione non può partire."
  say "  uv:      curl -LsSf https://astral.sh/uv/install.sh | sh"
  say "  dnslib:  python3 -m pip install --user dnslib"
  say "  poi rilanciare questo script."
  return 1
}

ensure_fetch() {
  have git && return 0
  if have curl && have tar; then return 0; fi
  warn "per scaricare il servizio di installazione serve git, oppure curl e tar"
  ask "li installo adesso?" s || return 1
  install_pkg git || install_pkg curl tar
  have git || { have curl && have tar; }
}

deps_report() {
  local py="assente" fetch="assente" idx="assente"
  if have uv; then py="uv ($(uv --version 2>/dev/null | head -1))"
  elif have python3 && python3 -c 'import dnslib' 2>/dev/null; then py="python3 + dnslib"; fi
  if have git; then fetch="git"; elif have curl && have tar; then fetch="curl+tar"; fi
  if have node; then idx="$(node -v 2>/dev/null)"; fi
  say "  python    : $py"
  say "  download  : $fetch"
  say "  node      : $idx ${DIM}(non serve: gira nel container)${OFF}"
  say "  privilegi : $(is_root && echo root || { have sudo && echo "sudo disponibile" || echo "${RED}no root, no sudo${OFF}"; })"
}

install_deps() {
  box
  say "${B}Dipendenze${OFF}"
  ensure_python || return 1
  ensure_fetch || return 1
  ok "pronto: $(printf '%s ' "${PYRUN[@]}" | cut -c1-60)…"
}

# --- preparazione del pacchetto di installazione -------------------------
esc_sed() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

prepare() {
  [ -n "$IP" ] && return 0
  IP="$(detect_ip)"
  [ -n "$IP" ] || return 1
}

prepare_files() {
  URL="http://$IP:$PORT/tv"
  ICON="http://$IP:$PORT/icon.png"

  mkdir -p "$WORK"
  if [ ! -d "$HELPER" ]; then
    say "${DIM}→ scarico il servizio di installazione in .installer/${OFF}"
    if have git; then
      git clone --depth 1 -q https://github.com/trialuser/vidaa-appstore "$HELPER" || return 1
    else
      curl -fsSL https://github.com/trialuser/vidaa-appstore/archive/refs/heads/main.tar.gz | tar -xz -C "$WORK" || return 1
      mv "$WORK/vidaa-appstore-main" "$HELPER"
    fi
  fi
  [ -f "$HELPER/ssl/vidaahub.com.key" ] || { err "certificato mancante in $HELPER/ssl"; return 1; }

  cat > "$HELPER/config.json" <<EOF
{
    "enable_dns_server": true,
    "enable_https_server": true,
    "enable_http_server": false,
    "server_address": "$IP",
    "http_port": 8080,
    "https_port": 443,
    "ssl_keyfile": "ssl/vidaahub.com.key",
    "ssl_certfile": "ssl/vidaahub.com.crt",
    "html_file": "install.html",
    "dns_records": [
        { "hostname": "vidaahub.com", "type": "A", "address": "$IP" }
    ]
}
EOF

  sed -e "s|{{NAME}}|$(esc_sed "$APPNAME")|g" \
      -e "s|{{APPID}}|$(esc_sed "$APPID")|g" \
      -e "s|{{URL}}|$(esc_sed "$URL")|g" \
      -e "s|{{ICON}}|$(esc_sed "$ICON")|g" \
      "$TPL" > "$HELPER/install.html" || return 1
}

# --- azioni della TUI ----------------------------------------------------
tv_steps() {
  box
  say "${B}Cosa fare sulla TV${OFF}"
  say "  1. Impostazioni → Rete → DNS = ${B}$IP${OFF} (secondario: vuoto)"
  say "  2. apri il browser della TV su ${B}https://vidaahub.com/${OFF} e accetta il certificato"
  say "  3. premi ${B}Installa${OFF}"
  say "  4. rimetti il DNS su automatico e riavvia la TV"
  say ""
  say "${DIM}Se il server non è raggiungibile, controlla che l'app sia avviata su http://$IP:$PORT/${OFF}"
}

start_server() {
  cd "$HELPER" || return 1
  say ""
  say "${B}Avvio il servizio (porte 53 e 443)${OFF} — Ctrl+C per fermarlo"
  if is_root; then
    exec "${PYRUN[@]}" server.py
  else
    if ! have sudo; then
      err "le porte 53 e 443 richiedono root: rilancia lo script con sudo"
      return 1
    fi
    exec sudo env HOME="$HOME" PATH="$PATH" "${PYRUN[@]}" server.py
  fi
}

action_install() {
  install_deps || { pause; return; }
  prepare || { err "IP non rilevato: impostalo da 'Cambia IP / porta / nome app'"; pause; return; }
  prepare_files || { pause; return; }
  tv_steps
  say ""
  ask "avvio il servizio adesso?" s || { say "preparato in $HELPER"; pause; return; }
  start_server
}

action_prepare() {
  install_deps || { pause; return; }
  prepare || { err "IP non rilevato"; pause; return; }
  prepare_files && { ok "file pronti in $HELPER"; tv_steps; }
  pause
}

action_settings() {
  box
  say "${B}Impostazioni${OFF}"
  local v
  read -r -p "IP del server [$IP]: " v </dev/tty; IP="${v:-$IP}"
  read -r -p "porta [$PORT]: " v </dev/tty; PORT="${v:-$PORT}"
  read -r -p "nome app sulla TV [$APPNAME]: " v </dev/tty; APPNAME="${v:-$APPNAME}"
  read -r -p "app id [$APPID]: " v </dev/tty; APPID="${v:-$APPID}"
  ok "salvato per questa sessione"
  pause
}

action_status() {
  box
  say "${B}Stato${OFF}"
  say "  server : http://$IP:$PORT  $(http_ok "http://$IP:$PORT/health" && printf '%sraggiungibile%s' "$GRN" "$OFF" || printf '%snon raggiungibile%s' "$YEL" "$OFF")"
  say "  app    : $APPNAME ($APPID)"
  say "  TV     : http://$IP:$PORT/tv"
  deps_report
  pause
}

menu() {
  while :; do
    clear 2>/dev/null || printf '\n'
    box
    printf '%s  AniSat VIDAA Streamer · installazione sulla TV%s\n' "$B" "$OFF"
    box
    say "  server : ${B}http://$IP:$PORT${OFF}"
    say "  app    : ${B}$APPNAME${OFF} ($APPID)"
    say ""
    say "  1) Installa l'app sulla TV"
    say "  2) Controlla e installa le dipendenze"
    say "  3) Prepara solo i file, senza avviare"
    say "  4) Rivedi i passi da fare sulla TV"
    say "  5) Stato e dipendenze"
    say "  6) Cambia IP / porta / nome app"
    say "  0) Esci"
    say ""
    local c; read -r -p "Scelta: " c </dev/tty
    case "$c" in
      1) action_install ;;
      2) install_deps; pause ;;
      3) action_prepare ;;
      4) prepare && tv_steps; pause ;;
      5) action_status ;;
      6) action_settings ;;
      0|q|"") exit 0 ;;
      *) warn "scelta non valida"; sleep 1 ;;
    esac
  done
}

# --- entry point ---------------------------------------------------------
[ "$IP" = "" ] && IP="$(detect_ip)"
if [ "$PREPARE_ONLY" = "1" ] || [ "$NONINTERACTIVE" = "1" ]; then
  install_deps || exit 1
  prepare || die "IP non rilevato: usa --ip 192.168.x.x"
  prepare_files || exit 1
  URL="http://$IP:$PORT/tv"; ICON="http://$IP:$PORT/icon.png"
  say "server: $IP   app: $URL"
  say "config.json e install.html pronti in $HELPER"
  [ "$PREPARE_ONLY" = "1" ] && exit 0
  tv_steps
  start_server
fi

[ -z "$IP" ] && IP="$(detect_ip)"
[ -z "$IP" ] && warn "IP non rilevato: impostalo dalla voce 6 del menu"
menu
