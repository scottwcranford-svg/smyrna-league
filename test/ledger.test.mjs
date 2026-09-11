// The money: what a bet moved, weekly high/low, balances, drilldowns.
import test from "node:test";
import assert from "node:assert/strict";
import * as Clock from "../clock.js";
import * as Ledger from "../ledger.js";
import { config } from "./fixtures.mjs";

test("ledger: winner collects the stake from each loser, unpaid debts net pairwise", () => {
  const L = Ledger.computeLedger(config, [
    { id: "b1", status: "settled", amount: 25, winner: "m0", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }], paid: ["m2"] },
    { id: "b2", status: "active", amount: 10, entries: [{ memberId: "m1", pick: "x" }, { memberId: "m2", pick: "y" }] },
    { id: "b3", status: "open", amount: 15, entries: [{ memberId: "m0", pick: "x" }, { memberId: null }] },
    { id: "b4", status: "void", amount: 40, autoVoid: true, entries: [{ memberId: "m0", pick: "x" }, { memberId: null }] },
    { id: "b5", status: "void", amount: 70, cancelled: true, entries: [{ memberId: "m2", pick: "x" }, { memberId: null }] },
  ]);
  assert.equal(L.pnl.m0.net, 50); assert.equal(L.pnl.m1.net, -25); assert.equal(L.pnl.m2.net, -25);
  assert.equal(L.pnl.m0.w, 1); assert.equal(L.pnl.m1.l, 1);
  // values come from a separate VM realm, so compare by JSON rather than prototype identity
  assert.equal(JSON.stringify(L.debts.map(d => [d.from, d.to, d.amount])), JSON.stringify([["m1", "m0", 25]]), "m2 already paid");
  assert.equal(L.risk.m1, 10); assert.equal(L.risk.m2, 10);
  assert.equal(L.risk.m0, 0, "an open bet isn't in play yet"); assert.equal(L.offered.m0, 15); assert.equal(L.offered.m1, 0);
  assert.equal(L.cancelled.m0, 40, "no takers by lock counts"); assert.equal(L.cancelled.m2, 0, "pulled by hand doesn't"); assert.equal(L.cancelled.m1, 0);
  assert.equal(L.pnl.m0.net, 50, "a cancelled bet moves no money");
  // net by kind: b1 is a season bet (no week); add a settled weekly one
  const L2 = Ledger.computeLedger(config, [
    { id: "b1", status: "settled", amount: 25, winner: "m0", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }], paid: ["m2"] },
    { id: "w1", status: "settled", week: 3, amount: 10, winner: "m1", entries: [{ memberId: "m0" }, { memberId: "m1" }], paid: [] },
  ]);
  assert.deepEqual([L2.pnl.m0.season, L2.pnl.m0.weekly, L2.pnl.m0.net], [50, -10, 40]);
  assert.deepEqual([L2.pnl.m1.season, L2.pnl.m1.weekly, L2.pnl.m1.net], [-25, 10, -15]);
});

test("weekly high / low: top score takes the stake from the bottom, ties share, tallied all season", () => {
  const rows = [{ id: "a", name: "A", pts: 148.4 }, { id: "b", name: "B", pts: 120 }, { id: "c", name: "C", pts: 92.1 }];
  assert.deepEqual(Ledger.highLow(rows), { high: [{ id: "a", name: "A", pts: 148.4 }], low: [{ id: "c", name: "C", pts: 92.1 }] });
  const tied = Ledger.highLow(rows.concat([{ id: "d", name: "D", pts: 148.4 }]));
  assert.deepEqual(tied.high.map((r) => r.id), ["a", "d"], "a tie at the top is kept together");
  assert.equal(Ledger.highLow([{ id: "a", pts: 100 }, { id: "b", pts: 100 }]), null, "all tied: nothing moves");
  assert.equal(Ledger.highLow([{ id: "a", pts: 0 }, { id: "b", pts: null }]), null, "one real score isn't a week");
  const hl = { weeks: { "1": Ledger.highLow(rows), "2": tied, "3": { high: [{ id: "c", pts: 1 }], low: [{ id: "zz", name: "gone", pts: 0 }] } } };
  const T = Ledger.hlTally(hl, [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], 5);
  assert.deepEqual(T.weeks, [1, 2, 3]);
  assert.deepEqual(T.byId.a, { net: 7.5, highs: 2, lows: 0 }, "5 for week 1, half of 5 for the shared week 2");
  assert.deepEqual(T.byId.c, { net: -5, highs: 1, lows: 2 }, "bottom in weeks 1 and 2, top in week 3");
  assert.deepEqual(T.byId.d, { net: 2.5, highs: 1, lows: 0 });
  assert.equal(Ledger.hlStake({ hlStake: 10 }), 10); assert.equal(Ledger.hlStake({}), 5);
  assert.deepEqual(Clock.finalWeeks({ games: [{ week: 1, status: "final" }, { week: 1, status: "final" }, { week: 2, status: "final" }, { week: 2, status: "live" }, { week: 3, status: "pre" }] }), [1], "only weeks with every game final");
});

