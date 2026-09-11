// Kickoff locks and week math. Every bet locks five minutes before the first game
// of its week (season bets: the opener); `config.weekStarts` carries the real
// schedule and the anchor cadence is the fallback. Imports nothing.


export const PLAYOFF_START = 15, LAST_WEEK = 17;

export const DEFAULT_KICKOFF="2026-09-10T00:20:00Z";   // the opener: Wed Sep 9 2026, 8:20 PM ET (Seattle)
const WEEK_ANCHOR="2026-09-11T00:15:00Z";       // Week 1's Thursday, 8:15 PM ET — weeks 2+ lock on that cadence
export const LOCK_LEAD=5*60*1000;                      // bets lock five minutes before the week's first game

export function isPlayoff(w){ return Number(w)>=PLAYOFF_START; }

/* ---- kickoff locks ----
   Every bet locks five minutes before the first game of its week (season bets: the opener).
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

export function betLock(b,config){
  if(b&&b.game&&b.game.date){ var t=Date.parse(b.game.date); if(!isNaN(t)) return t-LOCK_LEAD; }
  return lockTime(b?b.week:0,config);
}

export function weekLocked(week,config){ return Date.now()>=lockTime(week,config); }

export function isLocked(b,config){ return (b.status==="open"||b.status==="active")&&Date.now()>=betLock(b,config); }

export function currentWeek(config,games){
  var now=Date.now(), w=1;
  for(var i=1;i<=18;i++){ if(now>=firstGame(i,config)-LOCK_LEAD) w=i; }
  // once a week's last game is comfortably over, roll to the next
  var G=allGames(games), last=0;
  G.forEach(function(g){ if(g.week===w){ var t=Date.parse(g.date); if(t>last) last=t; } });
  if(last&&now>last+5*3600000&&w<18) w++;
  return w;
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
