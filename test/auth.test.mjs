// auth.js against a fake Firebase Auth: who a signed-in account is, whether it's
// an admin, the default-password check, and the admin's set-password flow on the
// secondary app.
import test from "node:test";
import assert from "node:assert/strict";

const log = [];
const users = { "jporch@smyrna.league": "JPorch123!" };
function fakeAuth(name) {
  return {
    currentUser: null,
    signInWithEmailAndPassword: async (e, p) => { log.push(name + " signIn " + e); if (users[e] !== p) throw { code: "auth/invalid-credential" }; return { user: { email: e } }; },
    createUserWithEmailAndPassword: async (e, p) => { log.push(name + " create " + e); if (users[e]) throw { code: "auth/email-already-in-use" }; users[e] = p; },
    signOut: async () => { log.push(name + " signOut"); },
    onAuthStateChanged: (fn) => { log.push(name + " watch"); fn(null); },
  };
}
const main = fakeAuth("main"), mgr = fakeAuth("mgr");
mgr.currentUser = { updatePassword: async (p) => { log.push("mgr update " + p); users["jporch@smyrna.league"] = p; } };
globalThis.firebase = { apps: [{ name: "[DEFAULT]" }], initializeApp: (c, n) => { const a = { name: n, auth: () => mgr }; globalThis.firebase.apps.push(a); return a; }, auth: Object.assign(() => main, { EmailAuthProvider: { credential: (e, p) => ({ e, p }) } }) };
globalThis.window = { FIREBASE_CONFIG: { projectId: "t" } };

const A = await import("../auth.js");
const config = { members: [{ id: "m1", name: "JPorch" }, { id: "m2", name: "hobnailboot" }], adminEmails: ["hobnailboot@smyrna.league"] };

test("whoAmI maps the account to a manager and flags admins", () => {
  assert.equal(JSON.stringify(A.whoAmI({ email: "jporch@smyrna.league" }, config)), JSON.stringify({ me: "m1", admin: false }));
  assert.equal(JSON.stringify(A.whoAmI({ email: "HobnailBoot@smyrna.league" }, config)), JSON.stringify({ me: "m2", admin: true }));
  assert.equal(JSON.stringify(A.whoAmI(null, config)), JSON.stringify({ me: null, admin: false }));
  assert.equal(JSON.stringify(A.whoAmI({ email: "nobody@smyrna.league" }, null)), JSON.stringify({ me: null, admin: false }));
});

test("signIn builds the synthetic address from the name", async () => {
  const cred = await A.signIn("JPorch", "JPorch123!");
  assert.equal(cred.user.email, "jporch@smyrna.league");
  await assert.rejects(A.signIn("JPorch", "nope"), (e) => e.code === "auth/invalid-credential");
});

test("isDefaultPassword is decided from what was typed, never by probing", () => {
  const before = log.length;
  assert.equal(A.isDefaultPassword({ email: "jporch@smyrna.league" }, "JPorch123!", config.members), true);
  assert.equal(A.isDefaultPassword({ email: "jporch@smyrna.league" }, "something-else", config.members), false);
  assert.equal(A.isDefaultPassword({ email: "ghost@smyrna.league" }, "Ghost123!", config.members), false, "unknown account");
  assert.equal(log.length, before, "no auth calls made");
});

test("changePassword re-authenticates with the current password first", async () => {
  const steps = [];
  const user = { email: "jporch@smyrna.league", reauthenticateWithCredential: async (c) => { steps.push("reauth " + c.p); }, updatePassword: async (p) => { steps.push("update " + p); } };
  await A.changePassword(user, "old", "new123");
  assert.equal(JSON.stringify(steps), JSON.stringify(["reauth old", "update new123"]));
});

test("setPassword creates the account on the secondary app, or updates it after asking for the current one", async () => {
  log.length = 0;
  assert.equal(await A.setPassword({ name: "Newbie" }, "Newbie123!"), "Password set for Newbie");
  assert.equal(users["newbie@smyrna.league"], "Newbie123!");
  assert.equal(log.includes("mgr signOut"), true, "the admin's own session stays put; the helper app signs out");
  assert.equal(log.some((l) => l.startsWith("main")), false);

  await assert.rejects(A.setPassword({ name: "JPorch" }, "JPorch456!", () => null), (e) => /not changed/.test(e.message));
  assert.equal(await A.setPassword({ name: "JPorch" }, "JPorch456!", () => "JPorch123!"), "Password changed for JPorch");
  assert.equal(users["jporch@smyrna.league"], "JPorch456!");
});

test("authMsg puts Firebase codes in plain words", () => {
  assert.match(A.authMsg({ code: "auth/invalid-credential" }), /Name or password/);
  assert.match(A.authMsg({ code: "auth/too-many-requests" }), /wait a minute/);
  assert.equal(A.authMsg({ message: "odd" }), "odd");
});
