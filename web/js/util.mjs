// Small helpers shared by the drawing code.

/** Deterministic generator, so the scene looks the same on every visit. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D noise in [0, 1] over x in [0, 1): random values joined by cosine ramps. */
export function noise(seed, cells = 16) {
  const random = rng(seed);
  const values = Array.from({ length: cells + 1 }, random);
  return (x) => {
    const p = Math.min(0.999999, Math.max(0, x)) * cells;
    const i = Math.floor(p);
    const f = (1 - Math.cos((p - i) * Math.PI)) / 2;
    return values[i] * (1 - f) + values[i + 1] * f;
  };
}

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Blend two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t));
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Size a canvas to the box CSS gave it, at the screen's pixel density, and
 * return a context that draws in CSS pixels. Clears the canvas.
 */
export function fit(canvas, maxDensity = 2) {
  const density = Math.min(window.devicePixelRatio || 1, maxDensity);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * density));
  canvas.height = Math.max(1, Math.round(h * density));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(density, 0, 0, density, 0, 0);
  return { ctx, w, h, density };
}

/** Round glow fading to nothing, drawn once and stamped many times. */
export function glowSprite(color, radius) {
  const size = Math.max(2, Math.ceil(radius * 2));
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.12, color);
  glow.addColorStop(0.45, `${color}55`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}
