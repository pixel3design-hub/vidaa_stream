// Risposte DNS minime per far credere alla TV di parlare con vidaahub.com.
// Funzioni pure: si testano senza rete, ed è il pezzo che si rompe in silenzio.

export function qname(buf) {
  const labels = [];
  let i = 12;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0 || (len & 0xc0) === 0xc0) break; // fine nome o compressione
    labels.push(buf.toString('latin1', i + 1, i + 1 + len));
    i += len + 1;
  }
  return labels.join('.').toLowerCase();
}

// offset subito dopo qtype + qclass
export function questionEnd(buf) {
  let i = 12;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) { i += 1; break; }
    if ((len & 0xc0) === 0xc0) { i += 2; break; }
    i += len + 1;
  }
  return i + 4;
}

/**
 * @param {Buffer} query
 * @param {{rcode?: number, answerIp?: string|null}} opts
 */
export function buildReply(query, { rcode = 0, answerIp = null } = {}) {
  const end = questionEnd(query);
  const head = Buffer.alloc(12);
  query.copy(head, 0, 0, 2);                  // stesso id
  head.writeUInt16BE(0x8180 | rcode, 2);      // risposta + RD/RA + rcode
  head.writeUInt16BE(1, 4);                   // qdcount
  head.writeUInt16BE(answerIp ? 1 : 0, 6);    // ancount

  const parts = [head, query.subarray(12, end)];

  if (answerIp) {
    const a = Buffer.alloc(16);
    a.writeUInt16BE(0xc00c, 0);               // nome: puntatore al quesito
    a.writeUInt16BE(1, 2);                    // A
    a.writeUInt16BE(1, 4);                    // IN
    a.writeUInt32BE(60, 6);                   // TTL
    a.writeUInt16BE(4, 10);                   // rdlength
    Buffer.from(answerIp.split('.').map(Number)).copy(a, 12);
    parts.push(a);
  }

  return Buffer.concat(parts);
}

export const NOERROR = 0;
export const NXDOMAIN = 3;

export function qtype(buf) {
  return buf.readUInt16BE(questionEnd(buf) - 4);
}
