// Drawing the page from state: header, ticker, banner, ledger board, settle-up
// list, filters, tickets, the stats strip and the footer. Reads state, writes the
// DOM, never the book. forms.js and actions.js are the other DOM writers.

import * as R from "./rules.js?v=dev";
import { state, members, realMembers, teamOf, touch } from "./state.js?v=dev";

const esc=R.esc, money=R.money, signed=R.signed, initials=R.initials, weekLabel=R.weekLabel, isPlayoff=R.isPlayoff,
      kindLabel=R.kindLabel, entriesOf=R.entriesOf, fmtWhen=R.fmtWhen, countdown=R.countdown, lineText=R.lineText,
      coverSide=R.coverSide, ago=R.ago;
const member=function(id){ return R.member(id,members()); };
const mName=function(id){ return R.mName(id,members()); };
const mColor=function(id){ return R.mColor(id,members()); };
const betLock=function(b){ return R.betLock(b,state.config); };
const isLocked=function(b){ return R.isLocked(b,state.config); };
const gameOf=function(b){ return R.gameOf(b,state.games); };
const currentWeek=function(){ return R.currentWeek(state.config,state.games); };
const computeLedger=function(){ return R.computeLedger(state.config,state.bets); };

export function render(){ head(); ticker(); banner(); tabs(); glance(); board(); highLow(); settle(); filters(); tickets(); statsBar(); foot(); }

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
  if(hash) return '<img class="avatar" src="https://sleepercdn.com/avatars/thumbs/'+esc(hash)+'" width="'+size+'" height="'+size+'" alt="" title="'+esc(m.name)+'" style="width:'+size+'px;height:'+size+'px">';
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
  return R.statusOf(id,state.roster).map(function(c){
    var hard=c==="Q"?"soft":"hard";
    return '<span class="st-tag '+hard+'" title="'+esc(R.STATUS_LABEL[c]||c)+'">'+esc(c)+"</span>";
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
  var slate=G.filter(function(g){ return g.week===w; });
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
    return '<span class="game"><span class="tm">'+logoHtml(g.away,14)+esc(g.away)+'</span><span class="at">@</span><span class="tm">'+logoHtml(g.home,14)+esc(g.home)+"</span>"+
      '<span class="when">'+esc(fmtKick(t))+"</span></span>";
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
  var line=R.leagueLine(league,c&&c.season);
  document.getElementById("leagueSub").textContent=(line?line+" · ":"")+"side bets";
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
}

// The tab row: which panel is open, and a badge where something needs a look.
function tabs(){
  var L=computeLedger(), HL=R.hlTally(state.highlow,members(),R.hlStake(state.config));
  var seats=0;
  state.bets.forEach(function(b){ if(b.status==="open"&&!isLocked(b)) entriesOf(b).forEach(function(e){ if(!e.memberId&&(!e.invite||e.declined)) seats++; }); });
  var Bal=R.balances(state.config,state.bets,state.highlow,state.payments&&state.payments.list,R.hlStake(state.config));
  var badge={ book:seats, ledger:0, hl:HL.weeks.length, settle:Bal.transfers.length };
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
    var Bg=R.balances(state.config,state.bets,state.highlow,state.payments&&state.payments.list,R.hlStake(state.config));
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
  }
  el.innerHTML=h;
}

