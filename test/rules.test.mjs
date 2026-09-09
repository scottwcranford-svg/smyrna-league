// Pure-logic tests against rules.js: lock times, countdowns, auto terms/names, stat
// sums, ledger math, who is covering, schedule parsing.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../rules.js";

const KICKOFF = "2026-09-10T00:20:00Z";   // Wed Sep 9 2026, 8:20 PM ET
const config = { leagueName: "T", season: "2026", stake: 25, kickoff: KICKOFF,
  weekStarts: { "1": KICKOFF, "2": "2026-09-18T00:15:00Z", "12": "2026-11-26T01:00:00Z", "18": "2027-01-10T18:00:00Z" },
  members: [{ id: "m0", name: "gmelan1", color: "#000" }, { id: "m1", name: "JPorch", color: "#000" }, { id: "m2", name: "RTownsend", color: "#000" }] };

test("locks are one hour before the week's first game", () => {
  assert.equal(R.lockTime(0, config), Date.parse(KICKOFF) - 3600e3);
  assert.equal(R.lockTime(1, config), Date.parse(KICKOFF) - 3600e3);
  assert.equal(R.lockTime(2, config), Date.parse("2026-09-18T00:15:00Z") - 3600e3);
  assert.equal(R.lockTime(12, config), Date.parse("2026-11-26T01:00:00Z") - 3600e3, "Thanksgiving week opens Wednesday");
  assert.equal(R.lockTime(18, config), Date.parse("2027-01-10T18:00:00Z") - 3600e3, "week 18 opens Sunday");
});

test("a game bet locks an hour before that game, not the week", () => {
  const b = { week: 1, status: "open", game: { date: "2026-09-13T17:00:00Z" } };
  assert.equal(R.betLock(b, config), Date.parse("2026-09-13T17:00:00Z") - 3600e3);
});

test("isLocked only applies to open/active bets and respects time", () => {
  const past = { week: 1, status: "active", game: { date: "2020-01-01T00:00:00Z" } };
  const settled = { week: 1, status: "settled", game: { date: "2020-01-01T00:00:00Z" } };
  assert.equal(R.isLocked(past, config), true);
  assert.equal(R.isLocked(settled, config), false);
});

test("countdown formats days, hours, minutes", () => {
  const now = Date.now();
  assert.match(R.countdown(now + 2 * 86400e3 + 3 * 3600e3), /^2d 3h$/);
  assert.match(R.countdown(now + 3 * 3600e3 + 12 * 60e3), /^3h 1[12]m$/);
  assert.match(R.countdown(now + 90e3), /^1m$/);
  assert.equal(R.countdown(now - 1), "under a minute");
});

test("autoTerms writes the sentence from stat, period and picks", () => {
  const t = R.autoTerms("player", [{ stat: "rec_yd", metric: "Receiving yards" }], 0, [
    { picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }, { id: "2", name: "Justin Jefferson", pos: "WR", team: "MIN" }] },
    { picks: [{ id: "3", name: "Drake London", pos: "WR", team: "ATL" }, { id: "4", name: "Amon-Ra St. Brown", pos: "WR", team: "DET" }] },
  ], config.members);
  assert.equal(t, "Most receiving yards on the season — Chase + Jefferson vs London + St. Brown.");
  const lower = R.autoTerms("team", [{ stat: "pts_allow", metric: "Points allowed", lower: true }], 3, [
    { picks: [{ id: "HOU", name: "Houston Texans", pos: "DEF", team: "HOU" }] }, { memberId: "m0", picks: [] }], config.members);
  assert.equal(lower, "Fewest points allowed in Week 3 — Texans vs gmelan1.");
  const solo = R.autoTerms("player", [{ stat: "rec_yd", metric: "Receiving yards" }], 0, [
    { memberId: "m0", picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }], config.members);
  assert.equal(solo, "Most receiving yards on the season — Chase vs the field.", "a one-sided proposal waits for joiners");
});

test("autoName: matchup for two sides, stat + period for pots", () => {
  assert.equal(R.autoName([{ metric: "Receiving yards" }], 0, [
    { picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }, { picks: [{ id: "2", name: "Drake London", pos: "WR", team: "ATL" }] }]),
    "Chase vs London");
  assert.equal(R.autoName([{ metric: "PPR points" }], 0, [{ picks: [{ id: "1", name: "A B", pos: "WR", team: "X" }] }, { picks: [{ id: "2", name: "C D", pos: "WR", team: "Y" }] }, { picks: [{ id: "3", name: "E F", pos: "WR", team: "Z" }] }]),
    "PPR points · Season pot");
  assert.equal(R.autoName([{ metric: "Sacks" }], 4, [{ picks: [{ id: "HOU", name: "Houston Texans", pos: "DEF", team: "HOU" }] }, { picks: [] }]), "Sacks · Week 4");
});

