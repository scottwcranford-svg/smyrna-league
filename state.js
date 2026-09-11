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
  scores:null,    // league/scores: every manager's fantasy points and projection, by week
  scoreWeek:null, // which week the Scores tab is showing; null follows the current week
  season:null,    // which season is being shown; null follows config.season
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
export function setSeason(s){ state.season=s?String(s):null; syncBets(); }

export function members(){ return (state.config&&state.config.members)||[]; }
// The roster as the league sees it: test accounts (member.test) are left out of the
// ledger board and the pickers, but never out of name lookups. You always see yourself.
// A manager's team name: Sleeper's, if the league sync has one, else what the League dialog says.
export function teamOf(m){ var s=m&&state.sleeper&&state.sleeper.byId?state.sleeper.byId[m.id]:null; return (s&&s.team)||(m&&m.team)||""; }
export function realMembers(){ return members().filter(function(m){ return !m.test||m.id===state.me; }); }

var renderFn=null, pending=false;
export function onRender(fn){ renderFn=fn; }

export function touch(){
  if(pending||!renderFn) return;
  pending=true;
  queueMicrotask(function(){ pending=false; renderFn(); });
}

export function set(patch){ Object.assign(state,patch); touch(); }
