// Smyrna Side Book — self-hosted server.
//
// One process, no dependencies: serves index.html, holds the shared book in
// data/book.json, pushes live updates to open pages over server-sent events,
// and pulls Sleeper on a timer (stats, rosters, schedule, live scores).
//
//   PORT        listen port                      (default 8899)
//   DATA_DIR    where book.json lives             (default ./data)
//   LEAGUE_KEY  passcode required on every /api call; unset = open
//   SEASON      NFL season                        (default 2026)

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8899);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LEAGUE_KEY = process.env.LEAGUE_KEY || "";
const SEASON = String(process.env.SEASON || "2026");
const BOOK_FILE = path.join(DATA_DIR, "book.json");
const INDEX = path.join(__dirname, "index.html");
const API = "https://api.sleeper.app";
const UA = "smyrna-side-book/1.0 (+self-hosted league ledger)";
const LAST_WEEK = 18;

/* ---------------- the book ---------------- */
let book = { league: {}, bets: {} };
try { book = JSON.parse(fs.readFileSync(BOOK_FILE, "utf8")); } catch (e) { /* first run */ }
book.league = book.league || {}; book.bets = book.bets || {};

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = BOOK_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(book));
    fs.renameSync(tmp, BOOK_FILE);
  }, 150);
}

const clients = new Set();
function broadcast(path, data) {
  const msg = `event: doc\ndata: ${JSON.stringify({ path, data })}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
function getDoc(col, id) { return col === "bets" ? book.bets[id] : book.league[id]; }
function setDoc(col, id, data) {
  if (col === "bets") book.bets[id] = data; else book.league[id] = data;
  save(); broadcast(`${col}/${id}`, data);
}
function delDoc(col, id) {
  if (col === "bets") delete book.bets[id]; else delete book.league[id];
  save(); broadcast(`${col}/${id}`, null);
}
function mergeDoc(col, id, patch) { setDoc(col, id, Object.assign({}, getDoc(col, id) || {}, patch)); }

// short leases so two phones tapping the same seat can't both win it
const leases = new Map();
function acquire(key, holder, ttl) {
  const now = Date.now(), cur = leases.get(key);
  if (cur && cur.until > now && cur.holder !== holder) return false;
  leases.set(key, { holder, until: now + Math.min(Math.max(ttl || 5000, 500), 30000) });
  return true;
}

/* ---------------- Sleeper ---------------- */
async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const COMPOSITES = { takeaways: ["int", "fum_rec"], td_scored: ["rush_td", "rec_td"] };
const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K"]);
let players = null, playersAt = 0;
async function loadPlayers() {
  if (players && Date.now() - playersAt < 24 * 3600e3) return players;
  players = await getJSON(`${API}/v1/players/nfl`); playersAt = Date.now();
  return players;
}
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

function valueFor(key, kind, totals) {
  let total = 0;
  const fields = COMPOSITES[kind] || [kind];
  for (const k of String(key).split("+")) {
    const row = totals[k.trim()] || {};
    for (const f of fields) total += Number(row[f] || 0);
  }
  return Math.round(total * 10) / 10;
}
function teamFor(key) {
  const codes = [];
  for (const k of String(key).split("+")) {
    const v = players[k.trim()] || {};
    if (v.position === "DEF") return null;
    codes.push(v.team || "FA");
  }
  return codes.length ? codes.join(" · ") : null;
}
async function throughWeek() {
  let last = 0;
  for (let w = 1; w <= LAST_WEEK; w++) {
    try { const d = await getJSON(`${API}/v1/stats/nfl/regular/${SEASON}/${w}`); if (d && Object.keys(d).length) last = w; else break; }
    catch (e) { break; }
  }
  return last;
}

// Eastern local -> UTC ms, respecting the November clock change
function etOffsetMin(t) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute);
  return Math.round((t - asUtc) / 60000);
}
function etToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number), [hh, mm] = timeStr.split(":").map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) t = Date.UTC(y, m - 1, d, hh, mm) + etOffsetMin(t) * 60000;
  return t;
}
function parseCsv(text) {
  const rows = [], lines = text.split(/\r?\n/).filter(Boolean);
  const head = splitCsv(lines[0]);
  for (let i = 1; i < lines.length; i++) { const c = splitCsv(lines[i]); const o = {}; head.forEach((h, j) => o[h] = c[j] ?? ""); rows.push(o); }
  return rows;
}
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
async function weekStarts() {
  const starts = {};
  try {
    const rows = parseCsv(await getText("https://github.com/nflverse/nfldata/raw/master/data/games.csv"));
    const first = {};
    for (const r of rows) {
      if (r.season !== SEASON || r.game_type !== "REG" || !r.gameday || !r.gametime) continue;
      const t = etToUtc(r.gameday, r.gametime), w = String(Number(r.week));
      if (!(w in first) || t < first[w]) first[w] = t;
    }
    for (const w in first) starts[w] = new Date(first[w]).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch (e) { console.warn("schedule:", e.message); }
  return starts;
}
async function gamesDoc(weeks) {
  const games = [];
  for (const w of weeks) {
    let feed = [];
    try { feed = await getJSON(`${API}/scores/nfl/regular/${SEASON}/${w}`); } catch (e) { continue; }
    for (const s of feed) {
      const m = s.metadata || {}; const iso = (m.date_time || "").replace("+00:00", "Z");
      if (!iso) continue;
      const g = { id: s.game_id, week: Number(s.week || w), away: m.away_team || s.away, home: m.home_team || s.home, date: iso.slice(0, 19) + "Z" };
      const over = !!m.is_over || s.status === "complete";
      const live = !over && (!!m.is_in_progress || !!m.has_started || s.status === "in_game");
      g.status = over ? "final" : live ? "live" : "pre";
      if (m.home_score != null && m.away_score != null) { g.awayScore = Number(m.away_score); g.homeScore = Number(m.home_score); }
      if (live || over) { const q = String(m.quarter_num ?? "").trim(); g.q = /^\d+$/.test(q) ? Number(q) : null; g.ql = m.quarter || ""; g.clock = m.time_remaining || ""; g.ot = !!m.is_overtime; }
      if (live) { g.pos = m.possession || ""; g.rz = !!m.red_zone; g.dd = m.down_and_distance || ""; }
      games.push(g);
    }
  }
  return games;
}
function currentWeek() {
  const ws = (book.league.config || {}).weekStarts || {}, now = Date.now();
  let w = 1;
  for (let i = 1; i <= LAST_WEEK; i++) { const t = Date.parse(ws[String(i)] || ""); if (!isNaN(t) && now >= t - 3600e3) w = i; }
  return w;
}

let refreshing = false, lastFull = 0;
async function fullRefresh(by) {
  if (refreshing) return { skipped: "busy" };
  refreshing = true;
  const now = nowIso();
  try {
    await loadPlayers();
    const week = await throughWeek();
    const totals = await getJSON(`${API}/v1/stats/nfl/regular/${SEASON}`).catch(() => ({}));
    const through = week ? `Through week ${week}` : "No games played yet";
    // bets
    let n = 0;
    for (const id of Object.keys(book.bets)) {
      const b = book.bets[id], S = b.stats;
      if (!S || !Array.isArray(S.rows)) continue;
      const kind = S.stat || "pts_ppr";
      const tracks = Array.isArray(S.tracks) && S.tracks.length ? S.tracks : [{ stat: kind }];
      const rows = S.rows.map(r => {
        const o = Object.assign({}, r);
        o.values = {}; for (const t of tracks) if (t.stat) o.values[t.stat] = valueFor(r.key, t.stat, totals);
        o.value = valueFor(r.key, kind, totals);
        const team = teamFor(r.key);
        if (team) { o.team = team; o.label = String(o.label || "").replace(/\s*\([A-Z]{2,3}\)/, "").trim(); }
        return o;
      });
      mergeDoc("bets", id, { stats: Object.assign({}, S, { rows, through, source: "Sleeper", updatedAt: now }) });
      n++;
    }
    // roster for the picker
    const roster = [];
    for (const [pid, v] of Object.entries(players)) {
      if (!v) continue;
      if (v.position === "DEF") roster.push([pid, `${v.first_name || ""} ${v.last_name || ""}`.trim(), "DEF", pid]);
      else if (v.team && (v.fantasy_positions || []).some(p => FANTASY_POS.has(p))) roster.push([pid, v.full_name || "", v.position || "", v.team]);
    }
    roster.sort((a, b) => (a[2] === "DEF") - (b[2] === "DEF") || a[1].localeCompare(b[1]));
    setDoc("league", "roster", { updatedAt: now, count: roster.length, players: roster });
    // schedule + every game
    const starts = await weekStarts();
    if (Object.keys(starts).length) mergeDoc("league", "config", { weekStarts: starts, scheduleUpdatedAt: now });
    const games = await gamesDoc(Array.from({ length: LAST_WEEK }, (_, i) => i + 1));
    if (games.length) setDoc("league", "games", { season: SEASON, updatedAt: now, count: games.length, source: "Sleeper scores", games });
    mergeDoc("league", "refresh", { finishedAt: now, through, status: "done", by: by || null });
    lastFull = Date.now();
    console.log(`[refresh] ${through} · ${n} bets · ${roster.length} roster · ${games.length} games`);
    return { ok: true, through, bets: n };
  } catch (e) {
    console.warn("[refresh] failed:", e.message);
    mergeDoc("league", "refresh", { finishedAt: now, status: "error", error: e.message });
    return { error: e.message };
  } finally { refreshing = false; }
}
// light pass: just this week's (and next week's) scores, for the ticker and game bets
async function scoresRefresh() {
  if (refreshing) return;
  const w = currentWeek(), weeks = [w]; if (w < LAST_WEEK) weeks.push(w + 1);
  const fresh = await gamesDoc(weeks);
  if (!fresh.length) return;
  const cur = book.league.games || { season: SEASON, games: [] };
  const keep = (cur.games || []).filter(g => !weeks.includes(g.week));
  const games = keep.concat(fresh).sort((a, b) => a.week - b.week || a.date.localeCompare(b.date));
  setDoc("league", "games", Object.assign({}, cur, { updatedAt: nowIso(), count: games.length, games }));
}

/* ---------------- HTTP ---------------- */
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(type ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ""; req.on("data", c => { s += c; if (s.length > 5e6) reject(new Error("too big")); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}
function authed(req, url) {
  if (!LEAGUE_KEY) return true;
  const k = req.headers["x-league-key"] || url.searchParams.get("key");
  return k === LEAGUE_KEY;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      return send(res, 200, fs.readFileSync(INDEX), "text/html; charset=utf-8");
    }
    if (!p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (!authed(req, url)) return send(res, 401, { error: "league key required" });

    if (req.method === "GET" && p === "/api/book") return send(res, 200, { league: book.league, bets: book.bets, keyed: !!LEAGUE_KEY });

    if (req.method === "GET" && p === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`event: init\ndata: ${JSON.stringify({ league: book.league, bets: book.bets })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
      req.on("close", () => { clients.delete(res); clearInterval(ping); });
      return;
    }

    const m = p.match(/^\/api\/doc\/(bets|league)\/([A-Za-z0-9_\-.~:@+]{1,200})$/);
    if (m) {
      const [, col, id] = m;
      if (req.method === "GET") { const d = getDoc(col, id); return send(res, 200, { exists: !!d, data: d || null }); }
      if (req.method === "PUT") { setDoc(col, id, await readBody(req)); return send(res, 200, { ok: true }); }
      if (req.method === "PATCH") { if (!getDoc(col, id)) return send(res, 404, { error: "no such document" }); mergeDoc(col, id, await readBody(req)); return send(res, 200, { ok: true }); }
      if (req.method === "DELETE") { delDoc(col, id); return send(res, 200, { ok: true }); }
    }
    const l = p.match(/^\/api\/lease\/(bets|league)\/([A-Za-z0-9_\-.~:@+]{1,200})$/);
    if (l && req.method === "POST") { const b = await readBody(req); return send(res, 200, { acquired: acquire(`${l[1]}/${l[2]}`, String(b.holder || ""), Number(b.ttlMs)) }); }

    if (req.method === "POST" && p === "/api/refresh") {
      const b = await readBody(req);
      mergeDoc("league", "refresh", { requestedAt: nowIso(), requestedBy: b.by || null });
      if (Date.now() - lastFull < 60e3) { scoresRefresh().catch(() => {}); mergeDoc("league", "refresh", { finishedAt: nowIso(), status: "done" }); return send(res, 200, { ok: true, note: "recent" }); }
      fullRefresh(b.by).catch(() => {});
      return send(res, 202, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) { return send(res, 400, { error: e.message }); }
});

server.listen(PORT, () => {
  console.log(`Smyrna Side Book on http://localhost:${PORT}${LEAGUE_KEY ? " (league key required)" : " (open — set LEAGUE_KEY)"}`);
  fullRefresh("startup").catch(() => {});
  setInterval(() => fullRefresh("timer").catch(() => {}), 60 * 60e3);   // hourly: stats, roster, schedule, all games
  setInterval(() => scoresRefresh().catch(() => {}), 60e3);            // every minute: this week's scores
});
