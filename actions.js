// What a click, change or keystroke does. Buttons carry data-act="…"; ACTIONS maps
// each to a function, so adding a button is one row here, not another branch in a
// chain. bindEvents() runs once at boot with what it needs from app.js.

import * as Fmt from "./fmt.js?v=dev";
import * as Clock from "./clock.js?v=dev";
import * as Id from "./identity.js?v=dev";
import * as A from "./auth.js?v=dev";
import { state, members, touch, shownSeason } from "./state.js?v=dev";
import { toast, showBet } from "./render.js?v=dev";
import * as B from "./book.js?v=dev";
import * as F from "./forms.js?v=dev";
import * as D from "./dialogs.js?v=dev";
import * as Nf from "./notify.js?v=dev";

const COLORS=Fmt.COLORS, uid=Fmt.uid, defaultPw=Id.defaultPw, emailFor=Id.emailFor;
const member=function(id){ return Id.member(id,members()); };
const adminEmails=function(){ return Id.adminEmails(state.config); };
const allGames=function(){ return Clock.allGames(state.games); };
const attr=function(t,n){ return t.getAttribute(n); };
const num=function(t,n){ return Number(t.getAttribute(n)); };

// data-act clicks. Each gets the element and its data-id.
export const ACTIONS = {
  filter:function(t){ state.filter.status=attr(t,"data-status"); touch(); },
  mine:function(){ state.filter.mine=!state.filter.mine; touch(); },
  scoreWeek:function(t){ state.scoreWeek=num(t,"data-w"); touch(); },
  publishLeague:function(){ B.publishLeague(); },
  take:function(t,id){ B.takeSeat(id,num(t,"data-i")); },
  accept:function(t,id){ B.takeSeat(id,num(t,"data-i")); },
  pass:function(t,id){ B.passSeat(id,num(t,"data-i")); },
  settle:function(t,id){ D.openSettleDlg(id); },
  edit:function(t,id){ F.openBetDlg(id); },
  join:function(t,id){ F.openJoinDlg(id); },
  pay:function(t){ B.recordPayment(attr(t,"data-from"),attr(t,"data-to"),attr(t,"data-amount")); },
  unpay:function(t,id){ B.voidPayment(id); },
  win:function(t,id){ B.recordWinner(id,attr(t,"data-w")); document.getElementById("settleDlg").close(); },
  reopen:function(t,id){ B.reopenBet(id); },
  void:function(t,id){ B.voidBet(id); },
  restore:function(t,id){ B.restoreBet(id); },
  del:function(t,id){ B.deleteBet(id); },
  signin:function(){ D.showLogin(); },

  // the propose form's draft
  dRm:function(t){ state.draft.splice(num(t,"data-i"),1); F.drawEntries(); },
  dScope:function(t){
    state.draftScope=attr(t,"data-scope")||"";
    state.draft.forEach(function(e){ e.picks=[]; e.pick=""; e.side=""; });
    if(state.draftScope==="game"){ state.draft=state.draft.slice(0,2); while(state.draft.length<2) state.draft.push({memberId:null,pick:"",picks:[],side:""}); }
    F.drawScope(); F.drawEntries();
  },
  dMarket:function(t){
    var m=attr(t,"data-market");
    state.draftMarket=(m==="total"||m==="spread")?m:"ml";
    state.draft.forEach(function(e){ e.side=""; });
    F.prefillLine();   // whatever Vegas has published for this game and market
    F.drawGameBox(); F.drawEntries();
  },
  // on a spread, which team is giving the points
  dFav:function(t){ state.draftFav=attr(t,"data-fav")||""; state.draft.forEach(function(e){ e.side=""; }); F.drawGameBox(); F.drawEntries(); },
  dSide:function(t){
    var si=num(t,"data-i"), sv=attr(t,"data-side");
    state.draft.forEach(function(e,j){ if(j!==si&&e.side===sv) e.side=""; });   // one side per pick
    state.draft[si].side=sv;
    F.drawEntries();
  },
  dStat:function(t){
    var sk=attr(t,"data-stat"), at=state.draftStats.indexOf(sk);
    if(at>=0){ if(state.draftStats.length>1) state.draftStats.splice(at,1); }   // keep at least one
    else state.draftStats.push(sk);
    F.drawScope();
  },
  dAdd:function(t){ F.addPick(num(t,"data-i"),attr(t,"data-id")); },
  dDrop:function(t){ F.dropPick(num(t,"data-i"),attr(t,"data-id")); },

  // the League dialog (admins)
  rmMember:function(t,id){
    if(!state.admin) return toast("Only the admin can do that");
    if(id===state.me) return toast("You can't remove yourself");
    state.config.members=state.config.members.filter(function(m){ return m.id!==id; });
    D.drawRoster(); B.saveConfig();
  },
  pwDefault:function(t,id){
    var dm=member(id); if(!dm) return;
    D.setPassword(id,defaultPw(dm)).then(function(msg){ toast(msg+" · "+defaultPw(dm)); }).catch(function(e){ toast(A.authMsg(e)); });
  },
  setPw:function(t,id){
    var pwIn=document.querySelector('input[data-pw="'+id+'"]');
    D.setPassword(id,pwIn?pwIn.value:"").then(function(msg){ if(pwIn) pwIn.value=""; toast(msg); }).catch(function(e){ toast(A.authMsg(e)); });
  },
  // which panel is open; remembered per device
  tab:function(t){
    state.tab=attr(t,"data-tab")||"book";
    try{ localStorage.setItem("smyrna.tab",state.tab); }catch(e){}
    touch();
  },
  // the season table in Settle Up: drill through to the bets behind a cell, and jump to one
  drill:function(t){ D.openDrill(attr(t,"data-m"),attr(t,"data-row")); },
  // Jump to a bet from a drill or the Rivals grid: the Book has to be open, and the
  // filters wide enough to show it, or the ticket isn't on the page to scroll to.
  goBet:function(t,id){
    document.getElementById("drillDlg").close();
    var b=B.findBet(id);
    if(b&&(state.tab!=="book"||(state.filter.status!=="all"&&state.filter.status!==b.status)||(state.filter.week!=="all"&&String(state.filter.week)!==String(b.week)))){
      state.tab="book"; state.filter.status="all"; state.filter.week="all";
      try{ localStorage.setItem("smyrna.tab","book"); }catch(e){}
      touch();
      setTimeout(function(){ showBet(id); },60);
      return;
    }
    showBet(id);
  },
  // notifications on this device: the nudge on the page, and "not now"
  push:function(){ D.pushToggle(); },
  pushLater:function(){ Nf.snooze(); touch(); },
  // Rivals: the bets between two managers, under the grid. Tapping the open cell closes it.
  rival:function(t){
    var a=attr(t,"data-a"), b=attr(t,"data-b");
    state.rival=(state.rival&&state.rival.a===a&&state.rival.b===b)?null:{ a:a, b:b };
    touch();
  },
  // phones: a ticket's Details / Less, and a ledger row's bet names
  fold:function(t,id){ state.unfolded[id]=!state.unfolded[id]; touch(); },
  seat:function(t,id){ state.unfolded["m:"+id]=!state.unfolded["m:"+id]; touch(); },
};

