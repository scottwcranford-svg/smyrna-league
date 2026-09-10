// Boot: draw the empty page, watch the auth state, open the book once someone is
// signed in with the passcode, and keep it current. Everything else lives in the
// modules below; this file is the only one that knows about all of them.

import * as R from "./rules.js?v=dev";
import * as S from "./store.js?v=dev";
import * as A from "./auth.js?v=dev";
import * as N from "./sleeper.js?v=dev";
import { state, members, onRender, touch } from "./state.js?v=dev";
import { render, toast, ticker, statsBar, showBet } from "./render.js?v=dev";
import { expireBets, settleFinished, syncBadges } from "./book.js?v=dev";
import { drawScope, drawEntries, drawGameBox } from "./forms.js?v=dev";
import { showLogin, enforceFreshPassword, drawRoster } from "./dialogs.js?v=dev";
import { bindEvents } from "./actions.js?v=dev";
import * as Nf from "./notify.js?v=dev";

const memberForEmail=function(email){ return R.memberForEmail(email,members()); };
const mark=function(k){ if(!state.timing[k]) state.timing[k]=Math.round(performance.now()); };
mark("boot");

/* ---- keeping the book current ----
   The loops need a snapshot of what this page knows; nothing in sleeper.js reads state. */
function refreshCtx(){ return { config:state.config, games:state.games, refresh:state.refresh, bets:state.bets, roster:state.roster, proj:state.proj, sleeper:state.sleeper, highlow:state.highlow,
                                holder:state.me, mobile:/Mobi|Android/i.test(navigator.userAgent) }; }
function scoresTick(db){ if(!db||state.local) return; N.scoresTick(db,refreshCtx()); }
function runRefresh(db,by,forced){ return N.runRefresh(db,by,forced,refreshCtx()); }
function makeDb(key){ return S.makeDb(key,{ refresh:runRefresh }); }

// An admin sees the admin controls only with the header switch on; off, the app
// looks and behaves as it does for everyone else. The switch is remembered per device.
const ADMIN_LS="smyrna.adminMode";
try{ state.adminMode=localStorage.getItem(ADMIN_LS)==="on"; }catch(e){}
try{ var savedTab=localStorage.getItem("smyrna.tab"); if(["book","ledger","hl","rivals","settle"].indexOf(savedTab)>=0) state.tab=savedTab; }catch(e){}
// A tapped notification opens the app at its bet: ?bet=<id>, read before storedKey() tidies the address.
var openBet=null; try{ openBet=new URLSearchParams(location.search).get("bet"); if(openBet) history.replaceState(null,"",location.pathname); }catch(e){}
function applyAuth(user){ var w=A.whoAmI(user,state.config); state.me=w.me; state.isAdmin=w.admin; state.admin=w.admin&&state.adminMode; stampSeen(); }
// Once per visit, note that this manager opened the app. league/seen was { memberId: iso };
// it is now { memberId: { at, n } } so the book can also say who opens it most. Old string
// entries still read fine (rules.seenAt / rules.seenCount), and the first visit after this
// shipped converts that manager's entry.
function stampSeen(){
  if(!state.me||!state.db||state.local||state.seenStamped===state.me) return;
  state.seenStamped=state.me;
  var d={}; d[state.me]={ at:new Date().toISOString(), n:R.seenCount(state.seen,state.me)+1 };
  state.db.doc("league/seen").update(d).catch(function(){ /* a missed stamp is no loss */ });
}
export function toggleAdmin(){
  state.adminMode=!state.adminMode;
  try{ localStorage.setItem(ADMIN_LS,state.adminMode?"on":"off"); }catch(e){}
  state.admin=state.isAdmin&&state.adminMode;
  if(document.getElementById("rosterDlg").open) drawRoster();
  touch();
}

