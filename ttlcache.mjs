// Cache TTL minima con deduplica: due richieste uguali in volo condividono la stessa fetch.
// Serve a non martellare AnimeSaturn quando TV e browser aprono la stessa serie.
export function createTtlCache({ ttlMs = 60_000, now = () => Date.now() } = {}) {
  const voci = new Map();

  return {
    async get(key, load) {
      const v = voci.get(key);
      if (v && v.exp > now()) return v.promise; // scaduta no, in corso o già pronta sì
      const promise = Promise.resolve().then(load);
      voci.set(key, { promise, exp: now() + ttlMs });
      try {
        return await promise;
      } catch (e) {
        voci.delete(key); // un errore non deve restare in cache
        throw e;
      }
    },
    clear() {
      voci.clear();
    },
    get size() {
      return voci.size;
    },
  };
}
