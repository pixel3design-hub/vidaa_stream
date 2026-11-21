<p align="center"><img src="icon.png" width="140" alt="AniSat VIDAA Streamer"></p>

# AniSat VIDAA Streamer

Scarica le serie da AnimeSaturn e le serve a un'app per TV Hisense con VIDAA OS.
Gira su qualunque macchina con Node 24 o più recente e ffmpeg: NAS UGREEN con UGOS, mini PC,
Raspberry, Windows, macOS. Docker serve solo a impacchettarlo.

```
┌──────────── host (NAS/PC/docker) ────────────┐        ┌──── TV VIDAA ────┐
│ /  ui.html      gestione (browser)           │        │ app = pagina /tv │
│ /tv tv.html     app TV                       │◄───────┤ video da /media  │
│ /api/library    JSON puntate pronte + viste  │  http  └──────────────────┘
│ /media/*.mp4    file con Range               │
│ ffmpeg + Referer → CDN AnimeSaturn           │
└──────────────────────────────────────────────┘
```

La TV legge solo gli MP4 dal NAS. È il server a contattare il CDN, e può mandare il Referer che
quello pretende: alla TV non restano header da inventare, né token che scadono a metà episodio.

## Avvio

Il modo normale è il container, che ha già dentro Node 24 e ffmpeg:

```bash
docker compose up -d
# PC:  http://localhost:8099/
# TV:  http://localhost:8099/tv
```

Su un PC o un NAS senza Docker servono Node 24 o più recente e ffmpeg nel PATH:

```bash
node server.mjs    # si ferma con un messaggio chiaro se Node è vecchio o manca ffmpeg
```

I dati stanno in `./data` (cambiali con `DATA`), una cartella per serie dentro `data/media/`.
Le altre variabili sono `PORT` (8099) e `CONCURRENCY` (2 download in parallelo).

## Download e release

Ogni tag `v*` fa partire `.github/workflows/release.yml`, che pubblica sulla release:

- `amd64_nasync_it.pixel3design.vidaastream_<ver>.upk` per l'App Center di UGOS Pro;
- `vidaa-stream-image-<ver>-amd64.tar.gz`, l'immagine Docker salvata su file;
- `anisat-vidaa-streamer-<ver>.tar.gz` per Linux e macOS, `.zip` per Windows (dentro c'è anche
  `start.cmd`, doppio clic e parte);
- `SHA256SUMS` per i controlli.

L'immagine sta su GitHub Packages. Gli esempi qui sotto usano il tag di versione, così sai
esattamente cosa scarichi:

```bash
docker pull ghcr.io/pixel3design-hub/vidaa-stream:0.6.1
```

Esistono anche `:latest` e `:sha-<7>`. `latest` punta all'ultima release, quindi cambia solo
quando esce un tag: se un comando scritto in una guida ti sembra vecchio, guarda il tag. Su GitHub
i pacchetti nascono privati: se lo vuoi pubblico, packages → package settings → change visibility.

## Marching files (finestra scorrevole)

Serve a non riempire il disco con le 500 puntate di una serie lunga.

Con `rolling` attivo il server tiene sempre `window` episodi pronti, contando dal primo non
ancora visto. Quando un episodio finisce (evento `ended` nel player, che chiama
`POST /api/watched`) il server lo segna come visto, sposta la finestra avanti di uno e mette in
coda il successivo. Se `deleteWatched` è attivo cancella anche il file appena visto, mentre la
traccia del "visto" resta.

Lo stato di ogni serie o stagione è in `data/media/<slug>/state.json`:

```json
{
  "slug": "one-piece-YPfyN", "title": "One Piece", "poster": "...", "total": 1100,
  "wanted": [1101, 1102], "watched": [1, 2, 3],
  "rolling": true, "window": 10, "deleteWatched": true
}
```

Si comanda da tutte e due le UI: tre bottoni nella schermata episodi della TV, checkbox nella
scheda serie del desktop. Quali episodi scaricare lo decide `planFill` in `rolling.mjs`, che è
coperto dai test.

Sopra i 50 episodi il marching parte da solo: aggiungendo una serie con `total` maggiore di
`AUTO_ROLLING_OVER`, `rolling` diventa `true` e `window` si porta a `AUTO_WINDOW` (10).

## Deploy con Docker (UGOS o altro)

Il `docker-compose.yml` del repo tira già l'immagine da GitHub Packages:

```bash
docker compose up -d            # immagine ghcr.io/pixel3design-hub/vidaa-stream:0.6.1
```

Monta `./data` (o la tua cartella condivisa) su `/data` ed espone la 8099. Su UGOS apri
Docker → Project e importa il compose. Su Synology, QNAP o un PC cambia solo il path del volume.

Se preferisci compilare in locale, nel compose sostituisci `image:` con `build: .` e lancia
`docker compose up -d --build`. Serve anche la variante senza registry, per i NAS che non
raggiungono ghcr: `vidaa-stream-image-<ver>-amd64.tar.gz` dalla release, scompattata e importata
da Docker → Immagini → Importa da file.

