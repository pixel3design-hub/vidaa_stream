// La cache deve ridurre le richieste al sito ma non nascondere gli errori né restare stantia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTtlCache } from '../ttlcache.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('seconda chiamata entro il TTL non ricarica', async () => {
  let chiamate = 0;
  const c = createTtlCache({ ttlMs: 1000 });
  const load = async () => { chiamate++; return 'x'; };
  assert.equal(await c.get('k', load), 'x');
  assert.equal(await c.get('k', load), 'x');
  assert.equal(chiamate, 1);
});

test('due richieste simultanee condividono la stessa load', async () => {
  let chiamate = 0;
  const c = createTtlCache({ ttlMs: 1000 });
  const load = async () => { chiamate++; await wait(30); return 'y'; };
  const [a, b] = await Promise.all([c.get('k', load), c.get('k', load)]);
  assert.equal(a, 'y');
  assert.equal(b, 'y');
  assert.equal(chiamate, 1);
});

test('chiavi diverse non si pestano', async () => {
  const c = createTtlCache({ ttlMs: 1000 });
  const uno = await c.get('a', async () => 1);
  const due = await c.get('b', async () => 2);
  assert.deepEqual([uno, due], [1, 2]);
  assert.equal(c.size, 2);
});

test('scaduto il TTL ricarica', async () => {
  let chiamate = 0;
  let ora = 0;
  const c = createTtlCache({ ttlMs: 1000, now: () => ora });
  const load = async () => { chiamate++; return chiamate; };
  assert.equal(await c.get('k', load), 1);
  ora = 500;
  assert.equal(await c.get('k', load), 1);
  ora = 1500;
  assert.equal(await c.get('k', load), 2);
});

test('un errore non resta in cache', async () => {
  let chiamate = 0;
  const c = createTtlCache({ ttlMs: 5000 });
  const rotto = async () => { chiamate++; throw new Error('rete'); };
  await assert.rejects(() => c.get('k', rotto), /rete/);
  const buono = async () => { chiamate++; return 'ok'; };
  assert.equal(await c.get('k', buono), 'ok');
  assert.equal(chiamate, 2);
});

test('clear svuota', async () => {
  const c = createTtlCache({ ttlMs: 5000 });
  await c.get('k', async () => 1);
  c.clear();
  assert.equal(c.size, 0);
});
