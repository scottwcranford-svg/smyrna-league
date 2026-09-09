// Pure league logic: the stat catalog, kickoff locks, ledger math, auto-written
// bet names and terms, game covers, schedule parsing, roster lookups and the small
// formatting helpers. Nothing here touches the DOM, the network or Firebase; every
// function takes what it needs as arguments so it can be tested under Node.

export const COLORS = ["#3B5799","#A8353B","#1C6F53","#8A6A12","#6D4C9F","#0F7284","#B4542A","#2F6B34","#8C3D6B","#4A5D75","#A0522D","#365F9E"];
export const REG_WEEKS = 14, PLAYOFF_START = 15, LAST_WEEK = 17;

// What a bet can be scored on. [sleeper field or composite, label, lowerIsBetter]
export const STATS = {
  player:[
    ["pts_ppr","PPR points"],["pts_std","Standard points"],
    ["pass_yd","Passing yards"],["pass_td","Passing TDs"],["pass_int","Interceptions thrown",true],
    ["rush_yd","Rushing yards"],["rush_td","Rushing TDs"],
    ["rec","Receptions"],["rec_yd","Receiving yards"],["rec_td","Receiving TDs"],
    ["rush_rec_yd","Rushing + receiving yards"],["td_scored","Rushing + receiving TDs"],["fum_lost","Fumbles lost",true]
  ],
  team:[
    ["takeaways","Takeaways · INT + fumble recoveries"],["int","Interceptions"],["ff","Forced fumbles"],
    ["sack","Sacks"],["def_td","Defensive TDs"],["pts_allow","Points allowed",true],
    ["yds_allow","Yards allowed",true],["pts_ppr","Defense fantasy points"]
  ]
};
export const COMPOSITES = { takeaways:["int","fum_rec"], td_scored:["rush_td","rec_td"], rush_rec_yd:["rush_yd","rec_yd"] };
export const FANTASY_POS = {QB:1,RB:1,WR:1,TE:1,K:1};

export const DEFAULT_KICKOFF="2026-09-10T00:20:00Z";   // the opener: Wed Sep 9 2026, 8:20 PM ET (Seattle)
export const WEEK_ANCHOR="2026-09-11T00:15:00Z";       // Week 1's Thursday, 8:15 PM ET — weeks 2+ lock on that cadence
export const LOCK_LEAD=60*60*1000;                     // bets lock one hour before the week's first game
export const SLEEPER_LEAGUE_ID="1314265150127116288";   // the Smyrna League on Sleeper (league/config.sleeperLeagueId overrides)
export const AUTH_DOMAIN="smyrna.league";              // sign-in ids are <slug(name)>@smyrna.league; nobody sees them

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

export function isPlayoff(w){ return Number(w)>=PLAYOFF_START; }

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

/* ---- kickoff locks ----
   Every bet locks one hour before the first game of its week (season bets: the opener).
   `config.weekStarts` carries the real schedule; the anchor cadence is the fallback. */

export function kickoffTime(config){ var t=Date.parse((config&&config.kickoff)||DEFAULT_KICKOFF); return isNaN(t)?Date.parse(DEFAULT_KICKOFF):t; }

export function firstGame(week,config){
  week=Number(week)||0;
  var ws=config&&config.weekStarts;
  var key=String(week<=1?1:week);
  if(ws&&ws[key]){ var t=Date.parse(ws[key]); if(!isNaN(t)) return t; }
  if(week<=1) return kickoffTime(config);
  return Date.parse(WEEK_ANCHOR)+(week-1)*7*86400000;
}

export function lockTime(week,config){ return firstGame(week,config)-LOCK_LEAD; }

export function betLock(b,config){
  if(b&&b.game&&b.game.date){ var t=Date.parse(b.game.date); if(!isNaN(t)) return t-LOCK_LEAD; }
  return lockTime(b?b.week:0,config);
}

export function weekLocked(week,config){ return Date.now()>=lockTime(week,config); }

