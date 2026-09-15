// Head-to-head history between two managers.
import test from "node:test";
import assert from "node:assert/strict";
import * as Rivals from "../rivals.js";

test("rivals: every settled bet is a set of pairs; a pot is one win per loser", () => {
  const members = [{ id: "m0", name: "gmelan1" }, { id: "m1", name: "JPorch" }, { id: "m2", name: "RTownsend" }, { id: "m3", name: "mscag" }];
  const bets = [
    { id: "b1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "m1", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "m0" }, { memberId: "m1" }] },
    { id: "b2", status: "settled", week: 0, name: "Pot", amount: 10, winner: "m0", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "m0" }, { memberId: "m1" }, { memberId: "m2" }, { memberId: "m3" }] },
    { id: "b3", status: "settled", week: 2, name: "Push", amount: 10, winner: "push", entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b4", status: "void", week: 2, name: "Void", amount: 10, entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b5", status: "active", week: 3, name: "Live", amount: 10, entries: [{ memberId: "m0" }, { memberId: "m2" }] },
    { id: "b6", status: "settled", week: 3, name: "Solo", amount: 10, winner: "m0", entries: [{ memberId: "m0" }] },
  ];
  const V = Rivals.rivals(members, bets);
  assert.deepEqual({ net: V.byId.m0.m1.net, w: V.byId.m0.m1.w, l: V.byId.m0.m1.l }, { net: -15, w: 1, l: 1 }, "lost 25, won 10 back off the pot");
  assert.deepEqual({ net: V.byId.m1.m0.net, w: V.byId.m1.m0.w, l: V.byId.m1.m0.l }, { net: 15, w: 1, l: 1 }, "the mirror");
  assert.deepEqual({ net: V.byId.m0.m2.net, w: V.byId.m0.m2.w }, { net: 10, w: 1 }, "a push, a void and a live bet count for nobody");
  assert.deepEqual(V.totals.m0, { net: 5, w: 3, l: 1, beat: 3, beatenBy: 1 }, "the pot beat three people");
  assert.deepEqual(V.byId.m0.m1.bets.map(x => [x.name, x.won]), [["Pot", true], ["Opener", false]], "newest first, from m0's side");

  const P2 = Rivals.rivalPairs(V);
  assert.deepEqual(P2[0], { a: "m1", b: "m0", net: 15, moved: 35, games: 2, w: 1, l: 1 }, "richest rivalry first, the one who's up named first");
  assert.equal(P2.length, 3, "each pair once, and only pairs that have bet");

  const H = Rivals.rivalHighlights(V, bets, members);
  assert.equal(H.hammer.id, "m0"); assert.equal(H.hammer.v, 3);
  assert.equal(H.nail.id, "m2", "a tie on losses goes to whoever won least");
  assert.deepEqual({ w: H.haul.winner, pot: H.haul.pot, losers: H.haul.losers }, { w: "m0", pot: 30, losers: 3 });

  const F = Rivals.rivalFeed(bets, 5);
  assert.deepEqual(F.map(x => [x.name, x.winner, x.losers.length, x.pot]), [["Pot", "m0", 3, 30], ["Opener", "m1", 1, 25]], "newest first, one line per settled bet");
});

test("rivals with hi/low: the low paid the high, a win and the stake on that pair; a tie splits it like Settle Up", () => {
  const members = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const bets = [{ id: "b1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "b", entries: [{ memberId: "a" }, { memberId: "b" }] }];
  const highlow = { weeks: {
    "1": { high: [{ id: "a", pts: 140 }], low: [{ id: "b", pts: 90 }] },
    "2": { high: [{ id: "a", pts: 150 }], low: [{ id: "b", pts: 80 }, { id: "c", pts: 80 }] },
    "3": { high: [{ id: "c", pts: 130 }], low: [] },   // not finished: ignored
  } };
  const V = Rivals.rivals(members, bets, highlow, 5);
  const ab = V.byId.a.b;
  assert.deepEqual({ net: ab.net, w: ab.w, l: ab.l, hl: ab.hl }, { net: -17.5, w: 2, l: 1, hl: { net: 7.5, w: 2, l: 0 } }, "−25 on the bet, +5 and +2.50 on hi/low");
  assert.deepEqual(ab.weeks.map(x => [x.week, x.won, x.pts, x.theirPts, x.amount]), [[2, true, 150, 80, 2.5], [1, true, 140, 90, 5]], "newest first");
  assert.deepEqual(V.byId.b.a.hl, { net: -7.5, w: 0, l: 2 }, "the mirror");
  assert.equal(V.byId.c.a.net, -2.5);
  assert.equal(V.totals.a.net + V.totals.b.net + V.totals.c.net, 0, "money only moves between them");
  assert.equal(V.totals.a.net - (-25), 10, "a's hi/low part matches hlTally: +5, +5");
  assert.deepEqual(Rivals.rivals(members, bets).byId.a.b, { net: -25, w: 0, l: 1, bets: ab.bets }, "without hi/low the cell is bets only");
});

test("rivals: an empty book has every pair at zero and no highlights", () => {
  const members = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const V = Rivals.rivals(members, []);
  assert.deepEqual(V.byId.a.b, { net: 0, w: 0, l: 0, bets: [] });
  assert.deepEqual(V.totals.a, { net: 0, w: 0, l: 0, beat: 0, beatenBy: 0 });
  assert.deepEqual(Rivals.rivalPairs(V), []);
  const H = Rivals.rivalHighlights(V, [], members);
  assert.deepEqual([H.rivalry, H.lopsided, H.hammer, H.nail, H.haul], [null, null, null, null, null]);
});
