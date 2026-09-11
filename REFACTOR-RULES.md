# Refactor plan: split rules.js

**Status:** steps 0–5 done — Sept 11 2026. `rules.js` is now a barrel over ten modules;
no consumer has changed yet. Steps 6 (drop the barrel, one consumer per commit) and 7
(split the tests) remain. Follows [REFACTOR.md](REFACTOR.md), which split the monolith and
set the ceiling this file broke. **Behavior change for users:** none. Same page, same
features, same URL, same Firestore data.

What differs from the plan below: steps 1–5 landed as one commit rather than five,
because the modules were generated from one pass over the original and only verify as a
set. The verbatim check turned out to be stronger than planned — every one of the 90
still-exported symbols is byte-identical in source to its pre-split self
(`fn.toString()` compared across the two module graphs), so the moves are provably
mechanical. The `fmtMoney` "cleanup" was wrong and is now documented as a trap.

## Why

`rules.js` is 997 lines and 103 exports, and every module in the app imports all of it as
`R`. It is not one concern — it is thirteen that happen to share the property of not
touching the DOM:

| Lines | What lives there |
|---|---|
| [1–96](rules.js#L1-L96) | escaping, money and name formatting, time formatting |
| [97–143](rules.js#L97-L143) | kickoff, lock times, week math |
| [152–268](rules.js#L152-L268) | high/low, payments, balances |
| [269–362](rules.js#L269-L362) | projections, stat sums |
| [363–530](rules.js#L363-L530) | badges |
| [532–643](rules.js#L532-L643) | rivals |
| [644–724](rules.js#L644-L724) | ledger, cover side |
| [725–835](rules.js#L725-L835) | bet lifecycle, auto-settle |
| [836–910](rules.js#L836-L910) | CSV parsing, Eastern-time conversion |
| [911–940](rules.js#L911-L940) | member identity, emails, admin list |
| [941–997](rules.js#L941-L997) | roster, byes |

Badges, CSV parsing and sign-in identity have nothing to do with each other. The cost is
the same one REFACTOR.md named: you cannot tell what a change can reach. Editing the badge
tie rule and editing the Eastern-time offset are edits to the same file, so every change
invalidates the whole module's cache entry and every reviewer has to re-read the header
comment to remember what is in scope. `render.js` reaches for 41 distinct symbols from it
and `forms.js` for 32; nothing in either import line says which of the thirteen concerns
that file actually depends on.

REFACTOR.md's own "done when" said no file exceeds ~400 lines. This is the file that broke
it, and it broke it by 2.5×.

## Goals / non-goals

- **Goals:** ten modules with one job each, none over ~200 lines; a dependency graph with
  no cycles, so each module can be read alone; import lines that name the concern; the
  pure-logic tests split to match. No change to behavior, to the data in Firestore, or to
  what any function computes.
- **Non-goals:** no framework, no bundler, no TypeScript. No rewriting of the logic itself
  — functions move verbatim. Not touching `render.js` (825 lines) or `subscribeBook`
  (155 lines); those are separate jobs with their own risks.

## Target layout

Ten files, all at the repo root (see Risks — the deploy's `sed` glob is `*.js`), replacing
`rules.js`. Sizes are measured from today's source:

```
fmt.js        77   esc, money, signed, initials, shortName, picksText, weekLabel,
                   kindLabel, clone, entriesOf, openSeats, uid, countdown, fmtWhen,
                   toLocalInput, ago, fmtDay, nameList, r2, COLORS
clock.js      65   kickoff, firstGame, lockTime, betLock, weekLocked, isLocked,
                   currentWeek, isPlayoff, finalWeeks, allGames, teamsPlaying, onBye
identity.js   34   member, mName, mColor, slugName, emailFor, defaultPw,
                   memberForEmail, adminEmails, adminIds, isAdminMember, AUTH_DOMAIN
roster.js     68   rosterRows, statusOf, statusCode, rosterFind, teamName,
                   rosterSearch, leagueLine, scoringName, FANTASY_POS
schedule.js   76   linesFromCsv, lineFor, lineSummary, weekStartsFromCsv, etToUtc
stats.js      90   STATS, valueFor, buildStats, statsKey, projFor, trimProjections
ledger.js    161   computeLedger, balances, drillRows, highLow, hlTally, hlStake
bets.js      134   gameOf, canJoin, autoResult, autoTerms, autoName, coverSide,
                   lineOrigin, lineText
rivals.js    112   rivals, rivalPairs, rivalHighlights, rivalFeed
badges.js    175   BADGES catalog, badges, badgeChanges, badgeStory, seenAt, seenCount
```

### The dependency graph

Measured, not guessed: every top-level symbol's body was scanned for references to every
other, with comments, string literals, property accesses and shadowing locals excluded.
The result is a three-layer DAG with **no cycles**.

```
layer 0   fmt   clock   identity   roster   schedule        (import nothing)
layer 1   stats  -> fmt
          ledger -> fmt, identity
          bets   -> clock, fmt, identity
          rivals -> fmt
layer 2   badges -> clock, fmt, identity, ledger
```

That graph is what makes this safe to do incrementally: leaves first, and nothing that has
already moved ever needs to import something that has not.

Two small moves make it come out this clean, and both are worth doing on their own merits:

- **`r2` moves to `fmt.js`.** It is one line (`Math.round(n*100)/100`) currently private to
  the ledger section, but `rivals` calls it four times and `badges` once. Left where it is,
  `rivals` would have to import `ledger` for a rounding helper. Moved, the `rivals -> ledger`
  edge disappears entirely and `rivals` becomes a `fmt`-only leaf.
- **`quickText` moves to `badges.js`.** It formats a millisecond gap for the Quick Draw
  badge and has exactly one caller, in `badges`.

## Cleanups this uncovers

Small, and each is verifiable on its own — do them as part of the step that touches the
relevant file, not as a separate pass:

- `REG_WEEKS` ([rules.js:7](rules.js#L7)) is referenced nowhere, including inside rules.js.
  Delete it.
- ~~`fmtMoney` is a pure alias for `money`; inline it.~~ **Do not.** It reads like one,
  but `badges()` declares a local `var money=function(n){ return n; };` that shadows the
  module-level `money`, and `fmtMoney` is how the badge text reaches past the shadow.
  Inlining it drops the `$` from every badge value — `ui.test.mjs` catches it. It stays,
  private to `badges.js`, and now carries a comment saying why.
- 14 exports are only ever called inside rules.js and become module-private once the file
  is split: `kickoffTime`, `firstGame`, `LOCK_LEAD`, `WEEK_ANCHOR` (clock); `splitCsv`,
  `etOffsetMin`, `csvTeam`, `lineKey` (schedule); `projKeys`, `COMPOSITES` (stats);
  `HL_STAKE`, `legacyPayments`, `settleTransfers` (ledger); `isFieldBet` (bets). Dropping
  the `export` keyword shrinks the public surface from 103 to ~88 without moving a line.

## Order of work (each step ends green)

Each step is one commit and one push. Pages redeploys in about a minute; `npm test` runs
locally before the push, and the live e2e runs after it.

**0. Barrel scaffold.** Turn `rules.js` into a re-export barrel over an empty set of new
files, then add each file as it is created:

```js
export * from "./fmt.js?v=dev";
export * from "./clock.js?v=dev";
// ...
```

This is the whole safety mechanism. While the barrel stands, `import * as R from
"./rules.js"` keeps resolving all 103 symbols, so **no consumer changes in steps 1–5** and
any step can be reverted with a single `git revert`.

**1. `fmt.js` + `clock.js`.** The two highest fan-in leaves (7 and 8 consumers). Move the
functions verbatim, delete `REG_WEEKS`, move `r2` in.

**2. `identity.js` + `roster.js` + `schedule.js`.** The remaining leaves. `auth.js` already
imports its six identity symbols by name from `rules.js`
([auth.js:7](auth.js#L7)) — repoint it at `identity.js` in this step; it is the one
consumer that gets cleaner for free.

**3. `stats.js` + `ledger.js`.** First layer-1 files. `ledger` is the largest at 161 lines.

**4. `bets.js` + `rivals.js`.** Rest of layer 1.

**5. `badges.js`.** Layer 2. Delete `fmtMoney`, move `quickText` in. `rules.js` is now
nothing but the barrel.

**6. Drop the barrel, one consumer per commit.** Now the real decoupling: replace
`import * as R from "./rules.js"` with direct named imports. The measured per-file
requirements, so each commit is a known quantity:

| File | Symbols | Modules it actually needs |
|---|---|---|
| [app.js](app.js) | 4 | badges, clock, fmt, identity |
| [actions.js](actions.js) | 7 | clock, fmt, identity |
| [book.js](book.js) | 11 | badges, bets, clock, fmt, identity |
| [sleeper.js](sleeper.js) | 13 | clock, ledger, roster, schedule, stats |
| [dialogs.js](dialogs.js) | 19 | badges, bets, clock, fmt, identity, ledger |
| [forms.js](forms.js) | 32 | bets, clock, fmt, identity, roster, schedule, stats |
| [render.js](render.js) | 41 | all ten |

Do them in that order — smallest first, so the pattern is proven on `app.js` before
`render.js`. `render.js` needing all ten is not a failure of the split; it is the god
renderer showing through, and it is the argument for the next refactor.

**7. Split the tests.** [test/rules.test.mjs](test/rules.test.mjs) is 492 lines covering 48
symbols across all ten modules. Split it to match: `fmt.test.mjs`, `clock.test.mjs`,
`ledger.test.mjs`, `badges.test.mjs`, `rivals.test.mjs`, `bets.test.mjs`,
`schedule.test.mjs`, `stats.test.mjs`, `roster.test.mjs`. **Update the `test` script in
[package.json](package.json)** — it lists test files explicitly rather than globbing, so a
new file that is not added there silently never runs.

## Verification, every step

Unchanged from REFACTOR.md, because it worked:

- `npm test` passes. The pure-logic tests are the contract: functions move verbatim, so
  every assertion in `rules.test.mjs` must still pass **without being edited** in steps
  1–5. An assertion that needs changing means something moved that should not have.
- `node test/e2e/flow.js` against the live URL after each push: login card not displayed
  by computed style, app displayed, ticket count, propose form opens.
- Because the barrel keeps the public surface identical, steps 1–5 have a stronger check
  available than "tests pass": the set of names exported from `rules.js` should be
  unchanged from the previous commit except for the deliberate deletions. Diff it.

## Risks and controls

- **The deploy's `sed` glob.** [.github/workflows/pages.yml](.github/workflows/pages.yml)
  stamps the commit with `sed -i "s/?v=dev/?v=$sha/g" index.html *.js`. That glob is
  root-only and unquoted. New modules **must** sit at the repo root, or the workflow must
  be updated in the same commit — a module under `lib/` would ship with a literal `?v=dev`
  and a stale cache, which is exactly the class of bug the stamp exists to prevent. This is
  the single most likely way to break this refactor. Root-level files, and it cannot happen.
- **Every new import needs `?v=dev`.** Same reason. Easy to forget on ten new files; grep
  for `from "./` without `?v=` before each push.
- **A function moves to the wrong module.** Control: the cycle check. Re-run the dependency
  scan after each step; a new cycle means a function landed in the wrong place. The
  measured graph above is the baseline.
- **Shadowed locals reading as dependencies.** Real hazard when moving code by name:
  `autoResult` has a local `var top=0` that looks like a call to badges' `top()`. Two such
  false positives existed in the first scan of this file. Control: functions move verbatim
  with their bodies, never by copying a call graph.
- **Rollback.** Every step is one commit; `git revert` and push restores in a minute. While
  the barrel stands (steps 1–5) a revert cannot break a consumer, because no consumer
  changed.

## Out of scope, noted while measuring

- `render.js` is 825 lines with `rivalsView` at 98 and `stripHtml` at 89. Its sections map
  onto tabs and would split cleanly. Next job.
- `subscribeBook` ([app.js:80](app.js#L80)) is 155 lines: timers, leases, two racing
  snapshots, auth re-application, forced password change, DOM show/hide.
- `state` ([state.js:5](state.js#L5)) is 39 fields mixing connection status, book data, view
  state and form drafts. REFACTOR.md called out 25 fields as a reason to split the
  monolith; it has grown since. This is what makes render.js and forms.js hard to split,
  so it probably has to come before them.
- [server.js](server.js) has its own CommonJS copies of `COMPOSITES`, `splitCsv` and
  `etOffsetMin`. Genuine duplication, but it is a separate self-hosted process that never
  imports the browser modules — unaffected by this split, and out of scope.

## Done when

No file over ~200 lines where `rules.js` was; `rules.js` is gone; the dependency scan
reports no cycles; no module imports another purely for a helper it could own; `npm test`
passes with the same assertions it has today; the e2e screenshot matches; and every test
file in `test/` is listed in `package.json`.

## Effort

Steps 0–5 are mechanical — about two hours plus the wait for Pages between pushes. Step 6
is the one that needs attention, roughly an hour, and `render.js` is most of it. Step 7 is
half an hour. Do 0–5 in one sitting so the tree never sits half-split.
