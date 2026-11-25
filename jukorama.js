#!/usr/bin/env node
'use strict';

/**
 * Jukorama: vote for the songs of a Festify party, from a terminal or a browser.
 *
 * Festify is a plain Firebase Realtime Database app: the "backend" is the RTDB
 * plus security rules, so a vote is just two writes under the user's own uid:
 *
 *   /votes/<partyId>/<trackKey>/<uid>          = true
 *   /votes_by_user/<partyId>/<uid>/<trackKey>   = true
 *
 * A server-side rule keeps /tracks/<partyId>/<trackKey>/vote_count in sync.
 * Unvoting is the removal of both keys.
 *
 * Auth is anonymous Firebase Auth, which is exactly what the web app does for
 * guests when the party allows anonymous voters.
 *
 * Usage:
 *   node jukorama.js index                 build/refresh the track title cache
 *   node jukorama.js list [query]          show the queue (sorted by votes)
 *   node jukorama.js vote <title> [artist] cast a vote
 *   node jukorama.js unvote <title>        remove your vote
 *   node jukorama.js whoami                show the anonymous identity in use
 *   node jukorama.js party                 show party info and settings
 *   node jukorama.js web                   local browser UI for the same actions
 *
 * Run: node jukorama.js <command>
 */

const fs = require('fs');
const path = require('path');
const readline = require('node:readline');
const tls = require('node:tls');
const { execFileSync, spawnSync } = require('node:child_process');
const fx = require('./fx.js');
const { CrtScreen } = require('./crt.js');
const { extractCoverUrl } = require('./covers.js');

// Corporate proxies re-sign TLS traffic; trust the OS store so fetch() works.
if (typeof tls.setDefaultCACertificates === 'function') {
  try {
    tls.setDefaultCACertificates(tls.getCACertificates('system'));
  } catch {
    /* keep Node's bundled roots */
  }
}

// ---------------------------------------------------------------------------
// corporate proxy bootstrap
//
// Node's fetch() connects directly unless proxy support is enabled at startup
// (--use-env-proxy or NODE_USE_ENV_PROXY=1). Merely having HTTPS_PROXY in the
// environment is not enough, which is a silent trap: the request then times out
// against the real IPs instead of going through the proxy.
//
// So: if proxy support is not active yet, resolve a proxy URL (from the
// environment, else from the Windows registry where a double-clicked process
// still finds the system proxy) and re-exec once with proxy support enabled.
// ---------------------------------------------------------------------------

/** Is fetch() already configured to honour HTTPS_PROXY? */
function proxySupportActive() {
  if (process.execArgv.some((a) => a === '--use-env-proxy')) return true;
  return process.env.NODE_USE_ENV_PROXY === '1';
}

/** Read the Windows system proxy from the registry. */
function windowsProxyConfig() {
  if (process.platform !== 'win32') return null;

  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  let raw;
  try {
    raw = execFileSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true });
  } catch {
    return null;
  }

  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(raw)) return null;

  const serverMatch = raw.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
  if (!serverMatch) return null;

  // Formats seen in the wild: "host:8080" or "http=h:80;https=h:443".
  const serverSpec = serverMatch[1].trim();
  let proxyUrl = null;
  if (/=/.test(serverSpec)) {
    const parts = Object.fromEntries(
      serverSpec
        .split(';')
        .map((p) => p.split('='))
        .filter((p) => p.length === 2)
        .map(([k, v]) => [k.trim().toLowerCase(), v.trim()]),
    );
    proxyUrl = parts.https || parts.http || null;
  } else {
    proxyUrl = serverSpec;
  }
  if (!proxyUrl) return null;
  if (!/^[a-z]+:\/\//i.test(proxyUrl)) proxyUrl = `http://${proxyUrl}`;

  const overrideMatch = raw.match(/ProxyOverride\s+REG_SZ\s+(.+)/i);
  const noProxy = overrideMatch
    ? overrideMatch[1]
        .trim()
        .replace(/;\s*$/, '')
        .replace(/<local>/gi, 'localhost,127.0.0.1')
        .replace(/\*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(',')
    : 'localhost,127.0.0.1';

  return { proxyUrl, noProxy };
}

function bootstrapProxyIfNeeded() {
  if (process.platform !== 'win32') return;
  if (process.env.JUKORAMA_PROXY_BOOTSTRAPPED === '1') return;
  if (proxySupportActive()) return;

  // Prefer the environment (IT-configured), fall back to the registry.
  const fromEnv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const fromRegistry = windowsProxyConfig();

  const proxyUrl = fromEnv || (fromRegistry && fromRegistry.proxyUrl);
  if (!proxyUrl) return; // no proxy in play; a direct connection is intended

  const noProxy =
    process.env.NO_PROXY ||
    process.env.no_proxy ||
    (fromRegistry && fromRegistry.noProxy) ||
    'localhost,127.0.0.1';

  const result = spawnSync(
    process.execPath,
    // Keep any flags we were started with (e.g. --use-system-ca).
    [...process.execArgv, __filename, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        NO_PROXY: noProxy,
        no_proxy: noProxy,
        NODE_USE_ENV_PROXY: '1',
        JUKORAMA_PROXY_BOOTSTRAPPED: '1',
      },
    },
  );
  process.exit(result.status === null ? 1 : result.status);
}

bootstrapProxyIfNeeded();

const API_KEY = 'AIzaSyC0tcXd3VWzvFy-W8pHvZFpleyJHhHDowM';
const DB = 'https://festify-79b08.firebaseio.com';
const REFERER = 'https://festify.us/';
const DEFAULT_PARTY = '-P2mFuoFSfyjMXOzkmZW';

const DATA_DIR = process.env.JUKORAMA_DATA_DIR
  ? path.resolve(process.env.JUKORAMA_DATA_DIR)
  : path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const INDEX_FILE = path.join(DATA_DIR, 'tracks-index.json');
// Private mode keeps its throwaway identity in memory only: writing it to disk
// would recreate the very link between a machine and its votes we want to avoid.
// Mutable because --private turns it on at runtime, before any identity is read.
let PRIVATE_MODE = process.env.JUKORAMA_PRIVATE === '1';
// Scoped rotation inside an otherwise normal session: extra votes need throwaway
// accounts, but the saved profile must survive untouched. When this is on,
// loadAuth() sees nothing and saveAuth() writes nothing, so the file on disk is
// never clobbered by a throwaway account.
let EXTRAS_MODE = false;

/** Are we using an identity that must never touch the saved profile? */
function ephemeralIdentity() {
  return PRIVATE_MODE || EXTRAS_MODE;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {
    _: [],
    party: DEFAULT_PARTY,
    yes: false,
    dryRun: false,
    pick: null,
    refresh: false,
    private: PRIVATE_MODE,
    port: 4737,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--party') out.party = argv[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--refresh') out.refresh = true;
    else if (a === '--private') out.private = true;
    else if (a === '--pick') out.pick = Number(argv[++i]);
    else if (a === '--port') out.port = Number(argv[++i]);
    else out._.push(a);
  }
  return out;
}

/** fetch() wrapper that explains the most common local failure modes. */
async function http(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (err) {
    // Node hides the real reason in err.cause; surface it, because a bare
    // "fetch failed" is impossible to act on.
    const cause = err.cause || {};
    const detail = [cause.code, cause.message].filter(Boolean).join(': ');

    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(detail)) {
      throw new Error(
        `Certificat TLS refusé (${detail}).\n` +
          "Le script utilise déjà le magasin de certificats Windows.\n" +
          'Si le problème persiste, essaie : node --use-system-ca jukorama.js ...',
      );
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(detail)) {
      throw new Error(
        `Impossible de résoudre le nom de domaine (${detail}).\n` +
          'Vérifie ta connexion réseau ou que le proxy est disponible.',
      );
    }
    if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|EPROTO|UND_ERR_CONNECT_TIMEOUT/i.test(detail)) {
      const configured = process.env.HTTPS_PROXY || process.env.https_proxy;
      // The classic trap: a proxy is configured but Node is connecting directly,
      // which shows up as a timeout against the real server IPs.
      const proxyHint =
        configured && !proxySupportActive()
          ? `\nUn proxy est configuré (${configured}) mais Node ne l'utilise pas.\n` +
            'Relance avec : node --use-env-proxy jukorama.js ...'
          : configured
            ? `\nProxy utilisé : ${configured}`
            : '';
      throw new Error(
        `Connexion réseau impossible vers ${new URL(url).host} (${detail}).${proxyHint}`,
      );
    }
    throw new Error(`Échec réseau vers ${new URL(url).host} : ${detail || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// anonymous identity (same flow as the web app for guests)
// ---------------------------------------------------------------------------

function loadAuth() {
  if (ephemeralIdentity()) return null; // never read a persisted identity while rotating
  return readJson(AUTH_FILE, null);
}

function saveAuth(auth) {
  // Throwaway accounts live in memory only. The flag on the account matters as
  // much as the mode: such an account can still be refreshed later (undo,
  // erasure on exit) once the session is back on the saved profile.
  if (ephemeralIdentity() || (auth && auth.ephemeral)) return;
  writeJson(AUTH_FILE, auth);
}

async function signUpAnonymous() {
  const res = await http(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: REFERER,
        Origin: 'https://festify.us',
      },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${body.error?.message || res.status}`);
  const auth = {
    uid: body.localId,
    refreshToken: body.refreshToken,
    idToken: body.idToken,
    expiresAt: Date.now() + (Number(body.expiresIn) - 120) * 1000,
  };
  // Mark throwaway accounts for good, so they can never be persisted whatever
  // the mode is by the time their token gets refreshed.
  if (ephemeralIdentity()) auth.ephemeral = true;
  saveAuth(auth);
  // Private mode deletes these accounts on exit; keep track of every one created.
  if (privateSession.active) privateSession.accounts.push(auth);
  else if (EXTRAS_MODE) extras.accounts.push(auth);
  return auth;
}

