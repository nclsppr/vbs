'use strict';

/**
 * Offline tests for the local web interface.
 *
 * The real page and the real CLI run against test/mock-firebase.js, so nothing
 * here can reach the real party.
 *
 *   node test/web.test.js
 *   node test/web.test.js private
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const CLI = process.env.JUKORAMA_CLI ? path.resolve(process.env.JUKORAMA_CLI) : path.join(ROOT, 'jukorama.js');
const APP = path.dirname(CLI); // the copy under test: the sources, or the built folder
const MOCK = path.join(__dirname, 'mock-firebase.js');
const PARTY = '-P2mFuoFSfyjMXOzkmZW';
const ZOO = 'spotify-zoo';
const PROPER = 'spotify-proper';
const CHEATER = 'spotify-cheater';
// `others` is how many guests voted for the track. Nobody did for the last one,
// so it is known by name but not in the queue.
const TRACKS = {
  [ZOO]: { title: 'Zoo', artists: 'Kaaris', others: 22 },
  [PROPER]: { title: 'Proper Education - Radio Edit', artists: 'Eric Prydz, Floyd', others: 3 },
  [CHEATER]: { title: "Cheater's Town", artists: 'Chris Isaak', others: 7 },
  'spotify-solo': { title: 'Lonely Road', artists: 'Nobody', others: 0 },
};
const QUEUED = Object.keys(TRACKS).filter((key) => TRACKS[key].others > 0);
// What the fake Spotify knows: every track above, by Spotify id.
const CATALOG = Object.fromEntries(
  Object.entries(TRACKS).map(([key, track]) => [key.replace(/^spotify-/, ''), { title: track.title, artists: track.artists }]),
);
// The address the fake Spotify gives for the 300 px cover of a track.
const coverAddress = (id) => `https://i.scdn.co/image/ab67616d00001e02${Buffer.from(id).toString('hex')}`;

const filter = process.argv.slice(2).join(' ').toLowerCase();

function assert(cond, message, extra) {
  if (!cond) {
    const detail = extra === undefined ? '' : `\n${JSON.stringify(extra).slice(0, 600)}`;
    throw new Error(message + detail);
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `read()` gives something true; fails with `what` otherwise. */
async function eventually(read, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    assert(Date.now() < end, `timed out waiting for ${what}`);
    await pause(40);
  }
}

function world() {
  return {
    tracks: Object.fromEntries(Object.entries(TRACKS).map(([key, track]) => [key, track.others])),
    accounts: [],
    votes: {},
    withdrawn: {},
  };
}

/**
 * Starts the television on a fresh data folder.
 *
 *   privateMode   launched by the private launcher
 *   savedProfile  a profile is already saved on this PC
 *   firstLaunch   no title cache yet
 *   catalog       what Spotify knows (titles and covers); without it Spotify is unreachable
 *   spotifyDelay  how long Spotify takes to answer, in ms
 */
function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jukorama-web-'));
  const stateFile = path.join(dir, 'server-state.json');
  const authFile = path.join(dir, 'auth.json');
  const indexFile = path.join(dir, 'tracks-index.json');
  if (!opts.firstLaunch) {
    fs.writeFileSync(
      indexFile,
      JSON.stringify({
        party: PARTY,
        tracks: Object.fromEntries(
          Object.entries(TRACKS).map(([key, track]) => [key, { title: track.title, artists: track.artists }]),
        ),
      }),
    );
  }
  let authBefore = null;
  const initial = world();
  if (opts.savedProfile) {
    initial.accounts.push('SAVED');
    authBefore = JSON.stringify(
      { uid: 'SAVED', refreshToken: 'rt.SAVED', idToken: 'id.SAVED.0', expiresAt: Date.now() + 3000e3 },
      null,
      2,
    );
    fs.writeFileSync(authFile, authBefore);
  }

  // Whatever the shell that runs the tests has set must not leak into a scenario.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(?:JUKORAMA|MOCK)_/i.test(name)) delete env[name];
  }
  env.JUKORAMA_PLAIN = '1';
  env.JUKORAMA_DATA_DIR = dir;
  env.JUKORAMA_PROXY_BOOTSTRAPPED = '1';
  env.JUKORAMA_WEB_NO_OPEN = '1';
  env.MOCK_STATE_FILE = stateFile;
  env.MOCK_WORLD = JSON.stringify(initial);
  if (opts.privateMode) env.JUKORAMA_PRIVATE = '1';
  if (opts.catalog) env.MOCK_CATALOG = JSON.stringify(opts.catalog);
  if (opts.spotifyDelay) env.MOCK_SPOTIFY_DELAY = String(opts.spotifyDelay);

  const child = spawn(process.execPath, ['-r', MOCK, CLI, 'web', '--port', '0'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not start\n${out}\n${err}`));
    }, 15000);
    const onData = () => {
      const match = out.match(/JUKORAMA_WEB http:\/\/127\.0\.0\.1:(\d+) ([a-f0-9]+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve({
        child,
        port: Number(match[1]),
        token: match[2],
        dir,
        stateFile,
        authFile,
        indexFile,
        authBefore,
      });
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${out}\n${err}`));
    });
  });

  return ready.then((session) => {
    session.output = () => out + err;
    return session;
  });
}

