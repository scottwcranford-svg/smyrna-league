// sleeper.js against saved Sleeper responses (test/fixtures): the scores feed → game
// rows, the player index → roster rows, season totals → re-scored bet stats, and
// the refresh loop's freshness rules with a fake book.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Roster from "../roster.js";
import * as Clock from "../clock.js";

const fx = (n) => JSON.parse(fs.readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const N = await import("../sleeper.js");

test("parseScores: pre-game rows carry id, week, teams and a UTC kickoff", () => {
  const games = N.parseScores([fx("scores-w1.json")], [1]);
  assert.equal(games.length, 3);
  const g = games[0];
  assert.equal(g.away, "CHI"); assert.equal(g.home, "CAR"); assert.equal(g.week, 1);
  assert.equal(g.date, "2026-09-13T17:00:00Z"); assert.equal(g.status, "pre");
  assert.equal(g.q, undefined, "no clock before kickoff");
});

test("parseScores: live and final games carry score, quarter, clock, possession", () => {
  const base = fx("scores-w1.json")[0];
  const live = JSON.parse(JSON.stringify(base)); Object.assign(live.metadata, { is_in_progress: true, has_started: true, quarter_num: "3", quarter: "Q3", time_remaining: "7:12", away_score: 14, home_score: 17, possession: "CAR", red_zone: true, down_and_distance: "2nd & 4" });
  const fin = JSON.parse(JSON.stringify(base)); fin.status = "complete"; Object.assign(fin.metadata, { is_over: true, away_score: 20, home_score: 27, quarter_num: "4", is_overtime: false });
  const [L, F] = N.parseScores([[live, fin]], [1]);
  assert.equal(L.status, "live"); assert.equal(L.q, 3); assert.equal(L.clock, "7:12"); assert.equal(L.pos, "CAR"); assert.equal(L.rz, true); assert.equal(L.dd, "2nd & 4");
  assert.equal(L.awayScore, 14); assert.equal(L.homeScore, 17);
  assert.equal(F.status, "final"); assert.equal(F.homeScore, 27); assert.equal(F.ot, false); assert.equal(F.pos, undefined);
});

test("parseRoster: a status code rides on the row only when there's one", () => {
  const rows = N.parseRoster({
    q: { full_name: "Q Guy", position: "WR", fantasy_positions: ["WR"], team: "CIN", status: "Active", injury_status: "Questionable" },
    o: { full_name: "Out Guy", position: "RB", fantasy_positions: ["RB"], team: "NE", status: "Active", injury_status: "Out" },
    ir: { full_name: "IR Guy", position: "TE", fantasy_positions: ["TE"], team: "SEA", status: "Injured Reserve", injury_status: null },
    ok: { full_name: "Fine Guy", position: "QB", fantasy_positions: ["QB"], team: "KC", status: "Active", injury_status: null },
  });
  const by = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.equal(by.q[4], "Q"); assert.equal(by.o[4], "OUT"); assert.equal(by.ir[4], "IR");
  assert.equal(by.ok.length, 4, "an active player carries no fifth slot");
  assert.deepEqual(Roster.statusOf("q+o", { players: rows }), ["Q", "OUT"], "a combined pick lists each");
  assert.deepEqual(Roster.statusOf("ok", { players: rows }), []);
  assert.equal(Roster.statusCode({ status: "Inactive" }), "INA"); assert.equal(Roster.statusCode({ status: "Practice Squad" }), "PS");
  assert.equal(Roster.statusCode({ status: "Something New" }), "", "unknown roster statuses stay quiet");
});

test("parseRoster: fantasy positions on a team plus every defense, defenses last", () => {
  const rows = N.parseRoster(fx("players.json"));
  const ids = rows.map((r) => r[0]);
  assert.equal(ids.includes("19"), true, "QB on a team");
  assert.equal(ids.includes("4"), false, "free agent dropped");
  assert.equal(ids.includes("202"), false, "linemen dropped");
  assert.equal(JSON.stringify(rows.filter((r) => r[2] === "DEF").map((r) => r[1])), JSON.stringify(["Houston Texans", "New England Patriots"]));
  assert.equal(rows[rows.length - 1][2], "DEF");
  assert.equal(JSON.stringify(rows.find((r) => r[0] === "19")), JSON.stringify(["19", "Joe Flacco", "QB", "CIN"]));
});

test("restat: every tracked stat re-scored from totals, composites summed", () => {
  const T = fx("totals-2025.json");
  const hou = T.HOU, wr = Object.keys(T).find((k) => T[k].rec_yd > 1500);
  const S = { scope: "team", stat: "takeaways", tracks: [{ stat: "takeaways" }, { stat: "sack" }], rows: [{ key: "HOU", entry: 0, value: 0 }] };
  const out = N.restat(S, T, "Through week 18", "2026-01-10T00:00:00Z");
  assert.equal(out.rows[0].values.takeaways, Math.round(((hou.int || 0) + (hou.fum_rec || 0)) * 10) / 10);
  assert.equal(out.rows[0].values.sack, hou.sack); assert.equal(out.rows[0].value, out.rows[0].values.takeaways);
  assert.equal(out.through, "Through week 18"); assert.equal(out.updatedAt, "2026-01-10T00:00:00Z"); assert.equal(out.source, "Sleeper");
  const P = N.restat({ scope: "player", stat: "rec_yd", rows: [{ key: wr, entry: 0 }] }, T, "x", "y");
  assert.equal(P.rows[0].value, T[wr].rec_yd);
  assert.equal(N.restat(null, T, "x", "y"), null); assert.equal(N.restat({ stat: "x" }, T, "x", "y"), null);
});

// a fake book that records writes and hands out leases
function fakeDb() {
  const writes = [];
  return { writes, doc: (p) => ({ set: async (d) => { writes.push(["set", p, d]); }, update: async (d) => { writes.push(["update", p, d]); },
    acquire: async () => ({ acquired: true }) }) };
}
const config = { season: "2026", weekStarts: { "1": "2026-09-10T00:20:00Z" }, members: [] };

test("scoresTick skips when the scores are fresh, or when nobody has signed in yet it still runs under an anonymous holder", async () => {
  const db = fakeDb();
  await N.scoresTick(db, { config, games: { updatedAt: N.isoNow(), games: [] }, holder: null });
  assert.equal(db.writes.length, 0, "fresh enough");
  let fetched = [];
  globalThis.fetch = async (u) => { fetched.push(u); return { ok: true, json: async () => fx("scores-w1.json") }; };
  await N.scoresTick(db, { config, games: { updatedAt: "2020-01-01T00:00:00Z", games: [{ week: 5, date: "2026-10-11T17:00:00Z" }] }, holder: null });
  assert.equal(fetched.length, 2, "this week and next");
  assert.match(fetched[0], /scores\/nfl\/regular\/2026\/\d+$/);
  const w = db.writes[0]; assert.equal(w[1], "league/games");
  assert.equal(w[2].games.some((g) => g.week === 5), true, "other weeks kept");
  assert.equal(w[2].count, w[2].games.length);
});

test("runRefresh: projections for this week, next, and live weekly bets; rewritten only when changed", async () => {
  const db = fakeDb();
  const projUrls = [];
  const raw = { "2": { rec_yd: 82.46, rec: 5.2 }, "3": { pass_yd: 241.3 }, "9": { rec_yd: 40 } };
  globalThis.fetch = async (u) => {
    if (/projections/.test(u)) projUrls.push(u);
    return { ok: true, json: async () => (/state\/nfl/.test(u) ? { week: 3 } : /projections/.test(u) ? raw : /stats\/nfl\/regular\/2026\/\d+$/.test(u) ? {} : /stats\/nfl\/regular\/2026$/.test(u) ? {} : []), text: async () => "" };
  };
  const roster = { updatedAt: N.isoNow(), players: [["2", "Ja'Marr Chase", "WR", "CIN"], ["3", "Drake Maye", "QB", "NE"]] };
  const bets = [{ id: "b1", week: 7, status: "open", stats: { stat: "rec_yd", rows: [{ key: "2", entry: 0 }] } }, { id: "g", week: 5, status: "active", game: { id: "x" }, stats: null }];
  await N.runRefresh(db, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster, holder: "m1", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } } });
  assert.deepEqual(projUrls.map((u) => u.split("/").pop()).sort(), ["2026", "3", "4", "7"], "the season, this week, next, and the open week-7 bet; not the game bet's week");
  const w = db.writes.find((x) => x[1] === "league/proj");
  assert.ok(w, "projections written");
  assert.deepEqual(Object.keys(w[2].weeks).sort(), ["0", "3", "4", "7"], "the season rides as week 0");
  assert.deepEqual(JSON.parse(w[2].weeks["7"]), { "2": { rec_yd: 82.5, rec: 5.2 }, "3": { pass_yd: 241.3 } }, "trimmed to the roster, one decimal");
  // same data again: nothing to write
  const db2 = fakeDb();
  await N.runRefresh(db2, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster, holder: "m1", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } }, proj: w[2] });
  assert.equal(db2.writes.some((x) => x[1] === "league/proj"), false, "unchanged projections are not rewritten");
});

