// The dealer's front door against a fake Firestore and a fake Auth: who gets in, the
// stale check, what is written where (the secret, the hole cards per uid, the history,
// the archive), the sweep, and the notices going out.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { makeHandler } = req("../functions/poker/handler.js");
const { pokerNotices } = req("../functions/poker/notices.js");
const E = req("../functions/poker/engine.js");

// ---- a fake Admin Firestore: nested collections, transactions that commit on return ----
function fakeDb(){
  const docs = new Map();
  const snap = (p) => ({ exists: docs.has(p), data: () => docs.get(p), id: p.split("/").pop() });
  const ref = (p) => ({ path: p, id: p.split("/").pop(), get: async () => snap(p), collection: (c) => col(p + "/" + c) });
  const col = (prefix) => ({
    doc: (id) => ref(prefix + "/" + id),
    listDocuments: async () => [...new Set([...docs.keys()].filter(k => k.startsWith(prefix + "/")).map(k => k.slice(prefix.length + 1).split("/")[0]))].map(id => ref(prefix + "/" + id)),
  });
  return {
    docs,
    collection: (c) => col(c),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: async (r) => snap(r.path), set: (r, d) => writes.push(["set", r.path, JSON.parse(JSON.stringify(d))]), delete: (r) => writes.push(["del", r.path]) };
      const out = await fn(tx);
      writes.forEach(([op, p, d]) => { if (op === "set") docs.set(p, d); else docs.delete(p); });
      return out;
    },
  };
}

const T0 = Date.parse("2026-09-24T01:00:00Z");
const members = [{ id: "a", name: "Alice", seasons: ["2026"] }, { id: "b", name: "Bob", seasons: ["2026"] }, { id: "c", name: "Cara", seasons: ["2026"] }, { id: "z", name: "Zed", seasons: ["2025"] }];
const tokens = { ta: { uid: "u_a", email: "alice@smyrna.league" }, tb: { uid: "u_b", email: "bob@smyrna.league" }, tc: { uid: "u_c", email: "cara@smyrna.league" }, tz: { uid: "u_z", email: "zed@smyrna.league" }, tx: { uid: "u_x", email: "nobody@smyrna.league" } };

function rig(){
  const db = fakeDb();
  db.docs.set("books/k1/league/config", { season: "2026", members, adminEmails: ["cara@smyrna.league"] });
  let clock = T0;
  const sent = [];
  const H = makeHandler({ db, verify: async (t) => { if (!tokens[t]) throw new Error("bad"); return tokens[t]; }, deliver: async (key, ns) => { sent.push(...ns.map(n => [key, n.to.join(","), n.title])); }, now: () => clock, rng: () => 0 });
  const post = (tok, body) => H.handle({ method: "POST", headers: { authorization: tok ? "Bearer " + tok : "" }, body: Object.assign({ key: "k1" }, body) });
  const table = () => db.docs.get("books/k1/poker/table");
  const at = (t) => { clock = t; };
  const stamped = (tok, body) => { const T = table(); return post(tok, Object.assign({ hand: T.handNo, seq: T.seq }, body)); };
  return { db, H, post, stamped, table, at, sent, clock: () => clock };
}

test("the door: no token, a bad token, a stranger, last season's manager", async () => {
  const R = rig();
  assert.equal((await R.post("", { op: "open" })).status, 401);
  assert.equal((await R.post("nope", { op: "open" })).status, 401);
  assert.equal((await R.H.handle({ method: "GET", headers: {}, body: {} })).status, 405);
  assert.deepEqual((await R.post("tx", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 })).body.error, "not_member");
  assert.deepEqual((await R.post("tz", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 })).body.error, "not_this_season");
  assert.equal((await R.post("ta", { op: "sit" })).status, 400, "no table yet");
  assert.equal((await R.post("ta", { op: "sit" })).body.error, "no_table");
});

