// Drawing the page from state: header, ticker, banner, ledger board, settle-up
// list, filters, tickets, the stats strip and the footer. Reads state, writes the
// DOM, never the book. forms.js and actions.js are the other DOM writers.

import * as Fmt from "./fmt.js?v=dev";
import * as Clock from "./clock.js?v=dev";
import * as Id from "./identity.js?v=dev";
import * as Roster from "./roster.js?v=dev";
import * as Sched from "./schedule.js?v=dev";
import * as Stats from "./stats.js?v=dev";
import * as Ledger from "./ledger.js?v=dev";
import * as Bets from "./bets.js?v=dev";
import * as Rivals from "./rivals.js?v=dev";
import * as Sn from "./seasons.js?v=dev";
import * as Keep from "./keepers.js?v=dev";
import * as Badges from "./badges.js?v=dev";
import { state, members, realMembers, teamOf, touch , seasonCfg } from "./state.js?v=dev";
import * as Nf from "./notify.js?v=dev";

// Under 600px the page takes its phone shape (styles.css does most of it; this is the
// markup that differs: folded tickets and ledger rows, the season table by manager).
export function phone(){ try{ return window.matchMedia("(max-width: 600px)").matches; }catch(e){ return false; } }

const esc=Fmt.esc, money=Fmt.money, signed=Fmt.signed, initials=Fmt.initials, weekLabel=Fmt.weekLabel, isPlayoff=Clock.isPlayoff,
      kindLabel=Fmt.kindLabel, entriesOf=Fmt.entriesOf, fmtWhen=Fmt.fmtWhen, countdown=Fmt.countdown, lineText=Bets.lineText,
      coverSide=Bets.coverSide, ago=Fmt.ago;
const member=function(id){ return Id.member(id,members()); };
const mName=function(id){ return Id.mName(id,members()); };
const mColor=function(id){ return Id.mColor(id,members()); };
const betLock=function(b){ return Clock.betLock(b,seasonCfg()); };
const isLocked=function(b){ return Clock.isLocked(b,seasonCfg()); };
const gameOf=function(b){ return Bets.gameOf(b,state.games); };
const currentWeek=function(){ return Clock.currentWeek(seasonCfg(),state.games); };
const computeLedger=function(){ return Ledger.computeLedger(seasonCfg(),state.bets); };

export function render(){ head(); ticker(); banner(); tabs(); glance(); badgesView(); board(); leagueView(); rivalsView(); settle(); filters(); tickets(); statsBar(); foot(); }

var toastTimer=null;
export function toast(msg){
  var t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ t.classList.remove("show"); },2600);
}

// Circular initials avatar — the recurring identity mark, the way Sleeper tags a manager everywhere.
export function avatarHtml(id,size){
  size=size||28;
  var m=member(id);
  var fs=Math.round(size*0.38);
  if(!m) return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:var(--ink-3);font-size:'+fs+'px">?</span>';
  // The manager's Sleeper avatar when the book has one; their initials otherwise.
  var hash=state.sleeper&&state.sleeper.byId&&state.sleeper.byId[id]?state.sleeper.byId[id].avatar:"";
  if(hash) return '<img class="avatar" src="https://sleepercdn.com/avatars/thumbs/'+esc(hash)+'" width="'+size+'" height="'+size+'" alt="" data-tip="'+esc(m.name)+'" style="width:'+size+'px;height:'+size+'px">';
  return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:'+esc(m.color)+';font-size:'+fs+'px">'+esc(initials(m.name))+"</span>";
}
// An NFL team's logo from Sleeper's CDN, by team code; nothing for over/under, free agents or blanks.
export function logoHtml(code,size){
  code=String(code||"").trim().toUpperCase(); if(!/^[A-Z]{2,3}$/.test(code)||code==="FA") return "";
  size=size||16;
  return '<img class="tlogo" src="https://sleepercdn.com/images/team_logos/nfl/'+code.toLowerCase()+'.png" width="'+size+'" height="'+size+'" alt="" loading="lazy">';
}
// Logos for a team tag that may hold several codes ("CIN · MIN" on a combined pick).
function teamLogos(text,size){ return String(text||"").split(" · ").map(function(c){ return logoHtml(c,size); }).join(""); }
// Status tags for a pick id: Q, OUT, IR… from the roster as it is now, not as it was when the bet was made.
export function statusTagsHtml(id){
  return Roster.statusOf(id,state.roster).map(function(c){
    var hard=c==="Q"?"soft":"hard";
    // the tag reads as a bare letter, so the full word rides along for screen readers
    // as well as in the tip — `title` used to do both jobs
    var label=Roster.STATUS_LABEL[c]||c;
    return '<span class="st-tag '+hard+'" data-tip="'+esc(label)+'" aria-label="'+esc(label)+'">'+esc(c)+"</span>";
  }).join("");
}

export function openAvatarHtml(size){
  size=size||28;
  return '<span class="avatar open" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*0.5)+'px">+</span>';
}

// Tick the countdowns; once one passes, redraw so its Edit/Take buttons go away.
setInterval(function(){
  var passed=false;
  document.querySelectorAll(".lock-when[data-lock]").forEach(function(el){
    var t=Number(el.getAttribute("data-lock"));
    if(Date.now()>=t) passed=true; else el.textContent="Locks in "+countdown(t);
  });
  if(passed) touch();
},10000);

/* ---- games ticker ----
   The current week's slate, written into league/games by the refresh. Before
   kickoff: matchup and time. During: score, quarter, clock. After: the score and Final. */
function fmtKick(t){
  var d=new Date(t);
  try{ return d.toLocaleString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"}); }catch(e){ return ""; }
}
export function ticker(){
  var el=document.getElementById("ticker");
  var G=state.games&&Array.isArray(state.games.games)?state.games.games:[];
  if(!G.length){ el.hidden=true; return; }
  var w=currentWeek(), now=Date.now();
  var slate=G.filter(function(g){ return g.week===w; }).sort(Clock.byKickoff);
  if(!slate.length){ el.hidden=true; return; }
  var items='<span class="tk-wk">Week '+w+"</span>"+slate.map(function(g){
    var t=Date.parse(g.date), scored=g.awayScore!=null&&g.homeScore!=null;
    var st=g.status||(scored?"final":(now>=t?"live":"pre"));
    if(st==="final"&&scored){
      var aw=g.awayScore>g.homeScore, hw=g.homeScore>g.awayScore;
      return '<span class="game"><span class="tm '+(aw?"win":"lose")+'">'+logoHtml(g.away,14)+esc(g.away)+' <b class="sc">'+g.awayScore+"</b></span>"+
        '<span class="at">·</span><span class="tm '+(hw?"win":"lose")+'">'+logoHtml(g.home,14)+esc(g.home)+' <b class="sc">'+g.homeScore+"</b></span>"+
        '<span class="final">Final'+(g.ot?" · OT":"")+"</span></span>";
    }
    if(st==="live"){
      // score as of the last refresh, plus quarter, clock and who has the ball
      var qlabel=g.ot?"OT":(g.q?"Q"+g.q:(g.ql||""));
      var poss=function(team){ return g.pos===team?' <span class="ball'+(g.rz?" rz":"")+'">◀</span>':""; };
      return '<span class="game"><span class="tm">'+logoHtml(g.away,14)+esc(g.away)+(scored?' <b class="sc">'+g.awayScore+"</b>":"")+poss(g.away)+"</span>"+
        '<span class="at">·</span><span class="tm">'+logoHtml(g.home,14)+esc(g.home)+(scored?' <b class="sc">'+g.homeScore+"</b>":"")+poss(g.home)+"</span>"+
        '<span class="live">'+esc((qlabel+" "+(g.clock||"")).trim()||"Live")+"</span></span>";
    }
    // before kickoff, what Vegas has on it — the same numbers the propose form prefills
    var L=Sched.lineFor(g,state.lines), sm=L?Sched.lineSummary(L):"";
    // inside the hour, the clock matters more than the date
    var soon=Clock.kicksSoon(g,now);
    return '<span class="game'+(soon?" soon":"")+'"><span class="tm">'+logoHtml(g.away,14)+esc(g.away)+'</span><span class="at">@</span><span class="tm">'+logoHtml(g.home,14)+esc(g.home)+"</span>"+
      (soon?'<span class="kick">Kicks in '+esc(countdown(t))+"</span>":'<span class="when">'+esc(fmtKick(t))+"</span>")+
      (sm?'<span class="odds">'+esc(sm)+"</span>":"")+"</span>";
  }).join("");
  // two copies make the loop seamless; speed scales with how much is on the strip
  el.style.setProperty("--tick",Math.max(30,slate.length*5)+"s");
  el.innerHTML='<div class="ticker-track">'+items+items+"</div>";
  el.hidden=false;
}

function head(){
  var c=state.config, league=state.sleeper&&state.sleeper.league;
  document.getElementById("leagueName").textContent=c?c.leagueName:"Smyrna League";
  // the league's settings line, Sleeper's way: "2026 · 10-Team Keeper SF PPR · side bets"
  var shown=Sn.shownSeasonOf(state), current=Sn.currentSeason(c);
  // league/sleeper holds the *current* league's settings, so "10-Team Keeper SF PPR" is
  // this year's and we have no record of an older year's. Reading 2026 therefore shows the
  // year and nothing it cannot vouch for.
  var line=shown===current?Roster.leagueLine(league,shown):String(shown);
  document.getElementById("leagueSub").textContent=(line?line+" · ":"")+(shown===current?"side bets":"closed · read only");
  // The picker only appears once there is more than one season to pick.
  var seasons=Sn.seasonList(c,state.allBets), pick=document.getElementById("seasonPick");
  var sel=document.getElementById("seasonSel");
  pick.hidden=seasons.length<2;
  if(!pick.hidden){
    var want=seasons.join("|");
    if(sel.getAttribute("data-built")!==want){
      sel.innerHTML=seasons.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+(s===current?" · now":"")+"</option>"; }).join("");
      sel.setAttribute("data-built",want);
    }
    sel.value=shown;
  }
  // the league's own Sleeper avatar when it has one; our football mark otherwise
  var mark=document.getElementById("leagueBadge");
  if(league&&league.avatar&&!mark.querySelector("img")) mark.innerHTML='<img src="https://sleepercdn.com/avatars/thumbs/'+esc(league.avatar)+'" alt="">';

  // who's signed in (identity comes from Firebase Auth, never a dropdown): one button, a menu behind it
  var signed=!!state.me;
  var nm=document.getElementById("meName"); nm.textContent=signed?mName(state.me):"Not signed in";
  document.getElementById("meAvatar").innerHTML=signed?avatarHtml(state.me,26):"";
  document.getElementById("meBtn").classList.toggle("admin-on",!!state.admin);
  document.getElementById("signOutBtn").hidden=!signed;
  document.getElementById("pwBtn").hidden=!signed;
  var adm=document.getElementById("adminBtn");
  adm.hidden=!(signed&&state.isAdmin);
  adm.setAttribute("aria-pressed",String(!!state.admin));
  adm.textContent=state.admin?"Admin on":"Admin off";
  // notifications on this device: the label says where they stand; the tap is in dialogs.pushToggle
  var pb=document.getElementById("pushBtn"), ps=Nf.status();
  pb.hidden=!signed||state.local||ps==="unsupported";
  pb.setAttribute("data-push",ps); pb.textContent=Nf.label(ps);
}

