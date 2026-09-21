// The dealer. Pure: `reduce` takes the table, its secret (the deck and everyone's hole
// cards) and the session's money, plus one event, and returns the three as they are
// afterwards with a list of effects for the handler to carry out (hole cards to write
// per player, a history entry, notices). Nothing here touches Firestore or the clock;
// the handler passes `now` and a random source in, which is what makes it testable
// with a stacked deck.
//
// Chips are integer cents. Money never appears or vanishes: a buy-in creates chips, a
// cash-out turns them back into a number owed, and between the two they only move
// stack → pot → stack. checkInvariant() proves that before every write.
//
// Rules kept deliberately simple (see the plan): the button moves to the next seated
// player who isn't sitting out; heads-up the button posts the small blind and acts
// first before the flop, last after; the minimum raise is the size of the last full
// raise; an all-in short of a full raise doesn't reopen betting for anyone who has
// already acted; a street ends when every player still able to act has acted and
// matched the bet; with one or none able to act the board runs out; everyone folding
// to one player awards the pot without a reveal; a showdown shows every hand still in.
"use strict";
const { rank7 } = require("./evaluate");

const SEATS = 10;
const CLOCK = 30000;          // ms to act
const BETWEEN = 6000;         // ms between hands, so the result can be read
const TIMEOUTS_OUT = 2;       // consecutive timeouts before the dealer sits you out
const AUTO_LEAVE = 10 * 60000; // sat out this long → cashed out
const IDLE_CLOSE = 10 * 60000; // fewer than two players this long → table closes

class EngineError extends Error {
  constructor(code, message, extra){ super(message || code); this.code = code; this.extra = extra || null; }
}
const refuse = (code, message, extra) => { throw new EngineError(code, message, extra); };

/* ---- cards ---- */
function newDeck(){
  const out = [];
  for (const s of "shdc") for (const r of "23456789TJQKA") out.push(r + s);
  return out;
}
function shuffle(deck, rng){
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = rng(i + 1); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}
function cryptoRng(n){ return require("node:crypto").randomInt(n); }

/* ---- reading the table ---- */
const clone = v => JSON.parse(JSON.stringify(v));
const iso = ms => new Date(ms).toISOString();
const seated = t => t.seats.filter(Boolean);
const seatOf = (t, memberId) => t.seats.find(s => s && s.memberId === memberId) || null;
// Can be dealt into the next hand.
const ready = s => !!s && !s.satOutAt && !s.leaving && (s.stack + (s.pendingAdd || 0)) > 0;
const inHand = s => !!s && (s.status === "in" || s.status === "folded" || s.status === "allin");
const live = t => seated(t).filter(s => s.status === "in" || s.status === "allin");
const canAct = t => seated(t).filter(s => s.status === "in");
// The first seat clockwise after `from` (an index, or -1 for "from the top") that `pred` accepts.
function nextSeat(t, from, pred){
  for (let k = 1; k <= SEATS; k++) { const i = (from + k + SEATS) % SEATS; if (pred(t.seats[i])) return i; }
  return -1;
}
const money = c => { const v = Math.abs(c) / 100; return "$" + (Number.isInteger(v) ? v : v.toFixed(2)); };

/* ---- the pots ----
   Layered from what each player has put in this hand. Each all-in level makes a pot that
   only players who reached it can win; anything a folded player put in above the top
   live level goes into the last pot. */
function pots(seats){
  const all = seats.filter(s => s && s.totalIn > 0);
  const liveSeats = all.filter(s => s.status === "in" || s.status === "allin");
  const levels = [...new Set(liveSeats.map(s => s.totalIn))].sort((a, b) => a - b);
  const out = [];
  let prev = 0, dealt = 0;
  for (const L of levels) {
    let amount = 0;
    all.forEach(s => { amount += Math.max(0, Math.min(s.totalIn, L) - prev); });
    out.push({ amount, eligible: liveSeats.filter(s => s.totalIn >= L).map(s => s.seat) });
    dealt += amount; prev = L;
  }
  const total = all.reduce((n, s) => n + s.totalIn, 0);
  if (out.length && total > dealt) out[out.length - 1].amount += total - dealt;
  if (!out.length && total) out.push({ amount: total, eligible: liveSeats.map(s => s.seat) });
  return out;
}

