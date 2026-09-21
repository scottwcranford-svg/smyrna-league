// Drawing the poker table. The fifth DOM writer: reads state.poker (the public table),
// state.pokerSession (tonight's money) and state.hole (my own cards), writes #poker and
// the tab's note. render.js never imports this - app.js calls pokerView() after
// render() - so the table can lean on render.js's avatars and toast without a cycle.
//
// The clock is the one thing here that moves between snapshots: a one-second interval
// rewrites the seconds and the ring on the seat to act, and nothing else, so the page
// is not redrawn once a second. When it hits zero the page sends the dealer a tick,
// stamped with the hand and seq it saw, and the dealer does whatever is due; every open
// page does the same and the dealer accepts the first (dealer.js, functions/poker).

import * as Fmt from "./fmt.js?v=dev";
import * as Id from "./identity.js?v=dev";
import * as Ledger from "./ledger.js?v=dev";
import * as Poker from "./poker.js?v=dev";
import * as Dl from "./dealer.js?v=dev";
import { state, members, touch } from "./state.js?v=dev";
import { avatarHtml, phone } from "./render.js?v=dev";

const esc=Fmt.esc;
const money=function(c){ return Fmt.money(Poker.dollars(c)); };
const mName=function(id){ return Id.mName(id,members()); };
const CLOCK=30000, BETWEEN=6000;

// app.js hands each table snapshot here: a new hand or seq clears the page's own draft
// (the raise it was sitting on, the last refusal, a half-confirmed Leave), and the
// dealer's clock is measured against this device's.
export function pokerSnapshot(doc){
  state.poker=doc||null;
  var k=doc?doc.handNo+":"+doc.seq:"";
  if(k!==state.pokerKey){ state.pokerKey=k; state.pokerRaise=null; state.pokerErr=""; state.pokerLeaveAsk=false; }
  if(doc&&doc.updatedAt){ var off=Date.parse(doc.updatedAt)-Date.now(); if(!isNaN(off)) state.pokerOffset=off; }
}

/* ---- cards ---- */
function cardHtml(code,cls){
  var c=Poker.card(code);
  return '<span class="pk-card'+(c.red?" red":"")+(cls?" "+cls:"")+'"><b>'+esc(c.rank)+'</b><i>'+esc(c.suit)+"</i></span>";
}
function backHtml(){ return '<span class="pk-card back" aria-hidden="true"></span>'; }
function slotHtml(){ return '<span class="pk-card slot" aria-hidden="true"></span>'; }

/* ---- the page ---- */
export function pokerView(){
  var el=document.getElementById("poker"); if(!el) return;
  var T=state.poker, me=state.me, note=document.getElementById("pokerNote");
  if(!T||T.status==="closed"){
    if(note) note.textContent="Texas Hold'em, cash game, the league only. Chips are dollars, settled between yourselves.";
    el.innerHTML=emptyHtml(T)+sessionHtml(state.pokerSession,true);
    return;
  }
  var seatedN=Poker.seats(T).length;
  if(note) note.textContent="Blinds "+money(T.blinds.sb)+"/"+money(T.blinds.bb)+" · buy in "+money(T.minBuy)+" to "+money(T.maxBuy)+" · "+seatedN+" seated"+(T.handNo?" · hand #"+T.handNo:"")+(T.closing?" · closes after this hand":"");
  var mine=Poker.mySeat(T,me);
  el.innerHTML=bannerHtml(T,mine)+tableHtml(T,me,mine)+mineHtml(T,mine)+'<div class="pk-err" id="pkErr"'+(state.pokerErr?"":" hidden")+">"+esc(state.pokerErr)+"</div>"
    +actionsHtml(T,mine)+seatCtlHtml(T,mine)+lastHandHtml(T)+sessionHtml(state.pokerSession,false);
  tickClock();
}