export function isLocked(b,config){ return (b.status==="open"||b.status==="active")&&Date.now()>=betLock(b,config); }

export function currentWeek(config,games){
  var now=Date.now(), w=1;
  for(var i=1;i<=18;i++){ if(now>=firstGame(i,config)-LOCK_LEAD) w=i; }
  // once a week's last game is comfortably over, roll to the next
  var G=allGames(games), last=0;
  G.forEach(function(g){ if(g.week===w){ var t=Date.parse(g.date); if(t>last) last=t; } });
  if(last&&now>last+5*3600000&&w<18) w++;
  return w;
}

/* ---- stats ---- */

/* ---- weekly high / low ----
   Each week the league's top Sleeper score collects the stake from the bottom score;
   ties share it. It runs all season and settles at the end. league/highlow holds
   { weeks: { "3": { high: [{ id, name, pts }], low: [...] } } }, one entry per week
   whose games are all final. */
export const HL_STAKE=5;
export function hlStake(config){ var n=Number(config&&config.hlStake); return n>0?n:HL_STAKE; }
// The week's high and low from [{ id, name, pts }] rows; ties are kept together.
export function highLow(rows){
  rows=(rows||[]).filter(function(r){ return typeof r.pts==="number"&&!isNaN(r.pts); });
  if(rows.length<2) return null;
  var max=-Infinity, min=Infinity;
  rows.forEach(function(r){ if(r.pts>max) max=r.pts; if(r.pts<min) min=r.pts; });
  if(max===min) return null;   // everyone tied: nothing changes hands
  var pick=function(v){ return rows.filter(function(r){ return r.pts===v; }).map(function(r){ return { id:r.id||null, name:r.name||"", pts:r.pts }; }); };
  return { high:pick(max), low:pick(min) };
}
// Running tally per manager: net dollars, weeks on top, weeks on the bottom.
export function hlTally(hl,members,stake){
  stake=stake||HL_STAKE;
  var byId={}; (members||[]).forEach(function(m){ byId[m.id]={ net:0, highs:0, lows:0 }; });
  var weeks=Object.keys((hl&&hl.weeks)||{}).map(Number).filter(function(w){ return w>0; }).sort(function(a,b){ return a-b; });
  weeks.forEach(function(w){
    var e=hl.weeks[String(w)]; if(!e||!e.high||!e.low||!e.high.length||!e.low.length) return;
    e.high.forEach(function(r){ if(r.id&&byId[r.id]){ byId[r.id].net+=stake/e.high.length; byId[r.id].highs++; } });
    e.low.forEach(function(r){ if(r.id&&byId[r.id]){ byId[r.id].net-=stake/e.low.length; byId[r.id].lows++; } });
  });
  Object.keys(byId).forEach(function(id){ byId[id].net=Math.round(byId[id].net*100)/100; });
  return { byId:byId, weeks:weeks };
}
// Weeks whose games are all final (and that have games at all).
export function finalWeeks(games){
  var G=allGames(games), by={};
  G.forEach(function(g){ var w=Number(g.week); if(!by[w]) by[w]={ n:0, done:0 }; by[w].n++; if(g.status==="final") by[w].done++; });
  return Object.keys(by).map(Number).filter(function(w){ return by[w].n>0&&by[w].done===by[w].n; }).sort(function(a,b){ return a-b; });
}

/* ---- projections ----
   Sleeper's weekly projections, trimmed to the roster and to the stats the app tracks,
   ride in league/proj as { weeks: { "5": "<json>" } }. A projection is read with the
   same valueFor as the actuals, so it is always the bet's own stat. */
export const STAT_SHORT={ pts_ppr:"pts", pts_std:"pts", pass_yd:"pass yds", pass_td:"pass TD", pass_int:"INT", rush_yd:"rush yds", rush_td:"rush TD",
  rec:"rec", rec_yd:"rec yds", rec_td:"rec TD", rush_rec_yd:"scrimmage yds", td_scored:"TD", fum_lost:"fum", takeaways:"takeaways", int:"INT", ff:"FF", sack:"sacks",
  def_td:"TD", pts_allow:"pts allowed", yds_allow:"yds allowed" };