test("runRefresh: weekly high / low from the league's matchups, for finished weeks the book lacks", async () => {
  const db = fakeDb();
  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /state\/nfl/.test(u) ? { week: 3 }
      : /league\/L1\/rosters$/.test(u) ? [{ roster_id: 1, owner_id: "u1" }, { roster_id: 2, owner_id: "u2" }, { roster_id: 3, owner_id: "u3" }]
      : /league\/L1\/users$/.test(u) ? [{ user_id: "u1", display_name: "hobnailboot" }, { user_id: "u2", display_name: "testbot" }, { user_id: "u3", display_name: "ghost" }]
      : /league\/L1\/matchups\/1$/.test(u) ? [{ roster_id: 1, points: 120.5 }, { roster_id: 2, points: 99.1 }, { roster_id: 3, points: 130.2 }]
      : /league\/L1\/matchups\/2$/.test(u) ? [{ roster_id: 1, points: 101 }, { roster_id: 2, points: 140 }, { roster_id: 3, points: 90 }]
      : /stats\/nfl\/regular\/2026/.test(u) ? {} : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const games = { games: [{ week: 1, status: "final" }, { week: 1, status: "final" }, { week: 2, status: "final" }, { week: 3, status: "live" }] };
  const cfg = { ...config, sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow(), members: [{ id: "m0", name: "hobnailboot" }, { id: "m1", name: "testbot" }] };
  const base = { standings: { bySeason: { "2026": { at: N.isoNow() } } }, config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, games, sleeper: { updatedAt: N.isoNow(), leagueId: "L1", byId: { m0: {}, m1: {} } } };
  await N.runRefresh(db, "m0", true, base);
  const w = db.writes.find((x) => x[1] === "league/highlow");
  // the weeks now sit under their season, so another year can never land on top of them
  assert.deepEqual(Object.keys(w[2].weeks), ["2026"], "one season in the document");
  const hl26 = w[2].weeks["2026"];
  assert.deepEqual(Object.keys(hl26), ["1", "2"], "weeks 1 and 2 are final; 3 is live");
  assert.deepEqual(hl26["1"], { high: [{ id: null, name: "ghost", pts: 130.2 }], low: [{ id: "m1", name: "testbot", pts: 99.1 }] }, "an owner who isn't a manager keeps their Sleeper name");
  assert.deepEqual(hl26["2"].high, [{ id: "m1", name: "testbot", pts: 140 }]);
  // the same fetch fills the Scores board: everyone's row, not just the top and bottom
  const sb = db.writes.find((x) => x[1] === "league/scores")[2];
  const sb26 = sb.weeks["2026"];
  assert.deepEqual(Object.keys(sb26), ["1", "2"]);
  assert.equal(sb26["1"].final, true, "a finished week is frozen");
  assert.deepEqual(sb26["1"].rows.map((r) => [r.name, r.pts]),
    [["hobnailboot", 120.5], ["testbot", 99.1], ["ghost", 130.2]], "every manager, in roster order");
  assert.equal(sb26["1"].rows[0].proj, null, "no projection published for a week already played");
  assert.deepEqual(sb.byRoster, { 1: "hobnailboot", 2: "testbot", 3: "ghost" }, "the roster map rides along so the live tick needs one call");

  // week 1 already in the pool: the pool skips it, but the board still wants its rows
  hits.length = 0; const db2 = fakeDb();
  await N.runRefresh(db2, "m0", true, { ...base, highlow: { weeks: { "2026": { "1": hl26["1"] } } } });
  assert.deepEqual(hits.filter((h) => /matchups/.test(h)).sort(), ["league/L1/matchups/1", "league/L1/matchups/2"]);
  assert.deepEqual(Object.keys(db2.writes.find((x) => x[1] === "league/highlow")[2].weeks["2026"]), ["1", "2"]);
  // nothing new for either doc: no lookups, no writes
  hits.length = 0; const db3 = fakeDb();
  await N.runRefresh(db3, "m0", true, { ...base, highlow: w[2], scores: sb });
  assert.equal(hits.some((h) => /matchups/.test(h)), false,
    "the pool and the board have nothing to fetch (the roster pull is its own job, and still runs)");
  assert.equal(db3.writes.some((x) => x[1] === "league/highlow" || x[1] === "league/scores"), false,
    "an unchanged board is never rewritten - a write comes back as a snapshot and would loop");
});

