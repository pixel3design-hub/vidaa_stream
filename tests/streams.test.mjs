// Cache delle URL: una risoluzione vale finché non scade. Nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamCache } from '../streams.mjs';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function stub(clock, expiresInMs = 3600_000) {
  let calls = 0;
  const fetcher = async (slug, ep) => {
    calls++;
    return { src: `https://cdn/${slug}/${ep}?n=${calls}`, hls: true, expiresAt: clock.now() + expiresInMs };
  };
  return { fetcher, calls: () => calls };
}

test('hit fresco: una sola chiamata', async () => {
  const c = fakeClock();
  const s = stub(c);
  const cache = createStreamCache({ fetcher: s.fetcher, now: c.now });
  await cache.get('a', 1);
  await cache.get('a', 1);
  assert.equal(s.calls(), 1);
});

test('scadenza vicina: risolve di nuovo', async () => {
  const c = fakeClock();
  const s = stub(c, 3600_000);
  const cache = createStreamCache({ fetcher: s.fetcher, marginMs: 60_000, now: c.now });
  await cache.get('a', 1);
  c.advance(3600_000 - 30_000); // dentro il margine
  const v = await cache.get('a', 1);
  assert.equal(s.calls(), 2);
  assert.match(v.src, /n=2$/);
});

test('URL scaduta: risolve di nuovo', async () => {
  const c = fakeClock();
  const s = stub(c, 60_000);
  const cache = createStreamCache({ fetcher: s.fetcher, now: c.now });
  await cache.get('a', 1);
  c.advance(120_000);
  await cache.get('a', 1);
  assert.equal(s.calls(), 2);
});

test('force risolve anche un hit fresco', async () => {
  const c = fakeClock();
  const s = stub(c);
  const cache = createStreamCache({ fetcher: s.fetcher, now: c.now });
  await cache.get('a', 1);
  await cache.get('a', 1, { force: true });
  assert.equal(s.calls(), 2);
});

test('invalidate: la prossima get risolve', async () => {
  const c = fakeClock();
  const s = stub(c);
  const cache = createStreamCache({ fetcher: s.fetcher, now: c.now });
  await cache.get('a', 1);
  cache.invalidate('a', 1);
  await cache.get('a', 1);
  assert.equal(s.calls(), 2);
});

test('senza expiresAt l’URL resta valida', async () => {
  const c = fakeClock();
  let calls = 0;
  const cache = createStreamCache({
    now: c.now,
    fetcher: async () => { calls++; return { src: 'https://cdn/x.mp4', hls: false, expiresAt: null }; },
  });
  await cache.get('a', 1);
  c.advance(86_400_000);
  await cache.get('a', 1);
  assert.equal(calls, 1);
});

test('due get concorrenti sulla stessa puntata: una sola chiamata', async () => {
  const c = fakeClock();
  const s = stub(c);
  const cache = createStreamCache({ fetcher: s.fetcher, now: c.now });
  await Promise.all([cache.get('a', 1), cache.get('a', 1)]);
  assert.equal(s.calls(), 1);
});