function emptyHtml(T){
  var was=T&&T.status==="closed"&&T.closedAt?"The last table closed "+Fmt.ago(T.closedAt)+". ":"";
  return '<div class="empty pk-empty">'+esc(was)+'No table open.<div style="margin-top:12px"><button type="button" class="btn pri" data-act="pkOpen">Open a table</button></div></div>';
}

function bannerHtml(T,mine){
  if(!mine) return "";
  if(mine.busted||(mine.stack+mine.pendingAdd<=0&&!Poker.inHand(mine)))
    return '<div class="pk-banner" data-state="busted"><span>You\'re out of chips.</span><button type="button" class="btn pri" data-act="pkRebuy">Add chips</button></div>';
  if(mine.satOutAt&&!Poker.inHand(mine))
    return '<div class="pk-banner" data-state="out"><span>You\'re sat out — the dealer deals around you.</span><button type="button" class="btn pri" data-act="pkBack">I\'m back</button></div>';
  if(mine.satOutAt) return '<div class="pk-banner" data-state="out"><span>You\'re out after this hand.</span><button type="button" class="btn" data-act="pkBack">Stay in</button></div>';
  if(mine.leaving) return '<div class="pk-banner" data-state="leaving"><span>You\'re leaving after this hand.</span></div>';
  return "";
}

// The dealer button and the blinds, as discs. On a desktop they ride the seat's edge
// that faces the board, at its outer end: the inner corner is where the seat's bet lies.
// On a phone they follow the name.
function marksHtml(T,s,B){
  if(T.status!=="hand") return "";
  return (T.button===s.seat?'<i class="pk-disc d" data-tip="Dealer button">D</i>':"")
    +(B.sb===s.seat?'<i class="pk-disc sb" data-tip="Small blind">SB</i>':"")
    +(B.bb===s.seat?'<i class="pk-disc bb" data-tip="Big blind">BB</i>':"");
}
const chipHtml='<i class="pk-chip" aria-hidden="true"></i>';
const at=function(p){ return ' style="left:'+p.x+'%;top:'+p.y+'%"'; };

function seatHtml(T,me,o,onPhone,B){
  var s=o.seat, pos=onPhone?"":at(Poker.seatXY(o.off));
  if(!s){
    var canSit=!Poker.seated(T,me)&&T.status!=="closed";
    return '<div class="pk-seat empty" data-seat="'+o.i+'"'+pos+">"+(canSit?'<button type="button" class="btn" data-act="pkSit" data-seat="'+o.i+'">Sit</button>':'<span class="pk-open">open</span>')+"</div>";
  }
  var isMe=s.memberId===me, actor=T.status==="hand"&&T.toAct===s.seat, dealer=T.button===s.seat&&T.status==="hand";
  var cls="pk-seat"+(isMe?" me":"")+(actor?" actor":"")+(s.status==="folded"?" folded":"")+(s.status==="allin"?" allin":"")+(s.status==="out"?" out":"")+(s.status==="waiting"?" waiting":"")+(dealer?" dealer":"");
  var sub;
  if(actor) sub='<span class="pk-turn">to act · <span class="pk-clock">'+Poker.secondsLeft(T.deadline,Date.now(),state.pokerOffset)+"s</span></span>";
  else if(s.status==="folded") sub="folded";
  else if(s.status==="allin") sub="all in";
  else if(s.status==="out") sub=s.busted?"out of chips":"sitting out";
  else if(s.status==="waiting"&&T.status==="hand") sub="next hand";
  else if(s.bet>0&&onPhone) sub='<span class="pk-bet">'+chipHtml+"bet "+money(s.bet)+"</span>";   // on the oval the chips are on the felt
  else sub=s.lastAction&&T.status==="hand"?esc({ check:"checked", call:"called", raise:"raised" }[s.lastAction.op]||s.lastAction.op):"";
  var cards="";
  if(T.status==="hand"&&(s.status==="in"||s.status==="allin")&&!isMe) cards=backHtml()+backHtml();
  else if(T.status!=="hand"&&T.lastHand&&T.lastHand.shown&&T.lastHand.shown[s.seat]) cards=T.lastHand.shown[s.seat].map(function(c){ return cardHtml(c,"small"); }).join("");
  var marks=marksHtml(T,s,B), felt="";
  if(!onPhone){
    var xy=Poker.seatXY(o.off);
    if(marks) marks='<span class="pk-marks '+(xy.y>50?"t":"b")+(xy.x>50?"r":"l")+'" data-for="'+s.seat+'">'+marks+"</span>";
    if(s.bet>0) felt+='<span class="pk-chips num" data-for="'+s.seat+'"'+at(Poker.betXY(o.off))+">"+chipHtml+money(s.bet)+"</span>";
  }
  return '<div class="'+cls+'" data-seat="'+s.seat+'"'+pos+'>'+(actor?'<span class="pk-ring" aria-hidden="true"></span>':"")
    +avatarHtml(s.memberId,onPhone?26:30)
    +'<div class="pk-info"><span class="pk-name">'+esc(mName(s.memberId))+(isMe?' <small>you</small>':"")+(onPhone&&marks?" "+marks:"")+'</span>'
    +'<span class="pk-stack num">'+money(s.stack)+(s.pendingAdd?" <small>+"+money(s.pendingAdd)+"</small>":"")+"</span>"
    +'<span class="pk-sub">'+sub+"</span></div>"
    +(cards?'<span class="pk-cards">'+cards+"</span>":"")+(onPhone?"":marks)+"</div>"+felt;
}

