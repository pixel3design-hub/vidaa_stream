// Configurazione persistente del player, in data/config.json. Un file, nessun DB.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { DATA } from './library.mjs';

const FILE = `${DATA}/config.json`;

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const MODES = ['bar', 'time', 'both'];

export const DEFAULTS = {
  player: {
    progress: {
      mode: 'bar',          // bar | time | both
      corner: 'bottom-left',
      visible: true,
      color: '#4f8cff',
      opacity: 80,          // 0-100
    },
  },
};

let current = structuredClone(DEFAULTS);

const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n))));
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : null);

// normalizza qualunque cosa arrivi (file vecchio, POST a mano) sui valori ammessi
export function sanitize(patch = {}) {
  const out = structuredClone(current);
  const p = patch.player?.progress || patch.progress || {};
  if (MODES.includes(p.mode)) out.player.progress.mode = p.mode;
  if (CORNERS.includes(p.corner)) out.player.progress.corner = p.corner;
  if (typeof p.visible === 'boolean') out.player.progress.visible = p.visible;
  const c = hex(p.color);
  if (c) out.player.progress.color = c;
  if (p.opacity !== undefined && Number.isFinite(Number(p.opacity))) {
    out.player.progress.opacity = clamp(p.opacity, 0, 100);
  }
  return out;
}

export async function load() {
  try {
    current = sanitize(JSON.parse(await readFile(FILE, 'utf8')));
  } catch {
    current = structuredClone(DEFAULTS);
  }
  return current;
}

export const get = () => current;

export async function save(patch) {
  current = sanitize(patch);
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2));
  await rename(tmp, FILE);
  return current;
}
