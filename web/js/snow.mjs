// Falling snow, and the snow that stays where it lands: on the top of the
// television and on the ground. Far flakes drift behind the scene; near
// flakes fall in front of it, settle, and never cross the picture.

import { rng, noise, clamp } from './util.mjs';

const COLUMN = 3; // width of one column of lying snow, in CSS pixels
const FLUX = 0.05; // near flakes per second and per pixel of width, fader at full
const STICK = 0.3; // share of a flake's area that stays where it lands
const MEAN_AREA = 13.8; // average area of a near flake, in square pixels
const REPOSE = 0.8; // steepest slope lying snow can hold
const SPREAD = [0.1, 0.2, 0.4, 0.2, 0.1];

/** Rounded end of a drift: 0 at the very end, 1 from `round` inwards. */
const shoulder = (distance, round) => (distance >= round ? 1 : Math.sqrt(1 - (1 - Math.max(0, distance) / round) ** 2));

/**
 * Snow lying on something, as a row of columns between `left` and `right`.
 * `floor(x)` is what it lies on, `limit(x)` how high it may pile up and
 * `start(x)` how much is there when the page opens.
 */
function createDrift({ left, right, floor, limit, start, seed }) {
  const count = Math.max(2, Math.floor((right - left) / COLUMN) + 1);
  const floors = new Float32Array(count);
  const limits = new Float32Array(count);
  const starts = new Float32Array(count);
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = left + i * COLUMN;
    floors[i] = floor(x);
    limits[i] = limit(x);
    starts[i] = Math.min(start(x), limits[i]);
    heights[i] = starts[i];
  }
  const random = rng(seed);
  const sparkles = Array.from({ length: Math.round(count / 9) }, () => ({
    column: Math.floor(random() * count),
    depth: random(),
    phase: random() * 6.28,
    speed: 1.4 + random() * 2.6,
  }));
  const column = (x) => clamp(Math.round((x - left) / COLUMN), 0, count - 1);

  return {
    changed: true,
    covers: (x) => x >= left && x <= right,
    top: (x) => floors[column(x)] - heights[column(x)],

    /** A flake of this area has landed at x. */
    add(x, area) {
      const centre = column(x);
      for (let k = 0; k < SPREAD.length; k += 1) {
        const i = centre + k - 2;
        if (i >= 0 && i < count) heights[i] = Math.min(limits[i], heights[i] + (area * SPREAD[k]) / COLUMN);
      }
      this.changed = true;
    },

    /** Even snowfall between two abscissas, for places flakes are kept away from. */
    raise(from, to, height) {
      for (let i = column(from); i <= column(to); i += 1) heights[i] = Math.min(limits[i], heights[i] + height);
      this.changed = true;
    },

    /** Lumps soften and slopes that are too steep slide down. */
    settle() {
      for (let i = 1; i < count - 1; i += 1) {
        heights[i] += 0.12 * (heights[i - 1] + heights[i + 1] - 2 * heights[i]);
      }
      for (let i = 0; i < count - 1; i += 1) {
        const excess = Math.abs(heights[i] - heights[i + 1]) - REPOSE * COLUMN;
        if (excess > 0) {
          const slide = (excess / 2) * Math.sign(heights[i] - heights[i + 1]);
          heights[i] -= slide;
          heights[i + 1] += slide;
        }
      }
      for (let i = 0; i < count; i += 1) heights[i] = Math.min(limits[i], heights[i]);
    },

    /** How full the drift is, 0 as it starts and 1 at its limit. */
    get fill() {
      let room = 0;
      let used = 0;
      for (let i = 0; i < count; i += 1) {
        room += limits[i] - starts[i];
        used += heights[i] - starts[i];
      }
      return room > 0 ? clamp(used / room, 0, 1) : 0;
    },
    set fill(share) {
      for (let i = 0; i < count; i += 1) heights[i] = starts[i] + share * (limits[i] - starts[i]);
      this.changed = true;
    },

    paint(ctx, shade) {
      let peak = Infinity;
      let base = -Infinity;
      for (let i = 0; i < count; i += 1) {
        peak = Math.min(peak, floors[i] - heights[i]);
        base = Math.max(base, floors[i]);
      }
      const crest = () => {
        for (let i = 0; i < count; i += 1) ctx.lineTo(left + i * COLUMN, floors[i] - heights[i]);
      };
      const body = ctx.createLinearGradient(0, peak, 0, base);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(1, shade);
      ctx.beginPath();
      ctx.moveTo(left, floors[0] + 2);
      crest();
      for (let i = count - 1; i >= 0; i -= 1) ctx.lineTo(left + i * COLUMN, floors[i] + 2);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      // A line of light along the crest.
      ctx.beginPath();
      crest();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },

    glitter(ctx, t) {
      for (const sparkle of sparkles) {
        const height = heights[sparkle.column];
        const shine = Math.sin(t * sparkle.speed + sparkle.phase) ** 8;
        if (height < 5 || shine < 0.05) continue;
        const x = left + sparkle.column * COLUMN;
        const y = floors[sparkle.column] - height + 2 + sparkle.depth * Math.min(height - 4, 14);
        const arm = 1 + 2.2 * shine;
        ctx.globalAlpha = shine;
        ctx.fillRect(x - arm, y - 0.5, arm * 2, 1);
        ctx.fillRect(x - 0.5, y - arm, 1, arm * 2);
      }
      ctx.globalAlpha = 1;
    },
  };
}

