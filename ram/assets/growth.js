/* Talk-through page: question cards with a notes box under each and one box at the end, notes saved on the server.
   Generic: nothing in this file names a client or a person and it holds no page wording beyond a few control labels.
   The cards, the intro, the labels and the placeholder text all arrive from the API after sign-in.

   Each box saves about a second after the last key, under the name typed once in the top bar (kept in this
   browser's storage, inside try/catch). Every save is a new row on the server (nothing is overwritten), and each
   box shows who saved it last and when, with the earlier saves underneath. A save names the version its screen
   started from; if the box was saved somewhere else in the meantime the server refuses (409) and the page shows
   both, so nothing is lost silently. The page follows the server every 30 seconds and when the tab regains focus,
   but never re-draws a box that has focus or unsent words. Print gives the cards with the notes written in. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var WHO_KEY = R.NS.slice(1) + "_growth_who";
  var OTHER_WHO = [R.NS.slice(1) + "_team_who", R.NS.slice(1) + "_plan_who"];
  var C = null, L = {}, st = {}, who = "";
  var dirty = {}, timers = {}, inflight = {}, conflict = {};
  var TEXT_DELAY = 900;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function fail(text) { document.body.insertBefore(mk("p", "grfail", text), document.body.firstChild); }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o[k] !== undefined ? o[k] : m; }); }
  function readWho() {
    try {
      var v = localStorage.getItem(WHO_KEY) || "";
      for (var i = 0; !v && i < OTHER_WHO.length; i++) v = localStorage.getItem(OTHER_WHO[i]) || "";
      return v;
    } catch (e) { return ""; }
  }
  function saveWho(v) { try { if (v) localStorage.setItem(WHO_KEY, v); else localStorage.removeItem(WHO_KEY); } catch (e) { } }

  R.gate(function () {
    R.apiJSON("/growth/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.content || !d.state) throw new Error((d && d.error) || "The page could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function start(d) {
    C = d.content; L = C.labels || {};
    who = TEST ? "TEST" : readWho();
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../assets/growth.css?v=2";
    var go = function () {
      go = function () { };
      document.title = C.title || "Working page";
      frame();
      draw();
      applyState(d.state.boxes, true);
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeunload", function (e) { if (Object.keys(dirty).length || busy()) { flushAll(); e.preventDefault(); e.returnValue = ""; } });
      window.addEventListener("beforeprint", function () { mirrors(); openForPrint(true); });
      window.addEventListener("afterprint", function () { openForPrint(false); });
      try { window.matchMedia("print").addEventListener("change", function (e) { openForPrint(e.matches); }); } catch (e) { }
      document.body.setAttribute("data-growth-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }
  /* The folded section prints open; after printing it goes back to how it was. */
  var wasOpen = null;
  function openForPrint(on) {
    var d = $("grMore"); if (!d) return;
    if (on) { if (wasOpen === null) wasOpen = d.open; d.open = true; }
    else if (wasOpen !== null) { d.open = wasOpen; wasOpen = null; }
  }
  function busy() { return Object.keys(inflight).some(function (k) { return inflight[k]; }); }

  /* ---------- the frame: sticky bar with the name box ---------- */
  function frame() {
    var nav = mk("div", "grnav noprint"); nav.id = "grNav";
    var wl = mk("label", "grwho"); wl.id = "grWhoLabel";
    wl.appendChild(mk("span", null, L.yourName || "Your name"));
    var wi = mk("input"); wi.type = "text"; wi.id = "grWho"; wi.maxLength = 40; wi.autocomplete = "name"; wi.value = who;
    wi.placeholder = L.namePlaceholder || "";
    if (TEST) wi.disabled = true;
    wi.addEventListener("change", function () {
      who = wi.value.replace(/\s+/g, " ").trim(); wi.value = who; saveWho(who);
      wl.classList.toggle("need", !who);
      if (who) flushAll();
    });
    wl.appendChild(wi);
    nav.appendChild(wl);
    var stat = mk("span", "grstatus"); stat.id = "grStatus"; stat.setAttribute("role", "status"); nav.appendChild(stat);
    var pr = mk("button", "grbtn", L.print || "Print"); pr.type = "button"; pr.id = "grPrint";
    pr.addEventListener("click", function () { flushAll(); mirrors(); window.print(); });
    nav.appendChild(pr);
    var out = mk("a", "grout", "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  /* ---------- drawing ---------- */
  function draw() {
    var head = mk("header", "grhead");
    var hw = mk("div", "grwrap");
    hw.appendChild(mk("h1", null, C.title || ""));
    var sub = mk("p", "grsub"); sub.innerHTML = C.sub || ""; hw.appendChild(sub);
    head.appendChild(hw);
    document.body.insertBefore(head, document.body.querySelector("script"));

    var main = mk("main", "grwrap"); main.id = "grMain";
    var ep = C.episode || {};
    var eb = mk("section", "grepisode");
    var p1 = mk("p"); p1.innerHTML = ep.line || ""; eb.appendChild(p1);
    if (ep.url) {
      var p2 = mk("p"); p2.appendChild(mk("b", null, (ep.urlLabel || "Link") + ": "));
      var a = mk("a", "grurl", ep.url); a.href = ep.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      p2.appendChild(a); eb.appendChild(p2);
    }
    main.appendChild(eb);
    var intro = mk("section", "grintro");
    (C.intro || []).forEach(function (t) { var p = mk("p"); p.innerHTML = t; intro.appendChild(p); });
    main.appendChild(intro);

    /* Optional split (content-defined): a few cards up front under one line, the rest, with their section headings,
       inside one closed section that opens for printing. Without it, every section is drawn in order. */
    var front = (C.front && C.front.ids) || [], more = null;
    if (front.length) {
      var byId = {};
      (C.sections || []).forEach(function (s) { (s.cards || []).forEach(function (c) { byId[c.id] = c; }); });
      if (C.front.line) main.appendChild(mk("p", "grfront", C.front.line));
      front.forEach(function (id) { if (byId[id]) main.appendChild(card(byId[id])); });
      more = mk("details", "grmore"); more.id = "grMore";
      more.appendChild(mk("summary", null, (C.more && C.more.title) || ""));
      main.appendChild(more);
    }
    (C.sections || []).forEach(function (s) {
      var rest = (s.cards || []).filter(function (c) { return front.indexOf(c.id) < 0; });
      if (!rest.length) return;
      var host = more || main;
      host.appendChild(mk("h2", null, s.title));
      rest.forEach(function (c) { host.appendChild(card(c)); });
    });

    var ov = mk("section", "grq groverall");
    ov.appendChild(box("overall", L.overall || "", C.overallPlaceholder || C.placeholder || ""));
    main.appendChild(ov);

    if (C.source) { var src = mk("p", "grsrc"); src.innerHTML = C.source; main.appendChild(src); }
    var f = C.footer || {};
    var foot = mk("footer", "grfoot");
    var ft = mk("span"); ft.innerHTML = f.text || ""; foot.appendChild(ft);
    if (f.logo) { var img = mk("img"); img.src = f.logo; img.alt = f.logoAlt || ""; foot.appendChild(img); }
    main.appendChild(foot);
    document.body.insertBefore(main, document.body.querySelector("script"));
    main.addEventListener("input", onInput);
  }

  function card(c) {
    var a = mk("article", "grq" + (c.close ? " close" : "")); a.id = "card_" + c.id; a.setAttribute("data-q", c.id);
    var h = mk("div", "grqhead");
    h.appendChild(mk("span", "grnum", String(c.n)));
    var tag = mk("span", "grtag"); tag.innerHTML = c.tag || ""; h.appendChild(tag);
    a.appendChild(h);
    var jay = mk("p", "grjay"); jay.innerHTML = c.jay || ""; a.appendChild(jay);
    var ask = mk("p", "grask"); ask.innerHTML = c.ask || ""; a.appendChild(ask);
    if (c.follow) {
      var fo = mk("p", "grfollow"); fo.appendChild(mk("b", null, "Follow-up: "));
      var sp = mk("span"); sp.innerHTML = c.follow; fo.appendChild(sp); a.appendChild(fo);
    }
    if ((c.think || []).length) {
      a.appendChild(mk("span", "grlbl", L.think || ""));
      var ul = mk("ul", "grthink");
      c.think.forEach(function (t) { ul.appendChild(mk("li", null, t)); });
      a.appendChild(ul);
    }
    (c.blocks || []).forEach(function (b) {
      a.appendChild(mk("span", "grlbl", b.label || ""));
      if (b.list) {
        var ol = mk("ol", "grlist");
        b.list.forEach(function (t) { var li = mk("li"); li.innerHTML = t; ol.appendChild(li); });
        a.appendChild(ol);
      } else {
        var tie = mk("div", "grtie");
        (b.paras || []).forEach(function (t) { var p = mk("p"); p.innerHTML = t; tie.appendChild(p); });
        a.appendChild(tie);
      }
    });
    a.appendChild(box(c.id, fill(L.notes, { n: c.n }), C.placeholder || ""));
    return a;
  }

  function box(id, label, ph) {
    var w = mk("div", "grbox"); w.setAttribute("data-box", id);
    var lab = mk("label", "grnlbl", label); lab.htmlFor = "gr_" + id; w.appendChild(lab);
    var ta = mk("textarea", "grnotes noprint"); ta.id = "gr_" + id; ta.setAttribute("data-box", id);
    ta.placeholder = ph; ta.rows = 4; ta.maxLength = 8000;
    w.appendChild(ta);
    var pv = mk("div", "grpv printonly"); pv.id = "grpv_" + id; w.appendChild(pv);
    var cf = mk("div", "grconflict noprint"); cf.id = "grcf_" + id; cf.hidden = true; w.appendChild(cf);
    var m = mk("p", "grmeta"); m.id = "grmeta_" + id; w.appendChild(m);
    var det = mk("details", "grearlier noprint"); det.id = "grearly_" + id; det.hidden = true;
    det.appendChild(mk("summary"));
    det.appendChild(mk("ol"));
    w.appendChild(det);
    return w;
  }
  function grow(ta) { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 104) + "px"; }

  /* ---------- state in ---------- */
  function applyState(boxes, force) {
    boxes = boxes || {};
    var act = document.activeElement;
    Object.keys(boxes).forEach(function (id) {
      var ta = $("gr_" + id); if (!ta) return;
      var free = force || (!(id in dirty) && !inflight[id] && ta !== act && !conflict[id]);
      if (free) { st[id] = boxes[id]; ta.value = boxes[id].text || ""; grow(ta); }
      else if (!(id in dirty) && !inflight[id] && !conflict[id]) st[id] = boxes[id];
      metaFor(id, boxes[id]);
    });
    mirrors();
  }
  function metaFor(id, b) {
    var m = $("grmeta_" + id); if (!m) return;
    m.textContent = b && b.rev ? fill(L.lastSaved, { by: b.by, when: R.fmtTs(b.ts) }) : (L.notSaved || "");
    m.classList.toggle("none", !(b && b.rev));
    var det = $("grearly_" + id); if (!det) return;
    var e = (b && b.earlier) || [];
    det.hidden = !e.length;
    det.querySelector("summary").textContent = (L.earlier || "Earlier saves") + " (" + e.length + ")";
    var ol = det.querySelector("ol"); ol.innerHTML = "";
    e.forEach(function (x) {
      var li = mk("li");
      li.appendChild(mk("span", "grewho", x.by + ", " + R.fmtTs(x.ts)));
      li.appendChild(mk("span", "gretext", x.text || "(empty)"));
      ol.appendChild(li);
    });
  }
  function mirrors() {
    Array.prototype.forEach.call(document.querySelectorAll("textarea.grnotes"), function (ta) {
      var pv = $("grpv_" + ta.getAttribute("data-box")); if (!pv) return;
      pv.textContent = ta.value; pv.classList.toggle("empty", !ta.value.trim());
    });
  }

  /* ---------- state out ---------- */
  function status(text, bad) { var s = $("grStatus"); if (s) { s.textContent = text; s.classList.toggle("bad", !!bad); } }
  function needName() {
    var wl = $("grWhoLabel"); if (wl) wl.classList.add("need");
    status(L.needName || "Type your name at the top first.", true);
  }

  function onInput(e) {
    var ta = e.target; if (!ta || !ta.matches || !ta.matches("textarea.grnotes")) return;
    var id = ta.getAttribute("data-box");
    grow(ta);
    var pv = $("grpv_" + id); if (pv) { pv.textContent = ta.value; pv.classList.toggle("empty", !ta.value.trim()); }
    if (conflict[id]) return;
    dirty[id] = ta.value;
    if (!who) { needName(); return; }
    status("Saving...");
    clearTimeout(timers[id]);
    timers[id] = setTimeout(function () { flush(id); }, TEXT_DELAY);
  }

  function flushAll() { Object.keys(dirty).forEach(function (id) { flush(id); }); }

  function flush(id, overBase) {
    clearTimeout(timers[id]);
    if (!(id in dirty)) return;
    if (!who) { needName(); return; }
    if (inflight[id]) return;
    var text = dirty[id]; delete dirty[id];
    var base = overBase !== undefined ? overBase : (st[id] ? st[id].rev : 0);
    inflight[id] = true;
    R.api("/growth/save" + Q, { method: "POST", json: { saved_by: who, box: id, text: text, base: base } }).then(answer).then(function (x) {
      inflight[id] = false;
      if (x.s === 200 && x.j.ok) {
        var b = x.j.state.boxes;
        st[id] = b[id];
        metaFor(id, b[id]);
        status("Saved " + clock());
      } else if (x.s === 409 && x.j.state) {
        showConflict(id, text, x.j.state.boxes[id]);
        status(x.j.error || "Saved somewhere else a moment ago.", true);
        return;
      } else {
        if (!(id in dirty)) dirty[id] = text;
        status("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), true);
        return;
      }
      if (id in dirty) flush(id);
    }).catch(function (e) {
      inflight[id] = false;
      if (!(id in dirty)) dirty[id] = text;
      if (e && e.message === "signed out") return;
      status("Not saved: no connection. It will try again.", true);
    });
  }

  /* A box saved somewhere else while this screen was typing: keep the typed words in the box, show the other words,
     and let the person choose. Nothing is saved until they do. */
  function showConflict(id, mine, theirs) {
    conflict[id] = { mine: mine, theirs: theirs };
    delete dirty[id];
    var cf = $("grcf_" + id); if (!cf) return;
    cf.innerHTML = "";
    cf.appendChild(mk("p", "grcfhead", "Saved somewhere else by " + theirs.by + ", " + R.fmtTs(theirs.ts) + ":"));
    cf.appendChild(mk("div", "grcftext", theirs.text || "(empty)"));
    var row = mk("div", "grcfrow");
    var keep = mk("button", "grbtn", "Keep what is in my box"); keep.type = "button";
    var use = mk("button", "grbtn alt", "Use the saved words"); use.type = "button";
    keep.addEventListener("click", function () {
      var ta = $("gr_" + id); var t = ta ? ta.value : mine;
      st[id] = theirs; delete conflict[id]; cf.hidden = true;
      dirty[id] = t; flush(id, theirs.rev);
    });
    use.addEventListener("click", function () {
      var ta = $("gr_" + id);
      st[id] = theirs; delete conflict[id]; cf.hidden = true;
      if (ta) { ta.value = theirs.text || ""; grow(ta); }
      metaFor(id, theirs); mirrors(); status("");
    });
    row.appendChild(keep); row.appendChild(use); cf.appendChild(row);
    cf.hidden = false;
    metaFor(id, theirs);
  }

  function poll() {
    if (document.hidden) return;
    if (who) flushAll();
    R.apiJSON("/growth/board?part=state" + (TEST ? "&as=TEST" : "")).then(function (d) {
      if (d && d.ok && d.state) applyState(d.state.boxes, false);
    }).catch(function () { });
  }
})();
