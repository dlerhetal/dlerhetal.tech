/* Swim-lane board shell. GENERATED from the local working page by the portal's build script; do not edit by hand.
   Generic: nothing in this file names a client or a person. The lanes, the steps, the hand-offs and every word
   on the page arrive from the API after sign-in. An editor (the consultant's browser, the same once-per-browser
   flag the other pages use) gets the editable board, saved to the API as append-only snapshots. Everyone else
   gets the same board read-only, the print controls, the info markers and one comment box. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var EDIT = !!R.DALE_MODE;
  var Q = TEST ? "?as=TEST" : "";
  var who = "";

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function fail(text) { var p = mk("p", "lfail", text); document.body.insertBefore(p, document.body.firstChild); }

  R.gate(function () {
    R.apiJSON("/lanes/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.content) throw new Error((d && d.error) || "The map could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The map could not be loaded."); });
  });

  function start(d) {
    var C = d.content;
    who = TEST ? "TEST" : (EDIT ? ((d.editors || [])[0] || "") : "");
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../assets/lanes.css";
    var go = function () {
      go = function () { };
      document.title = C.title || document.title;
      document.body.classList.add(EDIT ? "ed" : "ro");
      var holder = document.createElement("template");
      holder.innerHTML = C.body_html;
      document.body.insertBefore(holder.content, document.body.querySelector("script"));
      var nav = mk("div", "lnav");
      nav.appendChild(mk("span", "lmode", EDIT ? "Editing: changes save as you make them" : "Read only"));
      var home = mk("a", null, "Home"); home.href = "../"; nav.appendChild(home);
      var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
      document.body.insertBefore(nav, document.body.firstChild);
      var env = makeEnv(d);
      try { PAGE(C, d.board, env); } catch (e) { fail("The map could not be drawn: " + e.message); throw e; }
      if (EDIT) editorExtras(d, env); else { lockBoard(); viewerExtras(C); }
      document.body.setAttribute("data-lanes-ready", EDIT ? "edit" : "view");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- saving: every save is one more full snapshot on the server; nothing is overwritten ---------- */
  function makeEnv(d) {
    var timer = null, pending = null, busy = false, listeners = [];
    function note(text, bad) { var n = $("saveNote"); if (n) { n.textContent = text; n.style.color = bad ? "#b3261e" : ""; n.setAttribute("data-state", bad ? "bad" : "ok"); } }
    function flush() {
      clearTimeout(timer); timer = null;
      if (!pending || busy) return;
      var st = pending; pending = null; busy = true;
      var board = { steps: st.steps, handoffs: st.handoffs, text: st.text || {}, draftHash: st.draftHash || "" };
      fetch(R.API + "/lanes/save", { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + R.getToken() },
        body: JSON.stringify({ board: board, saved_by: who }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (x) {
          busy = false;
          if (x.s === 200 && x.j && x.j.ok) {
            note("Saved " + new Date().toLocaleTimeString() + ".");
            document.body.setAttribute("data-saved-id", String(x.j.saved.id));
            listeners.forEach(function (fn) { fn(x.j.saved); });
          } else if (x.s === 401) {
            note("Not saved: signed out. Reload the page and enter the password again.", true);
          } else {
            note("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)) + ". The change is still on this screen.", true);
          }
          if (pending) flush();
        })
        .catch(function () {
          busy = false; pending = pending || st;
          note("Not saved: the server could not be reached. The change is still on this screen and will be sent again shortly.", true);
          timer = setTimeout(flush, 5000);
        });
    }
    window.addEventListener("pagehide", function () { if (pending) flush(); });
    return {
      readonly: !EDIT,
      save: function (state) { if (!EDIT) return; pending = state; note("Saving..."); clearTimeout(timer); timer = setTimeout(flush, 900); },
      ready: function () {
        if (!EDIT) return;
        note(d.saved ? "This is the board saved " + R.fmtTs(d.saved.ts_utc) + ". Changes save as you make them." : "Changes save as you make them.");
      },
      onSaved: function (fn) { listeners.push(fn); },
      idle: function () { return !pending && !busy; }
    };
  }

  /* ---------- read only: no drag, no menus, no plus, no typing; the info markers and printing still work ---------- */
  function lockBoard() {
    function sweep() {
      each("#lanebody .noprint, #hoBody .noprint", function (n) { n.parentNode.removeChild(n); });
      each("#lanebody [draggable]", function (n) { n.setAttribute("draggable", "false"); });
      each("#hoBody [contenteditable]", function (n) { n.removeAttribute("contenteditable"); n.removeAttribute("role"); });
      each("#lanebody [title], #hoBody [title]", function (n) {
        if (n.classList.contains("infobtn")) return;
        var t = (n.getAttribute("title") || "").replace(/\s*Click to [a-z ]+\.?$/i, "").trim();
        if (t) { n.setAttribute("title", t); if (n.hasAttribute("aria-label")) n.setAttribute("aria-label", t); }
        else { n.removeAttribute("title"); n.removeAttribute("aria-label"); }
      });
    }
    function guard(e) {
      var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      if (!t || !t.closest("#lanes, #hoTable")) return;
      if (e.type === "click" && t.closest(".infobtn")) return;
      e.stopPropagation();
      if (e.type !== "click" || !t.closest("a")) e.preventDefault();
    }
    ["click", "dblclick", "dragstart", "drop"].forEach(function (type) { document.addEventListener(type, guard, true); });
    each("#questions textarea, #hoWhat", function (n) { n.readOnly = true; });
    each("main .noprint button, main .noprint select, main .noprint input", function (n) { n.disabled = true; });
    sweep();
    ["lanebody", "hoBody"].forEach(function (id) { var n = $(id); if (n) new MutationObserver(sweep).observe(n, { childList: true, subtree: true }); });
  }

  function addSection(id, heading) {
    var sec = mk("section", "box lrun"); sec.id = id;
    sec.appendChild(mk("h2", null, heading));
    var main = document.querySelector("main") || document.body, foot = main.querySelector("footer");
    if (foot && foot.parentNode === main) main.insertBefore(sec, foot); else main.appendChild(sec);
    return sec;
  }

  function viewerExtras(C) {
    var sec = addSection("lvComment", C.comment_label || "Say what is wrong");
    if (C.comment_help) sec.appendChild(mk("p", "lmsg", C.comment_help));
    var ta = mk("textarea"); ta.id = "lvCommentText"; ta.rows = 4; ta.setAttribute("aria-label", C.comment_label || "Comment");
    sec.appendChild(ta);
    var row = mk("div", "lrow"), b = mk("button", null, "Send"), msg = mk("span", "lmsg");
    b.type = "button"; b.id = "lvCommentSend"; msg.id = "lvCommentMsg";
    row.appendChild(b); row.appendChild(msg); sec.appendChild(row);
    b.addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text) { msg.className = "lmsg bad"; msg.textContent = "Type something first."; return; }
      b.disabled = true; msg.className = "lmsg"; msg.textContent = "Sending...";
      R.apiJSON("/lanes/comment", { method: "POST", json: { text: text, answered_by: TEST ? "TEST" : "" } }).then(function (j) {
        b.disabled = false;
        if (j && j.ok) { ta.value = ""; msg.className = "lmsg"; msg.textContent = "Sent " + new Date().toLocaleTimeString() + ". Thank you."; }
        else { msg.className = "lmsg bad"; msg.textContent = "Not sent: " + ((j && j.error) || "please try again") + "."; }
      }).catch(function () { b.disabled = false; msg.className = "lmsg bad"; msg.textContent = "Not sent: the server could not be reached. Your words are still in the box."; });
    });
  }

  /* ---------- the editor's extras: earlier versions (append-only), and the comments received ---------- */
  function editorExtras(d, env) {
    var vs = addSection("lvVersions", "Earlier versions");
    vs.appendChild(mk("p", "lmsg", "Every save is kept. Making an earlier version current adds it again as the newest one; nothing is deleted."));
    var vmsg = mk("p", "lmsg"); vmsg.id = "lvVersionMsg"; vs.appendChild(vmsg);
    var vlist = mk("ul"); vlist.id = "lvVersionList"; vs.appendChild(vlist);
    var cs = addSection("lvComments", "Comments received");
    var clist = mk("ul"); clist.id = "lvCommentList"; cs.appendChild(clist);
    var refreshTimer = null;

    function restore(v, b) {
      if (!env.idle()) { vmsg.className = "lmsg bad"; vmsg.textContent = "A change is still being saved. Try again in a moment."; return; }
      b.disabled = true; vmsg.className = "lmsg"; vmsg.textContent = "Making version " + v.id + " the current board...";
      R.apiJSON("/lanes/history?id=" + v.id).then(function (h) {
        if (!h || !h.ok || !h.board) throw new Error((h && h.error) || "that version could not be read");
        return R.apiJSON("/lanes/save", { method: "POST", json: { board: h.board, saved_by: who, note: "Restored version " + v.id } });
      }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "the server did not save it");
        location.reload();
      }).catch(function (e) { b.disabled = false; vmsg.className = "lmsg bad"; vmsg.textContent = "Not done: " + e.message + "."; });
    }
    function draw(h) {
      var snaps = (h.snapshots || []).filter(function (s) { return TEST || s.saved_by !== "TEST"; });
      vlist.textContent = "";
      vlist.setAttribute("data-count", String(snaps.length));
      if (!snaps.length) vlist.appendChild(mk("li", null, "Nothing has been saved yet. This is the draft."));
      snaps.slice(0, 20).forEach(function (v, i) {
        var li = mk("li"); li.setAttribute("data-version", String(v.id));
        li.appendChild(mk("b", null, "Version " + v.id + (i === 0 ? " (current)" : "")));
        li.appendChild(mk("span", "lmeta", R.fmtTs(v.ts_utc) + ", " + v.saved_by + ", " + v.steps + " steps, " + v.handoffs + " hand-offs" + (v.note ? ". " + v.note : "")));
        if (i > 0) {
          var b = mk("button", "lvRestore", "Make this the current board"); b.type = "button";
          var armed = false, t = null;
          b.addEventListener("click", function () {
            if (armed) { clearTimeout(t); restore(v, b); return; }
            armed = true; b.textContent = "Click again to make version " + v.id + " current";
            t = setTimeout(function () { armed = false; b.textContent = "Make this the current board"; }, 6000);
          });
          li.appendChild(b);
        }
        vlist.appendChild(li);
      });
      if (snaps.length > 20) vlist.appendChild(mk("li", "lmeta", "Showing the newest 20 of " + snaps.length + "."));
      var comments = (h.comments || []).filter(function (c) { return TEST || c.answered_by !== "TEST"; });
      clist.textContent = "";
      clist.setAttribute("data-count", String(comments.length));
      if (!comments.length) clist.appendChild(mk("li", null, "No comments yet."));
      comments.forEach(function (c) {
        var li = mk("li");
        li.appendChild(mk("span", "lmeta", R.fmtTs(c.ts_utc) + ", " + c.answered_by));
        li.appendChild(mk("span", "ltext", c.text));
        clist.appendChild(li);
      });
    }
    function refresh() { R.apiJSON("/lanes/history").then(function (h) { if (h && h.ok) draw(h); }).catch(function () { }); }
    env.onSaved(function () { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 400); });
    refresh();
  }

  /* ---------- the page's own script, carried over by the build rules ---------- */
  function PAGE(CONTENT, SAVED, ENV){
  "use strict";

  var LANES = CONTENT.lanes, PHASES = CONTENT.phases, STEPS = CONTENT.steps, HANDOFFS = CONTENT.handoffs,
      FOCUS_LANE = CONTENT.focus_lane || (CONTENT.lanes[0] || {}).key;

  var KIND_LABEL = { standing: "Standing", ongoing: "Ongoing" };
  var KIND_WORD = { step: "Numbered", standing: "Standing", ongoing: "Ongoing" };
  var KINDS = ["step", "standing", "ongoing"];
  var STATUS = {
    green: { word: "Green", means: "both sides know exactly how it is handed over", brief: "both know how" },
    amber: { word: "Amber", means: "it happens, but informally", brief: "informal" },
    red:   { word: "Red",   means: "nobody is named, or nobody knows how", brief: "no one named" }
  };
  var STATUS_ORDER = ["green", "amber", "red"];


  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(cls, text, title){
    var b = el("button", cls, text);
    b.type = "button";
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    return b;
  }
  function dom(id){ return document.getElementById(id); }
  function up(node, sel){
    if (node && node.nodeType !== 1) node = node.parentElement;
    return node && node.closest ? node.closest(sel) : null;
  }
  function laneOf(key){ return LANES.filter(function(l){ return l.key === key; })[0] || LANES[0]; }
  function phaseOf(key){ return PHASES.filter(function(p){ return p.key === key; })[0] || PHASES[0]; }
  function clean(text){ return String(text).replace(/\s+/g, " ").trim(); }
  function hash(str){ var h = 5381; for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; } return String(h); }


  var DRAFT_HASH = hash(JSON.stringify([STEPS, HANDOFFS]));
  var state = null;
  var ui = { renaming: null, editingInfo: null, openMenu: null, openInfo: {}, dragId: null };
  var numbers = {}, phaseCount = {}, boxCount = {}, newCount = 0;

  function draftBoard(){
    var rank = {};
    PHASES.forEach(function(p, i){ rank[p.key] = i; });
    var rows = STEPS.map(function(s, i){
      var who = s.whoNote ? (s.whoNote.charAt(0).toUpperCase() + s.whoNote.slice(1) + ".") : "";
      return { i: i, seq: s.sequence, step: { id: s.id, phase: s.phase, lane: s.lane, kind: s.kind, name: s.name, starred: !!s.starred,
        info: [who, s.info, s.note].filter(Boolean).join(" "), removed: false } };
    });
    rows.sort(function(a, b){
      if (rank[a.step.phase] !== rank[b.step.phase]) return rank[a.step.phase] - rank[b.step.phase];
      var an = a.seq === null, bn = b.seq === null;
      if (an !== bn) return an ? 1 : -1;
      if (!an && a.seq !== b.seq) return a.seq - b.seq;
      return a.i - b.i;
    });
    return {
      steps: rows.map(function(r){ return r.step; }),
      handoffs: HANDOFFS.map(function(h){ return { id: h.id, number: h.number, what: h.what, from: h.from, to: h.to, how: h.how, status: h.status }; })
    };
  }
  function loadState(){
    var saved = SAVED;
    if (saved && Array.isArray(saved.steps) && Array.isArray(saved.handoffs)) {
      saved = JSON.parse(JSON.stringify(saved));
      saved.steps.forEach(function(s){ s.lane = laneOf(s.lane).key; s.phase = phaseOf(s.phase).key; if (KINDS.indexOf(s.kind) < 0) s.kind = "step"; });
      saved.text = saved.text || {};
      return saved;
    }
    var d = draftBoard();
    return { steps: d.steps, handoffs: d.handoffs, draftHash: DRAFT_HASH, text: {} };
  }
  function save(){ ENV.save(state); }
  function stepById(id){ for (var i = 0; i < state.steps.length; i++) { if (state.steps[i].id === id) return state.steps[i]; } return null; }
  function computeNumbers(){

    numbers = {}; phaseCount = {};
    var cellCount = boxCount = {};
    PHASES.forEach(function(p){ phaseCount[p.key] = 0; });
    state.steps.forEach(function(s){
      if (s.removed || s.kind !== "step") return;
      phaseCount[s.phase] += 1;
      var k = s.phase + "|" + s.lane;
      cellCount[k] = (cellCount[k] || 0) + 1;
      numbers[s.id] = cellCount[k];
    });
  }
  function live(){ return state.steps.filter(function(s){ return !s.removed; }); }
  function cellSteps(phaseKey, laneKey){
    var mine = live().filter(function(s){ return s.phase === phaseKey && s.lane === laneKey; });
    return mine.filter(function(s){ return s.kind === "step"; }).concat(mine.filter(function(s){ return s.kind !== "step"; }));
  }


  function hoGone(h){ var a = stepById(h.from), b = stepById(h.to); return !a || !b || a.removed || b.removed; }
  function effStatus(h){ return hoGone(h) ? "red" : h.status; }
  function handoffsFor(stepId){
    var out = [];
    state.handoffs.forEach(function(h){
      if (h.from === stepId) out.push({ h: h, dir: "out" });
      if (h.to === stepId) out.push({ h: h, dir: "in" });
    });
    return out;
  }
  function diamondTitle(h, dir){
    var st = effStatus(h);
    return "H" + h.number + (dir === "out" ? " given here: " : dir === "in" ? " received here: " : ": ") + h.what + ". " +
      (hoGone(h) ? "Red: step removed." : STATUS[st].word + ": " + STATUS[st].means + ". Click to change the status.");
  }
  function diamondShape(label, dir){
    var frag = document.createDocumentFragment();
    var d = el("span", "dia" + (label.length > 2 ? " wide" : "") + (label ? "" : " bare"), label);
    var a = el("span", "arr");
    a.appendChild(el("i", "stem")); a.appendChild(el("i", "head"));
    if (dir === "in") { frag.appendChild(a); frag.appendChild(d); }
    else if (dir === "out") { frag.appendChild(d); frag.appendChild(a); }
    else frag.appendChild(d);
    return frag;
  }
  function diamond(h, dir){
    var b = btn("ho", null, diamondTitle(h, dir));
    b.setAttribute("data-ho", h.id);
    b.setAttribute("data-dir", dir);
    b.setAttribute("data-status", effStatus(h));
    b.appendChild(diamondShape("H" + h.number, dir));
    b.addEventListener("click", function(e){ e.stopPropagation(); cycleStatus(h); });
    return b;
  }
  function cycleStatus(h){
    if (hoGone(h)) return;
    h.status = STATUS_ORDER[(STATUS_ORDER.indexOf(h.status) + 1) % STATUS_ORDER.length];
    commit();
  }


  function commit(){ save(); render(); }
  function moveStep(id, targetId, laneKey, phaseKey){
    var s = stepById(id), t = targetId ? stepById(targetId) : null;
    if (!s) return;
    var arr = state.steps;
    arr.splice(arr.indexOf(s), 1);
    if (t) { s.lane = t.lane; s.phase = t.phase; arr.splice(arr.indexOf(t), 0, s); }
    else { s.lane = laneKey; s.phase = phaseKey; arr.push(s); }
    commit();
  }
  function nudge(s, dir){
    var list = state.steps.filter(function(x){ return !x.removed && x.kind === "step" && x.phase === s.phase && x.lane === s.lane; });
    var other = list[list.indexOf(s) + dir];
    if (!other) return;
    var a = state.steps.indexOf(s), b = state.steps.indexOf(other);
    state.steps[a] = other; state.steps[b] = s;
    commit();
  }
  function addStep(phaseKey, laneKey){
    newCount += 1;
    var s = { id: "new" + Date.now().toString(36) + newCount, phase: phaseKey, lane: laneKey, kind: "step", name: "New step", starred: false, info: "", removed: false };
    state.steps.push(s);
    ui.renaming = s.id;
    commit();
  }
  function finishRename(s, value, keep){
    if (ui.renaming === s.id) ui.renaming = null;
    var v = clean(value);
    if (keep && v && v !== s.name) { s.name = v; save(); renderHandoffs(); }
    refreshCard(s.id);
  }


  function card(s){
    var renaming = ui.renaming === s.id, editing = ui.editingInfo === s.id;
    var c = el("div", "card" + (s.starred ? " starred" : "") + (s.kind !== "step" ? " standing" : ""));
    c.draggable = !(renaming || editing);
    c.setAttribute("data-id", s.id);
    c.setAttribute("data-phase", s.phase);
    c.setAttribute("data-lane", s.lane);
    c.setAttribute("data-kind", s.kind);
    c.setAttribute("data-seq", s.kind === "step" ? String(numbers[s.id]) : "");
    c.setAttribute("data-name", s.name);
    c.setAttribute("data-starred", s.starred ? "1" : "0");
    if (s.kind === "step") c.appendChild(el("span", "num", String(numbers[s.id])));
    else c.appendChild(el("span", "tag", KIND_LABEL[s.kind]));

    var body = el("div", "body");
    var nm = el("div", "nm");
    if (renaming) {
      var inp = el("input", "rename");
      inp.type = "text"; inp.value = s.name;
      inp.setAttribute("aria-label", "Step name");
      var done = false;
      inp.addEventListener("keydown", function(e){
        if (e.key === "Enter") { e.preventDefault(); done = true; finishRename(s, inp.value, true); }
        else if (e.key === "Escape") { e.preventDefault(); done = true; finishRename(s, inp.value, false); }
      });
      inp.addEventListener("blur", function(){ if (!done) { done = true; finishRename(s, inp.value, true); } });
      nm.appendChild(inp);
    } else {
      var t = el("span", "nmtext", s.name);
      t.title = "Click to rename";
      t.addEventListener("click", function(){ ui.renaming = s.id; refreshCard(s.id); });
      nm.appendChild(t);
      if (s.starred) { nm.appendChild(document.createTextNode("\u00A0")); nm.appendChild(el("span", "star", "*")); }
    }
    handoffsFor(s.id).forEach(function(x){
      nm.appendChild(document.createTextNode(" "));
      nm.appendChild(diamond(x.h, x.dir));
    });
    body.appendChild(nm);


    if (s.info || editing) {
      var ib = btn("infobtn", "i", "More about this step");
      var ip = el("div", "infotext");
      if (editing) {
        var ta = el("textarea");
        ta.rows = 4; ta.value = s.info;
        ta.setAttribute("aria-label", "Info for this step");
        ta.addEventListener("input", function(){ s.info = ta.value; save(); });
        ip.appendChild(ta);
        var ok = btn(null, "Done");
        ok.addEventListener("click", function(){ s.info = clean(s.info); ui.editingInfo = null; ui.openInfo[s.id] = !!s.info; commit(); });
        ip.appendChild(ok);
      } else {
        ip.appendChild(document.createTextNode(s.info));
        var ed = btn("noprint", "Edit");
        ed.addEventListener("click", function(){ ui.editingInfo = s.id; refreshCard(s.id); });
        ip.appendChild(ed);
      }
      ip.hidden = !(editing || ui.openInfo[s.id]);
      ib.addEventListener("click", function(){ ui.openInfo[s.id] = ip.hidden; ip.hidden = !ip.hidden; });
      nm.appendChild(document.createTextNode(" "));
      nm.appendChild(ib);
      body.appendChild(ip);
    }
    if (ui.openMenu === s.id) body.appendChild(menu(s));
    c.appendChild(body);
    c.appendChild(tools(s));
    return c;
  }
  function tools(s){
    var t = el("div", "tools noprint");
    if (s.kind === "step") {
      var ar = el("div", "arrows");
      var a = btn("earlier", "▲", "Earlier in this phase");
      a.disabled = numbers[s.id] <= 1;
      a.addEventListener("click", function(){ nudge(s, -1); });
      var b = btn("later", "▼", "Later in this phase");
      b.disabled = numbers[s.id] >= (boxCount[s.phase + "|" + s.lane] || 0);
      b.addEventListener("click", function(){ nudge(s, 1); });
      ar.appendChild(a); ar.appendChild(b);
      t.appendChild(ar);
    }
    var m = btn("menubtn" + (ui.openMenu === s.id ? " on" : ""), "⋯", "Card menu");
    m.addEventListener("click", function(){
      var was = ui.openMenu;
      ui.openMenu = was === s.id ? null : s.id;
      if (was && was !== s.id) refreshCard(was);
      refreshCard(s.id);
    });
    t.appendChild(m);
    return t;
  }
  function menu(s){
    var m = el("div", "menu noprint");
    var st = btn("mstar" + (s.starred ? " on" : ""), s.starred ? "Asterisk: on" : "Asterisk: off", "Others could do this");
    st.addEventListener("click", function(){ s.starred = !s.starred; commit(); });
    m.appendChild(st);
    var ks = el("span", "kinds");
    KINDS.forEach(function(k){
      var kb = btn("mkind" + (s.kind === k ? " on" : ""), KIND_WORD[k]);
      kb.setAttribute("data-kind", k);
      kb.addEventListener("click", function(){ s.kind = k; commit(); });
      ks.appendChild(kb);
    });
    m.appendChild(ks);
    var inf = btn("minfo", s.info ? "Edit info" : "Add info");
    inf.addEventListener("click", function(){ ui.editingInfo = s.id; refreshCard(s.id); var ta = cardEl(s.id); ta = ta && ta.querySelector(".infotext textarea"); if (ta) ta.focus(); });
    m.appendChild(inf);
    var rm = btn("mremove danger", "Remove");
    rm.addEventListener("click", function(){ s.removed = true; ui.openMenu = null; if (ui.editingInfo === s.id) ui.editingInfo = null; commit(); });
    m.appendChild(rm);
    return m;
  }
  function cardEl(id){
    var all = dom("lanebody").querySelectorAll(".card");
    for (var i = 0; i < all.length; i++) { if (all[i].getAttribute("data-id") === id) return all[i]; }
    return null;
  }
  function refreshCard(id){
    var old = cardEl(id), s = stepById(id);
    if (!old || !s || s.removed) return;
    old.replaceWith(card(s));
    focusRename();
  }
  function focusRename(){
    if (!ui.renaming) return;
    var c = cardEl(ui.renaming), inp = c && c.querySelector("input.rename");
    if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); }
  }


  function renderTally(){
    var all = live();
    var num = all.filter(function(s){ return s.kind === "step"; });
    var extras = all.length - num.length;
    var rows = LANES.map(function(l){
      var mine = all.filter(function(s){ return s.lane === l.key; });
      var steps = mine.filter(function(s){ return s.kind === "step"; });
      return { lane: l, count: steps.length, starred: steps.filter(function(s){ return s.starred; }).length, extras: mine.length - steps.length };
    });
    var max = Math.max.apply(null, rows.map(function(r){ return r.count; })) || 1;
    var focus = rows.filter(function(r){ return r.lane.key === FOCUS_LANE; })[0] || rows[0];

    var sum = dom("tallySummary");
    sum.textContent = "";
    sum.setAttribute("data-total", String(num.length));
    sum.setAttribute("data-extras", String(extras));
    sum.setAttribute("data-focus-starred", String(focus.starred));
    sum.appendChild(el("b", null, num.length + " numbered steps"));
    sum.appendChild(document.createTextNode(" across " + PHASES.length + " phases, plus " + extras + " standing or ongoing items outside the numbered flow. "));
    sum.appendChild(el("b", null, focus.starred + " of " + focus.lane.label + "'s " + focus.count + " steps carry an asterisk"));
    sum.appendChild(document.createTextNode(" (others could do this)."));

    var by = { green: 0, amber: 0, red: 0 };
    state.handoffs.forEach(function(h){ by[effStatus(h)] += 1; });
    var hp = dom("tallyHandoffs");
    hp.textContent = "";
    hp.setAttribute("data-total", String(state.handoffs.length));
    hp.setAttribute("data-red", String(by.red));
    hp.setAttribute("data-amber", String(by.amber));
    hp.setAttribute("data-green", String(by.green));
    hp.appendChild(el("b", null, state.handoffs.length + (state.handoffs.length === 1 ? " hand-off" : " hand-offs") + " between lanes"));
    hp.appendChild(document.createTextNode(": " + by.red + " red, " + by.amber + " amber, " + by.green + " green."));

    var host = dom("tallyBars");
    host.textContent = "";
    rows.forEach(function(r){
      var row = el("div", "tallyrow");
      row.setAttribute("data-lane", r.lane.key);
      row.setAttribute("data-count", String(r.count));
      row.setAttribute("data-starred", String(r.starred));
      row.setAttribute("data-extras", String(r.extras));
      row.appendChild(el("div", "tallyname", r.lane.label));
      var track = el("div", "track");
      var bar = el("div", "bar");
      bar.style.width = (r.count / max * 62) + "%";
      if (r.count - r.starred > 0) { var p = el("div", "seg plain"); p.style.flex = String(r.count - r.starred); bar.appendChild(p); }
      if (r.starred > 0) { var g = el("div", "seg star"); g.style.flex = String(r.starred); bar.appendChild(g); }
      track.appendChild(bar);
      var txt = r.count + (r.count === 1 ? " step" : " steps");
      if (r.starred > 0) txt += ", " + r.starred + " with an asterisk";
      if (r.extras > 0) txt += " (plus " + r.extras + " standing or ongoing)";
      track.appendChild(el("div", "tallytext", txt));
      row.appendChild(track);
      host.appendChild(row);
    });
  }


  function buildLegends(){
    var host = dom("legend");
    function item(where, node, text){ var i = el("div", "item"); i.appendChild(node); i.appendChild(el("span", null, text)); where.appendChild(i); }
    var a = el("div", "card"); a.appendChild(el("span", "num", "1")); a.appendChild(el("div", "nm", "Step"));
    item(host, a, "done by the lane it sits in");
    var b = el("div", "card starred"); b.appendChild(el("span", "num", "2"));
    var bn = el("div", "nm", "Step "); bn.appendChild(el("span", "star", "*")); b.appendChild(bn);
    item(host, b, "asterisk: others could do this");
    var c = el("div", "card standing"); c.appendChild(el("span", "tag", "Standing")); c.appendChild(el("div", "nm", "Work"));
    item(host, c, "standing or ongoing work, not in the numbered order");
    function sample(dir, status){ var s = el("span", "ho static"); s.setAttribute("data-status", status); s.appendChild(diamondShape("H1", dir)); return s; }
    var pair = el("span"); pair.appendChild(sample("out", "amber")); pair.appendChild(document.createTextNode(" ")); pair.appendChild(sample("in", "amber"));
    item(host, pair, "hand-off: gives it, receives it (same number)");

    var hl = dom("hoLegend");
    item(hl, sample("out", "amber"), "on the giving card");
    item(hl, sample("in", "amber"), "on the receiving card");
    STATUS_ORDER.forEach(function(k){ item(hl, sample("", k), STATUS[k].word.toLowerCase() + ": " + STATUS[k].means); });


    var pl = dom("printLegend");
    var ps = el("div", "card starred"); ps.appendChild(el("span", "num", "1"));
    var pn = el("div", "nm"); pn.appendChild(el("span", "star", "*")); ps.appendChild(pn);
    item(pl, ps, "others could do this");
    var pd = el("div", "card standing"); pd.appendChild(el("span", "tag", "Standing"));
    item(pl, pd, "or Ongoing: unnumbered");
    var pp = el("span"); pp.appendChild(sample("out", "amber")); pp.appendChild(document.createTextNode(" ")); pp.appendChild(sample("in", "amber"));
    item(pl, pp, "hand-off out, in");
    STATUS_ORDER.forEach(function(k){ var b = el("span", "ho static"); b.setAttribute("data-status", k); b.appendChild(diamondShape("", "")); item(pl, b, STATUS[k].brief); });
  }


  function buildCols(){
    var cols = dom("cols");
    cols.appendChild(el("col", "lanecol"));
    PHASES.forEach(function(){ cols.appendChild(el("col")); });
  }
  function renderGrid(){
    var head = dom("headrow");
    head.textContent = "";
    head.appendChild(el("th", "corner", "Lane"));
    PHASES.forEach(function(p, i){
      var th = el("th", null, (i + 1) + ". " + p.label);
      th.setAttribute("data-phase", p.key);
      th.setAttribute("data-count", String(phaseCount[p.key]));
      th.appendChild(el("small", null, phaseCount[p.key] + " numbered steps"));
      head.appendChild(th);
    });

    var body = dom("lanebody");
    body.textContent = "";
    LANES.forEach(function(l){
      var tr = el("tr");
      var th = el("th", "lane", l.label);
      th.setAttribute("scope", "row");
      th.appendChild(el("small", null, l.sub));
      tr.appendChild(th);
      PHASES.forEach(function(p){
        var td = el("td", "cell");
        td.setAttribute("data-phase", p.key);
        td.setAttribute("data-lane", l.key);
        cellSteps(p.key, l.key).forEach(function(s){ td.appendChild(card(s)); });
        var add = btn("addbtn noprint", "+", "Add a step here");
        add.addEventListener("click", function(){ addStep(p.key, l.key); });
        td.appendChild(add);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    var wr = el("tr", "wrongrow");
    var wh = el("th", "lane", "What goes wrong");
    wh.setAttribute("scope", "row");
    wh.appendChild(el("small", null, "Yellow stickies. Uncovering these costs is the job."));
    wr.appendChild(wh);
    PHASES.forEach(function(p){
      var td = el("td", "wrongcell");
      td.setAttribute("data-phase", p.key);
      if (!p.wrong.length) td.appendChild(el("div", "nowrong", "No yellow stickies on the board for this phase."));
      p.wrong.forEach(function(w){
        var d = el("div", "wrong");
        d.appendChild(el("b", null, w));
        d.appendChild(el("span", null, CONTENT.cost_unknown));
        td.appendChild(d);
      });
      wr.appendChild(td);
    });
    body.appendChild(wr);
  }


  function renderTray(){
    var host = dom("tray");
    var gone = state.steps.filter(function(s){ return s.removed; });
    host.textContent = "";
    host.setAttribute("data-count", String(gone.length));
    host.appendChild(el("b", null, "Removed (" + gone.length + ")"));
    if (!gone.length) { host.appendChild(document.createTextNode(" Nothing removed. A removed card waits here and can be put back.")); return; }
    host.appendChild(document.createTextNode(" "));
    gone.forEach(function(s){
      var item = el("span", "trayitem");
      item.setAttribute("data-id", s.id);
      item.setAttribute("data-name", s.name);
      item.appendChild(el("span", null, s.name + (s.starred ? " *" : "") + " (" + phaseOf(s.phase).label + ", " + laneOf(s.lane).label + ")"));
      var b = btn("putback", "Put back");
      b.addEventListener("click", function(){ s.removed = false; commit(); });
      item.appendChild(b);
      host.appendChild(item);
    });
  }


  function whereCell(td, stepId){
    var s = stepById(stepId);
    if (!s) { td.appendChild(el("span", "gone", "step removed")); return; }
    td.appendChild(el("b", null, laneOf(s.lane).label));
    td.appendChild(document.createTextNode(": " + s.name));
    if (s.removed) td.appendChild(el("span", "gone", "step removed"));
    else td.appendChild(el("small", null, phaseOf(s.phase).label + (s.kind === "step" ? ", step " + numbers[s.id] : ", " + KIND_LABEL[s.kind].toLowerCase())));
  }
  function editable(h, field, label){
    var s = el("span", "edit", h[field]);
    s.setAttribute("contenteditable", "plaintext-only");
    s.setAttribute("role", "textbox");
    s.setAttribute("aria-label", label);
    s.setAttribute("data-field", field);
    s.addEventListener("keydown", function(e){
      if (e.key === "Enter") { e.preventDefault(); s.blur(); }
      else if (e.key === "Escape") { s.textContent = h[field]; s.blur(); }
    });
    s.addEventListener("blur", function(){
      var v = clean(s.textContent);
      if (v && v !== h[field]) {
        h[field] = v; save();
        Array.prototype.forEach.call(document.querySelectorAll("#lanebody .ho"), function(b){
          if (b.getAttribute("data-ho") === h.id) b.title = diamondTitle(h, b.getAttribute("data-dir"));
        });
      }
      s.textContent = h[field];
    });
    return s;
  }
  function twoClick(b, armedLabel, fn){
    var label = b.textContent, timer = null;
    b.addEventListener("click", function(){
      if (b.classList.contains("armed")) { clearTimeout(timer); b.classList.remove("armed"); b.textContent = label; fn(); return; }
      b.classList.add("armed"); b.textContent = armedLabel;
      timer = setTimeout(function(){ b.classList.remove("armed"); b.textContent = label; }, 6000);
    });
  }
  function fillSelect(sel){
    var keep = sel.value;
    sel.textContent = "";
    var first = el("option", null, "Pick a card"); first.value = ""; sel.appendChild(first);
    PHASES.forEach(function(p){
      var g = document.createElement("optgroup");
      g.label = p.label;
      var inPhase = live().filter(function(s){ return s.phase === p.key; });
      inPhase.filter(function(s){ return s.kind === "step"; }).concat(inPhase.filter(function(s){ return s.kind !== "step"; })).forEach(function(s){
        var o = el("option", null, (s.kind === "step" ? numbers[s.id] + ". " : KIND_LABEL[s.kind] + ": ") + s.name + " (" + laneOf(s.lane).label + ")");
        o.value = s.id;
        g.appendChild(o);
      });
      if (g.children.length) sel.appendChild(g);
    });
    sel.value = keep;
    if (sel.value !== keep) sel.value = "";
  }
  function renderHandoffs(){
    var body = dom("hoBody");
    body.textContent = "";
    if (!state.handoffs.length) {
      var etr = el("tr"), etd = el("td", null, "No hand-offs on the board yet.");
      etd.colSpan = 7; etr.appendChild(etd); body.appendChild(etr);
    }
    state.handoffs.forEach(function(h){
      var st = effStatus(h), gone = hoGone(h);
      var tr = el("tr");
      tr.setAttribute("data-ho", h.id);
      tr.setAttribute("data-status", st);
      tr.setAttribute("data-gone", gone ? "1" : "0");
      var c0 = el("td");
      var d = el("span", "ho static"); d.setAttribute("data-status", st); d.appendChild(diamondShape("H" + h.number, ""));
      c0.appendChild(d); tr.appendChild(c0);
      var c1 = el("td"); c1.appendChild(editable(h, "what", "What is handed over")); tr.appendChild(c1);
      var c2 = el("td", "from"); whereCell(c2, h.from); tr.appendChild(c2);
      var c3 = el("td", "to"); whereCell(c3, h.to); tr.appendChild(c3);
      var c4 = el("td"); c4.appendChild(editable(h, "how", "How it travels")); tr.appendChild(c4);
      var c5 = el("td");
      var sb = btn("statusbtn", gone ? "Red: step removed" : STATUS[st].word + ": " + STATUS[st].means, gone ? "Put the step back to set a status" : "Click to change the status");
      sb.setAttribute("data-status", st);
      sb.addEventListener("click", function(){ cycleStatus(h); });
      c5.appendChild(sb); tr.appendChild(c5);
      var c6 = el("td", "noprint");
      var rm = btn("horemove", "Remove");
      twoClick(rm, "Click again to remove", function(){ state.handoffs.splice(state.handoffs.indexOf(h), 1); commit(); });
      c6.appendChild(rm); tr.appendChild(c6);
      body.appendChild(tr);
    });
    fillSelect(dom("hoFrom"));
    fillSelect(dom("hoTo"));
  }


  function render(){
    computeNumbers();
    renderTally();
    renderGrid();
    renderTray();
    renderHandoffs();
    dom("staleNote").hidden = state.draftHash === DRAFT_HASH;
    focusRename();
  }


  var lanebody = dom("lanebody"), marked = null, markedCell = null;
  function clearMarks(){
    if (marked) marked.classList.remove("dropbefore");
    if (markedCell) markedCell.classList.remove("dropcell");
    marked = null; markedCell = null;
  }
  function dropTarget(e){
    var cell = up(e.target, "td.cell");
    if (!cell) return null;
    var c = up(e.target, ".card");
    return { cell: cell, card: c && c.getAttribute("data-id") !== ui.dragId ? c : null, self: !!c && c.getAttribute("data-id") === ui.dragId };
  }
  lanebody.addEventListener("dragstart", function(e){
    var c = up(e.target, ".card");
    if (!c || !c.draggable) return;
    ui.dragId = c.getAttribute("data-id");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", ui.dragId); } catch(x) {}
    setTimeout(function(){ c.classList.add("dragging"); }, 0);
  });
  lanebody.addEventListener("dragover", function(e){
    if (!ui.dragId) return;
    var t = dropTarget(e);
    clearMarks();
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (t.card) { marked = t.card; marked.classList.add("dropbefore"); }
    else if (!t.self) { markedCell = t.cell; markedCell.classList.add("dropcell"); }
  });
  lanebody.addEventListener("drop", function(e){
    if (!ui.dragId) return;
    var t = dropTarget(e), id = ui.dragId;
    ui.dragId = null;
    clearMarks();
    if (!t) return;
    e.preventDefault();
    if (t.self) { render(); return; }
    moveStep(id, t.card ? t.card.getAttribute("data-id") : null, t.cell.getAttribute("data-lane"), t.cell.getAttribute("data-phase"));
  });

  document.addEventListener("dragover", function(e){
    if (!ui.dragId) return;
    if (e.clientY < 90) window.scrollBy(0, -24);
    else if (e.clientY > window.innerHeight - 150) window.scrollBy(0, 24);
  });
  document.addEventListener("dragend", function(){
    ui.dragId = null;
    clearMarks();
    Array.prototype.forEach.call(document.querySelectorAll(".card.dragging"), function(c){ c.classList.remove("dragging"); });
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && ui.openMenu && !ui.renaming) { var was = ui.openMenu; ui.openMenu = null; refreshCard(was); }
  });


  dom("hoAddBtn").addEventListener("click", function(){
    var f = dom("hoFrom").value, t = dom("hoTo").value, w = clean(dom("hoWhat").value), msg = dom("hoMsg");
    if (!f || !t) { msg.textContent = "Pick the giving card and the receiving card."; return; }
    if (f === t) { msg.textContent = "The giving card and the receiving card must be different."; return; }
    if (!w) { msg.textContent = "Type what is handed over."; return; }
    var max = 0;
    state.handoffs.forEach(function(h){ if (h.number > max) max = h.number; });
    state.handoffs.push({ id: "h" + (max + 1), number: max + 1, what: w, from: f, to: t, how: CONTENT.unknown_how, status: "red" });
    dom("hoWhat").value = ""; dom("hoFrom").value = ""; dom("hoTo").value = "";
    msg.textContent = "Added H" + (max + 1) + ". It starts red until the how is known.";
    commit();
  });


  twoClick(dom("resetBoard"), "Click again to drop my board changes", function(){
    var d = draftBoard();
    state.steps = d.steps; state.handoffs = d.handoffs; state.draftHash = DRAFT_HASH;
    ui = { renaming: null, editingInfo: null, openMenu: null, openInfo: {}, dragId: null };
    commit();
  });


  function exportSteps(){
    return state.steps.map(function(s){
      return { id: s.id, phase: s.phase, phaseLabel: phaseOf(s.phase).label, lane: s.lane, laneLabel: laneOf(s.lane).label, kind: s.kind,
        sequence: s.kind === "step" && !s.removed ? numbers[s.id] : null, name: s.name, starred: s.starred, info: s.info, removed: !!s.removed };
    });
  }
  function exportHandoffs(){
    return state.handoffs.map(function(h){
      var a = stepById(h.from), b = stepById(h.to);
      return { number: h.number, what: h.what, how: h.how, status: h.status, shownAs: effStatus(h), stepRemoved: hoGone(h),
        fromStepId: h.from, fromLane: a ? laneOf(a.lane).label : "", fromStep: a ? a.name : "", fromPhase: a ? phaseOf(a.phase).label : "",
        toStepId: h.to, toLane: b ? laneOf(b.lane).label : "", toStep: b ? b.name : "", toPhase: b ? phaseOf(b.phase).label : "" };
    });
  }
  function describeChanges(){
    var out = [], d = draftBoard(), dnum = {}, dcount = {}, dById = {};
    d.steps.forEach(function(s){
      dById[s.id] = s;
      if (s.kind === "step") { var dk = s.phase + "|" + s.lane; dcount[dk] = (dcount[dk] || 0) + 1; dnum[s.id] = dcount[dk]; }
    });
    state.steps.forEach(function(s){
      var o = dById[s.id];
      if (!o) { out.push((s.removed ? "Added, then removed: " : "Added: ") + "\"" + s.name + "\" in " + phaseOf(s.phase).label + ", " + laneOf(s.lane).label + (s.kind === "step" && !s.removed ? ", step " + numbers[s.id] : "")); return; }
      var tag = "\"" + o.name + "\" (" + phaseOf(o.phase).label + (o.kind === "step" ? " " + dnum[o.id] : "") + ")";
      if (s.removed) { out.push("Removed: " + tag); return; }
      if (s.name !== o.name) out.push("Renamed: " + tag + " is now \"" + s.name + "\"");
      if (s.phase !== o.phase) out.push("Moved phase: " + tag + " to " + phaseOf(s.phase).label);
      if (s.lane !== o.lane) out.push("Moved lane: " + tag + " from " + laneOf(o.lane).label + " to " + laneOf(s.lane).label);
      if (s.starred !== o.starred) out.push((s.starred ? "Asterisk added: " : "Asterisk removed: ") + tag);
      if (s.kind !== o.kind) out.push("Kind: " + tag + " is now " + KIND_WORD[s.kind].toLowerCase());
      if (s.info !== o.info) out.push("Info edited: " + tag);
      if (s.kind === "step" && o.kind === "step" && s.phase === o.phase && s.lane === o.lane && numbers[s.id] !== dnum[s.id]) out.push("Renumbered: " + tag + " is now step " + numbers[s.id]);
    });
    var dh = {}, seen = {};
    d.handoffs.forEach(function(h){ dh[h.id] = h; });
    state.handoffs.forEach(function(h){
      var o = dh[h.id];
      seen[h.id] = true;
      if (!o) { out.push("Hand-off added: H" + h.number + " " + h.what); return; }
      if (h.from !== o.from || h.to !== o.to) out.push("Hand-off H" + h.number + " now sits on different cards");
      if (h.what !== o.what) out.push("Hand-off H" + h.number + " what: now \"" + h.what + "\"");
      if (h.how !== o.how) out.push("Hand-off H" + h.number + " how it travels: now \"" + h.how + "\"");
      if (h.status !== o.status) out.push("Hand-off H" + h.number + " status: " + o.status + " to " + h.status);
    });
    d.handoffs.forEach(function(h){ if (!seen[h.id]) out.push("Hand-off removed: H" + h.number + " " + h.what); });
    return out;
  }


  state = loadState();
  buildCols();
  computeNumbers();
  buildLegends();
  render();
  ENV.ready();

  var areas = Array.prototype.slice.call(document.querySelectorAll("#questions textarea"));
  areas.forEach(function(t){
    if (typeof state.text[t.id] === "string") t.value = state.text[t.id];
    t.addEventListener("input", function(){ state.text[t.id] = t.value; save(); });
  });

  var PAPER = {
    letter:  { size: "11in 8.5in", w: 792,  h: 612, margin: 28.8, pages: 2, lane: 66,
               levels: [[12, 3.5, 4, 5], [11.5, 3.5, 3.5, 5], [11.5, 3, 3, 4], [11, 3, 3, 4], [11, 2.5, 3, 4], [10.5, 3, 3, 4], [10.5, 2.5, 3, 4], [10.5, 2, 2.5, 3]] },
    tabloid: { size: "17in 11in",  w: 1224, h: 792, margin: 28.8, pages: 1, lane: 94,
               levels: [[13, 4, 4, 6], [12.5, 4, 4, 6], [12, 3.5, 4, 5], [11.5, 3.5, 3.5, 5], [11.5, 3, 3, 5], [11, 3, 3, 4], [11, 2.5, 3, 4],
                        [10.5, 3, 3, 4], [10.5, 2.5, 3, 4], [10, 3, 3, 4], [10, 2.5, 3, 4], [10, 2, 2.5, 3]] }
  };
  function addStyle(id){ var st = document.createElement("style"); st.id = id; document.head.appendChild(st); return st; }
  function scopedPrintRules(){

    var out = "";
    Array.prototype.forEach.call(document.styleSheets, function(sheet){
      var rules;
      try { rules = sheet.cssRules; } catch(e) { return; }
      Array.prototype.forEach.call(rules, function(r){
        if (!r.media || r.media.mediaText !== "print" || !r.cssRules) return;
        Array.prototype.forEach.call(r.cssRules, function(q){
          if (!q.selectorText) return;
          var sels = q.selectorText.split(",").map(function(x){ return x.trim(); }).filter(function(x){ return !/^(body|html|:root)/.test(x); });
          if (sels.length) out += sels.map(function(x){ return ".pm " + x; }).join(",") + "{" + q.style.cssText + "}";
        });
      });
    });
    return out;
  }
  addStyle("pmRules").textContent = scopedPrintRules();
  var pmDyn = addStyle("pmDyn"), printDyn = addStyle("printDyn");
  function fitCss(scope, lv, cols){
    var out = (scope || ":root") + "{--pf:" + lv[0] + "pt;--pp:" + lv[1] + "pt;--pg:" + lv[2] + "pt;--cp:" + lv[3] + "pt}";
    (cols || []).forEach(function(w, i){ out += (scope ? scope + " " : "") + "table.lanes col:nth-child(" + (i + 1) + "){width:" + w.toFixed(2) + "%}"; });
    return out;
  }
  function measure(paper, lv){
    var W = paper.w - 2 * paper.margin;
    var H = (paper.h - 2 * paper.margin) * (96 / 72) * 0.99;
    var box = el("div", "pm");
    box.style.cssText = "position:absolute;left:-30000px;top:0;visibility:hidden;width:" + W + "pt";
    box.appendChild(dom("printTitle").cloneNode(true));
    box.appendChild(dom("printLegend").cloneNode(true));
    var t = dom("lanes").cloneNode(true);
    box.appendChild(t);
    document.body.appendChild(box);
    try {

      pmDyn.textContent = fitCss(".pm", lv, null);
      t.classList.add("nat");
      var nat = Array.prototype.slice.call(t.querySelectorAll("thead th")).slice(1).map(function(th){ return th.getBoundingClientRect().width; });
      t.classList.remove("nat");
      var sorted = nat.slice().sort(function(a, b){ return a - b; }), mid = sorted[Math.floor(sorted.length / 2)] || 1;
      var need = nat.map(function(n){ return Math.max(0.85 * mid, Math.min(1.3 * mid, n)); });
      var sum = need.reduce(function(a, b){ return a + b; }, 0) || 1;
      var lanePct = paper.lane / W * 100;
      var cols = [lanePct].concat(need.map(function(n){ return n / sum * (100 - lanePct); }));

      var lineH = lv[0] * (96 / 72) * 1.22, cramped = false;
      for (var pass = 0; pass < 9; pass++) {
        pmDyn.textContent = fitCss(".pm", lv, cols);
        var bad = PHASES.map(function(){ return false; });
        Array.prototype.forEach.call(t.querySelectorAll("td.cell .card"), function(c){
          var nm = c.querySelector(".nm");
          if (!nm || (c.getAttribute("data-name") || "").length > 40) return;
          if (Math.round(nm.getBoundingClientRect().height / lineH) >= 3) {
            PHASES.forEach(function(ph, i){ if (ph.key === c.getAttribute("data-phase")) bad[i] = true; });
          }
        });
        var nBad = bad.filter(Boolean).length;
        cramped = nBad > 0;
        if (!nBad || nBad === bad.length || pass === 8) break;
        var take = 0;
        cols = cols.map(function(w, i){ if (i > 0 && bad[i - 1]) { take += w * 0.05; return w * 1.05; } return w; });
        cols = cols.map(function(w, i){ return (i > 0 && !bad[i - 1]) ? w - take / (bad.length - nBad) : w; });
      }

      var top = t.getBoundingClientRect().top - box.getBoundingClientRect().top;
      var head = t.querySelector("thead").getBoundingClientRect().height;
      var rows = Array.prototype.slice.call(t.querySelectorAll("tbody tr")).filter(function(tr){ return !tr.classList.contains("wrongrow"); })
        .map(function(tr){ return tr.getBoundingClientRect().height; });
      var pages = 1, y = top + head, tall = false, first = true;
      rows.forEach(function(r){
        if (head + r > H) tall = true;
        if (y + r > H && !first) { pages += 1; y = head + r; }
        else y += r;
        first = false;
      });
      return { level: lv, cols: cols, pages: pages, tall: tall, cramped: cramped, used: Math.round(top + head + rows.reduce(function(a, b){ return a + b; }, 0)) };
    } finally {
      document.body.removeChild(box);
      pmDyn.textContent = "";
    }
  }
  function prepPrint(){
    var key = dom("paper").value, paper = PAPER[key] || PAPER.letter, fit = null;
    document.body.classList.toggle("optWrong", dom("alsoWrong").checked);
    document.body.classList.toggle("optHandoffs", dom("alsoHandoffs").checked);
    dom("printDate").textContent = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    try {
      var fits = paper.levels.map(function(lv){ return measure(paper, lv); });
      var whole = fits.filter(function(f){ return !f.tall; });
      if (whole.length) fits = whole;
      var roomy = fits.filter(function(f){ return !f.cramped; });
      if (roomy.length) fits = roomy;
      var least = Math.min.apply(null, fits.map(function(f){ return f.pages; }));
      var goal = Math.max(paper.pages, least);
      fit = fits.filter(function(f){ return f.pages <= goal; })[0];
    } catch(e) { fit = null; }
    var lv = fit ? fit.level : paper.levels[paper.levels.length - 1];
    printDyn.textContent = "@page{size:" + paper.size + ";margin:.4in}@media print{" + fitCss("", lv, fit ? fit.cols : null) + "}";
    document.body.setAttribute("data-print-paper", key);
    document.body.setAttribute("data-print-type", String(lv[0]));
    document.body.setAttribute("data-print-pages", fit ? String(fit.pages) : "");
    document.body.setAttribute("data-print-tall", fit && fit.tall ? "1" : "0");
    document.body.setAttribute("data-print-fit", fit ? lv.join("/") + " used " + fit.used + "px" + (fit.cramped ? " cramped" : "") : "no fit, floor used");
  }
  function doPrint(){ prepPrint(); window.print(); }
  ["paper", "alsoWrong", "alsoHandoffs"].forEach(function(id){ dom(id).addEventListener("change", prepPrint); });
  window.addEventListener("beforeprint", prepPrint);
  prepPrint();
  dom("print1").addEventListener("click", doPrint);
  }
})();
