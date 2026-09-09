// The page: state, rendering, forms and the sign-in flow. Boot is at the bottom.
// rules.js holds the pure logic, store.js the book (Firestore + passcode),
// auth.js the accounts. Each refactor step moves more out of here.
import * as R from "./rules.js?v=15";
import * as S from "./store.js?v=15";
import * as A from "./auth.js?v=15";
import * as N from "./sleeper.js?v=15";

var COLORS=R.COLORS;
var REG_WEEKS=R.REG_WEEKS, PLAYOFF_START=R.PLAYOFF_START, LAST_WEEK=R.LAST_WEEK;
var STATS=R.STATS;

var state = {
  db:null, connected:false, ready:false, local:true,
  config:null, bets:[], me:null,
  filter:{ status:"all", week:"all", mine:false },
  refresh:null, roster:null, games:null, draftScope:"", draftStats:[], editId:null,
  draftGame:null, draftMarket:"ml", draftLine:"", draftFav:"", joinId:null,
  draft:[]
};

/* ---- the real league, used until the shared book answers ---- */
function defaultLeague(){ return { leagueName:"Smyrna League", season:"2026", stake:25, kickoff:DEFAULT_KICKOFF, members:[] }; }
function defaultBets(){ return []; }

/* ---- utils ---- */
function esc(s){ return R.esc(s); }
function money(n){ return R.money(n); }
function signed(n){ return R.signed(n); }
function member(id){ return R.member(id,((state.config&&state.config.members)||[])); }
function mName(id){ return R.mName(id,((state.config&&state.config.members)||[])); }
function mColor(id){ return R.mColor(id,((state.config&&state.config.members)||[])); }
// Circular initials avatar — the recurring identity mark, the way Sleeper tags a manager everywhere.
function initials(name){ return R.initials(name); }
function avatarHtml(id,size){
  size=size||28;
  var m=member(id);
  var fs=Math.round(size*0.38);
  if(!m) return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:var(--ink-3);font-size:'+fs+'px">?</span>';
  return '<span class="avatar" style="width:'+size+'px;height:'+size+'px;background:'+esc(m.color)+';font-size:'+fs+'px">'+esc(initials(m.name))+"</span>";
}
function openAvatarHtml(size){
  size=size||28;
  return '<span class="avatar open" style="width:'+size+'px;height:'+size+'px;font-size:'+Math.round(size*0.5)+'px">+</span>';
}
function weekLabel(w){ return R.weekLabel(w); }
function isPlayoff(w){ return R.isPlayoff(w); }
function kindLabel(k){ return R.kindLabel(k); }

/* ---- kickoff locks ----
   A bet locks when its week kicks off: no edits, no taking a seat, no new bets for
   that week. Season-long bets (week 0) lock at Week 1. Week N kicks off on the
   Thursday N-1 weeks after the opener; the opener is a league setting. */
var DEFAULT_KICKOFF=R.DEFAULT_KICKOFF;
var WEEK_ANCHOR=R.WEEK_ANCHOR;
function kickoffTime(){ return R.kickoffTime(state.config); }
var LOCK_LEAD=R.LOCK_LEAD;
// First game of a week. Prefer the stored schedule (league/config.weekStarts, written by
// the refresh script from the real NFL schedule); fall back to the Thursday formula.
function firstGame(w){ return R.firstGame(w,state.config); }
function lockTime(w){ return R.lockTime(w,state.config); }
// A bet on one game locks an hour before that game; everything else, the week's first.
function betLock(b){ return R.betLock(b,state.config); }

/* ---- game bets: the live game behind a ticket ---- */
function allGames(){ return R.allGames(state.games); }
function gameOf(b){ return R.gameOf(b,state.games); }
function teamName(code){ return R.teamName(code,state.roster); }
function lineText(b){ return R.lineText(b); }
// Which side is covering right now: "away"/"home"/"over"/"under", "push", or null before kickoff.
function coverSide(b,g){ return R.coverSide(b,g); }
function sideCode(b,e){ return e.side||""; }
function weekLocked(w){ return R.weekLocked(w,state.config); }
function isLocked(b){ return R.isLocked(b,state.config); }
function fmtWhen(t){ return R.fmtWhen(t); }
function countdown(t){ return R.countdown(t); }
// Tick the countdowns; once one passes, redraw so its Edit/Take buttons go away.
setInterval(function(){
  var passed=false;
  document.querySelectorAll(".lock-when[data-lock]").forEach(function(el){
    var t=Number(el.getAttribute("data-lock"));
    if(Date.now()>=t) passed=true; else el.textContent="Locks in "+countdown(t);
  });
  if(passed) render();
},10000);
function toLocalInput(iso){ return R.toLocalInput(iso); }
function uid(){ return R.uid(); }
// Snapshot bodies arrive frozen. Anything we intend to edit — and we edit bets
// constantly — has to be a deep copy first, or the write throws under strict mode.
function clone(o){ return R.clone(o); }
function entriesOf(b){ return R.entriesOf(b); }
function openSeats(b){ return R.openSeats(b); }

var toastTimer=null;
function toast(msg){
  var t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ t.classList.remove("show"); },2600);
}
function guard(){
  if(state.local){ toast(state.connected?"Publish the league first":"Preview only — nothing saves"); return false; }
  return true;
}

/* ---- ledger ---- */
function computeLedger(){ return R.computeLedger(state.config,state.bets); }

/* ---- render ---- */
function render(){ expireBets(); head(); ticker(); banner(); board(); settle(); filters(); tickets(); statsBar(); foot(); }

// A bet still waiting on a seat when its lock hits is cancelled — nobody should be
// able to jump in after kickoff. Whichever open page notices first writes it; the
// write is a merge and idempotent, so two pages noticing at once is harmless.
function expireBets(){
  var now=Date.now();
  state.bets.forEach(function(b){
    if(b.status!=="open"||now<betLock(b)) return;
    b.status="void"; b.winner=null; b.autoVoid=true; b.voidedAt=new Date(now).toISOString(); b.voidedReason="No takers by lock";
    if(state.db&&!state.local) state.db.doc("bets/"+b.id).update({ status:"void", winner:null, autoVoid:true, voidedAt:b.voidedAt, voidedReason:b.voidedReason })
      .catch(function(){ /* another page got there first, or offline — the snapshot will settle it */ });
  });
}

/* ---- games ticker ----
   The current week's slate, written into league/games by the refresh script.
   Before kickoff: matchup and time. After a refresh: the score and Final. */
