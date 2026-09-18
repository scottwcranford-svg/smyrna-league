// A bet's life: which game it is on, whether it can still be joined, who covered,
// and the auto-written names, terms and results.

import { entriesOf, shortName } from "./fmt.js?v=dev";
import { LAST_WEEK, PLAYOFF_START, allGames } from "./clock.js?v=dev";
import { mName } from "./identity.js?v=dev";

/* ---- league result bets ----
   A bet on what a manager's own team does in the Smyrna League, settled by Sleeper rather
   than by NFL stats: b.league = { subject: memberId, outcome }. Two sides, yes and no,
   one seat each, nobody joins, and no push - Sleeper's own tiebreakers decide everything.
   Season-long only for now (week 0); the outcome list is where a weekly one would go. */
export const LEAGUE_OUTCOMES=[
  { key:"playoffs", label:"Makes the playoffs", yes:"Makes it", no:"Misses", week:0,
    name:function(who){ return who+" makes the playoffs"; },
    terms:"Makes it vs Misses — Sleeper's playoff bracket decides it once the regular season is over." }
];
export function leagueOutcome(key){ var hit=null; LEAGUE_OUTCOMES.forEach(function(o){ if(o.key===key) hit=o; }); return hit; }
export function leagueSideText(side,key){ var o=leagueOutcome(key); return o?(side==="yes"?o.yes:side==="no"?o.no:""):""; }
export function leagueName(subject,key,members){ var o=leagueOutcome(key); return o?o.name(mName(subject,members)):""; }
export function leagueTerms(key){ var o=leagueOutcome(key); return o?o.terms:""; }

// Where the subject's team stands, from league/standings (sleeper.js standingsTick): the
// rows in standing order with a rank on each, the subject's own, how many make the
// playoffs, and whether the subject is inside that line - as things stand until Sleeper
// seeds the bracket, then for good. Null until the book has standings with the subject in them.
export function leagueStanding(b,ST){
  if(!b||!b.league||!ST||!Array.isArray(ST.rows)||!ST.rows.length) return null;
  var rows=ST.rows.map(function(r,i){ return Object.assign({},r,{ rank:i+1 }); });
  var me=null; rows.forEach(function(r){ if(!me&&r.id&&r.id===b.league.subject) me=r; });
  if(!me) return null;
  var teams=Number(ST.teams)||6, PO=ST.playoffs||{};
  var decided=!!PO.complete&&Array.isArray(PO.field);
  return { rows:rows, me:me, teams:teams, decided:decided, inField:decided?PO.field.indexOf(me.id)>=0:me.rank<=teams };
}

/* ---- game bets ---- */

export function coverSide(b,g){
  if(!g||g.awayScore==null||g.homeScore==null) return null;
  var a=g.awayScore, h=g.homeScore;
  if(b.market==="total"){ var tot=a+h, ln=Number(b.line); return tot>ln?"over":tot<ln?"under":"push"; }
  if(b.market==="spread"){
    var favHome=(b.fav||b.game.home)===b.game.home, ln2=Number(b.line);
    var favPts=(favHome?h:a)-ln2, dogPts=favHome?a:h;
    return favPts>dogPts?(favHome?"home":"away"):favPts<dogPts?(favHome?"away":"home"):"push";
  }
  return a>h?"away":h>a?"home":"push";
}

// A game bet records where its number came from at the moment it was posted, because the
// published line moves during the week and "what Vegas says now" is not what was agreed.
// Older bets have no record, so they answer null rather than guessing.
export function lineOrigin(b){
  if(!b||!b.game||b.market==="ml"||b.line==null) return null;
  return b.lineSrc==="vegas"?"vegas":b.lineSrc==="own"?"own":null;
}
export function lineText(b){
  if(!b.game) return "";
  if(b.market==="spread") return (b.fav||b.game.home)+" −"+b.line;
  if(b.market==="total") return "O/U "+b.line;
  return "Straight up";
}

