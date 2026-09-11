// Formatting helpers: countdowns, money, names.
import test from "node:test";
import assert from "node:assert/strict";
import * as Fmt from "../fmt.js";
import * as Id from "../identity.js";

test("countdown formats days, hours, minutes", () => {
  const now = Date.now();
  assert.match(Fmt.countdown(now + 2 * 86400e3 + 3 * 3600e3), /^2d 3h$/);
  assert.match(Fmt.countdown(now + 3 * 3600e3 + 12 * 60e3), /^3h 1[12]m$/);
  assert.match(Fmt.countdown(now + 90e3), /^1m$/);
  assert.equal(Fmt.countdown(now - 1), "under a minute");
});

test("small helpers", () => {
  assert.equal(Fmt.shortName(["1", "Amon-Ra St. Brown", "WR", "DET"]), "St. Brown");
  assert.equal(Fmt.shortName(["HOU", "Houston Texans", "DEF", "HOU"]), "Texans");
  assert.equal(Fmt.money(1234.5), "$1,234.50"); assert.equal(Fmt.money(25), "$25");
  assert.equal(Fmt.signed(-25), "−$25"); assert.equal(Fmt.signed(50), "+$50");
  assert.equal(Fmt.initials("Smyrna League"), "SM");
  assert.equal(Id.slugName("Amon-Ra St. Brown"), "amonrastbrown");
  assert.equal(Id.defaultPw({ name: "JPorch" }), "JPorch123!");
});

test("nameList: everyone named, however many hold it", () => {
  assert.equal(Fmt.nameList([]), "");
  assert.equal(Fmt.nameList(["Alice"]), "Alice");
  assert.equal(Fmt.nameList(["Alice", "Bob"]), "Alice and Bob");
  assert.equal(Fmt.nameList(["Alice", "Bob", "Cara"]), "Alice, Bob and Cara");
  assert.equal(Fmt.nameList(["Alice", "Bob", "Cara", "Dan"]), "Alice, Bob, Cara and Dan", "everyone is named, however many share it");
});