function currentWeek(){ return R.currentWeek(state.config,state.games); }
function fmtKick(t){
  var d=new Date(t);
  try{ return d.toLocaleString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"}); }catch(e){ return ""; }
}
function ticker(){
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
  var signed=!!state.me, canSign=state.connected&&!state.local;
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
  var members=(state.config?state.config.members:[]).slice();
  var host=document.getElementById("board");
  if(!members.length){
    host.className=""; host.innerHTML='<div class="empty">No managers yet.</div>';
    document.getElementById("boardNote").textContent=""; return;
  }
  host.className="board";
  members.sort(function(a,b){
    var d=L.pnl[b.id].net-L.pnl[a.id].net; if(d) return d;
    var ra=(L.risk[b.id]||0)-(L.risk[a.id]||0); if(ra) return ra;
    return a.name.localeCompare(b.name);
  });
  host.innerHTML=members.map(function(m){
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

function tickets(){
  var list=visible(), host=document.getElementById("tickets");
  if(!list.length){
    host.innerHTML='<div class="empty">'+(state.bets.length?"No bets match that filter.":"The book is empty. Somebody has to go first.")+"</div>";
    return;
  }
  host.innerHTML=list.map(function(b){
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

    var sides=ents.map(function(e,i){ return sideHtml(e,i,b); }).join('<span class="vs">VS</span>');
    var pot=(Number(b.amount)||0)*live.length;

    // Stats are written into the bet by a refresh, not fetched by the page —
    // published artifacts can't reach an outside API. No stats block, no strip.
    var strip="";
    var S=b.stats;
    if(S&&Array.isArray(S.rows)&&S.rows.length){
      // A bet tracks one stat or several. Older bets carry a single `stat`/`value`;
      // newer ones a `tracks` list with per-row `values`. Normalise, then draw one
      // standings block per track, each with its own leader.
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
      strip='<div class="statline">'+
        '<div class="stat-head"><span class="lbl">'+esc(multiTrack?"Standings · "+tracks.length+" stats":(tracks[0].metric||"Standings"))+"</span>"+
        '<span class="stat-when">'+esc(S.through||"")+(S.source?" · "+esc(S.source):"")+"</span></div>"+
        blocks+"</div>";
    }

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
      strip+
      '<div class="t-foot">'+
        '<div class="t-stake"><b>'+money(b.amount)+"</b> a side"+
          (live.length>2?' <span class="pot">· '+money(pot)+" pot</span>":"")+"</div>"+
        (acts.length||paidStamp?'<div class="t-actions">'+paidStamp+acts.join("")+"</div>":"")+
      "</div>"+
    "</article>";
  }).join("");
}

/* ---- stats freshness ----
   The page cannot reach Sleeper itself (published artifacts can't make outside
   requests), so the button records a request in the shared book and the refresh
   script writes the numbers back. This strip shows how fresh they are. */
function ago(iso){ return R.ago(iso); }
function statsBar(){
  var bar=document.getElementById("statsBar"), btn=document.getElementById("refreshBtn");
  var latest=null, through="";
  state.bets.forEach(function(b){
    var S=b.stats; if(!S||!S.updatedAt) return;
    if(!latest||String(S.updatedAt)>String(latest)){ latest=S.updatedAt; through=S.through||""; }
  });
  var r=state.refresh;
  var pending=!!(r&&r.requestedAt&&(!r.finishedAt||String(r.requestedAt)>String(r.finishedAt)));
  // A request is honoured by a refresh run outside the page, so it can sit a while.
  // Say how long, and after 15 minutes let it be asked again instead of looking stuck.
  var age=pending?(Date.now()-Date.parse(r.requestedAt)):0, stale=pending&&age>15*60000;
  var h="";
  if(pending) h='<span class="pending" title="Refreshes run from outside the page; this is waiting on one">Refresh requested '+esc(ago(r.requestedAt))+(r.requestedBy?" by "+esc(mName(r.requestedBy)):"")+"</span>"+
    (latest?' <span>· stats updated '+esc(ago(latest))+"</span>":"");
  else if(latest) h="Stats"+(through?" · "+esc(through):"")+" · updated "+esc(ago(latest));
  bar.innerHTML=h;
  btn.hidden=!(state.db&&!state.local);
  btn.disabled=pending&&!stale;
  btn.textContent=pending&&!stale?"Requested":"Refresh stats";
}
// The server pulls Sleeper itself — this asks it to do so now.
function requestRefresh(){
  if(!guard()) return;
  var cur=state.refresh||{};
  state.refresh=Object.assign({},cur,{ requestedAt:new Date().toISOString(), requestedBy:state.me||null });
  statsBar();
  state.db.refresh(state.me).then(function(r){ toast(r&&r.note==="recent"?"Scores refreshed":"Refreshing…"); })
    .catch(function(e){ toast(dbMsg(e)); });
}

function foot(){
  document.getElementById("foot").textContent = state.local
    ? "Local preview — changes are not saved."
    : "Shared book, live for everyone with the link and the passcode. Settling is on the honor system — this tracks the money, it doesn’t hold it.";
}

/* ---- persistence ---- */
function body(b){ var o={}; Object.keys(b).forEach(function(k){ if(k!=="id") o[k]=b[k]; }); return o; }
function dbMsg(e){ return S.dbMsg(e); }
function saveBet(b){
  var i=-1;
  for(var k=0;k<state.bets.length;k++){ if(state.bets[k].id===b.id){ i=k; break; } }
  if(i>=0) state.bets[i]=b; else state.bets.unshift(b);
  render();
  if(state.db&&!state.local) state.db.doc("bets/"+b.id).set(body(b)).catch(function(e){ toast(dbMsg(e)); });
}
function removeBet(id){
  state.bets=state.bets.filter(function(b){ return b.id!==id; });
  render();
  if(state.db&&!state.local) state.db.doc("bets/"+id).delete().catch(function(e){ toast(dbMsg(e)); });
}
function saveConfig(){
  render();
  if(state.db&&!state.local&&state.config)
    state.db.doc("league/config").set(state.config).catch(function(e){ toast(dbMsg(e)); });
}

/* ---- actions ---- */
function publishLeague(){
  if(!state.db) return toast("Not connected");
  var cfg=state.config, bets=state.bets.slice();
  state.db.doc("league/config").set(cfg).then(function(){
    state.local=false;
    return Promise.all(bets.map(function(b){ return state.db.doc("bets/"+b.id).set(body(b)); }));
  }).then(function(){ toast("Book is open"); render(); })
    .catch(function(e){ toast(dbMsg(e)); });
}

function takeSeat(id,i){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=null; state.bets.forEach(function(b){ if(b.id===id) bet=b; });
  if(!bet||bet.status!=="open") return;
  if(isLocked(bet)) return toast("Locked — that week has kicked off");
  if(entriesOf(bet).some(function(e){ return e.memberId===state.me; })) return toast("You’re already in this one");
  var seat=entriesOf(bet)[i]||{};
  if(seat.invite&&!seat.declined&&seat.invite!==state.me) return toast("That seat is held for "+mName(seat.invite));

  var ref=state.db?state.db.doc("bets/"+id):null;
  if(!ref){
    bet.entries[i].memberId=state.me; delete bet.entries[i].invite;
    if(!openSeats(bet)) bet.status="active";
    saveBet(bet); return;
  }
  // Two managers can tap the same open seat at once. Lease the doc, re-read,
  // and only claim the seat if it is genuinely still empty.
  ref.acquire({ holder:state.me, ttlMs:5000 }).then(function(res){
    if(!res.acquired){ toast("Someone else is claiming it"); return; }
    return ref.get().then(function(snap){
      var cur=snap.exists?clone(snap.data()):null;
      if(!cur||!Array.isArray(cur.entries)||!cur.entries[i]||cur.entries[i].memberId){
        toast("That seat is gone"); return;
      }
      if(cur.entries[i].invite&&!cur.entries[i].declined&&cur.entries[i].invite!==state.me){ toast("That seat is held for "+mName(cur.entries[i].invite)); return; }
      cur.entries[i].memberId=state.me; delete cur.entries[i].invite; delete cur.entries[i].declined;
      if(!cur.entries.some(function(e){ return !e.memberId; })) cur.status="active";
      return ref.set(cur).then(function(){ toast("You’re in"); });
    });
  }).catch(function(e){ toast(dbMsg(e)); });
}

function markPaid(betId,memberId){
  state.bets.forEach(function(b){
    if(b.id!==betId) return;
    if(!Array.isArray(b.paid)) b.paid=[];
    if(b.paid.indexOf(memberId)<0) b.paid.push(memberId);
    saveBet(b);
  });
}
function markPairPaid(from,to){
  if(!guard()) return;
  state.bets.forEach(function(b){
    if(b.status!=="settled"||b.winner!==to||b.winner==="push") return;
    if(!entriesOf(b).some(function(e){ return e.memberId===from; })) return;
    if(!Array.isArray(b.paid)) b.paid=[];
    if(b.paid.indexOf(from)<0){ b.paid.push(from); saveBet(b); }
  });
  toast("Settled up");
}

function openSettleDlg(id){
  if(!guard()) return;
  var bet=null; state.bets.forEach(function(b){ if(b.id===id) bet=b; });
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

/* ---- propose dialog ---- */
/* Roster lookups for the picker. The roster is a snapshot the refresh script
   writes into the shared book — the page itself can't reach Sleeper. */
function rosterRows(){ return R.rosterRows(state.roster); }
function rosterFind(id){ return R.rosterFind(id,state.roster); }
function rosterSearch(q,scope){ return R.rosterSearch(q,scope,state.roster); }
function shortName(row){ return R.shortName(row); }
function picksText(picks){ return R.picksText(picks); }

// Games still open for a bet in a week: not yet within an hour of kickoff.
function openGames(week){
  var now=Date.now();
  return allGames().filter(function(g){ return g.week===Number(week)&&now<Date.parse(g.date)-LOCK_LEAD; });
}
function drawGameBox(){
  var scope=state.draftScope, box=document.getElementById("bGameBox");
  box.hidden=scope!=="game";
  // A game bet fills in its own name, terms, type and week — hide those fields.
  var isGame=scope==="game";
  ["bNameRow","bKindRow","bWeekRow","bAddSide","bJoinRow"].forEach(function(id){ document.getElementById(id).hidden=isGame; });
  // Stat bets write their own terms from the stat, the period and the picks.
  document.getElementById("bTermsRow").hidden=!!scope;
  document.getElementById("bWhoLbl").textContent=isGame?"Your side, and who you're betting":"Who's in, and what they're taking";
  // A game bet has no default stake — the proposer names it every time.
  var amt=document.getElementById("bAmt"), dflt=String((state.config&&state.config.stake)||25);
  if(isGame){
    if(!state.editId&&amt.value===dflt) amt.value="";
    amt.placeholder="your stake";
    document.getElementById("bHint").textContent="You set the stake. Nothing's assumed on a game bet.";
  } else {
    if(!amt.value) amt.value=dflt;
    amt.placeholder="";
    if(!state.editId) document.getElementById("bHint").textContent="Default stake is "+money(Number(dflt))+".";
  }
  if(!isGame) return;
  var wk=document.getElementById("bWeek"), sel=document.getElementById("bGame");
  // One list, every game still open, grouped by week — no separate week step.
  var cur=state.draftGame, byWeek={}, weeks=[];
  var add=function(g){ var w=g.week; if(!byWeek[w]){ byWeek[w]=[]; weeks.push(w); } byWeek[w].push(g); };
  for(var w=1;w<=LAST_WEEK;w++) openGames(w).forEach(add);
  // when editing, the bet's own game stays listed even if it's near kickoff
  if(cur&&!weeks.some(function(w){ return byWeek[w].some(function(g){ return g.id===cur.id; }); })) add(cur);
  weeks.sort(function(a,b){ return a-b; });
  sel.innerHTML=weeks.length
    ? '<option value="">Pick a game…</option>'+weeks.map(function(w){
        return '<optgroup label="Week '+w+'">'+byWeek[w].map(function(g){
          return '<option value="'+esc(g.id)+'"'+(cur&&cur.id===g.id?" selected":"")+">"+esc(g.away+" @ "+g.home)+" · "+esc(fmtWhen(Date.parse(g.date)))+"</option>"; }).join("")+"</optgroup>"; }).join("")
    : '<option value="">No games left to bet on</option>';
  if(cur) wk.value=String(cur.week);
  document.querySelectorAll("#bMarket .chip").forEach(function(c){ c.setAttribute("aria-pressed",String(c.getAttribute("data-market")===state.draftMarket)); });
  document.getElementById("bLineRow").hidden=state.draftMarket!=="total";
  document.getElementById("bLine").value=state.draftLine;
}
function drawScope(){
  var scope=state.draftScope, box=document.getElementById("bStats"), hint=document.getElementById("bScopeHint");
  document.querySelectorAll("#bScope .chip").forEach(function(c){ c.setAttribute("aria-pressed",String(c.getAttribute("data-scope")===scope)); });
  drawGameBox();
  if(scope==="game"){
    box.hidden=true;
    hint.textContent=allGames().length?"Pick the game, take a side, say who you're betting, set the stake. The other owner gets the other side. Locks an hour before that game.":"Schedule isn't loaded yet — hit Refresh stats first.";
    return;
  }
  box.hidden=!scope;
  if(scope){
    // one or many stats; the first is on by default so the common case is one click
    var valid=STATS[scope].map(function(s){ return s[0]; });
    state.draftStats=state.draftStats.filter(function(k){ return valid.indexOf(k)>=0; });
    if(!state.draftStats.length) state.draftStats=[valid[0]];
    box.innerHTML=STATS[scope].map(function(s){
      return '<button type="button" class="chip" data-act="dStat" data-stat="'+esc(s[0])+'" aria-pressed="'+(state.draftStats.indexOf(s[0])>=0)+'">'+esc(s[1])+"</button>";
    }).join("");
  }
  if(!scope) hint.textContent="Anything goes. Settle it by hand when it's decided.";
  else if(!rosterRows().length) hint.textContent="Roster isn't loaded yet — hit Refresh stats first, or switch to free text.";
  else hint.textContent=(scope==="team"?"Pick a defense for each side.":"Pick one player per side, or several to combine them.")+" Track one stat or several — each gets its own standings. The terms write themselves from your picks.";
}

function drawEntries(hostId){
  var host=document.getElementById(hostId||"bEntries");
  var scope=state.draftScope, usePicker=!!scope&&rosterRows().length>0;
  host.innerHTML=state.draft.map(function(e,i){
    // You can only put yourself on a bet. Row one is you; other rows are open, or an
    // invitation the named manager has to accept. A seat already accepted stays put.
    var opts, lockedSeat=false;
    if(i===0||e.memberId){
      opts='<option value="'+esc(e.memberId||state.me)+'">'+esc(mName(e.memberId||state.me))+(i===0?" (you)":" · accepted")+"</option>";
      lockedSeat=true;
    } else {
      opts='<option value="">Open seat — anyone</option>'+state.config.members.filter(function(m){ return m.id!==state.me; }).map(function(m){
        return '<option value="'+esc(m.id)+'"'+(m.id===e.invite?" selected":"")+">Invite "+esc(m.name)+"</option>"; }).join("");
    }
    var pickUi;
    if(scope==="game"){
      var g=state.draftGame, choices;
      if(!g) choices=[];
      else if(state.draftMarket==="total") choices=[["over","Over"],["under","Under"]];
      else choices=[[g.away,teamName(g.away)],[g.home,teamName(g.home)]];
      if(i===0){
        pickUi='<div class="side-chips">'+(choices.length?choices.map(function(c){
          return '<button type="button" class="chip" data-act="dSide" data-i="'+i+'" data-side="'+esc(c[0])+'" aria-pressed="'+(e.side===c[0])+'">'+esc(c[1])+"</button>";
        }).join(""):'<span class="hint">Pick a game above</span>')+"</div>";
      } else {
        // the opponent's side is whatever you didn't take
        var mine0=state.draft[0].side, other=choices.filter(function(c){ return c[0]!==mine0; });
        pickUi='<div class="side-chips"><span class="hint">'+(mine0&&other.length===1?"takes "+esc(other[0][1]):"gets the other side")+"</span></div>";
      }
    } else if(usePicker){
      var chips=(e.picks||[]).map(function(p){
        return '<span class="pick-chip">'+esc(p.name)+(p.pos!=="DEF"?" <small>"+esc(p.pos+" · "+p.team)+"</small>":"")+
          '<button type="button" data-act="dDrop" data-i="'+i+'" data-id="'+esc(p.id)+'" aria-label="Remove">✕</button></span>';
      }).join("");
      pickUi='<div class="picker">'+
        (chips?'<div class="pick-chips">'+chips+"</div>":"")+
        '<input class="field" data-act="dSearch" data-i="'+i+'" autocomplete="off" placeholder="'+(scope==="team"?"Search a defense…":"Search a player…")+'">'+
        '<div class="sugg" id="sugg'+i+'" hidden></div>'+
      "</div>";
    } else {
      pickUi='<input class="field" data-act="dPick" data-i="'+i+'" maxlength="60" placeholder="What they’re taking" value="'+esc(e.pick)+'">';
    }
    return '<div class="entry-row">'+
      '<span class="entry-tag" style="margin-top:11px">'+(i===0?"You":"vs")+"</span>"+
      '<select class="field" data-act="dMem" data-i="'+i+'"'+(lockedSeat?" disabled":"")+'>'+opts+"</select>"+
      pickUi+
      (state.draft.length>2&&scope!=="game"?'<button class="btn danger rm" data-act="dRm" data-i="'+i+'">✕</button>':"")+
    "</div>";
  }).join("");
}
function gameSideText(side){
  if(side==="over"||side==="under") return (side==="over"?"Over ":"Under ")+state.draftLine;
  return teamName(side);
}
function drawSugg(i,q){
  var box=document.getElementById("sugg"+i); if(!box) return;
  // A player or defense can be on one side only — hide anything any side already holds.
  var taken={}; state.draft.forEach(function(e){ (e.picks||[]).forEach(function(p){ taken[p.id]=1; }); });
  var hits=rosterSearch(q,state.draftScope).filter(function(r){ return !taken[r[0]]; });
  box.hidden=!hits.length;
  box.innerHTML=hits.map(function(r){
    return '<button type="button" data-act="dAdd" data-i="'+i+'" data-id="'+esc(r[0])+'">'+esc(r[1])+
      (r[2]!=="DEF"?'<span class="tag">'+esc(r[2])+"</span>":"")+'<span class="team">'+esc(r[3])+"</span></button>";
  }).join("");
}
function addPick(i,id){
  var r=rosterFind(id); if(!r) return;
  var e=state.draft[i]; e.picks=e.picks||[];
  var elsewhere=state.draft.some(function(o){ return o!==e&&(o.picks||[]).some(function(p){ return p.id===id; }); });
  if(elsewhere) return toast(r[1]+" is already on another side");
  if(e.picks.some(function(p){ return p.id===id; })) return;
  if(state.draftScope==="team"&&e.picks.length) e.picks=[];   // one defense per side
  e.picks.push({ id:r[0], name:r[1], pos:r[2], team:r[3] });
  e.pick=picksText(e.picks);
  drawEntries();
  var next=document.querySelector('[data-act="dSearch"][data-i="'+i+'"]'); if(next) next.focus();
}
// Opens the form empty, or — given a bet id — pre-filled to edit that bet in place.
function openBetDlg(editId){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=null;
  if(editId){
    state.bets.forEach(function(b){ if(b.id===editId) bet=b; });
    if(!bet) return;
    if(bet.status!=="open"&&bet.status!=="active") return toast("Only live or open bets can be edited");
    if(!state.admin){
      if(isLocked(bet)) return toast("Locked — that week has kicked off");
      if(bet.createdBy&&bet.createdBy!==state.me) return toast("Only "+mName(bet.createdBy)+" can edit this one");
    }
  }
  state.editId=bet?bet.id:null;
  var wk=document.getElementById("bWeek");
  // Only weeks that haven't kicked off are offered for a new bet.
  var opts=[];
  if(bet||!weekLocked(0)) opts.push('<option value="0">Season long</option>');
  for(var i=1;i<=LAST_WEEK;i++){
    // a week stays listed while any of its games can still be bet on
    if(!bet&&weekLocked(i)&&!openGames(i).length) continue;
    opts.push('<option value="'+i+'">Week '+i+(i>=PLAYOFF_START?" · playoffs":"")+"</option>");
  }
  if(!opts.length) return toast("The season's over — nothing left to bet on");
  wk.innerHTML=opts.join("");
  var stake=(state.config&&state.config.stake)||25;
  document.getElementById("bTitle").textContent=bet?"Edit bet":"Propose a bet";
  document.getElementById("bJoin").checked=bet?!!bet.joinable:true;
  document.getElementById("bSave").textContent=bet?"Save changes":"Post it";
  document.getElementById("bName").value=bet?(bet.name||""):"";
  document.getElementById("bTerms").value=bet?(bet.terms||""):"";
  document.getElementById("bKind").value=bet?(bet.kind||"prop"):"prop";
  wk.value=bet?String(bet.week||0):"0";
  document.getElementById("bAmt").value=String(bet?bet.amount:stake);
  document.getElementById("bHint").textContent=bet
    ? (state.admin&&isLocked(bet)?"Admin update on a locked bet — everyone will see the change. ":"")+"Changing sides or stats resets the standings until the next refresh."
    : "Default stake is "+money(stake)+".";
  state.draftGame=null; state.draftMarket="ml"; state.draftLine=""; state.draftFav="";
  if(bet){
    state.draft=entriesOf(bet).map(function(e){
      return { memberId:e.memberId||null, invite:e.invite||null, pick:e.pick||"", picks:clone(e.picks||[]), side:e.side||"" };
    });
    var S=bet.stats||{};
    if(bet.game){
      state.draftScope="game"; state.draftGame=clone(bet.game);
      state.draftMarket=bet.market||"ml"; state.draftLine=bet.line!=null?String(bet.line):""; state.draftFav=bet.fav||"";
    } else {
      state.draftScope=S.scope||"player";   // no free-text bets any more
      state.draftStats=(Array.isArray(S.tracks)?S.tracks:[]).map(function(t){ return t.stat; }).filter(Boolean);
      if(!state.draftStats.length&&S.stat) state.draftStats=[S.stat];
    }
  } else {
    state.draft=[{memberId:state.me,pick:"",picks:[]},{memberId:null,pick:"",picks:[]}];
    state.draftScope="player"; state.draftStats=[];
  }
  drawScope(); drawEntries();
  document.getElementById("betDlg").showModal();
  document.getElementById("bName").focus();
}
// The strip's identity: what it scores and who it scores. Same identity, keep the numbers.
function statsKey(S){ return R.statsKey(S); }
// Terms for a stat bet, written from what's already chosen:
// "Most receiving yards on the season — Chase + Jefferson vs London + St. Brown."
function autoTerms(scope,tracks,week,entries){ return R.autoTerms(scope,tracks,week,entries,((state.config&&state.config.members)||[])); }
// A name when the proposer didn't give one: the matchup for two sides, the stat
// and period for a pot.
function autoName(tracks,week,entries){ return R.autoName(tracks,week,entries); }
// Build the standings strip for a stat-backed bet: one row per side, keyed by
// Sleeper IDs, zero until the refresh script fills it in.
function buildStats(entries){ return R.buildStats(entries,state.draftScope,state.draftStats); }
function submitBet(){
  var name=document.getElementById("bName").value.trim();
  var terms=document.getElementById("bTerms").value.trim();
  var amt=parseFloat(document.getElementById("bAmt").value);
  var isGame=state.draftScope==="game", G=state.draftGame;
  if(isGame){
    if(!G) return toast("Pick a game first");
    if(!name) name=G.away+" @ "+G.home;
    if(state.draftMarket==="total"&&!(parseFloat(state.draftLine)>0)) return toast("Set the total");
    if(!terms) terms=state.draftMarket==="total"?"Combined points over or under "+state.draftLine+".":"Straight up — whoever wins.";
    if(!state.draft[0].side) return toast(state.draftMarket==="total"?"Take Over or Under":"Pick your team");
    // the opponent gets whatever you didn't take
    var opts0=state.draftMarket==="total"?["over","under"]:[G.away,G.home];
    var other0=opts0.filter(function(o){ return o!==state.draft[0].side; })[0];
    if(state.draft.length<2) state.draft.push({memberId:null,pick:"",picks:[],side:""});
    state.draft[1].side=other0;
    if(!state.editId&&Date.now()>=Date.parse(G.date)-LOCK_LEAD) return toast("That game is about to kick off — pick another");
  }
  var statScope=state.draftScope==="player"||state.draftScope==="team";
  if(!name&&statScope){
    var tracksNm=STATS[state.draftScope].filter(function(s){ return state.draftStats.indexOf(s[0])>=0; })
      .map(function(s){ return { stat:s[0], metric:s[1] }; });
    name=autoName(tracksNm,Number(document.getElementById("bWeek").value)||0,state.draft);
  }
  if(!name) return toast("Give it a name first");
  if(statScope) terms="(auto)";   // rewritten from the picks once the strip is built
  if(!terms) return toast("Write the terms first");
  if(!(amt>0)) return toast(isGame?"Set the stake — it's yours to name":"Set a stake above zero");
  var wkPick=isGame?G.week:(Number(document.getElementById("bWeek").value)||0);
  if(!isGame&&weekLocked(wkPick)&&!(state.editId&&state.admin)) return toast(wkPick?"Week "+wkPick+" has kicked off — pick a later week":"The season's underway — season-long bets are locked");
  var seen={};
  for(var i=0;i<state.draft.length;i++){
    var id=state.draft[i].memberId;
    if(id&&seen[id]) return toast("Somebody is listed twice");
    if(id) seen[id]=1;
  }
  if(Object.keys(seen).length<1) return toast("At least one real manager");
  // the proposer is row one; nobody else can be placed, only invited
  var existingBet=null;
  if(state.editId) state.bets.forEach(function(b){ if(b.id===state.editId) existingBet=b; });
  var proposer=(existingBet&&existingBet.createdBy)||state.me;
  var inv={}; inv[proposer]=1;
  for(var k=0;k<state.draft.length;k++){
    var d=state.draft[k];
    if(k===0){ d.memberId=proposer; d.invite=null; continue; }
    if(d.memberId&&d.memberId!==proposer) continue;   // already accepted (editing)
    d.memberId=null;
    if(d.invite){ if(inv[d.invite]) return toast(mName(d.invite)+" is invited twice"); inv[d.invite]=1; }
  }
  if(state.draftScope&&rosterRows().length){
    var missing=state.draft.some(function(e){ return !(e.picks&&e.picks.length); });
    if(missing) return toast(state.draftScope==="team"?"Pick a defense for every side":"Pick a player for every side");
    var held={}, dup=null;
    state.draft.forEach(function(e){ (e.picks||[]).forEach(function(p){ if(held[p.id]) dup=p.name; held[p.id]=1; }); });
    if(dup) return toast(dup+" is on two sides");
  }
  var entries=state.draft.map(function(e){
    var out={ memberId:e.memberId||null, pick:(e.pick||"").trim() };
    if(!out.memberId&&e.invite) out.invite=e.invite;
    if(isGame){ out.side=e.side; out.pick=gameSideText(e.side); }
    else if(e.picks&&e.picks.length) out.picks=e.picks.map(function(p){ return { id:p.id, name:p.name, pos:p.pos, team:p.team }; });
    return out;
  });
  var existing=null;
  if(state.editId) state.bets.forEach(function(b){ if(b.id===state.editId) existing=b; });
  var bet={
    id:existing?existing.id:uid(),
    createdAt:existing?existing.createdAt:new Date().toISOString(),
    createdBy:existing?existing.createdBy:state.me,
    week:wkPick,
    kind:isGame?"matchup":document.getElementById("bKind").value,
    amount:Math.round(amt*100)/100, name:name, terms:terms,
    entries:entries,
    winner:null, paid:existing?(existing.paid||[]):[]
  };
  if(isGame){
    bet.game={ id:G.id, week:G.week, away:G.away, home:G.home, date:G.date };
    bet.market=state.draftMarket==="total"?"total":"ml";
  }
  // Pot-style: others can add themselves after posting. Never on a two-team game bet.
  bet.joinable=!isGame&&document.getElementById("bJoin").checked;
  if(isGame&&bet.market==="total") bet.line=parseFloat(state.draftLine);
  var stats=buildStats(state.draft);
  if(statScope){
    // terms come from the stat, the period and the picks — even if the roster wasn't
    // loaded and the sides were typed by hand
    var tracksSel=stats?stats.tracks:STATS[state.draftScope].filter(function(s){ return state.draftStats.indexOf(s[0])>=0; })
      .map(function(s){ return { stat:s[0], metric:s[1], lower:!!s[2] }; });
    bet.terms=autoTerms(state.draftScope,tracksSel,bet.week,state.draft);
  }
  // Editing: if the sides and stats are unchanged, keep the refreshed numbers.
  if(existing&&existing.stats&&stats&&statsKey(existing.stats)===statsKey(stats)) stats=existing.stats;
  if(stats) bet.stats=stats;
  if(existing){ bet.editedAt=new Date().toISOString(); bet.editedBy=state.me; }
  bet.status=bet.entries.some(function(e){ return !e.memberId; })?"open":"active";
  saveBet(bet);
  state.editId=null;
  document.getElementById("betDlg").close();
  toast(existing?"Bet updated":(bet.status==="open"?"Posted — waiting for takers":"Bet is live"));
}

/* ---- join a pot-style bet ---- */
function openJoinDlg(id){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=null; state.bets.forEach(function(b){ if(b.id===id) bet=b; });
  if(!bet||!bet.joinable||bet.game) return;
  if(isLocked(bet)) return toast("Locked — too close to kickoff");
  if(entriesOf(bet).some(function(e){ return e.memberId===state.me; })) return toast("You’re already in this one");
  state.joinId=id;
  var S=bet.stats||{};
  state.draftScope=S.scope||"";
  state.draftStats=(Array.isArray(S.tracks)?S.tracks:[]).map(function(t){ return t.stat; }).filter(Boolean);
  state.draft=[{memberId:state.me,pick:"",picks:[],side:""}];
  document.getElementById("jTitle").textContent="Join · "+(bet.name||bet.terms);
  document.getElementById("jTerms").textContent=bet.terms+"  ·  "+money(bet.amount)+" a side";
  document.getElementById("jHint").textContent=state.draftScope
    ? (state.draftScope==="team"?"Pick a defense nobody else has.":"Pick a player nobody else has.")
    : "Say what you're taking.";
  drawEntries("jEntries");
  document.getElementById("joinDlg").showModal();
}
function submitJoin(){
  var id=state.joinId, bet=null; state.bets.forEach(function(b){ if(b.id===id) bet=b; });
  if(!bet) return;
  var d=state.draft[0]||{}, scope=state.draftScope;
  if(scope&&rosterRows().length){
    if(!(d.picks&&d.picks.length)) return toast(scope==="team"?"Pick a defense":"Pick a player");
    var held={}; entriesOf(bet).forEach(function(e){ (e.picks||[]).forEach(function(p){ held[p.id]=1; }); });
    var dup=null; d.picks.forEach(function(p){ if(held[p.id]) dup=p.name; });
    if(dup) return toast(dup+" is already taken");
  } else if(!(d.pick||"").trim()) return toast("Say what you're taking");

  var entry={ memberId:state.me, pick:(d.pick||"").trim() };
  if(d.picks&&d.picks.length) entry.picks=d.picks.map(function(p){ return { id:p.id, name:p.name, pos:p.pos, team:p.team }; });

  // Same lease as taking a seat: re-read, append, write — so two joiners can't clobber each other.
  var apply=function(cur){
    if(!Array.isArray(cur.entries)) cur.entries=[];
    if(cur.entries.some(function(e){ return e.memberId===state.me; })) return false;
    cur.entries.push(entry);
    var S=cur.stats;
    if(S&&Array.isArray(S.rows)&&entry.picks){
      var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{stat:S.stat}];
      var values={}; tracks.forEach(function(t){ if(t.stat) values[t.stat]=0; });
      var row={ key:entry.picks.map(function(p){ return p.id; }).join("+"),
                label:entry.picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + "),
                memberId:state.me, entry:cur.entries.length-1, value:0, values:values };
      if(S.scope==="player") row.team=entry.picks.map(function(p){ return p.team; }).join(" · ");
      S.rows.push(row);
    }
    if(cur.status==="open"&&!cur.entries.some(function(e){ return !e.memberId; })) cur.status="active";
    if(S&&S.scope&&entry.picks) cur.terms=autoTerms(S.scope,(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{stat:S.stat,metric:S.metric,lower:S.lower}],cur.week,cur.entries);
    return true;
  };
  var ref=state.db?state.db.doc("bets/"+id):null;
  var done=function(){ state.joinId=null; document.getElementById("joinDlg").close(); toast("You’re in"); };
  if(!ref){ if(apply(bet)) saveBet(bet); done(); return; }
  ref.acquire({ holder:state.me, ttlMs:5000 }).then(function(res){
    if(!res.acquired){ toast("Someone else is joining — try again"); return; }
    return ref.get().then(function(snap){
      var cur=snap.exists?clone(snap.data()):null;
      if(!cur){ toast("That bet is gone"); return; }
      if(!apply(cur)){ toast("You’re already in this one"); return; }
      return ref.set(cur).then(done);
    });
  }).catch(function(e){ toast(dbMsg(e)); });
}

/* ---- the shared book (store.js) ---- */
var KEY_LS=S.KEY_LS;
function makeDb(key){ return S.makeDb(key,{ refresh:runRefresh }); }
function setKey(k){ S.setKey(k); }
function storedKey(){ return S.storedKey(); }
function tryKey(k){ return S.tryKey(k); }

/* ---- keeping the book current (sleeper.js) ----
   The loops need a snapshot of what this page knows; nothing in sleeper.js reads state. */
function refreshCtx(){ return { config:state.config, games:state.games, refresh:state.refresh, bets:state.bets, roster:state.roster,
                                holder:state.me, mobile:/Mobi|Android/i.test(navigator.userAgent) }; }
function scoresTick(db){ if(!db||state.local) return; N.scoresTick(db,refreshCtx()); }
function runRefresh(db,by,forced){ return N.runRefresh(db,by,forced,refreshCtx()); }


/* ---- who you are: Firebase Auth ----
   Accounts are handle@smyrna.league with a password the admin sets; no real
   email involved. Identity is the signed-in account, so "acting as" can't be faked.
   Admins are the accounts listed in league/config.adminEmails; any admin can flag others.
   Nothing renders until someone is signed in: the login screen is the whole page. */
var AUTH_DOMAIN=R.AUTH_DOMAIN;
function slugName(n){ return R.slugName(n); }
function emailFor(m){ return R.emailFor(m); }
function defaultPw(m){ return R.defaultPw(m); }   // the league's starting password: name + 123!
function memberForEmail(email){ return R.memberForEmail(email,((state.config&&state.config.members)||[])); }
function adminEmails(){ return R.adminEmails(state.config); }
function adminIds(){ return R.adminIds(state.config); }
function isAdminMember(id){ return R.isAdminMember(id,state.config); }
function applyAuth(user){ var w=A.whoAmI(user,state.config); state.me=w.me; state.admin=w.admin; }
function authMsg(e){ return A.authMsg(e); }
// The login screen: the whole page until you're in.
function showLogin(msg){
  document.getElementById("app").hidden=true;
  var lg=document.getElementById("login"); lg.hidden=false;
  document.getElementById("siKeyRow").hidden=!!storedKey();
  document.getElementById("siHint").textContent=msg||"";
  var nm=document.getElementById("siName"); (nm.value?document.getElementById("siPw"):nm).focus();
}
function submitLogin(){
  var name=document.getElementById("siName").value.trim(), pw=document.getElementById("siPw").value, hint=document.getElementById("siHint");
  var key=storedKey()||document.getElementById("siKey").value.trim();
  if(!name) return toast("Enter your name");
  if(!pw) return toast("Enter your password");
  if(!key){ document.getElementById("siKeyRow").hidden=false; return toast("Enter the league passcode"); }
  hint.textContent="Signing in…";
  tryKey(key).then(function(ok){
    if(!ok){ document.getElementById("siKeyRow").hidden=false; S.forgetKey(); hint.textContent="That passcode isn't right"; return; }
    setKey(key);
    return A.signIn(name,pw)
      .then(function(cred){
        hint.textContent="Opening the book…";
        state.typedPw=pw;
        // if this browser was already signed in, auth state won't "change" — open the book directly
        enterBook(cred.user||A.currentUser());
      })
      .catch(function(e){ hint.textContent=authMsg(e); });
  });
}
// Signed in and passcode known: open the book, subscribe once, show the app when it lands.
function enterBook(user){
  if(!user) return;
  var key=storedKey();
  if(!key){ showLogin("Signed in — now the league passcode."); return; }
  if(!state.db){ state.db=makeDb(key); state.connected=true; subscribeBook(state.db); }
  else if(!state.local){ document.getElementById("login").hidden=true; document.getElementById("app").hidden=false; render(); }
  // the default-password check needs the roster; if it isn't here yet, the config
  // snapshot runs it once the names arrive
  if(state.typedPw&&memberForEmail(user.email)){ enforceFreshPassword(user,state.typedPw); state.typedPw=null; }
  // If the book hasn't opened shortly, say why on the login screen instead of sitting there.
  clearTimeout(state.bookTimer);
  var t0=Date.now();
  state.bookTimer=setTimeout(function(){
    if(!document.getElementById("app").hidden) return;
    console.warn("book not open after",Math.round((Date.now()-t0)/1000),"s; local=",state.local,"error=",state.bookError);
    var why=state.bookError?("The book refused to load: "+dbMsg(state.bookError)+" ("+(state.bookError.code||"")+").")
      :"Signed in, but the book hasn't loaded. Something on this browser may be blocking firestore.googleapis.com — an ad blocker or strict tracking prevention. Try another browser, or start over below.";
    document.getElementById("siHint").textContent=why;
    document.getElementById("siReset").hidden=false;
  },6000);
}

// Still on the starting password? Require a new one before anything else.
function enforceFreshPassword(user,typedPw){
  var m=user?memberForEmail(user.email):null; if(!m||!typedPw) return;
  if(A.isDefaultPassword(user,typedPw,state.config.members)) forcePasswordChange(m);
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
document.getElementById("pwDlg").addEventListener("cancel",function(e){ if(state.mustChange) e.preventDefault(); });
// A signed-in manager changes their own password — nobody else's. Firebase requires
// a fresh sign-in first, which is what the current password is for.
function changeOwnPassword(){
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
  }).catch(function(e){ hint.textContent=authMsg(e); });
}
// The admin sets or changes a manager's password (auth.js does the work).
function setPassword(memberId,pw){
  if(!state.admin) return Promise.reject({ message:"Only the admin can set passwords" });
  var m=member(memberId); if(!m) return Promise.reject({ message:"No such manager" });
  if(!pw||pw.length<6) return Promise.reject({ code:"auth/weak-password" });
  return A.setPassword(m,pw,function(){ return prompt("An account for "+m.name+" already exists. Enter its current password to change it:"); });
}

/* ---- roster dialog ---- */
function openRoster(){
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
function drawRoster(){
  var adm=!!state.admin;
  document.getElementById("rosterList").innerHTML=state.config.members.map(function(m){
    return '<div class="rrow">'+avatarHtml(m.id,26)+
      '<span class="r-name">'+esc(m.name)+"</span>"+
      (isAdminMember(m.id)?'<span class="r-adm">Admin</span>':"")+
      '<span class="r-team">'+esc(m.team||"—")+"</span>"+
      (adm?'<input class="field r-pw" type="password" data-pw="'+esc(m.id)+'" autocomplete="new-password" placeholder="Set password">'+
           '<button class="btn" data-act="setPw" data-id="'+esc(m.id)+'">Set</button>'+
           '<button class="btn" data-act="pwDefault" data-id="'+esc(m.id)+'" title="'+esc(defaultPw(m))+'">Default</button>':"")+
      (adm?'<label class="check r-chk"><input type="checkbox" data-act="admToggle" data-id="'+esc(m.id)+'"'+(isAdminMember(m.id)?" checked":"")+'> Admin</label>':"")+
      (adm&&m.id!==state.me?'<button class="btn danger" data-act="rmMember" data-id="'+esc(m.id)+'">Remove</button>':"")+
    "</div>";
  }).join("");
}

/* ---- events ---- */
document.addEventListener("click",function(ev){
  var t=ev.target.closest("[data-act]"); if(!t) return;
  var act=t.getAttribute("data-act"), id=t.getAttribute("data-id");

  if(act==="filter"){ state.filter.status=t.getAttribute("data-status"); render(); }
  else if(act==="mine"){ state.filter.mine=!state.filter.mine; render(); }
  else if(act==="publishLeague"){ publishLeague(); }
  else if(act==="take"||act==="accept"){ takeSeat(id,Number(t.getAttribute("data-i"))); }
  else if(act==="pass"){
    if(!guard()) return;
    var pi=Number(t.getAttribute("data-i"));
    state.bets.forEach(function(b){
      if(b.id!==id) return;
      if(isLocked(b)) return toast("Locked — too late to pass");
      var e=entriesOf(b)[pi];
      if(!e||e.memberId||e.invite!==state.me) return;
      e.declined=true;   // the invite stays on record; the seat opens to anyone
      saveBet(b);
    });
    toast("Passed — the seat is open to anyone");
  }
  else if(act==="settle"){ openSettleDlg(id); }
  else if(act==="edit"){ openBetDlg(id); }
  else if(act==="join"){ openJoinDlg(id); }
  else if(act==="paidPair"){ markPairPaid(t.getAttribute("data-from"),t.getAttribute("data-to")); }
  else if(act==="paidOne"){ if(guard()){ markPaid(id,t.getAttribute("data-m")); toast("Marked paid"); } }
  else if(act==="win"){
    if(!guard()) return;
    var w=t.getAttribute("data-w");
    state.bets.forEach(function(b){
      if(b.id!==id) return;
      b.status="settled"; b.winner=w; b.settledAt=new Date().toISOString(); b.settledBy=state.me;
      if(!Array.isArray(b.paid)) b.paid=[];
      saveBet(b);
    });
    document.getElementById("settleDlg").close();
    toast(w==="push"?"Called a push":"Result recorded");
  }
  else if(act==="reopen"){
    if(!guard()) return;
    state.bets.forEach(function(b){ if(b.id===id){ b.status="active"; b.winner=null; b.paid=[]; saveBet(b); } });
    toast("Back to live");
  }
  else if(act==="void"){
    if(!guard()) return;
    var wasOpen=false;
    state.bets.forEach(function(b){
      if(b.id!==id) return;
      wasOpen=b.status==="open";
      b.status="void"; b.winner=null; b.voidedAt=new Date().toISOString(); b.voidedBy=state.me;
      if(wasOpen){ b.cancelled=true; b.voidedReason="Cancelled by "+mName(state.me); }
      saveBet(b);
    });
    toast(wasOpen?"Cancelled":"Voided");
  }
  else if(act==="restore"){
    if(!guard()) return;
    // Back to where it was before the void: open if a seat is empty, otherwise live.
    state.bets.forEach(function(b){ if(b.id===id){ b.status=openSeats(b)?"open":"active"; b.winner=null; delete b.autoVoid; delete b.cancelled; delete b.voidedAt; delete b.voidedBy; delete b.voidedReason; saveBet(b); } });
    toast("Restored");
  }
  else if(act==="del"){ if(guard()){ removeBet(id); toast("Deleted"); } }
  else if(act==="dRm"){ state.draft.splice(Number(t.getAttribute("data-i")),1); drawEntries(); }
  else if(act==="dScope"){
    state.draftScope=t.getAttribute("data-scope")||"";
    state.draft.forEach(function(e){ e.picks=[]; e.pick=""; e.side=""; });
    if(state.draftScope==="game"){ state.draft=state.draft.slice(0,2); while(state.draft.length<2) state.draft.push({memberId:null,pick:"",picks:[],side:""}); }
    drawScope(); drawEntries();
  }
  else if(act==="dMarket"){
    state.draftMarket=t.getAttribute("data-market")==="total"?"total":"ml";
    state.draft.forEach(function(e){ e.side=""; });
    drawGameBox(); drawEntries();
  }
  else if(act==="dSide"){
    var si=Number(t.getAttribute("data-i")), sv=t.getAttribute("data-side");
    state.draft.forEach(function(e,j){ if(j!==si&&e.side===sv) e.side=""; });   // one side per pick
    state.draft[si].side=sv;
    drawEntries();
  }
  else if(act==="dStat"){
    var sk=t.getAttribute("data-stat"), at=state.draftStats.indexOf(sk);
    if(at>=0){ if(state.draftStats.length>1) state.draftStats.splice(at,1); }   // keep at least one
    else state.draftStats.push(sk);
    drawScope();
  }
  else if(act==="dAdd"){ addPick(Number(t.getAttribute("data-i")),t.getAttribute("data-id")); }
  else if(act==="dDrop"){
    var di=Number(t.getAttribute("data-i")), pid=t.getAttribute("data-id"), de=state.draft[di];
    de.picks=(de.picks||[]).filter(function(p){ return p.id!==pid; }); de.pick=picksText(de.picks);
    drawEntries();
  }
  else if(act==="rmMember"){
    if(!state.admin) return toast("Only the admin can do that");
    if(id===state.me) return toast("You can't remove yourself");
    state.config.members=state.config.members.filter(function(m){ return m.id!==id; });
    drawRoster(); saveConfig();
  }
  else if(act==="signin"){ showLogin(); }
  else if(act==="pwDefault"){
    var dm=member(id); if(!dm) return;
    setPassword(id,defaultPw(dm)).then(function(msg){ toast(msg+" · "+defaultPw(dm)); }).catch(function(e){ toast(authMsg(e)); });
  }
  else if(act==="setPw"){
    var pwIn=document.querySelector('input[data-pw="'+id+'"]');
    setPassword(id,pwIn?pwIn.value:"").then(function(msg){ if(pwIn) pwIn.value=""; toast(msg); }).catch(function(e){ toast(authMsg(e)); });
  }
});

document.addEventListener("change",function(ev){
  var t=ev.target, act=t.getAttribute&&t.getAttribute("data-act");
  if(act==="admToggle"){
    if(!state.admin){ t.checked=!t.checked; return toast("Only the admin can do that"); }
    var mm=member(t.getAttribute("data-id")); if(!mm) return;
    var list=adminEmails().filter(function(e){ return e!==emailFor(mm); });
    if(t.checked) list.push(emailFor(mm));
    if(!list.length){ t.checked=true; return toast("Keep at least one admin"); }
    state.config.adminEmails=list; saveConfig(); drawRoster();
    toast(t.checked?mm.name+" is an admin":mm.name+" is no longer an admin");
  }
  else if(act==="week"){ state.filter.week=t.value; render(); }
  else if(t.id==="bWeek"&&state.draftScope==="game"){ state.draftGame=null; state.draftFav=""; state.draft.forEach(function(e){ e.side=""; }); drawGameBox(); drawEntries(); }
  else if(t.id==="bGame"){
    var gid=t.value, pick=null;
    allGames().forEach(function(g){ if(g.id===gid) pick=g; });
    state.draftGame=pick?{ id:pick.id, week:pick.week, away:pick.away, home:pick.home, date:pick.date }:null;
    state.draftFav=""; state.draftLine=""; state.draft.forEach(function(e){ e.side=""; });
    var nm=document.getElementById("bName");
    if(pick&&!nm.value.trim()) nm.value=pick.away+" @ "+pick.home;
    drawGameBox(); drawEntries();
  }
  else if(act==="dMem"){
    var di2=Number(t.getAttribute("data-i")), d2=state.draft[di2];
    if(di2>0&&!d2.memberId) d2.invite=t.value||null;   // row one is always you; accepted seats don't change
  }
});
document.addEventListener("input",function(ev){
  var t=ev.target, act=t.getAttribute&&t.getAttribute("data-act");
  if(act==="dPick") state.draft[Number(t.getAttribute("data-i"))].pick=t.value;
  else if(act==="dSearch") drawSugg(Number(t.getAttribute("data-i")),t.value);
  else if(t.id==="bLine"){ state.draftLine=t.value.trim(); if(state.draftMarket==="total") drawEntries(); }
});
document.addEventListener("keydown",function(ev){
  var t=ev.target;
  if(ev.key==="Enter"&&t.getAttribute&&t.getAttribute("data-act")==="dSearch"){
    ev.preventDefault();
    var first=document.querySelector("#sugg"+t.getAttribute("data-i")+" button");
    if(first) addPick(Number(t.getAttribute("data-i")),first.getAttribute("data-id"));
  }
});

document.getElementById("newBetBtn").addEventListener("click",function(){ openBetDlg(); });
document.getElementById("betDlg").addEventListener("close",function(){ state.editId=null; });
document.getElementById("refreshBtn").addEventListener("click",requestRefresh);
document.getElementById("rosterBtn").addEventListener("click",openRoster);
document.getElementById("bSave").addEventListener("click",function(e){ e.preventDefault(); submitBet(); });
document.getElementById("jSave").addEventListener("click",function(e){ e.preventDefault(); submitJoin(); });
document.getElementById("joinDlg").addEventListener("close",function(){ state.joinId=null; });
document.getElementById("bAddSide").addEventListener("click",function(e){
  e.preventDefault();
  if(state.draft.length>=8) return toast("Eight sides is plenty");
  state.draft.push({memberId:null,pick:""}); drawEntries();
});
document.getElementById("signOutBtn").addEventListener("click",function(){ A.signOut().then(function(){ location.reload(); }); });
document.getElementById("pwBtn").addEventListener("click",function(){
  document.getElementById("pwCur").value=""; document.getElementById("pwNew").value=""; document.getElementById("pwHint").textContent="";
  document.getElementById("pwDlg").showModal(); document.getElementById("pwCur").focus();
});
document.getElementById("pwGo").addEventListener("click",function(e){ e.preventDefault(); changeOwnPassword(); });
document.getElementById("siForm").addEventListener("submit",function(e){ e.preventDefault(); submitLogin(); });
document.getElementById("siReset").addEventListener("click",function(){
  try{ localStorage.clear(); }catch(e){}
  A.signOut().catch(function(){}).then(function(){ location.replace(location.pathname); });
});
["siName","siPw","siKey"].forEach(function(id){ document.getElementById(id).addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); submitLogin(); } }); });
document.getElementById("rAdd").addEventListener("click",function(e){
  e.preventDefault();
  if(!state.admin) return toast("Only the admin can do that");
  var n=document.getElementById("rNewName").value.trim();
  if(!n) return toast("Name required");
  state.config.members.push({ id:uid(), name:n,
    team:document.getElementById("rNewTeam").value.trim(),
    color:COLORS[state.config.members.length%COLORS.length] });
  document.getElementById("rNewName").value="";
  document.getElementById("rNewTeam").value="";
  drawRoster(); saveConfig();
});
document.getElementById("rSave").addEventListener("click",function(e){
  e.preventDefault();
  if(!state.admin) return toast("Only the admin can do that");
  state.config.leagueName=document.getElementById("rName").value.trim()||state.config.leagueName;
  state.config.season=document.getElementById("rSeason").value.trim()||state.config.season;
  var s=parseFloat(document.getElementById("rStake").value);
  if(s>0) state.config.stake=Math.round(s*100)/100;
  var ko=new Date(document.getElementById("rKickoff").value);   // datetime-local reads as local time
  if(!isNaN(ko)) state.config.kickoff=ko.toISOString();
  saveConfig();
  document.getElementById("rosterDlg").close();
  toast("League saved");
});

