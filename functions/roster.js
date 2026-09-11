// Who is in the league this season, worked out from Sleeper's own roster.
//
// Pure: no Firestore, no Auth, no network. index.js hands it the Sleeper league's users
// and the book's managers and acts on what comes back, which is what makes it testable.
//
// Two rules it never breaks:
//
//   Identity is permanent. A manager is never removed and never renamed, because bets,
//   badges and rivalries point at them by id long after they stop playing. Somebody who
//   left simply doesn't get the new season added to their list.
//
//   Test accounts are invisible to this. They are not in the Sleeper league by design, so
//   the reconcile must never read their absence as "they left", nor add a member for them.
"use strict";

const AUTH_DOMAIN = "smyrna.league";
// The league the app falls back to when config carries no override, kept in step with
// SLEEPER_LEAGUE_ID in roster.js. The book has never set sleeperLeagueId, because the app
// has always defaulted it in code - so a function that only read config found nothing.
const SLEEPER_LEAGUE_ID = "1314265150127116288";
const COLORS = ["#3B5799","#A8353B","#1C6F53","#8A6A12","#6D4C9F","#0F7284",
                "#B4542A","#2F6B34","#8C3D6B","#4A5D75","#A0522D","#365F9E"];

// The app's own rules, kept in step with identity.js.
function slugName(n){ return String(n == null ? "" : n).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function emailFor(name){ return slugName(name) + "@" + AUTH_DOMAIN; }
function defaultPw(name){ return String(name == null ? "" : name) + "123!"; }

function nameOf(u){ return String((u && (u.display_name || u.username)) || "").trim(); }

// What should change in the book so it matches Sleeper for `season`.
//
//   adds       managers to create, with the account to create alongside them
//   seasonAdds ids of managers already in the book who need `season` on their list
//   skipped    Sleeper users we refuse to act on, and why
//
// `newId` makes ids injectable so a test can assert on them.
function reconcile(sleeperUsers, members, season, newId) {
  const wanted = String(season);
  const list = Array.isArray(members) ? members : [];

  // Sleeper's user_id is the only stable handle on a person: display names change between
  // seasons, and matching on one forks the identity - last year's bets stay on the old
  // record while this year's go to a new one. So a member is pinned to their Sleeper id
  // the first time we can, and matched on it forever after.
  const bySleeper = {}, byName = {};
  list.forEach((m) => {
    if (m && m.sleeperId) bySleeper[String(m.sleeperId)] = m;
    const k = slugName(m && m.name);
    if (k && !byName[k]) byName[k] = m;
  });

  const adds = [], updates = [], skipped = [];
  const seen = {};
  let colour = list.length;

  (Array.isArray(sleeperUsers) ? sleeperUsers : []).forEach((u) => {
    const name = nameOf(u);
    const sid = String((u && u.user_id) || "");
    const key = slugName(name);
    if (!key) { skipped.push({ name, why: "no usable name" }); return; }
    if (seen[sid || key]) { skipped.push({ name, why: "listed twice in the Sleeper league" }); return; }
    seen[sid || key] = true;

    let m = sid ? bySleeper[sid] : null;
    let learn = false;
    if (!m) {
      const cand = byName[key];
      // Adopt a name match only if that record isn't already somebody else's Sleeper
      // account. Two managers can share a display name; they cannot share a user_id.
      if (cand && !cand.sleeperId) { m = cand; learn = !!sid; }
    }

    if (m) {
      const have = Array.isArray(m.seasons) && m.seasons.length ? m.seasons.map(String) : ["2026"];
      const up = { id: m.id };
      if (have.indexOf(wanted) < 0) up.seasons = have.concat([wanted]).sort();
      if (learn) up.sleeperId = sid;
      if (up.seasons || up.sleeperId) updates.push(up);
      return;
    }

    adds.push({
      member: { id: newId ? newId() : null, name: name, team: "", sleeperId: sid || null,
        seasons: [wanted], color: COLORS[colour++ % COLORS.length] },
      account: { email: emailFor(name), password: defaultPw(name) },
    });
  });

  return { adds, updates, skipped };
}

// Nothing to write is the normal case, and a write that changes nothing would come back as
// a snapshot and redraw every open page for no reason.
function isNoop(plan){ return !plan.adds.length && !plan.updates.length; }

// Apply a plan to a members array, returning a new one. Order is preserved and nobody is
// dropped: the only edits are appended managers and a longer `seasons` list.
function applyPlan(members, plan) {
  const byId = {};
  plan.updates.forEach((u) => { byId[u.id] = u; });
  const out = (Array.isArray(members) ? members : []).map((m) => {
    const u = byId[m && m.id];
    if (!u) return m;
    const next = Object.assign({}, m);
    if (u.seasons) next.seasons = u.seasons;
    if (u.sleeperId) next.sleeperId = u.sleeperId;
    return next;
  });
  return out.concat(plan.adds.map((a) => a.member));
}

// A season's Sleeper league id: the season's own, else the book-wide override, else the
// default the app itself uses. Sleeper mints a new id every year, which is why phase 2
// moves this onto the season rather than leaving it a constant.
function leagueIdFor(cfg, season) {
  const per = (cfg && cfg.bySeason && cfg.bySeason[String(season)]) || {};
  return String(per.leagueId || (cfg && cfg.sleeperLeagueId) || SLEEPER_LEAGUE_ID);
}

module.exports = { reconcile, applyPlan, isNoop, leagueIdFor, slugName, emailFor, defaultPw, AUTH_DOMAIN, SLEEPER_LEAGUE_ID };
