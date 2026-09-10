# Smyrna League

A shared side-bet ledger for the Smyrna League (Sleeper league `1314265150127116288`, 2026 season).
Tracks wagers made *alongside* the fantasy league — not the league itself.

**Live page:** https://scottwcranford-svg.github.io/smyrna-league/ — open it, enter the league
passcode once, pick your name.

Free end to end: the page is a static file on GitHub Pages, the shared book is in
Firestore's free tier, and every stat, score, roster and kickoff time is pulled from
Sleeper by the browser of whoever has the page open. No server, no accounts for the
league, nothing to keep awake.

## How it's put together

```
index.html        markup only: the login card, the page shell, the dialogs
styles.css        the look
app.js            boot: draw, watch sign-in, open the book, keep it current
state.js          the shared state object and touch() — one redraw per change, coalesced
render.js         draws the page from state (header, ticker, ledger, tickets, stats strip)
book.js           every change to a bet or the league: local copy first, then Firestore
forms.js          the propose/edit and join forms: draft, picker, game mode, submit
dialogs.js        settle, League (roster/passwords/admins), change password, login
actions.js        data-act → function map for clicks; binds the page's events
rules.js          PURE: stat catalog, locks, ledger math, auto names/terms, covers, parsing
store.js          Firestore shim, leases, the passcode (the only Firestore caller)
auth.js           Firebase Auth: sign in/out, who-am-I, admin flag, passwords
sleeper.js        Sleeper feeds + refresh loops (the only other network caller)
firebase-config.js    the Firebase project's public web config (not a secret)
vendor/               the Firebase compat SDK, served with the page so browsers'
                      tracking-prevention doesn't block a third-party script
test/                 unit tests (node --test) and the browser smoke test (puppeteer)
.github/workflows/pages.yml   deploys to Pages, stamping the commit into module URLs
migrate-to-firebase.py  one-time copy of data/book.json into Firestore
server.js, Dockerfile, docker-compose.yml   self-hosted alternative (see below)
```

Module rules: `rules.js` imports nothing and touches no DOM; `render.js`, `forms.js`,
`dialogs.js` and `actions.js` are the DOM writers; `store.js` and `sleeper.js` are the
network callers; `app.js` is the only file that knows about all of them.

- **The book** lives in Firestore under `books/<passcode>/…`. The security rules admit a
  path only if `SmyrnaLeague/<passcode>` exists, so the passcode is the door: the page
  never contains it, and rotating it is adding a new doc there and deleting the old one.
- **Live updates** are Firestore listeners; a change on one phone shows on the others
  in about a second.
- **Sleeper data** is fetched by the page itself (Sleeper allows browser calls). Whoever
  has the page open does the work and writes the result into the book for everyone;
  short leases keep it to one writer at a time so ten phones don't repeat the fetch.

| What | Source | Cadence |
| --- | --- | --- |
| Season stats → each bet's standings | `api.sleeper.app/v1/stats/nfl/regular/<season>` | every 15 min while a page is open, and on **Refresh stats** |
| This week's scores, quarter, clock | `api.sleeper.app/scores/nfl/regular/<season>/<week>` | every minute during games, else every ten |
| Roster for the picker | `/v1/players/nfl` (10 MB — desktop only) | weekly |
| First kickoff of each week → locks | nflverse `games.csv` (exact ET times) | daily |

Free-tier budget: a game day with the whole league on the page is a few thousand
document reads and a few hundred writes, against 50,000 and 20,000 a day.

## Setting it up (once)

1. Firebase console → new project → Firestore Database (production mode).
2. Register a web app; paste its `firebaseConfig` into `firebase-config.js`.
3. Rules (Firestore → Rules → paste `firestore.rules` → Publish). The passcode
   collection is `SmyrnaLeague` in this project; any name works as long as the rules
   and the data agree. The rules require a sign-in for everything, and let only the
   admin emails named in `league/config` change that document — the app's admin
   checks are in the browser, so the rules are what actually stop a curious manager
   with the console open. The rules aren't deployed from git; publish them by hand.
4. Firestore → Data → collection `SmyrnaLeague` → a document whose **ID is the passcode**
   (letters, digits, dashes; e.g. `smyrna-league-2026`) with any field.
5. Copy the book across: `python migrate-to-firebase.py --project <projectId> --key <passcode>`.
6. Push to GitHub. Repo → Settings → Pages → Source: **GitHub Actions**. The workflow
   in `.github/workflows/pages.yml` deploys every push to `master`, rewriting `?v=dev`
   in the module URLs to the commit hash so browsers fetch a whole build together.

## Notifications

A manager who turns them on (the menu behind their name → **Notifications off**, or
the one-time nudge on the page) gets a push when a bet is proposed, taken, passed on,
settled, cancelled or restored, when a payment is recorded, and when a week's high
and low are in. Whoever made the change never hears about it. On an iPhone the app
has to be on the home screen first (Safari only pushes to home-screen apps, iOS 16.4+);
the app walks through that when it sees an iPhone in Safari.

