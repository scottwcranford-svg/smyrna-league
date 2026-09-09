// store.js against a fake Firestore: the roster's nested arrays ride as JSON text,
// leases are taken in a transaction, the passcode comes from the link or the device,
// and refusals turn into plain words.
import test from "node:test";
import assert from "node:assert/strict";

// ---- a tiny in-memory Firestore compat stand-in ----
const docs = new Map();
function docRef(path) {
  return {
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (d, o) => { docs.set(path, o && o.merge ? { ...(docs.get(path) || {}), ...d } : d); },
    delete: async () => { docs.delete(path); },
    onSnapshot(fn) { fn({ exists: docs.has(path), data: () => docs.get(path) }); return () => {}; },
  };
}
function col(prefix) {
  return { doc: (id) => ({ ...docRef(prefix + "/" + id), collection: (c) => col(prefix + "/" + id + "/" + c) }),
           onSnapshot(fn) { fn({ docs: [...docs].filter(([k]) => k.startsWith(prefix + "/")).map(([k, v]) => ({ id: k.slice(prefix.length + 1), data: () => v })) }); } };
}
const fake = {
  collection: (c) => col(c),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d) => r.set(d) }),
  settings() {},
};
let store = {};
globalThis.firebase = { apps: [], initializeApp() { globalThis.firebase.apps.push({}); }, firestore: () => fake };
globalThis.window = { FIREBASE_CONFIG: { projectId: "t" } };
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.location = { search: "", pathname: "/x/" };
globalThis.history = { replaceState() {} };

const S = await import("../store.js");

test("roster players go in as JSON text and come back as arrays", async () => {
  const db = S.makeDb("k1");
  await db.doc("league/roster").set({ players: [["1", "A B", "WR", "X"]], updatedAt: "t" });
  const raw = docs.get("books/k1/league/roster");
  assert.equal(raw.playersJson, JSON.stringify([["1", "A B", "WR", "X"]]));
  assert.equal(raw.players, undefined, "no nested array stored");
  const back = await db.doc("league/roster").get();
  assert.equal(JSON.stringify(back.data().players), JSON.stringify([["1", "A B", "WR", "X"]]));
  assert.equal(back.data().playersJson, undefined);
});

test("update merges, delete removes, collection lists ids", async () => {
  const db = S.makeDb("k1");
  await db.doc("bets/b1").set({ a: 1, b: 1 });
  await db.doc("bets/b1").update({ b: 2 });
  assert.equal(JSON.stringify(docs.get("books/k1/bets/b1")), JSON.stringify({ a: 1, b: 2 }));
  let seen = null; db.collection("bets").limit(10).onSnapshot((q) => { seen = q.docs.map((d) => d.id + ":" + d.data().b); });
  assert.equal(JSON.stringify(seen), JSON.stringify(["b1:2"]));
  await db.doc("bets/b1").delete();
  assert.equal(docs.has("books/k1/bets/b1"), false);
});

test("a lease is exclusive until it expires, and reentrant for its holder", async () => {
  const db = S.makeDb("k1");
  assert.equal(await S.lease(db, "refresh", 60000, "phoneA"), true);
  assert.equal(await S.lease(db, "refresh", 60000, "phoneB"), false, "someone else holds it");
  assert.equal(await S.lease(db, "refresh", 60000, "phoneA"), true, "the holder can renew");
  docs.get("books/k1/leases/leases_refresh").until = Date.now() - 1;
  assert.equal(await S.lease(db, "refresh", 60000, "phoneB"), true, "expired leases are free");
});

test("db.refresh runs the supplied hook with forced=true", async () => {
  const calls = [];
  const db = S.makeDb("k1", { refresh: (d, by, forced) => { calls.push([d.key, by, forced]); return Promise.resolve("ran"); } });
  assert.equal(await db.refresh("m1"), "ran");
  assert.equal(JSON.stringify(calls), JSON.stringify([["k1", "m1", true]]));
  assert.equal(await S.makeDb("k2").refresh("m1"), null, "no hook, no refresh");
});

test("passcode: link wins and is scrubbed, else memory, else device", () => {
  store = {};
  assert.equal(S.storedKey(), "");
  S.setKey("abc"); assert.equal(S.storedKey(), "abc"); assert.equal(store[S.KEY_LS], "abc");
  location.search = "?key=fromlink"; assert.equal(S.storedKey(), "fromlink"); location.search = "";
  assert.equal(store[S.KEY_LS], "fromlink", "the link's passcode is remembered on the device");
  S.forgetKey(); assert.equal(S.storedKey(), ""); assert.equal(store[S.KEY_LS], undefined);
});

test("tryKey: malformed passcodes never hit the network; the gate decides the rest", async () => {
  assert.equal(await S.tryKey("no spaces!"), false);
  assert.equal(await S.tryKey("ab"), false);
  assert.equal(await S.tryKey("smyrna-league-2026"), true, "a readable (or merely missing) gate passes; only permission-denied fails");
});

test("dbMsg puts refusals in plain words", () => {
  assert.match(S.dbMsg({ code: "permission-denied" }), /wrong passcode/);
  assert.match(S.dbMsg({ code: "resource-exhausted" }), /quota/);
  assert.match(S.dbMsg({}), /try again/);
});
