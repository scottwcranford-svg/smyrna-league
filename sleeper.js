// Keeping the book current, from the browser. Sleeper allows browser calls, so
// whoever has the page open pulls the feeds and writes the results into the book
// for everyone. Short leases keep it to one writer at a time so ten phones don't
// do the same work or burn the free quota. This module and store.js are the only
// ones that touch the network; nothing here reads the page or the shared state —
// callers pass a `ctx` snapshot: { config, games, refresh, bets, roster, holder, mobile }.

import * as Clock from "./clock.js?v=dev";
import * as Roster from "./roster.js?v=dev";
import * as Sched from "./schedule.js?v=dev";
import * as Stats from "./stats.js?v=dev";
import * as Ledger from "./ledger.js?v=dev";
import * as Sn from "./seasons.js?v=dev";
import { lease } from "./store.js?v=dev";

export const SLEEPER="https://api.sleeper.app";
export const NFLVERSE_GAMES="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
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

// Next season's league, found from this one. Sleeper mints a new league every year and
// points it back at the old one with previous_league_id; there is no forward link, so the
// way across is to ask a manager which leagues they are in for the new season and take the
// one that points at ours.
export function nextLeagueFrom(leagues,fromId){
  var want=String(fromId||"");
  var hit=(leagues||[]).filter(function(l){ return String(l.previous_league_id||"")===want; })[0];
  return hit||null;
}

export function findNextLeague(fromId,season){
  if(!fromId||!season) return Promise.resolve(null);
  return sj(SLEEPER+"/v1/league/"+fromId+"/users").then(function(us){
    var uid=(us&&us[0]&&us[0].user_id)||"";
    if(!uid) return null;
    return sj(SLEEPER+"/v1/user/"+uid+"/leagues/nfl/"+season).then(function(ls){ return nextLeagueFrom(ls,fromId); });
  }).catch(function(){ return null; });
}

// The draft, trimmed to what the board draws. Sleeper's roster_id on a pick is who *got*
// the player, not whose slot it was, so a traded pick already credits the right manager;
// draft_slot is the original slot, and traded_picks says which ones moved. Keeping both
// means the board can say "hobnailboot, from JPorch" rather than quietly crediting one of
// them wrongly.
export function draftRows(picks,traded){
  var moved={};
  (traded||[]).forEach(function(t){ moved[String(t.round)+"|"+String(t.roster_id)]=true; });
  return (picks||[]).map(function(x){
    var m=x.metadata||{};
    var slot=x.draft_slot==null?null:Number(x.draft_slot);
    var from=(slot!=null&&moved[String(x.round)+"|"+String(slot)])?slot:null;
    return { r:Number(x.round), p:Number(x.pick_no), slot:slot, roster:Number(x.roster_id),
      name:((m.first_name||"")+" "+(m.last_name||"")).trim(), pos:m.position||"", team:m.team||"",
      keeper:!!x.is_keeper, from:(from!=null&&from!==Number(x.roster_id))?from:null };
  }).sort(function(a,b){ return a.p-b.p; });
}