function tableHtml(T,me,mine){
  var onPhone=phone();
  var order=Poker.seatOrder(T,me);
  var B=Poker.blindSeats(T);
  var seatsHtml=order.map(function(o){ return seatHtml(T,me,o,onPhone,B); }).join("");
  var street=T.status==="hand"?({preflop:"Pre-flop",flop:"Flop",turn:"Turn",river:"River"}[T.street]||T.street)+" · hand #"+T.handNo
    :T.status==="between"?"Next hand in <span class=\"pk-clock\">"+Poker.secondsLeft(T.deadline,Date.now(),state.pokerOffset)+"s</span>"
    :Poker.seats(T).filter(function(s){ return !s.satOutAt&&s.stack+s.pendingAdd>0; }).length<2?"Waiting for a second player":"Waiting";
  var board=(T.board||[]).map(function(c){ return cardHtml(c); }).join("");
  for(var i=(T.board||[]).length;i<5;i++) board+=slotHtml();
  var pots=(T.pots||[]);
  // one number while everyone can still bet; the layers only once somebody is all in
  var anyAllIn=Poker.seats(T).some(function(s){ return s.status==="allin"; });
  var potText=T.status==="hand"?(pots.length>1&&anyAllIn?money(pots[0].amount)+" pot · side "+pots.slice(1).map(function(p){ return money(p.amount); }).join(", "):money(Poker.potTotal(T))+" pot"):(T.lastHand?money(T.lastHand.pot)+" pot":"");
  // a pile in the middle once a street's bets have been swept in; before that the chips are in front of the seats
  var pile=T.status==="hand"&&Poker.potTotal(T)-Poker.streetBets(T)>0?'<i class="pk-chip pile" aria-hidden="true"></i>':"";
  return '<div class="pk-table" data-status="'+esc(T.status)+'">'
    +'<div class="pk-center"><span class="pk-street lbl">'+street+'</span><div class="pk-board">'+board+'</div><span class="pk-pot num">'+pile+potText+'</span><span class="pk-last">'+esc(T.lastText||"")+"</span></div>"
    +'<div class="pk-seats">'+seatsHtml+"</div></div>";
}

