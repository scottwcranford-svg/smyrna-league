// The one shared state object, and the single way to ask for a redraw. Modules
// mutate `state` and call touch(); the next microtask draws once, however many
// callers asked. app.js registers the drawing function at boot.

import * as Sn from "./seasons.js?v=dev";

export const state = {
  db:null, connected:false, ready:false, local:true,
  // `isAdmin` is who you are; `admin` is whether the admin controls are showing right now
  config:null, allBets:[], bets:[], me:null, isAdmin:false, admin:false, adminMode:false,
  filter:{ status:"all", week:"all", mine:false },
  refresh:null, roster:null, games:null,
  seen:null, seenStamped:null,
  proj:null,   // league/proj: Sleeper's weekly projections for the weeks in play
  sleeper:null,   // league/sleeper: each manager's Sleeper avatar and team name, by member id
  highlow:null,   // league/highlow: each finished week's top and bottom Sleeper scores
  allHighlow:null, allScores:null, allDraft:null,   // the raw documents; the narrowed ones below
  draft:null,     // league/draft: the season's picks, as the board draws them
  leagueTab:"scores",   // which half of the League tab is open: scores or draft
  draftView:"mgr",      // and which view of the draft: mgr, board, keep
  scores:null,    // league/scores: every manager's fantasy points and projection, by week
  scoreWeek:null, // which week the Scores tab is showing; null follows the current week
  season:null,    // which season is being shown; null follows config.season
  rosterSync:null, // league/rosterSync: the Sync from Sleeper request, and what came back
  payments:null,  // league/payments: { list: [{ id, from, to, amount, at, by, voided? }] } — settled once, at the end
  lines:null,     // league/lines: Vegas's spread and total per game, from the schedule file
  badges:null,    // league/badges: { byKey: { <badge>: { holder, value, at, week, from, since } } }
  rival:null,     // Rivals: { a, b } — the pair whose bets are open under the grid
  unfolded:{},   // on a phone, tickets and ledger rows fold; ids opened by a tap live here
  timing:{},     // sign-in stopwatch, ms since navigation: boot, auth, click, key, signed, open — the footer shows it
  tab:"book",     // which panel is open: book, ledger, hl, settle — remembered per device   // league/seen: when each manager last opened the app
  // the propose / join forms' draft
  draftScope:"", draftStats:[], editId:null,
  draftGame:null, draftMarket:"ml", draftLine:"", draftFav:"", joinId:null,
  draft:[],
  // sign-in bookkeeping
  typedPw:null, mustChange:false, bookTimer:null, bookError:null
};

// ---- the season boundary ----
// `allBets` is every bet in the book; `bets` is the season being shown. Everything
// downstream reads `bets` and needs no season logic of its own, which is the whole point:
// one filter here instead of thirty careful ones spread across the app. With a single
// season configured the two are the same set.
export function shownSeason(){ return state.season||Sn.currentSeason(state.config); }

function syncBets(){ state.bets=Sn.betsFor(state.allBets,shownSeason()); }

// The weekly documents get the same treatment as bets: the book keeps every season,
// `state.highlow` and `state.scores` are the season being shown. hlTally, balances,
// drillRows and the Scores tab all read the narrowed ones and need no season logic.
function syncWeekly(){
  state.highlow=state.allHighlow?Object.assign({},state.allHighlow,{ weeks:Sn.weeksOf(state.allHighlow,shownSeason()) }):null;
  state.scores=state.allScores?Object.assign({},state.allScores,{ weeks:Sn.weeksOf(state.allScores,shownSeason()) }):null;
  var dr=(state.allDraft&&state.allDraft.bySeason)||{};
  state.draft=dr[shownSeason()]||null;
}

export function setHighlow(doc){ state.allHighlow=doc||null; syncWeekly(); }
export function setDraft(doc){ state.allDraft=doc||null; syncWeekly(); }
export function setScores(doc){ state.allScores=doc||null; syncWeekly(); }

// Replace the book wholesale (a snapshot arrived).
export function setBets(list){ state.allBets=Array.isArray(list)?list.slice():[]; syncBets(); }

// Add or replace one bet, newest first — the local echo of a write.
export function putBet(b){
  var i=-1;
  for(var k=0;k<state.allBets.length;k++){ if(state.allBets[k].id===b.id){ i=k; break; } }
  if(i>=0) state.allBets[i]=b; else state.allBets.unshift(b);
  syncBets();
}

export function dropBet(id){
  state.allBets=state.allBets.filter(function(b){ return b.id!==id; });
  syncBets();
}

// Look at a different season.
export function setSeason(s){ state.season=s?String(s):null; syncBets(); syncWeekly(); }

// The league's settings as the season being shown has them. A season sets its own stake,
// its own kickoff and its own week starts - 2027's weeks do not begin when 2026's did -
// and its own Sleeper league id, because Sleeper mints a new one every year. What a season
// does not override it inherits from the top level, which is how 2026 keeps reading exactly
// as it always has. Everything that asks the clock or the ledger a question passes this,
// not the raw config.
export function seasonCfg(){
  var c=state.config;
  if(!c) return c;
  var s=Sn.settingsFor(c,shownSeason());
  return Object.assign({},c,{ stake:s.stake, kickoff:s.kickoff, weekStarts:s.weekStarts, sleeperLeagueId:s.leagueId });
}

// The season the league is actually on, whatever is being looked at. The refresh loops use
// this and never seasonCfg(): pulling Sleeper while an admin browses 2026 must still write
// 2027's scores, not last year's.
export function currentCfg(){
  var c=state.config;
  if(!c) return c;
  var s=Sn.settingsFor(c,Sn.currentSeason(c));
  return Object.assign({},c,{ stake:s.stake, kickoff:s.kickoff, weekStarts:s.weekStarts, sleeperLeagueId:s.leagueId });
}

export function members(){ return (state.config&&state.config.members)||[]; }
// The roster as the league sees it: test accounts (member.test) are left out of the
// ledger board and the pickers, but never out of name lookups. You always see yourself.
// A manager's team name: Sleeper's, if the league sync has one, else what the League dialog says.
export function teamOf(m){ var s=m&&state.sleeper&&state.sleeper.byId?state.sleeper.byId[m.id]:null; return (s&&s.team)||(m&&m.team)||""; }
// The league as the season being shown had it. `members()` stays the full permanent list,
// because a name or an avatar must still resolve for somebody who stopped playing years
// ago - a 2026 ticket should say RTownsend forever. This is the narrowed one: the ledger
// board, the hi/low standings, the badge field and the pickers all run off it, so they
// show the people who were actually there.
export function realMembers(){
  var s=shownSeason();
  return members().filter(function(m){
    if(m.test&&m.id!==state.me) return false;
    return Sn.inSeason(m,s);
  });
}

var renderFn=null, pending=false;
export function onRender(fn){ renderFn=fn; }

export function touch(){
  if(pending||!renderFn) return;
  pending=true;
  queueMicrotask(function(){ pending=false; renderFn(); });
}

export function set(patch){ Object.assign(state,patch); touch(); }
