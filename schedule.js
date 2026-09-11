// The schedule file: Vegas lines and week start times parsed out of the season CSV,
// and the Eastern-time conversion that dates them. Imports nothing.

/* ---- betting lines ----
   The same nflverse games.csv the schedule comes from carries the Vegas numbers:
   `spread_line` (from the home team's side — positive means the home team is favoured)
   and `total_line`. Lines appear a few weeks ahead of kickoff and are simply missing
   for games Vegas hasn't posted, which is why every line in the app stays editable. */

// nflverse calls the Rams LA; the app's game feed calls them LAR. Everything else matches.
const CSV_TEAM={ LA:"LAR" };
function csvTeam(code){ code=String(code||"").trim().toUpperCase(); return CSV_TEAM[code]||code; }
function lineKey(week,away,home){ return Number(week)+"|"+csvTeam(away)+"|"+csvTeam(home); }

export function linesFromCsv(csv,season){
  var rows=String(csv||"").split(/\r?\n/), head=(rows.shift()||"").split(",");
  var ix={}; head.forEach(function(h,i){ ix[h.trim()]=i; });
  var need=["season","game_type","week","away_team","home_team","spread_line","total_line"];
  for(var k=0;k<need.length;k++) if(ix[need[k]]==null) return {};
  var out={};
  for(var i=0;i<rows.length;i++){
    var c=rows[i].split(",");
    if(c[ix.season]!==String(season)||c[ix.game_type]!=="REG") continue;
    var sp=c[ix.spread_line], to=c[ix.total_line];
    if((sp==null||sp==="")&&(to==null||to==="")) continue;   // Vegas hasn't posted this one
    var rec={};
    if(sp!=="" && !isNaN(Number(sp))) rec.spread=Number(sp);
    if(to!=="" && !isNaN(Number(to))) rec.total=Number(to);
    if(!Object.keys(rec).length) continue;
    out[lineKey(c[ix.week],c[ix.away_team],c[ix.home_team])]=rec;
  }
  return out;
}

// What's published for one game, in the app's own terms: who's favoured, by how much,
// and the over/under. Null where Vegas has nothing yet.
export function lineFor(game,lines){
  if(!game||!lines) return null;
  var rec=(lines.byGame||lines)[lineKey(game.week,game.away,game.home)];
  if(!rec) return null;
  var out={ total:rec.total!=null?rec.total:null, spread:null, fav:null, dog:null, pick:false };
  if(rec.spread!=null){
    var n=Number(rec.spread);
    out.spread=Math.abs(n);
    out.pick=n===0;
    out.fav=n>0?game.home:game.away;
    out.dog=n>0?game.away:game.home;
  }
  return (out.total==null&&out.spread==null)?null:out;
}

// One short line for the picker: "SEA −3 · O/U 44.5", or what's missing.
export function lineSummary(L){
  if(!L) return "";
  var parts=[];
  if(L.spread!=null) parts.push(L.pick?"pick'em":L.fav+" \u2212"+L.spread);
  if(L.total!=null) parts.push("O/U "+L.total);
  return parts.join(" \u00b7 ");
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

function splitCsv(line){ var out=[],cur="",q=false; for(var i=0;i<line.length;i++){ var ch=line[i];
  if(q){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; }
  else if(ch==='"') q=true; else if(ch===","){ out.push(cur); cur=""; } else cur+=ch; } out.push(cur); return out; }

function etOffsetMin(t){ var f=new Intl.DateTimeFormat("en-US",{ timeZone:"America/New_York", hour12:false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  var p={}; f.formatToParts(new Date(t)).forEach(function(x){ p[x.type]=x.value; });
  return Math.round((t-Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute))/60000); }

export function etToUtc(dateStr,timeStr){ var a=dateStr.split("-").map(Number), b=timeStr.split(":").map(Number), t=Date.UTC(a[0],a[1]-1,a[2],b[0],b[1]);
  for(var i=0;i<2;i++) t=Date.UTC(a[0],a[1]-1,a[2],b[0],b[1])+etOffsetMin(t)*60000; return t; }