// The tab row: which panel is open, and a badge where something needs a look.
function tabs(){
  var L=computeLedger(), HL=Ledger.hlTally(state.highlow,members(),Ledger.hlStake(seasonCfg()));
  var seats=0;
  state.bets.forEach(function(b){ if(b.status==="open"&&!isLocked(b)) entriesOf(b).forEach(function(e){ if(!e.memberId&&(!e.invite||e.declined)) seats++; }); });
  var Bal=Ledger.balances(seasonCfg(),state.bets,state.highlow,state.payments&&state.payments.list,Ledger.hlStake(seasonCfg()));
  // Rivals badges the pairs you're behind on — the rivalries to fix.
  var RV=Rivals.rivals(realMembers().filter(function(m){ return !m.test; }),state.bets), owed=0;
  if(state.me&&RV.byId[state.me]) Object.keys(RV.byId[state.me]).forEach(function(b){ if(RV.byId[state.me][b].net<0) owed++; });
  // Badges badges how many titles you're holding right now
  var mineBadges=0;
  if(state.me) badgeList().forEach(function(b){ if((b.holders||[]).indexOf(state.me)>=0) mineBadges++; });
  var badge={ book:seats, ledger:0, badges:mineBadges, league:HL.weeks.length, rivals:owed, settle:Bal.transfers.length };
  Object.keys(badge).forEach(function(k){ var n=document.getElementById("tabN-"+k); if(!n) return; n.hidden=!badge[k]; n.textContent=badge[k]; });
  var cur=state.tab||"book";
  document.querySelectorAll("#tabs .tab").forEach(function(t){ var on=t.getAttribute("data-tab")===cur; t.classList.toggle("on",on); t.setAttribute("aria-selected",String(on)); });
  document.querySelectorAll("section[data-panel]").forEach(function(s){ s.hidden=s.getAttribute("data-panel")!==cur; });
}

// The Book's one-line strip: the league and you, at a glance.
function glance(){
  var L=computeLedger(), live=0, pot=0, mineOpen=0;
  state.bets.forEach(function(b){
    if(b.status!=="active"&&b.status!=="open") return;
    live++; pot+=(Number(b.amount)||0)*entriesOf(b).filter(function(e){ return e.memberId; }).length;
    if(b.status==="open"&&state.me&&b.createdBy===state.me&&!isLocked(b)) entriesOf(b).forEach(function(e){ if(!e.memberId) mineOpen++; });
  });
  var parts=['<span><b>'+live+"</b> "+(live===1?"bet":"bets")+" running</span>",'<span><b>'+esc(money(pot))+"</b> on the table</span>"];
  if(state.me){
    var Bg=Ledger.balances(seasonCfg(),state.bets,state.highlow,state.payments&&state.payments.list,Ledger.hlStake(seasonCfg()));
    var net=(Bg.byId[state.me]||{}).net||0;
    parts.push('<span>you <b class="'+(net>0?"pos":net<0?"neg":"")+'">'+esc(signed(net))+"</b> net"+
      (mineOpen?' · <b class="warn">'+mineOpen+(mineOpen===1?" seat":" seats")+"</b> waiting on takers":"")+"</span>");
  }
  document.getElementById("glanceTxt").innerHTML=parts.join("");
}

function banner(){
  var el=document.getElementById("banner"), h="";
  if(!state.ready){
    h='<div class="banner"><span class="lbl">Connecting</span><p>Reaching the shared book…</p></div>';
  } else if(!state.connected){
    h='<div class="banner"><span class="lbl">Preview</span><p>Can’t reach the book’s server, so nothing you do here is saved. Reload once it’s back, or open the league link.</p></div>';
  } else if(state.local){
    h='<div class="banner"><span class="lbl">Not saved yet</span><p>The shared book is empty. Publish this league and its opening bets so everyone sees the same ledger.</p>'+
      '<button class="btn pri" data-act="publishLeague">Publish it</button></div>';
  } else if(!state.me){
    h='<div class="banner"><span class="lbl">Read only</span><p>Sign in with your name and the password from the admin to take bets, post your own, and settle up. This device remembers you.</p>'+
      '<button class="btn pri" data-act="signin">Sign in</button></div>';
  } else if(Nf.nudge()){
    h='<div class="banner"><span class="lbl">Heads up</span><p>Get a buzz when a bet is proposed, taken or settled, and when the week’s high and low are in.'+
      (Nf.status()==="install"?" On an iPhone that means adding the app to your home screen first.":"")+'</p>'+
      '<span class="btns"><button class="btn pri" data-act="push">'+(Nf.status()==="install"?"Show me":"Turn on")+'</button><button class="btn" data-act="pushLater">Not now</button></span></div>';
  }
  el.innerHTML=h;
}

// Week by week: who topped the league on Sleeper and who finished last, and what moved.
// ---- the Draft board, and who can be kept next year ----

const POSCOL={ QB:"var(--loss)", RB:"var(--accent)", WR:"var(--open)", TE:"var(--gold)" };
function posTag(p){ return '<span class="dpos" style="color:'+(POSCOL[p]||"var(--ink-3)")+'">'+esc(p||"")+"</span>"; }

// A pick's manager: the draft carries its own roster map, so a manager who left the app
// still reads as themselves.
function draftName(D,rid){ return (D&&D.byRoster&&D.byRoster[rid])||(D&&D.byRoster&&D.byRoster[String(rid)])||"Roster "+rid; }

function draftByManager(D){
  var by={}, order=[];
  (D.picks||[]).forEach(function(p){
    var who=draftName(D,p.roster);
    if(!by[who]){ by[who]=[]; order.push(who); }
    by[who].push(p);
  });
  return '<div class="dmgrs">'+order.map(function(who){
    var ps=by[who], kept=ps.filter(function(p){ return p.keeper; }).length;
    var got=ps.filter(function(p){ return p.from!=null; }).length;
    var meta=[kept?kept+" kept":"",got?got+" traded in":""].filter(Boolean).join(" · ");
    return '<div class="dmgr"><div class="dhead"><b>'+esc(who)+"</b><span>"+esc(meta)+"</span></div>"+
      '<ol class="dpicks">'+ps.map(function(p){
        return "<li><span class='dno'>"+p.r+"."+(p.p<10?"0":"")+p.p+"</span>"+
          "<span class='dnm'>"+esc(p.name||"—")+"</span>"+posTag(p.pos)+
          (p.keeper?'<span class="dkept">KEPT</span>':"")+
          (p.from!=null?'<span class="dfrom">from '+esc(draftName(D,p.from))+"</span>":"")+"</li>";
      }).join("")+"</ol></div>";
  }).join("")+"</div>";
}

function draftBoard(D){
  var rounds={}, order=[];
  (D.picks||[]).forEach(function(p){ if(!rounds[p.r]){ rounds[p.r]=[]; order.push(p.r); } rounds[p.r].push(p); });
  order.sort(function(a,b){ return a-b; });
  return '<div class="dgrid">'+order.map(function(r){
    return '<div class="drow"><span class="drlab">R'+r+'</span><div class="dcells">'+
      rounds[r].map(function(p){
        return '<div class="dcell'+(p.keeper?" kept":"")+'"><span class="dno">'+p.r+"."+(p.p<10?"0":"")+p.p+"</span>"+
          "<b>"+esc(p.name||"—")+"</b><span class='dwho'>"+esc(draftName(D,p.roster))+"</span>"+posTag(p.pos)+
          (p.from!=null?'<span class="dfrom">from '+esc(draftName(D,p.from))+"</span>":"")+"</div>";
      }).join("")+"</div></div>";
  }).join("")+"</div>";
}