export function gameOf(b,games){
  if(!b||!b.game) return null;
  var G=allGames(games), hit=null;
  G.forEach(function(g){ if(!hit&&g.id===b.game.id) hit=g; });
  if(!hit) G.forEach(function(g){ if(!hit&&g.week===b.game.week&&g.away===b.game.away&&g.home===b.game.home) hit=g; });
  return hit||b.game;   // fall back to what the bet stored
}

/* ---- who can join ----
   A stat bet is open to joiners until it locks unless the proposer switched joining
   off, or it's a player-vs-the-field bet (sides with different player counts, set up
   on purpose). A game bet is two sides and never takes a third. */

function isFieldBet(b){
  var counts=[]; entriesOf(b).forEach(function(e){ var n=(e.picks||[]).length; if(n&&counts.indexOf(n)<0) counts.push(n); });
  return counts.length>1;
}

export function canJoin(b){
  return !!b&&!b.game&&!b.league&&b.joinable!==false&&(b.status==="open"||b.status==="active")&&!isFieldBet(b);
}

/* ---- matched sides ----
   A player bet says how alike its sides must be, in `b.match`:
     "count"   every side the same number of players, any positions
     "lineup"  every side the same number and the same positions (QB + WR vs QB + WR)
     "field"   one player against a field of exactly FIELD_SIZE, two sides, nobody joins
     "any"     no rule — not offered any more; it's what an older uneven bet plays by
   Bets from before the setting have no `match` and keep the old join rule: the same
   count as everyone else, unless the sides were already uneven. */
export const FIELD_SIZE=4;
export const MATCH_LEVELS=[["count","Same number of players"],["lineup","Same number and positions"],["field","One player vs a field of "+FIELD_SIZE]];
export const ANY_LEVEL=["any","Any lineup"];
var POS_ORDER={ QB:0, RB:1, WR:2, TE:3, K:4 };

// A side's positions in lineup order: ["QB","WR","WR"].
export function lineupOf(picks){
  return (picks||[]).map(function(p){ return String(p.pos||""); })
    .sort(function(a,b){ var ra=POS_ORDER[a], rb=POS_ORDER[b]; return ((ra==null?5:ra)-(rb==null?5:rb))||a.localeCompare(b); });
}
// "QB + 2 WR"
export function lineupText(picks){
  var n={}, order=[];
  lineupOf(picks).forEach(function(p){ if(!n[p]){ n[p]=0; order.push(p); } n[p]++; });
  return order.map(function(p){ return (n[p]>1?n[p]+" ":"")+p; }).join(" + ");
}
function plural(n){ return n+(n===1?" player":" players"); }

