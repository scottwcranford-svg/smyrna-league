// One tooltip for the whole app. The browser's own `title` box is drawn by the OS —
// system font, system colours, its own timing — so next to this app's dark cards it
// reads as something that leaked in from outside. This draws the same information in
// the app's own language.
//
// It lives on <body>, positioned fixed, rather than as a ::after inside the element:
// the season table sits in a horizontally scrolling wrapper, and a pseudo-element
// tooltip is clipped at that wrapper's edge, which is exactly where the drill-through
// hint appears.
//
// Anything with data-tip gets one, on hover and on keyboard focus. Elements that have
// no text of their own carry an aria-label as well — the tip itself is decoration and
// is hidden from assistive tech.

var el=null, target=null, hideTimer=null, showTimer=null;
var GAP=8, EDGE=8;
var DELAY=350;   // long enough not to flash while the pointer passes over on its way somewhere

function node(){
  if(el) return el;
  el=document.createElement("div");
  el.id="tip"; el.setAttribute("role","presentation"); el.setAttribute("aria-hidden","true");
  document.body.appendChild(el);
  return el;
}

// Above the target, or below it when there isn't room up there; never off the sides.
function place(t){
  var tip=node(), r=t.getBoundingClientRect();
  tip.style.left="0px"; tip.style.top="0px";   // measure unconstrained
  var w=tip.offsetWidth, h=tip.offsetHeight;
  var top=r.top-h-GAP, below=false;
  if(top<EDGE){ top=r.bottom+GAP; below=true; }
  var left=r.left+r.width/2-w/2;
  left=Math.max(EDGE,Math.min(left,window.innerWidth-w-EDGE));
  tip.style.left=Math.round(left)+"px";
  tip.style.top=Math.round(top)+"px";
  tip.classList.toggle("below",below);
}

export function showTip(t){
  var text=t&&t.getAttribute("data-tip");
  if(!text) return;
  target=t;
  var tip=node();
  tip.textContent=text;
  tip.classList.add("show");
  place(t);
}

export function hideTip(){
  clearTimeout(showTimer); clearTimeout(hideTimer);
  target=null;
  if(el) el.classList.remove("show");
}

function tipFor(e){
  var t=e.target;
  return t&&t.closest?t.closest("[data-tip]"):null;
}

export function bindTips(){
  // Pointer. Touch sends a synthetic mouseover on tap, so ignore anything that isn't
  // a real hover — a tooltip you have to tap to see is just a thing in the way.
  document.addEventListener("pointerover",function(e){
    if(e.pointerType!=="mouse") return;
    var t=tipFor(e); if(!t||t===target) return;
    clearTimeout(showTimer); clearTimeout(hideTimer);
    showTimer=setTimeout(function(){ showTip(t); },DELAY);
  });
  document.addEventListener("pointerout",function(e){
    if(e.pointerType!=="mouse") return;
    var t=tipFor(e); if(!t) return;
    clearTimeout(showTimer);
    hideTimer=setTimeout(hideTip,60);
  });
  // Keyboard: show straight away, and never on a plain mouse click's focus.
  document.addEventListener("focusin",function(e){
    var t=tipFor(e); if(!t) return;
    if(t.matches&&t.matches(":focus-visible")) showTip(t);
  });
  document.addEventListener("focusout",hideTip);
  // Anything that moves the page out from under it takes it away.
  document.addEventListener("pointerdown",hideTip);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape") hideTip(); });
  window.addEventListener("scroll",hideTip,true);
  window.addEventListener("resize",hideTip);
}

// A redraw can replace the element the tip is pointing at; if it's gone, so is the tip.
export function checkTip(){
  if(target&&!document.contains(target)) hideTip();
}
