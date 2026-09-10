// Pure-logic tests against rules.js: lock times, countdowns, auto terms/names, stat
// sums, ledger math, who is covering, schedule parsing.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../rules.js";

const KICKOFF = "2026-09-10T00:20:00Z";   // Wed Sep 9 2026, 8:20 PM ET
const config = { leagueName: "T", season: "2026", stake: 25, kickoff: KICKOFF,
  weekStarts: { "1": KICKOFF, "2": "2026-09-18T00:15:00Z", "12": "2026-11-26T01:00:00Z", "18": "2027-01-10T18:00:00Z" },
  members: [{ id: "m0", name: "gmelan1", color: "#000" }, { id: "m1", name: "JPorch", color: "#000" }, { id: "m2", name: "RTownsend", color: "#000" }] };

test("locks are five minutes before the week's first game", () => {
  assert.equal(R.lockTime(0, config), Date.parse(KICKOFF) - 300e3);
  assert.equal(R.lockTime(1, config), Date.parse(KICKOFF) - 300e3);
  assert.equal(R.lockTime(2, config), Date.parse("2026-09-18T00:15:00Z") - 300e3);
  assert.equal(R.lockTime(12, config), Date.parse("2026-11-26T01:00:00Z") - 300e3, "Thanksgiving week opens Wednesday");
  assert.equal(R.lockTime(18, config), Date.parse("2027-01-10T18:00:00Z") - 300e3, "week 18 opens Sunday");
});

test("a game bet locks five minutes before that game, not the week", () => {
  const b = { week: 1, status: "open", game: { date: "2026-09-13T17:00:00Z" } };
  assert.equal(R.betLock(b, config), Date.parse("2026-09-13T17:00:00Z") - 300e3);
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
  assert.equal(R.valueFor("a", "rush_rec_yd", { a: { rush_yd: 84, rec_yd: 31.5 } }), 115.5, "rushing + receiving yards");
  assert.equal(R.STATS.player.some((s) => s[0] === "rush_rec_yd"), true, "offered in the catalog");
});

test("ledger: winner collects the stake from each loser, unpaid debts net pairwise", () => {
  const L = R.computeLedger(config, [
    { id: "b1", status: "settled", amount: 25, winner: "m0", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }], paid: ["m2"] },
    { id: "b2", status: "active", amount: 10, entries: [{ memberId: "m1", pick: "x" }, { memberId: "m2", pick: "y" }] },
    { id: "b3", status: "open", amount: 15, entries: [{ memberId: "m0", pick: "x" }, { memberId: null }] },
    { id: "b4", status: "void", amount: 40, autoVoid: true, entries: [{ memberId: "m0", pick: "x" }, { memberId: null }] },
    { id: "b5", status: "void", amount: 70, cancelled: true, entries: [{ memberId: "m2", pick: "x" }, { memberId: null }] },
  ]);
  assert.equal(L.pnl.m0.net, 50); assert.equal(L.pnl.m1.net, -25); assert.equal(L.pnl.m2.net, -25);
  assert.equal(L.pnl.m0.w, 1); assert.equal(L.pnl.m1.l, 1);
  // values come from a separate VM realm, so compare by JSON rather than prototype identity
  assert.equal(JSON.stringify(L.debts.map(d => [d.from, d.to, d.amount])), JSON.stringify([["m1", "m0", 25]]), "m2 already paid");
  assert.equal(L.risk.m1, 10); assert.equal(L.risk.m2, 10);
  assert.equal(L.risk.m0, 0, "an open bet isn't in play yet"); assert.equal(L.offered.m0, 15); assert.equal(L.offered.m1, 0);
  assert.equal(L.cancelled.m0, 40, "no takers by lock counts"); assert.equal(L.cancelled.m2, 0, "pulled by hand doesn't"); assert.equal(L.cancelled.m1, 0);
  assert.equal(L.pnl.m0.net, 50, "a cancelled bet moves no money");
  // net by kind: b1 is a season bet (no week); add a settled weekly one
  const L2 = R.computeLedger(config, [
    { id: "b1", status: "settled", amount: 25, winner: "m0", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }], paid: ["m2"] },
    { id: "w1", status: "settled", week: 3, amount: 10, winner: "m1", entries: [{ memberId: "m0" }, { memberId: "m1" }], paid: [] },
  ]);
  assert.deepEqual([L2.pnl.m0.season, L2.pnl.m0.weekly, L2.pnl.m0.net], [50, -10, 40]);
  assert.deepEqual([L2.pnl.m1.season, L2.pnl.m1.weekly, L2.pnl.m1.net], [-25, 10, -15]);
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

