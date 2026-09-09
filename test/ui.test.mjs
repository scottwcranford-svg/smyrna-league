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
async function page() {
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  await p.goto(base, { waitUntil: "load" });
  await p.waitForSelector("#bEntries", { timeout: 20000 });
  await p.evaluate(async () => {
    const { state } = await import("./state.js?v=dev");
    state.config = { leagueName: "T", season: "2026", stake: 25, adminEmails: [],
      members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }],
      kickoff: "2026-09-10T00:20:00Z" };
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
    F.drawSugg(0, "chase"); const joinChase = sugg();
    return { w5chase, w5maye, w5def, w0chase, w5saved, w5toast, w0saved, joinChase };
  });
  assert.deepEqual(out.w5chase.map(r => r[1]), [true, true], "both CIN rows disabled");
  assert.equal(out.w5chase[0][2], "0.45"); assert.equal(out.w5chase[0][3], true, "bye tag shown");
  assert.deepEqual(out.w5maye, [["Drake MayeQB0 rec ydsNE", false, "1", false, [], "0 rec yds"]]);
  assert.deepEqual(out.w5chase.map(r => r[5]), ["0 rec yds", "61.5 rec yds"], "the picker shows the projection for the selected stat and week");
  assert.deepEqual(out.w0chase.map(r => r[5]), ["0 rec yds", "1210 rec yds"], "a season-long bet shows the season projection");
  assert.deepEqual(out.w5chase.map(r => r[4]), [[], ["Q"]], "the picker tags the questionable player");
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
