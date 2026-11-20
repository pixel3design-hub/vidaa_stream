#!/usr/bin/env bash
# Costruisce il pacchetto .upk per UGOS Pro (App Center -> installazione manuale).
# Uso: bash scripts/build-upk.sh            (VERSION, BUILD, ARCH, UGCLI, SKIP_BUILD da env)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UGOS="$ROOT/ugos"
VERSION="${VERSION:-$(node -p 'require("'"$ROOT"'/package.json").version')}"
BUILD="${BUILD:-1}"
ARCH="${ARCH:-amd64}"
UGCLI="${UGCLI:-ugcli}"
IMAGE="vidaa-stream:$VERSION"
GHCR="${GHCR:-ghcr.io/pixel3design-hub/vidaa-stream}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf 'errore: %s\n' "$*" >&2; exit 1; }

[ -d "$UGOS" ] || die "manca la cartella ugos/"
command -v "$UGCLI" >/dev/null 2>&1 || die "serve ugcli (https://developer.ugnas.com/en/doc/tools/ugcli.html)"

say "1/4 versioni: $VERSION (build $BUILD), arch $ARCH"
node -e '
  const fs = require("fs");
  const [ver, tag] = process.argv.slice(1);
  const py = "ugos/project.yaml", cy = "ugos/rootfs_common/docker-compose.yaml";
  fs.writeFileSync(py, fs.readFileSync(py, "utf8").replace(/^version: .*$/m, `version: ${ver}`));
  fs.writeFileSync(cy, fs.readFileSync(cy, "utf8").replace(/^    image: .*$/m, `    image: ${tag}`));
' "$VERSION" "$IMAGE"

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  say "2/4 uso l'immagine già presente ($IMAGE)"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "immagine $IMAGE non trovata: togli SKIP_BUILD"
elif docker pull "$GHCR:$VERSION"; then
  # stessa immagine che scaricherebbe chiunque altro, poi ri-taggata col nome che
  # docker-compose.yaml del pacchetto si aspetta (il tag deve combaciare col tar)
  say "2/4 immagine da $GHCR:$VERSION"
  docker tag "$GHCR:$VERSION" "$IMAGE"
else
  say "2/4 registry non raggiungibile, docker build in locale ($IMAGE)"
  docker build -t "$IMAGE" "$ROOT"
fi

say "3/4 docker save in ugos/rootfs_$ARCH/images/"
mkdir -p "$UGOS/rootfs_$ARCH/images"
# via le immagini di versioni precedenti: ugcli vuole solo i tar referenziati nel compose
rm -f "$UGOS/rootfs_$ARCH/images/"*.tar
docker save -o "$UGOS/rootfs_$ARCH/images/vidaa-stream-$VERSION.tar" "$IMAGE"

say "4/4 ugcli check + pack"
cd "$UGOS"
"$UGCLI" check
"$UGCLI" pack --arch "$ARCH" --product-series nasync --build "$BUILD"

echo
find "$UGOS/build_dir/pkgs/upk" -name '*.upk' -printf '%f (%s byte)\n' 2>/dev/null \
  || ls "$UGOS/build_dir/pkgs/upk"/*.upk