How it works: `notify.js` asks the browser, registers `firebase-messaging-sw.js` (from
the site's own folder — on GitHub Pages the site lives under a path, so the SDK's
default of the origin root would 404), gets a Firebase Cloud Messaging token and files
it under `league/push` as `{ byToken: { <token>: { memberId, at, ua } } }`. The Cloud
Function in `functions/` watches `bets/*`, `league/payments` and `league/highlow`,
works out who should hear (`functions/notices.js`, pure and unit-tested in
`test/notices.test.mjs`), and sends to every device those managers filed. Dead tokens
are pruned as FCM reports them. A tap opens the app at `?bet=<id>`.

Setting it up, once:

1. Firebase console → Project settings → Cloud Messaging → Web configuration →
   **Generate key pair**; paste the public key into `firebase-config.js` as `vapidKey`.
2. Upgrade the project to the **Blaze** plan (Cloud Functions need it; at this
   volume the bill is $0 — set a budget alert anyway).
3. `npm install -g firebase-tools`, `firebase login`, then from the repo root:
   `firebase deploy --only functions`. The first deploy enables Cloud Build,
   Artifact Registry and Eventarc for the project and takes a few minutes.
4. `firebase deploy --only firestore:rules` publishes `firestore.rules` from git, if
   you'd rather not paste it in the console.

`manifest.json` and the `icon-*.png` files make the site installable (home screen on
iPhone and Android, "Install app" on desktop Chrome); `index.html` carries the
viewport and Apple meta tags for the same reason.

## Working on it

```
npm install          # puppeteer-core, for the browser tests
npm test             # rules, store, auth, sleeper (pure logic, fake Firebase/Sleeper) + the UI suite
E2E_USER=<name> E2E_PASS=<password> [E2E_ADMIN=1] node test/e2e/flow.js
```

`test/ui.test.mjs` loads the real page in headless Chrome from a local server, feeds the
modules fake state, and reads the DOM back, computed style included. It covers what a
signed-in run can't: the admin's form, a bye week, a ticket from the proposer's side,
the League dialog's last-seen dates. Nothing reaches Firestore. It skips itself when
Chrome isn't at the usual path (set `CHROME` to point at it).

The live test signs in to the site, checks the login card is really gone (computed
style), the tickets and ledger render, and drives the filters, the League dialog and
the propose form (stat and game modes, the player picker) read-only. Signing in
writes one thing: the account's last-seen stamp. It runs against the live URL because
the Firebase key is locked to that domain; a local copy renders but can't sign in.

Give it its own manager. A real manager's password changes the first time they sign
in (the forced change), and the test dies with them. Add a manager such as `testbot`
in the League dialog with the admin switch on, set its password there, tick **Test**
on its row so the league never sees it (off the ledger board and out of the pickers;
it still signs in and can bet), and keep that password in the environment, never in
git. Run with `E2E_ADMIN=1` only when the account
is an app admin: the header switch must then show, off, and everything else still
render as it does for everyone.

## What it does

- **Propose a bet** — a player stat, a team stat, or a game. Stat bets pick players or a
  defense from Sleeper's roster and track one or many stats; game bets pick a game
  (winner, or over/under on the proposer's total). Name and terms write themselves.
  The proposer sets the stake (props default to the league stake; games have no default).
- **You can only put yourself on a bet.** Other sides are open seats anyone can take, or
  invitations the named manager accepts or passes from the ticket. Pot-style bets let
  anyone add themselves. Only the proposer can edit, and only the proposer can cancel,
  while it's still waiting on takers; once both sides are in, the bet stands (an admin
  can void a live bet to undo a mistake).
- **Locks an hour before kickoff** — the week's first game for stat bets, that game for
  game bets. Countdown on every ticket. A bet still waiting on a seat at lock is
  cancelled automatically.
- **Projections and status** — until something has been played, a stat ticket's standings
  show Sleeper's projections for the bet's own stat (weekly or season-long), with the
  projected leader marked; once played, actuals lead, the projection sits beside each
  and a tick on the bar marks it. The picker shows projections for the form's week and
  stats. Players carry Sleeper's status (Q, OUT, IR…) as a tag wherever they appear, and
  a bye tag on weeks their team is off. The roster refreshes every six hours from a desktop.
- **Live standings** — every stat bet shows a standings strip per tracked stat; every
  game bet shows score, quarter, clock and possession and tags the side that's ahead.
  A scores ticker runs under the header.
- **Bets settle themselves.** A game bet settles from the final score (winner, or the
  total against the line; a tie on the line is a push). A stat bet settles once every
  game of its period is final and the standings have refreshed after the last one
  ended: the leader on the stat wins, a tie is a push, and a bet tracking several stats
  goes to whoever leads the most of them. Season bets run through week 17. An admin
  can still record a result by hand, and reopen one.
- **Settle up** nets who owes whom; marking paid is separate so the P&L and the debt
  list stay honest.

House takes nothing: the full pot goes to the winner, zero-sum.

