'use strict';

/**
 * Jukorama's local television: the browser face of one voting session.
 *
 * Bound to 127.0.0.1 on purpose: the page is this machine's voter, the same
 * way the terminal is. It is not a party other people join. Three checks keep
 * other websites out: the Host header must be this server, a browser that says
 * the request comes from another site is refused, and every action needs the
 * token printed into the page we serve.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WEB_DIR = path.join(__dirname, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mid': 'audio/midi',
};

// Everything the page loads comes from this server, so nothing else is allowed.
const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serve(session) {
  const token = crypto.randomBytes(16).toString('hex');
  const port = Number.isInteger(session.port) ? session.port : 4737;

  function send(res, status, body, type, extra = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(type ? body : JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': type || 'application/json; charset=utf-8',
      'Content-Length': payload.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    });
    res.end(payload);
  }

  function tokenOk(header) {
    const got = Buffer.from(String(header || ''));
    const expected = Buffer.from(token);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 100000) {
          reject(Object.assign(new Error('Requête trop grande.'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('JSON invalide.'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function staticFile(pathname) {
    const root = path.resolve(WEB_DIR);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return file;
  }

  /** True when the request can only come from the page this server served. */
  function fromOurPage(req, actualPort) {
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!hosts.includes(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (origin && !hosts.some((host) => origin === `http://${host}`)) return false;
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin' || site === 'none';
  }

  const api = {
    'GET /api/boot': () => session.boot(),
    'GET /api/progress': () => ({ progress: session.progress() }),
    'POST /api/mode': (url, body) => session.chooseMode(body.private),
    'GET /api/tracks': (url) => session.tracks((url.searchParams.get('q') || '').trim()),
    'GET /api/track': (url) => session.track(url.searchParams.get('key') || ''),
    'GET /api/me': () => session.me(),
    'POST /api/vote': (url, body) => session.vote(body.key, Number(body.count)),
    'POST /api/withdraw': (url, body) => session.withdraw(body.key),
    'GET /api/reset': () => session.previewReset(),
    'POST /api/reset': (url, body) => session.reset(body),
    'GET /api/leave': () => session.leavePreview(),
    'POST /api/leave': (url, body) => session.leave(body),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!fromOurPage(req, server.address().port)) {
      send(res, 403, { error: 'Origine refusée.' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      const file = staticFile(url.pathname);
      const type = file && TYPES[path.extname(file)];
      if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        send(res, 404, { error: 'Introuvable.' });
        return;
      }
      if (path.extname(file) === '.html') {
        const page = fs.readFileSync(file, 'utf8').replaceAll('__JUKORAMA_TOKEN__', token);
        send(res, 200, page, type, { 'Content-Security-Policy': PAGE_POLICY, 'X-Frame-Options': 'DENY' });
        return;
      }
      send(res, 200, fs.readFileSync(file), type);
      return;
    }

    // An <img> cannot send the token header. Covers are public pictures and
    // the checks above already refuse other sites, so they go without it.
    if (req.method === 'GET' && url.pathname === '/api/cover') {
      try {
        const image = await session.cover(url.searchParams.get('id') || '', url.searchParams.get('size') === 'small');
        if (!image) send(res, 404, { error: 'Pas de pochette.' });
        else send(res, 200, image.bytes, image.type, { 'Cache-Control': 'private, max-age=604800, immutable' });
      } catch (err) {
        send(res, err.status || 502, { error: err.message || 'Pochette illisible.' });
      }
      return;
    }

    if (!tokenOk(req.headers['x-jukorama-token'])) {
      send(res, 401, { error: 'Page inconnue.' });
      return;
    }
    const handler = api[`${req.method} ${url.pathname}`];
    if (!handler) {
      send(res, 404, { error: 'Introuvable.' });
      return;
    }

    try {
      const result = await handler(url, req.method === 'POST' ? await readBody(req) : {});
      send(res, 200, result);
      if (result && result.shutdown) {
        console.log('À la prochaine !');
        setTimeout(() => process.exit(0), 80);
      }
    } catch (err) {
      send(res, err.status || 500, { error: err.message || String(err) });
    }
  });

  // Stay pending until process.exit. Resolving on listen would let the
  // `--private` wrapper erase the session before anyone has voted.
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      const url = `http://127.0.0.1:${actual}`;
      // The first line is the contract the offline tests parse. Keep it stable.
      console.log(`JUKORAMA_WEB ${url} ${token}`);
      console.log('');
      console.log('  Télévision de Noël allumée.');
      console.log(`  ${url}`);
      console.log('  Laisse cette fenêtre ouverte : c’est elle qui vote.');
      console.log('  Pour effacer les profils jetables, éteins la télé depuis la page.');
      openBrowser(url);
    });
  });
}

function openBrowser(url) {
  if (process.env.JUKORAMA_WEB_NO_OPEN === '1') return;
  if (!process.stdin.isTTY) return;
  if (process.platform !== 'win32') return;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function stopOnSignal(session) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    session
      .leave({ keep: true })
      .catch(() => {})
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', stop);
  process.on('SIGBREAK', stop);
}

async function start(session) {
  stopOnSignal(session);
  await serve(session);
}

module.exports = { serve: start };