// The roster as it stands, and what each player would cost to keep next year. The draft
// says what happened; this says what you have and what you can do with it, which is the
// question anyone actually opens the app with in February.
function rosterView(){
  var host=document.getElementById("rosterView"), note=document.getElementById("rosterNote");
  var sel=document.getElementById("rosterOf");
  var S=state.squads, D=state.draft;
  if(!S||!S.rosters||!Object.keys(S.rosters).length){
    host.innerHTML='<div class="empty">Rosters haven’t arrived yet — they come with the next refresh.</div>';
    note.textContent=""; sel.innerHTML=""; return;
  }
  var ids=Object.keys(S.rosters).sort(function(a,b){ return Number(a)-Number(b); });
  var nameOfTeam=function(rid){ return (S.byRoster&&(S.byRoster[rid]||S.byRoster[String(rid)]))||"Roster "+rid; };
  // default to your own team, so the view opens on the question you asked
  var mine=null;
  if(state.me){ var me=Id.member(state.me,members()); if(me) ids.forEach(function(rid){ if(nameOfTeam(rid)===me.name) mine=rid; }); }
  var want=state.rosterOf&&ids.indexOf(String(state.rosterOf))>=0?String(state.rosterOf):(mine||ids[0]);
  var built=ids.join("|");
  if(sel.getAttribute("data-built")!==built){
    sel.innerHTML=ids.map(function(rid){ return '<option value="'+esc(rid)+'">'+esc(nameOfTeam(rid))+(rid===mine?" · you":"")+"</option>"; }).join("");
    sel.setAttribute("data-built",built);
  }
  sel.value=want;

  var players=S.rosters[want]||[], starters=(S.starters&&S.starters[want])||[];
  var onField={}; starters.forEach(function(p){ onField[p]=1; });
  var nameOf=function(pid){
    var row=Roster.rosterFind(pid,state.roster);
    return row?{ name:row[1], pos:row[2], team:row[3] }:{ name:pid, pos:"", team:"" };
  };
  var byPlayer=(D&&D.byPlayer)||{}, prev=(D&&D.keptPrev)||{};
  var kept={}; Object.keys(byPlayer).forEach(function(pid){ if(byPlayer[pid].keeper) kept[pid]=1; });
  var rows=Keep.eligible(players,byPlayer,kept,prev,nameOf);
  rows.forEach(function(r){ r.start=!!onField[r.id]; r.team=nameOf(r.id).team; });

  var order={ QB:0, RB:1, WR:2, TE:3, K:4, DEF:5 };
  rows.sort(function(a,b){ return (order[a.pos]==null?9:order[a.pos])-(order[b.pos]==null?9:order[b.pos])||a.name.localeCompare(b.name); });

  var line=function(r){
    var cost=r.band==="wire"?"9/10":(r.cost!=null?"R"+r.cost:"—");
    var tag=r.band?'<span class="rkeep '+esc(r.band)+'">'+(r.band==="wire"?"WAIVER":r.band==="early"?"3–9":"10–16")+"</span>"
                  :'<span class="rno" data-tip="'+esc(r.why||"not eligible")+'">—</span>';
    return '<li'+(r.start?' class="start"':"")+'><span class="rpos" style="color:'+(POSCOL[r.pos]||"var(--ink-3)")+'">'+esc(r.pos||"")+"</span>"+
      '<span class="rnm">'+esc(r.name)+"</span>"+
      '<span class="rteam">'+esc(r.team||"")+"</span>"+
      '<span class="rcost">'+esc(cost)+"</span>"+tag+
      (r.years===1?'<span class="dyr">yr 2</span>':"")+"</li>";
  };
  var can=rows.filter(function(r){ return r.band; });
  var early=can.filter(function(r){ return r.band==="early"; }).length;
  var late=can.filter(function(r){ return r.band==="late"; }).length;
  var wire=can.filter(function(r){ return r.band==="wire"; }).length;
  var spent=rows.filter(function(r){ return r.years>=2; });

  // Say the rule, not just the count. "8 eligible" means nothing without "keep 1 of them".
  var n=function(k,what){ return "<b>"+k+"</b> "+(k===1?what:what+"s"); };
  host.innerHTML='<div class="rsum"><span class="rlab">How keeping works</span>'+
      '<p>Keep up to <b>two</b>. One of the '+n(early,"player")+" you drafted in <b>rounds 3–9</b>, "+
      "and one of the "+n(late,"player")+" from <b>rounds 10–16</b>."+
      (wire?" A player you never drafted — "+n(wire,"here")+" — can take the <b>9th or 10th</b> slot instead.":"")+
      "</p><p class=\"rfine\">A keeper costs your pick in that round. Only one of the two may be a QB. "+
      "A player kept two seasons running goes back in the draft pool.</p></div>"+
    (spent.length?'<p class="dspent">Back in the pool next year: '+spent.map(function(r){ return esc(r.name); }).join(", ")+"</p>":"")+
    '<ol class="rlist">'+rows.map(line).join("")+"</ol>";
  note.textContent=esc(nameOfTeam(want))+" · "+rows.length+" players · "+starters.length+" starting"+
    (S.at?" · "+ago(S.at):"");
}

function draftView(){
  var host=document.getElementById("draft"), note=document.getElementById("draftNote");
  var D=state.draft;
  if(!D||!(D.picks||[]).length){
    host.innerHTML='<div class="empty">No draft in the book for '+esc(weekLabel(0)===""?"":"")+esc(Sn.shownSeasonOf(state))+" yet — it arrives with the next refresh.</div>";
    note.textContent=""; return;
  }
  var v=state.draftView||"mgr";
  document.querySelectorAll("#draftViews button").forEach(function(b){
    b.setAttribute("aria-pressed",String(b.getAttribute("data-dv")===v)); });
  host.innerHTML=v==="board"?draftBoard(D):draftByManager(D);
  var kept=(D.picks||[]).filter(function(p){ return p.keeper; }).length;
  var moved=(D.picks||[]).filter(function(p){ return p.from!=null; }).length;
  note.textContent=(D.picks||[]).length+" picks · "+(D.rounds||0)+" rounds"+(D.type?" · "+D.type:"")+
    (kept?" · "+kept+" kept":"")+(moved?" · "+moved+" traded":"");
}

// ---- Scores: the Sleeper league's own week, and the pool riding on it ----

// Which weeks can be looked at: everything the book has a board for, plus the week
// being played. Ascending, so the picker reads like a season.
function scoreWeeks(){
  var have={}, out=[];
  var W=(state.scores&&state.scores.weeks)||{};
  Object.keys(W).forEach(function(k){ var n=Number(k); if(n>0){ have[n]=1; } });
  var cw=currentWeek(); if(cw>0) have[cw]=1;
  Object.keys(have).forEach(function(k){ out.push(Number(k)); });
  return out.sort(function(a,b){ return a-b; });
}

// The week on screen: what was picked, if it still exists, else the current one.
function shownWeek(){
  var weeks=scoreWeeks();
  if(!weeks.length) return currentWeek();
  var want=state.scoreWeek;
  if(want!=null&&weeks.indexOf(Number(want))>=0) return Number(want);
  var cw=currentWeek();
  return weeks.indexOf(cw)>=0?cw:weeks[weeks.length-1];
}

function weekPicker(){
  var host=document.getElementById("weekPick"), weeks=scoreWeeks(), cur=shownWeek();
  var W=(state.scores&&state.scores.weeks)||{};
  host.innerHTML=weeks.map(function(w){
    var e=W[String(w)], live=e&&!e.final&&w===currentWeek();
    return '<button type="button" class="chip'+(live?" live":"")+'" data-act="scoreWeek" data-w="'+w+'" aria-pressed="'+(w===cur)+'">'+
      esc(weekLabel(w))+(live?'<i class="n">live</i>':"")+"</button>";
  }).join("");
}

function boardSide(r,best,lead){
  var pct=best>0?Math.max(2,Math.round((Number(r.pts)||0)/best*100)):0;
  var played=(Number(r.pts)||0)>0;
  var face=r.id?avatarHtml(r.id,22):'<span class="avatar" aria-hidden="true">'+esc(initials(r.name))+"</span>";
  return '<div class="sb-side'+(lead?" lead":"")+(played?"":" idle")+'">'+
    '<span class="sb-who">'+face+'<span class="sb-name">'+esc(r.id?mName(r.id):r.name)+"</span></span>"+
    (played?'<span class="sb-pts">'+esc(String(r.pts))+"</span>"
           :'<span class="sb-idle">Yet to play</span>')+
    (r.proj!=null?'<span class="sb-proj" data-tip="Projected from the starters’ published numbers">proj '+esc(String(r.proj))+"</span>":'<span class="sb-proj"></span>')+
    '<span class="sb-bar'+(played?"":" none")+'">'+(played?'<i style="width:'+pct+'%"></i>':"")+"</span></div>";
}

// The League tab: this week's scores, or the draft behind the season.
function leagueView(){
  var lt=state.leagueTab||"scores";
  document.querySelectorAll("#leagueTabs button").forEach(function(b){
    b.setAttribute("aria-pressed",String(b.getAttribute("data-lt")===lt)); });
  document.querySelectorAll("[data-lview]").forEach(function(v){
    v.hidden=v.getAttribute("data-lview")!==lt; });
  if(lt==="draft") draftView(); else if(lt==="roster") rosterView(); else scoresView();
}

