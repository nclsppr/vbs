// The Christmas tree. It is drawn once, on a 58 × 100 grid scaled to its
// canvas; a second canvas on top carries what moves: the glow of the fairy
// lights, the star, and glints on the baubles.

import { rng, clamp, mix, fit, glowSprite } from './util.mjs';

const GRID = 58;
const CX = GRID / 2;
const APEX = 14;
const FOOT = 84;
const TIERS = 9;
const STAR = { x: CX, y: 8.6, outer: 5, inner: 2.1 };
const NEEDLES = ['#0b3d24', '#0f4f2d', '#156538', '#1c7a43', '#27904f'];
const LIGHTS = ['#fff1b8', '#ff5a64', '#52e08c', '#5cb8ff', '#ffb24d', '#ff7fe0'];
const BAUBLES = ['#e0263a', '#f2b632', '#2f7fe0', '#dfe4ee', '#c23bd0'];
const GIFTS = [
  [8.5, 85.5, 11, 11.5, '#c81e3a', '#ffd34d'],
  [31, 87, 10.5, 10, '#2b63d9', '#e8ecf5'],
  [18.5, 89.5, 8, 7.5, '#1f8f5a', '#ffffff'],
  [40.5, 90.5, 7.5, 6.5, '#8a35c9', '#ffd34d'],
];

/** Tiers of boughs from the top down; each starts well inside the one above. */
function shapeTiers() {
  const tiers = [];
  for (let i = 0; i < TIERS; i += 1) {
    const f = (i + 1) / TIERS;
    tiers.push({ bottom: APEX + (FOOT - APEX) * f ** 0.9, half: 3.4 + 15 * f ** 0.95 });
  }
  tiers.forEach((tier, i) => {
    const above = i ? tiers[i - 1].bottom : APEX;
    tier.top = Math.max(APEX, above - (tier.bottom - above) * 1.15);
    tier.sag = 1.2 + tier.half * 0.1;
  });
  return tiers;
}

/** Height of a tier's hem across its width (a runs from -1 to 1). */
const hem = (tier, a) => tier.bottom + tier.sag * (1 - a * a);

const along = (from, bend, to, u) => {
  const v = 1 - u;
  return [
    v * v * from[0] + 2 * v * u * bend[0] + u * u * to[0],
    v * v * from[1] + 2 * v * u * bend[1] + u * u * to[1],
  ];
};

/** The dark underside of a tier, so no sky shows between its boughs. */
function tierShadow(ctx, tier) {
  const shoulder = tier.top + (tier.bottom - tier.top) * 0.75;
  const points = Math.round(tier.half * 0.9) + 3;
  ctx.beginPath();
  ctx.moveTo(CX, tier.top);
  ctx.quadraticCurveTo(CX - tier.half * 0.35, shoulder, CX - tier.half, tier.bottom);
  for (let k = 1; k <= points; k += 1) {
    const a = -1 + (2 * k) / points;
    const dip = a - 1 / points;
    ctx.lineTo(CX + dip * tier.half, hem(tier, dip) - 1.3);
    ctx.lineTo(CX + a * tier.half, hem(tier, a));
  }
  ctx.quadraticCurveTo(CX + tier.half * 0.35, shoulder, CX, tier.top);
  ctx.closePath();
  ctx.fill();
}

/** Boughs of one tier, the ones reaching sideways first, the ones facing us last. */
function boughs(tier, random) {
  const count = Math.round(tier.half * 1.5) + 5;
  const list = [];
  for (let k = 0; k < count; k += 1) {
    const a = clamp(-1 + (2 * (k + 0.5)) / count + (random() - 0.5) * 0.12, -1, 1);
    const from = [CX + a * tier.half * 0.14, tier.top + (tier.bottom - tier.top) * (0.2 + 0.3 * random())];
    const tip = [CX + a * tier.half * (0.96 + 0.1 * random()), hem(tier, a) + (random() - 0.5) * 0.9];
    const bend = [from[0] + (tip[0] - from[0]) * 0.62, from[1] + (tip[1] - from[1]) * 0.22 - Math.abs(a) * 1.1];
    list.push({ a, from, bend, tip });
  }
  return list.sort((p, q) => Math.abs(q.a) - Math.abs(p.a));
}

