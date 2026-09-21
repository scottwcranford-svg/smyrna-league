// The dealer's front door. One HTTPS request in, one Firestore transaction, one reply.
//
// The request carries the caller's Firebase ID token; that gives an email, the email
// finds the manager in league/config the way the app does (identity.js
// memberForEmail), and the manager's id and uid go to the engine. Every poker document
// is written here with the Admin SDK - the rules let no client write them - so the only
// way chips move is through the engine.
//
// Each request names the hand and seq it was looking at; a request about a table that
// has since moved on is refused with 409 and the current numbers, which is what lets
// every open page send "tick" when a clock runs out without any of them doing harm.
//
// Pure apart from the Firestore and Auth handles passed in, so the tests run it
// against fakes: makeHandler({ db, verify, deliver, now, rng, logger }).
"use strict";
const { reduce, due, EngineError } = require("./engine");
const { pokerNotices } = require("./notices");
const { emailFor } = require("../roster");

const CONFIG_TTL = 60000;
const HISTORY_HANDS = 150, HISTORY_BYTES = 300000;

function makeHandler(deps){
  const db = deps.db, verify = deps.verify, deliver = deps.deliver || (async () => {});
  const now = deps.now || (() => Date.now()), rng = deps.rng || null;
  const log = deps.logger || { info(){}, warn(){}, error(){} };
  const cache = {};

  async function config(key){
    const c = cache[key];
    if (c && now() - c.at < CONFIG_TTL) return c.cfg;
    const s = await db.collection("books").doc(key).collection("league").doc("config").get();
    const cfg = s.exists ? s.data() : null;
    cache[key] = { at: now(), cfg };
    return cfg;
  }
  const memberFor = (cfg, email) => (cfg && cfg.members || []).find(m => m && emailFor(m.name) === String(email || "").toLowerCase()) || null;
  const isAdmin = (cfg, email) => (cfg && Array.isArray(cfg.adminEmails) ? cfg.adminEmails : []).map(e => String(e).toLowerCase()).indexOf(String(email || "").toLowerCase()) >= 0;
  const inSeason = (cfg, m) => (Array.isArray(m.seasons) && m.seasons.length ? m.seasons : ["2026"]).map(String).indexOf(String(cfg.season || "2026")) >= 0;

  // A browser's request: { method, headers, body }. Returns { status, body }.
  async function handle(req){
    if (req.method !== "POST") return { status: 405, body: { error: "method" } };
    const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return { status: 401, body: { error: "signin", message: "Sign in first" } };
    let who;
    try { who = await verify(token); } catch (e) { return { status: 401, body: { error: "signin", message: "Sign in again" } }; }
    if (!who || !who.uid || !who.email) return { status: 401, body: { error: "signin", message: "Sign in again" } };
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const key = String(body.key || ""), op = String(body.op || "");
    if (!key || !op) return { status: 400, body: { error: "request", message: "Missing key or op" } };
    const cfg = await config(key);
    const me = memberFor(cfg, who.email);
    if (!cfg || !me) return { status: 403, body: { error: "not_member", message: "Not a manager in this league" } };
    if (op !== "tick" && !inSeason(cfg, me)) return { status: 403, body: { error: "not_this_season", message: "Only this season's managers can play" } };
    const ctx = { now: now(), me: { id: me.id, uid: who.uid, name: me.name }, admin: isAdmin(cfg, who.email) };
    if (rng) ctx.rng = rng;
    return run(key, body, ctx, cfg.members || []);
  }

  // The transaction. `ev` is the request body; `ctx` what the engine needs to know.
  async function run(key, ev, ctx, members){
    const book = db.collection("books").doc(key);
    const refs = { table: book.collection("poker").doc("table"), secret: book.collection("pokerSecret").doc("table"), session: book.collection("poker").doc("session") };
    let out;
    try {
      out = await db.runTransaction(async (tx) => {
        const ts = await tx.get(refs.table), ss = await tx.get(refs.secret), ns = await tx.get(refs.session);
        const state = { table: ts.exists ? ts.data() : null, secret: ss.exists ? ss.data() : null, session: ns.exists ? ns.data() : null };
        const T = state.table;
        if (ev.op !== "open" && T && T.status !== "closed" && (ev.op !== "tick" || ev.seq != null)) {
          if (Number(ev.hand) !== T.handNo || Number(ev.seq) !== T.seq) return { status: 409, body: { error: "stale", hand: T.handNo, seq: T.seq } };
        }
        const histRef = T && T.sessionId ? book.collection("pokerHistory").doc(T.sessionId) : null;
        const hs = histRef ? await tx.get(histRef) : null;
        let S;
        try { S = reduce(state, ev, ctx); }
        catch (e) {
          if (e instanceof EngineError) return { status: 400, body: Object.assign({ error: e.code, message: e.message }, e.extra || {}) };
          throw e;
        }
        if (!S.effects.changed) return { status: 200, body: { ok: true, idle: true, seq: T ? T.seq : 0 } };
        tx.set(refs.table, S.table); tx.set(refs.secret, S.secret); tx.set(refs.session, S.session);
        S.effects.deal.forEach(d => tx.set(book.collection("pokerHole").doc(d.uid), { handNo: d.handNo, seat: d.seat, cards: d.cards }));
        S.effects.clearHole.forEach(uid => tx.delete(book.collection("pokerHole").doc(uid)));
        if (S.effects.history.length && histRef) {
          const hist = hs && hs.exists && Array.isArray(hs.data().hands) ? hs.data() : { hands: [] };
          hist.hands = hist.hands.concat(S.effects.history);
          while (hist.hands.length > HISTORY_HANDS || (hist.hands.length > 1 && JSON.stringify(hist).length > HISTORY_BYTES)) hist.hands.shift();
          tx.set(histRef, hist);
        }
        if (S.effects.archive) tx.set(book.collection("pokerSessions").doc(S.session.id), S.session);
        return { status: 200, body: { ok: true, seq: S.table.seq }, notices: pokerNotices(T, S.table, S.effects, members) };
      });
    } catch (e) {
      log.error("dealer failed", { key, op: ev.op, message: e && e.message });
      return { status: 500, body: { error: "dealer", message: "The dealer stumbled — try again" } };
    }
    if (out.notices && out.notices.length) {
      try { await deliver(key, out.notices); } catch (e) { log.warn("poker notices failed", { key, message: e && e.message }); }
    }
    return { status: out.status, body: out.body };
  }

  // Every minute: any table whose clock has run out with nobody left to tick it.
  async function sweep(){
    const books = await db.collection("books").listDocuments();
    const done = [];
    for (const b of books) {
      try {
        const s = await b.collection("poker").doc("table").get();
        const T = s.exists ? s.data() : null;
        if (!due(T, now())) continue;
        const cfg = await config(b.id);
        const r = await run(b.id, { op: "tick" }, { now: now(), me: null, admin: false, rng: rng || undefined }, (cfg && cfg.members) || []);
        done.push({ key: b.id, status: r.status, seq: r.body && r.body.seq });
      } catch (e) { log.error("sweep failed", { key: b.id, message: e && e.message }); }
    }
    return done;
  }

  return { handle, sweep, run };
}

module.exports = { makeHandler };
