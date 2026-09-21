// The dealer, run directly with a stacked deck: blinds and order, the betting rules,
// side pots and the odd cent, timeouts, leaving, closing, and the money adding up.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../functions/poker/engine.js");

const T0 = Date.parse("2026-09-24T01:00:00Z");
const me = (id) => ({ id, uid: "u_" + id, name: id });
const rng0 = () => 0;
// A deck that starts with the cards named (dealt two per player in seat order, then the
// board) and carries on with the rest of the pack.
function deck(...cards){ const rest = E.newDeck().filter(c => cards.indexOf(c) < 0); return cards.concat(rest); }
const sum = (S) => Object.keys(S.session.byId).reduce((n, id) => { const L = S.session.byId[id]; return n + L.in - L.out - L.onTable; }, 0);

// A little table: open, seat everyone, tick the first deal.
function table(players, opts){
  opts = Object.assign({ sb: 100, bb: 200, minBuy: 500, maxBuy: 20000, now: T0, deck: null }, opts || {});
  let S = E.reduce({ table: null, secret: null, session: null }, { op: "open", sb: opts.sb, bb: opts.bb, minBuy: opts.minBuy, maxBuy: opts.maxBuy }, { now: opts.now, me: me(players[0][0]) });
  players.forEach(([id, seat, buyIn]) => { S = E.reduce(S, { op: "sit", seat, buyIn }, { now: opts.now, me: me(id) }); });
  S = E.reduce(S, { op: "tick" }, { now: opts.now + E.BETWEEN, rng: rng0, deck: opts.deck });
  S.now = opts.now + E.BETWEEN;
  return S;
}
function act(S, id, action, amount, dt){ const now = S.now + (dt || 1000); const N = E.reduce(S, { op: "act", action, amount }, { now, me: me(id), rng: rng0 }); N.now = now; return N; }
function op(S, id, ev, dt, extra){ const now = S.now + (dt || 1000); const N = E.reduce(S, Object.assign({}, ev), Object.assign({ now, me: id ? me(id) : null, rng: rng0 }, extra || {})); N.now = now; return N; }
const seat = (S, i) => S.table.seats[i];

test("open, sit, deal: blinds, the button, hole cards to each player, and the money on the table", () => {
  let S = E.reduce({ table: null, secret: null, session: null }, { op: "open", sb: 100, bb: 200, minBuy: 4000, maxBuy: 20000 }, { now: T0, me: me("a") });
  assert.equal(S.table.status, "open"); assert.equal(S.table.seq, 1); assert.equal(S.session.hands, 0);
  S = E.reduce(S, { op: "sit", seat: 0, buyIn: 10000 }, { now: T0, me: me("a") });
  assert.equal(S.table.status, "open", "one player: waiting");
  S = E.reduce(S, { op: "sit", seat: 1, buyIn: 10000 }, { now: T0 + 1000, me: me("b") });
  assert.equal(S.table.status, "between", "two players: the first deal is scheduled");
  assert.equal(S.table.deadline, new Date(T0 + 1000 + E.BETWEEN).toISOString());
  assert.equal(S.session.byId.a.in, 10000); assert.equal(S.session.byId.a.onTable, 10000); assert.equal(sum(S), 0);
  const early = E.reduce(S, { op: "tick" }, { now: T0 + 2000 });
  assert.equal(early.effects.changed, false, "a tick before the deadline does nothing");
  S = E.reduce(S, { op: "tick" }, { now: T0 + 1000 + E.BETWEEN, rng: rng0, deck: deck("As", "Ad", "Kh", "Kd", "Ac", "7h", "2d", "9s", "3c") });
  assert.equal(S.table.status, "hand"); assert.equal(S.table.handNo, 1); assert.equal(S.table.street, "preflop");
  assert.equal(S.table.button, 0, "heads-up: the button posts the small blind");
  assert.equal(seat(S, 0).bet, 100); assert.equal(seat(S, 1).bet, 200); assert.equal(seat(S, 0).stack, 9900);
  assert.equal(S.table.toAct, 0, "and acts first before the flop");
  assert.equal(S.table.currentBet, 200); assert.equal(S.table.minRaise, 200);
  assert.deepEqual(S.effects.deal.map(d => [d.uid, d.seat, d.cards.join("")]), [["u_a", 0, "AsAd"], ["u_b", 1, "KhKd"]]);
  assert.deepEqual(S.secret.hole, { 0: ["As", "Ad"], 1: ["Kh", "Kd"] });
  assert.equal(S.table.deadline, new Date(T0 + 1000 + E.BETWEEN + E.CLOCK).toISOString());
  assert.equal(sum(S), 0, "chips in the pot still belong to someone");
});

