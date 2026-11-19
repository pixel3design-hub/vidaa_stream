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

```bash
node -v            # serve >= 24, il processo si ferma con un messaggio chiaro se è più vecchio
node server.mjs    # ffmpeg e ffprobe nel PATH
# PC:  http://localhost:8099/
# TV:  http://localhost:8099/tv
```

I dati stanno in `./data` (cambiali con `DATA`), una cartella per serie dentro `data/media/`.
Le altre variabili sono `PORT` (8099) e `CONCURRENCY` (2 download in parallelo).

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

```bash
docker build -t vidaa-stream:latest .
docker save vidaa-stream:latest -o vidaa-stream.tar   # su UGOS: Docker → Immagini → Importa da file
```

`docker-compose.yml` monta `/volume1/docker/vidaa-player/data` su `/data` ed espone la 8099.
Su UGOS apri Docker → Project e importa il compose. Su Synology, QNAP o un PC cambia solo il
path del volume.

## Installare l'app sulla TV

VIDAA non ha SDK pubblico né sideload: un'app è un URL installato con `Hisense_installApp(...)`,
funzione che esiste soltanto sull'origin `vidaahub.com`. Gli script qui sotto dirottano quel nome
sul PC tramite DNS, servono la pagina con il bottone Installa e la nostra icona, e alla fine
rimetti il DNS della TV su automatico.

```bash
# Linux / macOS (porte 53 e 443: chiede sudo)
bash scripts/install-tv.sh                 # IP rilevato da solo
bash scripts/install-tv.sh 192.168.1.20    # oppure esplicito
NO_RUN=1 bash scripts/install-tv.sh        # prepara soltanto, non avvia

# Windows (PowerShell come Amministratore)
.\scripts\install-tv.ps1
.\scripts\install-tv.ps1 -Ip 192.168.1.20 -Prepare   # prepara soltanto
```

Entrambi leggono `PORT` (8099), `APPNAME`/`-AppName` (Anime), `APPID`/`-AppId` (vidaa_anime) e
`IP`/`-Ip`. Al primo giro scaricano [trialuser/vidaa-appstore](https://github.com/trialuser/vidaa-appstore)
in `.installer/` (fuori da git), scrivono `config.json` e `install.html`, e avviano il servizio;
Ctrl+C per fermarlo.

Sulla TV: Impostazioni → Rete → DNS uguale all'IP del PC, poi browser su `https://vidaahub.com/`,
accetta il certificato, premi "Installa", rimetti il DNS automatico e riavvia.

Agli script servono `python3` con `dnslib` (`python3 -m pip install dnslib`) e `git` oppure
`curl` con `tar`. Node non gli serve, ma senza Node l'app non funziona.

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

Se l'installazione rifiuta un URL `http://`: aggiungi TLS self-signed sulla 8443
(`openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=nas"`),
installa l'app con `https://<ip-nas>:8443/tv` e accetta il certificato una volta nella TV.

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
