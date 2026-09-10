// The Firebase project's public web config (Project settings → Your apps).
// This is a public identifier, not a secret: access is governed by Firestore rules,
// which admit a path only when keys/<passcode> exists. `vapidKey` is the web push
// key pair's public half (Project settings → Cloud Messaging → Web configuration);
// also public. Set on `self` rather than `window` because the service worker
// (firebase-messaging-sw.js) reads this file too, and a worker has no window.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbih_XJRbIPyJeesUABXWIz5GsHGLcaHk",
  authDomain: "smyrna-league.firebaseapp.com",
  projectId: "smyrna-league",
  storageBucket: "smyrna-league.firebasestorage.app",
  messagingSenderId: "584956957180",
  appId: "1:584956957180:web:c4e1a697d021e41a46e279",
  vapidKey: "BMIgL6WyGkMZGnaaUOo9kTqWxNzjYM6UrwqcEOuzeosTpOysd2Lb9imXoU_7UqwHkqQ5AMYEtk_KX13asQnUmgY"
};
