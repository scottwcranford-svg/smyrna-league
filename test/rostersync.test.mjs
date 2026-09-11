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
    seasons: ["2027"], color: "#A8353B" }, "stamped with the season they joined");
  assert.deepEqual(plan.adds[0].account, { email: "amonrastbrown@smyrna.league", password: "Amon-Ra St. Brown123!" },
    "the sign-in id is the app's own slug rule, and the password its default");
});

test("a manager who is still playing gets the new season, not a duplicate", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  const plan = R.reconcile(sleeper("hobnailboot"), members, "2027", fresh());
  assert.equal(plan.adds.length, 0);
  assert.deepEqual(plan.seasonAdds, [{ id: "m0", seasons: ["2026", "2027"] }]);
  // running it twice changes nothing
  const after = R.applyPlan(members, plan);
  assert.equal(R.isNoop(R.reconcile(sleeper("hobnailboot"), after, "2027", fresh())), true, "idempotent");
});

test("a manager with no seasons list is treated as 2026 and carried forward", () => {
  const plan = R.reconcile(sleeper("JPorch"), [{ id: "m1", name: "JPorch" }], "2027", fresh());
  assert.deepEqual(plan.seasonAdds, [{ id: "m1", seasons: ["2026", "2027"] }],
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
  assert.deepEqual(plan.seasonAdds, [{ id: "m0", seasons: ["2026", "2027"] }], "case and punctuation don't split a person");
  assert.equal(plan.adds.length, 1, "username stands in when there's no display name");
  assert.equal(plan.adds[0].member.name, "mscag");
  assert.deepEqual(plan.skipped.map((s) => s.why), ["no usable name", "listed twice in the Sleeper league"]);
});

test("an empty or failed Sleeper read changes nothing", () => {
  const members = [{ id: "m0", name: "hobnailboot", seasons: ["2026"] }];
  assert.equal(R.isNoop(R.reconcile([], members, "2027", fresh())), true,
    "a bad fetch must not look like everyone leaving");
  assert.equal(R.isNoop(R.reconcile(null, members, "2027", fresh())), true);
  assert.deepEqual(R.applyPlan(members, R.reconcile([], members, "2027", fresh())), members);
});