/* ---- the session's money ---- */
function ledger(session, id){
  if (!session.byId[id]) session.byId[id] = { in: 0, out: 0, onTable: 0, net: 0, buyIns: [], cashOuts: [] };
  return session.byId[id];
}
function settleOnTable(S){
  Object.keys(S.session.byId).forEach(id => { S.session.byId[id].onTable = 0; });
  seated(S.table).forEach(s => { const L = ledger(S.session, s.memberId); L.onTable += s.stack + s.totalIn + (s.pendingAdd || 0); });
  Object.keys(S.session.byId).forEach(id => { const L = S.session.byId[id]; L.net = L.out + L.onTable - L.in; });
}
function checkInvariant(S){
  settleOnTable(S);
  let sum = 0;
  Object.keys(S.session.byId).forEach(id => { const L = S.session.byId[id]; sum += L.in - L.out - L.onTable; });
  if (sum !== 0) refuse("invariant", "chips don't add up: " + sum);
}

/* ---- events ---- */
function open(S, ev, ctx){
  if (S.table && S.table.status !== "closed") refuse("table_open", "A table is already open");
  const sb = int(ev.sb), bb = int(ev.bb), minBuy = int(ev.minBuy), maxBuy = int(ev.maxBuy);
  if (!(sb > 0 && bb >= sb)) refuse("blinds", "Blinds must be positive, big at least the small");
  if (!(minBuy >= bb && maxBuy >= minBuy)) refuse("buyin", "Buy-in range must be at least a big blind and min ≤ max");
  const id = "s" + ctx.now.toString(36);
  S.table = { status: "open", sessionId: id, openedBy: ctx.me.id, openedAt: iso(ctx.now), blinds: { sb, bb }, minBuy, maxBuy,
    handNo: 0, seq: 0, seats: Array(SEATS).fill(null), button: null, street: null, board: [], pots: [], toAct: null, deadline: null,
    currentBet: 0, minRaise: bb, acted: [], capped: [], lastText: ctx.me.name + " opened the table", lastHand: null, idleSince: iso(ctx.now), closing: false };
  S.secret = { handNo: 0, deck: [], next: 0, hole: {}, actions: [] };
  S.session = { id, openedAt: iso(ctx.now), closedAt: null, blinds: { sb, bb }, hands: 0, byId: {} };
}

function sit(S, ev, ctx){
  const t = S.table;
  if (seatOf(t, ctx.me.id)) refuse("seated", "You're already at the table");
  const buyIn = int(ev.buyIn);
  if (!(buyIn >= t.minBuy && buyIn <= t.maxBuy)) refuse("buyin", "Buy in between " + money(t.minBuy) + " and " + money(t.maxBuy), { min: t.minBuy, max: t.maxBuy });
  let i = ev.seat == null ? nextSeat(t, -1, s => !s) : int(ev.seat);
  if (!(i >= 0 && i < SEATS)) refuse("no_seat", "No seat free");
  if (t.seats[i]) refuse("taken", "That seat is taken");
  t.seats[i] = { seat: i, memberId: ctx.me.id, uid: ctx.me.uid, name: ctx.me.name, stack: buyIn, status: "waiting", bet: 0, totalIn: 0,
    timeouts: 0, satOutAt: null, pendingAdd: 0, lastAction: null, leaving: false, satAt: iso(ctx.now) };
  const L = ledger(S.session, ctx.me.id); L.in += buyIn; L.buyIns.push({ at: iso(ctx.now), amount: buyIn });
  t.lastText = ctx.me.name + " sat down with " + money(buyIn);
  maybeStart(S, ctx);
}

