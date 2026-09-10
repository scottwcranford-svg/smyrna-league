// Push notifications, this device's side: ask the browser, register the service
// worker, get a Firebase Cloud Messaging token and file it under league/push so the
// Cloud Function (functions/) knows where to send. Everything that touches
// Notification, the service worker or FCM lives here; no DOM. The page decides what
// to say about it.

import { state } from "./state.js?v=dev";

const LS="smyrna.push", NUDGE_LS="smyrna.pushNudge";
// Registered by relative path: on GitHub Pages the site lives under /smyrna-league/,
// and the SDK would otherwise look for the worker at the origin's root.
const SW="firebase-messaging-sw.js";

function ls(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } }
function lsSet(k,v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} }

export function supported(){
  try{ return !!(window.firebase&&firebase.messaging&&firebase.messaging.isSupported()&&"serviceWorker" in navigator&&"Notification" in window); }
  catch(e){ return false; }
}
export function standalone(){ try{ return navigator.standalone===true||window.matchMedia("(display-mode: standalone)").matches; }catch(e){ return false; } }
export function isIOS(){ var ua=navigator.userAgent||""; return /iPhone|iPad|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1); }
export function savedToken(){ return ls(LS); }

// "on" · "off" · "blocked" (denied in the browser) · "install" (an iPhone that isn't
// on the home screen yet: Safari only pushes to home-screen apps) · "unsupported"
export function status(){
  if(isIOS()&&!standalone()) return "install";
  if(!supported()) return "unsupported";
  if(Notification.permission==="denied") return "blocked";
  return savedToken()&&Notification.permission==="granted"?"on":"off";
}
export function label(s){ return { on:"Notifications on", off:"Notifications off", blocked:"Notifications blocked", install:"Get notifications", unsupported:"Notifications" }[s||status()]; }

// Worth a nudge on the page: signed in to the shared book, could turn them on, hasn't said "not now".
export function nudge(){
  if(!state.me||!state.db||state.local||ls(NUDGE_LS)) return false;
  var s=status(); return s==="off"||s==="install";
}
export function snooze(){ lsSet(NUDGE_LS,new Date().toISOString()); }

function messaging(){ return firebase.messaging(); }
function vapid(){ return (window.FIREBASE_CONFIG&&window.FIREBASE_CONFIG.vapidKey)||""; }
function register(){ return navigator.serviceWorker.register(SW); }
function fileToken(tok){
  var d={ byToken:{} };
  d.byToken[tok]={ memberId:state.me, at:new Date().toISOString(), ua:String(navigator.userAgent||"").slice(0,140) };
  return state.db.doc("league/push").update(d).then(function(){ lsSet(LS,tok); return tok; });
}

// From a tap: the permission prompt has to come straight out of a user gesture,
// which is why the browser is asked first and everything else waits on it.
export function enable(){
  if(!state.me||!state.db||state.local) return Promise.reject(new Error("Sign in first"));
  if(!supported()) return Promise.reject(new Error("This browser can't do notifications"));
  if(!vapid()) return Promise.reject(new Error("This copy has no push key"));
  return Notification.requestPermission().then(function(p){
    if(p!=="granted") throw new Error(p==="denied"?"Blocked — allow notifications for this site in the browser's settings":"No permission given");
    return register();
  }).then(function(reg){ return messaging().getToken({ vapidKey:vapid(), serviceWorkerRegistration:reg }); })
  .then(function(tok){ if(!tok) throw new Error("The browser gave no token"); return fileToken(tok); });
}

// Off on this device: forget the token here and in the book, and drop it at FCM.
export function disable(){
  var tok=savedToken(); lsSet(LS,null);
  var drop=tok&&state.db&&!state.local
    ?state.db.doc("league/push").get().then(function(s){
        var d=s.exists?s.data():null; if(!d||!d.byToken||!d.byToken[tok]) return;
        delete d.byToken[tok]; return state.db.doc("league/push").set(d);
      }).catch(function(){})
    :Promise.resolve();
  return drop.then(function(){ if(supported()) return messaging().deleteToken().catch(function(){}); });
}

// Tokens rotate now and then. On a visit with notifications on, ask for the current
// one and refile it if it changed. Quiet: nothing to tell anyone.
export function refresh(){
  if(status()!=="on"||!vapid()) return Promise.resolve(null);
  return register().then(function(reg){ return messaging().getToken({ vapidKey:vapid(), serviceWorkerRegistration:reg }); })
    .then(function(tok){ if(tok&&tok!==savedToken()) return fileToken(tok); return tok; })
    .catch(function(){ return null; });
}

// A message while the page is open: the book has already updated on screen, so the
// page just says what happened.
export function listen(onMsg){
  if(!supported()) return;
  try{ messaging().onMessage(function(m){ var n=(m&&m.notification)||(m&&m.data)||{}; onMsg(n.title||"",n.body||"",(m&&m.data&&m.data.bet)||null); }); }catch(e){}
}
