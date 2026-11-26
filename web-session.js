'use strict';

/**
 * Browser-facing session.
 *
 * The terminal and the page share one process, one ledger and the same vote
 * primitives. This module only turns those primitives into JSON. It never
 * talks HTTP and it never prints the prompts the terminal owns.
 */

const { sizedCover } = require('./covers.js');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** "1 vote", "3 votes": the page shows these sentences as they are. */
const votes = (count) => `${count} vote${count > 1 ? 's' : ''}`;

function createWebSession(deps) {
  // A launcher can lock the mode before the page loads (`--private`, or the
  // private .cmd). Otherwise the page asks once, before any account exists.
  let modeChosen = deps.isPrivate();
  let finishing = false;
  let tail = Promise.resolve();

  // Votes rotate the identity. Two requests at once would cast both as the
  // same account, and the second write would just overwrite the first.
  function exclusive(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  function requireMode() {
    if (!modeChosen) throw fail(409, 'Choisis d’abord un mode.');
  }

  // What the long calls are doing right now. The page polls this while it
  // waits, so it is read outside the queue above.
  let progress = null;

  async function indexQueue() {
    progress = { step: 'index', done: 0, total: 0 };
    try {
      await deps.buildIndex(deps.party, {
        quiet: true,
        onProgress: (done, total, waiting = false) => {
          progress = { step: 'index', done, total, waiting: Boolean(waiting) };
        },
      });
    } finally {
      progress = null;
    }
  }

  /** The queue, with the title cache brought up to date first when needed. */
  async function readQueue({ retryFailed = false } = {}) {
    const index = await deps.loadIndex();
    const queue = (await deps.db('GET', `/tracks/${deps.party}`)) || {};
    const known = index.party === deps.party ? index.tracks || {} : {};
    // A track nobody could name stays in the cache as a failure. Those are
    // only tried again when the television starts, not on every refresh.
    const stale = Object.keys(queue).some((key) => !known[key] || (retryFailed && !known[key].title));
    if (stale) await indexQueue();
    return queue;
  }

  async function boot() {
    if (!modeChosen) return { needsMode: true, maxBatch: deps.maxBatch };
    const queue = await readQueue({ retryFailed: true });
    const party = await deps.db('GET', `/parties/${deps.party}`);
    if (!party) throw fail(404, 'Party introuvable.');
    const votes = Object.values(queue).reduce((sum, track) => sum + (track.vote_count || 0), 0);
    warmCovers(queue).catch(() => {}); // in the background: the page does not wait for pictures
    return {
      needsMode: false,
      mode: deps.isPrivate() ? 'private' : 'normal',
      maxBatch: deps.maxBatch,
      sessionVotes: deps.sessionVotes().length,
      party: {
        name: party.name,
        code: party.short_id,
        country: party.country || '',
        tracks: Object.keys(queue).length,
        votes,
      },
    };
  }

  function chooseMode(isPrivate) {
    if (modeChosen) throw fail(409, 'Le mode est déjà choisi pour cette session.');
    if (typeof isPrivate !== 'boolean') throw fail(400, 'Choisis un mode.');
    if (isPrivate) deps.setPrivate();
    modeChosen = true;
    return { mode: deps.isPrivate() ? 'private' : 'normal' };
  }

  async function mineOfFactory() {
    const profile = new Set();
    // Private mode has no saved profile to ask about, and asking would create one.
    if (!deps.isPrivate() && deps.hasSavedProfile()) {
      for (const key of await deps.myVotedKeys(deps.party)) profile.add(key);
    }
    return (key) => (profile.has(key) ? 1 : 0) + deps.throwawayVotes(key).length;
  }

  async function listTracks(query) {
    requireMode();
    const queue = await readQueue();
    const index = await deps.loadIndex();
    const mineOf = await mineOfFactory();
    const rows = query
      ? deps.rankMatches(index, queue, query).slice(0, 30)
      : Object.entries(index.tracks || {})
          .filter(([key, track]) => track && track.title && queue[key])
          .map(([key, track]) => ({ key, ...track, voteCount: queue[key].vote_count || 0 }))
          .sort((a, b) => b.voteCount - a.voteCount || a.title.localeCompare(b.title, 'fr'));
    return rows.map((row) => ({
      key: row.key,
      id: row.id || String(row.key).replace(/^spotify-/, ''),
      title: row.title,
      artists: row.artists || '',
      votes: row.voteCount,
      rank: deps.rankOf(queue, row.key, row.voteCount),
      mine: mineOf(row.key),
    }));
  }

  function awarenessLines(title, profileAlreadyVoted, sessionCount) {
    const lines = [`Combien de votes pour « ${title} » ?`];
    if (deps.isPrivate()) {
      lines.push(
        'Chaque vote part d’un profil anonyme neuf, comme si tu rouvrais une fenêtre de navigation privée.',
      );
    } else if (profileAlreadyVoted) {
      lines.push(
        'Ton profil habituel a déjà son vote ici : chaque vote en plus part d’un profil jetable (comme une navigation privée). Ton profil enregistré n’est pas modifié, et ces profils jetables sont effacés en quittant.',
      );
    } else {
      lines.push(
        '1 = ton profil habituel. Au-delà, les votes supplémentaires partent de profils jetables (comme une navigation privée) : ton profil enregistré n’est pas modifié et ces comptes seront supprimés en quittant.',
      );
    }
    if (sessionCount) lines.push(`Tu en as déjà mis ${sessionCount} sur ce titre dans cette session.`);
    lines.push(`Entre 1 et ${deps.maxBatch}. Au-delà, relance pour en ajouter.`);
    return lines;
  }

  async function profileVoted(key) {
    if (deps.isPrivate() || !deps.hasSavedProfile()) return false;
    const { uid } = await deps.getIdentity();
    return deps.hasVoted(deps.party, key, uid);
  }

  async function trackDetail(key) {
    const rows = await listTracks('');
    const row = rows.find((item) => item.key === key);
    if (!row) throw fail(404, 'Cette chanson n’est pas dans la file.');
    const profileHasVoted = await profileVoted(key);
    return {
      ...row,
      profileHasVoted,
      awareness: awarenessLines(row.title, profileHasVoted, deps.sessionVoteCount(key)),
    };
  }

  async function describeMine(index, queue, key, count) {
    const meta = (index.tracks && index.tracks[key]) || {};
    let total = null;
    try {
      total = (await deps.votersOf(deps.party, key)).length;
    } catch {
      total = null;
    }
    return {
      key,
      title: meta.title || key,
      artists: meta.artists || '',
      count,
      total,
      queued: Boolean(queue[key]),
    };
  }

  async function me() {
    requireMode();
    const index = await deps.loadIndex();
    const queue = (await deps.db('GET', `/tracks/${deps.party}`)) || {};
    if (deps.isPrivate()) {
      const session = [];
      for (const [key, count] of deps.tally(deps.sessionVotes())) {
        session.push(await describeMine(index, queue, key, count));
      }
      return {
        mode: 'private',
        sessionCount: deps.sessionVotes().length,
        session,
        profile: null,
        extras: [],
        message: session.length ? '' : 'Aucun vote dans cette session.',
      };
    }

    // Reading the queue above needs a profile: after a reset, that is a new one.
    const profile = { uid: (await deps.getIdentity()).uid, votes: [] };
    for (const key of await deps.myVotedKeys(deps.party)) {
      profile.votes.push(await describeMine(index, queue, key, 1));
    }
    const extras = [];
    for (const [key, count] of deps.tally(deps.throwawayVotes())) {
      extras.push(await describeMine(index, queue, key, count));
    }
    return {
      mode: 'normal',
      sessionCount: deps.sessionVotes().length,
      session: [],
      profile,
      extras,
      message: '',
    };
  }

  async function vote(key, count) {
    requireMode();
    if (typeof key !== 'string' || !key || /[/\\]/.test(key)) throw fail(400, 'Titre invalide.');
    if (!Number.isInteger(count) || count < 1 || count > deps.maxBatch) {
      throw fail(400, `Choisis un nombre de 1 à ${deps.maxBatch}.`);
    }
    const index = await deps.loadIndex();
    const queue = (await deps.db('GET', `/tracks/${deps.party}`)) || {};
    const meta = index.tracks && index.tracks[key];
    if (!meta || !meta.title || !queue[key]) throw fail(404, 'Cette chanson n’est pas dans la file.');

    const profileHasVoted = await profileVoted(key);
    const mineBefore = deps.throwawayVotes(key).length + (profileHasVoted ? 1 : 0);
    const firstNeedsThrowaway = deps.isPrivate() ? mineBefore > 0 : profileHasVoted;
    progress = { step: 'vote', done: 0, total: count };
    let cast;
    try {
      cast = await deps.castVotes(deps.party, key, count, {
        firstNeedsThrowaway,
        onCast: (done, total) => {
          progress = { step: 'vote', done, total };
        },
      });
    } finally {
      progress = null;
    }
    if (!cast.added) throw fail(502, cast.error || 'Vote refusé.');

    let voters = null;
    try {
      voters = await deps.votersOf(deps.party, key);
    } catch {
      voters = null;
    }
    const total = voters ? voters.length : null;
    const mine = deps.throwawayVotes(key).length + (await profileVoted(key) ? 1 : 0);
    let partyVotes = null;
    try {
      const tracks = (await deps.db('GET', `/tracks/${deps.party}`)) || {};
      partyVotes = Object.entries(tracks).reduce(
        (sum, [trackKey, track]) => sum + (trackKey === key && total !== null ? total : track.vote_count || 0),
        0,
      );
    } catch {
      partyVotes = null;
    }
    return {
      title: meta.title,
      artists: meta.artists || '',
      added: cast.added,
      wanted: count,
      partialError: cast.added < count ? cast.error : null,
      mine,
      mineBefore,
      total,
      confirmed: Boolean(voters && cast.lastUid && voters.includes(cast.lastUid)),
      rank: total === null ? null : deps.rankOf(queue, key, total),
      partyVotes,
    };
  }

  async function withdraw(key) {
    requireMode();
    if (typeof key !== 'string' || !key) throw fail(400, 'Titre invalide.');
    const profileHasVoted = await profileVoted(key);
    const mine = deps.throwawayVotes(key).length + (profileHasVoted ? 1 : 0);
    if (!mine) throw fail(400, 'Aucun vote à retirer sur ce titre.');
    const { removed, failed } = await deps.withdrawMyVotesOn(deps.party, key, profileHasVoted);
    let totals = null;
    try {
      totals = (await deps.readTrackTotals(deps.party, [key])).totals;
    } catch {
      totals = null;
    }
    return {
      removed,
      failed,
      totals,
      message: `J’ai retiré ${votes(removed)} que tu avais mis sur ce titre.`,
    };
  }

  async function readTotalsSafely(keys, fallbackAuth) {
    if (!keys.length) return null;
    try {
      // Once the saved profile is gone, a plain read would create a new one
      // just to answer. Use an account this session already holds.
      if (!deps.isPrivate() && !deps.hasSavedProfile() && fallbackAuth) {
        return (await deps.asAccount(fallbackAuth, () => deps.readTrackTotals(deps.party, keys))).totals;
      }
      return (await deps.readTrackTotals(deps.party, keys)).totals;
    } catch {
      return null;
    }
  }

  async function performReset() {
    if (deps.isPrivate() || !deps.hasSavedProfile()) {
      const mine = deps.throwawayVotes();
      if (!mine.length) {
        const message = deps.isPrivate()
          ? 'Aucun vote à retirer : tu n’as rien voté dans cette session.'
          : 'Rien à retirer : ton profil vient déjà d’être remis à zéro.';
        return { removed: 0, failed: 0, totals: [], profileForgotten: false, message };
      }
      const keys = deps.tally(mine).map(([key]) => key);
      const { removed, failed } = await deps.undoVotes(deps.party, mine);
      const totals = await readTotalsSafely(keys, (removed[0] || failed[0] || mine[0]).auth);
      return {
        removed: removed.length,
        failed: failed.length,
        totals,
        profileForgotten: false,
        message: `J’ai retiré ${votes(removed.length)} que tu avais mis dans cette session.`,
      };
    }

    const extra = deps.throwawayVotes();
    const { uid } = await deps.getIdentity();
    const keys = await deps.myVotedKeys(deps.party);
    if (!keys.length && !extra.length) {
      return {
        removed: 0,
        failed: 0,
        totals: [],
        profileForgotten: false,
        empty: true,
        uid,
        message: `Aucun vote à retirer pour ${uid}.`,
      };
    }

    const touched = [...new Set([...keys, ...extra.map((vote) => vote.key)])];
    const undone = extra.length ? await deps.undoVotes(deps.party, extra) : { removed: [], failed: [] };
    let fromProfile;
    try {
      fromProfile = await deps.resetIdentity(deps.party);
    } catch (err) {
      throw fail(
        502,
        `Reset interrompu : ${votes(undone.removed.length)} en plus déjà retirés. Réessaie.`,
      );
    }
    deps.forgetSessionVotes(deps.sessionVotes().filter((vote) => !vote.throwaway));
    const totals = await readTotalsSafely(touched, null);
    deps.forgetIdentity();
    const removed = fromProfile + undone.removed.length;
    return {
      removed,
      failed: undone.failed.length,
      fromProfile,
      fromExtras: undone.removed.length,
      totals,
      profileForgotten: true,
      message: `J’ai retiré ${votes(removed)} de ton profil et de cette session.`,
    };
  }

  async function previewReset() {
    requireMode();
    if (deps.isPrivate()) {
      const mine = deps.throwawayVotes();
      const lines = [];
      for (const [key, count] of deps.tally(mine)) {
        lines.push({ key, count, title: await deps.titleFor(key) });
      }
      return {
        mode: 'private',
        count: mine.length,
        profiles: new Set(mine.map((vote) => vote.auth.uid)).size,
        lines,
        profileVotes: [],
        extras: lines,
        warning:
          'Ceci retire tous les votes de cette session privée. Ton profil enregistré, s’il existe, n’est pas touché.',
      };
    }

    const extra = deps.throwawayVotes();
    const extras = [];
    for (const [key, count] of deps.tally(extra)) {
      extras.push({ key, count, title: await deps.titleFor(key) });
    }
    let uid = null;
    const profileVotes = [];
    if (deps.hasSavedProfile()) {
      uid = (await deps.getIdentity()).uid;
      for (const key of await deps.myVotedKeys(deps.party)) {
        profileVotes.push({ key, title: await deps.titleFor(key) });
      }
    }
    return {
      mode: 'normal',
      uid,
      count: profileVotes.length + extra.length,
      profileVotes,
      extras,
      lines: extras,
      warning:
        'Ceci retire TOUS tes votes et SUPPRIME ton profil. Un nouveau profil pourra revoter pour les mêmes titres. Pour un seul titre, retire-le depuis sa fiche.',
    };
  }

  async function reset(body) {
    requireMode();
    if (!body || body.confirm !== 'reset') throw fail(400, 'Tape reset pour confirmer.');
    if (body.forgetProfile && !deps.isPrivate()) {
      const extra = deps.throwawayVotes();
      const keys = deps.hasSavedProfile() ? await deps.myVotedKeys(deps.party) : [];
      if (!keys.length && !extra.length && deps.hasSavedProfile()) {
        deps.forgetIdentity();
        return {
          removed: 0,
          failed: 0,
          totals: [],
          profileForgotten: true,
          message: 'Profil local oublié : un nouveau sera créé au besoin.',
        };
      }
    }
    return performReset();
  }

  async function leavePreview() {
    requireMode();
    if (deps.isPrivate()) {
      const lines = [];
      for (const [key, count] of deps.tally(deps.sessionVotes())) {
        lines.push({ key, count, title: await deps.titleFor(key) });
      }
      return {
        mode: 'private',
        lines,
        profileCount: 0,
        extraCount: deps.sessionVotes().length,
        warning: lines.length
          ? 'Après la fermeture, plus personne ne peut retirer ces votes. Tu peux les retirer maintenant.'
          : 'Rien à retirer.',
        forgetsProfile: false,
      };
    }
    const preview = await previewReset();
    const extraCount = preview.extras.reduce((sum, row) => sum + row.count, 0);
    return {
      mode: 'normal',
      lines: preview.profileVotes.map((row) => ({ ...row, count: 1 })).concat(preview.extras),
      profileCount: preview.profileVotes.length,
      extraCount,
      warning: extraCount
        ? `Tu quittes avec ${votes(preview.profileVotes.length)} sur ton profil et ${extraCount} en plus. Après la sortie, les votes en plus ne pourront plus être retirés.`
        : `Tu quittes avec ${votes(preview.profileVotes.length)} sur ton profil.`,
      forgetsProfile: preview.profileVotes.length + extraCount > 0,
    };
  }

  async function leave(body) {
    const result = await closeSession(body);
    // The server stops right after this answer: keep the cover addresses found so far.
    if (result.shutdown) await saveCovers().catch(() => {});
    return result;
  }

  async function closeSession(body) {
    if (finishing) return { shutdown: true, already: true };
    const keep = !body || body.keep !== false;
    if (!modeChosen) {
      finishing = true;
      return { shutdown: true, removed: 0, accountsDeleted: 0, kept: true };
    }

    if (deps.isPrivate()) {
      const keys = deps.tally(deps.sessionVotes()).map(([key]) => key);
      let removed = 0;
      if (!keep && deps.sessionVotes().length) {
        const before = deps.sessionVotes().length;
        const undone = await deps.undoVotes(deps.party, [...deps.sessionVotes()]);
        removed = before - deps.sessionVotes().length;
        if (deps.sessionVotes().length) {
          const totals = await readTotalsSafely(keys, (undone.failed[0] || undone.removed[0] || {}).auth);
          return {
            shutdown: false,
            removed,
            failed: deps.sessionVotes().length,
            totals,
            message: `Je n’ai pas pu retirer ${votes(deps.sessionVotes().length)}. Réessaie.`,
          };
        }
      }
      const totals = keys.length ? await readTotalsSafely(keys, deps.sessionVotes()[0] && deps.sessionVotes()[0].auth) : null;
      const accountsDeleted = await deps.closePrivateSession('web');
      finishing = true;
      return {
        shutdown: true,
        kept: keep,
        removed,
        failed: 0,
        totals,
        accountsDeleted: accountsDeleted || 0,
        profileForgotten: false,
      };
    }

    let outcome = null;
    if (!keep) {
      const preview = await previewReset();
      if (preview.profileVotes.length || preview.extras.length) outcome = await performReset();
    }
    const accountsDeleted = await deps.closeExtras();
    finishing = true;
    return {
      shutdown: true,
      kept: keep,
      removed: outcome ? outcome.removed : 0,
      failed: outcome ? outcome.failed : 0,
      totals: outcome ? outcome.totals : null,
      accountsDeleted: accountsDeleted || 0,
      profileForgotten: outcome ? outcome.profileForgotten : false,
      profileUntouched: deps.authFileExists(),
    };
  }

  // ---- covers -----------------------------------------------------------------
  //
  // The queue only knows Spotify ids. A cover takes two requests: Spotify's
  // page for the track gives the address of the picture, then the picture
  // itself. The bytes are served from here, so a browser behind the same proxy
  // shows them without talking to Spotify. None of this holds the vote lock,
  // and at most COVER_LANES requests run at once, to stay polite.
  const COVER_LANES = 4;
  const COVER_TROUBLE = 5; // lookups failing in a row before Spotify is left alone…
  const COVER_REST = 60000; // …for this long
  const coverAddresses = new Map(); // Spotify id → address, or null when Spotify has no picture
  const coverLookups = new Map(); // Spotify id → the lookup in flight
  const coverBytes = new Map(); // "id/small" or "id/full" → { type, bytes }
  const coverWaiters = { now: [], later: [] };
  let coverBusy = 0;
  let coverSave = null;
  let coversWarmed = false;
  let coverTrouble = 0;
  let coverRest = 0; // no lookup before this time

  /** `later` is the warm-up: the rows that are on screen go first. */
  async function inCoverLane(fn, later = false) {
    if (coverBusy < COVER_LANES) coverBusy += 1;
    else await new Promise((resolve) => coverWaiters[later ? 'later' : 'now'].push(resolve));
    try {
      return await fn();
    } finally {
      // The lane goes straight to whoever waits; it is only freed when nobody does.
      const next = coverWaiters.now.shift() || coverWaiters.later.shift();
      if (next) next();
      else coverBusy -= 1;
    }
  }

  /** One look at Spotify's page. When Spotify keeps failing, it is left alone for a while. */
  async function askSpotify(spotifyId) {
    if (Date.now() < coverRest) throw fail(502, 'Pochettes indisponibles pour le moment.');
    try {
      const address = await deps.fetchTrackArt(spotifyId);
      coverTrouble = 0;
      return address;
    } catch (err) {
      coverTrouble += 1;
      if (coverTrouble >= COVER_TROUBLE) {
        coverTrouble = 0;
        coverRest = Date.now() + COVER_REST;
      }
      throw err;
    }
  }

  /** Null when Spotify has no picture for the track; throws when it could not be asked. */
  function coverAddress(spotifyId, later = false) {
    if (coverAddresses.has(spotifyId)) return Promise.resolve(coverAddresses.get(spotifyId));
    if (!coverLookups.has(spotifyId)) {
      const lookup = inCoverLane(async () => {
        const index = await deps.loadIndex();
        const known = index.tracks && index.tracks[`spotify-${spotifyId}`];
        const saved = (known && known.image) || null;
        const address = saved || (await askSpotify(spotifyId));
        coverAddresses.set(spotifyId, address);
        if (address && !saved) saveCoversSoon();
        return address;
      }, later).finally(() => coverLookups.delete(spotifyId));
      coverLookups.set(spotifyId, lookup);
    }
    return coverLookups.get(spotifyId);
  }

  // Addresses found on the way go into the title cache, so the next launch has
  // them at once: one write for a burst of lookups, taken in turn with the
  // calls that rebuild that cache.
  function saveCoversSoon() {
    if (coverSave) return;
    coverSave = setTimeout(() => {
      coverSave = null;
      exclusive(saveCovers).catch(() => {});
    }, 2000);
    coverSave.unref();
  }

  async function saveCovers() {
    const index = await deps.loadIndex();
    let changed = false;
    for (const [spotifyId, address] of coverAddresses) {
      const entry = index.tracks && index.tracks[`spotify-${spotifyId}`];
      if (address && entry && entry.image !== address) {
        entry.image = address;
        changed = true;
      }
    }
    if (changed) deps.saveIndex(index);
  }

  /**
   * As soon as the queue is known, look up the addresses still missing, best
   * ranked first, leaving one lane free: when a row scrolls into view, only
   * its picture is left to fetch.
   */
  async function warmCovers(queue) {
    if (coversWarmed) return;
    coversWarmed = true;
    const index = await deps.loadIndex();
    const known = index.tracks || {};
    const todo = Object.keys(queue)
      .filter((key) => known[key] && known[key].title && !known[key].image)
      .sort((a, b) => (queue[b].vote_count || 0) - (queue[a].vote_count || 0))
      .map((key) => key.replace(/^spotify-/, ''));
    const worker = async () => {
      // Stops for good once Spotify is being left alone: rows still ask for their own.
      while (todo.length && !finishing && Date.now() >= coverRest) {
        await coverAddress(todo.shift(), true).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: COVER_LANES - 1 }, worker));
  }

  /**
   * The picture of a track: `small` for a row, full size for the voting page.
   * Null when the track has no cover; throws when it could not be fetched this time.
   */
  async function cover(id, small = false) {
    requireMode();
    const spotifyId = String(id || '').replace(/^spotify-/, '');
    if (!/^[A-Za-z0-9]{1,64}$/.test(spotifyId)) throw fail(400, 'Pochette introuvable.');
    const name = `${spotifyId}/${small ? 'small' : 'full'}`;
    if (coverBytes.has(name)) return coverBytes.get(name);
    const address = await coverAddress(spotifyId);
    if (!address) return null;
    return inCoverLane(async () => {
      if (coverBytes.has(name)) return coverBytes.get(name);
      const full = sizedCover(address, false);
      const wanted = sizedCover(address, small);
      // Should the small file be missing, the full picture does the job.
      const image = (await deps.fetchBinary(wanted)) || (wanted === full ? null : await deps.fetchBinary(full));
      if (image) coverBytes.set(name, image);
      return image;
    });
  }

  return {
    port: deps.port,
    boot: () => exclusive(boot),
    chooseMode: (isPrivate) => exclusive(() => chooseMode(isPrivate)),
    tracks: (query) => exclusive(() => listTracks(query)),
    track: (key) => exclusive(() => trackDetail(key)),
    me: () => exclusive(me),
    vote: (key, count) => exclusive(() => vote(key, count)),
    withdraw: (key) => exclusive(() => withdraw(key)),
    previewReset: () => exclusive(previewReset),
    reset: (body) => exclusive(() => reset(body)),
    leavePreview: () => exclusive(leavePreview),
    leave: (body) => exclusive(() => leave(body)),
    progress: () => progress,
    cover,
  };
}

module.exports = { createWebSession };
