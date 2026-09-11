// The season roster reconcile that runs in functions/: who Sleeper says is in the league
// this year, against who the book already knows. Pure logic, no Firestore, no Auth.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const R = createRequire(import.meta.url)("../functions/roster.js");

const sleeper = (...names) => names.map((n, i) => ({ user_id: "u" + i, display_name: n }));
let n = 0;
const ids = () => "new" + (++n);
const fresh = () => { n = 0; return ids; };

test("a manager Sleeper has and the book doesn't is added, account and all", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  const plan = R.reconcile(sleeper("hobnailboot", "Amon-Ra St. Brown"), members, "2027", fresh());
  assert.equal(plan.adds.length, 1);
  assert.deepEqual(plan.adds[0].member, { id: "new1", name: "Amon-Ra St. Brown", team: "",
    sleeperId: "u1", seasons: ["2027"], color: "#A8353B" },
    "stamped with the season they joined and pinned to Sleeper, so a rename never forks them");
  assert.deepEqual(plan.adds[0].account, { email: "amonrastbrown@smyrna.league", password: "Amon-Ra St. Brown123!" },
    "the sign-in id is the app's own slug rule, and the password its default");
});

test("a manager who is still playing gets the new season, not a duplicate", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  const plan = R.reconcile(sleeper("hobnailboot"), members, "2027", fresh());
  assert.equal(plan.adds.length, 0);
  assert.deepEqual(plan.updates, [{ id: "m0", seasons: ["2026", "2027"], sleeperId: "u0" }], "and is pinned to their Sleeper id on the way past");
  // running it twice changes nothing
  const after = R.applyPlan(members, plan);
  assert.equal(R.isNoop(R.reconcile(sleeper("hobnailboot"), after, "2027", fresh())), true, "idempotent");
});

test("a manager with no seasons list is treated as 2026 and carried forward", () => {
  const plan = R.reconcile(sleeper("JPorch"), [{ id: "m1", name: "JPorch" }], "2027", fresh());
  assert.deepEqual(plan.updates, [{ id: "m1", seasons: ["2026", "2027"], sleeperId: "u0" }],
    "no list meant 2026, and now it says so");
});

test("somebody who left is kept, and simply isn't in the new season", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] },
                   { id: "m9", name: "departed", seasons: ["2026"] }];
  const plan = R.reconcile(sleeper("hobnailboot"), members, "2027", fresh());
  const after = R.applyPlan(members, plan);
  assert.equal(after.length, 2, "identity is permanent — their bets and badges still point here");
  assert.deepEqual(after.find((m) => m.id === "m9").seasons, ["2026"], "but 2027 is not theirs");
  assert.deepEqual(after.find((m) => m.id === "m0").seasons, ["2026", "2027"]);
});

test("a test account is never added and never looks like it left", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] },
                   { id: "mt", name: "testbot", test: true, seasons: ["2026"] }];
  // testbot is deliberately not in the Sleeper league
  const plan = R.reconcile(sleeper("hobnailboot"), members, "2027", fresh());
  assert.deepEqual(plan.adds, [], "nothing invented for it");
  const after = R.applyPlan(members, plan);
  assert.deepEqual(after.find((m) => m.id === "mt"), members[1], "and it is left exactly as it was");
});

test("names match the way the app matches them, and junk is skipped rather than added", () => {
  const members = [{ id: "m0", name: "HobNailBoot", seasons: ["2026"] }];
  const plan = R.reconcile(
    [{ user_id: "u1", display_name: "hobnailboot" },
     { user_id: "u2", username: "mscag" },
     { user_id: "u3", display_name: "   " },
     { user_id: "u4", display_name: "mscag" }],
    members, "2027", fresh());
  assert.deepEqual(plan.updates, [{ id: "m0", seasons: ["2026", "2027"], sleeperId: "u1" }], "case and punctuation don't split a person");
  assert.equal(plan.adds.length, 2, "username stands in when there's no display name, and a second mscag is a second person");
  assert.deepEqual(plan.adds.map((a) => a.member.name), ["mscag", "mscag"]);
  assert.deepEqual(plan.skipped.map((s) => s.why), ["no usable name"], "two people may share a display name; they cannot share a user_id");
});

