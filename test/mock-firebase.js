'use strict';

/**
 * In-memory stand-in for the two Google services the CLI talks to:
 *
 *   - Firebase Auth: anonymous sign-up, token refresh, account deletion;
 *   - the Realtime Database: party, tracks, votes, with the same ownership rule
 *     as the real one (an account can only write or delete its own vote).
 *
 * Preloaded with `node -r ./test/mock-firebase.js jukorama.js ...`, so the real
 * CLI runs unmodified but can never reach the network: any other URL throws.
 * On exit the final server state is written to MOCK_STATE_FILE for the driver.
 *
 * Knobs (environment):
 *   MOCK_WORLD              JSON: { tracks: {key: otherVoters}, accounts: [uid],
 *                           votes: {key: [uid]}, withdrawn: {key: [uid]} } —
 *                           the initial server state. A track is in the queue
 *                           as long as it holds at least one vote.
 *   MOCK_EXPIRES_IN         token lifetime in seconds. 120 means "already
 *                           expired" for the CLI, which forces a refresh on
 *                           every single use.
 *   MOCK_COUNT_LAG          how many requests a track's vote_count stays behind
 *                           after one of its votes changed (default 0). The
 *                           real counter is updated by a server-side trigger a
 *                           moment after the write, not by the write itself.
 *   MOCK_FAIL_VOTE_DELETES  the first N `DELETE /votes/...` answer 500.
 *   MOCK_THROW_ON           "METHOD /path-prefix": matching requests fail like
 *                           a dropped connection, MOCK_THROW_TIMES times (1),
 *                           after letting the first MOCK_THROW_SKIP through (0).
 *   MOCK_PROMPT_MARK        text appended to every question the CLI asks, so
 *                           the driver can rebuild a faithful transcript.
 *   MOCK_CATALOG            JSON: { spotifyId: { title, artists } }. When set,
 *                           Spotify's embed pages and cover pictures are
 *                           answered from it, so a first launch (no title
 *                           cache yet) and the covers can be tested offline.
 *   MOCK_SPOTIFY_DELAY      milliseconds each of those answers takes (0).
 *   MOCK_LATENCY            milliseconds every Firebase answer takes (0), to
 *                           watch progress bars move as on a real network.
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

const RTDB_HOST = 'festify-79b08.firebaseio.com';
const world = JSON.parse(process.env.MOCK_WORLD || '{}');
const expiresIn = String(process.env.MOCK_EXPIRES_IN || '3600');

const countLag = Number(process.env.MOCK_COUNT_LAG || 0);
let failVoteDeletes = Number(process.env.MOCK_FAIL_VOTE_DELETES || 0);
const throwOn = process.env.MOCK_THROW_ON || '';
let throwSkip = Number(process.env.MOCK_THROW_SKIP || 0);
let throwTimes = throwOn ? Number(process.env.MOCK_THROW_TIMES || 1) : 0;

const state = {
  accounts: new Map(), // uid -> { deleted, generation, created }
  votes: {}, // trackKey -> { uid: true }
  votesByUser: {}, // uid -> { trackKey: true }
  tracks: Object.keys(world.tracks || {}),
  signUps: 0,
  requests: 0,
};

// --- initial state ----------------------------------------------------------

for (const [key, others] of Object.entries(world.tracks || {})) {
  state.votes[key] = {};
  for (let i = 1; i <= others; i++) state.votes[key][`other-${key}-${i}`] = true;
}
for (const uid of world.accounts || []) {
  state.accounts.set(uid, { deleted: false, generation: 0, created: 'seed' });
}
for (const [key, uids] of Object.entries(world.votes || {})) {
  for (const uid of uids) {
    state.votes[key][uid] = true;
    (state.votesByUser[uid] = state.votesByUser[uid] || {})[key] = true;
  }
}
// Votes withdrawn from the web app stay behind as `false`: { trackKey: [uid] }.
for (const [key, uids] of Object.entries(world.withdrawn || {})) {
  for (const uid of uids) state.votes[key][uid] = false;
}

// --- helpers ----------------------------------------------------------------

function reply(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  };
}

function droppedConnection() {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNRESET', message: 'socket hang up' };
  return err;
}

/** uid behind an idToken, or null when the token or its account is no good. */
function uidOf(idToken) {
  const match = /^id\.(.+)\.(\d+)$/.exec(String(idToken || ''));
  if (!match) return null;
  const account = state.accounts.get(match[1]);
  // Stricter than the real service, which tolerates a deleted account's token
  // for a while: that makes any "erase the account, then touch its vote"
  // ordering mistake fail loudly here.
  if (!account || account.deleted) return null;
  return match[1];
}

