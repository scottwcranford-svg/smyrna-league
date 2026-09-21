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
  assert.equal(Bets.scoringText(one), "Most receiving yards in Week 3 wins. A tie for the top is a push. Settles once every game its picks play in is final.");
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
  assert.equal(Bets.scoringText({ ...two, tiebreak: true }), "Each stat is its own contest in Week 3: receiving yards and fumbles lost (fewest wins). Whoever wins more of them takes it. A stat that ends tied counts for nobody. If the stats won are level, the first one listed (receiving yards) decides it; if that's tied too, it's a push. Settles once every game its picks play in is final.");
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

test("league result: yes/no sides, the subject's standing, and a name and terms from the outcome", () => {
  assert.equal(Bets.leagueName("m1", "playoffs", config.members), "JPorch makes the playoffs");
  assert.match(Bets.leagueTerms("playoffs"), /^Makes it vs Misses/);
  assert.equal(Bets.leagueSideText("yes", "playoffs"), "Makes it"); assert.equal(Bets.leagueSideText("no", "playoffs"), "Misses");
  assert.equal(Bets.leagueOutcome("title"), null, "an outcome that doesn't exist yet");
  const b = { league: { subject: "m1", outcome: "playoffs" }, status: "active", entries: [{ memberId: "m0", side: "yes" }, { memberId: "m2", side: "no" }] };
  assert.equal(Bets.canJoin({ ...b, status: "open", joinable: true }), false, "two sides, nobody joins");
  const ST = { teams: 2, rows: [{ rid: 1, id: "m2", name: "RTownsend", w: 3, l: 0, t: 0, pf: 400 }, { rid: 2, id: "m1", name: "JPorch", w: 2, l: 1, t: 0, pf: 380.5 }, { rid: 3, id: null, name: "ghost", w: 0, l: 3, t: 0, pf: 200 }] };
  const st = Bets.leagueStanding(b, ST);
  assert.deepEqual([st.me.rank, st.me.w, st.me.l, st.teams, st.inField, st.decided], [2, 2, 1, 2, true, false], "2nd of 3, inside a top two, not decided yet");
  assert.equal(Bets.leagueStanding({ ...b, league: { subject: "m0", outcome: "playoffs" } }, ST), null, "a manager the table doesn't have");
  assert.equal(Bets.leagueStanding(b, null), null);
  // Sleeper seeds its bracket from the live table all season: while it has a full field that is
  // the line as it stands (its tiebreakers, not ours), and only `complete` makes it final
  const live = { ...ST, playoffs: { rids: [1, 3], field: ["m2"], seeded: true, complete: false } };
  const lv = Bets.leagueStanding(b, live);
  assert.deepEqual([lv.seeded, lv.decided, lv.inField, lv.rows.map(r => r.in)], [true, false, false, [true, false, false]], "the seeded field is the line, not the table's top two; nothing decided yet");
  const seeded = { ...ST, playoffs: { rids: [1, 3], field: ["m2"], complete: true } };
  const sd = Bets.leagueStanding(b, seeded);
  assert.deepEqual([sd.decided, sd.inField], [true, false], "once complete the bracket decides, whatever the table says");
  assert.deepEqual(st.rows.map(r => r.in), [true, true, false], "no bracket: the table's top two");
  assert.match(Bets.scoringText(b), /^If the team is in Sleeper's playoff field when the regular season ends after Week 14, Makes it wins; otherwise Misses does\. .*there's no push\./);
});