// Signed in and passcode known: open the book, subscribe once, show the app when it lands.
function enterBook(user){
  if(!user) return;
  var key=S.storedKey();
  if(!key){ showLogin("Signed in — now the league passcode."); return; }
  if(!state.db){ state.db=makeDb(key); state.connected=true; subscribeBook(state.db); }
  else if(!state.local){ document.getElementById("login").hidden=true; document.getElementById("app").hidden=false; touch(); }
  // the default-password check needs the roster; if it isn't here yet, the config
  // snapshot runs it once the names arrive
  if(state.typedPw&&memberForEmail(user.email)){ enforceFreshPassword(user,state.typedPw); state.typedPw=null; }
  // If the book hasn't opened shortly, say why on the login screen instead of sitting there.
  clearTimeout(state.bookTimer);
  var t0=Date.now();
  state.bookTimer=setTimeout(function(){
    if(!document.getElementById("app").hidden) return;
    console.warn("book not open after",Math.round((Date.now()-t0)/1000),"s; local=",state.local,"error=",state.bookError);
    var why=state.bookError?("The book refused to load: "+S.dbMsg(state.bookError)+" ("+(state.bookError.code||"")+").")
      :"Signed in, but the book hasn't loaded. Something on this browser may be blocking firestore.googleapis.com — an ad blocker or strict tracking prevention. Try another browser, or start over below.";
    document.getElementById("siHint").textContent=why;
    document.getElementById("siReset").hidden=false;
  },6000);
}

// Everything the page reads, started once, after sign-in. Rules refuse these reads
// to anyone who isn't a signed-in member.
function subscribeBook(db){
  // Keep the book current from this browser: scores every minute during games,
  // a full refresh hourly. Leases keep it to one writer across all open pages.
  setTimeout(function(){ runRefresh(db,state.me,false).catch(function(){}); scoresTick(db); },4000);
  setInterval(function(){ scoresTick(db); },60000);
  setInterval(function(){ runRefresh(db,state.me,false).catch(function(){}); },15*60000);

  // These two subscriptions race, and either can deliver first. Hold the
  // latest bets snapshot so a bets-before-league ordering can't drop the
  // book on the floor — the league handler adopts whatever already arrived.
  var remoteBets=null;

  db.doc("league/config").onSnapshot(function(snap){
    if(snap.exists){
      var d=R.clone(snap.data());
      if(d&&Array.isArray(d.members)&&d.members.length){
        state.config={ leagueName:d.leagueName||"Smyrna League", season:d.season||"",
                       stake:Number(d.stake)||25, members:d.members,
                       kickoff:d.kickoff||R.DEFAULT_KICKOFF,
                       weekStarts:(d.weekStarts&&typeof d.weekStarts==="object")?d.weekStarts:null };
        state.config.adminEmails=Array.isArray(d.adminEmails)?d.adminEmails:(d.adminEmail?[d.adminEmail]:[]);
        if(state.local){
          state.local=false;
          state.bets=remoteBets||[];
        }
        applyAuth(A.currentUser());   // the roster may have arrived after sign-in
        var u=A.currentUser();
        if(u&&state.typedPw&&memberForEmail(u.email)){ enforceFreshPassword(u,state.typedPw); state.typedPw=null; }
        // the book is here and you're signed in: show the app
        clearTimeout(state.bookTimer);
        mark("open");
        document.getElementById("login").hidden=true;
        document.getElementById("app").hidden=false;
      } else {
        state.bookError={ code:"empty-config", message:"league settings are empty" };
      }
    } else {
      state.bookError={ code:"no-config", message:"no league settings under this passcode" };
    }
    touch();
  },function(e){ state.bookError=e; console.error("league/config:",e); toast(S.dbMsg(e)); });

  db.doc("league/refresh").onSnapshot(function(snap){
    state.refresh=snap.exists?R.clone(snap.data()):null;
    statsBar();
  },function(){ /* freshness strip is optional; stay quiet */ });

  db.doc("league/games").onSnapshot(function(snap){
    state.games=snap.exists?snap.data():null;
    ticker();
  },function(){ /* no ticker without the games doc */ });

  db.doc("league/seen").onSnapshot(function(snap){
    state.seen=snap.exists?snap.data():null;
    if(document.getElementById("rosterDlg").open) drawRoster();
  },function(){ /* the League dialog just shows no dates */ });

  db.doc("league/roster").onSnapshot(function(snap){
    state.roster=snap.exists?snap.data():null;   // read-only; no clone needed
    if(document.getElementById("betDlg").open){ drawScope(); drawEntries(); }
    touch();   // tickets show each pick's current status
  },function(){ /* picker falls back to free text */ });

  db.doc("league/payments").onSnapshot(function(snap){
    state.payments=snap.exists?R.clone(snap.data()):null;
    touch();
  },function(){ /* nothing paid yet */ });

  db.doc("league/lines").onSnapshot(function(snap){
    state.lines=snap.exists?snap.data():null;   // read-only; the form prefills from it
    if(document.getElementById("betDlg").open) drawGameBox();
  },function(){ /* no published lines, so every number is typed by hand */ });

  db.doc("league/badges").onSnapshot(function(snap){
    state.badges=snap.exists?R.clone(snap.data()):null;   // who has held what, and since when
    touch();
  },function(){ /* the case still shows today's holders, just no history */ });

  db.doc("league/highlow").onSnapshot(function(snap){
    state.highlow=snap.exists?snap.data():null;   // read-only
    touch();
  },function(){ /* no high/low until the first week is final anyway */ });

  db.doc("league/sleeper").onSnapshot(function(snap){
    state.sleeper=snap.exists?snap.data():null;   // read-only
    if(document.getElementById("rosterDlg").open) drawRoster();
    touch();
  },function(){ /* initials and the dialog's team names, then */ });

  db.doc("league/proj").onSnapshot(function(snap){
    state.proj=snap.exists?snap.data():null;   // read-only
    touch();   // tickets show projections until something has been played
  },function(){ /* no projections, no harm */ });

  // push, once the book is open: say what arrives while the page is up; refile a rotated token
  var pushStarted=false;
  var startPush=function(){
    if(pushStarted||state.local||!state.me) return; pushStarted=true;
    Nf.listen(function(title,body){ toast(title+(body?" · "+body:"")); });
    setTimeout(function(){ Nf.refresh(); },8000);
  };

  db.collection("bets").limit(1000).onSnapshot(function(snap){
    remoteBets=snap.docs.map(function(d){
      var v=R.clone(d.data())||{};
      v.id=d.id;
      if(!Array.isArray(v.entries)) v.entries=[];
      if(!Array.isArray(v.paid)) v.paid=[];
      return v;
    });
    if(state.local) return;
    state.bets=remoteBets;
    touch();
    startPush();
    if(openBet){ var id=openBet; openBet=null; state.tab="book"; touch(); setTimeout(function(){ showBet(id); },300); }
  },function(e){ toast(S.dbMsg(e)); });
}

