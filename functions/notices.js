// What to tell whom when the book changes. Pure: the function hands it a document
// as it was and as it is, plus the league's members, and gets back a list of
// { to:[memberIds], title, body, tag, bet }. Nothing here touches Firebase, so the
// unit tests run it directly. Whoever made the change never hears about it.
"use strict";

function money(n){ var v=Math.abs(Number(n)||0); return "$"+(v%1?v.toFixed(2):String(Math.round(v))); }
function nameOf(id,members){ var m=(members||[]).find(function(x){ return x&&x.id===id; }); return m?m.name:"Former manager"; }
function ids(list){ return Array.from(new Set((list||[]).filter(Boolean))); }
function without(list,x){ return (list||[]).filter(function(i){ return i!==x; }); }
function seated(b){ return ids(((b&&b.entries)||[]).map(function(e){ return e&&e.memberId; })); }
function list(names){ return names.length<=2?names.join(" and "):names.slice(0,-1).join(", ")+" and "+names[names.length-1]; }

// A bet document written: created, a seat taken, an invite passed, settled, voided, back on.
function betNotices(before,after,members){
  var out=[];
  if(!after) return out;   // deleted: nothing to say
  var N=function(id){ return nameOf(id,members); };
  var name=after.name||"a bet", amt=money(after.amount);
  var all=ids((members||[]).map(function(m){ return m&&m.id; }));
  var tag="bet-"+(after.id||"");
  var say=function(to,title,body){ to=ids(to); if(to.length) out.push({ to:to, title:title, body:body, tag:tag, bet:after.id||null }); };
  var by=after.createdBy||null, was=before?seated(before):[], now=seated(after);

  if(!before){
    if(after.status==="open"){
      var invited=ids((after.entries||[]).map(function(e){ return e&&!e.memberId?e.invite:null; }));
      say(without(invited,by), N(by)+" wants you on a bet", name+" · "+amt+(after.terms?" · "+after.terms:""));
      say(all.filter(function(i){ return i!==by&&invited.indexOf(i)<0; }), "New bet · "+amt, N(by)+": "+name+(after.terms?" — "+after.terms:""));
    } else if(after.status==="active"){
      say(without(now,by), "You're in a bet", N(by)+" put you on "+name+" · "+amt);
    }
    return out;
  }

  // seats taken, or a pot joined
  var newcomers=now.filter(function(i){ return was.indexOf(i)<0; });
  if(newcomers.length){
    var left=(after.entries||[]).filter(function(e){ return e&&!e.memberId; }).length;
    var how=after.status==="active"&&before.status!=="active"?"the bet is on":(left?left+(left===1?" seat":" seats")+" still open":"");
    say(ids(was.concat([by])).filter(function(i){ return newcomers.indexOf(i)<0; }), list(newcomers.map(N))+(newcomers.length===1?" is in":" are in"), name+" · "+amt+(how?" · "+how:""));
  }

  // an invitee passed: the proposer hears; the seat is open to anyone now
  var passed=(after.entries||[]).filter(function(e,i){ var p=(before.entries||[])[i]; return e&&e.declined&&e.invite&&!e.memberId&&!(p&&p.declined); }).map(function(e){ return e.invite; });
  if(passed.length) say(without([by],passed[0]), N(passed[0])+" passed", name+" · the seat is open to anyone");

  if(after.status==="settled"&&before.status!=="settled"){
    var actor=after.settledBy&&after.settledBy!=="auto"?after.settledBy:null, w=after.winner;
    var losers=without(now,w).map(N);
    say(without(ids(now.concat([by])),actor), w==="push"?"Push · "+name:N(w)+" wins "+name,
        (w==="push"?"Nobody pays":amt+" from "+list(losers))+(after.settledNote?" · "+after.settledNote:""));
  }

  if(after.status==="void"&&before.status!=="void"){
    if(after.autoVoid) say([by], "No takers · "+name, "Cancelled at lock — nobody took it");
    else say(without(ids(now.concat([by])),after.voidedBy||null), (before.status==="open"?"Cancelled · ":"Voided · ")+name, "by "+N(after.voidedBy));
  }

  if((before.status==="settled"||before.status==="void")&&(after.status==="active"||after.status==="open")){
    say(ids(now.concat([by])), name+" is back on", before.status==="settled"?"The result was reopened":"Restored"+(after.status==="open"?" · a seat is open":""));
  }
  return out;
}

// league/payments written: a payment recorded, or one undone.
function paymentNotices(before,after,members){
  var out=[], N=function(id){ return nameOf(id,members); };
  var was={}; ((before&&before.list)||[]).forEach(function(p){ if(p&&p.id) was[p.id]=p; });
  ((after&&after.list)||[]).forEach(function(p){
    if(!p||!p.id) return;
    var prev=was[p.id];
    if(!prev) out.push({ to:ids(without([p.from,p.to],p.by)), title:N(p.from)+" paid "+N(p.to)+" "+money(p.amount), body:"Recorded by "+N(p.by), tag:"pay-"+p.id, bet:null });
    else if(p.voided&&!prev.voided) out.push({ to:ids(without([p.from,p.to],p.voidedBy)), title:"Payment undone", body:N(p.from)+" → "+N(p.to)+" "+money(p.amount)+", undone by "+N(p.voidedBy), tag:"pay-"+p.id, bet:null });
  });
  return out.filter(function(n){ return n.to.length; });
}

// league/highlow written: a week just went final.
function highLowNotices(before,after,members,stake){
  var out=[], all=ids((members||[]).map(function(m){ return m&&m.id; }));
  stake=Number(stake)>0?Number(stake):5;
  var was=(before&&before.weeks)||{}, now=(after&&after.weeks)||{};
  Object.keys(now).map(Number).filter(function(w){ return w>0&&!was[String(w)]; }).sort(function(a,b){ return a-b; }).forEach(function(w){
    var e=now[String(w)]; if(!e||!e.high||!e.low||!e.high.length||!e.low.length) return;
    var hi=e.high.map(function(r){ return r.name||nameOf(r.id,members); }), lo=e.low.map(function(r){ return r.name||nameOf(r.id,members); });
    var each=function(n){ return money(stake/n); };
    out.push({ to:all, title:"Week "+w+" · high and low", body:list(hi)+" +"+each(e.high.length)+" · "+list(lo)+" −"+each(e.low.length), tag:"hl-"+w, bet:null });
  });
  return out;
}

module.exports={ betNotices:betNotices, paymentNotices:paymentNotices, highLowNotices:highLowNotices, money:money };