function mineHtml(T,mine){
  var H=state.hole;
  // my cards are shown only for my seat in this hand: a doc left from another account
  // on this device, or an older hand, is never anyone's cards
  if(!mine||!H||H.handNo!==T.handNo||H.seat!==mine.seat||T.status!=="hand"||!Poker.inHand(mine)) return "";
  var turn=Poker.myTurn(T,state.me);
  var call=Poker.toCall(T,mine);
  return '<div class="pk-mine'+(mine.status==="folded"?" folded":"")+'">'+(H.cards||[]).map(function(c){ return cardHtml(c,"big"); }).join("")
    +'<div class="pk-mine-r">'+(turn?'<span class="pk-ring big"><span class="pk-clock">'+Poker.secondsLeft(T.deadline,Date.now(),state.pokerOffset)+'s</span></span><span class="pk-turn">your turn</span>'
      :'<span class="pk-sub">'+(mine.status==="folded"?"folded":mine.status==="allin"?"all in":"waiting on "+esc(T.toAct!=null&&T.seats[T.toAct]?mName(T.seats[T.toAct].memberId):"the dealer"))+"</span>")
    +(turn?'<span class="pk-sub">'+(call?money(call)+" to call":"nothing to call")+" · pot "+money(Poker.potTotal(T))+"</span>":"")+"</div></div>";
}

function actionsHtml(T,mine){
  if(!Poker.myTurn(T,state.me)) return "";
  var dis=state.pokerBusy?" disabled":"";
  var call=Poker.toCall(T,mine), b=Poker.raiseBounds(T,mine), canRaise=b.max>(T.currentBet||0)&&mine.stack>call;
  var to=state.pokerRaise==null?b.min:Poker.clampRaise(state.pokerRaise,b);
  var html='<div class="pk-actions" id="pkActions"><div class="pk-row">'
    +'<button type="button" class="btn danger" data-act="pkFold"'+dis+'>Fold</button>'
    +(call?'<button type="button" class="btn pri" data-act="pkCall"'+dis+'>Call '+money(call)+(call>=mine.stack?" · all in":"")+"</button>":'<button type="button" class="btn pri" data-act="pkCheck"'+dis+">Check</button>")
    +(canRaise?'<button type="button" class="btn gold" data-act="pkRaise" id="pkRaiseBtn"'+dis+'>'+(T.currentBet?"Raise to ":"Bet ")+money(to)+"</button>":"")
    +(canRaise&&b.max>b.min?'<button type="button" class="btn" data-act="pkAllIn"'+dis+'>All in '+money(b.max)+"</button>":"")
    +"</div>";
  if(canRaise&&b.max>b.min){
    html+='<div class="pk-raise">'+["min","half","pot","allin"].map(function(w){ return '<button type="button" class="chip" data-act="pkPreset" data-preset="'+w+'"'+dis+'>'+(w==="min"?"Min":w==="half"?"½ pot":w==="pot"?"Pot":"All in")+"</button>"; }).join("")
      +'<input type="range" id="pkRaiseSlider" data-act="pkRaiseAmt" aria-label="Raise to" min="'+Poker.dollars(b.min)+'" max="'+Poker.dollars(b.max)+'" step="1" value="'+Poker.dollars(to)+'"'+dis+">"
      +'<span class="money-in"><span class="sig">$</span><input class="field num" id="pkRaiseAmt" data-act="pkRaiseAmt" inputmode="decimal" aria-label="Raise to, dollars" value="'+Poker.dollars(to)+'"'+dis+"></span></div>";
  }
  return html+"</div>";
}