/** A bough is a spine with needles on both sides, shorter towards the tip. */
function needles(ctx, random, { from, bend, tip }, size) {
  const steps = Math.max(8, Math.round(Math.hypot(tip[0] - from[0], tip[1] - from[1]) / 0.32));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const [x, y] = along(from, bend, tip, u);
    const heading = Math.atan2(
      (1 - u) * (bend[1] - from[1]) + u * (tip[1] - bend[1]),
      (1 - u) * (bend[0] - from[0]) + u * (tip[0] - bend[0]),
    );
    for (const side of [-1, 1]) {
      const angle = heading + side * (0.5 + 0.45 * random());
      const rise = Math.sin(angle);
      const length = size * (1 - 0.6 * u) * (0.7 + 0.6 * random());
      // Needles that point up catch the light.
      ctx.strokeStyle = NEEDLES[clamp(Math.floor(2.2 - rise * 2 + random() * 1.6), 0, NEEDLES.length - 1)];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + rise * length);
      ctx.stroke();
    }
  }
}

/**
 * Snow lying along the end of a bough: one smooth cushion, thickest in its
 * middle, painted as a blue shade with white on top.
 */
function snowOn(ctx, random, { from, bend, tip }, thick) {
  const start = 0.58 + random() * 0.2;
  const spine = [];
  for (let k = 0; k <= 8; k += 1) spine.push(along(from, bend, tip, start + ((0.99 - start) * k) / 8));
  // Snow does not hold on a bough that hangs almost straight down.
  const run = spine[8][0] - spine[0][0];
  const fall = spine[8][1] - spine[0][1];
  const length = Math.hypot(run, fall);
  if (Math.abs(run) < length * 0.5) return;
  // The side of the bough that faces the sky.
  const up = run > 0 ? [fall / length, -run / length] : [-fall / length, run / length];
  const swell = spine.map((point, k) => thick * Math.sin((k / 8) * Math.PI) ** 0.6 * (0.8 + 0.4 * random()));
  for (const [color, drop] of [['#b7cbf7', 0.22], ['#ffffff', 0]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    spine.forEach(([x, y], k) => ctx.lineTo(x + up[0] * swell[k], y + up[1] * swell[k] + drop));
    for (let k = 8; k >= 0; k -= 1) ctx.lineTo(spine[k][0] - up[0] * swell[k] * 0.25, spine[k][1] - up[1] * swell[k] * 0.25 + drop);
    ctx.closePath();
    ctx.fill();
  }
}

function foliage(ctx, tiers, random, px) {
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.2;
  // From the ground up, so each tier hangs over the one below.
  for (let i = TIERS - 1; i >= 0; i -= 1) {
    const tier = tiers[i];
    ctx.save();
    ctx.shadowColor = 'rgba(0, 10, 4, 0.55)';
    ctx.shadowBlur = 2.4 * px;
    ctx.shadowOffsetY = 1.1 * px;
    ctx.fillStyle = '#07301c';
    tierShadow(ctx, tier);
    ctx.restore();
    const size = 1.5 + tier.half * 0.05;
    for (const bough of boughs(tier, random)) {
      needles(ctx, random, bough, size);
      if (Math.abs(bough.a) > 0.3 && random() < 0.7) snowOn(ctx, random, bough, 0.42 + tier.half * 0.026);
    }
  }
}

/** Where a string sags between two points. */
const slack = (from, to, sag) => [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + sag];

/** Calls `place(x, y)` every `gap` along a string sagging between two points. */
function string(from, to, sag, gap, place) {
  const bend = slack(from, to, sag);
  const count = Math.max(2, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / gap));
  for (let k = 0; k < count; k += 1) place(...along(from, bend, to, (k + 0.5) / count));
}

/** Fairy lights wind one way round the tree… */
function fairyLights(ctx, tiers, random) {
  const lights = [];
  const bulb = (x, y) => {
    const color = LIGHTS[lights.length % LIGHTS.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 0.17, 0, Math.PI * 2);
    ctx.fill();
    lights.push({ x, y, color, phase: random() * 6.28, speed: 1.1 + random() * 2.2 });
  };
  ctx.strokeStyle = '#052a17';
  ctx.lineWidth = 0.12;
  for (let i = 0; i < TIERS - 1; i += 1) {
    const from = [CX + tiers[i].half * 0.82, hem(tiers[i], 0.82) + 0.6];
    const to = [CX - tiers[i + 1].half * 0.86, hem(tiers[i + 1], -0.86) + 0.6];
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.quadraticCurveTo(...slack(from, to, 1.6), ...to);
    ctx.stroke();
    string(from, to, 1.6, 2.1, bulb);
  }
  const last = tiers[TIERS - 1];
  for (let a = -0.84; a <= 0.85; a += 0.21) bulb(CX + a * last.half, hem(last, a) + 0.3);
  return lights;
}

