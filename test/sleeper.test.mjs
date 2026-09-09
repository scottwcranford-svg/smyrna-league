// sleeper.js against saved Sleeper responses (test/fixtures): the scores feed → game
// rows, the player index → roster rows, season totals → re-scored bet stats, and
// the refresh loop's freshness rules with a fake book.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as R from "../rules.js";

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
  assert.deepEqual(R.statusOf("q+o", { players: rows }), ["Q", "OUT"], "a combined pick lists each");
  assert.deepEqual(R.statusOf("ok", { players: rows }), []);
  assert.equal(R.statusCode({ status: "Inactive" }), "INA"); assert.equal(R.statusCode({ status: "Practice Squad" }), "PS");
  assert.equal(R.statusCode({ status: "Something New" }), "", "unknown roster statuses stay quiet");
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
  await N.runRefresh(db, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster, holder: "m1", mobile: true });
  assert.deepEqual(projUrls.map((u) => u.split("/").pop()).sort(), ["2026", "3", "4", "7"], "the season, this week, next, and the open week-7 bet; not the game bet's week");
  const w = db.writes.find((x) => x[1] === "league/proj");
  assert.ok(w, "projections written");
  assert.deepEqual(Object.keys(w[2].weeks).sort(), ["0", "3", "4", "7"], "the season rides as week 0");
  assert.deepEqual(JSON.parse(w[2].weeks["7"]), { "2": { rec_yd: 82.5, rec: 5.2 }, "3": { pass_yd: 241.3 } }, "trimmed to the roster, one decimal");
  // same data again: nothing to write
  const db2 = fakeDb();
  await N.runRefresh(db2, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster, holder: "m1", mobile: true, proj: w[2] });
  assert.equal(db2.writes.some((x) => x[1] === "league/proj"), false, "unchanged projections are not rewritten");
});

test("runRefresh: Sleeper avatars by username, daily or when a manager is new", async () => {
  const db = fakeDb();
  const users = [];
  globalThis.fetch = async (u) => {
    const m = /\/v1\/user\/([^/?]+)$/.exec(u); if (m) users.push(decodeURIComponent(m[1]));
    return { ok: true, json: async () => (/state\/nfl/.test(u) ? { week: 1 } : m ? (m[1] === "hobnailboot" ? { username: "hobnailboot", avatar: "6dcbee5f" } : null) : /stats\/nfl\/regular\/2026/.test(u) ? {} : []), text: async () => "" };
  };
  const cfg = { ...config, scheduleUpdatedAt: N.isoNow(), members: [{ id: "m0", name: "hobnailboot" }, { id: "m1", name: "testbot" }] };
  await N.runRefresh(db, "m0", true, { config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true });
  assert.deepEqual(users.sort(), ["hobnailboot", "testbot"], "one lookup per manager");
  const w = db.writes.find((x) => x[1] === "league/avatars");
  assert.deepEqual(w[2].byId, { m0: "6dcbee5f", m1: "" }, "unknown names keep their initials");
  // all known and fresh: no lookups
  users.length = 0; const db2 = fakeDb();
  await N.runRefresh(db2, "m0", true, { config: cfg, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, avatars: { updatedAt: N.isoNow(), byId: { m0: "6dcbee5f", m1: "" } } });
  assert.equal(users.length, 0); assert.equal(db2.writes.some((x) => x[1] === "league/avatars"), false);
  // a new manager on the roster: look everyone up again
  const db3 = fakeDb();
  await N.runRefresh(db3, "m0", true, { config: { ...cfg, members: cfg.members.concat([{ id: "m2", name: "newguy" }]) }, refresh: {}, bets: [], roster: { updatedAt: N.isoNow() }, holder: "m0", mobile: true, avatars: { updatedAt: N.isoNow(), byId: { m0: "6dcbee5f", m1: "" } } });
  assert.equal(db3.writes.some((x) => x[1] === "league/avatars"), true);
});

test("runRefresh honours the hourly rule, then writes stats, games and the refresh stamp", async () => {
  const db = fakeDb();
  assert.equal((await N.runRefresh(db, "m1", false, { config, refresh: { finishedAt: N.isoNow() } })).note, "recent");
  const T = fx("totals-2025.json");
  globalThis.fetch = async (u) => ({ ok: true, json: async () => (/state\/nfl/.test(u) ? { week: 1 } : /stats\/nfl\/regular\/2026\/1$/.test(u) ? { HOU: T.HOU } : /stats\/nfl\/regular\/2026$/.test(u) ? T : fx("scores-w1.json")), text: async () => "" });
  const bets = [{ id: "b1", stats: { stat: "sack", rows: [{ key: "HOU", entry: 0 }] } }, { id: "b2" }];
  const r = await N.runRefresh(db, "m1", true, { config: { ...config, scheduleUpdatedAt: N.isoNow() }, refresh: {}, bets, roster: { updatedAt: N.isoNow() }, holder: "m1", mobile: true });
  assert.equal(r.ok, true); assert.equal(r.bets, 1); assert.equal(r.through, "Through week 1");
  const paths = db.writes.map((w) => w[0] + " " + w[1]);
  assert.equal(paths.includes("update bets/b1"), true); assert.equal(paths.includes("update bets/b2"), false);
  assert.equal(paths.includes("set league/games"), true); assert.equal(paths.includes("set league/roster"), false, "roster is fresh (and this is a phone)");
  assert.equal(paths.includes("update league/config"), false, "schedule is fresh");
  const stamp = db.writes[db.writes.length - 1]; assert.equal(stamp[1], "league/refresh"); assert.equal(stamp[2].status, "done"); assert.equal(stamp[2].by, "m1");
  const b1 = db.writes.find((w) => w[1] === "bets/b1")[2].stats; assert.equal(b1.rows[0].value, T.HOU.sack);
});