function seatCtlHtml(T,mine){
  var canClose=state.me&&(T.openedBy===state.me||state.admin)&&!T.closing;
  if(!mine){
    var open=Poker.seats(T).length<Poker.SEATS&&T.status!=="closed";
    return '<div class="pk-seatctl" id="pkSeatCtl">'+(open?'<button type="button" class="btn pri" data-act="pkSit">Sit down</button>':'<span class="pk-sub">The table is full</span>')
      +(canClose?'<button type="button" class="btn" data-act="pkClose">Close the table</button>':"")+"</div>";
  }
  var rb=Poker.buyInBounds(T,mine,"rebuy");
  return '<div class="pk-seatctl" id="pkSeatCtl">'
    +'<button type="button" class="btn" data-act="pkRebuy"'+(rb.max>0?"":" disabled")+'>Add chips</button>'
    +(mine.satOutAt?'<button type="button" class="btn" data-act="pkBack">I\'m back</button>':'<button type="button" class="btn" data-act="pkSitOut">Sit out</button>')
    +(state.pokerLeaveAsk?'<span class="pk-ask">Leave and cash out '+money(mine.stack+mine.pendingAdd)+'? <button type="button" class="btn danger" data-act="pkLeaveYes">Leave</button> <button type="button" class="btn" data-act="pkLeaveNo">Stay</button></span>'
      :'<button type="button" class="btn" data-act="pkLeave"'+(mine.leaving?" disabled":"")+'>Leave</button>')
    +(canClose?'<button type="button" class="btn" data-act="pkClose">Close the table</button>':"")+"</div>";
}

function lastHandHtml(T){
  var H=T.lastHand; if(!H) return "";
  var winners=(H.winners||[]).map(function(w){ return '<span class="pk-win">'+avatarHtml(w.memberId,22)+" <b>"+esc(mName(w.memberId))+'</b> <b class="pos">+'+money(w.amount)+"</b>"+(w.text?" <span>"+esc(w.text)+"</span>":"")+"</span>"; }).join("");
  var shown=Object.keys(H.shown||{}).map(function(i){ var s=T.seats[Number(i)]; return '<span class="pk-shown">'+esc(s?mName(s.memberId):"seat "+i)+" "+H.shown[i].map(function(c){ return cardHtml(c,"small"); }).join("")+"</span>"; }).join("");
  return '<div class="pk-hands"><div class="track-title">Last hand · #'+H.no+'</div><div class="pk-hand">'+winners+(shown?'<div class="pk-shown-row">'+shown+'<span class="pk-sub">board '+(H.board||[]).map(function(c){ return cardHtml(c,"small"); }).join("")+"</span></div>":'<div class="pk-sub">Everyone else folded</div>')+"</div></div>";
}

function sessionHtml(S,closed){
  var rows=Poker.sessionRows(S); if(!rows.length) return "";
  var tr=Ledger.settleTransfers(Poker.netsFor(S));
  var when=S.openedAt?Fmt.fmtWhen(S.openedAt):"";
  return '<div class="pk-session"><div class="track-title">'+(closed?"Last session":"This session")+(when?" · from "+esc(when):"")+(S.hands?" · "+S.hands+" hands":"")+"</div>"
    +'<div class="pk-sess-head"><span></span><span>In</span><span>Out</span><span>Stack</span><span>Net</span></div>'
    +rows.map(function(r){ return '<div class="pk-sess">'+avatarHtml(r.id,22)+'<span class="pk-sess-name">'+esc(mName(r.id))+'</span><span class="num">'+money(r.in)+'</span><span class="num">'+money(r.out)+'</span><span class="num">'+(r.onTable?money(r.onTable):"—")+'</span><b class="num '+(r.net>0?"pos":r.net<0?"neg":"")+'">'+(r.net>0?"+":r.net<0?"−":"")+money(r.net)+"</b></div>"; }).join("")
    +(tr.length?'<div class="track-title" style="margin-top:8px">Settle outside the app · as it stands</div><div class="pk-transfers">'+tr.map(function(t){ return "<span>"+esc(mName(t.from))+" → "+esc(mName(t.to))+" <b>"+Fmt.money(t.amount)+"</b></span>"; }).join("")+"</div>":"")
    +'<div class="pk-sub pk-note">Chips are dollars. Nothing here goes to Settle up; sort it out between yourselves when the table closes.</div></div>';
}

