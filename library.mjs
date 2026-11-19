// Stato locale: una cartella per serie/stagione, con state.json che tiene traccia di
// episodi voluti, episodi visti e impostazioni della finestra. Nessun DB.
// Portabile: solo node:fs, path con path.join, DATA configurabile.
import { readFile, writeFile, rename, mkdir, stat, unlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = process.env.DATA || fileURLToPath(new URL('./data/', import.meta.url));
const MEDIA = join(DATA, 'media');

// >50 episodi in totale: la finestra scorrevole parte da sola
export const AUTO_ROLLING_OVER = 50;
export const AUTO_WINDOW = 10;

const dirOf = (slug) => join(MEDIA, slug);
export const episodePath = (slug, n) => join(dirOf(slug), `ep-${n}.mp4`);
const statePath = (slug) => join(dirOf(slug), 'state.json');

const cache = new Map();

export async function load() {
  await mkdir(MEDIA, { recursive: true });
  cache.clear();
  for (const d of await readdir(MEDIA, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const s = await readJson(statePath(d.name));
    if (s) cache.set(s.slug || d.name, s);
  }
  return cache;
}

async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function save(s) {
  await mkdir(dirOf(s.slug), { recursive: true });
  const p = statePath(s.slug);
  const tmp = `${p}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, p);
  cache.set(s.slug, s);
}

export const get = (slug) => cache.get(slug);
export const size = () => cache.size;

export function blank(slug) {
  return {
    slug, title: slug, poster: '', total: 0,
    wanted: [], watched: [],
    rolling: false, window: AUTO_WINDOW, deleteWatched: false,
    addedAt: Date.now(),
  };
}

// crea o aggiorna i metadati (titolo/poster/totale episodi)
export async function upsert({ slug, title, poster, total }) {
  let s = get(slug);
  const fresh = !s;
  if (!s) s = blank(slug);
  if (title) s.title = title;
  if (poster) s.poster = poster;
  if (total) s.total = total;
  // serie lunghe: finestra scorrevole attiva da subito
  if (fresh && s.total > AUTO_ROLLING_OVER) {
    s.rolling = true;
    s.window = AUTO_WINDOW;
  }
  await save(s);
  return s;
}

export async function addEpisodes(slug, episodes) {
  const s = get(slug) || (await upsert({ slug }));
  for (const n of episodes) {
    const num = Number(n);
    if (Number.isFinite(num) && !s.wanted.includes(num)) s.wanted.push(num);
  }
  s.wanted.sort((a, b) => a - b);
  await save(s);
  return s;
}

export async function settings(slug, { window, rolling, deleteWatched }) {
  const s = get(slug);
  if (!s) throw new Error('serie sconosciuta');
  if (window !== undefined) s.window = Math.max(0, Math.min(100, Number(window) || 0));
  if (rolling !== undefined) s.rolling = !!rolling;
  if (deleteWatched !== undefined) s.deleteWatched = !!deleteWatched;
  await save(s);
  return s;
}

// segna vista; con deleteWatched il file sparisce (torna libero spazio)
export async function markWatched(slug, ep) {
  const s = get(slug);
  if (!s) throw new Error('serie sconosciuta');
  ep = Number(ep);
  if (!s.watched.includes(ep)) s.watched.push(ep);
  s.watched.sort((a, b) => a - b);
  if (s.deleteWatched) {
    s.wanted = s.wanted.filter((n) => n !== ep);
    await unlink(episodePath(slug, ep)).catch(() => {});
  }
  await save(s);
  return s;
}

export async function markUnwatched(slug, ep) {
  const s = get(slug);
  if (!s) throw new Error('serie sconosciuta');
  s.watched = s.watched.filter((n) => n !== Number(ep));
  await save(s);
  return s;
}

// rimuove episodio (file + voce); se la serie resta vuota sparisce dalla libreria
export async function removeEpisode(slug, n) {
  const s = get(slug);
  if (!s) return false;
  n = Number(n);
  s.wanted = s.wanted.filter((x) => x !== n);
  s.watched = s.watched.filter((x) => x !== n);
  await unlink(episodePath(slug, n)).catch(() => {});
  if (!s.wanted.length && !s.watched.length) {
    cache.delete(slug);
    await rm(dirOf(slug), { recursive: true, force: true });
  } else {
    await save(s);
  }
  return true;
}

const sizeOf = async (p) => { try { return (await stat(p)).size; } catch { return 0; } };

// episodi già su disco
export async function downloadedSet(slug) {
  const s = get(slug);
  const out = new Set();
  if (!s) return out;
  const sizes = await Promise.all(s.wanted.map(async (n) => [n, await sizeOf(episodePath(slug, n))]));
  for (const [n, size] of sizes) if (size > 0) out.add(n);
  return out;
}

// JSON servito alla TV
export async function library() {
  return Promise.all(
    [...cache.values()].sort((a, b) => a.title.localeCompare(b.title)).map(async (s) => {
      const episodes = await Promise.all(
        s.wanted.map(async (n) => {
          const size = await sizeOf(episodePath(s.slug, n));
          return { n, ready: size > 0, size, watched: s.watched.includes(n) };
        }),
      );
      return {
        slug: s.slug, title: s.title, poster: s.poster, total: s.total,
        rolling: s.rolling, window: s.window, deleteWatched: s.deleteWatched,
        watched: s.watched, episodes,
      };
    }),
  );
}