test("canJoin: stat bets are open to joiners unless closed or player-vs-field; game bets never", () => {
  const p = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), name: "P" + i, pos: "WR", team: "X" }));
  assert.equal(R.canJoin({ status: "active", entries: [{ memberId: "a", picks: p(2) }, { memberId: "b", picks: p(2) }] }), true, "no flag at all (older bets)");
  assert.equal(R.canJoin({ status: "open", joinable: true, entries: [{ memberId: "a", picks: p(1) }] }), true, "one-sided proposal");
  assert.equal(R.canJoin({ status: "active", joinable: false, entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(1) }] }), false, "proposer closed it");
  assert.equal(R.canJoin({ status: "active", entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(4) }] }), false, "player vs the field");
  assert.equal(R.canJoin({ status: "active", game: { id: "g" }, entries: [{ memberId: "a", side: "NE" }, { memberId: "b", side: "SEA" }] }), false, "game bets are two sides");
  assert.equal(R.canJoin({ status: "settled", entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(1) }] }), false, "done is done");
});

test("autoResult: a game bet settles from the final score, or pushes", () => {
  const games = { games: [{ id: "g1", week: 1, away: "NE", home: "SEA", date: "2026-09-10T00:20:00Z", status: "final", awayScore: 17, homeScore: 24 }] };
  const ml = { status: "active", week: 1, game: { id: "g1", week: 1, away: "NE", home: "SEA", date: "2026-09-10T00:20:00Z" }, market: "ml",
    entries: [{ memberId: "m0", side: "NE" }, { memberId: "m1", side: "SEA" }] };
  assert.equal(R.autoResult(ml, games).winner, "m1");
  assert.match(R.autoResult(ml, games).note, /Final · NE 17, SEA 24/);
  const tot = { ...ml, market: "total", line: 41, entries: [{ memberId: "m0", side: "over" }, { memberId: "m1", side: "under" }] };
  assert.equal(R.autoResult(tot, games).winner, "push", "41 total on the 41 line");
  assert.equal(R.autoResult({ ...tot, line: 40.5 }, games).winner, "m0", "over");
  const live = { games: [{ ...games.games[0], status: "live" }] };
  assert.equal(R.autoResult(ml, live), null, "not while it's on");
  assert.equal(R.autoResult({ ...ml, status: "open" }, games), null, "an unfilled bet never settles");
});

