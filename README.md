# vidaa_stream

Servizio che scarica serie da AnimeSaturn e le serve in HTTP a un'app VIDAA.
Gira su qualunque macchina con **Node 24+** e **ffmpeg**: NAS UGREEN (UGOS/Docker), mini PC,
Raspberry, Windows, macOS. Il container è una comodità, non un requisito.

```
┌──────────── host (NAS/PC/docker) ────────────┐        ┌──── TV VIDAA ────┐
│ /  ui.html      gestione (browser)           │        │ app = pagina /tv │
│ /tv tv.html     app TV                       │◄───────┤ video da /media  │
│ /api/library    JSON puntate pronte + viste  │  http  └──────────────────┘
│ /media/*.mp4    file con Range               │
│ ffmpeg + Referer → CDN AnimeSaturn           │
└──────────────────────────────────────────────┘
```

La TV non tocca mai il CDN: niente Referer, niente CORS, niente token che scadono.

## Avvio

```bash
node -v            # serve >= 24, il processo si ferma con un messaggio chiaro se è più vecchio
node server.mjs    # ffmpeg e ffprobe nel PATH
# PC:  http://localhost:8099/
# TV:  http://localhost:8099/tv
```

Dati in `./data` (`DATA` per spostarli): una cartella per serie dentro `data/media/`.

Variabili: `PORT` (8099), `DATA`, `CONCURRENCY` (2 download in parallelo).

## Marching files (finestra scorrevole)

Per non riempire il disco con 500 episodi:

- `rolling` attivo → il server tiene sempre **N episodi pronti** (`window`), a partire dal primo
  non ancora visto;
- quando un episodio finisce (`ended` nel player → `POST /api/watched`), viene segnato come visto,
  la finestra scorre avanti di uno e parte il download del successivo;
- `deleteWatched` attivo → il file appena visto viene cancellato (il "visto" resta registrato).

Lo stato vive in **`data/media/<slug>/state.json`**, uno per serie/stagione:

```json
{
  "slug": "one-piece-YPfyN", "title": "One Piece", "poster": "...", "total": 1100,
  "wanted": [1101, 1102], "watched": [1, 2, 3],
  "rolling": true, "window": 10, "deleteWatched": true
}
```

Si controlla da entrambe le UI: TV (tre bottoni nella schermata episodi) e desktop (checkbox
nella scheda serie). Il calcolo di cosa scaricare è in `rolling.mjs` (`planFill`), coperto dai test.

**Automatico oltre 50 episodi**: quando si aggiunge una serie con più di 50 episodi in totale
(`AUTO_ROLLING_OVER`), `rolling` e `window: 10` partono da soli (`AUTO_WINDOW`).

## Deploy con Docker (UGOS o altro)

```bash
docker build -t vidaa-stream:latest .
docker save vidaa-stream:latest -o vidaa-stream.tar   # su UGOS: Docker → Immagini → Importa da file
```

`docker-compose.yml` monta `/volume1/docker/vidaa-player/data` → `/data` e espone 8099.
Su UGOS: Docker → Project → importa il compose. Su un NAS Synology/QNAP o un PC: identico,
basta cambiare il path del volume.

## Installare l'app sulla TV

VIDAA non ha SDK pubblico né sideload: le app sono **URL installati** con
`Hisense_installApp(...)`, funzione disponibile solo sull'origin `vidaahub.com`.
Serve una volta sola, con un PC sulla stessa rete:

1. clona `https://github.com/trialuser/vidaa-appstore`, `pip3 install dnslib`, imposta nel
   `config.json` il tuo IP e aggiungi la nostra app nella lista `apps`:
   ```js
   {category:'my', appid:'vidaa_anime', name:'Anime',
    url:'http://<ip-nas>:8099/tv', text:'Anime'}
   ```
2. `python3 server.py`
3. sulla TV: Impostazioni → Rete → DNS = IP del PC; apri il browser su `https://vidaahub.com/`
   (accetta il certificato) → Installa accanto ad "Anime"
4. rimetti il DNS automatico e riavvia la TV.

Se l'installazione rifiuta un URL `http://`: aggiungi TLS self-signed sulla 8443
(`openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=nas"`),
installa l'app con `https://<ip-nas>:8443/tv` e accetta il certificato una volta nella TV.

## API

| metodo | path | |
|---|---|---|
| GET | `/api/search?q=` | ricerca AnimeSaturn |
| GET | `/api/series?slug=` | episodi del sito |
| GET | `/api/library` | serie + episodi (`ready`, `size`) + `watched`, `rolling`, `window`, `deleteWatched` — è il JSON della TV |
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

Un solo comando per m3u8 e mp4:

```
ffmpeg -headers "Referer: https://play.saturncdn.net/\r\n" -i <src> -c copy -movflags +faststart -f mp4 out.mp4.part
```

`.part` fino alla fine: un download interrotto non compare in libreria. Percentuale da
`-progress pipe:1` (`out_time_us` / durata da `ffprobe`).

## Test

```bash
npm test        # node --test
```

## Note

- Se AnimeSaturn cambia markup si tocca solo `animesaturn.mjs` (copia ridotta di
  `anisat_downloader/extension/sites/animesaturn.js`: due punti da aggiornare).
- Su AnimeSaturn le stagioni sono schede separate: "aggiungi stagione" = aggiungere
  la scheda `…-season-2` al catalogo. Quindi il totale "di tutte le stagioni" per la regola
  dei 50 episodi è quello della singola scheda.
- ffmpeg prende la variante migliore del master (720p). Se una variante ha audio HE-AAC
  rotto, il job finisce in `error` con l'ultima riga di ffmpeg in chiaro.
- Nessuna pulizia automatica oltre a `deleteWatched`: i file restano finché non li cancelli.