function rebuy(S, ev, ctx){
  const s = seatOf(S.table, ctx.me.id); if (!s) refuse("not_seated", "You're not at the table");
  const amount = int(ev.amount);
  const max = S.table.maxBuy - (s.stack + s.pendingAdd);
  if (!(amount > 0)) refuse("amount", "Say how much");
  if (amount > max) refuse("buyin", "You can add up to " + money(max), { max });
  const L = ledger(S.session, ctx.me.id); L.in += amount; L.buyIns.push({ at: iso(ctx.now), amount });
  if (inHand(s)) s.pendingAdd += amount; else s.stack += amount;
  s.satOutAt = s.satOutAt && s.stack + s.pendingAdd > 0 && s.busted ? null : s.satOutAt;
  if (s.busted) { s.busted = false; s.status = "waiting"; s.satOutAt = null; }
  S.table.lastText = ctx.me.name + " adds " + money(amount);
  maybeStart(S, ctx);
}

function leave(S, ev, ctx){
  const s = seatOf(S.table, ctx.me.id); if (!s) refuse("not_seated", "You're not at the table");
  if (inHand(s) && S.table.status === "hand") {
    s.leaving = true;
    if (s.status === "in") { s.status = "folded"; s.lastAction = { op: "fold", amount: 0, at: iso(ctx.now) }; S.secret.actions.push({ seat: s.seat, op: "fold", amount: 0 }); }
    S.table.lastText = ctx.me.name + " is leaving after this hand";
    if (S.table.toAct === s.seat || live(S.table).length <= 1) afterAction(S, ctx, s.seat);
    return;
  }
  cashOut(S, s.seat, ctx, "left");
  afterSeatsChange(S, ctx);
}

function sitOut(S, ev, ctx){
  const s = seatOf(S.table, ctx.me.id); if (!s) refuse("not_seated", "You're not at the table");
  if (s.satOutAt) return;
  s.satOutAt = iso(ctx.now);
  if (S.table.status === "hand" && s.status === "in") {
    s.status = "folded"; s.lastAction = { op: "fold", amount: 0, at: iso(ctx.now) }; S.secret.actions.push({ seat: s.seat, op: "fold", amount: 0 });
    S.table.lastText = ctx.me.name + " sits out";
    if (S.table.toAct === s.seat || live(S.table).length <= 1) afterAction(S, ctx, s.seat);
    return;
  }
  if (!inHand(s)) s.status = "out";
  S.table.lastText = ctx.me.name + " sits out";
  afterSeatsChange(S, ctx);
}

function back(S, ev, ctx){
  const s = seatOf(S.table, ctx.me.id); if (!s) refuse("not_seated", "You're not at the table");
  if (s.stack + s.pendingAdd <= 0) refuse("busted", "Add chips first");
  s.satOutAt = null; s.timeouts = 0; s.busted = false;
  if (!inHand(s)) s.status = "waiting";
  S.table.lastText = ctx.me.name + " is back";
  maybeStart(S, ctx);
}

function act(S, ev, ctx){
  const t = S.table;
  if (t.status !== "hand") refuse("no_hand", "No hand is being played");
  const s = seatOf(t, ctx.me.id); if (!s) refuse("not_seated", "You're not at the table");
  if (t.toAct !== s.seat || s.status !== "in") refuse("not_your_turn", "It isn't your turn");
  doAction(S, s, ev.action, int(ev.amount), ctx, false);
}

