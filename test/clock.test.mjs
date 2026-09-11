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
