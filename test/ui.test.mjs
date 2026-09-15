// Screens the live e2e can't reach: it signs in as one manager, so it never sees the
// admin's form, a bye week, or a ticket from the proposer's side. These load the real
// page in headless Chrome from a local static server, import the app's modules, hand
// them fake state with state.local on (nothing reaches Firestore), and read the DOM
// back — computed style included. Skipped when Chrome isn't installed.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json" };

let puppeteer = null;
try { puppeteer = (await import("puppeteer-core")).default; } catch (_) {}
const canRun = !!puppeteer && fs.existsSync(CHROME);
const skip = canRun ? false : "Chrome not found";

let server, browser, base;
test.before(async () => {
  if (!canRun) return;
  server = http.createServer((q, r) => {
    let p = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
    if (p.endsWith(path.sep) || p.endsWith("/")) p = path.join(p, "index.html");
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(d);
    });
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-extensions"] });
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// A fresh page with the app's modules loaded and a small league in state.
async function page(ua, viewport) {
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  if (ua) await p.setUserAgent(ua);
  if (viewport) await p.setViewport(viewport);
  await p.goto(base, { waitUntil: "load" });
  await p.waitForSelector("#bEntries", { timeout: 20000 });
  await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    state.config = { leagueName: "T", season: "2026", stake: 25, adminEmails: [],
      members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }],
      kickoff: "2036-09-10T00:20:00Z" };   // far off: season-long bets must stay open whenever this runs
    state.me = "a"; state.local = true; state.bets = []; state.admin = false; state.isAdmin = false;
    state.roster = { players: [["1", "Chase Brown", "RB", "CIN"], ["2", "Ja'Marr Chase", "WR", "CIN", "Q"], ["3", "Drake Maye", "QB", "NE"], ["SEA", "Seattle Seahawks", "DEF", "SEA"], ["KC", "Kansas City Chiefs", "DEF", "KC"]] };
    state.games = { games: [{ id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z", status: "pre" }] };
  });
  return { p, errors };
}

test("a proposer sees the open seat, not a Take it button; anyone else gets the button; open tickets glow", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const h2h = { id: "h", status: "open", createdBy: "a", week: 5, kind: "matchup", amount: 10, name: "NE @ SEA", terms: "Straight up.",
      game: { id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" }, market: "ml",
      entries: [{ memberId: "a", side: "NE", pick: "New England Patriots" }, { memberId: null, side: "SEA", pick: "Seattle Seahawks" }], paid: [] };
    const done = { id: "d", status: "settled", createdBy: "b", week: 1, kind: "prop", amount: 10, name: "Done", terms: "t", winner: "b",
      entries: [{ memberId: "b", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] };
    // a week-5 stat bet holding a CIN player: CIN sits out week 5 in this schedule
    const pot = { id: "p", status: "active", createdBy: "b", week: 5, kind: "prop", amount: 10, name: "Pot", terms: "t", joinable: true,
      stats: { scope: "player", tracks: [{ stat: "rec_yd", metric: "Rec yds" }], rows: [
        { id: "2", label: "Ja'Marr Chase", team: "CIN", memberId: "b", values: {} }, { id: "3", label: "Drake Maye", team: "NE", memberId: "c", values: {} }] },
      entries: [{ memberId: "b", picks: [{ id: "2", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }, { memberId: "c", picks: [{ id: "3", name: "Drake Maye", pos: "QB", team: "NE" }] }], paid: [] };
    state.bets = [h2h, done, pot];
    const res = {};
    // week-5 projections: nothing played yet, so the strip shows them, and Maye leads on them
    state.proj = { weeks: { "5": JSON.stringify({ "2": { rec_yd: 61.5, rec: 4.1 }, "3": { rec_yd: 88.2, pass_yd: 240 } }) } };
    state.me = "a"; V.render();
    res.projRows = [...document.querySelectorAll(".srow")].map(r => [r.querySelector(".s-lab").textContent, r.querySelector("b").firstChild.textContent, !!r.querySelector("b.proj"), r.classList.contains("lead")]);
    res.projNote = (document.querySelector(".proj-note") || {}).textContent || "";
    const file = i => i.getAttribute("src").split("/").pop();
    res.logos = { gameline: [...document.querySelectorAll(".gameline img.tlogo")].map(file), sides: [...document.querySelectorAll(".side-pick img.tlogo")].map(file),
      rows: [...document.querySelectorAll(".srow .s-team img.tlogo")].map(file), ticker: [...document.querySelectorAll(".ticker .game")].every(g => g.querySelectorAll("img.tlogo").length === 2),
      size: (i => i && getComputedStyle(i).width)(document.querySelector(".gameline img.tlogo")) };
    // once something has been played, actuals take over and the projection sits beside them
    pot.stats.rows[0].values = { rec_yd: 12 }; V.render();
    res.playedRows = [...document.querySelectorAll(".srow")].map(r => [r.querySelector(".s-lab").textContent, r.querySelector("b").firstChild.textContent, (r.querySelector("b small.proj-was") || {}).textContent || "", r.classList.contains("lead")]);
    res.ticks = [...document.querySelectorAll(".srow .ptick")].map(t => [t.style.left, getComputedStyle(t).position]);
    res.barWidths = [...document.querySelectorAll(".srow .sbar i")].map(i => i.style.width);
    res.playedNote = !!document.querySelector(".proj-note");
    pot.stats.rows[0].values = {}; state.proj = null; V.render();
    res.byeTags = [...document.querySelectorAll(".srow")].map(r => [r.querySelector(".s-lab").textContent, !!r.querySelector(".s-bye")]);
    res.statusTags = [...document.querySelectorAll(".srow")].map(r => [r.querySelector(".s-lab").textContent, [...r.querySelectorAll(".st-tag")].map(t => t.textContent + ":" + t.dataset.tip + ":" + (getComputedStyle(t).display !== "none"))]);
    res.proposerTake = document.querySelectorAll('[data-act="take"]').length;
    res.seeking = [...document.querySelectorAll("article.ticket")].map(a => [a.querySelector(".terms").textContent, a.classList.contains("seeking")]);
    const glow = document.querySelector("article.ticket.seeking"), flat = document.querySelector("article.ticket:not(.seeking)");
    res.glowDiffers = getComputedStyle(glow).boxShadow !== getComputedStyle(flat).boxShadow;
    state.me = "b"; V.render();
    res.otherTake = document.querySelectorAll('[data-act="take"]').length;
    return res;
  });
  assert.equal(out.proposerTake, 0, "no Take it on your own bet");
  assert.equal(out.otherTake, 1, "another manager can take the seat");
  assert.deepEqual(Object.fromEntries(out.seeking), { "NE @ SEA": true, Done: false, Pot: true }, "open and joinable glow, settled doesn't");
  assert.deepEqual(out.byeTags, [["Ja'Marr Chase", true], ["Drake Maye", false]], "the CIN row wears a bye tag in week 5");
  assert.deepEqual(out.projRows, [["Ja'Marr Chase", "61.5", true, false], ["Drake Maye", "88.2", true, true]], "projections for the bet's stat, projected leader marked");
  assert.match(out.projNote, /Projected by Sleeper/);
  assert.deepEqual(out.logos.gameline, ["ne.png", "sea.png"], "logos on the game line");
  assert.deepEqual(out.logos.sides, ["ne.png", "sea.png"], "and on each side's pick");
  assert.deepEqual(out.logos.rows, ["cin.png", "ne.png"], "and on standings rows");
  assert.equal(out.logos.ticker, true, "and both teams in every ticker game"); assert.equal(out.logos.size, "18px");
  assert.deepEqual(out.playedRows, [["Ja'Marr Chase", "12", "p 61.5", true], ["Drake Maye", "0", "p 88.2", false]], "actuals lead once played; projection beside them");
  assert.equal(out.playedNote, false);
  assert.deepEqual(out.ticks, [["70%", "absolute"], ["100%", "absolute"]], "a tick at each projection, bars scaled to the larger of actual and projected");
  assert.deepEqual(out.barWidths, ["14%", "0%"], "12 of 88.2");
  assert.deepEqual(out.statusTags, [["Ja'Marr Chase", ["Q:Questionable:true"]], ["Drake Maye", []]], "the questionable player is tagged on the ticket, from the roster");
  assert.equal(out.glowDiffers, true, "and the glow is real computed style");
  assert.deepEqual(errors, []);
  await p.close();
});

test("admin switch on: any manager on any row; off: row one is you, others open or invited", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    const rows = () => [...document.querySelectorAll("#bEntries .entry-row")].map(r => {
      const s = r.querySelector("select");
      return { tag: r.querySelector(".entry-tag").textContent, disabled: s.disabled, opts: [...s.options].map(o => o.textContent) };
    });
    state.draftScope = "player"; state.draftStats = ["rec_yd"];
    state.admin = false; state.draft = [{ memberId: "a", pick: "", picks: [] }, { memberId: null, pick: "", picks: [], side: "" }]; F.drawEntries();
    const off = rows();
    state.admin = true; state.draft = [{ memberId: "b", pick: "", picks: [] }, { memberId: "c", pick: "", picks: [], side: "" }]; F.drawEntries();
    const on = rows();
    // save a game bet for Bob vs Cara with the switch on
    state.draftScope = "game"; state.draftMarket = "ml"; state.draftLine = ""; state.editId = null;
    state.draftGame = { id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" };
    state.draft = [{ memberId: "b", pick: "", picks: [], side: "NE" }, { memberId: "c", pick: "", picks: [], side: "" }];
    document.getElementById("bAmt").value = "10"; document.getElementById("bName").value = ""; document.getElementById("bTerms").value = "";
    F.submitBet(); const saved = state.bets[0];
    state.bets = []; state.draft = [{ memberId: "b", pick: "", picks: [], side: "NE" }, { memberId: "b", pick: "", picks: [], side: "" }];
    F.submitBet(); const dupSaved = state.bets.length;
    return { off, on, saved: saved && { createdBy: saved.createdBy, postedBy: saved.postedBy, status: saved.status, seats: saved.entries.map(e => e.memberId) }, dupSaved };
  });
  assert.equal(out.off[0].disabled, true); assert.deepEqual(out.off[0].opts, ["Alice (you)"]);
  assert.deepEqual(out.off[1].opts, ["Open seat — anyone", "Invite Bob", "Invite Cara"]);
  assert.equal(out.on[0].tag, "For"); assert.equal(out.on[0].disabled, false); assert.deepEqual(out.on[0].opts, ["Alice (you)", "Bob", "Cara"]);
  assert.deepEqual(out.on[1].opts, ["Open seat — anyone", "Alice (you)", "Bob", "Cara"]);
  assert.deepEqual(out.saved, { createdBy: "b", postedBy: "a", status: "active", seats: ["b", "c"] });
  assert.equal(out.dupSaved, 0, "same manager on two rows is refused");
  assert.deepEqual(errors, []);
  await p.close();
});

test("mid-week: players whose game has started are left out of every picker and refused on post or join", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    const at = h => new Date(Date.now() + h * 3600e3).toISOString();
    // week 3 is under way: CIN @ NE kicked off an hour ago, SEA @ KC is tomorrow
    state.config.weekStarts = { "3": at(-1) };
    state.games = { games: [{ id: "x", week: 3, away: "CIN", home: "NE", date: at(-1), status: "live" }, { id: "y", week: 3, away: "SEA", home: "KC", date: at(24), status: "pre" }] };
    const wk = document.getElementById("bWeek"); wk.innerHTML = '<option value="3">Week 3</option>'; wk.value = "3";
    const names = sel => [...document.querySelectorAll(sel + " button")].map(x => x.textContent.split(/[A-Z]{2,3}/)[0]);
    state.draftScope = "player"; state.draftStats = ["rec_yd"]; state.draft = [{ memberId: "a", pick: "", picks: [] }]; F.drawEntries();
    F.drawSugg(0, "ch"); const playerSugg = names("#bEntries #sugg0"); const suggEmpty = document.querySelector("#bEntries #sugg0 .sugg-empty")?.textContent;
    F.drawSugg(0, "maye"); const mayeSugg = names("#bEntries #sugg0");
    state.roster.players.push(["NE", "New England Patriots", "DEF", "NE"]);
    const defIds = q => { F.drawSugg(0, q); return [...document.querySelectorAll("#bEntries #sugg0 button")].map(x => x.dataset.id); };
    state.draftScope = "team"; F.drawEntries(); const defSugg = [...defIds("new england"), ...defIds("seattle")];
    // posting: a started pick is refused, but the week itself is still open for anyone yet to play
    state.draftScope = "player"; document.getElementById("bName").value = "Mid"; document.getElementById("bAmt").value = "10"; state.editId = null; state.bets = [];
    state.draft = [{ memberId: "a", pick: "", picks: [{ id: "3", name: "Drake Maye", pos: "QB", team: "NE" }] }]; F.submitBet();
    const startedSaved = state.bets.length, startedToast = document.getElementById("toast").textContent;
    state.roster.players.push(["9", "Travis Kelce", "TE", "KC"]);
    state.draft = [{ memberId: "a", pick: "", picks: [{ id: "9", name: "Travis Kelce", pos: "TE", team: "KC" }] }]; F.submitBet();
    const later = state.bets[0]; const laterSaved = state.bets.length;
    // joining that bet: the picker leaves the started players out, and a started pick is refused
    state.joinId = later.id; state.draftScope = "player"; state.draftStats = ["rec_yd"]; state.draft = [{ memberId: "b", pick: "", picks: [] }];
    state.me = "b"; F.drawEntries("jEntries"); document.getElementById("joinDlg").showModal();
    F.drawSugg(0, "ch"); const joinSugg = document.querySelectorAll("#jEntries #sugg0 button").length === 0;
    state.draft = [{ memberId: "b", pick: "", picks: [{ id: "1", name: "Chase Brown", pos: "RB", team: "CIN" }] }]; F.submitJoin();
    const joinStartedToast = document.getElementById("toast").textContent, joinedStarted = later.entries.length;
    document.getElementById("joinDlg").close();
    return { playerSugg, suggEmpty, mayeSugg, defSugg, startedSaved, startedToast, laterSaved, laterStatus: later && later.status, joinSugg, joinStartedToast, joinedStarted };
  });
  assert.deepEqual(out.playerSugg, [], "both CIN players are left out, not greyed"); assert.equal(out.suggEmpty, "No players match", "and the list says so rather than vanishing");
  assert.deepEqual(out.mayeSugg, [], "and NE's Maye");
  assert.deepEqual(out.defSugg, ["SEA"], "NE's defense is left out; Seattle's, yet to play, still shows");
  assert.equal(out.startedSaved, 0); assert.match(out.startedToast, /Drake Maye's game has already started/);
  assert.equal(out.laterSaved, 1, "a pick who plays tomorrow can still be posted after the week's first game"); assert.equal(out.laterStatus, "open");
  assert.equal(out.joinSugg, true, "the join picker leaves them out too");
  assert.match(out.joinStartedToast, /Chase Brown's game has already started/); assert.equal(out.joinedStarted, 1);
  assert.deepEqual(errors, []);
  await p.close();
});

test("picker filters: team and position narrow the list, the name box matches names, and the list stays open between picks", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    state.roster.players.push(["10", "Patrick Mahomes", "QB", "KC"], ["11", "Gardner Minshew", "QB", "KC"], ["12", "Travis Kelce", "TE", "KC"], ["13", "Denzel Mims", "WR", "PIT"], ["14", "Bo Nix", "QB", "DEN"]);
    state.proj = { weeks: { "6": JSON.stringify({ "10": { pts_ppr: 24 }, "11": { pts_ppr: 3 }, "12": { pts_ppr: 14 } }) } };
    const wk = document.getElementById("bWeek"); wk.innerHTML = '<option value="6">Week 6</option>'; wk.value = "6";
    document.getElementById("bMatch").innerHTML = '<option value="count">c</option>';
    state.draftScope = "player"; state.draftStats = ["pts_ppr"]; state.draftTeam = ""; state.draftPos = ""; state.draft = [{ memberId: "a", pick: "", picks: [] }];
    F.drawScope(); F.drawEntries(); document.getElementById("betDlg").showModal();
    const list = () => [...document.querySelectorAll("#bEntries #sugg0 button")].map(b => b.dataset.id);
    const sel = (act, v) => { const el = document.querySelector('#bPickFilters [data-act="' + act + '"]'); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };
    const box = () => document.querySelector('#bEntries [data-act="dSearch"]');
    const type = v => { const b = box(); b.value = v; b.dispatchEvent(new Event("input", { bubbles: true })); };
    const res = { filtersShown: getComputedStyle(document.getElementById("bPickFilters")).display !== "none",
      teamOpts: [...document.querySelectorAll('#bPickFilters [data-act="dTeam"] option')].map(o => o.value),
      posOpts: [...document.querySelectorAll('#bPickFilters [data-act="dPos"] option')].map(o => o.textContent),
      placeholder: box().placeholder };
    box().focus();
    res.blankNoFilter = document.querySelector("#bEntries #sugg0").hidden;
    sel("dTeam", "KC"); res.kc = list();
    sel("dPos", "QB"); res.kcQb = list();
    type("mah"); res.kcQbMah = list();
    sel("dTeam", ""); sel("dPos", ""); type("den"); res.den = list();
    type(""); sel("dTeam", "KC");
    document.querySelector('#bEntries #sugg0 button[data-id="10"]').click();
    res.afterPick = { chips: [...document.querySelectorAll("#bEntries .pick-chip")].map(c => c.firstChild.textContent.trim()), open: !document.querySelector("#bEntries #sugg0").hidden, list: list() };
    document.getElementById("bScopeHint").click(); res.closedOutside = document.querySelector("#bEntries #sugg0").hidden;
    state.draftScope = "team"; F.drawScope(); F.drawEntries();
    res.teamScope = { filters: document.getElementById("bPickFilters").hidden, match: document.getElementById("bMatchRow").hidden };
    document.getElementById("betDlg").close();
    return res;
  });
  assert.equal(out.filtersShown, true); assert.equal(out.placeholder, "Player name…");
  assert.deepEqual(out.teamOpts, ["", "CIN", "DEN", "KC", "NE", "PIT"]); assert.deepEqual(out.posOpts, ["Any position", "QB", "RB", "WR", "TE", "K"]);
  assert.equal(out.blankNoFilter, true, "an empty box with no filter shows nothing");
  assert.deepEqual(out.kc, ["10", "11", "12"], "the Chiefs, by position, the starter first on projection");
  assert.deepEqual(out.kcQb, ["10", "11"]); assert.deepEqual(out.kcQbMah, ["10"]);
  assert.deepEqual(out.den, ["13"], "den finds Denzel, not the Broncos");
  assert.deepEqual(out.afterPick, { chips: ["Patrick Mahomes"], open: true, list: ["11", "12"] }, "picked, and the list stays open on who's left");
  assert.equal(out.closedOutside, true, "a tap outside closes it");
  assert.deepEqual(out.teamScope, { filters: true, match: true }, "a defense bet has neither");
  assert.deepEqual(errors, []);
  await p.close();
});