test("open, sit, deal: the public table, the secret, a hole doc per uid, and the notices", async () => {
  const R = rig();
  let r = await R.post("ta", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 });
  assert.deepEqual(r.body, { ok: true, seq: 1 });
  assert.equal(R.table().status, "open"); assert.ok(R.db.docs.has("books/k1/pokerSecret/table")); assert.ok(R.db.docs.has("books/k1/poker/session"));
  assert.deepEqual(R.sent, [["k1", "b,c,z", "Poker table open · $1/$2"]], "everyone but the opener hears, whatever season they played");
  r = await R.stamped("ta", { op: "sit", seat: 0, buyIn: 10000 }); assert.equal(r.status, 200);
  r = await R.post("tb", { op: "sit", seat: 1, buyIn: 10000, hand: 0, seq: 1 });
  assert.deepEqual(r.body, { error: "stale", hand: 0, seq: 2 }, "a request about an older table is refused with the current numbers");
  assert.equal(r.status, 409);
  r = await R.stamped("tb", { op: "sit", seat: 1, buyIn: 10000 }); assert.equal(r.status, 200);
  assert.equal(R.table().status, "between");
  r = await R.post("tb", { op: "tick" }); assert.deepEqual(r.body.idle, true, "not yet");
  R.at(T0 + E.BETWEEN);
  r = await R.post("tb", { op: "tick" }); assert.equal(r.body.ok, true); assert.equal(r.body.idle, undefined);
  const T = R.table();
  assert.equal(T.status, "hand"); assert.equal(T.handNo, 1);
  const ha = R.db.docs.get("books/k1/pokerHole/u_a"), hb = R.db.docs.get("books/k1/pokerHole/u_b");
  assert.equal(ha.handNo, 1); assert.equal(ha.seat, 0); assert.equal(ha.cards.length, 2);
  assert.equal(hb.seat, 1); assert.notDeepEqual(ha.cards, hb.cards);
  const secret = R.db.docs.get("books/k1/pokerSecret/table");
  assert.deepEqual(secret.hole["0"], ha.cards); assert.equal(secret.deck.length, 52);
  assert.equal(JSON.stringify(T).indexOf(ha.cards[0]), -1, "no hole card on the public table");
  // a stamped tick from a page that has already seen the deal is a no-op with 409, not a second timeout
  r = await R.post("tb", { op: "tick", hand: 1, seq: 3 }); assert.equal(r.status, 409);
});

test("acting: wrong player, the engine's refusals, then a hand to the end and its history; leaving clears the hole doc", async () => {
  const R = rig();
  await R.post("ta", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 });
  await R.stamped("ta", { op: "sit", seat: 0, buyIn: 10000 }); await R.stamped("tb", { op: "sit", seat: 1, buyIn: 10000 });
  R.at(T0 + E.BETWEEN); await R.post("tb", { op: "tick" });
  let r = await R.stamped("tb", { op: "act", action: "check" });
  assert.equal(r.status, 400); assert.equal(r.body.error, "not_your_turn");
  r = await R.stamped("ta", { op: "act", action: "raise", amount: 250 });
  assert.equal(r.body.error, "min_raise"); assert.equal(r.body.min, 400, "the refusal carries the minimum");
  r = await R.stamped("ta", { op: "act", action: "fold" }); assert.equal(r.status, 200);
  const T = R.table();
  assert.equal(T.status, "between"); assert.equal(T.lastHand.winners[0].memberId, "b");
  const hist = R.db.docs.get("books/k1/pokerHistory/" + T.sessionId);
  assert.equal(hist.hands.length, 1); assert.equal(hist.hands[0].no, 1); assert.deepEqual(hist.hands[0].actions, [{ seat: 0, op: "fold", amount: 0 }], "objects, not nested arrays, which Firestore refuses");
  r = await R.stamped("tb", { op: "leave" }); assert.equal(r.status, 200);
  assert.equal(R.db.docs.has("books/k1/pokerHole/u_b"), false, "gone with the seat");
  assert.ok(R.db.docs.has("books/k1/pokerHole/u_a"));
  const S = R.db.docs.get("books/k1/poker/session");
  assert.equal(S.byId.b.out, 10100); assert.equal(S.byId.a.onTable, 9900); assert.equal(S.byId.a.net + S.byId.b.net, 0);
  assert.equal(R.table().status, "open", "one left: waiting");
});

