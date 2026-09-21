// The page's reading of the poker table: cards, turns, what a call costs, where a raise
// may land, the clock, the seat order, and the session tally. Pure, under node.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../poker.js";

const seat = (i, o) => Object.assign({ seat: i, memberId: "m" + i, stack: 10000, status: "in", bet: 0, totalIn: 0, pendingAdd: 0 }, o);
function table(o){
  const seats = Array(10).fill(null);
  seats[0] = seat(0, { bet: 1000, totalIn: 1000 }); seats[1] = seat(1, { bet: 200, totalIn: 200 }); seats[2] = seat(2, { status: "folded" });
  return Object.assign({ status: "hand", blinds: { sb: 100, bb: 200 }, minBuy: 4000, maxBuy: 20000, handNo: 3, seq: 40, seats, button: 2, street: "flop",
    board: ["Ah", "7c", "2d"], pots: [{ amount: 1600, eligible: [0, 1] }], toAct: 1, deadline: "2026-09-24T01:00:30Z", currentBet: 1000, minRaise: 800, updatedAt: "2026-09-24T01:00:00Z" }, o);
}

test("cards print their rank and suit, tens as 10, hearts and diamonds red", () => {
  assert.deepEqual(P.card("Td"), { code: "Td", rank: "10", suit: "♦", red: true });
  assert.deepEqual(P.card("As"), { code: "As", rank: "A", suit: "♠", red: false });
  assert.equal(P.card("Kh").red, true); assert.equal(P.card("9c").suit, "♣");
  assert.equal(P.handName(6), "Full house"); assert.equal(P.handName(99), "");
});

test("whose turn, what a call costs, when a check is free", () => {
  const t = table();
  assert.equal(P.myTurn(t, "m1"), true); assert.equal(P.myTurn(t, "m0"), false);
  assert.equal(P.myTurn(Object.assign(table(), { status: "between" }), "m1"), false);
  assert.equal(P.toCall(t, t.seats[1]), 800); assert.equal(P.canCheck(t, t.seats[1]), false);
  assert.equal(P.toCall(t, t.seats[0]), 0); assert.equal(P.canCheck(t, t.seats[0]), true);
  assert.equal(P.toCall(t, seat(5, { stack: 300 })), 300, "capped at the stack");
  assert.equal(P.seated(t, "m2"), true); assert.equal(P.seated(t, "zz"), false);
});

test("a raise lands between the bet plus the last raise and all in; the presets clamp", () => {
  const t = table();
  assert.deepEqual(P.raiseBounds(t, t.seats[1]), { min: 1800, max: 10200 });
  assert.deepEqual(P.raiseBounds(t, seat(5, { stack: 1200, bet: 0 })), { min: 1200, max: 1200 }, "a short stack can only shove");
  assert.equal(P.clampRaise(500, { min: 1800, max: 10200 }), 1800); assert.equal(P.clampRaise(99999, { min: 1800, max: 10200 }), 10200);
  assert.equal(P.potTotal(t), 1600);
  assert.equal(P.presetAmount(t, t.seats[1], "min"), 1800);
  assert.equal(P.presetAmount(t, t.seats[1], "half"), 2200, "bet + half of (pot + call)");
  assert.equal(P.presetAmount(t, t.seats[1], "pot"), 3400, "bet + pot + call");
  assert.equal(P.presetAmount(t, t.seats[1], "allin"), 10200);
  assert.equal(P.potTotal(Object.assign(table(), { pots: [] })), 1200, "no pots yet: what's been put in");
});

test("the clock counts down from the dealer's deadline and never goes negative", () => {
  const now = Date.parse("2026-09-24T01:00:12Z");
  assert.equal(P.secondsLeft("2026-09-24T01:00:30Z", now, 0), 18);
  assert.equal(P.secondsLeft("2026-09-24T01:00:30Z", now, 5000), 13, "the page's clock runs five seconds behind the server's");
  assert.equal(P.secondsLeft("2026-09-24T01:00:30Z", now + 60000, 0), 0);
  assert.equal(P.secondsLeft("", now, 0), 0);
  assert.equal(P.clockFraction("2026-09-24T01:00:30Z", 30000, now, 0), 0.6);
});

