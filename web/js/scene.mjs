// The winter scene around the television. The still parts are painted when
// the window changes size; one loop draws everything that moves.

import { $ } from './dom.mjs';
import { fit } from './util.mjs';
import { paintBackdrop } from './backdrop.mjs';
import { paintTree, createTreeLights } from './tree.mjs';
import { paintSnowman } from './snowman.mjs';
import { createSnow } from './snow.mjs';
import { createConfetti } from './confetti.mjs';

export function createScene() {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const snow = createSnow();
  // The badge of the logo is drawn once, at the top of the page: confetti borrows it.
  const badge = $('logo-mark').viewBox.baseVal;
  const confetti = createConfetti($('confetti'), $('logo-cut').getAttribute('d'), {
    x: badge.x,
    y: badge.y,
    w: badge.width,
    h: badge.height,
  });
  let far = null;
  let near = null;
  let tv = null;
  let animateBackdrop = null;
  let treeLights = null;
  let last = 0;

  function layout() {
    const cabinet = $('cabinet');
    const box = cabinet.getBoundingClientRect();
    far = fit($('snow-far'), 1.5);
    near = fit($('snow-near'), 1.5);
    tv = {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      radius: parseFloat(getComputedStyle(cabinet).borderTopLeftRadius),
    };
    const scene = { w: near.w, h: near.h, vh: near.h / 100, density: near.density, tv };
    animateBackdrop = paintBackdrop($('backdrop'), scene);
    // In a tall window the tree and the snowman are not displayed.
    treeLights = $('tree').clientWidth ? createTreeLights($('tree-lights'), paintTree($('tree'))) : null;
    if ($('snowman').clientWidth) paintSnowman($('snowman'));
    snow.layout(scene);
    confetti.layout();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;

    snow.step(dt, t);
    far.ctx.clearRect(0, 0, far.w, far.h);
    animateBackdrop(far.ctx, t);
    snow.drawFar(far.ctx);
    near.ctx.clearRect(0, 0, near.w, near.h);
    snow.drawNear(near.ctx, t);
    if (treeLights) treeLights(t);
    confetti.frame(dt);
  }

  let resizing = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizing);
    resizing = setTimeout(layout, 150);
  });
  layout();
  requestAnimationFrame(frame);

  return {
    /** Snowfall from 0 to 1. People who asked for less motion get a lighter fall. */
    setSnow(level) {
      snow.setAmount(level * (calm.matches ? 0.35 : 1));
    },

    /** Confetti from the top of the set. */
    celebrate() {
      confetti.burst((tv.left + tv.right) / 2, tv.top, calm.matches ? 40 : 260);
    },
  };
}
