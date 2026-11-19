// Verifica della logica che può rompersi in silenzio: decodifica XOR e parse del payload.
// Nessuna rete: i dati sono fixture generate qui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xorDecode, parseWatchPage, decodeEntities } from '../animesaturn.mjs';

// xorEncode è l'inverso di xorDecode (XOR è simmetrico)
function xorEncode(text, key) {
  const buf = Buffer.from(text, 'latin1');
  for (let i = 0; i < buf.length; i++) buf[i] ^= key.charCodeAt(i % key.length);
  return buf.toString('base64');
}

test('xorDecode torna il testo originale', () => {
  const key = '7ff8f6ccb5a93f81833ac98b692133c7';
  const url = 'https://srv30.sake.streampeaker.org/_t/1795146290/abc/DDL/ANIME/OnePiece/1100/playlist.m3u8';
  assert.equal(xorDecode(xorEncode(url, key), key), url);
});

test('xorDecode con chiave corta ripete il pattern', () => {
  assert.equal(xorDecode(xorEncode('abcdef', 'k'), 'k'), 'abcdef');
});

test('parseWatchPage legge il link del primo server', () => {
  const payload = {
    animeName: 'One Piece',
    servers: [{ name: 'Stream', link: 'https://play.saturncdn.net/embed/64419?token=abc&expires=1795146283' }],
    initialVideoUrl: 'https://play.saturncdn.net/embed/1?token=zzz&expires=1',
  };
  const json = JSON.stringify(payload).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<div x-data="watchPage(${json})"></div>`;
  const data = parseWatchPage(html);
  assert.equal(data.servers[0].link, payload.servers[0].link);
  assert.equal(data.animeName, 'One Piece');
});

test('parseWatchPage segnala il markup cambiato', () => {
  assert.throws(() => parseWatchPage('<html></html>'), /watchPage/);
});

test('decodeEntities non decodifica due volte', () => {
  assert.equal(decodeEntities('&amp;quot;'), '&quot;');
  assert.equal(decodeEntities('&#039;'), "'");
});