function scoresView(){
  var host=document.getElementById("scores"), note=document.getElementById("scoresNote");
  var stake=Ledger.hlStake(seasonCfg()), HL=Ledger.hlTally(state.highlow,members(),stake);
  weekPicker();
  var w=shownWeek(), E=(state.scores&&state.scores.weeks)?state.scores.weeks[String(w)]:null;
  var rows=(E&&Array.isArray(E.rows))?E.rows:[];
  var head="";
  if(!rows.length){
    head='<div class="empty">No scores for '+esc(weekLabel(w))+" yet — they arrive with the next refresh. Each week the top Sleeper score takes "+money(stake)+" from the bottom.</div>";
  } else {
    var played=rows.filter(function(r){ return (Number(r.pts)||0)>0; });
    var best=0; rows.forEach(function(r){ if((Number(r.pts)||0)>best) best=Number(r.pts)||0; });
    // the pool for this week: settled once every game is final, running before that
    var hl=Ledger.highLow(played);
    var pool="";
    if(hl){
      var side=function(list,cls,lab,amt){
        var n=list.length;
        return '<div class="sb-pool '+cls+'"><span class="sb-pool-lab">'+lab+(E.final?"":" so far")+"</span>"+
          '<span class="sb-pool-who">'+list.map(function(r){ return esc(r.id?mName(r.id):r.name); }).join(" · ")+"</span>"+
          '<span class="sb-pool-pts">'+esc(String(list[0].pts))+" pts · <b>"+signed(amt/n)+"</b></span></div>";
      };
      pool='<div class="sb-pools">'+side(hl.high,"hi","High",stake)+side(hl.low,"lo","Low",-stake)+"</div>";
    }
    // pair the sides on Sleeper's own matchup id; anything unpaired stands alone
    var by={}, order=[];
    rows.forEach(function(r){ var k=r.mid==null?("x"+r.name):String(r.mid); if(!by[k]){ by[k]=[]; order.push(k); } by[k].push(r); });
    var games=order.map(function(k){
      // ahead in this matchup, not on the whole board: a side is only leading the
      // manager across from it, and a tie leads nobody
      var top=-1, tied=false;
      by[k].forEach(function(r){ var v=Number(r.pts)||0; if(v>top){ top=v; tied=false; } else if(v===top) tied=true; });
      return '<div class="sb-game">'+by[k].map(function(r){
        return boardSide(r,best,!tied&&top>0&&(Number(r.pts)||0)===top);
      }).join("")+"</div>";
    }).join("");
    head=pool+'<div class="sb-games">'+games+"</div>";
  }
  // the season-long pool standings keep their place under the week
  var standing=realMembers().filter(function(m){ return !m.test; }).map(function(m){ return { m:m, t:HL.byId[m.id]||{ net:0, highs:0, lows:0 } }; })
    .sort(function(a,b){ return (b.t.net-a.t.net)||(b.t.highs-a.t.highs)||a.m.name.localeCompare(b.m.name); });
  var strip=HL.weeks.length?'<div class="track-title" style="margin-top:18px">Hi / low, all season</div><div class="hl-standings">'+standing.map(function(s){
    return '<div class="hl-stand'+(s.m.id===state.me?" me":"")+'">'+avatarHtml(s.m.id,22)+'<span class="hl-name">'+esc(s.m.name)+"</span>"+
      '<b class="'+(s.t.net>0?"pos":s.t.net<0?"neg":"flat")+'">'+signed(s.t.net)+"</b>"+
      '<small>'+s.t.highs+" hi · "+s.t.lows+" low</small></div>";
  }).join("")+"</div>":"";
  host.innerHTML=head+strip;
  var when=E&&E.at?" · updated "+ago(E.at):"";
  note.textContent=rows.length
    ? weekLabel(w)+" · "+(E.final?"final":"in progress")+" · "+money(stake)+" a week"+when
    : money(stake)+" a week, top score takes it from the bottom.";
}

function board(){
  var L=computeLedger();
  var list=realMembers().filter(function(m){ return !m.test; });   // not even yourself: the board is the league's
  var host=document.getElementById("board");
  if(!list.length){
    host.className=""; host.innerHTML='<div class="empty">No managers yet.</div>';
    document.getElementById("boardNote").textContent=""; return;
  }
  host.className="board";
  list.sort(function(a,b){
    var d=L.pnl[b.id].net-L.pnl[a.id].net; if(d) return d;
    var ra=(L.risk[b.id]||0)-(L.risk[a.id]||0); if(ra) return ra;
    return a.name.localeCompare(b.name);
  });
  var worn={};
  badgeList().forEach(function(b){ (b.holders||[]).forEach(function(id){ if(!worn[id]) worn[id]=[]; worn[id].push(b); }); });
  host.innerHTML=list.map(function(m){
    var p=L.pnl[m.id], played=p.w+p.l+p.p;
    var cls=p.net>0?"pos":p.net<0?"neg":"flat";
    var inPlay=L.risk[m.id]||0, proposed=L.offered[m.id]||0, gone=L.cancelled[m.id]||0;
    var mine=L.picks[m.id]||[];
    var fig=function(cls,v,lab){ return '<div class="fig '+cls+(v?"":" zero")+'"><b class="'+(v?"":"zero")+'">'+money(v)+"</b><span>"+lab+"</span></div>"; };
    // on a phone the row folds; the tap opens its bet names
    return '<div class="seat'+(m.id===state.me?" me":"")+((played||inPlay||proposed)?"":" idle")+(state.unfolded["m:"+m.id]?" open":"")+'" data-act="seat" data-id="'+esc(m.id)+'">'+
      '<div class="seat-top">'+avatarHtml(m.id,30)+
      '<span class="seat-name">'+esc(m.name)+"</span></div>"+
      '<div class="seat-team">'+esc(teamOf(m))+"</div>"+
      '<div class="figs">'+
        fig("stake",inPlay,"in play")+fig("prop",proposed,"proposed")+fig("gone",gone,"cancelled")+
        '<div class="fig net"><b class="'+cls+'">'+signed(p.net)+"</b><span>"+
          (played?p.w+"–"+p.l+(p.p?"–"+p.p:"")+" settled":"settled")+"</span></div>"+
      "</div>"+
      ((worn[m.id]||[]).length?'<div class="seat-bdgs">'+worn[m.id].map(function(b){
        return '<span class="bdg '+esc(b.fam)+' sm" data-tip="'+esc(b.label+" · "+b.blurb)+'">'+badgeSvg(b.icon)+esc(b.label)+"</span>"; }).join("")+"</div>":"")+
      '<div class="seat-picks'+(mine.length?"":" none")+'">'+
        (mine.length?esc(mine.join(" · ")):"no action yet")+"</div>"+
    "</div>";
  }).join("");

  var pot=0, live=0;
  state.bets.forEach(function(b){
    if(b.status!=="active"&&b.status!=="open") return;
    live++;
    pot+=(Number(b.amount)||0)*entriesOf(b).filter(function(e){return e.memberId;}).length;
  });
  document.getElementById("boardNote").textContent = pot
    ? live+(live===1?" bet":" bets")+" running · "+money(pot)+" on the table"
    : "Net across every settled bet.";
}

