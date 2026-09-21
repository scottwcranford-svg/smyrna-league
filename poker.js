// The poker table as the page reads it. Pure: card codes to what's printed on them, whose
// turn it is, what a call costs, where a raise may land, the clock, the seat order round
// the table, and the session tally. No dealing here - the dealer is a Cloud Function
// (functions/poker) and these helpers only mirror its rules closely enough to draw the
// right buttons. Chips are integer cents throughout, as the table doc has them.

export const HAND_NAMES=["High card","Pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"];
export function handName(cat){ return HAND_NAMES[Number(cat)]||""; }

const SUITS={ s:"♠", h:"♥", d:"♦", c:"♣" };
// "Td" → { rank:"10", suit:"♦", red:true }
export function card(code){
  code=String(code||"");
  var r=code[0]||"", s=code[1]||"";
  return { code:code, rank:r==="T"?"10":r, suit:SUITS[s]||"", red:s==="h"||s==="d" };
}

export const SEATS=10;
export function seats(t){ return ((t&&t.seats)||[]).filter(Boolean); }
export function mySeat(t,me){ return me?seats(t).filter(function(s){ return s.memberId===me; })[0]||null:null; }
export function seated(t,me){ return !!mySeat(t,me); }
export function inHand(s){ return !!s&&(s.status==="in"||s.status==="folded"||s.status==="allin"); }
export function myTurn(t,me){ var s=mySeat(t,me); return !!(t&&t.status==="hand"&&s&&s.status==="in"&&t.toAct===s.seat); }

// What it costs to stay in, capped at the stack; nothing owed means a check.
export function toCall(t,s){ if(!t||!s) return 0; return Math.max(0,Math.min((t.currentBet||0)-(s.bet||0),s.stack||0)); }
export function canCheck(t,s){ return !!t&&!!s&&(t.currentBet||0)-(s.bet||0)<=0; }
// Everything in the middle, this street's bets included.
export function potTotal(t){
  if(!t) return 0;
  if(Array.isArray(t.pots)&&t.pots.length) return t.pots.reduce(function(n,p){ return n+(Number(p.amount)||0); },0);
  return seats(t).reduce(function(n,s){ return n+(Number(s.totalIn)||0); },0);
}
// A raise is "to" an amount: at least the bet plus the last raise, at most all in. The
// dealer's rule exactly (engine.js doAction), so the slider can't offer what it refuses.
export function raiseBounds(t,s){
  if(!t||!s) return { min:0, max:0 };
  var all=(s.bet||0)+(s.stack||0), min=(t.currentBet||0)+(t.minRaise||t.blinds.bb||0);
  return { min:Math.min(min,all), max:all };
}
export function clampRaise(n,b){ n=Math.round(Number(n)||0); if(n<b.min) n=b.min; if(n>b.max) n=b.max; return n; }
// The preset chips: min, half the pot, the pot, all in - as raise-to amounts.
export function presetAmount(t,s,which){
  var b=raiseBounds(t,s), pot=potTotal(t), cb=t.currentBet||0, n;
  if(which==="allin") n=b.max;
  else if(which==="pot") n=cb+pot+toCall(t,s);
  else if(which==="half") n=cb+Math.round((pot+toCall(t,s))/2);
  else n=b.min;
  return clampRaise(n,b);
}

// The clock, from the dealer's deadline and its own idea of the time (updatedAt is the
// server's clock at the write; the offset is what the page found it to be against its own).
export function secondsLeft(deadline,now,offset){
  var t=Date.parse(deadline||""); if(isNaN(t)) return 0;
  return Math.max(0,Math.ceil((t-((now||Date.now())+(offset||0)))/1000));
}
export function clockFraction(deadline,total,now,offset){
  var t=Date.parse(deadline||""); if(isNaN(t)||!(total>0)) return 0;
  return Math.max(0,Math.min(1,(t-((now||Date.now())+(offset||0)))/total));
}

// The seats clockwise from the one after yours, yours last: `off` is how many seats
// round from you (0 is you), which is what places them on the oval.
export function seatOrder(t,me){
  var mine=mySeat(t,me), from=mine?mine.seat:0, out=[];
  for(var k=1;k<=SEATS;k++){ var i=(from+k)%SEATS; out.push({ i:i, off:k%SEATS, seat:(t&&t.seats&&t.seats[i])||null }); }
  return out;
}
// Where seat `off` sits on the oval, as percentages: you at the bottom, the rest round.
export function seatXY(off,n){
  n=n||SEATS;
  var a=(90+off*360/n)*Math.PI/180;
  return { x:Math.round((50+44*Math.cos(a))*10)/10, y:Math.round((50+42*Math.sin(a))*10)/10 };
}

// The session tally: in, out, on the table and net per manager, best night first.
export function sessionRows(session){
  var by=(session&&session.byId)||{};
  return Object.keys(by).map(function(id){ var L=by[id]; return { id:id, in:L.in||0, out:L.out||0, onTable:L.onTable||0, net:(L.out||0)+(L.onTable||0)-(L.in||0) }; })
    .sort(function(a,b){ return b.net-a.net||(a.id<b.id?-1:1); });
}
// Nets in dollars keyed by id, the shape ledger.js settleTransfers takes.
export function netsFor(session){
  var out={}; sessionRows(session).forEach(function(r){ out[r.id]={ net:r.net/100 }; }); return out;
}

// How much may go on the table: a seat's first buy-in, or a top-up to the table's max.
export function buyInBounds(t,s,mode){
  if(!t) return { min:0, max:0 };
  if(mode==="rebuy"&&s) return { min:Math.min(t.blinds.bb,Math.max(0,t.maxBuy-((s.stack||0)+(s.pendingAdd||0)))), max:Math.max(0,t.maxBuy-((s.stack||0)+(s.pendingAdd||0))) };
  return { min:t.minBuy||0, max:t.maxBuy||0 };
}

// Cents as the app prints money.
export function dollars(c){ return (Number(c)||0)/100; }
