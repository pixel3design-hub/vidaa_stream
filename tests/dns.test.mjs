// Risposte DNS del container di installazione: se sbagliano, la TV non trova vidaahub.com
// e l'installazione non parte. Query costruite a mano, niente rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReply, qname, qtype, questionEnd, NXDOMAIN, NOERROR } from '../installer/dns.mjs';

function query(name, type = 1, id = 0x1234) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);      // id
  head.writeUInt16BE(0x0100, 2);  // RD
  head.writeUInt16BE(1, 4);       // qdcount
  const labels = name.split('.').flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
  const tail = Buffer.from([0x00, type >> 8, type & 0xff, 0x00, 0x01]); // radice, qtype, qclass IN
  return Buffer.concat([head, ...labels, tail]);
}

const rcode = (buf) => buf.readUInt16BE(2) & 0x0f;
const ancount = (buf) => buf.readUInt16BE(6);

test('legge il nome e il tipo della domanda', () => {
  const q = query('vidaahub.com', 1);
  assert.equal(qname(q), 'vidaahub.com');
  assert.equal(qtype(q), 1);
  assert.equal(questionEnd(q), q.length);
});

test('A per vidaahub.com torna l IP con una risposta', () => {
  const q = query('vidaahub.com', 1);
  const r = buildReply(q, { answerIp: '192.168.1.20', rcode: NOERROR });
  assert.equal(r.readUInt16BE(0), 0x1234);   // stesso id
  assert.equal(rcode(r), NOERROR);
  assert.equal(ancount(r), 1);
  assert.equal(r.readUInt16BE(4), 1);        // qdcount
  assert.deepEqual([...r.subarray(r.length - 4)], [192, 168, 1, 20]);
  // il quesito è copiato identico subito dopo l header
  assert.deepEqual([...r.subarray(12, q.length)], [...q.subarray(12)]);
});

test('AAAA per lo stesso nome: nessuna risposta e nessun errore', () => {
  const r = buildReply(query('vidaahub.com', 28), { rcode: NOERROR });
  assert.equal(rcode(r), NOERROR);
  assert.equal(ancount(r), 0);
  assert.equal(r.length, questionEnd(query('vidaahub.com', 28)));
});

test('nomi altrui: NXDOMAIN, così la TV non si aspetta risposte', () => {
  const r = buildReply(query('google.com', 1), { rcode: NXDOMAIN });
  assert.equal(rcode(r), NXDOMAIN);
  assert.equal(ancount(r), 0);
});

test('compressione del nome nella risposta (puntatore 0xC00C)', () => {
  const r = buildReply(query('www.vidaahub.com', 1), { answerIp: '10.0.0.5' });
  const answer = r.subarray(r.length - 16);
  assert.equal(answer.readUInt16BE(0), 0xc00c);
  assert.equal(answer.readUInt16BE(2), 1);      // A
  assert.equal(answer.readUInt16BE(10), 4);     // rdlength
  assert.deepEqual([...answer.subarray(12)], [10, 0, 0, 5]);
});