test("sides must match: same lineup is enforced on post and join, a field bet is one against four", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev"); const V = await import("./render.js?v=dev");
    const P = (id, pos) => { state.roster.players.push([id, "P" + id, pos, "KC"]); return { id, name: "P" + id, pos, team: "KC" }; };
    const qb1 = P("q1", "QB"), wr1 = P("w1", "WR"), qb2 = P("q2", "QB"), rb2 = P("r2", "RB"), wr2 = P("w2", "WR"), f = ["f1", "f2", "f3", "f4"].map(id => P(id, "WR"));
    const wk = document.getElementById("bWeek"), mSel = document.getElementById("bMatch");
    const toast = () => document.getElementById("toast").textContent;
    const post = (match, draft) => {
      wk.innerHTML = '<option value="6">Week 6</option>'; wk.value = "6";
      mSel.innerHTML = '<option value="count"></option><option value="lineup"></option><option value="field"></option>'; mSel.value = match;
      state.draftScope = "player"; state.draftStats = ["pts_ppr"]; state.editId = null; state.draft = draft;
      document.getElementById("bName").value = ""; document.getElementById("bAmt").value = "10";
      const before = new Set(state.bets.map(b => b.id)); F.submitBet(); return state.bets.find(b => !before.has(b.id)) || null;
    };
    state.bets = [];
    const res = {};
    res.lineupBad = post("lineup", [{ memberId: "a", picks: [qb1, wr1] }, { memberId: null, picks: [qb2, rb2] }]); res.lineupBadToast = toast();
    const good = post("lineup", [{ memberId: "a", picks: [qb1, wr1] }]); res.lineupGood = good && good.match;
    V.render(); res.label = [...document.querySelectorAll("article.ticket .kind.match")].map(k => k.textContent);
    // joining it with a WR already picked: only quarterbacks are offered, and a wrong lineup is refused
    state.me = "b"; state.joinId = good.id; state.draftScope = "player"; state.draftStats = ["pts_ppr"]; state.draftTeam = "KC"; state.draftPos = "";
    state.draft = [{ memberId: "b", pick: "", picks: [wr2] }]; F.drawEntries("jEntries"); document.getElementById("joinDlg").showModal();
    F.drawSugg(0, ""); res.joinOffered = [...document.querySelectorAll("#jEntries #sugg0 button")].map(b => b.dataset.id).sort();
    state.draft = [{ memberId: "b", pick: "", picks: [wr2, rb2] }]; F.submitJoin(); res.joinBadToast = toast(); res.joinBadIn = good.entries.length;
    document.getElementById("joinDlg").close(); state.me = "a";
    // a field bet: choosing it adds the second side and hides the join option
    state.bets = []; wk.innerHTML = '<option value="6">Week 6</option>'; state.draftScope = "player"; state.draft = [{ memberId: "a", picks: [] }];
    mSel.innerHTML = '<option value="count"></option><option value="field"></option>'; F.drawScope(); F.drawEntries();
    mSel.value = "field"; mSel.dispatchEvent(new Event("change", { bubbles: true }));
    res.fieldRows = state.draft.length; res.fieldJoinHidden = document.getElementById("bJoinRow").hidden;
    res.fieldThree = post("field", [{ memberId: "a", picks: [qb1] }, { memberId: null, picks: f.slice(0, 3) }]); res.fieldThreeToast = toast();
    const field = post("field", [{ memberId: "a", picks: [qb1] }, { memberId: null, picks: f }]);
    res.field = field && { match: field.match, joinable: field.joinable };
    return res;
  });
  assert.equal(out.lineupBad, null); assert.match(out.lineupBadToast, /Pick QB \+ WR, same as the other side/);
  assert.equal(out.lineupGood, "lineup");
  assert.deepEqual(out.label, ["QB + WR each"], "the ticket says what every side has to be");
  assert.deepEqual(out.joinOffered, ["q1", "q2"], "with a WR already picked, only quarterbacks are offered");
  assert.match(out.joinBadToast, /Pick QB \+ WR, same as everyone else/); assert.equal(out.joinBadIn, 1);
  assert.equal(out.fieldRows, 2, "a field bet gets its second side"); assert.equal(out.fieldJoinHidden, true);
  assert.equal(out.fieldThree, null); assert.match(out.fieldThreeToast, /one player, and a field of 4/);
  assert.deepEqual(out.field, { match: "field", joinable: false });
  assert.deepEqual(errors, []);
  await p.close();
});

test("bye week: off teams are greyed in the picker and refused on post or join", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    const wk = document.getElementById("bWeek"); wk.innerHTML = '<option value="0">Season long</option><option value="5">Week 5</option>';
    const sugg = () => [...document.querySelectorAll("#sugg0 button")].map(x => [x.textContent, x.disabled, getComputedStyle(x).opacity, !!x.querySelector(".tag.bye"), [...x.querySelectorAll(".st-tag")].map(t => t.textContent), (x.querySelector(".proj") || {}).textContent || ""]);
    state.proj = { weeks: { "5": JSON.stringify({ "2": { rec_yd: 61.5, rec: 4.1 }, "3": { pass_yd: 240 } }), "0": JSON.stringify({ "2": { rec_yd: 1210 } }) } };
    state.draftScope = "player"; state.draftStats = ["rec_yd"]; state.draft = [{ memberId: "a", pick: "", picks: [] }]; F.drawEntries();
    wk.value = "5"; F.drawSugg(0, "chase"); const w5chase = sugg(); F.drawSugg(0, "maye"); const w5maye = sugg();
    state.draftScope = "team"; F.drawEntries(); F.drawSugg(0, "ch"); const w5def = sugg();
    state.draftScope = "player"; F.drawEntries(); wk.value = "0"; F.drawSugg(0, "chase"); const w0chase = sugg();
    document.getElementById("bName").value = "Test"; document.getElementById("bAmt").value = "10"; state.editId = null;
    state.draft = [{ memberId: "a", pick: "", picks: [{ id: "2", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }];
    wk.value = "5"; F.submitBet(); const w5saved = state.bets.length, w5toast = document.getElementById("toast").textContent;
    wk.value = "0"; F.submitBet(); const w0saved = state.bets.length;
    state.bets = [{ id: "j1", week: 5, status: "open", joinable: true, createdBy: "b", amount: 10, name: "Pot", terms: "t",
      stats: { scope: "player", tracks: [{ stat: "rec_yd" }] }, entries: [{ memberId: "b", picks: [{ id: "3", name: "Drake Maye", pos: "QB", team: "NE" }] }] }];
    state.joinId = "j1"; state.draftScope = "player"; state.draft = [{ memberId: "a", pick: "", picks: [] }]; F.drawEntries("jEntries"); document.getElementById("joinDlg").showModal();
    F.drawSugg(0, "chase"); const joinChase = [...document.querySelectorAll("#jEntries #sugg0 button")].map(x => [x.textContent, x.disabled]);
    const pickerLogos = document.querySelectorAll("#jEntries #sugg0 button .team img.tlogo").length;
    return { w5chase, w5maye, w5def, w0chase, w5saved, w5toast, w0saved, joinChase, pickerLogos };
  });
  assert.deepEqual(out.w5chase.map(r => r[1]), [true, true], "both CIN rows disabled");
  assert.equal(out.w5chase[1][2], "0.45"); assert.equal(out.w5chase[1][3], true, "bye tag shown");
  assert.deepEqual(out.w5maye, [["Drake MayeQB0 rec ydsNE", false, "1", false, [], "0 rec yds"]]);
  assert.deepEqual(out.w5chase.map(r => r[5]), ["61.5 rec yds", "0 rec yds"], "the picker shows the projection for the selected stat and week, best first");
  assert.deepEqual(out.w0chase.map(r => r[5]), ["1210 rec yds", "0 rec yds"], "a season-long bet shows the season projection");
  assert.deepEqual(out.w5chase.map(r => r[4]), [["Q"], []], "the picker tags the questionable player");
  assert.equal(out.pickerLogos, 2, "a logo beside each team code in the picker");
  assert.equal(out.w5def[0][1], true, "KC's defense is off too");
  assert.deepEqual(out.w0chase.map(r => r[1]), [false, false], "season-long filters nobody");
  assert.equal(out.w5saved, 0); assert.match(out.w5toast, /off in week 5/);
  assert.equal(out.w0saved, 1);
  assert.deepEqual(out.joinChase.map(r => r[1]), [true, true], "join filters against the bet's week");
  assert.deepEqual(errors, []);
  await p.close();
});

test("a test account is off the ledger board and out of the pickers; League shows it to admins and to itself", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const F = await import("./forms.js?v=dev"); const D = await import("./dialogs.js?v=dev");
    state.config.members[2].test = true;   // Cara
    const res = {};
    state.me = "a"; V.render();
    res.board = [...document.querySelectorAll("#board .seat-name")].map(e => e.textContent);
    state.draftScope = "player"; state.draftStats = ["rec_yd"];
    state.admin = false; state.draft = [{ memberId: "a", pick: "", picks: [] }, { memberId: null, pick: "", picks: [], side: "" }]; F.drawEntries();
    res.invites = [...document.querySelectorAll('#bEntries select[data-i="1"] option')].map(o => o.textContent);
    D.drawRoster(); res.rosterAsAlice = [...document.querySelectorAll("#rosterList .r-name")].map(e => e.textContent);
    state.admin = true; D.drawRoster();
    res.rosterAsAdmin = [...document.querySelectorAll("#rosterList .rrow")].map(r => [r.querySelector(".r-name").textContent, !!r.querySelector(".r-test"), r.querySelector('[data-act="testToggle"]').checked]);
    state.admin = false; state.me = "c"; V.render(); D.drawRoster();
    res.boardAsCara = [...document.querySelectorAll("#board .seat-name")].map(e => e.textContent);
    res.rosterAsCara = [...document.querySelectorAll("#rosterList .r-name")].map(e => e.textContent);
    return res;
  });
  assert.deepEqual(out.board, ["Alice", "Bob"], "Cara is off the board");
  assert.deepEqual(out.invites, ["Open seat — anyone", "Invite Bob"], "and can't be invited");
  assert.deepEqual(out.rosterAsAlice, ["Alice", "Bob"], "a regular manager doesn't see her in League");
  assert.deepEqual(out.rosterAsAdmin, [["Alice", false, false], ["Bob", false, false], ["Cara", true, true]], "an admin sees her, tagged, box ticked");
  assert.deepEqual(out.boardAsCara, ["Alice", "Bob"], "the board is the league's even for her");
  assert.deepEqual(out.rosterAsCara, ["Alice", "Bob", "Cara"], "but she sees herself in League");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Join dialog search works after the propose form has been drawn (shared ids)", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    // the propose form has been drawn, as it would be for anyone who opened it earlier
    state.draftScope = "player"; state.draftStats = ["pass_yd"]; state.draft = [{ memberId: "a", pick: "", picks: [] }]; F.drawEntries("bEntries");
    // now a join
    state.bets = [{ id: "j1", week: 0, status: "open", joinable: true, createdBy: "b", amount: 25, name: "Gun Slinger", terms: "t",
      stats: { scope: "player", tracks: [{ stat: "pass_yd" }] }, entries: [{ memberId: "b", picks: [{ id: "9", name: "Joe Burrow", pos: "QB", team: "CIN" }] }] }];
    state.joinId = "j1"; state.draft = [{ memberId: "a", pick: "", picks: [] }]; F.drawEntries("jEntries"); document.getElementById("joinDlg").showModal();
    F.drawSugg(0, "maye");
    const inJoin = document.querySelectorAll("#jEntries #sugg0 button").length, inPropose = document.querySelectorAll("#bEntries #sugg0 button").length;
    F.addPick(0, "3");
    const chipsJoin = [...document.querySelectorAll("#jEntries .pick-chip")].map(c => c.textContent), chipsPropose = document.querySelectorAll("#bEntries .pick-chip").length;
    const focused = document.activeElement && document.activeElement.closest("#jEntries") ? "join" : "elsewhere";
    return { inJoin, inPropose, chipsJoin, chipsPropose, focused };
  });
  assert.equal(out.inJoin, 1, "suggestions appear in the Join dialog"); assert.equal(out.inPropose, 0, "not in the hidden propose form");
  assert.equal(out.chipsJoin.length, 1); assert.match(out.chipsJoin[0], /Drake Maye/); assert.equal(out.chipsPropose, 0, "the pick lands in the Join dialog");
  assert.equal(out.focused, "join", "focus returns to the Join dialog's search");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Sleeper avatars and team names show where the book has them; initials and the dialog's names otherwise", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    state.config.members[1].team = "Bob's Dialog Name";
    state.sleeper = { updatedAt: "2026-09-09T20:00:00Z", leagueId: "L1", byId: { a: { avatar: "6dcbee5f295974c3ea459f3aa1e3ba02", team: "Cheat 2 Win" }, b: { avatar: "", team: "" } } };
    V.render(); D.drawRoster();
    const board = [...document.querySelectorAll("#board .seat")].map(s => { const a = s.querySelector(".avatar"); return [s.querySelector(".seat-name").textContent, a.tagName, a.tagName === "IMG" ? a.getAttribute("src") : a.textContent, getComputedStyle(a).borderRadius, s.querySelector(".seat-team").textContent]; });
    const roster = [...document.querySelectorAll("#rosterList .rrow")].map(r => r.querySelector(".r-team").textContent);
    return { board, roster };
  });
  assert.deepEqual(out.board.map(r => [r[0], r[1], r[2], r[4]]), [["Alice", "IMG", "https://sleepercdn.com/avatars/thumbs/6dcbee5f295974c3ea459f3aa1e3ba02", "Cheat 2 Win"], ["Bob", "SPAN", "BO", "Bob's Dialog Name"], ["Cara", "SPAN", "CA", ""]], "Sleeper's team name wins; the dialog's is the fallback");
  assert.equal(out.board[0][3], "50%", "round, like the initials");
  assert.deepEqual(out.roster, ["Cheat 2 Win", "Bob's Dialog Name", "—"]);
  assert.deepEqual(errors, []);
  await p.close();
});

test("Scores: a week board with projections, paired matchups, and the season pool under it", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.tab = "league";
    V.render();
    const empty = document.getElementById("scores").textContent;
    const before = document.querySelectorAll("#board .fig").length;
    state.highlow = { weeks: {
      "1": { high: [{ id: "a", name: "Alice", pts: 148.4 }], low: [{ id: "c", name: "Cara", pts: 92.1 }] },
      "2": { high: [{ id: "a", name: "Alice", pts: 131 }], low: [{ id: "b", name: "Bob", pts: 88.6 }] } } };
    state.scores = { weeks: {
      "1": { at: new Date().toISOString(), final: true, rows: [
        { id: "a", name: "Alice", pts: 148.4, proj: 121.2, mid: 1 },
        { id: "c", name: "Cara", pts: 92.1, proj: 110.9, mid: 1 },
        { id: "b", name: "Bob", pts: 120, proj: 115.5, mid: 2 },
        { id: null, name: "ghost", pts: 130.5, proj: null, mid: 2 } ] },
      "2": { at: new Date().toISOString(), final: false, rows: [
        { id: "a", name: "Alice", pts: 131, proj: 118.5, mid: 1 },
        { id: "b", name: "Bob", pts: 88.6, proj: 104.2, mid: 1 },
        { id: "c", name: "Cara", pts: 0, proj: 99.4, mid: 2 } ] } } };
    V.render(); await new Promise(r => setTimeout(r, 30));
    const read = () => ({
      picker: [...document.querySelectorAll("#weekPick .chip")].map(c => [c.textContent.replace("live", "").trim(), c.getAttribute("aria-pressed")]),
      games: [...document.querySelectorAll("#scores .sb-game")].map(g => [...g.querySelectorAll(".sb-side")].map(s => [
        s.querySelector(".sb-name").textContent,
        s.querySelector(".sb-pts") ? s.querySelector(".sb-pts").textContent : s.querySelector(".sb-idle").textContent,
        s.querySelector(".sb-proj").textContent,
        s.classList.contains("lead")])),
      pools: [...document.querySelectorAll("#scores .sb-pool")].map(x => [x.querySelector(".sb-pool-lab").textContent, x.querySelector(".sb-pool-who").textContent, x.querySelector(".sb-pool-pts b").textContent]),
      note: document.getElementById("scoresNote").textContent,
      avatars: document.querySelectorAll("#scores .sb-who .avatar, #scores .sb-who img").length });
    const wk1 = read();
    // the picker moves the board
    document.querySelector('#weekPick .chip[data-w="2"]').click();
    await new Promise(r => setTimeout(r, 30));
    return { empty, before, after: document.querySelectorAll("#board .fig").length, wk1, wk2: read(),
      standings: [...document.querySelectorAll("#scores .hl-stand")].map(s => [s.querySelector(".hl-name").textContent, s.querySelector("b").textContent, s.querySelector("small").textContent]),
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.match(out.empty, /top Sleeper score takes \$5/, "explains itself before any week has scores");
  assert.equal(out.before, 12); assert.equal(out.after, 12, "the ledger cards keep their four figures; the pool stays out of them");

  // week 1 is final and opens by default (it is the current week in this fixture)
  assert.deepEqual(out.wk1.picker, [["WK 1", "true"], ["WK 2", "false"]], "a chip per week the book has a board for");
  assert.deepEqual(out.wk1.games, [
    [["Alice", "148.4", "proj 121.2", true], ["Cara", "92.1", "proj 110.9", false]],
    [["Bob", "120", "proj 115.5", false], ["ghost", "130.5", "", true]]],
    "paired on Sleeper's matchup id, and a side leads the manager across from it - ghost is ahead of Bob without being the week's best");
  assert.deepEqual(out.wk1.pools, [["High", "Alice", "+$5"], ["Low", "Cara", "−$5"]], "a final week states the pool outright");
  assert.equal(out.wk1.avatars, 4, "every manager wears their avatar, and a name the league does not know falls back to initials");
  assert.match(out.wk1.note, /^WK 1 · final · \$5 a week/);

  // week 2 is live: the pool is provisional and a manager yet to play says so
  assert.deepEqual(out.wk2.picker, [["WK 1", "false"], ["WK 2", "true"]], "the picker follows the click");
  assert.deepEqual(out.wk2.games, [
    [["Alice", "131", "proj 118.5", true], ["Bob", "88.6", "proj 104.2", false]],
    [["Cara", "Yet to play", "proj 99.4", false]]], "a zero is 'yet to play', not a shutout");
  assert.deepEqual(out.wk2.pools, [["High so far", "Alice", "+$5"], ["Low so far", "Bob", "−$5"]],
    "live, it is 'so far', and Cara's nothing-yet is left out of the low");
  assert.match(out.wk2.note, /^WK 2 · in progress/);

  assert.deepEqual(out.standings, [["Alice", "+$10", "2 hi · 0 low"], ["Bob", "−$5", "0 hi · 1 low"], ["Cara", "−$5", "0 hi · 1 low"]],
    "the season pool keeps its standings under the week");
  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});