/* ---- boot ---- */
state.config=defaultLeague();
state.bets=defaultBets();
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
  storedKey();   // scrub a ?key= link into device memory right away
  A.onAuthStateChanged(function(user){
    applyAuth(user);
    if(user) enterBook(user);
    else { if(state.db){ location.reload(); return; } showLogin(); }
    render();
  });
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
      var d=clone(snap.data());
      if(d&&Array.isArray(d.members)&&d.members.length){
        state.config={ leagueName:d.leagueName||"Smyrna League", season:d.season||"",
                       stake:Number(d.stake)||25, members:d.members,
                       kickoff:d.kickoff||DEFAULT_KICKOFF,
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
        document.getElementById("login").hidden=true;
        document.getElementById("app").hidden=false;
      } else {
        state.bookError={ code:"empty-config", message:"league settings are empty" };
      }
    } else {
      state.bookError={ code:"no-config", message:"no league settings under this passcode" };
    }
    render();
  },function(e){ state.bookError=e; console.error("league/config:",e); toast(dbMsg(e)); });

  db.doc("league/refresh").onSnapshot(function(snap){
    state.refresh=snap.exists?clone(snap.data()):null;
    statsBar();
  },function(){ /* freshness strip is optional; stay quiet */ });

  db.doc("league/games").onSnapshot(function(snap){
    state.games=snap.exists?snap.data():null;
    ticker();
  },function(){ /* no ticker without the games doc */ });

  db.doc("league/roster").onSnapshot(function(snap){
    state.roster=snap.exists?snap.data():null;   // read-only; no clone needed
    if(document.getElementById("betDlg").open){ drawScope(); drawEntries(); }
  },function(){ /* picker falls back to free text */ });

  db.collection("bets").limit(1000).onSnapshot(function(snap){
    remoteBets=snap.docs.map(function(d){
      var v=clone(d.data())||{};
      v.id=d.id;
      if(!Array.isArray(v.entries)) v.entries=[];
      if(!Array.isArray(v.paid)) v.paid=[];
      return v;
    });
    if(state.local) return;
    state.bets=remoteBets;
    render();
  },function(e){ toast(dbMsg(e)); });
}
