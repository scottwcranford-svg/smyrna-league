// Ranking poker hands. Pure: a card is a two-character code, rank then suit ("Ah",
// "Td", "2c"), and the best five of any five, six or seven cards come back with a
// score that orders every hand against every other. Higher is better; equal scores
// are a genuine tie and split the pot.
//
// Written here rather than pulled in: it is a page of code, it returns an integer we
// can test against a known ordering, and the functions package stays Firebase-only.
"use strict";

const RANKS = "23456789TJQKA";
const CATEGORY = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
const WORD = { 14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten", 9: "nine", 8: "eight", 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two" };
const PLURAL = { 14: "aces", 13: "kings", 12: "queens", 11: "jacks", 10: "tens", 9: "nines", 8: "eights", 7: "sevens", 6: "sixes", 5: "fives", 4: "fours", 3: "threes", 2: "twos" };

function value(card){ return RANKS.indexOf(card[0]) + 2; }   // 2..14
function suit(card){ return card[1]; }

// The five ranks that decide a hand, most significant first, packed base 15 under the
// category. Two hands of one category compare digit by digit, which is the poker rule.
function pack(category, ranks){
  let n = category;
  for (let i = 0; i < 5; i++) n = n * 15 + (ranks[i] || 0);
  return n;
}

// One five-card hand.
function rank5(cards){
  const vals = cards.map(value).sort((a, b) => b - a);
  const flush = cards.every(c => suit(c) === suit(cards[0]));
  const counts = {};
  vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  // groups: [count, value] by count then value, descending
  const groups = Object.keys(counts).map(v => [counts[v], Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const distinct = groups.map(g => g[1]);
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5;   // the wheel
  }
  let category, ranks;
  if (straightHigh && flush) { category = 8; ranks = [straightHigh]; }
  else if (groups[0][0] === 4) { category = 7; ranks = [groups[0][1], groups[1][1]]; }
  else if (groups[0][0] === 3 && groups[1][0] === 2) { category = 6; ranks = [groups[0][1], groups[1][1]]; }
  else if (flush) { category = 5; ranks = vals; }
  else if (straightHigh) { category = 4; ranks = [straightHigh]; }
  else if (groups[0][0] === 3) { category = 3; ranks = [groups[0][1], groups[1][1], groups[2][1]]; }
  else if (groups[0][0] === 2 && groups[1][0] === 2) { category = 2; ranks = [groups[0][1], groups[1][1], groups[2][1]]; }
  else if (groups[0][0] === 2) { category = 1; ranks = [groups[0][1], groups[1][1], groups[2][1], groups[3][1]]; }
  else { category = 0; ranks = vals; }
  return { score: pack(category, ranks), category, ranks, best: cards.slice() };
}

// Every five-card subset of `cards` (5 to 7 of them); the best one wins.
function rank7(cards){
  if (!Array.isArray(cards) || cards.length < 5) throw new Error("need five cards");
  if (cards.length === 5) return finish(rank5(cards));
  let top = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const r = rank5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
      if (!top || r.score > top.score) top = r;
    }
  return finish(top);
}

function finish(r){
  r.name = CATEGORY[r.category];
  r.text = describe(r);
  return r;
}

// "two pair, kings and nines" — how the ticket names the winning hand.
function describe(r){
  const v = r.ranks, w = k => WORD[k], p = k => PLURAL[k];
  switch (r.category) {
    case 8: return v[0] === 14 ? "a royal flush" : "a straight flush, " + w(v[0]) + " high";
    case 7: return "four " + p(v[0]);
    case 6: return "a full house, " + p(v[0]) + " full of " + p(v[1]);
    case 5: return "a flush, " + w(v[0]) + " high";
    case 4: return "a straight, " + w(v[0]) + " high";
    case 3: return "three " + p(v[0]);
    case 2: return "two pair, " + p(v[0]) + " and " + p(v[1]);
    case 1: return "a pair of " + p(v[0]);
    default: return w(v[0]) + " high";
  }
}

function compare(a, b){ return a.score - b.score; }

module.exports = { rank7, rank5, compare, describe, CATEGORY, value, suit };