// Scroll a ticket into view and flash it, from a drill-through line.
export function showBet(id){
  var el=document.querySelector('article.ticket[data-bet="'+id+'"]');
  if(!el){ toast("That bet is filtered out of the book right now"); return false; }
  el.scrollIntoView({ behavior:"smooth", block:"center" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  return true;
}

// The season in one table: a column per manager, a row per pool, net all season, paid or not.
function seasonTable(L){
  var HL=Ledger.hlTally(state.highlow,members(),Ledger.hlStake(seasonCfg()));
  var cols=realMembers().filter(function(m){ return !m.test; });
  if(!cols.length) return "";
  if(phone()) return seasonTableByManager(L,HL,cols);
  var val=function(m,row){ var p=L.pnl[m.id]||{}, h=HL.byId[m.id]||{};
    return row==="hl"?(h.net||0):row==="weekly"?(p.weekly||0):row==="season"?(p.season||0):(h.net||0)+(p.weekly||0)+(p.season||0); };
  var cell=function(v,total,m,row){ v=Math.round(v*100)/100;
    return '<td class="num '+(v>0?"pos":v<0?"neg":"flat")+(total?" total":"")+'" data-act="drill" data-m="'+esc(m.id)+'" data-row="'+row+'" data-tip="What\u2019s behind this" tabindex="0">'+signed(v)+"</td>"; };
  var rows=[["hl","Hi / low"],["weekly","Weekly bets"],["season","Season bets"],["total","Total"]];
  return '<div class="pivot-wrap"><table class="pivot"><thead><tr><th></th>'+cols.map(function(m){
      return '<th'+(m.id===state.me?' class="me"':"")+'><span class="pv-head">'+avatarHtml(m.id,22)+'<span>'+esc(m.name)+"</span></span></th>"; }).join("")+"</tr></thead><tbody>"+
    rows.map(function(r){ var total=r[0]==="total";
      return "<tr"+(total?' class="total"':"")+"><th>"+esc(r[1])+"</th>"+cols.map(function(m){ return cell(val(m,r[0]),total,m,r[0]); }).join("")+"</tr>"; }).join("")+
    "</tbody></table></div>";
}

// The same table on a phone: a row per manager, the four pools across, so all ten fit.
function seasonTableByManager(L,HL,cols){
  var val=function(m,row){ var p=L.pnl[m.id]||{}, h=HL.byId[m.id]||{};
    return row==="hl"?(h.net||0):row==="weekly"?(p.weekly||0):row==="season"?(p.season||0):(h.net||0)+(p.weekly||0)+(p.season||0); };
  var cell=function(m,row){ var v=Math.round(val(m,row)*100)/100;
    return '<td class="num '+(v>0?"pos":v<0?"neg":"flat")+(row==="total"?" total":"")+'" data-act="drill" data-m="'+esc(m.id)+'" data-row="'+row+'" tabindex="0">'+signed(v)+"</td>"; };
  return '<div class="pivot-wrap"><table class="pivot by-manager"><thead><tr><th>Manager</th><th class="num">Hi/lo</th><th class="num">Weekly</th><th class="num">Season</th><th class="num">Total</th></tr></thead><tbody>'+
    cols.map(function(m){ return "<tr"+(m.id===state.me?' class="me"':"")+"><th>"+avatarHtml(m.id,20)+'<span>'+esc(m.name)+"</span></th>"+["hl","weekly","season","total"].map(function(r){ return cell(m,r); }).join("")+"</tr>"; }).join("")+
    "</tbody></table></div>";
}

/* ---- badges: live titles ----
   rules.badges() works out who holds what from the book; league/badges remembers who
   held it before, which is what lets a card say "took it from JPorch". */
const BADGE_ICON={
  dice:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  chips:'<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  wallet:'<path d="M4 7h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z"/><path d="M4 7V5h11M17 13h.01"/>',
  bank:'<path d="M3 9l9-5 9 5"/><path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 19h18"/>',
  trophy:'<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3"/><path d="M12 13v4M9 20h6"/>',
  flame:'<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1.5 2 2 2 0-2-1-4 1-7z"/>',
  shield:'<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  crown:'<path d="M4 8l3 4 5-6 5 6 3-4v10H4z"/>',
  star:'<path d="M12 3l2.6 5.6 6.1.8-4.5 4.3 1.2 6.1L12 16.9 6.6 19.8l1.2-6.1L3.3 9.4l6.1-.8z"/>',
  anchor:'<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 13a7 7 0 0 0 14 0M8 10H5M19 10h-3"/>',
  snow:'<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/><path d="M9 5l3 2 3-2M9 19l3-2 3 2"/>',
  stairs:'<path d="M4 20h4v-4h4v-4h4V8h4"/><path d="M4 20V4"/>',
  boots:'<path d="M7 4v9l-2 3v4h7v-4l-2-2V4z"/><path d="M17 8v5l2 3v4h-5"/>',
  bolt:'<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  horn:'<path d="M4 10v4h3l8 4V6L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  ghost:'<path d="M5 20V10a7 7 0 0 1 14 0v10l-2.3-2-2.3 2-2.4-2-2.3 2L7.3 18z"/><circle cx="9.5" cy="10.5" r=".9"/><circle cx="14.5" cy="10.5" r=".9"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  door:'<path d="M6 3h9v18H6z"/><path d="M15 3l3 2v14l-3 2M12 12h.01"/>'
};
const badgeSvg=function(k){ return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(BADGE_ICON[k]||"")+"</svg>"; };
// The badges as they stand, with whatever history the book has recorded.
function badgeList(){
  return Badges.badges(seasonCfg(),state.bets,state.highlow,state.seen,state.payments&&state.payments.list,Date.now());
}
function badgesView(){
  var host=document.getElementById("badges"), list=badgeList();
  var recs=(state.badges&&state.badges.byKey)||{};
  var held=list.filter(function(b){ return b.holders.length; });
  if(!held.length){
    host.innerHTML='<div class="empty">Eighteen titles up for grabs — biggest winner, biggest degenerate, hot hand, ghost. They land as soon as bets start settling.</div>';
    return;
  }
  var isMine=function(b){ return !!state.me&&b.holders.indexOf(state.me)>=0; };
  var mine=held.filter(isMine);
  var chip=function(b,small){ return '<span class="bdg '+esc(b.fam)+(small?" sm":"")+'" data-tip="'+esc(b.blurb)+'">'+badgeSvg(b.icon)+esc(b.label)+(small?"":" · "+esc(b.text))+"</span>"; };
  var h="";
  if(state.me) h+='<div class="bdg-mine"><span class="lbl">You hold</span>'+
    (mine.length?mine.map(function(b){ return chip(b); }).join("")
                :'<span class="note">Nothing yet — go win something.</span>')+"</div>";
  h+='<div class="bdg-case">'+list.map(function(b){
    var rec=recs[b.key], n=b.holders.length;
    // a tie is shared: every holder's face, then the names, and the title goes plural
    var who=n
      ? '<span class="bdg-who"><span class="bdg-faces">'+b.holders.slice(0,4).map(function(id){ return avatarHtml(id,22); }).join("")+"</span>"+
        "<b>"+esc(Fmt.nameList(b.holderNames))+'</b><b class="bdg-v">'+esc(b.text)+"</b></span>"
      : '<span class="bdg-who"><b class="bdg-none">Nobody yet</b></span>';
    return '<div class="bdg-card '+(n?esc(b.fam):"vacant")+(isMine(b)?" me":"")+'">'+
      '<span class="bdg-ic">'+badgeSvg(b.icon)+"</span>"+
      "<span>"+'<span class="bdg-nm">'+esc(b.label)+(b.shared?'<i class="bdg-share">shared · '+n+"</i>":"")+"</span>"+who+
      '<span class="bdg-sub">'+(function(){ var st=Badges.badgeStory(rec,members(),b.holders); return st?'<span class="took">'+esc(st)+"</span> · ":""; })()+esc(b.blurb)+"</span></span></div>";
  }).join("")+"</div>";
  host.innerHTML=h;
}

/* ---- Rivals: who took whose money ----
   A grid of every pair, each cell the row manager's money against the column's.
   Tap a cell for the bets behind it. Above it, the two managers who matter most to
   you; beside it, the season's bragging rights and the last few results. */
function rivalsView(){
  var host=document.getElementById("rivals");
  var list=realMembers().filter(function(m){ return !m.test; });
  var RV=Rivals.rivals(list,state.bets);
  var played=Object.keys(RV.totals).some(function(id){ return RV.totals[id].w||RV.totals[id].l; });
  if(!played){
    host.innerHTML='<div class="empty">Nothing has settled yet. Once bets start paying out, this is where you see who owns whom — every pair, all season.</div>';
    return;
  }
  var name=function(id){ return mName(id); };
  var rec=function(r){ return r.w+"–"+r.l; };
  var h="";

  // you: the manager you're up on most, and the one who has your number
  if(state.me&&RV.byId[state.me]){
    var best=null, worst=null;
    Object.keys(RV.byId[state.me]).forEach(function(b){
      var r=RV.byId[state.me][b]; if(!r.w&&!r.l) return;
      if(!best||r.net>RV.byId[state.me][best].net) best=b;
      if(!worst||r.net<RV.byId[state.me][worst].net) worst=b;
    });
    var card=function(cls,lbl,id,sub){
      if(!id) return "";
      var r=RV.byId[state.me][id];
      return '<div class="riv-you '+cls+'" data-act="rival" data-a="'+esc(state.me)+'" data-b="'+esc(id)+'" tabindex="0">'+
        '<span class="lbl">'+lbl+"</span>"+avatarHtml(id,36)+
        '<span class="riv-who"><b>'+esc(name(id))+"</b><small>"+rec(r)+" against them · "+esc(sub)+"</small></span>"+
        '<b class="riv-n '+(r.net>0?"pos":r.net<0?"neg":"flat")+'">'+esc(signed(r.net))+"</b></div>";
    };
    var mine="";
    if(best&&RV.byId[state.me][best].net>0) mine+=card("own","You own",best,"tap for the bets");
    if(worst&&RV.byId[state.me][worst].net<0) mine+=card("owned","Owns you",worst,"a rivalry to fix");
    if(mine) h+='<div class="riv-mine">'+mine+"</div>";
  }

  // the grid, richest season first
  var order=list.slice().sort(function(x,y){ return (RV.totals[y.id].net-RV.totals[x.id].net)||x.name.localeCompare(y.name); });
  var sel=state.rival;
  h+='<div class="riv-wrap"><table class="riv"><thead><tr><th></th>'+
    order.map(function(m){ return '<th'+(m.id===state.me?' class="me"':"")+' data-tip="'+esc(m.name)+'">'+avatarHtml(m.id,22)+"<span>"+esc(m.name)+"</span></th>"; }).join("")+
    '<th class="tot">Season</th></tr></thead><tbody>'+
    order.map(function(a){
      var t=RV.totals[a.id];
      return "<tr"+(a.id===state.me?' class="me"':"")+'><th>'+avatarHtml(a.id,22)+"<span>"+esc(a.name)+"</span><small>"+rec(t)+"</small></th>"+
        order.map(function(b){
          if(a.id===b.id) return '<td class="self"></td>';
          var r=RV.byId[a.id][b.id], n=r.w+r.l;
          if(!n) return '<td class="c none"><b>·</b></td>';
          var on=sel&&((sel.a===a.id&&sel.b===b.id)||(sel.a===b.id&&sel.b===a.id));
          return '<td class="c '+(r.net>0?"pos":r.net<0?"neg":"flat")+(on?" sel":"")+'" data-act="rival" data-a="'+esc(a.id)+'" data-b="'+esc(b.id)+'" tabindex="0"'+
            ' data-tip="'+esc(a.name+" vs "+b.name+" · "+rec(r))+'"><b>'+esc(signed(r.net))+"</b><small>"+rec(r)+"</small></td>";
        }).join("")+
        '<td class="tot '+(t.net>0?"pos":t.net<0?"neg":"flat")+'"><b>'+esc(signed(t.net))+"</b><small>"+rec(t)+"</small></td></tr>";
    }).join("")+"</tbody></table></div>";
  h+='<div class="riv-legend"><span><i class="sw pos"></i>the row is up on that column</span><span><i class="sw neg"></i>down</span><span>· the small line is wins–losses</span></div>';

  // the bets behind the open cell
  if(sel&&RV.byId[sel.a]&&RV.byId[sel.a][sel.b]){
    var r=RV.byId[sel.a][sel.b];
    h+='<div class="riv-drill"><div class="riv-drill-hd">'+avatarHtml(sel.a,22)+"<b>"+esc(name(sel.a))+"</b>"+
      '<span class="vs">vs</span>'+avatarHtml(sel.b,22)+"<b>"+esc(name(sel.b))+"</b>"+
      '<span class="riv-rec">'+rec(r)+" · "+esc(signed(r.net))+"</span></div>"+
      r.bets.map(function(x){
        return '<div class="riv-bet" data-act="goBet" data-id="'+esc(x.id)+'" tabindex="0">'+
          '<span class="wk">'+esc(weekLabel(x.week))+"</span>"+
          '<span class="riv-nm"><b>'+esc(x.name)+"</b><small>"+esc(money(x.amount))+" a side</small></span>"+
          '<span class="riv-w '+(x.won?"pos":"neg")+'">'+esc(name(x.won?sel.a:sel.b))+" won</span>"+
          '<b class="num '+(x.won?"pos":"neg")+'">'+esc(signed(x.won?x.amount:-x.amount))+"</b></div>";
      }).join("")+"</div>";
  }

  // bragging rights, and the last few results
  var H=Rivals.rivalHighlights(RV,state.bets,list);
  var rows=[];
  if(H.rivalry) rows.push(["Biggest rivalry",esc(name(H.rivalry.a))+" vs "+esc(name(H.rivalry.b))+" · "+money(H.rivalry.moved)+" has changed hands",H.rivalry.w+"–"+H.rivalry.l,"gold",[H.rivalry.a,H.rivalry.b]]);
  if(H.lopsided) rows.push(["Most lopsided",esc(name(H.lopsided.a))+" owns "+esc(name(H.lopsided.b)),money(H.lopsided.net),"pos",[H.lopsided.a]]);
  if(H.hammer) rows.push(["The hammer",esc(name(H.hammer.id))+" · most bets won off people",H.hammer.v+" W","pos",[H.hammer.id]]);
  if(H.nail) rows.push(["The nail",esc(name(H.nail.id))+" · most bets lost to people",H.nail.v+" L","neg",[H.nail.id]]);
  if(H.haul) rows.push(["Biggest haul",esc(name(H.haul.winner))+" took "+esc(H.haul.name)+" · "+H.haul.losers+" losers",money(H.haul.pot),"pos",[H.haul.winner]]);
  var feed=Rivals.rivalFeed(state.bets,5);
  h+='<div class="riv-side">'+
    '<div class="riv-box"><div class="lbl">Bragging rights</div>'+rows.map(function(x){
      return '<div class="riv-brag"><span class="riv-pair">'+x[4].map(function(id){ return avatarHtml(id,22); }).join("")+"</span>"+
        '<span class="riv-t"><b>'+esc(x[0])+"</b><small>"+x[1]+"</small></span>"+
        '<b class="riv-n '+x[3]+'">'+esc(x[2])+"</b></div>";
    }).join("")+"</div>"+
    '<div class="riv-box"><div class="lbl">Latest</div>'+feed.map(function(f){
      return '<div class="riv-bet" data-act="goBet" data-id="'+esc(f.id)+'" tabindex="0">'+
        '<span class="wk">'+esc(weekLabel(f.week))+"</span>"+
        '<span class="riv-nm"><b>'+esc(name(f.winner))+" beat "+esc(f.losers.map(name).join(", "))+"</b><small>"+esc(f.name)+" · "+esc(money(f.amount))+(f.losers.length>1?" each":"")+"</small></span>"+
        '<b class="num pos">'+esc(signed(f.pot))+"</b></div>";
    }).join("")+"</div></div>";

  host.innerHTML=h;
}

// Settle Up: the season table, everyone's balance as it stands, the transfers that would
// clear them, and the payments made so far. Nothing is paid bet by bet.
function settle(){
  var L=computeLedger(), host=document.getElementById("settle");
  var B=Ledger.balances(seasonCfg(),state.bets,state.highlow,state.payments&&state.payments.list,Ledger.hlStake(seasonCfg()));
  var cols=realMembers().filter(function(m){ return !m.test; });
  var h=seasonTable(L);

  // you, first
  if(state.me&&B.byId[state.me]){
    var me=B.byId[state.me], n=me.net;
    h+='<div class="you-line"><b class="'+(n>0?"pos":n<0?"neg":"flat")+'">'+(n>0?"You\u2019re up "+money(n):n<0?"You\u2019re down "+money(-n):"You\u2019re square")+"</b>"+
      '<span>bets '+esc(signed(me.bets))+" · hi / low "+esc(signed(me.hl))+(me.paidOut||me.paidIn?" · paid "+esc(money(me.paidOut))+", received "+esc(money(me.paidIn)):"")+"</span></div>";
  }

  // everyone's balance, biggest first
  var rows=cols.map(function(m){ return { m:m, b:B.byId[m.id]||{ bets:0, hl:0, net:0 } }; }).sort(function(a,b){ return (b.b.net-a.b.net)||a.m.name.localeCompare(b.m.name); });
  h+='<div class="bal-head"><span class="lbl">Balances · if the season ended now</span><span class="note">Settled bets and hi / low, minus anything already paid.</span></div>'+
    '<div class="balances">'+rows.map(function(r){ var n=r.b.net;
      return '<div class="bal'+(r.m.id===state.me?" me":"")+'">'+avatarHtml(r.m.id,26)+'<span class="bal-name">'+esc(r.m.name)+"</span>"+
        '<b class="'+(n>0?"pos":n<0?"neg":"flat")+'">'+esc(signed(n))+"</b><small>bets "+esc(signed(r.b.bets))+" · hi/low "+esc(signed(r.b.hl))+"</small></div>"; }).join("")+"</div>";

  // what would clear it
  var T=B.transfers;
  h+='<div class="bal-head" style="margin-top:16px"><span class="lbl">'+(T.length?"To clear it · "+T.length+(T.length===1?" payment":" payments"):"All square")+"</span>"+
    '<span class="note">'+(T.length?"The fewest transfers that zero everyone out. Mark each one paid as the money moves.":"Nobody owes anybody.")+"</span></div>";
  if(T.length) h+='<div class="settle">'+T.map(function(d){
    return '<div class="debt"><div class="debt-txt">'+avatarHtml(d.from,24)+"<b>"+esc(mName(d.from))+'</b><span class="pay-arrow">\u2192</span>'+avatarHtml(d.to,24)+"<b>"+esc(mName(d.to))+"</b></div>"+
      '<div class="debt-amt num">'+esc(money(d.amount))+"</div>"+
      (state.me?'<button class="btn" data-act="pay" data-from="'+esc(d.from)+'" data-to="'+esc(d.to)+'" data-amount="'+d.amount+'">Mark paid</button>':"")+"</div>"; }).join("")+"</div>";

  // paid so far
  var paid=B.payments.filter(function(p){ return !p.voided; }).sort(function(a,b){ return String(b.at||"").localeCompare(String(a.at||"")); });
  if(paid.length) h+='<div class="bal-head" style="margin-top:16px"><span class="lbl">Paid so far · '+paid.length+"</span></div>"+'<div class="paylog">'+paid.map(function(p){
    return '<div class="paid"><span class="paid-when">'+esc(p.at?fmtWhen(Date.parse(p.at)):"")+"</span>"+
      '<span class="paid-txt">'+esc(mName(p.from))+" \u2192 "+esc(mName(p.to))+(p.by?'<small> · marked by '+esc(mName(p.by))+"</small>":"")+(p.legacy?"<small> · from a bet marked paid</small>":"")+"</span>"+
      '<b class="num">'+esc(money(p.amount))+"</b>"+
      (state.admin&&!p.legacy?'<button class="btn" data-act="unpay" data-id="'+esc(p.id)+'" data-tip="Admin: undo this payment">Undo</button>':"")+"</div>"; }).join("")+"</div>";
  host.innerHTML=h;
}

function filters(){
  var f=state.filter, counts={all:0,open:0,active:0,settled:0,void:0};
  state.bets.forEach(function(b){ counts.all++; if(counts[b.status]!=null) counts[b.status]++; });
  var weeks=[];
  state.bets.forEach(function(b){ if(weeks.indexOf(Number(b.week))<0) weeks.push(Number(b.week)); });
  weeks.sort(function(a,b){ return a-b; });

  var h=[["all","Everything"],["open","Open"],["active","Live"],["settled","Settled"],["void","Voided"]]
    .map(function(s){
      var c=counts[s[0]];
      if(s[0]==="void"&&!c) return "";
      return '<button class="chip" data-act="filter" data-status="'+s[0]+'" aria-pressed="'+(f.status===s[0])+'">'+
        esc(s[1])+(c?'<i class="n">'+c+"</i>":"")+"</button>";
    }).join("");

  h+='<span style="width:8px"></span>'+
    '<select class="field w-auto" data-act="week" aria-label="Filter by week"><option value="all">All weeks</option>'+
    weeks.map(function(w){
      return '<option value="'+w+'"'+(String(f.week)===String(w)?" selected":"")+">"+weekLabel(w)+"</option>"; }).join("")+
    "</select>";
  if(state.me) h+='<button class="chip" data-act="mine" aria-pressed="'+f.mine+'">Only mine</button>';
  document.getElementById("filters").innerHTML=h;
}

function visible(){
  var f=state.filter;
  return state.bets.filter(function(b){
    if(f.status!=="all"&&b.status!==f.status) return false;
    if(f.week!=="all"&&String(b.week)!==String(f.week)) return false;
    if(f.mine&&state.me&&!entriesOf(b).some(function(e){ return e.memberId===state.me; })) return false;
    return true;
  }).sort(function(x,y){
    var r={open:0,active:1,settled:2,void:3};
    return (r[x.status]-r[y.status])||String(y.createdAt||"").localeCompare(String(x.createdAt||""));
  });
}

function sideHtml(e,i,b){
  var vacant=!e.memberId, cls="side";
  if(b.status==="settled"&&b.winner!=="push"&&b.winner) cls+= (b.winner===e.memberId)?" won":" lost";
  else if(b.game&&e.side&&(b.status==="open"||b.status==="active")){
    // while the game is on (or done but unsettled), show who's covering
    var cv=coverSide(b,gameOf(b));
    var mine=e.side==="over"||e.side==="under"?e.side:(e.side===b.game.away?"away":e.side===b.game.home?"home":"");
    if(cv==="push") cls+=" pushing"; else if(cv&&cv===mine) cls+=" cover";
  }
  if(vacant) cls+=" vacant";
  // A seat is either taken, reserved for someone who hasn't accepted yet, or open to anyone.
  var invited=vacant&&e.invite&&!e.declined?e.invite:null;
  var passed=vacant&&e.invite&&e.declined?e.invite:null;
  var who = vacant ? (invited?"Waiting on "+mName(invited):passed?mName(passed)+" passed · open seat":"Open seat") : mName(e.memberId);
  var pick = e.pick || (vacant?(invited?mName(invited)+"?":"Anyone"):who);
  // Invitations are accepted from the ticket's action row; open seats are taken here.
  // Not by someone already on the bet — the proposer sees the seat, not a button.
  var onIt=state.me&&entriesOf(b).some(function(x){ return x.memberId===state.me; });
  var canTake=vacant&&state.me&&!isLocked(b)&&!invited&&!onIt;
  return '<div class="'+cls+(invited?" invited":"")+'">'+
    (vacant?(invited?'<span class="avatar-wait">'+avatarHtml(invited,28)+"</span>":openAvatarHtml(28)):avatarHtml(e.memberId,28))+'<div>'+
    '<div class="side-pick">'+(b.game?logoHtml(e.side,18):"")+esc(pick)+"</div>"+
    '<div class="side-who">'+esc(who)+"</div>"+
    (canTake?'<button class="btn" style="margin-top:5px" data-act="take" data-id="'+esc(b.id)+'" data-i="'+i+'">Take it</button>':"")+
  "</div></div>";
}

// The game behind a game bet: score, quarter and clock as of the last refresh.
function gamelineHtml(b){
  var g=gameOf(b), now=Date.now(), t=Date.parse(g.date);
  var scored=g.awayScore!=null&&g.homeScore!=null;
  var st=g.status||(scored?"final":(now>=t?"live":"pre"));
  var aw=scored&&g.awayScore>g.homeScore, hw=scored&&g.homeScore>g.awayScore;
  var ball=function(team){ return st==="live"&&g.pos===team?' <span class="ball'+(g.rz?" rz":"")+'">◀</span>':""; };
  var team=function(code,score,lost){
    return '<span class="gl-team'+(st==="final"&&lost?" lose":"")+'">'+logoHtml(code,18)+'<span>'+esc(code)+"</span>"+
      (scored?'<span class="sc">'+score+"</span>":"")+ball(code)+"</span>";
  };
  var stateHtml;
  if(st==="final") stateHtml='<span class="gl-state">Final'+(g.ot?" · OT":"")+"</span>";
  else if(st==="live"){
    var q=g.ot?"OT":(g.q?"Q"+g.q:(g.ql||"Live"));
    stateHtml='<span class="gl-state live">'+esc((q+" "+(g.clock||"")).trim())+(g.dd?" · "+esc(g.dd):"")+"</span>";
  } else if(Clock.kicksSoon(g,now)) stateHtml='<span class="gl-state soon">Kicks in '+esc(countdown(t))+"</span>";
  else stateHtml='<span class="gl-state">'+esc(fmtWhen(t))+"</span>";
  return '<div class="gameline">'+team(g.away,g.awayScore,hw)+'<span class="gl-at">@</span>'+team(g.home,g.homeScore,aw)+
    (b.market&&b.market!=="ml"?'<span class="gl-line">'+esc(lineText(b))+
      (function(){ var o=Bets.lineOrigin(b); return o?'<i class="src '+o+'">'+(o==="vegas"?"Vegas":"their number")+"</i>":""; })()+"</span>":"")+stateHtml+"</div>";
}

// The standings strip: a bet tracks one stat or several. Older bets carry a single
// `stat`/`value`; newer ones a `tracks` list with per-row `values`. Normalise, then
// draw one standings block per track, each with its own leader.
function stripHtml(S,ents,week){
  if(!(S&&Array.isArray(S.rows)&&S.rows.length)) return "";
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, metric:S.metric, lower:S.lower }];
  var valueOf=function(r,t){ return Number((r.values&&t.stat in r.values)?r.values[t.stat]:r.value)||0; };
  var multiTrack=tracks.length>1;
  // Sleeper's projections for this week, if the app has them: shown in place of the
  // actuals until something has been played, then as a small reference beside them.
  var P=Stats.projFor(Number(week)||0,state.proj), anyPre=false;   // week 0: the season projections
  var blocks=tracks.map(function(t){
    var anyPlayed=false;
    S.rows.forEach(function(r){ if(valueOf(r,t)) anyPlayed=true; });
    var projOf=function(r){ return P?Stats.valueFor(r.key||r.id,t.stat,P):null; };
    var pre=!anyPlayed&&!!P&&S.rows.some(function(r){ return projOf(r); });
    if(pre) anyPre=true;
    var shownOf=function(r){ return pre?projOf(r):valueOf(r,t); };
    var better=function(a,b){ return t.lower?a<b:a>b; };
    // On a weekly bet, a row whose team sits out the week says so (a combined pick: any of its teams).
    var playing=Clock.teamsPlaying(week,state.games);
    var onBye=function(r){ return !!r.team&&String(r.team).split(" · ").some(function(tm){ return Clock.onBye(tm,playing); }); };
    var ownerOf=function(r){ return r.memberId||((r.entry!=null&&ents[r.entry])?ents[r.entry].memberId:null); };
    // The name cell: the dot, tag and bar colour say whose side a row is on.
    var nameHtml=function(r,owner,label){
      var own=owner?mColor(owner):"var(--ink-3)";
      return '<span class="sname">'+
        (owner?'<span class="dot" style="background:'+esc(own)+'"></span>':"")+
        '<span class="s-lab">'+esc(label||r.label||(owner?mName(owner):"Open seat"))+"</span>"+
        (r.team?'<span class="s-team">'+teamLogos(r.team,12)+esc(r.team)+"</span>":"")+
        statusTagsHtml(r.id||r.key)+
        (onBye(r)?'<span class="s-bye" data-tip="Off this week">bye</span>':"")+
        (owner&&(label||r.label)?'<span class="s-own">'+esc(mName(owner))+"</span>":"")+
      "</span>";
    };
    var barHtml=function(v,pv,owner,barMax){
      return '<span class="sbar"><i style="width:'+(barMax>0?Math.round(v/barMax*100):0)+'%;background:'+esc(owner?mColor(owner):"var(--ink-3)")+'"></i>'+
        (!pre&&pv?'<u class="ptick" style="left:'+Math.round(pv/barMax*100)+'%" data-tip="Sleeper projected '+esc(String(pv))+'"></u>':"")+"</span>";
    };
    var valHtml=function(v,pv){
      return pre?'<b class="proj" data-tip="Sleeper projection">'+esc(String(v))+"<small>proj</small></b>"
                :"<b>"+esc(String(v))+(pv!=null?'<small class="proj-was" data-tip="Sleeper projected '+esc(String(pv))+'">p '+esc(String(pv))+"</small>":"")+"</b>";
    };
    var title=multiTrack?'<div class="track-title">'+esc(t.metric||t.stat||"")+"</div>":"";

    // Rows that share a seat are one side — a player against the field. The side's
    // number is its best row (what settles the bet); the players sit under it, best first.
    var groups=[], byKey={};
    S.rows.forEach(function(r,i){ var k=r.entry!=null?"e"+r.entry:(r.memberId?"m"+r.memberId:"r"+i); if(!byKey[k]){ byKey[k]={ rows:[] }; groups.push(byKey[k]); } byKey[k].rows.push(r); });
    var grouped=groups.some(function(g){ return g.rows.length>1; });

    if(!grouped){
      var max=0, min=Infinity;
      S.rows.forEach(function(r){ var v=shownOf(r); if(v>max) max=v; if(v<min) min=v; });
      // Bars are scaled so the projection tick fits too, once actuals are showing.
      var barMax=max; if(!pre&&P) S.rows.forEach(function(r){ var q=projOf(r)||0; if(q>barMax) barMax=q; });
      // "lower is better" stats (points allowed) lead from the bottom; nobody leads at 0–0.
      var best=t.lower?min:max;
      return title+'<div class="stat-rows">'+S.rows.map(function(r){
        var v=shownOf(r), pv=projOf(r), lead=(anyPlayed||pre)&&v===best&&(pre?v>0:true), owner=ownerOf(r);
        return '<div class="srow'+(lead?" lead":"")+'">'+nameHtml(r,owner)+barHtml(v,pv,owner,barMax)+valHtml(v,pv)+"</div>";
      }).join("")+"</div>";
    }

    groups.forEach(function(g){
      g.rows=g.rows.slice().sort(function(a,b){ var va=shownOf(a), vb=shownOf(b); return va===vb?0:(better(va,vb)?-1:1); });
      g.top=g.rows[0]; g.v=shownOf(g.top); g.owner=ownerOf(g.top);
      var pvs=g.rows.map(projOf).filter(function(x){ return x!=null; });
      g.pv=pvs.length?pvs.reduce(function(a,b){ return better(a,b)?a:b; }):null;
    });
    var gmax=0, gmin=Infinity, gbar=0;
    groups.forEach(function(g){ if(g.v>gmax) gmax=g.v; if(g.v<gmin) gmin=g.v; if(g.v>gbar) gbar=g.v; if(!pre&&g.pv>gbar) gbar=g.pv; });
    var gbest=t.lower?gmin:gmax;
    return title+'<div class="stat-rows grouped">'+groups.map(function(g){
      var lead=(anyPlayed||pre)&&g.v===gbest&&(pre?g.v>0:true), many=g.rows.length>1;
      var head=many?{ label:"The field", team:"", id:null, key:null }:g.top;
      var h='<div class="srow side-row'+(lead?" lead":"")+(many?" many":"")+'">'+nameHtml(head,g.owner,many?"The field · best of "+g.rows.length:null)+barHtml(g.v,g.pv,g.owner,gbar)+valHtml(g.v,g.pv)+"</div>";
      if(many) h+=g.rows.map(function(r,i){
        var v=shownOf(r), pv=projOf(r);
        return '<div class="srow sub'+(i===0&&(anyPlayed||pre)&&(pre?v>0:true)?" counts":"")+'">'+nameHtml(r,null)+valHtml(v,pv)+"</div>";
      }).join("");
      return h;
    }).join("")+"</div>";
  }).join("");
  if(anyPre) blocks='<div class="proj-note">Projected by Sleeper · nothing played yet</div>'+blocks;
  return '<div class="statline">'+
    '<div class="stat-head"><span class="lbl">'+esc(multiTrack?"Standings · "+tracks.length+" stats":(tracks[0].metric||"Standings"))+"</span>"+
    '<span class="stat-when">'+esc(S.through||"")+(S.source?" · "+esc(S.source):"")+"</span></div>"+
    blocks+"</div>";
}