## Pacchetto .upk per UGOS Pro (in pausa)

Il `.upk` per l'App Center richiede una firma, quindi al momento non viene prodotto: la CI non lo
compila e le release non lo contengono. I file del progetto restano nel repo (`ugos/project.yaml`,
`ugos/rootfs_common/docker-compose.yaml`, icona 256×256) insieme allo script che lo impacchetta,
pronti per quando ci sarà la firma. Fino ad allora su UGOS si usa l'immagine Docker.

Com'è fatto, per quando servirà: dentro il pacchetto c'è la stessa immagine, il compose e l'icona;
l'installazione chiede solo la cartella dove tenere i video.

```bash
bash scripts/build-upk.sh     # serve docker; VERSION, BUILD, ARCH, UGCLI da env
```

Lo script prende l'immagine da `ghcr.io/pixel3design-hub/vidaa-stream:<versione>` e, se il
registry non risponde, la compila in locale. Poi riallinea le versioni in `ugos/project.yaml` e
`ugos/rootfs_common/docker-compose.yaml`, salva il tar in `ugos/rootfs_amd64/images/` e lancia
`ugcli check` + `ugcli pack`. Il risultato finisce in
`ugos/build_dir/pkgs/upk/amd64_nasync_it.pixel3design.vidaastream_<ver>.upk`.

Serve `ugcli`, che si scarica dalla piattaforma sviluppatori UGREEN:

```bash
curl -fsSL -o /usr/local/bin/ugcli https://osswaf.ugnas.com/pro/ugcli/download/ugcli-v1.1.0.25-linux-amd64
chmod +x /usr/local/bin/ugcli
```

Installazione su un dispositivo abilitato: `ugdev.sig` nella cartella personale dell'admin, poi
App Center → impostazioni → impostazioni sviluppo app → Autorizza, infine App Center →
installazione manuale → il `.upk`.

## Installare l'app sulla TV

VIDAA non ha SDK pubblico né sideload: un'app è un URL installato con `Hisense_installApp(...)`,
funzione che esiste soltanto sull'origin `vidaahub.com`. Gli script dirottano quel nome sul PC
tramite DNS, servono la pagina con il bottone Installa e la nostra icona, e alla fine rimetti il
DNS della TV su automatico.

Basta lanciarli: si apre un menu.

```bash
bash scripts/install-tv.sh                    # Linux / macOS
powershell -ExecutionPolicy Bypass -File .\scripts\install-tv.ps1   # Windows
```

Il menu mostra IP, porta e nome dell'app, e offre: installa l'app sulla TV, controlla e installa
le dipendenze, prepara solo i file, rivedi i passi da fare sulla TV, stato, cambia IP/porta/nome.

Cosa fanno gli script per te:

- rilevano l'IP locale con gli strumenti di sistema, senza Node;
- se manca qualcosa per il servizio di installazione (uv, oppure python con dnslib) chiedono se
  vuoi che se ne occupino loro, altrimenti ti stampano il comando da dare a mano;
- quando serve aprire le porte 53 e 443 elevano i privilegi: `sudo` su Linux/macOS, richiesta di
  consenso e riapertura elevata su Windows;
- al primo giro scaricano [trialuser/vidaa-appstore](https://github.com/trialuser/vidaa-appstore)
  in `.installer/` (fuori da git), scrivono `config.json` e `install.html` e avviano il servizio,
  che fermi con Ctrl+C.

Sulla TV: Impostazioni → Rete → DNS uguale all'IP del PC, poi browser su `https://vidaahub.com/`,
accetta il certificato, premi "Installa", rimetti il DNS automatico e riavvia.

Per l'automazione restano le opzioni da riga di comando: `--ip`, `--port`, `--name`, `--appid`,
`--prepare` (`-Ip`, `-Port`, `-AppName`, `-AppId`, `-Prepare` su Windows) più `--yes`/`-Yes` per
non fare domande. Le stesse cose via ambiente: `IP`, `PORT`, `APPNAME`, `APPID`.

Node e ffmpeg non servono sulla tua macchina: stanno nell'immagine Docker insieme all'app. Gli
script di installazione usano solo un Python, che arriva con uv.

### Con un container usa e getta

Chi ha già Docker evita anche il Python: un container fa la parte di `vidaahub.com` (DNS su 53,
HTTPS su 443) e si chiude da solo quando la TV conferma l'installazione. Serve la 0.5.0 o
successiva: prima `installer/` non stava nell'immagine.

```bash
docker run --rm -it \
  -p 53:53/udp -p 443:443/tcp \
  -e HOST_IP=192.168.1.20 \
  -e APP_URL=http://192.168.1.20:8099/tv \
  ghcr.io/pixel3design-hub/vidaa-stream:0.6.1 \
  node installer/tv-install.mjs
```

Con il compose del repo:

```bash
HOST_IP=192.168.1.20 APP_URL=http://192.168.1.20:8099/tv \
  docker compose --profile install run --rm install-tv
```

`HOST_IP` è l'indirizzo che la TV raggiunge: dentro la rete bridge Docker l'IP rilevato sarebbe
quello del container, quindi va passato a mano. `APP_URL` è dove risponde il servizio, di solito
`http://<stesso IP>:8099/tv`. `TIMEOUT` (900 secondi) chiude tutto se nessuno installa.

Sulla TV restano gli stessi passi: DNS = `HOST_IP`, browser su `https://vidaahub.com/`, accetta il
certificato, Installa. Il container esce con 0 appena la pagina conferma, e `--rm` lo elimina.

Due cose che fanno fallire l'avvio: la porta 53 già occupata (su Linux desktop la prende
`systemd-resolved`) e `HOST_IP` mancante. Nei log è scritto quale delle due è.