test("Settle Up: a balance card per manager with hi/low, weekly, season and what's been paid, then the transfers", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = [
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: ["b"] },
      { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] },
    ];
    state.highlow = { weeks: { "1": { high: [{ id: "b", name: "Bob", pts: 140 }], low: [{ id: "c", name: "Cara", pts: 90 }] } } };
    V.render();
    // nobody pays until the season's over: no transfers, no "To clear it", until the champion is named
    const during = { debts: document.querySelectorAll("#settle .debt").length, heads: [...document.querySelectorAll("#settle .bal-head .lbl")].map(x => x.textContent) };
    state.config = { ...state.config, bySeason: { "2026": { payoutWinners: { champ: "b" } } } };
    V.render();
    return { during, table: !!document.querySelector("#settle table"),
      you: document.querySelector("#settle .you-line").textContent,
      balances: [...document.querySelectorAll("#settle .bal")].map(b => [b.querySelector(".bal-name").textContent, b.querySelector("b").textContent, b.classList.contains("me")]),
      lines: [...document.querySelectorAll("#settle .bal")].map(b => [...b.querySelectorAll(".bal-ln")].map(x => x.textContent + (x.querySelector("span") ? ":" + x.querySelector("span").className : ""))),
      transfers: [...document.querySelectorAll("#settle .debt")].map(d => [d.querySelector(".debt-txt").textContent.replace(/^[A-Z]{2}/, "").replace(/→[A-Z]{2}/, "→"), d.querySelector(".debt-amt").textContent]) };
  });
  assert.deepEqual(out.during, { debts: 0, heads: ["Balances · if the season ended now", "Paid so far · 1"] }, "mid-season: balances and the log, no transfers to mark paid");
  assert.equal(out.table, false, "no season table: the cards carry it");
  assert.deepEqual(out.lines, [
    ["hi/low +$5:pos", "side bets −$25:neg", "paid $25"],
    ["hi/low −$5:neg", "side bets +$10:pos"],
    ["hi/low $0:flat", "side bets +$15:pos", "received $25"]], "each card: what its number is made of, and what's already changed hands");
  assert.match(out.you, /You.re down \$10/, "Alice: +25 on the season bet, already paid by Bob, −10 on the weekly one");
  assert.deepEqual(out.balances, [["Bob", "+$5", false], ["Cara", "+$5", false], ["Alice", "−$10", true]], "balances, biggest first: the paid season bet already netted, week-1 high and low folded in");
  assert.deepEqual(out.transfers, [["Alice→Bob", "$5"], ["Alice→Cara", "$5"]], "two transfers clear it");
  // Mark paid records the payment: the transfer goes, the balances move, the log shows it
  await p.evaluate(async () => { const { state } = await import("./state.js?v=dev"); state.local = false; });   // off preview mode; no db, so nothing is written
  await p.$eval('#settle .debt [data-act="pay"]', el => el.click());
  await new Promise(r => setTimeout(r, 30));
  const afterPay = await p.evaluate(() => ({ transfers: document.querySelectorAll("#settle .debt").length, you: document.querySelector("#settle .you-line").textContent, log: [...document.querySelectorAll("#settle .paid")].map(x => x.querySelector(".paid-txt").textContent + " " + x.querySelector("b").textContent), head: document.querySelectorAll("#settle .bal-head")[1].textContent }));
  assert.equal(afterPay.transfers, 1); assert.match(afterPay.you, /You.re down \$5/); assert.match(afterPay.head, /To clear it · 1 payment/);
  assert.deepEqual(afterPay.log.map(l => l.replace(/ · marked by \w+/, "")), ["Alice → Bob $5", "Bob → Alice · from a bet marked paid $25"], "the new payment, then the old per-bet flag as a payment");
  // drill through: Alice's Total cell lists her three lines; the bet line jumps to its ticket
  await p.$eval('#settle .bal b[data-act="drill"][data-m="a"][data-row="total"]', el => el.click());   // the card's number, through the real click wiring
  await p.waitForFunction(() => document.getElementById("drillDlg").open, { timeout: 5000 });
  const drill = await p.evaluate(() => ({
    title: document.getElementById("drillTitle").textContent.replace(/^AL\s*/, ""),
    lines: [...document.querySelectorAll("#drillList .drill")].map(d => [d.querySelector(".wk").textContent, d.querySelector(".drill-txt b").textContent, d.querySelector("b.num").textContent, d.getAttribute("data-id")]),
    net: document.querySelector("#drillList .drill-net b").textContent }));
  assert.equal(drill.title, "Alice · Everything");
  assert.deepEqual(drill.lines, [["WK 2", "", "−$10", "w1"], ["SEASON", "", "+$25", "s1"]], "her weekly loss and season win; no hi/low line since she wasn't high or low");
  assert.equal(drill.net, "+$15");
  await p.$eval('#drillList .drill[data-id="s1"]', el => el.click());
  const jumped = await p.evaluate(() => ({ closed: !document.getElementById("drillDlg").open, flashed: !!document.querySelector('article.ticket[data-bet="s1"].flash') }));
  assert.deepEqual(jumped, { closed: true, flashed: true }, "the line closes the dialog and flashes the ticket");
  assert.deepEqual(errors, []);
  await p.close();
});

test("tabs: Book open by default, the others behind their tabs, badges and the glance strip; the menu behind your name", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = [
      { id: "o1", status: "open", createdBy: "a", week: 5, kind: "prop", amount: 10, name: "Open one", terms: "t", entries: [{ memberId: "a", pick: "x" }, { memberId: null }], paid: [] },
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "b", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: [] },
    ];
    state.highlow = { weeks: { "1": { high: [{ id: "b", pts: 140 }], low: [{ id: "c", pts: 90 }] } } };
    state.sleeper = { byId: {}, league: { season: "2026", teams: 10, keeper: true, sf: true, scoring: "PPR" } };
    state.tab = "book"; V.render();
    const shown = () => [...document.querySelectorAll("section[data-panel]")].filter(s => getComputedStyle(s).display !== "none").map(s => s.getAttribute("data-panel"));
    const badges = () => [...document.querySelectorAll("#tabs .tab")].map(t => [t.getAttribute("data-tab"), t.classList.contains("on"), t.querySelector(".n").hidden ? "" : t.querySelector(".n").textContent]);
    const res = { line: document.getElementById("leagueSub").textContent, glance: document.getElementById("glanceTxt").textContent, shown: shown(), badges: badges(),
      me: document.getElementById("meName").textContent, dropHidden: document.getElementById("meDrop").hidden };
    // dues: nothing until an amount is set; then the league's total, and who's still to pay
    state.config.bySeason = { "2026": { dues: 200, duesPaid: { a: { at: "x" } } } }; V.render();
    const dueSpan = [...document.querySelectorAll("#glanceTxt > span")].find(x => /in dues/.test(x.textContent));
    res.duesPart = dueSpan && [dueSpan.textContent, dueSpan.dataset.tip, getComputedStyle(dueSpan.querySelector("b.warn")).color !== getComputedStyle(dueSpan.querySelector("b")).color];
    state.config.bySeason["2026"].duesPaid = { a: { at: "x" }, b: { at: "x" }, c: { at: "x" } }; V.render();
    res.duesAllPaid = [...document.querySelectorAll("#glanceTxt > span")].map(x => x.textContent).find(t => /in dues/.test(t));
    state.config.bySeason = {}; V.render();
    const w30 = () => new Promise(r => setTimeout(r, 30));
    const subs = () => [...document.querySelectorAll("#subTabs button")].map(b => [b.firstChild.textContent, b.getAttribute("aria-pressed") === "true", (b.querySelector(".n") || {}).textContent || ""]);
    res.subHiddenOnBook = document.getElementById("subTabs").hidden;
    document.querySelector('#tabs .tab[data-tab="money"]').click(); await w30();
    res.afterClick = { shown: shown(), on: badges().filter(b => b[1]).map(b => b[0]), saved: localStorage.getItem("smyrna.tab") };
    res.moneySubs = subs(); res.subStyle = getComputedStyle(document.getElementById("subTabs")).display;
    document.querySelector('#subTabs [data-tab="ledger"]').click(); await w30();
    res.ledger = { shown: shown(), saved: localStorage.getItem("smyrna.tab") };
    document.querySelector('#tabs .tab[data-tab="rivals"]').click(); await w30();
    res.rivalsSubs = subs().map(s => s[0]); res.rivalsShown = shown();
    document.querySelector('#tabs .tab[data-tab="money"]').click(); await w30();
    res.backToMoney = shown();
    document.getElementById("meBtn").click(); res.dropOpen = !document.getElementById("meDrop").hidden;
    document.body.click(); res.dropClosed = document.getElementById("meDrop").hidden;
    return res;
  });
  assert.equal(out.line, "2026 · 10-Team Keeper SF PPR · side bets", "the league's settings from Sleeper");
  assert.equal(out.glance, "1 bet running$10 on the tableyou −$25 net · 1 seat waiting on takers"); // no dues amount set: nothing about dues
  assert.deepEqual(out.duesPart, ["$600 in dues · 1 of 3 paid", "2026 league dues: $200 × 3 managers", true], "the league's total, and the unpaid count stands out");
  assert.equal(out.duesAllPaid, "$600 in dues", "everyone paid: just the total");
  assert.deepEqual(out.shown, ["book"]);
  assert.deepEqual(out.badges, [["book", true, "1"], ["money", false, "2"], ["rivals", false, "7"], ["league", false, "1"]], "four tabs: a seat open, two transfers to clear, a rivalry you're behind on plus six titles held, a week in");
  assert.equal(out.me, "Alice"); assert.equal(out.dropHidden, true);
  assert.deepEqual(out.afterClick, { shown: ["settle"], on: ["money"], saved: "settle" }, "Money opens on Settle up, through the real click wiring, and is remembered");
  assert.equal(out.subHiddenOnBook, true, "the Book has no sub-tabs");
  assert.deepEqual(out.moneySubs, [["Settle up", true, "2"], ["Ledger", false, ""]], "League-style sub-tabs, each with its own count"); assert.notEqual(out.subStyle, "none");
  assert.deepEqual(out.ledger, { shown: ["ledger"], saved: "ledger" });
  assert.deepEqual(out.rivalsSubs, ["Head to head", "Badges"]); assert.deepEqual(out.rivalsShown, ["rivals"]);
  assert.deepEqual(out.backToMoney, ["ledger"], "a tab reopens on the screen you left it on");
  assert.equal(out.dropOpen, true); assert.equal(out.dropClosed, true, "the menu opens on its button and closes on a click elsewhere");
  assert.deepEqual(errors, []);
  await p.close();
});

test("League dialog: when each manager was last in", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const D = await import("./dialogs.js?v=dev");
    state.seen = { a: new Date(Date.now() - 5 * 60e3).toISOString(), b: "2026-09-01T18:00:00Z" };
    D.drawRoster();
    return [...document.querySelectorAll("#rosterList .rrow")].map(r => { const s = r.querySelector(".r-seen"); return [r.querySelector(".r-name").textContent, s.textContent, !!s.dataset.tip]; });
  });
  assert.deepEqual(out, [["Alice", "Last in 5m ago", true], ["Bob", "Last in Sep 1", true], ["Cara", "Never signed in", false]]);
  assert.deepEqual(errors, []);
  await p.close();
});

test("League dialog: dues paid per season — an admin taps to change it, everyone else sees it, a new season starts unpaid", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const D = await import("./dialogs.js?v=dev");
    state.config.members = [{ id: "a", name: "Alice", seasons: ["2026", "2027"] }, { id: "b", name: "Bob", seasons: ["2026"] }, { id: "c", name: "Cara", seasons: ["2026", "2027"] }, { id: "t", name: "Testy", test: true }];
    const rows = () => [...document.querySelectorAll("#rosterList .rrow")].map(r => { const d = r.querySelector(".r-dues"); return [r.querySelector(".r-name").textContent, d ? d.tagName + ":" + d.textContent : ""]; });
    const sum = () => document.getElementById("rDues").textContent;
    const res = {};
    state.admin = true; D.drawRoster(); res.adminBefore = rows(); res.sumBefore = sum();
    document.querySelector('#rosterList [data-act="duesToggle"][data-id="b"]').click();
    document.querySelector('#rosterList [data-act="duesToggle"][data-id="c"]').click();
    res.adminAfter = rows(); res.sumAfter = sum();
    const paid = document.querySelector('#rosterList .r-dues.paid');
    res.paidStyle = [getComputedStyle(paid).backgroundColor !== getComputedStyle(document.querySelector('#rosterList .r-dues:not(.paid)')).backgroundColor];
    res.record = Object.keys(state.config.bySeason["2026"].duesPaid).sort();
    state.admin = false; state.me = "a"; D.drawRoster(); res.manager = rows();
    document.querySelector("#rosterList .r-dues").click(); res.managerCantChange = Object.keys(state.config.bySeason["2026"].duesPaid).length;
    // the next season: its own list, everyone unpaid, last year's record kept
    state.config.season = "2027"; state.season = null; state.admin = true; D.drawRoster(); res.next = rows(); res.nextSum = sum();
    res.lastYearKept = Object.keys(state.config.bySeason["2026"].duesPaid).sort();
    // what goes to Firestore: that one entry as a merge, never the whole league record
    const B = await import("./book.js?v=dev"); const sent = [];
    state.local = false; state.db = { doc: path => ({ update: d => { sent.push(["update", path, JSON.parse(JSON.stringify(d))]); return Promise.resolve(); }, set: d => { sent.push(["set", path]); return Promise.resolve(); } }) };
    B.saveDues("2027", "a", true); B.saveDues("2027", "a", false);
    state.local = true; state.db = null;
    res.sent = sent.map(x => x[0] === "update" ? [x[0], x[1], Object.keys(x[2]), Object.keys(x[2].bySeason), Object.keys(x[2].bySeason["2027"].duesPaid), x[2].bySeason["2027"].duesPaid.a === null ? "null" : "paid"] : x);
    return res;
  });
  assert.equal(out.sumBefore, "· 2026 dues · 0 of 3 paid");
  assert.deepEqual(out.adminBefore, [["Alice", "BUTTON:Dues unpaid"], ["Bob", "BUTTON:Dues unpaid"], ["Cara", "BUTTON:Dues unpaid"], ["Testy", ""]], "a test account owes nothing");
  assert.deepEqual(out.adminAfter.slice(0, 3), [["Alice", "BUTTON:Dues unpaid"], ["Bob", "BUTTON:Dues paid"], ["Cara", "BUTTON:Dues paid"]]);
  assert.equal(out.sumAfter, "· 2026 dues · 2 of 3 paid"); assert.deepEqual(out.paidStyle, [true], "paid looks different on screen");
  assert.deepEqual(out.record, ["b", "c"]);
  assert.deepEqual(out.manager, [["Alice", "SPAN:Dues unpaid"], ["Bob", "SPAN:Dues paid"], ["Cara", "SPAN:Dues paid"]], "a manager sees it but can't press it");
  assert.equal(out.managerCantChange, 2);
  assert.deepEqual(out.next, [["Alice", "BUTTON:Dues unpaid"], ["Bob", ""], ["Cara", "BUTTON:Dues unpaid"], ["Testy", ""]], "2027 is Alice and Cara, both unpaid; Bob didn't play");
  assert.equal(out.nextSum, "· 2027 dues · 0 of 2 paid");
  assert.deepEqual(out.lastYearKept, ["b", "c"]);
  assert.deepEqual(out.sent, [["update", "league/config", ["bySeason"], ["2027"], ["a"], "paid"], ["update", "league/config", ["bySeason"], ["2027"], ["a"], "null"]], "each tap writes only its own entry");
  assert.deepEqual(errors, []);
  await p.close();
});