test("runRefresh: the Sleeper league's team names and avatars, one call for everyone", async () => {
  const db = fakeDb();
  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /state\/nfl/.test(u) ? { week: 1 }
      : /\/v1\/user\/hobnailboot$/.test(u) ? { user_id: "466", avatar: "6dcbee5f" }
      : /\/v1\/user\/testbot$/.test(u) ? { user_id: "999", avatar: "t3st" }
      : /\/v1\/user\/466\/leagues\/nfl\/2026$/.test(u) ? [{ league_id: "L9", name: "Other League", total_rosters: 12 }, { league_id: "L1", name: "Smyrna League", total_rosters: 10 }]
      : /\/v1\/league\/L1\/users$/.test(u) ? [{ display_name: "hobnailboot", avatar: "6dcbee5f", metadata: { team_name: "Cheat 2 Win" } }, { display_name: "someoneelse", avatar: "x" }]
      : /\/v1\/league\/L1$/.test(u) ? { name: "Smyrna League", season: "2026", total_rosters: 10, avatar: null, settings: { type: 1 }, roster_positions: ["QB", "SUPER_FLEX", "BN"], scoring_settings: { rec: 1 } }
      : /stats\/nfl\/regular\/2026/.test(u) ? {} : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const cfg = { ...config, sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow(), members: [{ id: "m0", name: "hobnailboot", team: "Old Name" }, { id: "m1", name: "testbot" }] };
  await N.runRefresh(db, "m0", true, { config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } } });
  const w = db.writes.find((x) => x[1] === "league/sleeper");
  assert.equal(w[2].leagueId, "L1");
  assert.deepEqual(w[2].byId, { m0: { avatar: "6dcbee5f", team: "Cheat 2 Win" }, m1: { avatar: "t3st", team: "" } }, "league members get team names; others their public avatar");
  assert.deepEqual(w[2].league, { name: "Smyrna League", season: "2026", teams: 10, keeper: true, dynasty: false, sf: true, scoring: "PPR", avatar: "", playoffTeams: 0, playoffStart: 0, seedType: 0 }, "and the league's own settings ride along (this league says nothing about its playoffs)");
  // the identity block asks for everyone at once rather than per member; the board block
  // asks again for the week being played, which is one extra pair on the hourly refresh
  // (the standings are fresh here, so that block is quiet). The week being played is the real clock's.
  assert.deepEqual([...new Set(hits.filter((h) => /^league\/L1/.test(h)))].sort(),
    ["league/L1", "league/L1/drafts", "league/L1/matchups/" + Clock.currentWeek(cfg), "league/L1/rosters", "league/L1/users"],
    "the league's users and settings once each, plus the live week's board and a look for the draft");
  assert.equal(hits.filter((h) => h === "league/L1").length, 1, "the settings are not fetched per manager");
  // all known, fresh, league cached: no identity lookups (the live board still refreshes)
  hits.length = 0; const db2 = fakeDb();
  await N.runRefresh(db2, "m0", true, { config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } }, sleeper: { updatedAt: N.isoNow(), leagueId: "L1", byId: w[2].byId, league: w[2].league } });
  assert.equal(hits.some((h) => /^user\//.test(h) || h === "league/L1"), false, "nobody is looked up again once the league is cached");
  assert.equal(db2.writes.some((x) => x[1] === "league/sleeper"), false);
  // a new manager: sync again
  hits.length = 0; const db3 = fakeDb();
  await N.runRefresh(db3, "m0", true, { config: { ...cfg, members: cfg.members.concat([{ id: "m2", name: "newguy" }]) }, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } }, sleeper: { updatedAt: N.isoNow(), leagueId: "L1", byId: w[2].byId, league: w[2].league } });
  assert.equal(db3.writes.some((x) => x[1] === "league/sleeper"), true);
  assert.equal(hits.some((h) => /leagues\/nfl/.test(h)), false, "league id was cached");
});

test("runRefresh honours the hourly rule, then writes stats, games and the refresh stamp", async () => {
  const db = fakeDb();
  assert.equal((await N.runRefresh(db, "m1", false, { config, refresh: { finishedAt: N.isoNow() } })).note, "recent");
  const T = fx("totals-2025.json");
  globalThis.fetch = async (u) => ({ ok: true, json: async () => (/state\/nfl/.test(u) ? { week: 1 } : /stats\/nfl\/regular\/2026\/1$/.test(u) ? { HOU: T.HOU } : /stats\/nfl\/regular\/2026$/.test(u) ? T : fx("scores-w1.json")), text: async () => "" });
  const bets = [{ id: "b1", stats: { stat: "sack", rows: [{ key: "HOU", entry: 0 }] } }, { id: "b2" }];
  const r = await N.runRefresh(db, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster: { updatedAt: N.isoNow() }, holder: "m1", mobile: true, standings: { bySeason: { "2026": { at: N.isoNow() } } } });
  assert.equal(r.ok, true); assert.equal(r.bets, 1); assert.equal(r.through, "Through week 1");
  const paths = db.writes.map((w) => w[0] + " " + w[1]);
  assert.equal(paths.includes("update bets/b1"), true); assert.equal(paths.includes("update bets/b2"), false);
  assert.equal(paths.includes("set league/games"), true); assert.equal(paths.includes("set league/roster"), false, "roster is fresh (and this is a phone)");
  assert.equal(paths.includes("update league/config"), false, "schedule is fresh");
  const stamp = db.writes[db.writes.length - 1]; assert.equal(stamp[1], "league/refresh"); assert.equal(stamp[2].status, "done"); assert.equal(stamp[2].by, "m1");
  const b1 = db.writes.find((w) => w[1] === "bets/b1")[2].stats; assert.equal(b1.rows[0].value, T.HOU.sack);
});

