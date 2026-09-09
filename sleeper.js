// Keeping the book current, from the browser. Sleeper allows browser calls, so
// whoever has the page open pulls the feeds and writes the results into the book
// for everyone. Short leases keep it to one writer at a time so ten phones don't
// do the same work or burn the free quota. This module and store.js are the only
// ones that touch the network; nothing here reads the page or the shared state —
// callers pass a `ctx` snapshot: { config, games, refresh, bets, roster, holder, mobile }.

import * as R from "./rules.js?v=dev";
import { lease } from "./store.js?v=dev";

export const SLEEPER="https://api.sleeper.app";
export const NFLVERSE_GAMES="https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const ANON="anon"+Math.random().toString(36).slice(2,8);   // lease holder for a page with nobody signed in

export function seasonOf(config){ return String((config&&config.season)||"2026"); }
export function isoNow(){ return new Date().toISOString().replace(/\.\d{3}Z$/,"Z"); }
export function ageMin(iso){ var t=Date.parse(iso||""); return isNaN(t)?1e9:(Date.now()-t)/60000; }
function sj(url){ return fetch(url).then(function(r){ if(!r.ok) throw new Error(r.status+" "+url); return r.json(); }); }
function holder(ctx){ return (ctx&&ctx.holder)||ANON; }

/* ---- feeds → the shapes the book stores ---- */

// Sleeper's /scores feed → the compact game rows the ticker and game bets read.
export function parseScores(lists,weeks){
  var games=[];
  lists.forEach(function(feed,i){ (feed||[]).forEach(function(s){
    var m=s.metadata||{}, iso=(m.date_time||"").replace("+00:00","Z"); if(!iso) return;
    var g={ id:s.game_id, week:Number(s.week||weeks[i]), away:m.away_team||s.away, home:m.home_team||s.home, date:iso.slice(0,19)+"Z" };
    var over=!!m.is_over||s.status==="complete", live=!over&&(!!m.is_in_progress||!!m.has_started||s.status==="in_game");
    g.status=over?"final":live?"live":"pre";
    if(m.home_score!=null&&m.away_score!=null){ g.awayScore=Number(m.away_score); g.homeScore=Number(m.home_score); }
    if(live||over){ var q=String(m.quarter_num==null?"":m.quarter_num).trim(); g.q=/^\d+$/.test(q)?Number(q):null; g.ql=m.quarter||""; g.clock=m.time_remaining||""; g.ot=!!m.is_overtime; }
    if(live){ g.pos=m.possession||""; g.rz=!!m.red_zone; g.dd=m.down_and_distance||""; }
    games.push(g);
  }); });
  return games;
}

export function gamesFor(weeks,season){
  return Promise.all(weeks.map(function(w){ return sj(SLEEPER+"/scores/nfl/regular/"+season+"/"+w).catch(function(){ return []; }); }))
    .then(function(lists){ return parseScores(lists,weeks); });
}

// Sleeper's player index → [id, name, pos, team] rows: fantasy positions on a team,
// plus every defense; defenses last, otherwise by name.
export function parseRoster(players){
  var rows=[];
  Object.keys(players||{}).forEach(function(pid){ var v=players[pid]||{};
    if(v.position==="DEF") rows.push([pid,((v.first_name||"")+" "+(v.last_name||"")).trim(),"DEF",pid]);
    else if(v.team&&(v.fantasy_positions||[]).some(function(p){ return R.FANTASY_POS[p]; })){
      var row=[pid,v.full_name||"",v.position||"",v.team], st=R.statusCode(v);
      if(st) row.push(st);   // Q, OUT, IR… only when there's something to say
      rows.push(row);
    } });
  rows.sort(function(a,b){ return ((a[2]==="DEF")-(b[2]==="DEF"))||a[1].localeCompare(b[1]); });
  return rows;
}

// A bet's stats block re-scored from season totals; null if the bet tracks nothing.
export function restat(S,totals,through,now){
  if(!S||!Array.isArray(S.rows)) return null;
  var kind=S.stat||"pts_ppr", tracks=(Array.isArray(S.tracks)&&S.tracks.length)?S.tracks:[{stat:kind}];
  var rows=S.rows.map(function(r){ var o=Object.assign({},r); o.values={}; tracks.forEach(function(t){ if(t.stat) o.values[t.stat]=R.valueFor(r.key,t.stat,totals); }); o.value=R.valueFor(r.key,kind,totals); return o; });
  return Object.assign({},S,{ rows:rows, through:through, source:"Sleeper", updatedAt:now });
}

/* ---- the loops ---- */