test("League dialog: the season's dues amount sits with the league settings; an admin sets it, Save keeps it per season", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const D = await import("./dialogs.js?v=dev");
    state.config.members = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }];
    state.config.bySeason = { "2027": { leagueId: "L27" } };
    const amt = () => document.getElementById("rDuesAmt"), res = {};
    state.admin = false; D.openRoster(); res.manager = [document.getElementById("rDuesLbl").textContent, amt().value, amt().disabled];
    document.getElementById("rosterDlg").close();
    state.admin = true; D.openRoster(); res.adminEnabled = !amt().disabled;
    amt().value = "200"; document.getElementById("rSave").click();
    res.saved = state.config.bySeason["2026"].dues; res.other = state.config.bySeason["2027"];
    D.openRoster(); res.reopened = [amt().value, document.getElementById("rDues").textContent];
    res.rect = amt().getBoundingClientRect().width > 50;
    document.getElementById("rosterDlg").close();
    state.config.season = "2027"; state.season = null; D.openRoster(); res.next = [document.getElementById("rDuesLbl").textContent, amt().value];
    amt().value = ""; document.getElementById("rSave").click(); res.nextSaved = "dues" in state.config.bySeason["2027"];
    return res;
  });
  assert.deepEqual(out.manager, ["2026 league dues", "", true], "a manager sees it, can't type in it");
  assert.equal(out.adminEnabled, true);
  assert.equal(out.saved, 200); assert.deepEqual(out.other, { leagueId: "L27" }, "another season's settings untouched");
  assert.deepEqual(out.reopened, ["200", "· 2026 dues $200 · 0 of 2 paid"]); assert.equal(out.rect, true);
  assert.deepEqual(out.next, ["2027 league dues", ""], "2027 has its own amount, none set yet");
  assert.equal(out.nextSaved, false, "blank sets nothing");
  assert.deepEqual(errors, []);
  await p.close();
});

test("how it's scored: on every ticket, live in the propose form, and in the Join dialog", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev"); const F = await import("./forms.js?v=dev");
    const g = { id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" };
    state.bets = [
      { id: "t1", status: "active", week: 5, kind: "matchup", amount: 10, name: "NE @ SEA", terms: "t", game: g, market: "total", line: 44.5, entries: [{ memberId: "a", side: "over" }, { memberId: "b", side: "under" }], paid: [] },
      { id: "s1", status: "open", week: 5, kind: "prop", amount: 10, name: "Yards", terms: "t", joinable: true, tiebreak: true, stats: { scope: "player", tracks: [{ stat: "rec_yd", metric: "Receiving yards" }, { stat: "rec", metric: "Receptions" }], rows: [] },
        entries: [{ memberId: "b", picks: [{ id: "3", name: "Drake Maye", pos: "QB", team: "NE" }] }], paid: [] } ];
    V.render();
    const res = { tickets: ["t1", "s1"].map(id => (document.querySelector(`article.ticket[data-bet="${id}"] .scoring`) || {}).textContent) };
    res.ticketStyle = getComputedStyle(document.querySelector("article.ticket .scoring")).display !== "none";
    // the propose form: the wording follows the choices
    const wk = document.getElementById("bWeek"); wk.innerHTML = '<option value="6">Week 6</option>'; wk.value = "6";
    document.getElementById("bMatch").innerHTML = '<option value="count"></option><option value="field"></option>';
    state.editId = null; state.draftScope = "player"; state.draftStats = ["rec_yd"]; state.draft = [{ memberId: "a", pick: "", picks: [] }];
    F.drawScope(); F.drawEntries(); const box = document.getElementById("bScoring");
    res.oneStat = box.textContent;
    document.querySelector('#bStats .chip[data-stat="rec"]').click(); res.twoStats = box.textContent;
    state.draftScope = "game"; state.draftGame = g; state.draftMarket = "spread"; state.draftLine = "3.5"; state.draftFav = "SEA"; F.drawScope(); F.drawEntries();
    res.spread = box.textContent;
    // joining the stat bet
    // (opening it reads nothing from the server, but the preview guard would stop it)
    state.me = "a"; state.local = false; F.openJoinDlg("s1"); state.local = true;
    res.join = document.getElementById("jScoring").textContent; document.getElementById("joinDlg").close();
    return res;
  });
  assert.deepEqual(out.tickets, ["How it’s scored Both teams' final points are added together. Over 44.5 wins if the total is higher, Under if it's lower. Exactly 44.5 is a push.",
    "How it’s scored Each stat is its own contest in Week 5: receiving yards and receptions. Whoever wins more of them takes it. However many join, the one leader takes every stake. A stat that ends tied counts for nobody. If the stats won are level, the first one listed (receiving yards) decides it; if that's tied too, it's a push. Settles once every game that week is final."]);
  assert.equal(out.ticketStyle, true);
  assert.match(out.oneStat, /Most receiving yards in Week 6 wins\./);
  assert.match(out.twoStats, /Each stat is its own contest in Week 6: receptions and receiving yards\..*the first one listed \(receptions\) decides it/, "adding a stat rewrites it, in the order the ticket lists them");
  assert.match(out.spread, /SEA has to win by more than 3\.5 to cover; anything else and NE covers\./);
  assert.match(out.join, /Each stat is its own contest in Week 5/);
  assert.deepEqual(errors, []);
  await p.close();
});

test("dues payouts: set in the League dialog; on Settle Up the treasurer, the places and their winners, and a Dues row in the season table", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const D = await import("./dialogs.js?v=dev"); const V = await import("./render.js?v=dev");
    state.config.members = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }];
    state.config.bySeason = { "2026": { dues: 200, duesPaid: { a: { at: "x" }, b: { at: "x" }, c: { at: "x" } } } };
    const res = {};
    // the League dialog: an admin sets the treasurer and the four places
    state.admin = true; D.openRoster();
    res.fields = [...document.querySelectorAll("#rPayouts label > span:first-child")].map(s => s.textContent);
    document.getElementById("rTreasurer").value = "c";
    const set = (k, v) => { document.querySelector('#rPayouts [data-payout="' + k + '"]').value = v; };
    set("reg1", "300"); set("reg2", "150"); set("reg3", "50"); set("champ", "100");
    document.getElementById("rSave").click();
    res.saved = state.config.bySeason["2026"];
    // Settle Up, as an admin: pick winners
    state.tab = "settle"; V.render();
    const card = () => document.querySelector("#settle .dues-card");
    res.cardTop = card().querySelector(".dues-top").textContent;
    const pick = (place, id) => { const s = card().querySelector('select[data-place="' + place + '"]'); s.value = id; s.dispatchEvent(new Event("change", { bubbles: true })); };
    state.local = false; pick("reg1", "a"); pick("champ", "a"); pick("reg2", "b"); state.local = true;   // past the preview guard; there is no db to write to
    res.winners = Object.assign({}, state.config.bySeason["2026"].payoutWinners);
    // everyone else: names, not selects
    state.admin = false; state.me = "a"; V.render();
    const who = el => (el.querySelector(".dues-winner, .dues-tbd") || {}).lastChild.textContent;
    res.podium = [...card().querySelectorAll(".podium .step")].map(s => [s.querySelector(".step-place").textContent, who(s), s.querySelector(".step-block b").textContent, !!s.querySelector("select")]);
    res.stepHeights = [...card().querySelectorAll(".podium .step-block")].map(x => parseFloat(getComputedStyle(x).height));   // the app is off screen in this test, so the style, not the rect
    const champ = card().querySelector(".brk-champ");
    res.champ = [champ.querySelector("b").textContent, who(champ)];
    res.bracket = [[...card().querySelectorAll(".brk-h")].map(x => x.textContent), [...card().querySelectorAll(".brk-col.r1 .brk-name, .brk-col.r2 .brk-name")].map(x => x.textContent), [...card().querySelectorAll(".brk-tag")].map(x => x.textContent)];
    res.note = card().querySelector(".dues-note").textContent;
    res.cards = Object.fromEntries([...document.querySelectorAll("#settle .bal")].map(b => [b.dataset.m, [b.querySelector("b").textContent, b.querySelector('.bal-ln[data-row="dues"]').textContent, !!b.querySelector(".bal-ln.dues")]]));
    res.you = (document.querySelector("#settle .you-dues") || {}).textContent;
    res.transfers = [...document.querySelectorAll("#settle .debt")].length;
    // the drill-through behind Alice's dues cell
    document.querySelector('#settle .bal-ln[data-m="a"][data-row="dues"]').click();
    res.drill = [...document.querySelectorAll("#drillList .drill:not(.pending)")].map(d => d.querySelector("b").textContent + " | " + d.querySelector("small").textContent + " | " + d.querySelector(".num").textContent);   // what was won; what is still to come sits below
    document.getElementById("drillDlg").close();
    return res;
  });
  assert.deepEqual(out.fields, ["Treasurer · pays them out", "Regular season · 1st", "Regular season · 2nd", "Regular season · 3rd", "Playoff champion"]);
  assert.deepEqual({ treasurer: out.saved.treasurer, payouts: out.saved.payouts }, { treasurer: "c", payouts: { reg1: 300, reg2: 150, reg3: 50, champ: 100 } });
  assert.match(out.cardTop, /Cara.*Treasurer · holds the dues and pays them out.*\$600.*\$200 × 3 · all paid/);
  assert.deepEqual(out.winners, { reg1: "a", champ: "a", reg2: "b" });
  assert.deepEqual(out.podium, [["2nd", "Bob", "$150", false], ["1st", "Alice", "$300", false], ["3rd", "decided at season’s end", "$50", false]], "a podium: 2nd, 1st, 3rd");
  assert.equal(out.stepHeights[1] > out.stepHeights[0] && out.stepHeights[0] > out.stepHeights[2], true, "1st stands tallest, then 2nd, then 3rd");
  assert.deepEqual(out.champ, ["$100", "Alice"], "the bracket ends in the champion");
  assert.deepEqual(out.bracket, [["Round 1 · Week 15", "Semifinals · Week 16", "Final · Week 17", "Champion"], ["Seed 4", "Seed 5", "Seed 3", "Seed 6", "Seed 1", "Winner 4 / 5", "Seed 2", "Winner 3 / 6"], ["$50", "$300", "$150"]], "six seeds, 1 and 2 on a bye, the top three wearing their regular-season money");
  assert.match(out.note, /One manager can win a regular-season place and the playoff pool\..*balance card, but Cara pays it from the dues/);
  assert.deepEqual(out.cards, { a: ["$0", "dues +$400", true], b: ["$0", "dues +$150", true], c: ["$0", "dues $0", false] }, "every card shows its dues once payouts are set; gold only for a winner; "+"the dues each won sit on the card, outside the number the managers settle between them");
  assert.match(out.you, /plus \$400 in dues payouts, from Cara/);
  assert.equal(out.transfers, 0, "dues aren't a manager-to-manager transfer");
  assert.deepEqual(out.drill, ["League dues · Regular season · 1st | paid by Cara | +$300", "League dues · Playoff champion | paid by Cara | +$100"]);
  assert.deepEqual(errors, []);
  await p.close();
});

test("a balance card's drill-in: settled lines and their net, then what's still in play — live and open bets, dues paid in, places not decided", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const D = await import("./dialogs.js?v=dev");
    state.config.bySeason = { "2026": { dues: 200, duesPaid: { a: { at: "x" } }, treasurer: "c", payouts: { reg1: 800, champ: 600 }, payoutWinners: { champ: "b" } } };
    state.bets = [
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", name: "Season win", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
      { id: "l1", status: "active", week: 3, amount: 10, name: "Live pot", entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }], paid: [] },
      { id: "o1", status: "open", week: 4, amount: 5, name: "Open one", entries: [{ memberId: "a" }, { memberId: null }], paid: [] },
      { id: "x1", status: "active", week: 3, amount: 50, name: "Not hers", entries: [{ memberId: "b" }, { memberId: "c" }], paid: [] } ];
    const read = () => ({ settled: [...document.querySelectorAll("#drillList .drill:not(.pending)")].map(d => d.querySelector(".drill-txt b").textContent + " " + d.querySelector("b.num").textContent),
      net: (document.querySelector("#drillList .drill-net b") || {}).textContent, empty: (document.querySelector("#drillList .empty") || {}).textContent,
      sec: (document.querySelector("#drillList .drill-sec") || {}).textContent,
      secs: [...document.querySelectorAll("#drillList .drill-sec")].map(s => s.textContent),
      pending: [...document.querySelectorAll("#drillList .drill.pending")].map(d => [d.querySelector(".drill-txt b").textContent, d.querySelector("small").textContent, d.querySelector("b.num").textContent, d.dataset.id || ""]) });
    const res = {};
    D.openDrill("a", "bets"); res.bets = read(); document.getElementById("drillDlg").close();
    D.openDrill("a", "dues"); res.dues = read(); document.getElementById("drillDlg").close();
    D.openDrill("c", "hl"); res.hl = read(); document.getElementById("drillDlg").close();
    return res;
  });
  assert.deepEqual(out.bets.settled, ["Season win +$25"]); assert.equal(out.bets.net, "+$25");
  assert.equal(out.bets.sec, "In play · not counted yet");
  assert.deepEqual(out.bets.pending, [["Live pot", "live · wins $20", "$10 at stake", "l1"], ["Open one", "waiting on takers", "$5 at stake", "o1"]], "her live and open bets, not anyone else's; each opens its ticket");
  assert.equal(out.dues.empty, "No payouts won yet.");
  assert.deepEqual(out.dues.secs, ["Paid in", "In play · not counted yet"]);
  assert.deepEqual(out.dues.pending, [["2026 league dues", "paid in · to Cara", "$200", ""], ["League dues · Regular season · 1st", "decided at season’s end", "$800", ""]], "what she paid in on its own, then the place still open; the champion is decided, so it's not pending");
  assert.equal(out.hl.sec, undefined, "hi / low has nothing in play"); assert.equal(out.hl.empty, "Nothing here yet.");
  assert.deepEqual(errors, []);
  await p.close();
});

test("offense stat: a fourth scope, teams in the search, one team a side, and a scoring line about the team", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev"); const V = await import("./render.js?v=dev");
    const res = { scopes: [...document.querySelectorAll("#bScope .chip")].map(c => c.dataset.scope + ":" + c.textContent) };
    const wk = document.getElementById("bWeek"); wk.innerHTML = '<option value="6">Week 6</option>'; wk.value = "6";
    document.getElementById("bMatch").innerHTML = '<option value="count"></option>';
    state.editId = null; state.draftScope = "offense"; state.draftStats = []; state.draft = [{ memberId: "a", pick: "", picks: [] }];
    F.drawScope(); F.drawEntries();
    res.stats = [...document.querySelectorAll("#bStats .chip")].map(c => c.textContent);
    res.placeholder = document.querySelector('#bEntries [data-act="dSearch"]').placeholder;
    res.filters = document.getElementById("bPickFilters").hidden;
    F.drawSugg(0, "sea"); res.sugg = [...document.querySelectorAll("#bEntries #sugg0 button")].map(b => b.dataset.id);
    F.addPick(0, "SEA"); F.addPick(0, "KC"); res.oneASide = state.draft[0].picks.map(x => x.id);
    document.getElementById("bName").value = ""; document.getElementById("bAmt").value = "10";
    F.submitBet(); const bet = state.bets[0];
    res.saved = bet && { scope: bet.stats.scope, tracks: bet.stats.tracks.map(t => t.stat), rows: bet.stats.rows.map(r => r.key), hasMatch: "match" in bet };
    V.render(); res.scoring = (document.querySelector("article.ticket .scoring") || {}).textContent;
    return res;
  });
  assert.deepEqual(out.scopes, ["player:Player stat", "offense:Offense stat", "team:Defense stat", "game:A game"]);
  assert.deepEqual(out.stats, ["Points scored", "Total yards", "Passing yards", "Rushing yards", "Turnovers"]);
  assert.equal(out.placeholder, "Search a team…"); assert.equal(out.filters, true, "no player filters on a team bet");
  assert.deepEqual(out.sugg, ["SEA"], "teams, found by name or code");
  assert.deepEqual(out.oneASide, ["KC"], "one team a side: a second pick replaces the first");
  assert.deepEqual(out.saved, { scope: "offense", tracks: ["off_pts"], rows: ["KC"], hasMatch: false }, "sides-must-match is a player bet's question");
  assert.match(out.scoring, /Most points scored in Week 6 wins\./);
  assert.deepEqual(errors, []);
  await p.close();
});

test("notifications: the menu button says where they stand; the nudge shows once and takes 'not now'", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev"); const Nf = await import("./notify.js?v=dev");
    state.local = false; state.connected = true; state.db = { doc() { return { update: () => Promise.resolve(), get: () => Promise.resolve({ exists: false }) }; } };
    const btn = document.getElementById("pushBtn"), res = {};
    V.render();
    res.status = Nf.status(); res.btn = [btn.hidden, btn.textContent, btn.getAttribute("data-push")];
    const nudge = document.querySelector("#banner .banner");
    res.nudge = nudge ? [nudge.querySelector(".lbl").textContent, [...nudge.querySelectorAll("button")].map(b => b.textContent)] : null;
    document.querySelector('#banner [data-act="pushLater"]').click();
    await new Promise(r => setTimeout(r, 30));
    res.afterLater = [!!document.querySelector("#banner .banner"), !!localStorage.getItem("smyrna.pushNudge")];
    state.local = true; V.render(); res.localHidden = btn.hidden;
    localStorage.removeItem("smyrna.pushNudge");   // pages share this origin's storage
    return res;
  });
  assert.equal(out.status, "off", "headless Chrome on localhost supports push and hasn't been asked");
  assert.deepEqual(out.btn, [false, "Notifications off", "off"]);
  assert.deepEqual(out.nudge, ["Heads up", ["Turn on", "Not now"]]);
  assert.deepEqual(out.afterLater, [false, true], "'not now' clears the nudge and is remembered on this device");
  assert.equal(out.localHidden, true, "nothing to turn on while the book is only local");
  assert.deepEqual(errors, []);
  await p.close();
});

