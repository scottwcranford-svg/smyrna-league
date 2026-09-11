// The money: what each bet moved, the weekly high/low pool, who owes whom, and the
// per-manager drilldown.

import { entriesOf, r2 } from "./fmt.js?v=dev";
import { mName } from "./identity.js?v=dev";

/* ---- weekly high / low ----
   Each week the league's top Sleeper score collects the stake from the bottom score;
   ties share it. It runs all season and settles at the end. league/highlow holds
   { weeks: { "3": { high: [{ id, name, pts }], low: [...] } } }, one entry per week
   whose games are all final. */
const HL_STAKE=5;
export function hlStake(config){ var n=Number(config&&config.hlStake); return n>0?n:HL_STAKE; }
// The week's high and low from [{ id, name, pts }] rows; ties are kept together.
export function highLow(rows){
  rows=(rows||[]).filter(function(r){ return typeof r.pts==="number"&&!isNaN(r.pts); });
  if(rows.length<2) return null;
  var max=-Infinity, min=Infinity;
  rows.forEach(function(r){ if(r.pts>max) max=r.pts; if(r.pts<min) min=r.pts; });
  if(max===min) return null;   // everyone tied: nothing changes hands
  var pick=function(v){ return rows.filter(function(r){ return r.pts===v; }).map(function(r){ return { id:r.id||null, name:r.name||"", pts:r.pts }; }); };
  return { high:pick(max), low:pick(min) };
}
// Running tally per manager: net dollars, weeks on top, weeks on the bottom.
export function hlTally(hl,members,stake){
  stake=stake||HL_STAKE;
  var byId={}; (members||[]).forEach(function(m){ byId[m.id]={ net:0, highs:0, lows:0 }; });
  var weeks=Object.keys((hl&&hl.weeks)||{}).map(Number).filter(function(w){ return w>0; }).sort(function(a,b){ return a-b; });
  weeks.forEach(function(w){
    var e=hl.weeks[String(w)]; if(!e||!e.high||!e.low||!e.high.length||!e.low.length) return;
    e.high.forEach(function(r){ if(r.id&&byId[r.id]){ byId[r.id].net+=stake/e.high.length; byId[r.id].highs++; } });
    e.low.forEach(function(r){ if(r.id&&byId[r.id]){ byId[r.id].net-=stake/e.low.length; byId[r.id].lows++; } });
  });
  Object.keys(byId).forEach(function(id){ byId[id].net=Math.round(byId[id].net*100)/100; });
  return { byId:byId, weeks:weeks };
}

