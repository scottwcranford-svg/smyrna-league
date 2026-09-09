// Changes to the book: every write a manager can make to a bet or the league, done
// to the local copy first (so the page answers at once) and then to Firestore.
// The lease-guarded ones (taking a seat) re-read before they write.

import * as R from "./rules.js?v=17";
import { dbMsg } from "./store.js?v=17";
import { state, members, touch } from "./state.js?v=17";
import { toast, statsBar } from "./render.js?v=17";

const entriesOf=R.entriesOf, openSeats=R.openSeats, clone=R.clone;
const mName=function(id){ return R.mName(id,members()); };
const isLocked=function(b){ return R.isLocked(b,state.config); };
const betLock=function(b){ return R.betLock(b,state.config); };

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
    bet.entries[i].memberId=state.me; delete bet.entries[i].invite;
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
      cur.entries[i].memberId=state.me; delete cur.entries[i].invite; delete cur.entries[i].declined;
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

export function markPaid(betId,memberId){
  var b=findBet(betId); if(!b) return;
  if(!Array.isArray(b.paid)) b.paid=[];
  if(b.paid.indexOf(memberId)<0) b.paid.push(memberId);
  saveBet(b);
}
export function markPairPaid(from,to){
  if(!guard()) return;
  state.bets.forEach(function(b){
    if(b.status!=="settled"||b.winner!==to||b.winner==="push") return;
    if(!entriesOf(b).some(function(e){ return e.memberId===from; })) return;
    if(!Array.isArray(b.paid)) b.paid=[];
    if(b.paid.indexOf(from)<0){ b.paid.push(from); saveBet(b); }
  });
  toast("Settled up");
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
  var wasOpen=b.status==="open";
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
