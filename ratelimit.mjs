// Rate limit verso AnimeSaturn: distanza minima tra le chiamate e rispetto del
// Retry-After dei 429. Puro: clock e sleep si iniettano nei test.

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gate(): risolve quando la chiamata può partire. Le chiamate si accodano perché
// `next` viene prenotato subito, prima di dormire.
export function createLimiter({ rateMs = 0, now = Date.now, sleep = realSleep } = {}) {
  let next = 0;
  return async function gate() {
    const t = now();
    const at = Math.max(t, next);
    next = at + Math.max(0, rateMs);
    if (at > t) await sleep(at - t);
  };
}

// secondi, data HTTP o niente
export function retryAfterMs(headers, now = Date.now) {
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
