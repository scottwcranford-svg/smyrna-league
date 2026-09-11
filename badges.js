// Season titles. Each badge names a holder from the book, ties are shared, and
// `badgeChanges` reports what moved so the app can announce it.

import { entriesOf, fmtDay, money, nameList, r2, signed, weekLabel } from "./fmt.js?v=dev";
import { currentWeek } from "./clock.js?v=dev";
import { mName } from "./identity.js?v=dev";
import { balances, computeLedger, hlStake, hlTally } from "./ledger.js?v=dev";

/* ---- ledger ---- */

/* ---- badges ----
   Live titles, not trophies: every one is recomputed from the book, so they change
   hands the moment the standings do. Pure — the page hands it everything. A badge with
   no holder (nobody qualifies yet) still comes back, so the case shows what's up for
   grabs. `seen` accepts both shapes: an ISO string, or { at, n } once visits are counted. */

const BADGES=[
  { key:"degenerate", fam:"money", icon:"dice",   name:"Biggest Degenerate", blurb:"Most money staked all season, win or lose", plural:"Biggest Degenerates" },
  { key:"highroller", fam:"money", icon:"chips",  name:"High Roller",        blurb:"Biggest single pot they have money in", plural:"High Rollers" },
  { key:"deadbeat",   fam:"money", icon:"wallet", name:"Deadbeat",           blurb:"Owes the most right now", plural:"Deadbeats" },
  { key:"bank",       fam:"money", icon:"bank",   name:"The Bank",           blurb:"Owed the most right now", plural:"The Banks" },
  { key:"winner",     fam:"good",  icon:"trophy", name:"Biggest Winner",     blurb:"Best net across every settled bet", plural:"Biggest Winners" },
  { key:"hothand",    fam:"good",  icon:"flame",  name:"Hot Hand",           blurb:"Longest run of wins that hasn't ended", plural:"Hot Hands" },
  { key:"untouchable",fam:"good",  icon:"shield", name:"Untouchable",        blurb:"Unbeaten, three settled bets or more", plural:"Untouchables" },
  { key:"kingmaker",  fam:"good",  icon:"crown",  name:"Kingmaker",          blurb:"Biggest haul off one bet", plural:"Kingmakers" },
  { key:"weeklyking", fam:"good",  icon:"star",   name:"Weekly King",        blurb:"Most weeks as the top Sleeper score", plural:"Weekly Kings" },
  { key:"loser",      fam:"bad",   icon:"anchor", name:"Biggest Loser",      blurb:"Worst net across every settled bet", plural:"Biggest Losers" },
  { key:"icecold",    fam:"bad",   icon:"snow",   name:"Ice Cold",           blurb:"Longest run of losses that hasn't ended" },
  { key:"basement",   fam:"bad",   icon:"stairs", name:"Basement Dweller",   blurb:"Most weeks as the bottom Sleeper score", plural:"Basement Dwellers" },
  { key:"coldfeet",   fam:"bad",   icon:"boots",  name:"Cold Feet",          blurb:"Most bets of theirs cancelled with no takers" },
  { key:"active",     fam:"act",   icon:"bolt",   name:"Most Active",        blurb:"In the most bets this season" },
  { key:"instigator", fam:"act",   icon:"horn",   name:"The Instigator",     blurb:"Proposed the most bets", plural:"The Instigators" },
  { key:"ghost",      fam:"act",   icon:"ghost",  name:"Ghost",              blurb:"Longest since they last opened the app", plural:"Ghosts" },
  { key:"quickdraw",  fam:"act",   icon:"target", name:"Quick Draw",         blurb:"Fastest to take an open seat after it's posted", plural:"Quick Draws" },
  { key:"logins",     fam:"act",   icon:"door",   name:"Most Logged In",     blurb:"Opened the app the most times" }
];

// league/seen holds an ISO string per manager, or { at, n } once visits are counted.
export function seenAt(seen,id){ var v=seen&&seen[id]; if(!v) return ""; return typeof v==="string"?v:(v.at||""); }
export function seenCount(seen,id){ var v=seen&&seen[id]; return (v&&typeof v==="object"&&Number(v.n))||0; }

// Highest value takes it — and everyone level on that value holds it together, in name
// order so every browser lists them the same way. Nobody loses a title to alphabetics.
function top(vals,least){
  var rows=Object.keys(vals).map(function(id){ return { id:id, v:vals[id].v, name:vals[id].name }; })
    .filter(function(r){ return r.v!=null; });
  if(!rows.length) return null;
  var best=null;
  rows.forEach(function(r){ if(best===null||(least?r.v<best:r.v>best)) best=r.v; });
  var tied=rows.filter(function(r){ return r.v===best; })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });
  return { v:best, ids:tied.map(function(r){ return r.id; }), names:tied.map(function(r){ return r.name; }) };
}