test("autoResult: a league result bet settles from the seeded bracket once the regular season is final, and never guesses", () => {
  const b = { league: { subject: "m1", outcome: "playoffs" }, status: "active", week: 0, entries: [{ memberId: "m0", side: "yes" }, { memberId: "m2", side: "no" }] };
  const reg = (status) => ({ games: [{ id: "a", week: 14, status, date: "2026-12-14T00:00:00Z" }, { id: "b", week: 15, status: "pre", date: "2026-12-21T00:00:00Z" }] });
  const table = (playoffs, extra) => ({ standings: { teams: 2, playoffStart: 15, seedType: 0, over: true, rows: [{ rid: 1, id: "m2", name: "RTownsend", w: 9, l: 5 }, { rid: 2, id: "m1", name: "JPorch", w: 8, l: 6 }, { rid: 3, id: "m0", name: "gmelan1", w: 8, l: 6 }], playoffs, ...extra } });
  const inField = table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true });
  assert.deepEqual(Bets.autoResult(b, reg("final"), 0, inField), { winner: "m0", note: "Regular season over · in the playoff field" });
  assert.equal(Bets.autoResult(b, reg("final"), 0, table({ rids: [1, 3], field: ["m2", "m0"], seeded: true, complete: true })).winner, "m2", "missed: No wins");
  assert.equal(Bets.autoResult(b, reg("final"), 0, table({ rids: [1], field: ["m2"], complete: false })), null, "a half-seeded bracket waits");
  assert.equal(Bets.autoResult(b, reg("final"), 0, table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: false })), null, "Sleeper's live seeding is not a result");
  assert.equal(Bets.autoResult(b, reg("final"), 0, table(null)), null, "no bracket yet");
  assert.equal(Bets.autoResult(b, reg("live"), 0, inField), null, "the book's own week 14 isn't final yet");
  assert.equal(Bets.autoResult(b, reg("final"), 0, null), null, "no standings at all");
  assert.equal(Bets.autoResult({ ...b, league: { subject: "mX", outcome: "playoffs" } }, reg("final"), 0, inField), null, "a subject the table doesn't know is settled by hand");
  assert.equal(Bets.autoResult({ ...b, league: { subject: "m1", outcome: "title" } }, reg("final"), 0, inField), null, "an outcome that doesn't exist");
  assert.equal(Bets.autoResult({ ...b, status: "open" }, reg("final"), 0, inField), null, "an unfilled bet never settles");

  // the places read off the table once the regular season is over - JPorch is 2nd of 3
  const at = (outcome) => ({ ...b, league: { subject: "m1", outcome } });
  const done = table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true });
  assert.deepEqual(Bets.autoResult(at("reg1"), reg("final"), 0, done), { winner: "m2", note: "Regular season over · finished 2nd of 3" }, "not 1st: No");
  assert.equal(Bets.autoResult(at("top3"), reg("final"), 0, done).winner, "m0", "top 3: Yes");
  assert.equal(Bets.autoResult(at("last"), reg("final"), 0, done).winner, "m2", "not last: No");
  assert.equal(Bets.autoResult(at("reg1"), reg("final"), 0, table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true }, { over: false })), null, "the table isn't final yet");
  assert.equal(Bets.autoResult(at("reg1"), reg("final"), 0, table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true }, { seedType: 1 })), null, "a league seeded some other way is settled by hand");
  // the champion is the final's winner, whenever that is played
  assert.equal(Bets.autoResult(at("champ"), reg("final"), 0, done), null, "no final yet");
  assert.deepEqual(Bets.autoResult(at("champ"), reg("live"), 0, table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true, champion: "m1" })), { winner: "m0", note: "Playoff final played · champion" });
  assert.equal(Bets.autoResult(at("champ"), reg("live"), 0, table({ rids: [1, 2], field: ["m2", "m1"], seeded: true, complete: true, champion: "m2" })).winner, "m2", "somebody else won it");
});

