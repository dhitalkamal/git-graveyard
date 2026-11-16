import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan } from './scan.js';
import { revive } from './revive.js';

const PAGE = readFileSync(fileURLToPath(new URL('./ui.html', import.meta.url)), 'utf8');
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (k, v) => (v === Infinity ? null : v)));
};

/** Serve the cemetery for one repo. Loopback only; POST needs the per-run token. */
export function startServer(repo, { port = 4747 } = {}) {
  const token = randomBytes(16).toString('hex');
  let actualPort = port;

  const server = createServer((req, res) => {
    // block DNS-rebinding: only accept our own loopback host names
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) return json(res, 403, { error: 'bad host' });
    const url = new URL(req.url, `http://${host}`);

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
          'cache-control': 'no-store',
        });
        return res.end(PAGE.replace('__TOKEN__', token));
      }
      if (req.method === 'GET' && url.pathname === '/api/tombs') {
        const r = scan(repo);
        return json(res, 200, { repo: r.top, now: Date.now(), tombstones: r.tombstones });
      }
      if (req.method === 'POST' && url.pathname === '/api/revive') {
        if (req.headers['x-graveyard-token'] !== token) return json(res, 403, { error: 'bad token' });
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) req.destroy();
        });
        req.on('end', () => {
          try {
            const { id } = JSON.parse(body);
            if (typeof id !== 'string') return json(res, 400, { error: 'id required' });
            const r = revive(repo, id);
            json(res, 200, { branch: r.branch, file: r.file });
          } catch (e) {
            json(res, 400, { error: e.message });
          }
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${actualPort}/`, token });
    });
  });
}
