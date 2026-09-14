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

test("matched sides: same number, same lineup, or one player against a field of four", () => {
  const p = (id, pos) => ({ id, name: id, pos, team: "KC" });
  const side = (...pos) => ({ memberId: "m0", picks: pos.map((x, i) => p(x + i + Math.random(), x)) });
  assert.equal(Bets.sidesProblem("count", [side("QB", "WR"), side("RB", "TE")]), "", "same count, any positions");
  assert.match(Bets.sidesProblem("count", [side("QB", "WR"), side("RB")]), /Pick 2 players/);
  assert.equal(Bets.sidesProblem("lineup", [side("WR", "QB"), side("QB", "WR")]), "", "order doesn't matter");
  assert.match(Bets.sidesProblem("lineup", [side("QB", "WR"), side("QB", "RB")]), /Pick QB \+ WR/);
  assert.equal(Bets.sidesProblem("field", [side("QB"), side("WR", "WR", "RB", "TE")]), "", "one against four");
  assert.equal(Bets.sidesProblem("field", [side("WR", "WR", "RB", "TE"), side("QB")]), "", "either side can be the field");
  assert.match(Bets.sidesProblem("field", [side("QB"), side("WR", "WR", "RB")]), /field of 4/, "three isn't a field");
  assert.match(Bets.sidesProblem("field", [side("QB"), side("WR", "WR", "RB", "TE"), side("K")]), /two sides/);
  assert.equal(Bets.sidesProblem("any", [side("QB"), side("WR", "RB")]), "");

  const bet = (match, ...entries) => ({ match, status: "open", joinable: true, stats: { scope: "player" }, entries });
  assert.equal(Bets.joinProblem(bet("lineup", side("QB", "WR")), [p("a", "WR"), p("b", "QB")]), "");
  assert.match(Bets.joinProblem(bet("lineup", side("QB", "WR")), [p("a", "WR"), p("b", "WR")]), /QB \+ WR, same as everyone else/);
  assert.match(Bets.joinProblem(bet("count", side("QB", "WR")), [p("a", "K")]), /Pick 2 players/);
  assert.deepEqual(Bets.positionsNeeded(bet("lineup", side("QB", "WR", "WR")), [p("a", "WR")]), { QB: 1, WR: 1 }, "what's left to fill");
  assert.equal(Bets.positionsNeeded(bet("count", side("QB")), []), null);

  assert.equal(Bets.matchLabel(bet("count", side("QB", "WR"))), "2 players each");
  assert.equal(Bets.matchLabel(bet("lineup", side("QB", "WR", "WR"))), "QB + 2 WR each");
  assert.equal(Bets.matchLabel(bet("field", side("QB"), side("WR", "WR", "RB", "TE"))), "1 vs a field of 4");

  // bets from before the setting are left as they were
  const old = (...entries) => ({ status: "open", joinable: true, stats: { scope: "player" }, entries });
  assert.equal(Bets.matchLevel(old(side("QB"), side("WR"))), "count", "even sides: the old same-count rule");
  assert.equal(Bets.matchLevel(old(side("QB"), side("WR", "RB"))), "any", "uneven sides: no rule, as before");
  assert.match(Bets.joinProblem(old(side("QB", "WR")), [p("a", "K")]), /Pick 2 players/);
  assert.equal(Bets.matchLabel(old(side("QB", "WR"))), "", "and the ticket says nothing new about them");
});