test("league matchup: the week's pairings, the bet's matchup as the board has it, and a settlement on points", () => {
  const scores = { weeks: { "5": { final: false, rows: [
    { id: "m1", name: "JPorch", pts: 88.6, proj: 104.2, mid: 1 }, { id: "m2", name: "RTownsend", pts: 131, proj: 118.5, mid: 1 },
    { id: "m0", name: "gmelan1", pts: 0, proj: 99.4, mid: 2 }, { id: null, name: "ghost", pts: 0, proj: null, mid: 2 } ] } } };
  assert.deepEqual(Bets.leaguePairings(5, scores), [{ a: "m1", b: "m2" }], "a pairing needs both managers known to the book");
  assert.deepEqual(Bets.leaguePairings(6, scores), [], "a week the book has no board for");
  assert.deepEqual(Bets.leaguePairings(5, null), []);
  const b = { league: { subject: "m1", opp: "m2", outcome: "matchup" }, week: 5, status: "active", entries: [{ memberId: "m0", side: "m1" }, { memberId: "m2", side: "m2" }] };
  const M = Bets.leagueMatchup(b, scores);
  assert.deepEqual([M.week, M.me.name, M.opp.name, M.final], [5, "JPorch", "RTownsend", false]);
  assert.equal(Bets.leagueMatchup({ ...b, week: 6 }, scores), null, "no board for the week");
  assert.equal(Bets.leagueName("m1", "matchup", config.members, 5, "m2"), "JPorch vs RTownsend · Week 5");
  assert.equal(Bets.leagueSideText("m2", "matchup", config.members), "RTownsend", "a matchup side is the manager");
  assert.match(Bets.scoringText(b), /^Whoever scores more in the Week 5 Sleeper matchup wins\. A tie is a push\./);
  assert.equal(Bets.autoResult(b, null, 0, { scores }), null, "not while the week is on");
  const fin = (a, c) => ({ scores: { weeks: { "5": { final: true, rows: [{ id: "m1", name: "JPorch", pts: a, mid: 1 }, { id: "m2", name: "RTownsend", pts: c, mid: 1 }] } } } });
  assert.deepEqual(Bets.autoResult(b, null, 0, fin(88.6, 131)), { winner: "m2", note: "Week 5 final · JPorch 88.6, RTownsend 131" }, "RTownsend's side wins");
  assert.equal(Bets.autoResult(b, null, 0, fin(131, 88.6)).winner, "m0", "JPorch's side wins");
  assert.equal(Bets.autoResult(b, null, 0, fin(100, 100)).winner, "push", "level is a push");
  assert.equal(Bets.autoResult(b, null, 0, { scores: { weeks: { "5": { final: true, rows: [{ id: "m1", pts: 1, mid: 1 }] } } } }), null, "the opponent's row missing: wait");
  assert.equal(Bets.ordinal(1) + Bets.ordinal(2) + Bets.ordinal(3) + Bets.ordinal(4) + Bets.ordinal(11) + Bets.ordinal(12) + Bets.ordinal(13) + Bets.ordinal(21), "1st2nd3rd4th11th12th13th21st");
});

test("league standing: the line moves with the outcome - the field, 1st, top 3, last, the champion", () => {
  const ST = { teams: 2, over: false, rows: [{ rid: 1, id: "m2", name: "RTownsend", w: 3, l: 0 }, { rid: 2, id: "m1", name: "JPorch", w: 2, l: 1 }, { rid: 3, id: "m0", name: "gmelan1", w: 2, l: 1 }, { rid: 4, id: null, name: "ghost", w: 0, l: 3 }],
    playoffs: { rids: [1, 3], field: ["m2", "m0"], seeded: true, complete: false } };
  const at = (outcome, id) => ({ league: { subject: id || "m1", outcome } });
  const pick = (st) => [st.cut, st.cutLabel, st.inField, st.decided, st.rows.map(r => r.in)];
  assert.deepEqual(pick(Bets.leagueStanding(at("playoffs"), ST)), [2, "Top 2 make the playoffs", false, false, [true, false, true, false]], "the seeded field, not the table's top two");
  assert.deepEqual(pick(Bets.leagueStanding(at("reg1"), ST)), [1, "1st place", false, false, [true, false, false, false]]);
  assert.deepEqual(pick(Bets.leagueStanding(at("top3"), ST)), [3, "Top 3", true, false, [true, true, true, false]]);
  assert.deepEqual(pick(Bets.leagueStanding(at("last"), ST)), [3, "Last place", false, false, [false, false, false, true]]);
  assert.deepEqual(pick(Bets.leagueStanding(at("champ"), ST)), [2, "Top 2 make the playoffs", false, false, [true, false, true, false]], "the champion's line is the field until the final");
  const over = { ...ST, over: true, playoffs: { ...ST.playoffs, complete: true } };
  assert.deepEqual(Bets.leagueStanding(at("reg1", "m2"), over).decided, true, "the places are decided once the regular season is over");
  assert.deepEqual([Bets.leagueStanding(at("champ"), over).decided, Bets.leagueStanding(at("champ"), { ...over, playoffs: { ...over.playoffs, champion: "m1" } }).inField], [false, true], "the champion is decided by the final alone");
  assert.equal(Bets.leagueStanding(at("matchup"), ST), null, "a matchup has no table");
});