/* ---- boot ---- */
onRender(function(){ expireBets(); settleFinished(); syncBadges(); render(); });
try{ window.matchMedia("(max-width: 600px)").addEventListener("change",function(){ touch(); }); }catch(e){}
bindEvents({ enterBook:enterBook, toggleAdmin:toggleAdmin });
state.config={ leagueName:"Smyrna League", season:"2026", stake:25, kickoff:R.DEFAULT_KICKOFF, members:[] };
state.bets=[];
render();

state.ready=true;
// Any script error while the login card is up gets printed on the card, so a stuck
// screen always says why.
window.addEventListener("error",function(ev){
  var h=document.getElementById("siHint"); if(!h||document.getElementById("login").hidden) return;
  h.textContent="Error: "+(ev.message||"unknown")+(ev.lineno?" (line "+ev.lineno+")":"");
  document.getElementById("siReset").hidden=false;
});
window.addEventListener("unhandledrejection",function(ev){
  var h=document.getElementById("siHint"); if(!h||document.getElementById("login").hidden) return;
  var r=ev.reason||{}; h.textContent="Error: "+(r.code||"")+" "+(r.message||String(r));
  document.getElementById("siReset").hidden=false;
});
if(!window.FIREBASE_CONFIG||!window.FIREBASE_CONFIG.projectId||!window.firebase){
  showLogin("This copy isn't connected to the league's book.");
} else {
  S.initFirebase();
  S.storedKey();   // scrub a ?key= link into device memory right away
  A.onAuthStateChanged(function(user){
    // The login card is plain HTML and shows before Firebase is ready; a sign-in
    // started before this first callback can hang. The button opens here.
    document.getElementById("siGo").disabled=false;
    mark("auth");
    applyAuth(user);
    if(user) enterBook(user);
    else { if(state.db){ location.reload(); return; } showLogin(); }
    touch();
  });
}