test("autoResult: a stat bet settles when the period is final and the stats are fresher than the last game", () => {
  const kick = "2026-09-14T00:20:00Z", lastEnd = Date.parse(kick) + R.SETTLE_LAG;
  const games = { games: [{ id: "a", week: 1, date: "2026-09-13T17:00:00Z", status: "final" }, { id: "b", week: 1, date: kick, status: "final" }] };
  const bet = (rows, tracks, updatedAt) => ({ status: "active", week: 1, entries: [{ memberId: "m0" }, { memberId: "m1" }],
    stats: { scope: "player", stat: tracks[0].stat, tracks, rows, updatedAt, through: "Through week 1" } });
  const rows = [{ key: "1", entry: 0, values: { rec_yd: 120 } }, { key: "2", entry: 1, values: { rec_yd: 80 } }];
  const fresh = new Date(lastEnd + 60e3).toISOString(), stale = new Date(lastEnd - 60e3).toISOString(), after = lastEnd + 120e3;
  assert.equal(R.autoResult(bet(rows, [{ stat: "rec_yd" }], fresh), games, after).winner, "m0");
  assert.equal(R.autoResult(bet(rows, [{ stat: "rec_yd" }], stale), games, after), null, "stats predate the end of the last game");
  assert.equal(R.autoResult(bet(rows, [{ stat: "rec_yd" }], fresh), { games: [games.games[0], { ...games.games[1], status: "live" }] }, after), null, "a game still on");
  const allowed = [{ key: "HOU", entry: 0, values: { pts_allow: 24 } }, { key: "DAL", entry: 1, values: { pts_allow: 17 } }];
  assert.equal(R.autoResult(bet(allowed, [{ stat: "pts_allow", lower: true }], fresh), games, after).winner, "m1", "lower is better");
  const tie = [{ key: "1", entry: 0, values: { rec_yd: 100 } }, { key: "2", entry: 1, values: { rec_yd: 100 } }];
  assert.equal(R.autoResult(bet(tie, [{ stat: "rec_yd" }], fresh), games, after).winner, "push");
  const multi = [{ key: "1", entry: 0, values: { rec_yd: 120, rec: 5, rec_td: 1 } }, { key: "2", entry: 1, values: { rec_yd: 80, rec: 9, rec_td: 2 } }];
  assert.equal(R.autoResult(bet(multi, [{ stat: "rec_yd" }, { stat: "rec" }, { stat: "rec_td" }], fresh), games, after).winner, "m1", "most stats led");
  // a season bet waits for the last week
  const season = { ...bet(rows, [{ stat: "rec_yd" }], fresh), week: 0 };
  assert.equal(R.autoResult(season, games, after), null, "week 17 hasn't been played");
  const wk17 = { games: [{ id: "z", week: 17, date: "2027-01-04T01:20:00Z", status: "final" }] };
  const seasonFresh = { ...season, stats: { ...season.stats, updatedAt: "2027-01-05T00:00:00Z" } };
  assert.equal(R.autoResult(seasonFresh, wk17, Date.parse("2027-01-05T01:00:00Z")).winner, "m0");
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

test("bye weeks: teams without a game that week can't be picked", () => {
  const games = { games: [
    { id: "a", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" },
    { id: "b", week: 5, away: "DET", home: "GB", date: "2026-10-11T17:00:00Z" },
    { id: "c", week: 6, away: "KC", home: "NE", date: "2026-10-18T17:00:00Z" } ] };
  const w5 = R.teamsPlaying(5, games);
  assert.deepEqual(Object.keys(w5).sort(), ["DET", "GB", "NE", "SEA"]);
  assert.equal(R.onBye("KC", w5), true, "KC sits out week 5");
  assert.equal(R.onBye("NE", w5), false);
  assert.equal(R.onBye("KC", R.teamsPlaying(0, games)), false, "season-long bets filter nobody");
  assert.equal(R.onBye("KC", R.teamsPlaying(17, games)), false, "a week with no schedule filters nobody");
  assert.equal(R.onBye("KC", R.teamsPlaying(5, null)), false, "no schedule loaded yet");
});

test("weekly high / low: top score takes the stake from the bottom, ties share, tallied all season", () => {
  const rows = [{ id: "a", name: "A", pts: 148.4 }, { id: "b", name: "B", pts: 120 }, { id: "c", name: "C", pts: 92.1 }];
  assert.deepEqual(R.highLow(rows), { high: [{ id: "a", name: "A", pts: 148.4 }], low: [{ id: "c", name: "C", pts: 92.1 }] });
  const tied = R.highLow(rows.concat([{ id: "d", name: "D", pts: 148.4 }]));
  assert.deepEqual(tied.high.map((r) => r.id), ["a", "d"], "a tie at the top is kept together");
  assert.equal(R.highLow([{ id: "a", pts: 100 }, { id: "b", pts: 100 }]), null, "all tied: nothing moves");
  assert.equal(R.highLow([{ id: "a", pts: 0 }, { id: "b", pts: null }]), null, "one real score isn't a week");
  const hl = { weeks: { "1": R.highLow(rows), "2": tied, "3": { high: [{ id: "c", pts: 1 }], low: [{ id: "zz", name: "gone", pts: 0 }] } } };
  const T = R.hlTally(hl, [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], 5);
  assert.deepEqual(T.weeks, [1, 2, 3]);
  assert.deepEqual(T.byId.a, { net: 7.5, highs: 2, lows: 0 }, "5 for week 1, half of 5 for the shared week 2");
  assert.deepEqual(T.byId.c, { net: -5, highs: 1, lows: 2 }, "bottom in weeks 1 and 2, top in week 3");
  assert.deepEqual(T.byId.d, { net: 2.5, highs: 1, lows: 0 });
  assert.equal(R.hlStake({ hlStake: 10 }), 10); assert.equal(R.hlStake({}), 5);
  assert.deepEqual(R.finalWeeks({ games: [{ week: 1, status: "final" }, { week: 1, status: "final" }, { week: 2, status: "final" }, { week: 2, status: "live" }, { week: 3, status: "pre" }] }), [1], "only weeks with every game final");
});

test("balances: bets plus hi / low, minus payments; the transfers that clear everyone", () => {
  const cfg = { members: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }] };
  const bets = [
    { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
    { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a" }, { memberId: "c" }], paid: [] },
    { id: "w2", status: "settled", week: 3, amount: 10, winner: "d", entries: [{ memberId: "b" }, { memberId: "d" }], paid: ["b"] },   // b already paid d, the old way
  ];
  const hl = { weeks: { "1": { high: [{ id: "d", pts: 140 }], low: [{ id: "a", pts: 90 }] } } };
  const B = R.balances(cfg, bets, hl, null, 5);
  assert.deepEqual([B.byId.a.bets, B.byId.a.hl, B.byId.a.net], [15, -5, 10]);
  assert.deepEqual([B.byId.b.bets, B.byId.b.paidOut, B.byId.b.net], [-35, 10, -25], "the legacy paid flag counts as a payment");
  assert.deepEqual([B.byId.d.bets, B.byId.d.hl, B.byId.d.paidIn, B.byId.d.net], [10, 5, 10, 5]);
  assert.equal(B.byId.c.net, 10);
  assert.equal(Math.round(Object.values(B.byId).reduce((s, x) => s + x.net, 0) * 100) / 100, 0, "balances always net to zero");
  assert.deepEqual(B.transfers, [{ from: "b", to: "a", amount: 10 }, { from: "b", to: "c", amount: 10 }, { from: "b", to: "d", amount: 5 }], "biggest debtor pays down the creditors, biggest first");
  // a recorded payment moves two balances and shrinks the list
  const B2 = R.balances(cfg, bets, hl, [{ id: "p1", from: "b", to: "a", amount: 10, at: "2027-01-05T00:00:00Z" }], 5);
  assert.equal(B2.byId.b.net, -15); assert.equal(B2.byId.a.net, 0);
  assert.deepEqual(B2.transfers.map((t) => [t.from, t.to, t.amount]), [["b", "c", 10], ["b", "d", 5]]);
  const B3 = R.balances(cfg, bets, hl, [{ id: "p1", from: "b", to: "a", amount: 10, voided: true }], 5);
  assert.equal(B3.byId.b.net, -25, "a voided payment doesn't count");
  assert.equal(B3.payments.length, 2, "but it's still in the log, with the legacy one");
});

test("drillRows: what's behind a season-table cell, newest first", () => {
  const members = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }];
  const bets = [
    { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", name: "Wire to Wire", entries: [{ memberId: "a" }, { memberId: "b" }], settledAt: "2026-12-01T00:00:00Z" },
    { id: "w2", status: "settled", week: 2, amount: 10, winner: "c", name: "Week 2 thing", entries: [{ memberId: "a" }, { memberId: "c" }], settledAt: "2026-09-15T00:00:00Z" },
    { id: "w3", status: "settled", week: 3, amount: 10, winner: "push", name: "Pushed", entries: [{ memberId: "a" }, { memberId: "b" }], settledAt: "2026-09-22T00:00:00Z" },
    { id: "open", status: "active", week: 4, amount: 10, entries: [{ memberId: "a" }, { memberId: "b" }] },
    { id: "notme", status: "settled", week: 1, amount: 10, winner: "b", entries: [{ memberId: "b" }, { memberId: "c" }] },
  ];
  const hl = { weeks: { "1": { high: [{ id: "a", name: "Alice", pts: 140 }], low: [{ id: "c", name: "Cara", pts: 90 }] }, "2": { high: [{ id: "b", pts: 150 }], low: [{ id: "a", pts: 80 }, { id: "c", pts: 80 }] } } };
  const weekly = R.drillRows("a", "weekly", bets, hl, 5, members);
  assert.deepEqual(weekly.map((r) => [r.id, r.amount, r.note]), [["w3", 0, "push"], ["w2", -10, "lost to Cara"]], "weekly: newest first, pushes shown at 0, open and others' bets left out");
  assert.deepEqual(R.drillRows("a", "season", bets, hl, 5, members).map((r) => [r.id, r.amount, r.note]), [["s1", 25, "beat Bob"]]);
  const hlRows = R.drillRows("a", "hl", bets, hl, 5, members);
  assert.deepEqual(hlRows.map((r) => [r.week, r.amount, r.label, r.note]), [[2, -2.5, "Low score · 80", "under Bob"], [1, 5, "High score · 140", "over Cara"]], "a shared low splits the stake");
  const total = R.drillRows("a", "total", bets, hl, 5, members);
  assert.equal(total.length, 5); assert.equal(Math.round(total.reduce((s, r) => s + r.amount, 0) * 100) / 100, 17.5, "the total row adds everything up");
});

test("projections: trimmed to the roster and the tracked stats, read with valueFor", () => {
  const raw = {
    "2": { rec_yd: 82.46, rec: 5.2, pts_ppr: 17.1, adp_dd_ppr: 12, pass_yd: 0 },
    "3": { pass_yd: 241.3, pass_td: 1.6, rush_td: 0.2, rec_td: 0.05 },
    "9": { rec_yd: 40 },            // not on the roster
    SEA: { sack: 2.4, int: 0.8, fum_rec: 0.5, pts_allow: 20.3 },
  };
  const trimmed = R.trimProjections(raw, ["2", "3", "SEA", "missing"]);
  assert.deepEqual(Object.keys(trimmed).sort(), ["2", "3", "SEA"]);
  assert.equal(trimmed["2"].rec_yd, 82.5, "one decimal"); assert.equal("adp_dd_ppr" in trimmed["2"], false, "untracked keys dropped");
  assert.equal("pass_yd" in trimmed["2"], false, "zeros dropped");
  const proj = { weeks: { "5": JSON.stringify(trimmed) } };
  const P = R.projFor(5, proj);
  assert.equal(R.valueFor("2", "rec_yd", P), 82.5, "the bet's own stat");
  assert.equal(R.valueFor("3", "td_scored", P), 0.3, "composites work on projections too");
  assert.equal(R.valueFor("SEA", "takeaways", P), 1.3);
  assert.equal(R.valueFor("2+3", "rec_yd", P), 82.5, "combined picks add up");
  assert.equal(R.projFor(6, proj), null, "no projections for that week");
  assert.equal(R.projFor(5, null), null);
  assert.equal(R.projFor(5, proj), P, "parsed once, then cached");
  assert.deepEqual(R.trimProjections([1, 2], ["2"]), {}, "a bad payload is an empty set");
});

test("leagueLine: the Sleeper league's settings in one line", () => {
  assert.equal(R.leagueLine({ season: "2026", teams: 10, keeper: true, sf: true, scoring: "PPR" }), "2026 · 10-Team Keeper SF PPR");
  assert.equal(R.leagueLine({ season: "2026", teams: 12, dynasty: true, scoring: "Half PPR" }), "2026 · 12-Team Dynasty Half PPR");
  assert.equal(R.leagueLine(null, "2026"), "2026", "no league yet: the season alone");
  assert.equal(R.leagueLine(null, ""), "");
  assert.equal(R.scoringName(1), "PPR"); assert.equal(R.scoringName(0.5), "Half PPR"); assert.equal(R.scoringName(0), "Standard"); assert.equal(R.scoringName(undefined), "");
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

test("rivals: every settled bet is a set of pairs; a pot is one win per loser", () => {
  const members = [{ id: "m0", name: "gmelan1" }, { id: "m1", name: "JPorch" }, { id: "m2", name: "RTownsend" }, { id: "m3", name: "mscag" }];
  const bets = [
    { id: "b1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "m1", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "m0" }, { memberId: "m1" }] },
    { id: "b2", status: "settled", week: 0, name: "Pot", amount: 10, winner: "m0", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }, { memberId: "m3" }] },
    { id: "b3", status: "settled", week: 2, name: "Push", amount: 10, winner: "push", entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b4", status: "void", week: 2, name: "Void", amount: 10, entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b5", status: "active", week: 3, name: "Live", amount: 10, entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b6", status: "settled", week: 3, name: "Solo", amount: 10, winner: "m0", entries: [{ memberId: "m0" }] },
  ];
  const V = R.rivals(members, bets);
  assert.deepEqual({ net: V.byId.m0.m1.net, w: V.byId.m0.m1.w, l: V.byId.m0.m1.l }, { net: -15, w: 1, l: 1 }, "lost 25, won 10 back off the pot");
  assert.deepEqual({ net: V.byId.m1.m0.net, w: V.byId.m1.m0.w, l: V.byId.m1.m0.l }, { net: 15, w: 1, l: 1 }, "the mirror");
  assert.deepEqual({ net: V.byId.m0.m2.net, w: V.byId.m0.m2.w }, { net: 10, w: 1 }, "a push, a void and a live bet count for nobody");
  assert.deepEqual(V.totals.m0, { net: 5, w: 3, l: 1, beat: 3, beatenBy: 1 }, "the pot beat three people");
  assert.deepEqual(V.byId.m0.m1.bets.map(x => [x.name, x.won]), [["Pot", true], ["Opener", false]], "newest first, from m0's side");

  const P2 = R.rivalPairs(V);
  assert.deepEqual(P2[0], { a: "m1", b: "m0", net: 15, moved: 35, games: 2, w: 1, l: 1 }, "richest rivalry first, the one who's up named first");
  assert.equal(P2.length, 3, "each pair once, and only pairs that have bet");

  const H = R.rivalHighlights(V, bets, members);
  assert.equal(H.hammer.id, "m0"); assert.equal(H.hammer.v, 3);
  assert.equal(H.nail.id, "m2", "a tie on losses goes to whoever won least");
  assert.deepEqual({ w: H.haul.winner, pot: H.haul.pot, losers: H.haul.losers }, { w: "m0", pot: 30, losers: 3 });

  const F = R.rivalFeed(bets, 5);
  assert.deepEqual(F.map(x => [x.name, x.winner, x.losers.length, x.pot]), [["Pot", "m0", 3, 30], ["Opener", "m1", 1, 25]], "newest first, one line per settled bet");
});

test("rivals: an empty book has every pair at zero and no highlights", () => {
  const members = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const V = R.rivals(members, []);
  assert.deepEqual(V.byId.a.b, { net: 0, w: 0, l: 0, bets: [] });
  assert.deepEqual(V.totals.a, { net: 0, w: 0, l: 0, beat: 0, beatenBy: 0 });
  assert.deepEqual(R.rivalPairs(V), []);
  const H = R.rivalHighlights(V, [], members);
  assert.deepEqual([H.rivalry, H.lopsided, H.hammer, H.nail, H.haul], [null, null, null, null, null]);
});

const bconfig = { leagueName: "T", season: "2026", stake: 25, kickoff: KICKOFF,
  members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }, { id: "d", name: "Dan" }, { id: "t", name: "Testbot", test: true }] };
const bbets = [
  { id: "1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "b", createdBy: "a", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }] },
  { id: "2", status: "settled", week: 2, name: "Two", amount: 10, winner: "b", createdBy: "b", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }] },
  { id: "3", status: "settled", week: 0, name: "Pot", amount: 20, winner: "b", createdBy: "b", settledAt: "2026-09-25T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }, { memberId: "d" }] },
  { id: "4", status: "void", week: 2, autoVoid: true, amount: 10, createdBy: "c", entries: [{ memberId: "c" }] },
  { id: "5", status: "active", week: 3, amount: 15, createdBy: "a", createdAt: "2026-09-24T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "d", takenAt: "2026-09-24T00:00:45Z" }] },
];
const bhl = { weeks: { "1": { high: [{ id: "c", name: "Cara", pts: 150 }], low: [{ id: "a", name: "Alice", pts: 80 }] } } };
const bseen = { a: "2026-09-25T00:00:00Z", b: { at: "2026-09-30T00:00:00Z", n: 12 }, c: "2026-08-01T00:00:00Z" };
const bnow = Date.parse("2026-10-01T00:00:00Z");
const held = (list) => Object.fromEntries(list.filter(x => x.holders.length).map(x => [x.key, [x.holders.join("+"), x.text]]));

test("badges: eighteen live titles, worked out from the book", () => {
  const list = R.badges(bconfig, bbets, bhl, bseen, null, bnow);
  assert.equal(list.length, 18, "every badge comes back, held or not");
  assert.deepEqual(held(list), {
    degenerate: ["a", "$70"], highroller: ["a+b+c+d", "$80"], deadbeat: ["a", "owes $60"], bank: ["b", "owed $95"],
    winner: ["b", "+$95"], hothand: ["b", "3 in a row"], untouchable: ["b", "3–0"], kingmaker: ["b", "$60"],
    weeklyking: ["c", "1 high"], loser: ["a", "−$55"], icecold: ["a", "3 in a row"], basement: ["a", "1 low"],
    coldfeet: ["c", "1 pulled"], active: ["a", "4 bets"], instigator: ["a+b", "2 posted"], ghost: ["c", "61d away"],
    quickdraw: ["d", "45s"], logins: ["b", "12 visits"],
  });
  // the four in the same $20 pot all have the same biggest pot, so they hold High Roller together
  const hr = list.find(x => x.key === "highroller");
  assert.equal(hr.shared, true);
  assert.equal(hr.label, "High Rollers", "and the title reads plural");
  assert.equal(list.find(x => x.key === "winner").label, "Biggest Winner", "one holder keeps the singular");
});

test("badges: nobody qualifies on an empty book, and test accounts never hold one", () => {
  const list = R.badges(bconfig, [], null, null, null, bnow);
  assert.deepEqual(list.filter(x => x.holders.length), [], "every badge is up for grabs");
  assert.equal(list.length, 18);
  const only = R.badges(bconfig, [{ id: "9", status: "settled", week: 1, amount: 10, winner: "t", createdBy: "t", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "t" }, { memberId: "a" }] }], null, null, null, bnow);
  assert.deepEqual(only.find(x => x.key === "winner").holders, [], "a test account is not in the running");
  assert.deepEqual(only.find(x => x.key === "loser").holders, ["a"], "the real manager still gets theirs");
});

test("badges: a tie is shared by everyone level on it, and the title goes plural", () => {
  const cfg = { ...bconfig, members: [{ id: "z", name: "Zoe" }, { id: "a", name: "Alice" }] };
  const tie = [
    { id: "1", status: "settled", week: 1, amount: 10, winner: "z", createdBy: "z", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "z" }, { memberId: "a" }] },
    { id: "2", status: "settled", week: 2, amount: 10, winner: "a", createdBy: "a", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "z" }, { memberId: "a" }] },
  ];
  const list = R.badges(cfg, tie, null, null, null, bnow);
  const d = list.find(x => x.key === "degenerate");
  assert.deepEqual(d.holders, ["a", "z"], "both staked $20, so both hold it, in name order");
  assert.deepEqual(d.holderNames, ["Alice", "Zoe"]);
  assert.equal(d.shared, true);
  assert.equal(d.label, "Biggest Degenerates", "and the title goes plural");
  assert.equal(list.find(x => x.key === "icecold").label, "Ice Cold", "a title with no sensible plural keeps its name");
});