test("a heads-up hand to showdown: option, order after the flop, a raise, and the winner's hand named", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000]], { deck: deck("As", "Ad", "Kh", "Kd", "Ac", "7h", "2d", "9s", "3c") });
  assert.throws(() => act(S, "b", "check"), /isn't your turn/);
  S = act(S, "a", "call");
  assert.equal(seat(S, 0).bet, 200); assert.equal(S.table.toAct, 1, "the big blind has the option");
  S = act(S, "b", "check");
  assert.equal(S.table.street, "flop"); assert.deepEqual(S.table.board, ["Ac", "7h", "2d"]);
  assert.equal(S.table.toAct, 1, "after the flop the non-button acts first");
  assert.equal(seat(S, 0).bet, 0, "bets reset each street"); assert.equal(seat(S, 0).totalIn, 200);
  assert.throws(() => act(S, "b", "bet", 100), /minimum raise is to \$2/, "a bet under the big blind");
  S = act(S, "b", "bet", 400);
  assert.equal(S.table.currentBet, 400); assert.equal(S.table.minRaise, 400); assert.match(S.table.lastText, /b bets \$4/);
  assert.throws(() => act(S, "a", "raise", 700), /minimum raise is to \$8/);
  S = act(S, "a", "raise", 1200);
  assert.equal(S.table.minRaise, 800); assert.match(S.table.lastText, /a raises to \$12/);
  S = act(S, "b", "call");
  assert.equal(S.table.street, "turn"); assert.equal(S.table.board.length, 4);
  S = act(S, "b", "check"); S = act(S, "a", "check");
  assert.equal(S.table.street, "river");
  S = act(S, "b", "check"); S = act(S, "a", "bet", 1000); S = act(S, "b", "call");
  assert.equal(S.table.status, "between", "showdown, then the next deal is scheduled");
  const H = S.table.lastHand;
  assert.equal(H.pot, 4800);
  assert.deepEqual(H.winners.map(w => [w.memberId, w.amount, w.text]), [["a", 4800, "three aces"]]);
  assert.deepEqual(H.shown, { 0: ["As", "Ad"], 1: ["Kh", "Kd"] }, "a showdown shows every hand");
  assert.equal(seat(S, 0).stack, 12400); assert.equal(seat(S, 1).stack, 7600);
  assert.equal(S.table.lastText, "a wins $48 with three aces");
  assert.equal(S.session.hands, 1); assert.equal(S.session.byId.a.net, 2400); assert.equal(S.session.byId.b.net, -2400); assert.equal(sum(S), 0);
  assert.equal(S.effects.history.length, 1); assert.equal(S.effects.history[0].actions.length, 10);
  assert.deepEqual(S.secret.hole, {}, "the cards are gone from the secret until the next deal");
});

test("three-handed: the button acts first before the flop; a short all-in doesn't reopen the betting", () => {
  let S = table([["a", 0, 10000], ["b", 1, 1100], ["c", 2, 10000]]);
  assert.equal(S.table.button, 0); assert.equal(seat(S, 1).bet, 100, "small blind left of the button"); assert.equal(seat(S, 2).bet, 200);
  assert.equal(S.table.toAct, 0, "under the gun is the button with three");
  S = act(S, "a", "raise", 1000);
  assert.equal(S.table.minRaise, 800);
  S = act(S, "b", "allin");
  assert.equal(seat(S, 1).status, "allin"); assert.equal(S.table.currentBet, 1100);
  assert.deepEqual(S.table.capped, [0], "a raised already and the all-in was short: a can't raise again");
  S = act(S, "c", "call");
  assert.equal(S.table.toAct, 0);
  assert.throws(() => act(S, "a", "raise", 2000), /call or fold/);
  S = act(S, "a", "call");
  assert.equal(S.table.street, "flop"); assert.equal(S.table.toAct, 2, "first still-in seat left of the button");
  assert.deepEqual(S.table.pots.map(p => [p.amount, p.eligible]), [[3300, [0, 1, 2]]]);
});