test("balances: bets plus hi / low, minus payments; the transfers that clear everyone", () => {
  const cfg = { members: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }] };
  const bets = [
    { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", entries: [{ memberId: "a" }, { memberId: "b" }], paid: [] },
    { id: "w1", status: "settled", week: 2, amount: 10, winner: "c", entries: [{ memberId: "a" }, { memberId: "c" }], paid: [] },
    { id: "w2", status: "settled", week: 3, amount: 10, winner: "d", entries: [{ memberId: "b" }, { memberId: "d" }], paid: ["b"] },   // b already paid d, the old way
  ];
  const hl = { weeks: { "1": { high: [{ id: "d", pts: 140 }], low: [{ id: "a", pts: 90 }] } } };
  const B = Ledger.balances(cfg, bets, hl, null, 5);
  assert.deepEqual([B.byId.a.bets, B.byId.a.hl, B.byId.a.net], [15, -5, 10]);
  assert.deepEqual([B.byId.b.bets, B.byId.b.paidOut, B.byId.b.net], [-35, 10, -25], "the legacy paid flag counts as a payment");
  assert.deepEqual([B.byId.d.bets, B.byId.d.hl, B.byId.d.paidIn, B.byId.d.net], [10, 5, 10, 5]);
  assert.equal(B.byId.c.net, 10);
  assert.equal(Math.round(Object.values(B.byId).reduce((s, x) => s + x.net, 0) * 100) / 100, 0, "balances always net to zero");
  assert.deepEqual(B.transfers, [{ from: "b", to: "a", amount: 10 }, { from: "b", to: "c", amount: 10 }, { from: "b", to: "d", amount: 5 }], "biggest debtor pays down the creditors, biggest first");
  // a recorded payment moves two balances and shrinks the list
  const B2 = Ledger.balances(cfg, bets, hl, [{ id: "p1", from: "b", to: "a", amount: 10, at: "2027-01-05T00:00:00Z" }], 5);
  assert.equal(B2.byId.b.net, -15); assert.equal(B2.byId.a.net, 0);
  assert.deepEqual(B2.transfers.map((t) => [t.from, t.to, t.amount]), [["b", "c", 10], ["b", "d", 5]]);
  const B3 = Ledger.balances(cfg, bets, hl, [{ id: "p1", from: "b", to: "a", amount: 10, voided: true }], 5);
  assert.equal(B3.byId.b.net, -25, "a voided payment doesn't count");
  assert.equal(B3.payments.length, 2, "but it's still in the log, with the legacy one");
});

