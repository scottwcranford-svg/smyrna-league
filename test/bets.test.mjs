// A bet's life: auto-written names and terms, joinable, covered, settled.
import test from "node:test";
import assert from "node:assert/strict";
import * as Bets from "../bets.js";
import { config } from "./fixtures.mjs";

test("autoTerms writes the sentence from stat, period and picks", () => {
  const t = Bets.autoTerms("player", [{ stat: "rec_yd", metric: "Receiving yards" }], 0, [
    { picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }, { id: "2", name: "Justin Jefferson", pos: "WR", team: "MIN" }] },
    { picks: [{ id: "3", name: "Drake London", pos: "WR", team: "ATL" }, { id: "4", name: "Amon-Ra St. Brown", pos: "WR", team: "DET" }] },
  ], config.members);
  assert.equal(t, "Most receiving yards on the season — Chase + Jefferson vs London + St. Brown.");
  const lower = Bets.autoTerms("team", [{ stat: "pts_allow", metric: "Points allowed", lower: true }], 3, [
    { picks: [{ id: "HOU", name: "Houston Texans", pos: "DEF", team: "HOU" }] }, { memberId: "m0", picks: [] }], config.members);
  assert.equal(lower, "Fewest points allowed in Week 3 — Texans vs gmelan1.");
  const solo = Bets.autoTerms("player", [{ stat: "rec_yd", metric: "Receiving yards" }], 0, [
    { memberId: "m0", picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }], config.members);
  assert.equal(solo, "Most receiving yards on the season — Chase vs the field.", "a one-sided proposal waits for joiners");
});

test("autoName: matchup for two sides, stat + period for pots", () => {
  assert.equal(Bets.autoName([{ metric: "Receiving yards" }], 0, [
    { picks: [{ id: "1", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }, { picks: [{ id: "2", name: "Drake London", pos: "WR", team: "ATL" }] }]),
    "Chase vs London");
  assert.equal(Bets.autoName([{ metric: "PPR points" }], 0, [{ picks: [{ id: "1", name: "A B", pos: "WR", team: "X" }] }, { picks: [{ id: "2", name: "C D", pos: "WR", team: "Y" }] }, { picks: [{ id: "3", name: "E F", pos: "WR", team: "Z" }] }]),
    "PPR points · Season pot");
  assert.equal(Bets.autoName([{ metric: "Sacks" }], 4, [{ picks: [{ id: "HOU", name: "Houston Texans", pos: "DEF", team: "HOU" }] }, { picks: [] }]), "Sacks · Week 4");
});

test("coverSide: winner, total, and pushes", () => {
  const ml = { market: "ml", game: { away: "NE", home: "SEA" } };
  assert.equal(Bets.coverSide(ml, { awayScore: 17, homeScore: 24 }), "home");
  assert.equal(Bets.coverSide(ml, { awayScore: 20, homeScore: 20 }), "push");
  assert.equal(Bets.coverSide(ml, {}), null, "no score yet");
  const tot = { market: "total", line: 45.5, game: { away: "NE", home: "SEA" } };
  assert.equal(Bets.coverSide(tot, { awayScore: 20, homeScore: 27 }), "over");
  assert.equal(Bets.coverSide(tot, { awayScore: 20, homeScore: 21 }), "under");
});

test("canJoin: stat bets are open to joiners unless closed or player-vs-field; game bets never", () => {
  const p = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), name: "P" + i, pos: "WR", team: "X" }));
  assert.equal(Bets.canJoin({ status: "active", entries: [{ memberId: "a", picks: p(2) }, { memberId: "b", picks: p(2) }] }), true, "no flag at all (older bets)");
  assert.equal(Bets.canJoin({ status: "open", joinable: true, entries: [{ memberId: "a", picks: p(1) }] }), true, "one-sided proposal");
  assert.equal(Bets.canJoin({ status: "active", joinable: false, entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(1) }] }), false, "proposer closed it");
  assert.equal(Bets.canJoin({ status: "active", entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(4) }] }), false, "player vs the field");
  assert.equal(Bets.canJoin({ status: "active", game: { id: "g" }, entries: [{ memberId: "a", side: "NE" }, { memberId: "b", side: "SEA" }] }), false, "game bets are two sides");
  assert.equal(Bets.canJoin({ status: "settled", entries: [{ memberId: "a", picks: p(1) }, { memberId: "b", picks: p(1) }] }), false, "done is done");
});

test("autoResult: a game bet settles from the final score, or pushes", () => {
  const games = { games: [{ id: "g1", week: 1, away: "NE", home: "SEA", date: "2026-09-10T00:20:00Z", status: "final", awayScore: 17, homeScore: 24 }] };
  const ml = { status: "active", week: 1, game: { id: "g1", week: 1, away: "NE", home: "SEA", date: "2026-09-10T00:20:00Z" }, market: "ml",
    entries: [{ memberId: "m0", side: "NE" }, { memberId: "m1", side: "SEA" }] };
  assert.equal(Bets.autoResult(ml, games).winner, "m1");
  assert.match(Bets.autoResult(ml, games).note, /Final · NE 17, SEA 24/);
  const tot = { ...ml, market: "total", line: 41, entries: [{ memberId: "m0", side: "over" }, { memberId: "m1", side: "under" }] };
  assert.equal(Bets.autoResult(tot, games).winner, "push", "41 total on the 41 line");
  assert.equal(Bets.autoResult({ ...tot, line: 40.5 }, games).winner, "m0", "over");
  const live = { games: [{ ...games.games[0], status: "live" }] };
  assert.equal(Bets.autoResult(ml, live), null, "not while it's on");
  assert.equal(Bets.autoResult({ ...ml, status: "open" }, games), null, "an unfilled bet never settles");
});

