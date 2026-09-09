// Browser smoke test against the live site (or SITE env): sign in, and check what's
// actually on screen — the login card is not displayed (computed style, not a flag),
// the app is, the tickets render, and the propose form opens. Then a round of
// read-only clicks: filters, the League dialog, the form's game and stat modes, the
// player picker. Nothing here writes to the book. Saves a screenshot.
//
//   E2E_USER=mwong22 E2E_PASS=... [E2E_KEY=smyrna-league-2026] [SITE=http://127.0.0.1:8898/] node test/e2e/flow.js
"use strict";
const puppeteer = require("puppeteer-core");
const path = require("path");

const SITE = process.env.SITE || "https://scottwcranford-svg.github.io/smyrna-league/";
const USER = process.env.E2E_USER, PASS = process.env.E2E_PASS, KEY = process.env.E2E_KEY || "smyrna-league-2026";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!USER || !PASS) { console.error("set E2E_USER and E2E_PASS"); process.exit(2); }

const $ = (sel) => document.querySelector(sel);
const shown = (id) => getComputedStyle(document.getElementById(id)).display !== "none";

let browser; const errors = [], checks = {};
(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-extensions"], defaultViewport: { width: 1200, height: 900 } });
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  // console errors count, except the browser's own "Failed to load resource" for the site's missing favicon
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto(SITE, { waitUntil: "load" });
  // the Go button enables once the modules have loaded and bound the form
  await page.waitForSelector("#siGo:not([disabled])", { timeout: 30000 });
  await page.type("#siName", USER); await page.type("#siPw", PASS);
  if (!(await page.$eval("#siKeyRow", e => e.hidden))) await page.type("#siKey", KEY);
  await page.click("#siGo");

  // The first sign-in right after a deploy sometimes never opens the book (cold CDN
  // edge or a slow first Firestore long-poll); a reload and second try always has.
  const bookOpen = () => page.waitForFunction(() => getComputedStyle(document.getElementById("login")).display === "none", { timeout: 45000 });
  try { await bookOpen(); }
  catch (e) {
    checks.retried = await page.evaluate(() => document.getElementById("siHint").textContent);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#siGo:not([disabled])", { timeout: 30000 });
    // the device remembers the passcode now; the account may still be signed in
    if (await page.evaluate(() => !document.getElementById("login").hidden)) {
      await page.type("#siName", USER); await page.type("#siPw", PASS); await page.click("#siGo");
    }
    await bookOpen();
  }
  await page.waitForFunction(() => document.querySelectorAll("article.ticket").length > 0, { timeout: 15000 });
  Object.assign(checks, await page.evaluate(() => ({
    appDisplay: getComputedStyle(document.getElementById("app")).display,
    me: document.getElementById("meName").textContent,
    tickets: document.querySelectorAll("article.ticket").length,
    seats: document.querySelectorAll(".seat").length,
    tickerGames: document.querySelectorAll(".ticker .game").length / 2,
    forcedPw: document.getElementById("pwDlg").open,
    // Join shows on stat bets this manager isn't in; never on game bets or player-vs-field bets
    joinOn: [...document.querySelectorAll("article.ticket")].filter(a => a.querySelector('[data-act="join"]')).map(a => a.querySelector(".terms").textContent),
  })));
  // a forced password change (test account still on its default) sits on top; close it without changing anything
  if (checks.forcedPw) await page.evaluate(() => { document.getElementById("pwDlg").close(); });

  // filters: a status chip, "only mine", the week select — the ticket list must follow
  await page.click('.chip[data-act="filter"][data-status="active"]');
  await page.waitForFunction(() => document.querySelector('.chip[data-status="active"]').getAttribute("aria-pressed") === "true");
  checks.liveOnly = await page.evaluate(() => [...document.querySelectorAll("article.ticket")].every(a => a.classList.contains("active")));
  await page.click('.chip[data-act="mine"]');
  await page.waitForFunction(() => document.querySelector('.chip[data-act="mine"]').getAttribute("aria-pressed") === "true");
  checks.mineOnly = await page.evaluate(() => document.querySelectorAll("article.ticket").length);
  await page.click('.chip[data-act="mine"]');
  await page.click('.chip[data-act="filter"][data-status="all"]');
  await page.waitForFunction((n) => document.querySelectorAll("article.ticket").length === n, {}, checks.tickets);

  // the League dialog opens read-only for a non-admin and closes
  await page.click("#rosterBtn");
  await page.waitForFunction(() => document.getElementById("rosterDlg").open);
  checks.rosterRows = await page.evaluate(() => document.querySelectorAll("#rosterList .rrow").length);
  checks.rosterReadOnly = await page.evaluate(() => document.getElementById("rSave").hidden && document.getElementById("rName").disabled);
  await page.evaluate(() => document.getElementById("rosterDlg").close());

  // the propose form: player mode with the picker, stat chips toggle, game mode lists games
  await page.click("#newBetBtn");
  await page.waitForFunction(() => document.getElementById("betDlg").open, { timeout: 5000 });
  Object.assign(checks, await page.evaluate(() => ({ title: document.getElementById("bTitle").textContent, scopeChips: document.querySelectorAll("#bScope .chip").length,
    statChips: document.querySelectorAll("#bStats .chip").length, entryRows: document.querySelectorAll("#bEntries .entry-row").length })));
  await page.click('#bStats .chip[data-stat="rec_yd"]');
  checks.twoStats = await page.evaluate(() => document.querySelectorAll('#bStats .chip[aria-pressed="true"]').length);
  await page.type('#bEntries input[data-act="dSearch"][data-i="0"]', "chase");
  await page.waitForFunction(() => { const s = document.getElementById("sugg0"); return s && !s.hidden && s.querySelectorAll("button").length > 0; }, { timeout: 5000 });
  await page.click('#sugg0 button');
  checks.pickChip = await page.evaluate(() => (document.querySelector("#bEntries .pick-chip") || {}).textContent || "");
  await page.click('#bScope .chip[data-scope="game"]');
  await page.waitForFunction(() => !document.getElementById("bGameBox").hidden);
  checks.gameOptions = await page.evaluate(() => document.querySelectorAll("#bGame option").length - 1);
  await page.select("#bGame", await page.$eval("#bGame option:nth-child(2)", o => o.value));
  await page.waitForFunction(() => document.querySelectorAll('#bEntries .chip[data-act="dSide"]').length === 2);
  await page.click('#bEntries .chip[data-act="dSide"]');
  checks.sideTaken = await page.evaluate(() => document.querySelectorAll('#bEntries .chip[data-act="dSide"][aria-pressed="true"]').length);
  await page.evaluate(() => document.getElementById("betDlg").close());

  // change-password dialog opens and closes
  await page.click("#pwBtn");
  await page.waitForFunction(() => document.getElementById("pwDlg").open);
  await page.evaluate(() => document.getElementById("pwDlg").close());

  const shot = path.join(__dirname, "flow.png"); await page.screenshot({ path: shot });
  await browser.close();

  const ok = checks.appDisplay !== "none" && checks.me === USER && checks.tickets >= 1 && checks.seats >= 1 && checks.liveOnly === true
    && checks.joinOn.length >= 1 && !checks.joinOn.some(t => /White Men Can Catch|NE @ SEA/.test(t))
    && checks.rosterRows >= 1 && checks.rosterReadOnly === true
    && checks.title === "Propose a bet" && checks.scopeChips === 3 && checks.statChips >= 10 && checks.entryRows === 1 && checks.twoStats === 2
    && /Chase/.test(checks.pickChip) && checks.gameOptions >= 1 && checks.sideTaken === 1 && errors.length === 0;
  console.log(JSON.stringify({ ...checks, errors }, null, 0));
  console.log(ok ? "E2E OK — screenshot " + shot : "E2E FAILED");
  process.exit(ok ? 0 : 1);
})().catch(async e => {
  // say what the login card was showing when it gave up
  let hint = "";
  try { const pages = await browser.pages(); hint = await pages[pages.length - 1].evaluate(() => document.getElementById("siHint").textContent); } catch (_) {}
  console.error("E2E FAILED:", e.message, hint ? "| login card said: " + hint : "", JSON.stringify(checks), JSON.stringify(errors));
  try { await browser.close(); } catch (_) {}
  process.exit(1);
});