export function projKeys(){
  var ks={};
  ["player","team"].forEach(function(sc){ STATS[sc].forEach(function(s){ ks[s[0]]=1; (COMPOSITES[s[0]]||[]).forEach(function(f){ ks[f]=1; }); }); });
  return Object.keys(ks);
}
export function trimProjections(raw,rosterIds){
  var keys=projKeys(), out={};
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return out;
  (rosterIds||[]).forEach(function(id){
    var v=raw[id]; if(!v||typeof v!=="object") return;
    var o={}, any=false;
    keys.forEach(function(k){ var n=Number(v[k]); if(n){ o[k]=Math.round(n*10)/10; any=true; } });
    if(any) out[id]=o;
  });
  return out;
}
var projCache={};   // week -> [json string, parsed]
export function projFor(week,proj){
  var w=proj&&proj.weeks?proj.weeks[String(week)]:null;
  if(!w) return null;
  if(typeof w!=="string") return w;
  var c=projCache[week];
  if(c&&c[0]===w) return c[1];
  var parsed=null; try{ parsed=JSON.parse(w); }catch(e){ parsed=null; }
  projCache[week]=[w,parsed];
  return parsed;
}

export function valueFor(key,kind,totals){
  var total=0, fields=COMPOSITES[kind]||[kind];
  String(key).split("+").forEach(function(k){ var row=totals[k.trim()]||{}; fields.forEach(function(f){ total+=Number(row[f]||0); }); });
  return Math.round(total*10)/10;
}

export function buildStats(entries,scope,statIds){
  if(!scope||!STATS[scope]) return null;
  var tracks=[];
  STATS[scope].forEach(function(s){ if((statIds||[]).indexOf(s[0])>=0) tracks.push({ stat:s[0], metric:s[1], lower:!!s[2] }); });
  if(!tracks.length) return null;
  var rows=[], multi=false;
  entries.forEach(function(e,i){
    var picks=e.picks||[]; if(!picks.length) return;
    if(picks.length>1) multi=true;
    var values={}; tracks.forEach(function(t){ values[t.stat]=0; });
    var row={ key:picks.map(function(p){ return p.id; }).join("+"),
              label:picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + "),
              memberId:e.memberId||null, entry:i, value:0, values:values };
    if(scope==="player") row.team=picks.map(function(p){ return p.team; }).join(" · ");
    rows.push(row);
  });
  if(!rows.length) return null;
  if(multi) tracks.forEach(function(t){ t.metric+=" · combined"; });
  // `stat`/`metric`/`lower` mirror the first track so older readers still work.
  return { scope:scope, tracks:tracks, stat:tracks[0].stat, metric:tracks[0].metric, lower:tracks[0].lower,
           rows:rows, through:"Not refreshed yet", source:"Sleeper", updatedAt:null };
}

export function statsKey(S){
  if(!S||!Array.isArray(S.rows)) return "";
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{stat:S.stat}];
  return (S.scope||"")+"|"+tracks.map(function(t){ return t.stat; }).join(",")+"|"+
    S.rows.map(function(r){ return r.key+"@"+(r.entry!=null?r.entry:""); }).join(";");
}

/* ---- ledger ---- */

