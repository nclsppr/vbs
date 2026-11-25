// Album covers. Every track has a coloured tile with its initial; the picture
// fades in over it once the server has fetched it from Spotify.

import { el } from './dom.mjs';

// A few at a time: the keys must never wait behind a queue of pictures.
const AT_ONCE = 4;
// A picture that did not come is asked for again, twice, then the tile stays.
const RETRY_AFTER = [4000, 20000];

const initial = (title) => (title.match(/[\p{L}\p{N}]/u) || ['♪'])[0].toUpperCase();
const hue = (key) => [...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

/**
 * `list` is the scrolling list of rows. Its covers are fetched a little before
 * they scroll into view, and dropped if they scroll away before their turn.
 * Returns `cover(track, large)`; `large` is the cover of the voting page.
 */
export function createCovers(list) {
  const asks = new WeakMap(); // tile of a row → what fetches its picture, until it is asked for
  const near = new Set(); // tiles within a screen of the visible rows, still without picture
  const seen = new Set(); // those of them that are on screen: they go first
  let loading = 0;

  /** Keeps `tiles` equal to the watched tiles that are within `margin` of the list. */
  const watcher = (tiles, margin) =>
    new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) tiles.add(entry.target);
          else tiles.delete(entry.target);
        }
        pump();
      },
      { root: list, rootMargin: margin },
    );
  const watchers = [watcher(near, '100% 0px'), watcher(seen, '0px')];

  function watch(tile) {
    for (const each of watchers) each.observe(tile);
  }

  function pump() {
    while (loading < AT_ONCE && near.size) {
      const tile = [...near].find((candidate) => seen.has(candidate)) || near.values().next().value;
      near.delete(tile);
      seen.delete(tile);
      for (const each of watchers) each.unobserve(tile);
      const ask = asks.get(tile);
      asks.delete(tile);
      if (ask) ask();
    }
  }

  /**
   * Adds a picture to `tile` and returns what fetches it. After a failure,
   * `again(ask)` is called when it is time for another try.
   */
  function picture(tile, address, again) {
    const img = el('img', { alt: '', decoding: 'async' });
    let tries = 0;
    const ask = () => {
      loading += 1;
      img.src = address;
    };
    const settle = () => {
      loading -= 1;
      pump();
    };
    img.addEventListener('load', () => {
      img.classList.add('is-shown');
      settle();
    });
    img.addEventListener('error', () => {
      const delay = RETRY_AFTER[tries];
      tries += 1;
      if (delay) setTimeout(() => again(ask), delay);
      settle();
    });
    tile.append(img);
    return ask;
  }

  return function cover(track, large = false) {
    const address = `/api/cover?id=${encodeURIComponent(track.key.replace(/^spotify-/, ''))}`;
    const tile = el('span', { class: 'cover' }, el('span', { class: 'cover-letter', text: initial(track.title) }));
    tile.style.setProperty('--hue', hue(track.key));
    if (large) {
      // The small picture is there at once (the row has it), the full one
      // then comes over it.
      for (const source of [`${address}&size=small`, address]) picture(tile, source, (ask) => ask())();
    } else {
      // Fetched when the row comes close, and again from there after a failure.
      const wait = (ask) => {
        asks.set(tile, ask);
        watch(tile);
      };
      wait(picture(tile, `${address}&size=small`, wait));
    }
    return tile;
  };
}
