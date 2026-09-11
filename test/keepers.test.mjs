// The league's keeper rules: two players, one from rounds 3-9 and one from 10-16, at the
// round they went in; waiver pickups sit in the 9th or 10th slot; one QB; a contract runs
// two seasons and then the player goes back in the pool.
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../keepers.js";

const picks = {
  p1: { r: 1 }, p2: { r: 2 }, p4: { r: 4 }, p9: { r: 9 },
  p10: { r: 10 }, p16: { r: 16 },
};

test("the rounds decide the slot, and the first two are too early", () => {
  assert.equal(K.statusOf("p1", picks.p1, {}, {}).band, null, "a first-rounder is not keepable");
  assert.match(K.statusOf("p2", picks.p2, {}, {}).why, /too early/);
  assert.equal(K.statusOf("p4", picks.p4, {}, {}).band, "early");
  assert.equal(K.statusOf("p9", picks.p9, {}, {}).band, "early", "nine is the top of the first band");
  assert.equal(K.statusOf("p10", picks.p10, {}, {}).band, "late", "ten starts the second");
  assert.equal(K.statusOf("p16", picks.p16, {}, {}).band, "late");
  assert.equal(K.statusOf("p4", picks.p4, {}, {}).cost, 4, "and it costs the round they went in");
});

test("a player who was never drafted is a waiver keeper", () => {
  const s = K.statusOf("free", null, {}, {});
  assert.equal(s.band, "wire");
  assert.equal(s.wire, true);
  assert.equal(s.cost, null, "with no round of their own until a slot is chosen");
  assert.equal(K.costOf({ band: "wire" }, "early"), 9);
  assert.equal(K.costOf({ band: "wire" }, "late"), 10, "so two waiver players can be kept, 9 and 10");
  assert.equal(K.costOf({ band: "late", cost: 12 }, "late"), 12, "a drafted keeper still costs their own round");
});

test("a contract runs two seasons, however many managers it passed through", () => {
  assert.equal(K.seasonsKept("x", {}, {}), 0, "drafted fresh last year");
  assert.equal(K.seasonsKept("x", { x: 1 }, {}), 1, "kept once - one year left");
  assert.equal(K.seasonsKept("x", { x: 1 }, { x: 1 }), 2, "kept twice - spent");
  assert.equal(K.seasonsKept("x", {}, { x: 1 }), 0,
    "kept two years ago but not last year: they went back in the pool and the clock restarted");

  const spent = K.statusOf("x", picks.p4, { x: 1 }, { x: 1 });
  assert.equal(spent.band, null, "so they cannot be kept again");
  assert.match(spent.why, /back in the pool/);
  const once = K.statusOf("x", picks.p4, { x: 1 }, {});
  assert.equal(once.band, "early", "but one season kept still leaves a second");
});

test("eligible() reads a whole roster in one go", () => {
  const nameOf = (id) => ({ p4: { name: "Bo Nix", pos: "QB" }, p10: { name: "DK Metcalf", pos: "WR" },
    free: { name: "Kayshon Boutte", pos: "WR" }, p1: { name: "Jahmyr Gibbs", pos: "RB" } }[id]);
  const out = K.eligible(["p4", "p10", "free", "p1"], picks, {}, {}, nameOf);
  assert.deepEqual(out.map((o) => [o.name, o.band, o.cost]), [
    ["Bo Nix", "early", 4], ["DK Metcalf", "late", 10],
    ["Kayshon Boutte", "wire", null], ["Jahmyr Gibbs", null, 1]]);
  assert.deepEqual(K.eligible(null, picks, {}, {}, nameOf), [], "an empty roster is not a crash");
});

test("two keepers, one per band, and only one of them a QB", () => {
  const early = { name: "Bo Nix", pos: "QB", band: "early", cost: 4 };
  const early2 = { name: "Trey McBride", pos: "TE", band: "early", cost: 3 };
  const late = { name: "DK Metcalf", pos: "WR", band: "late", cost: 11 };
  const lateQb = { name: "Kyler Murray", pos: "QB", band: "late", cost: 10 };

  assert.equal(K.checkChoice([]).ok, true, "keeping nobody is allowed");
  assert.equal(K.checkChoice([early]).ok, true, "so is keeping one");
  assert.equal(K.checkChoice([early, late]).ok, true, "one from each band is the normal case");

  assert.deepEqual(K.checkChoice([early, early2]).problems, ["Only one keeper from rounds 3–9"]);
  assert.deepEqual(K.checkChoice([early, lateQb]).problems, ["Only one QB can be kept"],
    "two QBs is out even when the bands are right");
  assert.equal(K.checkChoice([early2, lateQb]).ok, true, "one QB is fine");
  assert.deepEqual(K.checkChoice([early, late, early2]).problems.includes("Two keepers at most"), true);

  const spent = { name: "Jayden Daniels", pos: "QB", band: null, why: "kept two seasons — back in the pool" };
  assert.deepEqual(K.checkChoice([spent]).problems,
    ["Jayden Daniels can't be kept — kept two seasons — back in the pool"],
    "and it says why, by name");
});

test("waiver keepers take a slot, and there are only two", () => {
  const wire = { name: "Kayshon Boutte", pos: "WR", band: "wire" };
  const wire2 = { name: "Somebody Else", pos: "RB", band: "wire" };
  const early = { name: "Bo Nix", pos: "QB", band: "early", cost: 4 };
  const late = { name: "DK Metcalf", pos: "WR", band: "late", cost: 11 };

  assert.equal(K.checkChoice([wire]).ok, true);
  assert.equal(K.checkChoice([wire, wire2]).ok, true, "two waiver keepers, the 9th and 10th slots");
  assert.equal(K.checkChoice([wire, early]).ok, true, "a waiver player can sit in the other slot");
  assert.deepEqual(K.checkChoice([wire, early, late]).problems.includes("Two keepers at most"), true);
  assert.deepEqual(K.checkChoice([early, late].concat([wire])).problems.includes("Two keepers at most"), true,
    "with both bands already spoken for, there is nowhere for a third");
});

test("every problem is reported, not just the first", () => {
  const r = K.checkChoice([
    { name: "A", pos: "QB", band: "early", cost: 4 },
    { name: "B", pos: "QB", band: "early", cost: 5 },
    { name: "C", pos: "RB", band: null, why: "round 1 — too early to keep" },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 4, "too many, C ineligible, two from one band, two QBs");
});
