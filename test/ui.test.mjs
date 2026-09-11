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
    res.statusTags = [...document.querySelectorAll(".srow")].map(r => [r.querySelector(".s-lab").textContent, [...r.querySelectorAll(".st-tag")].map(t => t.textContent + ":" + t.title + ":" + (getComputedStyle(t).display !== "none"))]);
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
  assert.equal(out.w5chase[0][2], "0.45"); assert.equal(out.w5chase[0][3], true, "bye tag shown");
  assert.deepEqual(out.w5maye, [["Drake MayeQB0 rec ydsNE", false, "1", false, [], "0 rec yds"]]);
  assert.deepEqual(out.w5chase.map(r => r[5]), ["0 rec yds", "61.5 rec yds"], "the picker shows the projection for the selected stat and week");
  assert.deepEqual(out.w0chase.map(r => r[5]), ["0 rec yds", "1210 rec yds"], "a season-long bet shows the season projection");
  assert.deepEqual(out.w5chase.map(r => r[4]), [[], ["Q"]], "the picker tags the questionable player");
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

test("weekly high / low: a running tally on the ledger cards and a week-by-week section", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    V.render();
    const empty = document.getElementById("highlow").textContent;
    const before = document.querySelectorAll("#board .fig").length;
    state.highlow = { weeks: {
      "1": { high: [{ id: "a", name: "Alice", pts: 148.4 }], low: [{ id: "c", name: "Cara", pts: 92.1 }] },
      "2": { high: [{ id: "a", name: "Alice", pts: 131 }], low: [{ id: "b", name: "Bob", pts: 88.6 }] } } };
    V.render();
    return { empty, before, after: document.querySelectorAll("#board .fig").length,
      standings: [...document.querySelectorAll("#highlow .hl-stand")].map(s => [s.querySelector(".hl-name").textContent, s.querySelector("b").textContent, s.querySelector("b").className, s.querySelector("small").textContent, s.classList.contains("me")]),
      rows: [...document.querySelectorAll("#highlow .hl-row")].map(r => [r.querySelector(".wk").textContent, r.querySelector(".high .hl-name").textContent, r.querySelector(".high i").textContent, r.querySelector(".low .hl-name").textContent, r.querySelector(".low i").textContent]),
      note: document.getElementById("hlNote").textContent };
  });
  assert.match(out.empty, /top Sleeper score takes \$5/, "explains itself before any week is final");
  assert.equal(out.before, 12); assert.equal(out.after, 12, "the ledger cards keep their four figures; hi/low stays out of them");
  assert.deepEqual(out.standings, [["Alice", "+$10", "pos", "2 hi · 0 low", true], ["Bob", "−$5", "neg", "0 hi · 1 low", false], ["Cara", "−$5", "neg", "0 hi · 1 low", false]], "its own standings, net first, you marked");
  assert.deepEqual(out.rows, [["WK 2", "Alice", "+$5", "Bob", "−$5"], ["WK 1", "Alice", "+$5", "Cara", "−$5"]], "latest week first");
  assert.equal(out.note, "2 weeks in · $5 a week · Alice leads at +$10");
  assert.deepEqual(errors, []);
  await p.close();
});