export function badges(config,bets,highlow,seen,payments,now){
  var list=(config&&config.members||[]).filter(function(m){ return !m.test; });
  var byId={}; list.forEach(function(m){ byId[m.id]=m; });
  var has=function(id){ return !!byId[id]; };
  var nm=function(id){ return byId[id]?byId[id].name:""; };
  now=now||Date.now();

  var L=computeLedger(config,bets);
  var stake=hlStake(config);
  var HL=hlTally(highlow,list,stake);
  var Bal=balances(config,bets,highlow,payments,stake);

  // one pass over the book
  var staked={}, pot={}, mine={}, made={}, pulled={}, haul={}, drawn={}, settled={};
  list.forEach(function(m){ staked[m.id]=0; pot[m.id]=0; mine[m.id]=0; made[m.id]=0; pulled[m.id]=0; haul[m.id]=0; drawn[m.id]=null; settled[m.id]=[]; });

  (bets||[]).forEach(function(b){
    var amt=Number(b.amount)||0, ents=entriesOf(b).filter(function(e){ return e.memberId&&has(e.memberId); });
    if(b.createdBy&&has(b.createdBy)){
      if(b.status!=="void") made[b.createdBy]++;
      else if(b.autoVoid||b.cancelled) pulled[b.createdBy]++;
    }
    if(b.status==="open"||b.status==="void") { ents.forEach(function(e){ if(b.status==="open") mine[e.memberId]++; }); return; }
    var seats=ents.length, thisPot=amt*seats;
    ents.forEach(function(e){
      staked[e.memberId]+=amt; mine[e.memberId]++;
      if(thisPot>pot[e.memberId]) pot[e.memberId]=thisPot;
      // the fastest anyone has ever grabbed an open seat (stamped from the day it shipped)
      var t=Date.parse(e.takenAt||""), t0=Date.parse(b.createdAt||"");
      if(!isNaN(t)&&!isNaN(t0)&&t>t0){ var gap=t-t0; if(drawn[e.memberId]==null||gap<drawn[e.memberId]) drawn[e.memberId]=gap; }
    });
    if(b.status!=="settled"||!b.winner||b.winner==="push") return;
    var losers=ents.filter(function(e){ return e.memberId!==b.winner; }).length;
    if(has(b.winner)&&losers){ var got=amt*losers; if(got>haul[b.winner]) haul[b.winner]=got; }
    var when=String(b.settledAt||b.createdAt||"");
    ents.forEach(function(e){ settled[e.memberId].push({ at:when, won:e.memberId===b.winner }); });
  });

  // a streak is the run at the end of a manager's settled bets, newest last
  var streak=function(id,won){
    var rows=settled[id].slice().sort(function(a,b){ return String(a.at).localeCompare(String(b.at)); });
    var n=0;
    for(var i=rows.length-1;i>=0;i--){ if(rows[i].won===won) n++; else break; }
    return n;
  };

  var pick=function(fn,least){
    var vals={};
    list.forEach(function(m){ vals[m.id]={ v:fn(m.id), name:m.name }; });
    return top(vals,least);
  };
  var money=function(n){ return n; };
  var out=BADGES.map(function(B){
    var hit=null, text="";
    if(B.key==="degenerate"){ hit=pick(function(id){ return staked[id]>0?staked[id]:null; }); if(hit) text=fmtMoney(hit.v); }
    else if(B.key==="highroller"){ hit=pick(function(id){ return pot[id]>0?pot[id]:null; }); if(hit) text=fmtMoney(hit.v); }
    else if(B.key==="deadbeat"){ hit=pick(function(id){ var n=(Bal.byId[id]||{}).net; return n<0?-n:null; }); if(hit) text="owes "+fmtMoney(hit.v); }
    else if(B.key==="bank"){ hit=pick(function(id){ var n=(Bal.byId[id]||{}).net; return n>0?n:null; }); if(hit) text="owed "+fmtMoney(hit.v); }
    else if(B.key==="winner"){ hit=pick(function(id){ var n=(L.pnl[id]||{}).net; return n>0?n:null; }); if(hit) text=signed(hit.v); }
    else if(B.key==="loser"){ hit=pick(function(id){ var n=(L.pnl[id]||{}).net; return n<0?-n:null; }); if(hit) text=signed(-hit.v); }
    else if(B.key==="hothand"){ hit=pick(function(id){ var n=streak(id,true); return n>1?n:null; }); if(hit) text=hit.v+" in a row"; }
    else if(B.key==="icecold"){ hit=pick(function(id){ var n=streak(id,false); return n>1?n:null; }); if(hit) text=hit.v+" in a row"; }
    else if(B.key==="untouchable"){ hit=pick(function(id){ var p=L.pnl[id]||{}; return (p.w>=3&&!p.l)?p.w:null; }); if(hit) text=hit.v+"\u20130"; }
    else if(B.key==="kingmaker"){ hit=pick(function(id){ return haul[id]>0?haul[id]:null; }); if(hit) text=fmtMoney(hit.v); }
    else if(B.key==="weeklyking"){ hit=pick(function(id){ var h=(HL.byId[id]||{}).highs; return h>0?h:null; }); if(hit) text=hit.v+(hit.v===1?" high":" highs"); }
    else if(B.key==="basement"){ hit=pick(function(id){ var l=(HL.byId[id]||{}).lows; return l>0?l:null; }); if(hit) text=hit.v+(hit.v===1?" low":" lows"); }
    else if(B.key==="coldfeet"){ hit=pick(function(id){ return pulled[id]>0?pulled[id]:null; }); if(hit) text=hit.v+" pulled"; }
    else if(B.key==="active"){ hit=pick(function(id){ return mine[id]>0?mine[id]:null; }); if(hit) text=hit.v+(hit.v===1?" bet":" bets"); }
    else if(B.key==="instigator"){ hit=pick(function(id){ return made[id]>0?made[id]:null; }); if(hit) text=hit.v+" posted"; }
    // whole days, not milliseconds: a badge's value has to be the same on two draws a
    // second apart, or badgeChanges() sees a change every time and writes forever.
    else if(B.key==="ghost"){ hit=pick(function(id){ var t=Date.parse(seenAt(seen,id)||""); return isNaN(t)?null:Math.floor((now-t)/86400000); }); if(hit) text=hit.v+"d away"; }
    else if(B.key==="quickdraw"){ hit=pick(function(id){ return drawn[id]; },true); if(hit) text=quickText(hit.v); }
    else if(B.key==="logins"){ hit=pick(function(id){ var n=seenCount(seen,id); return n>1?n:null; }); if(hit) text=hit.v+" visits"; }
    var ids=hit?hit.ids:[];
    // shared, so the title itself goes plural: two Biggest Degenerates
    return { key:B.key, fam:B.fam, icon:B.icon, name:B.name, blurb:B.blurb,
             label:(ids.length>1&&B.plural)?B.plural:B.name,
             holders:ids, holderNames:ids.map(nm), shared:ids.length>1,
             holder:ids[0]||null, holderName:ids.length?nm(ids[0]):"",
             value:hit?r2(hit.v):null, text:hit?text:"" };
  });
  return out;
}

