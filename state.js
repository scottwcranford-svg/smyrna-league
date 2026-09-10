// The one shared state object, and the single way to ask for a redraw. Modules
// mutate `state` and call touch(); the next microtask draws once, however many
// callers asked. app.js registers the drawing function at boot.

export const state = {
  db:null, connected:false, ready:false, local:true,
  // `isAdmin` is who you are; `admin` is whether the admin controls are showing right now
  config:null, bets:[], me:null, isAdmin:false, admin:false, adminMode:false,
  filter:{ status:"all", week:"all", mine:false },
  refresh:null, roster:null, games:null,
  seen:null, seenStamped:null,
  proj:null,   // league/proj: Sleeper's weekly projections for the weeks in play
  sleeper:null,   // league/sleeper: each manager's Sleeper avatar and team name, by member id
  highlow:null,   // league/highlow: each finished week's top and bottom Sleeper scores
  payments:null,  // league/payments: { list: [{ id, from, to, amount, at, by, voided? }] } — settled once, at the end
  tab:"book",     // which panel is open: book, ledger, hl, settle — remembered per device   // league/seen: when each manager last opened the app
  // the propose / join forms' draft
  draftScope:"", draftStats:[], editId:null,
  draftGame:null, draftMarket:"ml", draftLine:"", draftFav:"", joinId:null,
  draft:[],
  // sign-in bookkeeping
  typedPw:null, mustChange:false, bookTimer:null, bookError:null
};

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
