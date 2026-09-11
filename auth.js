// Who you are: Firebase Auth. Accounts are <slug(name)>@smyrna.league with a
// password the admin sets; no real email involved. Identity is the signed-in
// account, so "acting as" can't be faked. Admins are the accounts listed in
// league/config.adminEmails. This module owns every call into firebase.auth();
// it has no DOM — the sign-in screen and dialogs live with the rest of the page.

import { AUTH_DOMAIN, slugName, defaultPw, emailFor, memberForEmail, adminEmails } from "./identity.js?v=dev";

function auth(){ return firebase.auth(); }

export function signIn(name,pw){ return auth().signInWithEmailAndPassword(slugName(name)+"@"+AUTH_DOMAIN,pw); }

export function signOut(){ return auth().signOut(); }

export function currentUser(){ return auth().currentUser; }

export function onAuthStateChanged(fn){ return auth().onAuthStateChanged(fn); }

// Which manager a signed-in account is, and whether that account is an admin.
export function whoAmI(user,config){
  var members=(config&&config.members)||[];
  var m=user?memberForEmail(user.email,members):null;
  return { me:m?m.id:null,
           admin:!!(user&&user.email&&adminEmails(config).indexOf(String(user.email).toLowerCase())>=0) };
}

// Still on the starting password? Decided from the password actually typed at
// sign-in — never by probing Firebase, which counts every probe as a failed login
// and eventually throttles the account.
export function isDefaultPassword(user,typedPw,members){
  var m=user?memberForEmail(user.email,members):null;
  return !!(m&&typedPw&&typedPw===defaultPw(m));
}

// A signed-in manager changes their own password. Firebase requires a fresh
// sign-in first, which is what the current password is for.
export function changePassword(user,cur,nw){
  var cred=firebase.auth.EmailAuthProvider.credential(user.email,cur);
  return user.reauthenticateWithCredential(cred).then(function(){ return user.updatePassword(nw); });
}

// The admin sets or changes a manager's password. Account creation runs on a
// second Firebase app instance so the admin's own session stays signed in. When
// the account already exists, `askCurrent()` must return its current password.
export function setPassword(m,pw,askCurrent){
  var app2=null; firebase.apps.forEach(function(a){ if(a.name==="mgr") app2=a; });
  if(!app2) app2=firebase.initializeApp(window.FIREBASE_CONFIG,"mgr");
  var auth2=app2.auth(), email=emailFor(m);
  return auth2.createUserWithEmailAndPassword(email,pw).then(function(){
    return auth2.signOut().then(function(){ return "Password set for "+m.name; });
  }).catch(function(e){
    if(e.code!=="auth/email-already-in-use") throw e;
    var cur=askCurrent?askCurrent():null;
    if(!cur) throw { message:"Password not changed" };
    return auth2.signInWithEmailAndPassword(email,cur).then(function(){ return auth2.currentUser.updatePassword(pw); })
      .then(function(){ return auth2.signOut(); }).then(function(){ return "Password changed for "+m.name; });
  });
}

export function authMsg(e){
  var c=e&&e.code||"";
  if(c==="auth/wrong-password"||c==="auth/invalid-credential"||c==="auth/invalid-login-credentials"||c==="auth/user-not-found") return "Name or password isn't right";
  if(c==="auth/too-many-requests") return "Too many tries — wait a minute";
  if(c==="auth/weak-password") return "Password needs at least 6 characters";
  if(c==="auth/email-already-in-use") return "That account exists — enter its current password to change it";
  if(c==="auth/operation-not-allowed") return "Sign-in isn't enabled in Firebase yet";
  if(c==="auth/admin-restricted-operation") return "Firebase has account creation switched off — Authentication → Settings → User actions → Enable create, or add the user in the console";
  if(c==="auth/network-request-failed") return "Offline — try again";
  return (e&&e.message)||"Couldn't sign in";
}