test("notifications on an iPhone in Safari: the button and the nudge lead to the home-screen steps, passcode included", { skip }, async () => {
  const { p, errors } = await page("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev"); const Nf = await import("./notify.js?v=dev");
    localStorage.setItem("smyrna.sidebook.key.v1", "test-passcode-42"); localStorage.removeItem("smyrna.pushNudge");
    state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    V.render();
    const btn = document.getElementById("pushBtn"), res = { status: Nf.status(), btn: [btn.hidden, btn.textContent], nudgeBtn: document.querySelector('#banner [data-act="push"]').textContent };
    btn.click();
    await new Promise(r => setTimeout(r, 30));
    const dlg = document.getElementById("pushDlg");
    res.dlg = [dlg.open, dlg.querySelectorAll("#pushBody .steps li").length, /Add to Home Screen/.test(dlg.textContent), /test-passcode-42/.test(dlg.textContent)];
    return res;
  });
  assert.equal(out.status, "install");
  assert.deepEqual(out.btn, [false, "Get notifications"]); assert.equal(out.nudgeBtn, "Show me");
  assert.deepEqual(out.dlg, [true, 3, true, true], "the dialog opens with the three steps and this phone's passcode");
  assert.deepEqual(errors, []);
  await p.close();
});

// The same league the first test uses, as a phone sees it.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
async function phoneState(p) {
  await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const h2h = { id: "h", status: "open", createdBy: "b", week: 5, kind: "matchup", amount: 10, name: "NE @ SEA", terms: "Straight up.",
      game: { id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" }, market: "ml",
      entries: [{ memberId: "b", side: "NE", pick: "New England Patriots" }, { memberId: null, side: "SEA", pick: "Seattle Seahawks" }], paid: [] };
    const pot = { id: "p", status: "active", createdBy: "b", week: 5, kind: "prop", amount: 10, name: "Pot", terms: "Most receiving yards.", joinable: false,
      stats: { scope: "player", tracks: [{ stat: "rec_yd", metric: "Rec yds" }], rows: [
        { id: "2", label: "Ja'Marr Chase", team: "CIN", memberId: "b", values: {} }, { id: "3", label: "Drake Maye", team: "NE", memberId: "c", values: {} }] },
      entries: [{ memberId: "b", picks: [{ id: "2", name: "Ja'Marr Chase", pos: "WR", team: "CIN" }] }, { memberId: "c", picks: [{ id: "3", name: "Drake Maye", pos: "QB", team: "NE" }] }], paid: [] };
    const done = { id: "d", status: "settled", createdBy: "b", week: 1, kind: "prop", amount: 10, name: "Done", terms: "t", winner: "b", entries: [{ memberId: "b", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] };
    state.bets = [h2h, pot, done]; state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    localStorage.setItem("smyrna.pushNudge", "x");
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;   // rects need the app on screen
    V.render();
  });
}

test("phone: tabs sit in a bar at the bottom, Propose floats, tickets fold and open on a tap, the ledger is a list", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  await phoneState(p);
  const out = await p.evaluate(async () => {
    const cs = (el) => getComputedStyle(el), res = {}, wait = () => new Promise(r => setTimeout(r, 30));
    const tabs = document.getElementById("tabs"), r = tabs.getBoundingClientRect();
    const tt = [...tabs.querySelectorAll(".tab")];
    res.tabs = { position: cs(tabs).position, atBottom: Math.round(r.bottom) === innerHeight,
      fits: tt.every(t => t.getBoundingClientRect().right <= innerWidth + 1),
      oneRow: new Set(tt.map(t => Math.round(t.getBoundingClientRect().top))).size === 1,
      count: tt.length };
    res.fab = cs(document.getElementById("newBetBtn")).position;
    res.refresh = document.getElementById("refreshBtn").textContent;
    res.filtersNoWrap = cs(document.getElementById("filters")).flexWrap;
    const tk = (id) => document.querySelector('article.ticket[data-bet="' + id + '"]');
    res.open = { fold: tk("h").classList.contains("fold"), foldBtn: !!tk("h").querySelector(".t-fold") };
    res.pot = { fold: tk("p").classList.contains("fold"), desc: cs(tk("p").querySelector(".bet-desc")).display, sides: cs(tk("p").querySelector(".sides")).display, rows: tk("p").querySelectorAll(".srow").length, bar: cs(tk("p").querySelector(".sbar")).display, btn: tk("p").querySelector(".t-fold").textContent };
    tk("p").querySelector(".t-fold").click(); await wait();
    res.potOpen = { fold: tk("p").classList.contains("fold"), desc: cs(tk("p").querySelector(".bet-desc")).display, btn: tk("p").querySelector(".t-fold").textContent };
    tk("d").querySelector(".terms").click(); await wait();   // a tap on the body of a folded ticket
    res.doneOpen = !tk("d").classList.contains("fold");
    document.querySelector('#tabs .tab[data-tab="money"]').click(); await wait();
    document.querySelector('#subTabs [data-tab="ledger"]').click(); await wait();
    const seat = document.querySelector(".board .seat"), zero = document.querySelector(".board .fig.prop.zero");   // Bob proposed a bet, so look past his row
    res.seat = { grid: cs(seat).display, propHidden: zero ? cs(zero).display : "n/a", picks: cs(seat.querySelector(".seat-picks")).display };
    seat.click(); await wait();
    res.seatOpen = cs(document.querySelector(".board .seat .seat-picks")).display;
    document.querySelector('#subTabs [data-tab="settle"]').click(); await wait();
    const cards = [...document.querySelectorAll("#settle .bal")];
    res.cards = { count: cards.length, oneColumn: new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size === 1, fits: cards.every(c => c.getBoundingClientRect().right <= innerWidth), pieces: document.querySelectorAll('#settle .bal-ln[data-act="drill"]').length, scrollsSideways: document.documentElement.scrollWidth > innerWidth };
    document.getElementById("newBetBtn").click(); await new Promise(r => setTimeout(r, 60));
    const dlg = document.getElementById("betDlg"); res.dialog = { w: Math.round(dlg.getBoundingClientRect().width), sticky: cs(dlg.querySelector(".form-foot")).position };
    dlg.close();
    return res;
  });
  assert.deepEqual(out.tabs, { position: "fixed", atBottom: true, fits: true, oneRow: true, count: 4 }, "all four tabs on one fixed row at the bottom");
  assert.equal(out.fab, "fixed"); assert.equal(out.refresh, "\u21bb"); assert.equal(out.filtersNoWrap, "nowrap");
  assert.deepEqual(out.open, { fold: false, foldBtn: false }, "a ticket still looking for people never folds");
  assert.deepEqual(out.pot, { fold: true, desc: "none", sides: "none", rows: 2, bar: "none", btn: "Details" }, "folded: the stat rows carry the sides and their numbers, no bars, no terms");
  assert.deepEqual(out.potOpen, { fold: false, desc: "block", btn: "Less" });
  assert.equal(out.doneOpen, true, "a tap anywhere on a folded ticket opens it");
  assert.deepEqual(out.seat, { grid: "grid", propHidden: "none", picks: "none" }, "ledger rows hide empty proposed/cancelled and the bet names");
  assert.equal(out.seatOpen, "block");
  assert.deepEqual(out.cards, { count: 3, oneColumn: true, fits: true, pieces: 6, scrollsSideways: false }, "Settle Up on a phone: a card a row, each piece tappable, nothing off the side");
  assert.deepEqual(out.dialog, { w: 390, sticky: "sticky" }, "dialogs fill the screen with the buttons pinned");
  assert.deepEqual(errors, []);
  await p.close();
});

test("desktop is untouched: no folding, tabs in the panel, the season table with managers across", { skip }, async () => {
  const { p, errors } = await page(null, { width: 1200, height: 900 });
  await phoneState(p);
  const out = await p.evaluate(async () => {
    const cs = (el) => getComputedStyle(el);
    document.querySelector('#tabs .tab[data-tab="money"]').click(); await new Promise(r => setTimeout(r, 30));
    return { fold: !!document.querySelector("article.ticket.fold"), foldBtn: cs(document.querySelector(".t-fold")).display, tabs: cs(document.getElementById("tabs")).position, fab: cs(document.getElementById("newBetBtn")).position,
      cards: document.querySelectorAll("#settle .bal .bal-lines").length > 0, refresh: document.getElementById("refreshBtn").textContent };
  });
  assert.deepEqual(out, { fold: false, foldBtn: "none", tabs: "static", fab: "static", cards: true, refresh: "Refresh stats" });
  assert.deepEqual(errors, []);
  await p.close();
});

// A player against the field: the four field rows share one seat.
const FIELD = { id: "f", status: "active", createdBy: "b", week: 0, kind: "prop", amount: 25, name: "White Men Can Catch", terms: "McConkey vs the field.",
  stats: { scope: "player", tracks: [{ stat: "pts_ppr", metric: "PPR points · best of each side", lower: false }], rows: [
    { key: "1", label: "McConkey", team: "LAC", memberId: "b", entry: 0, values: { pts_ppr: 0 } },
    { key: "2", label: "Pierce", team: "IND", memberId: "c", entry: 1, values: { pts_ppr: 0 } },
    { key: "3", label: "Kupp", team: "SEA", memberId: "c", entry: 1, values: { pts_ppr: 5.5 } },
    { key: "4", label: "Bech", team: "LV", memberId: "c", entry: 1, values: { pts_ppr: 0 } },
    { key: "5", label: "TeSlaa", team: "DET", memberId: "c", entry: 1, values: { pts_ppr: 2 } }], through: "Through week 1", source: "Sleeper" },
  entries: [{ memberId: "b", picks: [{ id: "1", name: "Ladd McConkey", pos: "WR", team: "LAC" }] },
            { memberId: "c", picks: [{ id: "2", name: "Alec Pierce" }, { id: "3", name: "Cooper Kupp" }, { id: "4", name: "Jack Bech" }, { id: "5", name: "Isaac TeSlaa" }] }], paid: [] };

test("a player against the field: one row per side with the side's best, the field's players under it, best first", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (FIELD) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = [FIELD]; V.render();
    const t = document.querySelector('article.ticket[data-bet="f"]');
    const sides = [...t.querySelectorAll(".srow.side-row")].map(r => [r.querySelector(".s-lab").textContent, r.querySelector("b").firstChild.textContent, r.classList.contains("lead"), !!r.querySelector(".sbar")]);
    const subs = [...t.querySelectorAll(".srow.sub")].map(r => [r.querySelector(".s-lab").textContent, r.querySelector("b").firstChild.textContent, r.classList.contains("counts"), !!r.querySelector(".sbar")]);
    return { sides, subs, plain: t.querySelectorAll(".srow:not(.side-row):not(.sub)").length };
  }, FIELD);
  assert.deepEqual(out.sides, [["McConkey", "0", false, true], ["The field · best of 4", "5.5", true, true]], "two sides, the field scored by its best player, and leading");
  assert.deepEqual(out.subs, [["Kupp", "5.5", true, false], ["TeSlaa", "2", false, false], ["Pierce", "0", false, false], ["Bech", "0", false, false]], "the field's players best first, the one counting marked, no bars");
  assert.equal(out.plain, 0);
  assert.deepEqual(errors, []);
  await p.close();
});

test("phone: a folded field bet shows the two sides and hides the field's players", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  await p.evaluate(async (FIELD) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = [FIELD]; state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    localStorage.setItem("smyrna.pushNudge", "x");
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render();
  }, FIELD);
  const out = await p.evaluate(() => {
    const t = document.querySelector('article.ticket[data-bet="f"]'), cs = (el) => getComputedStyle(el).display;
    return { fold: t.classList.contains("fold"), sides: [...t.querySelectorAll(".srow.side-row")].map(cs), subs: [...t.querySelectorAll(".srow.sub")].map(cs) };
  });
  assert.deepEqual(out, { fold: true, sides: ["grid", "grid"], subs: ["none", "none", "none", "none"] });
  assert.deepEqual(errors, []);
  await p.close();
});

// Alice beat Bob twice and lost a pot to Cara; Cara's pot beat everyone.
const RIVAL_BETS = [
  { id: "r1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "a", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
  { id: "r2", status: "settled", week: 2, name: "Gun Slinger", amount: 10, winner: "a", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
  { id: "r3", status: "settled", week: 0, name: "Season pot", amount: 20, winner: "c", settledAt: "2026-09-25T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }], paid: [] },
];

test("Rivals: a grid of every pair, your two rivalries above it, and the bets behind a cell on a click", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = BETS; state.tab = "rivals"; V.render();
    const res = {}, host = document.getElementById("rivals");
    res.shown = [...document.querySelectorAll("section[data-panel]")].filter(s => !s.hidden).map(s => s.getAttribute("data-panel"));
    res.badge = (() => { const n = document.querySelector('#subTabs [data-tab="rivals"] .n'); return [!n, n ? n.textContent : ""]; })();
    res.mine = [...host.querySelectorAll(".riv-you")].map(c => [c.querySelector(".lbl").textContent, c.querySelector(".riv-who b").textContent, c.querySelector(".riv-n").textContent]);
    // the grid: row manager, then each cell against the columns, then the season total
    const head = [...host.querySelectorAll(".riv thead th")].map(t => (t.querySelector("span:not(.avatar)") || t).textContent.trim());
    res.head = head;
    res.rows = [...host.querySelectorAll(".riv tbody tr")].map(tr => [tr.querySelector("th span:not(.avatar)").textContent,
      ...[...tr.querySelectorAll("td")].map(td => td.classList.contains("self") ? "—" : td.querySelector("b").textContent)]);
    res.tot = [...host.querySelectorAll(".riv td.tot")].map(td => td.querySelector("b").textContent);
    res.selfCells = host.querySelectorAll(".riv td.self").length;
    // click Alice-vs-Bob
    host.querySelector('.riv td.c[data-a="a"][data-b="b"]').click();
    await new Promise(r => setTimeout(r, 40));
    const d = document.querySelector("#rivals .riv-drill");
    res.drill = [...d.querySelectorAll(".riv-bet")].map(x => [x.querySelector(".wk").textContent, x.querySelector(".riv-nm b").textContent, x.querySelector(".riv-w").textContent, x.querySelector("b.num").textContent]);
    res.sel = document.querySelectorAll("#rivals .riv td.c.sel").length;
    // clicking the same cell again closes it
    document.querySelector('#rivals .riv td.c[data-a="a"][data-b="b"]').click();
    await new Promise(r => setTimeout(r, 40));
    res.closed = !document.querySelector("#rivals .riv-drill");
    res.brag = [...document.querySelectorAll("#rivals .riv-brag")].map(x => [x.querySelector(".riv-t b").textContent, x.querySelector(".riv-n").textContent]);
    res.feed = [...document.querySelectorAll("#rivals .riv-box:last-child .riv-bet .riv-nm b")].map(x => x.textContent);
    return res;
  }, RIVAL_BETS);
  assert.deepEqual(out.shown, ["rivals"]);
  assert.deepEqual(out.badge, [false, "1"], "one manager is up on you");
  assert.deepEqual(out.mine, [["You own", "Bob", "+$35"], ["Owns you", "Cara", "−$20"]]);
  assert.deepEqual(out.head, ["", "Cara", "Alice", "Bob", "Season"], "columns run richest season first");
  assert.deepEqual(out.rows, [
    ["Cara", "—", "+$20", "+$20", "+$40"],
    ["Alice", "−$20", "—", "+$35", "+$15"],
    ["Bob", "−$20", "−$35", "—", "−$55"]], "each cell is the row's money against the column, the last one the season");
  assert.deepEqual(out.tot, ["+$40", "+$15", "−$55"]);
  assert.equal(out.selfCells, 3, "the diagonal is blank");
  assert.deepEqual(out.drill, [["WK 2", "Gun Slinger", "Alice won", "+$10"], ["WK 1", "Opener", "Alice won", "+$25"]], "newest first, from the row manager's side");
  assert.equal(out.sel, 2, "both halves of the pair light up — it is one rivalry seen from either side");
  assert.equal(out.closed, true, "a second click on the open cell closes it");
  assert.deepEqual(out.brag, [["Biggest rivalry", "2–0"], ["Most lopsided", "$35"], ["The hammer", "2 W"], ["The nail", "3 L"], ["Biggest haul", "$40"]]);
  assert.deepEqual(out.feed, ["Cara beat Alice, Bob", "Alice beat Bob", "Alice beat Bob"]);
  assert.deepEqual(errors, []);
  await p.close();
});

