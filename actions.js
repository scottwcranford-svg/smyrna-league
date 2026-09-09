// What a click, change or keystroke does. Buttons carry data-act="…"; ACTIONS maps
// each to a function, so adding a button is one row here, not another branch in a
// chain. bindEvents() runs once at boot with what it needs from app.js.

import * as R from "./rules.js?v=dev";
import * as A from "./auth.js?v=dev";
import { state, members, touch } from "./state.js?v=dev";
import { toast } from "./render.js?v=dev";
import * as B from "./book.js?v=dev";
import * as F from "./forms.js?v=dev";
import * as D from "./dialogs.js?v=dev";

const COLORS=R.COLORS, uid=R.uid, defaultPw=R.defaultPw, emailFor=R.emailFor;
const member=function(id){ return R.member(id,members()); };
const adminEmails=function(){ return R.adminEmails(state.config); };
const allGames=function(){ return R.allGames(state.games); };
const attr=function(t,n){ return t.getAttribute(n); };
const num=function(t,n){ return Number(t.getAttribute(n)); };

// data-act clicks. Each gets the element and its data-id.
export const ACTIONS = {
  filter:function(t){ state.filter.status=attr(t,"data-status"); touch(); },
  mine:function(){ state.filter.mine=!state.filter.mine; touch(); },
  publishLeague:function(){ B.publishLeague(); },
  take:function(t,id){ B.takeSeat(id,num(t,"data-i")); },
  accept:function(t,id){ B.takeSeat(id,num(t,"data-i")); },
  pass:function(t,id){ B.passSeat(id,num(t,"data-i")); },
  settle:function(t,id){ D.openSettleDlg(id); },
  edit:function(t,id){ F.openBetDlg(id); },
  join:function(t,id){ F.openJoinDlg(id); },
  paidPair:function(t){ B.markPairPaid(attr(t,"data-from"),attr(t,"data-to")); },
  paidOne:function(t,id){ if(B.guard()){ B.markPaid(id,attr(t,"data-m")); toast("Marked paid"); } },
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
    state.draftMarket=attr(t,"data-market")==="total"?"total":"ml";
    state.draft.forEach(function(e){ e.side=""; });
    F.drawGameBox(); F.drawEntries();
  },
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
  }
};

// data-act changes on selects and checkboxes
const CHANGES = {
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
    if(i>0&&!d.memberId) d.invite=t.value||null;   // row one is always you; accepted seats don't change
  }
};

function addMember(){
  if(!state.admin) return toast("Only the admin can do that");
  var n=document.getElementById("rNewName").value.trim();
  if(!n) return toast("Name required");
  state.config.members.push({ id:uid(), name:n,
    team:document.getElementById("rNewTeam").value.trim(),
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
    var t=ev.target.closest("[data-act]"); if(!t) return;
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
  on("betDlg","close",function(){ state.editId=null; });
  on("refreshBtn","click",B.requestRefresh);
  on("rosterBtn","click",D.openRoster);
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
  on("pwGo","click",function(e){ e.preventDefault(); D.changeOwnPassword(); });
  on("pwDlg","cancel",function(e){ if(state.mustChange) e.preventDefault(); });
  on("siForm","submit",function(e){ e.preventDefault(); D.submitLogin(hooks.enterBook); });
  on("siReset","click",D.startOver);
  ["siName","siPw","siKey"].forEach(function(id){ on(id,"keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); D.submitLogin(hooks.enterBook); } }); });
  on("rAdd","click",function(e){ e.preventDefault(); addMember(); });
  on("rSave","click",function(e){ e.preventDefault(); saveLeague(); });
  // The login card is in the HTML and shows before these modules have loaded; its
  // button stays disabled until this point so a fast tap can't go nowhere.
  document.getElementById("siGo").disabled=false;
}
