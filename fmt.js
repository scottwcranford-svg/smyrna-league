// Formatting and the small shared helpers: escaping, money, names, relative
// times, countdowns, ids. Imports nothing.

export const COLORS = ["#3B5799","#A8353B","#1C6F53","#8A6A12","#6D4C9F","#0F7284","#B4542A","#2F6B34","#8C3D6B","#4A5D75","#A0522D","#365F9E"];

/* ---- formatting ---- */

export function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

export function money(n){ var v=Math.abs(Number(n)||0);
  var s = v%1===0?String(v):v.toFixed(2);
  return "$"+s.replace(/\B(?=(\d{3})+(?!\d))/g,","); }

export function signed(n){ return (n>0?"+":n<0?"−":"")+money(n); }

export function initials(name){ var s=String(name||"").replace(/[^A-Za-z0-9]/g,""); return (s.slice(0,2)||"?").toUpperCase(); }

export function shortName(row){ return row[2]==="DEF"?row[1].split(" ").pop():row[1].split(" ").slice(1).join(" ")||row[1]; }

export function picksText(picks){ return (picks||[]).map(function(p){ return p.name; }).join(" + "); }

export function weekLabel(w){ w=Number(w); return w===0?"SEASON":"WK "+w; }

export function kindLabel(k){ return k==="matchup"?"Head to head":k==="future"?"Season future":"Prop"; }

export function clone(o){ return o?JSON.parse(JSON.stringify(o)):o; }

export function entriesOf(b){ return Array.isArray(b.entries)?b.entries:[]; }

export function openSeats(b){ return entriesOf(b).filter(function(e){ return !e.memberId; }).length; }

export function uid(){ return "b"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

export function countdown(t){
  var s=Math.max(0,Math.round((t-Date.now())/1000));
  var d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60);
  if(d) return d+"d "+h+"h";
  if(h) return h+"h "+m+"m";
  return m>0?m+"m":"under a minute";
}

export function fmtWhen(t){
  var d=new Date(t);
  try{ return d.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
  catch(e){ return d.toString(); }
}

export function toLocalInput(iso){
  var d=new Date(iso); if(isNaN(d)) return "";
  var p=function(n){ return (n<10?"0":"")+n; };
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}

export function ago(iso){
  var t=Date.parse(iso||""); if(isNaN(t)) return "";
  var s=Math.max(0,(Date.now()-t)/1000);
  if(s<60) return "just now";
  if(s<3600) return Math.round(s/60)+"m ago";
  if(s<86400) return Math.round(s/3600)+"h ago";
  return Math.round(s/86400)+"d ago";
}

/* ---- balances and net settlement ----
   Nothing is paid bet by bet. Everyone's balance is settled bets plus hi / low, plus what
   they've paid, minus what they've been paid. Payments live in league/payments; the old
   per-bet paid flags count as payments of the stake from loser to winner. The transfers
   that clear everyone: the biggest debtor pays the biggest creditor, and so on. */
export function r2(n){ return Math.round(n*100)/100; }

// "Alice", "Alice and Bob", "Alice, Bob and Cara" — everyone named, however many.
// A shared title is the whole point; hiding half the holders defeats it.
export function nameList(names){
  names=(names||[]).filter(Boolean);
  if(!names.length) return "";
  if(names.length===1) return names[0];
  return names.slice(0,-1).join(", ")+" and "+names[names.length-1];
}
export function fmtDay(t){ return new Date(t).toLocaleDateString(undefined,{ month:"short", day:"numeric" }); }