test("Rivals: the Include hi/low switch folds hi/low weeks into the cells, the hover and the drill", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (BETS) => {
    const { state, setHighlow } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = BETS; state.tab = "rivals";
    setHighlow({ weeks: { "3": { high: [{ id: "a", name: "Alice", pts: 141.2 }], low: [{ id: "b", name: "Bob", pts: 88.4 }] } } });
    V.render();
    const w = () => new Promise(r => setTimeout(r, 40));
    const cell = () => document.querySelector('#rivals .riv td.c[data-a="a"][data-b="b"]');
    const res = {};
    res.off = { checked: document.querySelector('#rivals [data-act="rivalHL"]').checked, cell: cell().querySelector("b").textContent, tip: cell().getAttribute("data-tip") };
    const box = document.querySelector('#rivals [data-act="rivalHL"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await w();
    res.on = { stored: localStorage.getItem("smyrna.rivalHL"), cell: cell().querySelector("b").textContent, rec: cell().querySelector("small").textContent, tip: cell().getAttribute("data-tip"),
      tot: document.querySelector('#rivals .riv tbody tr:nth-child(1) td.tot b').textContent };
    cell().click(); await w();
    const d = document.querySelector("#rivals .riv-drill");
    res.head = d.querySelector(".riv-rec").textContent;
    res.drill = [...d.querySelectorAll(".riv-bet")].map(x => [x.querySelector(".wk").textContent, x.querySelector(".riv-nm b").textContent, x.querySelector(".riv-nm small").textContent, x.querySelector(".riv-w").textContent, x.querySelector("b.num").textContent, x.classList.contains("hl")]);
    res.brag = [...document.querySelectorAll("#rivals .riv-brag")].map(x => [x.querySelector(".riv-t b").textContent, x.querySelector(".riv-n").textContent])[2];
    // the tip draws the lines on their own rows
    const { showTip } = await import("./tips.js?v=dev"); showTip(cell());
    res.tipLines = document.getElementById("tip").getClientRects().length && getComputedStyle(document.getElementById("tip")).whiteSpace;
    try { localStorage.removeItem("smyrna.rivalHL"); } catch (e) {}
    return res;
  }, RIVAL_BETS);
  assert.deepEqual(out.off, { checked: false, cell: "+$35", tip: "Alice vs Bob · 2–0" }, "off by default: bets only");
  assert.deepEqual(out.on, { stored: "on", cell: "+$40", rec: "3–0", tip: "Alice vs Bob · 3–0\nbets +$35 · 2–0\nhi/low +$5 · 1–0 (wk 3 high)", tot: "+$40" },
    "on: week 3's high over Bob is +$5 and a win in the cell, and the hover splits it");
  assert.equal(out.head, "3–0 · +$40");
  assert.deepEqual(out.drill, [
    ["WK 2", "Gun Slinger", "$10 a side", "Alice won", "+$10", false],
    ["WK 1", "Opener", "$25 a side", "Alice won", "+$25", false],
    ["WK 3", "High score · 141.2", "over Bob · 88.4", "Alice high", "+$5", true]], "the bets, then the hi/low weeks");
  assert.deepEqual(out.brag, ["The hammer", "2 W"], "bragging rights stay about bets");
  assert.equal(out.tipLines, "pre-line");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Rivals: nothing settled yet says so, and a bet opens from the grid with the Book's filters cleared", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = []; state.tab = "rivals"; V.render();
    const res = { empty: document.querySelector("#rivals .empty").textContent.slice(0, 22), badge: !document.querySelector('#subTabs [data-tab="rivals"] .n') };
    state.bets = BETS; state.filter.status = "open"; state.filter.week = "2"; V.render();
    await new Promise(r => setTimeout(r, 30));
    document.querySelector('#rivals .riv td.c[data-a="a"][data-b="b"]').click();
    await new Promise(r => setTimeout(r, 40));
    document.querySelector("#rivals .riv-drill .riv-bet").click();   // jump to that bet
    await new Promise(r => setTimeout(r, 140));
    res.after = { tab: state.tab, status: state.filter.status, week: state.filter.week,
      shown: [...document.querySelectorAll("section[data-panel]")].filter(s => !s.hidden).map(s => s.getAttribute("data-panel")),
      flashed: !!document.querySelector('article.ticket[data-bet="r2"].flash') };
    return res;
  }, RIVAL_BETS);
  assert.equal(out.empty, "Nothing has settled ye");
  assert.equal(out.badge, true, "no badge before anything settles");
  assert.deepEqual(out.after, { tab: "book", status: "all", week: "all", shown: ["book"], flashed: true });
  assert.deepEqual(errors, []);
  await p.close();
});

test("phone: Rivals stacks the cards, keeps the names column pinned and the grid inside the screen", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = BETS; state.tab = "rivals"; state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    localStorage.setItem("smyrna.pushNudge", "x");
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render();
    await new Promise(r => setTimeout(r, 40));
    const cs = (el) => getComputedStyle(el), host = document.getElementById("rivals");
    host.querySelector('.riv td.c[data-a="a"][data-b="b"]').click();
    await new Promise(r => setTimeout(r, 40));
    // the click redraws the panel, so everything measured has to be looked up again
    const wrap = host.querySelector(".riv-wrap"), th = host.querySelector(".riv tbody th");
    return {
      mineCols: cs(host.querySelector(".riv-mine")).gridTemplateColumns.split(" ").length,
      sideCols: cs(host.querySelector(".riv-side")).gridTemplateColumns.split(" ").length,
      pinned: cs(th).position,
      scrolls: wrap.scrollWidth >= wrap.clientWidth,
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth,
      tabFits: [...document.querySelectorAll("#tabs .tab")].every(t => t.getBoundingClientRect().right <= innerWidth + 1),
      tabs: document.querySelectorAll("#tabs .tab").length,
      drill: !!host.querySelector(".riv-drill .riv-bet"),
    };
  }, RIVAL_BETS);
  assert.equal(out.mineCols, 1, "your two rivalries stack");
  assert.equal(out.sideCols, 1, "bragging rights and Latest stack");
  assert.equal(out.pinned, "sticky", "the names column stays put while the grid scrolls");
  assert.equal(out.noBodyScroll, true, "the page itself never scrolls sideways");
  assert.equal(out.tabs, 4); assert.equal(out.tabFits, true, "the four tabs fit the bottom bar");
  assert.equal(out.drill, true);
  assert.deepEqual(errors, []);
  await p.close();
});

// Alice staked the most and lost the most; Bob has won three straight.
const BADGE_BETS = [
  { id: "n1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "b", createdBy: "a", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
  { id: "n2", status: "settled", week: 2, name: "Two", amount: 10, winner: "b", createdBy: "b", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
  { id: "n3", status: "settled", week: 0, name: "Pot", amount: 20, winner: "b", createdBy: "b", settledAt: "2026-09-25T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }], paid: [] },
];

test("Badges: its own tab, what you hold, shared titles, and the chips each manager wears on the Ledger", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = BETS; state.tab = "badges";
    state.badges = { byKey: { winner: { holders: ["b"], holder: "b", value: 55, text: "+$75", at: "2026-09-25T00:00:00Z", week: 2, from: ["a"] } } };
    V.render();
    const res = {}, host = document.getElementById("badges");
    res.cards = host.querySelectorAll(".bdg-card").length;
    res.held = [...host.querySelectorAll(".bdg-card:not(.vacant)")].map(c =>
      [c.querySelector(".bdg-nm").textContent, c.querySelector(".bdg-who b").textContent, c.querySelector(".bdg-v").textContent]);
    res.vacant = host.querySelectorAll(".bdg-card.vacant").length;
    res.story = host.querySelector(".bdg-card.good .bdg-sub .took").textContent;
    res.noStory = !host.querySelector(".bdg-card.money .bdg-sub .took");   // no record for it yet
    res.mine = [...host.querySelectorAll(".bdg-mine .bdg")].map(x => x.textContent);
    res.mineNote = (host.querySelector(".bdg-mine .note") || {}).textContent || "";
    // the Ledger tab's rows wear the same titles
    state.tab = "ledger"; V.render();
    await new Promise(r => setTimeout(r, 40));
    res.worn = [...document.querySelectorAll("#board .seat")].map(s =>
      [s.querySelector(".seat-name").textContent, [...s.querySelectorAll(".seat-bdgs .bdg")].map(b => b.textContent)]);
    state.tab = "badges"; state.bets = []; V.render();
    res.empty = document.querySelector("#badges .empty").textContent.slice(0, 23);
    return res;
  }, BADGE_BETS);
  assert.equal(out.cards, 18, "every badge shows, held or up for grabs");
  assert.deepEqual(out.held, [
    ["Biggest Degeneratesshared · 2", "Alice and Bob", "$55"], ["High Rollersshared · 3", "Alice, Bob and Cara", "$60"],
    ["Deadbeat", "Alice", "owes $55"], ["The Bank", "Bob", "owed $75"], ["Biggest Winner", "Bob", "+$75"],
    ["Hot Hand", "Bob", "3 in a row"], ["Untouchable", "Bob", "3–0"], ["Kingmaker", "Bob", "$40"],
    ["Biggest Loser", "Alice", "−$55"], ["Ice Cold", "Alice", "3 in a row"],
    ["Most Activeshared · 2", "Alice and Bob", "3 bets"], ["The Instigator", "Bob", "2 posted"]],
    "level on the number means both hold it, and the title goes plural");
  assert.equal(out.vacant, 6, "the rest are still up for grabs");
  assert.equal(out.story, "took it from Alice · wk 2", "the case remembers who lost a title");
  assert.equal(out.noStory, true, "a badge the book hasn't recorded yet shows its blurb, not a wrong story");
  assert.deepEqual(out.mine, ["Biggest Degenerates · $55", "High Rollers · $60", "Deadbeat · owes $55", "Biggest Loser · −$55", "Ice Cold · 3 in a row", "Most Active · 3 bets"], "you are Alice in this fixture, and a shared title reads plural");
  assert.deepEqual(out.worn, [["Bob", ["Biggest Degenerates", "High Rollers", "The Bank", "Biggest Winner", "Hot Hand", "Untouchable", "Kingmaker", "Most Active", "The Instigator"]],
    ["Cara", ["High Rollers"]], ["Alice", ["Biggest Degenerates", "High Rollers", "Deadbeat", "Biggest Loser", "Ice Cold", "Most Active"]]],
    "both holders of a shared title wear it");
  assert.equal(out.empty, "Eighteen titles up for ");
  assert.deepEqual(errors, []);
  await p.close();
});

test("phone: the badge case goes to one card per row", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = BETS; state.tab = "badges"; state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    localStorage.setItem("smyrna.pushNudge", "x");
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render(); await new Promise(r => setTimeout(r, 40));
    const host = document.getElementById("badges");
    return { cols: getComputedStyle(host.querySelector(".bdg-case")).gridTemplateColumns.split(" ").length,
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth,
      cards: host.querySelectorAll(".bdg-card").length };
  }, BADGE_BETS);
  assert.deepEqual(out, { cols: 1, noBodyScroll: true, cards: 18 });
  assert.deepEqual(errors, []);
  await p.close();
});

const LINES = { byGame: { "5|NE|SEA": { spread: 3, total: 44.5 }, "1|NE|SEA": { spread: 3, total: 44.5 } } };

test("the propose form says which games have a line, prefills it, and lets you change it", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (LINES) => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    state.lines = LINES;
    state.games = { games: [
      { id: "g5", week: 5, away: "NE", home: "SEA", date: "2036-10-11T17:00:00Z", status: "pre" },
      { id: "g6", week: 5, away: "KC", home: "DEN", date: "2036-10-11T20:00:00Z", status: "pre" }] };
    F.openBetDlg();
    document.querySelector('#bScope [data-scope="game"]').click();
    await new Promise(r => setTimeout(r, 40));
    const res = {};
    res.options = [...document.querySelectorAll("#bGame option")].map(o => o.textContent).filter(t => /@/.test(t));
    // with no game chosen there is nothing to bet on yet
    res.beforeGame = { markets: document.getElementById("bMarket").hidden, rowHidden: document.getElementById("bLineRow").hidden,
      src: document.getElementById("bLineSrc").hidden };
    // pick the game with a line
    const sel = document.getElementById("bGame");
    sel.value = "g5"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    const chips = () => [...document.querySelectorAll("#bMarket .chip")].map(c => [c.textContent, c.classList.contains("has-line"), c.getAttribute("aria-pressed")]);
    res.chipsOnPick = chips();
    document.querySelector('#bMarket [data-market="total"]').click();
    await new Promise(r => setTimeout(r, 40));
    res.total = { line: document.getElementById("bLine").value, label: document.getElementById("bLineLbl").textContent, ph: document.getElementById("bLine").placeholder, src: document.getElementById("bLineSrc").textContent };
    document.querySelector('#bMarket [data-market="spread"]').click();
    await new Promise(r => setTimeout(r, 40));
    res.spread = { line: document.getElementById("bLine").value, label: document.getElementById("bLineLbl").textContent, ph: document.getElementById("bLine").placeholder,
      fav: [...document.querySelectorAll("#bLineSrc [data-act='dFav']")].map(b => [b.textContent, b.getAttribute("aria-pressed")]),
      sides: [...document.querySelectorAll("#bEntries .side-chips .chip")].map(c => c.textContent) };
    // flip the favourite and the handicap follows
    document.querySelector("#bLineSrc [data-act='dFav'][data-fav='NE']").click();
    await new Promise(r => setTimeout(r, 40));
    res.flipped = [...document.querySelectorAll("#bEntries .side-chips .chip")].map(c => c.textContent);
    // a game with no published line leaves the boxes empty and says so
    sel.value = "g6"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    document.querySelector('#bMarket [data-market="spread"]').click();
    await new Promise(r => setTimeout(r, 40));
    res.noLine = { line: document.getElementById("bLine").value, src: document.getElementById("bLineSrc").textContent,
      chips: chips().map(c => c[1]) };
    document.getElementById("betDlg").close();
    return res;
  }, LINES);
  assert.deepEqual(out.options, ["NE @ SEA · Sat, Oct 11, 1:00 PM · SEA −3 · O/U 44.5", "KC @ DEN · Sat, Oct 11, 4:00 PM · no line yet"],
    "the picker says which games have a line before you choose one");
  assert.deepEqual(out.beforeGame, { markets: true, rowHidden: true, src: true },
    "before a game is picked the markets, the number and the hint are all out of the way");
  assert.deepEqual(out.chipsOnPick, [["Winner", false, "true"], ["Over / Under44.5", true, "false"], ["SpreadSEA −3", true, "false"]],
    "each market wears its published number");
  assert.equal(out.total.line, "44.5"); assert.equal(out.total.label, "Total"); assert.equal(out.total.ph, "45.5");
  assert.match(out.total.src, /^Vegas has this at 44\.5/);
  assert.equal(out.spread.line, "3"); assert.equal(out.spread.label, "Points"); assert.equal(out.spread.ph, "3.5");
  assert.deepEqual(out.spread.fav, [["NE", "false"], ["SEA", "true"]], "Seattle is the favourite Vegas named");
  assert.deepEqual(out.spread.sides, ["NE +3", "Seattle Seahawks −3"], "the fixture roster names Seattle but not New England");
  assert.deepEqual(out.flipped, ["NE −3", "Seattle Seahawks +3"], "flipping the favourite flips the handicap");
  assert.equal(out.noLine.line, "", "no number to prefill");
  assert.match(out.noLine.src, /^No published line for this game yet/, "and the form says so instead of leaving it blank");
  assert.deepEqual(out.noLine.chips, [false, false, false], "no market wears a number");
  assert.deepEqual(errors, []);
  await p.close();
});

test("the ticker carries the line for a game that hasn't kicked off", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (LINES) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.lines = LINES;
    state.games = { games: [
      { id: "g1", week: 1, away: "NE", home: "SEA", date: "2036-09-10T00:20:00Z", status: "pre" },
      { id: "g2", week: 1, away: "KC", home: "DEN", date: "2036-09-13T17:00:00Z", status: "pre" },
      { id: "g3", week: 1, away: "SF", home: "LAR", date: "2036-09-13T17:00:00Z", status: "live", awayScore: 7, homeScore: 3, q: 2, clock: "5:00" }] };
    V.render();
    const games = [...document.querySelectorAll("#ticker .ticker-track > .game")].slice(0, 3);
    return games.map(g => [g.textContent.replace(/\s+/g, " ").trim(), (g.querySelector(".odds") || {}).textContent || null]);
  }, LINES);
  assert.equal(out[0][1], "SEA −3 · O/U 44.5", "a game with a line shows it");
  assert.equal(out[1][1], null, "a game without one shows nothing extra");
  assert.equal(out[2][1], null, "a game already under way shows the score, not the line");
  assert.deepEqual(errors, []);
  await p.close();
});

test("a ticket says whether its line was Vegas's or the proposer's own", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const g = { id: "g5", week: 5, away: "NE", home: "SEA", date: "2026-10-11T17:00:00Z" };
    const bet = (id, extra) => Object.assign({ id, status: "active", createdBy: "b", week: 5, kind: "matchup", amount: 10,
      name: id, terms: "t", game: g, entries: [{ memberId: "b", side: "over" }, { memberId: "c", side: "under" }], paid: [] }, extra);
    state.bets = [bet("v", { market: "total", line: 44.5, lineSrc: "vegas" }),
                  bet("o", { market: "spread", line: 7, fav: "SEA", lineSrc: "own" }),
                  bet("old", { market: "total", line: 44.5 }),
                  bet("ml", { market: "ml" })];
    V.render();
    const src = (id) => { const el = document.querySelector('article.ticket[data-bet="' + id + '"] .gl-line'); return el ? [el.textContent, (el.querySelector(".src") || {}).className || null] : null; };
    return { v: src("v"), o: src("o"), old: src("old"), ml: src("ml") };
  });
  assert.deepEqual(out.v, ["O/U 44.5Vegas", "src vegas"]);
  assert.deepEqual(out.o, ["SEA −7their number", "src own"]);
  assert.deepEqual(out.old, ["O/U 44.5", null], "a bet from before the change makes no claim");
  assert.equal(out.ml, null, "a straight-up bet shows no line at all");
  assert.deepEqual(errors, []);
  await p.close();
});

test("phone: the ticker stacks each game's line under the matchup", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  const out = await p.evaluate(async (LINES) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.lines = LINES;
    state.games = { games: [{ id: "g1", week: 1, away: "NE", home: "SEA", date: "2036-09-10T00:20:00Z", status: "pre" }] };
    state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    localStorage.setItem("smyrna.pushNudge", "x");
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render(); await new Promise(r => setTimeout(r, 40));
    const g = document.querySelector("#ticker .ticker-track > .game"), o = g.querySelector(".odds"), t = g.querySelector(".tm");
    return { odds: o.textContent, below: Math.round(o.getBoundingClientRect().top) > Math.round(t.getBoundingClientRect().top),
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  }, LINES);
  assert.equal(out.odds, "SEA −3 · O/U 44.5");
  assert.equal(out.below, true, "the line sits on its own row under the teams, not squeezed beside them");
  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});

test("a new prop opens on the week you're in, not a blank week box", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const F = await import("./forms.js?v=dev");
    // Mid-season: week 5 has started and still has a game to bet on, week 6 is ahead.
    const now = Date.now(), week = 7 * 86400e3, ws = {};
    for (let i = 1; i <= 18; i++) ws[String(i)] = new Date(now + (i - 5) * week).toISOString();
    state.config = { ...state.config, kickoff: ws["1"], weekStarts: ws };
    state.local = false;   // openBetDlg is guarded on a published league
    state.games = { games: [
      { id: "g5", week: 5, away: "NE", home: "SEA", date: new Date(now + 2 * 86400e3).toISOString(), status: "pre" },
      { id: "g6", week: 6, away: "KC", home: "DEN", date: new Date(now + 9 * 86400e3).toISOString(), status: "pre" }] };
    F.openBetDlg();
    const wk = document.getElementById("bWeek");
    return { value: wk.value, label: wk.selectedOptions[0] ? wk.selectedOptions[0].textContent : "",
      seasonLongOffered: [...wk.options].some(o => o.value === "0"),
      rowShown: !document.getElementById("bWeekRow").hidden };
  });
  assert.equal(out.value, "5", "the week box opens on the current week");
  assert.equal(out.label, "Week 5");
  assert.equal(out.seasonLongOffered, false, "season long is gone once the opener has kicked off — which is what left the box blank");
  assert.equal(out.rowShown, true, "a player/team prop still picks its own week");
  assert.deepEqual(errors, []);
  await p.close();
});