test("scoringText: every kind of bet says how it's scored, in the words autoResult settles by", () => {
  const g = { id: "g", week: 3, away: "DEN", home: "KC", date: "2026-09-20T17:00:00Z" };
  assert.equal(Bets.scoringText({ game: g, market: "ml" }), "Whoever wins the game takes it. A tie is a push.");
  assert.equal(Bets.scoringText({ game: g, market: "total", line: 45.5 }), "Both teams' final points are added together. Over 45.5 wins if the total is higher, Under if it's lower. Exactly 45.5 is a push.");
  assert.equal(Bets.scoringText({ game: g, market: "spread", line: 3.5, fav: "KC" }), "KC has to win by more than 3.5 to cover; anything else and DEN covers. KC winning by exactly 3.5 is a push.");
  assert.equal(Bets.scoringText({ game: g, market: "spread", line: 0, fav: "KC" }), "Whoever wins the game takes it. A tie is a push.", "a pick'em reads as straight up");
  const p = (id, pos) => ({ id, name: id, pos, team: "KC" });
  const one = { week: 3, joinable: false, stats: { scope: "player", tracks: [{ stat: "rec_yd", metric: "Receiving yards" }] }, entries: [{ memberId: "a", picks: [p("1", "WR")] }, { memberId: "b", picks: [p("2", "WR")] }] };
  assert.equal(Bets.scoringText(one), "Most receiving yards in Week 3 wins. A tie for the top is a push. Settles once every game that week is final.");
  assert.match(Bets.scoringText({ ...one, week: 0, joinable: true, status: "open" }), /^Most receiving yards over the whole season wins\. However many join, the one leader takes every stake\. .* Settles once every game through Week 17 is final\.$/);
  assert.match(Bets.scoringText({ ...one, stats: { scope: "team", tracks: [{ stat: "pts_allow", metric: "Points allowed", lower: true }] } }), /^Fewest points allowed in Week 3 wins\./);
  assert.match(Bets.scoringText({ ...one, entries: [{ memberId: "a", picks: [p("1", "WR"), p("3", "RB")] }, { memberId: "b", picks: [p("2", "WR"), p("4", "RB")] }] }), /A side's players are added together\./);
  const field = { ...one, match: "field", entries: [{ memberId: "a", picks: [p("1", "WR")] }, { memberId: "b", picks: ["2", "3", "4", "5"].map(x => p(x, "WR")) }] };
  assert.match(Bets.scoringText(field), /The field counts only its best player\./); assert.doesNotMatch(Bets.scoringText(field), /added together|However many/);
  const oldField = { ...one, stats: { scope: "player", tracks: [{ stat: "pts_ppr", metric: "PPR points · best of each side" }], rows: [{ key: "1", entry: 0 }, { key: "2", entry: 1 }, { key: "3", entry: 1 }] } };
  assert.match(Bets.scoringText(oldField), /^Most PPR points in Week 3 wins\. The field counts only its best player\./, "an older field bet is recognised from its rows");
  assert.doesNotMatch(Bets.scoringText({ ...one, status: "active", joinable: false }), /However many/, "a head-to-head closed to joiners doesn't talk about them");
  assert.match(Bets.scoringText({ ...one, stats: { scope: "team", tracks: [{ stat: "takeaways", metric: "Takeaways · INT + fumble recoveries" }] } }), /^Most takeaways in Week 3 wins\./);
  const two = { ...one, stats: { scope: "player", tracks: [{ stat: "rec_yd", metric: "Receiving yards" }, { stat: "fum_lost", metric: "Fumbles lost", lower: true }] } };
  assert.equal(Bets.scoringText({ ...two, tiebreak: true }), "Each stat is its own contest in Week 3: receiving yards and fumbles lost (fewest wins). Whoever wins more of them takes it. A stat that ends tied counts for nobody. If the stats won are level, the first one listed (receiving yards) decides it; if that's tied too, it's a push. Settles once every game that week is final.");
  assert.match(Bets.scoringText(two), /If the stats won are level, it's a push\./, "a bet from before the tiebreaker says so");
  assert.equal(Bets.scoringText({ stats: null, entries: [] }), "Settled by hand: the result is recorded once it's decided.");
});

test("autoResult: level on stats won — the first stat decides a bet with the tiebreaker, pushes one without", () => {
  const games = { games: [{ week: 3, status: "final", date: "2026-09-21T00:00:00Z" }] };
  const now = Date.parse("2026-09-22T12:00:00Z");
  const bet = (tiebreak, recYd) => ({ status: "active", week: 3, tiebreak, entries: [{ memberId: "a" }, { memberId: "b" }],
    stats: { scope: "player", updatedAt: "2026-09-22T00:00:00Z", through: "Through week 3", tracks: [{ stat: "rec_yd", metric: "Receiving yards" }, { stat: "rec", metric: "Receptions" }],
      rows: [{ memberId: "a", entry: 0, values: { rec_yd: recYd[0], rec: 5 } }, { memberId: "b", entry: 1, values: { rec_yd: recYd[1], rec: 8 } }] } });
  assert.deepEqual(Bets.autoResult(bet(true, [92, 71]), games, now), { winner: "a", note: "Week 3 complete · level on stats, Receiving yards decided it" }, "1–1, yards is first: a");
  assert.equal(Bets.autoResult(bet(false, [92, 71]), games, now).winner, "push", "an older bet still pushes a split");
  assert.equal(Bets.autoResult(bet(true, [60, 71]), games, now).winner, "b", "b wins both outright; no tiebreak needed");
  const tiedFirst = bet(true, [70, 70]); tiedFirst.stats.tracks.push({ stat: "rec_td", metric: "Receiving TDs" }); tiedFirst.stats.rows[0].values.rec_td = 1; tiedFirst.stats.rows[1].values.rec_td = 0;
  assert.equal(Bets.autoResult(tiedFirst, games, now).winner, "push", "yards tied (nobody), 1–1 on the rest, and the first stat can't break it");
});