test("side pots: the short stack can only win what everyone matched; the odd cent goes left of the button", () => {
  let S = table([["a", 0, 500], ["b", 1, 1000], ["c", 2, 2000]], { deck: deck("Ah", "Ad", "Kh", "Kd", "2h", "3d", "Ac", "Kc", "7s", "8s", "9d") });
  S = act(S, "a", "allin"); S = act(S, "b", "allin");
  assert.equal(S.table.currentBet, 1000);
  S = act(S, "c", "call");
  assert.equal(S.table.status, "between", "nobody left to bet: the board ran out and it showed down");
  assert.deepEqual(S.table.lastHand.board.length, 5);
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount, w.text]), [["a", 1500, "three aces"], ["b", 1000, "three kings"]]);
  assert.equal(seat(S, 0).stack, 1500); assert.equal(seat(S, 1).stack, 1000); assert.equal(seat(S, 2).stack, 1000);
  assert.equal(sum(S), 0);

  // a tie for an odd pot: the sb folded 101 in, a and c play the board
  S = table([["a", 0, 10000], ["b", 1, 10000], ["c", 2, 10000]], { sb: 101, bb: 201, deck: deck("2h", "3h", "9c", "8c", "2d", "3d", "Ac", "Kc", "Qs", "Js", "Ts") });
  S = act(S, "a", "call"); S = act(S, "b", "fold"); S = act(S, "c", "check");
  for (const street of ["flop", "turn", "river"]) { assert.equal(S.table.street, street); S = act(S, "c", "check"); S = act(S, "a", "check"); }
  assert.equal(S.table.lastHand.pot, 503);
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 251], ["c", 252]], "the odd cent to the first winner clockwise from the button");
  assert.match(S.table.lastText, /split it/);
  assert.equal(sum(S), 0);
});

// a has $5 and aces, b and c have $100 each with kings and queens, and the board helps nobody.
const SHORT = () => table([["a", 0, 500], ["b", 1, 10000], ["c", 2, 10000]], { deck: deck("Ah", "Ad", "Kh", "Kd", "Qh", "Qd", "2c", "7s", "9d", "3c", "4s") });
const potsOf = S => S.table.pots.map(p => [p.amount, p.eligible]);

test("a short all-in with two callers who play on: the side pot is theirs, the main pot is a showdown for all three", () => {
  let S = SHORT();
  S = act(S, "a", "allin");
  assert.deepEqual(potsOf(S), [[800, [0, 1, 2]]], "the blinds haven't answered yet: one pot, no side pot made of a bet on its way round");
  S = act(S, "b", "call"); S = act(S, "c", "call");
  assert.equal(S.table.street, "flop"); assert.equal(S.table.toAct, 1, "a is all in: only b and c are asked");
  assert.deepEqual(potsOf(S), [[1500, [0, 1, 2]]]);
  S = act(S, "b", "bet", 1000);
  assert.deepEqual(potsOf(S), [[1500, [0, 1, 2]], [1000, [1, 2]]], "c may yet call, so the bet is the side pot's, not a pot of b's own");
  S = act(S, "c", "call");
  S = act(S, "b", "check"); S = act(S, "c", "bet", 2000); S = act(S, "b", "call");
  assert.deepEqual(potsOf(S), [[1500, [0, 1, 2]], [6000, [1, 2]]]);
  S = act(S, "b", "check"); S = act(S, "c", "check");
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 1500], ["b", 6000]]);
  assert.equal(S.table.lastText, "a wins the $15 main pot with a pair of aces · b wins the $60 side pot with a pair of kings", "two pots, two winners: not a split");
  assert.deepEqual([0, 1, 2].map(i => seat(S, i).stack), [1500, 12500, 6500]); assert.equal(sum(S), 0);
});

test("the side pot folded away: the hand still runs out for the all-in player, and the unmatched bet goes back", () => {
  let S = SHORT();
  S = act(S, "a", "allin"); S = act(S, "b", "call"); S = act(S, "c", "call");
  S = act(S, "b", "bet", 1000); S = act(S, "c", "call");
  S = act(S, "b", "bet", 3000); S = act(S, "c", "fold");
  assert.equal(S.table.status, "between"); assert.equal(S.table.lastHand.board.length, 5, "c folding doesn't end it: a's aces are still owed a showdown");
  assert.deepEqual(S.table.lastHand.shown, { 0: ["Ah", "Ad"], 1: ["Kh", "Kd"] });
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 1500], ["b", 2000]], "b's $30 was never matched, so it isn't winnings");
  assert.equal(S.table.lastHand.pot, 3500);
  assert.equal(S.table.lastText, "a wins the $15 main pot with a pair of aces · b wins the $20 side pot with a pair of kings");
  assert.deepEqual([0, 1, 2].map(i => seat(S, i).stack), [1500, 10500, 8500]); assert.equal(sum(S), 0);
});

