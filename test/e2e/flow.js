// Browser smoke test against the live site (or SITE env): sign in, and check what's
// actually on screen — the login card is not displayed (computed style, not a flag),
// the app is, the tickets render, and the propose form opens. Saves a screenshot.
//
//   E2E_USER=mwong22 E2E_PASS=... [E2E_KEY=smyrna-league-2026] [SITE=http://127.0.0.1:8898/] node test/e2e/flow.js
"use strict";
const puppeteer = require("puppeteer-core");
const path = require("path");

const SITE = process.env.SITE || "https://scottwcranford-svg.github.io/smyrna-league/";
const USER = process.env.E2E_USER, PASS = process.env.E2E_PASS, KEY = process.env.E2E_KEY || "smyrna-league-2026";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!USER || !PASS) { console.error("set E2E_USER and E2E_PASS"); process.exit(2); }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-extensions"], defaultViewport: { width: 1200, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForSelector("#siName", { timeout: 15000 });
  await page.type("#siName", USER); await page.type("#siPw", PASS);
  if (!(await page.$eval("#siKeyRow", e => e.hidden))) await page.type("#siKey", KEY);
  await page.click("#siGo");

  await page.waitForFunction(() => getComputedStyle(document.getElementById("login")).display === "none", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("article.ticket").length > 0, { timeout: 15000 });
  const state = await page.evaluate(() => ({
    appDisplay: getComputedStyle(document.getElementById("app")).display,
    me: document.getElementById("meName").textContent,
    tickets: document.querySelectorAll("article.ticket").length,
    seats: document.querySelectorAll(".seat").length,
    tickerGames: document.querySelectorAll(".ticker .game").length / 2,
    forcedPw: document.getElementById("pwDlg").open,
  }));
  // a forced password change (test account still on its default) sits on top; close it without changing anything
  if (state.forcedPw) await page.evaluate(() => { document.getElementById("pwDlg").close(); });
  await page.click("#newBetBtn");
  await page.waitForFunction(() => document.getElementById("betDlg").open, { timeout: 5000 });
  const form = await page.evaluate(() => ({ title: document.getElementById("bTitle").textContent, scopeChips: document.querySelectorAll("#bScope .chip").length }));
  await page.evaluate(() => document.getElementById("betDlg").close());
  const shot = path.join(__dirname, "flow.png"); await page.screenshot({ path: shot });
  await browser.close();

  const ok = state.appDisplay !== "none" && state.me === USER && state.tickets >= 1 && state.seats >= 1 && form.title === "Propose a bet" && form.scopeChips === 3 && errors.length === 0;
  console.log(JSON.stringify({ ...state, ...form, errors }, null, 0));
  console.log(ok ? "E2E OK — screenshot " + shot : "E2E FAILED");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error("E2E FAILED:", e.message); process.exit(1); });