// The action row: what this manager can do to this bet right now.
function actionsHtml(b,ents,live,mine){
  var acts=[];
  // Pot-style bet you're not in yet? Add yourself.
  if(state.me&&Bets.canJoin(b)&&!isLocked(b)&&!mine)
    acts.push('<button class="btn pri" data-act="join" data-id="'+esc(b.id)+'">Join</button>');
  // Proposed to you? Accept or pass, right on the ticket.
  if(state.me&&(b.status==="open")&&!isLocked(b)){
    ents.forEach(function(e,ei){
      if(!e.memberId&&e.invite===state.me&&!e.declined){
        acts.push('<button class="btn pri" data-act="accept" data-id="'+esc(b.id)+'" data-i="'+ei+'">Accept bet</button>');
        acts.push('<button class="btn" data-act="pass" data-id="'+esc(b.id)+'" data-i="'+ei+'">Pass</button>');
      }
    });
  }
  // Results record themselves when the game or the period is done; an admin can still call one by hand.
  if(b.status==="active"&&state.admin) acts.push('<button class="btn" data-act="settle" data-id="'+esc(b.id)+'" data-tip="Admin: record the result by hand">Settle</button>');
  if(b.status==="settled") acts.push('<button class="btn" data-act="reopen" data-id="'+esc(b.id)+'">Reopen</button>');
  // only the proposer can edit a bet
  if((b.status==="open"||b.status==="active")&&!isLocked(b)&&(!b.createdBy||b.createdBy===state.me)) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'">Edit</button>');
  // the app admin can correct any live or open bet, even after lock
  else if((b.status==="open"||b.status==="active")&&state.admin) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'" data-tip="Admin: fix this bet">Update</button>');
  // Still waiting on takers: the proposer can pull it. Live: only people in it can void it.
  var proposer=!b.createdBy||b.createdBy===state.me;
  // Only the proposer can cancel, and only while it's still waiting on takers. Once
  // both sides are in it stands; an admin can void a live bet to undo a mistake.
  if(b.status==="open"&&proposer) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'">Cancel</button>');
  else if(b.status==="active"&&state.admin) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'" data-tip="Admin: void this bet">Void</button>');
  // a voided bet can come back only while its week is still open; after lock it would just cancel again
  if(b.status==="void"&&Date.now()<betLock(b)) acts.push('<button class="btn" data-act="restore" data-id="'+esc(b.id)+'">Restore</button>');
  if(b.status==="void") acts.push('<button class="btn danger" data-act="del" data-id="'+esc(b.id)+'">Delete</button>');
  return acts;
}

