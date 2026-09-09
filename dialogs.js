// The smaller dialogs and the sign-in screen: settle a bet, the League/roster
// dialog (admins set passwords and flag admins), change your own password (forced
// on the starting password), and the login card that is the whole page until
// you're in. DOM in, auth.js/store.js out.

import * as R from "./rules.js?v=dev";
import * as S from "./store.js?v=dev";
import * as A from "./auth.js?v=dev";
import { state, members, realMembers, teamOf } from "./state.js?v=dev";
import { toast, avatarHtml } from "./render.js?v=dev";
import { guard, findBet } from "./book.js?v=dev";

const esc=R.esc, money=R.money, entriesOf=R.entriesOf, toLocalInput=R.toLocalInput, defaultPw=R.defaultPw, DEFAULT_KICKOFF=R.DEFAULT_KICKOFF;
const member=function(id){ return R.member(id,members()); };
const mName=function(id){ return R.mName(id,members()); };
const gameOf=function(b){ return R.gameOf(b,state.games); };
const memberForEmail=function(email){ return R.memberForEmail(email,members()); };
const adminIds=function(){ return R.adminIds(state.config); };
const isAdminMember=function(id){ return R.isAdminMember(id,state.config); };

/* ---- settle ---- */
export function openSettleDlg(id){
  if(!guard()) return;
  var bet=findBet(id);
  if(!bet) return;
  var live=entriesOf(bet).filter(function(e){ return e.memberId; });
  var head=bet.name?bet.name+" — "+bet.terms:bet.terms;
  if(bet.game){
    var g=gameOf(bet);
    if(g&&g.awayScore!=null&&g.homeScore!=null) head+="  ·  "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore+(g.status==="final"?" (Final)":" (in progress)");
  }
  document.getElementById("sTerms").textContent=head;
  document.getElementById("sOptions").innerHTML =
    live.map(function(e){
      var take=(Number(bet.amount)||0)*(live.length-1);
      return '<button class="btn lg blk" data-act="win" data-id="'+esc(id)+'" data-w="'+esc(e.memberId)+'">'+
        esc(e.pick||mName(e.memberId))+" — "+esc(mName(e.memberId))+" collects "+money(take)+"</button>";
    }).join("")+
    '<button class="btn lg blk" data-act="win" data-id="'+esc(id)+'" data-w="push">Push — nobody pays</button>';
  document.getElementById("settleDlg").showModal();
}

