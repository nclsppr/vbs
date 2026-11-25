'use strict';

/**
 * Persistent CRT session screen.
 *
 * The splash is only the shop window; this is the room behind it. The whole
 * session runs inside one managed terminal screen:
 *
 *   +-- JUKORAMA -------------------- party 375513 --+
 *   |  (log area: snow falls behind the text)         |
 *   |                                                 |
 *   +-- 1217 votes · 2 session · 21:03 ********* -----+
 *   > paparazzi_
 *
 * Responsibilities:
 *   - own the alternate screen for the session, so the user's real scrollback
 *     is untouched
 *   - keep a scrollback of log lines and paint it inside the frame
 *   - animate snow and a spinner on a timer, independently of user input
 *   - capture keystrokes itself (raw mode) so the prompt lives inside the frame
 *
 * Everything degrades to plain text when the output is not a terminal: the CLI
 * must stay scriptable.
 */

const E = '\x1b[';
const RESET = `${E}0m`;
const fg = (n) => `${E}38;5;${n}m`;
const BOLD = `${E}1m`;
const DIM = `${E}2m`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  // frame
  frame: 24,
  frameHot: 45,
  // text
  text: 253,
  muted: 245,
  dim: 240,
  heading: 231,
  // semantic
  ok: 42,
  warn: 214,
  err: 203,
  accent: 51,
  gold: 220,
  echo: 73,
  // christmas
  green: 41,
  greenDim: 28,
  greenDark: 22,
  amber: 214,
  red: 203,
  blue: 39,
  trunk: 130,
  snowFar: 237,
  snowMid: 244,
  snowNear: 252,
  prompt: 51,
};

const FLAKES = ['*', '\u00b7', '.', "'", '+', ','];
const SPINNER = ['\u2802', '\u2806', '\u2807', '\u280f', '\u281f', '\u283f', '\u283b', '\u2839', '\u2838', '\u2830', '\u2820', '\u2800'];

// Permanent corner tree. Only CP437-safe single-width glyphs (block shades and
// ASCII) so the frame can never be knocked out of alignment by wide characters.
const MINI_TREE = [
  '   *   ',
  '   \u2593   ',
  '  \u2593\u2593\u2593  ',
  ' \u2593\u2593\u2593\u2593\u2593 ',
  '\u2593\u2593\u2593\u2593\u2593\u2593\u2593',
  '   \u2588   ',
];
// Bauble positions on the tree (row, col) and the colours they cycle through.
const TREE_BAUBLES = [[2, 3], [3, 2], [3, 4], [4, 1], [4, 3], [4, 5]];
// Christmas-light palette for shimmering titles, garlands and baubles.
const XMAS = [C.red, C.green, C.gold, C.snowNear, C.blue];

/** Strip SGR sequences so stored log lines can be re-coloured by the screen. */
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Emoji are double-width and would break the frame alignment. Swap the few we
 * actually print for text markers.
 */
function demojify(s) {
  return s.replace(/\u{1F512}\s*/gu, '[PRIVE] ').replace(/\u26a0\ufe0f?\s*/gu, '! ');
}

function width(s) {
  return [...stripAnsi(s)].length;
}

function truncate(s, max) {
  const chars = [...stripAnsi(s)];
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return chars.slice(0, max).join('');
  return `${chars.slice(0, max - 1).join('')}\u2026`;
}

/**
 * Pick a colour for a log line from its content.
 *
 * The rest of the program just prints French strings (directly or through the
 * intercepted console.log); classifying here keeps all the styling in one place
 * instead of threading a colour through every call site.
 */
