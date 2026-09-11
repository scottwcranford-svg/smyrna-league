// Kickoff locks and week math: when a bet locks, and who is on bye.
import test from "node:test";
import assert from "node:assert/strict";
import * as Clock from "../clock.js";
import { KICKOFF, config } from "./fixtures.mjs";

test("locks are five minutes before the week's first game", () => {
  assert.equal(Clock.lockTime(0, config), Date.parse(KICKOFF) - 300e3);
  assert.equal(Clock.lockTime(1, config), Date.parse(KICKOFF) - 300e3);
  assert.equal(Clock.lockTime(2, config), Date.parse("2026-09-18T00:15:00Z") - 300e3);
  assert.equal(Clock.lockTime(12, config), Date.parse("2026-11-26T01:00:00Z") - 300e3, "Thanksgiving week opens Wednesday");
  assert.equal(Clock.lockTime(18, config), Date.parse("2027-01-10T18:00:00Z") - 300e3, "week 18 opens Sunday");
});

test("a game bet locks five minutes before that game, not the week", () => {
  const b = { week: 1, status: "open", game: { date: "2026-09-13T17:00:00Z" } };
  assert.equal(Clock.betLock(b, config), Date.parse("2026-09-13T17:00:00Z") - 300e3);
});

test("isLocked only applies to open/active bets and respects time", () => {
  const past = { week: 1, status: "active", game: { date: "2020-01-01T00:00:00Z" } };
  const settled = { week: 1, status: "settled", game: { date: "2020-01-01T00:00:00Z" } };
  assert.equal(Clock.isLocked(past, config), true);
  assert.equal(Clock.isLocked(settled, config), false);
});

test("bye weeks: teams without a game that week can't be picked", () => {
  const games = { games: [
    { id: "a", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" },
    { id: "b", week: 5, away: "DET", home: "GB", date: "2026-10-11T17:00:00Z" },
    { id: "c", week: 6, away: "KC", home: "NE", date: "2026-10-18T17:00:00Z" } ] };
  const w5 = Clock.teamsPlaying(5, games);
  assert.deepEqual(Object.keys(w5).sort(), ["DET", "GB", "NE", "SEA"]);
  assert.equal(Clock.onBye("KC", w5), true, "KC sits out week 5");
  assert.equal(Clock.onBye("NE", w5), false);
  assert.equal(Clock.onBye("KC", Clock.teamsPlaying(0, games)), false, "season-long bets filter nobody");
  assert.equal(Clock.onBye("KC", Clock.teamsPlaying(17, games)), false, "a week with no schedule filters nobody");
  assert.equal(Clock.onBye("KC", Clock.teamsPlaying(5, null)), false, "no schedule loaded yet");
});

test("kickoff order: chronological, undated last, stable on a tie", () => {
  const g = (id, date, away, home) => ({ id, date, away, home });
  const slate = [
    g("mon", "2026-09-14T00:15:00Z", "DEN", "KC"),
    g("late", "2026-09-13T20:25:00Z", "GB", "MIN"),
    g("early", "2026-09-13T17:00:00Z", "CHI", "CAR"),
    g("tbd", "", "NYJ", "TEN"),
    g("early2", "2026-09-13T17:00:00Z", "ATL", "PIT"),
  ];
  assert.deepEqual([...slate].sort(Clock.byKickoff).map(x => x.id),
    ["early2", "early", "late", "mon", "tbd"], "same kickoff breaks on the matchup, ATL before CHI");
  // sorting twice must not shuffle it again
  assert.deepEqual([...slate].sort(Clock.byKickoff).sort(Clock.byKickoff).map(x => x.id),
    ["early2", "early", "late", "mon", "tbd"]);
});

test("a game reads as kicking off soon only inside the hour before it starts", () => {
  const now = Date.parse("2026-09-13T17:00:00Z");
  const at = (mins, extra) => ({ id: "g", date: new Date(now + mins * 60e3).toISOString(), ...extra });
  assert.equal(Clock.kicksSoon(at(30), now), true, "half an hour out");
  assert.equal(Clock.kicksSoon(at(59), now), true);
  assert.equal(Clock.kicksSoon(at(61), now), false, "more than an hour is just scheduled");
  assert.equal(Clock.kicksSoon(at(-1), now), false, "already started is not 'soon'");
  assert.equal(Clock.kicksSoon(at(30, { status: "live" }), now), false, "a live game is never soon");
  assert.equal(Clock.kicksSoon(at(30, { status: "final" }), now), false);
  assert.equal(Clock.kicksSoon(at(30, { awayScore: 7, homeScore: 3 }), now), false, "nor one with a score on it");
  assert.equal(Clock.kicksSoon({ id: "x", date: "" }, now), false, "no date, no judgement");
  assert.equal(Clock.kicksSoon(null, now), false);
});