function ticketHtml(b){
  var ents=entriesOf(b);
  var live=ents.filter(function(e){ return e.memberId; });
  var mine=state.me&&live.some(function(e){ return e.memberId===state.me; });

  var chip;
  var how=b.settledNote?' data-tip="'+esc(b.settledNote)+'"':"";
  if(b.status==="settled"&&b.winner==="push") chip='<span class="status push"'+how+'>Push</span>';
  else if(b.status==="settled") chip='<span class="status settled"'+how+'>'+esc(mName(b.winner))+" wins</span>";
  else if(b.status==="active") chip='<span class="status active">Live</span>';
  else if(b.status==="void") chip='<span class="status void">'+(b.autoVoid?"Cancelled · no takers":b.cancelled?"Cancelled":"Void")+"</span>";
  else {
    var waiting=ents.filter(function(e){ return !e.memberId&&e.invite&&!e.declined; }).map(function(e){ return mName(e.invite); });
    var anyone=ents.filter(function(e){ return !e.memberId&&(!e.invite||e.declined); }).length;
    chip='<span class="status open">'+(anyone?anyone+" seat"+(anyone===1?"":"s")+" open":waiting.length?"Waiting on "+waiting.join(", "):"Open · join in")+"</span>";
  }

  var acts=actionsHtml(b,ents,live,mine);
  var sides=ents.map(function(e,i){ return sideHtml(e,i,b); }).join('<span class="vs">VS</span>');
  var pot=(Number(b.amount)||0)*live.length;
  var paidStamp="";   // nothing is paid bet by bet: balances net out at the end of the year
  // Still looking for people: a seat to fill, or a pot you could add yourself to.
  var seeking=!isLocked(b)&&(b.status==="open"||(state.me&&Bets.canJoin(b)&&!mine));
  var strip=stripHtml(b.stats,ents,b.week);
  // On a phone a ticket folds to its name, sides and numbers; a tap opens the rest.
  // One still looking for people stays fully drawn, its button in reach.
  var fold=phone()&&!seeking&&!state.unfolded[b.id];
  return '<article class="ticket '+esc(b.status)+(seeking?" seeking":"")+(fold?" fold":"")+(strip?" has-stats":"")+'" data-bet="'+esc(b.id)+'">'+
    '<div class="t-meta"><div class="t-meta-l">'+
      '<span class="wk'+(isPlayoff(b.week)?" po":"")+'">'+weekLabel(b.week)+"</span>"+
      '<span class="kind">'+esc(kindLabel(b.kind))+(live.length>2?" · "+live.length+"-way":"")+"</span>"+
    "</div>"+'<div class="t-meta-r">'+
      ((b.status==="open"||b.status==="active")
        ? (isLocked(b)?'<span class="status locked">Locked</span>'
                      :'<span class="lock-when" data-lock="'+betLock(b)+'" data-tip="'+esc(fmtWhen(betLock(b)))+'">Locks in '+esc(countdown(betLock(b)))+"</span>")
        : "")+
      chip+"</div></div>"+
    '<p class="terms">'+esc(b.name||b.terms)+"</p>"+
    (b.name?'<p class="bet-desc">'+esc(b.terms)+"</p>":"")+
    (b.game?gamelineHtml(b):"")+
    '<div class="sides">'+sides+"</div>"+
    strip+
    '<div class="t-foot">'+
      '<div class="t-stake"><b>'+money(b.amount)+"</b> a side"+
        (live.length>2?' <span class="pot">· '+money(pot)+" pot</span>":"")+"</div>"+
      (acts.length||paidStamp?'<div class="t-actions">'+paidStamp+acts.join("")+"</div>":"")+
      (seeking?"":'<button class="btn t-fold" data-act="fold" data-id="'+esc(b.id)+'" aria-expanded="'+(!fold)+'">'+(fold?"Details":"Less")+"</button>")+
    "</div>"+
  "</article>";
}

