// The stat catalog and the sums built from it: what a bet can be scored on, the
// value of a stat for an entry, and weekly projections.

import { shortName } from "./fmt.js?v=dev";

// What a bet can be scored on. [sleeper field or composite, label, lowerIsBetter]
export const STATS = {
  // in the order the propose form groups them (STAT_GROUPS); the first listed breaks a tie
  player:[
    ["pts_ppr","PPR points"],["pts_half_ppr","Half-PPR points"],["pts_std","Standard points"],
    ["pass_yd","Passing yards"],["pass_td","Passing TDs"],["pass_int","Interceptions thrown",true],
    ["rush_yd","Rushing yards"],["rush_td","Rushing TDs"],
    ["rec","Receptions"],["rec_yd","Receiving yards"],["rec_td","Receiving TDs"],["rec_tgt","Targets"],
    ["total_yd","Total yards"],["total_td","Total TDs"],["rush_rec_yd","Rushing + receiving yards"],["td_scored","Rushing + receiving TDs"],
    ["touches","Touches"],["turnovers","Turnovers",true],["fum_lost","Fumbles lost",true]
  ],
  team:[
    ["takeaways","Takeaways · INT + fumble recoveries"],["int","Interceptions"],["ff","Forced fumbles"],
    ["sack","Sacks"],["def_td","Defensive TDs"],["pts_allow","Points allowed",true],
    ["yds_allow","Yards allowed",true],["pts_ppr","Defense fantasy points"]
  ]
};
// Headings for the player stat buttons. Only a way to find them - a bet can mix stats from any group.
export const STAT_GROUPS=[["Fantasy",["pts_ppr","pts_half_ppr","pts_std"]],["Passing",["pass_yd","pass_td","pass_int"]],["Rushing",["rush_yd","rush_td"]],
  ["Receiving",["rec","rec_yd","rec_td","rec_tgt"]],["Totals",["total_yd","total_td","rush_rec_yd","td_scored","touches","turnovers","fum_lost"]]];
// A stat made of several Sleeper fields, added up. Same unit only: yards with yards, TDs with TDs.
// (server.js keeps its own copy for the self-hosted refresher - change both.)
const COMPOSITES = { takeaways:["int","fum_rec"], td_scored:["rush_td","rec_td"], rush_rec_yd:["rush_yd","rec_yd"],
  total_yd:["pass_yd","rush_yd","rec_yd"], total_td:["pass_td","rush_td","rec_td"], touches:["rush_att","rec"], turnovers:["pass_int","fum_lost"] };

/* ---- projections ----
   Sleeper's weekly projections, trimmed to the roster and to the stats the app tracks,
   ride in league/proj as { weeks: { "5": "<json>" } }. A projection is read with the
   same valueFor as the actuals, so it is always the bet's own stat. */
export const STAT_SHORT={ pts_ppr:"pts", pts_half_ppr:"pts", pts_std:"pts", rec_tgt:"tgt", total_yd:"total yds", total_td:"TD", touches:"touches", turnovers:"TO", pass_yd:"pass yds", pass_td:"pass TD", pass_int:"INT", rush_yd:"rush yds", rush_td:"rush TD",
  rec:"rec", rec_yd:"rec yds", rec_td:"rec TD", rush_rec_yd:"scrimmage yds", td_scored:"TD", fum_lost:"fum", takeaways:"takeaways", int:"INT", ff:"FF", sack:"sacks",
  def_td:"TD", pts_allow:"pts allowed", yds_allow:"yds allowed" };
function projKeys(){
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

// opts.field: a player-vs-the-field bet. Its field side gets one row per player, and the
// side counts its best one (the ticket groups them; autoResult takes the leading row).
// Any other side with several players is one row with their numbers added together.
export function buildStats(entries,scope,statIds,opts){
  var field=!!(opts&&opts.field);
  if(!scope||!STATS[scope]) return null;
  var tracks=[];
  STATS[scope].forEach(function(s){ if((statIds||[]).indexOf(s[0])>=0) tracks.push({ stat:s[0], metric:s[1], lower:!!s[2] }); });
  if(!tracks.length) return null;
  var rows=[], multi=false;
  entries.forEach(function(e,i){
    var picks=e.picks||[]; if(!picks.length) return;
    if(field&&picks.length>1){
      picks.forEach(function(p){
        var vals={}; tracks.forEach(function(t){ vals[t.stat]=0; });
        var pr={ key:p.id, label:shortName([p.id,p.name,p.pos,p.team]), memberId:e.memberId||null, entry:i, value:0, values:vals };
        if(scope==="player") pr.team=p.team;
        rows.push(pr);
      });
      return;
    }
    if(picks.length>1) multi=true;
    var values={}; tracks.forEach(function(t){ values[t.stat]=0; });
    var row={ key:picks.map(function(p){ return p.id; }).join("+"),
              label:picks.map(function(p){ return shortName([p.id,p.name,p.pos,p.team]); }).join(" + "),
              memberId:e.memberId||null, entry:i, value:0, values:values };
    if(scope==="player") row.team=picks.map(function(p){ return p.team; }).join(" · ");
    rows.push(row);
  });
  if(!rows.length) return null;
  if(field) tracks.forEach(function(t){ t.metric+=" · best of each side"; });
  else if(multi) tracks.forEach(function(t){ t.metric+=" · combined"; });
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
