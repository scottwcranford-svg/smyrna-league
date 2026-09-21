// Who hears what about the poker table. Pure, like notices.js for bets: the table as it
// was and as it is, the dealer's effects, the members, and back come
// { to, title, body, tag, bet:null, link } notices. Deliberately few: a table opening,
// the table filling up, and the dealer sitting you out or cashing you out. Nobody is
// pushed "your turn" on a thirty-second clock.
"use strict";

function money(c){ const v = Math.abs(Number(c) || 0) / 100; return "$" + (Number.isInteger(v) ? v : v.toFixed(2)); }
function nameOf(id, members){ const m = (members || []).find(x => x && x.id === id); return m ? m.name : "Someone"; }
const seatedIds = t => (t && t.seats || []).filter(Boolean).map(s => s.memberId);
const list = names => names.length <= 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

function pokerNotices(before, after, effects, members){
  const out = [];
  if (!after) return out;
  const all = (members || []).filter(m => m && m.id).map(m => m.id);
  const link = "?poker=1";
  const blinds = money(after.blinds.sb) + "/" + money(after.blinds.bb);
  const opened = (!before || before.status === "closed") && after.status !== "closed";
  if (opened) {
    out.push({ to: all.filter(id => id !== after.openedBy), title: "Poker table open · " + blinds,
      body: nameOf(after.openedBy, members) + " opened it · buy in " + money(after.minBuy) + " to " + money(after.maxBuy), tag: "poker-open-" + after.sessionId, bet: null, link });
  } else if (before && seatedIds(before).length < 3 && seatedIds(after).length >= 3 && after.status !== "closed") {
    const seated = seatedIds(after);
    out.push({ to: all.filter(id => seated.indexOf(id) < 0), title: "Poker table open · " + blinds,
      body: seated.length + " seated: " + list(seated.map(id => nameOf(id, members))), tag: "poker-open-" + after.sessionId, bet: null, link });
  }
  ((effects && effects.notices) || []).forEach(n => {
    if (n.kind === "autoOut") out.push({ to: [n.memberId], title: "You've been sat out", body: "Two missed clocks at the poker table. Tap I'm back when you're there.", tag: "poker-seat-" + n.memberId, bet: null, link });
    else if (n.kind === "autoLeave") out.push({ to: [n.memberId], title: "Cashed out " + money(n.amount), body: "Sat out ten minutes at the poker table, so the dealer cashed you out.", tag: "poker-seat-" + n.memberId, bet: null, link });
    else if (n.kind === "closed") out.push({ to: [n.memberId], title: "Table closed · you cashed out " + money(n.amount), body: "Settle up between yourselves; the session tally is in the app.", tag: "poker-seat-" + n.memberId, bet: null, link });
  });
  return out.filter(n => n.to.length);
}

module.exports = { pokerNotices, money };
