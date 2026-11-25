'use strict';

/**
 * Retro CRT effects for the Jukorama CLI.
 *
 * Three pieces:
 *   splash()    — CRT power-on, then an animated Christmas scene with snow
 *   voteFlash() — a boxed confirmation with a short draw-in
 *   powerOff()  — the reverse collapse when the session ends
 *
 * Everything is a no-op when stdout is not a terminal (piped, CI, tests) or when
 * JUKORAMA_NO_FX=1, so the CLI keeps working as a plain script. JUKORAMA_FX_FORCE=1
 * turns the effects back on regardless, which is how they are tested without a
 * real console.
 */

const E = '\x1b[';
const RESET = `${E}0m`;
const fg = (n) => `${E}38;5;${n}m`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (s) => process.stdout.write(s);

function fxEnabled() {
  if (process.env.JUKORAMA_NO_FX === '1') return false;
  if (process.env.JUKORAMA_FX_FORCE === '1') return true;
  return Boolean(process.stdout.isTTY);
}

function size() {
  const forced = process.env.JUKORAMA_FX_SIZE;
  if (forced) {
    const [c, r] = forced.split('x').map(Number);
    if (c > 0 && r > 0) return { cols: c, rows: r };
  }
  return {
    cols: Math.max(40, process.stdout.columns || 80),
    rows: Math.max(18, process.stdout.rows || 24),
  };
}

// ---------------------------------------------------------------------------
// palette (256-colour; safe in conhost and Windows Terminal)
// ---------------------------------------------------------------------------

const C = {
  black: 16,
  green: 41,
  greenDim: 35,
  greenDark: 28,
  trunk: 130,
  gold: 226,
  amber: 214,
  red: 203,
  blue: 39,
  snowFar: 245,
  snowMid: 252,
  snowNear: 231,
  title: 51,
  dim: 240,
  box: 51,
};

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------

function makeBuffer(cols, rows) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ ch: ' ', fg: C.dim })),
  );
}

function put(buf, x, y, text, color) {
  const row = buf[y];
  if (!row) return;
  for (let i = 0; i < text.length; i++) {
    const cx = x + i;
    if (cx >= 0 && cx < row.length) row[cx] = { ch: text[i], fg: color };
  }
}

/** Centre a string, counting only its width. */
function putCentered(buf, y, text, color) {
  put(buf, Math.floor((buf[0].length - text.length) / 2), y, text, color);
}

function paintRect(buf, x, y, w, h, ch, color) {
  for (let yy = y; yy < y + h; yy++) {
    const row = buf[yy];
    if (!row) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx >= 0 && xx < row.length) row[xx] = { ch, fg: color };
    }
  }
}

/**
 * Paint a buffer to the terminal.
 *
 * Colours are emitted as runs rather than per cell, which keeps the output small
 * enough to redraw the whole screen at ~11 fps without visible tearing. Odd rows
 * are dimmed to imitate CRT scanlines.
 */
function render(buf, { scanlines = true } = {}) {
  const out = [`${E}H`];
  for (let y = 0; y < buf.length; y++) {
    let last = -1;
    let line = '';
    for (const cell of buf[y]) {
      if (cell.fg !== last) {
        line += fg(cell.fg);
        last = cell.fg;
      }
      line += cell.ch;
    }
    line += RESET;
    if (scanlines && y % 2 === 1) line = `${E}2m${line}${E}22m`;
    out.push(line);
    if (y < buf.length - 1) out.push('\n');
  }
  write(out.join(''));
}

// ---------------------------------------------------------------------------
// snow
// ---------------------------------------------------------------------------

const FLAKES = ['*', '\u00b7', '.', "'", '+', ','];

function makeSnow(cols, rows, count) {
  const flakes = [];
  for (let i = 0; i < count; i++) {
    const layer = i % 3; // 0 = far, 1 = mid, 2 = near
    flakes.push({
      x: Math.random() * cols,
      y: Math.random() * rows,
      vy: 0.12 + layer * 0.2,
      phase: Math.random() * Math.PI * 2,
      amp: 0.4 + Math.random() * 1.6,
      ch: FLAKES[(Math.random() * FLAKES.length) | 0],
      color: [C.snowFar, C.snowMid, C.snowNear][layer],
    });
  }
  return flakes;
}

