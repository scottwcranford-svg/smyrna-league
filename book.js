// Changes to the book: every write a manager can make to a bet or the league, done
// to the local copy first (so the page answers at once) and then to Firestore.
// The lease-guarded ones (taking a seat) re-read before they write.

import * as Fmt from "./fmt.js?v=dev";
import * as Clock from "./clock.js?v=dev";
import * as Id from "./identity.js?v=dev";
import * as Bets from "./bets.js?v=dev";
import * as Badges from "./badges.js?v=dev";
import { dbMsg } from "./store.js?v=dev";
import { state, members, touch } from "./state.js?v=dev";
import { toast, statsBar } from "./render.js?v=dev";

const entriesOf=Fmt.entriesOf, openSeats=Fmt.openSeats, clone=Fmt.clone;
const mName=function(id){ return Id.mName(id,members()); };
const money=Fmt.money, uid=Fmt.uid;
const isLocked=function(b){ return Clock.isLocked(b,state.config); };
const betLock=function(b){ return Clock.betLock(b,state.config); };

export function guard(){
  if(state.local){ toast(state.connected?"Publish the league first":"Preview only — nothing saves"); return false; }
  return true;
}

export function findBet(id){ var hit=null; state.bets.forEach(function(b){ if(b.id===id) hit=b; }); return hit; }

function body(b){ var o={}; Object.keys(b).forEach(function(k){ if(k!=="id") o[k]=b[k]; }); return o; }

export function saveBet(b){
  var i=-1;
  for(var k=0;k<state.bets.length;k++){ if(state.bets[k].id===b.id){ i=k; break; } }
  if(i>=0) state.bets[i]=b; else state.bets.unshift(b);
  touch();
  if(state.db&&!state.local) state.db.doc("bets/"+b.id).set(body(b)).catch(function(e){ toast(dbMsg(e)); });
}
export function removeBet(id){
  state.bets=state.bets.filter(function(b){ return b.id!==id; });
  touch();
  if(state.db&&!state.local) state.db.doc("bets/"+id).delete().catch(function(e){ toast(dbMsg(e)); });
}
export function saveConfig(){
  touch();
  if(state.db&&!state.local&&state.config)
    state.db.doc("league/config").set(state.config).catch(function(e){ toast(dbMsg(e)); });
}

// A bet still waiting on a seat when its lock hits is cancelled — nobody should be
// able to jump in after kickoff. Whichever open page notices first writes it; the
// write is a merge and idempotent, so two pages noticing at once is harmless.
export function expireBets(){
  var now=Date.now();
  state.bets.forEach(function(b){
    if(b.status!=="open"||now<betLock(b)) return;
    b.status="void"; b.winner=null; b.autoVoid=true; b.voidedAt=new Date(now).toISOString(); b.voidedReason="No takers by lock";
    if(state.db&&!state.local) state.db.doc("bets/"+b.id).update({ status:"void", winner:null, autoVoid:true, voidedAt:b.voidedAt, voidedReason:b.voidedReason })
      .catch(function(){ /* another page got there first, or offline — the snapshot will settle it */ });
  });
}

// Bets settle themselves once the result is in (rules.autoResult decides). Like
// expireBets: whichever open page notices first writes it, and two pages writing
// the same result is harmless.
export function settleFinished(){
  var now=Date.now();
  state.bets.forEach(function(b){
    var r=Bets.autoResult(b,state.games,now); if(!r) return;
    b.status="settled"; b.winner=r.winner; b.settledAt=new Date(now).toISOString(); b.settledBy="auto"; b.settledNote=r.note;
    if(!Array.isArray(b.paid)) b.paid=[];
    if(state.db&&!state.local) state.db.doc("bets/"+b.id).update({ status:"settled", winner:r.winner, settledAt:b.settledAt, settledBy:"auto", settledNote:r.note })
      .catch(function(){ /* another page got there first, or offline */ });
  });
}

