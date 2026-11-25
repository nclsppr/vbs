// The night behind the television: sky, aurora, stars, moon, mountains and
// the string of big bulbs hung across the top of the window.

import { rng, noise, clamp, mix, fit, glowSprite } from './util.mjs';

const BULB_COLORS = ['#ff3b4e', '#ffc93c', '#3ddc6e', '#4aa8ff', '#ff6fd0'];

function sky(ctx, w, h) {
  const night = ctx.createLinearGradient(0, 0, 0, h);
  night.addColorStop(0, '#030616');
  night.addColorStop(0.45, '#0a1440');
  night.addColorStop(0.78, '#1d3076');
  night.addColorStop(1, '#2b448c');
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Curtains of light: thin vertical strips that swell from nothing at the hem,
 * glow green just above it and fade to violet higher up.
 */
function aurora(ctx, w, h) {
  const ribbons = [
    { seed: 11, y: 0.36, sway: 0.2, tall: 0.34, strength: 0.5 },
    { seed: 23, y: 0.22, sway: 0.14, tall: 0.24, strength: 0.38 },
    { seed: 37, y: 0.52, sway: 0.16, tall: 0.28, strength: 0.28 },
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const ribbon of ribbons) {
    const hem = noise(ribbon.seed, 5);
    const height = noise(ribbon.seed + 1, 9);
    const rays = noise(ribbon.seed + 2, 70);
    const folds = noise(ribbon.seed + 3, 14);
    for (let x = 0; x < w; x += 2) {
      const u = x / w;
      const bottom = h * (ribbon.y + ribbon.sway * (hem(u) - 0.5));
      const top = bottom - h * ribbon.tall * (0.5 + height(u));
      const alpha = ribbon.strength * (0.25 + 0.75 * rays(u)) * (0.35 + 0.65 * folds(u));
      const strip = ctx.createLinearGradient(0, bottom, 0, top);
      strip.addColorStop(0, 'rgba(70, 255, 170, 0)');
      strip.addColorStop(0.1, `rgba(70, 255, 170, ${alpha})`);
      strip.addColorStop(0.3, `rgba(60, 215, 215, ${alpha * 0.55})`);
      strip.addColorStop(0.65, `rgba(90, 120, 255, ${alpha * 0.22})`);
      strip.addColorStop(1, 'rgba(150, 70, 255, 0)');
      ctx.fillStyle = strip;
      ctx.fillRect(x, top, 2, bottom - top);
    }
  }
  ctx.restore();
}

/** Paints the stars and returns the brightest ones, which the scene makes twinkle. */
function starField(ctx, w, h, random) {
  const twinklers = [];
  const count = Math.round((w * h) / 4200);
  for (let i = 0; i < count; i += 1) {
    const x = random() * w;
    const y = random() ** 1.5 * h * 0.76;
    const radius = 0.35 + random() ** 3 * 1.3;
    ctx.globalAlpha = 0.3 + random() * 0.6;
    ctx.fillStyle = random() < 0.2 ? '#ffe9c4' : random() < 0.3 ? '#c9dcff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (radius > 1) twinklers.push({ x, y, size: radius * 3.4, phase: random() * 6.28, speed: 0.7 + random() * 1.8 });
  }
  ctx.globalAlpha = 1;
  return twinklers;
}

function moon(ctx, layout) {
  const { w, h, tv } = layout;
  const room = w - tv.right;
  const beside = room > 110;
  const radius = beside ? clamp(room * 0.2, 18, h * 0.055) : tv.top * 0.26;
  const x = beside ? tv.right + room / 2 : w * 0.84;
  const y = beside ? h * 0.235 : tv.top * 0.47;

  const halo = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 4.4);
  halo.addColorStop(0, 'rgba(190, 212, 255, 0.34)');
  halo.addColorStop(0.35, 'rgba(160, 190, 255, 0.11)');
  halo.addColorStop(1, 'rgba(160, 190, 255, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(x - radius * 4.4, y - radius * 4.4, radius * 8.8, radius * 8.8);

  const disc = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
  disc.addColorStop(0, '#fffef4');
  disc.addColorStop(0.6, '#eef0fa');
  disc.addColorStop(1, '#bcc7e6');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Seas, kept inside the disc.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(128, 142, 190, 0.26)';
  for (const [dx, dy, size] of [[-0.3, -0.25, 0.3], [0.28, -0.05, 0.22], [-0.05, 0.38, 0.26], [0.42, 0.45, 0.16], [-0.55, 0.25, 0.13]]) {
    ctx.beginPath();
    ctx.arc(x + dx * radius, y + dy * radius, size * radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function ridge(ctx, w, h, line, fill) {
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, line(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A fir far away: three dark tiers, each with snow on its left shoulder. */
function pine(ctx, x, foot, size) {
  ctx.fillStyle = '#0b1838';
  ctx.fillRect(x - size * 0.04, foot - size * 0.12, size * 0.08, size * 0.12);
  for (let tier = 0; tier < 3; tier += 1) {
    const top = foot - size * (1 - tier * 0.24);
    const bottom = foot - size * (0.56 - tier * 0.23);
    const half = size * (0.16 + tier * 0.075);
    ctx.fillStyle = '#0d2140';
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + half, bottom);
    ctx.lineTo(x - half, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(214, 228, 255, 0.82)';
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - half * 0.82, bottom - size * 0.02);
    ctx.lineTo(x - half * 0.3, bottom - size * 0.07);
    ctx.lineTo(x + half * 0.12, top + (bottom - top) * 0.52);
    ctx.closePath();
    ctx.fill();
  }
}

function land(ctx, w, h, random) {
  const far = noise(101, 9);
  const mid = noise(102, 6);
  const near = noise(103, 4);
  const farLine = (x) => h * (0.665 + 0.085 * far(x / w));
  const midLine = (x) => h * (0.765 + 0.045 * mid(x / w));
  const nearLine = (x) => h * (0.845 + 0.03 * near(x / w));

  // Snow under the moon is blue; white is kept for what lies in front.
  const mountains = ctx.createLinearGradient(0, h * 0.66, 0, h * 0.8);
  mountains.addColorStop(0, '#2a3f88');
  mountains.addColorStop(1, '#1b2c6b');
  ridge(ctx, w, h, farLine, mountains);

  const hills = ctx.createLinearGradient(0, h * 0.76, 0, h * 0.88);
  hills.addColorStop(0, '#4f6ab6');
  hills.addColorStop(1, '#354c97');
  ridge(ctx, w, h, midLine, hills);

  const pines = Math.round(w / 46);
  for (let i = 0; i < pines; i += 1) {
    const x = random() * w;
    pine(ctx, x, midLine(x) + h * 0.006, h * (0.035 + random() * 0.05));
  }

  const field = ctx.createLinearGradient(0, h * 0.84, 0, h);
  field.addColorStop(0, '#6c87cf');
  field.addColorStop(1, '#9fb7ea');
  ridge(ctx, w, h, nearLine, field);
}

function bow(ctx, x, y, size) {
  ctx.fillStyle = '#d7263d';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + side * size, y - size * 0.75, x + side * size * 1.25, y + size * 0.5, x, y);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * size * 0.75, y + size * 1.35);
    ctx.lineTo(x + side * size * 0.25, y + size * 1.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#ff5468';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function bulbPath(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(x - rx * 0.55, y - ry);
  ctx.bezierCurveTo(x - rx * 1.25, y - ry * 0.5, x - rx * 1.05, y + ry * 0.45, x, y + ry);
  ctx.bezierCurveTo(x + rx * 1.05, y + ry * 0.45, x + rx * 1.25, y - ry * 0.5, x + rx * 0.55, y - ry);
  ctx.closePath();
}

/** One lit bulb per colour, drawn once and stamped over the unlit ones. */
function litBulb(color, rx, ry) {
  const sprite = document.createElement('canvas');
  sprite.width = Math.ceil(rx * 2.8);
  sprite.height = Math.ceil(ry * 2.4);
  const ctx = sprite.getContext('2d');
  const x = sprite.width / 2;
  const y = sprite.height / 2;
  const light = ctx.createRadialGradient(x - rx * 0.2, y - ry * 0.25, 0, x, y, ry * 1.1);
  light.addColorStop(0, '#ffffff');
  light.addColorStop(0.3, mix(color, '#ffffff', 0.45));
  light.addColorStop(1, color);
  bulbPath(ctx, x, y, rx, ry);
  ctx.fillStyle = light;
  ctx.fill();
  return sprite;
}

/** Paints the wire, the bows and the unlit bulbs; returns what lights them. */
function garland(ctx, w, vh) {
  const swags = Math.max(2, Math.round(w / (40 * vh)));
  const span = w / swags;
  const top = 1.1 * vh;
  const sag = 3.3 * vh;
  const rx = 0.72 * vh;
  const ry = 1.08 * vh;
  const bulbs = [];

  ctx.strokeStyle = '#0a2a1c';
  ctx.lineWidth = Math.max(1.5, 0.22 * vh);
  ctx.beginPath();
  for (let i = 0; i < swags; i += 1) {
    ctx.moveTo(i * span, top);
    ctx.quadraticCurveTo((i + 0.5) * span, top + sag * 2, (i + 1) * span, top);
  }
  ctx.stroke();

  for (let i = 0; i < swags; i += 1) {
    const count = Math.max(3, Math.round(span / (4.6 * vh)));
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) / count;
      const x = (i + t) * span;
      const hang = top + sag * 4 * t * (1 - t);
      const color = BULB_COLORS[bulbs.length % BULB_COLORS.length];
      ctx.fillStyle = '#123f2a';
      ctx.fillRect(x - rx * 0.5, hang - 0.1 * vh, rx, 0.75 * vh);
      const y = hang + 0.55 * vh + ry;
      bulbPath(ctx, x, y, rx, ry);
      ctx.fillStyle = mix(color, '#05060c', 0.62);
      ctx.fill();
      bulbs.push({ x, y, color });
    }
  }
  for (let i = 0; i <= swags; i += 1) bow(ctx, i * span, top + 0.35 * vh, 1.25 * vh);

  const lit = new Map(BULB_COLORS.map((color) => [color, litBulb(color, rx, ry)]));
  const glow = new Map(BULB_COLORS.map((color) => [color, glowSprite(color, 4.4 * vh)]));
  return { bulbs, lit, glow };
}

/**
 * Paint the still part of the night on `canvas`. Returns `animate(ctx, t)`,
 * which draws the parts that move (twinkling stars, the garland's light) on
 * another canvas laid over this one.
 */
export function paintBackdrop(canvas, layout) {
  const { ctx, w, h } = fit(canvas, 1.5);
  const random = rng(20261224);
  sky(ctx, w, h);
  aurora(ctx, w, h);
  const stars = starField(ctx, w, h, random);
  moon(ctx, layout);
  land(ctx, w, h, random);
  const { bulbs, lit, glow } = garland(ctx, w, layout.vh);

  return function animate(front, t) {
    front.strokeStyle = '#ffffff';
    front.lineWidth = 1;
    for (const star of stars) {
      const shine = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
      const arm = star.size * (0.4 + 0.6 * shine);
      front.globalAlpha = 0.15 + 0.75 * shine;
      front.beginPath();
      front.moveTo(star.x - arm, star.y);
      front.lineTo(star.x + arm, star.y);
      front.moveTo(star.x, star.y - arm);
      front.lineTo(star.x, star.y + arm);
      front.stroke();
    }

    // A wave of light runs along the string, over a slow common breath.
    bulbs.forEach((bulb, i) => {
      const wave = 0.5 + 0.5 * Math.sin(t * 2.4 - i * 0.85);
      const level = 0.25 + 0.75 * wave * wave;
      const halo = glow.get(bulb.color);
      const body = lit.get(bulb.color);
      front.globalCompositeOperation = 'lighter';
      front.globalAlpha = level * 0.85;
      front.drawImage(halo, bulb.x - halo.width / 2, bulb.y - halo.height / 2);
      front.globalCompositeOperation = 'source-over';
      front.globalAlpha = level;
      front.drawImage(body, bulb.x - body.width / 2, bulb.y - body.height / 2);
    });
    front.globalAlpha = 1;
  };
}