// What's wrong with a side against the side it has to match, or "".
function mismatch(match,picks,ref){
  if(match==="count"&&picks.length!==ref.length) return "Pick "+plural(ref.length)+", same as the other side";
  if(match==="lineup"&&lineupOf(picks).join()!==lineupOf(ref).join()) return "Pick "+lineupText(ref)+", same as the other side";
  return "";
}
// Every side the proposer filled in, held to the bet's level; "" when they fit.
export function sidesProblem(match,entries){
  var sides=(entries||[]).map(function(e){ return e.picks||[]; }).filter(function(p){ return p.length; });
  if(match==="field"){
    var n=sides.map(function(p){ return p.length; }).sort(function(a,b){ return a-b; });
    return (sides.length===2&&(entries||[]).length===2&&n[0]===1&&n[1]===FIELD_SIZE)?"":"Player vs the field is two sides: one player, and a field of "+FIELD_SIZE;
  }
  if(match!=="count"&&match!=="lineup") return "";
  for(var i=1;i<sides.length;i++){ var m=mismatch(match,sides[i],sides[0]); if(m) return m; }
  return "";
}
// The level a bet actually plays by: its own, or for an older bet the rule it always had.
export function matchLevel(b){
  if(b&&(b.match==="any"||b.match==="count"||b.match==="lineup"||b.match==="field")) return b.match;
  return b&&isFieldBet(b)?"any":"count";
}
function refSide(b){ var ref=null; entriesOf(b).forEach(function(e){ if(!ref&&(e.picks||[]).length) ref=e.picks; }); return ref; }
// A joiner's picks against the bet; "" when they fit.
export function joinProblem(b,picks){
  var ref=refSide(b), m=matchLevel(b);
  if(!ref||m==="field") return "";
  var msg=mismatch(m,picks||[],ref);
  return msg?msg.replace("the other side","everyone else on this bet"):"";
}
// Positions a joiner still needs on a lineup bet, as counts ({ QB:1, WR:1 }), or null
// when any position will do.
export function positionsNeeded(b,picks){
  var ref=refSide(b);
  if(!ref||matchLevel(b)!=="lineup") return null;
  var need={};
  ref.forEach(function(p){ need[p.pos]=(need[p.pos]||0)+1; });
  (picks||[]).forEach(function(p){ if(need[p.pos]) need[p.pos]--; });
  return need;
}
// What the ticket says about it: "2 players each", "QB + WR each"; "" for no rule.
export function matchLabel(b){
  if(!b||b.game||!b.stats||b.stats.scope!=="player"||!b.match) return "";
  var ref=refSide(b); if(!ref) return "";
  if(b.match==="count") return plural(ref.length)+" each";
  if(b.match==="lineup") return lineupText(ref)+" each";
  if(b.match==="field") return "1 vs a field of "+FIELD_SIZE;
  return "";
}

/* ---- settling without a button ----
   A game bet settles from the final score. A stat bet settles once every game of
   its period is final and the standings were refreshed after the last one ended;
   the leader on the tracked stat wins, a tie is a push, and a bet tracking several
   stats goes to whoever leads the most of them. Season bets run through LAST_WEEK.
   Returns null while there's nothing to decide yet. */

export const SETTLE_LAG=4*3600000;   // a game is over this long after kickoff; stats after that count