test("next season's league is found by the link back, not by guessing", async () => {
  const leagues = [
    { league_id: "other", name: "Work League", previous_league_id: "zzz" },
    { league_id: "L2027", name: "Smyrna League", previous_league_id: "L2026" },
  ];
  assert.equal(N.nextLeagueFrom(leagues, "L2026").league_id, "L2027", "the one that points at ours");
  assert.equal(N.nextLeagueFrom(leagues, "nope"), null, "and nothing when none does");
  assert.equal(N.nextLeagueFrom(null, "L2026"), null);

  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /league\/L2026\/users$/.test(u) ? [{ user_id: "u1", display_name: "hobnailboot" }]
      : /user\/u1\/leagues\/nfl\/2027$/.test(u) ? leagues : [];
    return { ok: true, json: async () => j };
  };
  const found = await N.findNextLeague("L2026", "2027");
  assert.equal(found.league_id, "L2027");
  assert.deepEqual(hits, ["league/L2026/users", "user/u1/leagues/nfl/2027"], "two calls, no guessing");

  // a league nobody is in, or a season that does not exist yet, answers null rather than throwing
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  assert.equal(await N.findNextLeague("L2026", "2027"), null);
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await N.findNextLeague("L2026", "2027"), null, "and offline is not a crash");
});

test("draftRows: a traded pick credits who got the player, and says where it came from", () => {
  const picks = [
    { round: 1, pick_no: 1, draft_slot: 1, roster_id: 1, is_keeper: null,
      metadata: { first_name: "Jahmyr", last_name: "Gibbs", position: "RB", team: "DET" } },
    { round: 4, pick_no: 40, draft_slot: 1, roster_id: 8, is_keeper: null,
      metadata: { first_name: "Bo", last_name: "Nix", position: "QB", team: "DEN" } },
    { round: 5, pick_no: 47, draft_slot: 7, roster_id: 7, is_keeper: true,
      metadata: { first_name: "Rashee", last_name: "Rice", position: "WR", team: "KC" } },
  ];
  const traded = [{ round: 4, roster_id: 1, owner_id: 8, previous_owner_id: 1 }];
  const rows = N.draftRows(picks, traded);
  assert.deepEqual(rows.map((r) => [r.p, r.roster, r.from, r.name]), [
    [1, 1, null, "Jahmyr Gibbs"],
    [40, 8, 1, "Bo Nix"],
    [47, 7, null, "Rashee Rice"]], "only the traded one carries a from, and it is the slot's owner");
  assert.equal(rows[2].keeper, true, "keepers are flagged where Sleeper flags them");
  assert.deepEqual(N.draftRows([{ round: 1, pick_no: 1, roster_id: 1, player_id: "9509", metadata: {} }], [])[0].pid, "9509", "each pick keeps its player id");
  assert.equal(rows[0].keeper, false, "and absence is not a keeper — Sleeper sends null, not false");
  assert.deepEqual(N.draftRows(null, null), [], "no draft is not a crash");
});

test("draftRows sorts into pick order whatever order Sleeper sends", () => {
  const out = N.draftRows([
    { round: 2, pick_no: 15, roster_id: 2, metadata: {} },
    { round: 1, pick_no: 3, roster_id: 3, metadata: {} },
    { round: 1, pick_no: 1, roster_id: 1, metadata: {} }], []);
  assert.deepEqual(out.map((r) => r.p), [1, 3, 15]);
});