// A draft is written once and then never changes, so this only runs when the book has no
// draft for the season being played.
export function draftTick(db,ctx){
  var cfg=ctx.config||{}, here=Sn.currentSeason(cfg);
  var have=(ctx.draft&&ctx.draft.bySeason)||{};
  if(have[here]&&(have[here].picks||[]).length) return Promise.resolve();
  var lid=leagueIdOf(cfg);
  if(!lid) return Promise.resolve();
  return sj(SLEEPER+"/v1/league/"+lid+"/drafts").then(function(ds){
    var d=(ds||[]).filter(function(x){ return String(x.season)===here; })[0]||(ds||[])[0];
    if(!d||!d.draft_id) return;
    return Promise.all([
      sj(SLEEPER+"/v1/draft/"+d.draft_id+"/picks"),
      sj(SLEEPER+"/v1/draft/"+d.draft_id+"/traded_picks").catch(function(){ return []; }),
      sj(SLEEPER+"/v1/league/"+lid+"/rosters"),
      sj(SLEEPER+"/v1/league/"+lid+"/users")
    ]).then(function(all){
      var rows=draftRows(all[0],all[1]);
      if(!rows.length) return;
      var owner={}; (all[2]||[]).forEach(function(r){ owner[r.roster_id]=r.owner_id; });
      var uname={}; (all[3]||[]).forEach(function(u){ uname[u.user_id]=u.display_name||u.username||""; });
      var byRoster={}; Object.keys(owner).forEach(function(rid){ byRoster[rid]=uname[owner[rid]]||""; });
      var out=Object.assign({},have);
      out[here]={ draftId:String(d.draft_id), at:isoNow(), type:d.type||"", rounds:Number((d.settings||{}).rounds)||0,
        byRoster:byRoster, picks:rows };
      return db.doc("league/draft").set(Object.assign({},ctx.draft||{},{ updatedAt:isoNow(), bySeason:out }));
    });
  }).catch(function(){});
}

// Our Sleeper league: the id an admin put in league/config, else the Smyrna League.
export function leagueIdOf(cfg){ return String((cfg&&cfg.sleeperLeagueId)||Roster.SLEEPER_LEAGUE_ID); }