// A player's move, or the dealer's on their behalf when the clock runs out.
function doAction(S, s, action, amount, ctx, timedOut){
  const t = S.table, at = iso(ctx.now);
  const putIn = n => { n = Math.min(n, s.stack); s.stack -= n; s.bet += n; s.totalIn += n; if (s.stack === 0) s.status = "allin"; return n; };
  const toCall = t.currentBet - s.bet;
  let text;
  if (action === "fold") { s.status = "folded"; text = s.name + " folds"; amount = 0; }
  else if (action === "check") {
    if (toCall > 0) refuse("cant_check", "There's " + money(toCall) + " to call");
    text = s.name + " checks"; amount = 0;
  }
  else if (action === "call") {
    if (toCall <= 0) { action = "check"; text = s.name + " checks"; amount = 0; }
    else { amount = putIn(toCall); text = s.name + (s.status === "allin" ? " calls all in for " : " calls ") + money(amount); }
  }
  else if (action === "raise" || action === "bet" || action === "allin") {
    if (action === "allin") amount = s.bet + s.stack;
    const allIn = amount >= s.bet + s.stack;
    if (allIn) amount = s.bet + s.stack;
    if (amount <= t.currentBet) {
      if (!allIn) refuse("raise_low", "A raise must be more than " + money(t.currentBet), { min: t.currentBet + t.minRaise });
      putIn(amount - s.bet); action = "call"; text = s.name + " calls all in for " + money(amount);   // an all-in that can't cover the bet is a call
    } else {
      if (t.capped.indexOf(s.seat) >= 0) refuse("no_reraise", "You can call or fold, not raise again");
      const size = amount - t.currentBet;
      if (!allIn && size < t.minRaise) refuse("min_raise", "The minimum raise is to " + money(t.currentBet + t.minRaise), { min: t.currentBet + t.minRaise });
      const opened = t.currentBet === 0;
      putIn(amount - s.bet);
      if (size >= t.minRaise) { t.minRaise = size; t.acted = []; t.capped = []; }
      else t.capped = [...new Set(t.capped.concat(t.acted))];   // short all-in: no reraise for those who acted
      t.currentBet = amount;
      action = opened ? "bet" : "raise";
      text = s.name + (opened ? " bets " : " raises to ") + money(amount) + (s.status === "allin" ? ", all in" : "");
    }
  }
  else refuse("action", "Unknown action");
  if (t.acted.indexOf(s.seat) < 0) t.acted.push(s.seat);
  s.lastAction = { op: action, amount, at };
  if (timedOut) { s.timeouts += 1; text += " (time)"; } else s.timeouts = 0;
  S.secret.actions.push({ seat: s.seat, op: action, amount });
  t.lastText = text;
  if (timedOut && s.timeouts >= TIMEOUTS_OUT && !s.satOutAt) { s.satOutAt = iso(ctx.now); S.effects.notices.push({ kind: "autoOut", memberId: s.memberId }); }
  afterAction(S, ctx, s.seat);
}

// Where the hand goes after a seat has acted (or folded by leaving).
function afterAction(S, ctx, from){
  const t = S.table;
  if (live(t).length <= 1) return endHand(S, ctx);
  const active = canAct(t);
  const done = active.every(s => t.acted.indexOf(s.seat) >= 0 && s.bet === t.currentBet);
  if (!done) {
    const next = nextSeat(t, from, s => s && s.status === "in" && !(t.acted.indexOf(s.seat) >= 0 && s.bet === t.currentBet));
    if (next < 0) return endStreet(S, ctx);
    t.toAct = next; t.deadline = iso(ctx.now + CLOCK); t.pots = pots(t.seats);
    return;
  }
  endStreet(S, ctx);
}

function endStreet(S, ctx){
  const t = S.table;
  if (t.street === "river") return endHand(S, ctx);
  seated(t).forEach(s => { s.bet = 0; });
  t.currentBet = 0; t.minRaise = t.blinds.bb; t.acted = []; t.capped = [];
  dealStreet(S);
  t.pots = pots(t.seats);
  if (canAct(t).length <= 1) {
    // nobody left to bet against: run the board out
    while (t.street !== "river") dealStreet(S);
    return endHand(S, ctx);
  }
  t.toAct = nextSeat(t, t.button, s => s && s.status === "in");
  t.deadline = iso(ctx.now + CLOCK);
}