export function computeLedger(config,bets){
  // risk: stake on live bets. offered: stake on bets still waiting for takers.
  // cancelled: stake on bets that reached the lock with no takers and cancelled themselves.
  var pnl={}, pairs={}, risk={}, offered={}, cancelled={}, picks={};
  (config?config.members:[]).forEach(function(m){
    pnl[m.id]={net:0,w:0,l:0,p:0,weekly:0,season:0}; risk[m.id]=0; offered[m.id]=0; cancelled[m.id]=0; picks[m.id]=[];
  });
  var touch=function(id){ if(id&&!pnl[id]) pnl[id]={net:0,w:0,l:0,p:0,weekly:0,season:0}; };

  (bets||[]).forEach(function(b){
    var amt=Number(b.amount)||0;
    var ents=entriesOf(b).filter(function(e){ return e.memberId; });

    if(b.status==="open") ents.forEach(function(e){ if(offered[e.memberId]!=null) offered[e.memberId]+=amt; });
    if(b.status==="active") ents.forEach(function(e){ if(risk[e.memberId]!=null) risk[e.memberId]+=amt; });
    if(b.status==="void"&&b.autoVoid) ents.forEach(function(e){ if(cancelled[e.memberId]!=null) cancelled[e.memberId]+=amt; });
    if(b.status==="open"||b.status==="active"){
      // The ledger card lists the bets a manager is in, by name.
      var title=b.name||String(b.terms||"").slice(0,32);
      ents.forEach(function(e){
        if(picks[e.memberId]&&picks[e.memberId].indexOf(title)<0) picks[e.memberId].push(title);
      });
    }
    if(b.status!=="settled"||ents.length<2) return;

    ents.forEach(function(e){ touch(e.memberId); });
    if(b.winner==="push"){ ents.forEach(function(e){ pnl[e.memberId].p++; }); return; }
    var win=b.winner;
    if(!win||!pnl[win]) return;

    var losers=ents.filter(function(e){ return e.memberId!==win; });
    var bucket=Number(b.week)>0?"weekly":"season";   // net by kind, for the season table
    pnl[win].net += amt*losers.length; pnl[win].w++; pnl[win][bucket]+=amt*losers.length;
    var paid=Array.isArray(b.paid)?b.paid:[];
    losers.forEach(function(e){
      pnl[e.memberId].net -= amt; pnl[e.memberId].l++; pnl[e.memberId][bucket]-=amt;
      if(paid.indexOf(e.memberId)>=0) return;
      var key=[win,e.memberId].sort().join("|");
      if(pairs[key]==null) pairs[key]=0;
      pairs[key] += (key.split("|")[0]===win?amt:-amt);
    });
  });

  var debts=[];
  Object.keys(pairs).forEach(function(key){
    var v=pairs[key]; if(Math.abs(v)<0.005) return;
    var ids=key.split("|");
    debts.push(v>0?{from:ids[1],to:ids[0],amount:v,key:key}:{from:ids[0],to:ids[1],amount:-v,key:key});
  });
  debts.sort(function(a,b){ return b.amount-a.amount; });
  return { pnl:pnl, debts:debts, risk:risk, offered:offered, cancelled:cancelled, picks:picks };
}

/* ---- game bets ---- */

export function coverSide(b,g){
  if(!g||g.awayScore==null||g.homeScore==null) return null;
  var a=g.awayScore, h=g.homeScore;
  if(b.market==="total"){ var tot=a+h, ln=Number(b.line); return tot>ln?"over":tot<ln?"under":"push"; }
  if(b.market==="spread"){
    var favHome=(b.fav||b.game.home)===b.game.home, ln2=Number(b.line);
    var favPts=(favHome?h:a)-ln2, dogPts=favHome?a:h;
    return favPts>dogPts?(favHome?"home":"away"):favPts<dogPts?(favHome?"away":"home"):"push";
  }
  return a>h?"away":h>a?"home":"push";
}

export function lineText(b){
  if(!b.game) return "";
  if(b.market==="spread") return (b.fav||b.game.home)+" −"+b.line;
  if(b.market==="total") return "O/U "+b.line;
  return "Straight up";
}

export function allGames(games){ return (games&&Array.isArray(games.games))?games.games:[]; }

export function gameOf(b,games){
  if(!b||!b.game) return null;
  var G=allGames(games), hit=null;
  G.forEach(function(g){ if(!hit&&g.id===b.game.id) hit=g; });
  if(!hit) G.forEach(function(g){ if(!hit&&g.week===b.game.week&&g.away===b.game.away&&g.home===b.game.home) hit=g; });
  return hit||b.game;   // fall back to what the bet stored
}

