// The page's service worker, for push only. Firebase Messaging needs one to receive
// a notification while the app is closed; the browser shows what the function sends
// (a title, a line, the icon) and a tap opens the app at that bet. Served from the
// site's own folder, so notify.js registers it by relative path.
importScripts("vendor/firebase-app-compat.js");
importScripts("vendor/firebase-messaging-compat.js");
importScripts("firebase-config.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
var messaging=firebase.messaging();

// Everything the function sends carries a notification the browser shows itself.
// A data-only message (nothing does that today) gets shown by hand here.
messaging.onBackgroundMessage(function(m){
  if(m&&m.notification) return;
  var d=(m&&m.data)||{};
  return self.registration.showNotification(d.title||"Smyrna League",{ body:d.body||"", icon:"icon-192.png", tag:d.tag||undefined, data:{ FCM_MSG:{ data:d, fcmOptions:{ link:d.link||"./" } } } });
});

// Take over open pages right away, so the first visit after a deploy is on this worker.
self.addEventListener("install",function(){ self.skipWaiting(); });
self.addEventListener("activate",function(ev){ ev.waitUntil(self.clients.claim()); });
