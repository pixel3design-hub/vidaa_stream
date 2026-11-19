# vidaa-player

Servizio che gira sul NAS (UGOS / Docker): cerca le serie su AnimeSaturn, scarica gli episodi
con ffmpeg e li serve in HTTP alla TV. L'app VIDAA è solo un client di questo servizio.

```
┌──────────── NAS (docker) ─────────────┐        ┌──── TV VIDAA ────┐
│ /  ui.html      gestione (browser PC) │        │ app = pagina /tv │
│ /tv tv.html     app TV                │◄───────┤ video da /media  │
│ /api/library    JSON puntate pronte   │  http  └──────────────────┘
│ /media/*.mp4    file con Range        │
│ ffmpeg + Referer → CDN AnimeSaturn    │
└───────────────────────────────────────┘
```

La TV non tocca mai il CDN: niente Referer, niente CORS, niente token che scadono.

## Avvio rapido in locale (per provare)

```bash
node server.mjs            # richiede ffmpeg/ffprobe nel PATH
# PC:   http://localhost:8099/
# TV:   http://localhost:8099/tv
```

Dati in `./data` (`DATA` per cambiarli): `catalog.json` + `media/<slug>/ep-<n>.mp4`.

## Sul NAS (UGOS Pro)

Docker → **Project → importa compose**, oppure due passi con immagine:

```bash
# sul PC
docker build -t vidaa-player:latest .
docker save vidaa-player:latest -o vidaa-player.tar
# UGOS: Docker → Immagini → Importa da file → vidaa-player.tar
#       poi il compose di questo repo (o crea il container a mano:
#       porta 8099, volume /volume1/docker/vidaa-player/data → /data)
```

Verifica: `curl http://<ip-nas>:8099/health` → `{"ok":true}`.
UI di gestione: `http://<ip-nas>:8099/` — ricerca, spunte episodi, coda, cestino.

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

L'app compare tra le app installate e carica `/tv` dal NAS.

Se l'installazione rifiuta un URL `http://`: aggiungi TLS self-signed sulla 8443
(`openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=nas"`),
installa l'app con `https://<ip-nas>:8443/tv` e accetta il certificato una volta nella TV.

## API

| metodo | path | |
|---|---|---|
| GET | `/api/search?q=` | ricerca AnimeSaturn |
| GET | `/api/series?slug=` | episodi del sito |
| GET | `/api/library` | catalogo + `ready`/`size` per episodio — è il JSON della TV |
| POST | `/api/add` | `{slug, episodes:[1,2]}` aggiunge e mette in coda |
| POST | `/api/download` | `{slug, ep}` singolo episodio |
| POST | `/api/remove` | `{slug, ep}` cancella file e voce |
| GET | `/api/queue` | `[{slug, ep, state, pct, error}]` |
| GET | `/media/<slug>/ep-<n>.mp4` | file, con `Range` per il seek |
| GET | `/health` | |

## Come scarica

Un solo comando per m3u8 e mp4:

```
ffmpeg -headers "Referer: https://play.saturncdn.net/\r\n" -i <src> -c copy -movflags +faststart out.mp4.part
```

`.part` fino alla fine: un download interrotto non compare in libreria. Percentuale da
`-progress pipe:1` (`out_time_us` / durata da `ffprobe`). Concorrenza 2 (`CONCURRENCY`).

## Test

```bash
node --test
```

## Note

- Se AnimeSaturn cambia markup si tocca solo `animesaturn.mjs` (copia ridotta di
  `anisat_downloader/extension/sites/animesaturn.js`: due punti da aggiornare).
- Su AnimeSaturn le stagioni sono schede separate: "aggiungi stagione" = aggiungere
  la scheda `…-season-2` al catalogo.
- ffmpeg prende la variante migliore del master (720p). Se una variante ha audio HE-AAC
  rotto, il job finisce in `error` con l'ultima riga di ffmpeg in chiaro.
- Nessuna pulizia automatica: i file restano finché non li cancelli dalla UI.