function classify(text) {
  const t = stripAnsi(text).trim().toLowerCase();
  if (!t) return C.text;
  if (t.startsWith('\u2192')) return C.accent; // "→ chosen track"
  if (/vote enregistr|vote ok|\u2605 vote/.test(t)) return C.ok;
  // "Maintenant 22 votes au total : Title" — the read-back after a withdrawal.
  if (/^maintenant \d+ votes? au total|^plus dans la file :|^plus aucun vote :/.test(t)) return C.accent;
  if (/vote retir|retir\u00e9/.test(t)) return C.warn;
  if (/r\u00e9capitulatif|garder ces votes|compte.*supprim|plus aucun lien/.test(t)) return C.accent;
  if (/erreur|aucune chanson|introuvable|invalide|refus|\u00e9chec|echec|impossible/.test(t)) return C.err;
  if (/annul\u00e9|rien chang|rien \u00e0 retirer|aucun vote \u00e0 retirer|^retrait en cours/.test(t)) return C.muted;
  if (/d\u00e9j\u00e0 vot|d\u00e9j\u00e0 mis|c'est ton|attention|^!/.test(t)) return C.warn;
  if (/\[prive\]|mode priv/.test(t)) return C.amber;
  if (/^code |chansons|^party |^\d{2}\/\d{2}\//.test(t)) return C.heading;
  if (/liste =|[e\u00e9]cris (?:le|un) titre|raccourci|tape le|tape ce titre/.test(t)) return C.muted;
  if (/^votes de/.test(t)) return C.heading;
  return C.text;
}

/**
 * Break a line into coloured segments so numbers, vote tallies and bracketed
 * hints stand out from the title text.
 */
function segment(text, baseColor) {
  const plain = demojify(stripAnsi(text));
  const base = baseColor != null ? baseColor : classify(plain);

  // "   29  Title" or "    1. Title — Artist  [2 votes]"
  const listMatch = plain.match(/^(\s*)(\d+)([.)]?)(\s+)(.*)$/);
  if (listMatch) {
    const [, pad, num, dot, gap, rest] = listMatch;
    const segs = [
      { t: pad, c: base },
      { t: num + dot, c: C.gold },
      { t: gap, c: base },
    ];
    // Dim a trailing "[...]" tally so the title reads first.
    const bracket = rest.match(/^(.*?)(\s*\[[^\]]*\])\s*$/);
    if (bracket) {
      segs.push({ t: bracket[1], c: base });
      segs.push({ t: bracket[2], c: C.dim });
    } else {
      segs.push({ t: rest, c: base });
    }
    return segs;
  }

  return [{ t: plain, c: base }];
}

class CrtScreen {
  constructor(options = {}) {
    this.title = options.title || 'JUKORAMA';
    this.subtitle = options.subtitle || '';
    this.maxLog = 400;
    this.logLines = [];
    this.input = '';
    this.promptText = '';
    this.spinnerIndex = 0;
    this.running = false;
    this.frames = 0;
    this.stats = options.stats || (() => null);
    this.snow = [];
    this.timer = null;
    this.originalLog = null;
    this._resolve = null;
    this._onData = null;
    // CRT scanlines + brightness dips, on unless explicitly disabled.
    this.scanlines = process.env.JUKORAMA_NO_SCANLINES !== '1' && process.env.JUKORAMA_PLAIN !== '1';
  }

  get cols() {
    return Math.max(40, process.stdout.columns || 80);
  }

  get rows() {
    return Math.max(16, process.stdout.rows || 24);
  }

  /** Is the full screen usable at all? */
  static supported() {
    if (process.env.JUKORAMA_NO_FX === '1') return false;
    if (process.env.JUKORAMA_PLAIN === '1') return false;
    // The screen captures keystrokes in raw mode and repaints fixed geometry, so
    // it needs a genuine terminal on both ends. JUKORAMA_FX_FORCE only overrides
    // the "is this worth doing" part, never this requirement.
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    return true;
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;

    process.stdout.write(`${E}?1049h${E}?25l${E}2J${E}?7l`);
    this.snow = this._makeSnow();

    // Anything printed by the rest of the program lands in the frame instead of
    // tearing through it.
    this.originalLog = console.log;
    console.log = (...args) => this.log(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        /* ignore */
      }
      process.stdin.resume();
      this._onData = (chunk) => this._handleData(chunk);
      process.stdin.on('data', this._onData);
    }

    process.stdout.on('resize', this._boundResize || (this._boundResize = () => this.render()));