/* ---- the clock ---- */
function tickClock(){
  var T=state.poker; if(!T||!T.deadline||(T.status!=="hand"&&T.status!=="between")) return;
  var now=Date.now(), s=Poker.secondsLeft(T.deadline,now,state.pokerOffset);
  document.querySelectorAll("#poker .pk-clock").forEach(function(el){ el.textContent=s+"s"; });
  var frac=Poker.clockFraction(T.deadline,T.status==="hand"?CLOCK:BETWEEN,now,state.pokerOffset);
  document.querySelectorAll("#poker .pk-ring").forEach(function(el){ el.style.setProperty("--pk-left",String(frac)); });
  if(s===0) pokerTimeout();
}
setInterval(tickClock,1000);

// The clock ran out: tell the dealer, once per hand and seq. The player on the clock
// says so at once; everyone else a few seconds later, in case that page is gone.
export function pokerTimeout(){
  var T=state.poker; if(!T||(T.status!=="hand"&&T.status!=="between")) return;
  var key=T.handNo+":"+T.seq;
  if(state.pokerTimeoutSent===key) return;
  state.pokerTimeoutSent=key;
  var mine=Poker.mySeat(T,state.me);
  var delay=Poker.myTurn(T,state.me)?0:(T.status==="between"?(mine?400:2500):3000);
  setTimeout(function(){ if(state.pokerKey!==key) return; Dl.send({ op:"tick", hand:T.handNo, seq:T.seq }).catch(function(){}); },delay);
}

/* ---- the raise controls, without a redraw ---- */
// The slider and the amount box mirror each other and the Raise button, by hand: a
// redraw mid-drag would rebuild the slider under the thumb.
export function raiseInput(t){
  var T=state.poker, mine=Poker.mySeat(T,state.me); if(!T||!mine) return;
  var b=Poker.raiseBounds(T,mine), cents=Math.round((parseFloat(t.value)||0)*100);
  state.pokerRaise=Poker.clampRaise(cents,b);
  var other=document.getElementById(t.id==="pkRaiseSlider"?"pkRaiseAmt":"pkRaiseSlider");
  if(other&&other!==t&&t.id==="pkRaiseSlider") other.value=Poker.dollars(state.pokerRaise);
  else if(other&&other!==t) other.value=Poker.dollars(state.pokerRaise);
  var btn=document.getElementById("pkRaiseBtn"); if(btn) btn.textContent=(T.currentBet?"Raise to ":"Bet ")+money(state.pokerRaise);
}
export function raiseAmount(){
  var T=state.poker, mine=Poker.mySeat(T,state.me); if(!T||!mine) return 0;
  var b=Poker.raiseBounds(T,mine);
  return state.pokerRaise==null?b.min:Poker.clampRaise(state.pokerRaise,b);
}