// Week by week: who topped the league on Sleeper and who finished last, and what moved.
function highLow(){
  var host=document.getElementById("highlow"), note=document.getElementById("hlNote");
  var stake=R.hlStake(state.config), HL=R.hlTally(state.highlow,members(),stake);
  if(!HL.weeks.length){
    host.innerHTML='<div class="empty">Each week the top Sleeper score takes '+money(stake)+" from the bottom score. Runs all season, settles at the end.</div>";
    note.textContent=""; return;
  }
  var who=function(list){ return list.map(function(r){ return (r.id?avatarHtml(r.id,20):"")+'<span class="hl-name">'+esc(r.id?mName(r.id):r.name)+"</span>"; }).join('<span class="hl-tie">·</span>'); };
  var pts=function(list){ return list.length?String(list[0].pts):""; };
  // Standings for this pool alone: every manager, net first, then the weeks under it.
  var standing=realMembers().filter(function(m){ return !m.test; }).map(function(m){ return { m:m, t:HL.byId[m.id]||{ net:0, highs:0, lows:0 } }; })
    .sort(function(a,b){ return (b.t.net-a.t.net)||(b.t.highs-a.t.highs)||a.m.name.localeCompare(b.m.name); });
  var strip='<div class="hl-standings">'+standing.map(function(s){
    return '<div class="hl-stand'+(s.m.id===state.me?" me":"")+'">'+avatarHtml(s.m.id,22)+'<span class="hl-name">'+esc(s.m.name)+"</span>"+
      '<b class="'+(s.t.net>0?"pos":s.t.net<0?"neg":"flat")+'">'+signed(s.t.net)+"</b>"+
      '<small>'+s.t.highs+" hi · "+s.t.lows+" low</small></div>";
  }).join("")+"</div>";
  host.innerHTML=strip+'<div class="hl-table">'+HL.weeks.slice().reverse().map(function(w){
    var e=state.highlow.weeks[String(w)];
    return '<div class="hl-row"><span class="wk">'+esc(weekLabel(w))+"</span>"+
      '<span class="hl-side high">'+who(e.high)+'<b>'+esc(pts(e.high))+"</b><i>"+signed(stake/e.high.length)+"</i></span>"+
      '<span class="hl-side low">'+who(e.low)+'<b>'+esc(pts(e.low))+"</b><i>"+signed(-stake/e.low.length)+"</i></span></div>";
  }).join("")+"</div>";
  var lead=null; Object.keys(HL.byId).forEach(function(id){ if(!lead||HL.byId[id].net>HL.byId[lead].net) lead=id; });
  note.textContent=HL.weeks.length+(HL.weeks.length===1?" week":" weeks")+" in · "+money(stake)+" a week · "+(lead&&HL.byId[lead].net>0?mName(lead)+" leads at "+signed(HL.byId[lead].net):"all square");
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
  host.innerHTML=list.map(function(m){
    var p=L.pnl[m.id], played=p.w+p.l+p.p;
    var cls=p.net>0?"pos":p.net<0?"neg":"flat";
    var inPlay=L.risk[m.id]||0, proposed=L.offered[m.id]||0, gone=L.cancelled[m.id]||0;
    var mine=L.picks[m.id]||[];
    var fig=function(cls,v,lab){ return '<div class="fig '+cls+'"><b class="'+(v?"":"zero")+'">'+money(v)+"</b><span>"+lab+"</span></div>"; };
    return '<div class="seat'+(m.id===state.me?" me":"")+((played||inPlay||proposed)?"":" idle")+'">'+
      '<div class="seat-top">'+avatarHtml(m.id,30)+
      '<span class="seat-name">'+esc(m.name)+"</span></div>"+
      '<div class="seat-team">'+esc(teamOf(m))+"</div>"+
      '<div class="figs">'+
        fig("stake",inPlay,"in play")+fig("prop",proposed,"proposed")+fig("gone",gone,"cancelled")+
        '<div class="fig net"><b class="'+cls+'">'+signed(p.net)+"</b><span>"+
          (played?p.w+"–"+p.l+(p.p?"–"+p.p:"")+" settled":"settled")+"</span></div>"+
      "</div>"+
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
  var HL=R.hlTally(state.highlow,members(),R.hlStake(state.config));
  var cols=realMembers().filter(function(m){ return !m.test; });
  if(!cols.length) return "";
  var val=function(m,row){ var p=L.pnl[m.id]||{}, h=HL.byId[m.id]||{};
    return row==="hl"?(h.net||0):row==="weekly"?(p.weekly||0):row==="season"?(p.season||0):(h.net||0)+(p.weekly||0)+(p.season||0); };
  var cell=function(v,total,m,row){ v=Math.round(v*100)/100;
    return '<td class="num '+(v>0?"pos":v<0?"neg":"flat")+(total?" total":"")+'" data-act="drill" data-m="'+esc(m.id)+'" data-row="'+row+'" title="What\u2019s behind this" tabindex="0">'+signed(v)+"</td>"; };
  var rows=[["hl","Hi / low"],["weekly","Weekly bets"],["season","Season bets"],["total","Total"]];
  return '<div class="pivot-wrap"><table class="pivot"><thead><tr><th></th>'+cols.map(function(m){
      return '<th'+(m.id===state.me?' class="me"':"")+'><span class="pv-head">'+avatarHtml(m.id,22)+'<span>'+esc(m.name)+"</span></span></th>"; }).join("")+"</tr></thead><tbody>"+
    rows.map(function(r){ var total=r[0]==="total";
      return "<tr"+(total?' class="total"':"")+"><th>"+esc(r[1])+"</th>"+cols.map(function(m){ return cell(val(m,r[0]),total,m,r[0]); }).join("")+"</tr>"; }).join("")+
    "</tbody></table></div>";
}

// Settle Up: the season table, everyone's balance as it stands, the transfers that would
// clear them, and the payments made so far. Nothing is paid bet by bet.
function settle(){
  var L=computeLedger(), host=document.getElementById("settle");
  var B=R.balances(state.config,state.bets,state.highlow,state.payments&&state.payments.list,R.hlStake(state.config));
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
      (state.admin&&!p.legacy?'<button class="btn" data-act="unpay" data-id="'+esc(p.id)+'" title="Admin: undo this payment">Undo</button>':"")+"</div>"; }).join("")+"</div>";
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
  } else stateHtml='<span class="gl-state">'+esc(fmtWhen(t))+"</span>";
  return '<div class="gameline">'+team(g.away,g.awayScore,hw)+'<span class="gl-at">@</span>'+team(g.home,g.homeScore,aw)+
    (b.market&&b.market!=="ml"?'<span class="gl-line">'+esc(lineText(b))+"</span>":"")+stateHtml+"</div>";
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
  var P=R.projFor(Number(week)||0,state.proj), anyPre=false;   // week 0: the season projections
  var blocks=tracks.map(function(t){
    var anyPlayed=false;
    S.rows.forEach(function(r){ if(valueOf(r,t)) anyPlayed=true; });
    var projOf=function(r){ return P?R.valueFor(r.key||r.id,t.stat,P):null; };
    var pre=!anyPlayed&&!!P&&S.rows.some(function(r){ return projOf(r); });
    if(pre) anyPre=true;
    var shownOf=function(r){ return pre?projOf(r):valueOf(r,t); };
    var max=0, min=Infinity;
    S.rows.forEach(function(r){ var v=shownOf(r); if(v>max) max=v; if(v<min) min=v; });
    // Bars are scaled so the projection tick fits too, once actuals are showing.
    var barMax=max; if(!pre&&P) S.rows.forEach(function(r){ var q=projOf(r)||0; if(q>barMax) barMax=q; });
    // On a weekly bet, a row whose team sits out the week says so (a combined pick: any of its teams).
    var playing=R.teamsPlaying(week,state.games);
    var onBye=function(r){ return !!r.team&&String(r.team).split(" · ").some(function(tm){ return R.onBye(tm,playing); }); };
    // "lower is better" stats (points allowed) lead from the bottom; nobody leads at 0–0.
    var best=t.lower?min:max;
    return (multiTrack?'<div class="track-title">'+esc(t.metric||t.stat||"")+"</div>":"")+
      '<div class="stat-rows">'+S.rows.map(function(r){
        var v=shownOf(r), pv=projOf(r), lead=(anyPlayed||pre)&&v===best&&(pre?v>0:true);
        // Each row is a player or team; the dot, tag and bar colour say whose side it's on.
        // A row made in the form points at its entry, so a seat taken later still colours it.
        var owner=r.memberId||((r.entry!=null&&ents[r.entry])?ents[r.entry].memberId:null);
        var own=owner?mColor(owner):"var(--ink-3)";
        return '<div class="srow'+(lead?" lead":"")+'">'+
          '<span class="sname">'+
            (owner?'<span class="dot" style="background:'+esc(own)+'"></span>':"")+
            '<span class="s-lab">'+esc(r.label||(owner?mName(owner):"Open seat"))+"</span>"+
            (r.team?'<span class="s-team">'+teamLogos(r.team,12)+esc(r.team)+"</span>":"")+
            statusTagsHtml(r.id||r.key)+
            (onBye(r)?'<span class="s-bye" title="Off this week">bye</span>':"")+
            (owner&&r.label?'<span class="s-own">'+esc(mName(owner))+"</span>":"")+
          "</span>"+
          '<span class="sbar"><i style="width:'+(barMax>0?Math.round(v/barMax*100):0)+'%;background:'+esc(own)+'"></i>'+
            (!pre&&pv?'<u class="ptick" style="left:'+Math.round(pv/barMax*100)+'%" title="Sleeper projected '+esc(String(pv))+'"></u>':"")+"</span>"+
          (pre?'<b class="proj" title="Sleeper projection">'+esc(String(v))+"<small>proj</small></b>"
              :"<b>"+esc(String(v))+(pv!=null?'<small class="proj-was" title="Sleeper projected '+esc(String(pv))+'">p '+esc(String(pv))+"</small>":"")+"</b>")+"</div>";
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
  if(state.me&&R.canJoin(b)&&!isLocked(b)&&!mine)
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
  if(b.status==="active"&&state.admin) acts.push('<button class="btn" data-act="settle" data-id="'+esc(b.id)+'" title="Admin: record the result by hand">Settle</button>');
  if(b.status==="settled") acts.push('<button class="btn" data-act="reopen" data-id="'+esc(b.id)+'">Reopen</button>');
  // only the proposer can edit a bet
  if((b.status==="open"||b.status==="active")&&!isLocked(b)&&(!b.createdBy||b.createdBy===state.me)) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'">Edit</button>');
  // the app admin can correct any live or open bet, even after lock
  else if((b.status==="open"||b.status==="active")&&state.admin) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'" title="Admin: fix this bet">Update</button>');
  // Still waiting on takers: the proposer can pull it. Live: only people in it can void it.
  var proposer=!b.createdBy||b.createdBy===state.me;
  // Only the proposer can cancel, and only while it's still waiting on takers. Once
  // both sides are in it stands; an admin can void a live bet to undo a mistake.
  if(b.status==="open"&&proposer) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'">Cancel</button>');
  else if(b.status==="active"&&state.admin) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'" title="Admin: void this bet">Void</button>');
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
  var how=b.settledNote?' title="'+esc(b.settledNote)+'"':"";
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
  var seeking=!isLocked(b)&&(b.status==="open"||(state.me&&R.canJoin(b)&&!mine));
  return '<article class="ticket '+esc(b.status)+(seeking?" seeking":"")+'" data-bet="'+esc(b.id)+'">'+
    '<div class="t-meta"><div class="t-meta-l">'+
      '<span class="wk'+(isPlayoff(b.week)?" po":"")+'">'+weekLabel(b.week)+"</span>"+
      '<span class="kind">'+esc(kindLabel(b.kind))+(live.length>2?" · "+live.length+"-way":"")+"</span>"+
    "</div>"+'<div class="t-meta-r">'+
      ((b.status==="open"||b.status==="active")
        ? (isLocked(b)?'<span class="status locked">Locked</span>'
                      :'<span class="lock-when" data-lock="'+betLock(b)+'" title="'+esc(fmtWhen(betLock(b)))+'">Locks in '+esc(countdown(betLock(b)))+"</span>")
        : "")+
      chip+"</div></div>"+
    '<p class="terms">'+esc(b.name||b.terms)+"</p>"+
    (b.name?'<p class="bet-desc">'+esc(b.terms)+"</p>":"")+
    (b.game?gamelineHtml(b):"")+
    '<div class="sides">'+sides+"</div>"+
    stripHtml(b.stats,ents,b.week)+
    '<div class="t-foot">'+
      '<div class="t-stake"><b>'+money(b.amount)+"</b> a side"+
        (live.length>2?' <span class="pot">· '+money(pot)+" pot</span>":"")+"</div>"+
      (acts.length||paidStamp?'<div class="t-actions">'+paidStamp+acts.join("")+"</div>":"")+
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
  if(pending) h='<span class="pending" title="Waiting on a refresh">Refresh requested '+esc(ago(r.requestedAt))+(r.requestedBy?" by "+esc(mName(r.requestedBy)):"")+"</span>"+
    (latest?' <span>· stats updated '+esc(ago(latest))+"</span>":"");
  else if(latest) h="Stats"+(through?" · "+esc(through):"")+" · updated "+esc(ago(latest));
  bar.innerHTML=h;
  btn.hidden=!(state.db&&!state.local);
  btn.disabled=pending&&!stale;
  btn.textContent=pending&&!stale?"Requested":"Refresh stats";
}

function foot(){
  document.getElementById("foot").textContent = state.local
    ? "Local preview — changes are not saved."
    : "Shared book, live for everyone with the link and the passcode. Settling is on the honor system — this tracks the money, it doesn’t hold it.";
}
