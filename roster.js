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

/* ---- the picker search ----
   A player search has three parts: a team, a position and a name. A player shows when
   he matches every part that is set; the name only ever matches the name, so "den"
   finds Denzel Mims, never "the Broncos". With a team or position picked the name can
   be blank and the list is everyone who fits; without, it takes two letters and stops
   at eight. A defense search (scope "team") is the name box alone, and matches the
   team code too, so "kc" finds the Chiefs.
   opts: { team, pos, keep(row) → false hides a row, score(row) → a number, higher first }.
   Hidden rows never count toward a cap, so they can't push a real match off the list. */
export const LIST_CAP=8, POS_CAP=40;
export const POS_ORDER={ QB:0, RB:1, WR:2, TE:3, K:4 };
var SIDELINED={ OUT:1, IR:1, PUP:1, SUS:1, COV:1, NA:1, DNR:1, INA:1, PS:1 };
export function posRank(pos){ var p=POS_ORDER[pos]; return p==null?5:p; }

export function rosterSearch(q,scope,roster,opts){
  opts=opts||{};
  q=String(q||"").trim().toLowerCase();
  var def=scope==="team"||scope==="offense", team=def?"":String(opts.team||""), pos=def?"":String(opts.pos||"");   // an offense pick is a team too
  var filtered=!!(team||pos);
  if(!filtered&&q.length<2) return [];
  var out=[];
  rosterRows(roster).forEach(function(r){
    if(def?r[2]!=="DEF":r[2]==="DEF") return;
    if(team&&r[3]!==team) return;
    if(pos&&r[2]!==pos) return;
    if(q&&(def?(r[1]+" "+r[3]):r[1]).toLowerCase().indexOf(q)<0) return;
    if(opts.keep&&!opts.keep(r)) return;
    out.push(r);
  });
  // A whole team reads like a depth chart, position by position. Otherwise the best
  // projection leads. Within either, anyone sidelined (IR, out, practice squad…) sinks,
  // then it's by name.
  var score=opts.score||function(){ return 0; }, byPos=!!team&&!pos;
  out.sort(function(a,b){
    return (byPos?posRank(a[2])-posRank(b[2]):0)||(score(b)-score(a))||
      ((SIDELINED[a[4]]?1:0)-(SIDELINED[b[4]]?1:0))||String(a[1]).localeCompare(String(b[1]));
  });
  return team?out:out.slice(0,filtered?POS_CAP:LIST_CAP);
}
// The teams on the roster, as codes, alphabetical — the Team filter's list.
export function rosterTeams(roster){
  var seen={};
  rosterRows(roster).forEach(function(r){ if(r[2]!=="DEF"&&r[3]) seen[r[3]]=1; });
  return Object.keys(seen).sort();
}