// This week's (and next week's) scores — every minute while a game is on, else every ten.
export function scoresTick(db,ctx){
  if(!db) return Promise.resolve();
  var season=seasonOf(ctx.config), w=R.currentWeek(ctx.config,ctx.games), weeks=[w]; if(w<18) weeks.push(w+1);
  var G=R.allGames(ctx.games), now=Date.now();
  var hot=G.some(function(g){ return g.week===w&&(g.status==="live"||(now>=Date.parse(g.date)-3600000&&now<Date.parse(g.date)+4*3600000)); });
  var cur=ctx.games||{};
  if(ageMin(cur.updatedAt)<(hot?0.9:9.5)) return Promise.resolve();          // fresh enough, or someone else just did it
  return lease(db,"scores",50000,holder(ctx)).then(function(ok){
    if(!ok) return;
    return gamesFor(weeks,season).then(function(fresh){
      if(!fresh.length) return;
      var keep=(cur.games||[]).filter(function(g){ return weeks.indexOf(g.week)<0; });
      var games=keep.concat(fresh).sort(function(a,b){ return a.week-b.week||a.date.localeCompare(b.date); });
      return db.doc("league/games").set(Object.assign({ season:season },cur,{ updatedAt:isoNow(), count:games.length, source:"Sleeper scores", games:games }));
    });
  }).catch(function(){});
}

// Stats, schedule, roster, every game — hourly, or on Refresh.
export function runRefresh(db,by,forced,ctx){
  var last=ctx.refresh||{};
  if(!forced&&ageMin(last.finishedAt)<55) return Promise.resolve({ note:"recent" });
  if(forced&&ageMin(last.finishedAt)<1){ scoresTick(db,ctx); return Promise.resolve({ note:"recent" }); }
  return lease(db,"refresh",90000,holder(ctx)).then(function(ok){
    if(!ok) return { note:"busy" };
    var now=isoNow(), season=seasonOf(ctx.config);
    db.doc("league/refresh").update({ requestedAt:now, requestedBy:by||null });
    return sj(SLEEPER+"/v1/state/nfl").catch(function(){ return {}; }).then(function(st){
      var maxW=Math.min(18,Math.max(1,Number(st.week)||18));
      // through: the highest week with stats posted, bounded by the NFL's current week
      var seq=Promise.resolve(0);
      for(var w=1;w<=maxW;w++)(function(w){ seq=seq.then(function(last){ if(last<w-1) return last; return sj(SLEEPER+"/v1/stats/nfl/regular/"+season+"/"+w).then(function(d){ return (d&&Object.keys(d).length)?w:last; }).catch(function(){ return last; }); }); })(w);
      return seq.then(function(week){
        return sj(SLEEPER+"/v1/stats/nfl/regular/"+season).catch(function(){ return {}; }).then(function(totals){
          var through=week?"Through week "+week:"No games played yet", writes=[], n=0;
          (ctx.bets||[]).forEach(function(b){
            var S=restat(b.stats,totals,through,now); if(!S) return;
            writes.push(db.doc("bets/"+b.id).update({ stats:S })); n++;
          });
          // the schedule daily; the roster every six hours so injury designations keep up,
          // and never from a phone (the player index is 10 MB)
          var roster=ctx.roster||{}, cfg=ctx.config||{};
          if(ageMin(cfg.scheduleUpdatedAt)>24*60) writes.push(fetch(NFLVERSE_GAMES).then(function(r){ return r.text(); }).then(function(csv){
            var starts=R.weekStartsFromCsv(csv,season); if(Object.keys(starts).length) return db.doc("league/config").update({ weekStarts:starts, scheduleUpdatedAt:now }); }).catch(function(){}));
          if(!ctx.mobile&&ageMin(roster.updatedAt)>6*60) writes.push(sj(SLEEPER+"/v1/players/nfl").then(function(players){
            var rows=parseRoster(players);
            return db.doc("league/roster").set({ updatedAt:now, count:rows.length, players:rows }); }).catch(function(){}));
          var weeks=[]; for(var i=1;i<=18;i++) weeks.push(i);
          writes.push(gamesFor(weeks,season).then(function(games){ if(games.length) return db.doc("league/games").set({ season:season, updatedAt:now, count:games.length, source:"Sleeper scores", games:games }); }).catch(function(){}));
          return Promise.all(writes).then(function(){ return db.doc("league/refresh").update({ finishedAt:isoNow(), through:through, status:"done", by:by||null }); })
            .then(function(){ return { ok:true, through:through, bets:n }; });
        });
      });
    });
  });
}
