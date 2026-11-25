<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/jukorama-dark.svg">
    <img src="docs/jukorama.svg" alt="Jukorama" width="420">
  </picture>
</p>

# Jukorama

Vote for the songs of a Festify party from the command line or from a local
web page, instead of hunting for the track in a 400-song list on your phone.

> **Nouveau : mode interactif.** Double-clique sur `Voter.cmd`, tape le titre,
> c'est voté. Voir **[TUTO.md](TUTO.md)** (en français) pour le mode d'emploi pas à pas.

```bash
node jukorama.js shell                  # interactive: type a title, press Enter
node jukorama.js vote "Paparazzi"
node jukorama.js vote "Cheater's Town" "Chris Isaak"
node vote.js "Paparazzi"               # shim for "/vote ..."
```

## Commands

| Command | What it does |
| --- | --- |
| `node jukorama.js` (no args) | Interactive mode when run in a terminal |
| `node jukorama.js shell` | Interactive mode, explicit |
| `node jukorama.js party` | Party name, code, settings, queue size, your uid |
| `node jukorama.js whoami` | Show the anonymous identity in use |
| `node jukorama.js list [query]` | List the queue sorted by votes; filter with a query |
| `node jukorama.js index [--refresh]` | Build/refresh the local title cache |
| `node jukorama.js vote <title> [artist]` | Cast a vote |
| `node jukorama.js unvote <title> [artist]` | Remove your vote |
| `node jukorama.js myvotes` | List the votes held by your identity |
| `node jukorama.js reset` | Remove all your votes and forget your identity |
| `node jukorama.js <cmd> --private` | Run once with a throwaway identity, then erase it |
| `node jukorama.js <cmd> --dry-run` | Show what would happen |
| `node jukorama.js <cmd> --pick <n>` | Choose a candidate when the match is ambiguous |
| `node jukorama.js <cmd> --party <id>` | Target another party |
| `node jukorama.js web [--port n]` | Same session, in a local browser page (see [The television](#the-television)) |

`Voter.cmd` is a double-click launcher for Windows: it checks that Node.js is
installed, starts `jukorama.js shell`, and keeps the window open afterwards.
`Voter-web.cmd` opens the same session as a local page, and
`Voter-web-prive.cmd` is that page in private mode. The window that opened the
page has to stay open: it is the program that votes.

In interactive mode, `liste` prints the ranking and `quitter` exits — on exit it
asks whether to keep your votes, defaulting to yes. A leading `/vote ` is
stripped so the `/vote <titre>` habit works.

After confirming a track, the session asks **how many votes** to cast (Enter =
1). `mesvotes` and `reset` then always speak about *everything you cast*, not
about whichever account happens to be current:

- `mesvotes` lists the saved profile's votes plus the extra ones cast this
  session; in private mode it lists the whole session with live totals.
- `reset` withdraws all of them, then reports how many were removed and the new
  total of every track involved (`J’ai retiré 5 vote(s)…` /
  `Maintenant 22 votes au total : Zoo — Kaaris`). In a normal session it also
  forgets the saved profile and requires typing `reset` to confirm; in private
  mode it never touches the saved profile.
- Typing the title of a track you already voted for offers `[r]` (withdraw all
  your votes on that track, with the same report) or `[v]` (add more).

A vote that could not be withdrawn (network error) is reported as such and
stays on the books, so retyping `reset` retries it.

## How Festify works

Festify is a static single-page app with a Firebase backend, so there is no
custom REST API to call: the app talks straight to a Firebase Realtime Database.

- **Auth**: Firebase Auth. Guests get an anonymous account
  (`accounts:signUp` on Identity Toolkit). No email, no password.
- **Data**: a single RTDB at `festify-79b08.firebaseio.com` with the nodes
  `/parties`, `/tracks`, `/votes`, `/votes_by_user`, `/tracks_played`.
- **A vote** is two writes that the app performs with the guest's own uid:

```
/votes/<partyId>/<trackKey>/<uid>          = true
/votes_by_user/<partyId>/<uid>/<trackKey>  = true
```

  `trackKey` is `spotify-<spotifyTrackId>`. Unvoting deletes both keys (the web
  app writes `false` instead, so only `true` entries are votes).
  A server-side trigger keeps `vote_count` in sync, so the counter is never
  written by the client — and it is updated a moment *after* the write. Right
  after voting or withdrawing, the CLI therefore counts the `true` entries under
  `/votes/<partyId>/<trackKey>` instead of reading `vote_count` back (checked on
  the live party: the two agree on every queued track). A track whose last vote
  is withdrawn leaves the queue.
- **Access rules, as observed**:
  - `/tracks/<partyId>` — readable by anyone (this is how the queue loads).
  - `/votes/<partyId>/<trackKey>` — readable, so vote totals are public.
  - `/votes_by_user/<partyId>` — *not* readable, but you can write your own uid.
    Child-level deletes are allowed; deleting the whole `<uid>` node is **not**
    (`Permission denied`), which is why `reset` removes votes one by one.
  - `/metadata/<partyId>` — not readable by guests, which is why track titles
    have to be resolved from Spotify.
  - `/tracks/<partyId>/...` — **write denied** for guests: you cannot add a song
    to the queue, only vote on songs already there.

Because the write is scoped to your own uid, one identity equals one vote per
track, exactly like the web UI. Casting more than one vote on a track therefore
takes more identities, which is what the "how many votes?" question does: the
first vote comes from the saved profile, every extra one from a throwaway
anonymous account that lives in memory only and is deleted on exit — the same
thing as reopening a private browser window. The tool does not hide it: it
says what each vote is, keeps count, and can undo all of it (see below).

### Session ledger

`sessionVotes` holds every vote cast during the run as `{ key, auth,
throwaway }`. It is the single source of truth for the status bar, `mesvotes`,
`reset`, `[r]` and the exit recap, in both modes, so they cannot contradict each
other. An entry leaves the ledger only when its vote is really gone from the
server. Two rules follow from it:

- **Votes are withdrawn per owner.** Each extra vote belongs to a different
  account and one token cannot delete another account's entry, so the undo
  authenticates as the account stored with the vote.
- **Throwaway accounts never touch the saved profile.** While one is in use,
  `loadAuth()`/`saveAuth()`/`forgetIdentity()` ignore `data/auth.json`, and the
  accounts carry an `ephemeral` flag so that a later token refresh cannot write
  them to disk either. A normal session returns to the saved profile as soon as
  a batch of votes is cast.

Extra votes can only be withdrawn during the session that cast them: once the
program exits, their accounts are gone.

## Setup

```bash
node jukorama.js party     # creates data/auth.json with an anonymous identity
node jukorama.js index     # resolves titles for the current queue (~1-3 min)
```

`JUKORAMA_DATA_DIR` overrides where `auth.json` and the index live, which is handy
for throwaway identities when testing.

Titles are cached in `data/tracks-index.json`. Run `index` again when tracks are
added; the script also does this automatically when the queue has grown.

`data/auth.json` holds the anonymous identity that owns your votes. Keep it — a
new identity is a new vote slot, which would defeat the point of voting once.
`reset` is the supported way to start over: it deletes your votes first, then
the local identity.

### Corporate proxy / TLS interception

Two independent things have to be right, and only the first one was handled
previously:

1. **Certificates.** `jukorama.js` trusts the OS store at startup
   (`tls.setDefaultCACertificates`), so re-signed TLS traffic verifies.
2. **Proxy usage.** Node's `fetch()` connects *directly* unless proxy support is
   enabled at startup via `--use-env-proxy` or `NODE_USE_ENV_PROXY=1`. Merely
   having `HTTPS_PROXY` set is not enough — undici ignores it, and the request
   fails with `UND_ERR_CONNECT_TIMEOUT` against the real IPs. That was the bug:
   the bootstrap saw `HTTPS_PROXY` and assumed the proxy was in use.

`bootstrapProxyIfNeeded()` now checks whether proxy support is *actually active*
(`execArgv` contains `--use-env-proxy`, or `NODE_USE_ENV_PROXY === '1'`). If not,
it resolves a proxy URL (environment first, then `ProxyEnable`/`ProxyServer` from
`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, which a
double-clicked process can still read) and re-execs itself once with
`NODE_USE_ENV_PROXY=1`, preserving any flags it was started with. A
`JUKORAMA_PROXY_BOOTSTRAPPED` marker prevents loops.

Network failures surface the underlying cause (`UND_ERR_CONNECT_TIMEOUT`,
`ENOTFOUND`, `CERT_*`, …) and explicitly say when a proxy is configured but not
being used. `Voter.cmd` prints a diagnostic block on non-zero exit.

## Matching

`vote` accepts a fragment of the title, an artist name, or both, in any order
and without accents or punctuation:

- exact title → confident
- title prefix / substring → confident
- artist name → confident when it points at one track
- fuzzy token overlap → only accepted if the best candidate clearly wins

When the match is ambiguous the script prints the top candidates and refuses to
guess, so a typo cannot silently vote for the wrong song.

## Private mode (GDPR)

`Voter-prive.cmd`, or `JUKORAMA_PRIVATE=1` / `--private`.

Festify stores no name or email for anonymous voters, so the uid is the only
personal identifier that exists. Private mode:

- creates throwaway anonymous accounts for the run, **never written to disk**
  (`saveAuth()` becomes a no-op, so nothing on the machine links to them);
- **uses a fresh account for every repeat vote** on a track, so the user picks
  how many votes to cast;
- prints a running reminder on each repeat (`! C'est ton 2e vote…`) and a recap
  on exit, so the user always knows what they are doing;
- makes `mesvotes` and `reset` cover the whole session rather than the current
  account, and leaves the saved profile of normal sessions strictly alone;
- offers to withdraw the session's votes on exit, then deletes every throwaway
  account (`accounts:delete` — art. 17 GDPR);
- also runs on `SIGINT`, so Ctrl+C cannot bypass it.

Design position: the tool does not police how many votes a person casts. A
browser in private mode already allows the same thing; what this adds is
visibility — the user is told, in plain language, what they cast and how often.
Keeping that information visible is the point, not blocking the action.

Two implementation notes worth keeping:

- **Votes are deleted per owner**, through the session ledger described above.
  (Bugs found along the way: a single-token undo removed only 1 vote out of 2,
  and a `reset` that looked at the current account only removed 1 vote out of 5
  while `mesvotes` still counted 5.)
- **Any withdrawal happens before account deletion.** A deleted account's
  `idToken` is still accepted by the Realtime Database for a while (a write
  returned `200` after `accounts:delete`), but once the account is gone we can no
  longer authenticate as that uid.

## The television

`node jukorama.js web` serves one page on `127.0.0.1` (port 4737 unless `--port`
says otherwise) and opens it: an old wooden television in a snowy garden. Its
screen does everything the terminal does — choose a mode, search, vote several
times, see and withdraw one's votes, reset, leave — and the set has its own
controls: a power button, faders for the snow, the tube effect and the sound,
and a music box that plays seven public-domain carols.

The set carries the Jukorama logo, traced as vector outlines that are declared
once at the top of `web/index.html`. It warms up on a station ident (the tube
takes the colour of the badge and shows its white “j”, so the television itself
becomes the logo), the teletext header bar has the badge in white, the pages
without a header show the whole logo in white, the maker's plate wears it in
colour, and one confetti in eight is a badge. The page is Jukorama's own: it
never names the service it votes on.

| File | Role |
| --- | --- |
| `web.js` | The HTTP server: static files, the JSON API, the checks below |
| `web-session.js` | Turns the vote primitives of `jukorama.js` into JSON; calls are serialized |
| `covers.js` | Reads the address of a cover out of Spotify's page; picks its size |
| `web/index.html`, `web/css/` | The set, its screen, the scene |
| `web/js/*.mjs` | ES modules, no build step: pages and keys (`app`), covers, tube, scene, snow, tree, sound… |
| `web/music/` | The carols (`.mid`, CC0), their order, and `CREDITS.txt` |

**It is this machine's voter, not a website.** The server only listens on the
loopback address. A request is refused when its `Host` is not this server, when
its `Origin` or `Sec-Fetch-Site` says it comes from another site, and — for
everything under `/api/` except covers — when it lacks the random token printed
into the page. The page is served with a strict Content-Security-Policy:
nothing is loaded from anywhere else, and there is no inline script or style.

**Covers.** The queue only stores Spotify ids, so the address of a picture
comes from the track's public embed page, and the picture itself from Spotify's
image host; `GET /api/cover?id=…[&size=small]` serves the bytes, so the browser
never talks to Spotify. Rows use the 64 px file, the voting page the 300 px
one. Addresses are looked up in the background as soon as the queue is known
(best ranked first, four requests at a time at most, rows on screen first) and
saved in `data/tracks-index.json`, so only the first launch has to find them.
A picture that could not be fetched answers 502 and the page asks again; a
track without picture answers 404 and keeps its lettered tile.

`node test/preview.js [port] [private]` runs the page against the fake server
with 34 made-up songs, for working on it without touching a real party. Its
covers are drawn stand-ins (a record on a coloured sleeve), not photographs.

## Tests

```bash
node test/offline.test.js              # terminal scenarios, ~15 s, no network
node test/web.test.js                  # the television, against the same fake server
node test/run-all.js                   # both, which is what the packager runs
```

Both suites run the real program against
`test/mock-firebase.js`, an in-memory stand-in for Firebase Auth and the
Realtime Database that enforces the same ownership rule and can misbehave on
demand (failed deletes, dropped connections, expired tokens, a `vote_count` that
lags behind). Each scenario checks both what the program said and what the fake
server ended up with, and a last check makes sure no message would be cut off
in the retro frame on an 80-column console. Nothing in it can reach the real
party. Set `JUKORAMA_CLI=dist/jukorama.js` to run it against the packaged copy.

The web suite also follows every file the page loads and fails when a file
under `web/` is used by nothing, when the page carries inline script or style,
when it uses a drawing it does not declare, when it names the service behind
it, when another site gets an answer, or when a carol cannot be played or is
not credited. With `MOCK_CATALOG` the fake server answers for Spotify too, which
covers the first launch and the covers.

`build-dist.cmd` runs the suite before packaging and refuses to build a zip if
it fails: it leaves the existing zip alone and exits with code 1. The `test/`
folder is not shipped.

## Why the vote cannot be added to the queue

If a title is not in the queue, `vote` says so and lists what is nearby.
Festify's security rules only let the party host add tracks, and guests cannot
write to `/tracks`. So the workflow is: add the song from the web app
(party `375513`), then run `vote` for it.
