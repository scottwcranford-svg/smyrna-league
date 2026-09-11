// Roster lookups and the league's own settings line.
import test from "node:test";
import assert from "node:assert/strict";
import * as Roster from "../roster.js";

test("leagueLine: the Sleeper league's settings in one line", () => {
  assert.equal(Roster.leagueLine({ season: "2026", teams: 10, keeper: true, sf: true, scoring: "PPR" }), "2026 · 10-Team Keeper SF PPR");
  assert.equal(Roster.leagueLine({ season: "2026", teams: 12, dynasty: true, scoring: "Half PPR" }), "2026 · 12-Team Dynasty Half PPR");
  assert.equal(Roster.leagueLine(null, "2026"), "2026", "no league yet: the season alone");
  assert.equal(Roster.leagueLine(null, ""), "");
  assert.equal(Roster.scoringName(1), "PPR"); assert.equal(Roster.scoringName(0.5), "Half PPR"); assert.equal(Roster.scoringName(0), "Standard"); assert.equal(Roster.scoringName(undefined), "");
});
