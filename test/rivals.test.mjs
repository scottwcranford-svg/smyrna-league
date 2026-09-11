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

test("rivals: an empty book has every pair at zero and no highlights", () => {
  const members = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const V = Rivals.rivals(members, []);
  assert.deepEqual(V.byId.a.b, { net: 0, w: 0, l: 0, bets: [] });
  assert.deepEqual(V.totals.a, { net: 0, w: 0, l: 0, beat: 0, beatenBy: 0 });
  assert.deepEqual(Rivals.rivalPairs(V), []);
  const H = Rivals.rivalHighlights(V, [], members);
  assert.deepEqual([H.rivalry, H.lopsided, H.hammer, H.nail, H.haul], [null, null, null, null, null]);
});
