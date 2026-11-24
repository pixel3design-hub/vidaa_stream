// La configurazione arriva da una pagina web: va normalizzata, non salvata come capita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DATA va impostata prima dell'import: library.mjs la legge al caricamento
process.env.DATA = await mkdtemp(join(tmpdir(), 'vs-config-'));
const cfg = await import('../config.mjs');

test('parte dai default', async () => {
  const c = await cfg.load();
  assert.equal(c.player.progress.mode, 'bar');
  assert.equal(c.player.progress.corner, 'bottom-left');
  assert.equal(c.player.progress.visible, true);
  assert.equal(c.player.progress.color, '#4f8cff');
  assert.equal(c.player.progress.opacity, 80);
});

test('accetta valori validi e li salva su file', async () => {
  const c = await cfg.save({ player: { progress: { mode: 'time', corner: 'top-right', color: '#FF8800', opacity: 55, visible: false } } });
  assert.equal(c.player.progress.mode, 'time');
  assert.equal(c.player.progress.corner, 'top-right');
  assert.equal(c.player.progress.color, '#ff8800', 'minuscolo');
  assert.equal(c.player.progress.opacity, 55);
  assert.equal(c.player.progress.visible, false);

  const suFile = JSON.parse(await readFile(join(process.env.DATA, 'config.json'), 'utf8'));
  assert.equal(suFile.player.progress.mode, 'time');
  const ricaricata = await cfg.load();
  assert.equal(ricaricata.player.progress.corner, 'top-right');
});

test('ignora valori inventati invece di salvarli', async () => {
  const c = await cfg.save({ player: { progress: { mode: 'boh', corner: 'in-mezzo', color: 'rosso', opacity: 'tanta' } } });
  assert.equal(c.player.progress.mode, 'time', 'resta il valore precedente');
  assert.equal(c.player.progress.corner, 'top-right');
  assert.equal(c.player.progress.color, '#ff8800');
  assert.equal(c.player.progress.opacity, 55);
});

test('opacità fuori scala viene limitata a 0-100', async () => {
  assert.equal((await cfg.save({ player: { progress: { opacity: 999 } } })).player.progress.opacity, 100);
  assert.equal((await cfg.save({ player: { progress: { opacity: -5 } } })).player.progress.opacity, 0);
});

test('patch parziale: cambia solo quello che passa', async () => {
  const c = await cfg.save({ player: { progress: { opacity: 30 } } });
  assert.equal(c.player.progress.opacity, 30);
  assert.equal(c.player.progress.mode, 'time', 'il resto resta');
  assert.equal(c.player.progress.color, '#ff8800');
});

test('formato accettato anche senza il wrapper player', async () => {
  const c = await cfg.save({ progress: { mode: 'both' } });
  assert.equal(c.player.progress.mode, 'both');
});

test('file corrotto: si riparte dai default senza crash', async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(process.env.DATA, 'config.json'), '{ non json');
  const c = await cfg.load();
  assert.equal(c.player.progress.mode, 'bar');
});
