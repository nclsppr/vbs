// Confetti thrown from the top of the television when a vote goes through:
// paper of all colours and, here and there, the badge of the logo.

import { fit } from './util.mjs';

const COLORS = ['#ff4b5c', '#45ef8f', '#ffe14d', '#62e6ff', '#ffffff', '#ff62d2'];
const BADGE_COLORS = ['#e8492d', '#ffffff'];
const BADGE_EVERY = 8; // one piece in eight is a badge

/** `badge` is the outline of the logo's badge, as SVG path data in a `box` wide and high. */
export function createConfetti(canvas, badge, box) {
  const outline = new Path2D(badge);
  let ctx = null;
  let w = 0;
  let h = 0;
  let pieces = [];

  return {
    layout() {
      ({ ctx, w, h } = fit(canvas, 1.5));
      pieces = [];
    },

    /** Throw `count` pieces up from (x, y). */
    burst(x, y, count) {
      for (let i = 0; i < count; i += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
        const speed = h * (0.35 + Math.random() * 0.8);
        const isBadge = i % BADGE_EVERY === BADGE_EVERY - 1;
        // Sized for the window, so a large screen gets a real shower. A badge
        // is larger than a piece of paper: its "j" has to be seen.
        const size = isBadge ? h * (0.024 + Math.random() * 0.014) : h * (0.007 + Math.random() * 0.008);
        pieces.push({
          x,
          y,
          vx: Math.cos(angle) * speed * 1.15,
          vy: Math.sin(angle) * speed,
          w: size,
          h: isBadge ? (size * box.h) / box.w : h * (0.004 + Math.random() * 0.005),
          turn: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * (isBadge ? 6 : 14),
          color: isBadge ? BADGE_COLORS[(i >> 3) % BADGE_COLORS.length] : COLORS[i % COLORS.length],
          isBadge,
          age: 0,
        });
      }
    },

    frame(dt) {
      if (!pieces.length) return;
      ctx.clearRect(0, 0, w, h);
      pieces = pieces.filter((piece) => piece.y < h + 40 && piece.age < 7);
      for (const piece of pieces) {
        piece.age += dt;
        piece.vy += h * 1.15 * dt;
        piece.vx *= 1 - 1.2 * dt;
        piece.vy *= 1 - 0.9 * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.turn += piece.spin * dt;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.turn);
        ctx.fillStyle = piece.color;
        if (piece.isBadge) {
          // A badge sways without ever turning its edge to the eye.
          ctx.scale(1, 0.72 + 0.28 * Math.cos(piece.age * 5 + piece.turn));
          ctx.scale(piece.w / box.w, piece.w / box.w);
          ctx.translate(-box.x - box.w / 2, -box.y - box.h / 2);
          ctx.fill(outline, 'evenodd');
        } else {
          // Paper flutters: it shows its face, then its edge.
          ctx.scale(1, Math.cos(piece.age * 9 + piece.turn));
          ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        }
        ctx.restore();
      }
    },
  };
}
