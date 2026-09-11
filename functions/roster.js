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
  const byName = {};
  list.forEach((m) => { const k = slugName(m && m.name); if (k) byName[k] = m; });

  const adds = [], seasonAdds = [], skipped = [];
  const seen = {};
  let colour = list.length;

  (Array.isArray(sleeperUsers) ? sleeperUsers : []).forEach((u) => {
    const name = nameOf(u);
    const key = slugName(name);
    if (!key) { skipped.push({ name, why: "no usable name" }); return; }
    if (seen[key]) { skipped.push({ name, why: "listed twice in the Sleeper league" }); return; }
    seen[key] = true;

    const m = byName[key];
    if (m) {
      const have = Array.isArray(m.seasons) && m.seasons.length ? m.seasons.map(String) : ["2026"];
      if (have.indexOf(wanted) < 0) seasonAdds.push({ id: m.id, seasons: have.concat([wanted]).sort() });
      return;
    }
    adds.push({
      member: { id: newId ? newId() : null, name: name, team: "",
        seasons: [wanted], color: COLORS[colour++ % COLORS.length] },
      account: { email: emailFor(name), password: defaultPw(name) },
    });
  });

  return { adds, seasonAdds, skipped };
}

// Nothing to write is the normal case, and a write that changes nothing would come back as
// a snapshot and redraw every open page for no reason.
function isNoop(plan){ return !plan.adds.length && !plan.seasonAdds.length; }

// Apply a plan to a members array, returning a new one. Order is preserved and nobody is
// dropped: the only edits are appended managers and a longer `seasons` list.
function applyPlan(members, plan) {
  const bySeasonAdd = {};
  plan.seasonAdds.forEach((s) => { bySeasonAdd[s.id] = s.seasons; });
  const out = (Array.isArray(members) ? members : []).map((m) => {
    const next = bySeasonAdd[m && m.id];
    return next ? Object.assign({}, m, { seasons: next }) : m;
  });
  return out.concat(plan.adds.map((a) => a.member));
}

module.exports = { reconcile, applyPlan, isNoop, slugName, emailFor, defaultPw, AUTH_DOMAIN };
