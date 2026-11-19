// Servizio del NAS: API + UI desktop + UI TV. Zero dipendenze npm.
// Portabile: node:http + ffmpeg, gira su qualunque Linux/macOS/Windows o in container.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as site from './animesaturn.mjs';
import * as lib from './library.mjs';
import { enqueue, queue, forget, isActive } from './downloader.mjs';
import { planFill } from './rolling.mjs';

const MAJOR = Number(process.versions.node.split('.')[0]);
if (MAJOR < 24) {
  console.error(`serve Node >= 24 (in esecuzione: ${process.version}).`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8099);
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

// icona e favicon: servono anche alla pagina di installazione sulla TV
const STATIC = { '/icon.png': 'icon.png', '/favicon.png': 'favicon.png', '/favicon.ico': 'favicon.png' };

async function sendStatic(res, file) {
  try {
    const buf = await readFile(PUBLIC + file);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'max-age=86400' });
    res.end(buf);
  } catch {
    json(res, 404, { error: 'non trovato' });
  }
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
    if (path === '/health') return json(res, 200, { ok: true, node: process.version, series: lib.size() });

    const media = /^\/media\/([a-z0-9._-]+)\/ep-(\d+)\.mp4$/i.exec(path);
    if (media) return await sendFile(req, res, lib.episodePath(media[1], Number(media[2])));

    if (path === '/api/search') return json(res, 200, await site.search(q.get('q') || ''));
    if (path === '/api/series') return json(res, 200, await site.series(q.get('slug')));
    if (path === '/api/library') return json(res, 200, await lib.library());
    if (path === '/api/queue') return json(res, 200, queue());

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
});