/* ---- the buy-in sheet: open a table, sit down, add chips ---- */
const dollarsOf=function(id){ var v=parseFloat(document.getElementById(id).value); return isNaN(v)?NaN:Math.round(v*100); };
export function openPokerBuy(mode,seat){
  var T=state.poker, mine=Poker.mySeat(T,state.me);
  state.pokerDlg={ mode:mode, seat:seat==null?null:seat };
  var dlg=document.getElementById("pkBuyDlg");
  document.getElementById("pkOpenRow").hidden=mode!=="open";
  document.getElementById("pkBuyTitle").textContent=mode==="open"?"Open a table":mode==="rebuy"?"Add chips":"Sit down"+(seat!=null?" · seat "+(seat+1):"");
  document.getElementById("pkBuyLbl").textContent=mode==="rebuy"?"Add":"Buy in for";
  document.getElementById("pkBuyGo").textContent=mode==="open"?"Open and sit":mode==="rebuy"?"Add chips":"Sit down";
  document.getElementById("pkBuyAmt").value="";
  document.getElementById("pkBuyHint").textContent="";
  drawBuyBounds();
  dlg.showModal();
  document.getElementById(mode==="open"?"pkSb":"pkBuyAmt").focus();
}
function buyBounds(){
  var D=state.pokerDlg||{}, T=state.poker, mine=Poker.mySeat(T,state.me);
  if(D.mode==="open"){ var mn=dollarsOf("pkMin"), mx=dollarsOf("pkMax"); return { min:isNaN(mn)?0:mn, max:isNaN(mx)?0:mx }; }
  return Poker.buyInBounds(T,mine,D.mode);
}
export function drawBuyBounds(){
  var D=state.pokerDlg||{}, T=state.poker, b=buyBounds();
  var desc=document.getElementById("pkBuyDesc"), pre=document.getElementById("pkBuyPresets");
  var bb=D.mode==="open"?dollarsOf("pkBb"):(T?T.blinds.bb:0), sb=D.mode==="open"?dollarsOf("pkSb"):(T?T.blinds.sb:0);
  desc.textContent=(isNaN(sb)||isNaN(bb)?"":"Blinds "+money(sb)+"/"+money(bb)+". ")+(D.mode==="rebuy"?"Add up to "+money(b.max)+", on the table at the next deal. ":"Buy in "+money(b.min)+" to "+money(b.max)+". ")+"Chips are dollars, settled outside the app.";
  pre.innerHTML=(b.max>0?[[b.min,"min"],[Math.round((b.min+b.max)/2/100)*100,""],[b.max,"max"]].filter(function(x,i,a){ return x[0]>0&&(i===0||x[0]!==a[i-1][0]); }).map(function(x){ return '<button type="button" class="chip" data-act="pkBuyPreset" data-amt="'+x[0]+'">'+money(x[0])+(x[1]?" "+x[1]:"")+"</button>"; }).join(""):"");
}
export function submitPokerBuy(){
  var D=state.pokerDlg||{}, hint=document.getElementById("pkBuyHint"), dlg=document.getElementById("pkBuyDlg");
  var amt=dollarsOf("pkBuyAmt"), b=buyBounds();
  if(isNaN(amt)||amt<=0){ hint.textContent="How much?"; return; }
  if(amt<b.min||amt>b.max){ hint.textContent=D.mode==="rebuy"?"Up to "+money(b.max):"Between "+money(b.min)+" and "+money(b.max); return; }
  hint.textContent="…";
  var done=function(r){ if(r){ dlg.close(); state.pokerDlg=null; } else hint.textContent=state.pokerErr||"The dealer said no"; };
  if(D.mode==="open"){
    var sb=dollarsOf("pkSb"), bb=dollarsOf("pkBb"), mn=dollarsOf("pkMin"), mx=dollarsOf("pkMax");
    if(!(sb>0&&bb>=sb)){ hint.textContent="Blinds: the big at least the small"; return; }
    if(!(mn>=bb&&mx>=mn)){ hint.textContent="Buy-in: at least a big blind, and min ≤ max"; return; }
    state.pokerBusy=true; state.pokerErr=""; touch();
    Dl.send({ op:"open", sb:sb, bb:bb, minBuy:mn, maxBuy:mx }).then(function(r){
      return Dl.send({ op:"sit", hand:0, seq:r.seq, buyIn:amt });
    }).then(function(){ state.pokerBusy=false; touch(); done(true); })
      .catch(function(e){ state.pokerBusy=false; if(!(e&&e.error==="stale")) state.pokerErr=Dl.msg(e); touch(); done(false); });
    return;
  }
  Dl.act(D.mode==="rebuy"?{ op:"rebuy", amount:amt }:{ op:"sit", seat:D.seat, buyIn:amt }).then(done);
}
export function buyPreset(cents){ document.getElementById("pkBuyAmt").value=String(Poker.dollars(cents)); document.getElementById("pkBuyHint").textContent=""; }