test("split pots beside side pots: a tie for the main pot, a tie for the side pot, and a board that plays for three uneven stacks", () => {
  const playOn = [["a", "allin"], ["b", "call"], ["c", "call"], ["b", "bet", 1000], ["c", "call"], ["b", "check"], ["c", "check"], ["b", "check"], ["c", "check"]];
  const run = (S, moves) => moves.reduce((s, m) => act(s, m[0], m[1], m[2]), S);
  const paidInFull = S => assert.equal(S.table.lastHand.winners.reduce((n, w) => n + w.amount, 0), S.table.lastHand.pot, "every cent of the pot is paid");
  // a and b both hold an ace and the board's K Q J play as kickers; c has nothing
  let S = run(table([["a", 0, 500], ["b", 1, 10000], ["c", 2, 10000]], { deck: deck("Ah", "2c", "Ad", "3c", "7h", "8h", "As", "Kd", "Qc", "Jh", "4s") }), playOn);
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 750], ["b", 2750]], "half the main pot each, and the side pot to the one who was in it");
  assert.equal(S.table.lastText, "b and a split the $15 main pot with a pair of aces · b wins the $20 side pot with a pair of aces");
  paidInFull(S); assert.equal(sum(S), 0);
  // a's aces take the main pot; b and c both hold a king with the same kickers
  S = run(table([["a", 0, 500], ["b", 1, 10000], ["c", 2, 10000]], { deck: deck("Ah", "Ad", "Kh", "2c", "Kd", "3c", "Ks", "Qc", "Jh", "9s", "4d") }), playOn);
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 1500], ["b", 1000], ["c", 1000]]);
  assert.equal(S.table.lastText, "a wins the $15 main pot with a pair of aces · b and c split the $20 side pot with a pair of kings");
  paidInFull(S); assert.equal(sum(S), 0);
  // $5, $10 and $20 all in and a royal flush on the board: everyone gets their own money back
  S = run(table([["a", 0, 500], ["b", 1, 1000], ["c", 2, 2000]], { deck: deck("2c", "3d", "4c", "5d", "6c", "7d", "As", "Ks", "Qs", "Js", "Ts") }), [["a", "allin"], ["b", "allin"], ["c", "call"]]);
  assert.deepEqual([0, 1, 2].map(i => seat(S, i).stack), [500, 1000, 2000]);
  assert.equal(S.table.lastText, "b, c and a split the $15 main pot with a royal flush · b and c split the $10 side pot with a royal flush");
  paidInFull(S); assert.equal(sum(S), 0);
  // four-handed, the small blind folds a dollar in: $7 three ways, the odd cent to the first winner left of the button
  S = table([["a", 0, 10000], ["b", 1, 10000], ["c", 2, 10000], ["d", 3, 10000]], { deck: deck("2c", "3d", "4c", "5d", "6c", "7d", "8c", "9d", "As", "Ks", "Qs", "Js", "Ts") });
  S = run(S, [["d", "call"], ["a", "call"], ["b", "fold"], ["c", "check"]].concat(...[1, 2, 3].map(() => [["c", "check"], ["d", "check"], ["a", "check"]])));
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["a", 233], ["c", 234], ["d", 233]]);
  assert.equal(S.table.lastText, "a $2.33, c $2.34, d $2.33 split it"); assert.deepEqual(Object.keys(S.table.lastHand.shown), ["0", "2", "3"], "the folded hand is never shown");
  paidInFull(S); assert.equal(sum(S), 0);
});

test("a shove nobody can cover: the difference comes back, and there is no side pot of one", () => {
  let S = table([["a", 0, 20000], ["b", 1, 5000]], { deck: deck("2c", "7d", "Ah", "Ad", "Ks", "Qs", "9h", "4c", "3d") });
  S = act(S, "a", "allin");
  assert.deepEqual(potsOf(S), [[20200, [0, 1]]], "b hasn't answered");
  S = act(S, "b", "call");
  assert.equal(S.table.status, "between");
  assert.deepEqual(S.table.lastHand.winners.map(w => [w.memberId, w.amount]), [["b", 10000]]); assert.equal(S.table.lastHand.pot, 10000, "$50 each; a's other $150 was never in it");
  assert.equal(S.table.lastText, "b wins $100 with a pair of aces");
  assert.equal(seat(S, 0).stack, 15000); assert.equal(seat(S, 1).stack, 10000); assert.ok(!seat(S, 0).busted, "a is not broke: $150 never left"); assert.equal(sum(S), 0);
});

