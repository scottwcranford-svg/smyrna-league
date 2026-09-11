# Plan: one app, many seasons

**Status:** phase 1 done — Sept 11 2026. Nothing is visible yet; 2026 works exactly as it
did. Phase 2 is untouched. **Behavior change for users:** none until a second season is
added.

Done, beyond what phase 1 originally scoped:

- `seasons.js` and its tests; `season` stamped on every new bet and payment.
- The `state.allBets` → `state.bets` seam, and the season context resetting on every load.
- A roster sync in `functions/`, nightly and on a **Sync from Sleeper** button, which adds
  new managers with the default password, records the seasons they play, and **pins each
  manager to their Sleeper `user_id`** — without that, a display-name change forks a
  person in two and splits their history.
- Remove is only offered for a manager nothing in the book points at.

Wired so far: `LEGACY_SEASON`, `currentSeason`, `seasonOf`, `betsFor`. Written and waiting
for phase 2: `seasonsOf`, `inSeason`, `withSeason`, `seasonList`, `settingsFor`.

## Why

The app is a one-season app that doesn't know it. `config.season` exists, but it is only a
display string and a fragment of a Sleeper URL — nothing partitions on it:

| What | Today | What happens in 2027 |
|---|---|---|
| `bets/{id}` | carries `week`, no season ([forms.js:433](forms.js#L433)) | `computeLedger` sums both years; Settle Up asks JPorch to pay a 2026 debt |
| `league/highlow` | `weeks["1"]` | 2027 Week 1 lands on 2026 Week 1 |
| `league/scores` | `weeks["1"]`, frozen once `final` | 2027 Week 1 is refused, not overwritten |
| `league/badges` | "most money staked all season" | means all time |
| `league/payments` | one flat list | 2026 payments net off 2027 debts |
| `DEFAULT_KICKOFF`, `WEEK_ANCHOR` | 2026 dates ([clock.js](clock.js)) | wrong week numbers |
| `SLEEPER_LEAGUE_ID` | one id ([roster.js:5](roster.js#L5)) | Sleeper mints a **new id every season**; nothing reads `previous_league_id` |

There is no archive, reset or rollover anywhere in the repo.

## The shape of the fix

Three moves, and the third is what keeps it small.

**1. A bet knows its season.** New bets stamp `state.season`. **A bet with no `season` is
2026** — so nothing has to be written to existing records.

**2. Everything else carries the same tag.** One rule, applied to every object in the book,
rather than a second mechanism for documents:

| Object | Tag |
|---|---|
| a bet | `season: "2027"` |
| a payment | `season: "2027"` |
| a manager | `seasons: ["2026","2027"]` — a list, because a person spans seasons |
| a week of hi/low | `weeks: { "2027": { "1": … } }` |
| a week of scores | `weeks: { "2027": { "1": … } }` |
| a badge record | `byKey: { "2027": { … } }` |

Paths do not change, so **no Firestore rules change and no documents move**. The same
default covers everything already written: **an untagged object is 2026** — an untagged
bet, an untagged payment, a manager with no `seasons` list, and a `weeks` map whose keys
are week numbers rather than seasons.

The one thing to keep an eye on is that the per-season documents now grow instead of
multiplying. A season of `league/scores` is roughly 14 KB (18 weeks × 10 managers), hi/low
and badges are far smaller, and Firestore's ceiling is 1 MB per document — so this holds
for decades, and bets were never at risk because each is its own document. Worth stating
because it is the one place the tag approach could have bitten, and it does not.

### What the tag should be: the year, with the league id beside it

Tagging objects with the **Sleeper league id** instead is tempting, and it is right about
something important: Sleeper mints a *new league id every season*
(`1314265150127116288` is 2026's), chains them with `previous_league_id`, and every URL the
app builds — rosters, users, matchups, the lot — is made from it. It is the real identifier
of a season's data, and the year is only a label for it.

But it is the wrong thing to stamp on 5,000 objects:

- A side bet between two managers is not *from* the Sleeper league. It belongs to a season;
  it has no Sleeper identity of its own.
- A 19-digit number is unreadable in the Firestore console and in any log. "Which season is
  this bet?" should not need a lookup table.
- It hard-binds the book to Sleeper. Change fantasy platform, run a season Sleeper doesn't
  know about, or fix a league that was set up twice, and every row is stranded.

So bind the two rather than choose: **the year is the tag, the season record holds the
id.**

```js
config.bySeason = {
  "2026": { leagueId:"1314265150127116288", stake:25, kickoff:"…", weekStarts:{…} },
  "2027": { leagueId:"<Sleeper's next one>", … }
}
```

Objects carry `season: "2026"` — short, legible, stable. Every Sleeper URL is built from
`bySeason[season].leagueId`, which lives in exactly one place instead of the constant in
[roster.js:5](roster.js#L5). The id stops being a global and becomes a property of a
season, which is what it always was. And `previous_league_id` gives Phase 2 a nice touch:
when the admin adds 2027, the app can offer the new league id rather than asking anyone to
paste a 19-digit number.

**3. Filter once, at the boundary.** `state.bets` is read in 30 places across seven modules.
None of them change. The bets subscription keeps everything in `state.allBets`, and
`state.bets` becomes the selected season's slice:

```js
state.allBets = <everything the subscription delivers>;
state.bets    = state.allBets.filter(b => seasonOf(b) === state.season);
```

Every downstream computation — ledger, balances, badges, rivals, the drill-through,
`expireBets`, `settleFinished`, the tab counts — is season-correct for free. A missed
filter is the main risk in a change like this, and this removes the possibility of one
rather than relying on thirty careful edits.

### Book-level vs season-level

The split is **not** "the league is stable, the season rotates" — the league name and the
passcode are stable, but *who is in it is not*. Managers leave and arrive between seasons.
The real distinction is finer, and getting it wrong is the most expensive mistake available
here:

> **Identity is permanent. Participation is per season.**

A manager record *is* a person: their name, their sign-in, their colour, their password.
It must never be deleted, because 2026's bets, badges and rivalries point at it by id.
Today [identity.js:13](identity.js#L13) already falls back to `"Former manager"` when a
lookup misses — which means **removing someone from the roster right now silently guts last
season's history**: their name disappears from the ledger board, their avatar from every
ticket they were on, their titles from the badge case. That is a live foot-gun, not a
future one.

So:

- **Book-level, permanent:** the manager records themselves (`config.members`) — every
  person who has *ever* been in the league. Plus `league/seen`, `league/push`, `gate`, the
  league name and the admin list. A departed manager keeps their sign-in and can still open
  the app to read their own history.
- **Per season:** *which* of those people played. Proposed shape is a field on the member
  record, matching the per-row flags the League dialog already has (`test`, admin):
  `{ id, name, colour, seasons: ["2026","2027"] }`.
- **Also per season:** everything in the table above, plus `stake`, `kickoff`, `weekStarts`
  and `sleeperLeagueId`, via `config.bySeason[year]` with today's top-level values as the
  2026 fallback.

The rule that falls out, and that the League dialog must enforce: **you never remove a
manager, you untick the season.** Remove is the one destructive action here, and it should
stop being offered.

The knock-on is wider than it looks: 36 places read the member list, and in Phase 2
`realMembers()` becomes "the people in the season being shown". The ledger board, the
hi/low standings, the badge field and the pickers all narrow to that season — while name
and avatar lookups keep resolving against the full permanent list, so a 2026 ticket still
says *RTownsend* long after RTownsend has stopped playing.

## Why not the other designs

- **A season segment in the path** (`books/{key}/seasons/2027/bets/{id}`) is the cleanest
  isolation and my first instinct. Rejected because config would live inside a season the
  app must already know to find, and because it forces a real migration of live money
  records to get 2026 into place.
- **A suffixed document per season** (`league/highlow-2027`) was the second draft. Rejected
  in favour of tags: it needed a naming helper, a legacy-name special case, and a second
  mechanism to remember alongside the tag on bets. One rule beats two.
- **A whole new passcode per season** costs no code at all, and is the honest fallback if
  this is judged not worth building. Rejected as the plan because it is a hard cut: no
  cross-season history, no all-time records, and everyone re-enters a passcode each
  September.

## What the chain opens up

Walking `previous_league_id` from the current league goes back years:

```
2026  1314265150127116288
2025  1182536467054473216
2024  1048398072201605120
2023   986306268388204544
2022   850757873582571520
```

So 2022–2025 already exist in Sleeper and their weekly scores could in principle be pulled
in. **Decided against — the book runs 2026 forward.** Those seasons have no side bets,
because the app did not exist, so Book, Ledger, Badges, Rivals and Settle Up would all be
empty for them and only Scores would show anything. A half-populated past season is worse
than no past season.

The chain still earns its place for one thing: when the admin adds 2027,
`previous_league_id` lets the app find and offer the new league id instead of asking anyone
to paste a 19-digit number.

## What the user sees

- A **season picker**. Proposed home is beside the league name in the header, showing the
  current season and listing the others; it sets `state.season` and redraws. Everything
  already keys off that.
- An **older season is read-only**: no proposing, joining, settling or paying. The lock
  rules already refuse a kicked-off week, but this should be explicit rather than
  incidental.
- **Adding a season** is an admin job in the League dialog: the year, its Sleeper league
  id, and the stake. `weekStarts` fills itself from the schedule CSV, as it does now.
- Badges, Rivals and Settle Up read "this season" and say so. All-time records are a
  natural follow-on — `state.allBets` is right there — but are **not** in this plan.

## Now vs later

The whole thing is not worth building until there is a second season to look at. But one
part of it **gets more expensive every day it is deferred**, and that part is small.

The test for "do it now" is: *does waiting create records that later need backfilling, or
a decision that later needs unpicking?* Only two things pass it.

### Phase 1 — groundwork (now, ~2 hours, nothing visible)

Records accrue. Everything else in this document can be added cold, later, in an afternoon,
because it is either derived state that gets rewritten wholesale (badges, hi/low, scores)
or a naming convention that can be introduced at any time.

Three things cannot be reconstructed after the fact. Two of them accumulate:

- **bets** — written once per proposal, kept forever ([forms.js:433](forms.js#L433))
- **payments** — appended to a flat list, kept forever ([book.js:157](book.js#L157))

Every one written between now and the day seasons land is a row somebody has to backfill,
and backfilling money records against a live book is the single riskiest thing in this
plan. Writing `season` on them today costs one field each.

The third is **who is playing this season**, and it is the one that is genuinely lost
rather than merely awkward. Nothing in the book records it. It cannot be recovered from the
bets — those name only the people who happened to take a side bet, not the manager who
played all year and never posted one. The moment anyone is removed from the roster, 2026's
membership is gone for good and the ledger board for that season can never be drawn
correctly again. Pinning it is one field on ten records, today.

1. **`seasons.js`** — `LEGACY_SEASON = "2026"`, `seasonOf(rec)` (no stamp means 2026),
   `seasonsOf(member)` (no list means 2026), `currentSeason(config)`, and
   `docFor(name,season)` ready for later. Pure, no DOM, tested under Node.
2. **Stamp on write.** `season` on every new bet and every new payment, from
   `currentSeason(state.config)`.
3. **Pin the roster.** Every current manager gets `seasons: ["2026"]`, and `addMember`
   stamps the current season on anyone new. One write, once — and it stops being possible
   to lose.
4. **The seam.** The bets subscription fills `state.allBets`; `state.bets` becomes the
   selected season's slice. With one season it is the identical array — which is the point:
   the seam ships, is exercised by the whole existing suite, and proves itself long before
   anything depends on it. All 30 readers of `state.bets` stay as they are.
5. **Leave removal alone — there isn't any.** The League dialog can add a manager and edit
   the league's name, season, stake and kickoff ([actions.js](actions.js) `saveLeague`), but
   nothing removes a member. So the foot-gun is latent, not live: the way a manager
   currently "leaves" is by staying in the list, which is exactly the behaviour Phase 2
   wants. Nothing to do here beyond not adding a Remove button later.

That is the lot. After it, 2027 is a feature to build rather than a migration to survive.

### Phase 2 — the feature (when a second season actually exists)

Left cold deliberately; none of it gets harder by waiting. In rough order of risk:

4. **The member list narrows to the season.** The fiddly one, and the reason to do it
   first: 36 places read the roster. `realMembers()` becomes "the people in the season
   being shown" — the ledger board, the hi/low standings, the badge field and the pickers
   all follow it — while `mName` and `avatarHtml` keep resolving against the full permanent
   list, so a 2026 ticket still says *RTownsend* years after he stops playing. Getting this
   half-right is how a season ends up showing the wrong people.
5. **Season-scoped documents.** Nine of them still write to a bare name: `badges`, `games`,
   `highlow`, `lines`, `proj`, `roster`, `scores`, `sleeper`. Their weekly maps key by week
   (`weeks["1"]`) and need a season above that. `config`, `push`, `seen` and `refresh` stay
   book-level. `payments` is the exception that needs no split — its entries already carry
   `season`, so it filters like bets do.
6. **Season-scoped settings.** `settingsFor` exists and nothing calls it yet: `stake`,
   `kickoff`, `weekStarts` and `sleeperLeagueId` are still read from the top level.
7. **`sleeper.js` per season** — the league id comes from the season's settings rather than
   the constant in [roster.js:5](roster.js#L5), which `functions/roster.js` now duplicates.
8. **The picker and the read-only past.** First visible change. It must not persist the
   choice — a test already enforces that.
9. **Add-a-season in the League dialog**, admin only, offering the next league id from
   `previous_league_id` rather than asking anyone to paste nineteen digits.

## Verification

**Phase 1 has an unusually strong test available, and it should be used:** the entire
existing suite must pass **completely unedited**. Phase 1 changes no behavior for a
one-season book, so a single edited assertion means something moved that should not have.
On top of that:

- New pure tests for `seasons.js` — chiefly that an unstamped record reads as 2026.
- A test that a bet and a payment written today carry the season.
- A test that drives the seam with two seasons in `state.allBets` and asserts the ledger
  and badge totals for one exclude the other's bets. This is the assertion Phase 2 will
  lean on, and it can be written now, before anything depends on it.
- The live e2e after the push, as ever.

## Risks and controls

- **Money read across seasons.** The failure that matters: someone is asked to pay a debt
  from last year. Control: the single boundary seam, plus the totals test above.
- **`state.bets` is replaced, not mutated.** It is assigned from the snapshot in three
  places in [app.js](app.js) and filtered in one — `removeBet` at [book.js:37](book.js#L37),
  which must filter `allBets` instead, or a deleted bet reappears on the next draw. Nothing
  pushes to it, so that is the whole surface. This is the one place Phase 1 can actually
  break something.
- **The 2026 default is load-bearing.** "No stamp means 2026" keeps live data untouched,
  but it is a rule someone has to remember. It is one constant, in one module, commented —
  and the alternative is backfilling real money records.
- **Rollback.** Phase 1 is invisible; it reverts as one commit. The stamped `season` fields
  left behind are inert and correct whenever it is reapplied.

## Effort

Phase 1 about two hours, most of it tests. Phase 2 about a day when it is wanted, and no
harder for having waited.

## Done when

**Phase 1:** every new bet and payment records its season, `state.bets` is a season slice
of `state.allBets`, `seasons.js` is covered by pure tests, and the existing suite passes
with no assertion edited.

**Phase 2:** a second season can be added, the picker switches between them, an older
season is read-only, the ledger and badges for each season count only their own bets, and
2026's data was never rewritten.