test("the refresh note stacks under the numbers and the buttons, not between them", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.local = false; state.connected = true; state.ready = true; state.db = { doc() { return {}; } };
    state.bets = [{ id: "x", week: 1, kind: "matchup", status: "open", amount: 5, createdBy: "a",
      entries: [{ memberId: "a", pick: "ATL" }, { memberId: null, pick: "PIT" }],
      stats: { updatedAt: new Date(Date.now() - 30e3).toISOString(), through: "Week 1" } }];
    state.refresh = { requestedAt: new Date(Date.now() - 20e3).toISOString(), requestedBy: "a", finishedAt: null };
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render(); await new Promise(r => setTimeout(r, 40));
    const glance = document.getElementById("glance"), bar = document.getElementById("statsBar");
    const btns = document.querySelector(".glance-r");
    const rb = bar.getBoundingClientRect(), rr = btns.getBoundingClientRect();
    return { text: bar.textContent.trim(),
      below: Math.round(rb.top) >= Math.round(rr.bottom) - 2,
      ownRow: Math.round(rb.width) >= Math.round(glance.getBoundingClientRect().width) - 40,
      holdsButtons: [...btns.children].map(c => c.id),
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.match(out.text, /^Refresh requested/, "the pending note is what's showing");
  assert.equal(out.below, true, "the note sits under the buttons, not beside them");
  assert.equal(out.ownRow, true, "and gets the full width of the bar to itself");
  assert.deepEqual(out.holdsButtons, ["refreshBtn", "newBetBtn"], "the right-hand group is buttons only");
  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});

test("the slate lists in kickoff order, and a game inside the hour counts down", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const F = await import("./forms.js?v=dev");
    const now = Date.now(), mins = (m) => new Date(now + m * 60e3).toISOString();
    state.local = false; state.connected = true; state.ready = true; state.db = { doc() { return {}; } };
    // deliberately out of order, the way the schedule feed hands them over
    state.games = { games: [
      { id: "mon", week: 1, away: "DEN", home: "KC", date: mins(60 * 30), status: "pre" },
      { id: "soon", week: 1, away: "ATL", home: "PIT", date: mins(42), status: "pre" },
      { id: "late", week: 1, away: "GB", home: "MIN", date: mins(60 * 8), status: "pre" }] };
    state.config = { ...state.config, kickoff: mins(-60), weekStarts: { "1": mins(-60) } };
    state.bets = [];
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render(); await new Promise(r => setTimeout(r, 40));
    const games = [...document.querySelectorAll("#ticker .ticker-track > .game")].slice(0, 3);
    const order = games.map(g => [...g.querySelectorAll(".tm")].map(t => t.textContent.trim()).join("@"));
    const soonEl = document.querySelector("#ticker .game.soon .kick");
    // and the propose form's game list, grouped by week, in the same order
    F.openBetDlg();
    document.querySelector('#bScope [data-scope="game"]').click();
    await new Promise(r => setTimeout(r, 40));
    const opts = [...document.querySelectorAll("#bGame optgroup option")].map(o => o.textContent);
    return { order, soon: soonEl ? soonEl.textContent : null,
      soonGold: soonEl ? getComputedStyle(soonEl).color : null,
      picker: opts.map(t => t.split(" · ")[0]), pickerSoon: opts.find(t => /kicks in/.test(t)) || null,
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.deepEqual(out.order, ["ATL@PIT", "GB@MIN", "DEN@KC"], "the ticker runs in kickoff order, not feed order");
  assert.match(out.soon, /^Kicks in 4[12]m$/, "the one inside the hour counts down instead of showing its date");
  assert.equal(out.soonGold, "rgb(255, 174, 88)", "in the same gold the app uses for happening-now");
  assert.deepEqual(out.picker, ["ATL @ PIT", "GB @ MIN", "DEN @ KC"], "and so does the propose form's list");
  assert.match(out.pickerSoon, /ATL @ PIT · kicks in 4[12]m/, "which says so in words, since an option can't be styled");
  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});

test("tooltips are the app's own, not the browser's, and none are left native", { skip }, async () => {
  const { p, errors } = await page();
  await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.tab = "settle";
    state.bets = [
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: ["b"] },
      { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] }];
    state.highlow = { weeks: { "1": { high: [{ id: "b", name: "Bob", pts: 140 }], low: [{ id: "c", name: "Cara", pts: 90 }] } } };
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
    V.render(); await new Promise(r => setTimeout(r, 40));
  });
  // nothing anywhere still asks the OS to draw a tooltip
  const natives = await p.evaluate(() => [...document.querySelectorAll("[title]")].map(e => e.tagName + ":" + e.getAttribute("title")));
  assert.deepEqual(natives, [], "every title= became data-tip; a stray one would draw the OS box again");

  await p.hover('#settle .bal b[data-act="drill"][data-m="b"][data-row="total"]');
  await p.waitForFunction(() => { const t = document.getElementById("tip"); return t && t.classList.contains("show"); }, { timeout: 4000 });
  const tip = await p.evaluate(() => {
    const t = document.getElementById("tip"), cs = getComputedStyle(t), r = t.getBoundingClientRect();
    const cell = document.querySelector('#settle .bal b[data-act="drill"][data-m="b"][data-row="total"]').getBoundingClientRect();
    const root = getComputedStyle(document.documentElement);
    const paint = (v) => { const d = document.createElement("i"); d.style.color = root.getPropertyValue(v).trim();
      document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    return { text: t.textContent, bg: cs.backgroundColor, color: cs.color, ink: paint("--ink"), page: paint("--bg"),
      above: r.bottom <= cell.top + 1, centred: Math.abs((r.left + r.width / 2) - (cell.left + cell.width / 2)) < 2,
      onScreen: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      notClipped: r.bottom <= document.querySelector('#settle .bal b[data-m="b"]').getBoundingClientRect().top + 1 };
  });
  assert.equal(tip.text, "What’s behind this");
  assert.equal(tip.bg, tip.ink, "the app's ink, the same inversion the toast uses — not a system box");
  assert.equal(tip.color, tip.page, "and the page colour for the text, so it reads in either theme");
  assert.equal(tip.above, true, "it sits above what it describes");
  assert.equal(tip.centred, true, "and points at the middle of it");
  assert.equal(tip.onScreen, true, "never off the edge of the viewport");
  // and isn't cut off by the card it sits on
  assert.equal(tip.notClipped, true);
  // and go away when the pointer leaves
  await p.hover("#settle .you-line");
  await p.waitForFunction(() => !document.getElementById("tip").classList.contains("show"), { timeout: 4000 });
  assert.deepEqual(errors, []);
  await p.close();
});

test("the season seam: the book holds every season, the app shows one", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const St = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const B = await import("./book.js?v=dev");
    const { state } = St;
    state.tab = "settle";
    // one book, two seasons in it
    St.setBets([
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: [] },
      { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] },
      { id: "n1", season: "2027", status: "settled", week: 1, amount: 50, winner: "b", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: [] },
    ]);
    // each manager's balance, in roster order; undefined when there's nobody to show
    const totals = () => { V.render(); const cards = [...document.querySelectorAll("#settle .bal")];
      if (!cards.length) return undefined;
      return state.config.members.map(m => cards.find(c => c.dataset.m === m.id)).filter(Boolean).map(c => c.querySelector("b").textContent); };
    const shownDefault = St.shownSeason();
    const held = state.allBets.length, showing2026 = state.bets.length;
    const t2026 = totals();
    St.setSeason("2027");
    // nobody has said they are playing 2027 yet, so the board has nobody on it
    const strangers = { rows: totals(), members: St.realMembers().length };
    // now they say so - participation is asserted, never inherited
    state.config.members.forEach(m => { if (m.id !== "c") m.seasons = ["2026", "2027"]; });
    const t2027 = totals(), showing2027 = state.bets.length;
    St.setSeason(null);
    // a locally saved bet lands in the book, not just the view
    B.saveBet({ id: "z9", status: "open", week: 1, amount: 5, season: "2027",
      entries: [{ memberId: "a", pick: "x" }, { memberId: null, pick: "" }], paid: [] });
    const afterSave = { all: state.allBets.length, shown: state.bets.length };
    B.removeBet("z9");
    const afterDrop = { all: state.allBets.length, shown: state.bets.length };
    return { shownDefault, held, showing2026, showing2027, strangers, t2026, t2027, afterSave, afterDrop };
  });
  assert.equal(out.shownDefault, "2026", "with nothing picked, the season the book is on");
  assert.equal(out.held, 3, "the book keeps every season");
  assert.equal(out.showing2026, 2, "the app shows one — the two untagged bets are 2026");
  assert.equal(out.showing2027, 1);
  // Alice: +25 on the season bet, −10 on the weekly one. The 2027 bet must not reach her.
  assert.deepEqual(out.t2026, ["+$15", "−$25", "+$10"], "2026 totals, with 2027 nowhere in them");
  assert.equal(out.strangers.members, 0, "a season nobody has joined shows nobody");
  assert.equal(out.strangers.rows, undefined, "so there is no board to draw");
  assert.deepEqual(out.t2027, ["−$50", "+$50"], "and once two of them join, 2027 on its own - Cara didn't, so she has no card");
  assert.deepEqual(out.afterSave, { all: 4, shown: 2 },
    "a 2027 bet saved while looking at 2026 joins the book without appearing on screen");
  assert.deepEqual(out.afterDrop, { all: 3, shown: 2 }, "and deleting it removes it from the book, not just the view");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Sync from Sleeper: admin only, says what it did, and won't be hit twice", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    state.local = false; state.connected = true; state.db = { doc() { return {}; } };
    const read = () => ({ shown: !document.getElementById("rSync").hidden,
      disabled: document.getElementById("rSync").disabled,
      note: document.getElementById("rSyncNote").textContent });
    state.admin = false; D.drawRoster();
    const asManager = read();
    state.admin = true; D.drawRoster();
    const asAdminIdle = read();
    // a request in flight
    state.rosterSync = { requestedAt: new Date().toISOString(), requestedBy: "a", finishedAt: null };
    D.drawRoster();
    const running = read();
    // and the answer
    state.rosterSync = { requestedAt: new Date(Date.now() - 4000).toISOString(),
      finishedAt: new Date(Date.now() - 2000).toISOString(), added: 2, carried: 8, note: "" };
    D.drawRoster();
    const done = read();
    state.rosterSync = { requestedAt: new Date(Date.now() - 4000).toISOString(),
      finishedAt: new Date(Date.now() - 2000).toISOString(), added: 0, carried: 0, note: "Already up to date" };
    D.drawRoster();
    return { asManager, asAdminIdle, running, done, quiet: read() };
  });
  assert.equal(out.asManager.shown, false, "a manager never sees it");
  assert.equal(out.asManager.note, "");
  assert.equal(out.asAdminIdle.shown, true);
  assert.equal(out.asAdminIdle.disabled, false);
  assert.equal(out.running.note, "Checking Sleeper…", "it says so while the function is working");
  assert.equal(out.running.disabled, true, "and cannot be fired again mid-flight");
  assert.match(out.done.note, /^2 managers added · 8 carried into 2026 · /, "then what actually happened");
  assert.equal(out.done.disabled, false);
  assert.equal(out.quiet.note, "Already up to date", "a no-op says so rather than reading as a failure");
  assert.deepEqual(errors, []);
  await p.close();
});

test("season context follows the league and resets on every load", { skip }, async () => {
  const first = await page();
  const picked = await first.p.evaluate(async () => {
    const St = await import("./state.js?v=dev");
    St.setSeason("2027");
    // a choice is a choice for this visit only — nothing about it is written down
    const stored = Object.keys(localStorage).filter(k => /season/i.test(k));
    return { shown: St.shownSeason(), stored };
  });
  assert.equal(picked.shown, "2027", "you can look at another season while you are here");
  assert.deepEqual(picked.stored, [], "but it is never persisted, unlike the tab");
  await first.p.close();

  // a fresh load is a fresh sign-in: back to the season the league is on
  const next = await page();
  const onLoad = await next.p.evaluate(async () => {
    const St = await import("./state.js?v=dev");
    return { season: St.state.season, shown: St.shownSeason(), config: St.state.config.season };
  });
  assert.equal(onLoad.season, null, "nothing is carried over");
  assert.equal(onLoad.shown, "2026");
  assert.equal(onLoad.shown, onLoad.config, "the season context is whatever the league says it is on");
  assert.deepEqual(next.errors, []);
  await next.p.close();
});

test("a sync that never comes back doesn't lock the button", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    state.admin = true;
    const read = () => ({ disabled: document.getElementById("rSync").disabled,
      note: document.getElementById("rSyncNote").textContent });
    // asked for just now, nothing has answered
    state.rosterSync = { requestedAt: new Date(Date.now() - 5000).toISOString(), requestedBy: "a" };
    D.drawRoster(); const fresh = read();
    // asked for long enough ago that nothing is coming
    state.rosterSync = { requestedAt: new Date(Date.now() - 5 * 60000).toISOString(), requestedBy: "a" };
    D.drawRoster(); const lost = read();
    return { fresh, lost };
  });
  assert.equal(out.fresh.disabled, true, "while it might still answer, one ask is enough");
  assert.equal(out.fresh.note, "Checking Sleeper…");
  assert.equal(out.lost.disabled, false, "but a request nothing answered must never be a dead end");
  assert.equal(out.lost.note, "That didn't come back — press to try again");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Remove is only offered for a manager nothing points at yet", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const St = await import("./state.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    const { state } = St;
    state.admin = true; state.isAdmin = true; state.me = "a"; state.local = true;
    // Bob is in a settled bet; Cara is a handle typed wrong and has nothing
    St.setBets([{ id: "b1", status: "settled", week: 1, amount: 10, winner: "a",
      createdBy: "a", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: [] }]);
    D.drawRoster();
    const click = (id) => { const b = document.querySelector('#rosterList [data-act="rmMember"][data-id="' + id + '"]');
      if (!b) return "no button"; b.click(); return null; };
    const before = state.config.members.map(m => m.id);
    const bobBtn = document.querySelector('#rosterList [data-act="rmMember"][data-id="b"]');
    click("b"); await new Promise(r => setTimeout(r, 30));
    const afterBob = { ids: state.config.members.map(m => m.id), offered: !!bobBtn };
    click("c"); await new Promise(r => setTimeout(r, 30));
    const afterCara = state.config.members.map(m => m.id);
    return { before, afterBob, afterCara };
  });
  assert.deepEqual(out.before, ["a", "b", "c"]);
  assert.equal(out.afterBob.offered, false, "Bob is not offered a Remove at all — a settled bet points at him");
  assert.deepEqual(out.afterBob.ids, ["a", "b", "c"], "and the action refuses too, so a hand-made click can't get round it");
  assert.deepEqual(out.afterCara, ["a", "b"], "Cara has nothing against her name, so a mistyped handle is still cleanable");
  assert.deepEqual(errors, []);
  await p.close();
});

test("participation is asserted per season, never inherited from the last one", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    const B = await import("./book.js?v=dev");
    const Sn = await import("./seasons.js?v=dev");
    // a later season is in charge, and nobody has a list yet
    state.config = { ...state.config, season: "2027" };
    state.admin = true; state.local = true;
    B.saveConfig();
    const stamped = state.config.members.map(m => [m.id, (m.seasons || []).join(",")]);
    // someone who played 2026 and is back for 2027 says so explicitly
    const both = Sn.withSeason({ id: "a", seasons: ["2026"] }, "2027");
    return { stamped, both,
      in2027: state.config.members.filter(m => Sn.inSeason(m, "2027")).map(m => m.id),
      in2026: state.config.members.filter(m => Sn.inSeason(m, "2026")).map(m => m.id) };
  });
  assert.deepEqual(out.stamped, [["a", "2026"], ["b", "2026"], ["c", "2026"]],
    "saving in 2027 records what 'no list' already meant — 2026 — and not the season in charge");
  assert.deepEqual(out.in2027, [], "nobody is carried into a season just because it started");
  assert.deepEqual(out.in2026, ["a", "b", "c"], "and last season is untouched");
  assert.deepEqual(out.both, ["2026", "2027"], "coming back is a second tag, not a replacement");
  assert.deepEqual(errors, []);
  await p.close();
});

test("asking for a password is the app's dialog, not the browser's", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const D = await import("./dialogs.js?v=dev");
    // prompt() would freeze the page here; this returns a promise and the page stays live
    const asked = D.askFor({ title: "Change Bob's password", body: "They already have an account.", label: "Their current password" });
    await new Promise(r => setTimeout(r, 50));
    const dlg = document.getElementById("askDlg");
    const open = { isOpen: dlg.open, modal: dlg.matches(":modal"),
      title: document.getElementById("askTitle").textContent,
      label: document.getElementById("askLabel").textContent,
      type: document.getElementById("askInput").type,
      focused: document.activeElement.id };
    document.getElementById("askInput").value = "hunter2";
    document.getElementById("askGo").click();
    const answer = await asked;
    const afterOk = { isOpen: dlg.open, left: document.getElementById("askInput").value };

    // cancelling answers null, which setPassword reads as "leave it alone"
    const asked2 = D.askFor({ title: "again" });
    await new Promise(r => setTimeout(r, 30));
    document.getElementById("askInput").value = "typed but thought better of it";
    document.getElementById("askCancel").click();
    const cancelled = await asked2;

    // and Escape must answer too, or the caller waits forever
    const asked3 = D.askFor({ title: "escape" });
    await new Promise(r => setTimeout(r, 30));
    dlg.close();
    const escaped = await asked3;
    return { open, answer, afterOk, cancelled, escaped };
  });
  assert.equal(out.open.isOpen, true, "the app's own dialog, not an OS box");
  assert.equal(out.open.modal, true, "and it is modal, like every other dialog here");
  assert.equal(out.open.title, "Change Bob's password", "asked in words about this manager");
  assert.equal(out.open.label, "Their current password");
  assert.equal(out.open.type, "password", "never shown on screen");
  assert.equal(out.open.focused, "askInput", "you can just type");
  assert.equal(out.answer, "hunter2");
  assert.equal(out.afterOk.isOpen, false);
  assert.equal(out.afterOk.left, "", "the password is not left sitting in the field");
  assert.equal(out.cancelled, null, "cancelling answers null, so nothing is changed");
  assert.equal(out.escaped, null, "and so does Escape — an unanswered promise would hang the caller");
  assert.deepEqual(errors, []);
  await p.close();
});

