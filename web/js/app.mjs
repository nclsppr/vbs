// What the television shows: its pages, and what the keys do. Everything the
// terminal can do is here: choose a mode, search, vote several times, see and
// withdraw one's votes, reset, and leave cleanly.

import { $, el, icon } from './dom.mjs';
import { api, watch } from './api.mjs';
import { createCovers } from './covers.mjs';
import { clamp } from './util.mjs';

const VIEWS = ['view-ident', 'view-gate', 'view-tuning', 'view-queue', 'view-nosignal', 'view-bye'];
const SHORTCUTS = [1, 3, 5, 10];
const REFRESH_EVERY = 30000;
const IDENT = 1500; // how long the logo stays up once the tube is warm

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Writes a text only when it differs, so that what did not change is not laid out again. */
const write = (node, text) => {
  const value = String(text ?? '');
  if (node.textContent !== value) node.textContent = value;
};
const plural = (count, one, many) => `${count} ${count > 1 ? many : one}`;
const votes = (count) => plural(count, 'vote', 'votes');

export function createApp({ scene, tube, sound }) {
  const state = {
    powered: false, // the set is on
    switching: false, // …or warming up
    ended: false, // the session is closed, the server is gone
    busy: false, // a vote, a withdrawal or a goodbye is on its way
    mode: null,
    code: '',
    maxBatch: 25,
    query: '',
    rows: [],
    selected: 0,
    mine: 0,
  };
  const rowParts = new Map(); // track key → the nodes of its row
  const cover = createCovers($('rows'));
  const timers = { toast: 0, stamp: 0, search: 0 };
  let sheet = null; // the track on the voting page
  let focusAfter = null; // where the focus returns when a page closes

  // ---- pages ---------------------------------------------------------------

  function show(id) {
    if (state.ended && id !== 'view-bye') return;
    for (const view of VIEWS) $(view).hidden = view !== id;
    tube.searching(id === 'view-tuning');
    tube.zap();
    sound.effect('zap');
  }

  const overlayOpen = () => !$('sheet').hidden || !$('dialog').hidden;

  function dropOverlay() {
    $('sheet').hidden = true;
    $('dialog').hidden = true;
    $('view-queue').inert = false;
    sheet = null;
  }

  function openOverlay(overlay, target) {
    if (!overlayOpen()) focusAfter = document.activeElement;
    $('sheet').hidden = overlay !== $('sheet');
    $('dialog').hidden = overlay !== $('dialog');
    $('view-queue').inert = true;
    tube.zap();
    sound.effect('open');
    target.focus();
  }

  function closeOverlay() {
    if (!overlayOpen()) return;
    dropOverlay();
    tube.zap();
    sound.effect('back');
    refocus();
  }

  function refocus() {
    if (state.busy || !focusAfter) return;
    if (focusAfter.isConnected && !focusAfter.closest('[hidden]')) focusAfter.focus();
    focusAfter = null;
  }

  /**
   * While something is on its way to the party, the picture does not answer.
   * `text` says what is going on when nothing else on the page shows it.
   */
  function busy(flag, text = '') {
    state.busy = flag;
    $('picture').inert = flag;
    $('wait-text').textContent = text;
    $('wait').hidden = !text;
    if (!flag) refocus();
  }

  function toast(text, isError = false) {
    const node = $('toast');
    node.textContent = text;
    node.classList.toggle('is-error', isError);
    node.hidden = false;
    clearTimeout(timers.toast);
    timers.toast = setTimeout(() => {
      node.hidden = true;
    }, isError ? 6000 : 3400);
    if (isError) sound.effect('error');
  }

  function noSignal(text) {
    if (state.ended) return;
    dropOverlay();
    $('nosignal-text').textContent = text;
    show('view-nosignal');
    sound.effect('error');
    $('nosignal-retry').focus();
  }

  const failed = (error) => (error.offline ? noSignal(error.message) : toast(error.message, true));

  /** The first press asks "sure?", the second one within three seconds acts. */
  function twoSteps(button, action) {
    button.addEventListener('click', () => {
      if (button.dataset.label) {
        action();
        return;
      }
      button.dataset.label = button.textContent;
      button.textContent = 'Sûr ?';
      setTimeout(() => {
        if (!button.dataset.label) return;
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      }, 3000);
    });
  }

  // ---- finding the party ----------------------------------------------------

  /** `found` is true once the party answered and only the queue is left to open. */
  function showSearch(progress, found = false) {
    const reading = Boolean(progress && progress.step === 'index' && progress.total);
    $('tuning-text').textContent = reading
      ? `Je lis les titres de la file… ${progress.done}/${progress.total}`
      : found
        ? 'J’ouvre la file…'
        : 'Je cherche la fête…';
    $('tuning-meter').classList.toggle('is-waiting', !reading);
    $('tuning-meter').style.setProperty('--p', reading ? progress.done / progress.total : 0);
  }

  /** Asks for the party. The waiting page follows the search, whether it is shown or not. */
  function findParty() {
    showSearch(null);
    let found = false;
    const search = { over: false };
    search.result = watch(api('GET', '/api/boot'), (progress) => {
      found = found || Boolean(progress && progress.total);
      showSearch(progress, found);
    }).finally(() => {
      search.over = true;
    });
    // A failure is reported by whoever reads the result, which may be later.
    search.result.catch(() => {});
    return search;
  }

  /**
   * Opens what the search finds: the choice of a mode, or the queue. A search
   * started behind the logo may be over already: there is nothing to wait for.
   */
  async function tune(search = findParty()) {
    if (!search.over && $('view-tuning').hidden) show('view-tuning');
    try {
      const boot = await search.result;
      showSearch(null, true);
      state.maxBatch = boot.maxBatch;
      // Shortcuts for the usual amounts, up to what one request may carry.
      $('amount-chips').replaceChildren(
        ...[...SHORTCUTS.filter((amount) => amount < boot.maxBatch), boot.maxBatch].map((amount) =>
          el('button', { type: 'button', class: 'chip', text: amount, onclick: () => setAmount(amount) }),
        ),
      );
      if (boot.needsMode) {
        show('view-gate');
        $('pick-normal').focus();
        return;
      }
      state.mode = boot.mode;
      state.code = boot.party.code;
      $('party-name').textContent = boot.party.name;
      $('mode-badge').textContent = boot.mode === 'private' ? 'CABINE PRIVÉE' : 'SALLE';
      $('mode-badge').classList.toggle('is-private', boot.mode === 'private');
      // The queue is still to be read: the waiting page says so.
      if ($('view-tuning').hidden) show('view-tuning');
      await refresh();
      show('view-queue');
      if (window.matchMedia('(pointer: fine)').matches) $('q').focus();
    } catch (error) {
      noSignal(error.message);
    }
  }

  async function choose(isPrivate) {
    showSearch(null);
    show('view-tuning');
    try {
      await api('POST', '/api/mode', { private: isPrivate });
    } catch (error) {
      // 409: the mode was already chosen (another tab, or a locked launcher).
      if (error.status !== 409) {
        noSignal(error.message);
        return;
      }
    }
    await tune();
  }

  // ---- the queue -------------------------------------------------------------

  function buildRow(track) {
    const parts = {
      rank: el('span', { class: 'row-rank' }),
      title: el('span', { class: 'row-title' }),
      artist: el('span', { class: 'row-artist' }),
      mine: el('span', { class: 'row-mine' }),
      count: document.createTextNode(''),
    };
    parts.button = el(
      'button',
      { type: 'button', class: 'row-btn', onclick: () => openSheet(track) },
      parts.rank,
      cover(track),
      el('span', { class: 'row-text' }, parts.title, parts.artist),
      el('span', { class: 'row-side' }, parts.mine, el('span', { class: 'row-votes' }, icon('icon-heart', 'heart'), parts.count)),
    );
    parts.node = el('li', { class: 'row' }, parts.button);
    return parts;
  }

  function renderRows() {
    const list = $('rows');
    const nodes = state.rows.map((track) => {
      if (!rowParts.has(track.key)) rowParts.set(track.key, buildRow(track));
      const parts = rowParts.get(track.key);
      // The queue is read again every half minute: most rows are the same as before.
      write(parts.rank, track.rank);
      write(parts.title, track.title);
      write(parts.artist, track.artists);
      write(parts.count, track.votes);
      write(parts.mine, `×${track.mine}`);
      parts.mine.hidden = !track.mine;
      parts.node.classList.toggle('is-top', track.rank <= 3);
      parts.button.setAttribute(
        'aria-label',
        `${track.title}, ${track.artists}, ${votes(track.votes)}, rang ${track.rank}${track.mine ? `, dont ${track.mine} de toi` : ''}`,
      );
      return parts.node;
    });

    // Move only what changed place: rows that stay keep the focus and the scroll.
    let place = list.firstElementChild;
    for (const node of nodes) {
      if (node === place) place = place.nextElementSibling;
      else list.insertBefore(node, place);
    }
    while (place) {
      const next = place.nextElementSibling;
      place.remove();
      place = next;
    }

    $('queue-title').textContent = state.query
      ? `RÉSULTATS · ${nodes.length}`
      : `LA FILE · ${plural(nodes.length, 'TITRE', 'TITRES')}`;
    $('rows-empty').hidden = nodes.length > 0;
    $('rows-empty').textContent = state.query
      ? `Rien ne ressemble à « ${state.query} » dans la file.`
      : 'La file est vide pour le moment.';
    select(state.selected);
  }

  /** Move the cursor of the list; `follow` scrolls it into view. */
  function select(index, follow = false) {
    state.selected = clamp(index, 0, Math.max(0, state.rows.length - 1));
    state.rows.forEach((track, i) => rowParts.get(track.key).node.classList.toggle('is-selected', i === state.selected));
    const current = state.rows[state.selected];
    if (!current || !follow) return;
    const { node, button } = rowParts.get(current.key);
    node.scrollIntoView({ block: 'nearest' });
    if (document.activeElement.classList.contains('row-btn')) button.focus();
  }

  async function loadRows() {
    const { query } = state;
    const rows = await api('GET', `/api/tracks${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    if (query !== state.query) return; // the search has moved on
    state.rows = rows;
    if (!query) {
      const total = rows.reduce((sum, track) => sum + track.votes, 0);
      $('party-meta').textContent = `Code ${state.code} · ${plural(rows.length, 'titre', 'titres')} · ${votes(total)}`;
    }
    renderRows();
  }

  // ---- my votes ---------------------------------------------------------------

  function mineRow(entry) {
    // The figure first: the artist is what gets cut when the column is narrow.
    const info = [entry.queued ? entry.total !== null && `${entry.total} au total` : 'plus dans la file', entry.artists];
    const pull = el('button', { type: 'button', class: 'mine-pull', text: 'Retirer', 'aria-label': `Retirer mes votes sur ${entry.title}` });
    twoSteps(pull, () => withdraw(entry.key));
    return el(
      'li',
      { class: 'mine-row' },
      el('span', { class: 'mine-count', text: `×${entry.count}` }),
      entry.queued
        ? el('button', { type: 'button', class: 'mine-title', text: entry.title, onclick: () => openSheet(entry) })
        : el('span', { class: 'mine-title', text: entry.title }),
      el('span', { class: 'mine-info', text: info.filter(Boolean).join(' · ') }),
      pull,
    );
  }

  /** On a narrow picture the yellow key swaps the queue and "my votes". */
  function labelMineKey() {
    const swapped = $('columns').classList.contains('show-mine');
    $('key-mine').textContent = swapped ? 'La file' : `Mes votes · ${state.mine}`;
    $('key-mine').setAttribute('aria-pressed', String(swapped));
  }

  function renderMine(me) {
    const head = (text) => el('p', { class: 'mine-head', text });
    const note = (text) => el('p', { class: 'mine-note', text });
    const list = (entries) => el('ul', { class: 'mine-list' }, ...entries.map(mineRow));
    const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0);
    const parts = [];

    if (me.mode === 'private') {
      state.mine = sum(me.session);
      if (state.mine) parts.push(head(`CETTE SESSION · ${votes(state.mine)}`), list(me.session));
      else parts.push(note('Aucun vote dans cette session. Choisis un titre dans la file.'));
      parts.push(note('Cabine privée : rien n’est écrit sur ce PC, et les profils jetables sont effacés quand tu éteins.'));
    } else {
      const extra = sum(me.extras);
      state.mine = me.profile.votes.length + extra;
      if (me.profile.votes.length) {
        parts.push(head(`TON PROFIL · ${votes(me.profile.votes.length)}`), list(me.profile.votes));
      } else {
        parts.push(note('Pas encore de vote avec ton profil. Choisis un titre dans la file.'));
      }
      if (extra) {
        parts.push(
          head(`EN PLUS · ${votes(extra)}`),
          list(me.extras),
          note('Les votes en plus partent de profils jetables, effacés quand tu éteins.'),
        );
      }
    }
    $('mine-body').replaceChildren(...parts);
    $('mine-title').textContent = `MES VOTES · ${state.mine}`;
    labelMineKey();
  }

  async function refresh() {
    await loadRows();
    renderMine(await api('GET', '/api/me'));
  }

  // ---- voting -----------------------------------------------------------------

  function setAmount(amount) {
    sheet.amount = clamp(amount, 1, state.maxBatch);
    $('amount-value').textContent = sheet.amount;
    $('amount-less').disabled = sheet.amount <= 1;
    $('amount-more').disabled = sheet.amount >= state.maxBatch;
    $('sheet-vote').textContent = sheet.amount > 1 ? `Voter × ${sheet.amount}` : 'Voter';
    for (const chip of $('amount-chips').children) chip.classList.toggle('is-on', Number(chip.textContent) === sheet.amount);
  }

  /** Fills the voting page; `track` may lack the figures only the server knows. */
  function describeSheet(track) {
    const mine = track.mine || 0;
    $('sheet-title').textContent = track.title;
    $('sheet-artist').textContent = track.artists;
    $('sheet-stats').replaceChildren(
      icon('icon-heart', 'heart'),
      track.rank ? `${votes(track.votes)} · rang ${track.rank}${mine ? ` · dont ${mine} de toi` : ''}` : '…',
    );
    const pull = $('sheet-withdraw');
    pull.hidden = !mine;
    pull.textContent = mine > 1 ? `Retirer mes ${mine} votes` : 'Retirer mon vote';
    delete pull.dataset.label;
  }

  /** Opens at once with what is already on screen, then asks the server for the rest. */
  async function openSheet(hint) {
    if (state.busy) return;
    const { key } = hint;
    const opened = { key, amount: 1 };
    sheet = opened;
    describeSheet(state.rows.find((track) => track.key === key) || hint);
    $('sheet-cover').replaceChildren(cover(hint, true));
    $('sheet-notes').replaceChildren(el('p', { text: 'Je regarde où en est ce titre…' }));
    $('sheet-meter').hidden = true;
    $('sheet-vote').disabled = true;
    setAmount(1);
    openOverlay($('sheet'), $('sheet-close'));
    try {
      const track = await api('GET', `/api/track?key=${encodeURIComponent(key)}`);
      if (sheet !== opened) return;
      describeSheet(track);
      $('sheet-notes').replaceChildren(
        ...track.awareness.map((line, i) => el('p', { class: i ? null : 'is-question', text: line })),
      );
      $('sheet-vote').disabled = false;
      $('sheet-vote').focus();
    } catch (error) {
      if (sheet !== opened) return;
      closeOverlay();
      failed(error);
    }
  }

  function stamp(result) {
    const node = $('stamp');
    $('stamp-count').textContent = `+${result.added}`;
    $('stamp-title').textContent = result.title;
    $('stamp-total').textContent = [result.total !== null && votes(result.total), result.rank && `rang ${result.rank}`]
      .filter(Boolean)
      .join(' · ');
    node.classList.remove('is-leaving');
    node.hidden = false;
    clearTimeout(timers.stamp);
    timers.stamp = setTimeout(() => {
      node.classList.add('is-leaving');
      timers.stamp = setTimeout(() => {
        node.hidden = true;
      }, 300);
    }, 2200);
  }

  async function vote() {
    if (!sheet || state.busy) return;
    const { key, amount } = sheet;
    const meter = $('sheet-meter');
    meter.style.setProperty('--p', 0);
    meter.hidden = false;
    meter.scrollIntoView({ block: 'nearest' });
    busy(true);
    try {
      const result = await watch(api('POST', '/api/vote', { key, count: amount }), (progress) => {
        if (progress && progress.step === 'vote') meter.style.setProperty('--p', progress.done / progress.total);
      });
      closeOverlay();
      stamp(result);
      scene.celebrate();
      sound.effect('vote');
      if (result.partialError) toast(`${result.added} sur ${result.wanted} seulement : ${result.partialError}`, true);
      await refresh();
    } catch (error) {
      meter.hidden = true;
      failed(error);
    } finally {
      busy(false);
    }
  }

  /** Withdrawals and resets end the same way: say what was removed, then reload. */
  async function removal(request) {
    if (state.busy) return;
    busy(true, 'Je retire tes votes…');
    try {
      const result = await request();
      busy(true); // the votes are gone: only the queue is left to reload
      closeOverlay();
      sound.effect('pull');
      toast(result.failed ? `${result.message} Je n’ai pas pu en retirer ${result.failed}.` : result.message, result.failed > 0);
      await refresh();
    } catch (error) {
      failed(error);
    } finally {
      busy(false);
    }
  }

  const withdraw = (key) => removal(() => api('POST', '/api/withdraw', { key }));
  const reset = (forgetProfile) => removal(() => api('POST', '/api/reset', { confirm: 'reset', forgetProfile }));

  // ---- reset and goodbye --------------------------------------------------------

  const say = (tone, text) => el('p', { class: tone, text });
  const tally = (lines) =>
    el('ul', { class: 'dialog-list' }, ...lines.map((line) => el('li', {}, el('b', { text: `×${line.count}` }), line.title)));

  /** A page of text with keys under it; returns the keys. `sure` keys ask twice. */
  function dialog({ page, title, body, actions, focus }) {
    $('dialog-page').textContent = page;
    $('dialog-title').textContent = title;
    $('dialog-body').replaceChildren(...body.filter(Boolean));
    const keys = actions.filter(Boolean).map((action) => {
      const key = el('button', { type: 'button', class: `key key-${action.tone}`, text: action.label, disabled: action.disabled });
      if (action.sure) twoSteps(key, action.run);
      else key.addEventListener('click', action.run);
      return key;
    });
    $('dialog-actions').replaceChildren(...keys);
    openOverlay($('dialog'), focus || keys[keys.length - 1]);
    return keys;
  }

  const back = { label: 'Retour', tone: 'yellow', run: closeOverlay };

  async function askReset() {
    if (state.busy) return;
    let preview;
    try {
      preview = await api('GET', '/api/reset');
    } catch (error) {
      failed(error);
      return;
    }
    if (!preview.count) {
      const profile = preview.mode === 'normal' && preview.uid;
      dialog({
        page: 'P400',
        title: 'TOUT RETIRER',
        body: [
          say('is-good', 'Tu n’as aucun vote à retirer.'),
          profile && say('is-dim', 'Tu peux quand même oublier le profil enregistré sur ce PC : un neuf prend sa place.'),
        ],
        actions: [profile && { label: 'Oublier mon profil', tone: 'red', sure: true, run: () => reset(true) }, back],
      });
      return;
    }

    const lines = preview.mode === 'private' ? preview.lines : [...preview.profileVotes.map((line) => ({ ...line, count: 1 })), ...preview.extras];
    const word = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '12' });
    const [go] = dialog({
      page: 'P400',
      title: 'TOUT RETIRER',
      body: [say('is-warning', preview.warning), tally(lines), el('label', { class: 'confirm' }, 'Pour confirmer, tape reset :', word)],
      actions: [{ label: `Retirer ${votes(preview.count)}`, tone: 'red', disabled: true, run: () => reset(false) }, back],
      focus: word,
    });
    word.addEventListener('input', () => {
      go.disabled = word.value.trim().toLowerCase() !== 'reset';
    });
    word.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !go.disabled) reset(false);
    });
  }

  async function askLeave() {
    let preview;
    try {
      preview = await api('GET', '/api/leave');
    } catch (error) {
      if (error.offline) {
        leave(true);
        return;
      }
      // The votes cannot be read, yet leaving must stay possible.
      dialog({
        page: 'P900',
        title: 'ÉTEINDRE',
        body: [say('is-warning', error.message), say('is-dim', 'Je ne peux pas lire tes votes. Tu peux éteindre quand même : ils restent en place.')],
        actions: [{ label: 'Éteindre quand même', tone: 'green', run: () => leave(true) }, back],
      });
      return;
    }
    const some = preview.lines.length > 0;
    dialog({
      page: 'P900',
      title: 'ÉTEINDRE',
      body: [
        say(some ? 'is-warning' : 'is-good', some ? preview.warning : 'Aucun vote à retirer. Les profils jetables seront effacés.'),
        some && tally(preview.lines),
        some && preview.forgetsProfile && say('is-dim', '« Tout retirer » supprime aussi le profil enregistré sur ce PC, comme un reset.'),
      ],
      actions: [
        { label: some ? 'Garder mes votes' : 'Éteindre', tone: 'green', run: () => leave(true) },
        some && { label: 'Tout retirer', tone: 'red', sure: true, run: () => leave(false) },
        back,
      ],
    });
  }

  function farewell(result) {
    return [
      result.removed > 0 && `J’ai retiré ${votes(result.removed)}.`,
      result.accountsDeleted > 0 && `${plural(result.accountsDeleted, 'profil jetable effacé', 'profils jetables effacés')}.`,
      result.profileForgotten && 'Le profil enregistré sur ce PC est supprimé.',
      result.profileUntouched && 'Ton profil reste enregistré sur ce PC.',
      'Tu peux fermer cet onglet.',
    ].filter(Boolean);
  }

  async function switchOff(noteTitle, noteText) {
    sound.stop();
    sound.effect('off');
    await tube.off();
    // Should the set be switched on again, it warms up on a dark picture.
    for (const view of VIEWS) $(view).hidden = true;
    state.powered = false;
    $('power').setAttribute('aria-pressed', 'false');
    $('note-title').textContent = noteTitle;
    $('note-text').textContent = noteText;
  }

  async function leave(keep) {
    if (state.busy) return;
    busy(true, keep ? 'J’éteins…' : 'Je retire tes votes, puis j’éteins…');
    let result;
    try {
      result = await api('POST', '/api/leave', { keep });
    } catch (error) {
      busy(false);
      if (error.offline) {
        // The server is already gone: there is nothing left to close.
        dropOverlay();
        await switchOff('Plus de courant', 'Relance Voter-web.cmd, puis recharge la page.');
      } else {
        failed(error);
      }
      return;
    }
    if (!result.shutdown) {
      closeOverlay();
      busy(false);
      toast(result.message, true);
      refresh().catch(failed);
      return;
    }

    busy(false);
    dropOverlay();
    $('bye-text').replaceChildren(...farewell(result).map((line) => el('p', { text: line })));
    show('view-bye');
    state.ended = true;
    await wait(3200);
    await switchOff('Télé éteinte', 'Pour revenir : Voter-web.cmd');
    $('note').disabled = true;
    $('power').disabled = true;
  }

  // ---- the set's own buttons, and the keyboard -----------------------------------

  async function power() {
    if (state.ended || state.switching || state.busy) return;
    if (state.powered) {
      closeOverlay();
      // Before a mode is chosen, or without signal, there is nothing to ask.
      if (state.mode && !$('view-queue').hidden) await askLeave();
      else await leave(true);
      return;
    }
    state.switching = true;
    state.powered = true;
    $('power').setAttribute('aria-pressed', 'true');
    sound.unlock();
    sound.effect('on');
    // The tube warms up on the logo, and the party is looked for behind it.
    for (const view of VIEWS) $(view).hidden = view !== 'view-ident';
    tube.searching(false);
    const search = findParty();
    await tube.on();
    sound.start();
    state.switching = false;
    await wait(IDENT);
    await tune(search);
  }

  function search() {
    state.query = $('q').value.trim();
    state.selected = 0;
    $('rows').scrollTop = 0;
    loadRows().catch(failed);
  }

  function keys(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || !state.powered || state.busy) return;
    const { key } = event;
    const typing = event.target instanceof HTMLInputElement;

    if (!$('dialog').hidden) {
      if (key === 'Escape') closeOverlay();
    } else if (!$('sheet').hidden) {
      if (key === 'Escape') closeOverlay();
      else if (key === 'ArrowLeft' || key === '-') setAmount(sheet.amount - 1);
      else if (key === 'ArrowRight' || key === '+') setAmount(sheet.amount + 1);
    } else if (!$('view-gate').hidden) {
      if (key === '1') choose(false);
      else if (key === '2') choose(true);
    } else if (!$('view-queue').hidden) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        select(state.selected + (key === 'ArrowDown' ? 1 : -1), true);
      } else if (key === '/' && !typing) {
        event.preventDefault();
        $('q').focus();
      } else if (key === 'Escape' && typing && $('q').value) {
        $('q').value = '';
        search();
      }
    }
  }

  $('power').addEventListener('click', power);
  $('note').addEventListener('click', power);
  $('key-leave').addEventListener('click', power);
  $('pick-normal').addEventListener('click', () => choose(false));
  $('pick-private').addEventListener('click', () => choose(true));
  $('nosignal-retry').addEventListener('click', () => tune());

  $('q').addEventListener('input', () => {
    clearTimeout(timers.search);
    timers.search = setTimeout(search, 180);
  });
  $('search').addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = state.rows[state.selected];
    if (chosen) openSheet(chosen);
  });

  $('key-reset').addEventListener('click', askReset);
  $('key-refresh').addEventListener('click', () => {
    refresh().then(() => toast('La file est à jour.'), failed);
  });
  $('key-mine').addEventListener('click', () => {
    $('columns').classList.toggle('show-mine');
    labelMineKey();
  });

  $('sheet-close').addEventListener('click', closeOverlay);
  $('amount-less').addEventListener('click', () => setAmount(sheet.amount - 1));
  $('amount-more').addEventListener('click', () => setAmount(sheet.amount + 1));
  $('sheet-vote').addEventListener('click', vote);
  twoSteps($('sheet-withdraw'), () => withdraw(sheet.key));
  document.addEventListener('keydown', keys);

  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString('fr-FR');
  }, 1000);

  // The queue moves while the party goes on: keep it fresh, quietly.
  setInterval(() => {
    if ($('view-queue').hidden || overlayOpen() || state.busy || document.hidden) return;
    refresh().catch((error) => {
      if (error.offline) noSignal(error.message);
    });
  }, REFRESH_EVERY);
}
