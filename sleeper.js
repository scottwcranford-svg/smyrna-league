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
import * as Players from "./players.js?v=dev";
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

// Who is on each team right now. Unlike the draft this moves all season - waivers,
// trades, drops - so it is refreshed on the hourly pass rather than written once. Kept in
// its own document so a roster change does not rewrite the draft.
export function squadTick(db,ctx){
  var cfg=ctx.config||{}, here=Sn.currentSeason(cfg);
  var cur=(ctx.squads&&ctx.squads.bySeason&&ctx.squads.bySeason[here])||null;
  if(cur&&ageMin(cur.at)<55) return Promise.resolve();
  var lid=leagueIdOf(cfg);
  if(!lid) return Promise.resolve();
  return Promise.all([
    sj(SLEEPER+"/v1/league/"+lid+"/rosters"),
    sj(SLEEPER+"/v1/league/"+lid+"/users")
  ]).then(function(all){
    var rs=all[0]||[];
    if(!rs.length) return;
    var uname={}; (all[1]||[]).forEach(function(u){ uname[u.user_id]=u.display_name||u.username||""; });
    var byRoster={}, squads={}, starters={};
    rs.forEach(function(r){
      byRoster[r.roster_id]=uname[r.owner_id]||"";
      squads[r.roster_id]=(r.players||[]).slice();
      starters[r.roster_id]=(r.starters||[]).filter(function(p){ return p&&p!=="0"; });
    });
    // nothing moved: a write would only come back as a snapshot and redraw
    if(cur&&JSON.stringify(cur.rosters)===JSON.stringify(squads)&&JSON.stringify(cur.starters)===JSON.stringify(starters)) return;
    var out=Object.assign({},(ctx.squads&&ctx.squads.bySeason)||{});
    out[here]={ at:isoNow(), byRoster:byRoster, rosters:squads, starters:starters };
    return db.doc("league/squads").set(Object.assign({},ctx.squads||{},{ updatedAt:isoNow(), bySeason:out }));
  }).catch(function(){});
}

