// Push notifications for the book. Three Firestore triggers watch what the app
// writes (a bet, the payments log, the week's high and low), work out who should
// hear about it (notices.js), and send through Firebase Cloud Messaging to every
// device those managers turned notifications on from. Devices are in league/push:
// { byToken: { <fcm token>: { memberId, at, ua } } }, written by notify.js in the app.
//
// Deploy (needs the project on the Blaze plan and `firebase login` once):
//   firebase deploy --only functions
"use strict";
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldPath, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { betNotices, paymentNotices, highLowNotices } = require("./notices");

setGlobalOptions({ region: "us-central1", maxInstances: 3, memory: "256MiB", timeoutSeconds: 60 });
initializeApp();

// Where a tap on a notification lands. ?bet=<id> scrolls the app to that ticket.
const SITE = process.env.SITE_URL || "https://scottwcranford-svg.github.io/smyrna-league/";

function book(key){ return getFirestore().collection("books").doc(key); }

async function leagueOf(key){
  const s = await book(key).collection("league").doc("config").get();
  const d = s.exists ? s.data() : {};
  return { members: Array.isArray(d.members) ? d.members : [], hlStake: Number(d.hlStake) > 0 ? Number(d.hlStake) : 5 };
}

// Send each notice to every device of every manager it names; forget tokens FCM
// says are gone (the app was removed, or the browser dropped the subscription).
async function deliver(key, notices){
  if (!notices.length) return;
  const pushRef = book(key).collection("league").doc("push");
  const snap = await pushRef.get();
  const byToken = (snap.exists && snap.data().byToken) || {};
  const tokensOf = {};
  for (const [tok, v] of Object.entries(byToken)) if (v && v.memberId) (tokensOf[v.memberId] = tokensOf[v.memberId] || []).push(tok);
  const dead = new Set();
  for (const n of notices) {
    const tokens = [...new Set(n.to.flatMap(id => tokensOf[id] || []))];
    if (!tokens.length) { logger.info("nobody listening", { title: n.title, to: n.to }); continue; }
    const link = SITE + (n.bet ? "?bet=" + encodeURIComponent(n.bet) : "");
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: n.title, body: n.body },
      data: { bet: n.bet || "", tag: n.tag || "", link },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        notification: { title: n.title, body: n.body, icon: SITE + "icon-192.png", tag: n.tag || undefined, renotify: !!n.tag },
        fcmOptions: { link }
      }
    });
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const c = r.error && r.error.code;
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-argument" || c === "messaging/invalid-registration-token") dead.add(tokens[i]);
      else logger.warn("send failed", { code: c, message: r.error && r.error.message });
    });
    logger.info("sent", { title: n.title, managers: n.to.length, devices: tokens.length, ok: res.successCount });
  }
  if (dead.size) {
    const args = [];
    dead.forEach(t => { args.push(new FieldPath("byToken", t), FieldValue.delete()); });
    await pushRef.update(...args).catch(e => logger.warn("prune failed", e.message));
    logger.info("pruned", { tokens: dead.size });
  }
}

const doc = s => (s && s.exists ? s.data() : null);

exports.betChanged = onDocumentWritten("books/{book}/bets/{id}", async (ev) => {
  const before = doc(ev.data.before), after = doc(ev.data.after);
  if (after) after.id = ev.params.id;
  const L = await leagueOf(ev.params.book);
  await deliver(ev.params.book, betNotices(before, after, L.members));
});

exports.paymentsChanged = onDocumentWritten("books/{book}/league/payments", async (ev) => {
  const L = await leagueOf(ev.params.book);
  await deliver(ev.params.book, paymentNotices(doc(ev.data.before), doc(ev.data.after), L.members));
});

exports.highLowChanged = onDocumentWritten("books/{book}/league/highlow", async (ev) => {
  const L = await leagueOf(ev.params.book);
  await deliver(ev.params.book, highLowNotices(doc(ev.data.before), doc(ev.data.after), L.members, L.hlStake));
});

/* ---- the season roster: who Sleeper says is in the league ---- */
// New managers arrive between seasons, and until now each one needed the admin to create
// an account by hand — which the Firebase console blocks from the browser anyway, since
// public sign-up is switched off. The Admin SDK has no such limit, so this does it: once a
// day it reads the current season's Sleeper league, adds anyone the book is missing with
// the app's default password, and records the season against everyone still playing. They
// are forced to pick a real password the first time they sign in.
//
// Nobody is ever removed. A manager who left keeps their record — bets, badges and
// rivalries point at it by id — and simply doesn't get the new season on their list.
// The reconcile itself is roster.js, tested under test/rostersync.test.mjs.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getAuth } = require("firebase-admin/auth");
const { reconcile, applyPlan, isNoop, emailFor } = require("./roster");

