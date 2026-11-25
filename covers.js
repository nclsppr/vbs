'use strict';

/**
 * Pull a track's cover out of Spotify's public embed page.
 *
 * The picture lives on entity.visualIdentity.image in three sizes (64, 300 and
 * 640 px), with coverArt.sources and og:image kept as fallbacks. The file name
 * is the same on the public image CDN, which is what the page actually shows.
 */

// The voting page shows the cover at about 260 px: the 300 px file is enough
// and five times lighter than the 640 px one. Rows use the 64 px file, see
// sizedCover() below.
const WANTED_WIDTH = 300;

function decode(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function publicImage(url) {
  if (!url || typeof url !== 'string') return null;
  const hash = url.match(/\/image\/([a-z0-9]+)/i);
  if (hash) return `https://i.scdn.co/image/${hash[1]}`;
  if (/^https:\/\//i.test(url)) return url;
  return null;
}

const widthOf = (image) => image.maxWidth || image.width || 0;

function extractCoverUrl(html) {
  const source = String(html || '');
  const next = source.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  let images = [];
  if (next) {
    try {
      const entity = JSON.parse(next[1])?.props?.pageProps?.state?.data?.entity;
      images = (entity && (entity.visualIdentity?.image || entity.coverArt?.sources)) || [];
    } catch {
      images = [];
    }
  }
  if (!images.length) {
    const og = source.match(/property="og:image" content="([^"]+)"/);
    return og ? publicImage(decode(og[1])) : null;
  }
  // Smallest file that is still large enough; the largest one otherwise.
  const sorted = [...images].sort((a, b) => widthOf(a) - widthOf(b));
  const best = sorted.find((image) => widthOf(image) >= WANTED_WIDTH) || sorted[sorted.length - 1];
  return publicImage(best && best.url);
}

// One album picture comes in three sizes, told apart by the start of its name.
const SIZED = /\/image\/ab67616d0000(?:4851|1e02|b273)(?=[0-9a-f]+$)/;

/**
 * The same picture at 64 px (`small`: a row of the queue) or at 300 px. An
 * address that does not follow the naming is returned as it is.
 */
function sizedCover(address, small) {
  return String(address).replace(SIZED, `/image/ab67616d0000${small ? '4851' : '1e02'}`);
}

module.exports = { extractCoverUrl, sizedCover };