function issue(uid) {
  const account = state.accounts.get(uid);
  account.generation++;
  return { idToken: `id.${uid}.${account.generation}`, refreshToken: `rt.${uid}` };
}

/** Votes really held on a track: only `true` entries count, as on the real server. */
function voteCount(key) {
  return Object.values(state.votes[key] || {}).filter((value) => value === true).length;
}

// --- the queue, as maintained by the server-side trigger ---------------------

// vote_count is not part of the vote write: a trigger recomputes it shortly
// afterwards, and drops the track from the queue once it has no vote left.
const published = {}; // trackKey -> vote_count as last published
const changedAt = {}; // trackKey -> number of the request that last changed its votes
for (const key of state.tracks) published[key] = voteCount(key);

function publishedCount(key) {
  const settled = changedAt[key] === undefined || state.requests - changedAt[key] > countLag;
  if (settled) published[key] = voteCount(key);
  return published[key];
}

const queued = (key) => state.tracks.includes(key) && publishedCount(key) > 0;

// --- Firebase Auth ----------------------------------------------------------

function identityToolkit(url, options) {
  const body = JSON.parse(options.body || '{}');

  if (url.pathname.endsWith('accounts:signUp')) {
    state.signUps++;
    const uid = `T${state.signUps}`;
    state.accounts.set(uid, { deleted: false, generation: 0, created: 'signUp' });
    const tokens = issue(uid);
    return reply(200, { localId: uid, expiresIn, ...tokens });
  }

  if (url.pathname.endsWith('accounts:delete')) {
    const uid = uidOf(body.idToken);
    if (!uid) return reply(400, { error: { message: 'INVALID_ID_TOKEN' } });
    state.accounts.get(uid).deleted = true;
    return reply(200, {});
  }

  return reply(404, { error: { message: 'unknown auth endpoint' } });
}

function secureToken(options) {
  const params = new URLSearchParams(String(options.body || ''));
  const match = /^rt\.(.+)$/.exec(params.get('refresh_token') || '');
  const account = match && state.accounts.get(match[1]);
  if (!account || account.deleted) return reply(400, { error: { message: 'TOKEN_EXPIRED' } });
  const tokens = issue(match[1]);
  return reply(200, {
    id_token: tokens.idToken,
    refresh_token: tokens.refreshToken,
    expires_in: expiresIn,
    user_id: match[1],
  });
}

// --- Realtime Database ------------------------------------------------------

