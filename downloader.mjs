// Coda di download: un solo comando ffmpeg copre sia m3u8 sia mp4 diretto.
// Il Referer lo mettiamo noi negli header dell'input: è l'unica cosa che il CDN pretende.
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve as resolveStream, REFERER, UA } from './animesaturn.mjs';
import { episodePath } from './library.mjs';

const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const HEADERS = `Referer: ${REFERER}\r\nUser-Agent: ${UA}\r\n`;

const jobs = new Map(); // "<slug>:<ep>" -> job
const procs = new Map(); // key -> processo ffmpeg in corso
let running = 0;

export const queue = () => [...jobs.values()];

// true se l'episodio è già in coda o in download (per non riaccodarlo)
export const isActive = (slug, ep) => {
  const j = jobs.get(key(slug, Number(ep)));
  return !!j && (j.state === 'queued' || j.state === 'running');
};

const key = (slug, ep) => `${slug}:${ep}`;

export function enqueue(slug, episodes) {
  let added = 0;
  for (const ep of episodes) {
    const n = Number(ep);
    const k = key(slug, n);
    const j = jobs.get(k);
    if (j && j.state !== 'error') continue;
    jobs.set(k, { key: k, slug, ep: n, state: 'queued', pct: 0, error: null });
    added++;
  }
  pump();
  return added;
}

export function forget(slug, ep) {
  cancel(slug, ep);
  jobs.delete(key(slug, Number(ep)));
}

// annulla un job in coda o in corso: il .part viene buttato via
function cancel(slug, ep) {
  const j = jobs.get(key(slug, Number(ep)));
  if (!j) return;
  if (j.state === 'queued' || j.state === 'running') {
    j.state = 'cancelled';
    procs.get(j.key)?.kill('SIGKILL');
  }
}

function pump() {
  for (const job of jobs.values()) {
    if (running >= CONCURRENCY) return;
    if (job.state !== 'queued') continue;
    running++;
    job.state = 'running';
    run(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(job) {
  const out = episodePath(job.slug, job.ep);
  const tmp = `${out}.part`;
  try {
    if (await exists(out)) {
      job.state = 'done';
      job.pct = 100;
      return;
    }
    await mkdir(dirname(out), { recursive: true });
    const { src } = await resolveStream(job.slug, job.ep);
    const total = await duration(src);
    await transcode(src, tmp, job, total);
    procs.delete(job.key);
    if (job.state === 'cancelled') return;
    await rename(tmp, out);
    job.state = 'done';
    job.pct = 100;
  } catch (e) {
    procs.delete(job.key);
    await unlink(tmp).catch(() => {});
    if (job.state === 'cancelled') return;
    job.state = 'error';
    job.error = String(e.message || e).slice(0, 300);
  }
}

const exists = async (p) => { try { return (await stat(p)).size > 0; } catch { return false; } };

const fmtDur = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '?');

function duration(src) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-headers', HEADERS,
      '-show_entries', 'format=duration', '-of', 'csv=p=0', src,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const d = parseFloat(out.trim());
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    });
  });
}

function transcode(src, out, job, total) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-headers', HEADERS,
      '-i', src,
      '-c', 'copy', '-movflags', '+faststart',
      '-f', 'mp4', // il file temporaneo finisce in .part: senza -f ffmpeg non sceglie il muxer
      '-progress', 'pipe:1', '-nostats',
      out,
    ]);
    let err = '';
    let buf = '';
    procs.set(job.key, p);
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) {
        // out_time_us è in microsecondi (out_time_ms è lo stesso valore, nome fuorviante)
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
        if (m && total) job.pct = Math.min(99, Math.round((Number(m[1]) / 1e6 / total) * 100));
      }
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-1200); });
    p.on('error', (e) => reject(new Error(`ffmpeg non avviato: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exit ${code}: ${err.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
    });
  });
}

export { fmtDur };
