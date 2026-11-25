'use strict';

/**
 * Offline end-to-end tests for the interactive session.
 *
 * Each scenario runs the real CLI (plain mode, scripted stdin) against
 * test/mock-firebase.js, then checks both what the program said and what the
 * fake server ended up with. Nothing here can reach the real party.
 *
 *   node test/offline.test.js            run everything
 *   node test/offline.test.js -v         also print every session transcript
 *   node test/offline.test.js <words>    only scenarios whose name contains them
 *
 * Set JUKORAMA_CLI to test another build, e.g. the packaged copy:
 *   JUKORAMA_CLI=dist/jukorama.js node test/offline.test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = process.env.JUKORAMA_CLI
  ? path.resolve(process.env.JUKORAMA_CLI)
  : path.join(ROOT, 'jukorama.js');
const MOCK = path.join(__dirname, 'mock-firebase.js');
const PARTY = '-P2mFuoFSfyjMXOzkmZW';

const ZOO = 'spotify-zoo';
const PROPER = 'spotify-proper';
const CHEATER = 'spotify-cheater';
const SOLO = 'spotify-solo';
// `others` = votes already there from other guests.
const TRACKS = {
  [ZOO]: { title: 'Zoo', artists: 'Kaaris', others: 22 },
  [PROPER]: { title: 'Proper Education - Radio Edit', artists: 'Eric Prydz, Floyd', others: 3 },
  [CHEATER]: { title: "Cheater's Town", artists: 'Chris Isaak', others: 7 },
  // Nobody else votes for this one: it is only in the queue when a scenario
  // seeds a vote on it, and it leaves the queue when that vote goes.
  [SOLO]: { title: 'Lonely Road', artists: 'Nobody', others: 0 },
};

const verbose = process.argv.includes('-v');
const filter = process.argv.slice(2).filter((a) => a !== '-v').join(' ').toLowerCase();

// Appended by the mock to every question, so that the transcript can be put
// back together the way a terminal shows it: question, typed answer, new line.
const PROMPT_MARK = '\u0001';

/** Everything the program logged across all sessions, for the width check. */
const loggedLines = new Set();

/**
 * Rebuild what the user would have seen from the piped output.
 * Returns the transcript and, separately, the lines that were logged (as
 * opposed to asked): in the retro frame only those go to the scrollback.
 */
function rebuild(stdout, typed) {
  const parts = stdout.split(PROMPT_MARK);
  const logged = [];
  let transcript = '';
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    // All but the last part end with a question, after the final line break.
    const logEnd = last ? part.length : part.lastIndexOf('\n') + 1;
    logged.push(...part.slice(0, logEnd).split('\n'));
    transcript += part;
    if (!last) transcript += `${typed[i] === undefined ? '' : typed[i]}\n`;
  });
  return { transcript, logged };
}

// ---------------------------------------------------------------------------
// running one session
// ---------------------------------------------------------------------------

/**
 * Run the CLI once in a throwaway data directory.
 *
 * @param lines         what the user types, one entry per Enter
 * @param argv          CLI arguments (defaults to the interactive shell)
 * @param privateMode   launch like Voter-prive.cmd
 * @param savedProfile  start with an existing saved profile (uid "SAVED")
 * @param seedVotes     votes already on the server: { trackKey: [uid] }
 * @param withdrawn     votes taken back from the web app, left as `false`
 * @param env           extra mock knobs
 */
