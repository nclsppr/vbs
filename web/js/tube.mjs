// The picture tube: its static, and switching it on and off. The state of the
// set is one class on <body>, which the style sheets animate.

import { $ } from './dom.mjs';

const STATES = ['tv-off', 'tv-starting', 'tv-on', 'tv-stopping'];
const WARM_UP = 760; // as long as the picture-on animation in tv.css
const COOL_DOWN = 620; // as long as picture-off
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTube() {
  const tube = $('tube');
  const canvas = $('tube-noise');
  const ctx = canvas.getContext('2d');
  const grain = ctx.createImageData(canvas.width, canvas.height);
  const pixels = new Uint32Array(grain.data.buffer);
  let zapping = 0;

  const set = (state) => {
    document.body.classList.remove(...STATES);
    document.body.classList.add(state);
  };

  setInterval(() => {
    if (document.hidden || document.body.classList.contains('tv-off')) return;
    for (let i = 0; i < pixels.length; i += 1) {
      const level = (Math.random() * 256) | 0;
      pixels[i] = 0xff000000 | (level << 16) | (level << 8) | level;
    }
    ctx.putImageData(grain, 0, 0);
  }, 70);

  return {
    async on() {
      set('tv-starting');
      await wait(WARM_UP);
      set('tv-on');
    },

    async off() {
      set('tv-stopping');
      await wait(COOL_DOWN);
      set('tv-off');
    },

    /** A burst of static, as when the channel changes. */
    zap() {
      tube.classList.add('is-static');
      clearTimeout(zapping);
      zapping = setTimeout(() => tube.classList.remove('is-static'), 170);
    },

    /** Static stays up while the set is looking for the party. */
    searching(flag) {
      tube.classList.toggle('is-searching', flag);
    },
  };
}
