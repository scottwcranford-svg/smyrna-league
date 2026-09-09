# Refactor plan: split the single-file app

**Status:** done — Sept 9 2026, steps 0–6 as one commit each, live browser test green
after every push. **Behavior change for users:** none. Same page, same features, same URL.

What differs from the plan below: the "forms" slice became three files (`book.js` for
writes, `forms.js` for the two big forms, `dialogs.js` for the small ones) so nothing
passed ~430 lines; `state.js` exposes `touch()` (one coalesced redraw per microtask)
rather than `set(patch)`, since most changes mutate bets in place; `sleeper.js` takes a
context snapshot instead of reading state; the deploy stamp is the commit hash written
by `.github/workflows/pages.yml`, replacing `?v=dev` / `build dev` in the source.

## Why

`index.html` is 2,342 lines: 1,869 of script, 120 top-level functions, 25 fields on one
shared `state` object, 143 direct DOM lookups, and every concern in one place —
rendering, forms, sign-in, the database layer, Sleeper fetching, lock rules, ledger
math, the ticker, CSV and timezone parsing. The login-card bug (a one-line CSS rule
that kept a hidden element visible) took a dozen builds to find because nothing could
be tested in isolation and the tests checked a flag instead of the screen.

## Goals / non-goals

- **Goals:** small files with one job each; pure logic testable under Node; a real
  browser smoke test that checks what's on screen; the click-handler `if/else` chain
  replaced by an action map; no change to the data in Firestore.
- **Non-goals:** no framework, no bundler, no TypeScript, no redesign. Plain ES modules
  served by GitHub Pages as-is.

## Target layout

```
index.html        markup only + <link rel=stylesheet> + <script type="module" src="app.js">
styles.css        the CSS block, unchanged
app.js            boot: config check → auth state → open book → show app
store.js          Firestore shim (makeDb), passcode (storedKey/tryKey/setKey), leases
auth.js           emailFor/slug, sign-in/out, admin list, set/change password, forced change
sleeper.js        fetches + math: totals, throughWeek, gamesFor, weekStarts, roster; runRefresh, scoresTick
rules.js          PURE: STATS catalog, valueFor, lockTime/betLock/isLocked/firstGame, countdown,
                  autoTerms, autoName, computeLedger, coverSide, currentWeek, expire logic
render.js         head, ticker, banner, board, settle, filters, tickets, statsBar, foot; avatars
forms.js          propose/edit (draft state, picker, game mode, submit), join, settle dialog,
                  roster dialog, change-password dialog; the action map for data-act clicks
state.js          the one shared state object + tiny pub/sub (render on change)
vendor/           Firebase compat SDK (unchanged)
test/rules.test.js       node --test against rules.js
test/e2e/flow.js         puppeteer: login → book visible (computed style) → ticket count → propose form opens
```

Module boundaries: `rules.js` imports nothing and touches no DOM. `render.js` and
`forms.js` are the only modules that touch the DOM. `store.js` and `sleeper.js` are the
only modules that touch the network.

## Order of work (each step ends green)

0. **Freeze and instrument.** Tag `v1-monolith`. Write `test/e2e/flow.js` (sign in with a
   test account, wait for `#login` computed `display:none`, count tickets, open the
   propose form, screenshot). Write `test/rules.test.js` by extracting today's pure
   functions from the monolith with the same slicing used during debugging, so the
   tests exist *before* anything moves and define the baseline.
1. **rules.js.** Move the pure functions verbatim. Point the monolith at them via
   `import`. Run both test files.
2. **store.js + auth.js.** Move the Firestore shim, passcode helpers, leases, and all
   sign-in/password code. `app.js` appears here as the boot sequence; the monolith's
   boot block goes away.
3. **sleeper.js.** Move fetches and refresh/scores loops. Node test the parsers
   (`weekStartsFromCsv`, `gamesFor` shape, `valueFor` composites) against fixtures
   saved from real responses.
4. **render.js + forms.js + state.js.** Split what's left. Replace the click `if/else`
   chain with `const ACTIONS = { edit, join, take, settle, … }` keyed by `data-act`.
   `state.js` exposes `set(patch)` that schedules one `render()`; modules stop calling
   `render()` directly.
5. **styles.css.** Cut the `<style>` block out. `index.html` is markup only.
6. **Cleanup.** Drop the `build N` stamp in favour of a version from the last commit
   (written at deploy by a 10-line GitHub Action), delete dead code (`server.js`
   shim references, artifact-era comments), update README.

Steps 1–5 are each one commit and one push; Pages redeploys in about a minute, and the
e2e test runs against the live URL after each.

## Verification, every step

- `node --test test/` passes (pure logic identical to baseline).
- `node test/e2e/flow.js` against the live site: login card is *not displayed*
  (computed style, not the `hidden` flag), app is displayed, five tickets, propose
  form opens, screenshot saved for eyeballing.
- Manual: sign in on a phone once at the end.

## Risks and controls

- **A module boundary breaks a flow** (most likely: forms ↔ render calling each other).
  Control: the action map and `state.set()` are the only cross-module calls; e2e catches
  the rest.
- **ES modules and caching.** Browsers cache modules aggressively; Pages sends
  `max-age=600`. Control: `app.js?v=<commit>` query on the script tag, written by the
  same deploy step that stamps the version.
- **Firestore data shape.** Untouched. No migration.
- **Rollback.** Every step is a single commit; `git revert` and push restores the
  previous state in a minute. `v1-monolith` tag is the hard fallback.

## Effort

About half a day of focused work, plus the wait for Pages between steps. Do it in one
sitting so the tree never sits half-split.

## Done when

`index.html` is under 200 lines of markup, no file exceeds ~400 lines, `rules.js` has
no `document` reference, both test files pass, and the e2e screenshot matches today's.
