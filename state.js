// The one shared state object, and the single way to ask for a redraw. Modules
// mutate `state` and call touch(); the next microtask draws once, however many
// callers asked. app.js registers the drawing function at boot.

export const state = {
  db:null, connected:false, ready:false, local:true,
  config:null, bets:[], me:null, admin:false,
  filter:{ status:"all", week:"all", mine:false },
  refresh:null, roster:null, games:null,
  // the propose / join forms' draft
  draftScope:"", draftStats:[], editId:null,
  draftGame:null, draftMarket:"ml", draftLine:"", draftFav:"", joinId:null,
  draft:[],
  // sign-in bookkeeping
  typedPw:null, mustChange:false, bookTimer:null, bookError:null
};

export function members(){ return (state.config&&state.config.members)||[]; }

var renderFn=null, pending=false;
export function onRender(fn){ renderFn=fn; }

export function touch(){
  if(pending||!renderFn) return;
  pending=true;
  queueMicrotask(function(){ pending=false; renderFn(); });
}

export function set(patch){ Object.assign(state,patch); touch(); }