/** The top edge of the cabinet, rounded corners included. */
function cabinetTop({ left, right, top, radius }) {
  return (x) => {
    const inset = radius - Math.min(x - left, right - x);
    return inset <= 0 ? top : top + radius - Math.sqrt(Math.max(0, radius * radius - inset * inset));
  };
}

export function createSnow() {
  const random = rng(2412);
  const drifts = document.createElement('canvas');
  let amount = 1;
  let scene = null;
  let roof = null;
  let ground = null;
  let far = [];
  let near = [];
  let owed = 0;
  let sinceSettle = 0;

  const farFlake = (y) => ({
    x: random() * scene.w,
    y,
    r: 0.5 + random() * 0.9,
    fall: 16 + random() * 30,
    swing: 0.4 + random() * 1.1,
    phase: random() * 6.28,
    tone: Math.floor(random() * 3),
  });

  const nearFlake = (y) => {
    const r = 1.3 + 2.1 * random() ** 2;
    return {
      x: -80 + random() * (scene.w + 160),
      y,
      r,
      fall: 40 + 26 * r,
      drift: 0.5 + r * 0.22,
      swing: 0.5 + random() * 1.4,
      phase: random() * 6.28,
      tone: Math.floor(random() * 3),
    };
  };

  function populate() {
    const wanted = Math.round((amount * scene.w * scene.h) / 4000);
    while (far.length < wanted) far.push(farFlake(random() * scene.h));
    far.length = wanted;
  }

  /** True once a near flake is done: it has landed, or it has left the sky. */
  function lands(flake) {
    const { tv, w, h } = scene;
    const foot = flake.y + flake.r;
    if (roof.covers(flake.x)) {
      const top = roof.top(flake.x);
      if (foot < top) return false;
      // Well below the crest, it was blown in from the side: it passes
      // behind the set and leaves nothing on the roof.
      if (foot - top < 16) roof.add(flake.x, STICK * Math.PI * flake.r * flake.r);
      return true;
    }
    if (flake.x > tv.left && flake.x < tv.right && flake.y > tv.top) return true;
    if (foot >= ground.top(flake.x)) {
      ground.add(flake.x, STICK * Math.PI * flake.r * flake.r);
      return true;
    }
    return flake.x < -120 || flake.x > w + 120 || flake.y > h + 10;
  }

  function paintDrifts() {
    const { w, h, density } = scene;
    const ctx = drifts.getContext('2d');
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, w, h);
    roof.paint(ctx, '#d9e5ff');
    ground.paint(ctx, '#c3d4fa');
    roof.changed = false;
    ground.changed = false;
  }

  return {
    /** New window size: lay the drifts out again, as full as they were. */
    layout(next) {
      const fill = roof ? [roof.fill, ground.fill] : [0, 0];
      scene = next;
      const { w, h, vh, tv } = scene;
      const lumps = noise(31, 22);
      const dunes = noise(47, 9);
      const edge = tv.radius * 0.22;
      const roofLeft = tv.left + edge;
      const roofRight = tv.right - edge;
      const ends = (x) => shoulder(Math.min(x - roofLeft, roofRight - x), 4.2 * vh);

      roof = createDrift({
        left: roofLeft,
        right: roofRight,
        floor: cabinetTop(tv),
        limit: (x) => 5 * vh * ends(x),
        start: (x) => vh * (1 + 0.9 * lumps((x - roofLeft) / (roofRight - roofLeft))) * ends(x),
        seed: 5,
      });
      ground = createDrift({
        left: 0,
        right: w,
        floor: () => h,
        limit: () => 10.5 * vh,
        start: (x) => vh * (5.6 + 1.9 * dunes(x / w)),
        seed: 6,
      });
      [roof.fill, ground.fill] = fill;

      drifts.width = Math.round(w * scene.density);
      drifts.height = Math.round(h * scene.density);
      far = [];
      populate();
      // Start with a sky already full of flakes, none of them over the set.
      near = [];
      for (let i = Math.round(amount * FLUX * (w + 160) * 9); i > 0; i -= 1) {
        const flake = nearFlake(random() * h);
        if (!lands(flake)) near.push(flake);
      }
      paintDrifts();
    },

    /** From 0 (clear night) to 1. What has settled stays. */
    setAmount(value) {
      amount = value;
      if (scene) populate();
    },

    step(dt, t) {
      const { w, h, tv } = scene;
      const gust = 20 * Math.sin(t * 0.13) + 13 * Math.sin(t * 0.31 + 1.7);

      for (const flake of far) {
        flake.y += flake.fall * dt;
        flake.x += (gust * 0.35 + Math.sin(t * flake.swing + flake.phase) * 8) * dt;
        if (flake.y > h + 4) Object.assign(flake, farFlake(-4));
        if (flake.x < -6) flake.x += w + 12;
        else if (flake.x > w + 6) flake.x -= w + 12;
      }

      owed += amount * FLUX * (w + 160) * dt;
      for (; owed >= 1; owed -= 1) near.push(nearFlake(-6));
      let kept = 0;
      for (const flake of near) {
        flake.y += flake.fall * dt;
        flake.x += (gust * flake.drift + Math.sin(t * flake.swing + flake.phase) * 16) * dt;
        if (!lands(flake)) {
          near[kept] = flake;
          kept += 1;
        }
      }
      near.length = kept;

      // No flake falls in front of the set, yet the ground there fills up too.
      if (amount > 0) ground.raise(tv.left, tv.right, amount * FLUX * MEAN_AREA * STICK * dt);

      sinceSettle += dt;
      if (sinceSettle > 0.25) {
        sinceSettle = 0;
        roof.settle();
        ground.settle();
        if (roof.changed || ground.changed) paintDrifts();
      }
    },

    drawFar(ctx) {
      ctx.fillStyle = '#dfe9ff';
      for (let tone = 0; tone < 3; tone += 1) {
        ctx.globalAlpha = 0.3 + tone * 0.2;
        ctx.beginPath();
        for (const flake of far) {
          if (flake.tone !== tone) continue;
          ctx.moveTo(flake.x + flake.r, flake.y);
          ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawNear(ctx, t) {
      const { w, h } = scene;
      ctx.drawImage(drifts, 0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      for (let tone = 0; tone < 3; tone += 1) {
        ctx.globalAlpha = 0.62 + tone * 0.19;
        ctx.beginPath();
        for (const flake of near) {
          if (flake.tone !== tone) continue;
          ctx.moveTo(flake.x + flake.r, flake.y);
          ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      roof.glitter(ctx, t);
      ground.glitter(ctx, t);
    },
  };
}
