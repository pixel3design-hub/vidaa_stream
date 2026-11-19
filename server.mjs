// Servizio del NAS: API + UI desktop + UI TV. Zero dipendenze npm.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as site from './animesaturn.mjs';
import * as lib from './library.mjs';
import { enqueue, queue, forget } from './downloader.mjs';

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

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const q = url.searchParams;
  const path = url.pathname;

  try {
    if (path === '/' || path === '/ui') return await page(res, 'ui.html');
    if (path === '/tv') return await page(res, 'tv.html');
        if (path === '/health') return json(res, 200, { ok: true, series: (await lib.library()).length });

    const media = /^\/media\/([a-z0-9._-]+)\/ep-(\d+)\.mp4$/i.exec(path);
    if (media) return await sendFile(req, res, lib.episodePath(media[1], Number(media[2])));

    if (path === '/api/search') return json(res, 200, await site.search(q.get('q') || ''));
    if (path === '/api/series') return json(res, 200, await site.series(q.get('slug')));
    if (path === '/api/library') return json(res, 200, await lib.library());
    if (path === '/api/queue') return json(res, 200, queue());

    if (req.method === 'POST' && path === '/api/add') {
      const { slug, episodes = [] } = await readBody(req);
      if (!slug) return json(res, 400, { error: 'slug mancante' });
      let s = lib.find(slug);
      let title = s?.title;
      let poster = s?.poster;
      if (!title || !poster) {
        const info = await site.series(slug);
        title = title || info.title;
        poster = poster || info.poster;
      }
      await lib.add({ slug, title, poster, episodes });
      const queued = enqueue(slug, episodes);
      return json(res, 200, { ok: true, queued });    }

    if (req.method === 'POST' && path === '/api/download') {
      const { slug, ep } = await readBody(req);
      if (!slug || !ep) return json(res, 400, { error: 'slug/ep mancanti' });
      let s = lib.find(slug);
      if (!s) {
        const info = await site.series(slug);
        s = await lib.add({ slug, title: info.title, poster: info.poster, episodes: [ep] });
      } else {
        await lib.add({ slug, episodes: [ep] });
      }
      return json(res, 200, { ok: true, queued: enqueue(slug, [ep]) });
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
  console.log(`vidaa-player: UI http://<nas>:${PORT}/  TV http://<nas>:${PORT}/tv`);
});
