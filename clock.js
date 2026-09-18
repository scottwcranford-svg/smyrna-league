// Kickoff locks and week math. A bet locks five minutes before its game — a game
// bet's own, a weekly stat bet's picks' first, otherwise the week's first (season
// bets: the opener); `config.weekStarts` carries the real schedule and the anchor
// cadence is the fallback. Imports nothing.


export const PLAYOFF_START = 15, LAST_WEEK = 17;

export const DEFAULT_KICKOFF="2026-09-10T00:20:00Z";   // the opener: Wed Sep 9 2026, 8:20 PM ET (Seattle)
const WEEK_ANCHOR="2026-09-11T00:15:00Z";       // Week 1's Thursday, 8:15 PM ET — weeks 2+ lock on that cadence
export const LOCK_LEAD=5*60*1000;                      // bets lock five minutes before kickoff

export function isPlayoff(w){ return Number(w)>=PLAYOFF_START; }

/* ---- kickoff locks ----
   Every bet locks five minutes before a kickoff — see betLock for which one.
   `config.weekStarts` carries the real schedule; the anchor cadence is the fallback. */

function kickoffTime(config){ var t=Date.parse((config&&config.kickoff)||DEFAULT_KICKOFF); return isNaN(t)?Date.parse(DEFAULT_KICKOFF):t; }

function firstGame(week,config){
  week=Number(week)||0;
  var ws=config&&config.weekStarts;
  var key=String(week<=1?1:week);
  if(ws&&ws[key]){ var t=Date.parse(ws[key]); if(!isNaN(t)) return t; }
  if(week<=1) return kickoffTime(config);
  return Date.parse(WEEK_ANCHOR)+(week-1)*7*86400000;
}

export function lockTime(week,config){ return firstGame(week,config)-LOCK_LEAD; }

// A season-long league result bet (bets.js) locks at the opener like any season bet. The
// type arrived in week 2 of 2026, so for that season alone it locks at week 3's first
// kickoff - the managers agreed to an end-of-week-2 cutoff. Delete the entry after 2026.
// An untagged bet is 2026 (seasons.js).
const LEAGUE_LOCK_WEEK={ "2026":3 };
export function leagueLockWeek(b){ return LEAGUE_LOCK_WEEK[String((b&&b.season)||"2026")]||0; }

// A game bet locks on its game. A weekly stat bet locks on the first game any of its
// picks plays in, so it stays open through the week while nobody on it has started —
// and nobody joins knowing how a pick already on it did. Without the schedule (or a
// pick's game in it) it falls back to the week's first game. Season bets: the opener,
// except a league result bet in a season that had a later cutoff (leagueLockWeek).
export function betLock(b,config,games){
  if(b&&b.game&&b.game.date){ var t=Date.parse(b.game.date); if(!isNaN(t)) return t-LOCK_LEAD; }
  var week=b?Number(b.week)||0:0;
  if(b&&b.league&&!week) return lockTime(leagueLockWeek(b),config);
  if(week&&games){
    var first=Infinity, found=true, any=false;
    (Array.isArray(b.entries)?b.entries:[]).forEach(function(e){ (e.picks||[]).forEach(function(p){
      any=true;
      var k=kickoffOf(p.team,week,games);
      if(isNaN(k)) found=false; else if(k<first) first=k;
    }); });
    if(any&&found) return first-LOCK_LEAD;
  }
  return lockTime(week,config);
}

export function weekLocked(week,config){ return Date.now()>=lockTime(week,config); }

export function isLocked(b,config,games){ return (b.status==="open"||b.status==="active")&&Date.now()>=betLock(b,config,games); }

// When a team's game in a week kicks off, or NaN if the schedule doesn't have one.
function kickoffOf(team,week,games){
  var w=Number(week)||0, t=NaN;
  allGames(games).forEach(function(g){ if(Number(g.week)===w&&(g.away===team||g.home===team)) t=Date.parse(g.date||""); });
  return t;
}
// A game that's under way or over, or inside the five minutes before kickoff —
// the same line a game bet locks on.
export function gameStarted(g,now){
  if(!g) return false;
  if(g.status==="live"||g.status==="final") return true;
  var t=Date.parse(g.date||"");
  return !isNaN(t)&&(now||Date.now())>=t-LOCK_LEAD;
}
// Teams whose game in a week has started, as a set. Empty for season-long bets and
// before the schedule has loaded.
export function teamsStarted(week,games,now){
  var w=Number(week)||0, out={};
  if(!w) return out;
  allGames(games).forEach(function(g){ if(Number(g.week)===w&&gameStarted(g,now)){ out[g.away]=1; out[g.home]=1; } });
  return out;
}

export function currentWeek(config,games){
  var now=Date.now(), w=1;
  for(var i=1;i<=18;i++){ if(now>=firstGame(i,config)-LOCK_LEAD) w=i; }
  // once a week's last game is comfortably over, roll to the next
  var G=allGames(games), last=0;
  G.forEach(function(g){ if(g.week===w){ var t=Date.parse(g.date); if(t>last) last=t; } });
  if(last&&now>last+5*3600000&&w<18) w++;
  return w;
}
export const SOON_LEAD=60*60*1000;   // a game reads as "about to start" an hour out

// A game that hasn't kicked off but is about to. Live and final games are never
// "soon", however their date reads, and a game with no date can't be judged.
export function kicksSoon(g,now){
  if(!g||g.status==="live"||g.status==="final") return false;
  if(g.awayScore!=null&&g.homeScore!=null) return false;
  var t=Date.parse(g.date||"");
  if(isNaN(t)) return false;
  now=now||Date.now();
  return t>now&&t-now<=SOON_LEAD;
}

// Kickoff order. The schedule feed arrives in its own order — Monday night can sit
// above Sunday afternoon — so anything listing a slate sorts through here. Undated
// games go last, and same-kickoff games break on the matchup so two renders of the
// same slate never disagree.
export function byKickoff(a,b){
  var ta=Date.parse((a&&a.date)||""), tb=Date.parse((b&&b.date)||"");
  if(isNaN(ta)&&isNaN(tb)) return String((a&&a.id)||"").localeCompare(String((b&&b.id)||""));
  if(isNaN(ta)) return 1;
  if(isNaN(tb)) return -1;
  if(ta!==tb) return ta-tb;
  return String((a.away||"")+(a.home||"")).localeCompare(String((b.away||"")+(b.home||"")));
}

// Weeks whose games are all final (and that have games at all).
export function finalWeeks(games){
  var G=allGames(games), by={};
  G.forEach(function(g){ var w=Number(g.week); if(!by[w]) by[w]={ n:0, done:0 }; by[w].n++; if(g.status==="final") by[w].done++; });
  return Object.keys(by).map(Number).filter(function(w){ return by[w].n>0&&by[w].done===by[w].n; }).sort(function(a,b){ return a-b; });
}

export function allGames(games){ return (games&&Array.isArray(games.games))?games.games:[]; }

// Teams with a game in a week, as a set. Empty when that week's schedule isn't
// known — season-long bets, the playoffs, or before the schedule has loaded — and
// an empty set filters nobody.
export function teamsPlaying(week,games){
  var w=Number(week)||0, out={};
  if(!w) return out;
  allGames(games).forEach(function(g){ if(Number(g.week)===w){ out[g.away]=1; out[g.home]=1; } });
  return out;
}
// A roster row or a pick whose team sits out the week. `team` is the team code.
export function onBye(team,playing){
  var any=false; for(var k in playing){ any=true; break; }
  return any&&!playing[team];
}