// Not a redundant alias: badges() shadows `money` with a local that returns the raw
// number, so this is how the badge text reaches the real one. Inline it and every
// badge value loses its "$".
function fmtMoney(n){ return money(n); }
function quickText(ms){
  var s=Math.round(ms/1000);
  if(s<60) return s+"s";
  if(s<3600) return Math.round(s/60)+"m";
  if(s<86400) return Math.round(s/3600)+"h";
  return Math.round(s/86400)+"d";
}

// What changed since the book last recorded who held what. `stored` is league/badges'
// { byKey: { <key>: { holder, value, at, week, from } } }; the answer is the records to
// write, so whichever page notices first can save them and everyone sees the same history.
export function badgeChanges(list,stored,config,games,now){
  var was=(stored&&stored.byKey)||{}, out={}, any=false;
  var wk=currentWeek(config,games);
  var key=function(a){ return (a||[]).join(","); };
  (list||[]).forEach(function(b){
    var prev=was[b.key], had=prev?(prev.holders||(prev.holder?[prev.holder]:[])):[];
    var now2=b.holders||[];
    var same=prev&&key(had)===key(now2)&&(prev.text||"")===(b.text||"");
    if(same) return;
    // a badge nobody holds and nobody held is not news
    if(!now2.length&&!had.length) return;
    any=true;
    // whoever was on it before and isn't any more lost it
    var lost=had.filter(function(id){ return now2.indexOf(id)<0; });
    var kept=had.length&&key(had)===key(now2);
    out[b.key]={ holders:now2, holder:now2[0]||null, value:b.value, text:b.text||"",
                 at:new Date(now||Date.now()).toISOString(), week:wk,
                 from:lost.length?lost:null,
                 since:kept?(prev.since||prev.at||null):null };
  });
  return any?out:null;
}

// The line under a badge: who it was taken from, or how long they've held it. `holder`
// is who holds it right now — the book's record can lag a moment behind on a fresh page,
// and until it lands there is simply no story to tell, not "nobody yet".
export function badgeStory(rec,members,holders){
  var now=Array.isArray(holders)?holders:(holders?[holders]:[]);
  if(arguments.length>2&&!now.length) return "nobody yet";
  var had=rec?(rec.holders||(rec.holder?[rec.holder]:[])):[];
  if(!had.length) return arguments.length>2?"":"nobody yet";
  if(arguments.length>2&&had.join(",")!==now.join(",")) return "";
  var wk=rec.week?weekLabel(rec.week).toLowerCase():"";
  var from=Array.isArray(rec.from)?rec.from:(rec.from?[rec.from]:[]);
  if(from.length) return "took it from "+nameList(from.map(function(id){ return mName(id,members); }))+(wk?" \u00b7 "+wk:"");
  var since=rec.since||rec.at;
  var t=Date.parse(since||"");
  return isNaN(t)?"held it all season":"held since "+(rec.sinceWeek?weekLabel(rec.sinceWeek).toLowerCase():fmtDay(t));
}