test("matchupTeams: the NFL teams both sides' starters play for, by Sleeper roster; pairings fall back to the schedule in the standings", () => {
  const squads = { byRoster: { "1": "JPorch", "2": "hobnailboot", "3": "RTownsend" }, rosters: {}, starters: { "1": ["p1", "p2", "0"], "2": ["p3"], "3": ["p9"] } };
  const roster = { players: [["p1", "A", "QB", "KC"], ["p2", "B", "WR", "KC"], ["p3", "C", "RB", "CIN"], ["p9", "D", "TE", "SEA"]] };
  const members = [{ id: "m0", name: "gmelan1" }, { id: "m1", name: "JPorch" }, { id: "m2", name: "RTownsend" }, { id: "m4", name: "hobnailboot" }];
  const b = { league: { subject: "m1", opp: "m4", outcome: "matchup" }, week: 3 };
  assert.deepEqual(Bets.matchupTeams(b, squads, roster, members), ["KC", "CIN"], "each team once, both sides");
  assert.equal(Bets.matchupTeams({ league: { subject: "m1", outcome: "playoffs" } }, squads, roster, members), null, "a season bet has no starters to lock on");
  assert.equal(Bets.matchupTeams(b, null, roster, members), null, "no squads yet");
  assert.equal(Bets.matchupTeams({ ...b, league: { subject: "m0", opp: "mX", outcome: "matchup" } }, squads, roster, members), null, "managers the squads don't have");
  const standings = { pairings: { "6": [{ a: "m1", b: "m2" }, { a: "m0", b: null }] } };
  assert.deepEqual(Bets.leaguePairings(6, null, standings), [{ a: "m1", b: "m2" }], "the schedule from the standings, pairs with both managers only");
  const scores = { weeks: { "6": { rows: [{ id: "m4", mid: 1 }, { id: "m0", mid: 1 }] } } };
  assert.deepEqual(Bets.leaguePairings(6, scores, standings), [{ a: "m4", b: "m0" }], "the week's board wins once the book has it");
  assert.deepEqual(Bets.leaguePairings(7, scores, standings), []);
});

test("againstSelf: nobody holds the side that pays when their own team fails", () => {
  const season = (outcome) => ({ league: { subject: "m1", outcome } });
  assert.equal(Bets.againstSelf(season("playoffs"), "m1", "no"), true, "Misses on your own team");
  assert.equal(Bets.againstSelf(season("playoffs"), "m1", "yes"), false, "Makes it on your own team is fine");
  assert.equal(Bets.againstSelf(season("playoffs"), "m2", "no"), false, "anyone else can take either side");
  assert.equal(Bets.againstSelf(season("champ"), "m1", "no"), true);
  assert.equal(Bets.againstSelf(season("last"), "m1", "yes"), true, "Last on your own team pays when you lose");
  assert.equal(Bets.againstSelf(season("last"), "m1", "no"), false, "Not last is backing yourself");
  const m = { league: { subject: "m1", opp: "m2", outcome: "matchup" }, week: 3 };
  assert.equal(Bets.againstSelf(m, "m1", "m2"), true, "taking your opponent in your own matchup");
  assert.equal(Bets.againstSelf(m, "m2", "m1"), true);
  assert.equal(Bets.againstSelf(m, "m1", "m1"), false); assert.equal(Bets.againstSelf(m, "m0", "m2"), false, "a third manager takes whoever");
  assert.equal(Bets.againstSelf({ game: { id: "g" } }, "m1", "NE"), false, "not a league bet");
  assert.equal(Bets.againstSelf(m, null, "m2"), false);
});