/**
 * Delete the Firebase account itself (GDPR art. 17 erasure).
 *
 * Festify keeps no email or name for anonymous users, so the uid is the only
 * personal identifier that exists. Deleting the account means the votes can no
 * longer be attributed to anyone, even by Festify.
 */
async function deleteAccount(auth) {
  const res = await http(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: REFERER,
      Origin: 'https://festify.us',
    },
    body: JSON.stringify({ idToken: auth.idToken }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Suppression du compte refusée (${res.status}) : ${body.slice(0, 200)}`);
  }
}

async function refreshIdToken(auth) {
  const res = await http(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: REFERER,
      Origin: 'https://festify.us',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
  });
  const body = await res.json();
  if (!res.ok) {
    // A throwaway account that can no longer be refreshed must never be
    // replaced by a persisted one: outside the rotation modes, signing up here
    // would overwrite the saved profile.
    if (auth.ephemeral && !ephemeralIdentity()) throw new Error('Profil jetable expiré.');
    return signUpAnonymous();
  }
  const next = {
    ...auth,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in) - 120) * 1000,
  };
  saveAuth(next);
  return next;
}

let cachedAuth = null;

async function getIdToken() {
  if (!cachedAuth) cachedAuth = loadAuth();
  if (!cachedAuth) cachedAuth = await signUpAnonymous();
  if (Date.now() >= cachedAuth.expiresAt) cachedAuth = await refreshIdToken(cachedAuth);
  return cachedAuth.idToken;
}

async function getIdentity() {
  if (!cachedAuth) cachedAuth = loadAuth();
  if (!cachedAuth) cachedAuth = await signUpAnonymous();
  if (Date.now() >= cachedAuth.expiresAt) cachedAuth = await refreshIdToken(cachedAuth);
  return cachedAuth;
}

// ---------------------------------------------------------------------------
// Realtime Database access
// ---------------------------------------------------------------------------

async function db(method, dbPath, value, { retry = true } = {}) {
  const token = await getIdToken();
  const url = `${DB}${dbPath}.json?auth=${encodeURIComponent(token)}`;
  const options = { method };
  if (value !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(value);
  }
  const res = await http(url, options);
  if (res.status === 401 && retry) {
    cachedAuth = await refreshIdToken(cachedAuth);
    return db(method, dbPath, value, { retry: false });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`RTDB ${method} ${dbPath} -> ${res.status} ${text.trim()}`);
  return text ? JSON.parse(text) : null;
}

const trackKey = (spotifyId) => `spotify-${spotifyId}`;

// ---------------------------------------------------------------------------
// track title index
//
// The guest app cannot read /metadata (permission denied) and the queue only
// stores Spotify ids, so titles are resolved from the public Spotify pages and
// cached locally.
// ---------------------------------------------------------------------------

function metaTag(html, property) {
  const m = html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`));
  if (!m) return null;
  return decodeEntities(m[1]);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchTrackMeta(spotifyId, attempt = 0) {
  try {
    // The embed page ships its data as JSON in __NEXT_DATA__, which is more
    // reliable than scraping og: tags from the full web player page.
    const res = await http(`https://open.spotify.com/embed/track/${spotifyId}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    });

    if (res.status === 429) {
      // Spotify throttles aggressively; honour Retry-After and back off.
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt;
      throw new Error(`THROTTLED:${Math.min(waitMs, 30000)}`);
    }
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return { title: null, artists: null, error: `HTTP ${res.status}` };

    const html = await res.text();
    const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (raw) {
      const entity = JSON.parse(raw[1])?.props?.pageProps?.state?.data?.entity;
      if (entity?.title) {
        return {
          title: entity.title,
          artists: (entity.artists || []).map((a) => a.name).join(', ') || null,
          // Same page, so the web interface gets its cover for free.
          image: extractCoverUrl(html),
        };
      }
    }

    // Fallback: og: tags on the same page.
    const title = metaTag(html, 'og:title');
    if (title) {
      const desc = metaTag(html, 'og:description') || '';
      return { title, artists: desc.split('\u00b7')[0].trim() || null, image: extractCoverUrl(html) };
    }
    throw new Error('no track data in page');
  } catch (err) {
    const throttled = /^THROTTLED:(\d+)$/.exec(err.message);
    const maxAttempts = throttled ? 6 : 3;

    if (attempt < maxAttempts) {
      const waitMs = throttled ? Number(throttled[1]) : 500 * (attempt + 1);
      await sleep(waitMs);
      return fetchTrackMeta(spotifyId, attempt + 1);
    }
    if (throttled) return { title: null, artists: null, error: 'rate limited' };
    return { title: null, artists: null, error: err.message };
  }
}

/**
 * Album cover for a Spotify track, from the public embed page.
 *
 * Festify's own party screen shows this artwork beside every row. The queue
 * itself only stores the Spotify id, so the picture has to come from Spotify.
 * Returns null when Spotify has no picture for the track (callers keep a
 * generated cover) and throws when the page could not be read this time, so
 * that the caller asks again later instead of giving up on the cover.
 */
async function fetchTrackArt(spotifyId) {
  const meta = await fetchTrackMeta(spotifyId);
  if (meta.title) return meta.image || null;
  // "HTTP 404" and the like: Spotify no longer knows the track.
  if (/^HTTP 4\d\d$/.test(meta.error || '')) return null;
  throw new Error(`Cover lookup failed: ${meta.error || 'no answer'}`);
}

/**
 * Image bytes for a cover URL. The browser then loads them from us.
 * Null when there is no usable picture there; throws when it is worth asking again.
 */
async function fetchBinary(url) {
  const res = await http(url, { headers: { 'User-Agent': UA, Accept: 'image/*,*/*' } });
  if (res.status === 429 || res.status >= 500) throw new Error(`Cover download failed: HTTP ${res.status}`);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  // Photographs only: the page shows these bytes as coming from this server.
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 32 || bytes.length > 2000000) return null;
  return { type, bytes };
}

async function loadIndex() {
  return readJson(INDEX_FILE, { party: DEFAULT_PARTY, tracks: {} });
}

async function buildIndex(party, { force = false, quiet = false, onProgress = null } = {}) {
  const index = force ? { party, tracks: {} } : await loadIndex();
  if (index.party !== party) index.tracks = {};
  index.party = party;

  const queue = await db('GET', `/tracks/${party}`);
  if (!queue) throw new Error('That party has no tracks yet.');

  const ids = Object.keys(queue);
  const missing = ids
    .map((key) => ({ key, id: key.replace(/^spotify-/, '') }))
    .filter((t) => {
      if (force) return true;
      const cached = index.tracks[t.key];
      if (!cached) return true;
      if (cached.title) return false;
      // Retry previously failed lookups, unless they were rate limited very recently.
      return true;
    });

  if (!quiet) {
    console.log(`${ids.length} tracks in the queue, ${missing.length} to resolve.`);
  }

  let done = 0;
  const total = missing.length;
  let failed = 0;
  if (onProgress) onProgress(0, total); // the listener knows how many are coming before the first one is read

  async function worker() {
    while (missing.length) {
      const track = missing.shift();
      const meta = await fetchTrackMeta(track.id);
      if (meta.title) {
        index.tracks[track.key] = { id: track.id, title: meta.title, artists: meta.artists };
        if (meta.image) index.tracks[track.key].image = meta.image;
      } else {
        failed++;
        index.tracks[track.key] = { id: track.id, title: null, artists: null, error: meta.error };
      }
      done++;
      if (onProgress) onProgress(done, total);
      if (!quiet && done % 25 === 0) console.log(`  resolved ${done}/${total}`);
      writeJson(INDEX_FILE, index);
    }
  }

  await Promise.all(Array.from({ length: 3 }, () => worker()));
  writeJson(INDEX_FILE, index);
  if (!quiet) {
    console.log(`Index ready: ${Object.values(index.tracks).filter((t) => t.title).length} titled, ${failed} failed.`);
  }
  return index;
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTrack(track, query) {
  const q = norm(query);
  if (!q) return 0;
  const t = norm(track.title);
  const a = norm(track.artists || '');
  const both = `${t} ${a}`.trim();
  let score = 0;

  if (t === q) score = 1000;
  else if (t.startsWith(q)) score = 850;
  else if (t.includes(q)) score = 720;
  else if (both.includes(q)) score = 600;
  else {
    const qTokens = q.split(' ');
    const haystack = both.split(' ');
    const hits = qTokens.filter((tok) => haystack.includes(tok)).length;
    score = Math.round((500 * hits) / Math.max(1, qTokens.length));
  }

  // Artist-only input: "Chris Isaak"
  if (a && (a === q || a.includes(q))) score += 120;
  return score;
}

function rankMatches(index, queue, query) {
  const rows = [];
  for (const [key, track] of Object.entries(index.tracks)) {
    if (!track.title) continue;
    const queued = queue[key];
    if (!queued) continue;
    const score = scoreTrack(track, query);
    if (score <= 0) continue;
    rows.push({ key, ...track, score, voteCount: queued.vote_count || 0 });
  }
  rows.sort((x, y) => y.score - x.score || y.voteCount - x.voteCount);
  return rows;
}

// ---------------------------------------------------------------------------
// vote primitives
// ---------------------------------------------------------------------------

async function hasVoted(party, key, uid) {
  return (await db('GET', `/votes/${party}/${encodeURIComponent(key)}/${uid}`)) === true;
}

async function castVote(party, key) {
  const { uid } = await getIdentity();
  await db('PUT', `/votes/${party}/${encodeURIComponent(key)}/${uid}`, true);
  await db('PUT', `/votes_by_user/${party}/${uid}/${encodeURIComponent(key)}`, true);
}

async function removeVote(party, key) {
  const { uid } = await getIdentity();
  await db('DELETE', `/votes/${party}/${encodeURIComponent(key)}/${uid}`);
  await db('DELETE', `/votes_by_user/${party}/${uid}/${encodeURIComponent(key)}`);
}

/**
 * Uids currently voting for a track, read from the vote entries themselves.
 *
 * This is the ground truth behind a track's vote_count: the server derives that
 * counter from these entries a moment after each change, so right after a vote
 * or a withdrawal it can still show the previous number. Counting the entries
 * gives the figure the counter is about to settle on.
 */
async function votersOf(party, key) {
  const entries = (await db('GET', `/votes/${party}/${encodeURIComponent(key)}`)) || {};
  // The web app withdraws a vote by writing false, so only true entries count.
  return Object.keys(entries).filter((uid) => entries[uid] === true);
}

/**
 * All tracks the current identity has voted for, as track keys.
 *
 * /votes_by_user is the natural place, but its read is restricted, so scan the
 * public /votes node for entries carrying our uid. That is also the only view
 * that stays correct if the two nodes ever drift apart.
 */
async function myVotedKeys(party) {
  const { uid } = await getIdentity();
  return myVotedKeysFor(uid, party);
}

/** Same, for an explicit uid (needed when the account is about to be deleted). */
async function myVotedKeysFor(uid, party) {
  const votes = (await db('GET', `/votes/${party}`)) || {};
  return Object.keys(votes).filter((key) => votes[key] && votes[key][uid] === true);
}

/** Remove every vote of the current identity, and forget the identity itself. */
async function resetIdentity(party) {
  const { uid } = await getIdentity();
  const keys = await myVotedKeys(party);

  for (const key of keys) {
    await db('DELETE', `/votes/${party}/${encodeURIComponent(key)}/${uid}`);
    await db('DELETE', `/votes_by_user/${party}/${uid}/${encodeURIComponent(key)}`);
  }

  // Best effort: rules only permit writing individual children, so deleting the
  // whole per-user node is refused. The loop above already empties it, but this
  // clears anything a previous interrupted run left behind.
  try {
    await db('DELETE', `/votes_by_user/${party}/${uid}`);
  } catch {
    /* expected: node-level delete is not allowed */
  }
  return keys.length;
}

/** Delete the local identity file. Next run creates a fresh anonymous account. */
function forgetIdentity() {
  cachedAuth = null;
  // A throwaway identity has no file of its own: the one on disk belongs to the
  // saved profile, and forgetting a throwaway must never take it down with it.
  if (ephemeralIdentity()) return;
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
}

/**
 * Normal session: is there a saved profile, in memory or on disk?
 *
 * Worth asking before a lookup, because getIdentity() creates a profile when
 * there is none — and the only time there is none mid-session is right after a
 * reset, where a brand-new uid popping up would just be confusing.
 */
function hasSavedProfile() {
  return cachedAuth !== null || fs.existsSync(AUTH_FILE);
}

// ---------------------------------------------------------------------------
// private mode (GDPR-oriented)
//
// Festify stores no name or email for anonymous voters: the uid is the only
// personal identifier that exists, and it is what links a machine to its votes.
//
// Private mode therefore:
//   - creates a throwaway anonymous account for this run only,
//   - never writes it to disk (nothing to find on the machine afterwards),
//   - deletes the Firebase account on exit (art. 17 erasure).
//
// What remains in Festify is an opaque uid that no longer resolves to any
// account, so the vote can no longer be attributed — not even by Festify.
//
// Order matters: votes are removed first, because a deleted account's idToken
// stays accepted by the Realtime Database for a while (observed: a write with a
// deleted account's token still returned 200). Once the account is gone we can
// no longer authenticate as that uid, so any leftover vote would be stuck
// forever — unremovable by us and by Festify's guest-facing rules.
//
// The honest trade-off: deleting the account also means the vote can no longer
// be changed or withdrawn later, and a brand-new identity cannot be checked
// against earlier votes. That is exactly why private mode is opt-in and is
// described as "one session, one vote" rather than "a fresh vote every time".
// ---------------------------------------------------------------------------

const privateSession = {
  active: PRIVATE_MODE,
  accounts: [], // anonymous accounts created here, deleted on exit
  closed: false,
};

// Every vote cast during this run, in both modes: { key, auth, throwaway }.
//   - private mode: all of them come from throwaway accounts;
//   - normal mode: the saved profile's own vote (throwaway: false) plus the
//     extra ones cast from throwaway accounts.
// This is the single source of truth for "what did I do in this session": the
// status bar, mesvotes, reset and the exit recap all read it, so they cannot
// contradict each other. An entry leaves it only once its vote is really gone
// from the server.
const sessionVotes = [];

// Throwaway accounts used for extra votes inside an otherwise normal session.
// Kept separate from privateSession because the saved profile stays in charge of
// the first vote, and its votes must never be touched.
const extras = {
  active: false,
  accounts: [], // created for votes beyond the first, erased on exit
  closed: false,
};

/** Force the next identity lookup to create a brand-new anonymous account. */
function rotateIdentity() {
  if (!privateSession.active && !EXTRAS_MODE && !PRIVATE_MODE) return;
  cachedAuth = null;
}

function recordSessionVote(key, auth, { throwaway }) {
  // Remember which account cast it: a vote can only be withdrawn by the account
  // that owns it, and rotation gives every extra vote its own account.
  sessionVotes.push({ key, auth, throwaway });
}

/** Votes cast this session for one track, all accounts combined. */
function sessionVoteCount(key) {
  return sessionVotes.filter((vote) => vote.key === key).length;
}

/** Session votes held by throwaway accounts, optionally for one track only. */
function throwawayVotes(key = null) {
  return sessionVotes.filter((vote) => vote.throwaway && (key === null || vote.key === key));
}

/** [trackKey, count] pairs, biggest first, for recaps. */
function tally(votes) {
  const counts = new Map();
  for (const vote of votes) counts.set(vote.key, (counts.get(vote.key) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Drop ledger entries once their votes are gone from the server. */
function forgetSessionVotes(entries) {
  for (const entry of entries) {
    const i = sessionVotes.indexOf(entry);
    if (i !== -1) sessionVotes.splice(i, 1);
  }
}

/** Best-effort title for a track key, for session recaps. */
async function titleFor(key) {
  try {
    const index = await loadIndex();
    const meta = index.tracks[key];
    if (meta && meta.title) return `${meta.title}${meta.artists ? ` \u2014 ${meta.artists}` : ''}`;
  } catch {
    /* fall through */
  }
  return key;
}

// Shown before withdrawing several votes: each one takes a round trip or two,
// and a silent screen in the meantime looks like a hang.
const WITHDRAWING = '  Retrait en cours\u2026';

/**
 * Withdraw votes that this session cast from throwaway accounts.
 *
 * Each vote must be removed by the exact account that cast it: with identity
 * rotation every vote lives under a different uid, and one token cannot delete
 * another account's entry.
 *
 * Entries that are really gone leave the ledger; the ones that could not be
 * removed stay in it, so the session never claims a vote is withdrawn when it
 * is not. Returns both lists.
 */
async function undoVotes(party, entries) {
  const removed = [];
  const failed = [];
  const previousAuth = cachedAuth;
  const previousMode = EXTRAS_MODE;
  // Throwaway context: nothing below may read or overwrite the saved profile.
  EXTRAS_MODE = true;
  try {
    for (const entry of entries) {
      try {
        const auth =
          Date.now() >= entry.auth.expiresAt ? await refreshIdToken(entry.auth) : entry.auth;
        // A failed refresh hands back a brand-new account, which cannot touch
        // the old one's vote.
        if (auth.uid !== entry.auth.uid) throw new Error('throwaway account lost');
        entry.auth = auth;
        cachedAuth = auth;

        // /votes is the entry that counts: once it is gone the vote is gone,
        // even if tidying up the per-user mirror fails afterwards.
        await db('DELETE', `/votes/${party}/${encodeURIComponent(entry.key)}/${auth.uid}`);
        removed.push(entry);
        try {
          await db('DELETE', `/votes_by_user/${party}/${auth.uid}/${encodeURIComponent(entry.key)}`);
        } catch {
          /* cosmetic leftover only */
        }
      } catch {
        failed.push(entry);
      }
    }
  } finally {
    // Undoing votes does not change who the user is: go back to the identity
    // that was current before (the saved profile in a normal session).
    EXTRAS_MODE = previousMode;
    cachedAuth = previousAuth;
  }
  forgetSessionVotes(removed);
  return { removed, failed };
}

/**
 * Withdraw every vote of mine on one track: the ones this session cast from
 * throwaway accounts, and the saved profile's own in a normal session.
 */
async function withdrawMyVotesOn(party, key, profileHasVoted) {
  let removed = 0;
  let failed = 0;

  const extra = throwawayVotes(key);
  if (extra.length) {
    const result = await undoVotes(party, extra);
    removed += result.removed.length;
    failed += result.failed.length;
  }

  if (profileHasVoted) {
    try {
      await removeVote(party, key); // runs as the saved profile
      forgetSessionVotes(sessionVotes.filter((vote) => !vote.throwaway && vote.key === key));
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

/**
 * Say, per track, how many votes are left once some were withdrawn.
 *
 * Read back from the server rather than computed, so it is the number everyone
 * else sees too. Returns the party-wide total from those same reads (null if
 * they failed), which saves the status bar a second request.
 */
/**
 * Per-track totals after a change, counted from the vote entries themselves.
 *
 * `vote_count` on the queue lags behind the write, so it is not the number to
 * show. Also reports whether the track is still queued: Festify drops it once
 * its last vote is gone. Throws if the read fails; the caller decides what to
 * say.
 */
async function readTrackTotals(party, keys) {
  const unique = [...new Set(keys)];
  const queue = (await db('GET', `/tracks/${party}`)) || {};
  const totals = [];
  for (const key of unique) {
    totals.push({
      key,
      title: await titleFor(key),
      votes: (await votersOf(party, key)).length,
      queued: Boolean(queue[key]),
    });
  }
  const fresh = new Map(totals.map((row) => [row.key, row.votes]));
  const partyVotes = Object.entries(queue).reduce(
    (sum, [key, track]) => sum + (fresh.has(key) ? fresh.get(key) : track.vote_count || 0),
    0,
  );
  return { totals, partyVotes };
}

async function reportNewTotals(party, keys) {
  const unique = [...new Set(keys)];
  if (!unique.length) return null;

  let result;
  try {
    result = await readTrackTotals(party, unique);
  } catch {
    console.log('    (totaux illisibles pour le moment : tape liste pour les voir)');
    return null;
  }
  // Number first: the frame clips long lines, and with a long title it must be
  // the end of the title that gets cut, never the count.
  for (const row of result.totals) {
    // Festify drops a track from the queue once its last vote is withdrawn.
    if (!row.queued) console.log(`    Plus dans la file : ${row.title}`);
    else if (row.votes === 0) console.log(`    Plus aucun vote : ${row.title}`);
    else console.log(`    Maintenant ${row.votes} ${row.votes === 1 ? 'vote' : 'votes'} au total : ${row.title}`);
  }
  return result.partyVotes;
}

/**
 * End a private session: report what the user did, offer to undo it, then erase
 * the accounts.
 *
 * The votes are kept by default — casting them was the point. But the user is
 * told exactly what was cast and offered the chance to withdraw it, because
 * once the accounts are deleted those votes can no longer be removed by anyone.
 */
async function closePrivateSession(reason = 'sortie', reader = null) {
  if (!privateSession.active || privateSession.closed) return 0;
  privateSession.closed = true;

  // Recap: the user should see what they leave behind before deciding.
  const entries = tally(sessionVotes);
  if (entries.length) {
    console.log('');
    console.log('  Récapitulatif de la session :');
    for (const [key, n] of entries) {
      const title = await titleFor(key);
      const marker = n > 1 ? `  ← ${n} votes sur ce titre` : '';
      console.log(`    ${String(n).padStart(2)}×  ${title}${marker}`);
    }

    const repeated = entries.filter(([, n]) => n > 1);
    if (repeated.length) {
      console.log('');
      console.log(`  Tu as voté plusieurs fois pour ${repeated.length} titre(s).`);
    }

    // Once the accounts are gone, nobody can take these votes back. Offer the
    // choice while it is still possible.
    if (reader) {
      console.log('');
      const answer = await reader.ask('  Garder ces votes ? [O/n] ');
      if (isNo(answer)) {
        const keys = entries.map(([key]) => key);
        const total = sessionVotes.length;
        let removedCount = 0;
        if (total > 1) console.log(WITHDRAWING);
        for (;;) {
          // Whatever could not be removed stays in the ledger for the next try.
          const { removed, failed } = await undoVotes(DEFAULT_PARTY, [...sessionVotes]);
          removedCount += removed.length;
          if (!failed.length) break;
          // Last chance: after this the accounts are erased for good.
          const retry = await reader.ask(
            `  ${failed.length} vote(s) n\u2019ont pas pu être retirés. Réessayer ? [O/n] `,
          );
          if (retry === null || isNo(retry)) break;
        }
        console.log(`  J\u2019ai retiré ${removedCount} vote(s) sur ${total} avant suppression des comptes.`);
        if (sessionVotes.length) {
          console.log(`  Échec pour ${sessionVotes.length} vote(s) : ils resteront en place.`);
        }
        await reportNewTotals(DEFAULT_PARTY, keys);
      }
    }
  }

  // Listed only now: a failed token refresh during the undo may have created
  // one more throwaway account, and it must be erased like the others.
  const persisted = readJson(AUTH_FILE, null);
  const accounts = privateSession.accounts.filter(
    (auth) => auth && !(persisted && persisted.uid === auth.uid),
  );

  let deleted = 0;
  for (const auth of accounts) {
    try {
      if (Date.now() >= auth.expiresAt) {
        cachedAuth = await refreshIdToken(auth);
        await deleteAccount(cachedAuth);
      } else {
        await deleteAccount(auth);
      }
      deleted++;
    } catch {
      /* keep going: one failure must not block the others */
    }
  }

  if (deleted > 0) {
    console.log(`  ${deleted} compte(s) anonyme(s) supprimé(s).`);
    // Only talk about "these votes" when some are actually left behind.
    if (sessionVotes.length) console.log('  Plus aucun lien entre toi et ces votes.');
  }
  cachedAuth = null;
  return deleted;
}

/**
 * Erase the throwaway accounts used for extra votes in a normal session.
 *
 * Mirrors closePrivateSession's erasure step: the votes stay (casting them was
 * the point), but the accounts behind them are deleted so they can no longer be
 * attributed to anyone. The saved profile was never touched.
 */
async function closeExtras() {
  if (!extras.active || extras.closed || !extras.accounts.length) {
    EXTRAS_MODE = false;
    cachedAuth = null; // fall back to the saved profile on the next lookup
    return 0;
  }
  extras.closed = true;

  console.log('');
  console.log(
    `  ${extras.accounts.length} profil(s) jetable(s) utilisé(s) pour les votes en plus.`,
  );

  // Throwaway context: a token refreshed below must never land in the saved
  // profile's file.
  EXTRAS_MODE = true;
  let deleted = 0;
  for (const auth of [...extras.accounts]) {
    try {
      const live = Date.now() >= auth.expiresAt ? await refreshIdToken(auth) : auth;
      await deleteAccount(live);
      deleted++;
    } catch {
      /* keep going: one failure must not block the others */
    }
  }
  if (deleted > 0) {
    console.log(`  ${deleted} compte(s) jetable(s) supprimé(s).`);
  }
  // Not worth saying right after a reset, which forgets the profile on purpose.
  if (fs.existsSync(AUTH_FILE)) console.log('  Ton profil enregistré n\u2019a pas été modifié.');
  extras.accounts = [];
  EXTRAS_MODE = false;
  cachedAuth = null;
  return deleted;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function describe(row) {
  const votes = row.voteCount === 1 ? '1 vote' : `${row.voteCount} votes`;
  return `${row.title}${row.artists ? ` \u2014 ${row.artists}` : ''}  [${votes}]`;
}

async function cmdParty(args) {
  const party = await db('GET', `/parties/${args.party}`);
  if (!party) throw new Error('Party not found.');
  console.log(`Party        : ${party.name}`);
  console.log(`Code         : ${party.short_id}`);
  console.log(`Country      : ${party.country}`);
  console.log(`Anon voters  : ${party.settings?.allow_anonymous_voters ? 'allowed' : 'not allowed'}`);
  const tracks = (await db('GET', `/tracks/${args.party}`)) || {};
  const totalVotes = Object.values(tracks).reduce((s, t) => s + (t.vote_count || 0), 0);
  console.log(`Queue        : ${Object.keys(tracks).length} tracks, ${totalVotes} votes`);
  const { uid } = await getIdentity();
  console.log(`Your uid     : ${uid}`);
}

async function cmdWhoami() {
  const { uid } = await getIdentity();
  console.log(`Anonymous Festify identity: ${uid}`);
  console.log(`Stored in: ${AUTH_FILE}`);
}

async function cmdMyVotes(args) {
  const index = await loadIndex();
  const queue = (await db('GET', `/tracks/${args.party}`)) || {};
  const keys = await myVotedKeys(args.party);
  const { uid } = await getIdentity();

  if (!keys.length) {
    console.log(`Aucun vote pour ${uid} sur cette party.`);
    return;
  }

  const rows = keys
    .map((key) => {
      const meta = index.tracks[key] || {};
      return {
        key,
        title: meta.title || key,
        artists: meta.artists || '',
        voteCount: (queue[key] && queue[key].vote_count) || 0,
        stillQueued: Boolean(queue[key]),
      };
    })
    .sort((a, b) => b.voteCount - a.voteCount);

  console.log(`Votes de ${uid} (${rows.length}) :`);
  for (const row of rows) {
    const flag = row.stillQueued ? '' : '  [plus dans la file]';
    console.log(
      `  ${String(row.voteCount).padStart(3)}  ${row.title}${row.artists ? ` \u2014 ${row.artists}` : ''}${flag}`,
    );
  }
}

async function cmdReset(args) {
  const { uid } = await getIdentity();
  const keys = await myVotedKeys(args.party);

  if (args.dryRun) {
    console.log(`[dry-run] retirerait ${keys.length} vote(s) de ${uid} et oublierait cette identité.`);
    return;
  }

  const removed = await resetIdentity(args.party);
  console.log(`Reset effectué : ${removed} vote(s) retirés, identité ${uid} oubliée.`);
  // Read back before forgetting, so no new identity is created for the request.
  await reportNewTotals(args.party, keys);
  forgetIdentity();

  console.log('Au prochain lancement, un nouveau profil anonyme sera créé.');
  console.log("Tu peux donc revoter pour les mêmes chansons — à utiliser avec discernement.");
}

async function cmdIndex(args) {
  const index = await buildIndex(args.party, { force: args.refresh });
  console.log(`${Object.keys(index.tracks).length} entries cached in ${INDEX_FILE}`);
}

async function cmdList(args) {
  const query = args._.join(' ').trim();
  const index = await loadIndex();
  if (!index.tracks || index.party !== args.party || Object.keys(index.tracks).length === 0) {
    await buildIndex(args.party, { quiet: true });
    return cmdList(args);
  }
  const queue = (await db('GET', `/tracks/${args.party}`)) || {};
  const rows = Object.entries(index.tracks)
    .filter(([key, t]) => t.title && queue[key])
    .map(([key, t]) => ({ key, ...t, voteCount: queue[key].vote_count || 0 }))
    .filter((r) => !query || scoreTrack(r, query) > 0)
    .sort((a, b) => b.voteCount - a.voteCount || a.title.localeCompare(b.title));

  for (const row of rows) console.log(`${String(row.voteCount).padStart(3)}  ${row.title}${row.artists ? ` \u2014 ${row.artists}` : ''}`);
  console.log(`\n${rows.length} tracks${query ? ` matching "${query}"` : ''}.`);
}

async function resolveTarget(args) {
  const query = args._.join(' ').trim();
  if (!query) throw new Error('Missing track title. Example: vote "Cheater\'s Town" "Chris Isaak"');

  let index = await loadIndex();
  const queue = (await db('GET', `/tracks/${args.party}`)) || {};
  const cachedCount = Object.keys(index.tracks || {}).filter((k) => index.tracks[k].title).length;

  if (index.party !== args.party || cachedCount < Object.keys(queue).length) {
    index = await buildIndex(args.party, { quiet: false });
  }

  let matches = rankMatches(index, queue, query);

  if (matches.length === 0) {
    // Voting only works on tracks already in the queue, so tell the user what
    // exists nearby instead of failing silently.
    const near = rankMatches(index, Object.fromEntries(Object.keys(index.tracks).map((k) => [k, { vote_count: 0 }])), query)
      .slice(0, 5);
    let hint = '';
    if (near.length) {
      hint = `\nClosest titles currently known:\n${near.map((n) => `  - ${n.title}${n.artists ? ` \u2014 ${n.artists}` : ''}`).join('\n')}`;
    } else {
      const all = Object.values(index.tracks).filter((t) => t.title).slice(0, 5);
      hint = `\nExamples of what is in the queue:\n${all.map((n) => `  - ${n.title}${n.artists ? ` \u2014 ${n.artists}` : ''}`).join('\n')}`;
    }
    throw new Error(
      `No track in the queue matches "${query}". Festify only allows voting on tracks already in the queue, so add the song from the web app first (party ${args.party}).${hint}`,
    );
  }

  const top = matches[0];
  const runnerUp = matches[1];
  const confident = top.score >= 850 || (top.score >= 600 && (!runnerUp || top.score - runnerUp.score >= 120));

  if (args.pick !== null && Number.isFinite(args.pick)) {
    const chosen = matches[args.pick - 1];
    if (!chosen) throw new Error(`No candidate #${args.pick}.`);
    return chosen;
  }

  if (!confident && !args.yes) {
    console.log(`"${query}" is ambiguous, refusing to guess:\n`);
    matches.slice(0, 6).forEach((m, i) => console.log(`  ${i + 1}. ${describe(m)}`));
    console.log('\nRe-run with --pick <n> to choose one.');
    process.exitCode = 2;
    return null;
  }

  return top;
}

async function cmdVote(args) {
  const target = await resolveTarget(args);
  if (!target) return;
  const { uid } = await getIdentity();

  if (await hasVoted(args.party, target.key, uid)) {
    console.log(`Already voted for: ${describe(target)}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[dry-run] would vote for: ${describe(target)}`);
    return;
  }

  await castVote(args.party, target.key);

  // Read back the authoritative state instead of trusting the write.
  const voters = await votersOf(args.party, target.key);
  const confirmed = voters.includes(uid);
  const n = voters.length;
  console.log(`Vote OK: ${describe(target)}`);
  console.log(`Now ${n} ${n === 1 ? 'vote' : 'votes'} on this track, vote recorded for ${uid}: ${confirmed}`);
}

async function cmdUnvote(args) {
  const target = await resolveTarget(args);
  if (!target) return;
  const { uid } = await getIdentity();

  if (!(await hasVoted(args.party, target.key, uid))) {
    console.log(`You have no vote on: ${describe(target)}`);
    return;
  }
  if (args.dryRun) {
    console.log(`[dry-run] would remove vote on: ${describe(target)}`);
    return;
  }

  await removeVote(args.party, target.key);
  // Counted from the vote entries: the track itself leaves the queue when its
  // last vote goes, so there may be nothing left to read a counter from.
  const n = (await votersOf(args.party, target.key)).length;
  console.log(`Vote removed: ${describe(target)}`);
  console.log(`Now ${n} ${n === 1 ? 'vote' : 'votes'} on this track.`);
}

function usage() {
  console.log(
    [
      'Usage: node jukorama.js             (mode interactif, le plus simple)',
      '       node jukorama.js <command> [args]',
      '',
      '  party                          party info, settings and your uid',
      '  whoami                         show the anonymous identity in use',
      '  index [--refresh]              build the local track title cache',
      '  list [query]                   list the queue by vote count',
      '  vote <title> [artist]          vote for a track',
      '  unvote <title> [artist]        remove your vote',
      '  myvotes                        list the votes held by your identity',
      '  reset                          remove all your votes and forget your identity',
      '  web [--port n]                 local web interface (same actions, in the browser)',
      '',
      'Options: --party <id>  --pick <n>  --yes  --dry-run',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// interactive mode
//
// The launcher (Voter.cmd) starts this: no arguments to remember, no quoting.
// ---------------------------------------------------------------------------

/**
 * Input surface for the interactive loop.
 *
 * With a real terminal it returns a CrtScreen, so the whole session stays inside
 * the retro frame. Otherwise it falls back to plain readline, which keeps the
 * program usable when piped or in CI.
 */
function makeReader(options = {}) {
  if (CrtScreen.supported()) {
    const screen = new CrtScreen(options);
    return screen;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const iterator = rl[Symbol.asyncIterator]();

  return {
    plain: true,
    start() {},
    stop() {},
    log(...args) {
      console.log(...args);
    },
    flash(title, bodyLines = []) {
      console.log(`  ${title}`);
      for (const line of bodyLines) console.log(`  ${line}`);
    },
    banner(title, lines = []) {
      console.log(`  ${title}`);
      for (const line of lines) console.log(`  ${line}`);
    },
    clear() {},
    /** Print the prompt and wait for one line. Returns null at end of input. */
    async ask(question) {
      if (question) process.stdout.write(question);
      const { value, done } = await iterator.next();
      if (done) return null;
      return String(value).trim();
    },
    close() {
      rl.close();
    },
  };
}

// Tolerant on purpose: a stray space or an absent answer (end of input) must
// never be read as the opposite of what was typed.
const isYes = (s) => /^(o|oui|y|yes)$/i.test(String(s == null ? '' : s).trim());
const isNo = (s) => /^(n|non|no)$/i.test(String(s == null ? '' : s).trim());

/** 1-based rank of a track by vote count, counting strictly-higher tracks. */
function rankOf(queue, key, newCount) {
  let better = 0;
  for (const [k, t] of Object.entries(queue)) {
    const c = k === key ? newCount : t.vote_count || 0;
    if (c > newCount) better++;
  }
  return better + 1;
}

// Upper bound per command. Not a moral limit: each vote is a fresh anonymous
// account plus two database writes, so a typo like "500" would sit there for
// minutes. Repeating the command adds as many more as the user wants.
const MAX_BATCH = 25;

/**
 * Ask how many votes to cast for one track.
 *
 * The site cannot stop anyone from opening a private window and voting again, so
 * the program does not pretend otherwise: it lets the user pick the number and
 * states plainly what that does. Awareness, not gatekeeping.
 */
async function askVoteQuantity(
  reader,
  chosen,
  { sessionCount = 0, isPrivate = false, profileAlreadyVoted = false } = {},
) {
  console.log('');
  console.log(`  Combien de votes pour « ${chosen.title} » ?`);
  if (isPrivate) {
    console.log('  Chaque vote part d\u2019un profil anonyme neuf, comme si tu rouvrais');
    console.log('  une fen\u00eatre de navigation priv\u00e9e.');
  } else if (profileAlreadyVoted) {
    // The saved profile holds one vote per track, so every vote asked for here
    // is an extra one.
    console.log('  Ton profil habituel a d\u00e9j\u00e0 son vote ici : chaque vote en plus');
    console.log('  part d\u2019un profil jetable (comme une navigation priv\u00e9e). Ton');
    console.log('  profil enregistr\u00e9 n\u2019est pas modifi\u00e9, et ces profils jetables');
    console.log('  sont effac\u00e9s en quittant.');
  } else {
    console.log('  1 = ton profil habituel. Au-delà, les votes suppl\u00e9mentaires');
    console.log('  partent de profils jetables (comme une navigation priv\u00e9e) :');
    console.log('  ton profil enregistr\u00e9 n\u2019est pas modifi\u00e9 et ces comptes');
    console.log('  seront supprim\u00e9s en quittant.');
  }
  if (sessionCount) console.log(`  Tu en as déjà mis ${sessionCount} sur ce titre dans cette session.`);
  console.log(`  Entr\u00e9e = 1 vote, sinon un nombre de 1 \u00e0 ${MAX_BATCH}.`);

  const raw = await reader.ask('  Nombre de votes : ');
  if (raw === null) return 0;
  const trimmed = String(raw).trim();
  if (!trimmed) return 1;

  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    console.log('  Je n\u2019ai pas compris ce nombre, annul\u00e9.');
    return 0;
  }
  if (n > MAX_BATCH) {
    console.log(`  ${n} d\u2019un coup, c\u2019est long : plafonn\u00e9 \u00e0 ${MAX_BATCH} par commande.`);
    console.log('  Relance la commande pour en ajouter d\u2019autres.');
    return MAX_BATCH;
  }
  return n;
}

/**
 * Cast `wanted` votes for one queued track and record each one in the ledger.
 *
 * Shared by the terminal and the web page so the two cannot drift: the first
 * vote uses the current identity unless that identity already voted, and every
 * further vote rotates to a throwaway account. A normal session is put back on
 * the saved profile before this returns.
 */
async function castVotes(party, key, wanted, { firstNeedsThrowaway, onCast } = {}) {
  let added = 0;
  let lastUid = null;
  let error = null;
  try {
    for (let i = 0; i < wanted; i++) {
      const fresh = i > 0 || firstNeedsThrowaway;
      if (fresh) {
        // In a normal session this switches to throwaway identities: the saved
        // profile is neither read nor written until the batch is over.
        if (!privateSession.active) {
          EXTRAS_MODE = true;
          extras.active = true;
        }
        rotateIdentity();
      }

      // Always re-read the identity: after a rotation this is the new account,
      // and castVote() authenticates as whoever is current.
      const voter = await getIdentity();
      try {
        await castVote(party, key);
      } catch (err) {
        error = err.message || String(err);
        break;
      }
      // Every vote goes into the session ledger with the account that owns it:
      // that is what lets mesvotes and reset account for all of them later.
      recordSessionVote(key, voter, { throwaway: privateSession.active || fresh });
      lastUid = voter.uid;
      added++;
      if (onCast) onCast(added, wanted);
    }
  } finally {
    // A normal session always returns to the saved profile once the extra votes
    // are cast: mesvotes, reset and the next vote must act as that profile,
    // never as whichever throwaway account happened to vote last.
    if (!privateSession.active && EXTRAS_MODE) {
      EXTRAS_MODE = false;
      cachedAuth = null;
    }
  }
  return { added, lastUid, error };
}

/**
 * Run `fn` authenticated as `auth`, without letting that account touch the
 * saved profile. Used when the profile was just forgotten and a read still
 * needs some token that already exists.
 */
async function asAccount(auth, fn) {
  const previousAuth = cachedAuth;
  const previousMode = EXTRAS_MODE;
  EXTRAS_MODE = true;
  cachedAuth = auth;
  try {
    return await fn();
  } finally {
    EXTRAS_MODE = previousMode;
    cachedAuth = previousAuth;
  }
}

async function voteOneInteractively(reader, args) {
  const index = await loadIndex();
  const queue = (await db('GET', `/tracks/${args.party}`)) || {};
  const query = args._.join(' ').trim();

  const matches = rankMatches(index, queue, query);
  if (!matches.length) {
    console.log(`  Aucune chanson de la file ne correspond à « ${query} ».`);
    console.log("  Festify n'accepte un vote que sur une chanson déjà dans la file.");
    console.log('  Ajoute-la depuis le site, puis reviens ici.');
    return;
  }

  const top = matches[0];
  const runnerUp = matches[1];
  const confident =
    top.score >= 850 || (top.score >= 600 && (!runnerUp || top.score - runnerUp.score >= 120));

  let chosen = top;
  if (confident) {
    console.log(`  → ${describe(top)}`);
  } else {
    const shown = matches.slice(0, 8);
    console.log('  Plusieurs chansons correspondent :');
    shown.forEach((m, i) => console.log(`    ${i + 1}. ${describe(m)}`));
    const answer = await reader.ask(`  Numéro (1-${shown.length}, Entrée pour annuler) : `);
    if (answer === null || answer === '') {
      console.log('  Annulé.');
      return;
    }
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > shown.length) {
      console.log('  Choix invalide, annulé.');
      return;
    }
    chosen = shown[n - 1];
    console.log(`  → ${describe(chosen)}`);
  }

  // "My votes on this track" means the same thing in both modes: whatever this
  // session cast from throwaway accounts, plus the saved profile's own vote in a
  // normal session. Private mode has no saved profile and its identities are
  // disposable, so only the session ledger can answer the question there —
  // asking "did the current uid vote?" is what used to hide 4 votes out of 5.
  const profileHasVoted = privateSession.active
    ? false
    : await hasVoted(args.party, chosen.key, (await getIdentity()).uid);
  const mine = throwawayVotes(chosen.key).length + (profileHasVoted ? 1 : 0);

  // Set when the user already answered a "do you want to vote again?" prompt, so
  // this flow does not ask for the same confirmation twice.
  let confirmedByUser = false;

  // Already voted? Offer the reverse action instead of silently doing nothing.
  // Voting again is always possible: it goes through fresh throwaway accounts,
  // which is what reopening a private window would do.
  if (mine > 0) {
    console.log(
      mine === 1 ? '  Tu as déjà voté pour ce titre.' : `  Tu as déjà mis ${mine} votes sur ce titre.`,
    );
    // The options go to the scrollback and the prompt stays short, so nothing
    // gets clipped on a narrow window.
    console.log(
      `  [r] retirer ${mine === 1 ? 'ce vote' : `mes ${mine} votes`} \u00b7 [v] revoter \u00b7 Entrée = ne rien faire`,
    );
    const answer = await reader.ask('  Ton choix [r/v] : ');
    const choice = (answer || '').trim().toLowerCase();

    if (choice === 'r') {
      if (mine > 1) console.log(WITHDRAWING);
      const { removed, failed } = await withdrawMyVotesOn(args.party, chosen.key, profileHasVoted);
      console.log(`  J\u2019ai retiré ${removed} vote(s) que tu avais mis sur ce titre.`);
      if (failed) console.log(`  Échec pour ${failed} vote(s) : réessaie dans un instant.`);
      await reportNewTotals(args.party, [chosen.key]);
      return;
    }
    if (choice !== 'v') {
      console.log('  Rien changé.');
      return;
    }

    // They already said they want to vote again: skip the second confirmation
    // and go straight to how many.
    confirmedByUser = true;
  }

  if (!confirmedByUser) {
    const answer = await reader.ask('  Je vote pour ce titre ? [O/n] ');
    if (isNo(answer)) {
      console.log('  Annulé.');
      return;
    }
  }

  // How many votes? A profile holds one vote per track, so asking for more means
  // casting the extras from throwaway accounts — exactly what a private browser
  // window does. The user asked for the capability, so it is offered plainly;
  // the saved profile is never modified by those extra votes.
  const wanted = await askVoteQuantity(reader, chosen, {
    sessionCount: sessionVoteCount(chosen.key),
    isPrivate: privateSession.active,
    profileAlreadyVoted: profileHasVoted,
  });
  if (wanted < 1) return;

  // Who casts what. The first vote comes from the current identity (the saved
  // profile in a normal session) unless it already holds a vote on this track;
  // every other vote needs an account of its own, or it would simply overwrite
  // the previous one.
  const firstNeedsThrowaway = privateSession.active ? mine > 0 : profileHasVoted;

  const cast = await castVotes(args.party, chosen.key, wanted, {
    firstNeedsThrowaway,
    onCast(i, total) {
      if (total > 1) console.log(`  Vote ${i}/${total} enregistré.`);
    },
  });
  if (cast.error) console.log(`  Vote ${cast.added + 1}/${wanted} refusé : ${cast.error}`);
  const castCount = cast.added;
  const lastUid = cast.lastUid;

  if (!castCount) return;

  const n = sessionVoteCount(chosen.key);
  if (n > 1) {
    reader.log(`  ! C'est ton ${n}e vote pour ce titre dans cette session.`);
  }

  // Read the authoritative state back instead of trusting the write: the vote
  // entries give both the new total and the proof that the last vote is in.
  // The votes are cast by now, so a failed read must not look like a failed
  // vote: say what is known and leave the total out.
  let voters = null;
  try {
    voters = await votersOf(args.party, chosen.key);
  } catch {
    /* reported below as an unreadable total */
  }
  const total = voters ? voters.length : null;
  const unreadable = 'total illisible pour le moment : tape liste';

  // Inside the frame: a bordered stamp plus a burst of confetti.
  if (!reader.plain) {
    const lines = [`${chosen.title}${chosen.artists ? ` \u2014 ${chosen.artists}` : ''}`];
    if (castCount > 1) lines.push(`\u2795 ${castCount} votes ajout\u00e9s d\u2019un coup`);
    if (total === null) {
      lines.push(`\u266a ${unreadable}`);
    } else {
      const rank = rankOf(queue, chosen.key, total);
      lines.push(
        `\u266a ${total} ${total === 1 ? 'vote' : 'votes'}${rank ? `   \u00b7   #${rank} au classement` : ''}`,
      );
    }
    if (n > 1) lines.push(`\u26a0 ${n}\u00d7 par toi dans cette session`);
    reader.flash(`\u2605 VOTE ENREGISTRE`, lines);
    await reader.confetti();
  } else {
    // Title only: describe() would append the tally from before the vote.
    console.log(`  Vote enregistré : ${chosen.title}${chosen.artists ? ` \u2014 ${chosen.artists}` : ''}`);
    if (castCount > 1) console.log(`  ${castCount} votes ajoutés d\u2019un coup.`);
    if (total === null) {
      console.log(`  (${unreadable})`);
    } else {
      const confirmed = voters.includes(lastUid);
      console.log(
        `  ${total} ${total === 1 ? 'vote' : 'votes'} au total. Vérifié côté serveur : ${confirmed ? 'oui' : 'non'}`,
      );
    }
  }
}

async function interactive() {
  const args = { _: [], party: DEFAULT_PARTY, yes: true, dryRun: false, pick: null, refresh: false };
  let reader = makeReader();

  // Ctrl+C must not bypass the private-mode cleanup.
  if (privateSession.active) {
    process.on('SIGINT', () => {
      closePrivateSession('interruption')
        .catch(() => {})
        .finally(() => process.exit(130));
    });
  } else {
    process.on('SIGINT', () => {
      closeExtras()
        .catch(() => {})
        .finally(() => process.exit(130));
    });
  }

  try {
    const party = await db('GET', `/parties/${args.party}`);
    if (!party) throw new Error('Party introuvable.');

    // Retro CRT intro. Any keypress skips it; non-interactive runs never see it.
    await fx.splash({ subtitle: party.name });

    const queue = (await db('GET', `/tracks/${args.party}`)) || {};
    let liveVoteTotal = Object.values(queue).reduce((s, t) => s + (t.vote_count || 0), 0);

    // From here on the whole session lives inside the frame.
    if (!reader.plain) {
      reader = makeReader({
        title: 'JUKORAMA',
        subtitle: `party ${party.short_id}`,
        stats: () => ({
          votes: liveVoteTotal,
          // Straight from the ledger, so it drops back when votes are withdrawn.
          session: sessionVotes.length,
          mode: privateSession.active ? 'PRIVE' : null,
        }),
      });
    }
    reader.start();

    // Welcome: a centered title card in the frame, plain lines when piped.
    if (reader.plain) {
      reader.log(`  ${party.name}`);
      reader.log(`  Code ${party.short_id} \u2014 ${Object.keys(queue).length} chansons`);
    } else {
      reader.banner(party.name, [`Code ${party.short_id}  \u00b7  ${Object.keys(queue).length} chansons`]);
    }
    reader.log('');

    if (privateSession.active) {
      reader.log('  [PRIVE] profil jetable, jamais ecrit sur le disque');
      reader.log('          les comptes sont supprimes en quittant, tes votes restent');
      reader.log('');
    }

    // The liste/mesvotes/reset/quitter cheat-sheet now lives in the separator
    // bar, so the welcome only needs the one essential instruction.
    reader.log('  Ecris un titre (ou un artiste), puis Entree pour voter.');
    reader.log('');

    // Refresh the title index only when the queue has grown.
    let index = await loadIndex();
    const cached = Object.keys(index.tracks || {}).filter((k) => index.tracks[k].title).length;
    if (index.party !== args.party || cached < Object.keys(queue).length) {
      reader.log('  Mise a jour de la liste des titres (~30 s, une seule fois)...');
      index = await buildIndex(args.party, { quiet: true });
      reader.log('  Liste a jour.');
      reader.log('');
    }

    for (;;) {
      const raw = await reader.ask('> ');
      if (raw === null) break; // end of input / Ctrl+Z
      if (!raw) continue;

      // Accept the "/vote ..." form too, since that was the original wish.
      const input = raw.replace(/^\/(?:vote|voter)\s+/i, '').trim();

      if (/^(q|quit|quitter|exit|sortir)$/i.test(input)) break;

      // One failed command must not end the session: the ledger of what was
      // voted lives in memory, and losing it means losing the ability to
      // withdraw those votes and to erase the throwaway accounts on exit.
      try {
        if (/^(liste|list|classement)$/i.test(input)) {
          await cmdList({ _: [], party: args.party });
        } else if (/^(mesvotes|mes votes|myvotes|votes)$/i.test(input)) {
          await showMyVotes(args);
        } else if (/^reset$/i.test(input)) {
          // Private mode spreads votes across throwaway accounts, so its reset
          // must undo the whole session, not just the current identity.
          const partyTotal = privateSession.active
            ? await resetSessionVotes(reader, args)
            : await resetInteractively(reader, args);
          // The reset already read the new totals: reuse them for the header
          // rather than asking again (which, right after a normal reset, would
          // create a new profile just for that).
          if (typeof partyTotal === 'number') liveVoteTotal = partyTotal;
        } else {
          await voteOneInteractively(reader, { ...args, _: [input] });
          // The header total should follow what actually happened.
          liveVoteTotal = await currentVoteTotal(args.party, liveVoteTotal);
        }
      } catch (err) {
        reader.log(`  Erreur : ${err.message || err}`);
      }
      reader.log('');
    }

    // Private mode reports what was cast and offers to undo it before the
    // accounts are erased.
    if (privateSession.active) {
      await closePrivateSession('sortie', reader);
    } else {
      // Offer the reset first: it also covers the extra votes, and those can
      // only be withdrawn while their throwaway accounts still exist.
      try {
        await maybeOfferResetOnExit(reader, args);
      } catch (err) {
        reader.log(`  Erreur : ${err.message || err}`);
      }
      if (extras.active) await closeExtras();
    }
  } finally {
    if (reader.plain) reader.close();
    else reader.stop();
  }

  console.log('À la prochaine !');
  // Cathode-ray collapse, then the normal screen comes back.
  await fx.powerOff();

  // Belt and braces: if the console is still in raw mode the launcher's
  // "Press any key" would consume a byte without echo and close the window,
  // which looks exactly like an abrupt exit.
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* not a TTY: nothing to restore */
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/** Recompute the party's total vote count, for the status bar. */
async function currentVoteTotal(party, fallback) {
  try {
    const tracks = (await db('GET', `/tracks/${party}`)) || {};
    return Object.values(tracks).reduce((s, t) => s + (t.vote_count || 0), 0);
  } catch {
    return fallback;
  }
}

/**
 * "mesvotes" inside the session: one coherent answer per mode.
 *
 * Private mode has no lasting identity, so "the votes of the current uid" means
 * nothing to the user: it is whichever throwaway account voted last. What they
 * did is the session ledger, shown with the live totals. A normal session shows
 * the saved profile's votes, then the extra ones cast from throwaway accounts.
 */
async function showMyVotes(args) {
  if (privateSession.active) {
    if (!sessionVotes.length) {
      console.log('  Aucun vote dans cette session.');
      return;
    }
    const queue = (await db('GET', `/tracks/${args.party}`)) || {};
    console.log(`  Tes votes dans cette session (mode privé) : ${sessionVotes.length}`);
    for (const [key, n] of tally(sessionVotes)) {
      const total = (queue[key] && queue[key].vote_count) || 0;
      console.log(`    ${String(n).padStart(2)}\u00d7  ${await titleFor(key)}  [${total} au total]`);
    }
    return;
  }

  if (hasSavedProfile()) {
    await cmdMyVotes({ party: args.party });
  } else {
    // Only right after a reset. Asking the server would create a new profile
    // just to report that it holds nothing.
    console.log('  Aucun vote sur ton profil : il vient d\u2019être remis à zéro.');
  }
  const extra = throwawayVotes();
  if (extra.length) {
    console.log('');
    console.log(`  En plus dans cette session, depuis des profils jetables : ${extra.length}`);
    for (const [key, n] of tally(extra)) {
      console.log(`    ${String(n).padStart(2)}\u00d7  ${await titleFor(key)}`);
    }
  }
}

/**
 * Undo everything this session cast from throwaway accounts.
 *
 * This is "reset" in private mode. Each vote lives on its own throwaway
 * account, so a reset that only looks at the current identity would miss all
 * but the last one. This removes the whole session instead, then says exactly
 * what changed. A saved profile is not involved and is left alone.
 */
async function resetSessionVotes(reader, args) {
  const mine = throwawayVotes();
  if (!mine.length) {
    console.log('  Aucun vote à retirer : tu n\u2019as rien voté dans cette session.');
    return;
  }

  const entries = tally(mine);
  const profiles = new Set(mine.map((vote) => vote.auth.uid)).size;
  console.log(`  Pendant cette session, tu as mis ${mine.length} vote(s) :`);
  for (const [key, n] of entries) {
    console.log(`    ${String(n).padStart(2)}\u00d7  ${await titleFor(key)}`);
  }
  console.log(`  (répartis sur ${profiles} profil(s) anonyme(s) jetable(s))`);

  const answer = await reader.ask('  Tout retirer ? [O/n] ');
  if (answer === null || isNo(answer)) {
    console.log('  Rien changé.');
    return;
  }

  const keys = entries.map(([key]) => key);
  if (mine.length > 1) console.log(WITHDRAWING);
  const { removed, failed } = await undoVotes(args.party, mine);

  console.log(`  J\u2019ai retiré ${removed.length} vote(s) que tu avais mis dans cette session.`);
  if (failed.length) {
    console.log(`  Échec pour ${failed.length} vote(s) : retape reset pour réessayer.`);
  }
  return reportNewTotals(args.party, keys);
}

/** Confirm-and-reset flow shared by the `reset` command and the exit prompt. */
async function resetInteractively(reader, args) {
  // Extra votes of this session sit on throwaway accounts: the profile's own
  // list does not show them, yet they are just as much "my votes".
  const extra = throwawayVotes();

  // No profile left: a reset has just been done. Looking the identity up now
  // would create a new profile only to offer to forget it.
  if (!hasSavedProfile()) {
    if (!extra.length) {
      console.log('  Rien à retirer : ton profil vient déjà d\u2019être remis à zéro.');
      return;
    }
    // Extra votes the previous reset could not remove: only they are left.
    return resetSessionVotes(reader, args);
  }

  const { uid } = await getIdentity();
  const keys = await myVotedKeys(args.party);

  if (!keys.length && !extra.length) {
    console.log(`  Aucun vote à retirer pour ${uid}.`);
    const answer = await reader.ask('  Oublier quand même cette identité ? [o/N] ');
    if (!isYes(answer)) {
      console.log('  Rien changé.');
      return;
    }
    forgetIdentity();
    console.log('  Profil local oublié : un nouveau sera créé au besoin.');
    return;
  }

  const index = await loadIndex();
  if (keys.length) {
    console.log(`  Ton profil ${uid} détient ${keys.length} vote(s) :`);
    for (const key of keys) {
      const meta = index.tracks[key] || {};
      console.log(`    - ${meta.title || key}${meta.artists ? ` \u2014 ${meta.artists}` : ''}`);
    }
  }
  if (extra.length) {
    console.log(
      `  ${keys.length ? 'En plus, cette' : 'Cette'} session : ${extra.length} vote(s) depuis des profils jetables :`,
    );
    for (const [key, n] of tally(extra)) {
      console.log(`    ${String(n).padStart(2)}\u00d7  ${await titleFor(key)}`);
    }
  }
  console.log('');
  console.log('  Attention : ceci retire TOUS tes votes et SUPPRIME ton profil.');
  console.log('  Un nouveau profil sera créé ensuite : tu pourras donc revoter pour');
  console.log('  les mêmes titres, ce qui revient à bourrer les urnes.');
  console.log('  Pour ne retirer que tes votes sur un titre, tape ce titre.');

  const answer = await reader.ask(`  Confirmer le reset ? Tape "reset" pour confirmer : `);
  if (String(answer || '').trim().toLowerCase() !== 'reset') {
    console.log('  Annulé.');
    return;
  }

  // Extra votes first, while this run still holds their throwaway accounts.
  const touched = [...new Set([...keys, ...extra.map((vote) => vote.key)])];
  if (keys.length + extra.length > 1) console.log(WITHDRAWING);
  const undone = extra.length ? await undoVotes(args.party, extra) : { removed: [], failed: [] };
  let fromProfile;
  try {
    fromProfile = await resetIdentity(args.party);
  } catch (err) {
    // Stopped half-way (network): the profile is kept, so whatever is left can
    // still be seen with mesvotes and removed by trying again.
    if (undone.removed.length) {
      console.log(`  J\u2019ai retiré ${undone.removed.length} vote(s) en plus avant l\u2019erreur.`);
    }
    console.log('  Reset interrompu : retape reset pour le terminer.');
    throw err;
  }
  forgetSessionVotes(sessionVotes.filter((vote) => !vote.throwaway));

  const removed = fromProfile + undone.removed.length;
  console.log(`  J\u2019ai retiré ${removed} vote(s) que tu avais enregistré(s).`);
  if (extra.length) {
    console.log(
      `  (${fromProfile} de ton profil, ${undone.removed.length} depuis des profils jetables)`,
    );
  }
  if (undone.failed.length) {
    console.log(`  Échec pour ${undone.failed.length} vote(s) en plus : retape reset pour réessayer.`);
  }
  // Read the totals back while the profile still exists, so this does not have
  // to create a brand-new one just to make a request.
  const partyTotal = await reportNewTotals(args.party, touched);

  forgetIdentity();
  console.log('  Profil local oublié : un nouveau sera créé au besoin.');
  return partyTotal;
}

/** On exit, mention the leftovers — but a bare Enter keeps everything. */
async function maybeOfferResetOnExit(reader, args) {
  let keys = [];
  // Right after a reset there is no profile to ask about: looking it up would
  // create a new one for nothing.
  if (hasSavedProfile()) {
    try {
      keys = await myVotedKeys(args.party);
    } catch {
      /* offline: the extra votes below are still worth mentioning */
    }
  }
  const extra = throwawayVotes();
  if (!keys.length && !extra.length) return false;

  console.log('');
  if (extra.length) {
    console.log(`  Tu quittes avec ${keys.length} vote(s) sur ton profil et ${extra.length} en plus.`);
    console.log('  Après la sortie, les votes en plus ne pourront plus être retirés.');
  } else {
    console.log(`  Tu quittes avec ${keys.length} vote(s) enregistré(s).`);
  }
  const answer = await reader.ask('  Les conserver ? [O/n] ');
  if (!isNo(answer)) return false;

  await resetInteractively(reader, args);
  return true;
}

/** Everything the local web server is allowed to do, bound to this process. */
function webDependencies(args) {
  return {
    party: args.party,
    port: Number.isInteger(args.port) ? args.port : 4737,
    maxBatch: MAX_BATCH,
    isPrivate: () => privateSession.active,
    setPrivate() {
      PRIVATE_MODE = true;
      privateSession.active = true;
    },
    loadIndex,
    buildIndex,
    db,
    getIdentity,
    hasVoted,
    hasSavedProfile,
    myVotedKeys,
    throwawayVotes,
    sessionVoteCount,
    sessionVotes: () => sessionVotes,
    tally,
    titleFor,
    castVotes,
    votersOf,
    rankOf,
    rankMatches,
    withdrawMyVotesOn,
    undoVotes,
    resetIdentity,
    forgetIdentity,
    forgetSessionVotes,
    readTrackTotals,
    closePrivateSession,
    closeExtras,
    fetchTrackArt,
    fetchBinary,
    asAccount,
    saveIndex: (index) => writeJson(INDEX_FILE, index),
    authFileExists: () => fs.existsSync(AUTH_FILE),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();

  // --private turns any one-shot command into a throwaway session.
  if (args.private && command !== undefined && command !== 'shell' && command !== 'interactive') {
    // Set before any identity is read, otherwise loadAuth() would hand back the
    // persistent profile and the wipe below would destroy the user's real votes.
    PRIVATE_MODE = true;
    privateSession.active = true;
    try {
      return await runCommand(command, args);
    } finally {
      await closePrivateSession('fin de commande');
    }
  }

  return runCommand(command, args);
}

async function runCommand(command, args) {
  switch (command) {
    case 'party':
      return cmdParty(args);
    case 'whoami':
      return cmdWhoami();
    case 'index':
      return cmdIndex(args);
    case 'list':
      return cmdList(args);
    case 'vote':
      return cmdVote(args);
    case 'unvote':
      return cmdUnvote(args);
    case 'mesvotes':
    case 'myvotes':
    case 'votes':
      return cmdMyVotes(args);
    case 'reset':
      return cmdReset(args);
    case 'shell':
    case 'interactive':
      return interactive();
    case 'web':
      return require('./web.js').serve(
        require('./web-session.js').createWebSession(webDependencies(args)),
      );
    case undefined:
      // Double-clicked launcher or bare `node jukorama.js`: be interactive when
      // a human is actually typing, and fall back to help when piped.
      return process.stdin.isTTY ? interactive() : usage();
    case 'help':
    case '--help':
      return usage();
    default:
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});

// Test hook: lets an offline harness exercise the identity bookkeeping without
// touching the network. Only active when JUKORAMA_TEST_HOOKS=1.
if (process.env.JUKORAMA_TEST_HOOKS === '1') {
  module.exports = {
    loadAuth,
    saveAuth,
    setExtrasMode: (v) => {
      EXTRAS_MODE = v;
    },
    isEphemeral: ephemeralIdentity,
    rotateIdentity,
    extras,
  };
}