function stepSnow(flakes, cols, rows, t) {
  for (const f of flakes) {
    f.y += f.vy;
    f.x += Math.sin(t / 420 + f.phase) * f.amp * 0.18;
    if (f.y >= rows) {
      f.y -= rows;
      f.x = Math.random() * cols;
    }
    if (f.x < 0) f.x += cols;
    if (f.x >= cols) f.x -= cols;
  }
}

function drawSnow(buf, flakes) {
  for (const f of flakes) {
    const x = Math.round(f.x);
    const y = Math.round(f.y);
    const row = buf[y];
    if (row && x >= 0 && x < row.length) row[x] = { ch: f.ch, fg: f.color };
  }
}

// ---------------------------------------------------------------------------
// the tree
// ---------------------------------------------------------------------------

// Every row has an odd width and no manual padding: centring on the widest row
// then lines the star, the branches and the trunk up on the same axis.
const TREE_ROWS = [
  '*',
  '/_\\',
  '/___\\',
  '/_*_*_\\',
  '/___A___\\',
  '/_*____*_\\',
  '/___A___A___\\',
  '|||',
  '__|||__',
];

function treeColor(ch, row, col) {
  if (row === 0) return C.gold;
  if (ch === '*') return [C.red, C.gold, C.blue, C.amber][(row + col) % 4];
  if (ch === 'A') return C.red;
  if (ch === '|') return C.trunk;
  if (ch === '_') return C.greenDark;
  return C.green;
}

function drawTree(buf, topY, flicker) {
  const cols = buf[0].length;
  const treeW = Math.max(...TREE_ROWS.map((r) => r.length));
  const left = Math.floor((cols - treeW) / 2);

  TREE_ROWS.forEach((row, r) => {
    const x = left + Math.floor((treeW - row.length) / 2);
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      let color = treeColor(ch, r, i);
      if (flicker && color === C.green) color = C.greenDim;
      put(buf, x + i, topY + r, ch, color);
    }
  });
}

// ---------------------------------------------------------------------------
// twinkling stars
// ---------------------------------------------------------------------------

const STAR_CHARS = ['\u2726', '\u2727', '+', '\u00b7', '\u2735'];
const STAR_GLOW = [C.dim, C.snowFar, C.snowMid, C.gold, C.snowNear, C.gold, C.snowMid, C.snowFar];

/** Fixed star positions in the sky band above the tree. */
function makeStars(cols, skyBottom, count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: 1 + ((Math.random() * (cols - 2)) | 0),
      y: 1 + ((Math.random() * Math.max(1, skyBottom - 1)) | 0),
      ch: STAR_CHARS[(Math.random() * STAR_CHARS.length) | 0],
      phase: (Math.random() * STAR_GLOW.length) | 0,
    });
  }
  return stars;
}

function drawStars(buf, stars, frame) {
  for (const s of stars) {
    const color = STAR_GLOW[(s.phase + (frame >> 1)) % STAR_GLOW.length];
    put(buf, s.x, s.y, s.ch, color);
  }
}

// ---------------------------------------------------------------------------
// presents under the tree
// ---------------------------------------------------------------------------

/** A little cluster of wrapped presents with gold ribbon, centred on cx. */
function drawGifts(buf, cx, topY) {
  const colors = [C.red, C.blue, C.amber, C.green];
  const n = 3;
  const w = n * 3 + (n - 1); // each present 3 wide + 1 gap
  let x = cx - Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const box = colors[i % colors.length];
    put(buf, x, topY, '\u250c', box);
    put(buf, x + 1, topY, '\u252c', C.gold); // ribbon knot
    put(buf, x + 2, topY, '\u2510', box);
    put(buf, x, topY + 1, '\u2514', box);
    put(buf, x + 1, topY + 1, '\u2534', C.gold);
    put(buf, x + 2, topY + 1, '\u2518', box);
    x += 4;
  }
}

// ---------------------------------------------------------------------------
// vignette border (echoes the session frame, for a seamless hand-off)
// ---------------------------------------------------------------------------