test("the season picker appears once there are two, and the past is read only", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const St = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const B = await import("./book.js?v=dev");
    const { state } = St;
    state.local = false; state.connected = true; state.db = { doc() { return { set: () => Promise.resolve() }; } };
    state.admin = true;
    V.render(); await new Promise(r => setTimeout(r, 30));
    const oneSeason = { hidden: document.getElementById("seasonPick").hidden };

    // a second season exists the moment anything claims one
    state.config = { ...state.config, season: "2027" };
    state.config.members.forEach(m => { m.seasons = ["2026", "2027"]; });
    St.setBets([{ id: "old", season: "2026", status: "settled", week: 1, amount: 10, entries: [] }]);
    V.render(); await new Promise(r => setTimeout(r, 30));
    const sel = document.getElementById("seasonSel");
    const two = { hidden: document.getElementById("seasonPick").hidden,
      options: [...sel.options].map(o => o.textContent), value: sel.value,
      sub: document.getElementById("leagueSub").textContent };

    // reading 2026 while the league is on 2027
    sel.value = "2026"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    const past = { shown: St.shownSeason(), sub: document.getElementById("leagueSub").textContent };
    const allowed = B.guard();
    const toastText = document.getElementById("toast").textContent;

    // back to now, and writing is allowed again
    sel.value = "2027"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    return { oneSeason, two, past, allowed, toastText, backNow: B.guard() };
  });
  assert.equal(out.oneSeason.hidden, true, "one season needs no picker");
  assert.equal(out.two.hidden, false, "two does");
  assert.deepEqual(out.two.options, ["2026", "2027 · now"], "oldest first, and which one the league is on");
  assert.equal(out.two.value, "2027", "opening on the season being played");
  assert.match(out.two.sub, /side bets$/, "which reads as normal");
  assert.equal(out.past.shown, "2026");
  assert.match(out.past.sub, /closed · read only$/, "an older season says so in the header");
  assert.equal(out.allowed, false, "and refuses every write, since guard() is the one gate they all pass");
  assert.equal(out.toastText, "2026 is closed — switch to 2027 to make changes", "saying how to fix it");
  assert.equal(out.backNow, true, "the season being played is writable as ever");
  assert.deepEqual(errors, []);
  await p.close();
});

test("starting a season moves the league on and carries nobody with it", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const St = await import("./state.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    const { state } = St;
    state.local = false; state.connected = true; state.admin = true;
    state.db = { doc() { return { set: () => Promise.resolve() }; } };
    state.config.members.forEach(m => { m.seasons = ["2026"]; });
    D.drawRoster();
    const go = document.getElementById("rSeasonGo");
    const start = (yr, lid) => { document.getElementById("rNewSeason").value = yr;
      document.getElementById("rNewLeague").value = lid || ""; go.click(); };

    start("nope");                       // not a year
    const bad = document.getElementById("toast").textContent;
    start("2026");                       // already here
    const dup = document.getElementById("toast").textContent;

    start("2027", "L2027");
    await new Promise(r => setTimeout(r, 40));
    return { bad, dup, toast: document.getElementById("toast").textContent,
      season: state.config.season, shown: St.shownSeason(),
      settings: state.config.bySeason && state.config.bySeason["2027"],
      playing: St.realMembers().map(m => m.id),
      stillOn2026: state.config.members.map(m => (m.seasons || []).join(",")) };
  });
  assert.match(out.bad, /Which year/, "a year is four digits");
  assert.match(out.dup, /2026 is already in the book/);
  assert.equal(out.season, "2027", "the league moves on");
  assert.equal(out.shown, "2027", "and everyone lands there, not on whatever was last looked at");
  assert.deepEqual(out.settings, { stake: 25, leagueId: "L2027" }, "the season gets its own stake and Sleeper league");
  assert.deepEqual(out.playing, [], "nobody is carried over — the roster sync adds whoever is actually in the new league");
  assert.deepEqual(out.stillOn2026, ["2026", "2026", "2026"], "and last season's record is untouched");
  assert.match(out.toast, /^Season 2027 started — Sync from Sleeper for the roster$/,
    "and says the next step, since the new season starts with nobody in it");
  assert.deepEqual(errors, []);
  await p.close();
});

test("the season is not editable as a label — only Start a season moves it", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    const D = await import("./dialogs.js?v=dev");
    state.local = false; state.connected = true; state.admin = true;
    state.db = { doc() { return { set: () => Promise.resolve() }; } };
    D.openRoster();
    const box = document.getElementById("rSeason");
    const shown = { value: box.value, disabled: box.disabled,
      nameEditable: !document.getElementById("rName").disabled };
    // typing into it and saving must not move the league
    box.disabled = false; box.value = "2027";
    document.getElementById("rSave").click();
    await new Promise(r => setTimeout(r, 40));
    return { shown, after: state.config.season };
  });
  assert.equal(out.shown.value, "2026", "it still shows which season the league is on");
  assert.equal(out.shown.disabled, true, "but it cannot be typed into");
  assert.equal(out.shown.nameEditable, true, "while the league's name still can be, for an admin");
  assert.equal(out.after, "2026",
    "and even forced, saving does not move the league — that would empty the board and lock last season silently");
  assert.deepEqual(errors, []);
  await p.close();
});

const DRAFT = { draftId: "d1", rounds: 16, type: "snake",
  byRoster: { 1: "Alice", 2: "Bob", 3: "Cara" },
  rosters: { 1: ["p4", "p11", "free", "p1"], 2: ["p5"], 3: [] },
  byPlayer: { p1: { r: 1, keeper: false }, p4: { r: 4, keeper: false },
              p5: { r: 5, keeper: true }, p11: { r: 11, keeper: false } },
  keptPrev: { p5: 1 },
  // a full first round, because two cards would fit a phone and ten never will
  picks: Array.from({ length: 10 }, (_, i) => ({ r: 1, p: i + 1, slot: i + 1,
      roster: (i % 3) + 1, name: "Player " + (i + 1), pos: "RB", team: "DET", keeper: false, from: null }))
    .concat([
      { r: 4, p: 40, slot: 2, roster: 1, name: "Bo Nix", pos: "QB", team: "DEN", keeper: false, from: 2 },
      { r: 5, p: 47, slot: 2, roster: 2, name: "Rashee Rice", pos: "WR", team: "KC", keeper: true, from: null },
    ]) };

async function withDraft(p) {
  await p.evaluate(async (DRAFT) => {
    const St = await import("./state.js?v=dev");
    const { state } = St;
    state.tab = "league"; state.leagueTab = "draft";
    state.roster = { players: [["p4", "Bo Nix", "QB", "DEN"], ["p11", "DK Metcalf", "WR", "SEA"],
      ["free", "Kayshon Boutte", "WR", "NE"], ["p1", "Jahmyr Gibbs", "RB", "DET"], ["p5", "Rashee Rice", "WR", "KC"]] };
    St.setDraft({ bySeason: { 2026: DRAFT } });
    document.getElementById("login").hidden = true; document.getElementById("app").hidden = false;
  }, DRAFT);
}

test("the League tab holds Scores, the Draft and the Roster", { skip }, async () => {
  const { p, errors } = await page();
  await withDraft(p);
  const out = await p.evaluate(async () => {
    const V = await import("./render.js?v=dev"); const { state } = await import("./state.js?v=dev");
    const seg = (id) => [...document.querySelectorAll("#" + id + " button")].map(b => [b.textContent, b.getAttribute("aria-pressed")]);
    V.render(); await new Promise(r => setTimeout(r, 30));
    const halves = { tabs: seg("leagueTabs"),
      scoresShown: !document.querySelector('[data-lview="scores"]').hidden,
      draftShown: !document.querySelector('[data-lview="draft"]').hidden };
    const byMgr = { views: seg("draftViews"),
      mgrs: [...document.querySelectorAll("#draft .dmgr .dhead b")].map(b => b.textContent),
      alicePicks: [...document.querySelectorAll("#draft .dmgr")][0].querySelectorAll("li").length,
      from: [...document.querySelectorAll("#draft .dfrom")].map(f => f.textContent),
      kept: [...document.querySelectorAll("#draft .dkept")].length,
      note: document.getElementById("draftNote").textContent };
    state.draftView = "board"; V.render(); await new Promise(r => setTimeout(r, 20));
    const board = { rows: document.querySelectorAll("#draft .drow").length,
      scrolls: getComputedStyle(document.querySelector("#draft .dgrid")).overflowX,
      keptCell: document.querySelectorAll("#draft .dcell.kept").length };
    return { halves, byMgr, board, noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.deepEqual(out.halves.tabs, [["Scores", "false"], ["Draft", "true"], ["Roster", "false"]], "three, the draft open");
  assert.equal(out.halves.scoresShown, false);
  assert.equal(out.halves.draftShown, true);

  assert.deepEqual(out.byMgr.views, [["By manager", "true"], ["Board", "false"]], "the draft is what happened; what you can keep lives on Roster");
  assert.deepEqual(out.byMgr.mgrs, ["Alice", "Bob", "Cara"], "in the order they first picked");
  assert.equal(out.byMgr.alicePicks, 5, "four in round one plus the pick she traded for");
  assert.deepEqual(out.byMgr.from, ["from Bob"], "a traded pick says where it came from, on the manager who got the player");
  assert.equal(out.byMgr.kept, 1);
  assert.match(out.byMgr.note, /^12 picks · 16 rounds · snake · 1 kept · 1 traded$/);

  assert.equal(out.board.rows, 3, "a row per round that has picks");
  assert.equal(out.board.scrolls, "auto", "and it scrolls sideways inside its own box");
  assert.equal(out.board.keptCell, 1);

  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});

test("Draft by manager: each player's position rank, an arrow against projection, and who's no longer on the team", { skip }, async () => {
  const { p, errors } = await page();
  await withDraft(p);
  const out = await p.evaluate(async () => {
    const V = await import("./render.js?v=dev"); const St = await import("./state.js?v=dev");
    St.state.draftView = "mgr";
    const D = St.state.draftBoard;
    // Bo Nix (p4) and Rashee Rice (p5) carry ids; Rice was Bob's pick and is now Alice's, Nix is still Alice's
    D.picks.forEach(x => { if (x.name === "Bo Nix") x.pid = "p4"; if (x.name === "Rashee Rice") x.pid = "p5"; if (x.name === "Player 1") x.pid = "gone"; });
    St.setSquads({ bySeason: { 2026: { byRoster: { 1: "Alice", 2: "Bob", 3: "Cara" }, rosters: { 1: ["p4", "p5"], 2: [], 3: [] } } } });
    St.setPlayers({ bySeason: { 2026: { through: 2, field: "pts_ppr", rows: JSON.stringify({ p4: [40.2, 30, "QB7"], p5: [12, 26.5, "WR48"], gone: [3, 3.1, "RB90"] }) } } });
    V.render(); await new Promise(r => setTimeout(r, 30));
    const li = (name) => [...document.querySelectorAll("#draft .dpicks li")].find(l => l.querySelector(".dnm").textContent === name);
    const read = (l) => ({ rank: l.querySelector(".drank").textContent, gone: l.classList.contains("gone"), tag: l.querySelector(".dgone")?.textContent || "", tip: l.getAttribute("data-tip") || "",
      arrow: l.querySelector(".dtrend")?.className || "", strike: getComputedStyle(l.querySelector(".dnm")).textDecorationLine });
    const nix = li("Bo Nix"), rice = li("Rashee Rice");
    return { nix: read(nix), rice: read(rice), p1: read(li("Player 1")), p2: read(li("Player 2")),
      rightEdge: Math.round(nix.querySelector(".drank").getBoundingClientRect().right) === Math.round(nix.getBoundingClientRect().right) };
  });
  assert.deepEqual(out.nix, { rank: "QB7▲", gone: false, tag: "", tip: "Bo Nix · 40.2 pts · 30 projected through WK 2", arrow: "dtrend up", strike: "none" }, "34% over: up");
  assert.deepEqual(out.rice, { rank: "WR48▼", gone: true, tag: "now Alice", tip: "Rashee Rice · 12 pts · 26.5 projected through WK 2 · now on Alice", arrow: "dtrend down", strike: "line-through" }, "Bob's pick, on Alice's team now");
  assert.deepEqual(out.p1, { rank: "RB90", gone: true, tag: "dropped", tip: "Player 1 · 3 pts · 3.1 projected through WK 2 · no longer on a roster", arrow: "", strike: "line-through" }, "within 10%: no arrow");
  assert.deepEqual(out.p2, { rank: "", gone: false, tag: "", tip: "", arrow: "", strike: "none" }, "a pick with no id says nothing");
  assert.equal(out.rightEdge, true, "the rank sits at the card's right edge, a column down the list");
  assert.deepEqual(errors, []);
  await p.close();
});

test("phone: the League tab's switches fill the width and the cards stack", { skip }, async () => {
  const { p, errors } = await page(null, PHONE);
  await withDraft(p);
  const out = await p.evaluate(async () => {
    const V = await import("./render.js?v=dev"); const { state } = await import("./state.js?v=dev");
    V.render(); await new Promise(r => setTimeout(r, 40));
    const seg = document.getElementById("draftViews");
    const btns = [...seg.querySelectorAll("button")].map(b => Math.round(b.getBoundingClientRect().width));
    const cards = [...document.querySelectorAll("#draft .dmgr")].map(c => Math.round(c.getBoundingClientRect().width));
    state.draftView = "board"; V.render(); await new Promise(r => setTimeout(r, 30));
    const grid = document.querySelector("#draft .dgrid");
    return { btns, oneWide: new Set(cards).size === 1, cards: cards.length,
      segFits: Math.round(seg.getBoundingClientRect().width) <= 390,
      gridScrolls: grid.scrollWidth > grid.clientWidth,
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.equal(out.segFits, true, "the view switch stays inside the screen");
  assert.equal(new Set(out.btns).size, 1, "and splits it evenly rather than three sizes");
  assert.equal(out.oneWide, true, "manager cards go one per row");
  assert.equal(out.gridScrolls, true, "the board scrolls, because ten columns never fit a phone");
  assert.equal(out.noBodyScroll, true, "but the page itself never scrolls sideways");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Roster: your team by default, what each player costs to keep, and who is spent", { skip }, async () => {
  const { p, errors } = await page();
  await withDraft(p);
  const out = await p.evaluate(async (DRAFT) => {
    const St = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    const { state } = St;
    state.leagueTab = "roster";
    state.config = { ...state.config, members: [{ id: "a", name: "Alice", seasons: ["2026"] },
      { id: "b", name: "Bob", seasons: ["2026"] }] };
    state.me = "b";   // Bob is signed in, so Bob's roster should open
    St.setSquads({ bySeason: { 2026: { at: new Date().toISOString(),
      byRoster: DRAFT.byRoster, rosters: DRAFT.rosters,
      starters: { 1: ["p4"], 2: ["p5"], 3: [] } } } });
    V.render(); await new Promise(r => setTimeout(r, 40));
    const sel = document.getElementById("rosterOf");
    const read = () => ({
      picked: sel.value, options: [...sel.options].map(o => o.textContent),
      note: document.getElementById("rosterNote").textContent,
      rows: [...document.querySelectorAll("#rosterView .rlist li")].map(li => [
        li.querySelector(".rnm").textContent,
        li.querySelector(".rcost").textContent,
        li.querySelector(".rkeep") ? li.querySelector(".rkeep").textContent : "—",
        li.classList.contains("start")]),
      summary: document.querySelector("#rosterView .rsum").textContent,
      spent: document.querySelector("#rosterView .dspent") ? document.querySelector("#rosterView .dspent").textContent : "" });
    const bob = read();
    // switch to Alice's team
    sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    return { bob, alice: read(), noBodyScroll: document.documentElement.scrollWidth <= innerWidth };
  }, DRAFT);

  assert.equal(out.bob.picked, "2", "it opens on your own team, not the first in the list");
  assert.deepEqual(out.bob.options, ["Alice", "Bob · you", "Cara"], "and says which one is yours");
  assert.match(out.bob.note, /^Bob · 1 players · 1 starting/);
  assert.deepEqual(out.bob.rows, [["Rashee Rice", "—", "—", true]],
    "his one player: starting, but no band and no price, because the contract is up");
  assert.match(out.bob.spent, /Rashee Rice/, "kept in both years already, so he goes back in the pool");

  assert.equal(out.alice.picked, "1", "the picker switches teams");
  assert.deepEqual(out.alice.rows, [
    ["Bo Nix", "R4", "3–9", true],
    ["Jahmyr Gibbs", "R1", "—", false],
    ["DK Metcalf", "R11", "10–16", false],
    ["Kayshon Boutte", "9/10", "WAIVER", false]],
    "sorted QB, RB, WR. Gibbs still shows R1 - the round is why he cannot be kept, and the empty band says so");
  assert.match(out.alice.summary, /Keep up to two/, "the rule is stated, not left to be inferred");
  assert.match(out.alice.summary, /One of the 1 player you drafted in rounds 3–9/,
    "with the count folded into the rule rather than sitting beside it");
  assert.match(out.alice.summary, /1 here .* can take the 9th or 10th slot/, "the waiver route, only when there is one");
  assert.match(out.alice.summary, /costs your pick in that round/);
  assert.match(out.alice.summary, /Only one of the two may be a QB/, "the rule that catches people out");
  assert.match(out.alice.summary, /kept two seasons running goes back in the draft pool/);
  assert.equal(out.noBodyScroll, true);
  assert.deepEqual(errors, []);
  await p.close();
});