test("valueFor sums composites and combined keys", () => {
  assert.equal(R.valueFor("HOU", "takeaways", { HOU: { int: 19, fum_rec: 8 } }), 27);
  assert.equal(R.valueFor("a+b", "rec_yd", { a: { rec_yd: 100 }, b: { rec_yd: 50.5 } }), 150.5);
  assert.equal(R.valueFor("zz", "pts_ppr", {}), 0);
});

test("ledger: winner collects the stake from each loser, unpaid debts net pairwise", () => {
  const L = R.computeLedger(config, [
    { id: "b1", status: "settled", amount: 25, winner: "m0", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }], paid: ["m2"] },
    { id: "b2", status: "active", amount: 10, entries: [{ memberId: "m1", pick: "x" }, { memberId: "m2", pick: "y" }] },
  ]);
  assert.equal(L.pnl.m0.net, 50); assert.equal(L.pnl.m1.net, -25); assert.equal(L.pnl.m2.net, -25);
  assert.equal(L.pnl.m0.w, 1); assert.equal(L.pnl.m1.l, 1);
  // values come from a separate VM realm, so compare by JSON rather than prototype identity
  assert.equal(JSON.stringify(L.debts.map(d => [d.from, d.to, d.amount])), JSON.stringify([["m1", "m0", 25]]), "m2 already paid");
  assert.equal(L.risk.m1, 10); assert.equal(L.risk.m2, 10);
});

test("coverSide: winner, total, and pushes", () => {
  const ml = { market: "ml", game: { away: "NE", home: "SEA" } };
  assert.equal(R.coverSide(ml, { awayScore: 17, homeScore: 24 }), "home");
  assert.equal(R.coverSide(ml, { awayScore: 20, homeScore: 20 }), "push");
  assert.equal(R.coverSide(ml, {}), null, "no score yet");
  const tot = { market: "total", line: 45.5, game: { away: "NE", home: "SEA" } };
  assert.equal(R.coverSide(tot, { awayScore: 20, homeScore: 27 }), "over");
  assert.equal(R.coverSide(tot, { awayScore: 20, homeScore: 21 }), "under");
});

test("schedule CSV → first kickoff per week, Eastern → UTC across the clock change", () => {
  const csv = ["game_id,season,game_type,week,gameday,weekday,gametime,away_team,home_team",
    "a,2026,REG,1,2026-09-09,Wednesday,20:20,NE,SEA", "b,2026,REG,1,2026-09-13,Sunday,13:00,CHI,CAR",
    "c,2026,REG,12,2026-11-25,Wednesday,20:00,GB,LA", "d,2026,REG,18,2027-01-10,Sunday,13:00,SF,ARI",
    "e,2025,REG,1,2025-09-04,Thursday,20:20,DAL,PHI", "f,2026,POST,19,2027-01-16,Saturday,16:30,X,Y"].join("\n");
  const ws = R.weekStartsFromCsv(csv, "2026");
  assert.equal(ws["1"], "2026-09-10T00:20:00Z");
  assert.equal(ws["12"], "2026-11-26T01:00:00Z", "EST after the November change");
  assert.equal(ws["18"], "2027-01-10T18:00:00Z");
  assert.equal(ws["19"], undefined, "postseason ignored");
  assert.equal(new Date(R.etToUtc("2026-07-04", "12:00")).toISOString(), "2026-07-04T16:00:00.000Z", "EDT is UTC-4");
});

test("small helpers", () => {
  assert.equal(R.shortName(["1", "Amon-Ra St. Brown", "WR", "DET"]), "St. Brown");
  assert.equal(R.shortName(["HOU", "Houston Texans", "DEF", "HOU"]), "Texans");
  assert.equal(R.money(1234.5), "$1,234.50"); assert.equal(R.money(25), "$25");
  assert.equal(R.signed(-25), "−$25"); assert.equal(R.signed(50), "+$50");
  assert.equal(R.initials("Smyrna League"), "SM");
  assert.equal(R.slugName("Amon-Ra St. Brown"), "amonrastbrown");
  assert.equal(R.defaultPw({ name: "JPorch" }), "JPorch123!");
});
