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
