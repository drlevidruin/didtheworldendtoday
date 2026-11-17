// npm run serve
//
// A tiny static server for looking at dist/ on this machine. No dependencies.
//   http://127.0.0.1:8787/                      the site at the root of a domain
//   http://127.0.0.1:8787/didtheworldendtoday/  the same files inside a subfolder,
//                                               which is how GitHub Pages serves a
//                                               project site, to prove that every
//                                               link is relative
// A missing page gets dist/404.html with a 404 status, as Pages does.
// Env: PORT (default 8787), HOST (default 127.0.0.1)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './lib/paths.mjs';

export const SUBFOLDER = '/didtheworldendtoday';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function insideDist(distDir, file) {
  const rel = path.relative(distDir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Maps a request path to what to send. Pure, so the tests can use it too.
// Returns { status, file, redirect? }. file is an absolute path inside distDir.
export function resolveStatic(distDir, rawPath, { prefix = SUBFOLDER } = {}) {
  let pathname = String(rawPath || '/').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400, file: null };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400, file: null };

  if (prefix && decoded === prefix) return { status: 301, redirect: `${prefix}/`, file: null };
  if (prefix && decoded.startsWith(`${prefix}/`)) decoded = decoded.slice(prefix.length);
  if (!decoded.startsWith('/')) decoded = `/${decoded}`;

  const wanted = path.normalize(path.join(distDir, decoded));
  const notFound = { status: 404, file: path.join(distDir, '404.html') };
  if (!insideDist(distDir, wanted)) return notFound;
  try {
    const stat = fs.statSync(wanted);
    if (stat.isDirectory()) {
      if (!decoded.endsWith('/')) return { status: 301, redirect: `${prefix && rawPath.startsWith(`${prefix}/`) ? prefix : ''}${decoded}/`, file: null };
      const index = path.join(wanted, 'index.html');
      if (fs.existsSync(index)) return { status: 200, file: index };
      return notFound;
    }
    return { status: 200, file: wanted };
  } catch {
    return notFound;
  }
}

export function createServer(distDir, options = {}) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const hit = resolveStatic(distDir, req.url, options);
    if (hit.redirect) {
      res.writeHead(hit.status, { Location: hit.redirect });
      res.end();
      return;
    }
    if (!hit.file || !fs.existsSync(hit.file)) {
      res.writeHead(hit.status || 404, { 'Content-Type': TYPES['.txt'] });
      res.end('Not found\n');
      return;
    }
    const body = fs.readFileSync(hit.file);
    res.writeHead(hit.status, {
      'Content-Type': TYPES[path.extname(hit.file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

function main() {
  const dist = path.join(REPO_ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('serve: dist/ is empty. Run npm run build first.');
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  createServer(dist).listen(port, host, () => {
    console.log(`serving dist at http://${host}:${port}/`);
    console.log(`and under     http://${host}:${port}${SUBFOLDER}/`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