// data-act changes on selects and checkboxes
const CHANGES = {
  // Flag a manager as a test account: still signs in and can bet, but the league doesn't see it.
  testToggle:function(t){
    if(!state.admin){ t.checked=!t.checked; return toast("Only the admin can do that"); }
    var mm=member(attr(t,"data-id")); if(!mm) return;
    if(t.checked) mm.test=true; else delete mm.test;
    B.saveConfig(); D.drawRoster(); touch();
    toast(t.checked?mm.name+" is a test account":mm.name+" is a regular manager again");
  },
  admToggle:function(t){
    if(!state.admin){ t.checked=!t.checked; return toast("Only the admin can do that"); }
    var mm=member(attr(t,"data-id")); if(!mm) return;
    var list=adminEmails().filter(function(e){ return e!==emailFor(mm); });
    if(t.checked) list.push(emailFor(mm));
    if(!list.length){ t.checked=true; return toast("Keep at least one admin"); }
    state.config.adminEmails=list; B.saveConfig(); D.drawRoster();
    toast(t.checked?mm.name+" is an admin":mm.name+" is no longer an admin");
  },
  week:function(t){ state.filter.week=t.value; touch(); },
  dMem:function(t){
    var i=num(t,"data-i"), d=state.draft[i];
    if(state.admin){ d.memberId=t.value||(i===0?state.me:null); d.invite=null; }   // admin on: seat anyone outright
    else if(i>0&&!d.memberId) d.invite=t.value||null;   // row one is always you; accepted seats don't change
  }
};

function addMember(){
  if(!state.admin) return toast("Only the admin can do that");
  var n=document.getElementById("rNewName").value.trim();
  if(!n) return toast("Name required");
  state.config.members.push({ id:uid(), name:n,
    team:document.getElementById("rNewTeam").value.trim(),
    seasons:[shownSeason()],
    color:COLORS[state.config.members.length%COLORS.length] });
  document.getElementById("rNewName").value="";
  document.getElementById("rNewTeam").value="";
  D.drawRoster(); B.saveConfig();
}
function saveLeague(){
  if(!state.admin) return toast("Only the admin can do that");
  state.config.leagueName=document.getElementById("rName").value.trim()||state.config.leagueName;
  state.config.season=document.getElementById("rSeason").value.trim()||state.config.season;
  var s=parseFloat(document.getElementById("rStake").value);
  if(s>0) state.config.stake=Math.round(s*100)/100;
  var ko=new Date(document.getElementById("rKickoff").value);   // datetime-local reads as local time
  if(!isNaN(ko)) state.config.kickoff=ko.toISOString();
  B.saveConfig();
  document.getElementById("rosterDlg").close();
  toast("League saved");
}