export function autoResult(b,games,now,standings){
  if(!b||b.status!=="active") return null;
  var ents=entriesOf(b), owner=function(e){ return e&&e.memberId||null; };
  var sideWins=function(code,note){
    var hit=null; ents.forEach(function(e){ if(!hit&&e.memberId&&e.side===code) hit=e; });
    return hit?{ winner:hit.memberId, note:note }:null;
  };
  if(b.league){
    // Sleeper seeds the bracket with its own tiebreakers; the field is read from it, never
    // worked out from the records. Waits until the book's own schedule agrees the regular
    // season is over, and leaves a team the standings don't know to be settled by hand.
    var L=b.league, ST=standings||null, PO=ST&&ST.playoffs;
    if(L.outcome!=="playoffs"||!PO||!PO.complete||!Array.isArray(PO.field)) return null;
    var lastReg=(Number(ST.playoffStart)||PLAYOFF_START)-1;
    var reg=allGames(games).filter(function(x){ return x.week===lastReg; });
    if(!reg.length||reg.some(function(x){ return x.status!=="final"; })) return null;
    if(!(ST.rows||[]).some(function(r){ return r.id&&r.id===L.subject; })) return null;
    var made=PO.field.indexOf(L.subject)>=0;
    return sideWins(made?"yes":"no","Regular season over · "+(made?"in the playoff field":"out of the playoff field"));
  }
  if(b.game){
    var g=gameOf(b,games);
    if(!g||g.status!=="final"||g.awayScore==null||g.homeScore==null) return null;
    var cv=coverSide(b,g);
    if(cv==="push") return { winner:"push", note:"Push · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore };
    var code=cv==="away"?b.game.away:cv==="home"?b.game.home:cv;   // "over"/"under" as-is
    return sideWins(code,"Final · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore);
  }
  var S=b.stats; if(!S||!Array.isArray(S.rows)||S.rows.length<2) return null;
  var w=Number(b.week)||0, through=w||LAST_WEEK;
  var slate=allGames(games).filter(function(x){ return x.week===through; });
  if(!slate.length||slate.some(function(x){ return x.status!=="final"; })) return null;
  var lastKick=0; slate.forEach(function(x){ var t=Date.parse(x.date); if(t>lastKick) lastKick=t; });
  var fresh=Date.parse(S.updatedAt||"");
  if(isNaN(fresh)||fresh<lastKick+SETTLE_LAG||(now||Date.now())<lastKick+SETTLE_LAG) return null;
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, lower:S.lower }];
  var wins={}, firstLeaders=null;
  tracks.forEach(function(t,ti){
    var best=null, leaders=[];
    S.rows.forEach(function(r){
      var v=Number((r.values&&t.stat in r.values)?r.values[t.stat]:r.value)||0;
      var who=r.memberId||owner(ents[r.entry]); if(!who) return;
      if(best===null||(t.lower?v<best:v>best)){ best=v; leaders=[who]; } else if(v===best&&leaders.indexOf(who)<0) leaders.push(who);
    });
    if(ti===0) firstLeaders=leaders;
    if(leaders.length===1) wins[leaders[0]]=(wins[leaders[0]]||0)+1;
  });
  var top=0, tops=[];
  Object.keys(wins).forEach(function(id){ if(wins[id]>top){ top=wins[id]; tops=[id]; } else if(wins[id]===top) tops.push(id); });
  var period=w?"Week "+w:"Season";
  // A bet posted with the tiebreaker (every stat bet since it existed): when the stats won
  // are level, the first stat decides it - if its leader is one of those level.
  if(tops.length>1&&b.tiebreak&&tracks.length>1&&firstLeaders&&firstLeaders.length===1&&tops.indexOf(firstLeaders[0])>=0)
    return { winner:firstLeaders[0], note:period+" complete · level on stats, "+String(tracks[0].metric||tracks[0].stat||"the first stat").replace(/ · (combined|best of each side)$/,"")+" decided it" };
  if(tops.length!==1) return { winner:"push", note:period+" complete · tied" };
  return { winner:tops[0], note:period+" complete · "+(S.through||"") };
}

/* ---- how a bet is scored, in plain words ----
   A few sentences for every kind of bet, shown on its ticket, in the propose form as it's
   filled in, and in the Join dialog. It reads the same fields autoResult settles on, so
   what it says is what happens. */