test("a draft record written before the keeper fields existed is refetched, not trusted", async () => {
  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /state\/nfl/.test(u) ? { week: 1 }
      : /league\/L1\/drafts$/.test(u) ? [{ draft_id: "D1", season: "2026", type: "snake", settings: { rounds: 16 } }]
      : /draft\/D1\/picks$/.test(u) ? [{ round: 4, pick_no: 40, draft_slot: 2, roster_id: 1, player_id: "p9",
          metadata: { first_name: "Bo", last_name: "Nix", position: "QB", team: "DEN" } }]
      : /draft\/D1\/traded_picks$/.test(u) ? []
      : /league\/L1\/rosters$/.test(u) ? [{ roster_id: 1, owner_id: "u1", players: ["p9"], starters: ["p9"] }]
      : /league\/L1\/users$/.test(u) ? [{ user_id: "u1", display_name: "hobnailboot" }]
      : /stats\/nfl\/regular\/2026/.test(u) ? {} : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const cfg = { ...config, sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow(), members: [{ id: "m0", name: "hobnailboot" }] };
  const base = { config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true };

  // the old shape: picks and nothing to price a keeper with
  const stale = { bySeason: { 2026: { draftId: "D1", picks: [{ r: 4, p: 40, roster: 1, name: "Bo Nix" }], byRoster: { 1: "hobnailboot" } } } };
  const db = fakeDb();
  await N.runRefresh(db, "m0", true, { ...base, draft: stale });
  const w = db.writes.find((x) => x[1] === "league/draft");
  assert.ok(w, "an incomplete record is refetched rather than left in place");
  const rec = w[2].bySeason["2026"];
  assert.deepEqual(rec.byPlayer, { p9: { r: 4, keeper: false } }, "so a drafted player can be priced");
  assert.deepEqual(rec.rosters, { 1: ["p9"] });
  assert.deepEqual(rec.keptPrev, {}, "no previous league here, but the field is present");

  // and once it is whole, it is left alone
  hits.length = 0; const db2 = fakeDb();
  await N.runRefresh(db2, "m0", true, { ...base, draft: { bySeason: { 2026: rec } } });
  assert.equal(hits.some((h) => /drafts|draft\//.test(h)), false, "a complete draft is never fetched twice");
  assert.equal(db2.writes.some((x) => x[1] === "league/draft"), false);
});

test("playersTick: season points, projections for finished weeks fetched once, ranks; quiet when nothing moved", async () => {
  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /projections\/nfl\/regular\/2026\/1$/.test(u) ? { a: { pts_ppr: 15 }, b: { pts_ppr: 10 } }
      : /projections\/nfl\/regular\/2026\/2$/.test(u) ? { a: { pts_ppr: 15 }, b: { pts_ppr: 10 } } : {};
    return { ok: true, json: async () => j };
  };
  const ctx = { config, roster: { players: [["a", "A", "RB", "DET"], ["b", "B", "RB", "NYJ"]] },
    games: { games: [{ week: 1, status: "final" }, { week: 2, status: "final" }, { week: 3, status: "live" }] },
    sleeper: { league: { scoring: "PPR" } } };
  const byWeek = { 1: { a: { pts_ppr: 20 } , b: { pts_ppr: 8 } }, 2: { a: { pts_ppr: 18 }, b: { pts_ppr: 6 } }, 3: { a: { pts_ppr: 30 } } };
  const db = fakeDb();
  await N.playersTick(db, ctx, byWeek, "2026");
  assert.deepEqual(hits, ["projections/nfl/regular/2026/1", "projections/nfl/regular/2026/2"], "the finished weeks only - week 3 is still being played");
  const rec = db.writes[0][2].bySeason["2026"];
  assert.equal(rec.through, 2); assert.equal(rec.field, "pts_ppr");
  assert.deepEqual(JSON.parse(rec.rows), { a: [38, 30, "RB1"], b: [14, 20, "RB2"] });

  hits.length = 0; const db2 = fakeDb();
  await N.playersTick(db2, { ...ctx, players: { bySeason: { 2026: rec } } }, byWeek, "2026");
  assert.deepEqual(hits, [], "a kept week's projection isn't fetched again");
  assert.equal(db2.writes.length, 0, "and nothing moved, so nothing is written");

  const db3 = fakeDb();
  await N.playersTick(db3, { ...ctx, players: { bySeason: { 2026: rec } } }, { ...byWeek, 2: { a: { pts_ppr: 19 }, b: { pts_ppr: 6 } } }, "2026");
  assert.deepEqual(JSON.parse(db3.writes[0][2].bySeason["2026"].rows).a, [39, 30, "RB1"], "a stat correction is picked up");

  const db4 = fakeDb();
  await N.playersTick(db4, ctx, { 1: byWeek[1] }, "2026");
  assert.equal(db4.writes.length, 0, "a finished week without stats waits for the next hour");
});

test("statsTick: bets re-score while games are live, and stay quiet when they aren't", async () => {
  const stats = { rows: [{ key: "1", values: {}, value: 0 }], stat: "pts_ppr", tracks: [{ stat: "pts_ppr" }],
    through: "Through week 1", updatedAt: new Date(Date.now() - 10 * 60000).toISOString() };
  const bet = { id: "b1", stats };
  const live = { games: [{ week: 1, status: "live", date: N.isoNow() }] };
  const done = { games: [{ week: 1, status: "final", date: N.isoNow() }] };
  const base = { config, holder: "m0", bets: [bet] };

  // only week 1 has anything in it, whatever week the real clock is on
  let calls = 0;
  globalThis.fetch = async (u) => { calls++; return { ok: true, json: async () => (/regular\/2026\/1$/.test(u) ? { 1: { pts_ppr: 21.5 } } : {}) }; };

  // no live game: the hourly pass is enough
  let db = fakeDb();
  await N.statsTick(db, { ...base, games: done });
  assert.equal(calls, 0, "nothing is fetched when nothing is being played");
  assert.equal(db.writes.length, 0);

  // live, and the numbers are stale
  db = fakeDb();
  await N.statsTick(db, { ...base, games: live });
  assert.equal(calls, Clock.currentWeek(config, live), "one call per week played so far (the real clock's week)");
  const w = db.writes.find((x) => x[1] === "bets/b1");
  assert.ok(w, "and the bet is re-scored");
  assert.equal(w[2].stats.rows[0].value, 21.5);
  assert.equal(w[2].stats.through, "Through week 1", "the week it is through does not churn — only the numbers move");

  // live but just done: left alone, or every open page would pull 150KB a minute
  calls = 0; db = fakeDb();
  const fresh = { ...bet, stats: { ...stats, updatedAt: N.isoNow() } };
  await N.statsTick(db, { ...base, games: live, bets: [fresh] });
  assert.equal(calls, 0, "inside the window, nothing happens");
  assert.equal(db.writes.length, 0);

  // a book with no stat bets never asks
  calls = 0; db = fakeDb();
  await N.statsTick(db, { ...base, games: live, bets: [{ id: "g1", game: { id: "x" } }] });
  assert.equal(calls, 0, "a game bet tracks no stat, so there is nothing to re-score");
});

test("sumWeeks: season totals are added up from the weeks, not taken on trust", () => {
  const w1 = { p1: { pts_ppr: 12.5, rec_yd: 80, rec: 5 }, p2: { pts_ppr: 3 } };
  const w2 = { p1: { pts_ppr: 8.5, rec_yd: 40, rec: 3 }, p3: { pts_ppr: 20 } };
  assert.deepEqual(N.sumWeeks([w1, w2]), {
    p1: { pts_ppr: 21, rec_yd: 120, rec: 8 },
    p2: { pts_ppr: 3 },
    p3: { pts_ppr: 20 } }, "every player, every stat, across the weeks given");
  assert.deepEqual(N.sumWeeks([w1]), w1, "one week is that week");
  assert.deepEqual(N.sumWeeks([]), {}, "and no weeks is nothing, not a crash");
  assert.deepEqual(N.sumWeeks(null), {});
  assert.deepEqual(N.sumWeeks([{ p1: null }, { p1: { pts_ppr: 4 } }]), { p1: { pts_ppr: 4 } },
    "a missing week for a player is skipped, not counted as zero-and-broken");
  assert.deepEqual(N.sumWeeks([{ p1: { pts_ppr: 4, team: "SF" } }]), { p1: { pts_ppr: 4 } },
    "text fields are left out — a team name is not a quantity to add up");
});

test("runRefresh scores bets from the weeks it already fetched, never the season aggregate", async () => {
  const hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /state\/nfl/.test(u) ? { week: 2 }
      : /stats\/nfl\/regular\/2026\/1$/.test(u) ? { "9": { pts_ppr: 10, rec_yd: 60 } }
      : /stats\/nfl\/regular\/2026\/2$/.test(u) ? { "9": { pts_ppr: 15, rec_yd: 90 } }
      : /stats\/nfl\/regular\/2026$/.test(u) ? { "9": { pts_ppr: 999 } }   // the broken one; must be ignored
      : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const bet = { id: "b1", stats: { rows: [{ key: "9", values: {}, value: 0 }], stat: "pts_ppr",
    tracks: [{ stat: "pts_ppr" }, { stat: "rec_yd" }] } };
  const db = fakeDb();
  await N.runRefresh(db, "m0", true, { config: { ...config, sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow() },
    refresh: {}, bets: [bet], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true });
  const w = db.writes.find((x) => x[1] === "bets/b1");
  assert.ok(w, "the bet was re-scored");
  assert.equal(w[2].stats.rows[0].value, 25, "10 + 15 from the two weeks, not the 999 the aggregate claimed");
  assert.equal(w[2].stats.rows[0].values.rec_yd, 150);
  assert.equal(w[2].stats.through, "Through week 2");
  assert.equal(hits.some((h) => /^stats\/nfl\/regular\/2026$/.test(h)), false,
    "and the season endpoint is never asked - it disagreed with its own weeks");
});

test("a weekly bet is scored on its own week; a season bet on the running total", () => {
  const byWeek = { 1: { p: { pts_ppr: 10 } }, 2: { p: { pts_ppr: 15 } }, 3: { p: { pts_ppr: 4 } } };
  const toDate = N.sumWeeks([byWeek[1], byWeek[2], byWeek[3]]);
  assert.deepEqual(N.totalsFor(byWeek, toDate, 2), { p: { pts_ppr: 15 } }, "week 2 means week 2");
  assert.deepEqual(N.totalsFor(byWeek, toDate, 0), { p: { pts_ppr: 29 } }, "season means everything so far");
  assert.deepEqual(N.totalsFor(byWeek, toDate, 9), {}, "a week not played yet is nothing, not the season");
  assert.deepEqual(N.totalsFor(null, toDate, 0), { p: { pts_ppr: 29 } });

  assert.equal(N.throughFor(3, 5), "Week 3", "and a weekly bet does not claim to be the season");
  assert.equal(N.throughFor(0, 5), "Through week 5");
  assert.equal(N.throughFor(0, 0), "No games played yet");
});

test("runRefresh: week 2's bet reads week 2, the season bet reads both weeks", async () => {
  globalThis.fetch = async (u) => {
    const j = /state\/nfl/.test(u) ? { week: 2, season: "2026", season_type: "regular" }
      : /stats\/nfl\/regular\/2026\/1$/.test(u) ? { "9": { pts_ppr: 10 } }
      : /stats\/nfl\/regular\/2026\/2$/.test(u) ? { "9": { pts_ppr: 15 } }
      : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const mk = (id, week) => ({ id, week, stats: { rows: [{ key: "9", values: {}, value: 0 }],
    stat: "pts_ppr", tracks: [{ stat: "pts_ppr" }] } });
  const db = fakeDb();
  await N.runRefresh(db, "m0", true, { config: { ...config, sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow() },
    refresh: {}, bets: [mk("wk2", 2), mk("season", 0), mk("wk1", 1)],
    roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true });
  const val = (id) => db.writes.find((x) => x[1] === "bets/" + id)[2].stats;
  assert.equal(val("wk2").rows[0].value, 15, "week 2's bet is week 2 alone");
  assert.equal(val("wk2").through, "Week 2");
  assert.equal(val("wk1").rows[0].value, 10, "and week 1's is week 1, not everything since");
  assert.equal(val("season").rows[0].value, 25, "the season bet keeps adding up");
  assert.equal(val("season").through, "Through week 2");
});

test("once the season is over the totals stop shrinking with the NFL's clock", async () => {
  const asked = [];
  globalThis.fetch = async (u) => {
    asked.push(u);
    // February: Sleeper's state has rolled to next season, week 1
    const j = /state\/nfl/.test(u) ? { week: 1, season: "2027", season_type: "pre" }
      : /stats\/nfl\/regular\/2026\/(\d+)$/.test(u) ? { "9": { pts_ppr: 5 } }
      : [];
    return { ok: true, json: async () => j, text: async () => "" };
  };
  const db = fakeDb();
  await N.runRefresh(db, "m0", true, { config: { ...config, season: "2026", sleeperLeagueId: "L1", scheduleUpdatedAt: N.isoNow() },
    refresh: {}, bets: [{ id: "s", week: 0, stats: { rows: [{ key: "9", values: {}, value: 0 }], stat: "pts_ppr", tracks: [{ stat: "pts_ppr" }] } }],
    roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true });
  const w = db.writes.find((x) => x[1] === "bets/s");
  assert.equal(w[2].stats.rows[0].value, 90, "all eighteen weeks, not the one the new season is on");
  assert.equal(asked.filter((u) => /stats\/nfl\/regular\/2026\/\d+$/.test(u)).length, 18);
});

test("offenseWeek: a team's offense from its game score, the opponent's yards allowed, and its own players' rows", () => {
  // CIN 33 @ TB 27, week 1 2026, checked against ESPN: CIN 351 yds, 245 net passing, 106 rushing, 1 turnover
  const games = [{ id: "g", week: 1, away: "CIN", home: "TB", status: "final", awayScore: 33, homeScore: 27 },
                 { id: "h", week: 1, away: "KC", home: "DEN", status: "pre" }];
  const defense = { TB: { yds_allow: 351 }, CIN: { yds_allow: 282 } };
  const rows = [
    { team: "CIN", stats: { pass_yd: 254, pass_sack_yds: 9, pass_int: 1 } },
    { team: "CIN", stats: { rush_yd: 80 } }, { team: "CIN", stats: { rush_yd: 26, fum_lost: 0 } },
    { team: "TB", stats: { pass_yd: 216, pass_sack_yds: 23, rush_yd: 20 } }, { team: "TB", stats: { rush_yd: 69, fum_lost: 4 } },
    { team: "KC", stats: { rush_yd: 99 } } ];
  const w = N.offenseWeek(games, defense, rows);
  assert.deepEqual(w.teams.CIN, { off_pts: 33, off_yd: 351, off_pass_yd: 245, off_rush_yd: 106, off_to: 1 });
  assert.deepEqual(w.teams.TB, { off_pts: 27, off_yd: 282, off_pass_yd: 193, off_rush_yd: 89, off_to: 4 });
  assert.equal("KC" in w.teams, false, "a game that hasn't started has no offense yet");
  assert.equal(w.final, false, "and the week isn't final while it's still to play");
  assert.equal(N.offenseWeek([games[0]], defense, rows).final, true);
});

test("withOffense + restat: an offense bet is scored on the week, and a season bet on the running total", () => {
  const byWeek = { 1: { CIN: { yds_allow: 282, sack: 4 }, "1234": { pass_yd: 254 } }, 2: { CIN: { sack: 1 } } };
  const off = { 1: { teams: { CIN: { off_pts: 33, off_yd: 351 } }, final: true }, 2: { teams: { CIN: { off_pts: 17, off_yd: 300 } }, final: false } };
  const merged = N.withOffense(byWeek, off);
  assert.deepEqual(merged[1].CIN, { yds_allow: 282, sack: 4, off_pts: 33, off_yd: 351 }, "the defense fields stay; the offense lays on top");
  assert.equal(byWeek[1].CIN.off_pts, undefined, "the feeds themselves aren't changed");
  const S = { scope: "offense", stat: "off_pts", tracks: [{ stat: "off_pts" }, { stat: "off_yd" }], rows: [{ key: "CIN", entry: 0 }] };
  const season = N.sumWeeks([merged[1], merged[2]]);
  assert.deepEqual(N.restat(S, N.totalsFor(merged, season, 1), "Week 1", "t").rows[0].values, { off_pts: 33, off_yd: 351 });
  assert.deepEqual(N.restat(S, N.totalsFor(merged, season, 0), "Through week 2", "t").rows[0].values, { off_pts: 50, off_yd: 651 });
});

test("offenseFor: a final week comes from the book; an unfinished one from the feeds, and is written back", async () => {
  const writes = [], stored = { bySeason: { "2026": { 1: { final: true, teams: { CIN: { off_pts: 33 } } } } } };
  const db = { doc: (p) => ({ get: async () => ({ exists: true, data: () => stored }), set: async (d) => { writes.push([p, d]); } }) };
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, json: async () => (/scores/.test(u)
    ? [{ game_id: "x", week: 2, status: "in_game", metadata: { date_time: "2026-09-20T17:00:00+00:00", away_team: "CIN", home_team: "HOU", away_score: 7, home_score: 3, is_in_progress: true } }]
    : [{ team: "CIN", stats: { rush_yd: 40 } }]) }; };
  const got = await N.offenseFor(db, "2026", { 1: {}, 2: { HOU: { yds_allow: 120 } } });
  assert.deepEqual(got[1], stored.bySeason["2026"][1], "week 1 is final in the book: no fetch for it");
  assert.equal(urls.some((u) => /\/1(\?|$)/.test(u)), false);
  assert.deepEqual(got[2].teams.CIN, { off_pts: 7, off_yd: 120, off_pass_yd: 0, off_rush_yd: 40, off_to: 0 });
  assert.equal(got[2].final, false);
  assert.equal(writes.length, 1); assert.equal(writes[0][0], "league/offense");
  assert.deepEqual(Object.keys(writes[0][1].bySeason["2026"]).sort(), ["1", "2"], "week 1 kept, week 2 added");
  assert.equal(N.needsOffense([{ status: "active", stats: { scope: "offense" } }]), true);
  assert.equal(N.needsOffense([{ status: "settled", stats: { scope: "offense" } }, { status: "active", stats: { scope: "player" } }]), false, "nothing is fetched unless a live or open bet needs it");
});