// Badges are worked out from the book every draw; this records who holds what, so the
// case can say "took it from JPorch" instead of just naming today's holder. Like
// expireBets: whichever open page notices first writes it, and the write is a merge, so
// two pages noticing at once is harmless.
export function syncBadges(){
  if(!state.db||state.local||!state.config) return;
  // This runs on the way to every draw, so nothing in here may throw: a failed
  // bookkeeping write must never stop the page from rendering.
  try{
    var list=Badges.badges(state.config,state.bets,state.highlow,state.seen,state.payments&&state.payments.list,Date.now());
    var chg=Badges.badgeChanges(list,state.badges,state.config,state.games,Date.now());
    if(!chg) return;
    var cur=(state.badges&&state.badges.byKey)||{};
    state.badges={ updatedAt:new Date().toISOString(), byKey:Object.assign({},cur,chg) };
    var ref=state.db.doc("league/badges");
    if(ref&&typeof ref.update==="function") ref.update(state.badges)
      .catch(function(){ /* another page got there first, or offline — the snapshot settles it */ });
  }catch(e){ console.warn("badges:",e&&e.message); }
}

export function publishLeague(){
  if(!state.db) return toast("Not connected");
  var cfg=state.config, bets=state.bets.slice();
  state.db.doc("league/config").set(cfg).then(function(){
    state.local=false;
    return Promise.all(bets.map(function(b){ return state.db.doc("bets/"+b.id).set(body(b)); }));
  }).then(function(){ toast("Book is open"); touch(); })
    .catch(function(e){ toast(dbMsg(e)); });
}

export function takeSeat(id,i){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=findBet(id);
  if(!bet||bet.status!=="open") return;
  if(isLocked(bet)) return toast("Locked — that week has kicked off");
  if(entriesOf(bet).some(function(e){ return e.memberId===state.me; })) return toast("You’re already in this one");
  var seat=entriesOf(bet)[i]||{};
  if(seat.invite&&!seat.declined&&seat.invite!==state.me) return toast("That seat is held for "+mName(seat.invite));

  var ref=state.db?state.db.doc("bets/"+id):null;
  if(!ref){
    bet.entries[i].memberId=state.me; bet.entries[i].takenAt=new Date().toISOString(); delete bet.entries[i].invite;
    if(!openSeats(bet)) bet.status="active";
    saveBet(bet); return;
  }
  // Two managers can tap the same open seat at once. Lease the doc, re-read,
  // and only claim the seat if it is genuinely still empty.
  ref.acquire({ holder:state.me, ttlMs:5000 }).then(function(res){
    if(!res.acquired){ toast("Someone else is claiming it"); return; }
    return ref.get().then(function(snap){
      var cur=snap.exists?clone(snap.data()):null;
      if(!cur||!Array.isArray(cur.entries)||!cur.entries[i]||cur.entries[i].memberId){
        toast("That seat is gone"); return;
      }
      if(cur.entries[i].invite&&!cur.entries[i].declined&&cur.entries[i].invite!==state.me){ toast("That seat is held for "+mName(cur.entries[i].invite)); return; }
      cur.entries[i].memberId=state.me; cur.entries[i].takenAt=new Date().toISOString();
      delete cur.entries[i].invite; delete cur.entries[i].declined;
      if(!cur.entries.some(function(e){ return !e.memberId; })) cur.status="active";
      return ref.set(cur).then(function(){ toast("You’re in"); });
    });
  }).catch(function(e){ toast(dbMsg(e)); });
}

// Invited to a seat and not interested: the invite stays on record; the seat opens to anyone.
export function passSeat(id,i){
  if(!guard()) return;
  var b=findBet(id); if(!b) return;
  if(isLocked(b)) return toast("Locked — too late to pass");
  var e=entriesOf(b)[i];
  if(!e||e.memberId||e.invite!==state.me) return;
  e.declined=true;
  saveBet(b);
  toast("Passed — the seat is open to anyone");
}