function dealStreet(S){
  const t = S.table, d = S.secret;
  const take = n => { const c = d.deck.slice(d.next, d.next + n); d.next += n; return c; };
  if (t.street === "preflop") { t.board = take(3); t.street = "flop"; }
  else if (t.street === "flop") { t.board = t.board.concat(take(1)); t.street = "turn"; }
  else if (t.street === "turn") { t.board = t.board.concat(take(1)); t.street = "river"; }
}

function maybeStart(S, ctx){
  const t = S.table;
  if (t.status !== "open") return;
  const n = seated(t).filter(ready).length;
  if (n >= 2) { t.status = "between"; t.deadline = iso(ctx.now + BETWEEN); t.idleSince = null; }
}
function afterSeatsChange(S, ctx){
  const t = S.table;
  if (t.status === "hand") return;
  if (!seated(t).length) return closeTable(S, ctx);
  if (seated(t).filter(ready).length < 2) { t.status = "open"; t.deadline = null; t.toAct = null; if (!t.idleSince) t.idleSince = iso(ctx.now); }
  else maybeStart(S, ctx);
}

function startHand(S, ctx){
  const t = S.table;
  seated(t).forEach(s => { if (s.pendingAdd) { s.stack += s.pendingAdd; s.pendingAdd = 0; } });
  const players = seated(t).filter(ready);
  if (players.length < 2) { t.status = "open"; t.deadline = null; t.toAct = null; t.idleSince = t.idleSince || iso(ctx.now); return; }
  t.handNo += 1;
  const deck = ctx.deck ? ctx.deck.slice() : shuffle(newDeck(), ctx.rng);   // ctx.deck: a stacked deck, tests only
  S.secret = { handNo: t.handNo, deck, next: 0, hole: {}, actions: [] };
  players.forEach(s => { s.status = "in"; s.bet = 0; s.totalIn = 0; s.lastAction = null; });
  seated(t).forEach(s => { if (!ready(s)) s.status = "out"; });
  t.button = t.button == null ? players[ctx.rng(players.length)].seat : nextSeat(t, t.button, ready);
  const order = []; for (let k = 1; k <= SEATS; k++) { const i = (t.button + k) % SEATS; if (ready(t.seats[i]) && t.seats[i].status === "in") order.push(i); }
  // order runs clockwise from the seat after the button and ends with the button itself
  const headsUp = players.length === 2;
  const sbSeat = headsUp ? t.button : order[0], bbSeat = headsUp ? order[0] : order[1];
  const post = (i, n) => { const s = t.seats[i]; n = Math.min(n, s.stack); s.stack -= n; s.bet += n; s.totalIn += n; if (s.stack === 0) s.status = "allin"; return n; };
  const sbPaid = post(sbSeat, t.blinds.sb), bbPaid = post(bbSeat, t.blinds.bb);
  players.forEach(s => { S.secret.hole[s.seat] = [deck[S.secret.next], deck[S.secret.next + 1]]; S.secret.next += 2;
    S.effects.deal.push({ uid: s.uid, seat: s.seat, cards: S.secret.hole[s.seat], handNo: t.handNo }); });
  t.street = "preflop"; t.board = []; t.currentBet = t.blinds.bb; t.minRaise = t.blinds.bb; t.acted = []; t.capped = [];
  t.status = "hand"; t.lastHand = t.lastHand || null;
  t.lastText = "Hand #" + t.handNo + " · " + t.seats[sbSeat].name + " posts " + money(sbPaid) + ", " + t.seats[bbSeat].name + " posts " + money(bbPaid);
  const first = headsUp ? sbSeat : order[2 % order.length];
  const firstIn = t.seats[first].status === "in" ? first : nextSeat(t, first, s => s && s.status === "in");
  t.pots = pots(t.seats);
  if (firstIn < 0 || canAct(t).length <= 1 && live(t).length >= 2 && canAct(t).every(s => s.bet === t.currentBet)) {
    while (t.street !== "river") dealStreet(S);
    return endHand(S, ctx);
  }
  t.toAct = firstIn; t.deadline = iso(ctx.now + CLOCK);
}

