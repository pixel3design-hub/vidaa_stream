// Catalogo locale + file su disco. Nessun DB: catalog.json + esistenza dei file.
import { readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DATA = process.env.DATA || fileURLToPath(new URL('./data/', import.meta.url));
const CATALOG = `${DATA}/catalog.json`;
const MEDIA = `${DATA}/media`;

export const episodePath = (slug, n) => `${MEDIA}/${slug}/ep-${n}.mp4`;

let catalog = [];

export async function load() {
  await mkdir(MEDIA, { recursive: true });
  try {
    const j = JSON.parse(await readFile(CATALOG, 'utf8'));
    catalog = Array.isArray(j) ? j : [];
  } catch {
    catalog = [];
  }
  return catalog;
}

async function save() {
  const tmp = `${CATALOG}.tmp`;
  await writeFile(tmp, JSON.stringify(catalog, null, 2));
  await rename(tmp, CATALOG);
}

export const find = (slug) => catalog.find((s) => s.slug === slug);

const sizeOf = async (p) => { try { return (await stat(p)).size; } catch { return 0; } };

// aggiunge la serie (se nuova) e unisce gli episodi richiesti
export async function add({ slug, title, poster, episodes = [] }) {
  let s = find(slug);
  if (!s) {
    s = { slug, title: title || slug, poster: poster || '', wanted: [], addedAt: Date.now() };
    catalog.push(s);
  }
  if (title) s.title = title;
  if (poster) s.poster = poster;
  for (const n of episodes) {
    const num = Number(n);
    if (Number.isFinite(num) && !s.wanted.includes(num)) s.wanted.push(num);
  }
  s.wanted.sort((a, b) => a - b);
  await save();
  return s;
}

export async function removeEpisode(slug, n) {
  const s = find(slug);
  if (!s) return false;
  s.wanted = s.wanted.filter((x) => x !== Number(n));
  if (!s.wanted.length) catalog = catalog.filter((x) => x.slug !== slug);
  await save();
  await unlink(episodePath(slug, n)).catch(() => {});
  return true;
}

// struttura JSON servita alla TV
export async function library() {
  return Promise.all(
    catalog.map(async (s) => {
      const episodes = await Promise.all(
        s.wanted.map(async (n) => {
          const size = await sizeOf(episodePath(s.slug, n));
          return { n, ready: size > 0, size };
        }),
      );
      return { slug: s.slug, title: s.title, poster: s.poster, episodes };
    }),
  );
}
