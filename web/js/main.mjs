// Entry point: build the scene, the tube, the sound and the pages, then wire
// the controls on the front of the set.

import { $ } from './dom.mjs';
import { createScene } from './scene.mjs';
import { createTube } from './tube.mjs';
import { createSound } from './sound.mjs';
import { createApp } from './app.mjs';

const SETTINGS = 'jukorama.tv';

const scene = createScene();
const tube = createTube();
const sound = createSound();

const apply = {
  snow: (level) => scene.setSnow(level),
  crt: (level) => document.documentElement.style.setProperty('--crt', level),
  sound: (level) => {
    sound.setVolume(level);
    showTune();
  },
};

let tuneName = '';
function showTune() {
  $('tune-name').textContent = Number($('fader-sound').value) === 0 ? 'SON COUPÉ' : tuneName || 'MUSIQUE';
}

/** Settings survive a reload. A private window may refuse storage: carry on without. */
function saved() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS)) || {};
  } catch {
    return {};
  }
}

function save() {
  const settings = Object.fromEntries(Object.keys(apply).map((name) => [name, Number($(`fader-${name}`).value)]));
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch {
    // Nothing to do: the faders still work for this visit.
  }
}

const settings = saved();
for (const name of Object.keys(apply)) {
  const fader = $(`fader-${name}`);
  const move = () => {
    const level = Number(fader.value) / 100;
    fader.parentElement.style.setProperty('--v', level);
    apply[name](level);
  };
  if (Number.isFinite(settings[name])) fader.value = settings[name];
  fader.addEventListener('input', () => {
    move();
    save();
  });
  move();
}

sound.onTune((name) => {
  tuneName = name;
  showTune();
});
$('tune').addEventListener('click', () => sound.next());

createApp({ scene, tube, sound });
