// The shared book: Firestore behind the doc/collection shape the page has always
// used, plus the league passcode that opens it. This is the only module that talks
// to Firestore. `firebase` is the compat SDK loaded by index.html (vendor/).

export const KEY_LS="smyrna.sidebook.key.v1";

function ensureApp(){ if(!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG); }

// Called once at boot. Plain long-polling instead of Firestore's streaming channel:
// the stream is what Brave Shields, some ad blockers and some networks quietly break,
// leaving the book stuck at "Opening…". Long-polling costs a little latency and
// works everywhere.
export function initFirebase(){
  ensureApp();
  try{ firebase.firestore().settings({ experimentalForceLongPolling:true, merge:true }); }catch(e){}
}

// The book lives under books/<passcode>/…; Firestore's rules admit a path only if
// the passcode's gate exists, so the passcode is the door. `hooks.refresh(db, by,
// forced)` is what db.refresh() runs — the Sleeper pull, supplied by the caller so
// this module stays out of that business.
export function makeDb(key,hooks){
  ensureApp();
  hooks=hooks||{};
  var fs=firebase.firestore(), root=fs.collection("books").doc(key);
  var clean=function(o){ return JSON.parse(JSON.stringify(o===undefined?null:o)); };
  // Firestore forbids arrays inside arrays; the roster's [[id,name,pos,team]] rides as text.
  var toStore=function(path,d){ d=clean(d); if(path==="league/roster"&&d&&Array.isArray(d.players)){ d=Object.assign({},d,{ playersJson:JSON.stringify(d.players) }); delete d.players; } return d; };
  var fromStore=function(path,d){ if(d&&path==="league/roster"&&typeof d.playersJson==="string"){ d=Object.assign({},d); try{ d.players=JSON.parse(d.playersJson); }catch(e){ d.players=[]; } delete d.playersJson; } return d; };
  var ref=function(path){ var p=path.split("/"); return root.collection(p[0]).doc(p[1]); };
  var snap=function(path,s){ var d=s.exists?fromStore(path,s.data()):undefined; return { exists:s.exists, data:function(){ return d; } }; };
  return {
    key:key,
    doc:function(path){ var r=ref(path);
      return {
        get:function(){ return r.get().then(function(s){ return snap(path,s); }); },
        set:function(d){ return r.set(toStore(path,d)); },
        update:function(d){ return r.set(toStore(path,d),{ merge:true }); },
        delete:function(){ return r.delete(); },
        onSnapshot:function(fn,err){ return r.onSnapshot(function(s){ fn(snap(path,s)); },err||function(){}); },
        // a short lease on leases/<col>_<id>, taken in a transaction so two phones can't both win
        acquire:function(o){
          var lr=root.collection("leases").doc(path.replace("/","_")), holder=String(o&&o.holder||""), ttl=Math.min(Math.max(Number(o&&o.ttlMs)||5000,500),120000);
          return fs.runTransaction(function(tx){
            return tx.get(lr).then(function(s){
              var d=s.exists?s.data():null, now=Date.now();
              if(d&&d.until>now&&d.holder!==holder) return { acquired:false };
              tx.set(lr,{ holder:holder, until:now+ttl }); return { acquired:true };
            });
          });
        }
      }; },
    collection:function(name){ var c=root.collection(name);
      return { limit:function(){ return this; },
        onSnapshot:function(fn,err){ return c.onSnapshot(function(q){ fn({ docs:q.docs.map(function(d){ var v=fromStore(name+"/"+d.id,d.data()); return { id:d.id, data:function(){ return v; } }; }) }); },err||function(){}); } };
    },
    refresh:function(by){ return hooks.refresh?hooks.refresh(this,by,true):Promise.resolve(null); }
  };
}

// Take the named lease for ttl ms; false if someone else holds it (or the book is unreachable).
export function lease(db,name,ttl,holder){
  return db.doc("leases/"+name).acquire({ holder:holder, ttlMs:ttl }).then(function(r){ return r.acquired; }).catch(function(){ return false; });
}

// What to tell someone when a read or write is refused.
export function dbMsg(e){
  var c=e&&e.code;
  if(c==="permission-denied") return "The book refused this — wrong passcode, or you're not signed in";
  if(c==="resource-exhausted") return "Daily free quota hit — back after midnight Pacific";
  if(c==="unavailable") return "Offline — will retry";
  if(c==="quota_exceeded") return "The book is full — delete old bets";
  if(c==="resource_exhausted") return "Too fast — give it a second";
  if(c==="revoked"||c==="not_granted") return "Lost access to the book";
  if(c==="invalid_argument") return "That write was rejected";
  return "Couldn’t save — try again";
}

/* ---- the league passcode ----
   From the link (?key=…), else remembered on this device. It's checked against a
   tiny "gate" document the rules let anyone read with the right passcode — nothing
   else in the book is readable before sign-in. */
var memKey="";   // in-memory copy, so a browser that blocks storage still gets through this visit

export function setKey(k){ memKey=k; try{ localStorage.setItem(KEY_LS,k); }catch(e){} }

export function forgetKey(){ memKey=""; try{ localStorage.removeItem(KEY_LS); }catch(e){} }

export function storedKey(){
  var k=""; try{ k=new URLSearchParams(location.search).get("key")||""; }catch(e){}
  if(k){ setKey(k); try{ history.replaceState(null,"",location.pathname); }catch(e){} return k; }
  if(memKey) return memKey;
  try{ return localStorage.getItem(KEY_LS)||""; }catch(e){ return ""; }
}

export function tryKey(k){
  if(!/^[A-Za-z0-9_\-]{3,80}$/.test(k)) return Promise.resolve(false);
  ensureApp();
  return firebase.firestore().collection("books").doc(k).collection("league").doc("gate").get()
    .then(function(){ return true; }).catch(function(e){ return !(e&&e.code==="permission-denied"); });
}
