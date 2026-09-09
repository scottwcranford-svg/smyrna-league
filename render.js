// Drawing the page from state: header, ticker, banner, ledger board, settle-up
// list, filters, tickets, the stats strip and the footer. Reads state, writes the
// DOM, never the book. forms.js and actions.js are the other DOM writers.

import * as R from "./rules.js?v=16";
import { state, members, touch } from "./state.js?v=16";

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

export function render(){ head(); ticker(); banner(); board(); settle(); filters(); tickets(); statsBar(); foot(); }

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
  return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:'+esc(m.color)+';font-size:'+fs+'px">'+esc(initials(m.name))+"</span>";
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
      return '<span class="game"><span class="tm '+(aw?"win":"lose")+'">'+esc(g.away)+' <b class="sc">'+g.awayScore+"</b></span>"+
        '<span class="at">·</span><span class="tm '+(hw?"win":"lose")+'">'+esc(g.home)+' <b class="sc">'+g.homeScore+"</b></span>"+
        '<span class="final">Final'+(g.ot?" · OT":"")+"</span></span>";
    }
    if(st==="live"){
      // score as of the last refresh, plus quarter, clock and who has the ball
      var qlabel=g.ot?"OT":(g.q?"Q"+g.q:(g.ql||""));
      var poss=function(team){ return g.pos===team?' <span class="ball'+(g.rz?" rz":"")+'">◀</span>':""; };
      return '<span class="game"><span class="tm">'+esc(g.away)+(scored?' <b class="sc">'+g.awayScore+"</b>":"")+poss(g.away)+"</span>"+
        '<span class="at">·</span><span class="tm">'+esc(g.home)+(scored?' <b class="sc">'+g.homeScore+"</b>":"")+poss(g.home)+"</span>"+
        '<span class="live">'+esc((qlabel+" "+(g.clock||"")).trim()||"Live")+"</span></span>";
    }
    return '<span class="game"><span class="tm">'+esc(g.away)+'</span><span class="at">@</span><span class="tm">'+esc(g.home)+"</span>"+
      '<span class="when">'+esc(fmtKick(t))+"</span></span>";
  }).join("");
  // two copies make the loop seamless; speed scales with how much is on the strip
  el.style.setProperty("--tick",Math.max(30,slate.length*5)+"s");
  el.innerHTML='<div class="ticker-track">'+items+items+"</div>";
  el.hidden=false;
}

