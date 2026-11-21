// Il caso che ha fatto cadere il container: la TV chiude la connessione a metà stream e il
// corpo remoto emette 'error'. Qui si verifica che non diventi un'eccezione non gestita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { proxyBody } from '../stream-proxy.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// finto `res`: un Writable che registra se viene distrutto/chiuso
function fakeRes() {
  const chunks = [];
  const res = new PassThrough();
  res.chunks = chunks;
  res.on('data', (c) => chunks.push(Buffer.from(c)));
  return res;
}

test('errore a metà stream: niente eccezioni non gestite, upstream abortito', async () => {
  const remote = {
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        setTimeout(() => c.error(new Error('terminated')), 5);
      },
    }),
  };
  const res = fakeRes();
  const aborti = [];
  const body = proxyBody(remote, res, { abort: (e) => aborti.push(e) });

  await wait(60); // se l'errore sfuggisse, qui il test runner esploderebbe
  assert.ok(aborti.length, 'abort deve essere chiamato');
  assert.match(String(aborti[0].message), /terminated/);
  assert.equal(body.destroyed, true);
});

test('stream normale: i byte arrivano tutti e non si aborta alla fine', async () => {
  const remote = {
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3, 4]));
        c.close();
      },
    }),
  };
  const res = fakeRes();
  let abortato = false;
  proxyBody(remote, res, { abort: () => (abortato = true) });

  await wait(60);
  assert.deepEqual([...Buffer.concat(res.chunks)], [1, 2, 3, 4]);
  assert.equal(abortato, false);
});

test('client che chiude prima: stream distrutto e upstream abortito', async () => {
  const remote = {
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        // non chiude: resta in attesa come un video in corso
      },
    }),
  };
  const res = fakeRes();
  let abortato = false;
  const body = proxyBody(remote, res, { abort: () => (abortato = true) });

  res.destroy(); // la TV se ne va
  await wait(60);
  assert.equal(abortato, true);
  assert.equal(body.destroyed, true);
});

test('risposta senza corpo: chiude e basta', () => {
  const res = fakeRes();
  const body = proxyBody({ body: null }, res, {});
  assert.equal(body, null);
  assert.equal(res.writableEnded, true);
});
