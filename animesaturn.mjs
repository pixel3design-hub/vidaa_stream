// Adapter AnimeSaturn. Unico punto che conosce il markup del sito:
// se cambia, si tocca solo questo file (e la copia nell'estensione browser).
// Copia ridotta di anisat_downloader/extension/sites/animesaturn.js
import { createLimiter, retryAfterMs } from './ratelimit.mjs';

export const SITE = 'https://www.animesaturn.net';
export const PLAY = 'https://play.saturncdn.net';
// senza questo Referer la playlist risponde 403
export const REFERER = `${PLAY}/`;
export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const NAMED = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

export function decodeEntities(s) {
  return String(s).replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const code = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

function firstMatch(re, s) {
  const m = re.exec(String(s));
  return m ? (m[1] ?? m[0]) : null;
}

function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { out.push(JSON.parse(m[1])); } catch { /* blocco non parsabile */ }
  }
  return out;
}

// base64 -> XOR con chiave ripetuta (schema usato da play.saturncdn.net)
export function xorDecode(b64, key) {
  const bin = Buffer.from(b64, 'base64').toString('latin1');
  let out = '';
  for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch con rate limit e rispetto del Retry-After: il sito chiude con 429 se lo si martella
export function createHttpGet({
  fetchImpl = fetch,
  limiter,
  sleep: wait = sleep,
  retries = Number(process.env.RATE_RETRIES ?? 3),
  warn = (m) => console.warn(m),
  now = Date.now,
} = {}) {
  return async function httpGet(url, headers) {
    for (let attempt = 0; ; attempt++) {
      await limiter?.();
      const r = await fetchImpl(url, { headers, cache: 'no-store' });
      if (r.status !== 429) return r;
      if (attempt >= retries) throw new Error(`HTTP 429 (troppe richieste) su ${url}`);
      const ms = retryAfterMs(r.headers, now()) ?? 1500 * (attempt + 1);
      warn(`429 su ${url}: aspetto ${Math.round(ms / 1000)}s (tentativo ${attempt + 1}/${retries})`);
      await wait(ms);
    }
  };
}

const httpGet = createHttpGet({
  limiter: createLimiter({ rateMs: Number(process.env.RATE_MS ?? 800) }),
});

async function get(url, as = 'text') {
  const r = await httpGet(url, { 'User-Agent': UA, Referer: `${SITE}/` });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
  return as === 'json' ? r.json() : r.text();
}

const slugOf = (u) => /\/anime\/([^/?#]+)/.exec(String(u))?.[1] || null;

// --- ricerca -------------------------------------------------------------

export async function search(q) {
  const j = await get(`${SITE}/api/search?q=${encodeURIComponent(q)}`, 'json');
  return (j.results || []).map((x) => ({
    slug: slugOf(x.url),
    title: x.title,
    poster: x.poster || '',
    year: x.year || '',
    episodes: Number(x.episodes) || null,
    status: x.status?.label || '',
  })).filter((x) => x.slug);
}

// --- serie ---------------------------------------------------------------

export async function series(slug) {
  const html = await get(`${SITE}/anime/${slug}`);
  const ld = jsonLd(html).find((x) => x['@type'] === 'TVSeries') || {};
  const byN = new Map();
  for (const m of html.matchAll(/href="\/episode\/([^/"]+)\/(ep-(\d+))"/g)) byN.set(Number(m[3]), Number(m[3]));
  return {
    slug,
    title: ld.name || decodeEntities(firstMatch(/<meta property="og:title" content="([^"]*)"/, html) || slug),
    poster: ld.image || firstMatch(/<meta property="og:image" content="([^"]*)"/, html) || '',
    description: decodeEntities((ld.description || '').trim()),
    episodes: [...byN.values()].sort((a, b) => a - b),
  };
}

// --- risoluzione stream --------------------------------------------------

// esportata a parte: testabile senza rete
export function parseWatchPage(html) {
  const raw = firstMatch(/x-data="watchPage\((\{[\s\S]*?\})\)"/, html);
  if (!raw) throw new Error('payload watchPage non trovato (markup cambiato?)');
  return JSON.parse(decodeEntities(raw));
}

function embedOf(link) {
  const u = new URL(link);
  return {
    id: u.pathname.split('/').filter(Boolean).pop(),
    token: u.searchParams.get('token') || '',
    expires: u.searchParams.get('expires') || '',
  };
}

// pagina episodio -> url sorgente (m3u8 o mp4 diretto) + scadenza
export async function resolve(slug, ep) {
  const html = await get(`${SITE}/anime/${slug}/ep-${ep}`);
  const data = parseWatchPage(html);
  const link = (data.servers || []).find((s) => s?.link)?.link || data.initialVideoUrl;
  if (!link) throw new Error('nessun server video disponibile');

  const { id, token, expires } = embedOf(link);
  const r = await fetch(`${PLAY}/embed/${id}/playlist?token=${encodeURIComponent(token)}&expires=${expires}`, {
    headers: { 'User-Agent': UA, Referer: REFERER },
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!j.d) throw new Error(j.ok === false ? 'playlist rifiutata (Referer non accettato)' : 'playlist vuota');

  const src = xorDecode(j.d, token);
  if (!/^https?:\/\//.test(src)) throw new Error('decodifica playlist fallita');

  return { src, hls: /\.m3u8(\?|$)/i.test(src), expiresAt: expires ? Number(expires) * 1000 : null };
}

// --- ultime uscite (dalla home) -------------------------------------------

// Estrae le card del carosello "Ultime uscite". Funzione pura: il markup è la parte
// fragile, quindi si prova con un fixture invece che con la rete.
export function parseLatest(html, limit = 30) {
  const start = html.indexOf('data-latest-rail');
  const rail = start >= 0 ? html.slice(start) : html;

  const out = [];
  for (const m of rail.matchAll(/<a href="\/episode\/([^/"]+)\/(ep-(\d+))" class="ac group">([\s\S]*?)<\/a>/g)) {
    const [, slug, , ep, inner] = m;
    const n = Number(ep);
    if (out.some((x) => x.slug === slug && x.ep === n)) continue;
    const poster = /<img src="([^"]+)"/.exec(inner)?.[1] || '';
    const title = decodeEntities(/<h3 class="ac__title">([^<]*)<\/h3>/.exec(inner)?.[1] || slug);
    out.push({ slug, ep: n, title, poster, url: `${SITE}/anime/${slug}/ep-${n}` });
    if (out.length >= limit) break;
  }
  return out;
}

export async function news(limit = 30) {
  let html;
  try {
    html = await get(`${SITE}/`);
  } catch (e) {
    // un "fetch failed" sulla home è quasi sempre transitorio: un secondo tentativo
    await new Promise((r) => setTimeout(r, 700));
    html = await get(`${SITE}/`);
  }
  return parseLatest(html, limit);
}