test("standings: every team's record in standing order, owners mapped to managers by name", () => {
  const rosters = [
    { roster_id: 1, owner_id: "u1", settings: { wins: 2, losses: 1, ties: 0, fpts: 350, fpts_decimal: 42, fpts_against: 300, fpts_against_decimal: 5 } },
    { roster_id: 2, owner_id: "u2", settings: { wins: 3, losses: 0, ties: 0, fpts: 380, fpts_decimal: 0, fpts_against: 290 } },
    { roster_id: 3, owner_id: "u3", settings: { wins: 2, losses: 1, ties: 0, fpts: 360, fpts_decimal: 10, fpts_against: 310 } },
    { roster_id: 4, owner_id: "u4", settings: { wins: 0, losses: 3, fpts: 200 } } ];
  const users = [{ user_id: "u1", display_name: "JPorch" }, { user_id: "u2", display_name: "hobnailboot" }, { user_id: "u3", display_name: "RTownsend" }, { user_id: "u4", display_name: "ghost" }];
  const rows = N.standingsRows(rosters, users, { jporch: "m1", hobnailboot: "m0", rtownsend: "m2" });
  assert.deepEqual(rows.map((r) => [r.rid, r.id, r.name, r.w, r.l, r.pf]), [
    [2, "m0", "hobnailboot", 3, 0, 380], [3, "m2", "RTownsend", 2, 1, 360.1], [1, "m1", "JPorch", 2, 1, 350.42], [4, null, "ghost", 0, 3, 200]],
    "wins, then losses, then points for; the decimals are Sleeper's hundredths; a name the book lacks has no id");
  assert.equal(rows[2].pa, 300.05);
  assert.deepEqual(N.standingsRows([], users, {}), []);
});

