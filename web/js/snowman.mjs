// The snowman, turned towards the television with the remote in his hand.
// Drawn once, on an 80 × 100 grid scaled to its canvas.

import { rng, fit } from './util.mjs';

const GRID = 80;

function ball(ctx, x, y, r) {
  const snow = ctx.createRadialGradient(x - r * 0.42, y - r * 0.48, r * 0.1, x, y, r * 1.05);
  snow.addColorStop(0, '#ffffff');
  snow.addColorStop(0.5, '#eef3ff');
  snow.addColorStop(0.85, '#b9cbf3');
  snow.addColorStop(1, '#8aa3e0');
  ctx.fillStyle = snow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function coal(ctx, x, y, r) {
  ctx.fillStyle = '#14161c';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function twig(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function arms(ctx) {
  ctx.strokeStyle = '#4a2c14';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.3;
  // Right arm, raised behind him.
  twig(ctx, [[55, 44], [64, 39], [71, 31]]);
  ctx.lineWidth = 0.9;
  twig(ctx, [[66.5, 36.2], [71.5, 37.5]]);
  twig(ctx, [[69, 33.4], [68.2, 28.5]]);
  // Left arm, raised towards the television.
  ctx.lineWidth = 1.3;
  twig(ctx, [[28, 45], [21.5, 40], [18, 34]]);
  ctx.lineWidth = 0.9;
  twig(ctx, [[20.2, 37.8], [16, 38.8]]);

  // The remote, aimed at the set.
  ctx.save();
  ctx.translate(18, 33.6);
  ctx.rotate(0.5);
  ctx.fillStyle = '#1b1d24';
  ctx.beginPath();
  ctx.roundRect(-8.2, -2, 9.4, 4, 0.9);
  ctx.fill();
  ctx.fillStyle = '#ff3b4e';
  ctx.beginPath();
  ctx.arc(-6.6, -0.6, 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a90a0';
  for (const [x, y] of [[-4.6, -0.7], [-2.9, -0.7], [-1.2, -0.7], [-4.6, 0.8], [-2.9, 0.8], [-1.2, 0.8]]) {
    ctx.fillRect(x - 0.45, y - 0.4, 0.9, 0.8);
  }
  ctx.restore();
}

function scarf(ctx) {
  const stripes = (path) => {
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = '#d7263d';
    ctx.fillRect(0, 0, GRID, 100);
    ctx.strokeStyle = '#fff4f4';
    ctx.lineWidth = 1.15;
    for (let x = -40; x < GRID + 40; x += 4.2) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x + 26, 70);
      ctx.stroke();
    }
    ctx.restore();
  };
  // The tail first, lifted by the wind, then the band round the neck.
  stripes(() => {
    ctx.beginPath();
    ctx.moveTo(46, 33.5);
    ctx.bezierCurveTo(54, 35, 58, 41, 66, 39.5);
    ctx.lineTo(67.5, 44.8);
    ctx.bezierCurveTo(58, 47, 52, 41.5, 45, 39.6);
    ctx.closePath();
  });
  stripes(() => {
    ctx.beginPath();
    ctx.moveTo(28.6, 31.6);
    ctx.bezierCurveTo(34, 36.4, 45, 36.6, 50.6, 31.2);
    ctx.lineTo(52, 35.8);
    ctx.bezierCurveTo(45.5, 42, 33.4, 41.8, 27.4, 36.4);
    ctx.closePath();
  });
  // Fringe at the end of the tail.
  ctx.strokeStyle = '#d7263d';
  ctx.lineWidth = 0.55;
  for (let k = 0; k < 6; k += 1) {
    ctx.beginPath();
    ctx.moveTo(66.2 + k * 0.26, 39.9 + k * 0.92);
    ctx.lineTo(68.6 + k * 0.26, 39.5 + k * 0.92);
    ctx.stroke();
  }
}

function hat(ctx) {
  ctx.save();
  ctx.translate(40.5, 15.4);
  ctx.rotate(0.14);
  const felt = ctx.createLinearGradient(-9, 0, 9, 0);
  felt.addColorStop(0, '#3a3d48');
  felt.addColorStop(0.45, '#1c1e25');
  felt.addColorStop(1, '#090a0d');
  ctx.fillStyle = felt;
  ctx.beginPath();
  ctx.ellipse(0, 0, 13.4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-8.2, -13.5, 16.4, 13.6, 1.1);
  ctx.fill();
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(-8.2, -4.6, 16.4, 3.4);

  // Holly on the band.
  ctx.fillStyle = '#1f8f4d';
  for (const turn of [-0.55, 0.5]) {
    ctx.save();
    ctx.translate(-3.2, -3);
    ctx.rotate(turn);
    ctx.beginPath();
    ctx.ellipse(0, -2.3, 1.25, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#ff5468';
  for (const [x, y] of [[-3.9, -2.4], [-2.5, -2.6], [-3.2, -1.5]]) {
    ctx.beginPath();
    ctx.arc(x, y, 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  // Snow settled on the top of the hat.
  ctx.fillStyle = '#ffffff';
  for (let x = -7.6; x <= 7.7; x += 1.7) {
    ctx.beginPath();
    ctx.ellipse(x, -13.5, 1.5, 1 + ((x * 7) % 3) * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function face(ctx) {
  coal(ctx, 33.4, 22.6, 1.25);
  coal(ctx, 40.2, 21.8, 1.35);
  for (const [x, y] of [[30.6, 29.6], [32.6, 31.4], [35.2, 32.3], [38, 32.3], [40.5, 31.3]]) coal(ctx, x, y, 0.7);

  const carrot = ctx.createLinearGradient(22, 0, 37, 0);
  carrot.addColorStop(0, '#ffab47');
  carrot.addColorStop(1, '#e8641a');
  ctx.fillStyle = carrot;
  ctx.beginPath();
  ctx.moveTo(36.6, 24.4);
  ctx.lineTo(21.5, 28.4);
  ctx.lineTo(36.9, 28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150, 60, 0, 0.5)';
  ctx.lineWidth = 0.3;
  for (const x of [27, 30, 33]) {
    ctx.beginPath();
    ctx.moveTo(x, 26.2 + (36.6 - x) * 0.04);
    ctx.lineTo(x + 0.5, 27.6);
    ctx.stroke();
  }
}

export function paintSnowman(canvas) {
  const { ctx, w } = fit(canvas);
  const random = rng(77);
  ctx.scale(w / GRID, w / GRID);

  arms(ctx);
  ball(ctx, 42, 75, 22);
  // The belly shades the ball it sits on.
  ctx.fillStyle = 'rgba(96, 124, 196, 0.32)';
  ctx.beginPath();
  ctx.ellipse(41.6, 62.2, 13.4, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ball(ctx, 41, 47, 15.5);
  ball(ctx, 39.8, 25.6, 11);
  scarf(ctx);

  for (const [x, y] of [[35.6, 44], [34.8, 50.6], [36, 57.2]]) coal(ctx, x, y, 1.2);
  face(ctx);
  hat(ctx);

  // A little texture, so the balls do not look like plastic.
  ctx.fillStyle = 'rgba(140, 165, 225, 0.2)';
  for (let i = 0; i < 46; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = random() * 19;
    ctx.beginPath();
    ctx.arc(42 + Math.cos(angle) * reach, 75 + Math.sin(angle) * reach, 0.3 + random() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
