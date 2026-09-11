// A bet's life: which game it is on, whether it can still be joined, who covered,
// and the auto-written names, terms and results.

import { entriesOf, shortName } from "./fmt.js?v=dev";
import { LAST_WEEK, allGames } from "./clock.js?v=dev";
import { mName } from "./identity.js?v=dev";

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
  return !!b&&!b.game&&b.joinable!==false&&(b.status==="open"||b.status==="active")&&!isFieldBet(b);
}

/* ---- settling without a button ----
   A game bet settles from the final score. A stat bet settles once every game of
   its period is final and the standings were refreshed after the last one ended;
   the leader on the tracked stat wins, a tie is a push, and a bet tracking several
   stats goes to whoever leads the most of them. Season bets run through LAST_WEEK.
   Returns null while there's nothing to decide yet. */

export const SETTLE_LAG=4*3600000;   // a game is over this long after kickoff; stats after that count

export function autoResult(b,games,now){
  if(!b||b.status!=="active") return null;
  var ents=entriesOf(b), owner=function(e){ return e&&e.memberId||null; };
  if(b.game){
    var g=gameOf(b,games);
    if(!g||g.status!=="final"||g.awayScore==null||g.homeScore==null) return null;
    var cv=coverSide(b,g);
    if(cv==="push") return { winner:"push", note:"Push · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore };
    var code=cv==="away"?b.game.away:cv==="home"?b.game.home:cv;   // "over"/"under" as-is
    var hit=null; ents.forEach(function(e){ if(!hit&&e.memberId&&e.side===code) hit=e; });
    return hit?{ winner:hit.memberId, note:"Final · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore }:null;
  }
  var S=b.stats; if(!S||!Array.isArray(S.rows)||S.rows.length<2) return null;
  var w=Number(b.week)||0, through=w||LAST_WEEK;
  var slate=allGames(games).filter(function(x){ return x.week===through; });
  if(!slate.length||slate.some(function(x){ return x.status!=="final"; })) return null;
  var lastKick=0; slate.forEach(function(x){ var t=Date.parse(x.date); if(t>lastKick) lastKick=t; });
  var fresh=Date.parse(S.updatedAt||"");
  if(isNaN(fresh)||fresh<lastKick+SETTLE_LAG||(now||Date.now())<lastKick+SETTLE_LAG) return null;
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, lower:S.lower }];
  var wins={};
  tracks.forEach(function(t){
    var best=null, leaders=[];
    S.rows.forEach(function(r){
      var v=Number((r.values&&t.stat in r.values)?r.values[t.stat]:r.value)||0;
      var who=r.memberId||owner(ents[r.entry]); if(!who) return;
      if(best===null||(t.lower?v<best:v>best)){ best=v; leaders=[who]; } else if(v===best&&leaders.indexOf(who)<0) leaders.push(who);
    });
    if(leaders.length===1) wins[leaders[0]]=(wins[leaders[0]]||0)+1;
  });
  var top=0, tops=[];
  Object.keys(wins).forEach(function(id){ if(wins[id]>top){ top=wins[id]; tops=[id]; } else if(wins[id]===top) tops.push(id); });
  var period=w?"Week "+w:"Season";
  if(tops.length!==1) return { winner:"push", note:period+" complete · tied" };
  return { winner:tops[0], note:period+" complete · "+(S.through||"") };
}

/* ---- auto-written names and terms ---- */

export function autoTerms(scope,tracks,week,entries,members){
  var names=(tracks||[]).map(function(t){ return String(t.metric||t.stat||"").replace(/ · combined$/,""); });
  var lc=function(s){ return s.charAt(0).toLowerCase()+s.slice(1); };
  var what;
  if(names.length>1){
    // several stats: name them plainly; "most"/"fewest" would misread across the list
    var list=names.map(lc); list[0]=names[0];
    what=list.slice(0,-1).join(", ")+" and "+list[list.length-1]+" (each its own standings)";
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