test("bracketField: the seeded roster ids and nothing else - empty until Sleeper seeds it", () => {
  assert.deepEqual(N.bracketField([]), []);
  assert.deepEqual(N.bracketField(null), []);
  // round 1: 4 v 5 and 3 v 6; round 2: seeds 1 and 2 off their byes against the winners; a final
  const seeded = [
    { r: 1, m: 1, t1: 4, t2: 5 }, { r: 1, m: 2, t1: 3, t2: 6 },
    { r: 2, m: 3, t1: 1, t2: { w: 1 } }, { r: 2, m: 4, t1: 2, t2: { w: 2 } },
    { r: 3, m: 5, t1: { w: 3 }, t2: { w: 4 }, p: 1 } ];
  assert.deepEqual(N.bracketField(seeded), [1, 2, 3, 4, 5, 6], "the byes count: they are numbers in a later round");
  assert.deepEqual(N.bracketField([{ r: 1, m: 1, t1: null, t2: null }, { r: 2, m: 2, t1: { w: 1 }, t2: null }]), [], "a bracket with nobody in it yet");
  // once it is played, winners and losers are filled in but the field is the same six
  assert.deepEqual(N.bracketField(seeded.map((m) => ({ ...m, w: 4, l: 5 }))), [1, 2, 3, 4, 5, 6]);
});

