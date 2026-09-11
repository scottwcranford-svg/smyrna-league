// Season titles: who holds what, ties, and what moved.
import test from "node:test";
import assert from "node:assert/strict";
import * as Badges from "../badges.js";
import { KICKOFF } from "./fixtures.mjs";

const bconfig = { leagueName: "T", season: "2026", stake: 25, kickoff: KICKOFF,
  members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }, { id: "d", name: "Dan" }, { id: "t", name: "Testbot", test: true }] };

const bbets = [
  { id: "1", status: "settled", week: 1, name: "Opener", amount: 25, winner: "b", createdBy: "a", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }] },
  { id: "2", status: "settled", week: 2, name: "Two", amount: 10, winner: "b", createdBy: "b", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }] },
  { id: "3", status: "settled", week: 0, name: "Pot", amount: 20, winner: "b", createdBy: "b", settledAt: "2026-09-25T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }, { memberId: "d" }] },
  { id: "4", status: "void", week: 2, autoVoid: true, amount: 10, createdBy: "c", entries: [{ memberId: "c" }] },
  { id: "5", status: "active", week: 3, amount: 15, createdBy: "a", createdAt: "2026-09-24T00:00:00Z", entries: [{ memberId: "a" }, { memberId: "d", takenAt: "2026-09-24T00:00:45Z" }] },
];

const bhl = { weeks: { "1": { high: [{ id: "c", name: "Cara", pts: 150 }], low: [{ id: "a", name: "Alice", pts: 80 }] } } };

const bseen = { a: "2026-09-25T00:00:00Z", b: { at: "2026-09-30T00:00:00Z", n: 12 }, c: "2026-08-01T00:00:00Z" };

const bnow = Date.parse("2026-10-01T00:00:00Z");

const held = (list) => Object.fromEntries(list.filter(x => x.holders.length).map(x => [x.key, [x.holders.join("+"), x.text]]));

test("badges: eighteen live titles, worked out from the book", () => {
  const list = Badges.badges(bconfig, bbets, bhl, bseen, null, bnow);
  assert.equal(list.length, 18, "every badge comes back, held or not");
  assert.deepEqual(held(list), {
    degenerate: ["a", "$70"], highroller: ["a+b+c+d", "$80"], deadbeat: ["a", "owes $60"], bank: ["b", "owed $95"],
    winner: ["b", "+$95"], hothand: ["b", "3 in a row"], untouchable: ["b", "3–0"], kingmaker: ["b", "$60"],
    weeklyking: ["c", "1 high"], loser: ["a", "−$55"], icecold: ["a", "3 in a row"], basement: ["a", "1 low"],
    coldfeet: ["c", "1 pulled"], active: ["a", "4 bets"], instigator: ["a+b", "2 posted"], ghost: ["c", "61d away"],
    quickdraw: ["d", "45s"], logins: ["b", "12 visits"],
  });
  // the four in the same $20 pot all have the same biggest pot, so they hold High Roller together
  const hr = list.find(x => x.key === "highroller");
  assert.equal(hr.shared, true);
  assert.equal(hr.label, "High Rollers", "and the title reads plural");
  assert.equal(list.find(x => x.key === "winner").label, "Biggest Winner", "one holder keeps the singular");
});

test("badges: nobody qualifies on an empty book, and test accounts never hold one", () => {
  const list = Badges.badges(bconfig, [], null, null, null, bnow);
  assert.deepEqual(list.filter(x => x.holders.length), [], "every badge is up for grabs");
  assert.equal(list.length, 18);
  const only = Badges.badges(bconfig, [{ id: "9", status: "settled", week: 1, amount: 10, winner: "t", createdBy: "t", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "t" }, { memberId: "a" }] }], null, null, null, bnow);
  assert.deepEqual(only.find(x => x.key === "winner").holders, [], "a test account is not in the running");
  assert.deepEqual(only.find(x => x.key === "loser").holders, ["a"], "the real manager still gets theirs");
});

