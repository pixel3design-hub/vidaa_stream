// Traccia di visione: posizione salvata, soglia 90%, deleteWatched. DATA temporaneo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA = await mkdtemp(join(tmpdir(), 'vidaa-progress-'));
const lib = await import('../library.mjs');

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

async function series(slug, { deleteWatched = false, episodes = [1, 2] } = {}) {
  await lib.upsert({ slug, title: slug, total: 10 });
  await lib.addEpisodes(slug, episodes);
  if (deleteWatched) await lib.settings(slug, { deleteWatched: true });
  return lib.get(slug);
}

test('sotto il 90% salva la posizione ma non marca visto', async () => {
  await series('sotto');
  const s = await lib.markProgress('sotto', 1, 600, 1000);
  assert.deepEqual(s.watched, []);
  assert.equal(s.progress[1].pos, 600);
  assert.equal(s.progress[1].dur, 1000);
});

test('sopra il 90% marca visto', async () => {
  await series('sopra');
  const s = await lib.markProgress('sopra', 2, 950, 1000);
  assert.deepEqual(s.watched, [2]);
});

test('deleteWatched al 90%: file via e wanted più corto', async () => {
  await series('cancella', { deleteWatched: true });
  const file = lib.episodePath('cancella', 1);
  await mkdir(join(process.env.DATA, 'media', 'cancella'), { recursive: true });
  await writeFile(file, 'x');
  assert.equal(await exists(file), true);
  const s = await lib.markProgress('cancella', 1, 990, 1000);
  assert.deepEqual(s.wanted, [2]);
  assert.equal(await exists(file), false);
  assert.deepEqual(s.watched, [1]);
});

test('markWatched non duplica e markUnwatched azzera la ripresa', async () => {
  await series('dup', { deleteWatched: false });
  await lib.markProgress('dup', 1, 500, 1000);
  await lib.markWatched('dup', 1);
  const again = await lib.markWatched('dup', 1);
  assert.deepEqual(again.watched, [1]);
  const s = await lib.markUnwatched('dup', 1);
  assert.deepEqual(s.watched, []);
  assert.equal(s.progress[1], undefined);
});

test('library() espone pos per ogni episodio', async () => {
  await series('lista', { episodes: [1, 2] });
  await lib.markProgress('lista', 1, 123, 1000);
  const row = (await lib.library()).find((x) => x.slug === 'lista');
  assert.equal(row.episodes.find((e) => e.n === 1).pos, 123);
  assert.equal(row.episodes.find((e) => e.n === 2).pos, 0);
});
