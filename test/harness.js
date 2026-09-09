// Loads the app's script under Node with just enough browser stubbed to construct
// it, then hands back its functions by name. Used by the unit tests so they run the
// real code, not a copy. After the refactor, tests import rules.js directly and this
// harness goes away.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function element() {
  const el = {
    hidden: false, value: "", textContent: "", innerHTML: "", disabled: false, open: false,
    style: { setProperty() {} }, classList: { add() {}, remove() {} },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, close() {}, showModal() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    forEach() {},
  };
  return el;
}

function load(names) {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  let src = html.match(/<script>([\s\S]*)<\/script>/)[1];
  // expose the requested functions from inside the IIFE
  src = src.replace(/\}\)\(\);\s*$/, `\nreturn {${names.join(",")}};\n})();`);
  src = "var __app = " + src.trimStart();
  const els = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    Date, Math, JSON, Number, String, Array, Object, Promise, Intl, RegExp, parseFloat, isNaN, encodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} },
    location: { search: "", pathname: "/", reload() {}, replace() {} },
    history: { replaceState() {} },
    navigator: { userAgent: "node" },
    URLSearchParams,
    fetch() { return Promise.reject(new Error("no network in tests")); },
    document: {
      getElementById(id) { if (!els.has(id)) els.set(id, element()); return els.get(id); },
      querySelectorAll() { return []; }, querySelector() { return null; },
      addEventListener() {},
    },
    window: { FIREBASE_CONFIG: null, addEventListener() {} },
    firebase: { apps: [], initializeApp() {}, firestore() { return { settings() {} }; }, auth() { return { onAuthStateChanged() {}, currentUser: null }; } },
  };
  sandbox.window.firebase = sandbox.firebase;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "index.html<script>" });
  return sandbox.__app;
}

module.exports = { load };