test("badgeChanges: only what moved, and it remembers who it came from", () => {
  const list = R.badges(bconfig, bbets, bhl, bseen, null, bnow);
  const first = R.badgeChanges(list, null, bconfig, null, bnow);
  assert.equal(Object.keys(first).length, 18, "the first run records every held badge");
  assert.equal(first.winner.from, null, "nobody to take it from yet");
  assert.deepEqual(first.winner.holders, ["b"], "holders is always a list");
  const stored = { byKey: first };
  assert.equal(R.badgeChanges(list, stored, bconfig, null, bnow), null, "nothing moved, nothing written");
  // Cara wins one big enough to take Biggest Winner off Bob
  const moved = bbets.concat([{ id: "6", status: "settled", week: 4, amount: 200, winner: "c", createdBy: "c", settledAt: "2026-09-28T00:00:00Z", entries: [{ memberId: "c" }, { memberId: "d" }] }]);
  const chg = R.badgeChanges(R.badges(bconfig, moved, bhl, bseen, null, bnow), stored, bconfig, null, bnow);
  assert.equal(chg.winner.holder, "c");
  assert.deepEqual(chg.winner.from, ["b"], "it says who lost it — a list, since a shared title can lose several at once");
  assert.equal(chg.weeklyking, undefined, "a badge that didn't move isn't rewritten");
});