test("Settle Up opens with the season table: managers across, hi/low, weekly, season and total down", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = [
      { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a", pick: "x" }, { memberId: "b", pick: "y" }], paid: ["b"] },
      { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a", pick: "x" }, { memberId: "c", pick: "y" }], paid: [] },
    ];
    state.highlow = { weeks: { "1": { high: [{ id: "b", name: "Bob", pts: 140 }], low: [{ id: "c", name: "Cara", pts: 90 }] } } };
    V.render();
    const t = document.querySelector("#settle table.pivot");
    return { heads: [...t.querySelectorAll("thead th")].slice(1).map(h => [h.querySelector(".pv-head span:not(.avatar)").textContent, h.classList.contains("me")]),
      rows: [...t.querySelectorAll("tbody tr")].map(r => [r.querySelector("th").textContent, ...[...r.querySelectorAll("td")].map(d => d.textContent + ":" + d.className.replace("num ", "").replace(" total", ""))]),
      scrolls: getComputedStyle(document.querySelector("#settle .pivot-wrap")).overflowX,
      you: document.querySelector("#settle .you-line").textContent,
      balances: [...document.querySelectorAll("#settle .bal")].map(b => [b.querySelector(".bal-name").textContent, b.querySelector("b").textContent, b.classList.contains("me")]),
      transfers: [...document.querySelectorAll("#settle .debt")].map(d => [d.querySelector(".debt-txt").textContent.replace(/^[A-Z]{2}/, "").replace(/→[A-Z]{2}/, "→"), d.querySelector(".debt-amt").textContent]) };
  });
  assert.deepEqual(out.heads, [["Alice", true], ["Bob", false], ["Cara", false]], "a column per manager, yours marked");
  assert.deepEqual(out.rows, [
    ["Hi / low", "$0:flat", "+$5:pos", "−$5:neg"],
    ["Weekly bets", "−$10:neg", "$0:flat", "+$10:pos"],
    ["Season bets", "+$25:pos", "−$25:neg", "$0:flat"],
    ["Total", "+$15:pos", "−$20:neg", "+$5:pos"]], "net all season, paid or not");
  assert.equal(out.scrolls, "auto", "wide tables scroll inside the section");
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
  await p.$eval('#settle td[data-act="drill"][data-m="a"][data-row="total"]', el => el.click());   // through the real click wiring
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
    document.querySelector('#tabs .tab[data-tab="settle"]').click();
    await new Promise(r => setTimeout(r, 30));
    res.afterClick = { shown: shown(), on: badges().filter(b => b[1]).map(b => b[0]), saved: localStorage.getItem("smyrna.tab") };
    document.getElementById("meBtn").click(); res.dropOpen = !document.getElementById("meDrop").hidden;
    document.body.click(); res.dropClosed = document.getElementById("meDrop").hidden;
    return res;
  });
  assert.equal(out.line, "2026 · 10-Team Keeper SF PPR · side bets", "the league's settings from Sleeper");
  assert.equal(out.glance, "1 bet running$10 on the tableyou −$25 net · 1 seat waiting on takers");
  assert.deepEqual(out.shown, ["book"]);
  assert.deepEqual(out.badges, [["book", true, "1"], ["ledger", false, ""], ["badges", false, "6"], ["hl", false, "1"], ["rivals", false, "1"], ["settle", false, "2"]], "a seat open, six titles held, a week in, a rivalry you're behind on, two transfers to clear");
  assert.equal(out.me, "Alice"); assert.equal(out.dropHidden, true);
  assert.deepEqual(out.afterClick, { shown: ["settle"], on: ["settle"], saved: "settle" }, "the tab switches through the real click wiring and is remembered");
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
    return [...document.querySelectorAll("#rosterList .rrow")].map(r => { const s = r.querySelector(".r-seen"); return [r.querySelector(".r-name").textContent, s.textContent, !!s.title]; });
  });
  assert.deepEqual(out, [["Alice", "Last in 5m ago", true], ["Bob", "Last in Sep 1", true], ["Cara", "Never signed in", false]]);
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
    document.querySelector('#tabs .tab[data-tab="ledger"]').click(); await wait();
    const seat = document.querySelector(".board .seat"), zero = document.querySelector(".board .fig.prop.zero");   // Bob proposed a bet, so look past his row
    res.seat = { grid: cs(seat).display, propHidden: zero ? cs(zero).display : "n/a", picks: cs(seat.querySelector(".seat-picks")).display };
    seat.click(); await wait();
    res.seatOpen = cs(document.querySelector(".board .seat .seat-picks")).display;
    document.querySelector('#tabs .tab[data-tab="settle"]').click(); await wait();
    const pv = document.querySelector(".pivot");
    res.pivot = { byManager: pv.classList.contains("by-manager"), rows: [...pv.querySelectorAll("tbody th span:last-child")].map(t => t.textContent.trim()), cells: pv.querySelectorAll('td[data-act="drill"]').length, fits: pv.getBoundingClientRect().width <= innerWidth };
    document.getElementById("newBetBtn").click(); await new Promise(r => setTimeout(r, 60));
    const dlg = document.getElementById("betDlg"); res.dialog = { w: Math.round(dlg.getBoundingClientRect().width), sticky: cs(dlg.querySelector(".form-foot")).position };
    dlg.close();
    return res;
  });
  assert.deepEqual(out.tabs, { position: "fixed", atBottom: true, fits: true, oneRow: true, count: 6 }, "all six tabs on one fixed row at the bottom");
  assert.equal(out.fab, "fixed"); assert.equal(out.refresh, "\u21bb"); assert.equal(out.filtersNoWrap, "nowrap");
  assert.deepEqual(out.open, { fold: false, foldBtn: false }, "a ticket still looking for people never folds");
  assert.deepEqual(out.pot, { fold: true, desc: "none", sides: "none", rows: 2, bar: "none", btn: "Details" }, "folded: the stat rows carry the sides and their numbers, no bars, no terms");
  assert.deepEqual(out.potOpen, { fold: false, desc: "block", btn: "Less" });
  assert.equal(out.doneOpen, true, "a tap anywhere on a folded ticket opens it");
  assert.deepEqual(out.seat, { grid: "grid", propHidden: "none", picks: "none" }, "ledger rows hide empty proposed/cancelled and the bet names");
  assert.equal(out.seatOpen, "block");
  assert.deepEqual(out.pivot, { byManager: true, rows: ["Alice", "Bob", "Cara"], cells: 12, fits: true }, "Settle Up's table runs by manager on a phone");
  assert.deepEqual(out.dialog, { w: 390, sticky: "sticky" }, "dialogs fill the screen with the buttons pinned");
  assert.deepEqual(errors, []);
  await p.close();
});