### Icona

`icon.png` è il sorgente 1024×1024, `public/icon.png` è la versione 320×320 che la TV mostra nel
menu app e `public/favicon.png` quella da 32×32. Le prime due il servizio le espone su `/icon.png`
e `/favicon.png`. Dopo aver cambiato l'icona rigenera le derivate:

```bash
ffmpeg -y -i icon.png -vf scale=320:320 public/icon.png
ffmpeg -y -i icon.png -vf scale=32:32 public/favicon.png
```

### A mano (se gli script non ti servono)

1. clona `https://github.com/trialuser/vidaa-appstore`, `pip3 install dnslib`, copia `config.json`
   e aggiungi la voce in `apps` di `index-en.html`:
   ```js
   {category:'my', appid:'vidaa_anime', name:'Anime', url:'http://<ip-nas>:8099/tv', text:'Anime'}
   ```
2. `python3 server.py`, TV → DNS = IP del PC → `https://vidaahub.com/` → Installa.

Se l'installazione rifiuta un URL `http://`, il servizio sa parlare anche HTTPS su una
porta separata (`TLS_PORT`, default 8443). Serve una chiave e un certificato, anche self-signed:
la TV lo accetta una volta.

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=nas" \
  -keyout certs/nas.key -out certs/nas.crt

docker run -d --name vidaa-stream \
  -p 8099:8099 -p 8443:8443 \
  -e TLS_KEY=/certs/nas.key -e TLS_CERT=/certs/nas.crt \
  -v "$PWD/certs:/certs:ro" -v "$PWD/data:/data" \
  ghcr.io/pixel3design-hub/vidaa-stream:0.6.1
```

Poi installa l'app puntando a `https://<ip>:8443/tv`: con gli script è `APP_URL=https://...`,
con il container di installazione la stessa variabile `APP_URL`. Dentro l'immagine c'è già un
certificato utilizzabile, se non ti serve un CN preciso: `TLS_KEY=/app/installer/vidaahub.key` e
`TLS_CERT=/app/installer/vidaahub.crt`.

## API

| metodo | path | |
|---|---|---|
| GET | `/api/search?q=` | ricerca AnimeSaturn |
| GET | `/api/series?slug=` | episodi del sito |
| GET | `/api/library` | serie + episodi (`ready`, `size`, `watched`, `rolling`, `window`, `deleteWatched`); è il JSON che legge la TV |
| POST | `/api/add` | `{slug, episodes:[1,2]}` aggiunge e mette in coda |
| POST | `/api/download` | `{slug, ep}` singolo episodio |
| POST | `/api/watched` | `{slug, ep}` visto: cancella (se attivo) e sposta la finestra |
| POST | `/api/unwatched` | `{slug, ep}` annulla "visto" |
| POST | `/api/settings` | `{slug, window, rolling, deleteWatched}` |
| POST | `/api/remove` | `{slug, ep}` cancella file e voce (annulla il download in corso) |
| GET | `/api/queue` | `[{slug, ep, state, pct, error}]` |
| GET | `/media/<slug>/ep-<n>.mp4` | file, con `Range` per il seek |
| GET | `/health` | `{ok, node, series}` |

## Come scarica

m3u8 e mp4 diretto passano dallo stesso comando:

```
ffmpeg -headers "Referer: https://play.saturncdn.net/\r\n" -i <src> -c copy -movflags +faststart -f mp4 out.mp4.part
```

Il file resta `.part` fino alla fine, così un download interrotto non compare in libreria. La
percentuale arriva da `-progress pipe:1` (`out_time_us` diviso la durata letta con `ffprobe`).

## Test

```bash
npm test        # node --test
```

## Note

- Se AnimeSaturn cambia markup si tocca solo `animesaturn.mjs`, che è una copia ridotta di
  `anisat_downloader/extension/sites/animesaturn.js`: due punti da aggiornare.
- Su AnimeSaturn le stagioni sono schede separate, quindi "aggiungi stagione" vuol dire aggiungere
  la scheda `…-season-2` al catalogo. La regola dei 50 episodi guarda il totale di quella scheda.
- ffmpeg prende la variante migliore del master, di solito 720p. Se una variante ha audio HE-AAC
  rotto il job finisce in `error`, con l'ultima riga di ffmpeg nel campo `error`.
- Oltre a `deleteWatched` non c'è pulizia automatica: i file restano finché non li cancelli.