test("badgeChanges: a draw a second later writes nothing — no value may drift with the clock", () => {
  const list = R.badges(bconfig, bbets, bhl, bseen, null, bnow);
  const stored = { byKey: R.badgeChanges(list, null, bconfig, null, bnow) };
  const later = R.badges(bconfig, bbets, bhl, bseen, null, bnow + 1500);
  assert.equal(R.badgeChanges(later, stored, bconfig, null, bnow + 1500), null,
    "otherwise every render writes to the book, which loops through the snapshot");
  const nextDay = R.badges(bconfig, bbets, bhl, bseen, null, bnow + 86400e3);
  assert.equal(R.badgeChanges(nextDay, stored, bconfig, null, bnow + 86400e3).ghost.text, "62d away", "a day later it does move");
});

test("badgeStory: took it from, or held since", () => {
  const members = bconfig.members;
  assert.equal(R.badgeStory(null, members), "nobody yet");
  assert.equal(R.badgeStory({ holder: "c", holders: ["c"], from: ["b"], week: 4 }, members), "took it from Bob · wk 4");
  assert.match(R.badgeStory({ holder: "b", from: null, week: 2, at: "2026-09-18T00:00:00Z" }, members), /^held since /);
  // with a holder passed in, the record can lag a fresh page: no story beats a wrong one
  assert.equal(R.badgeStory(null, members, ["c"]), "", "a holder on screen with no record yet says nothing");
  assert.equal(R.badgeStory(null, members, []), "nobody yet");
  assert.equal(R.badgeStory({ holder: "b", holders: ["b"], from: ["a"], week: 4 }, members, ["c"]), "", "a stale record for someone else is not shown");
  assert.equal(R.badgeStory({ holder: "c", holders: ["c"], from: ["b"], week: 4 }, members, ["c"]), "took it from Bob · wk 4");
});

