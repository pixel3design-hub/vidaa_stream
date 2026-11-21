// Rate limit: distanza minima, Retry-After, percorso 429 -> 200. Nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, retryAfterMs } from '../ratelimit.mjs';
import { createHttpGet } from '../animesaturn.mjs';

test('le chiamate rispettano la distanza minima', async () => {
  let t = 0;
  const starts = [];
  const limiter = createLimiter({
    rateMs: 800,
    now: () => t,
    sleep: async (ms) => { t += ms; starts.push(t); },
  });
  await limiter();
  await limiter();
  await limiter();
  // la prima non dorme, le altre aspettano 800 ms l'una dall'altra
  assert.deepEqual(starts, [800, 1600]);
});

test('rateMs 0 non aspetta', async () => {
  let t = 0;
  const limiter = createLimiter({ rateMs: 0, now: () => t, sleep: async () => { t += 999; } });
  await limiter();
  await limiter();
  assert.equal(t, 0);
});

test('retryAfterMs legge i secondi', () => {
  assert.equal(retryAfterMs(new Headers({ 'retry-after': '3' })), 3000);
  assert.equal(retryAfterMs({ 'retry-after': '0' }), 0);
});

test('retryAfterMs legge la data HTTP', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const at = new Date(now + 7000).toUTCString();
  assert.equal(retryAfterMs(new Headers({ 'retry-after': at }), now), 7000);
});

test('retryAfterMs senza header o illeggibile: null', () => {
  assert.equal(retryAfterMs(new Headers()), null);
  assert.equal(retryAfterMs(new Headers({ 'retry-after': 'boh' })), null);
});

test('429 poi 200: aspetta e riprova', async () => {
  const waits = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '2' } });
    return new Response('ok', { status: 200 });
  };
  const httpGet = createHttpGet({
    fetchImpl,
    limiter: async () => {},
    sleep: async (ms) => { waits.push(ms); },
    warn: () => {},
  });
  const r = await httpGet('https://example.test/x');
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
});

test('429 senza Retry-After: attesa crescente, poi errore esplicito', async () => {
  const waits = [];
  let calls = 0;
  const httpGet = createHttpGet({
    fetchImpl: async () => { calls++; return new Response('', { status: 429 }); },
    retries: 2,
    sleep: async (ms) => { waits.push(ms); },
    warn: () => {},
  });
  await assert.rejects(() => httpGet('https://example.test/x'), /429/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 3000]);
});
