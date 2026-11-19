// Finestra scorrevole ("marching files"): tenere N episodi pronti a partire dal
// primo non ancora visto. Funzione pura: decide cosa mettere in coda, non tocca il disco.

/**
 * @param {{watched?: number[], total?: number, window?: number, rolling?: boolean}} state
 * @param {(ep: number) => boolean} have  già scaricato o già in coda
 * @returns {number[]} episodi da scaricare, in ordine
 */
export function planFill(state, have = () => false) {
  const { watched = [], total = 0, window = 0, rolling = false } = state;
  if (!rolling || window <= 0 || total <= 0) return [];

  const seen = new Set(watched);
  let next = 1;
  while (seen.has(next)) next++; // primo episodio non visto

  const out = [];
  let slots = 0;
  for (let ep = next; ep <= total && slots < window; ep++) {
    if (seen.has(ep)) continue; // i visti non occupano la finestra
    slots++;
    if (!have(ep)) out.push(ep);
  }
  return out;
}

// prossimo episodio da guardare (o null se finita)
export function nextUnwatched(state) {
  const { watched = [], total = 0 } = state;
  const seen = new Set(watched);
  for (let ep = 1; ep <= total; ep++) if (!seen.has(ep)) return ep;
  return null;
}