/* ---- who can join ----
   A stat bet is open to joiners until it locks unless the proposer switched joining
   off, or it's a player-vs-the-field bet (sides with different player counts, set up
   on purpose). A game bet is two sides and never takes a third. */

export function isFieldBet(b){
  var counts=[]; entriesOf(b).forEach(function(e){ var n=(e.picks||[]).length; if(n&&counts.indexOf(n)<0) counts.push(n); });
  return counts.length>1;
}

export function canJoin(b){
  return !!b&&!b.game&&b.joinable!==false&&(b.status==="open"||b.status==="active")&&!isFieldBet(b);
}

/* ---- settling without a button ----
   A game bet settles from the final score. A stat bet settles once every game of
   its period is final and the standings were refreshed after the last one ended;
   the leader on the tracked stat wins, a tie is a push, and a bet tracking several
   stats goes to whoever leads the most of them. Season bets run through LAST_WEEK.
   Returns null while there's nothing to decide yet. */

export const SETTLE_LAG=4*3600000;   // a game is over this long after kickoff; stats after that count

export function autoResult(b,games,now){
  if(!b||b.status!=="active") return null;
  var ents=entriesOf(b), owner=function(e){ return e&&e.memberId||null; };
  if(b.game){
    var g=gameOf(b,games);
    if(!g||g.status!=="final"||g.awayScore==null||g.homeScore==null) return null;
    var cv=coverSide(b,g);
    if(cv==="push") return { winner:"push", note:"Push · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore };
    var code=cv==="away"?b.game.away:cv==="home"?b.game.home:cv;   // "over"/"under" as-is
    var hit=null; ents.forEach(function(e){ if(!hit&&e.memberId&&e.side===code) hit=e; });
    return hit?{ winner:hit.memberId, note:"Final · "+g.away+" "+g.awayScore+", "+g.home+" "+g.homeScore }:null;
  }
  var S=b.stats; if(!S||!Array.isArray(S.rows)||S.rows.length<2) return null;
  var w=Number(b.week)||0, through=w||LAST_WEEK;
  var slate=allGames(games).filter(function(x){ return x.week===through; });
  if(!slate.length||slate.some(function(x){ return x.status!=="final"; })) return null;
  var lastKick=0; slate.forEach(function(x){ var t=Date.parse(x.date); if(t>lastKick) lastKick=t; });
  var fresh=Date.parse(S.updatedAt||"");
  if(isNaN(fresh)||fresh<lastKick+SETTLE_LAG||(now||Date.now())<lastKick+SETTLE_LAG) return null;
  var tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{ stat:S.stat, lower:S.lower }];
  var wins={};
  tracks.forEach(function(t){
    var best=null, leaders=[];
    S.rows.forEach(function(r){
      var v=Number((r.values&&t.stat in r.values)?r.values[t.stat]:r.value)||0;
      var who=r.memberId||owner(ents[r.entry]); if(!who) return;
      if(best===null||(t.lower?v<best:v>best)){ best=v; leaders=[who]; } else if(v===best&&leaders.indexOf(who)<0) leaders.push(who);
    });
    if(leaders.length===1) wins[leaders[0]]=(wins[leaders[0]]||0)+1;
  });
  var top=0, tops=[];
  Object.keys(wins).forEach(function(id){ if(wins[id]>top){ top=wins[id]; tops=[id]; } else if(wins[id]===top) tops.push(id); });
  var period=w?"Week "+w:"Season";
  if(tops.length!==1) return { winner:"push", note:period+" complete · tied" };
  return { winner:tops[0], note:period+" complete · "+(S.through||"") };
}

/* ---- auto-written names and terms ---- */