function drawBorder(buf, color, label) {
  const rows = buf.length;
  const cols = buf[0].length;
  put(buf, 0, 0, `\u2554${'\u2550'.repeat(cols - 2)}\u2557`, color);
  put(buf, 0, rows - 1, `\u255a${'\u2550'.repeat(cols - 2)}\u255d`, color);
  for (let y = 1; y < rows - 1; y++) {
    put(buf, 0, y, '\u2551', color);
    put(buf, cols - 1, y, '\u2551', color);
  }
  if (label) {
    const tag = ` ${label} `;
    put(buf, 3, 0, tag, C.snowNear);
  }
}

/**
 * Build one splash frame into a fresh buffer and return it.
 *
 * Split out from splash() so a single frame can be rendered and measured in a
 * test without running the whole animation.
 */
function composeSplash(state) {
  const { cols, rows, frame, snow, stars, topY, subtitle } = state;
  const treeH = TREE_ROWS.length;
  const buf = makeBuffer(cols, rows);
  const t = frame * 90;

  // Back to front: snow and stars first, then the tree and text on top.
  stepSnow(snow, cols, rows, t);
  drawSnow(buf, snow);
  drawStars(buf, stars, frame);

  drawTree(buf, topY, frame % 13 === 0);
  // Presents sit on the ground line right under the trunk.
  drawGifts(buf, Math.floor(cols / 2), topY + treeH);

  // Title glows: the phosphor warms and cools around gold.
  const glow = [C.gold, C.amber, C.snowNear, C.amber][(frame >> 1) % 4];
  putCentered(buf, topY + treeH + 3, TITLE, glow);
  putCentered(buf, topY + treeH + 4, (subtitle || 'JUKORAMA').slice(0, cols - 6), C.amber);

  const bar = '\u2593'.repeat(Math.max(4, Math.min(12, Math.floor(cols / 8))));
  putCentered(buf, topY + treeH + 5, `${bar}\u2591\u2591  CHRISTMAS MODE  \u00b7  60HZ`, C.dim);
  if (frame % 16 < 10) putCentered(buf, topY + treeH + 6, HINT, C.snowMid);

  // Vignette last, so nothing paints over the frame edges.
  drawBorder(buf, C.box, '\u2744 JUKORAMA \u2744');
  return buf;
}

// ---------------------------------------------------------------------------
// effects
// ---------------------------------------------------------------------------

const hideCursor = () => write(`${E}?25l`);
const showCursor = () => write(`${E}?25h`);
const enterAlt = () => write(`${E}?1049h`);
const exitAlt = () => write(`${E}?1049l`);

/** Bright bar that grows from a dot into a full screen: the CRT warming up. */
async function powerOn(cols, rows) {
  const steps = [
    { w: 3, h: 1, color: C.snowNear, ms: 70 },
    { w: Math.floor(cols * 0.35), h: 1, color: C.snowNear, ms: 55 },
    { w: Math.floor(cols * 0.8), h: 1, color: C.snowNear, ms: 50 },
    { w: cols, h: 1, color: C.title, ms: 45 },
    { w: cols, h: Math.max(2, Math.floor(rows * 0.16)), color: C.title, ms: 45 },
    { w: cols, h: Math.max(4, Math.floor(rows * 0.5)), color: C.greenDark, ms: 45 },
    { w: cols, h: rows, color: C.black, ms: 70 },
  ];

  for (const s of steps) {
    const buf = makeBuffer(cols, rows);
    paintRect(buf, Math.floor((cols - s.w) / 2), Math.floor((rows - s.h) / 2), s.w, s.h, '\u2588', s.color);
    render(buf, { scanlines: false });
    await sleep(s.ms);
  }
}

/** Listen for any key so the splash can be skipped. Only when a human is typing. */
function skipListener(onSkip) {
  if (!process.stdin.isTTY) return null;
  const handler = () => onSkip();
  try {
    process.stdin.setRawMode(true);
  } catch {
    /* not supported: fall through */
  }
  if (process.stdin.isPaused()) process.stdin.resume();
  process.stdin.once('data', handler);
  return () => {
    process.stdin.removeListener('data', handler);
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    // Do NOT pause stdin here: the interactive loop needs it immediately, and a
    // paused stdin also swallows the launcher's final "Press any key".
  };
}

const TITLE = '\u2605  B I E N T \u00d4 T   N O \u00cb L  \u2605';
const HINT = 'Appuie sur une touche pour voter';