// Every team's record, in standing order, for the league result bets (bets.js). Owners map
// to managers by Sleeper display name, as the Scores board does. Wins first, then fewest
// losses, then points for - a fair picture of the table; Sleeper's own tiebreakers still
// decide the seeds, which is why the playoff field is read from the bracket, not from this.
export function standingsRows(rosters,users,memByName){
  var uname={}; (users||[]).forEach(function(u){ uname[u.user_id]=u.display_name||u.username||""; });
  var pts=function(s,k){ return Math.round(((Number(s[k])||0)+(Number(s[k+"_decimal"])||0)/100)*100)/100; };
  return (rosters||[]).map(function(r){
    var s=r.settings||{}, nm=uname[r.owner_id]||"";
    return { rid:Number(r.roster_id), id:memByName[nm.toLowerCase()]||null, name:nm,
      w:Number(s.wins)||0, l:Number(s.losses)||0, t:Number(s.ties)||0, pf:pts(s,"fpts"), pa:pts(s,"fpts_against") };
  }).sort(function(a,b){ return b.w-a.w||a.l-b.l||b.pf-a.pf||a.rid-b.rid; });
}
// The roster ids Sleeper has seeded into the winners bracket. A seeded team sits in a
// game as a number; everything else is a {w:m} or {l:m} reference to an earlier game, so
// before the bracket is seeded this is empty, and once it is, it is the whole field -
// the top seeds' byes included, since a bye is a later-round game with a number in it.
export function bracketField(bracket){
  var out=[];
  (bracket||[]).forEach(function(m){ [m&&m.t1,m&&m.t2].forEach(function(t){ if(typeof t==="number"&&out.indexOf(t)<0) out.push(t); }); });
  return out.sort(function(a,b){ return a-b; });
}
// What a standings record says, minus when it was written - so an unchanged table is
// never rewritten (a write comes back as a snapshot, which draws, which would write again).
function standingsSig(rec){
  if(!rec) return "";
  var PO=rec.playoffs||{};
  return [rec.teams,rec.playoffStart,rec.seedType,rec.over?1:0,(rec.rows||[]).map(function(r){ return [r.rid,r.id,r.name,r.w,r.l,r.t,r.pf,r.pa].join(":"); }).join("|"),
    (PO.rids||[]).join(","),(PO.field||[]).join(","),PO.seeded?1:0,PO.complete?1:0,PO.champion||"",
    Object.keys(rec.pairings||{}).sort().map(function(w){ return w+":"+(rec.pairings[w]||[]).map(function(p){ return p.a+"-"+p.b; }).join(","); }).join("|")].join("/");
}
// The table and the playoff field, hourly: league/standings = { updatedAt, bySeason: {
// <season>: { at, leagueId, teams, playoffStart, seedType, over, rows, pairings: { <week>: [{ a, b }] },
// playoffs: { rids, field, seeded, complete, champion } } }. `pairings` is the regular season's
// schedule as member ids, for the weekly matchup bets. `field` is the seeded teams as member ids. Sleeper seeds the bracket from the live
// standings all season long - week 2 already shows six teams in it - so `seeded` is only
// "as it stands", with Sleeper's own tiebreakers applied; `complete` is the seeding once the
// regular season is over in the book's own schedule, and that is what a "makes the
// playoffs" bet settles on. How many spots there are comes from league/sleeper (the daily
// league read), six until that has landed. Three calls, one write when something moved.
export function standingsTick(db,ctx){
  var cfg=ctx.config||{}, here=Sn.currentSeason(cfg);
  var cur=(ctx.standings&&ctx.standings.bySeason&&ctx.standings.bySeason[here])||null;
  var lid=leagueIdOf(cfg);
  if(!lid) return Promise.resolve();
  var L=(ctx.sleeper&&ctx.sleeper.league)||{};
  var start=Number(L.playoffStart)||(cur&&Number(cur.playoffStart))||Clock.PLAYOFF_START;
  // The rest of the regular season's pairings, for the weekly matchup bets: Sleeper fixes
  // the schedule up front, so each week is fetched once and kept. A week the book lacks
  // is fetched on the next pass whatever the hour - the form is offering it.
  var have=(cur&&cur.pairings)||{}, wantW=[];
  for(var w=Math.max(1,Math.min(start-1,Clock.currentWeek(cfg,ctx.games)));w<=start-1;w++) if(!have[String(w)]) wantW.push(w);
  if(cur&&ageMin(cur.at)<55&&!wantW.length) return Promise.resolve();
  var memByName={}; (cfg.members||[]).forEach(function(m){ memByName[String(m.name).toLowerCase()]=m.id; });
  return Promise.all([
    sj(SLEEPER+"/v1/league/"+lid+"/rosters"),
    sj(SLEEPER+"/v1/league/"+lid+"/users"),
    sj(SLEEPER+"/v1/league/"+lid+"/winners_bracket").catch(function(){ return []; }),
    Promise.all(wantW.map(function(w){ return sj(SLEEPER+"/v1/league/"+lid+"/matchups/"+w).then(function(ms){ return [w,ms]; }).catch(function(){ return [w,null]; }); }))
  ]).then(function(all){
    var rows=standingsRows(all[0],all[1],memByName);
    if(!rows.length) return;
    var teams=Number(L.playoffTeams)||(cur&&Number(cur.teams))||6;
    var rids=bracketField(all[2]), byRid={}; rows.forEach(function(r){ byRid[r.rid]=r; });
    var pairings=Object.assign({},have);
    (all[3]||[]).forEach(function(pr){
      var ms=pr[1]; if(!ms||!ms.length) return;
      var byMid={}, list=[];
      ms.forEach(function(m){
        if(m.matchup_id==null) return;
        var r=byRid[Number(m.roster_id)], id=(r&&r.id)||null;
        if(byMid[m.matchup_id]!==undefined){ if(id&&byMid[m.matchup_id]) list.push({ a:byMid[m.matchup_id], b:id }); } else byMid[m.matchup_id]=id;
      });
      if(list.length) pairings[String(pr[0])]=list;
    });
    var field=rids.map(function(rid){ return byRid[rid]?byRid[rid].id:null; }).filter(Boolean);
    var seeded=rids.length>0&&rids.length>=teams;
    var over=Clock.finalWeeks(ctx.games).indexOf(start-1)>=0;   // the last regular-season week is final
    // the final (p: 1) names its winner once played; that is the champion
    var champ=null; (all[2]||[]).forEach(function(m){ if(m&&Number(m.p)===1&&typeof m.w==="number"&&byRid[m.w]) champ=byRid[m.w].id||null; });
    var next={ at:isoNow(), leagueId:lid, teams:teams, playoffStart:start, seedType:Number(L.seedType)||0, over:over, rows:rows, pairings:pairings,
               playoffs:{ rids:rids, field:field, seeded:seeded, complete:seeded&&over, champion:champ } };
    if(cur&&standingsSig(cur)===standingsSig(next)) return;   // nothing moved
    var out=Object.assign({},(ctx.standings&&ctx.standings.bySeason)||{});
    out[here]=next;
    return db.doc("league/standings").set(Object.assign({},ctx.standings||{},{ updatedAt:isoNow(), bySeason:out }));
  }).catch(function(){});
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
      keeper:!!x.is_keeper, from:(from!=null&&from!==Number(x.roster_id))?from:null, pid:String(x.player_id||"") };
  }).sort(function(a,b){ return a.p-b.p; });
}