test("seats run clockwise from the one after yours and end with you; you sit at the bottom of the oval", () => {
  const t = table();
  const order = P.seatOrder(t, "m1");
  assert.deepEqual(order.map(o => o.i), [2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
  assert.equal(order[9].off, 0); assert.equal(order[0].off, 1);
  assert.equal(order.filter(o => o.seat).length, 3);
  assert.deepEqual(P.seatOrder(t, null).map(o => o.i), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0], "not seated: seat 0 at the bottom");
  assert.deepEqual(P.seatXY(0), { x: 50, y: 92 });
  assert.deepEqual(P.seatXY(5), { x: 50, y: 8 });
  assert.ok(P.seatXY(2).x < 50 && P.seatXY(8).x > 50, "left round the bottom, right round the top");
});

test("the blinds are read off the button as the dealer posts them; a bet sits on the felt inside its seat", () => {
  const t = table();   // button on seat 2 (folded, but dealt in); 0 and 1 follow it
  assert.deepEqual(P.blindSeats(t), { sb: 0, bb: 1 });
  const four = table({ button: 0 }); four.seats[5] = seat(5, { status: "waiting" }); four.seats[7] = seat(7, { status: "out" });
  assert.deepEqual(P.blindSeats(four), { sb: 1, bb: 2 }, "a seat waiting for the next hand or sitting out posted nothing");
  const hu = table({ button: 1 }); hu.seats[2] = null;
  assert.deepEqual(P.blindSeats(hu), { sb: 1, bb: 0 }, "heads-up the button is the small blind");
  assert.deepEqual(P.blindSeats(table({ status: "between" })), { sb: null, bb: null });
  assert.deepEqual(P.blindSeats(null), { sb: null, bb: null });
  assert.equal(P.streetBets(t), 1200); assert.equal(P.potTotal(t) - P.streetBets(t), 400, "what's been swept into the middle");
  assert.deepEqual(P.betXY(0), { x: 50, y: 77 }); assert.deepEqual(P.betXY(5), { x: 50, y: 23 });
  for (let off = 0; off < 10; off++) {
    const s = P.seatXY(off), b = P.betXY(off), d = p => Math.hypot(p.x - 50, p.y - 50);
    assert.ok(d(b) < d(s) - 10, "well inside its seat");
  }
});

test("the session tally: net as it stands, best night first, and the nets ledger.js can pair up", () => {
  const session = { byId: { a: { in: 20000, out: 0, onTable: 18600 }, b: { in: 20000, out: 0, onTable: 23000 }, c: { in: 10000, out: 1900, onTable: 0 }, d: { in: 10000, out: 0, onTable: 16500 } } };
  assert.deepEqual(P.sessionRows(session).map(r => [r.id, r.net]), [["d", 6500], ["b", 3000], ["a", -1400], ["c", -8100]]);
  assert.deepEqual(P.netsFor(session), { a: { net: -14 }, b: { net: 30 }, c: { net: -81 }, d: { net: 65 } });
  assert.deepEqual(P.sessionRows(null), []);
});

test("buy-in bounds: the table's for a seat, up to the max for a top-up", () => {
  const t = table();
  assert.deepEqual(P.buyInBounds(t, null, "sit"), { min: 4000, max: 20000 });
  assert.deepEqual(P.buyInBounds(t, seat(1, { stack: 18600 }), "rebuy"), { min: 200, max: 1400 });
  assert.deepEqual(P.buyInBounds(t, seat(1, { stack: 20000 }), "rebuy"), { min: 0, max: 0 });
  assert.equal(P.dollars(1234), 12.34);
});