const SLEEPER = "https://api.sleeper.app";
const memberId = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// A season's Sleeper league id: the season's own, else the book-wide one. Sleeper mints a
// new id every year, so this is the thing that actually changes come September.
function leagueIdFor(cfg, season) {
  const per = (cfg && cfg.bySeason && cfg.bySeason[String(season)]) || {};
  return String(per.leagueId || (cfg && cfg.sleeperLeagueId) || "");
}

async function syncBook(key) {
  const ref = book(key).collection("league").doc("config");
  const cfg = doc(await ref.get());
  if (!cfg || !Array.isArray(cfg.members)) return { key, skipped: "no config" };

  const season = String(cfg.season || "2026");
  const leagueId = leagueIdFor(cfg, season);
  if (!leagueId) return { key, skipped: "no Sleeper league id" };

  const res = await fetch(`${SLEEPER}/v1/league/${leagueId}/users`);
  if (!res.ok) return { key, skipped: `Sleeper said ${res.status}` };
  const users = await res.json();
  // An empty read is indistinguishable from everyone leaving, so treat it as nothing to do.
  if (!Array.isArray(users) || !users.length) return { key, skipped: "Sleeper returned nobody" };

  const plan = reconcile(users, cfg.members, season, memberId);
  if (isNoop(plan)) return { key, season, added: 0, carried: 0 };

  // Accounts first: a member nobody can sign in as is worse than no member.
  const made = [];
  for (const a of plan.adds) {
    try {
      await getAuth().createUser({ email: a.account.email, password: a.account.password });
      made.push(a.member.name);
    } catch (e) {
      if (e && e.code === "auth/email-already-exists") { made.push(a.member.name); continue; }
      logger.error("account failed", { name: a.member.name, code: e && e.code, message: e && e.message });
      a.failed = true;
    }
  }
  plan.adds = plan.adds.filter(a => !a.failed);
  if (isNoop(plan)) return { key, season, added: 0, carried: 0, failed: true };

  await ref.update({ members: applyPlan(cfg.members, plan) });
  logger.info("roster synced", { key, season, added: made, carried: plan.seasonAdds.length,
    skipped: plan.skipped });
  return { key, season, added: plan.adds.length, carried: plan.seasonAdds.length };
}

exports.syncRoster = onSchedule({ schedule: "every day 06:00", timeZone: "America/New_York" }, async () => {
  const books = await getFirestore().collection("books").listDocuments();
  for (const b of books) {
    try { logger.info("sync", await syncBook(b.id)); }
    catch (e) { logger.error("sync failed", { key: b.id, message: e && e.message }); }
  }
});

// The same sync, on demand. The app has no Cloud Functions SDK vendored, so the button
// writes a request into the book the way "Refresh stats" already does, and this picks it
// up. The result goes back on the same document so the League dialog can say what
// happened instead of leaving the admin to read the logs.
//
// Writing the result is itself a write to this document, so the trigger fires again: the
// guard is that only a *new* requestedAt is work. Without it this is a loop, which is the
// same trap the badge sync hit in September.
exports.rosterSyncRequested = onDocumentWritten("books/{book}/league/rosterSync", async (ev) => {
  const before = doc(ev.data.before), after = doc(ev.data.after);
  if (!after || !after.requestedAt) return;
  if (before && before.requestedAt === after.requestedAt) return;   // our own result write

  const key = ev.params.book;
  const ref = book(key).collection("league").doc("rosterSync");
  const stamp = { requestedAt: after.requestedAt, finishedAt: new Date().toISOString() };

  // Firestore rules let any signed-in manager write league/{doc}, so the real check is
  // here, where it cannot be skipped by writing the document directly.
  const cfg = doc(await book(key).collection("league").doc("config").get());
  const admins = (cfg && Array.isArray(cfg.adminEmails) ? cfg.adminEmails : []).map(e => String(e).toLowerCase());
  const me = (cfg && cfg.members || []).find(m => m.id === after.requestedBy);
  if (!me || admins.indexOf(emailFor(me.name)) < 0) {
    logger.warn("roster sync refused", { key, by: after.requestedBy });
    await ref.update(Object.assign(stamp, { note: "Only an admin can sync the roster" }));
    return;
  }

  try {
    const r = await syncBook(key);
    await ref.update(Object.assign(stamp, {
      added: r.added || 0, carried: r.carried || 0,
      note: r.skipped ? r.skipped : (r.added || r.carried ? "" : "Already up to date"),
    }));
    logger.info("roster sync on request", r);
  } catch (e) {
    logger.error("roster sync failed", { key, message: e && e.message });
    await ref.update(Object.assign(stamp, { note: "Sync failed — check the logs" }));
  }
});
