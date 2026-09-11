// Head-to-head history between two managers: the grid, the sharpest pairs, and the
// feed of what they have bet on each other.

import { entriesOf, r2 } from "./fmt.js?v=dev";

/* ---- who beat whom ----
   Every settled bet is a set of pairs: the winner took the stake from each loser,
   so a four-way pot won by one manager is three wins for them and one loss each for
   the others — exactly what the money did. Pushes and voids count for nobody.
   `byId[a][b]` is a's record against b: net dollars from a's side, wins, losses, and
   the bets behind them, newest first. Pure: the page hands it the book. */
export function rivals(members,bets){
  var ids=(members||[]).map(function(m){ return m.id; });
  var byId={}, blank=function(){ return { net:0, w:0, l:0, bets:[] }; };
  var cell=function(a,b){
    if(!byId[a]) byId[a]={};
    if(!byId[a][b]) byId[a][b]=blank();
    return byId[a][b];
  };
  ids.forEach(function(a){ ids.forEach(function(b){ if(a!==b) cell(a,b); }); });

  (bets||[]).forEach(function(b){
    if(!b||b.status!=="settled"||!b.winner||b.winner==="push") return;
    var ents=entriesOf(b).filter(function(e){ return e.memberId; });
    if(ents.length<2) return;
    var win=b.winner;
    if(!ents.some(function(e){ return e.memberId===win; })) return;
    var amt=Number(b.amount)||0;
    var meta={ id:b.id, week:Number(b.week)||0, name:b.name||String(b.terms||"").slice(0,40),
               amount:amt, at:b.settledAt||b.createdAt||"" };
    ents.forEach(function(e){
      var l=e.memberId; if(l===win) return;
      var W=cell(win,l), L=cell(l,win);
      W.net+=amt; W.w++; W.bets.push(Object.assign({ won:true, vs:l }, meta));
      L.net-=amt; L.l++; L.bets.push(Object.assign({ won:false, vs:win }, meta));
    });
  });

  var order=function(x,y){ return String(y.at||"").localeCompare(String(x.at||""))||(y.week-x.week); };
  Object.keys(byId).forEach(function(a){ Object.keys(byId[a]).forEach(function(b){
    byId[a][b].net=r2(byId[a][b].net);
    byId[a][b].bets.sort(order);
  }); });

  // one row per manager: their record across everyone
  var totals={};
  Object.keys(byId).forEach(function(a){
    var t={ net:0, w:0, l:0, beat:0, beatenBy:0 };
    Object.keys(byId[a]).forEach(function(b){
      var r=byId[a][b];
      t.net+=r.net; t.w+=r.w; t.l+=r.l;
      if(r.w) t.beat++;
      if(r.l) t.beatenBy++;
    });
    t.net=r2(t.net);
    totals[a]=t;
  });
  return { byId:byId, totals:totals, ids:ids };
}

// Each unordered pair once, richest rivalry first: how much has changed hands, and
// which way it leans. `a` is always the one who's up (or the first name on a tie).
export function rivalPairs(R){
  var seen={}, out=[];
  Object.keys(R.byId).forEach(function(a){ Object.keys(R.byId[a]).forEach(function(b){
    var key=[a,b].sort().join("|"); if(seen[key]) return; seen[key]=1;
    var r=R.byId[a][b], games=r.w+r.l; if(!games) return;
    var moved=r.bets.reduce(function(s,x){ return s+x.amount; },0);
    var up=r.net>=0?a:b, down=r.net>=0?b:a;
    out.push({ a:up, b:down, net:Math.abs(r.net), moved:r2(moved), games:games,
               w:R.byId[up][down].w, l:R.byId[up][down].l });
  }); });
  return out.sort(function(x,y){ return y.moved-x.moved||y.net-x.net; });
}

// The five lines beside the grid. Null where the season hasn't produced one yet.
export function rivalHighlights(R,bets,members){
  var pairs=rivalPairs(R), out={};
  out.rivalry=pairs[0]||null;
  out.lopsided=pairs.slice().sort(function(x,y){ return y.net-x.net; })[0]||null;
  if(out.lopsided&&!out.lopsided.net) out.lopsided=null;
  // most wins, and most losses; a tie goes to whoever has fewer of the other thing,
  // so the hammer and the nail don't end up being the same manager.
  var rank=function(key,other){
    var best=null;
    Object.keys(R.totals).forEach(function(id){
      var t=R.totals[id], v=t[key]; if(!v) return;
      if(!best||v>best.v||(v===best.v&&t[other]<best.other)) best={ id:id, v:v, other:t[other] };
    });
    return best;
  };
  out.hammer=rank("w","l"); out.nail=rank("l","w");
  var haul=null;
  (bets||[]).forEach(function(b){
    if(!b||b.status!=="settled"||!b.winner||b.winner==="push") return;
    var ents=entriesOf(b).filter(function(e){ return e.memberId; });
    var losers=ents.filter(function(e){ return e.memberId!==b.winner; }).length;
    if(!losers||!ents.some(function(e){ return e.memberId===b.winner; })) return;
    var pot=(Number(b.amount)||0)*losers;
    if(!haul||pot>haul.pot) haul={ pot:r2(pot), losers:losers, winner:b.winner, id:b.id,
                                   name:b.name||String(b.terms||"").slice(0,40), week:Number(b.week)||0 };
  });
  out.haul=haul;
  return out;
}

// The last few settled bets, as "X beat Y and Z".
export function rivalFeed(bets,n){
  var out=[];
  (bets||[]).forEach(function(b){
    if(!b||b.status!=="settled"||!b.winner||b.winner==="push") return;
    var ents=entriesOf(b).filter(function(e){ return e.memberId; });
    if(ents.length<2||!ents.some(function(e){ return e.memberId===b.winner; })) return;
    var losers=ents.filter(function(e){ return e.memberId!==b.winner; }).map(function(e){ return e.memberId; });
    if(!losers.length) return;
    out.push({ id:b.id, week:Number(b.week)||0, name:b.name||String(b.terms||"").slice(0,40),
               amount:Number(b.amount)||0, winner:b.winner, losers:losers,
               pot:r2((Number(b.amount)||0)*losers.length), at:b.settledAt||b.createdAt||"" });
  });
  out.sort(function(x,y){ return String(y.at||"").localeCompare(String(x.at||""))||(y.week-x.week); });
  return out.slice(0,n||5);
}