## Data

| Doc | Shape |
| --- | --- |
| `league/config` | `{leagueName, season, stake, kickoff, weekStarts:{"1":iso…}, members:[{id,name,team,color}]}` |
| `league/roster` | `{updatedAt, count, playersJson}` — `[[id,name,pos,team]]` as text (Firestore forbids nested arrays) |
| `league/games` | `{season, updatedAt, count, games:[{id, week, away, home, date, status:pre\|live\|final, awayScore?, homeScore?, q?, clock?, pos?, rz?, ot?}]}` |
| `league/refresh` | `{requestedAt, requestedBy, finishedAt, through, status}` |
| `leases/<name>` | `{holder, until}` — seat, join, scores and refresh leases |
| `bets/<id>` | `{createdAt, createdBy, week, kind, amount, name, terms, joinable, entries:[{memberId, invite?, declined?, pick, picks?:[{id,name,pos,team}], side?}], status, winner, paid:[memberId], stats?, game?, market?, line?}` |
| `bets/<id>.stats` | `{scope, tracks:[{stat,metric,lower}], rows:[{key,label,team?,memberId,entry,values:{stat:n}}], through, source, updatedAt}` |

`status`: `open` (a seat unclaimed) · `active` · `settled` · `void` (`cancelled` /
`autoVoid` say why). `week` 0 = season-long; weeks 15–17 are playoffs.

## Self-hosted alternative

`server.js` is the same app with the book in `data/book.json` and the Sleeper pulls on
the server (hourly; scores every minute). `docker compose up -d --build` runs it with an
ngrok tunnel (`.env`: `LEAGUE_KEY`, `NGROK_AUTHTOKEN`, `NGROK_DOMAIN`). It needs the
host awake; the Firebase setup above doesn't. To use it, point `index.html` back at the
server shim (git history has it).

## Sign-in, passwords and admins

Each manager signs in with **their name and a password**; the device remembers them.
Identity comes from Firebase Auth, so nobody can act as someone else. Under the hood
the account ID is `<name-slug>@smyrna.league` — never shown, never a real mailbox;
Firebase just needs an email-shaped identifier.

- **Admins** get an **Admin on/off** switch in the header. Off (the default), the app
  looks and behaves exactly as it does for any manager; on, the admin controls show.
  The switch is remembered per device. Admins are listed in
  `league/config.adminEmails`. With the switch on, on the League screen an admin
  sees a password field and an **Admin** toggle on every manager, can add/remove
  managers, edit league settings, and gets an **Update** button on any live or open
  bet (even after lock) to fix mistakes. Anyone can be flagged admin; there must
  always be at least one.
- **Setting a password** creates the manager's account (on a second Firebase app
  instance so the admin stays signed in). Changing one asks for the current password;
  if it's lost, delete the user in Firebase console → Authentication and set it again.
- **Anyone signed in** can change their own password (header → Change password; asks
  for the current one). Nobody can change anyone else's except an admin.
- **A change is required while on the default.** If the password typed at sign-in is
  `<Name>123!`, a non-dismissable "pick a new password" dialog appears before
  anything else. (Decided from what was typed — the page never probes Firebase with
  the default, which would count as failed logins and throttle the account.) An admin
  reset to Default triggers it again at the next sign-in.
- **First admin sign-in** creates the admin's own account with whatever password they
  type, as long as they're already listed in `adminEmails`.
- Firebase console, once: Authentication → Sign-in method → **Email/Password → Enable**
  (the mechanism, not a requirement for real emails). After all accounts exist,
  Authentication → Settings → User actions → **disable "Enable create (sign-up)"** so
  only existing accounts can sign in. With sign-up closed, the League dialog's Set
  button can't create an account for a manager added later (Firebase answers
  `admin-restricted-operation`). Either turn "Enable create" back on for a minute,
  press Set, and turn it off again, or add the user yourself in Authentication →
  Users → Add user, with the email `<slug>@smyrna.league` (the name lowercased with
  everything but letters and digits removed) and the password you want.

Rules: see `firestore.rules` at the repo root, and step 3 under *Setting it up*.

## About the API key in `firebase-config.js`

GitHub's secret scanning flags it as a Google API key. It is the Firebase **web** key,
which is public by design — every Firebase web app ships it — and it grants nothing
by itself: reads and writes are governed by the Firestore rules and by sign-in. It is
still hardened in Google Cloud → APIs & Services → Credentials: application
restriction = HTTP referrers (`scottwcranford-svg.github.io/*`), API restriction =
Identity Toolkit, Token Service, Cloud Firestore, Firebase Installations. That stops
the key being reused from another site (for example to hammer sign-in attempts).

## Two things worth remembering

1. **Settling is honor-system.** Sign-in proves who did what; it doesn't referee the
   result. Every action is stamped with the signed-in name.
2. **It's a ledger, not a bank.** It tracks the money; it never holds or moves it, and
   there's no rake. Keep it private and small-stakes; check your state's rule on
   social betting if in doubt.