// What's behind one cell of the season table: the settled bets (or hi / low weeks)
// that make up a manager's net in that row, newest first. Rows: hl, weekly, season, total.
export function drillRows(memberId,row,bets,highlow,stake,members){
  var out=[];
  if(row==="hl"||row==="total"){
    var hl=(highlow&&highlow.weeks)||{};
    Object.keys(hl).map(Number).sort(function(a,b){ return b-a; }).forEach(function(w){
      var e=hl[String(w)]; if(!e||!e.high||!e.low) return;
      var hi=e.high.some(function(r){ return r.id===memberId; }), lo=e.low.some(function(r){ return r.id===memberId; });
      if(!hi&&!lo) return;
      var mine=(hi?e.high:e.low).filter(function(r){ return r.id===memberId; })[0]||{};
      var other=(hi?e.low:e.high).map(function(r){ return r.id?mName(r.id,members):r.name; }).join(" · ");
      out.push({ kind:"hl", week:w, label:(hi?"High score":"Low score")+" · "+(mine.pts!=null?mine.pts:""),
        note:(hi?"over ":"under ")+other, amount:hi?stake/e.high.length:-stake/e.low.length });
    });
  }
  if(row!=="hl"){
    (bets||[]).forEach(function(b){
      if(b.status!=="settled") return;
      var ents=entriesOf(b).filter(function(e){ return e.memberId; });
      if(ents.length<2||!ents.some(function(e){ return e.memberId===memberId; })) return;
      var weekly=Number(b.week)>0;
      if(row==="weekly"&&!weekly) return; if(row==="season"&&weekly) return;
      var amt=Number(b.amount)||0, val;
      if(b.winner==="push") val=0;
      else if(b.winner===memberId) val=amt*(ents.length-1);
      else if(b.winner) val=-amt; else return;
      out.push({ kind:"bet", id:b.id, week:Number(b.week)||0, label:b.name||b.terms||"", amount:val,
        note:b.winner==="push"?"push":b.winner===memberId?"beat "+ents.filter(function(e){ return e.memberId!==memberId; }).map(function(e){ return mName(e.memberId,members); }).join(" · "):"lost to "+mName(b.winner,members),
        at:b.settledAt||b.editedAt||b.createdAt||"" });
    });
  }
  out.sort(function(a,b){ return (b.week-a.week)||String(b.at||"").localeCompare(String(a.at||"")); });
  return out;
}
function legacyPayments(bets){
  var out=[];
  (bets||[]).forEach(function(b){
    if(b.status!=="settled"||!b.winner||b.winner==="push") return;
    (Array.isArray(b.paid)?b.paid:[]).forEach(function(from){
      if(from!==b.winner) out.push({ id:"bet:"+b.id+":"+from, from:from, to:b.winner, amount:Number(b.amount)||0, at:b.settledAt||"", legacy:true });
    });
  });
  return out;
}
function settleTransfers(byId){
  var debt=[], cred=[];
  Object.keys(byId).forEach(function(id){ var n=byId[id].net; if(n<-0.004) debt.push({ id:id, amt:-n }); else if(n>0.004) cred.push({ id:id, amt:n }); });
  debt.sort(function(a,b){ return b.amt-a.amt; }); cred.sort(function(a,b){ return b.amt-a.amt; });
  var out=[], i=0, j=0;
  while(i<debt.length&&j<cred.length){
    var a=r2(Math.min(debt[i].amt,cred[j].amt));
    out.push({ from:debt[i].id, to:cred[j].id, amount:a });
    debt[i].amt=r2(debt[i].amt-a); cred[j].amt=r2(cred[j].amt-a);
    if(debt[i].amt<=0.004) i++; if(cred[j].amt<=0.004) j++;
  }
  return out;
}
export function balances(config,bets,highlow,payments,stake){
  var members=config?config.members:[];
  var L=computeLedger(config,bets), HL=hlTally(highlow,members,stake);
  var byId={};
  var touch=function(id){ if(id&&!byId[id]) byId[id]={ bets:0, hl:0, paidOut:0, paidIn:0, net:0 }; };
  (members||[]).forEach(function(m){ touch(m.id); });
  Object.keys(L.pnl).forEach(function(id){ touch(id); byId[id].bets=L.pnl[id].net; });
  Object.keys(HL.byId).forEach(function(id){ touch(id); byId[id].hl=HL.byId[id].net; });
  var all=legacyPayments(bets).concat(payments||[]);
  all.forEach(function(p){ var a=Number(p.amount)||0; if(!(a>0)||!p.from||!p.to||p.voided) return; touch(p.from); touch(p.to); byId[p.from].paidOut+=a; byId[p.to].paidIn+=a; });
  Object.keys(byId).forEach(function(id){ var b=byId[id]; b.bets=r2(b.bets); b.hl=r2(b.hl); b.paidOut=r2(b.paidOut); b.paidIn=r2(b.paidIn); b.net=r2(b.bets+b.hl+b.paidOut-b.paidIn); });
  return { byId:byId, transfers:settleTransfers(byId), payments:all };
}

// What a manager would take with them. Removing someone deletes the record their bets,
// payments and hi/low weeks all point at by id, so the money survives and the person does
// not: every ticket they were on starts reading "Former manager" and their avatar is gone.
// This counts the places that would break, so the League dialog can refuse. A manager with
// nothing against their name — a handle typed wrong — is still safe to delete.
export function footprint(id,bets,highlow,payments){
  var out={ bets:0, payments:0, weeks:0, any:false };
  (bets||[]).forEach(function(b){
    if(b.createdBy===id||entriesOf(b).some(function(e){ return e.memberId===id; })) out.bets++;
  });
  (payments||[]).forEach(function(p){ if(!p.voided&&(p.from===id||p.to===id)) out.payments++; });
  var weeks=(highlow&&highlow.weeks)||{};
  Object.keys(weeks).forEach(function(w){
    var e=weeks[w]||{}, hit=function(list){ return (list||[]).some(function(r){ return r.id===id; }); };
    if(hit(e.high)||hit(e.low)) out.weeks++;
  });
  out.any=!!(out.bets||out.payments||out.weeks);
  return out;
}