/** …and strings of golden beads wind the other way. */
function beads(ctx, tiers) {
  for (let i = 1; i < TIERS - 1; i += 2) {
    const from = [CX - tiers[i].half * 0.9, hem(tiers[i], -0.9) + 1.2];
    const to = [CX + tiers[i + 1].half * 0.92, hem(tiers[i + 1], 0.92) + 1];
    string(from, to, 2.4, 0.85, (x, y) => {
      ctx.fillStyle = '#e9ad2c';
      ctx.beginPath();
      ctx.arc(x, y, 0.37, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c0';
      ctx.beginPath();
      ctx.arc(x - 0.1, y - 0.11, 0.14, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function bauble(ctx, { x, y, r, color }) {
  ctx.strokeStyle = '#d8b35a';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(x, y - r - 0.9);
  ctx.lineTo(x, y - r);
  ctx.stroke();
  ctx.fillStyle = '#d9b24c';
  ctx.fillRect(x - 0.32, y - r - 0.34, 0.64, 0.52);

  const shade = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
  shade.addColorStop(0, mix(color, '#ffffff', 0.78));
  shade.addColorStop(0.35, color);
  shade.addColorStop(1, mix(color, '#000000', 0.58));
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Light bounced back by the snow, then the highlight.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 0.13;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, 0.25, 1.35);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.4, y - r * 0.45, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function baubles(ctx, tiers, random) {
  const hung = [];
  for (let i = 1; i < TIERS; i += 1) {
    const count = 2 + Math.floor(i * 0.6);
    for (let k = 0; k < count; k += 1) {
      const a = -0.8 + (1.6 * (k + 0.5 + (i % 2 ? 0.22 : -0.22))) / count;
      const r = 1.15 + random() * 0.5;
      hung.push({
        x: CX + a * tiers[i].half * 0.92,
        y: hem(tiers[i], a) + 0.9 + r,
        r,
        color: BAUBLES[(i * 2 + k) % BAUBLES.length],
      });
    }
  }
  hung.forEach((item) => bauble(ctx, item));
  return hung;
}

function candyCanes(ctx, tiers) {
  for (const [i, a, flip] of [[2, -0.5, 1], [4, 0.42, -1], [5, -0.62, 1], [7, 0.05, -1], [8, -0.4, 1]]) {
    ctx.save();
    ctx.translate(CX + a * tiers[i].half, hem(tiers[i], a) - 0.6);
    ctx.scale(flip, 1);
    ctx.rotate(0.2);
    ctx.beginPath();
    ctx.moveTo(0, 3.1);
    ctx.lineTo(0, 0);
    ctx.arc(0.75, 0, 0.75, Math.PI, 0);
    ctx.lineWidth = 0.62;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.setLineDash([0.42, 0.5]);
    ctx.strokeStyle = '#e0263a';
    ctx.stroke();
    ctx.restore();
  }
}

/** Five points, each cut in a light and a dark facet. */
function star(ctx) {
  const { x, y, outer, inner } = STAR;
  ctx.fillStyle = '#b98422';
  ctx.fillRect(x - 0.4, y + 2.4, 0.8, 3.6);
  const points = [];
  for (let k = 0; k < 10; k += 1) {
    const radius = k % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
  }
  points.forEach((point, k) => {
    ctx.fillStyle = k % 2 ? '#e7a419' : '#ffe777';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(...point);
    ctx.lineTo(...points[(k + 1) % 10]);
    ctx.closePath();
    ctx.fill();
  });
  ctx.strokeStyle = '#fff6c4';
  ctx.lineWidth = 0.16;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, k) => (k ? ctx.lineTo(...point) : ctx.moveTo(...point)));
  ctx.closePath();
  ctx.stroke();
}

function trunk(ctx) {
  const bark = ctx.createLinearGradient(CX - 2.1, 0, CX + 2.1, 0);
  bark.addColorStop(0, '#3a2311');
  bark.addColorStop(0.4, '#6f4525');
  bark.addColorStop(1, '#2b190c');
  ctx.fillStyle = bark;
  ctx.fillRect(CX - 2.1, FOOT - 4, 4.2, 104 - FOOT);
}

function gift(ctx, random, [x, y, w, h, color, ribbon]) {
  const paper = ctx.createLinearGradient(x, 0, x + w, 0);
  paper.addColorStop(0, mix(color, '#ffffff', 0.2));
  paper.addColorStop(0.55, color);
  paper.addColorStop(1, mix(color, '#000000', 0.4));
  ctx.fillStyle = paper;
  ctx.fillRect(x, y + h * 0.2, w, h * 0.8);
  ctx.fillRect(x - 0.45, y, w + 0.9, h * 0.24);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(x, y + h * 0.24, w, 0.45);

  ctx.fillStyle = ribbon;
  ctx.fillRect(x + w * 0.42, y, w * 0.16, h);
  ctx.fillRect(x, y + h * 0.56, w, h * 0.12);

  // Snow on the lid, then the bow standing out of it.
  ctx.fillStyle = '#ffffff';
  for (let at = x - 0.2; at <= x + w + 0.2; at += 0.8) {
    ctx.beginPath();
    ctx.ellipse(at, y, 0.8, 0.38 + random() * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const side of [-1, 1]) {
    ctx.fillStyle = ribbon;
    ctx.beginPath();
    ctx.ellipse(x + w / 2 + side * w * 0.17, y - h * 0.1, w * 0.18, h * 0.1, side * -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(ribbon, '#000000', 0.32);
    ctx.beginPath();
    ctx.ellipse(x + w / 2 + side * w * 0.17, y - h * 0.1, w * 0.09, h * 0.045, side * -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ribbon;
  ctx.beginPath();
  ctx.arc(x + w / 2, y - h * 0.05, w * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

/** Paint the tree. Returns what the animated canvas needs, in grid units. */
export function paintTree(canvas) {
  const { ctx, w, density } = fit(canvas);
  const scale = w / GRID;
  const random = rng(1225);
  const tiers = shapeTiers();
  ctx.scale(scale, scale);

  trunk(ctx);
  foliage(ctx, tiers, random, scale * density);
  const lights = fairyLights(ctx, tiers, random);
  beads(ctx, tiers);
  const hung = baubles(ctx, tiers, random);
  candyCanes(ctx, tiers);
  star(ctx);
  GIFTS.forEach((box) => gift(ctx, random, box));
  return { lights, baubles: hung };
}

/** Returns `draw(t)`, to call on every frame with the time in seconds. */
export function createTreeLights(canvas, tree) {
  const { ctx, w, h } = fit(canvas);
  const scale = w / GRID;
  const glows = new Map(LIGHTS.map((color) => [color, glowSprite(color, 2.7 * scale)]));
  const halo = glowSprite('#ffd95e', 9 * scale);
  const GLINT = 0.75;

  return function draw(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const light of tree.lights) {
      const wave = 0.5 + 0.5 * Math.sin(t * light.speed + light.phase);
      const glow = glows.get(light.color);
      ctx.globalAlpha = 0.25 + 0.75 * wave * wave;
      ctx.drawImage(glow, light.x * scale - glow.width / 2, light.y * scale - glow.height / 2);
    }

    // The star breathes, and two thin rays turn slowly through it.
    const pulse = 0.72 + 0.28 * Math.sin(t * 1.9);
    ctx.save();
    ctx.translate(STAR.x * scale, STAR.y * scale);
    ctx.globalAlpha = pulse;
    ctx.drawImage(halo, -halo.width / 2, -halo.height / 2);
    ctx.rotate(t * 0.22);
    ctx.globalAlpha = 0.6 * pulse;
    ctx.drawImage(halo, -halo.width * 0.44, -halo.height * 0.03, halo.width * 0.88, halo.height * 0.06);
    ctx.drawImage(halo, -halo.width * 0.03, -halo.height * 0.44, halo.width * 0.06, halo.height * 0.88);
    ctx.restore();

    // Now and then a bauble catches the light.
    const turn = Math.floor(t / GLINT);
    const lucky = tree.baubles[(turn * 7919) % tree.baubles.length];
    const size = Math.sin(((t / GLINT) % 1) * Math.PI) * lucky.r * 1.5 * scale;
    const x = (lucky.x - lucky.r * 0.4) * scale;
    const y = (lucky.y - lucky.r * 0.45) * scale;
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 0.12 * scale);
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
}
