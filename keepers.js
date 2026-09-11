// Who you can keep next year, and what it costs.
//
// The league's rules, in the order they bite:
//
//   Two keepers at most. One from rounds 3-9 of last year's draft, one from rounds 10-16.
//   A keeper costs you this year's pick in the round they went in.
//   Somebody never drafted — a real waiver pickup — can be kept at the 9th or 10th slot,
//   so two waiver players can be kept, one in each.
//   Only one of your keepers may be a QB.
//   A contract runs two seasons. Once a player has been kept twice, by one manager or
//   several, they go back into the pool.
//   Keeping nobody is allowed.
//
// Pure: no DOM, no network, no state. Feed it the roster, last year's picks and the year
// before's keepers, and it answers for one manager.

export const EARLY = [3, 9];     // the first keeper slot
export const LATE = [10, 16];    // the second
export const WIRE_EARLY = 9;     // what an undrafted player costs in the early slot
export const WIRE_LATE = 10;     // and in the late one
export const MAX_KEEPERS = 2;
export const CONTRACT = 2;       // seasons, then back to the pool

// How many seasons in a row this player has already been kept, ending with last season.
// Two is the whole contract, so they are spent.
export function seasonsKept(pid, keptLast, keptBefore) {
  var n = 0;
  if (keptLast && keptLast[pid]) { n++; if (keptBefore && keptBefore[pid]) n++; }
  return n;
}

// What a single player is worth to you next year.
//   band  "early" | "late" | "wire" | null   which slot they can fill
//   cost  the round they would take, or null
//   why   why not, when they cannot be kept
export function statusOf(pid, pick, keptLast, keptBefore) {
  var years = seasonsKept(pid, keptLast, keptBefore);
  if (years >= CONTRACT) return { band: null, cost: null, years: years, why: "kept two seasons — back in the pool" };
  if (!pick) return { band: "wire", cost: null, years: years, why: "", wire: true };
  var r = Number(pick.r || pick.round);
  if (!(r > 0)) return { band: null, cost: null, years: years, why: "no draft round on record" };
  if (r < EARLY[0]) return { band: null, cost: r, years: years, why: "round " + r + " — too early to keep" };
  if (r <= EARLY[1]) return { band: "early", cost: r, years: years, why: "" };
  if (r <= LATE[1]) return { band: "late", cost: r, years: years, why: "" };
  return { band: null, cost: r, years: years, why: "round " + r + " — outside the keeper rounds" };
}

// Every player on a roster, with what keeping them would mean. `picks` is last year's
// draft keyed by player id; `keptLast` / `keptBefore` are sets of ids kept in those years.
export function eligible(players, picks, keptLast, keptBefore, nameOf) {
  return (players || []).map(function (pid) {
    var who = (nameOf && nameOf(pid)) || { name: pid, pos: "" };
    var s = statusOf(pid, picks && picks[pid], keptLast, keptBefore);
    return { id: pid, name: who.name, pos: who.pos, band: s.band, cost: s.cost,
      years: s.years, why: s.why, wire: !!s.wire };
  });
}

// Is this set of choices legal? Returns every problem, not just the first, so the screen
// can say all of it at once instead of one complaint at a time.
export function checkChoice(chosen) {
  var list = chosen || [], problems = [];
  if (list.length > MAX_KEEPERS) problems.push("Two keepers at most");
  var bad = list.filter(function (c) { return !c.band; });
  bad.forEach(function (c) { problems.push(c.name + " can't be kept — " + (c.why || "not eligible")); });

  // A waiver player fills whichever slot is free, so count the ones that are pinned first
  // and let the rest fall where they can.
  var early = list.filter(function (c) { return c.band === "early"; }).length;
  var late = list.filter(function (c) { return c.band === "late"; }).length;
  var wire = list.filter(function (c) { return c.band === "wire"; }).length;
  if (early > 1) problems.push("Only one keeper from rounds 3–9");
  if (late > 1) problems.push("Only one keeper from rounds 10–16");
  if (wire && early + late + wire > MAX_KEEPERS) problems.push("Two keepers at most");
  else if (wire && early >= 1 && late >= 1) problems.push("No slot left for a waiver keeper");

  var qbs = list.filter(function (c) { return String(c.pos).toUpperCase() === "QB"; }).length;
  if (qbs > 1) problems.push("Only one QB can be kept");
  return { ok: !problems.length, problems: problems };
}

// What a chosen keeper costs, once a waiver player has a slot to sit in.
export function costOf(c, slot) {
  if (c.band !== "wire") return c.cost;
  return slot === "late" ? WIRE_LATE : WIRE_EARLY;
}