// "7 bets and 2 payments", for telling an admin what they would be throwing away.
export function footprintText(f){
  var bits=[];
  if(f.bets) bits.push(f.bets+(f.bets===1?" bet":" bets"));
  if(f.payments) bits.push(f.payments+(f.payments===1?" payment":" payments"));
  if(f.weeks) bits.push(f.weeks+(f.weeks===1?" hi/low week":" hi/low weeks"));
  if(bits.length<2) return bits[0]||"";
  return bits.slice(0,-1).join(", ")+" and "+bits[bits.length-1];
}

export function computeLedger(config,bets){
  // risk: stake on live bets. offered: stake on bets still waiting for takers.
  // cancelled: stake on bets that reached the lock with no takers and cancelled themselves.
  var pnl={}, pairs={}, risk={}, offered={}, cancelled={}, picks={};
  (config?config.members:[]).forEach(function(m){
    pnl[m.id]={net:0,w:0,l:0,p:0,weekly:0,season:0}; risk[m.id]=0; offered[m.id]=0; cancelled[m.id]=0; picks[m.id]=[];
  });
  var touch=function(id){ if(id&&!pnl[id]) pnl[id]={net:0,w:0,l:0,p:0,weekly:0,season:0}; };

  (bets||[]).forEach(function(b){
    var amt=Number(b.amount)||0;
    var ents=entriesOf(b).filter(function(e){ return e.memberId; });

    if(b.status==="open") ents.forEach(function(e){ if(offered[e.memberId]!=null) offered[e.memberId]+=amt; });
    if(b.status==="active") ents.forEach(function(e){ if(risk[e.memberId]!=null) risk[e.memberId]+=amt; });
    if(b.status==="void"&&b.autoVoid) ents.forEach(function(e){ if(cancelled[e.memberId]!=null) cancelled[e.memberId]+=amt; });
    if(b.status==="open"||b.status==="active"){
      // The ledger card lists the bets a manager is in, by name.
      var title=b.name||String(b.terms||"").slice(0,32);
      ents.forEach(function(e){
        if(picks[e.memberId]&&picks[e.memberId].indexOf(title)<0) picks[e.memberId].push(title);
      });
    }
    if(b.status!=="settled"||ents.length<2) return;

    ents.forEach(function(e){ touch(e.memberId); });
    if(b.winner==="push"){ ents.forEach(function(e){ pnl[e.memberId].p++; }); return; }
    var win=b.winner;
    if(!win||!pnl[win]) return;

    var losers=ents.filter(function(e){ return e.memberId!==win; });
    var bucket=Number(b.week)>0?"weekly":"season";   // net by kind, for the season table
    pnl[win].net += amt*losers.length; pnl[win].w++; pnl[win][bucket]+=amt*losers.length;
    var paid=Array.isArray(b.paid)?b.paid:[];
    losers.forEach(function(e){
      pnl[e.memberId].net -= amt; pnl[e.memberId].l++; pnl[e.memberId][bucket]-=amt;
      if(paid.indexOf(e.memberId)>=0) return;
      var key=[win,e.memberId].sort().join("|");
      if(pairs[key]==null) pairs[key]=0;
      pairs[key] += (key.split("|")[0]===win?amt:-amt);
    });
  });

  var debts=[];
  Object.keys(pairs).forEach(function(key){
    var v=pairs[key]; if(Math.abs(v)<0.005) return;
    var ids=key.split("|");
    debts.push(v>0?{from:ids[1],to:ids[0],amount:v,key:key}:{from:ids[0],to:ids[1],amount:-v,key:key});
  });
  debts.sort(function(a,b){ return b.amount-a.amount; });
  return { pnl:pnl, debts:debts, risk:risk, offered:offered, cancelled:cancelled, picks:picks };
}