test("standingsTick: the table and the field hourly, written only when something moved", async () => {
  const members = [{ id: "m0", name: "hobnailboot" }, { id: "m1", name: "JPorch" }, { id: "m2", name: "RTownsend" }];
  const cfg = { ...config, sleeperLeagueId: "L1", members };
  const rosters = [
    { roster_id: 1, owner_id: "u1", settings: { wins: 2, losses: 1, fpts: 350 } },
    { roster_id: 2, owner_id: "u2", settings: { wins: 3, losses: 0, fpts: 380 } },
    { roster_id: 3, owner_id: "u3", settings: { wins: 1, losses: 2, fpts: 300 } } ];
  const users = [{ user_id: "u1", display_name: "JPorch" }, { user_id: "u2", display_name: "hobnailboot" }, { user_id: "u3", display_name: "RTownsend" }];
  let bracket = [], hits = [];
  globalThis.fetch = async (u) => {
    hits.push(u.replace(/^.*\/v1\//, ""));
    const j = /rosters$/.test(u) ? rosters : /users$/.test(u) ? users : /winners_bracket$/.test(u) ? bracket
      : /matchups\/\d+$/.test(u) ? [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }, { roster_id: 3, matchup_id: 2 }] : [];
    return { ok: true, json: async () => j };
  };
  // before the daily league read has said how many make it: six, and the table still lands
  let db = fakeDb();
  await N.standingsTick(db, { config: cfg, holder: "m0" });
  assert.equal(db.writes[0][2].bySeason["2026"].teams, 6, "six spots until the league says otherwise");
  // the rest of the regular season's pairings come along, fetched once, as member ids
  const liveW = Clock.currentWeek(cfg), weeksLeft = Array.from({ length: 14 - liveW + 1 }, (_, i) => String(liveW + i));
  const pr = db.writes[0][2].bySeason["2026"].pairings;
  assert.deepEqual(Object.keys(pr).sort((a, b) => a - b), weeksLeft, "every week from the one being played to week 14");
  assert.deepEqual(pr[String(liveW)], [{ a: "m1", b: "m0" }], "roster 3 has nobody to pair with; the pair is JPorch and hobnailboot");
  assert.equal(hits.filter((h) => /matchups/.test(h)).length, weeksLeft.length);
  // the league settings come from league/sleeper, never a second league read
  const sleeper = { league: { playoffTeams: 2, playoffStart: 15 } };
  hits = []; db = fakeDb();
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper });
  assert.deepEqual(hits.filter((h) => !/matchups/.test(h)).sort(), ["league/L1/rosters", "league/L1/users", "league/L1/winners_bracket"], "three calls, plus the schedule");
  const w = db.writes.find((x) => x[1] === "league/standings");
  assert.ok(w, "written");
  const rec = w[2].bySeason["2026"];
  assert.deepEqual([rec.teams, rec.playoffStart, rec.leagueId], [2, 15, "L1"]);
  assert.deepEqual(rec.rows.map((r) => [r.rid, r.id, r.w, r.l]), [[2, "m0", 3, 0], [1, "m1", 2, 1], [3, "m2", 1, 2]]);
  assert.deepEqual(rec.playoffs, { rids: [], field: [], seeded: false, complete: false, champion: null }, "nobody seeded yet");
  assert.deepEqual([rec.seedType, rec.over], [0, false], "Sleeper's default seeding; the regular season is on");
  assert.ok(rec.at, "stamped");
  // an hour on, nothing moved: no write (a write would come back as a snapshot and loop)
  hits = []; db = fakeDb();
  const stale = { ...rec, at: new Date(Date.now() - 61 * 60000).toISOString() };
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, standings: { bySeason: { "2026": stale } } });
  assert.equal(hits.length, 3, "it looked, and the schedule it already had was not fetched again");
  assert.equal(db.writes.length, 0, "and left the book alone");
  // fresh: it doesn't even look
  hits = []; db = fakeDb();
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, standings: { bySeason: { "2026": rec } } });
  assert.deepEqual(hits, []);
  // Sleeper seeds the bracket from the live table mid-season: the field lands as member ids,
  // seeded but not complete while week 14 is still to be played
  bracket = [{ r: 1, m: 1, t1: 2, t2: 1 }];
  db = fakeDb();
  const midSeason = { games: [{ id: "a", week: 14, status: "live", date: "2026-12-14T00:00:00Z" }] };
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, games: midSeason, standings: { bySeason: { "2026": stale, "2025": { at: "old", rows: [] } } } });
  const w2 = db.writes.find((x) => x[1] === "league/standings");
  assert.deepEqual(w2[2].bySeason["2026"].playoffs, { rids: [1, 2], field: ["m1", "m0"], seeded: true, complete: false, champion: null }, "two spots, two seeds, as it stands");
  assert.deepEqual(w2[2].bySeason["2025"], { at: "old", rows: [] }, "other seasons are left exactly as they were");
  // the regular season ends in the book's own schedule: the same seeding is now the result
  db = fakeDb();
  const over = { games: [{ id: "a", week: 14, status: "final", date: "2026-12-14T00:00:00Z" }] };
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, games: over, standings: { bySeason: { "2026": { ...stale, playoffs: w2[2].bySeason["2026"].playoffs } } } });
  assert.deepEqual(db.writes[0][2].bySeason["2026"].playoffs, { rids: [1, 2], field: ["m1", "m0"], seeded: true, complete: true, champion: null }, "complete once week 14 is final");
  assert.equal(db.writes[0][2].bySeason["2026"].over, true);
  // the final is played: its winner is the champion
  bracket = [{ r: 1, m: 1, t1: 2, t2: 1, w: 1, l: 2, p: 1 }];
  db = fakeDb();
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, games: over, standings: { bySeason: { "2026": { ...stale, over: true, playoffs: { rids: [1, 2], field: ["m1", "m0"], seeded: true, complete: true, champion: null } } } } });
  assert.equal(db.writes[0][2].bySeason["2026"].playoffs.champion, "m1", "JPorch, roster 1");
  // a bracket the feed can't give (a league before the playoffs are set up) is just no field
  globalThis.fetch = async (u) => { if (/winners_bracket$/.test(u)) return { ok: false, status: 404 }; return { ok: true, json: async () => (/rosters$/.test(u) ? rosters : users) }; };
  db = fakeDb();
  await N.standingsTick(db, { config: cfg, holder: "m0", sleeper, standings: { bySeason: { "2026": { ...stale, playoffs: { rids: [1, 2], field: ["m1", "m0"], seeded: true, complete: true } } } } });
  assert.deepEqual(db.writes[0][2].bySeason["2026"].playoffs, { rids: [], field: [], seeded: false, complete: false, champion: null });
});
