'use strict';

/**
 * Downloads the third-party assets the web page ships with, and writes down
 * where each one comes from and under which licence.
 *
 *   node --use-env-proxy --use-system-ca tools/fetch-assets.js
 *
 * Nothing here runs for a voter: the files live in web/ and this script only
 * documents (and can repeat) how they got there. Files already present are
 * kept, so the script can be run again after an interruption.
 *
 *   web/music/*.mid         Christmas carols, CC0 settings from Wikimedia Commons
 *   web/music/playlist.json order and titles for the television's jukebox
 *   web/music/CREDITS.txt   source and licence of every tune
 *   web/fonts/vt323-*.woff2 VT323, SIL Open Font License 1.1
 *   web/fonts/OFL.txt       the licence text that must travel with the font
 */

const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web');
const UA = 'jukorama-assets/1.0 (one-off download of a few CC0 MIDI files) node-fetch';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Carols whose melody is in the public domain, in settings their author
// released under CC0. `name` is what the television shows.
const CAROLS = [
  { file: 'vive-le-vent.mid', name: 'Vive le vent', commons: 'File:Jingle Bells.mid' },
  { file: 'mon-beau-sapin.mid', name: 'Mon beau sapin', commons: 'File:O Tannenbaum.mid' },
  { file: 'il-est-ne.mid', name: 'Il est né le divin enfant', commons: 'File:Il est né le divin enfant.mid' },
  { file: 'we-wish-you.mid', name: 'We Wish You a Merry Christmas', commons: 'File:We Wish You A Merry Christmas.mid' },
  { file: 'deck-the-halls.mid', name: 'Deck the Halls', commons: 'File:Deck the Halls.mid' },
  { file: 'joy-to-the-world.mid', name: 'Joy to the World', commons: 'File:Joy to the World (Freue dich, Welt).mid' },
  { file: 'douce-nuit.mid', name: 'Douce nuit', commons: 'File:Stille Nacht, heilige Nacht.mid' },
];
const FREE = new Set(['CC0', 'Public domain']);

async function get(url, headers = {}, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (res.status === 429 && attempt < 2) {
    // Wait exactly as long as the server asks, then try again once or twice.
    const wait = Number(res.headers.get('retry-after')) || 30;
    console.log(`       throttled, waiting ${wait} s as asked`);
    await sleep(Math.min(wait + 5, 900) * 1000);
    return get(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function fetchCarols() {
  const dir = path.join(WEB, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    titles: CAROLS.map((carol) => carol.commons).join('|'),
  });
  const data = await (await get(`https://commons.wikimedia.org/w/api.php?${query}`)).json();
  const pages = new Map(data.query.pages.map((page) => [page.title, page]));

  const credits = [
    'Musique de la télévision Jukorama',
    '=================================',
    '',
    'Chants de Noël dont la mélodie est dans le domaine public. Les fichiers MIDI',
    'viennent de Wikimedia Commons, où leur auteur les a placés sous licence CC0',
    '(https://creativecommons.org/publicdomain/zero/1.0/deed.fr).',
    '',
  ];
  const playlist = [];
  let failure = null;
  for (const carol of CAROLS) {
    const page = pages.get(carol.commons);
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info) throw new Error(`Not on Commons: ${carol.commons}`);
    const meta = info.extmetadata || {};
    const licence = plain(meta.LicenseShortName && meta.LicenseShortName.value);
    if (!FREE.has(licence)) throw new Error(`${carol.commons} is "${licence}", not CC0 or public domain.`);

    const target = path.join(dir, carol.file);
    if (!fs.existsSync(target) && !failure) {
      try {
        // One small file every 20 s: the file server throttles anything faster.
        // The API adds tracking parameters to the address; the bare one is canonical.
        await sleep(20000);
        const bytes = Buffer.from(await (await get(info.url.split('?')[0])).arrayBuffer());
        if (bytes.subarray(0, 4).toString('latin1') !== 'MThd') throw new Error(`${carol.commons} is not a MIDI file.`);
        fs.writeFileSync(target, bytes);
      } catch (err) {
        failure = err;
      }
    }
    if (!fs.existsSync(target)) continue;

    playlist.push({ file: carol.file, name: carol.name });
    credits.push(
      `${carol.file}  —  ${carol.name}`,
      `  ${plain(meta.Artist && meta.Artist.value)}`,
      `  Licence : ${licence}`,
      `  Source  : ${info.descriptionurl}`,
      '',
    );
    console.log(`music  ${carol.file}  ${fs.statSync(target).size} bytes  ${licence}`);
  }
  // The jukebox only lists what is really there.
  fs.writeFileSync(path.join(dir, 'playlist.json'), `${JSON.stringify(playlist, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'CREDITS.txt'), credits.join('\r\n'));
  if (failure) throw new Error(`${playlist.length} of ${CAROLS.length} carols present. ${failure.message}`);
}

async function fetchFont() {
  const dir = path.join(WEB, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const wanted = ['vt323-latin.woff2', 'vt323-latin-ext.woff2', 'OFL.txt'];
  if (wanted.every((file) => fs.existsSync(path.join(dir, file)))) {
    console.log('font   already present');
    return;
  }
  // A browser user agent makes Google Fonts answer with woff2 and one
  // @font-face block per subset.
  const css = await (
    await get('https://fonts.googleapis.com/css2?family=VT323&display=swap', {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    })
  ).text();
  const faces = [];
  const block = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g;
  let match;
  while ((match = block.exec(css))) {
    const subset = match[1];
    if (subset !== 'latin' && subset !== 'latin-ext') continue;
    const url = /url\((https:[^)]+\.woff2)\)/.exec(match[2]);
    const range = /unicode-range:\s*([^;]+);/.exec(match[2]);
    if (!url || !range) throw new Error(`Unexpected Google Fonts answer for ${subset}.`);
    const bytes = Buffer.from(await (await get(url[1])).arrayBuffer());
    if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${subset} is not a woff2 file.`);
    const file = `vt323-${subset}.woff2`;
    fs.writeFileSync(path.join(dir, file), bytes);
    faces.push({ file, range: range[1].trim() });
    console.log(`font   ${file}  ${bytes.length} bytes`);
  }
  if (faces.length !== 2) throw new Error('VT323: expected the latin and latin-ext subsets.');
  const licence = await (await get('https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt')).text();
  if (!/SIL OPEN FONT LICENSE/i.test(licence)) throw new Error('The font licence text is not the OFL.');
  fs.writeFileSync(path.join(dir, 'OFL.txt'), licence);
  // web/css/base.css repeats these two ranges; print them in case Google
  // ever changes the split.
  for (const face of faces) console.log(`       ${face.file}: unicode-range ${face.range}`);
}

(async () => {
  await fetchFont();
  await fetchCarols();
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
