// Roster lookups and the league's own settings line.
import test from "node:test";
import assert from "node:assert/strict";
import * as Roster from "../roster.js";

test("search: team, position and name narrow together; the name only matches names", () => {
  const roster = { players: [
    ["1", "Zed Fullback", "FB", "KC"], ["2", "Cyrus Allen", "WR", "KC"], ["3", "Patrick Mahomes", "QB", "KC"],
    ["4", "Hurt Receiver", "WR", "KC", "IR"], ["5", "Harrison Butker", "K", "KC"], ["6", "Bo Nix", "QB", "DEN"],
    ["7", "Aaron Receiver", "WR", "KC"], ["8", "Denzel Mims", "WR", "PIT"], ["9", "Gardner Minshew", "QB", "KC"],
    ["KC", "Kansas City Chiefs", "DEF", "KC"],
    ...Array.from({ length: 50 }, (_, i) => [`w${i}`, `Jo Wideout${i}`, "WR", "NYJ"]) ] };
  const names = rows => rows.map(r => r[1]);
  assert.deepEqual(Roster.rosterSearch("", "player", roster), [], "nothing typed, nothing picked: no list");
  assert.deepEqual(Roster.rosterSearch("m", "player", roster), [], "one letter isn't a search on its own");
  assert.deepEqual(names(Roster.rosterSearch("", "player", roster, { team: "KC" })),
    ["Gardner Minshew", "Patrick Mahomes", "Aaron Receiver", "Cyrus Allen", "Hurt Receiver", "Harrison Butker", "Zed Fullback"],
    "a whole team: by position, IR last among the receivers, no defense, no cap");
  const score = r => ({ "3": 24, "9": 3 })[r[0]] || 0;
  assert.deepEqual(names(Roster.rosterSearch("", "player", roster, { team: "KC", pos: "QB", score })), ["Patrick Mahomes", "Gardner Minshew"], "the starter's projection puts him first");
  assert.deepEqual(names(Roster.rosterSearch("mah", "player", roster, { team: "KC", pos: "QB" })), ["Patrick Mahomes"]);
  assert.deepEqual(names(Roster.rosterSearch("den", "player", roster)), ["Denzel Mims"], "den is a name, never the Broncos");
  assert.deepEqual(names(Roster.rosterSearch("kc", "player", roster)), [], "and a team code typed as a name finds nobody");
  assert.deepEqual(names(Roster.rosterSearch("", "player", roster, { team: "KC", keep: r => r[0] !== "3" })).includes("Patrick Mahomes"), false, "hidden players stay hidden");
  assert.equal(Roster.rosterSearch("", "player", roster, { pos: "WR" }).length, Roster.POS_CAP, "a position league-wide stops at the cap");
  assert.equal(Roster.rosterSearch("jo", "player", roster).length, Roster.LIST_CAP, "a name alone stops at eight");
  assert.deepEqual(Roster.rosterSearch("kc", "team", roster, { team: "DEN", pos: "QB" }).map(r => r[0]), ["KC"], "a defense search ignores the filters and matches the code");
  assert.deepEqual(Roster.rosterTeams(roster), ["DEN", "KC", "NYJ", "PIT"]);
});

test("leagueLine: the Sleeper league's settings in one line", () => {
  assert.equal(Roster.leagueLine({ season: "2026", teams: 10, keeper: true, sf: true, scoring: "PPR" }), "2026 · 10-Team Keeper SF PPR");
  assert.equal(Roster.leagueLine({ season: "2026", teams: 12, dynasty: true, scoring: "Half PPR" }), "2026 · 12-Team Dynasty Half PPR");
  assert.equal(Roster.leagueLine(null, "2026"), "2026", "no league yet: the season alone");
  assert.equal(Roster.leagueLine(null, ""), "");
  assert.equal(Roster.scoringName(1), "PPR"); assert.equal(Roster.scoringName(0.5), "Half PPR"); assert.equal(Roster.scoringName(0), "Standard"); assert.equal(Roster.scoringName(undefined), "");
});
