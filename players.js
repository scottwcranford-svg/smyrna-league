// Each player's season so far, for the Draft board: fantasy points through the last
// finished week, what Sleeper projected for those same weeks, and where the points rank
// at the player's position. Pure: sleeper.js hands it the feeds and writes the result to
// league/players; render.js reads it back.
//
// league/players = { bySeason: { "2026": { through, field, rows, proj } } }
//   through  the last week of an unbroken run of finished weeks (1..through all final)
//   field    pts_ppr, pts_half_ppr or pts_std - the league's own scoring
//   rows     JSON text of { pid: [points, projected, "RB4"] } (text: Firestore forbids nested arrays)
//   proj     { "1": JSON text of { pid: projected points } } - one per finished week, fetched
//            once and kept: a played week's projection doesn't change, and each is ~500KB
//            raw, so refetching every week every hour would be a waste

// The points field for the league's scoring, as league/sleeper names it.
export function fieldFor(scoring){
  return scoring==="Half PPR"?"pts_half_ppr":scoring==="Standard"?"pts_std":"pts_ppr";
}

// The last week of the unbroken run from week 1 that's all final: [1,2,4] → 2.
export function finalThrough(finals){
  var have={}; (finals||[]).forEach(function(w){ have[Number(w)]=1; });
  var w=0; while(have[w+1]) w++;
  return w;
}

var r1=function(n){ return Math.round(n*10)/10; };

// One week's feed trimmed to the players we know and the one field: { pid: points }.
export function weekPoints(raw,ids,field){
  var out={};
  if(!raw||typeof raw!=="object") return out;
  (ids||[]).forEach(function(id){ var v=raw[id]; var n=v&&Number(v[field]); if(n) out[id]=r1(n); });
  return out;
}

// { pid: [points, projected, rank] } for everyone on the roster rows ([id, name, pos, team])
// who scored or was projected to. Rank is by total points at the position; a player on
// zero hasn't earned one, and ties share it.
export function seasonRows(actualWeeks,projWeeks,rosterRows,field){
  var pts={}, proj={};
  (actualWeeks||[]).forEach(function(d){ Object.keys(d||{}).forEach(function(pid){ var v=d[pid]; var n=v&&Number(v[field]); if(n) pts[pid]=(pts[pid]||0)+n; }); });
  (projWeeks||[]).forEach(function(d){ Object.keys(d||{}).forEach(function(pid){ var n=Number(d[pid]); if(n) proj[pid]=(proj[pid]||0)+n; }); });
  var byPos={}, out={};
  (rosterRows||[]).forEach(function(r){
    var id=r[0], p=r1(pts[id]||0), q=r1(proj[id]||0);
    if(!p&&!q) return;
    out[id]=[p,q,""];
    if(p) (byPos[r[2]]=byPos[r[2]]||[]).push([id,p]);
  });
  Object.keys(byPos).forEach(function(pos){
    var list=byPos[pos].sort(function(a,b){ return b[1]-a[1]; });
    list.forEach(function(x,i){ var rank=(i>0&&list[i-1][1]===x[1])?Number(out[list[i-1][0]][2].slice(pos.length)):i+1; out[x[0]][2]=pos+rank; });
  });
  return out;
}

// Better or worse than projected so far: "up" past 10% over, "down" past 10% under, else "".
export const TREND_BAND=0.10;
export function trend(points,projected){
  if(!(projected>0)) return "";
  var d=(points-projected)/projected;
  return d>TREND_BAND?"up":d<-TREND_BAND?"down":"";
}

// Where a drafted player is now, against the manager who drafted him: "" still there,
// otherwise the roster id that has him, or "dropped" when nobody does.
export function whereNow(pid,draftRoster,squads){
  var R=squads&&squads.rosters;
  if(!pid||!R) return "";
  if((R[String(draftRoster)]||[]).indexOf(pid)>=0) return "";
  var now=Object.keys(R).filter(function(rid){ return (R[rid]||[]).indexOf(pid)>=0; })[0];
  return now||"dropped";
}

var parsed=[null,null];
export function rowsOf(season){
  var s=season&&season.rows;
  if(!s) return null;
  if(parsed[0]===s) return parsed[1];
  var v=null; try{ v=JSON.parse(s); }catch(e){ v=null; }
  parsed=[s,v];
  return v;
}
