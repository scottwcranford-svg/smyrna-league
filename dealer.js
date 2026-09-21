// The one call to the poker dealer (functions/poker, an HTTPS Cloud Function). Not
// Firestore, so not store.js; not Sleeper, so not sleeper.js: this is the app's third
// network module and the only place the dealer's URL is used. No DOM.
//
// Every request carries the signed-in account's ID token and the hand and seq the page
// was looking at; the dealer refuses a request about a table that has since moved on
// (409 "stale"), which is why every open page can send a tick when a clock runs out and
// only one of them does anything.

import { state, touch } from "./state.js?v=dev";
import * as A from "./auth.js?v=dev";

function url(){ return (window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.pokerUrl)||""; }

// Resolves the dealer's reply ({ ok, seq }); rejects with { error, message } in its words.
export function send(body){
  if(state.local) return Promise.resolve({ ok:true, seq:(state.poker&&state.poker.seq)||0, local:true });   // the UI tests: nothing leaves the page
  var u=A.currentUser(); if(!u) return Promise.reject({ error:"signin", message:"Sign in first" });
  if(!url()||!state.db) return Promise.reject({ error:"nodealer", message:"This copy has no dealer configured" });
  var ctl=new AbortController(), timer=setTimeout(function(){ ctl.abort(); },8000);
  return u.getIdToken().then(function(tok){
    return fetch(url(),{ method:"POST", signal:ctl.signal, headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok },
      body:JSON.stringify(Object.assign({ key:state.db.key },body)) });
  }).then(function(r){ return r.json().catch(function(){ return { error:"bad-reply" }; }); })
    .then(function(j){ if(j&&j.ok) return j; throw j||{ error:"unknown" }; })
    .catch(function(e){ throw (e&&e.name==="AbortError")?{ error:"timeout", message:"The dealer didn't answer" }:e; })
    .finally(function(){ clearTimeout(timer); });
}

// A player's move: stamped with the hand and seq on screen, the action bar held while
// it's out, a refusal put on the table in words. A stale refusal is swallowed - the
// snapshot that made it stale has already redrawn the table.
export function act(body){
  if(state.pokerBusy) return Promise.resolve(null);
  var T=state.poker||{};
  state.pokerBusy=true; state.pokerErr=""; touch();
  return send(Object.assign({ hand:T.handNo||0, seq:T.seq||0 },body))
    .then(function(r){ state.pokerBusy=false; touch(); return r; })
    .catch(function(e){ state.pokerBusy=false; if(!(e&&e.error==="stale")) state.pokerErr=msg(e); touch(); return null; });
}

// The dealer's refusals in plain words.
export function msg(e){
  var c=(e&&e.error)||"";
  if(e&&e.message&&c!=="dealer"&&c!=="bad-reply"&&c!=="unknown") return e.message;
  if(c==="timeout") return "The dealer didn't answer — try again";
  if(c==="signin") return "Sign in again";
  if(c==="nodealer") return "No dealer is set up for this copy";
  return "The dealer stumbled — try again";
}
