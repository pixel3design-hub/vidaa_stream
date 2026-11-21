// Copia il corpo di una risposta remota nella risposta locale senza far morire il processo.
// La TV chiude la connessione spesso (pausa, seek, stop) e undici risponde "terminated":
// senza listener su 'error' diventa un'eccezione non gestita e il servizio cade.
import { Readable } from 'node:stream';

export function proxyBody(remote, res, { abort } = {}) {
  if (!remote.body) {
    res.end();
    return null;
  }

  const body = Readable.fromWeb(remote.body);
  const stop = () => {
    if (res.writableEnded) return; // finito normalmente, non c'e niente da abortire
    body.destroy();
    abort?.(new Error('client chiuso'));
  };

  // la TV se n'e andata: smettiamo di leggere dal CDN invece di scaricare a vuoto
  res.on('close', stop);
  res.on('error', stop);
  body.on('error', (e) => {
    abort?.(e);
    res.destroy();
  });

  body.pipe(res);
  return body;
}