function endHand(S, ctx){
  const t = S.table, at = iso(ctx.now);
  const players = live(t);
  const total = seated(t).reduce((n, s) => n + s.totalIn, 0);
  const won = {}, shown = {}, hands = {};
  if (players.length === 1) {
    won[players[0].seat] = total;
  } else {
    players.forEach(s => { hands[s.seat] = rank7(S.secret.hole[s.seat].concat(t.board)); shown[s.seat] = S.secret.hole[s.seat]; });
    pots(t.seats).forEach(p => {
      let best = -1; p.eligible.forEach(i => { if (hands[i].score > best) best = hands[i].score; });
      const winners = p.eligible.filter(i => hands[i].score === best);
      // odd cents to the first winner clockwise from the button
      const ordered = []; for (let k = 1; k <= SEATS; k++) { const i = (t.button + k) % SEATS; if (winners.indexOf(i) >= 0) ordered.push(i); }
      const share = Math.floor(p.amount / ordered.length); let rest = p.amount - share * ordered.length;
      ordered.forEach(i => { won[i] = (won[i] || 0) + share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; });
    });
  }
  const winners = Object.keys(won).map(Number).filter(i => won[i] > 0).map(i => { const s = t.seats[i]; s.stack += won[i];
    return { seat: i, memberId: s.memberId, name: s.name, amount: won[i], cat: hands[i] ? hands[i].category : null, text: hands[i] ? hands[i].text : null }; });
  t.lastHand = { no: t.handNo, at, board: t.board.slice(), pot: total, winners, shown };
  S.effects.history.push({ no: t.handNo, at, board: t.board.slice(), pot: total, winners, shown, actions: S.secret.actions.slice() });
  t.lastText = winners.length === 1
    ? winners[0].name + (winners[0].text ? " wins " + money(winners[0].amount) + " with " + winners[0].text : " takes " + money(winners[0].amount))
    : winners.map(w => w.name + " " + money(w.amount)).join(", ") + " split it";
  S.session.hands += 1;
  S.secret.hole = {}; S.secret.actions = [];
  t.street = "done"; t.toAct = null; t.deadline = null; t.acted = []; t.capped = []; t.currentBet = 0; t.pots = [];
  seated(t).forEach(s => {
    s.bet = 0; s.totalIn = 0;
    if (s.stack + s.pendingAdd <= 0) { s.busted = true; s.satOutAt = s.satOutAt || at; }
    s.status = s.satOutAt ? "out" : "waiting";
  });
  seated(t).filter(s => s.leaving).forEach(s => cashOut(S, s.seat, ctx, "left"));
  t.status = "between";
  if (t.closing) return closeTable(S, ctx);
  afterSeatsChange(S, ctx);
  if (t.status === "between") t.deadline = iso(ctx.now + BETWEEN);
}

function cashOut(S, i, ctx, why){
  const s = S.table.seats[i]; if (!s) return;
  const amount = s.stack + (s.pendingAdd || 0);
  const L = ledger(S.session, s.memberId); L.out += amount; L.cashOuts.push({ at: iso(ctx.now), amount, why });
  S.table.seats[i] = null;
  S.effects.clearHole.push(s.uid);
  if (why === "auto") S.effects.notices.push({ kind: "autoLeave", memberId: s.memberId, amount });
  if (why === "closed") S.effects.notices.push({ kind: "closed", memberId: s.memberId, amount });
}

function closeTable(S, ctx){
  const t = S.table;
  if (t.status === "hand") { t.closing = true; t.lastText = "The table closes after this hand"; return; }
  seated(t).forEach(s => cashOut(S, s.seat, ctx, "closed"));
  t.status = "closed"; t.toAct = null; t.deadline = null; t.closedAt = iso(ctx.now); t.lastText = "Table closed";
  S.session.closedAt = iso(ctx.now);
  S.secret = { handNo: t.handNo, deck: [], next: 0, hole: {}, actions: [] };
  S.effects.archive = true;
}