test("seenAt and seenCount read both shapes of league/seen", () => {
  const seen = { a: "2026-09-25T00:00:00Z", b: { at: "2026-09-30T00:00:00Z", n: 12 } };
  assert.equal(R.seenAt(seen, "a"), "2026-09-25T00:00:00Z");
  assert.equal(R.seenAt(seen, "b"), "2026-09-30T00:00:00Z");
  assert.equal(R.seenAt(seen, "zz"), "");
  assert.equal(R.seenCount(seen, "a"), 0, "an old string entry has no count yet");
  assert.equal(R.seenCount(seen, "b"), 12);
});

const LINES_CSV = [
  "game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line",
  "2026_01_NE_SEA,2026,REG,1,2026-09-09,20:20,NE,,SEA,,3,44.5",
  "2026_01_SF_LA,2026,REG,1,2026-09-10,20:15,SF,,LA,,3.5,47.5",
  "2026_01_CHI_CAR,2026,REG,1,2026-09-13,13:00,CHI,,CAR,,-3,46.5",
  "2026_02_DAL_PHI,2026,REG,2,2026-09-20,13:00,DAL,,PHI,,0,41",
  "2026_12_KC_DEN,2026,REG,12,2026-11-22,13:00,KC,,DEN,,,",
  "2025_01_NE_SEA,2025,REG,1,2025-09-09,20:20,NE,,SEA,,7,40",
  "2026_99_AFC_NFC,2026,POST,22,2027-02-07,18:30,AFC,,NFC,,2,45",
].join("\n");