test("the sweep ticks a table whose clock ran out with nobody watching, and leaves the rest alone", async () => {
  const R = rig();
  await R.post("ta", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 });
  await R.stamped("ta", { op: "sit", seat: 0, buyIn: 10000 }); await R.stamped("tb", { op: "sit", seat: 1, buyIn: 10000 });
  assert.deepEqual(await R.H.sweep(), [], "nothing due");
  R.at(T0 + E.BETWEEN + 1);
  let done = await R.H.sweep();
  assert.equal(done.length, 1); assert.equal(R.table().status, "hand");
  R.at(T0 + E.BETWEEN + 1 + E.CLOCK);
  done = await R.H.sweep();
  assert.equal(done[0].status, 200); assert.equal(R.table().seats[0].timeouts, 1, "the actor was folded for them");
});

test("closing archives the session; a table can be opened again", async () => {
  const R = rig();
  await R.post("ta", { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 });
  await R.stamped("ta", { op: "sit", seat: 0, buyIn: 10000 });
  let r = await R.stamped("tb", { op: "close" }); assert.equal(r.body.error, "not_allowed");
  r = await R.stamped("tc", { op: "close" }); assert.equal(r.status, 200, "an admin may");
  const T = R.table();
  assert.equal(T.status, "closed");
  const arch = R.db.docs.get("books/k1/pokerSessions/" + T.sessionId);
  assert.ok(arch && arch.closedAt); assert.equal(arch.byId.a.out, 10000);
  assert.ok(R.sent.some(([, to, title]) => to === "a" && /Table closed/.test(title)));
  r = await R.post("tb", { op: "open", sb: 50, bb: 100, minBuy: 500, maxBuy: 5000 }); assert.equal(r.status, 200);
  assert.equal(R.table().openedBy, "b");
});

test("notices: opening, three seated, and the dealer's own doings", () => {
  const ms = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }, { id: "d", name: "Dan" }];
  const seats = (...ids) => { const s = Array(10).fill(null); ids.forEach((id, i) => { s[i] = { memberId: id }; }); return s; };
  const T = (o) => Object.assign({ status: "open", sessionId: "s1", openedBy: "a", blinds: { sb: 100, bb: 200 }, minBuy: 4000, maxBuy: 20000, seats: seats() }, o);
  const brief = ns => ns.map(n => [n.to.join(","), n.title, n.body, n.tag]);
  assert.deepEqual(brief(pokerNotices(null, T(), null, ms)), [["b,c,d", "Poker table open · $1/$2", "Alice opened it · buy in $40 to $200", "poker-open-s1"]]);
  assert.deepEqual(brief(pokerNotices(T({ status: "closed" }), T(), null, ms)), [["b,c,d", "Poker table open · $1/$2", "Alice opened it · buy in $40 to $200", "poker-open-s1"]], "reopened after a close");
  assert.deepEqual(brief(pokerNotices(T({ seats: seats("a", "b") }), T({ seats: seats("a", "b", "c") }), null, ms)), [["d", "Poker table open · $1/$2", "3 seated: Alice, Bob and Cara", "poker-open-s1"]]);
  assert.deepEqual(pokerNotices(T({ seats: seats("a", "b", "c") }), T({ seats: seats("a", "b", "c", "d") }), null, ms), [], "only the first time it reaches three");
  assert.deepEqual(brief(pokerNotices(T(), T(), { notices: [{ kind: "autoOut", memberId: "b" }, { kind: "autoLeave", memberId: "c", amount: 4250 }] }, ms)),
    [["b", "You've been sat out", "Two missed clocks at the poker table. Tap I'm back when you're there.", "poker-seat-b"],
     ["c", "Cashed out $42.50", "Sat out ten minutes at the poker table, so the dealer cashed you out.", "poker-seat-c"]]);
  assert.equal(pokerNotices(null, T(), null, ms)[0].link, "?poker=1");
});
