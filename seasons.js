// Which season a thing belongs to.
//
// The book started as a one-season app, so everything already written is 2026 and carries
// no tag at all. That is the rule the whole file turns on: an untagged object is 2026 — an
// untagged bet, an untagged payment, a manager with no `seasons` list. Nothing in the book
// has to be rewritten for seasons to exist, now or later.
//
// Identity is permanent; participation is per season. A manager record is a person — their
// name, sign-in and colour — and is never deleted, because bets, badges and rivalries
// point at it by id long after they stop playing. `seasons` says which years they played.
//
// The year is the tag because it is short, legible and stable. Sleeper's league id is the
// real identifier of a season's *data* — it changes every year, and every API URL is built
// from it — but it belongs on the season's settings, not stamped on five thousand objects.
// See SEASONS.md.

export const LEGACY_SEASON = "2026";

// The season the book is on right now.
export function currentSeason(config){
  var s=config&&config.season;
  return s?String(s):LEGACY_SEASON;
}

// A bet's or a payment's season.
export function seasonOf(rec){
  var s=rec&&rec.season;
  return s?String(s):LEGACY_SEASON;
}

// The seasons a manager has played. No list means they were here for 2026.
export function seasonsOf(m){
  var a=m&&m.seasons;
  return (Array.isArray(a)&&a.length)?a.map(String):[LEGACY_SEASON];
}

export function inSeason(m,season){
  return seasonsOf(m).indexOf(String(season))>=0;
}

// Add a season to a manager without disturbing the order or repeating one.
export function withSeason(m,season){
  var have=seasonsOf(m), s=String(season);
  if(have.indexOf(s)>=0) return have.slice();
  return have.concat([s]).sort();
}

// The one filter the rest of the app relies on: everything downstream of state.bets is
// season-correct because this is applied once, at the boundary.
export function betsFor(bets,season){
  var s=String(season);
  return (bets||[]).filter(function(b){ return seasonOf(b)===s; });
}

// Every season the book knows about, oldest first: whatever is configured, plus any season
// actually present on a record, plus the one being played.
export function seasonList(config,bets){
  var seen={};
  seen[currentSeason(config)]=1;
  var cfg=config&&config.bySeason;
  if(cfg) Object.keys(cfg).forEach(function(k){ seen[String(k)]=1; });
  (bets||[]).forEach(function(b){ seen[seasonOf(b)]=1; });
  ((config&&config.members)||[]).forEach(function(m){ seasonsOf(m).forEach(function(s){ seen[s]=1; }); });
  return Object.keys(seen).sort();
}

// A season's own settings, falling back to the top-level ones that were there before
// seasons existed — so 2026 reads exactly as it always has.
export function settingsFor(config,season){
  var per=(config&&config.bySeason&&config.bySeason[String(season)])||{};
  return {
    leagueId:per.leagueId||(config&&config.sleeperLeagueId)||"",
    stake:per.stake!=null?per.stake:(config&&config.stake),
    kickoff:per.kickoff||(config&&config.kickoff),
    weekStarts:per.weekStarts||(config&&config.weekStarts)||null
  };
}

// ---- weekly documents ----
// league/highlow and league/scores hold { weeks: { "3": {...} } }. That shape has no room
// for a season, so it gains one above the week: { weeks: { "2027": { "3": {...} } } }. The
// old flat shape is 2026 by the same rule as everything else, so nothing has to be
// rewritten - a key that looks like a week number means the map predates seasons.
function isFlat(weeks){
  var ks=Object.keys(weeks||{});
  if(!ks.length) return false;
  return ks.every(function(k){ var n=Number(k); return n>=0&&n<=18; });
}

// The weeks a season has, whichever shape the document is in.
export function weeksOf(doc,season){
  var weeks=(doc&&doc.weeks)||{};
  if(isFlat(weeks)) return String(season)===LEGACY_SEASON?weeks:{};
  return weeks[String(season)]||{};
}

// The whole map with one season's weeks replaced, ready to write back. Other seasons are
// left exactly as they were, and a flat map is lifted under 2026 on the way past.
export function withWeeks(doc,season,weeks){
  var cur=(doc&&doc.weeks)||{};
  var out=isFlat(cur)?{}:Object.assign({},cur);
  if(isFlat(cur)) out[LEGACY_SEASON]=cur;
  out[String(season)]=weeks;
  return out;
}

// Which seasons a weekly document actually holds.
export function seasonsIn(doc){
  var weeks=(doc&&doc.weeks)||{};
  if(isFlat(weeks)) return [LEGACY_SEASON];
  return Object.keys(weeks).sort();
}