test("betting lines: parsed from the schedule file, the Rams renamed, other seasons left out", () => {
  const lines = R.linesFromCsv(LINES_CSV, "2026");
  assert.deepEqual(Object.keys(lines).sort(), ["1|CHI|CAR", "1|NE|SEA", "1|SF|LAR", "2|DAL|PHI"],
    "only 2026 regular-season games with a number, and LA is the app's LAR");
  assert.deepEqual(lines["1|NE|SEA"], { spread: 3, total: 44.5 });
  assert.equal(lines["12|KC|DEN"], undefined, "a game Vegas hasn't posted isn't stored");
  assert.deepEqual(R.linesFromCsv("nothing,useful\n1,2", "2026"), {}, "a file without the columns is ignored, not guessed at");
});

test("lineFor: the spread is read from the home team's side and named for the favourite", () => {
  const lines = R.linesFromCsv(LINES_CSV, "2026");
  const seattle = R.lineFor({ week: 1, away: "NE", home: "SEA" }, lines);
  assert.deepEqual(seattle, { total: 44.5, spread: 3, fav: "SEA", dog: "NE", pick: false }, "positive means the home team gives the points");
  const chicago = R.lineFor({ week: 1, away: "CHI", home: "CAR" }, lines);
  assert.deepEqual({ fav: chicago.fav, dog: chicago.dog, spread: chicago.spread }, { fav: "CHI", dog: "CAR", spread: 3 }, "negative means the away team is favoured");
  const even = R.lineFor({ week: 2, away: "DAL", home: "PHI" }, lines);
  assert.equal(even.pick, true, "a zero spread is a pick'em, not a missing line");
  assert.equal(R.lineFor({ week: 12, away: "KC", home: "DEN" }, lines), null, "no line, nothing to show");
  assert.equal(R.lineFor(null, lines), null);
  assert.equal(R.lineFor({ week: 1, away: "NE", home: "SEA" }, null), null);
  assert.deepEqual(R.lineFor({ week: 1, away: "SF", home: "LAR" }, { byGame: lines }).fav, "LAR", "reads the stored { byGame } shape too");
});