test("autoResult: a stat bet settles when the period is final and the stats are fresher than the last game", () => {
  const kick = "2026-09-14T00:20:00Z", lastEnd = Date.parse(kick) + Bets.SETTLE_LAG;
  const games = { games: [{ id: "a", week: 1, date: "2026-09-13T17:00:00Z", status: "final" }, { id: "b", week: 1, date: kick, status: "final" }] };
  const bet = (rows, tracks, updatedAt) => ({ status: "active", week: 1, entries: [{ memberId: "m0" }, { memberId: "m1" }],
    stats: { scope: "player", stat: tracks[0].stat, tracks, rows, updatedAt, through: "Through week 1" } });
  const rows = [{ key: "1", entry: 0, values: { rec_yd: 120 } }, { key: "2", entry: 1, values: { rec_yd: 80 } }];
  const fresh = new Date(lastEnd + 60e3).toISOString(), stale = new Date(lastEnd - 60e3).toISOString(), after = lastEnd + 120e3;
  assert.equal(Bets.autoResult(bet(rows, [{ stat: "rec_yd" }], fresh), games, after).winner, "m0");
  assert.equal(Bets.autoResult(bet(rows, [{ stat: "rec_yd" }], stale), games, after), null, "stats predate the end of the last game");
  assert.equal(Bets.autoResult(bet(rows, [{ stat: "rec_yd" }], fresh), { games: [games.games[0], { ...games.games[1], status: "live" }] }, after), null, "a game still on");
  const allowed = [{ key: "HOU", entry: 0, values: { pts_allow: 24 } }, { key: "DAL", entry: 1, values: { pts_allow: 17 } }];
  assert.equal(Bets.autoResult(bet(allowed, [{ stat: "pts_allow", lower: true }], fresh), games, after).winner, "m1", "lower is better");
  const tie = [{ key: "1", entry: 0, values: { rec_yd: 100 } }, { key: "2", entry: 1, values: { rec_yd: 100 } }];
  assert.equal(Bets.autoResult(bet(tie, [{ stat: "rec_yd" }], fresh), games, after).winner, "push");
  const multi = [{ key: "1", entry: 0, values: { rec_yd: 120, rec: 5, rec_td: 1 } }, { key: "2", entry: 1, values: { rec_yd: 80, rec: 9, rec_td: 2 } }];
  assert.equal(Bets.autoResult(bet(multi, [{ stat: "rec_yd" }, { stat: "rec" }, { stat: "rec_td" }], fresh), games, after).winner, "m1", "most stats led");
  // a season bet waits for the last week
  const season = { ...bet(rows, [{ stat: "rec_yd" }], fresh), week: 0 };
  assert.equal(Bets.autoResult(season, games, after), null, "week 17 hasn't been played");
  const wk17 = { games: [{ id: "z", week: 17, date: "2027-01-04T01:20:00Z", status: "final" }] };
  const seasonFresh = { ...season, stats: { ...season.stats, updatedAt: "2027-01-05T00:00:00Z" } };
  assert.equal(Bets.autoResult(seasonFresh, wk17, Date.parse("2027-01-05T01:00:00Z")).winner, "m0");
});

test("a spread bet settles from the final score, the favourite giving the points", () => {
  const bet = { week: 1, status: "active", market: "spread", line: 9.5, fav: "KC",
    game: { id: "g", week: 1, away: "KC", home: "CAR", date: "2026-09-13T17:00:00Z" },
    entries: [{ memberId: "a", side: "KC" }, { memberId: "b", side: "CAR" }] };
  const game = (aw, hm) => ({ id: "g", week: 1, away: "KC", home: "CAR", status: "final", awayScore: aw, homeScore: hm });
  assert.equal(Bets.coverSide(bet, game(31, 17)), "away", "won by 14, covers 9.5");
  assert.equal(Bets.coverSide(bet, game(24, 20)), "home", "won by 4, doesn't cover");
  assert.equal(Bets.coverSide(bet, game(17, 31)), "home", "lost outright");
  assert.equal(Bets.coverSide({ ...bet, line: 10 }, game(27, 17)), "push", "exactly the number is a push");
  assert.equal(Bets.lineText(bet), "KC −9.5");
});

test("lineOrigin: a bet says whether its number was Vegas's or the proposer's own", () => {
  const g = { id: "g", week: 1, away: "KC", home: "CAR", date: "2026-09-13T17:00:00Z" };
  assert.equal(Bets.lineOrigin({ game: g, market: "total", line: 44.5, lineSrc: "vegas" }), "vegas");
  assert.equal(Bets.lineOrigin({ game: g, market: "spread", line: 3, fav: "KC", lineSrc: "own" }), "own");
  assert.equal(Bets.lineOrigin({ game: g, market: "total", line: 44.5 }), null, "a bet posted before this shipped doesn't guess");
  assert.equal(Bets.lineOrigin({ game: g, market: "ml", lineSrc: "vegas" }), null, "a straight-up bet has no number");
  assert.equal(Bets.lineOrigin(null), null);
});
