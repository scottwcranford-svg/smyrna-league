// The dealer's hand ranking, run directly: every category in order, the wheel, kickers,
// ties, and the best five out of seven.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../functions/poker/evaluate.js");

const h = (s) => s.split(" ");
const score = (s) => E.rank7(h(s)).score;

test("the categories rank in poker order", () => {
  const hands = [
    ["Ah Kd 9c 5s 2h", "High card", "ace high"],
    ["Ah Ad 9c 5s 2h", "Pair", "a pair of aces"],
    ["Kh Kd 9c 9s 2h", "Two pair", "two pair, kings and nines"],
    ["Qh Qd Qc 5s 2h", "Three of a kind", "three queens"],
    ["9h 8d 7c 6s 5h", "Straight", "a straight, nine high"],
    ["Ah 9h 7h 4h 2h", "Flush", "a flush, ace high"],
    ["Kh Kd Kc 9s 9h", "Full house", "a full house, kings full of nines"],
    ["Jh Jd Jc Js 2h", "Four of a kind", "four jacks"],
    ["9h 8h 7h 6h 5h", "Straight flush", "a straight flush, nine high"],
    ["Ah Kh Qh Jh Th", "Straight flush", "a royal flush"],
  ];
  for (let i = 1; i < hands.length; i++) assert.ok(score(hands[i][0]) > score(hands[i - 1][0]), hands[i][1] + " beats " + hands[i - 1][1]);
  hands.forEach(([cards, name, text]) => { const r = E.rank7(h(cards)); assert.equal(r.name, name); assert.equal(r.text, text); });
});

test("the wheel is the lowest straight and a six-high straight beats it", () => {
  const wheel = E.rank7(h("Ah 2d 3c 4s 5h"));
  assert.equal(wheel.name, "Straight"); assert.equal(wheel.text, "a straight, five high");
  assert.ok(score("6h 5d 4c 3s 2h") > wheel.score);
  assert.ok(wheel.score > score("Ah Ad Ac Ks 2h"), "any straight beats three of a kind");
  assert.ok(wheel.score < score("Ah Ad Ac Ks Kh"), "and loses to a full house");
  assert.ok(score("Ah 2h 3h 4h 5h") > score("Kh Kd Kc Ks 2h"), "a steel wheel is a straight flush");
});

test("kickers decide within a category, in order", () => {
  assert.ok(score("Ah Ad Kc 5s 2h") > score("Ah Ad Qc Js 2h"), "pair of aces, king kicker");
  assert.ok(score("Ah 9h 7h 4h 3h") > score("Ah 9h 7h 4h 2h"), "flush down to the last card");
  assert.ok(score("Kh Kd 9c 9s Ah") > score("Kh Kd 9c 9s Qh"), "two pair kicker");
  assert.ok(score("Kh Kd Kc 9s 9h") > score("Qh Qd Qc As Ah"), "full house: trips first");
  assert.ok(score("Ah Ad 4c 4s 2h") > score("Kh Kd Qc Qs Ah"), "two pair: the higher pair first");
  assert.ok(score("Jh Jd Jc Js 2h") > score("Th Td Tc Ts Ah"), "quads by rank");
  assert.ok(score("Kh 9d 7c 5s 2h") > score("Kh 9d 7c 4s 3h"), "high card down the line");
});

test("equal hands score equal, whatever the suits", () => {
  assert.equal(score("Ah Kd 9c 5s 2h"), score("As Kc 9d 5h 2c"));
  assert.equal(score("9h 8d 7c 6s 5h"), score("9c 8c 7d 6h 5s"));
});