function run({
  lines = [],
  argv = ['shell'],
  privateMode = false,
  savedProfile = false,
  seedVotes = {},
  withdrawn = {},
  env = {},
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jukorama-offline-'));
  const stateFile = path.join(dir, 'server-state.json');
  const authFile = path.join(dir, 'auth.json');

  fs.writeFileSync(
    path.join(dir, 'tracks-index.json'),
    JSON.stringify({
      party: PARTY,
      tracks: Object.fromEntries(
        Object.entries(TRACKS).map(([key, t]) => [key, { title: t.title, artists: t.artists }]),
      ),
    }),
  );

  const world = {
    tracks: Object.fromEntries(Object.entries(TRACKS).map(([key, t]) => [key, t.others])),
    accounts: [],
    votes: seedVotes,
    withdrawn,
  };

  let authBefore = null;
  if (savedProfile) {
    world.accounts.push('SAVED');
    authBefore = JSON.stringify(
      {
        uid: 'SAVED',
        refreshToken: 'rt.SAVED',
        idToken: 'id.SAVED.0',
        // With instantly-expiring tokens the saved one must be stale as well.
        expiresAt: env.MOCK_EXPIRES_IN === '120' ? 0 : Date.now() + 3000e3,
      },
      null,
      2,
    );
    fs.writeFileSync(authFile, authBefore);
  }

  const childEnv = {
    ...process.env,
    ...env,
    JUKORAMA_PLAIN: '1',
    JUKORAMA_DATA_DIR: dir,
    JUKORAMA_PROXY_BOOTSTRAPPED: '1', // never re-exec through a corporate proxy
    MOCK_STATE_FILE: stateFile,
    MOCK_WORLD: JSON.stringify(world),
    MOCK_PROMPT_MARK: PROMPT_MARK,
  };
  // Nothing from the machine the tests run on may leak into a session: neither
  // a launcher's mode nor a proxy configuration (it changes error messages).
  for (const name of Object.keys(childEnv)) {
    if (/^(?:JUKORAMA_PRIVATE|JUKORAMA_TEST_HOOKS|NODE_USE_ENV_PROXY|(?:https?|all|no)_proxy)$/i.test(name)) {
      delete childEnv[name];
    }
  }
  if (privateMode) childEnv.JUKORAMA_PRIVATE = '1';

  const result = spawnSync(process.execPath, ['-r', MOCK, CLI, ...argv], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    env: childEnv,
    timeout: 30000,
  });

  const { transcript, logged } = rebuild(result.stdout || '', lines);
  // Only the interactive shell is drawn inside the retro frame; one-shot
  // commands print to a plain terminal, which wraps long lines by itself.
  if (argv[0] === 'shell') for (const line of logged) loggedLines.add(line);
  const out = `${transcript}${result.stderr || ''}`;
  const server = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const authAfter = fs.existsSync(authFile) ? fs.readFileSync(authFile, 'utf8') : null;
  fs.rmSync(dir, { recursive: true, force: true });

  return {
    out,
    server,
    authBefore,
    authAfter,
    profile: authAfter ? JSON.parse(authAfter) : null,
    status: result.status,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
  };
}

// ---------------------------------------------------------------------------
// small assertion helpers
// ---------------------------------------------------------------------------

const says = (r, text) => r.out.includes(text);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throwaways = (r) => Object.entries(r.server.accounts).filter(([, a]) => a.created === 'signUp');
const allThrowawaysErased = (r) => throwaways(r).every(([, a]) => a.deleted);
const cleanExit = (r) => r.status === 0 && !r.timedOut && says(r, '\u00c0 la prochaine !');

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