// A draft is written once and then never changes, so this only runs when the book has no
// draft for the season being played.
export function draftTick(db,ctx){
  var cfg=ctx.config||{}, here=Sn.currentSeason(cfg);
  var have=(ctx.draft&&ctx.draft.bySeason)||{};
  // A draft never changes, so this normally runs once - but "we already have one" is not
  // the same as "we have all of it". A record written before byPlayer, rosters and
  // keptPrev existed has picks and nothing to price a keeper with, and every player on
  // the roster then reads as an undrafted waiver pickup. Refetch until the record is whole.
  var rec=have[here];
  // Picks gained their player id later still, for the board's rank and roster check.
  if(rec&&(rec.picks||[]).length&&rec.byPlayer&&rec.rosters&&rec.keptPrev&&rec.picks.every(function(p){ return "pid" in p; })) return Promise.resolve();
  var lid=leagueIdOf(cfg);
  if(!lid) return Promise.resolve();
  return sj(SLEEPER+"/v1/league/"+lid+"/drafts").then(function(ds){
    var d=(ds||[]).filter(function(x){ return String(x.season)===here; })[0]||(ds||[])[0];
    if(!d||!d.draft_id) return;
    // Last season's keepers decide whose contract is spent: kept two years running and the
    // player goes back in the pool. Only the flags are taken, not a whole season - the book
    // runs 2026 forward, and this is the one thing that needs to look further back.
    var prevId=String(d.previous_league_id||"");
    var prevKept=prevId
      ? sj(SLEEPER+"/v1/league/"+prevId+"/drafts").then(function(pds){
          var pd=(pds||[])[0];
          if(!pd) return {};
          return sj(SLEEPER+"/v1/draft/"+pd.draft_id+"/picks").then(function(ps){
            var out={}; (ps||[]).forEach(function(x){ if(x.is_keeper&&x.player_id) out[x.player_id]=1; });
            return out;
          });
        }).catch(function(){ return {}; })
      : Promise.resolve({});
    return Promise.all([
      sj(SLEEPER+"/v1/draft/"+d.draft_id+"/picks"),
      sj(SLEEPER+"/v1/draft/"+d.draft_id+"/traded_picks").catch(function(){ return []; }),
      sj(SLEEPER+"/v1/league/"+lid+"/rosters"),
      sj(SLEEPER+"/v1/league/"+lid+"/users"),
      prevKept
    ]).then(function(all){
      var rows=draftRows(all[0],all[1]);
      if(!rows.length) return;
      var owner={}, squads={};
      (all[2]||[]).forEach(function(r){ owner[r.roster_id]=r.owner_id; squads[r.roster_id]=(r.players||[]).slice(); });
      var uname={}; (all[3]||[]).forEach(function(u){ uname[u.user_id]=u.display_name||u.username||""; });
      var byRoster={}; Object.keys(owner).forEach(function(rid){ byRoster[rid]=uname[owner[rid]]||""; });
      // which player each pick took, so the keeper view can price a roster against the draft
      var byPlayer={}; (all[0]||[]).forEach(function(x){ if(x.player_id) byPlayer[x.player_id]={ r:Number(x.round), keeper:!!x.is_keeper }; });
      var out=Object.assign({},have);
      out[here]={ draftId:String(d.draft_id), at:isoNow(), type:d.type||"", rounds:Number((d.settings||{}).rounds)||0,
        byRoster:byRoster, rosters:squads, byPlayer:byPlayer, keptPrev:all[4]||{}, picks:rows };
      return db.doc("league/draft").set(Object.assign({},ctx.draft||{},{ updatedAt:isoNow(), bySeason:out }));
    });
  }).catch(function(){});
}

