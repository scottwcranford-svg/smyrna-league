// The season CSV: betting lines, week starts, Eastern to UTC.
import test from "node:test";
import assert from "node:assert/strict";
import * as Sched from "../schedule.js";

const LINES_CSV = [
  "game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line",
  "2026_01_NE_SEA,2026,REG,1,2026-09-09,20:20,NE,,SEA,,3,44.5",
  "2026_01_SF_LA,2026,REG,1,2026-09-10,20:15,SF,,LA,,3.5,47.5",
  "2026_01_CHI_CAR,2026,REG,1,2026-09-13,13:00,CHI,,CAR,,-3,46.5",
  "2026_02_DAL_PHI,2026,REG,2,2026-09-20,13:00,DAL,,PHI,,0,41",
  "2026_12_KC_DEN,2026,REG,12,2026-11-22,13:00,KC,,DEN,,,",
  "2025_01_NE_SEA,2025,REG,1,2025-09-09,20:20,NE,,SEA,,7,40",
  "2026_99_AFC_NFC,2026,POST,22,2027-02-07,18:30,AFC,,NFC,,2,45",
].join("\n");

test("schedule CSV → first kickoff per week, Eastern → UTC across the clock change", () => {
  const csv = ["game_id,season,game_type,week,gameday,weekday,gametime,away_team,home_team",
    "a,2026,REG,1,2026-09-09,Wednesday,20:20,NE,SEA", "b,2026,REG,1,2026-09-13,Sunday,13:00,CHI,CAR",
    "c,2026,REG,12,2026-11-25,Wednesday,20:00,GB,LA", "d,2026,REG,18,2027-01-10,Sunday,13:00,SF,ARI",
    "e,2025,REG,1,2025-09-04,Thursday,20:20,DAL,PHI", "f,2026,POST,19,2027-01-16,Saturday,16:30,X,Y"].join("\n");
  const ws = Sched.weekStartsFromCsv(csv, "2026");
  assert.equal(ws["1"], "2026-09-10T00:20:00Z");
  assert.equal(ws["12"], "2026-11-26T01:00:00Z", "EST after the November change");
  assert.equal(ws["18"], "2027-01-10T18:00:00Z");
  assert.equal(ws["19"], undefined, "postseason ignored");
  assert.equal(new Date(Sched.etToUtc("2026-07-04", "12:00")).toISOString(), "2026-07-04T16:00:00.000Z", "EDT is UTC-4");
});

test("betting lines: parsed from the schedule file, the Rams renamed, other seasons left out", () => {
  const lines = Sched.linesFromCsv(LINES_CSV, "2026");
  assert.deepEqual(Object.keys(lines).sort(), ["1|CHI|CAR", "1|NE|SEA", "1|SF|LAR", "2|DAL|PHI"],
    "only 2026 regular-season games with a number, and LA is the app's LAR");
  assert.deepEqual(lines["1|NE|SEA"], { spread: 3, total: 44.5 });
  assert.equal(lines["12|KC|DEN"], undefined, "a game Vegas hasn't posted isn't stored");
  assert.deepEqual(Sched.linesFromCsv("nothing,useful\n1,2", "2026"), {}, "a file without the columns is ignored, not guessed at");
});

test("lineFor: the spread is read from the home team's side and named for the favourite", () => {
  const lines = Sched.linesFromCsv(LINES_CSV, "2026");
  const seattle = Sched.lineFor({ week: 1, away: "NE", home: "SEA" }, lines);
  assert.deepEqual(seattle, { total: 44.5, spread: 3, fav: "SEA", dog: "NE", pick: false }, "positive means the home team gives the points");
  const chicago = Sched.lineFor({ week: 1, away: "CHI", home: "CAR" }, lines);
  assert.deepEqual({ fav: chicago.fav, dog: chicago.dog, spread: chicago.spread }, { fav: "CHI", dog: "CAR", spread: 3 }, "negative means the away team is favoured");
  const even = Sched.lineFor({ week: 2, away: "DAL", home: "PHI" }, lines);
  assert.equal(even.pick, true, "a zero spread is a pick'em, not a missing line");
  assert.equal(Sched.lineFor({ week: 12, away: "KC", home: "DEN" }, lines), null, "no line, nothing to show");
  assert.equal(Sched.lineFor(null, lines), null);
  assert.equal(Sched.lineFor({ week: 1, away: "NE", home: "SEA" }, null), null);
  assert.deepEqual(Sched.lineFor({ week: 1, away: "SF", home: "LAR" }, { byGame: lines }).fav, "LAR", "reads the stored { byGame } shape too");
});

test("lineSummary: what the picker and the ticker print", () => {
  const lines = Sched.linesFromCsv(LINES_CSV, "2026");
  assert.equal(Sched.lineSummary(Sched.lineFor({ week: 1, away: "NE", home: "SEA" }, lines)), "SEA −3 · O/U 44.5");
  assert.equal(Sched.lineSummary(Sched.lineFor({ week: 2, away: "DAL", home: "PHI" }, lines)), "pick'em · O/U 41");
  assert.equal(Sched.lineSummary(null), "");
});
