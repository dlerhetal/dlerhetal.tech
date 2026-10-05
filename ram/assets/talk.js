/* Guide page with the reader's own entries. Generic: nothing in this file names a client or a person, and it holds no
   wording from the guide. The page markup, the options, the labels and the name the page saves under all arrive from
   the API after sign-in.

   The markup carries empty slots (data-talk-slot) that this script fills with real inputs: the option list (tick any,
   mark one as the main one), one free-text box, a date, and and one short line. Every change is
   saved on the server as it is made (a tick or a date at once, typing about a second after the last key), with an
   honest status line. Each save says which version of the field its screen started from; if the field was saved
   somewhere else in the meantime the server refuses with 409 and the page shows the latest. The page follows the
   server every 30 seconds and when the tab regains focus, but never re-draws a box that has focus or unsent text.
   Print gives the guide with the entries filled in. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var DALE = !!R.DALE_MODE;
  var Q = TEST ? "?as=TEST" : "";
  var C = null, L = {}, who = "";
  var st = {}, dirty = {}, inflight = false, timer = null, seq = 0;
  var TEXT_DELAY = 900;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function fail(text) { document.body.insertBefore(mk("p", "tfail", text), document.body.firstChild); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return "";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  R.gate(function () {
    R.apiJSON("/talk/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.content || !d.state) throw new Error((d && d.error) || "The page could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function start(d) {
    C = d.content; L = C.labels || {};
    who = TEST ? "TEST" : (DALE ? (d.page_editor || "") : (C.owner || ""));
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../assets/talk.css?v=1";
    var go = function () {
      go = function () { };
      document.title = C.title || "Working page";
      draw();
      applyState(d.state.fields, true);
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeunload", function (e) { if (Object.keys(dirty).length || inflight) { flush(); e.preventDefault(); e.returnValue = ""; } });
      window.addEventListener("beforeprint", mirrors);
      document.body.setAttribute("data-talk-ready", TEST ? "test" : (DALE ? "dale" : "owner"));
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- the page ---------- */
  function draw() {
    var nav = mk("div", "tnav noprint");
    nav.appendChild(mk("span", "tmode", "Saving as " + who));
    var stat = mk("span", "tstatus"); stat.id = "tkStatus"; stat.setAttribute("role", "status"); nav.appendChild(stat);
    var pr = mk("button", "tbtn", "Print"); pr.type = "button"; pr.id = "tkPrint";
    pr.addEventListener("click", function () { flush(); mirrors(); window.print(); });
    nav.appendChild(pr);
    var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);

    var main = mk("main", "tmain"); main.id = "tkMain";
    main.innerHTML = C.html || "";
    document.body.insertBefore(main, document.body.querySelector("script"));
    slot("goals", goalsEl());
    slot("myGoal", myGoalEl());
    slot("checkBackDate", dateEl());
    slot("checkin", coverEl());
  }

  function slot(name, el) { var s = document.querySelector('[data-talk-slot="' + name + '"]'); if (s) { s.innerHTML = ""; s.appendChild(el); } }
  function meta(id) { var p = mk("p", "tmeta"); p.id = id; return p; }

  function goalsEl() {
    var box = mk("div", "tgoals"); box.id = "tkGoals";
    (C.goals || []).forEach(function (g) {
      var row = mk("div", "tg"); row.setAttribute("data-goal", g.id);
      var head = mk("div", "tghead");
      var lab = mk("label", "tgpick");
      var cb = mk("input"); cb.type = "checkbox"; cb.value = g.id; cb.className = "tkPick"; cb.id = "tkPick_" + g.id;
      lab.appendChild(cb); lab.appendChild(mk("span", "tgtitle", g.title));
      head.appendChild(lab);
      var ml = mk("label", "tgmain");
      var rb = mk("input"); rb.type = "radio"; rb.name = "tkMainGoal"; rb.value = g.id; rb.className = "tkMain"; rb.id = "tkMain_" + g.id;
      ml.appendChild(rb); ml.appendChild(mk("span", null, L.main || ""));
      head.appendChild(ml);
      row.appendChild(head);
      var p1 = mk("p", "tgline"); p1.appendChild(mk("b", null, (L.means || "") + ": ")); p1.appendChild(document.createTextNode(g.means || "")); row.appendChild(p1);
      var p2 = mk("p", "tgline"); p2.appendChild(mk("b", null, (L.fixed || "") + ": ")); p2.appendChild(document.createTextNode(g.fixed || "")); row.appendChild(p2);
      cb.addEventListener("change", function () {
        var f = { goalPicks: picks() };
        if (!cb.checked && mainGoal() === "" && st.mainGoal && st.mainGoal.value === g.id) f.mainGoal = "";
        if (!cb.checked && rb.checked) { rb.checked = false; f.mainGoal = ""; }
        mark(); queue(f, 0);
      });
      rb.addEventListener("change", function () {
        if (rb.checked && !cb.checked) cb.checked = true;
        mark(); queue({ goalPicks: picks(), mainGoal: g.id }, 0);
      });
      box.appendChild(row);
    });
    box.appendChild(meta("tkGoalsMeta"));
    return box;
  }
  function picks() { return Array.prototype.map.call(document.querySelectorAll(".tkPick:checked"), function (c) { return c.value; }); }
  function mainGoal() { var r = document.querySelector(".tkMain:checked"); return r ? r.value : ""; }
  function mark() {
    Array.prototype.forEach.call(document.querySelectorAll(".tg"), function (row) {
      var id = row.getAttribute("data-goal");
      row.classList.toggle("on", !!document.querySelector("#tkPick_" + id + ":checked"));
      row.classList.toggle("main", !!document.querySelector("#tkMain_" + id + ":checked"));
    });
  }

  function myGoalEl() {
    var box = mk("div", "tfield");
    var lab = mk("label", "tlabel", L.myGoal || ""); lab.htmlFor = "tkMyGoal"; box.appendChild(lab);
    var ta = mk("textarea", "tta noprint"); ta.id = "tkMyGoal"; ta.rows = 4; ta.maxLength = 4000;
    ta.addEventListener("input", function () { queue({ myGoal: ta.value }, TEXT_DELAY); grow(ta); });
    box.appendChild(ta);
    var pv = mk("div", "tpv printonly"); pv.id = "tkMyGoalPrint"; box.appendChild(pv);
    box.appendChild(meta("tkMyGoalMeta"));
    return box;
  }
  function grow(ta) { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 96) + "px"; }

  function dateEl() {
    var box = mk("div", "tfield");
    var lab = mk("label", "tlabel", L.checkBackDate || ""); lab.htmlFor = "tkDate"; box.appendChild(lab);
    var inp = mk("input", "tdate noprint"); inp.type = "date"; inp.id = "tkDate";
    inp.addEventListener("change", function () { queue({ checkBackDate: inp.value }, 0); away(); echo(); });
    box.appendChild(inp);
    var pv = mk("div", "tpv printonly"); pv.id = "tkDatePrint"; box.appendChild(pv);
    box.appendChild(mk("p", "tnote noprint", L.awayNote || ""));
    var w = mk("p", "twarn", L.awayWarn || ""); w.id = "tkAwayWarn"; w.hidden = true; box.appendChild(w);
    box.appendChild(meta("tkDateMeta"));
    return box;
  }
  function away() {
    var v = $("tkDate").value, w = $("tkAwayWarn");
    w.hidden = !(v && C.awayFrom && C.awayTo && v >= C.awayFrom && v <= C.awayTo);
  }

  function coverEl() {
    var box = mk("div", "tfield tcover");
    var lab = mk("label", "tlabel", L.morningCover || ""); lab.htmlFor = "tkCover"; box.appendChild(lab);
    var inp = mk("input", "ttext"); inp.type = "text"; inp.id = "tkCover"; inp.maxLength = 300;
    inp.addEventListener("input", function () { queue({ morningCover: inp.value }, TEXT_DELAY); });
    box.appendChild(inp);
    box.appendChild(meta("tkCoverMeta"));
    return box;
  }

  function echo() {
    var e = document.querySelector('[data-talk-slot="dateEcho"]');
    if (e) {
      e.innerHTML = "";
      e.appendChild(mk("b", null, (L.checkBackEcho || "") + ": "));
      var v = $("tkDate") ? $("tkDate").value : "";
      if (v) e.appendChild(mk("span", "techo", longDate(v)));
      else {
        e.appendChild(mk("span", "techo tunset", (L.notSet || "") + " ("));
        var a = mk("a", "noprint", L.setAbove || ""); a.href = "#tkDate";
        a.addEventListener("click", function (ev) { ev.preventDefault(); var d = $("tkDate"); d.scrollIntoView({ block: "center" }); d.focus(); });
        e.appendChild(a); e.appendChild(mk("span", "tunset", ")"));
      }
    }
  }

  function mirrors() {
    var ta = $("tkMyGoal"); if (ta) $("tkMyGoalPrint").textContent = ta.value;
    var d = $("tkDate"); if (d) $("tkDatePrint").textContent = d.value ? longDate(d.value) : "";
  }

  /* ---------- state in, state out ---------- */
  function metaLine(id, fields) {
    var n = $(id); if (!n) return;
    var best = null;
    fields.forEach(function (f) { var x = st[f]; if (x && x.rev && (!best || x.rev > best.rev)) best = x; });
    n.textContent = best ? "Saved by " + best.by + ", " + R.fmtTs(best.ts) : "";
  }

  function applyState(fields, force) {
    fields = fields || {};
    var act = document.activeElement;
    function free(f, el) { return force || (!dirty[f] && el !== act); }
    Object.keys(fields).forEach(function (f) { if (force || !dirty[f]) st[f] = fields[f]; });
    if (free("goalPicks", null) && st.goalPicks) {
      var ps = st.goalPicks.value || [];
      Array.prototype.forEach.call(document.querySelectorAll(".tkPick"), function (c) { c.checked = ps.indexOf(c.value) >= 0; });
    }
    if (free("mainGoal", null) && st.mainGoal) {
      Array.prototype.forEach.call(document.querySelectorAll(".tkMain"), function (r) { r.checked = r.value === st.mainGoal.value; });
    }
    var ta = $("tkMyGoal");
    if (ta && st.myGoal && free("myGoal", ta)) { ta.value = st.myGoal.value || ""; grow(ta); }
    var d = $("tkDate");
    if (d && st.checkBackDate && free("checkBackDate", d)) d.value = st.checkBackDate.value || "";
    var co = $("tkCover");
    if (co && st.morningCover && free("morningCover", co)) co.value = st.morningCover.value || "";
    mark(); away(); echo(); mirrors();
    metaLine("tkGoalsMeta", ["goalPicks", "mainGoal"]);
    metaLine("tkMyGoalMeta", ["myGoal"]);
    metaLine("tkDateMeta", ["checkBackDate"]);
    metaLine("tkCoverMeta", ["morningCover"]);
  }

  function status(text, bad) { var s = $("tkStatus"); if (s) { s.textContent = text; s.classList.toggle("bad", !!bad); } }

  /* queue(fields, delay): remember the newest value of each field and send them together after the delay
     (0 for a tick, a pick or a date; about a second after the last key for typing). One save at a time. */
  function queue(fields, delay) {
    Object.keys(fields).forEach(function (f) { dirty[f] = fields[f]; });
    status("Saving...");
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  function flush() {
    clearTimeout(timer);
    if (inflight) return;
    var send = dirty; dirty = {};
    var keys = Object.keys(send); if (!keys.length) return;
    var base = {}; keys.forEach(function (f) { base[f] = st[f] ? st[f].rev : 0; });
    inflight = true;
    var mine = ++seq;
    R.api("/talk/save", { method: "POST", json: { saved_by: who, fields: send, base: base } }).then(answer).then(function (x) {
      inflight = false;
      if (x.s === 200 && x.j.ok) {
        var f = x.j.state.fields;
        keys.forEach(function (k) { st[k] = f[k]; });
        applyState(f, false);
        status("Saved " + clock());
      } else if (x.s === 409 && x.j.state) {
        keys.forEach(function (k) { delete dirty[k]; });
        applyState(x.j.state.fields, true);
        status(x.j.error || "Changed somewhere else. The latest is loaded.", true);
      } else {
        keys.forEach(function (k) { if (!(k in dirty)) dirty[k] = send[k]; });
        status("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), true);
        return;
      }
      if (Object.keys(dirty).length) flush();
    }).catch(function (e) {
      inflight = false;
      keys.forEach(function (k) { if (!(k in dirty)) dirty[k] = send[k]; });
      if (e && e.message === "signed out") return;
      status("Not saved: no connection. It will try again.", true);
    });
    return mine;
  }

  function poll() {
    if (document.hidden) return;
    if (Object.keys(dirty).length && !inflight) flush();
    R.apiJSON("/talk/board?part=state" + (TEST ? "&as=TEST" : "")).then(function (d) {
      if (d && d.ok && d.state && !inflight) applyState(d.state.fields, false);
    }).catch(function () { });
  }
})();