test("desktop is untouched: no folding, tabs in the panel, the season table with managers across", { skip }, async () => {
  const { p, errors } = await page(null, { width: 1200, height: 900 });
  await phoneState(p);
  const out = await p.evaluate(async () => {
    const cs = (el) => getComputedStyle(el);
    document.querySelector('#tabs .tab[data-tab="settle"]').click(); await new Promise(r => setTimeout(r, 30));
    return { fold: !!document.querySelector("article.ticket.fold"), foldBtn: cs(document.querySelector(".t-fold")).display, tabs: cs(document.getElementById("tabs")).position, fab: cs(document.getElementById("newBetBtn")).position,
      pivot: document.querySelector(".pivot").classList.contains("by-manager"), refresh: document.getElementById("refreshBtn").textContent };
  });
  assert.deepEqual(out, { fold: false, foldBtn: "none", tabs: "static", fab: "static", pivot: false, refresh: "Refresh stats" });
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
    res.badge = (() => { const n = document.getElementById("tabN-rivals"); return [n.hidden, n.textContent]; })();
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

test("Rivals: nothing settled yet says so, and a bet opens from the grid with the Book's filters cleared", { skip }, async () => {
  const { p, errors } = await page();
  const out = await p.evaluate(async (BETS) => {
    const { state } = await import("./state.js?v=dev"); const V = await import("./render.js?v=dev");
    state.bets = []; state.tab = "rivals"; V.render();
    const res = { empty: document.querySelector("#rivals .empty").textContent.slice(0, 22), badge: document.getElementById("tabN-rivals").hidden };
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
  assert.equal(out.tabs, 6); assert.equal(out.tabFits, true, "six tabs still fit the bottom bar");
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
    document.querySelector('#tabs .tab[data-tab="ledger"]').click();
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