function fmtLine(n){ n=Number(n); return isNaN(n)?"":String(n); }
// the stat by its short name: "Takeaways · INT + fumble recoveries" and "PPR points · combined" read as the part before the dot
function statName(t){ return String((t&&(t.metric||t.stat))||"the stat").split(" · ")[0]; }
function lower1(s){ return /^[A-Z]{2}/.test(s)?s:s.charAt(0).toLowerCase()+s.slice(1); }   // "PPR points" keeps its capitals
// A field side: one row per player sharing a seat, or a bet set up as one.
function fieldSide(b){
  if(b&&b.match==="field") return true;
  var seen={}, dup=false;
  ((b&&b.stats&&b.stats.rows)||[]).forEach(function(r){ var k=r.entry!=null?"e"+r.entry:null; if(k){ if(seen[k]) dup=true; seen[k]=1; } });
  return dup;
}
export function scoringText(b){
  if(!b) return "";
  if(b.league){
    var o=leagueOutcome(b.league.outcome);
    if(!o) return "Settled by hand: the result is recorded once it's decided.";
    return "If the team is in Sleeper's playoff field when the regular season ends after Week "+(PLAYOFF_START-1)+", "+o.yes+" wins; otherwise "+o.no+" does. "+
      "Sleeper's own tiebreakers seed the bracket, so there's no push. Settles once the bracket is set.";
  }
  if(b.game){
    var g=b.game, ln=fmtLine(b.line);
    if(b.market==="total") return "Both teams' final points are added together. Over "+ln+" wins if the total is higher, Under if it's lower. Exactly "+ln+" is a push.";
    if(b.market==="spread"&&Number(b.line)>0){
      var fav=b.fav||g.home, dog=fav===g.home?g.away:g.home;
      return fav+" has to win by more than "+ln+" to cover; anything else and "+dog+" covers. "+fav+" winning by exactly "+ln+" is a push.";
    }
    return "Whoever wins the game takes it. A tie is a push.";
  }
  var S=b.stats;
  if(!S||!S.scope) return "Settled by hand: the result is recorded once it's decided.";
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, metric:S.metric, lower:S.lower }];
  var w=Number(b.week)||0, period=w?"in Week "+w:"over the whole season";
  var ents=entriesOf(b), field=fieldSide(b);
  var who=S.scope==="team"?"defense":S.scope==="offense"?"team":"player";
  var side=field?"The field counts only its best "+who+". "
    :ents.some(function(e){ return (e.picks||[]).length>1; })?"A side's "+who+"s are added together. ":"";
  // only where more can still come in, or already have
  var pot=(!field&&(canJoin(b)||ents.length>2))?"However many join, the one leader takes every stake. ":"";
  var out;
  if(tracks.length===1){
    var t=tracks[0];
    out=(t.lower?"Fewest ":"Most ")+lower1(statName(t))+" "+period+" wins. "+side+pot+"A tie for the top is a push.";
  } else {
    var names=tracks.map(function(x){ return lower1(statName(x))+(x.lower?" (fewest wins)":""); });
    out="Each stat is its own contest "+period+": "+names.slice(0,-1).join(", ")+" and "+names[names.length-1]+". Whoever wins more of them takes it. "+side+pot+
      "A stat that ends tied counts for nobody. "+(b.tiebreak?"If the stats won are level, the first one listed ("+lower1(statName(tracks[0]))+") decides it; if that's tied too, it's a push.":"If the stats won are level, it's a push.");
  }
  return out+" Settles once every game "+(w?"that week":"through Week "+LAST_WEEK)+" is final.";
}

/* ---- auto-written names and terms ---- */

export function autoTerms(scope,tracks,week,entries,members){
  var names=(tracks||[]).map(function(t){ return String(t.metric||t.stat||"").replace(/ · combined$/,""); });
  var lc=function(s){ return s.charAt(0).toLowerCase()+s.slice(1); };
  var what;
  if(names.length>1){
    // several stats: name them plainly; "most"/"fewest" would misread across the list
    var list=names.map(lc); list[0]=names[0];
    what=list.slice(0,-1).join(", ")+" and "+list[list.length-1]+" (most stats won takes it)";
  } else what=((tracks[0]&&tracks[0].lower)?"Fewest ":"Most ")+lc(names[0]||"");
  var when=Number(week)?" in Week "+Number(week):" on the season";
  var sides=(entries||[]).map(function(e){
    var picks=e.picks||[];
    if(picks.length) return picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + ");
    if(e.pick) return e.pick;
    return e.memberId?mName(e.memberId,members):"an open seat";
  });
  // one side so far: the proposal stands against whoever joins
  return what+when+(sides.length===1?" — "+sides[0]+" vs the field":sides.length?" — "+sides.join(" vs "):"")+".";
}

export function autoName(tracks,week,entries){
  var sides=(entries||[]).map(function(e){
    var picks=e.picks||[];
    if(picks.length) return picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + ");
    return e.pick||"";
  }).filter(Boolean);
  if(sides.length===2&&(entries||[]).length===2) return sides[0]+" vs "+sides[1];
  var m=String((tracks&&tracks[0]&&(tracks[0].metric||tracks[0].stat))||"Stat").replace(/ · combined$/,"");
  return m+(Number(week)?" · Week "+Number(week):" · Season")+((entries||[]).length>2?" pot":"");
}
