// Fixtures shared by more than one of the split rules tests.

export const KICKOFF = "2026-09-10T00:20:00Z";   // Wed Sep 9 2026, 8:20 PM ET

export const config = { leagueName: "T", season: "2026", stake: 25, kickoff: KICKOFF,
  weekStarts: { "1": KICKOFF, "2": "2026-09-18T00:15:00Z", "12": "2026-11-26T01:00:00Z", "18": "2027-01-10T18:00:00Z" },
  members: [{ id: "m0", name: "gmelan1", color: "#000" }, { id: "m1", name: "JPorch", color: "#000" }, { id: "m2", name: "RTownsend", color: "#000" }] };
