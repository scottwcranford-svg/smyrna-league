// Each player's season so far, for the Draft board.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../players.js";

test("finalThrough: the unbroken run of finished weeks from week 1", () => {
  assert.equal(P.finalThrough([1, 2, 4]), 2);
  assert.equal(P.finalThrough([2, 3]), 0, "week 1 not final is nothing");
  assert.equal(P.finalThrough([]), 0);
});

test("fieldFor: the league's scoring picks the points field, PPR when unknown", () => {
  assert.equal(P.fieldFor("PPR"), "pts_ppr");
  assert.equal(P.fieldFor("Half PPR"), "pts_half_ppr");
  assert.equal(P.fieldFor("Standard"), "pts_std");
  assert.equal(P.fieldFor(undefined), "pts_ppr");
});

test("weekPoints: one field, the players we know, zeros left out", () => {
  const raw = { a: { pts_ppr: 22.14, rec: 4 }, b: { pts_ppr: 0 }, z: { pts_ppr: 9 } };
  assert.deepEqual(P.weekPoints(raw, ["a", "b", "c"], "pts_ppr"), { a: 22.1 });
  assert.deepEqual(P.weekPoints(null, ["a"], "pts_ppr"), {});
});

test("seasonRows: points and projection added up, ranked by total points at the position, ties share", () => {
  const roster = [["r1", "Gibbs", "RB", "DET"], ["r2", "Hall", "RB", "NYJ"], ["r3", "Judkins", "RB", "CLE"], ["r4", "Hurt", "RB", "FA"],
    ["w1", "Collins", "WR", "HOU"], ["q1", "Nix", "QB", "DEN"]];
  const actual = [{ r1: { pts_ppr: 20 }, r2: { pts_ppr: 12 }, r3: { pts_ppr: 15 }, w1: { pts_ppr: 8 } },
    { r1: { pts_ppr: 18.4 }, r2: { pts_ppr: 6 }, r3: { pts_ppr: 3 }, w1: { pts_ppr: 11 }, x: { pts_ppr: 40 } }];
  const proj = [{ r1: 17, r2: 14, r3: 9, r4: 5, w1: 12 }, { r1: 17, r2: 14, r3: 9, r4: 5, w1: 12 }];
  assert.deepEqual(P.seasonRows(actual, proj, roster, "pts_ppr"), {
    r1: [38.4, 34, "RB1"], r2: [18, 28, "RB2"], r3: [18, 18, "RB2"], r4: [0, 10, ""], w1: [19, 24, "WR1"] },
    "Hall and Judkins tie on 18; a player who hasn't scored has no rank; nobody off the roster rows, and nobody with nothing");
});

test("trend: an arrow only past 10% either way, and none without a projection", () => {
  assert.equal(P.trend(38.4, 34), "up");
  assert.equal(P.trend(18, 28), "down");
  assert.equal(P.trend(19, 18), "", "within 10%");
  assert.equal(P.trend(11, 10), "", "exactly 10% is not past it");
  assert.equal(P.trend(12, 0), "");
});

test("whereNow: still on the drafting team, on another, or dropped", () => {
  const squads = { rosters: { 1: ["a"], 2: ["b"], 3: [] } };
  assert.equal(P.whereNow("a", 1, squads), "");
  assert.equal(P.whereNow("b", 1, squads), "2");
  assert.equal(P.whereNow("c", 3, squads), "dropped");
  assert.equal(P.whereNow("a", 2, null), "", "no rosters yet says nothing");
  assert.equal(P.whereNow("", 1, squads), "", "nor does a pick with no id");
});