export function autoTerms(scope,tracks,week,entries,members){
  var names=(tracks||[]).map(function(t){ return String(t.metric||t.stat||"").replace(/ · combined$/,""); });
  var lc=function(s){ return s.charAt(0).toLowerCase()+s.slice(1); };
  var what;
  if(names.length>1){
    // several stats: name them plainly; "most"/"fewest" would misread across the list
    var list=names.map(lc); list[0]=names[0];
    what=list.slice(0,-1).join(", ")+" and "+list[list.length-1]+" (each its own standings)";
  } else what=((tracks[0]&&tracks[0].lower)?"Fewest ":"Most ")+lc(names[0]||"");
  var when=Number(week)?" in Week "+Number(week):" on the season";
  var sides=(entries||[]).map(function(e){
    var picks=e.picks||[];
    if(picks.length) return picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + ");
    if(e.pick) return e.pick;
    return e.memberId?mName(e.memberId,members):"an open seat";
  });
  // one side so far: the proposal stands against whoever joins
  return what+when+(sides.length===1?" — "+sides[0]+" vs the field":sides.length?" — "+sides.join(" vs "):"")+".";
}

export function autoName(tracks,week,entries){
  var sides=(entries||[]).map(function(e){
    var picks=e.picks||[];
    if(picks.length) return picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + ");
    return e.pick||"";
  }).filter(Boolean);
  if(sides.length===2&&(entries||[]).length===2) return sides[0]+" vs "+sides[1];
  var m=String((tracks&&tracks[0]&&(tracks[0].metric||tracks[0].stat))||"Stat").replace(/ · combined$/,"");
  return m+(Number(week)?" · Week "+Number(week):" · Season")+((entries||[]).length>2?" pot":"");
}

/* ---- schedule CSV (nflverse games.csv) → first kickoff per week, in UTC ---- */

export function weekStartsFromCsv(csv,season){
  var lines=csv.split(/\r?\n/).filter(Boolean), head=splitCsv(lines[0]), first={}, ix={};
  head.forEach(function(h,i){ ix[h]=i; });
  for(var i=1;i<lines.length;i++){ var c=splitCsv(lines[i]);
    if(c[ix.season]!==String(season)||c[ix.game_type]!=="REG"||!c[ix.gameday]||!c[ix.gametime]) continue;
    var t=etToUtc(c[ix.gameday],c[ix.gametime]), w=String(Number(c[ix.week]));
    if(!(w in first)||t<first[w]) first[w]=t; }
  var out={}; Object.keys(first).forEach(function(w){ out[w]=new Date(first[w]).toISOString().replace(/\.\d{3}Z$/,"Z"); });
  return out;
}

export function splitCsv(line){ var out=[],cur="",q=false; for(var i=0;i<line.length;i++){ var ch=line[i];
  if(q){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; }
  else if(ch==='"') q=true; else if(ch===","){ out.push(cur); cur=""; } else cur+=ch; } out.push(cur); return out; }