/* ---- the League dialog ---- */
export function openRoster(){
  var adm=!!state.admin;
  document.getElementById("rName").value=state.config.leagueName;
  document.getElementById("rSeason").value=state.config.season;
  document.getElementById("rStake").value=String(state.config.stake||25);
  document.getElementById("rKickoff").value=toLocalInput(state.config.kickoff||DEFAULT_KICKOFF);
  ["rName","rSeason","rStake","rKickoff"].forEach(function(id){ document.getElementById(id).disabled=!adm; });
  document.getElementById("rAddRow").hidden=!adm;
  document.getElementById("rAdd").hidden=!adm;
  document.getElementById("rSave").hidden=!adm;
  document.getElementById("rHint").textContent=adm
    ? "Set each manager's password here and hand it to them. Removing someone keeps their settled bets in the ledger."
    : "App admin"+(adminIds().length===1?"":"s")+": "+esc(adminIds().map(mName).join(", ")||"none set")+". Only admins can change the league, set passwords or flag admins.";
  drawRoster();
  document.getElementById("rosterDlg").showModal();
}
// Drill-through from the season table: the bets or hi / low weeks behind one cell.
export function openDrill(memberId,row){
  var m=member(memberId); if(!m) return;
  var rows=R.drillRows(memberId,row,state.bets,state.highlow,R.hlStake(state.config),members());
  var title={ hl:"Hi / low", weekly:"Weekly bets", season:"Season bets", total:"Everything" }[row]||row;
  var net=rows.reduce(function(s,r){ return s+r.amount; },0);
  document.getElementById("drillTitle").innerHTML=avatarHtml(m.id,24)+" "+esc(m.name)+' <span class="drill-row">· '+esc(title)+"</span>";
  document.getElementById("drillList").innerHTML=rows.length?rows.map(function(r){
    var v=Math.round(r.amount*100)/100, cls=v>0?"pos":v<0?"neg":"flat";
    return '<div class="drill"'+(r.kind==="bet"?' data-act="goBet" data-id="'+esc(r.id)+'" role="button" tabindex="0"':"")+'>'+
      '<span class="wk">'+esc(R.weekLabel(r.week))+"</span>"+
      '<span class="drill-txt"><b>'+esc(r.label)+"</b><small>"+esc(r.note)+"</small></span>"+
      '<b class="num '+cls+'">'+R.signed(v)+"</b></div>";
  }).join("")+'<div class="drill-net">Net <b class="'+(net>0?"pos":net<0?"neg":"flat")+'">'+R.signed(Math.round(net*100)/100)+"</b></div>"
  :'<div class="empty">Nothing here yet.</div>';
  document.getElementById("drillDlg").showModal();
}
// When a manager last opened the app, from league/seen.
function seenHtml(id){
  var iso=state.seen&&state.seen[id], t=Date.parse(iso||"");
  if(isNaN(t)) return '<span class="r-seen never">Never signed in</span>';
  var when; try{ when=new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"}); }catch(e){ when=R.ago(iso); }
  return '<span class="r-seen" title="'+esc(R.fmtWhen(t))+'">Last in '+esc(Date.now()-t<86400e3?R.ago(iso):when)+"</span>";
}
export function drawRoster(){
  var adm=!!state.admin;
  // Test accounts show to admins (to manage them) and to themselves; nobody else sees them.
  document.getElementById("rosterList").innerHTML=(adm?members():realMembers()).map(function(m){
    return '<div class="rrow'+(m.test?" test":"")+'">'+avatarHtml(m.id,26)+
      '<span class="r-name">'+esc(m.name)+"</span>"+
      (isAdminMember(m.id)?'<span class="r-adm">Admin</span>':"")+
      (m.test?'<span class="r-adm r-test" title="Left out of the ledger and the pickers">Test</span>':"")+
      '<span class="r-team">'+esc(teamOf(m)||"—")+"</span>"+seenHtml(m.id)+
      (adm?'<input class="field r-pw" type="password" data-pw="'+esc(m.id)+'" autocomplete="new-password" placeholder="Set password">'+
           '<button class="btn" data-act="setPw" data-id="'+esc(m.id)+'">Set</button>'+
           '<button class="btn" data-act="pwDefault" data-id="'+esc(m.id)+'" title="'+esc(defaultPw(m))+'">Default</button>':"")+
      (adm?'<label class="check r-chk"><input type="checkbox" data-act="admToggle" data-id="'+esc(m.id)+'"'+(isAdminMember(m.id)?" checked":"")+'> Admin</label>':"")+
      (adm?'<label class="check r-chk" title="A test account: kept off the ledger board and out of the pickers"><input type="checkbox" data-act="testToggle" data-id="'+esc(m.id)+'"'+(m.test?" checked":"")+'> Test</label>':"")+
      (adm&&m.id!==state.me?'<button class="btn danger" data-act="rmMember" data-id="'+esc(m.id)+'">Remove</button>':"")+
    "</div>";
  }).join("");
}
// The admin sets or changes a manager's password (auth.js does the work).
export function setPassword(memberId,pw){
  if(!state.admin) return Promise.reject({ message:"Only the admin can set passwords" });
  var m=member(memberId); if(!m) return Promise.reject({ message:"No such manager" });
  if(!pw||pw.length<6) return Promise.reject({ code:"auth/weak-password" });
  return A.setPassword(m,pw,function(){ return prompt("An account for "+m.name+" already exists. Enter its current password to change it:"); });
}

/* ---- your own password ---- */
export function openPasswordDlg(){
  document.getElementById("pwCur").value=""; document.getElementById("pwNew").value=""; document.getElementById("pwHint").textContent="";
  document.getElementById("pwDlg").showModal(); document.getElementById("pwCur").focus();
}
// Still on the starting password? Require a new one before anything else.
export function enforceFreshPassword(user,typedPw){
  var m=user?memberForEmail(user.email):null; if(!m||!typedPw) return;
  if(A.isDefaultPassword(user,typedPw,members())) forcePasswordChange(m);
}
function forcePasswordChange(m){
  var dlg=document.getElementById("pwDlg");
  state.mustChange=true;
  document.getElementById("pwCur").value=defaultPw(m);
  document.getElementById("pwNew").value="";
  document.getElementById("pwHint").textContent="You're on the starting password. Pick your own to continue.";
  if(!dlg.open) dlg.showModal();
  document.getElementById("pwNew").focus();
}
// A signed-in manager changes their own password — nobody else's. Firebase requires
// a fresh sign-in first, which is what the current password is for.
export function changeOwnPassword(){
  var user=A.currentUser(), hint=document.getElementById("pwHint");
  if(!user) return toast("Sign in first");
  var cur=document.getElementById("pwCur").value, nw=document.getElementById("pwNew").value;
  if(!cur) return toast("Enter your current password");
  if(!nw||nw.length<6) return toast("New password needs at least 6 characters");
  var mm=memberForEmail(user.email);
  if(mm&&nw===defaultPw(mm)) return toast("That's the starting password — pick a different one");
  hint.textContent="Changing…";
  A.changePassword(user,cur,nw).then(function(){
    document.getElementById("pwCur").value=""; document.getElementById("pwNew").value=""; hint.textContent="";
    state.mustChange=false;
    document.getElementById("pwDlg").close(); toast("Password changed");
  }).catch(function(e){ hint.textContent=A.authMsg(e); });
}

/* ---- the login screen: the whole page until you're in ---- */
export function showLogin(msg){
  document.getElementById("app").hidden=true;
  var lg=document.getElementById("login"); lg.hidden=false;
  document.getElementById("siKeyRow").hidden=!!S.storedKey();
  document.getElementById("siHint").textContent=msg||"";
  var nm=document.getElementById("siName"); (nm.value?document.getElementById("siPw"):nm).focus();
}
// Check the passcode, sign in, then hand the user to `enterBook` (app.js opens the book).
export function submitLogin(enterBook){
  var name=document.getElementById("siName").value.trim(), pw=document.getElementById("siPw").value, hint=document.getElementById("siHint");
  var key=S.storedKey()||document.getElementById("siKey").value.trim();
  if(!name) return toast("Enter your name");
  if(!pw) return toast("Enter your password");
  if(!key){ document.getElementById("siKeyRow").hidden=false; return toast("Enter the league passcode"); }
  hint.textContent="Signing in…";
  S.tryKey(key).then(function(ok){
    if(!ok){ document.getElementById("siKeyRow").hidden=false; S.forgetKey(); hint.textContent="That passcode isn't right"; return; }
    S.setKey(key);
    return A.signIn(name,pw)
      .then(function(cred){
        hint.textContent="Opening the book…";
        state.typedPw=pw;
        // if this browser was already signed in, auth state won't "change" — open the book directly
        enterBook(cred.user||A.currentUser());
      })
      .catch(function(e){ hint.textContent=A.authMsg(e); });
  });
}
// The login card's "start over": forget everything on this device and reload clean.
export function startOver(){
  try{ localStorage.clear(); }catch(e){}
  A.signOut().catch(function(){}).then(function(){ location.replace(location.pathname); });
}