// A payment between two managers, against the season's balances. Recorded by whoever
// marks it; an admin can void one that was marked by mistake.
export function recordPayment(from,to,amount){
  if(!guard()) return;
  amount=Math.round((Number(amount)||0)*100)/100;
  if(!from||!to||from===to||!(amount>0)) return toast("Nothing to record");
  var cur=state.payments||{ list:[] }, list=Array.isArray(cur.list)?cur.list.slice():[];
  list.push({ id:uid(), from:from, to:to, amount:amount, at:new Date().toISOString(), by:state.me||null });
  state.payments={ updatedAt:new Date().toISOString(), list:list };
  touch();
  if(state.db&&!state.local) state.db.doc("league/payments").set(state.payments).catch(function(e){ toast(dbMsg(e)); });
  toast("Recorded · "+mName(from)+" paid "+mName(to)+" "+money(amount));
}
export function voidPayment(id){
  if(!guard()) return;
  if(!state.admin) return toast("Only the admin can undo a payment");
  var cur=state.payments||{ list:[] }, list=(cur.list||[]).map(function(p){ return p.id===id?Object.assign({},p,{ voided:true, voidedBy:state.me||null, voidedAt:new Date().toISOString() }):p; });
  state.payments={ updatedAt:new Date().toISOString(), list:list };
  touch();
  if(state.db&&!state.local) state.db.doc("league/payments").set(state.payments).catch(function(e){ toast(dbMsg(e)); });
  toast("Payment undone");
}

export function recordWinner(id,w){
  if(!guard()) return;
  var b=findBet(id); if(!b) return;
  b.status="settled"; b.winner=w; b.settledAt=new Date().toISOString(); b.settledBy=state.me;
  if(!Array.isArray(b.paid)) b.paid=[];
  saveBet(b);
  toast(w==="push"?"Called a push":"Result recorded");
}
export function reopenBet(id){
  if(!guard()) return;
  var b=findBet(id); if(!b) return;
  b.status="active"; b.winner=null; b.paid=[]; saveBet(b);
  toast("Back to live");
}
// Still waiting on takers: cancelled. Live: voided. Both come back with Restore.
export function voidBet(id){
  if(!guard()) return;
  var b=findBet(id); if(!b) return;
  var wasOpen=b.status==="open", proposer=!b.createdBy||b.createdBy===state.me;
  if(wasOpen&&!proposer&&!state.admin) return toast("Only "+mName(b.createdBy)+" can cancel this one");
  if(!wasOpen&&!state.admin) return toast("Both sides are in — this bet stands");
  b.status="void"; b.winner=null; b.voidedAt=new Date().toISOString(); b.voidedBy=state.me;
  if(wasOpen){ b.cancelled=true; b.voidedReason="Cancelled by "+mName(state.me); }
  saveBet(b);
  toast(wasOpen?"Cancelled":"Voided");
}
// Back to where it was before the void: open if a seat is empty, otherwise live.
export function restoreBet(id){
  if(!guard()) return;
  var b=findBet(id); if(!b) return;
  b.status=openSeats(b)?"open":"active"; b.winner=null;
  delete b.autoVoid; delete b.cancelled; delete b.voidedAt; delete b.voidedBy; delete b.voidedReason;
  saveBet(b);
  toast("Restored");
}
export function deleteBet(id){
  if(!guard()) return;
  removeBet(id); toast("Deleted");
}

// Ask this page to pull Sleeper now (the book's refresh hook does the work).
export function requestRefresh(){
  if(!guard()) return;
  var cur=state.refresh||{};
  state.refresh=Object.assign({},cur,{ requestedAt:new Date().toISOString(), requestedBy:state.me||null });
  statsBar();
  state.db.refresh(state.me).then(function(r){ toast(r&&r.note==="recent"?"Scores refreshed":"Refreshing…"); })
    .catch(function(e){ toast(dbMsg(e)); });
}
