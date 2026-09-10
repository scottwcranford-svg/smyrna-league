// The Cloud Function's who-hears-what, run directly: a bet as it was and as it is,
// the league's members, and the notices that should go out. Whoever made the change
// never gets told about it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { betNotices, paymentNotices, highLowNotices } = createRequire(import.meta.url)("../functions/notices.js");

const members = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }, { id: "d", name: "Dan" }];
const bet = (o) => Object.assign({ id: "x1", name: "NE @ SEA", amount: 10, status: "open", createdBy: "a", terms: "Straight up.",
  entries: [{ memberId: "a", pick: "NE" }, { memberId: null, pick: "SEA" }] }, o);
const brief = (ns) => ns.map(n => [n.to.join(","), n.title, n.body]);

test("a new open bet: everyone but the proposer hears; an invitee gets a personal one", () => {
  assert.deepEqual(brief(betNotices(null, bet(), members)), [["b,c,d", "New bet · $10", "Alice: NE @ SEA — Straight up."]]);
  const inv = bet({ entries: [{ memberId: "a", pick: "NE" }, { memberId: null, invite: "c", pick: "SEA" }] });
  assert.deepEqual(brief(betNotices(null, inv, members)), [["c", "Alice wants you on a bet", "NE @ SEA · $10 · Straight up."], ["b,d", "New bet · $10", "Alice: NE @ SEA — Straight up."]]);
});

test("an admin seats everyone at once: the seated hear they're in", () => {
  const b = bet({ status: "active", createdBy: "a", entries: [{ memberId: "b" }, { memberId: "c" }] });
  assert.deepEqual(brief(betNotices(null, b, members)), [["b,c", "You're in a bet", "Alice put you on NE @ SEA · $10"]]);
});

test("a seat taken: the proposer hears, the taker doesn't; a pot join says what's still open", () => {
  const was = bet(), now = bet({ status: "active", entries: [{ memberId: "a" }, { memberId: "b" }] });
  assert.deepEqual(brief(betNotices(was, now, members)), [["a", "Bob is in", "NE @ SEA · $10 · the bet is on"]]);
  const pot0 = bet({ status: "active", joinable: true, entries: [{ memberId: "a" }, { memberId: "b" }] });
  const pot1 = bet({ status: "active", joinable: true, entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }] });
  assert.deepEqual(brief(betNotices(pot0, pot1, members)), [["a,b", "Cara is in", "NE @ SEA · $10"]]);
  const three = bet({ entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: null }] });
  assert.deepEqual(brief(betNotices(bet({ entries: [{ memberId: "a" }, { memberId: null }, { memberId: null }] }), three, members)), [["a", "Bob is in", "NE @ SEA · $10 · 1 seat still open"]]);
});

test("the same document written twice says nothing twice", () => {
  const b = bet({ status: "active", entries: [{ memberId: "a" }, { memberId: "b" }] });
  assert.deepEqual(betNotices(b, b, members), []);
  assert.deepEqual(betNotices(b, null, members), [], "a deleted bet is silent");
});

test("an invite passed: the proposer hears", () => {
  const was = bet({ entries: [{ memberId: "a" }, { memberId: null, invite: "c" }] });
  const now = bet({ entries: [{ memberId: "a" }, { memberId: null, invite: "c", declined: true }] });
  assert.deepEqual(brief(betNotices(was, now, members)), [["a", "Cara passed", "NE @ SEA · the seat is open to anyone"]]);
});

test("settled: everyone on it hears who won and who pays, except whoever settled it by hand", () => {
  const live = bet({ status: "active", entries: [{ memberId: "a" }, { memberId: "b" }] });
  const auto = bet({ status: "settled", winner: "b", settledBy: "auto", settledNote: "SEA 24–17", entries: live.entries });
  assert.deepEqual(brief(betNotices(live, auto, members)), [["a,b", "Bob wins NE @ SEA", "$10 from Alice · SEA 24–17"]]);
  const byHand = bet({ status: "settled", winner: "a", settledBy: "a", entries: live.entries });
  assert.deepEqual(brief(betNotices(live, byHand, members)), [["b", "Alice wins NE @ SEA", "$10 from Bob"]]);
  const push = bet({ status: "settled", winner: "push", settledBy: "c", entries: live.entries });
  assert.deepEqual(brief(betNotices(live, push, members)), [["a,b", "Push · NE @ SEA", "Nobody pays"]]);
  const three = { entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }] };
  assert.deepEqual(brief(betNotices(bet(Object.assign({ status: "active" }, three)), bet(Object.assign({ status: "settled", winner: "c", settledBy: "auto", amount: 12.5 }, three)), members)),
    [["a,b,c", "Cara wins NE @ SEA", "$12.50 from Alice and Bob"]]);
});

test("voided: no takers goes to the proposer only; a cancel names who did it and skips them", () => {
  assert.deepEqual(brief(betNotices(bet(), bet({ status: "void", autoVoid: true }), members)), [["a", "No takers · NE @ SEA", "Cancelled at lock — nobody took it"]]);
  assert.deepEqual(brief(betNotices(bet(), bet({ status: "void", cancelled: true, voidedBy: "a" }), members)), [], "the proposer cancelled their own open bet: nobody else was on it");
  const live = bet({ status: "active", entries: [{ memberId: "a" }, { memberId: "b" }] });
  assert.deepEqual(brief(betNotices(live, bet({ status: "void", voidedBy: "d", entries: live.entries }), members)), [["a,b", "Voided · NE @ SEA", "by Dan"]]);
  assert.deepEqual(brief(betNotices(bet({ status: "void", voidedBy: "d", entries: live.entries }), live, members)), [["a,b", "NE @ SEA is back on", "Restored"]]);
});

test("payments: both sides hear, minus whoever recorded it; undoing says so", () => {
  const p = { id: "p1", from: "b", to: "a", amount: 25, by: "a" };
  assert.deepEqual(brief(paymentNotices(null, { list: [p] }, members)), [["b", "Bob paid Alice $25", "Recorded by Alice"]]);
  assert.deepEqual(brief(paymentNotices({ list: [p] }, { list: [p] }, members)), []);
  assert.deepEqual(brief(paymentNotices({ list: [p] }, { list: [Object.assign({}, p, { voided: true, voidedBy: "d" })] }, members)), [["b,a", "Payment undone", "Bob → Alice $25, undone by Dan"]]);
});

test("high and low: the league hears when a week goes final, once per week", () => {
  const w1 = { weeks: { "1": { high: [{ id: "a", name: "Alice", pts: 150 }], low: [{ id: "c", name: "Cara", pts: 80 }] } } };
  const w2 = { weeks: { "1": w1.weeks["1"], "2": { high: [{ id: "b", pts: 140 }, { id: "d", pts: 140 }], low: [{ id: "a", pts: 90 }] } } };
  assert.deepEqual(brief(highLowNotices(null, w1, members, 5)), [["a,b,c,d", "Week 1 · high and low", "Alice +$5 · Cara −$5"]]);
  assert.deepEqual(brief(highLowNotices(w1, w2, members, 5)), [["a,b,c,d", "Week 2 · high and low", "Bob and Dan +$2.50 · Alice −$5"]]);
  assert.deepEqual(highLowNotices(w2, w2, members, 5), []);
});