const scenarios = [
  {
    name: 'private: vote x5, reset removes all 5 and mesvotes agrees (the reported bug)',
    run: () => run({ privateMode: true, lines: ['zoo', 'o', '5', 'mesvotes', 'reset', 'o', 'mesvotes', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['mesvotes shows the 5 session votes', says(r, 'Tes votes dans cette session (mode priv\u00e9) : 5')],
      ['...with the live total', says(r, ' 5\u00d7  Zoo \u2014 Kaaris  [27 au total]')],
      ['reset lists the whole session', says(r, 'Pendant cette session, tu as mis 5 vote(s) :')],
      ['reset says how they were spread', says(r, '(r\u00e9partis sur 5 profil(s) anonyme(s) jetable(s))')],
      ['reset reports 5 removed', says(r, 'J\u2019ai retir\u00e9 5 vote(s) que tu avais mis dans cette session.')],
      ['reset reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes is empty afterwards', says(r, 'Aucun vote dans cette session.')],
      ['no per-uid talk in private mode', !says(r, 'Aucun vote pour ') && !says(r, 'Ton profil ')],
      ['nothing left to recap on exit', !says(r, 'R\u00e9capitulatif')],
      ['exit does not mention votes that no longer exist', says(r, '5 compte(s) anonyme(s) supprim\u00e9(s).') && !says(r, 'ces votes')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['one account per vote, none for read-backs', r.server.signUps === 5],
      ['every throwaway account erased', allThrowawaysErased(r)],
      ['no profile written to disk', r.authAfter === null],
    ],
  },
  {
    name: 'private: a server counter that lags behind does not make the totals lie',
    run: () =>
      run({ privateMode: true, env: { MOCK_COUNT_LAG: '2' }, lines: ['zoo', 'o', '5', 'reset', 'o', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['total right after voting', says(r, '27 votes au total. V\u00e9rifi\u00e9 c\u00f4t\u00e9 serveur : oui')],
      ['total right after the reset', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
    ],
  },
  {
    name: 'private: votes taken back from the web app (false entries) are not counted',
    run: () =>
      run({ privateMode: true, withdrawn: { [ZOO]: ['web-guest'] }, lines: ['zoo', 'o', '2', 'reset', 'o', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['total right after voting', says(r, '24 votes au total. V\u00e9rifi\u00e9 c\u00f4t\u00e9 serveur : oui')],
      ['total right after the reset', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
    ],
  },
  {
    name: 'private: reset leaves the saved normal profile alone',
    run: () => run({ privateMode: true, savedProfile: true, lines: ['zoo', 'o', '2', 'reset', 'o', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['auth.json byte-identical', r.authAfter === r.authBefore],
      ['saved account still exists', r.server.accounts.SAVED.deleted === false],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'private: [r] on a title withdraws all my votes on it, others stay',
    run: () =>
      run({
        privateMode: true,
        lines: ['zoo', 'o', '3', 'proper education', 'o', '2', 'zoo', 'r', 'mesvotes', 'quitter', 'o'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['knows about the 3 votes whatever the current account', says(r, 'Tu as d\u00e9j\u00e0 mis 3 votes sur ce titre.')],
      ['offers to withdraw the 3', says(r, '[r] retirer mes 3 votes')],
      ['reports 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais mis sur ce titre.')],
      ['reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes now shows 2', says(r, 'Tes votes dans cette session (mode priv\u00e9) : 2')],
      ['exit recap lists only Proper Education', says(r, '2\u00d7  Proper Education') && !/\d\u00d7  Zoo \u2014 Kaaris\s+\u2190/.test(r.out)],
      ['server: Zoo 22, Proper 5', r.server.counts[ZOO] === 22 && r.server.counts[PROPER] === 5],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'private: keeping the votes on exit erases the accounts and says what that means',
    run: () => run({ privateMode: true, lines: ['zoo', 'o', '2', 'quitter', ''] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['recap lists the 2 votes', says(r, 'R\u00e9capitulatif de la session :') && says(r, ' 2\u00d7  Zoo \u2014 Kaaris')],
      ['accounts erased', says(r, '2 compte(s) anonyme(s) supprim\u00e9(s).') && allThrowawaysErased(r)],
      ['says the votes are now untraceable', says(r, 'Plus aucun lien entre toi et ces votes.')],
      ['server: the 2 votes stay', r.server.counts[ZOO] === 24],
    ],
  },
  {
    name: 'private: answering n on exit withdraws everything and reports totals',
    run: () => run({ privateMode: true, lines: ['zoo', 'o', '2', 'quitter', 'n'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['reports 2 of 2 removed', says(r, 'J\u2019ai retir\u00e9 2 vote(s) sur 2 avant suppression des comptes.')],
      ['reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'private: votes that could not be removed stay in the ledger until they are',
    run: () =>
      run({
        privateMode: true,
        env: { MOCK_FAIL_VOTE_DELETES: '2' },
        lines: ['zoo', 'o', '5', 'reset', 'o', 'mesvotes', 'reset', 'o', 'mesvotes', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['first reset: 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais mis dans cette session.')],
      ['first reset: 2 failures admitted', says(r, '\u00c9chec pour 2 vote(s) : retape reset pour r\u00e9essayer.')],
      ['first reset: honest total', says(r, 'Maintenant 24 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes still shows the 2 left', says(r, 'Tes votes dans cette session (mode priv\u00e9) : 2')],
      ['second reset: 2 removed', says(r, 'J\u2019ai retir\u00e9 2 vote(s) que tu avais mis dans cette session.')],
      ['second reset: total back', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes empty at last', says(r, 'Aucun vote dans cette session.')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
    ],
  },
  {
    name: 'private: a failed withdrawal on exit can be retried before accounts are erased',
    run: () =>
      run({ privateMode: true, env: { MOCK_FAIL_VOTE_DELETES: '1' }, lines: ['zoo', 'o', '2', 'quitter', 'n', 'o'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['offers the retry', says(r, '1 vote(s) n\u2019ont pas pu \u00eatre retir\u00e9s. R\u00e9essayer ? [O/n]')],
      ['both removed in the end', says(r, 'J\u2019ai retir\u00e9 2 vote(s) sur 2 avant suppression des comptes.')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'private: a dropped connection does not end the session nor lose the ledger',
    run: () =>
      run({
        privateMode: true,
        // Let through the reads of the queue at start-up, for the vote and for
        // the status bar: the one that fails is the first mesvotes.
        env: { MOCK_THROW_ON: 'GET /tracks/', MOCK_THROW_SKIP: '3' },
        lines: ['zoo', 'o', '2', 'mesvotes', 'mesvotes', 'reset', 'o', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['the error is shown', says(r, 'Erreur : Connexion r\u00e9seau impossible')],
      ['the 2 votes are still accounted for', says(r, 'Tes votes dans cette session (mode priv\u00e9) : 2')],
      ['and can be withdrawn', says(r, 'J\u2019ai retir\u00e9 2 vote(s) que tu avais mis dans cette session.')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'private: votes are cast even if the total cannot be read back, and it says so',
    run: () =>
      run({
        privateMode: true,
        env: { MOCK_THROW_ON: 'GET /votes/' },
        lines: ['zoo', 'o', '2', 'mesvotes', 'quitter', 'n'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['the votes are confirmed', says(r, 'Vote enregistr\u00e9 : Zoo \u2014 Kaaris') && says(r, '2 votes ajout\u00e9s d\u2019un coup.')],
      ['the missing total is admitted', says(r, '(total illisible pour le moment : tape liste)')],
      ['it does not look like a failed vote', !says(r, 'Erreur')],
      ['the 2 votes are accounted for', says(r, 'Tes votes dans cette session (mode priv\u00e9) : 2')],
      ['and can still be withdrawn on exit', says(r, 'J\u2019ai retir\u00e9 2 vote(s) sur 2 avant suppression des comptes.')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
    ],
  },
  {
    name: 'private: one-shot "reset --private" keeps the saved profile and its votes',
    run: () => run({ argv: ['reset', '--private'], savedProfile: true, seedVotes: { [ZOO]: ['SAVED'] } }),
    checks: (r) => [
      ['auth.json byte-identical', r.authAfter === r.authBefore],
      ['saved profile still holds its vote', same(r.server.myVotes[ZOO], ['SAVED'])],
      ['saved account still exists', r.server.accounts.SAVED.deleted === false],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'normal: vote x3 = profile + 2 throwaways; mesvotes and reset account for all 3',
    run: () => run({ savedProfile: true, lines: ['zoo', 'o', '3', 'mesvotes', 'reset', 'reset', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['awareness line counts the 3', says(r, "! C'est ton 3e vote pour ce titre dans cette session.")],
      ['mesvotes is about the saved profile', says(r, 'Votes de SAVED (1) :')],
      ['mesvotes adds the extra votes', says(r, 'En plus dans cette session, depuis des profils jetables : 2')],
      ['reset lists the profile vote', says(r, 'Ton profil SAVED d\u00e9tient 1 vote(s) :')],
      ['reset lists the extra votes', says(r, 'En plus, cette session : 2 vote(s) depuis des profils jetables :')],
      ['reset reports 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais enregistr\u00e9(s).')],
      ['...and where they came from', says(r, '(1 de ton profil, 2 depuis des profils jetables)')],
      ['reset reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['profile forgotten, none recreated behind the scenes', r.authAfter === null && r.server.signUps === 2],
      ['every throwaway account erased', allThrowawaysErased(r)],
      ['no false reassurance after a reset', !says(r, 'Ton profil enregistr\u00e9 n\u2019a pas \u00e9t\u00e9 modifi\u00e9')],
    ],
  },
  {
    name: 'normal: after a batch the session is back on the saved profile',
    run: () =>
      run({ savedProfile: true, lines: ['zoo', 'o', '3', 'proper education', 'o', '', 'mesvotes', 'quitter', ''] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['next vote is cast by the saved profile', same(r.server.myVotes[PROPER], ['SAVED'])],
      ['mesvotes shows both profile votes', says(r, 'Votes de SAVED (2) :')],
      ['Zoo holds profile + 2 throwaways', same(r.server.myVotes[ZOO], ['SAVED', 'T1', 'T2'])],
      ['exit mentions both kinds', says(r, 'Tu quittes avec 2 vote(s) sur ton profil et 2 en plus.')],
      ['exit warns about the extras', says(r, 'Apr\u00e8s la sortie, les votes en plus ne pourront plus \u00eatre retir\u00e9s.')],
      ['saved profile kept', r.profile && r.profile.uid === 'SAVED' && !('ephemeral' in r.profile)],
      ['reassurance shown', says(r, 'Ton profil enregistr\u00e9 n\u2019a pas \u00e9t\u00e9 modifi\u00e9.')],
      ['every throwaway account erased', allThrowawaysErased(r)],
      ['saved account not erased', r.server.accounts.SAVED.deleted === false],
    ],
  },
  {
    name: 'normal: reset offered on exit runs before the throwaway accounts are erased',
    run: () => run({ savedProfile: true, lines: ['zoo', 'o', '3', 'quitter', 'n', 'reset'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['reports 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais enregistr\u00e9(s).')],
      ['...and where they came from', says(r, '(1 de ton profil, 2 depuis des profils jetables)')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['every throwaway account erased', allThrowawaysErased(r)],
      ['profile forgotten', r.authAfter === null],
    ],
  },
  {
    name: 'normal: [r] on a title withdraws the profile vote and the extras',
    run: () => run({ savedProfile: true, lines: ['zoo', 'o', '3', 'zoo', 'r', 'mesvotes', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['knows about the 3 votes', says(r, 'Tu as d\u00e9j\u00e0 mis 3 votes sur ce titre.')],
      ['reports 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais mis sur ce titre.')],
      ['reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes: nothing left', says(r, 'Aucun vote pour SAVED sur cette party.') && !says(r, 'En plus dans cette session')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['saved profile kept', r.profile && r.profile.uid === 'SAVED'],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'normal: withdrawing the last vote of a track says it left the queue',
    run: () => run({ savedProfile: true, seedVotes: { [SOLO]: ['SAVED'] }, lines: ['lonely', 'r', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['reports 1 removed', says(r, 'J\u2019ai retir\u00e9 1 vote(s) que tu avais mis sur ce titre.')],
      ['says the track is gone', says(r, 'Plus dans la file : Lonely Road \u2014 Nobody')],
      ['server: no vote left on it', r.server.counts[SOLO] === 0],
    ],
  },
  {
    name: 'normal: ...or that it has no vote left, while the server has not dropped it yet',
    run: () =>
      run({
        savedProfile: true,
        seedVotes: { [SOLO]: ['SAVED'] },
        env: { MOCK_COUNT_LAG: '2' },
        lines: ['lonely', 'r', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['says so', says(r, 'Plus aucun vote : Lonely Road \u2014 Nobody')],
      ['never claims a stale count', !says(r, 'Maintenant 1 vote')],
      ['server: no vote left on it', r.server.counts[SOLO] === 0],
    ],
  },
  {
    name: 'normal: [v] when the profile already voted adds throwaway votes only',
    run: () =>
      run({ savedProfile: true, seedVotes: { [ZOO]: ['SAVED'] }, lines: ['zoo', 'v', '2', 'mesvotes', 'quitter', ''] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['says the profile already voted', says(r, 'Tu as d\u00e9j\u00e0 vot\u00e9 pour ce titre.') && says(r, '[r] retirer ce vote')],
      ['explains every vote is an extra', says(r, 'Ton profil habituel a d\u00e9j\u00e0 son vote ici : chaque vote en plus')],
      ['Zoo holds profile + 2 throwaways', same(r.server.myVotes[ZOO], ['SAVED', 'T1', 'T2'])],
      ['mesvotes adds the extra votes', says(r, 'En plus dans cette session, depuis des profils jetables : 2')],
      ['saved profile kept', r.profile && r.profile.uid === 'SAVED'],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'normal: single vote then reset reports the removal and the new total',
    run: () => run({ savedProfile: true, lines: ['zoo', 'o', '', 'reset', 'reset', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['reports 1 removed', says(r, 'J\u2019ai retir\u00e9 1 vote(s) que tu avais enregistr\u00e9(s).')],
      ['reports the new total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['profile forgotten, no account created', r.authAfter === null && r.server.signUps === 0],
    ],
  },
  {
    name: 'normal: right after a reset, mesvotes and reset do not conjure up a new profile',
    run: () => run({ savedProfile: true, lines: ['zoo', 'o', '', 'reset', 'reset', 'mesvotes', 'reset', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['mesvotes says the profile was just reset', says(r, 'Aucun vote sur ton profil : il vient d\u2019\u00eatre remis \u00e0 z\u00e9ro.')],
      ['a second reset has nothing to do', says(r, 'Rien \u00e0 retirer : ton profil vient d\u00e9j\u00e0 d\u2019\u00eatre remis \u00e0 z\u00e9ro.')],
      ['no unknown uid shows up', !says(r, 'Aucun vote pour ') && !says(r, 'Aucun vote \u00e0 retirer pour ')],
      ['no account created, no profile on disk', r.server.signUps === 0 && r.authAfter === null],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
    ],
  },
  {
    name: 'normal: an extra vote the reset could not remove is not forgotten',
    run: () =>
      run({
        savedProfile: true,
        env: { MOCK_FAIL_VOTE_DELETES: '1' },
        lines: ['zoo', 'o', '3', 'reset', 'reset', 'mesvotes', 'reset', 'o', 'mesvotes', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['first reset: 2 removed', says(r, 'J\u2019ai retir\u00e9 2 vote(s) que tu avais enregistr\u00e9(s).')],
      ['...1 from the profile, 1 extra', says(r, '(1 de ton profil, 1 depuis des profils jetables)')],
      ['first reset: the failure is admitted', says(r, '\u00c9chec pour 1 vote(s) en plus : retape reset pour r\u00e9essayer.')],
      ['first reset: honest total', says(r, 'Maintenant 23 votes au total : Zoo \u2014 Kaaris')],
      ['mesvotes still shows the one left', says(r, 'En plus dans cette session, depuis des profils jetables : 1')],
      ['second reset lists it', says(r, 'Pendant cette session, tu as mis 1 vote(s) :')],
      ['second reset removes it', says(r, 'J\u2019ai retir\u00e9 1 vote(s) que tu avais mis dans cette session.')],
      ['second reset: total back', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['both throwaway accounts erased', r.server.accounts.T1.deleted && r.server.accounts.T2.deleted],
      ['the old profile is gone for good', !r.profile || r.profile.uid !== 'SAVED'],
      ['no throwaway account became the saved profile', !r.profile || !['T1', 'T2'].includes(r.profile.uid)],
    ],
  },
  {
    name: 'normal: a reset cut short by the network says so and can be finished',
    run: () =>
      run({
        savedProfile: true,
        // The connection drops when the profile's own vote is being withdrawn,
        // after the two extra ones are gone.
        env: { MOCK_THROW_ON: `DELETE /votes/${PARTY}/${ZOO}/SAVED` },
        lines: ['zoo', 'o', '3', 'reset', 'reset', 'mesvotes', 'reset', 'reset', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['says what was already done', says(r, 'J\u2019ai retir\u00e9 2 vote(s) en plus avant l\u2019erreur.')],
      ['says how to finish', says(r, 'Reset interrompu : retape reset pour le terminer.')],
      ['shows the error', says(r, 'Erreur : Connexion r\u00e9seau impossible')],
      ['mesvotes: the profile vote is still there, the extras are not', says(r, 'Votes de SAVED (1) :') && !says(r, 'En plus dans cette session')],
      ['second reset finishes the job', says(r, 'J\u2019ai retir\u00e9 1 vote(s) que tu avais enregistr\u00e9(s).')],
      ['...and reports the total', says(r, 'Maintenant 22 votes au total : Zoo \u2014 Kaaris')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['profile forgotten only once the job is done', r.authAfter === null],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
  {
    name: 'normal: reset with nothing to remove changes nothing by default',
    run: () => run({ savedProfile: true, lines: ['reset', '', 'quitter'] }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['says so', says(r, 'Aucun vote \u00e0 retirer pour SAVED.') && says(r, 'Rien chang\u00e9.')],
      ['saved profile kept', r.profile && r.profile.uid === 'SAVED'],
    ],
  },
  {
    name: 'normal: instantly-expiring tokens never let a throwaway replace the saved profile',
    run: () =>
      run({
        savedProfile: true,
        env: { MOCK_EXPIRES_IN: '120' },
        lines: ['zoo', 'o', '3', 'zoo', 'r', 'zoo', 'o', '2', 'quitter', ''],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['saved profile is still SAVED', r.profile && r.profile.uid === 'SAVED' && !('ephemeral' in r.profile)],
      ['Zoo holds profile + 1 throwaway', same(r.server.myVotes[ZOO], ['SAVED', 'T3'])],
      ['every throwaway account erased', allThrowawaysErased(r)],
      ['saved account not erased', r.server.accounts.SAVED.deleted === false],
    ],
  },
  {
    name: 'private: instantly-expiring tokens, reset still removes everything',
    run: () =>
      run({
        privateMode: true,
        savedProfile: true,
        env: { MOCK_EXPIRES_IN: '120' },
        lines: ['zoo', 'o', '3', 'reset', 'o', 'quitter'],
      }),
    checks: (r) => [
      ['clean exit', cleanExit(r)],
      ['reports 3 removed', says(r, 'J\u2019ai retir\u00e9 3 vote(s) que tu avais mis dans cette session.')],
      ['server: Zoo back to 22', r.server.counts[ZOO] === 22],
      ['auth.json byte-identical', r.authAfter === r.authBefore],
      ['every throwaway account erased', allThrowawaysErased(r)],
    ],
  },
];

// ---------------------------------------------------------------------------
// CRT frame
// ---------------------------------------------------------------------------

const crt = () => require(path.join(path.dirname(CLI), 'crt.js'));

/**
 * Paint one frame of the retro screen on a classic 80x24 console, whatever the
 * size of the terminal the tests run in, and return its rows as plain text.
 */
function crtRows(prepare) {
  const { CrtScreen, stripAnsi } = crt();
  const out = process.stdout;
  const real = { write: out.write, columns: out.columns, rows: out.rows };
  let frame = '';
  out.columns = 80;
  out.rows = 24;
  out.write = (chunk) => {
    frame = String(chunk);
    return true;
  };
  try {
    const screen = new CrtScreen({ title: 'JUKORAMA', subtitle: 'party 000000' });
    screen.running = true;
    prepare(screen);
    // What matters is the frame painted once `prepare` is over: the prompt
    // hint, for one, only shows from the frame after the one ask() paints.
    screen.render();
  } finally {
    out.write = real.write;
    out.columns = real.columns;
    out.rows = real.rows;
  }
  // Drop the cursor-home sequence that starts every frame.
  return stripAnsi(frame.replace(/^\u001b\[H/, '')).split('\n');
}

/** The prompt hint must not appear behind a question. */
function crtPromptChecks() {
  const { width } = crt();
  const ask = (question) => {
    const rows = crtRows((screen) => {
      screen.ask(question);
    });
    return { rows, promptRow: rows.find((row) => row.includes(question.trim())) || '' };
  };
  const question = ask('  Tout retirer ? [O/n] ');
  const main = ask('> ');
  const hint = 'tape le titre';
  return [
    ['question row is drawn', question.promptRow !== ''],
    ['no song-title hint behind a question', !question.promptRow.includes(hint)],
    ['hint still shown on the main prompt', main.rows.some((row) => row.includes(hint))],
    ['every row is exactly 80 columns', question.rows.every((row) => width(row) === 80)],
  ];
}

/**
 * The scenarios above type through the plain reader, which hands back trimmed
 * lines. The retro frame reads keystrokes itself and must honour the same
 * contract, or "n " would be taken for the default answer of a [O/n] question.
 */
async function crtInputChecks() {
  const typed = (keys) => {
    let answer;
    crtRows((screen) => {
      answer = screen.ask('  Tout retirer ? [O/n] ');
      screen._handleData(Buffer.from(keys));
    });
    return answer;
  };
  return [
    ['a typed answer comes back without the spaces around it', (await typed(' n \r')) === 'n'],
    ['spaces alone are an empty answer', (await typed('   \r')) === ''],
    ['Ctrl+D is the end of input', (await typed('\u0004')) === null],
  ];
}

/**
 * Nothing the sessions above logged may be cut off on an 80-column console.
 *
 * The frame cuts long lines instead of wrapping them, and the rows next to the
 * corner tree are the narrowest: every line scrolls through them sooner or
 * later. Titles and uids vary, so the check is on the fixed wording: a line
 * must fit with a real-size uid, and if anything gets cut it may only be the
 * end of a song title.
 */
function crtWidthChecks() {
  const { width } = crt();
  // 'Q' appears nowhere else in the frame, so counting it measures the row.
  const rows = crtRows((screen) => screen.log('Q'.repeat(200)));
  const capacity = (rows[1].match(/Q/g) || []).length;

  const songs = Object.values(TRACKS)
    .flatMap((t) => [`${t.title} \u2014 ${t.artists}`, t.title])
    .sort((a, b) => b.length - a.length);
  const realSizeUid = 'u'.repeat(28);

  const tooWide = [];
  for (const line of loggedLines) {
    // Free-form network error details are not ours to shorten.
    if (line.startsWith('  Erreur :')) continue;
    let fixed = line.replace(/\b(?:SAVED|T\d+)\b/g, realSizeUid);
    for (const song of songs) fixed = fixed.split(song).join('\u00a7');
    if (width(fixed) > capacity) tooWide.push([`fits in ${capacity} columns: "${line}"`, false]);
  }

  return [
    ['the probe measured a row next to the tree', capacity >= 60 && capacity < 76],
    [`all ${loggedLines.size} distinct logged lines fit next to the tree`, tooWide.length === 0],
    ...tooWide,
  ];
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

let failed = 0;
let total = 0;

function report(name, checks, transcript) {
  const bad = checks.filter(([, ok]) => !ok);
  console.log(`${bad.length ? 'FAIL' : ' ok '}  ${name}`);
  for (const [label, ok] of checks) {
    total++;
    if (!ok) {
      failed++;
      console.log(`        x ${label}`);
    } else if (verbose) {
      console.log(`        . ${label}`);
    }
  }
  if (transcript && (bad.length || verbose)) {
    console.log('        ---- transcript ----');
    for (const line of transcript.split('\n')) console.log(`        | ${line}`);
  }
}

async function main() {
  for (const scenario of scenarios) {
    if (filter && !scenario.name.toLowerCase().includes(filter)) continue;
    const result = scenario.run();
    if (!result.server) {
      report(scenario.name, [['the CLI ran and the mock reported its state', false]], result.out);
      continue;
    }
    report(scenario.name, scenario.checks(result), result.out);
  }

  if (!filter || filter.includes('crt')) {
    report('crt: prompt hint only on the main prompt', crtPromptChecks(), null);
    report('crt: typed answers follow the same rules as in plain mode', await crtInputChecks(), null);
  }
  if (loggedLines.size) {
    report('crt: session messages are never cut off on an 80-column console', crtWidthChecks(), null);
  }

  console.log('');
  console.log(failed ? `${failed} check(s) failed out of ${total}.` : `All ${total} checks passed.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
