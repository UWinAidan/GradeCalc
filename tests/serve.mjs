/* Tiny static server for ui-check: serves ./site with the headers from site/_headers (so CSP violations show up as
 * console errors, the same as on Cloudflare). /api/* and /auth/* go to an optional handler (the Worker, later). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.png': 'image/png' };

function siteHeaders() {
  const out = {};
  for (const line of readFileSync(path.join(SITE, '_headers'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  delete out['Strict-Transport-Security'];  // plain http locally
  return out;
}

export function serve({ port = 0, api = null } = {}) {
  const headers = siteHeaders();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (api && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) return api(req, res);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, path.normalize(p));
    if (!file.startsWith(SITE) || p.includes('_headers')) { res.writeHead(404); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
