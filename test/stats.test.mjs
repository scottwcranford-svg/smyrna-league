// The stat catalog, composite sums and weekly projections.
import test from "node:test";
import assert from "node:assert/strict";
import * as Stats from "../stats.js";

test("valueFor sums composites and combined keys", () => {
  assert.equal(Stats.valueFor("HOU", "takeaways", { HOU: { int: 19, fum_rec: 8 } }), 27);
  assert.equal(Stats.valueFor("a+b", "rec_yd", { a: { rec_yd: 100 }, b: { rec_yd: 50.5 } }), 150.5);
  assert.equal(Stats.valueFor("zz", "pts_ppr", {}), 0);
  assert.equal(Stats.valueFor("a", "rush_rec_yd", { a: { rush_yd: 84, rec_yd: 31.5 } }), 115.5, "rushing + receiving yards");
  assert.equal(Stats.STATS.player.some((s) => s[0] === "rush_rec_yd"), true, "offered in the catalog");
});

test("projections: trimmed to the roster and the tracked stats, read with valueFor", () => {
  const raw = {
    "2": { rec_yd: 82.46, rec: 5.2, pts_ppr: 17.1, adp_dd_ppr: 12, pass_yd: 0 },
    "3": { pass_yd: 241.3, pass_td: 1.6, rush_td: 0.2, rec_td: 0.05 },
    "9": { rec_yd: 40 },            // not on the roster
    SEA: { sack: 2.4, int: 0.8, fum_rec: 0.5, pts_allow: 20.3 },
  };
  const trimmed = Stats.trimProjections(raw, ["2", "3", "SEA", "missing"]);
  assert.deepEqual(Object.keys(trimmed).sort(), ["2", "3", "SEA"]);
  assert.equal(trimmed["2"].rec_yd, 82.5, "one decimal"); assert.equal("adp_dd_ppr" in trimmed["2"], false, "untracked keys dropped");
  assert.equal("pass_yd" in trimmed["2"], false, "zeros dropped");
  const proj = { weeks: { "5": JSON.stringify(trimmed) } };
  const P = Stats.projFor(5, proj);
  assert.equal(Stats.valueFor("2", "rec_yd", P), 82.5, "the bet's own stat");
  assert.equal(Stats.valueFor("3", "td_scored", P), 0.3, "composites work on projections too");
  assert.equal(Stats.valueFor("SEA", "takeaways", P), 1.3);
  assert.equal(Stats.valueFor("2+3", "rec_yd", P), 82.5, "combined picks add up");
  assert.equal(Stats.projFor(6, proj), null, "no projections for that week");
  assert.equal(Stats.projFor(5, null), null);
  assert.equal(Stats.projFor(5, proj), P, "parsed once, then cached");
  assert.deepEqual(Stats.trimProjections([1, 2], ["2"]), {}, "a bad payload is an empty set");
});
