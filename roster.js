// The Sleeper roster as the app reads it: player rows, injury status, team names
// and the picker search. Imports nothing.

export const FANTASY_POS = {QB:1,RB:1,WR:1,TE:1,K:1};
export const SLEEPER_LEAGUE_ID="1314265150127116288";   // the Smyrna League on Sleeper (league/config.sleeperLeagueId overrides)

/* ---- stats ---- */

// "2026 · 10-Team Keeper SF PPR", from the Sleeper league's settings; the season alone without them.
export function leagueLine(league,season){
  var parts=[];
  var yr=(league&&league.season)||season; if(yr) parts.push(String(yr));
  if(league&&league.teams){
    var d=[league.teams+"-Team"];
    if(league.dynasty) d.push("Dynasty"); else if(league.keeper) d.push("Keeper");
    if(league.sf) d.push("SF");
    if(league.scoring) d.push(league.scoring);
    parts.push(d.join(" "));
  }
  return parts.join(" · ");
}
export function scoringName(rec){ var r=Number(rec); return isNaN(r)?"":r>=1?"PPR":r>0?"Half PPR":"Standard"; }

/* ---- roster (Sleeper players + defenses): rows are [id, name, pos, team] ---- */

export function rosterRows(roster){ return (roster&&Array.isArray(roster.players))?roster.players:[]; }

/* ---- player status ----
   A roster row's fifth slot is a short status code from Sleeper, present only when
   the player isn't simply active. Injury designations first, then the roster status. */
export const STATUS_LABEL={ Q:"Questionable", D:"Doubtful", OUT:"Out", IR:"Injured reserve", PUP:"Physically unable to perform",
  SUS:"Suspended", COV:"COVID list", NA:"Not active", DNR:"Did not report", INA:"Inactive", PS:"Practice squad" };
var INJURY={ questionable:"Q", doubtful:"D", out:"OUT", ir:"IR", pup:"PUP", sus:"SUS", cov:"COV", na:"NA", dnr:"DNR" };
var ROSTER_STATUS={ "injured reserve":"IR", "physically unable to perform":"PUP", "practice squad":"PS", inactive:"INA" };
export function statusCode(v){
  if(!v) return "";
  var inj=String(v.injury_status||"").trim().toLowerCase();
  if(inj&&INJURY[inj]) return INJURY[inj];
  var st=String(v.status||"").trim().toLowerCase();
  if(!st||st==="active") return "";
  return ROSTER_STATUS[st]||"";
}
// Status codes for a pick id ("a", or "a+b" for a combined pick), from the current roster.
export function statusOf(id,roster){
  var out=[];
  String(id||"").split("+").forEach(function(k){ var r=rosterFind(k.trim(),roster); var c=r&&r[4]; if(c&&out.indexOf(c)<0) out.push(c); });
  return out;
}
export function rosterFind(id,roster){ var rows=rosterRows(roster); for(var i=0;i<rows.length;i++){ if(rows[i][0]===id) return rows[i]; } return null; }

export function teamName(code,roster){
  var rows=rosterRows(roster);
  for(var i=0;i<rows.length;i++){ if(rows[i][2]==="DEF"&&rows[i][0]===code) return rows[i][1]; }
  return code;
}

export function rosterSearch(q,scope,roster){
  q=String(q||"").trim().toLowerCase(); if(q.length<2) return [];
  var out=[], rows=rosterRows(roster);
  for(var i=0;i<rows.length&&out.length<8;i++){
    var r=rows[i], isDef=r[2]==="DEF";
    if(scope==="team"?!isDef:isDef) continue;
    var hay=(r[1]+" "+r[3]).toLowerCase();
    if(hay.indexOf(q)>=0) out.push(r);
  }
  return out;
}
