// Who a manager is: name and colour lookups, the sign-in address derived from the
// name, and who counts as an admin. Imports nothing.

export const AUTH_DOMAIN="smyrna.league";              // sign-in ids are <slug(name)>@smyrna.league; nobody sees them

/* ---- members and admins ---- */

export function member(id,members){
  members=members||[];
  for(var i=0;i<members.length;i++){ if(members[i].id===id) return members[i]; }
  return null; }

export function mName(id,members){ var m=member(id,members); return m?m.name:"Former manager"; }

export function mColor(id,members){ var m=member(id,members); return m?m.color:"var(--ink-3)"; }

export function slugName(n){ return String(n||"").toLowerCase().replace(/[^a-z0-9]/g,""); }

export function emailFor(m){ return slugName(m.name)+"@"+AUTH_DOMAIN; }

export function defaultPw(m){ return String(m.name||"")+"123!"; }

export function memberForEmail(email,members){
  email=String(email||"").toLowerCase();
  var hit=null; (members||[]).forEach(function(m){ if(!hit&&emailFor(m)===email) hit=m; });
  return hit;
}

export function adminEmails(config){ return (config&&Array.isArray(config.adminEmails))?config.adminEmails.map(function(e){ return String(e).toLowerCase(); }):[]; }

export function adminIds(config){ var members=config?config.members:[];
  return adminEmails(config).map(function(e){ var m=memberForEmail(e,members); return m?m.id:null; }).filter(Boolean); }

export function isAdminMember(id,config){ var m=member(id,config?config.members:[]); return !!m&&adminEmails(config).indexOf(emailFor(m))>=0; }
