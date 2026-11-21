// Misura il rate limit di AnimeSaturn: quanto si può andare prima del 429, cosa
// dichiara il Retry-After e quanto ci mette a riaprire. Non gira in CI.
//
//   node scripts/probe-ratelimit.mjs --max 12 --gap 300
import { SITE, UA } from '../animesaturn.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const MAX = Number(arg('max', 15));
const GAP = Number(arg('gap', 250));
const URL_BASE = arg('url', `${SITE}/api/search?q=`);

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1) + 's';

async function hit(n) {
  const url = `${URL_BASE}${encodeURIComponent('probe' + n + Math.random().toString(36).slice(2, 7))}`;
  const t0 = now();
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: `${SITE}/` },
    cache: 'no-store',
  });
  const body = await r.text().catch(() => '');
  return { status: r.status, ms: now() - t0, retryAfter: r.headers.get('retry-after'), body };
}

console.log(`probe ${URL_BASE} — max ${MAX}, gap ${GAP}ms\n`);

const latencies = [];
let blockedAt = null;   // numero di richiesta che ha preso 429/403
let declared = null;    // Retry-After dichiarato
let retriedAt = null;   // quando è tornato a rispondere

for (let n = 1; n <= MAX; n++) {
  if (n > 1) await sleep(GAP);
  const r = await hit(n);
  const tag = r.status === 200 ? 'ok ' : String(r.status);
  console.log(`#${String(n).padStart(2)} ${tag} ${Math.round(r.ms)}ms${r.retryAfter ? ` retry-after=${r.retryAfter}` : ''}`);
  if (r.status === 200) {
    latencies.push(r.ms);
    continue;
  }
  if (r.status === 403) {
    console.log("\n403 (Cloudflare): mi fermo subito, nessun'altra richiesta.");
    process.exit(2);
  }
  if (r.status === 429) {
    blockedAt = n;
    declared = r.retryAfter;
    break;
  }
  console.log(`\nstato inatteso ${r.status}: mi fermo.`);
  process.exit(1);
}

if (blockedAt) {
  // sonda ogni 5 s fino a 60 s: quanto dura davvero il blocco
  const t0 = now();
  for (let waited = 5000; waited <= 60000; waited += 5000) {
    await sleep(5000);
    const r = await hit('probe');
    console.log(`+${secs(now() - t0)} -> ${r.status}`);
    if (r.status === 200) { retriedAt = now() - t0; break; }
    if (r.status === 403) { console.log('403 durante l attesa: mi fermo.'); break; }
  }
}

console.log('\n--- riepilogo ---');
if (blockedAt) {
  console.log(`richieste prima del 429: ${blockedAt - 1}`);
  console.log(`retry-after dichiarato: ${declared ?? 'nessuno'}`);
  console.log(`recupero effettivo: ${retriedAt == null ? 'oltre 60s' : secs(retriedAt)}`);
} else {
  console.log(`nessun 429 in ${MAX} richieste a ${GAP}ms: il limite è più alto (o assente)`);
}
if (latencies.length) {
  console.log(`latenza media: ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`);
}
