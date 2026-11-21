// Servizio del NAS: API + UI desktop + UI TV. Zero dipendenze npm.
// Portabile: node:http + ffmpeg, gira su qualunque Linux/macOS/Windows o in container.
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { stat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as site from './animesaturn.mjs';
import * as lib from './library.mjs';
import { enqueue, queue, forget, isActive } from './downloader.mjs';
import { streams } from './streams.mjs';
import { planFill } from './rolling.mjs';

const MAJOR = Number(process.versions.node.split('.')[0]);
if (MAJOR < 24) {
  console.error(`serve Node >= 24 (in esecuzione: ${process.version}).`);
  process.exit(1);
}

// senza ffmpeg la libreria funziona ma i download no: meglio dirlo subito
for (const bin of ['ffmpeg', 'ffprobe']) {
  if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).error) {
    console.warn(`attenzione: ${bin} non è nel PATH, i download falliranno (nell'immagine Docker c'è)`);
  }
}

const PORT = Number(process.env.PORT || 8099);
// HTTPS opzionale: serve se la TV rifiuta un URL http:// in fase di installazione.
// TLS_KEY/TLS_CERT sono percorsi a un certificato (anche self-signed) e alla sua chiave.
const TLS_PORT = Number(process.env.TLS_PORT || 8443);
const TLS_KEY = process.env.TLS_KEY || '';
const TLS_CERT = process.env.TLS_CERT || '';
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('body troppo grande'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON non valido')); }
    });
    req.on('error', reject);
  });
}

const pipe = (stream, res) => stream.on('error', () => res.destroy()).pipe(res);

async function sendFile(req, res, path) {
  let st;
  try { st = await stat(path); } catch { return json(res, 404, { error: 'file non trovato' }); }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : null;
    let end = range[2] ? Number(range[2]) : null;
    if (start === null) { start = st.size - end; end = st.size - 1; }      // bytes=-500
    if (end === null || end >= st.size) end = st.size - 1;
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'content-type': 'video/mp4',
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${st.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'max-age=3600',
    });
    return pipe(createReadStream(path, { start, end }), res);
  }

  res.writeHead(200, {
    'content-type': 'video/mp4',
    'content-length': st.size,
    'accept-ranges': 'bytes',
    'cache-control': 'max-age=3600',
  });
  pipe(createReadStream(path), res);
}

const page = async (res, file) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(await readFile(PUBLIC + file));
};

// icona, favicon e hls.js: servono anche alla pagina di installazione sulla TV
const STATIC = {
  '/icon.png': ['icon.png', 'image/png'],
  '/favicon.png': ['favicon.png', 'image/png'],
  '/favicon.ico': ['favicon.png', 'image/png'],
  '/hls.js': ['hls.js', 'application/javascript; charset=utf-8'],
};

async function sendStatic(res, [file, type]) {
  try {
    const buf = await readFile(PUBLIC + file);
    res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'max-age=86400' });
    res.end(buf);
  } catch {
    json(res, 404, { error: 'non trovato' });
  }
}

// --- proxy HLS/mp4 -------------------------------------------------------
// Non è un relay aperto: solo http/https su host che il resolver usa davvero.
// La TV non ha internet libero, e senza Referer il CDN risponde 403.
const LIVE_HOSTS = ['saturncdn.net', 'streampeaker.org'];

function liveUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  return LIVE_HOSTS.some((d) => h === d || h.endsWith('.' + d)) ? u : null;
}

const proxied = (abs, referer) => `/p?u=${encodeURIComponent(abs)}&r=${encodeURIComponent(referer)}`;

// righe non-# più gli URI dentro EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA
function rewritePlaylist(text, base, referer) {
  return text.split('\n').map((line) => {
    const l = line.trimEnd();
    if (!l) return l;
    if (l.startsWith('#')) {
      return l.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxied(new URL(uri, base).href, referer)}"`);
    }
    return proxied(new URL(l, base).href, referer);
  }).join('\n');
}

