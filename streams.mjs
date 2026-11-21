// Cache delle URL di streaming: AnimeSaturn le fa scadere, quindi chi le usa
// ricontrolla `expiresAt` e risolve di nuovo quando manca poco.
import { resolve } from './animesaturn.mjs';

const DEFAULT_MARGIN = 60_000;

export function createStreamCache({ fetcher = resolve, marginMs = DEFAULT_MARGIN, now = Date.now } = {}) {
  const entries = new Map(); // "<slug>:<ep>" -> {src, hls, expiresAt}
  const inflight = new Map();
  const keyOf = (slug, ep) => `${slug}:${Number(ep)}`;
  const stale = (e) => e.expiresAt != null && e.expiresAt - now() < marginMs;

  async function get(slug, ep, { force = false } = {}) {
    const k = keyOf(slug, ep);
    const hit = entries.get(k);
    if (!force && hit && !stale(hit)) return hit;
    // due richieste sulla stessa puntata aspettano la stessa risoluzione
    const pending = inflight.get(k);
    if (!force && pending) return pending;
    const p = Promise.resolve()
      .then(() => fetcher(slug, Number(ep)))
      .then((v) => { entries.set(k, v); return v; })
      .finally(() => { if (inflight.get(k) === p) inflight.delete(k); });
    inflight.set(k, p);
    return p;
  }

  function invalidate(slug, ep) {
    entries.delete(keyOf(slug, ep));
  }

  return { get, invalidate, entries };
}

// senza expiresAt l'URL vale finché qualcuno non la invalida (o il CDN la rifiuta)
export const streams = createStreamCache();