export function etOffsetMin(t){ var f=new Intl.DateTimeFormat("en-US",{ timeZone:"America/New_York", hour12:false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  var p={}; f.formatToParts(new Date(t)).forEach(function(x){ p[x.type]=x.value; });
  return Math.round((t-Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute))/60000); }

export function etToUtc(dateStr,timeStr){ var a=dateStr.split("-").map(Number), b=timeStr.split(":").map(Number), t=Date.UTC(a[0],a[1]-1,a[2],b[0],b[1]);
  for(var i=0;i<2;i++) t=Date.UTC(a[0],a[1]-1,a[2],b[0],b[1])+etOffsetMin(t)*60000; return t; }

/* ---- members and admins ---- */

export function member(id,members){
  members=members||[];
  for(var i=0;i<members.length;i++){ if(members[i].id===id) return members[i]; }
  return null; }

export function mName(id,members){ var m=member(id,members); return m?m.name:"Former manager"; }

export function mColor(id,members){ var m=member(id,members); return m?m.color:"var(--ink-3)"; }

export function slugName(n){ return String(n||"").toLowerCase().replace(/[^a-z0-9]/g,""); }

export function emailFor(m){ return slugName(m.name)+"@"+AUTH_DOMAIN; }

export function defaultPw(m){ return String(m.name||"")+"123!"; }

export function memberForEmail(email,members){
  email=String(email||"").toLowerCase();
  var hit=null; (members||[]).forEach(function(m){ if(!hit&&emailFor(m)===email) hit=m; });
  return hit;
}

export function adminEmails(config){ return (config&&Array.isArray(config.adminEmails))?config.adminEmails.map(function(e){ return String(e).toLowerCase(); }):[]; }

export function adminIds(config){ var members=config?config.members:[];
  return adminEmails(config).map(function(e){ var m=memberForEmail(e,members); return m?m.id:null; }).filter(Boolean); }

export function isAdminMember(id,config){ var m=member(id,config?config.members:[]); return !!m&&adminEmails(config).indexOf(emailFor(m))>=0; }

/* ---- roster (Sleeper players + defenses): rows are [id, name, pos, team] ---- */

export function rosterRows(roster){ return (roster&&Array.isArray(roster.players))?roster.players:[]; }

/* ---- player status ----
   A roster row's fifth slot is a short status code from Sleeper, present only when
   the player isn't simply active. Injury designations first, then the roster status. */
export const STATUS_LABEL={ Q:"Questionable", D:"Doubtful", OUT:"Out", IR:"Injured reserve", PUP:"Physically unable to perform",
  SUS:"Suspended", COV:"COVID list", NA:"Not active", DNR:"Did not report", INA:"Inactive", PS:"Practice squad" };
var INJURY={ questionable:"Q", doubtful:"D", out:"OUT", ir:"IR", pup:"PUP", sus:"SUS", cov:"COV", na:"NA", dnr:"DNR" };
var ROSTER_STATUS={ "injured reserve":"IR", "physically unable to perform":"PUP", "practice squad":"PS", inactive:"INA" };
export function statusCode(v){
  if(!v) return "";
  var inj=String(v.injury_status||"").trim().toLowerCase();
  if(inj&&INJURY[inj]) return INJURY[inj];
  var st=String(v.status||"").trim().toLowerCase();
  if(!st||st==="active") return "";
  return ROSTER_STATUS[st]||"";
}
// Status codes for a pick id ("a", or "a+b" for a combined pick), from the current roster.
export function statusOf(id,roster){
  var out=[];
  String(id||"").split("+").forEach(function(k){ var r=rosterFind(k.trim(),roster); var c=r&&r[4]; if(c&&out.indexOf(c)<0) out.push(c); });
  return out;
}
export function rosterFind(id,roster){ var rows=rosterRows(roster); for(var i=0;i<rows.length;i++){ if(rows[i][0]===id) return rows[i]; } return null; }

export function teamName(code,roster){
  var rows=rosterRows(roster);
  for(var i=0;i<rows.length;i++){ if(rows[i][2]==="DEF"&&rows[i][0]===code) return rows[i][1]; }
  return code;
}

// Teams with a game in a week, as a set. Empty when that week's schedule isn't
// known — season-long bets, the playoffs, or before the schedule has loaded — and
// an empty set filters nobody.
export function teamsPlaying(week,games){
  var w=Number(week)||0, out={};
  if(!w) return out;
  allGames(games).forEach(function(g){ if(Number(g.week)===w){ out[g.away]=1; out[g.home]=1; } });
  return out;
}
// A roster row or a pick whose team sits out the week. `team` is the team code.
export function onBye(team,playing){
  var any=false; for(var k in playing){ any=true; break; }
  return any&&!playing[team];
}

export function rosterSearch(q,scope,roster){
  q=String(q||"").trim().toLowerCase(); if(q.length<2) return [];
  var out=[], rows=rosterRows(roster);
  for(var i=0;i<rows.length&&out.length<8;i++){
    var r=rows[i], isDef=r[2]==="DEF";
    if(scope==="team"?!isDef:isDef) continue;
    var hay=(r[1]+" "+r[3]).toLowerCase();
    if(hay.indexOf(q)>=0) out.push(r);
  }
  return out;
}