async function liveProxy(req, res, q) {
  const target = liveUrl(q.get('u') || '');
  if (!target) return json(res, 400, { error: 'url non ammessa' });
  const referer = liveUrl(q.get('r') || '')?.href || site.REFERER;
  const headers = { 'User-Agent': site.UA, Referer: referer };
  if (req.headers.range) headers.Range = req.headers.range;

  const r = await fetch(target, { headers, cache: 'no-store' });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    return json(res, r.status, { error: `CDN ${r.status}${body ? ': ' + body.slice(0, 120) : ''}` });
  }

  const base = new URL(r.url || target.href); // dopo un redirect le rotte relative cambiano
  const type = r.headers.get('content-type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8($|\?)/i.test(base.href)) {
    const text = await r.text();
    const body = text.trimStart().startsWith('#EXTM3U') ? rewritePlaylist(text, base, referer) : text;
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  const pass = { 'content-type': type || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  for (const h of ['content-length', 'content-range']) {
    const v = r.headers.get(h);
    if (v && !r.headers.get('content-encoding')) pass[h] = v;
  }
  res.writeHead(r.status, pass);
  Readable.fromWeb(r.body).pipe(res);
}

// metadati dal sito: titolo, poster, totale episodi
async function ensureSeries(slug) {
  const info = await site.series(slug);
  const total = info.episodes.at(-1) || 0;
  await lib.upsert({ slug, title: info.title, poster: info.poster, total });
  return info;
}

// riempie la finestra scorrevole: N episodi pronti dal primo non visto
async function fill(slug) {
  const s = lib.get(slug);
  if (!s || !s.rolling) return 0;
  const downloaded = await lib.downloadedSet(slug);
  const eps = planFill(s, (ep) => downloaded.has(ep) || isActive(slug, ep));
  if (!eps.length) return 0;
  await lib.addEpisodes(slug, eps);
  return enqueue(slug, eps);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const q = url.searchParams;
  const path = url.pathname;

  try {
    if (path === '/' || path === '/ui') return await page(res, 'ui.html');
    if (path === '/tv') return await page(res, 'tv.html');
    if (STATIC[path]) return await sendStatic(res, STATIC[path]);
    if (path === '/p') return await liveProxy(req, res, q);
    if (path === '/health') return json(res, 200, { ok: true, node: process.version, series: lib.size() });

    const media = /^\/media\/([a-z0-9._-]+)\/ep-(\d+)\.mp4$/i.exec(path);
    if (media) return await sendFile(req, res, lib.episodePath(media[1], Number(media[2])));

    if (path === '/api/search') return json(res, 200, await site.search(q.get('q') || ''));
    if (path === '/api/series') return json(res, 200, await site.series(q.get('slug')));
    if (path === '/api/library') return json(res, 200, await lib.library());
    if (path === '/api/queue') return json(res, 200, queue());
    if (path === '/api/live') {
      const slug = q.get('slug');
      const ep = Number(q.get('ep'));
      if (!slug || !Number.isFinite(ep) || ep <= 0) return json(res, 400, { error: 'slug/ep mancanti' });
      const s = await streams.get(slug, ep);
      return json(res, 200, {
        kind: s.hls ? 'hls' : 'mp4',
        src: proxied(s.src, site.REFERER),
        expiresAt: s.expiresAt,
      });
    }

    if (req.method === 'POST' && path === '/api/add') {
      const { slug, episodes = [] } = await readBody(req);
      if (!slug) return json(res, 400, { error: 'slug mancante' });
      await ensureSeries(slug);
      const chosen = episodes.filter((n) => Number.isFinite(Number(n)));
      await lib.addEpisodes(slug, chosen);
      const queued = enqueue(slug, chosen) + (await fill(slug));
      return json(res, 200, { ok: true, queued, series: lib.get(slug) });
    }

    if (req.method === 'POST' && path === '/api/download') {
      const { slug, ep } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      if (!lib.get(slug)) await ensureSeries(slug);
      await lib.addEpisodes(slug, [Number(ep)]);
      const queued = enqueue(slug, [Number(ep)]) + (await fill(slug));
      return json(res, 200, { ok: true, queued });
    }

    // fine visione: segna vista, eventualmente cancella il file, sposta la finestra
    if (req.method === 'POST' && path === '/api/watched') {
      const { slug, ep } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      forget(slug, ep); // se era ancora in download, va annullato
      const s = await lib.markWatched(slug, Number(ep));
      const queued = await fill(slug);
      return json(res, 200, { ok: true, watched: s.watched, deleted: s.deleteWatched, queued });
    }

    if (req.method === 'POST' && path === '/api/unwatched') {
      const { slug, ep } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      await lib.markUnwatched(slug, Number(ep));
      return json(res, 200, { ok: true, queued: await fill(slug) });
    }

    // avanzamento: non usa /api/watched, che altrimenti cancellerebbe il file mentre lo si guarda
    if (req.method === 'POST' && path === '/api/progress') {
      const { slug, ep, pos, dur } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      const wasWatched = lib.get(slug)?.watched.includes(Number(ep)) || false;
      const s = await lib.markProgress(slug, Number(ep), pos, dur);
      // appena superata la soglia la finestra scorre, come su /api/watched
      const queued = !wasWatched && s.watched.includes(Number(ep)) ? await fill(slug) : 0;
      return json(res, 200, { ok: true, watched: s.watched, queued });
    }

    if (req.method === 'POST' && path === '/api/settings') {
      const { slug, window, rolling, deleteWatched } = await readBody(req);
      if (!slug) return json(res, 400, { error: 'slug mancante' });
      const s = await lib.settings(slug, { window, rolling, deleteWatched });
      const queued = await fill(slug);
      return json(res, 200, { ok: true, queued, series: s });
    }

    if (req.method === 'POST' && path === '/api/remove') {
      const { slug, ep } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      forget(slug, ep);
      await lib.removeEpisode(slug, ep);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
}

await lib.load();
createServer(route).listen(PORT, '0.0.0.0', () => {
  console.log(`vidaa_stream (node ${process.version}): UI http://<host>:${PORT}/  TV http://<host>:${PORT}/tv`);
  if (!TLS_KEY || !TLS_CERT) return;
  try {
    createHttpsServer(
      { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) },
      route,
    ).listen(TLS_PORT, '0.0.0.0', () => {
      console.log(`vidaa_stream: anche in HTTPS su <host>:${TLS_PORT} (certificato self-signed, la TV lo accetta una volta)`);
    });
  } catch (e) {
    console.error(`HTTPS non avviato: ${e.message} (controlla TLS_KEY e TLS_CERT)`);
  }
});