async function splash(opts = {}) {
  if (!fxEnabled()) return false;

  const { cols, rows } = size();
  if (cols < 54 || rows < 20) return false;

  enterAlt();
  hideCursor();

  let skipped = false;
  const detach = skipListener(() => {
    skipped = true;
  });

  try {
    await powerOn(cols, rows);

    const snow = makeSnow(cols, rows, Math.round(cols * 0.85));
    const treeH = TREE_ROWS.length;
    const blockH = treeH + 7;
    const topY = Math.max(1, Math.floor((rows - blockH) / 2));
    const stars = makeStars(cols, topY, Math.round(cols * 0.18));
    const frames = 46;

    for (let frame = 0; frame < frames && !skipped; frame++) {
      const buf = composeSplash({
        cols,
        rows,
        frame,
        snow,
        stars,
        topY,
        subtitle: opts.subtitle || 'JUKORAMA',
      });
      render(buf);
      await sleep(85);
    }
  } finally {
    if (detach) detach();
    showCursor();
    // Leaving the alternate screen restores exactly what was there before, so
    // the session's normal output is never wiped by the animation.
    exitAlt();
  }

  return true;
}

/**
 * Boxed vote confirmation, drawn in place.
 *
 * The block is reserved first, then redrawn bottom-up on the same lines, so it
 * never scrolls the session output around it.
 */
async function voteFlash(title, artists, total) {
  if (!fxEnabled()) return false;

  const { cols } = size();
  const label = 'VOTE ENREGISTR\u00c9';
  const heading = `  \u2605 ${label}`;
  const body = `  ${title}${artists ? ` \u2014 ${artists}` : ''}`;
  const count = `  ${total} ${total === 1 ? 'vote' : 'votes'} au total`;
  const inner = Math.min(cols - 6, Math.max(heading.length, body.length, count.length) + 2);

  const pad = (s) => `  \u2551${s.padEnd(inner).slice(0, inner)}\u2551`;
  const lines = [
    `${fg(C.green)}  \u2554${'\u2550'.repeat(inner)}\u2557${RESET}`,
    `${fg(C.box)}${pad(heading)}${RESET}`,
    `${fg(C.snowNear)}${pad(body)}${RESET}`,
    `${fg(C.snowMid)}${pad(count)}${RESET}`,
    `${fg(C.green)}  \u255a${'\u2550'.repeat(inner)}\u255d${RESET}`,
  ];

  // Reserve the block so the redraw has somewhere to land.
  write('\n'.repeat(lines.length));

  const frames = 3;
  for (let f = 0; f < frames; f++) {
    write(`${E}${lines.length}A`);
    for (const line of lines) write(`\r${E}2K${line}\n`);
    await sleep(70);
  }

  return true;
}

/**
 * Compact CRT switch-off.
 *
 * Deliberately NOT drawn full-screen and NOT on the alternate buffer: entering
 * the alternate screen a second time at the very end of the session made the
 * console restore the wrong buffer, wiping the session output right before the
 * launcher's `pause`. This version only touches the single line it draws on, so
 * the votes and recap above stay readable.
 */
async function powerOff() {
  if (!fxEnabled()) return false;

  const { cols } = size();
  const width = Math.max(10, Math.min(cols - 2, 48));

  const frames = [
    { text: '\u2588'.repeat(width), color: C.snowNear },
    { text: '\u2588'.repeat(Math.floor(width * 0.55)), color: C.snowNear },
    { text: '\u2588'.repeat(Math.floor(width * 0.2)), color: C.greenDim },
    { text: '\u2588', color: C.greenDim },
    { text: '', color: C.dim },
  ];

  write('\n');
  for (const frame of frames) {
    const pad = Math.max(0, Math.floor((Math.min(cols, 60) - frame.text.length) / 2));
    write(`\r${E}2K${' '.repeat(pad)}${frame.text ? fg(frame.color) + frame.text + RESET : ''}`);
    await sleep(frame.text ? 85 : 40);
  }
  write('\r'); // leave the cursor at column 0 for whatever prints next

  return true;
}

module.exports = {
  splash,
  voteFlash,
  powerOff,
  enabled: fxEnabled,
  // Exposed for the offline render test only.
  __test: { composeSplash, makeSnow, makeStars, render, TREE_ROWS },
};