test("autoResult: a weekly stat bet settles once the games its picks play in are final, not the whole week", () => {
  const thu = "2026-09-18T00:15:00Z", sun = "2026-09-20T17:00:00Z", mon = "2026-09-22T00:15:00Z";
  const week = (monStatus) => ({ games: [
    { id: "a", week: 2, away: "DET", home: "BUF", date: thu, status: "final" },
    { id: "b", week: 2, away: "CAR", home: "ATL", date: sun, status: "final" },
    { id: "c", week: 2, away: "NYG", home: "LAR", date: mon, status: monStatus }] });
  const sunEnd = Date.parse(sun) + Bets.SETTLE_LAG, monEnd = Date.parse(mon) + Bets.SETTLE_LAG;
  const bet = (picks, updatedAt) => ({ status: "active", week: 2,
    entries: [{ memberId: "m4", picks: picks[0] }, { memberId: "m1", picks: picks[1] }],
    stats: { scope: "player", stat: "rush_rec_yd", tracks: [{ stat: "rush_rec_yd" }], updatedAt, through: "Through week 2",
      rows: [{ entry: 0, values: { rush_rec_yd: 113 } }, { entry: 1, values: { rush_rec_yd: 81 } }] } });
  const two = [[{ team: "DET" }], [{ team: "ATL" }]];
  const afterSun = new Date(sunEnd + 60e3).toISOString();
  const r = Bets.autoResult(bet(two, afterSun), week("pre"), sunEnd + 120e3);
  assert.equal(r && r.winner, "m4", "Thursday and Sunday final: settled on Sunday night");
  assert.equal(r.note, "Week 2 · its games final · Through week 2", "the note says the week isn't over");
  assert.equal(Bets.autoResult(bet(two, afterSun), week("pre"), sunEnd - 60e3), null, "not before the lag after the last of its games");
  assert.equal(Bets.autoResult(bet(two, new Date(sunEnd - 60e3).toISOString()), week("pre"), sunEnd + 120e3), null, "stats must be fresher than its last game");
  assert.equal(Bets.autoResult(bet(two, afterSun), { games: [week("pre").games[0], { ...week("pre").games[1], status: "live" }, week("pre").games[2]] }, sunEnd + 120e3), null, "one of its games still on");
  const afterMon = new Date(monEnd + 60e3).toISOString();
  assert.equal(Bets.autoResult(bet(two, afterMon), week("final"), monEnd + 120e3).note, "Week 2 complete · Through week 2", "once the week is over the note says so");
  // a pick the slate has no game for (bye), or one without a team: the whole week
  const bye = [[{ team: "DET" }], [{ team: "KC" }]];
  assert.equal(Bets.autoResult(bet(bye, afterSun), week("pre"), sunEnd + 120e3), null, "a bye pick waits for the week");
  assert.equal(Bets.autoResult(bet(bye, afterMon), week("final"), monEnd + 120e3).winner, "m4");
  const noTeam = [[{ team: "DET" }], [{ name: "someone" }]];
  assert.equal(Bets.autoResult(bet(noTeam, afterSun), week("pre"), sunEnd + 120e3), null, "a pick without a team waits for the week");
  assert.deepEqual(Bets.ownGames({ entries: [{ picks: [{ team: "DET" }] }, { picks: [{ team: "ATL" }] }] }, week("pre").games).map(g => g.id), ["a", "b"]);
  assert.equal(Bets.ownGames({ entries: [{ memberId: "m0" }, { memberId: "m1" }] }, week("pre").games), null, "no picks at all: the week");
});
