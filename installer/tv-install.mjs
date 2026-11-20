// Installazione "una volta sola" dentro un container: risponde come vidaahub.com
// (DNS 53 + HTTPS 443), serve la pagina con il bottone Installa e, quando la pagina
// conferma l'installazione, esce. Con `docker run --rm` il container sparisce da solo.
import { createServer as createHttpsServer } from 'node:https';
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildReply, qname, qtype, NOERROR, NXDOMAIN } from './dns.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const log = (msg) => console.log(`[install] ${msg}`);

const APP_ID = process.env.APP_ID || 'vidaa_anime';
const APP_NAME = process.env.APP_NAME || 'Anime';
const TIMEOUT_S = Number(process.env.TIMEOUT || 900);

function detectIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '';
}

const IP = process.env.HOST_IP || detectIp();
const APP_URL = process.env.APP_URL || `http://${IP}:8099/tv`;
const ICON_URL = process.env.ICON_URL || APP_URL.replace(/\/tv$/, '/icon.png');

if (!IP) {
  log('nessun IP: passa HOST_IP=<ip della macchina che vedono le TV>');
  process.exit(2);
}
if (!process.env.HOST_IP && /^172\.(1[7-9]|2\d|3[01])\./.test(IP)) {
  log(`attenzione: ${IP} sembra l'indirizzo interno di Docker, la TV non ti raggiunge.`);
  log('dentro la rete bridge passa HOST_IP=<ip LAN della macchina>, oppure usa --network host');
}

// --- DNS ------------------------------------------------------------------------
const OUR_NAMES = new Set(['vidaahub.com', 'www.vidaahub.com']);

const udp = createSocket('udp4');
udp.on('error', (e) => {
  log(`DNS non disponibile su 53/udp: ${e.message}`);
  log('la porta 53 è libera? su Linux desktop systemd-resolved può occuparla');
  process.exit(2);
});
udp.on('message', (msg, rinfo) => {
  if (msg.length < 12) return;
  const name = qname(msg);
  const type = qtype(msg);
  let out;
  if (!OUR_NAMES.has(name)) out = buildReply(msg, { rcode: NXDOMAIN });
  else if (type === 1) out = buildReply(msg, { answerIp: IP, rcode: NOERROR });
  else out = buildReply(msg, { rcode: NOERROR }); // AAAA e altro: nessuna risposta
  udp.send(out, rinfo.port, rinfo.address);
});
udp.bind(53, () => log(`DNS su :53/udp, vidaahub.com -> ${IP}`));

// --- pagina ---------------------------------------------------------------------
const page = readFileSync(`${HERE}install.html`, 'utf8')
  .replaceAll('{{NAME}}', APP_NAME)
  .replaceAll('{{APPID}}', APP_ID)
  .replaceAll('{{URL}}', APP_URL)
  .replaceAll('{{ICON}}', ICON_URL);

let closed = false;
function finish(code, msg) {
  if (closed) return;
  closed = true;
  log(msg);
  setTimeout(() => process.exit(code), 100); // lascia uscire la risposta HTTP
}

const web = createHttpsServer(
  { key: readFileSync(`${HERE}vidaahub.key`), cert: readFileSync(`${HERE}vidaahub.crt`) },
  (req, res) => {
    if (req.method === 'POST' && req.url === '/done') {
      res.writeHead(204);
      res.end();
      return finish(0, 'installazione confermata dalla TV, esco');
    }
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('non trovato');
  },
);

web.on('error', (e) => {
  log(`HTTPS non disponibile su 443/tcp: ${e.message}`);
  process.exit(2);
});

web.listen(443, () => {
  log(`HTTPS su :443/tcp, app: ${APP_URL}`);
  log(`sulla TV: Impostazioni > Rete > DNS = ${IP}, poi browser su https://vidaahub.com/`);
  log(`attendo l'installazione (max ${TIMEOUT_S}s), poi esco da solo`);
});

setTimeout(() => finish(2, 'tempo scaduto: nessuna installazione ricevuta'), TIMEOUT_S * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => finish(0, `ricevuto ${sig}, esco`));