test("everyone folds to one player: the pot without a reveal", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000], ["c", 2, 10000]]);
  S = act(S, "a", "raise", 600); S = act(S, "b", "fold"); S = act(S, "c", "fold");
  assert.equal(S.table.status, "between");
  assert.deepEqual(S.table.lastHand.shown, {}); assert.equal(S.table.lastHand.winners[0].text, null);
  assert.equal(S.table.lastText, "a takes $5", "the blinds and the $2 of a's raise they could have matched; the other $4 came straight back");
  assert.equal(S.table.lastHand.pot, 500);
  assert.equal(seat(S, 0).stack, 10300); assert.equal(seat(S, 1).stack, 9900); assert.equal(seat(S, 2).stack, 9800);
});

test("the clock: a timeout checks or folds; two in a row sits you out; ten minutes out cashes you out; an empty table closes", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000]]);
  assert.equal(E.due(S.table, S.now + 1000), false);
  assert.equal(E.due(S.table, S.now + E.CLOCK), true);
  S = op(S, null, { op: "tick" }, E.CLOCK);
  assert.equal(seat(S, 0).timeouts, 1); assert.equal(seat(S, 0).lastAction.op, "fold", "folded for them");
  assert.equal(S.table.status, "between"); assert.equal(seat(S, 1).stack, 10100); assert.equal(S.table.lastText, "b takes $2", "a's blind and the dollar of b's that covered it");
  S = op(S, null, { op: "tick" }, E.BETWEEN);   // hand 2: b is the button and acts first
  assert.equal(S.table.button, 1); assert.equal(S.table.toAct, 1);
  S = act(S, "b", "call");
  assert.equal(S.table.toAct, 0);
  S = op(S, null, { op: "tick" }, E.CLOCK);
  assert.match(S.table.lastText, /a checks \(time\)/);
  assert.equal(seat(S, 0).timeouts, 2); assert.ok(seat(S, 0).satOutAt, "two in a row: sat out");
  assert.deepEqual(S.effects.notices, [{ kind: "autoOut", memberId: "a" }]);
  assert.equal(S.table.street, "flop"); assert.equal(S.table.toAct, 0, "still in this hand though");
  S = op(S, null, { op: "tick" }, E.CLOCK);
  S = act(S, "b", "bet", 400);
  S = op(S, null, { op: "tick" }, E.CLOCK);
  assert.equal(S.table.status, "open", "a is out, one player ready: waiting for players");
  assert.equal(seat(S, 0).status, "out"); assert.equal(seat(S, 1).status, "waiting");
  const outAt = Date.parse(seat(S, 0).satOutAt), idle = Date.parse(S.table.idleSince);
  assert.ok(idle > outAt);
  assert.equal(E.due(S.table, outAt + E.AUTO_LEAVE - 1000), false);
  assert.equal(E.due(S.table, outAt + E.AUTO_LEAVE), true);
  S = E.reduce(S, { op: "tick" }, { now: idle + E.IDLE_CLOSE, rng: rng0 });
  assert.equal(seat(S, 0), null, "cashed out");
  assert.deepEqual(S.session.byId.a.cashOuts.map(c => [c.amount, c.why]), [[9700, "auto"]]);
  assert.ok(S.effects.notices.some(n => n.kind === "autoLeave" && n.memberId === "a" && n.amount === 9700));
  assert.equal(S.table.status, "closed", "b alone for ten minutes: the table closes and b is cashed out too");
  assert.equal(seat(S, 1), null); assert.equal(S.session.byId.b.out, 10300); assert.equal(S.effects.archive, true);
  assert.equal(S.session.byId.a.net + S.session.byId.b.net, 0); assert.equal(sum(S), 0);
  assert.throws(() => E.reduce(S, { op: "sit", seat: 0, buyIn: 1000 }, { now: S.now, me: me("c") }), /No table/);
});

test("leaving mid-hand folds now and cashes out when the hand ends; a real action resets the timeout count", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000], ["c", 2, 10000]]);
  S = op(S, "b", { op: "leave" });
  assert.equal(seat(S, 1).status, "folded"); assert.equal(seat(S, 1).leaving, true); assert.equal(S.table.toAct, 0);
  S = act(S, "a", "call"); S = act(S, "c", "check");
  S = act(S, "c", "check"); S = act(S, "a", "check"); S = act(S, "c", "check"); S = act(S, "a", "check"); S = act(S, "c", "check"); S = act(S, "a", "check");
  assert.equal(S.table.status, "between");
  assert.equal(seat(S, 1), null, "gone after the hand");
  assert.equal(S.session.byId.b.out, 9900); assert.equal(S.session.byId.b.net, -100);
  assert.deepEqual(S.effects.clearHole, ["u_b"]);
  assert.equal(sum(S), 0);
});