function realtimeDatabase(method, url) {
  const uid = uidOf(url.searchParams.get('auth'));
  if (!uid) return reply(401, { error: 'Auth token is expired' });

  const parts = url.pathname
    .replace(/\.json$/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const [root, party, a, b] = parts;
  const denied = () => reply(401, { error: 'Permission denied' });

  if (root === 'parties' && method === 'GET') {
    return reply(200, {
      name: '27/11/2026 - Offline Test Party',
      short_id: '000000',
      country: 'LU',
      settings: { allow_anonymous_voters: true },
    });
  }

  if (root === 'tracks' && method === 'GET') {
    if (a) return reply(200, queued(a) ? { vote_count: publishedCount(a) } : null);
    const queue = state.tracks.filter(queued).map((k) => [k, { vote_count: publishedCount(k) }]);
    return reply(200, queue.length ? Object.fromEntries(queue) : null);
  }

  if (root === 'votes') {
    if (method === 'GET') {
      if (!a) {
        const nonEmpty = Object.entries(state.votes).filter(([, v]) => Object.keys(v).length);
        return reply(200, nonEmpty.length ? Object.fromEntries(nonEmpty) : null);
      }
      // Like the real database, an empty node reads as null.
      if (!b) return reply(200, Object.keys(state.votes[a] || {}).length ? state.votes[a] : null);
      const value = state.votes[a] ? state.votes[a][b] : undefined;
      return reply(200, value === undefined ? null : value);
    }
    // Writes: one vote at a time, and only under the caller's own uid.
    if (!a || !b || b !== uid || !state.tracks.includes(a)) return denied();
    if (method === 'PUT') {
      state.votes[a][uid] = true;
      changedAt[a] = state.requests;
      return reply(200, true);
    }
    if (method === 'DELETE') {
      if (failVoteDeletes > 0) {
        failVoteDeletes--;
        return reply(500, { error: 'Internal server error (injected)' });
      }
      delete state.votes[a][uid];
      changedAt[a] = state.requests;
      return reply(200, null);
    }
  }

  if (root === 'votes_by_user') {
    // /votes_by_user/<party>/<uid>/<trackKey>: own entries only, and the real
    // rules refuse deleting the whole per-user node.
    if (a !== uid || !b) return denied();
    if (method === 'PUT') {
      (state.votesByUser[uid] = state.votesByUser[uid] || {})[b] = true;
      return reply(200, true);
    }
    if (method === 'DELETE') {
      if (state.votesByUser[uid]) delete state.votesByUser[uid][b];
      return reply(200, null);
    }
    return denied();
  }

  return reply(404, { error: `no such path for ${method}: /${[root, party, a, b].filter(Boolean).join('/')}` });
}

// --- Spotify (titles and covers) ---------------------------------------------

const catalog = process.env.MOCK_CATALOG ? JSON.parse(process.env.MOCK_CATALOG) : null;
const spotifyDelay = Number(process.env.MOCK_SPOTIFY_DELAY || 0);
const latency = Number(process.env.MOCK_LATENCY || 0);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function binaryReply(type, bytes) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Spotify names the three sizes of an album picture by the start of the file
// name; the rest is the same for all three. Here that rest spells the track id.
const COVER_SIZES = { 64: 'ab67616d00004851', 300: 'ab67616d00001e02', 640: 'ab67616d0000b273' };
const coverName = (id, size) => `${COVER_SIZES[size]}${Buffer.from(id).toString('hex')}`;

function spotifyEmbed(url) {
  const id = url.pathname.split('/').pop();
  const track = catalog[id];
  if (!track) return { ...reply(404, {}), headers: { get: () => null } };
  const entity = {
    title: track.title,
    artists: String(track.artists || '').split(', ').filter(Boolean).map((name) => ({ name })),
    visualIdentity: {
      image: Object.keys(COVER_SIZES).map((size) => ({
        url: `https://image-cdn-fa.spotifycdn.com/image/${coverName(id, size)}`,
        maxWidth: Number(size),
        maxHeight: Number(size),
      })),
    },
  };
  const data = JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } });
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${data}</script></html>`;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => html };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

/** A square PNG file; `pixel(x, y)` gives the [red, green, blue] of each dot. */
function png(size, pixel) {
  const stride = size * 3 + 1; // each line starts with its filter byte (0: none)
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * stride + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB, no interlacing
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rgb(hue, saturation, lightness) {
  const spread = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - spread * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * A drawn cover, in its own colours for every track: a record on a striped
 * sleeve. It cannot be mistaken for the lettered tile the page shows while it
 * has no picture, so a look at the page tells whether covers really load. The
 * real ones are photographs; these are only stand-ins for an offline test.
 */
function spotifyImage(url) {
  const name = url.pathname.split('/').pop();
  const size = Number(Object.keys(COVER_SIZES).find((width) => name.startsWith(COVER_SIZES[width])));
  const id = size ? Buffer.from(name.slice(16), 'hex').toString() : '';
  if (!catalog[id]) return { ...reply(404, {}), headers: { get: () => null } };
  let seed = 0;
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  // Neighbouring ids must not get neighbouring colours.
  const hue = Math.imul(seed, 2654435761) >>> 24;
  const sleeve = [rgb(hue * 1.41, 0.75, 0.5), rgb(hue * 1.41, 0.75, 0.64)];
  const label = rgb(hue * 1.41 + 150, 0.9, 0.6);
  const grooves = [[20, 20, 24], [44, 44, 52]];
  const unit = size / 300;
  const bytes = png(size, (x, y) => {
    const radius = Math.hypot(x - size / 2, y - size / 2) / unit;
    if (radius < 8) return [245, 245, 245];
    if (radius < 48) return label;
    if (radius < 126) return grooves[Math.floor(radius / 7) % 2];
    return sleeve[Math.floor((x + y) / unit / 28) % 2];
  });
  return binaryReply('image/png', bytes);
}

// --- fetch replacement ------------------------------------------------------

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();
  state.requests++;

  if (throwTimes > 0 && `${method} ${url.pathname}`.startsWith(throwOn)) {
    if (throwSkip > 0) {
      throwSkip--;
    } else {
      throwTimes--;
      throw droppedConnection();
    }
  }

  const firebase = {
    'identitytoolkit.googleapis.com': () => identityToolkit(url, options),
    'securetoken.googleapis.com': () => secureToken(options),
    [RTDB_HOST]: () => realtimeDatabase(method, url),
  }[url.hostname];
  if (firebase) {
    if (latency) await pause(latency);
    return firebase();
  }
  if (catalog && (url.hostname === 'open.spotify.com' || url.hostname === 'i.scdn.co')) {
    if (spotifyDelay) await pause(spotifyDelay);
    return url.hostname === 'i.scdn.co' ? spotifyImage(url) : spotifyEmbed(url);
  }

  // Nothing else is allowed out: an offline test must stay offline.
  throw new Error(`offline test tried to reach ${url.origin}${url.pathname}`);
};

// --- transcript fidelity ----------------------------------------------------

// With piped input, a question and whatever gets printed next end up on the
// same line, which no real user ever sees. Mark the end of every question (the
// only writes that do not end with a line break) so the driver can put the
// typed answer and the line break back.
if (process.env.MOCK_PROMPT_MARK) {
  const mark = process.env.MOCK_PROMPT_MARK;
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const isQuestion = typeof chunk === 'string' && chunk !== '' && !chunk.endsWith('\n');
    return write(isQuestion ? chunk + mark : chunk, ...rest);
  };
}

// --- final state for the driver ---------------------------------------------

process.on('exit', () => {
  if (!process.env.MOCK_STATE_FILE) return;
  const mine = (uid) => !uid.startsWith('other-');
  const dump = {
    counts: Object.fromEntries(state.tracks.map((k) => [k, voteCount(k)])),
    // Votes held by accounts this run knows about (seeded or signed up).
    myVotes: Object.fromEntries(
      state.tracks.map((k) => [
        k,
        Object.keys(state.votes[k])
          .filter((uid) => state.votes[k][uid] === true && mine(uid))
          .sort(),
      ]),
    ),
    accounts: Object.fromEntries(
      [...state.accounts.entries()].map(([uid, a]) => [uid, { deleted: a.deleted, created: a.created }]),
    ),
    signUps: state.signUps,
    requests: state.requests,
  };
  fs.writeFileSync(process.env.MOCK_STATE_FILE, JSON.stringify(dump, null, 2));
});