function close(S, ev, ctx){
  const t = S.table;
  if (t.openedBy !== ctx.me.id && !ctx.admin) refuse("not_allowed", "Only whoever opened the table, or an admin, can close it");
  closeTable(S, ctx);
}

// Whatever the clock says is due: a timed-out action, the next deal, sitting the
// absent out, cashing out the long gone, closing an empty table. Anyone may send it.
function tick(S, ctx){
  const t = S.table, now = ctx.now;
  let changed = false;
  const past = dl => dl && now >= Date.parse(dl);
  if (t.status === "hand" && past(t.deadline)) {
    const s = t.seats[t.toAct];
    doAction(S, s, s.bet === t.currentBet ? "check" : "fold", 0, ctx, true);
    changed = true;
  } else if (t.status === "between" && past(t.deadline)) { startHand(S, ctx); changed = true; }
  seated(t).filter(s => !inHand(s) && s.satOutAt && now - Date.parse(s.satOutAt) >= AUTO_LEAVE).forEach(s => { cashOut(S, s.seat, ctx, "auto"); changed = true; });
  if (changed && t.status !== "hand") afterSeatsChange(S, ctx);
  if (t.status === "open") {
    if (!seated(t).length) { closeTable(S, ctx); changed = true; }
    else if (t.idleSince && now - Date.parse(t.idleSince) >= IDLE_CLOSE && seated(t).filter(ready).length < 2) { closeTable(S, ctx); changed = true; }
  }
  return changed;
}

// True when a tick would do something: the sweep's test, so it doesn't write for nothing.
function due(table, now){
  if (!table || table.status === "closed") return false;
  const past = dl => dl && now >= Date.parse(dl);
  if ((table.status === "hand" || table.status === "between") && past(table.deadline)) return true;
  if (seated(table).some(s => !inHand(s) && s.satOutAt && now - Date.parse(s.satOutAt) >= AUTO_LEAVE)) return true;
  if (table.status === "open" && (!seated(table).length || (table.idleSince && now - Date.parse(table.idleSince) >= IDLE_CLOSE))) return true;
  return false;
}

function int(v){ const n = Number(v); return Number.isInteger(n) ? n : NaN; }

const OPS = { open, sit, rebuy, leave, sitOut, back, act, close };

// state: { table, secret, session } as stored (table null before the first open).
// ev: { op, ... }. ctx: { now (ms), rng(n), me:{ id, uid, name } | null, admin }.
function reduce(state, ev, ctx){
  const S = { table: state.table ? clone(state.table) : null, secret: state.secret ? clone(state.secret) : null, session: state.session ? clone(state.session) : null,
    effects: { deal: [], clearHole: [], notices: [], history: [], archive: false, changed: true } };
  ctx = Object.assign({ now: Date.now(), rng: cryptoRng, me: null, admin: false }, ctx || {});
  const op = ev && ev.op;
  if (op === "open") { open(S, ev, ctx); }
  else {
    if (!S.table || S.table.status === "closed") refuse("no_table", "No table is open");
    if (op === "tick") { S.effects.changed = tick(S, ctx); }
    else if (OPS[op]) { if (!ctx.me) refuse("who", "Sign in first"); OPS[op](S, ev, ctx); }
    else refuse("op", "Unknown request");
  }
  if (S.effects.changed) {
    S.table.seq = (S.table.seq || 0) + 1;
    S.table.updatedAt = iso(ctx.now);
    if (S.table.status !== "hand") S.table.pots = [];
    checkInvariant(S);
  }
  return S;
}

module.exports = { reduce, pots, due, newDeck, shuffle, cryptoRng, EngineError, money,
  CLOCK, BETWEEN, TIMEOUTS_OUT, AUTO_LEAVE, IDLE_CLOSE, SEATS };
