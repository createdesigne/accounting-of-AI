import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Serve only built public assets. Never expose the repository or .env files.
export function createStaticHandler(directory) {
  const root = resolve(directory);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (req.url === '/') { res.writeHead(302, { Location: '/accounting-of-AI/' }); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local.invalid').pathname); } catch { res.writeHead(400); res.end(); return; }
    const base = '/accounting-of-AI/';
    if (!pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep) || relative.split(/[\\/]/).some(part => part.startsWith('.'))) { res.writeHead(404); res.end(); return; }
    try {
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404); res.end(); }
  };
}