    this.render();
    this.timer = setInterval(() => {
      this.frames++;
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
      this.render();
    }, 120);
    // Do not hold the event loop open just for the animation.
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    if (this._onData && process.stdin.isTTY) {
      process.stdin.removeListener('data', this._onData);
      this._onData = null;
    }
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }

    if (this.originalLog) {
      console.log = this.originalLog;
      this.originalLog = null;
    }

    process.stdout.write(`${E}?25h${E}?1049l${E}?7h`);
  }

  // -------------------------------------------------------------------------
  // log
  // -------------------------------------------------------------------------

  log(...args) {
    const raw = args.length ? args.join(' ') : '';
    // An explicit colour can be passed as a second argument by internal callers.
    const forced = typeof args[1] === 'number' && args.length === 2 ? args[1] : undefined;
    const text = typeof args[0] === 'string' && forced !== undefined ? args[0] : raw;
    for (const line of String(text).split('\n')) {
      this._pushLine(segment(line, forced));
    }
    this.render();
  }

  /** Append a pre-built segment array to the scrollback, trimming history. */
  _pushLine(segs) {
    this.logLines.push(segs);
    if (this.logLines.length > this.maxLog) {
      this.logLines.splice(0, this.logLines.length - this.maxLog);
    }
  }

  clear() {
    this.logLines = [];
    this.render();
  }

  /**
   * Decorative bordered block, written straight into the scrollback.
   * Used for vote confirmations so they feel like a machine stamping a ticket.
   */
  flash(title, bodyLines = [], options = {}) {
    const color = options.color || C.gold;
    const cleanTitle = demojify(stripAnsi(title));
    const body = bodyLines.map((l) => demojify(stripAnsi(l)));
    const inner = Math.min(
      this.cols - 8,
      Math.max(width(cleanTitle) + 2, ...body.map((l) => width(l) + 2), 22),
    );
    const bar = '\u2501'.repeat(inner); // heavy horizontal
    const pad = (s, c) => ({ t: ` ${truncate(s, inner - 2).padEnd(inner - 2)} `, c });

    // A stamped ticket in heavy box-drawing; the title carries the accent colour,
    // the body stays readable, and a ♪ tally line gets the green "ok" tone.
    // Avoid a doubled star when the caller already prefixed one.
    const star = cleanTitle.startsWith('\u2605') ? cleanTitle : `\u2605 ${cleanTitle}`;
    this._pushLine([{ t: `\u250f${bar}\u2513`, c: color }]);
    this._pushLine([{ t: '\u2503', c: color }, pad(star, color), { t: '\u2503', c: color }]);
    this._pushLine([{ t: '\u2503', c: color }, { t: ' '.repeat(inner), c: color }, { t: '\u2503', c: color }]);
    body.forEach((line, i) => {
      const tone = i === body.length - 1 && /vote|\u266a/i.test(line) ? C.ok : C.heading;
      this._pushLine([{ t: '\u2503', c: color }, pad(line, tone), { t: '\u2503', c: color }]);
    });
    this._pushLine([{ t: `\u2517${bar}\u251b`, c: color }]);
    this.render();
  }

  /**
   * Centered welcome card for the top of the session: a light rounded box with
   * the party name and a couple of info lines, so the accueil reads as a title
   * screen rather than a wall of left-aligned text.
   */
  banner(title, lines = [], options = {}) {
    const accent = options.color || C.gold;
    const clean = (s) => demojify(stripAnsi(s));
    const cTitle = clean(title);
    const body = lines.map(clean).filter((l) => l.length);
    const area = this.cols - 4; // usable width inside the frame
    const innerW = Math.min(area - 2, Math.max(cTitle.length, ...body.map((l) => l.length), 24) + 6);
    const indent = Math.max(0, Math.floor((area - (innerW + 2)) / 2));
    const pad = ' '.repeat(indent);

    const centered = (raw, textColor) => {
      const s = truncate(raw, innerW);
      const w = width(s);
      const l = Math.max(0, Math.floor((innerW - w) / 2));
      const r = Math.max(0, innerW - w - l);
      return [
        { t: pad, c: accent },
        { t: '\u2502', c: accent },
        { t: ' '.repeat(l), c: textColor },
        { t: s, c: textColor },
        { t: ' '.repeat(r), c: textColor },
        { t: '\u2502', c: accent },
      ];
    };

    this._pushLine([{ t: `${pad}\u256d${'\u2500'.repeat(innerW)}\u256e`, c: accent }]);
    this._pushLine(centered(`\u2605  ${cTitle}  \u2605`, C.heading));
    for (const line of body) this._pushLine(centered(line, C.text));
    this._pushLine([{ t: `${pad}\u2570${'\u2500'.repeat(innerW)}\u256f`, c: accent }]);
    this.render();
  }

  // -------------------------------------------------------------------------
  // input
  // -------------------------------------------------------------------------

  /**
   * Prompt inside the frame and wait for one line.
   *
   * Same contract as the plain reader: resolves the typed line without the
   * spaces around it, or null on Ctrl+D / EOF. A stray space after "n" must not
   * turn a "no" into the default answer.
   */
  ask(question) {
    if (!this.running) {
      return Promise.resolve(null);
    }
    this.promptText = question || '> ';
    this.input = '';
    this.render();
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  _submit() {
    const value = this.input.trim();
    this.input = '';
    this.promptText = '';
    const resolve = this._resolve;
    this._resolve = null;
    // Echo the typed line back into the scrollback so it reads like a transcript.
    if (value) {
      this._pushLine([
        { t: '\u276f ', c: C.prompt },
        { t: value, c: C.echo },
      ]);
    }
    this.render();
    if (resolve) resolve(value);
  }

  _handleData(chunk) {
    const text = chunk.toString('utf8');

    for (const ch of text) {
      if (this._resolve === null) continue;

      if (ch === '\r' || ch === '\n') {
        this._submit();
        continue;
      }
      if (ch === '\u0003') {
        // Ctrl+C: hand control back so the caller can clean up.
        process.emit('SIGINT');
        continue;
      }
      if (ch === '\u0004') {
        const resolve = this._resolve;
        this._resolve = null;
        this.promptText = '';
        this.input = '';
        if (resolve) resolve(null);
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {
        this.input = this.input.slice(0, -1);
        this.render();
        continue;
      }
      if (ch === '\u001b') continue; // ignore escape sequences (arrows, etc.)
      if (ch >= ' ') {
        this.input += ch;
        this.render();
      }
    }
  }

  /**
   * Burst of confetti across the log area. Purely decorative: it draws over the
   * buffer for a moment, then the normal frame resumes.
   */
  async confetti(durationFrames = 14) {
    if (!this.running) return;

    const cols = this.cols;
    const rows = this.rows;
    const palette = [C.gold, C.red, C.blue, C.green, C.snowNear, C.amber];
    const shapes = ['\u2726', '\u2727', '*', '+', '\u00b7', '\u2217'];
    const parts = [];
    for (let i = 0; i < Math.round(cols * 0.6); i++) {
      parts.push({
        x: Math.random() * cols,
        y: -Math.random() * 6,
        vy: 0.5 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.7,
        ch: shapes[(Math.random() * shapes.length) | 0],
        fg: palette[(Math.random() * palette.length) | 0],
      });
    }

    for (let f = 0; f < durationFrames && this.running; f++) {
      const buf = this._cell(cols, rows);
      const sepY = rows - 4;

      for (const p of parts) {
        p.y += p.vy;
        p.x += p.vx;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (y >= 0 && y < sepY && x > 0 && x < cols - 1) {
          buf[y][x] = { ch: p.ch, fg: p.fg };
        }
      }

      // Keep the candy-cane rails during the burst.
      for (let y = 1; y < sepY; y++) {
        const col = this._stripe(y);
        buf[y][0] = { ch: '\u2551', fg: col };
        buf[y][cols - 1] = { ch: '\u2551', fg: col };
      }

      this._flush(buf);
      await sleep(55);
    }

    this.render();
  }

  // -------------------------------------------------------------------------
  // drawing
  // -------------------------------------------------------------------------

  _cell(w, h) {
    return Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', fg: C.dim })));
  }

  _put(buf, x, y, text, color) {
    const row = buf[y];
    if (!row) return;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const cx = x + i;
      if (cx >= 0 && cx < row.length) row[cx] = { ch: chars[i], fg: color };
    }
  }

  /** Paint an array of {t, c} segments at (x, y), clipping to maxWidth cells. */
  _putSegs(buf, x, y, segs, maxWidth) {
    const row = buf[y];
    if (!row) return;
    let cx = x;
    const limit = x + maxWidth;
    for (const seg of segs) {
      for (const ch of [...seg.t]) {
        if (cx >= limit || cx >= row.length) return;
        if (cx >= 0) row[cx] = { ch, fg: seg.c };
        cx++;
      }
    }
  }

  /** Barber-pole colour for frame chrome: scrolling red / white candy stripes. */
  _stripe(i) {
    return (i + this.frames) % 4 < 2 ? C.red : C.snowNear;
  }

  /** Paint the permanent lit mini tree with its (top-left) corner at ox, oy. */
  _drawTree(buf, ox, oy) {
    const star = this.frames % 6 < 3 ? C.gold : C.snowNear;
    MINI_TREE.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === ' ') continue;
        let col = C.green;
        if (ch === '*') col = star;
        else if (ch === '\u2588') col = C.trunk;
        this._put(buf, ox + i, oy + r, ch, col);
      }
    });
    // Twinkling baubles hung on the branches.
    TREE_BAUBLES.forEach(([r, c], k) => {
      const col = XMAS[(k + ((this.frames / 4) | 0)) % XMAS.length];
      this._put(buf, ox + c, oy + r, 'o', col);
    });
  }

  _makeSnow() {
    const cols = this.cols;
    const rows = this.rows;
    const flakes = [];
    const count = Math.round(cols * 0.6);
    for (let i = 0; i < count; i++) {
      const layer = i % 3;
      // Roughly one flake in ten is a coloured ornament flake for extra sparkle.
      const ornament = Math.random() < 0.1;
      flakes.push({
        x: Math.random() * cols,
        y: Math.random() * rows,
        vy: 0.1 + layer * 0.16,
        phase: Math.random() * Math.PI * 2,
        amp: 0.35 + Math.random() * 1.2,
        ch: ornament ? '*' : FLAKES[(Math.random() * FLAKES.length) | 0],
        fg: ornament
          ? [C.red, C.gold, C.blue, C.green][(Math.random() * 4) | 0]
          : [C.snowFar, C.snowMid, C.snowNear][layer],
      });
    }
    return flakes;
  }

  _stepSnow() {
    const cols = this.cols;
    const rows = this.rows;
    const t = this.frames * 120;
    for (const f of this.snow) {
      f.y += f.vy;
      f.x += Math.sin(t / 700 + f.phase) * f.amp * 0.15;
      if (f.y >= rows) {
        f.y -= rows;
        f.x = Math.random() * cols;
      }
      if (f.x < 0) f.x += cols;
      if (f.x >= cols) f.x -= cols;
    }
  }

  render() {
    if (!this.running) return;

    const cols = this.cols;
    const rows = this.rows;

    // Layout, from the bottom up: bottom border, prompt, status, separator.
    const sepY = rows - 4;
    const statusY = rows - 3;
    const promptY = rows - 2;

    this._stepSnow();

    const buf = this._cell(cols, rows);

    // --- snow first: it must never sit on top of text -----------------------
    // Keep the two chrome rows at the bottom clean, otherwise flakes drift
    // across the status bar and the prompt.
    const snowFloor = sepY - 1;
    for (const f of this.snow) {
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      if (y > snowFloor) continue;
      const row = buf[y];
      if (row && x >= 0 && x < row.length) row[x] = { ch: f.ch, fg: f.fg };
    }

    // --- frame --------------------------------------------------------------
    const hot = this.frames % 40 < 3;
    const frameColor = hot ? C.frameHot : C.frame;
    const innerW = cols - 2;

    // Top border: ╔═❄ J U K O R A M A ❄ oo oo oo party 375513 ❄╗
    // The title shimmers letter by letter and the filler is a string of blinking
    // Christmas-light bulbs; the party name sits at the far right.
    const letters = [...this.title];
    const titleSegs = [
      { t: '\u2554\u2550', c: frameColor },
      { t: '\u2745 ', c: hot ? C.frameHot : C.snowNear },
      ...letters.map((ch, i) => ({ t: ch, c: XMAS[(i + this.frames) % XMAS.length] })),
      { t: ' \u2745', c: hot ? C.frameHot : C.snowNear },
    ];
    const leftW = 2 + 2 + letters.length + 2;
    const sub = this.subtitle || '';
    const subChunk = sub ? ` ${sub} \u2745` : '';
    const subW = width(subChunk);
    const fill = Math.max(0, cols - 1 - leftW - subW);
    this._putSegs(buf, 0, 0, titleSegs, cols);
    for (let i = 0; i < fill; i++) {
      if (i % 3 === 1) {
        this._put(buf, leftW + i, 0, 'o', XMAS[(((i / 3) | 0) + this.frames) % XMAS.length]);
      } else {
        this._put(buf, leftW + i, 0, '\u2550', frameColor);
      }
    }
    if (subChunk) this._put(buf, leftW + fill, 0, subChunk, C.accent);
    if (buf[0][cols - 1]) buf[0][cols - 1] = { ch: '\u2557', fg: frameColor };

    // Side rails: animated candy-cane stripes.
    for (let y = 1; y < sepY; y++) {
      const col = this._stripe(y);
      buf[y][0] = { ch: '\u2551', fg: col };
      buf[y][cols - 1] = { ch: '\u2551', fg: col };
    }

    // --- log area -----------------------------------------------------------
    // A permanent lit tree lives in the top-right corner; narrow the log lines
    // that share its rows so text never runs underneath it.
    const treeW = MINI_TREE[0].length;
    const treeH = MINI_TREE.length;
    const treeX = cols - 1 - treeW - 1; // one-cell gap from the right rail
    const treeY = 1;

    const logTop = 1;
    const logBottom = sepY - 1; // inclusive
    const logHeight = Math.max(0, logBottom - logTop + 1);
    const visible = this.logLines.slice(-logHeight);
    for (let i = 0; i < visible.length; i++) {
      const yy = logTop + i;
      const inTree = yy >= treeY && yy < treeY + treeH;
      const maxW = inTree ? Math.max(4, treeX - 1 - 2) : cols - 4;
      this._putSegs(buf, 2, yy, visible[i], maxW);
    }

    // Tree painted after the log so it is always visible above the text.
    this._drawTree(buf, treeX, treeY);

    // --- separator: candy-cane rule + always-visible command hints -----------
    // The welcome help scrolls away, so keep the command cheat-sheet inlaid in
    // the separator rule where it is always in view.
    buf[sepY][0] = { ch: '\u2560', fg: frameColor };
    for (let x = 1; x < cols - 1; x++) buf[sepY][x] = { ch: '\u2550', fg: this._stripe(x) };
    buf[sepY][cols - 1] = { ch: '\u2563', fg: frameColor };
    const cmds = ['titre\u2192vote', 'liste', 'mesvotes', 'reset', 'quitter'];
    const hint = [{ t: ' \u2744 ', c: hot ? C.frameHot : C.snowNear }];
    cmds.forEach((cmd, i) => {
      if (i) hint.push({ t: ' \u00b7 ', c: C.dim });
      hint.push({ t: cmd, c: C.accent });
    });
    hint.push({ t: ' \u2744 ', c: hot ? C.frameHot : C.snowNear });
    const hintW = hint.reduce((n, s) => n + width(s.t), 0);
    if (hintW <= cols - 6) this._putSegs(buf, 3, sepY, hint, cols - 4);

    const stats = this.stats() || {};
    const spin = SPINNER[this.spinnerIndex];
    const sep = () => ({ t: '  \u00b7  ', c: C.dim });
    const statusSegs = [{ t: ' ', c: C.dim }, { t: spin, c: C.accent }, { t: ' ', c: C.dim }];
    if (stats.votes != null) {
      statusSegs.push({ t: `\u266a ${stats.votes}`, c: C.gold }, { t: ' votes', c: C.muted }, sep());
    }
    if (stats.session != null) {
      const hotCount = stats.session > 0;
      statusSegs.push({ t: `${stats.session}`, c: hotCount ? C.ok : C.muted }, { t: ' cette session', c: C.muted }, sep());
    }
    if (stats.mode) statusSegs.push({ t: stats.mode, c: C.amber }, sep());
    statusSegs.push({ t: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), c: C.muted });

    const statusW = statusSegs.reduce((n, s) => n + width(s.t), 0);
    // Little animated garland on the right: it breathes with the frame counter.
    const garlandLen = Math.max(0, Math.min(18, cols - statusW - 4));
    this._put(buf, 0, statusY, '\u2551', frameColor);
    this._putSegs(buf, 1, statusY, statusSegs, cols - 3);
    for (let i = 0; i < garlandLen; i++) {
      const phase = (i + this.frames) % 6;
      const ch = phase < 3 ? '\u2022' : '\u00b7';
      // Alternate the lit bulbs between red and gold for a fairy-light feel.
      const col = phase < 3 ? ((i % 2) ? C.red : C.gold) : C.dim;
      this._put(buf, cols - 1 - garlandLen + i, statusY, ch, col);
    }
    this._put(buf, cols - 1, statusY, '\u2551', frameColor);

    // --- prompt -------------------------------------------------------------
    // Replace a bare "> " with a sharp chevron; keep any custom question text.
    const rawPrompt = this.promptText || '> ';
    const prompt = rawPrompt === '> ' ? '\u276f ' : rawPrompt;
    // Keep the tail visible when the line overflows.
    const room = cols - 4 - width(prompt);
    const shown = [...this.input].slice(-Math.max(1, room)).join('');
    this._put(buf, 0, promptY, '\u2551', frameColor);
    this._put(buf, 1, promptY, prompt, C.prompt);
    const inputX = 1 + width(prompt);
    if (shown) {
      this._put(buf, inputX, promptY, shown, C.heading);
    } else if (this._resolve !== null && rawPrompt === '> ') {
      // Dim placeholder so a newcomer knows what to type. The command list lives
      // in the separator bar now, so this just nudges toward a song title. Only
      // on the main prompt: behind a question ("Tout retirer ? [O/n]") it would
      // suggest typing a song title as the answer.
      const hint = 'tape le titre d\u2019une chanson\u2026';
      this._put(buf, inputX, promptY, truncate(hint, room), C.dim);
    }
    // Cursor block, blinking like a terminal should. Only while typing, so it
    // never sits on top of the dim placeholder hint.
    const cursorX = inputX + width(shown);
    if (shown && this._resolve !== null && this.frames % 8 < 4 && cursorX < cols - 1) {
      buf[promptY][cursorX] = { ch: '\u2588', fg: C.prompt };
    }
    this._put(buf, cols - 1, promptY, '\u2551', frameColor);

    // --- bottom border: candy-cane too --------------------------------------
    buf[rows - 1][0] = { ch: '\u255a', fg: frameColor };
    for (let x = 1; x < cols - 1; x++) buf[rows - 1][x] = { ch: '\u2550', fg: this._stripe(x) };
    buf[rows - 1][cols - 1] = { ch: '\u255d', fg: frameColor };

    // --- flush --------------------------------------------------------------
    this._flush(buf);
  }

  /** Paint a whole buffer to the terminal in one write. */
  _flush(buf) {
    // CRT feel: dim every other row (scanlines), plus an occasional whole-frame
    // brightness dip, as if the phosphor can't quite hold steady.
    const flicker = this.scanlines && this.frames % 53 === 0;
    let out = `${E}H`;
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
      const dim = flicker || (this.scanlines && y % 2 === 1);
      out += `${dim ? DIM : ''}${line}${RESET}`;
      if (y < buf.length - 1) out += '\n';
    }
    process.stdout.write(out);
  }
}

module.exports = { CrtScreen, stripAnsi, width, C, fg, RESET, BOLD, DIM };