// Sleeper's player index → [id, name, pos, team] rows: fantasy positions on a team,
// plus every defense; defenses last, otherwise by name.
export function parseRoster(players){
  var rows=[];
  Object.keys(players||{}).forEach(function(pid){ var v=players[pid]||{};
    if(v.position==="DEF") rows.push([pid,((v.first_name||"")+" "+(v.last_name||"")).trim(),"DEF",pid]);
    else if(v.team&&(v.fantasy_positions||[]).some(function(p){ return Roster.FANTASY_POS[p]; })){
      var row=[pid,v.full_name||"",v.position||"",v.team], st=Roster.statusCode(v);
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
  var rows=S.rows.map(function(r){ var o=Object.assign({},r); o.values={}; tracks.forEach(function(t){ if(t.stat) o.values[t.stat]=Stats.valueFor(r.key,t.stat,totals); }); o.value=Stats.valueFor(r.key,kind,totals); return o; });
  return Object.assign({},S,{ rows:rows, through:through, source:"Sleeper", updatedAt:now });
}

/* ---- the loops ---- */

// This week's (and next week's) scores — every minute while a game is on, else every ten.
// One week of the Sleeper league's own scoreboard, from a /matchups payload.
// `points` is what they have scored; the projection is summed from the starters'
// published numbers, which league/proj already holds for the weeks in play — so a
// live board costs one call, not two. Sides pair on matchup_id.
export function boardRows(ms,nameOf,memByName,projWeek){
  return (ms||[]).map(function(m){
    var nm=nameOf(m.roster_id)||"", pr=0, any=false;
    if(projWeek) (m.starters||[]).forEach(function(pid){
      var p=pid&&pid!=="0"?projWeek[pid]:null;
      if(p&&p.pts_ppr){ pr+=Number(p.pts_ppr)||0; any=true; }
    });
    return { id:memByName[nm.toLowerCase()]||null, name:nm,
      pts:Math.round((Number(m.points)||0)*100)/100,
      proj:any?Math.round(pr*10)/10:null,
      mid:m.matchup_id==null?null:Number(m.matchup_id) };
  });
}

// Has anything actually moved? league/scores is written from a timer, so an unchanged
// week must not be rewritten — a write comes back as a snapshot, which draws, which
// would write again.
export function boardSig(rows){
  return (rows||[]).map(function(r){ return r.name+":"+r.pts+":"+(r.proj==null?"":r.proj); }).sort().join("|");
}

// The fantasy board for the week being played, refreshed on the same tick as the NFL
// scores and under the same lease. Reuses the roster map already on the doc, so this
// is one call a minute rather than three. A settled week is never touched, and an
// unchanged one is never rewritten.
export function boardTick(db,ctx,w){
  var sc=ctx.scores||{}, byRoster=sc.byRoster||{};
  if(!Object.keys(byRoster).length) return Promise.resolve();   // runRefresh hasn't laid the map down yet
  var here=Sn.currentSeason(ctx.config), mine=Sn.weeksOf(sc,here);
  var k=String(w), was=mine[k];
  if(was&&was.final) return Promise.resolve();
  var lid=leagueIdOf(ctx.config), mem=(ctx.config&&ctx.config.members)||[];
  var memByName={}; mem.forEach(function(m){ memByName[String(m.name).toLowerCase()]=m.id; });
  return sj(SLEEPER+"/v1/league/"+lid+"/matchups/"+w).then(function(ms){
    var rows=boardRows(ms,function(rid){ return byRoster[rid]||byRoster[String(rid)]||""; },memByName,Stats.projFor(w,ctx.proj));
    if(!rows.length) return;
    if(was&&boardSig(was.rows)===boardSig(rows)) return;         // nothing moved; writing would only loop
    var weeks=Object.assign({},mine);
    weeks[k]={ at:isoNow(), final:false, rows:rows };
    return db.doc("league/scores").set(Object.assign({},sc,{ updatedAt:isoNow(), weeks:Sn.withWeeks(sc,here,weeks) }));
  }).catch(function(){});
}

export function scoresTick(db,ctx){
  if(!db) return Promise.resolve();
  var season=seasonOf(ctx.config), w=Clock.currentWeek(ctx.config,ctx.games), weeks=[w]; if(w<18) weeks.push(w+1);
  var G=Clock.allGames(ctx.games), now=Date.now();
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
    }).then(function(){ return boardTick(db,ctx,w); });
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
            var starts=Sched.weekStartsFromCsv(csv,season);
            // the same file carries Vegas's spread and total per game; they arrive a few
            // weeks ahead of kickoff, so this is re-read every day for the new ones
            var lines=Sched.linesFromCsv(csv,season), jobs=[];
            if(Object.keys(lines).length) jobs.push(db.doc("league/lines").set({ updatedAt:now, season:String(season), byGame:lines }));
            if(Object.keys(starts).length) jobs.push(db.doc("league/config").update({ weekStarts:starts, scheduleUpdatedAt:now }));
            return Promise.all(jobs); }).catch(function(){}));
          if(!ctx.mobile&&ageMin(roster.updatedAt)>6*60) writes.push(sj(SLEEPER+"/v1/players/nfl").then(function(players){
            var rows=parseRoster(players);
            return db.doc("league/roster").set({ updatedAt:now, count:rows.length, players:rows }); }).catch(function(){}));
          // Weekly high / low from the Sleeper league's matchup scores, for every finished
          // week the book doesn't have yet. Owners map to managers by Sleeper display name.
          // The same call carries every manager's score, not just the top and bottom, so the
          // Scores tab is stored alongside the pool rather than fetched twice.
          // Read and write only the season being played; other seasons in these documents
          // are left exactly as they are.
          var here=Sn.currentSeason(cfg);
          var hlDoc=ctx.highlow||{}, hlWeeks=Sn.weeksOf(hlDoc,here), hlMem=cfg.members||[];
          var scDoc=ctx.scores||{}, scWeeks=Sn.weeksOf(scDoc,here);
          // the draft, once, whenever the book has none for this season
          writes.push(draftTick(db,ctx));
          var finals=Clock.finalWeeks(ctx.games);
          var isFinal={}; finals.forEach(function(w){ isFinal[String(w)]=true; });
          var need=finals.filter(function(w){
            var k=String(w);
            return !hlWeeks[k]||!(scWeeks[k]&&scWeeks[k].final);
          });
          // the week being played is fetched every time, so the board is current
          var liveW=Clock.currentWeek(cfg,ctx.games);
          if(!isFinal[String(liveW)]&&need.indexOf(liveW)<0) need=need.concat([liveW]);
          if(need.length&&hlMem.length){
            var lid2=leagueIdOf(cfg);
            writes.push(Promise.all([sj(SLEEPER+"/v1/league/"+lid2+"/rosters"), sj(SLEEPER+"/v1/league/"+lid2+"/users")]).then(function(rs){
              var owner={}; (rs[0]||[]).forEach(function(r){ owner[r.roster_id]=r.owner_id; });
              var uname={}; (rs[1]||[]).forEach(function(u){ uname[u.user_id]=u.display_name||u.username||""; });
              var nameOf=function(rid){ return uname[owner[rid]]||""; };
              var memByName={}; hlMem.forEach(function(m){ memByName[String(m.name).toLowerCase()]=m.id; });
              // kept on the doc so the live tick can read a board with one call, not three
              var byRoster={}; Object.keys(owner).forEach(function(rid){ byRoster[rid]=nameOf(rid); });
              return Promise.all(need.map(function(w){
                return sj(SLEEPER+"/v1/league/"+lid2+"/matchups/"+w).then(function(ms){
                  return [w,boardRows(ms,nameOf,memByName,Stats.projFor(w,ctx.proj))];
                }).catch(function(){ return [w,null]; });
              })).then(function(pairs){ pairs.byRoster=byRoster; return pairs; });
            }).then(function(pairs){
              // the pool: settled weeks only, and only ones the book hasn't got
              var out=Object.assign({},hlWeeks), anyHL=false;
              pairs.forEach(function(pr){
                var w=pr[0], rows=pr[1];
                if(!rows||!isFinal[String(w)]||hlWeeks[String(w)]) return;
                var hl=Ledger.highLow(rows);
                if(hl){ out[String(w)]=hl; anyHL=true; }
              });
              // the board: every week fetched, live ones included
              var board=Object.assign({},scWeeks), anySC=false;
              pairs.forEach(function(pr){
                var w=pr[0], rows=pr[1], k=String(w);
                if(!rows||!rows.length) return;
                var was=board[k];
                if(was&&was.final&&isFinal[k]) return;                       // settled, leave it
                if(was&&boardSig(was.rows)===boardSig(rows)&&!!was.final===!!isFinal[k]) return;   // nothing moved
                board[k]={ at:now, final:!!isFinal[k], rows:rows }; anySC=true;
              });
              var jobs=[];
              if(anyHL) jobs.push(db.doc("league/highlow").set(Object.assign({},hlDoc,{ updatedAt:now, leagueId:lid2, weeks:Sn.withWeeks(hlDoc,here,out) })));
              if(anySC) jobs.push(db.doc("league/scores").set(Object.assign({},scDoc,{ updatedAt:now, leagueId:lid2, season:season, byRoster:pairs.byRoster||{}, weeks:Sn.withWeeks(scDoc,here,board) })));
              return Promise.all(jobs);
            }).catch(function(){}));
          }
          // The Sleeper league itself, daily or when a manager is new: every manager's team
          // name and avatar from one call. league/sleeper = { leagueId, byId: { memberId:
          // { avatar, team } } }. A manager Sleeper's league doesn't have (a test account)
          // gets their public avatar and no team; a name Sleeper doesn't know keeps initials.
          var sl=ctx.sleeper||{}, mem=cfg.members||[];
          var newFace=mem.some(function(m){ return !(sl.byId&&(m.id in sl.byId)); });
          if(mem.length&&(newFace||!sl.league||ageMin(sl.updatedAt)>24*60)){   // also when the league's settings aren't in yet
            writes.push(Promise.resolve(leagueIdOf(cfg)).then(function(lid){
              var leagueP=lid?sj(SLEEPER+"/v1/league/"+lid).then(function(L){
                if(!L||typeof L!=="object") return null;
                var st=L.settings||{}, pos=Array.isArray(L.roster_positions)?L.roster_positions:[];
                return { name:L.name||"", season:String(L.season||""), teams:Number(L.total_rosters)||0, keeper:Number(st.type)===1, dynasty:Number(st.type)===2,
                         sf:pos.indexOf("SUPER_FLEX")>=0, scoring:Roster.scoringName((L.scoring_settings||{}).rec), avatar:(typeof L.avatar==="string")?L.avatar:"" };
              }).catch(function(){ return null; }):Promise.resolve(null);
              return Promise.all([lid?sj(SLEEPER+"/v1/league/"+lid+"/users").catch(function(){ return []; }):Promise.resolve([]), leagueP]).then(function(both){
                var users=both[0], league=both[1];
                var byName={}; (users||[]).forEach(function(u){ byName[String(u.display_name||u.username||"").toLowerCase()]=u; });
                return Promise.all(mem.map(function(m){
                  var u=byName[String(m.name).toLowerCase()];
                  if(u) return { id:m.id, avatar:(typeof u.avatar==="string")?u.avatar:"", team:String((u.metadata&&u.metadata.team_name)||"").trim() };
                  return sj(SLEEPER+"/v1/user/"+encodeURIComponent(m.name)).then(function(p){ return { id:m.id, avatar:(p&&typeof p.avatar==="string")?p.avatar:"", team:"" }; }).catch(function(){ return { id:m.id, avatar:"", team:"" }; });
                })).then(function(rows){
                  var byId={}; rows.forEach(function(r){ byId[r.id]={ avatar:r.avatar, team:r.team }; });
                  var doc={ updatedAt:now, leagueId:lid||"", byId:byId };
                  if(league) doc.league=league; else if(ctx.sleeper&&ctx.sleeper.league) doc.league=ctx.sleeper.league;
                  return db.doc("league/sleeper").set(doc);
                });
              });
            }).catch(function(){}));
          }
          // Projections for the weeks in play: the season ("0"), this week, next, and any week
          // with a live weekly stat bet. Trimmed to the roster and the tracked stats, written only when changed.
          var rosterIds=Roster.rosterRows(ctx.roster).map(function(r){ return r[0]; });
          if(rosterIds.length){
            var want={0:1}, cw=Math.min(18,Math.max(1,Number(st.week)||1)); want[cw]=1; if(cw<18) want[cw+1]=1;
            (ctx.bets||[]).forEach(function(b){ if(b.stats&&!b.game&&(b.status==="open"||b.status==="active")&&Number(b.week)>0) want[Number(b.week)]=1; });
            var prevW=(ctx.proj&&ctx.proj.weeks)||{}, weeksOut={}, changed=false;
            writes.push(Promise.all(Object.keys(want).map(function(w){
              return sj(SLEEPER+"/v1/projections/nfl/regular/"+season+(w==="0"?"":"/"+w)).then(function(raw){
                var s=JSON.stringify(Stats.trimProjections(raw,rosterIds)); weeksOut[w]=s; if(prevW[w]!==s) changed=true;
              }).catch(function(){ if(prevW[w]) weeksOut[w]=prevW[w]; });
            })).then(function(){
              if(changed||Object.keys(weeksOut).join()!==Object.keys(prevW).join()) return db.doc("league/proj").set({ season:season, updatedAt:now, weeks:weeksOut });
            }).catch(function(){}));
          }
          var weeks=[]; for(var i=1;i<=18;i++) weeks.push(i);
          writes.push(gamesFor(weeks,season).then(function(games){ if(games.length) return db.doc("league/games").set({ season:season, updatedAt:now, count:games.length, source:"Sleeper scores", games:games }); }).catch(function(){}));
          return Promise.all(writes).then(function(){ return db.doc("league/refresh").update({ finishedAt:isoNow(), through:through, status:"done", by:by||null }); })
            .then(function(){ return { ok:true, through:through, bets:n }; });
        });
      });
    });
  });
}