test("the best five of seven: a straight on the board, a flush in the hole, a full house in the mix", () => {
  const r = E.rank7(h("Ah Kh 9h 4c 2h 7h Td"));
  assert.equal(r.name, "Flush"); assert.equal(r.text, "a flush, ace high");
  assert.deepEqual(r.best.slice().sort(), ["2h", "7h", "9h", "Ah", "Kh"].sort());
  assert.equal(E.rank7(h("9h 8d 7c 6s 5h Ad Kd")).text, "a straight, nine high");
  assert.equal(E.rank7(h("Kh Kd 9c 9s Kc 2d 3d")).text, "a full house, kings full of nines");
  assert.equal(E.rank7(h("Kh Kd 9c 9s 9h 2d 3d")).text, "a full house, nines full of kings", "the trips come first, whatever the pair");
  assert.equal(E.rank7(h("Ah Ad Kc Ks Qh Qd 2c")).text, "two pair, aces and kings", "best two of three pairs");
  assert.equal(E.rank7(h("Th Jh Qh Kh Ah 2c 3c")).text, "a royal flush");
});

test("fewer than five cards is refused", () => {
  assert.throws(() => E.rank7(h("Ah Kh")));
});

// A second evaluator written another way - straight from the counts of the seven cards,
// never trying five-card subsets - must agree with rank7 on who wins every deal.
test("twenty thousand random deals: the same winner, or the same tie, as an evaluator written a different way", () => {
  const val = c => "23456789TJQKA".indexOf(c[0]) + 2;
  function indep(cards){
    const vs = cards.map(val), bySuit = {}; cards.forEach(c => (bySuit[c[1]] = bySuit[c[1]] || []).push(val(c)));
    const straightHigh = set => { const u = [...new Set(set)]; if (u.includes(14)) u.push(1); for (let h = 14; h >= 5; h--) if ([0, 1, 2, 3, 4].every(k => u.includes(h - k))) return h; return 0; };
    const cnt = {}; vs.forEach(v => { cnt[v] = (cnt[v] || 0) + 1; });
    const ranksWith = test => Object.keys(cnt).map(Number).filter(v => test(cnt[v])).sort((a, b) => b - a);
    const kick = (excl, n) => [...new Set(vs)].filter(v => !excl.includes(v)).sort((a, b) => b - a).slice(0, n);
    const fl = Object.values(bySuit).find(a => a.length >= 5), quads = ranksWith(n => n === 4), trips = ranksWith(n => n >= 3), pairs = ranksWith(n => n === 2);
    if (fl && straightHigh(fl)) return [8, straightHigh(fl)];
    if (quads.length) return [7, quads[0], kick([quads[0]], 1)[0]];
    const under = ranksWith(n => n >= 2).filter(v => v !== trips[0]);
    if (trips.length && under.length) return [6, trips[0], under[0]];
    if (fl) return [5].concat(fl.sort((a, b) => b - a).slice(0, 5));
    if (straightHigh(vs)) return [4, straightHigh(vs)];
    if (trips.length) return [3, trips[0]].concat(kick([trips[0]], 2));
    if (pairs.length >= 2) return [2, pairs[0], pairs[1], kick([pairs[0], pairs[1]], 1)[0]];
    if (pairs.length) return [1, pairs[0]].concat(kick([pairs[0]], 3));
    return [0].concat(kick([], 5));
  }
  const cmp = (a, b) => { for (let i = 0; i < 6; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return Math.sign(d); } return 0; };
  const pack = []; for (const su of "shdc") for (const r of "23456789TJQKA") pack.push(r + su);
  let seed = 20260921; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let ties = 0;
  for (let i = 0; i < 20000; i++) {
    const d = pack.slice(); for (let k = d.length - 1; k > 0; k--) { const j = rnd(k + 1); const t = d[k]; d[k] = d[j]; d[j] = t; }
    const board = d.slice(4, 9), h1 = d.slice(0, 2).concat(board), h2 = d.slice(2, 4).concat(board);
    const r1 = E.rank7(h1), r2 = E.rank7(h2);
    assert.equal(r1.category, indep(h1)[0], h1.join(" "));
    assert.equal(Math.sign(r1.score - r2.score), cmp(indep(h1), indep(h2)), h1.join(" ") + " against " + h2.join(" "));
    if (r1.score === r2.score) ties++;
  }
  assert.ok(ties > 400 && ties < 1200, "about one deal in twenty-five is a genuine tie: " + ties);
});
