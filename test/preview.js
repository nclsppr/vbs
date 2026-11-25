'use strict';

/**
 * Opens the television on a made-up party, without any network.
 *
 *   node test/preview.js [port]            first launch: titles are looked up
 *   node test/preview.js [port] private    same, started as Voter-web-prive.cmd
 *
 * Everything is answered by test/mock-firebase.js: votes, accounts, titles and
 * drawn covers. Use it to look at the page or to click through it safely.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SONGS = [
  ['Never Gonna Give You Up', 'Rick Astley', 41],
  ['Zoo', 'Kaaris', 27],
  ['All I Want for Christmas Is You', 'Mariah Carey', 24],
  ['Last Christmas', 'Wham!', 22],
  ['Freed from Desire', 'Gala', 19],
  ['Les Lacs du Connemara', 'Michel Sardou', 18],
  ['Dancing Queen', 'ABBA', 16],
  ['Sapés comme jamais', 'Maître Gims, Niska', 15],
  ['Mr. Brightside', 'The Killers', 14],
  ['Alors on danse', 'Stromae', 13],
  ["Cheater's Town", 'Chris Isaak', 12],
  ['Proper Education - Radio Edit', 'Eric Prydz, Floyd', 11],
  ['I Gotta Feeling', 'Black Eyed Peas', 10],
  ['Blue (Da Ba Dee)', 'Eiffel 65', 9],
  ['Bande organisée', 'Sch, Kofs, Jul, Naps, Soso Maness, Elams, Solda, Houari', 9],
  ['Wonderwall', 'Oasis', 8],
  ['Une chanson au titre vraiment interminable pour voir comment la ligne se comporte', 'Artiste au nom très long également', 8],
  ['Jingle Bell Rock', 'Bobby Helms', 7],
  ['Tout oublier', 'Angèle, Roméo Elvis', 7],
  ['Djadja', 'Aya Nakamura', 6],
  ['Sweet Caroline', 'Neil Diamond', 6],
  ['Macarena', 'Los Del Rio', 5],
  ['Feliz Navidad', 'José Feliciano', 5],
  ['Rasputin', 'Boney M.', 4],
  ['Petit Papa Noël', 'Tino Rossi', 4],
  ['Billie Jean', 'Michael Jackson', 3],
  ["It's Beginning to Look a Lot Like Christmas", 'Michael Bublé', 3],
  ['Papaoutai', 'Stromae', 3],
  ['Take On Me', 'a-ha', 2],
  ['Sandstorm', 'Darude', 2],
  ['Ça plane pour moi', 'Plastic Bertrand', 2],
  ['Bohemian Rhapsody', 'Queen', 1],
  ['Lonely Road', 'Nobody', 1],
  ['Смуглянка', 'Хор', 1],
];

const port = /^\d+$/.test(process.argv[2] || '') ? process.argv[2] : '4780';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jukorama-preview-'));
const catalog = {};
const tracks = {};
SONGS.forEach(([title, artists, votes], i) => {
  const id = `demo${String(i + 1).padStart(2, '0')}`;
  catalog[id] = { title, artists };
  tracks[`spotify-${id}`] = votes;
});

const env = {
  ...process.env,
  JUKORAMA_DATA_DIR: dir,
  JUKORAMA_PROXY_BOOTSTRAPPED: '1',
  JUKORAMA_WEB_NO_OPEN: '1',
  MOCK_WORLD: JSON.stringify({ tracks, accounts: [], votes: {}, withdrawn: {} }),
  MOCK_CATALOG: JSON.stringify(catalog),
  // Answers take a little time, as on a real network, so waits can be seen.
  MOCK_SPOTIFY_DELAY: process.env.MOCK_SPOTIFY_DELAY || '120',
  MOCK_LATENCY: process.env.MOCK_LATENCY || '70',
};
if (process.argv.includes('private')) env.JUKORAMA_PRIVATE = '1';
else delete env.JUKORAMA_PRIVATE;

const child = spawn(
  process.execPath,
  ['-r', path.join(__dirname, 'mock-firebase.js'), path.join(__dirname, '..', 'jukorama.js'), 'web', '--port', port],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code || 0);
});