test("lineSummary: what the picker and the ticker print", () => {
  const lines = R.linesFromCsv(LINES_CSV, "2026");
  assert.equal(R.lineSummary(R.lineFor({ week: 1, away: "NE", home: "SEA" }, lines)), "SEA −3 · O/U 44.5");
  assert.equal(R.lineSummary(R.lineFor({ week: 2, away: "DAL", home: "PHI" }, lines)), "pick'em · O/U 41");
  assert.equal(R.lineSummary(null), "");
});

test("a spread bet settles from the final score, the favourite giving the points", () => {
  const bet = { week: 1, status: "active", market: "spread", line: 9.5, fav: "KC",
    game: { id: "g", week: 1, away: "KC", home: "CAR", date: "2026-09-13T17:00:00Z" },
    entries: [{ memberId: "a", side: "KC" }, { memberId: "b", side: "CAR" }] };
  const game = (aw, hm) => ({ id: "g", week: 1, away: "KC", home: "CAR", status: "final", awayScore: aw, homeScore: hm });
  assert.equal(R.coverSide(bet, game(31, 17)), "away", "won by 14, covers 9.5");
  assert.equal(R.coverSide(bet, game(24, 20)), "home", "won by 4, doesn't cover");
  assert.equal(R.coverSide(bet, game(17, 31)), "home", "lost outright");
  assert.equal(R.coverSide({ ...bet, line: 10 }, game(27, 17)), "push", "exactly the number is a push");
  assert.equal(R.lineText(bet), "KC −9.5");
});

test("lineOrigin: a bet says whether its number was Vegas's or the proposer's own", () => {
  const g = { id: "g", week: 1, away: "KC", home: "CAR", date: "2026-09-13T17:00:00Z" };
  assert.equal(R.lineOrigin({ game: g, market: "total", line: 44.5, lineSrc: "vegas" }), "vegas");
  assert.equal(R.lineOrigin({ game: g, market: "spread", line: 3, fav: "KC", lineSrc: "own" }), "own");
  assert.equal(R.lineOrigin({ game: g, market: "total", line: 44.5 }), null, "a bet posted before this shipped doesn't guess");
  assert.equal(R.lineOrigin({ game: g, market: "ml", lineSrc: "vegas" }), null, "a straight-up bet has no number");
  assert.equal(R.lineOrigin(null), null);
});

test("nameList: everyone named, however many hold it", () => {
  assert.equal(R.nameList([]), "");
  assert.equal(R.nameList(["Alice"]), "Alice");
  assert.equal(R.nameList(["Alice", "Bob"]), "Alice and Bob");
  assert.equal(R.nameList(["Alice", "Bob", "Cara"]), "Alice, Bob and Cara");
  assert.equal(R.nameList(["Alice", "Bob", "Cara", "Dan"]), "Alice, Bob, Cara and Dan", "everyone is named, however many share it");
});
