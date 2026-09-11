// Which season a thing belongs to. The rule everything rests on: an untagged object is
// 2026, because the book ran a whole season before seasons existed.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../seasons.js";

test("an untagged object is the season the book started in", () => {
  assert.equal(S.LEGACY_SEASON, "2026");
  assert.equal(S.seasonOf({ id: "b1" }), "2026", "a bet written before seasons existed");
  assert.equal(S.seasonOf({ id: "p1", amount: 5 }), "2026", "and a payment");
  assert.equal(S.seasonOf(null), "2026");
  assert.equal(S.seasonOf({ season: "2027" }), "2027");
  assert.equal(S.seasonOf({ season: 2027 }), "2027", "a number reads as its year");
});

test("a manager with no seasons list played 2026", () => {
  assert.deepEqual(S.seasonsOf({ id: "a", name: "Alice" }), ["2026"]);
  assert.deepEqual(S.seasonsOf({ id: "a", seasons: [] }), ["2026"], "an empty list is not a claim");
  assert.deepEqual(S.seasonsOf({ id: "a", seasons: ["2026", "2027"] }), ["2026", "2027"]);
  assert.equal(S.inSeason({ id: "a" }, "2026"), true);
  assert.equal(S.inSeason({ id: "a" }, "2027"), false, "staying on is a decision, not a default");
  assert.equal(S.inSeason({ id: "a", seasons: ["2027"] }, "2027"), true);
});

test("withSeason adds one without repeating or reordering", () => {
  assert.deepEqual(S.withSeason({ id: "a" }, "2027"), ["2026", "2027"]);
  assert.deepEqual(S.withSeason({ id: "a", seasons: ["2026"] }, "2026"), ["2026"], "already there");
  assert.deepEqual(S.withSeason({ id: "a", seasons: ["2027"] }, "2026"), ["2026", "2027"]);
});

test("betsFor is the one filter the rest of the app leans on", () => {
  const bets = [
    { id: "old", amount: 10 },                    // untagged: 2026
    { id: "new", amount: 20, season: "2027" },
    { id: "also", amount: 30, season: "2026" },
  ];
  assert.deepEqual(S.betsFor(bets, "2026").map((b) => b.id), ["old", "also"]);
  assert.deepEqual(S.betsFor(bets, "2027").map((b) => b.id), ["new"]);
  assert.deepEqual(S.betsFor(bets, "2028").map((b) => b.id), []);
  assert.deepEqual(S.betsFor(null, "2026"), []);
});

test("currentSeason falls back rather than inventing one", () => {
  assert.equal(S.currentSeason({ season: "2027" }), "2027");
  assert.equal(S.currentSeason({ season: "" }), "2026", "a blank in the League dialog is not a season");
  assert.equal(S.currentSeason(null), "2026");
});

test("seasonList gathers every season anything claims, oldest first", () => {
  const config = { season: "2027", members: [{ id: "a" }, { id: "b", seasons: ["2027"] }] };
  const bets = [{ id: "x" }, { id: "y", season: "2027" }];
  assert.deepEqual(S.seasonList(config, bets), ["2026", "2027"],
    "the untagged bet and the listless manager both vouch for 2026");
  assert.deepEqual(S.seasonList({ season: "2026", bySeason: { 2027: {}, 2028: {} } }, []),
    ["2026", "2027", "2028"], "a season that is configured but has no records yet still counts");
  assert.deepEqual(S.seasonList(null, null), ["2026"]);
});

test("settingsFor reads a season's own, falling back to what was there before seasons", () => {
  const config = { stake: 25, kickoff: "2026-09-10T00:20:00Z", sleeperLeagueId: "L2026",
    weekStarts: { 1: "2026-09-10T00:20:00Z" },
    bySeason: { 2027: { leagueId: "L2027", stake: 50, kickoff: "2027-09-09T00:20:00Z" } } };
  const now = S.settingsFor(config, "2026");
  assert.equal(now.leagueId, "L2026", "2026 keeps reading the top-level values it always had");
  assert.equal(now.stake, 25);
  assert.deepEqual(now.weekStarts, { 1: "2026-09-10T00:20:00Z" });

  const next = S.settingsFor(config, "2027");
  assert.equal(next.leagueId, "L2027", "Sleeper mints a new league id every season");
  assert.equal(next.stake, 50);
  assert.equal(next.kickoff, "2027-09-09T00:20:00Z");
  assert.equal(next.weekStarts, config.weekStarts, "what a season doesn't override, it inherits");
});