test("drillRows: what's behind a season-table cell, newest first", () => {
  const members = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }];
  const bets = [
    { id: "s1", status: "settled", week: 0, amount: 25, winner: "a", name: "Wire to Wire", entries: [{ memberId: "a" }, { memberId: "b" }], settledAt: "2026-12-01T00:00:00Z" },
    { id: "w2", status: "settled", week: 2, amount: 10, winner: "c", name: "Week 2 thing", entries: [{ memberId: "a" }, { memberId: "c" }], settledAt: "2026-09-15T00:00:00Z" },
    { id: "w3", status: "settled", week: 3, amount: 10, winner: "push", name: "Pushed", entries: [{ memberId: "a" }, { memberId: "b" }], settledAt: "2026-09-22T00:00:00Z" },
    { id: "open", status: "active", week: 4, amount: 10, entries: [{ memberId: "a" }, { memberId: "b" }] },
    { id: "notme", status: "settled", week: 1, amount: 10, winner: "b", entries: [{ memberId: "b" }, { memberId: "c" }] },
  ];
  const hl = { weeks: { "1": { high: [{ id: "a", name: "Alice", pts: 140 }], low: [{ id: "c", name: "Cara", pts: 90 }] }, "2": { high: [{ id: "b", pts: 150 }], low: [{ id: "a", pts: 80 }, { id: "c", pts: 80 }] } } };
  const weekly = Ledger.drillRows("a", "weekly", bets, hl, 5, members);
  assert.deepEqual(weekly.map((r) => [r.id, r.amount, r.note]), [["w3", 0, "push"], ["w2", -10, "lost to Cara"]], "weekly: newest first, pushes shown at 0, open and others' bets left out");
  assert.deepEqual(Ledger.drillRows("a", "season", bets, hl, 5, members).map((r) => [r.id, r.amount, r.note]), [["s1", 25, "beat Bob"]]);
  const hlRows = Ledger.drillRows("a", "hl", bets, hl, 5, members);
  assert.deepEqual(hlRows.map((r) => [r.week, r.amount, r.label, r.note]), [[2, -2.5, "Low score · 80", "under Bob"], [1, 5, "High score · 140", "over Cara"]], "a shared low splits the stake");
  const total = Ledger.drillRows("a", "total", bets, hl, 5, members);
  assert.equal(total.length, 5); assert.equal(Math.round(total.reduce((s, r) => s + r.amount, 0) * 100) / 100, 17.5, "the total row adds everything up");
});

test("footprint: what a manager would take with them if they were removed", () => {
  const bets = [
    { id: "b1", createdBy: "a", entries: [{ memberId: "a" }, { memberId: "b" }] },
    { id: "b2", createdBy: "c", entries: [{ memberId: "b" }, { memberId: null }] },
    { id: "b3", createdBy: "c", entries: [{ memberId: "c" }, { memberId: "d" }] },
  ];
  const payments = [{ from: "a", to: "b", amount: 5 },
                    { from: "b", to: "c", amount: 5, voided: true }];
  const highlow = { weeks: {
    "1": { high: [{ id: "a", pts: 140 }], low: [{ id: "d", pts: 80 }] },
    "2": { high: [{ id: "c", pts: 150 }], low: [{ id: "a", pts: 70 }] } } };

  const a = Ledger.footprint("a", bets, highlow, payments);
  assert.deepEqual(a, { bets: 1, payments: 1, weeks: 2, any: true },
    "one bet counted once though he both posted it and is in it");
  assert.equal(Ledger.footprint("b", bets, highlow, payments).bets, 2, "in two, posted neither");
  assert.equal(Ledger.footprint("b", bets, highlow, payments).payments, 1, "a voided payment is not history worth keeping");

  const nobody = Ledger.footprint("zz", bets, highlow, payments);
  assert.deepEqual(nobody, { bets: 0, payments: 0, weeks: 0, any: false },
    "a handle typed wrong leaves nothing behind, and can still be deleted");
  assert.equal(Ledger.footprint("x", [], null, null).any, false, "an empty book is not a reason to refuse");
});

test("footprintText reads as a sentence, however many kinds there are", () => {
  assert.equal(Ledger.footprintText({ bets: 1, payments: 0, weeks: 0 }), "1 bet");
  assert.equal(Ledger.footprintText({ bets: 7, payments: 2, weeks: 0 }), "7 bets and 2 payments");
  assert.equal(Ledger.footprintText({ bets: 7, payments: 2, weeks: 3 }), "7 bets, 2 payments and 3 hi/low weeks");
  assert.equal(Ledger.footprintText({ bets: 0, payments: 0, weeks: 1 }), "1 hi/low week");
  assert.equal(Ledger.footprintText({ bets: 0, payments: 0, weeks: 0 }), "");
});