test("badges: a tie is shared by everyone level on it, and the title goes plural", () => {
  const cfg = { ...bconfig, members: [{ id: "z", name: "Zoe" }, { id: "a", name: "Alice" }] };
  const tie = [
    { id: "1", status: "settled", week: 1, amount: 10, winner: "z", createdBy: "z", settledAt: "2026-09-11T00:00:00Z", entries: [{ memberId: "z" }, { memberId: "a" }] },
    { id: "2", status: "settled", week: 2, amount: 10, winner: "a", createdBy: "a", settledAt: "2026-09-18T00:00:00Z", entries: [{ memberId: "z" }, { memberId: "a" }] },
  ];
  const list = Badges.badges(cfg, tie, null, null, null, bnow);
  const d = list.find(x => x.key === "degenerate");
  assert.deepEqual(d.holders, ["a", "z"], "both staked $20, so both hold it, in name order");
  assert.deepEqual(d.holderNames, ["Alice", "Zoe"]);
  assert.equal(d.shared, true);
  assert.equal(d.label, "Biggest Degenerates", "and the title goes plural");
  assert.equal(list.find(x => x.key === "icecold").label, "Ice Cold", "a title with no sensible plural keeps its name");
});

test("badgeChanges: only what moved, and it remembers who it came from", () => {
  const list = Badges.badges(bconfig, bbets, bhl, bseen, null, bnow);
  const first = Badges.badgeChanges(list, null, bconfig, null, bnow);
  assert.equal(Object.keys(first).length, 18, "the first run records every held badge");
  assert.equal(first.winner.from, null, "nobody to take it from yet");
  assert.deepEqual(first.winner.holders, ["b"], "holders is always a list");
  const stored = { byKey: first };
  assert.equal(Badges.badgeChanges(list, stored, bconfig, null, bnow), null, "nothing moved, nothing written");
  // Cara wins one big enough to take Biggest Winner off Bob
  const moved = bbets.concat([{ id: "6", status: "settled", week: 4, amount: 200, winner: "c", createdBy: "c", settledAt: "2026-09-28T00:00:00Z", entries: [{ memberId: "c" }, { memberId: "d" }] }]);
  const chg = Badges.badgeChanges(Badges.badges(bconfig, moved, bhl, bseen, null, bnow), stored, bconfig, null, bnow);
  assert.equal(chg.winner.holder, "c");
  assert.deepEqual(chg.winner.from, ["b"], "it says who lost it — a list, since a shared title can lose several at once");
  assert.equal(chg.weeklyking, undefined, "a badge that didn't move isn't rewritten");
});

test("badgeChanges: a draw a second later writes nothing — no value may drift with the clock", () => {
  const list = Badges.badges(bconfig, bbets, bhl, bseen, null, bnow);
  const stored = { byKey: Badges.badgeChanges(list, null, bconfig, null, bnow) };
  const later = Badges.badges(bconfig, bbets, bhl, bseen, null, bnow + 1500);
  assert.equal(Badges.badgeChanges(later, stored, bconfig, null, bnow + 1500), null,
    "otherwise every render writes to the book, which loops through the snapshot");
  const nextDay = Badges.badges(bconfig, bbets, bhl, bseen, null, bnow + 86400e3);
  assert.equal(Badges.badgeChanges(nextDay, stored, bconfig, null, bnow + 86400e3).ghost.text, "62d away", "a day later it does move");
});

test("badgeStory: took it from, or held since", () => {
  const members = bconfig.members;
  assert.equal(Badges.badgeStory(null, members), "nobody yet");
  assert.equal(Badges.badgeStory({ holder: "c", holders: ["c"], from: ["b"], week: 4 }, members), "took it from Bob · wk 4");
  assert.match(Badges.badgeStory({ holder: "b", from: null, week: 2, at: "2026-09-18T00:00:00Z" }, members), /^held since /);
  // with a holder passed in, the record can lag a fresh page: no story beats a wrong one
  assert.equal(Badges.badgeStory(null, members, ["c"]), "", "a holder on screen with no record yet says nothing");
  assert.equal(Badges.badgeStory(null, members, []), "nobody yet");
  assert.equal(Badges.badgeStory({ holder: "b", holders: ["b"], from: ["a"], week: 4 }, members, ["c"]), "", "a stale record for someone else is not shown");
  assert.equal(Badges.badgeStory({ holder: "c", holders: ["c"], from: ["b"], week: 4 }, members, ["c"]), "took it from Bob · wk 4");
});

test("seenAt and seenCount read both shapes of league/seen", () => {
  const seen = { a: "2026-09-25T00:00:00Z", b: { at: "2026-09-30T00:00:00Z", n: 12 } };
  assert.equal(Badges.seenAt(seen, "a"), "2026-09-25T00:00:00Z");
  assert.equal(Badges.seenAt(seen, "b"), "2026-09-30T00:00:00Z");
  assert.equal(Badges.seenAt(seen, "zz"), "");
  assert.equal(Badges.seenCount(seen, "a"), 0, "an old string entry has no count yet");
  assert.equal(Badges.seenCount(seen, "b"), 12);
});
