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
