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
index.html            the whole app
firebase-config.js    the Firebase project's public web config (not a secret)
vendor/               the Firebase compat SDK (app + firestore), served with the page so
                      browsers' tracking-prevention doesn't block a third-party script
migrate-to-firebase.py  one-time copy of data/book.json into Firestore
server.js, Dockerfile, docker-compose.yml   self-hosted alternative (see below)
```

- **The book** lives in Firestore under `books/<passcode>/…`. The security rules admit a
  path only if `keys/<passcode>` exists, so the passcode is the door: the page never
  contains it, and rotating it is adding a new `keys/` doc and deleting the old one.
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
3. Rules (Firestore → Rules → Publish). The passcode collection is `SmyrnaLeague` in
   this project; any name works as long as the rules and the data agree:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /SmyrnaLeague/{key} { allow read, write: if false; }
       match /books/{key}/{doc=**} {
         allow read, write: if exists(/databases/$(db)/documents/SmyrnaLeague/$(key));
       }
     }
   }
   ```
4. Firestore → Data → collection `SmyrnaLeague` → a document whose **ID is the passcode**
   (letters, digits, dashes; e.g. `smyrna-league-2026`) with any field.
5. Copy the book across: `python migrate-to-firebase.py --project <projectId> --key <passcode>`.
6. Push to GitHub; Pages serves `index.html` from `main`.

## What it does

- **Propose a bet** — a player stat, a team stat, or a game. Stat bets pick players or a
  defense from Sleeper's roster and track one or many stats; game bets pick a game
  (winner, or over/under on the proposer's total). Name and terms write themselves.
  The proposer sets the stake (props default to the league stake; games have no default).
- **You can only put yourself on a bet.** Other sides are open seats anyone can take, or
  invitations the named manager accepts or passes from the ticket. Pot-style bets let
  anyone add themselves. Only the proposer can edit; the proposer can cancel while it's
  waiting on takers; once live only the people in it can void it.
- **Locks an hour before kickoff** — the week's first game for stat bets, that game for
  game bets. Countdown on every ticket. A bet still waiting on a seat at lock is
  cancelled automatically.
- **Live standings** — every stat bet shows a standings strip per tracked stat; every
  game bet shows score, quarter, clock and possession and tags the side that's ahead.
  A scores ticker runs under the header.
- **Settle** by naming the winner (or push); **settle up** nets who owes whom; marking
  paid is separate so the P&L and the debt list stay honest.

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

- **Admins** are listed in `league/config.adminEmails`. On the League screen an admin
  sees a password field and an **Admin** toggle on every manager, can add/remove
  managers, edit league settings, and gets an **Update** button on any live or open
  bet (even after lock) to fix mistakes. Anyone can be flagged admin; there must
  always be at least one.
- **Setting a password** creates the manager's account (on a second Firebase app
  instance so the admin stays signed in). Changing one asks for the current password;
  if it's lost, delete the user in Firebase console → Authentication and set it again.
- **Anyone signed in** can change their own password (header → Change password; asks
  for the current one). Nobody can change anyone else's except an admin.
- **A change is required while on the default.** At every sign-in and page load the
  page silently re-signs-in with `<Name>123!`; if that works, a non-dismissable
  "pick a new password" dialog appears. An admin reset to Default triggers it again.
- **First admin sign-in** creates the admin's own account with whatever password they
  type, as long as they're already listed in `adminEmails`.
- Firebase console, once: Authentication → Sign-in method → **Email/Password → Enable**
  (the mechanism, not a requirement for real emails). After all accounts exist,
  Authentication → Settings → User actions → **disable "Enable create (sign-up)"** so
  only existing accounts can sign in.

Rules (Firestore → Rules): reads need the league passcode path; writes need a signed-in
member; `league/config` writes need an admin:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function opened(key){ return exists(/databases/$(db)/documents/SmyrnaLeague/$(key)); }
    function member(){ return request.auth != null && request.auth.token.email != null
      && request.auth.token.email.matches('.*@smyrna[.]league'); }
    function admin(key){ return member()
      && request.auth.token.email in get(/databases/$(db)/documents/books/$(key)/league/config).data.adminEmails; }
    match /SmyrnaLeague/{key} { allow read, write: if false; }
    match /books/{key}/league/config { allow read: if opened(key); allow write: if admin(key); }
    match /books/{key}/{col}/{id} {
      allow read: if opened(key);
      allow write: if opened(key) && member() && !(col == 'league' && id == 'config');
    }
  }
}
```

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
