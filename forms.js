// The propose/edit form and the join form: the draft in state, the player/defense
// picker, game mode (winner or over/under), and the submit that turns a draft into
// a bet. Reads state, writes the dialogs' DOM, saves through book.js.

import * as R from "./rules.js?v=dev";
import { state, members } from "./state.js?v=dev";
import { toast } from "./render.js?v=dev";
import { guard, findBet, saveBet } from "./book.js?v=dev";
import { dbMsg } from "./store.js?v=dev";

const STATS=R.STATS, LAST_WEEK=R.LAST_WEEK, PLAYOFF_START=R.PLAYOFF_START, LOCK_LEAD=R.LOCK_LEAD;
const esc=R.esc, money=R.money, uid=R.uid, clone=R.clone, entriesOf=R.entriesOf, fmtWhen=R.fmtWhen,
      shortName=R.shortName, picksText=R.picksText, statsKey=R.statsKey, autoName=R.autoName;
const mName=function(id){ return R.mName(id,members()); };
const isLocked=function(b){ return R.isLocked(b,state.config); };
const weekLocked=function(w){ return R.weekLocked(w,state.config); };
const allGames=function(){ return R.allGames(state.games); };
const teamName=function(code){ return R.teamName(code,state.roster); };
const rosterRows=function(){ return R.rosterRows(state.roster); };
const rosterFind=function(id){ return R.rosterFind(id,state.roster); };
const rosterSearch=function(q,scope){ return R.rosterSearch(q,scope,state.roster); };
const autoTerms=function(scope,tracks,week,entries){ return R.autoTerms(scope,tracks,week,entries,members()); };
const buildStats=function(entries){ return R.buildStats(entries,state.draftScope,state.draftStats); };

// Games still open for a bet in a week: not yet within an hour of kickoff.
export function openGames(week){
  var now=Date.now();
  return allGames().filter(function(g){ return g.week===Number(week)&&now<Date.parse(g.date)-LOCK_LEAD; });
}
export function drawGameBox(){
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
export function drawScope(){
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

export function drawEntries(hostId){
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
      opts='<option value="">Open seat — anyone</option>'+members().filter(function(m){ return m.id!==state.me; }).map(function(m){
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
export function drawSugg(i,q){
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
export function addPick(i,id){
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
export function dropPick(i,pid){
  var de=state.draft[i];
  de.picks=(de.picks||[]).filter(function(p){ return p.id!==pid; }); de.pick=picksText(de.picks);
  drawEntries();
}

// Opens the form empty, or — given a bet id — pre-filled to edit that bet in place.
export function openBetDlg(editId){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=null;
  if(editId){
    bet=findBet(editId);
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

export function submitBet(){
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
  var existing=state.editId?findBet(state.editId):null;
  var proposer=(existing&&existing.createdBy)||state.me;
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
export function openJoinDlg(id){
  if(!guard()) return;
  if(!state.me) return toast("Pick your name first");
  var bet=findBet(id);
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
export function submitJoin(){
  var id=state.joinId, bet=findBet(id);
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