function head(){
  var c=state.config;
  document.getElementById("leagueName").textContent=c?c.leagueName:"Smyrna League";
  document.getElementById("leagueBadge").textContent=initials(c?c.leagueName:"SB");
  document.getElementById("kicker").textContent=((c&&c.season)?c.season+" season":"Fantasy")+" · side bets";
  var live=0, n=state.bets.length;
  state.bets.forEach(function(b){ if(b.status==="active"||b.status==="open") live++; });
  document.getElementById("leagueSub").textContent = n
    ? n+(n===1?" wager":" wagers")+" on the side — "+live+" still running."
    : "Every wager on the side, and who ends up paying.";

  // who's signed in (identity comes from Firebase Auth, never a dropdown)
  var signed=!!state.me;
  document.getElementById("meLbl").textContent=signed?(state.admin?"Admin":"Signed in as"):"Not signed in";
  var nm=document.getElementById("meName"); nm.hidden=!signed; nm.textContent=signed?mName(state.me):"";
  document.getElementById("signOutBtn").hidden=!signed;
  document.getElementById("pwBtn").hidden=!signed;
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

function board(){
  var L=computeLedger();
  var list=members().slice();
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
    var inPlay=(L.risk[m.id]||0)+(L.offered[m.id]||0);
    var mine=L.picks[m.id]||[];
    return '<div class="seat'+(m.id===state.me?" me":"")+((played||inPlay)?"":" idle")+'">'+
      '<div class="seat-top">'+avatarHtml(m.id,30)+
      '<span class="seat-name">'+esc(m.name)+"</span></div>"+
      '<div class="seat-team">'+esc(m.team||"")+"</div>"+
      '<div class="figs">'+
        '<div class="fig stake"><b class="'+(inPlay?"":"zero")+'">'+money(inPlay)+"</b><span>in play</span></div>"+
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

function settle(){
  var L=computeLedger(), host=document.getElementById("settle");
  if(!L.debts.length){
    host.innerHTML='<div class="empty">Nobody owes anybody yet.</div>'; return;
  }
  host.innerHTML='<div class="settle">'+L.debts.map(function(d){
    var n=0;
    state.bets.forEach(function(b){
      if(b.status!=="settled"||b.winner==="push") return;
      var paid=Array.isArray(b.paid)?b.paid:[];
      if(b.winner===d.to && paid.indexOf(d.from)<0 &&
         entriesOf(b).some(function(e){ return e.memberId===d.from; })) n++;
    });
    return '<div class="debt">'+
      '<div class="debt-txt">'+avatarHtml(d.from,24)+
      "<b>"+esc(mName(d.from))+"</b>"+
      '<span class="pay-arrow">→</span>'+avatarHtml(d.to,24)+
      "<b>"+esc(mName(d.to))+"</b>"+
      '<span class="debt-n">· '+n+(n===1?" bet":" bets")+"</span></div>"+
      '<div class="debt-amt num">'+money(d.amount)+"</div>"+
      '<button class="btn" data-act="paidPair" data-from="'+esc(d.from)+'" data-to="'+esc(d.to)+'">Mark paid</button>'+
    "</div>";
  }).join("")+"</div>";
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
        esc(s[1])+(c?" "+c:"")+"</button>";
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
  var canTake=vacant&&state.me&&!isLocked(b)&&!invited;
  return '<div class="'+cls+(invited?" invited":"")+'">'+
    (vacant?(invited?'<span class="avatar-wait">'+avatarHtml(invited,28)+"</span>":openAvatarHtml(28)):avatarHtml(e.memberId,28))+'<div>'+
    '<div class="side-pick">'+esc(pick)+"</div>"+
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
    return '<span class="gl-team'+(st==="final"&&lost?" lose":"")+'"><span>'+esc(code)+"</span>"+
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
function stripHtml(S,ents){
  if(!(S&&Array.isArray(S.rows)&&S.rows.length)) return "";
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, metric:S.metric, lower:S.lower }];
  var valueOf=function(r,t){ return Number((r.values&&t.stat in r.values)?r.values[t.stat]:r.value)||0; };
  var multiTrack=tracks.length>1;
  var blocks=tracks.map(function(t){
    var max=0, min=Infinity, anyPlayed=false;
    S.rows.forEach(function(r){ var v=valueOf(r,t); if(v>max) max=v; if(v<min) min=v; if(v) anyPlayed=true; });
    // "lower is better" stats (points allowed) lead from the bottom; nobody leads at 0–0.
    var best=t.lower?min:max;
    return (multiTrack?'<div class="track-title">'+esc(t.metric||t.stat||"")+"</div>":"")+
      '<div class="stat-rows">'+S.rows.map(function(r){
        var v=valueOf(r,t), lead=anyPlayed&&v===best;
        // Each row is a player or team; the dot, tag and bar colour say whose side it's on.
        // A row made in the form points at its entry, so a seat taken later still colours it.
        var owner=r.memberId||((r.entry!=null&&ents[r.entry])?ents[r.entry].memberId:null);
        var own=owner?mColor(owner):"var(--ink-3)";
        return '<div class="srow'+(lead?" lead":"")+'">'+
          '<span class="sname">'+
            (owner?'<span class="dot" style="background:'+esc(own)+'"></span>':"")+
            '<span class="s-lab">'+esc(r.label||(owner?mName(owner):"Open seat"))+"</span>"+
            (r.team?'<span class="s-team">'+esc(r.team)+"</span>":"")+
            (owner&&r.label?'<span class="s-own">'+esc(mName(owner))+"</span>":"")+
          "</span>"+
          '<span class="sbar"><i style="width:'+(max>0?Math.round(v/max*100):0)+'%;background:'+esc(own)+'"></i></span>'+
          "<b>"+esc(String(v))+"</b></div>";
      }).join("")+"</div>";
  }).join("");
  return '<div class="statline">'+
    '<div class="stat-head"><span class="lbl">'+esc(multiTrack?"Standings · "+tracks.length+" stats":(tracks[0].metric||"Standings"))+"</span>"+
    '<span class="stat-when">'+esc(S.through||"")+(S.source?" · "+esc(S.source):"")+"</span></div>"+
    blocks+"</div>";
}

// The action row: what this manager can do to this bet right now.
function actionsHtml(b,ents,live,mine,unpaid){
  var acts=[];
  // Pot-style bet you're not in yet? Add yourself.
  if(state.me&&b.joinable&&!b.game&&(b.status==="open"||b.status==="active")&&!isLocked(b)&&!mine)
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
  if(b.status==="active") acts.push('<button class="btn'+(mine?" pri":"")+'" data-act="settle" data-id="'+esc(b.id)+'">Settle</button>');
  unpaid.forEach(function(e){
    acts.push('<button class="btn" data-act="paidOne" data-id="'+esc(b.id)+'" data-m="'+esc(e.memberId)+'">'+esc(mName(e.memberId))+" paid</button>");
  });
  if(b.status==="settled") acts.push('<button class="btn" data-act="reopen" data-id="'+esc(b.id)+'">Reopen</button>');
  // only the proposer can edit a bet
  if((b.status==="open"||b.status==="active")&&!isLocked(b)&&(!b.createdBy||b.createdBy===state.me)) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'">Edit</button>');
  // the app admin can correct any live or open bet, even after lock
  else if((b.status==="open"||b.status==="active")&&state.admin) acts.push('<button class="btn" data-act="edit" data-id="'+esc(b.id)+'" title="Admin: fix this bet">Update</button>');
  // Still waiting on takers: the proposer can pull it. Live: only people in it can void it.
  var proposer=!b.createdBy||b.createdBy===state.me;
  if(b.status==="open"&&proposer) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'">Cancel</button>');
  else if(b.status==="active"&&(mine||proposer)) acts.push('<button class="btn danger" data-act="void" data-id="'+esc(b.id)+'">Void</button>');
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
  if(b.status==="settled"&&b.winner==="push") chip='<span class="status push">Push</span>';
  else if(b.status==="settled") chip='<span class="status settled">'+esc(mName(b.winner))+" wins</span>";
  else if(b.status==="active") chip='<span class="status active">Live</span>';
  else if(b.status==="void") chip='<span class="status void">'+(b.autoVoid?"Cancelled · no takers":b.cancelled?"Cancelled":"Void")+"</span>";
  else {
    var waiting=ents.filter(function(e){ return !e.memberId&&e.invite&&!e.declined; }).map(function(e){ return mName(e.invite); });
    var anyone=ents.filter(function(e){ return !e.memberId&&(!e.invite||e.declined); }).length;
    chip='<span class="status open">'+(anyone?anyone+" seat"+(anyone===1?"":"s")+" open":"Waiting on "+waiting.join(", "))+"</span>";
  }

  var paid=Array.isArray(b.paid)?b.paid:[];
  var unpaid=(b.status==="settled"&&b.winner&&b.winner!=="push")
    ? live.filter(function(e){ return e.memberId!==b.winner&&paid.indexOf(e.memberId)<0; }) : [];
  var acts=actionsHtml(b,ents,live,mine,unpaid);
  var sides=ents.map(function(e,i){ return sideHtml(e,i,b); }).join('<span class="vs">VS</span>');
  var pot=(Number(b.amount)||0)*live.length;
  var paidStamp=(b.status==="settled"&&b.winner!=="push"&&!unpaid.length)?'<span class="paid-stamp">Paid</span>':"";
  return '<article class="ticket '+esc(b.status)+'">'+
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
    stripHtml(b.stats,ents)+
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