// `enterBook(user)` is app.js's: sign-in hands the user there to open the book.
export function bindEvents(hooks){
  var on=function(id,ev,fn){ document.getElementById(id).addEventListener(ev,fn); };

  document.addEventListener("click",function(ev){
    var t=ev.target.closest("[data-act]");
    if(!t){   // a tap on a folded ticket, away from any control, opens it
      var tk=ev.target.closest("article.ticket.fold");
      if(tk&&!ev.target.closest("button,a,select,input,label")){ state.unfolded[attr(tk,"data-bet")]=true; touch(); }
      return;
    }
    var fn=ACTIONS[attr(t,"data-act")];
    if(fn) fn(t,attr(t,"data-id"));
  });
  document.addEventListener("change",function(ev){
    var t=ev.target, act=t.getAttribute&&attr(t,"data-act");
    if(act&&CHANGES[act]) return CHANGES[act](t);
    if(t.id==="bWeek"&&state.draftScope==="game"){ state.draftGame=null; state.draftFav=""; state.draft.forEach(function(e){ e.side=""; }); F.drawGameBox(); F.drawEntries(); }
    else if(t.id==="bGame"){
      var gid=t.value, pick=null;
      allGames().forEach(function(g){ if(g.id===gid) pick=g; });
      state.draftGame=pick?{ id:pick.id, week:pick.week, away:pick.away, home:pick.home, date:pick.date }:null;
      state.draftFav=""; state.draftLine=""; state.draft.forEach(function(e){ e.side=""; });
      F.prefillLine();
      var nm=document.getElementById("bName");
      if(pick&&!nm.value.trim()) nm.value=pick.away+" @ "+pick.home;
      F.drawGameBox(); F.drawEntries();
    }
  });
  document.addEventListener("input",function(ev){
    var t=ev.target, act=t.getAttribute&&attr(t,"data-act");
    if(act==="dPick") state.draft[num(t,"data-i")].pick=t.value;
    else if(act==="dSearch") F.drawSugg(num(t,"data-i"),t.value);
    else if(t.id==="bLine"){ state.draftLine=t.value.trim(); if(state.draftMarket==="total") F.drawEntries(); }
  });
  document.addEventListener("keydown",function(ev){
    var t=ev.target;
    if(ev.key==="Enter"&&t.getAttribute&&attr(t,"data-act")==="dSearch"){
      ev.preventDefault();
      var first=document.querySelector("#sugg"+attr(t,"data-i")+" button");
      if(first) F.addPick(num(t,"data-i"),first.getAttribute("data-id"));
    }
  });

  on("newBetBtn","click",function(){ F.openBetDlg(); });
  // the menu behind your name: open on the button, close on anything else
  var drop=document.getElementById("meDrop"), meBtn=document.getElementById("meBtn");
  var closeMenu=function(){ drop.hidden=true; meBtn.setAttribute("aria-expanded","false"); };
  on("meBtn","click",function(ev){ ev.stopPropagation(); drop.hidden=!drop.hidden; meBtn.setAttribute("aria-expanded",String(!drop.hidden)); });
  document.addEventListener("click",function(ev){ if(!drop.hidden&&!ev.target.closest("#meDrop")) closeMenu(); });
  drop.addEventListener("click",function(ev){ if(ev.target.closest("button")) closeMenu(); });
  document.addEventListener("keydown",function(ev){ if(ev.key==="Escape"&&!drop.hidden) closeMenu(); });
  on("betDlg","close",function(){ state.editId=null; });
  on("refreshBtn","click",B.requestRefresh);
  on("rosterBtn","click",D.openRoster);
  on("pushBtn","click",D.pushToggle);
  on("bSave","click",function(e){ e.preventDefault(); F.submitBet(); });
  on("jSave","click",function(e){ e.preventDefault(); F.submitJoin(); });
  on("joinDlg","close",function(){ state.joinId=null; });
  on("bAddSide","click",function(e){
    e.preventDefault();
    if(state.draft.length>=8) return toast("Eight sides is plenty");
    state.draft.push({memberId:null,pick:""}); F.drawEntries();
  });
  on("signOutBtn","click",function(){ A.signOut().then(function(){ location.reload(); }); });
  on("pwBtn","click",D.openPasswordDlg);
  on("adminBtn","click",hooks.toggleAdmin);
  on("pwGo","click",function(e){ e.preventDefault(); D.changeOwnPassword(); });
  on("pwDlg","cancel",function(e){ if(state.mustChange) e.preventDefault(); });
  on("siForm","submit",function(e){ e.preventDefault(); D.submitLogin(hooks.enterBook); });
  on("siReset","click",D.startOver);
  ["siName","siPw","siKey"].forEach(function(id){ on(id,"keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); D.submitLogin(hooks.enterBook); } }); });
  on("rAdd","click",function(e){ e.preventDefault(); addMember(); });
  on("rSync","click",function(e){ e.preventDefault(); B.requestRosterSync(); });
  on("rSave","click",function(e){ e.preventDefault(); saveLeague(); });
}