function tickets(){
  var list=visible(), host=document.getElementById("tickets");
  if(!list.length){
    host.innerHTML='<div class="empty">'+(state.bets.length?"No bets match that filter.":"The book is empty. Somebody has to go first.")+"</div>";
    return;
  }
  host.innerHTML=list.map(ticketHtml).join("");
}

/* ---- stats freshness: how current the numbers on the tickets are ---- */
export function statsBar(){
  var bar=document.getElementById("statsBar"), btn=document.getElementById("refreshBtn");
  var latest=null, through="";
  state.bets.forEach(function(b){
    var S=b.stats; if(!S||!S.updatedAt) return;
    if(!latest||String(S.updatedAt)>String(latest)){ latest=S.updatedAt; through=S.through||""; }
  });
  var r=state.refresh;
  var pending=!!(r&&r.requestedAt&&(!r.finishedAt||String(r.requestedAt)>String(r.finishedAt)));
  // A refresh can sit a while if another page holds the lease. Say how long, and
  // after 15 minutes let it be asked again instead of looking stuck.
  var age=pending?(Date.now()-Date.parse(r.requestedAt)):0, stale=pending&&age>15*60000;
  var h="";
  if(pending) h='<span class="pending" data-tip="Waiting on a refresh">Refresh requested '+esc(ago(r.requestedAt))+(r.requestedBy?" by "+esc(mName(r.requestedBy)):"")+"</span>"+
    (latest?' <span>· stats updated '+esc(ago(latest))+"</span>":"");
  else if(latest) h="Stats"+(through?" · "+esc(through):"")+" · updated "+esc(ago(latest));
  bar.innerHTML=h;
  btn.hidden=!(state.db&&!state.local);
  btn.disabled=pending&&!stale;
  btn.textContent=pending&&!stale?(phone()?"…":"Requested"):(phone()?"↻":"Refresh stats");
  btn.dataset.tip=pending&&!stale?"Refresh requested":"Refresh stats";
}

function foot(){
  document.getElementById("foot").textContent = state.local
    ? "Local preview — changes are not saved."
    : "Shared book, live for everyone with the link and the passcode. Settling is on the honor system — this tracks the money, it doesn’t hold it."+signInTime();
}
// How long this visit's sign-in took, stage by stage — so a slow one says where it waited.
function signInTime(){
  var t=state.timing||{}; if(!t.open) return "";
  var s=function(ms){ return (Math.max(ms,0)/1000).toFixed(1)+"s"; };
  var parts=[["scripts",t.boot],["auth",t.auth-t.boot],["passcode",t.click?t.key-t.click:null],["sign-in",t.click?t.signed-t.key:null],["book",t.open-(t.signed||t.auth)]]
    .filter(function(p){ return p[1]!=null&&!isNaN(p[1]); }).map(function(p){ return p[0]+" "+s(p[1]); });
  return " Opened in "+s(t.open)+(t.click?" (typing not counted)":"")+": "+parts.join(" · ")+".";
}