test("an empty or failed Sleeper read changes nothing", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  assert.equal(R.isNoop(R.reconcile([], members, "2027", fresh())), true,
    "a bad fetch must not look like everyone leaving");
  assert.equal(R.isNoop(R.reconcile(null, members, "2027", fresh())), true);
  assert.deepEqual(R.applyPlan(members, R.reconcile([], members, "2027", fresh())), members);
});

test("the league id falls back the way the app does, not to nothing", () => {
  // The book has never set sleeperLeagueId - the app defaults it in code - so a function
  // that only read config skipped every sync with "no Sleeper league id".
  assert.equal(R.leagueIdFor(null, "2026"), R.SLEEPER_LEAGUE_ID, "no config at all still finds the league");
  assert.equal(R.leagueIdFor({}, "2026"), R.SLEEPER_LEAGUE_ID);
  assert.equal(R.leagueIdFor({ sleeperLeagueId: "L9" }, "2026"), "L9", "a book-wide override wins over the default");
  assert.equal(R.leagueIdFor({ sleeperLeagueId: "L9", bySeason: { 2027: { leagueId: "L2027" } } }, "2027"), "L2027",
    "and a season's own wins over both - Sleeper mints a new id every year");
  assert.equal(R.leagueIdFor({ sleeperLeagueId: "L9", bySeason: { 2027: { leagueId: "L2027" } } }, "2026"), "L9",
    "without reaching into another season's");
});

test("the copy of the league id has not drifted from the app's", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../roster.js", import.meta.url), "utf8");
  const m = src.match(/SLEEPER_LEAGUE_ID\s*=\s*"(\d+)"/);
  assert.ok(m, "roster.js still declares the constant");
  assert.equal(R.SLEEPER_LEAGUE_ID, m[1],
    "functions/ cannot import the browser module, so this is the check that keeps the two in step");
});

test("a manager who changes their Sleeper name keeps their history", () => {
  // The whole point of pinning: bets, badges and rivalries point at m0 by id. If a rename
  // created a second record, 2026 would stay on the old one and 2027 land on the new, and
  // the ledger would show one person twice with half a history each.
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"], sleeperId: "466" }];
  const plan = R.reconcile([{ user_id: "466", display_name: "hobnailboot_2" }], members, "2027", fresh());
  assert.deepEqual(plan.adds, [], "no second record");
  assert.deepEqual(plan.updates, [{ id: "m0", seasons: ["2026", "2027"] }], "the same person, a season longer");
  const after = R.applyPlan(members, plan);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, "m0", "and everything that points at m0 still resolves");
});

test("a name match is only adopted when nobody else owns that Sleeper account", () => {
  // m0 is pinned to 466. A different Sleeper user turning up with the same display name is
  // a different person, not a rename, and must not be folded into m0's history.
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"], sleeperId: "466" }];
  const plan = R.reconcile([{ user_id: "999", display_name: "hobnailboot" }], members, "2027", fresh());
  assert.equal(plan.adds.length, 1, "a stranger with a familiar name is still a stranger");
  assert.equal(plan.adds[0].member.sleeperId, "999");
  assert.deepEqual(plan.updates, [], "and m0 is left alone");
});

test("pinning happens once and then stops changing anything", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  const first = R.reconcile(sleeper("hobnailboot"), members, "2026", fresh());
  assert.deepEqual(first.updates, [{ id: "m0", sleeperId: "u0" }],
    "already in 2026, so the only thing to record is who they are on Sleeper");
  const after = R.applyPlan(members, first);
  assert.equal(R.isNoop(R.reconcile(sleeper("hobnailboot"), after, "2026", fresh())), true,
    "and from then on there is nothing to do");
});