// Every player's season so far (players.js): points through the last finished week, the
// projection for the same weeks, and the position rank. The weekly stats are the ones the
// refresh has just walked; a finished week's projection is fetched once and kept. Written
// only when something moved - no clock value is compared, so it can't loop.
export function playersTick(db,ctx,byWeek,season){
  var cfg=ctx.config||{}, here=Sn.currentSeason(cfg);
  var rows=Roster.rosterRows(ctx.roster);
  var F=Players.finalThrough(Clock.finalWeeks(ctx.games));
  if(String(season)!==here||!rows.length||!F) return Promise.resolve();
  for(var w=1;w<=F;w++) if(!byWeek[w]) return Promise.resolve();   // stats not all in yet: next hour
  var field=Players.fieldFor(ctx.sleeper&&ctx.sleeper.league&&ctx.sleeper.league.scoring);
  var doc=ctx.players||{}, cur=(doc.bySeason&&doc.bySeason[here])||{};
  var have=cur.field===field?(cur.proj||{}):{};
  var ids=rows.map(function(r){ return r[0]; }), need=[];
  for(var k=1;k<=F;k++) if(!have[k]) need.push(k);
  return Promise.all(need.map(function(w){
    return sj(SLEEPER+"/v1/projections/nfl/regular/"+season+"/"+w)
      .then(function(raw){ return [w,JSON.stringify(Players.weekPoints(raw,ids,field))]; })
      .catch(function(){ return [w,null]; });
  })).then(function(got){
    var proj=Object.assign({},have);
    got.forEach(function(g){ if(g[1]) proj[g[0]]=g[1]; });
    var act=[], pw=[];
    for(var w=1;w<=F;w++){
      if(!proj[w]) return;   // a projection didn't arrive: try again next hour
      act.push(byWeek[w]); pw.push(JSON.parse(proj[w]));
    }
    var out=JSON.stringify(Players.seasonRows(act,pw,rows,field));
    if(cur.rows===out&&cur.through===F&&cur.field===field&&!got.length) return;
    var bs=Object.assign({},doc.bySeason||{});
    bs[here]={ through:F, field:field, rows:out, proj:proj };
    return db.doc("league/players").set({ updatedAt:isoNow(), bySeason:bs });
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

// Season totals, summed from the weekly feeds.
//
// Sleeper has a /stats/nfl/regular/<season> endpoint that looks like exactly this, and it
// cannot be trusted: on 13 Sep 2026 it carried 52 players while week 1 alone had 353, and
// its top scorer disagreed with the week's. Bets scored from it showed numbers that had
// nothing to do with what happened. The weekly feeds are right, and the refresh already
// fetches them to work out which week we are through - so add them up rather than asking
// for an aggregate somebody else got wrong.
export function sumWeeks(weeks){
  var out={};
  (weeks||[]).forEach(function(d){
    Object.keys(d||{}).forEach(function(pid){
      var v=d[pid]; if(!v||typeof v!=="object") return;
      var to=out[pid]||(out[pid]={});
      Object.keys(v).forEach(function(k){
        var n=Number(v[k]);
        if(!isNaN(n)&&typeof v[k]!=="string") to[k]=(Number(to[k])||0)+n;
      });
    });
  });
  return out;
}

/* ---- team offense ----
   Sleeper has no team offense rows (a team's key in the weekly feed is its defense), so a
   week's offense is worked out, and every piece was checked against ESPN's box scores for
   all 28 teams of week 1 2026:
     points       the game's own score, from /scores (the opponent's pts_allow leaves out
                  defensive and return TDs - wrong for three teams)
     total yards  the opponent defense's yds_allow
     passing      every player on the team that week: pass_yd minus pass_sack_yds (net)
     rushing      every player: rush_yd
     turnovers    every player, returners included: pass_int + fum_lost (the opponent's
                  takeaways missed two teams)
   "On the team that week" needs the feed that tags each row with its team, since a player
   traded in week 9 must not carry his first eight weeks along. It is heavy (~200KB a week),
   so a finished week is worked out once and kept in league/offense, and nothing is fetched
   unless a bet on the book is an offense bet. */
export const OFFENSE_ROWS="/stats/nfl/{season}/{week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=FB&position[]=K&position[]=P"+
  "&position[]=DB&position[]=CB&position[]=S&position[]=SS&position[]=FS&position[]=LB&position[]=DL&position[]=DE&position[]=DT";

// One week: { KC: { off_pts, off_yd, off_pass_yd, off_rush_yd, off_to } } for every team whose
// game has started, plus whether every game that week is over.
export function offenseWeek(games,defense,rows){
  var out={}, all=true, any=false;
  (games||[]).forEach(function(g){
    if(g.status!=="final") all=false;
    if(g.status==="pre"||g.awayScore==null||g.homeScore==null) return;
    any=true;
    [[g.away,g.home,g.awayScore],[g.home,g.away,g.homeScore]].forEach(function(t){
      var def=(defense||{})[t[1]]||{};
      out[t[0]]={ off_pts:Number(t[2])||0, off_yd:Number(def.yds_allow)||0, off_pass_yd:0, off_rush_yd:0, off_to:0 };
    });
  });
  (rows||[]).forEach(function(r){
    var o=r&&out[r.team]; if(!o) return;
    var s=r.stats||{};
    o.off_pass_yd+=(Number(s.pass_yd)||0)-(Number(s.pass_sack_yds)||0);
    o.off_rush_yd+=Number(s.rush_yd)||0;
    o.off_to+=(Number(s.pass_int)||0)+(Number(s.fum_lost)||0);
  });
  Object.keys(out).forEach(function(k){ var o=out[k]; o.off_pass_yd=Math.round(o.off_pass_yd); o.off_rush_yd=Math.round(o.off_rush_yd); });
  return { teams:out, final:any&&all };
}
// The weekly feeds with each team's offense laid onto its row, so valueFor("KC","off_pts")
// and sumWeeks work on it like any other stat. The feeds themselves are not changed.
export function withOffense(byWeek,offByWeek){
  var out={};
  Object.keys(byWeek||{}).forEach(function(w){
    var d=byWeek[w], off=(offByWeek||{})[w];
    if(!off||!off.teams){ out[w]=d; return; }
    var merged=Object.assign({},d);
    Object.keys(off.teams).forEach(function(t){ merged[t]=Object.assign({},d[t]||{},off.teams[t]); });
    out[w]=merged;
  });
  return out;
}
export function needsOffense(bets){ return (bets||[]).some(function(b){ return b&&b.stats&&b.stats.scope==="offense"&&(b.status==="open"||b.status==="active"); }); }
// Every week in byWeek worked out, from league/offense where a week is already final there,
// else from the feeds. Writes back what changed. Resolves to { week: { teams, final } }.
export function offenseFor(db,season,byWeek){
  var ref=db.doc("league/offense");
  return ref.get().then(function(snap){ return snap.exists?(snap.data()||{}):{}; }).catch(function(){ return {}; }).then(function(doc){
    var mine=((doc.bySeason||{})[String(season)])||{}, got={}, changed=false;
    var weeks=Object.keys(byWeek||{});
    return Promise.all(weeks.map(function(w){
      if(mine[w]&&mine[w].final){ got[w]=mine[w]; return null; }
      return Promise.all([gamesFor([Number(w)],season), sj(SLEEPER+OFFENSE_ROWS.replace("{season}",season).replace("{week}",w)).catch(function(){ return []; })])
        .then(function(r){ got[w]=offenseWeek(r[0],byWeek[w],r[1]); changed=true; }).catch(function(){});
    })).then(function(){
      if(changed){
        var per={}; per[String(season)]=Object.assign({},mine,got);
        ref.set({ updatedAt:isoNow(), bySeason:Object.assign({},doc.bySeason||{},per) }).catch(function(){});
      }
      return got;
    });
  });
}

// Which numbers a bet is scored on. A weekly bet is that week and nothing else - week 3
// means week 3, not the season with week 3 somewhere inside it. A season-long bet is the
// running total to date. Both were reading season-to-date, so every weekly bet has been
// scored on the wrong figures.
export function totalsFor(byWeek,season,betWeek){
  var w=Number(betWeek)||0;
  return w>0?((byWeek||{})[w]||{}):(season||{});
}

// What to print under the numbers, so a weekly bet doesn't claim to be the season.
export function throughFor(betWeek,week){
  var w=Number(betWeek)||0;
  if(w>0) return "Week "+w;
  return week?"Through week "+week:"No games played yet";
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

// Bets re-scored while games are on. The hourly pass already does this, but an hour is
// far too long when the ticker beside it moves every minute: someone watches their player
// score and the bet does not budge. This runs on the same minute tick, but only while a
// game is actually live, and only every few minutes - the season totals are 150KB, so it
// is not something to pull every sixty seconds from every open page.
export const RESTAT_EVERY=4;   // minutes, while games are live

export function statsTick(db,ctx){
  if(!db) return Promise.resolve();
  var G=Clock.allGames(ctx.games);
  if(!G.some(function(g){ return g.status==="live"; })) return Promise.resolve();
  var latest=null, tracked=0;
  (ctx.bets||[]).forEach(function(b){
    var S=b.stats;
    if(!S||!Array.isArray(S.rows)) return;
    tracked++;
    if(S.updatedAt&&(!latest||String(S.updatedAt)>String(latest))) latest=S.updatedAt;
  });
  if(!tracked) return Promise.resolve();                       // nothing on the book tracks a stat
  if(latest&&ageMin(latest)<RESTAT_EVERY) return Promise.resolve();
  return lease(db,"restat",50000,holder(ctx)).then(function(ok){
    if(!ok) return;
    // the same weekly feeds, so the four-minute pass and the hourly one never disagree
    var season=seasonOf(ctx.config), upto=Math.min(18,Math.max(1,Clock.currentWeek(ctx.config,ctx.games)));
    var byWeek={};
    var chain=Promise.resolve();
    for(var w=1;w<=upto;w++)(function(w){ chain=chain.then(function(){
      return sj(SLEEPER+"/v1/stats/nfl/regular/"+season+"/"+w).then(function(d){ if(d&&Object.keys(d).length) byWeek[w]=d; }).catch(function(){});
    }); })(w);
    return chain.then(function(){
      return needsOffense(ctx.bets)?offenseFor(db,season,byWeek).then(function(off){ byWeek=withOffense(byWeek,off); }):null;
    }).then(function(){
      var toDate=sumWeeks(Object.keys(byWeek).map(function(k){ return byWeek[k]; }));
      var now=isoNow(), jobs=[];
      (ctx.bets||[]).forEach(function(b){
        // a weekly bet is its own week; a season bet is the running total
        var S=restat(b.stats,totalsFor(byWeek,toDate,b.week),(b.stats&&b.stats.through)||"",now);
        if(S) jobs.push(db.doc("bets/"+b.id).update({ stats:S }));
      });
      return Promise.all(jobs);
    });
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
      // How far to walk. Normally the NFL's own week - there is no point asking for weeks
      // that have not happened. But that cap is only right while our season is the one
      // being played: come February the state's week resets to 1, and capping there would
      // quietly shrink a season-long bet's totals to week 1 and keep them there. A season
      // that is over, or a season we are not in, is walked in full.
      // Only an explicit mismatch counts as "the season is done" - a field Sleeper didn't
      // send is not evidence that it has, and guessing there would walk all eighteen weeks
      // every hour for no reason.
      var stSeason=String(st.season||""), stType=String(st.season_type||"");
      var over=(stSeason&&stSeason!==String(season))||(stType&&stType!=="regular");
      var maxW=over?18:Math.min(18,Math.max(1,Number(st.week)||18));
      // through: the highest week with stats posted, bounded by the NFL's current week
      var seq=Promise.resolve(0), byWeek={};
      for(var w=1;w<=maxW;w++)(function(w){ seq=seq.then(function(last){ if(last<w-1) return last; return sj(SLEEPER+"/v1/stats/nfl/regular/"+season+"/"+w).then(function(d){ if(d&&Object.keys(d).length){ byWeek[w]=d; return w; } return last; }).catch(function(){ return last; }); }); })(w);
      return seq.then(function(week){
        return (needsOffense(ctx.bets)?offenseFor(db,season,byWeek).then(function(off){ byWeek=withOffense(byWeek,off); }):Promise.resolve()).then(function(){ return week; });
      }).then(function(week){
        var toDate=sumWeeks(Object.keys(byWeek).map(function(k){ return byWeek[k]; }));
        return Promise.resolve(toDate).then(function(totals){
          // the book's own headline: how far the season has been played
          var through=throughFor(0,week), writes=[], n=0;
          (ctx.bets||[]).forEach(function(b){
            var S=restat(b.stats,totalsFor(byWeek,totals,b.week),throughFor(b.week,week),now); if(!S) return;
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
          writes.push(squadTick(db,ctx));
          writes.push(standingsTick(db,ctx));
          writes.push(playersTick(db,ctx,byWeek,season));
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
                         sf:pos.indexOf("SUPER_FLEX")>=0, scoring:Roster.scoringName((L.scoring_settings||{}).rec), avatar:(typeof L.avatar==="string")?L.avatar:"",
                         // how many make the playoffs and when they start: the standings tick reads these rather than asking again
                         playoffTeams:Number(st.playoff_teams)||0, playoffStart:Number(st.playoff_week_start)||0, seedType:Number(st.playoff_seed_type)||0 };
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
