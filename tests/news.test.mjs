// Il parser del carosello "Ultime uscite": il markup cambia, quindi si prova con un fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatest } from '../animesaturn.mjs';

const card = (slug, ep, titolo, poster) => `
  <a href="/episode/${slug}/ep-${ep}" class="ac group">
    <div class="ac__poster"><img src="https://img.saturncdn.net/${poster}.png" alt="${titolo}"></div>
    <span class="ac__ep-badge">EP ${ep}</span>
    <div class="ac__caption"><h3 class="ac__title">${titolo}</h3><p class="ac__sub">Episodio ${ep}</p></div>
  </a>`;

const home = `<html><body>
  <section><h2>Altro</h2><a href="/anime/qualcos-altro-x1y2" class="card">non è una card del rail</a></section>
  <div class="rail" data-latest-rail>
    ${card('aoashi-season-2-WsCjw', 8, 'Ao Ashi 2', 'locandine/aaa')}
    ${card('ranma-2024-abc12', 3, 'Ranma ½ (2024)', 'locandine/bbb')}
    ${card('aoashi-season-2-WsCjw', 8, 'Ao Ashi 2', 'locandine/aaa')}
    ${card('naruto-jrXDE', 1, 'Naruto', 'locandine/ccc')}
  </div>
</body></html>`;

test('legge le card del rail con titolo, poster ed episodio', () => {
  const out = parseLatest(home);
  assert.equal(out.length, 3, 'la card duplicata va scartata');
  assert.deepEqual(out[0], {
    slug: 'aoashi-season-2-WsCjw',
    ep: 8,
    title: 'Ao Ashi 2',
    poster: 'https://img.saturncdn.net/locandine/aaa.png',
    url: 'https://www.animesaturn.net/anime/aoashi-season-2-WsCjw/ep-8',
  });
  assert.equal(out[1].ep, 3);
  assert.equal(out[2].slug, 'naruto-jrXDE');
});

test('rispetta il limite richiesto', () => {
  assert.equal(parseLatest(home, 2).length, 2);
});

test('senza il marcatore del rail si arrangia su tutta la pagina', () => {
  const senzaRail = home.replace('data-latest-rail', 'data-altro');
  assert.equal(parseLatest(senzaRail).length, 3);
});

test('pagina senza card: lista vuota, non un errore', () => {
  assert.deepEqual(parseLatest('<html><body><p>niente</p></body></html>'), []);
});

test('titoli con entità html decodificate', () => {
  const out = parseLatest(`<div data-latest-rail>${card('x-y', 1, 'Kaguya-sama &amp; love', 'p')}</div>`);
  assert.equal(out[0].title, 'Kaguya-sama & love');
});
