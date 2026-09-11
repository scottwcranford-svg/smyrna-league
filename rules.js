// Pure league logic, split by concern. Nothing reached from here touches the DOM, the
// network or Firebase; every function takes what it needs as arguments so it can be
// tested under Node.
//
// This file is a barrel: it re-exports the ten modules below so `import * as R from
// "./rules.js"` keeps working while callers are moved over to importing the module
// they actually depend on. See REFACTOR-RULES.md.
//
//   fmt       formatting and the small shared helpers      (imports nothing)
//   clock     kickoff locks and week math                  (imports nothing)
//   identity  who a manager is, and who is an admin        (imports nothing)
//   roster    Sleeper player rows, status, team names      (imports nothing)
//   schedule  the season CSV: lines, week starts, ET       (imports nothing)
//   stats     the stat catalog and the sums built from it
//   ledger    what each bet moved, high/low, who owes whom
//   bets      a bet's life: joinable, covered, auto-named
//   rivals    head-to-head history between two managers
//   badges    season titles and what moved

export * from "./fmt.js?v=dev";
export * from "./clock.js?v=dev";
export * from "./identity.js?v=dev";
export * from "./roster.js?v=dev";
export * from "./schedule.js?v=dev";
export * from "./stats.js?v=dev";
export * from "./ledger.js?v=dev";
export * from "./bets.js?v=dev";
export * from "./rivals.js?v=dev";
export * from "./badges.js?v=dev";