test("sitting out and coming back; rebuy waits for the next hand; buy-in limits", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000]]);
  assert.throws(() => op(S, "a", { op: "rebuy", amount: 20000 }), /add up to \$101/);
  S = op(S, "a", { op: "rebuy", amount: 5000 });
  assert.equal(seat(S, 0).pendingAdd, 5000); assert.equal(seat(S, 0).stack, 9900, "not during the hand");
  assert.equal(S.session.byId.a.in, 15000); assert.equal(sum(S), 0);
  S = act(S, "a", "fold");
  assert.equal(seat(S, 0).status, "waiting");
  S = op(S, "b", { op: "sitOut" });
  assert.equal(seat(S, 1).status, "out"); assert.equal(S.table.status, "open", "one ready player");
  S = op(S, "b", { op: "back" });
  assert.equal(S.table.status, "between");
  S = op(S, null, { op: "tick" }, E.BETWEEN);
  assert.equal(seat(S, 0).stack + seat(S, 0).bet, 14900, "the rebuy landed at the deal");
  assert.throws(() => op(S, "c", { op: "sit", seat: 0, buyIn: 1000 }), /taken/);
  assert.throws(() => op(S, "c", { op: "sit", seat: 3, buyIn: 100 }), /between \$5 and \$200/);
  S = op(S, "c", { op: "sit", seat: 3, buyIn: 1000 });
  assert.equal(seat(S, 3).status, "waiting", "joins the next hand");
  assert.throws(() => op(S, "c", { op: "sit", seat: 4, buyIn: 1000 }), /already at the table/);
});

test("closing: the opener or an admin, after the current hand; everyone is cashed out", () => {
  let S = table([["a", 0, 10000], ["b", 1, 10000]]);
  assert.throws(() => op(S, "b", { op: "close" }), /Only whoever opened/);
  S = op(S, "b", { op: "close" }, 1000, { admin: true });
  assert.equal(S.table.closing, true); assert.equal(S.table.status, "hand");
  S = act(S, "a", "fold");
  assert.equal(S.table.status, "closed"); assert.equal(S.table.seats.filter(Boolean).length, 0);
  assert.equal(S.session.closedAt, S.table.closedAt); assert.equal(S.effects.archive, true);
  assert.equal(S.session.byId.a.out, 9900); assert.equal(S.session.byId.b.out, 10100); assert.equal(sum(S), 0);
  assert.throws(() => E.reduce(S, { op: "open", sb: 0, bb: 200, minBuy: 500, maxBuy: 20000 }, { now: S.now, me: me("a") }), /Blinds/);
  const again = E.reduce(S, { op: "open", sb: 100, bb: 200, minBuy: 500, maxBuy: 20000 }, { now: S.now + 1, me: me("a") });
  assert.equal(again.table.status, "open"); assert.equal(again.session.hands, 0, "a fresh session");
});

test("pots: layers by what each player put in, folded money in the lowest pots", () => {
  const s = (i, status, totalIn) => ({ seat: i, status, totalIn });
  assert.deepEqual(E.pots([s(0, "allin", 500), s(1, "in", 1000), s(2, "in", 1000), s(3, "folded", 300)]),
    [{ amount: 1800, eligible: [0, 1, 2] }, { amount: 1000, eligible: [1, 2] }]);
  assert.deepEqual(E.pots([s(0, "in", 500), s(1, "folded", 1000)]), [{ amount: 1500, eligible: [0] }], "a fold above the top live level still goes in");
  assert.deepEqual(E.pots([s(0, "allin", 500), s(1, "in", 3000), s(2, "in", 1000), s(3, "allin", 2000)]),
    [{ amount: 2000, eligible: [0, 1, 2, 3] }, { amount: 3500, eligible: [1, 2, 3] }, { amount: 1000, eligible: [1, 2] }], "only an all-in makes a layer, and a player with a bet to answer still counts for the pots above them");
  assert.deepEqual(E.pots([s(0, "in", 100), s(1, "in", 200), s(2, "in", 600)]), [{ amount: 900, eligible: [0, 1, 2] }], "nobody all in: one pot, however uneven the street so far");
});
