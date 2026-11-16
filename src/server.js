import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scan.js';
import { revive } from './revive.js';

const PAGE = readFileSync(fileURLToPath(new URL('./ui.html', import.meta.url)), 'utf8');
const THREE_ROOT = dirname(dirname(createRequire(import.meta.url).resolve('three')));
const VENDOR_DIRS = [join3('build'), join3('examples', 'jsm')];
function join3(...p) {
  return resolve(THREE_ROOT, ...p) + sep;
}
/** Map /vendor/three/<path> to a .js file inside three's build/ or examples/jsm/, nowhere else. */
function vendorFile(pathname) {
  const rel = decodeURIComponent(pathname.slice('/vendor/three/'.length));
  const file = resolve(THREE_ROOT, rel);
  if (!file.endsWith('.js') || !VENDOR_DIRS.some((d) => file.startsWith(d))) return null;
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

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
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:",
          'cache-control': 'no-store',
        });
        return res.end(PAGE.replace('__TOKEN__', token));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/vendor/three/')) {
        const body = vendorFile(url.pathname);
        if (!body) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=3600' });
        return res.end(body);
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
