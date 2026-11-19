// Finestra scorrevole: decide quali episodi tenere scaricati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFill, nextUnwatched } from '../rolling.mjs';

const state = (o) => ({ total: 100, window: 3, rolling: true, watched: [], ...o });

test('scarica i primi N quando non si è visto nulla', () => {
  assert.deepEqual(planFill(state({}), () => false), [1, 2, 3]);
});

test('dopo aver visto un episodio la finestra scorre di uno', () => {
  const have = new Set([1, 2, 3]);
  // ep1 visto e cancellato, 2 e 3 su disco → manca solo il 4
  assert.deepEqual(planFill(state({ watched: [1] }), (e) => have.has(e)), [4]);
  // niente da fare finché la finestra è piena
  assert.deepEqual(planFill(state({ watched: [] }), (e) => have.has(e)), []);
});

test('gli episodi visti non occupano la finestra', () => {
  // 1-5 visti, nessun file: la finestra parte dal 6
  assert.deepEqual(planFill(state({ watched: [1, 2, 3, 4, 5] }), () => false), [6, 7, 8]);
});

test('quello che è già in coda viene saltato ma occupa una slot', () => {
  // 2 è in download: la finestra copre 1,2,3 → mette in coda 1 e 3
  assert.deepEqual(planFill(state({}), (e) => e === 2), [1, 3]);
});

test('si ferma alla fine della serie', () => {
  assert.deepEqual(planFill(state({ total: 4, watched: [1, 2] }), () => false), [3, 4]);
});

test('marching spento o finestra zero: non tocca niente', () => {
  assert.deepEqual(planFill(state({ rolling: false }), () => false), []);
  assert.deepEqual(planFill(state({ window: 0 }), () => false), []);
});

test('nextUnwatched salta i visti e ritorna null a fine serie', () => {
  assert.equal(nextUnwatched({ total: 5, watched: [1, 2] }), 3);
  assert.equal(nextUnwatched({ total: 2, watched: [1, 2] }), null);
});

test('soglia auto: oltre 50 episodi la finestra è 10', async () => {
  const { AUTO_ROLLING_OVER, AUTO_WINDOW } = await import('../library.mjs');
  assert.equal(AUTO_ROLLING_OVER, 50);
  assert.equal(AUTO_WINDOW, 10);
});