function stopped(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', resolve));
}

async function stop(session) {
  if (session.child.exitCode === null) {
    session.child.kill();
    await stopped(session.child);
  }
  fs.rmSync(session.dir, { recursive: true, force: true });
}

async function call(session, method, pathname, body, token = true) {
  const res = await fetch(`http://127.0.0.1:${session.port}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Jukorama-Token': session.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** A request with the headers a test wants, which fetch() does not allow to set. */
function raw(session, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: session.port, path: pathname, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

/** A cover as the page's <img> asks for it: no token. */
async function cover(session, query) {
  const res = await fetch(`http://127.0.0.1:${session.port}/api/cover?${query}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    cache: res.headers.get('cache-control'),
    width: isPng ? bytes.readUInt32BE(16) : null,
    error: isPng ? null : bytes.toString('utf8').slice(0, 200),
  };
}

function serverState(session) {
  return JSON.parse(fs.readFileSync(session.stateFile, 'utf8'));
}

const savedIndex = (session) => JSON.parse(fs.readFileSync(session.indexFile, 'utf8')).tracks;

/** Every file under `dir`, as paths from it with forward slashes. */
function filesUnder(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path.join(dir, entry.name), name) : [name];
  });
}

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mid': 'audio/midi',
};

/** Follows everything the page loads, starting from "/". Returns the paths. */
async function crawl(session) {
  const seen = new Set();
  const todo = ['/'];
  while (todo.length) {
    const pathname = todo.shift();
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    const res = await fetch(`http://127.0.0.1:${session.port}${pathname}`);
    assert(res.status === 200, `${pathname} is served`, res.status);
    const ext = pathname === '/' ? '.html' : path.extname(pathname);
    const type = (res.headers.get('content-type') || '').split(';')[0];
    assert(type === CONTENT_TYPES[ext], `${pathname} has the right content type`, type);
    const text = ['.html', '.css', '.mjs', '.json'].includes(ext) ? await res.text() : '';
    if (!text) await res.arrayBuffer();
    const found = (pattern) => [...text.matchAll(pattern)].map((match) => match[1]);
    if (ext === '.html') todo.push(...found(/(?:href|src)="(\/[^"#]+)"/g));
    if (ext === '.css') todo.push(...found(/url\(\s*["']?(\/[^"')]+)/g));
    if (ext === '.mjs') {
      todo.push(...found(/from '\.\/([\w-]+\.mjs)'/g).map((name) => `/js/${name}`));
      todo.push(...found(/'(\/(?:css|fonts|img|js|music)\/[^']+)'/g));
    }
    if (pathname === '/music/playlist.json') todo.push(...JSON.parse(text).map((entry) => `/music/${entry.file}`));
  }
  return seen;
}

const scenarios = [
  {
    name: 'web: the page is whole, self-contained and closed to other sites',
    async run() {
      const session = await start({ privateMode: true });
      try {
        const page = await fetch(`http://127.0.0.1:${session.port}/`);
        const html = await page.text();
        assert(html.includes(session.token), 'the page carries the api token');
        for (const marker of ['id="picture"', 'id="rows"', 'id="fader-snow"', 'id="power"']) {
          assert(html.includes(marker), `the television is on the page: ${marker}`);
        }
        const policy = page.headers.get('content-security-policy') || '';
        assert(policy.includes("default-src 'none'") && policy.includes("script-src 'self'"), 'the page only loads from here', policy);
        assert(!/<style[\s>]/i.test(html) && !/\sstyle=/i.test(html), 'no inline style, which the policy would drop');
        assert(!/<script(?![^>]*\ssrc=)/i.test(html) && !/\son[a-z]+=/i.test(html), 'no inline script, which the policy would drop');

        const served = await crawl(session);
        for (const needed of ['/js/main.mjs', '/js/covers.mjs', '/css/screen.css', '/music/playlist.json']) {
          assert(served.has(needed), `the page loads ${needed}`, [...served]);
        }
        // Text files are licences and credits: kept beside what they cover, loaded by nobody.
        const unused = filesUnder(path.join(APP, 'web')).filter(
          (file) => file !== '/index.html' && !file.endsWith('.txt') && !served.has(file),
        );
        assert(unused.length === 0, 'every file of the page is used by the page', unused);

        // A drawing that is used but not declared shows nothing, without a word.
        const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
        const drawings = [...html.matchAll(/<use href="#([^"]+)"/g)].map((match) => match[1]);
        const missing = drawings.filter((id) => !declared.has(id));
        assert(drawings.includes('logo-mark') && missing.length === 0, 'every drawing the page uses is declared in it', missing);

        // The page is Jukorama's own: the service it votes on is named nowhere in it.
        assert(/<title>Jukorama\b/.test(html), 'the page is called Jukorama', html.match(/<title>[^<]*/));
        const naming = filesUnder(path.join(APP, 'web')).filter((file) =>
          /festify/i.test(fs.readFileSync(path.join(APP, 'web', file), 'latin1')),
        );
        assert(naming.length === 0, 'no file of the page names the service behind it', naming);

        const local = `127.0.0.1:${session.port}`;
        assert((await raw(session, '/', { Host: local })) === 200, 'this machine gets the page');
        assert((await raw(session, '/', { Host: 'evil.example' })) === 403, 'another host name is refused');
        assert((await raw(session, '/', { Host: local, Origin: 'https://evil.example' })) === 403, 'another origin is refused');
        assert((await raw(session, '/', { Host: local, 'Sec-Fetch-Site': 'cross-site' })) === 403, 'a request sent by another site is refused');
        assert((await raw(session, '/../jukorama.js', { Host: local })) === 404, 'nothing outside the page folder is served');
        assert((await raw(session, '/js/..%2f..%2fjukorama.js', { Host: local })) === 404, 'not even with an encoded path');
        const denied = await call(session, 'GET', '/api/tracks', undefined, false);
        assert(denied.status === 401, 'the api needs the token of the page', denied);
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: first launch reads the titles, shows its progress and serves the covers',
    async run() {
      const session = await start({ firstLaunch: true, catalog: CATALOG, spotifyDelay: 300 });
      try {
        await call(session, 'POST', '/api/mode', { private: true });
        const booting = call(session, 'GET', '/api/boot');
        const during = await eventually(async () => {
          const { data } = await call(session, 'GET', '/api/progress');
          return data.progress && data.progress.total ? data.progress : null;
        }, 'the progress of the first reading');
        assert(during.step === 'index' && during.total === QUEUED.length, 'the page can say how many titles are being read', during);
        const boot = await booting;
        assert(boot.status === 200 && boot.data.party.tracks === QUEUED.length, 'the television starts', boot.data);
        const idle = await call(session, 'GET', '/api/progress');
        assert(idle.data.progress === null, 'nothing is in progress afterwards', idle.data);

        const rows = await call(session, 'GET', '/api/tracks');
        assert(rows.data.length === QUEUED.length && rows.data[0].title === 'Zoo' && rows.data[0].id === 'zoo', 'every title was found', rows.data);
        assert(savedIndex(session)[ZOO].image === coverAddress('zoo'), 'the cover address is kept with the title', savedIndex(session)[ZOO]);

        const small = await cover(session, 'id=zoo&size=small');
        assert(small.status === 200 && small.type === 'image/png' && small.width === 64, 'a row gets the small picture', small);
        assert(/max-age=\d+/.test(small.cache) && small.cache.includes('immutable'), 'the browser may keep it', small.cache);
        const full = await cover(session, 'id=zoo');
        assert(full.status === 200 && full.width === 300, 'the voting page gets the full picture', full);
        assert((await cover(session, 'id=nothere')).status === 404, 'a track Spotify does not know has no cover');
        assert((await cover(session, 'id=..%2Fx')).status === 400, 'an odd id is refused');
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: covers missing from an older title cache are found in the background and kept',
    async run() {
      const session = await start({ privateMode: true, catalog: CATALOG });
      try {
        assert(!savedIndex(session)[ZOO].image, 'the older cache has titles only');
        const boot = await call(session, 'GET', '/api/boot');
        assert(boot.status === 200, 'the television starts without waiting for pictures', boot.data);
        // The server rewrites the cache in place while this looks at it: a read
        // that falls in the middle of a write is simply made again.
        await eventually(() => {
          let saved;
          try {
            saved = savedIndex(session);
          } catch {
            return false;
          }
          return QUEUED.every((key) => saved[key].image);
        }, 'the cover address of every track of the queue in the title cache');
        assert(savedIndex(session)[ZOO].image === coverAddress('zoo'), 'the address is the 300 px picture', savedIndex(session)[ZOO]);
        assert(savedIndex(session)[ZOO].title === 'Zoo', 'the titles are still there', savedIndex(session)[ZOO]);
        const small = await cover(session, 'id=zoo&size=small');
        assert(small.status === 200 && small.width === 64, 'the picture is served', small);
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: private vote x5 then reset puts Zoo back to 22',
    async run() {
      const session = await start({ privateMode: true });
      try {
        const boot = await call(session, 'GET', '/api/boot');
        assert(boot.status === 200 && boot.data.mode === 'private', 'private launcher skips the mode gate', boot.data);
        assert(String(boot.data.party.name).includes('Offline'), 'party name comes from the server', boot.data);

        const denied = await call(session, 'POST', '/api/vote', { key: ZOO, count: 1 }, false);
        assert(denied.status === 401, 'a page without the token cannot vote', denied);

        const found = await call(session, 'GET', '/api/tracks?q=zoo');
        assert(found.data[0] && found.data[0].title === 'Zoo', 'search finds Zoo first', found.data);

        const voted = await call(session, 'POST', '/api/vote', { key: ZOO, count: 5 });
        assert(voted.status === 200 && voted.data.added === 5 && voted.data.total === 27, 'five votes land and the total is 27', voted.data);
        assert(voted.data.confirmed === true, 'the last vote is visible on the server', voted.data);

        const mine = await call(session, 'GET', '/api/me');
        assert(mine.data.sessionCount === 5 && mine.data.session[0].count === 5, 'mesvotes shows all 5', mine.data);
        assert(mine.data.session[0].total === 27 && mine.data.session[0].title === 'Zoo', 'mesvotes shows the live total', mine.data);

        const reset = await call(session, 'POST', '/api/reset', { confirm: 'reset' });
        assert(reset.data.removed === 5, 'reset removes the whole session', reset.data);
        assert(String(reset.data.message).includes('5 votes'), 'reset says how many', reset.data);
        assert(reset.data.totals[0].votes === 22 && reset.data.totals[0].queued, 'reset says the new total', reset.data.totals);

        const after = await call(session, 'GET', '/api/me');
        assert(after.data.sessionCount === 0, 'mesvotes is empty afterwards', after.data);

        const left = await call(session, 'POST', '/api/leave', { keep: true });
        assert(left.data.shutdown === true, 'leaving closes the television', left.data);
        await stopped(session.child);
        const server = serverState(session);
        assert(server.counts[ZOO] === 22, 'Zoo is back to 22', server.counts);
        const throwaways = Object.values(server.accounts).filter((account) => account.created === 'signUp');
        assert(throwaways.length === 5 && throwaways.every((account) => account.deleted), 'every throwaway account is erased', server.accounts);
        assert(!fs.existsSync(session.authFile), 'private mode writes no profile');
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: choosing private leaves the saved profile untouched',
    async run() {
      const session = await start({ savedProfile: true });
      try {
        const early = await call(session, 'POST', '/api/vote', { key: ZOO, count: 1 });
        assert(early.status === 409, 'voting waits until a mode is chosen', early);
        const chosen = await call(session, 'POST', '/api/mode', { private: true });
        assert(chosen.data.mode === 'private', 'the cabine can be chosen from the page', chosen.data);
        const tooMany = await call(session, 'POST', '/api/vote', { key: ZOO, count: 26 });
        assert(tooMany.status === 400, 'more than 25 is refused', tooMany.data);
        // Spotify cannot be reached here: the cover fails, and the vote does not wait for it.
        const noCover = cover(session, 'id=zoo&size=small');
        const voted = await call(session, 'POST', '/api/vote', { key: ZOO, count: 1 });
        assert(voted.data.added === 1 && voted.data.total === 23, 'one private vote counts', voted.data);
        const failed = await noCover;
        assert(failed.status === 502, 'a cover that cannot be fetched is an error the page can ask for again', failed);
        const left = await call(session, 'POST', '/api/leave', { keep: true });
        assert(left.data.shutdown === true, 'leave shuts down', left.data);
        await stopped(session.child);
        assert(fs.readFileSync(session.authFile, 'utf8') === session.authBefore, 'the saved profile file is byte for byte the same');
        const server = serverState(session);
        assert(server.counts[ZOO] === 23, 'the private vote stays when kept', server.counts);
        assert(server.myVotes[ZOO].length === 1 && !server.myVotes[ZOO].includes('SAVED'), 'the saved profile did not cast it', server.myVotes);
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: normal batch is profile plus throwaways, reset forgets the profile',
    async run() {
      const session = await start({ savedProfile: true });
      try {
        await call(session, 'POST', '/api/mode', { private: false });
        const detail = await call(session, 'GET', `/api/track?key=${ZOO}`);
        assert(detail.data.awareness.join(' ').includes('profil habituel'), 'the quantity warning is the same as the terminal', detail.data.awareness);
        const voted = await call(session, 'POST', '/api/vote', { key: ZOO, count: 3 });
        assert(voted.data.added === 3 && voted.data.total === 25, 'three votes reach 25', voted.data);
        const mine = await call(session, 'GET', '/api/me');
        assert(mine.data.profile.uid === 'SAVED', 'mesvotes still names the saved profile', mine.data.profile);
        assert(mine.data.profile.votes.some((row) => row.key === ZOO), 'the profile vote is listed', mine.data.profile);
        assert(mine.data.extras[0] && mine.data.extras[0].count === 2, 'the two extra votes are listed apart', mine.data.extras);
        const again = await call(session, 'GET', `/api/track?key=${ZOO}`);
        assert(again.data.awareness.join(' ').includes('déjà son vote'), 'voting again says the profile already voted', again.data.awareness);
        const reset = await call(session, 'POST', '/api/reset', { confirm: 'reset' });
        assert(reset.data.removed === 3 && reset.data.profileForgotten === true, 'reset removes all three and forgets the profile', reset.data);
        assert(reset.data.totals[0].votes === 22, 'the new total is 22', reset.data.totals);
        assert(!fs.existsSync(session.authFile), 'the profile file is gone before exit');
        const left = await call(session, 'POST', '/api/leave', { keep: true });
        await stopped(session.child);
        assert(left.data.accountsDeleted === 2, 'the throwaway accounts are erased on the way out', left.data);
        const server = serverState(session);
        assert(server.counts[ZOO] === 22, 'Zoo is back to 22', server.counts);
      } finally {
        await stop(session);
      }
    },
  },
  {
    name: 'web: withdrawing one title leaves the other in place',
    async run() {
      const session = await start({ savedProfile: true, catalog: CATALOG });
      try {
        await call(session, 'POST', '/api/mode', { private: false });
        await call(session, 'POST', '/api/vote', { key: ZOO, count: 2 });
        await call(session, 'POST', '/api/vote', { key: PROPER, count: 1 });
        const pulled = await call(session, 'POST', '/api/withdraw', { key: ZOO });
        assert(pulled.data.removed === 2, 'both of my Zoo votes go', pulled.data);
        assert(String(pulled.data.message).includes('2 votes'), 'the page is told how many', pulled.data);
        assert(pulled.data.totals[0].votes === 22, 'Zoo is back to the others', pulled.data.totals);
        const mine = await call(session, 'GET', '/api/me');
        assert(mine.data.profile.votes.some((row) => row.key === PROPER), 'Proper Education stays on the profile', mine.data);
        assert(!mine.data.profile.votes.some((row) => row.key === ZOO), 'Zoo is gone from the profile', mine.data.profile);
        // Asked for just before leaving: the address must not be lost with the server.
        assert((await cover(session, 'id=cheater&size=small')).status === 200, 'a cover is served on the way');
        const left = await call(session, 'POST', '/api/leave', { keep: true });
        await stopped(session.child);
        assert(savedIndex(session)[CHEATER].image === coverAddress('cheater'), 'cover addresses are saved when the television stops', savedIndex(session));
        const server = serverState(session);
        assert(server.counts[ZOO] === 22 && server.counts[PROPER] === 4, 'only Zoo was withdrawn', server.counts);
        assert(server.myVotes[PROPER].includes('SAVED'), 'the saved profile still holds Proper', server.myVotes);
        assert(left.data.profileUntouched === true, 'keeping the votes keeps the profile', left.data);
      } finally {
        await stop(session);
      }
    },
  },
];

const { extractCoverUrl, sizedCover } = require(path.join(APP, 'covers.js'));

/** What needs no server: reading a cover out of Spotify's page, and the carols. */
async function fileChecks() {
  const image = (name, width) => `{"url":"https://image-cdn-fa.spotifycdn.com/image/${name}","maxWidth":${width}}`;
  const html = '<script id="__NEXT_DATA__" type="application/json">'
    + '{"props":{"pageProps":{"state":{"data":{"entity":{"visualIdentity":{"image":['
    + `${image('ab67616d00004851aaaaaaaa', 64)},${image('ab67616d00001e02aaaaaaaa', 300)},${image('ab67616d0000b273aaaaaaaa', 640)}`
    + ']}}}}}}}</script>';
  const address = extractCoverUrl(html);
  assert(address === 'https://i.scdn.co/image/ab67616d00001e02aaaaaaaa', 'the 300 px cover is read from Spotify’s page', address);
  assert(sizedCover(address, true) === 'https://i.scdn.co/image/ab67616d00004851aaaaaaaa', 'a row gets the 64 px file', sizedCover(address, true));
  assert(sizedCover('https://i.scdn.co/image/ab67616d0000b273aaaaaaaa', false) === address, 'an address saved at 640 px is brought back to 300 px');
  assert(sizedCover('https://example.org/cover.jpg', true) === 'https://example.org/cover.jpg', 'another kind of address is left alone');

  const music = path.join(APP, 'web', 'music');
  const { parseMidi } = await import(pathToFileURL(path.join(APP, 'web', 'js', 'sound.mjs')).href);
  const credits = fs.readFileSync(path.join(music, 'CREDITS.txt'), 'utf8');
  const playlist = JSON.parse(fs.readFileSync(path.join(music, 'playlist.json'), 'utf8'));
  assert(playlist.length >= 5, 'there are several carols', playlist);
  for (const carol of playlist) {
    const file = fs.readFileSync(path.join(music, carol.file));
    const tune = parseMidi(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    assert(tune.notes.length > 30 && tune.length > 10, `${carol.file} is a melody the music box can play`, { notes: tune.notes.length, seconds: tune.length });
    assert(credits.includes(`${carol.file}  —  ${carol.name}`), `${carol.file} is credited under its name`, carol);
  }
}

async function main() {
  let failed = 0;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log(` ok   ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${name}`);
      const lines = String(err && err.stack ? err.stack : err).split('\n');
      console.log(`        x ${lines[0]}`);
      lines.slice(1, 6).forEach((line) => console.log(`          ${line}`));
    }
  };

  const chosen = scenarios.filter((scenario) => !filter || scenario.name.toLowerCase().includes(filter));
  if (!filter) await run('web: covers are read from Spotify’s page, and every carol plays', fileChecks);
  for (const scenario of chosen) await run(scenario.name, scenario.run);
  if (!chosen.length) {
    console.log('No web scenario matched.');
    process.exit(1);
  }
  if (failed) {
    console.log(`${failed} web scenario(s) failed.`);
    process.exit(1);
  }
  console.log(`All ${chosen.length + (filter ? 0 : 1)} web scenarios passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
