/* Checklist page: a daily form, an editable list, a log of past mornings, two prints and a Word download.
   Generic: nothing in this file names a client or a person, and it holds none of the checklist's wording. The list,
   its headings, the field labels and the closing question all arrive from the API after sign-in.

   One page serves any checklist: the slug comes from <body data-list="...">, and every call goes to /api/<slug>/.
   The server holds the list as versions (append-only); the prints and the Word file are built from the current one.
   The name is typed once in the top bar (kept in this browser, inside try/catch). An unsent morning form is kept in
   this browser too, so a reload does not lose it; it is cleared once the server has it. */
(function () {
  "use strict";
  var R = window.RAM;
  var SLUG = (document.body.getAttribute("data-list") || "quickstart").replace(/[^a-z0-9_-]/gi, "");
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var NSK = R.NS.slice(1);
  var WHO_KEY = NSK + "_" + SLUG + "_who";
  var OTHER_WHO = [NSK + "_growth_who", NSK + "_team_who", NSK + "_plan_who"];
  var DRAFT_KEY = NSK + "_" + SLUG + "_draft" + (TEST ? "_test" : "");
  var TAB_KEY = NSK + "_" + SLUG + "_tab";
  var L = null, LOGO = "", TODAY = "", LOG = null, who = "", tab = "today";
  var draft = null, editing = null, busy = false, confirmVoid = null;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function btn(text, cls, fn, title) { var b = mk("button", "qsbtn" + (cls ? " " + cls : ""), text); b.type = "button"; if (title) b.title = title; if (fn) b.addEventListener("click", fn); return b; }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function readWho() { var v = load(WHO_KEY) || ""; for (var i = 0; !v && i < OTHER_WHO.length; i++) v = load(OTHER_WHO[i]) || ""; return v; }
  function localDate() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function fail(text) { document.body.insertBefore(mk("p", "qsfail", text), document.body.firstChild); }
  function doc() { return L.doc; }
  function visibleSections() { return doc().sections.filter(function (s) { return !s.hidden; }).map(function (s) { return { s: s, items: s.items.filter(function (i) { return !i.hidden; }) }; }); }
  function fieldLabel(key, dflt) { var f = (doc().headerFields || []).filter(function (x) { return x.key === key; })[0]; return f ? f.label : dflt; }
  function showDay(iso) { try { var p = iso.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }); } catch (e) { return iso; } }
  function showTime(t) { if (!t) return ""; var p = t.split(":"); var h = +p[0], m = p[1]; return ((h % 12) || 12) + ":" + m + (h < 12 ? " AM" : " PM"); }
  function minutesBetween(a, b) {
    var ma = /^(\d{1,2}):(\d{2})$/.exec(a || ""), mb = /^(\d{1,2}):(\d{2})$/.exec(b || "");
    if (!ma || !mb) return null;
    var x = +ma[1] * 60 + +ma[2], y = +mb[1] * 60 + +mb[2];
    return y >= x ? y - x : -1;
  }
  function num(v) { return (Math.round(v * 100) / 100).toString(); }

  R.gate(function () {
    R.apiJSON("/" + SLUG + "/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.list) throw new Error((d && d.error) || "The page could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function start(d) {
    L = d.list; LOGO = d.logo || ""; TODAY = localDate();
    who = TEST ? "TEST" : readWho();
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../assets/quickstart.css?v=1";
    var go = function () {
      go = function () { };
      document.title = doc().title || "Working page";
      readDraft();
      frame();
      drawAll();
      var h = (location.hash || "").replace("#", "");
      pick(["today", "list", "log"].indexOf(h) >= 0 ? h : (load(TAB_KEY) || "today"));
      loadLog();
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      window.addEventListener("beforeprint", function () { if (!document.body.getAttribute("data-print")) prepPrint("letter"); });
      window.addEventListener("afterprint", function () { document.body.removeAttribute("data-print"); });
      document.body.setAttribute("data-qs-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- frame: top bar, header band, tabs, print and Word buttons ---------- */
  function frame() {
    var nav = mk("div", "qsnav noprint");
    var wl = mk("label", "qswho"); wl.id = "qsWhoLabel";
    wl.appendChild(mk("span", null, "Your name"));
    var wi = mk("input"); wi.type = "text"; wi.id = "qsWho"; wi.maxLength = 40; wi.autocomplete = "name"; wi.value = who;
    wi.placeholder = "Type it once";
    if (TEST) wi.disabled = true;
    wi.addEventListener("change", function () {
      who = wi.value.replace(/\s+/g, " ").trim(); wi.value = who; store(WHO_KEY, who || null);
      wl.classList.toggle("need", !who); if (who) status("");
    });
    wl.appendChild(wi); nav.appendChild(wl);
    var st = mk("span", "qsstatus"); st.id = "qsStatus"; st.setAttribute("role", "status"); nav.appendChild(st);
    var out = mk("a", "qsout", "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);

    var head = mk("header", "qshead noprint");
    var hw = mk("div", "qswrap");
    var h1 = mk("h1"); h1.id = "qsTitle"; hw.appendChild(h1);
    var sub = mk("p", "qssub"); sub.id = "qsChanged"; hw.appendChild(sub);
    var tabs = mk("div", "qstabs"); tabs.setAttribute("role", "tablist");
    [["today", "Today"], ["list", "The list"], ["log", "Log"]].forEach(function (t) {
      var b = mk("button", "qstab", t[1]); b.type = "button"; b.id = "tab_" + t[0]; b.setAttribute("role", "tab");
      b.addEventListener("click", function () { pick(t[0]); });
      tabs.appendChild(b);
    });
    hw.appendChild(tabs);
    head.appendChild(hw);
    document.body.insertBefore(head, nav.nextSibling);

    var main = mk("main", "qswrap noprint"); main.id = "qsMain";
    var tools = mk("div", "qstools");
    tools.appendChild(btn("Print big paper (25 x 30 in)", "alt", function () { doPrint("big"); }));
    tools.appendChild(btn("Print Letter", "alt", function () { doPrint("letter"); }));
    var wd = btn("Download Word", "alt", function () {
      status("Building the Word file...");
      wd.disabled = true;
      R.download("/" + SLUG + "/docx" + Q, (doc().title || "Checklist").replace(/[^A-Za-z0-9]+/g, "_") + "_v" + L.ver + ".docx")
        .then(function () { status("Word file downloaded " + clock()); })
        .catch(function () { status("The Word file could not be built. Try again.", true); })
        .then(function () { wd.disabled = false; });
    });
    wd.id = "qsWord";
    tools.appendChild(wd);
    main.appendChild(tools);
    ["today", "list", "log"].forEach(function (t) { var p = mk("section", "qspanel"); p.id = "panel_" + t; p.setAttribute("role", "tabpanel"); main.appendChild(p); });
    document.body.insertBefore(main, head.nextSibling);
    var pr = mk("div", "qsprint"); pr.id = "qsPrint"; document.body.insertBefore(pr, main.nextSibling);
    var ps = document.createElement("style"); ps.id = "qsPageSize"; document.head.appendChild(ps);
  }

  function pick(t) {
    tab = t; store(TAB_KEY, t);
    ["today", "list", "log"].forEach(function (x) {
      $("panel_" + x).hidden = x !== t;
      var b = $("tab_" + x); b.classList.toggle("on", x === t); b.setAttribute("aria-selected", x === t ? "true" : "false");
    });
    if (t === "log") loadLog();
    try { history.replaceState(null, "", location.pathname + location.search + "#" + t); } catch (e) { }
  }

  function status(text, bad) { var s = $("qsStatus"); if (s) { s.textContent = text; s.classList.toggle("bad", !!bad); } }
  function needName() { var wl = $("qsWhoLabel"); if (wl) wl.classList.add("need"); status("Type your name at the top first.", true); var w = $("qsWho"); if (w) w.focus(); }

  function drawAll() {
    $("qsTitle").textContent = doc().title || "";
    $("qsChanged").textContent = "Last changed by " + L.by + ", " + R.fmtTs(L.ts) + " (version " + L.ver + ")";
    drawToday(); drawList(); drawLog();
  }

  /* ---------- TODAY: the daily form ---------- */
  function emptyDraft() { return { f: { date: TODAY }, t: {}, held: "", ref: null, refLine: "" }; }
  function readDraft() {
    draft = null;
    try { draft = JSON.parse(load(DRAFT_KEY) || "null"); } catch (e) { draft = null; }
    if (!draft || typeof draft !== "object" || !draft.f) draft = emptyDraft();
    if (!draft.f.date) draft.f.date = TODAY;
    draft.t = draft.t || {};
  }
  function saveDraft() { store(DRAFT_KEY, JSON.stringify(draft)); }

  function inputFor(f) {
    var i = mk("input"); i.id = "qf_" + f.key; i.setAttribute("data-field", f.key);
    if (f.key === "date") i.type = "date";
    else if (f.key === "clockIn" || f.key === "rollOut") i.type = "time";
    else if (f.key === "menOnCrew") { i.type = "number"; i.min = "0"; i.max = "99"; i.inputMode = "numeric"; }
    else { i.type = "text"; i.maxLength = f.key === "job" ? 120 : 40; }
    i.value = draft.f[f.key] || "";
    return i;
  }

  function drawToday() {
    var p = $("panel_today"); p.innerHTML = "";
    if (draft.ref) {
      var fx = mk("div", "qsfixing");
      fx.appendChild(mk("span", null, "Fixing " + draft.refLine + ". Saving replaces it on the log."));
      fx.appendChild(btn("Cancel the fix", "alt", function () { draft = emptyDraft(); saveDraft(); drawToday(); }));
      p.appendChild(fx);
    }
    var card = mk("div", "qscard");
    var grid = mk("div", "qsfields");
    (doc().headerFields || []).forEach(function (f) {
      var w = mk("label", "qsfield");
      w.appendChild(mk("span", null, f.label));
      w.appendChild(inputFor(f));
      grid.appendChild(w);
    });
    card.appendChild(grid);
    var calc = mk("div", "qscalc"); calc.id = "qsCalc"; calc.setAttribute("aria-live", "polite");
    card.appendChild(calc);
    p.appendChild(card);

    visibleSections().forEach(function (v) {
      var sc = mk("div", "qscard qssection");
      var h = mk("h2"); h.appendChild(mk("span", null, v.s.title));
      if (v.s.subtitle) h.appendChild(mk("small", null, v.s.subtitle));
      sc.appendChild(h);
      var ul = mk("ul", "qsitems");
      v.items.forEach(function (it) {
        var t = draft.t[it.id] || {};
        var li = mk("li", "qsitem"); li.setAttribute("data-id", it.id);
        var lab = mk("label", "qschk");
        var cb = mk("input"); cb.type = "checkbox"; cb.checked = !!t.done; cb.setAttribute("data-tick", it.id);
        lab.appendChild(cb);
        var tx = mk("span", "qstext", it.text);
        if (it.confirm) tx.appendChild(mk("b", "qsq", " ?"));
        lab.appendChild(tx);
        li.appendChild(lab);
        var wv = mk("input", "qsitemwho"); wv.type = "text"; wv.maxLength = 40; wv.placeholder = "Who"; wv.value = t.who || "";
        wv.setAttribute("data-who", it.id); wv.setAttribute("aria-label", "Who");
        li.appendChild(wv);
        li.classList.toggle("done", !!t.done);
        ul.appendChild(li);
      });
      sc.appendChild(ul);
      p.appendChild(sc);
    });

    var hc = mk("div", "qscard");
    var hl = mk("label", "qsheldlbl", (doc().heldUp || {}).title || ""); hl.htmlFor = "qsHeld"; hc.appendChild(hl);
    var ta = mk("textarea", "qsheld"); ta.id = "qsHeld"; ta.rows = 3; ta.maxLength = 2000; ta.value = draft.held || "";
    hc.appendChild(ta);
    var row = mk("div", "qsrow");
    var sv = btn(draft.ref ? "Save the fix" : "Save this morning", "big", submit); sv.id = "qsSubmit";
    row.appendChild(sv);
    row.appendChild(btn("Start another crew", "alt", function () { draft = emptyDraft(); saveDraft(); drawToday(); $("qsSaved").textContent = ""; window.scrollTo(0, 0); }));
    hc.appendChild(row);
    var sd = mk("p", "qssaved"); sd.id = "qsSaved"; sd.setAttribute("role", "status"); hc.appendChild(sd);
    p.appendChild(hc);
    p.oninput = onTodayInput; p.onchange = onTodayInput;
    calcLine();
  }

  function onTodayInput(e) {
    var t = e.target;
    if (t.hasAttribute("data-field")) draft.f[t.getAttribute("data-field")] = t.value;
    else if (t.hasAttribute("data-tick")) {
      var id = t.getAttribute("data-tick"); draft.t[id] = draft.t[id] || {}; draft.t[id].done = t.checked;
      var li = t.closest("li"); if (li) li.classList.toggle("done", t.checked);
    } else if (t.hasAttribute("data-who")) { var id2 = t.getAttribute("data-who"); draft.t[id2] = draft.t[id2] || {}; draft.t[id2].who = t.value; }
    else if (t.id === "qsHeld") draft.held = t.value;
    saveDraft(); calcLine();
  }

  function calcLine() {
    var c = $("qsCalc"); if (!c) return;
    var m = minutesBetween(draft.f.clockIn, draft.f.rollOut), men = parseInt(draft.f.menOnCrew, 10);
    c.innerHTML = "";
    c.classList.remove("bad");
    if (m === null) { c.appendChild(mk("span", "qscalcwait", "Fill in " + fieldLabel("clockIn", "clock-in").toLowerCase() + " and " + fieldLabel("rollOut", "roll-out").toLowerCase() + " to see the minutes and man-hours.")); return; }
    if (m < 0) { c.classList.add("bad"); c.appendChild(mk("span", null, "The " + fieldLabel("rollOut", "roll-out").toLowerCase() + " is before the " + fieldLabel("clockIn", "clock-in").toLowerCase() + ".")); return; }
    var a = mk("div", "qsfig"); a.appendChild(mk("b", null, String(m))); a.appendChild(mk("span", null, "minutes, clock-in to roll-out")); a.id = "qsMinutes"; c.appendChild(a);
    var b = mk("div", "qsfig"); b.id = "qsManHours";
    if (isNaN(men)) { b.appendChild(mk("b", null, "?")); b.appendChild(mk("span", null, "man-hours: fill in " + fieldLabel("menOnCrew", "men").toLowerCase())); }
    else { b.appendChild(mk("b", null, num(men * m / 60))); b.appendChild(mk("span", null, "man-hours (" + men + " men x " + m + " minutes / 60)")); }
    c.appendChild(b);
  }

  function entryFromDraft() {
    var ticks = [];
    visibleSections().forEach(function (v) {
      v.items.forEach(function (it) {
        var t = draft.t[it.id] || {};
        ticks.push({ id: it.id, text: it.text, section: v.s.id, done: !!t.done, who: (t.who || "").trim() });
      });
    });
    var f = draft.f;
    return { date: f.date || "", crewLead: f.crewLead || "", men: f.menOnCrew === undefined || f.menOnCrew === "" ? null : f.menOnCrew,
             clockIn: f.clockIn || "", rollOut: f.rollOut || "", job: f.job || "", heldUp: draft.held || "", ticks: ticks };
  }

  function submit() {
    if (busy) return;
    if (!who) { needName(); return; }
    var e = entryFromDraft(), out = $("qsSaved");
    if (!e.date) { out.textContent = "Pick the date first."; out.className = "qssaved bad"; return; }
    busy = true; $("qsSubmit").disabled = true; out.className = "qssaved"; out.textContent = "Saving...";
    R.api("/" + SLUG + "/submit" + Q, { method: "POST", json: { saved_by: who, entry: e, ref: draft.ref } }).then(answer).then(function (x) {
      busy = false; var b = $("qsSubmit"); if (b) b.disabled = false;
      if (x.s === 200 && x.j.ok) {
        var line = "Saved by " + x.j.by + " at " + clock() + ".";
        if (x.j.minutes !== null && x.j.minutes !== undefined) line += " " + x.j.minutes + " minutes clock-in to roll-out" + (x.j.manHours !== null && x.j.manHours !== undefined ? ", " + num(x.j.manHours) + " man-hours." : ".");
        line += " It is on the Log.";
        draft = emptyDraft(); saveDraft(); drawToday();
        var o2 = $("qsSaved"); o2.textContent = line; o2.className = "qssaved good";
        status("Saved " + clock());
        loadLog();
      } else {
        out.className = "qssaved bad"; out.textContent = "Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s));
        if (x.s === 403) needName();
      }
    }).catch(function (err) {
      busy = false; var b = $("qsSubmit"); if (b) b.disabled = false;
      if (err && err.message === "signed out") return;
      out.className = "qssaved bad"; out.textContent = "Not saved: no connection. Your answers are kept on this phone; press Save again when there is signal.";
    });
  }

  /* ---------- THE LIST: edit ---------- */
  function edit(ops, done) {
    if (!who) { needName(); return; }
    status("Saving...");
    R.api("/" + SLUG + "/edit" + Q, { method: "POST", json: { saved_by: who, base: L.ver, ops: ops } }).then(answer).then(function (x) {
      if (x.j && x.j.list) { L = x.j.list; }
      if (x.s === 200 && x.j.ok) { editing = null; status("Saved " + clock()); drawAll(); if (done) done(true); }
      else {
        status("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), true);
        if (x.s === 403) needName();
        if (x.s === 409) { editing = null; drawAll(); }
        if (done) done(false);
      }
    }).catch(function (e) { if (e && e.message !== "signed out") status("Not saved: no connection.", true); if (done) done(false); });
  }

  function renameBox(host, value, onSave, label) {
    host.innerHTML = "";
    var i = mk("input", "qsrename"); i.type = "text"; i.maxLength = 300; i.value = value; i.setAttribute("aria-label", label || "New words");
    host.appendChild(i);
    var row = mk("div", "qsctl");
    var save = function () { var v = i.value.replace(/\s+/g, " ").trim(); if (!v || v === value) { editing = null; drawList(); return; } onSave(v); };
    row.appendChild(btn("Save", "", save));
    row.appendChild(btn("Cancel", "alt", function () { editing = null; drawList(); }));
    host.appendChild(row);
    i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { editing = null; drawList(); } });
    setTimeout(function () { i.focus(); i.select(); }, 20);
  }

  function drawList() {
    var p = $("panel_list"); if (!p) return; p.innerHTML = "";
    var intro = mk("p", "qsnote", "Change the list here. Every change is saved as a new version with your name; nothing is ever deleted. Hidden lines can be brought back. The prints and the Word file always use the list as it stands.");
    p.appendChild(intro);
    var secs = doc().sections;
    secs.forEach(function (s, si) {
      var sc = mk("div", "qscard qseditsec" + (s.hidden ? " hiddenline" : "")); sc.setAttribute("data-sec", s.id);
      var hd = mk("div", "qseditrow qssechead");
      var tx = mk("div", "qseditext");
      if (editing === "S:" + s.id) {
        renameBox(tx, s.title, function (v) { edit([{ op: "set", target: s.id, field: "title", value: v, was: s.title }]); }, "Section title");
      } else if (editing === "U:" + s.id) {
        renameBox(tx, s.subtitle || "", function (v) { edit([{ op: "set", target: s.id, field: "subtitle", value: v, was: s.subtitle || "" }]); }, "Section line");
      } else {
        tx.appendChild(mk("b", null, s.title));
        if (s.subtitle) tx.appendChild(mk("small", null, s.subtitle));
        if (s.hidden) tx.appendChild(mk("em", "qshidtag", "Hidden"));
      }
      hd.appendChild(tx);
      var ctl = mk("div", "qsctl");
      if (!s.hidden) {
        ctl.appendChild(btn("Rename", "alt", function () { editing = "S:" + s.id; drawList(); }));
        ctl.appendChild(btn(s.subtitle ? "Change line" : "Add a line", "alt", function () { editing = "U:" + s.id; drawList(); }));
        if (si > 0) ctl.appendChild(btn("Up", "alt", function () { edit([{ op: "move", target: s.id, dir: "up" }]); }, "Move this section up"));
        if (si < secs.length - 1) ctl.appendChild(btn("Down", "alt", function () { edit([{ op: "move", target: s.id, dir: "down" }]); }, "Move this section down"));
        ctl.appendChild(btn("Hide", "warn", function () { edit([{ op: "hide", target: s.id }]); }));
      } else {
        ctl.appendChild(btn("Bring back", "", function () { edit([{ op: "restore", target: s.id }]); }));
      }
      hd.appendChild(ctl);
      sc.appendChild(hd);
      if (!s.hidden) {
        var ol = mk("ol", "qsedititems");
        var shown = s.items.filter(function (i) { return !i.hidden; });
        s.items.forEach(function (it) {
          if (it.hidden) return;
          var k = shown.indexOf(it);
          var li = mk("li", "qseditrow"); li.setAttribute("data-item", it.id);
          var t = mk("div", "qseditext");
          if (editing === "I:" + it.id) {
            renameBox(t, it.text, function (v) { edit([{ op: "set", target: it.id, field: "text", value: v, was: it.text }]); }, "Item");
          } else {
            t.appendChild(mk("span", null, it.text));
            if (it.confirm) t.appendChild(mk("b", "qsq", " ?"));
          }
          li.appendChild(t);
          var c = mk("div", "qsctl");
          c.appendChild(btn("Rename", "alt", function () { editing = "I:" + it.id; drawList(); }));
          c.appendChild(btn(it.confirm ? "Clear ?" : "Mark ?", "alt qsqbtn", function () { edit([{ op: "set", target: it.id, field: "confirm", value: !it.confirm }]); },
            it.confirm ? "The crews have confirmed it: take the question mark off" : "Not sure about it yet: put a question mark on it"));
          if (k > 0) c.appendChild(btn("Up", "alt", function () { edit([{ op: "move", target: it.id, dir: "up" }]); }));
          if (k < shown.length - 1) c.appendChild(btn("Down", "alt", function () { edit([{ op: "move", target: it.id, dir: "down" }]); }));
          var others = secs.filter(function (o) { return o.id !== s.id && !o.hidden; });
          if (others.length) {
            var sel = mk("select", "qsmove"); sel.setAttribute("aria-label", "Move to another section");
            sel.appendChild(new Option("Move to...", ""));
            others.forEach(function (o) { sel.appendChild(new Option(o.title, o.id)); });
            sel.addEventListener("change", function () { if (sel.value) edit([{ op: "move", target: it.id, to_section: sel.value }]); });
            c.appendChild(sel);
          }
          c.appendChild(btn("Hide", "warn", function () { edit([{ op: "hide", target: it.id }]); }));
          li.appendChild(c);
          ol.appendChild(li);
        });
        sc.appendChild(ol);
        var add = mk("div", "qsadd");
        var ai = mk("input"); ai.type = "text"; ai.maxLength = 300; ai.placeholder = "Add an item to this section"; ai.setAttribute("aria-label", "New item");
        var ab = btn("Add", "", function () { var v = ai.value.replace(/\s+/g, " ").trim(); if (!v) { ai.focus(); return; } edit([{ op: "add_item", section: s.id, text: v }], function (ok) { if (ok) { var n = document.querySelector("[data-sec='" + s.id + "'] .qsadd input"); if (n) n.focus(); } }); });
        ai.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ab.click(); } });
        add.appendChild(ai); add.appendChild(ab);
        sc.appendChild(add);
        var hid = s.items.filter(function (i) { return i.hidden; });
        if (hid.length) {
          var det = mk("details", "qshidden");
          det.appendChild(mk("summary", null, "Hidden items (" + hid.length + ")"));
          hid.forEach(function (it) {
            var r = mk("div", "qseditrow hiddenline");
            r.appendChild(mk("div", "qseditext", it.text + (it.confirm ? " ?" : "")));
            var c2 = mk("div", "qsctl"); c2.appendChild(btn("Bring back", "", function () { edit([{ op: "restore", target: it.id }]); }));
            r.appendChild(c2); det.appendChild(r);
          });
          if (editing === "open:" + s.id) det.open = true;
          sc.appendChild(det);
        }
      }
      p.appendChild(sc);
    });

    var hq = mk("div", "qscard");
    var hr = mk("div", "qseditrow");
    var ht = mk("div", "qseditext");
    var held = doc().heldUp || {};
    if (editing === "H") renameBox(ht, held.title || "", function (v) { edit([{ op: "set", target: "heldUp", field: "title", value: v, was: held.title || "" }]); }, "Closing question");
    else { ht.appendChild(mk("small", null, "The question at the end of the form")); ht.appendChild(mk("b", null, held.title || "")); }
    hr.appendChild(ht);
    var hc = mk("div", "qsctl"); hc.appendChild(btn("Rename", "alt", function () { editing = "H"; drawList(); })); hr.appendChild(hc);
    hq.appendChild(hr); p.appendChild(hq);

    var ns = mk("div", "qscard qsadd qsaddsec");
    var ti = mk("input"); ti.type = "text"; ti.maxLength = 300; ti.placeholder = "Add a section: its title"; ti.setAttribute("aria-label", "New section title");
    var si2 = mk("input"); si2.type = "text"; si2.maxLength = 300; si2.placeholder = "and a short line under it (optional)"; si2.setAttribute("aria-label", "New section line");
    ns.appendChild(ti); ns.appendChild(si2);
    ns.appendChild(btn("Add section", "", function () { var v = ti.value.replace(/\s+/g, " ").trim(); if (!v) { ti.focus(); return; } edit([{ op: "add_section", title: v, subtitle: si2.value }]); }));
    p.appendChild(ns);

    var vd = mk("details", "qscard qsversions"); vd.id = "qsVersions";
    vd.appendChild(mk("summary", null, "Earlier versions"));
    var vl = mk("ol", "qsvlist"); vl.id = "qsVList"; vd.appendChild(vl);
    vd.addEventListener("toggle", function () { if (vd.open) loadVersions(); });
    p.appendChild(vd);
  }

  function loadVersions() {
    var vl = $("qsVList"); if (!vl) return;
    vl.innerHTML = ""; vl.appendChild(mk("li", null, "Loading..."));
    R.apiJSON("/" + SLUG + "/versions" + Q).then(function (d) {
      vl.innerHTML = "";
      (d.versions || []).forEach(function (v) {
        var li = mk("li");
        li.appendChild(mk("span", "qsvwho", "Version " + v.id + ", " + v.saved_by + ", " + R.fmtTs(v.ts_utc)));
        li.appendChild(mk("span", "qsvsum", v.summary));
        if (v.id !== L.ver) {
          var b = btn("Bring this version back", "alt", function () {
            b.hidden = true;
            var y = btn("Yes, bring it back", "", function () {
              if (!who) { needName(); return; }
              R.api("/" + SLUG + "/restore" + Q, { method: "POST", json: { saved_by: who, version: v.id, base: L.ver } }).then(answer).then(function (x) {
                if (x.s === 200 && x.j.ok) { L = x.j.list; status("Saved " + clock()); drawAll(); }
                else status("Not saved: " + ((x.j && x.j.error) || x.s), true);
              });
            });
            var n = btn("No", "alt", function () { y.remove(); n.remove(); b.hidden = false; });
            li.appendChild(y); li.appendChild(n);
          });
          li.appendChild(b);
        } else li.appendChild(mk("em", "qsvnow", "This is the list now"));
        vl.appendChild(li);
      });
    }).catch(function () { vl.innerHTML = ""; vl.appendChild(mk("li", null, "Could not load the versions.")); });
  }

  /* ---------- LOG ---------- */
  function loadLog() {
    R.apiJSON("/" + SLUG + "/log" + Q).then(function (d) { if (d && d.ok) { LOG = d; drawLog(); } }).catch(function () { });
  }

  function cell(tr, text, label, cls) { var td = mk("td", cls || null, text); td.setAttribute("data-label", label); tr.appendChild(td); return td; }

  function drawLog() {
    var p = $("panel_log"); if (!p) return; p.innerHTML = "";
    if (doc().why) p.appendChild(mk("p", "qsnote", doc().why));
    if (!LOG) { p.appendChild(mk("p", null, "Loading...")); return; }
    var wc = mk("div", "qscard");
    wc.appendChild(mk("h2", null, "Startup man-hours by week"));
    if (!LOG.weeks.length) wc.appendChild(mk("p", "qsmuted", "No mornings saved yet."));
    else {
      var wt = mk("table", "qstable qsweeks"); wt.id = "qsWeeks";
      var th = mk("tr"); ["Week ending", "Mornings", "Man-hours", "Average minutes"].forEach(function (h) { th.appendChild(mk("th", null, h)); });
      var thead = mk("thead"); thead.appendChild(th); wt.appendChild(thead);
      var tb = mk("tbody");
      LOG.weeks.forEach(function (w) {
        var tr = mk("tr");
        cell(tr, "Sat " + showDay(w.weekEnding).replace(/^\D+/, ""), "Week ending");
        cell(tr, String(w.mornings), "Mornings");
        cell(tr, num(w.manHours) + (w.missing ? " (" + w.missing + " without times)" : ""), "Man-hours", "qsbig");
        cell(tr, w.avgMinutes === null ? "" : String(w.avgMinutes), "Average minutes");
        tb.appendChild(tr);
      });
      wt.appendChild(tb); wc.appendChild(wt);
    }
    p.appendChild(wc);

    var mc = mk("div", "qscard");
    mc.appendChild(mk("h2", null, "Mornings"));
    if (!LOG.entries.length) mc.appendChild(mk("p", "qsmuted", "Nothing yet. Fill in the Today tab and press Save."));
    else {
      var heads = [fieldLabel("date", "Date"), fieldLabel("crewLead", "Crew lead"), fieldLabel("menOnCrew", "Men"), fieldLabel("clockIn", "Clock-in"),
                   fieldLabel("rollOut", "Roll-out"), "Minutes", "Man-hours", fieldLabel("job", "Job"), (doc().heldUp || {}).title || "", "Saved by", ""];
      var t = mk("table", "qstable qslog"); t.id = "qsLog";
      var hr = mk("tr"); heads.forEach(function (h) { hr.appendChild(mk("th", null, h)); });
      var th2 = mk("thead"); th2.appendChild(hr); t.appendChild(th2);
      var b2 = mk("tbody");
      LOG.entries.forEach(function (e) {
        var tr = mk("tr"); tr.setAttribute("data-entry", e.id);
        cell(tr, showDay(e.date), heads[0]);
        cell(tr, e.crewLead, heads[1]);
        cell(tr, e.men === null ? "" : String(e.men), heads[2]);
        cell(tr, showTime(e.clockIn), heads[3]);
        cell(tr, showTime(e.rollOut), heads[4]);
        cell(tr, e.minutes === null ? "" : String(e.minutes), heads[5], "qsmin");
        cell(tr, e.manHours === null ? "" : num(e.manHours), heads[6], "qsmh qsbig");
        cell(tr, e.job, heads[7]);
        cell(tr, e.heldUp, heads[8], "qsheldcell");
        cell(tr, e.by + ", " + R.fmtTs(e.ts) + (e.items ? " (" + e.ticked + " of " + e.items + " ticked)" : ""), heads[9], "qsmuted");
        var act = mk("td", "qsacts"); act.setAttribute("data-label", "");
        act.appendChild(btn("Fix", "alt", function () { fixEntry(e); }));
        if (confirmVoid === e.id) {
          act.appendChild(btn("Yes, take it off", "warn", function () { voidEntry(e.id); }));
          act.appendChild(btn("No", "alt", function () { confirmVoid = null; drawLog(); }));
        } else act.appendChild(btn("Take off the log", "alt", function () { confirmVoid = e.id; drawLog(); }));
        tr.appendChild(act);
        b2.appendChild(tr);
      });
      t.appendChild(b2); mc.appendChild(t);
    }
    p.appendChild(mc);
  }

  function fixEntry(e) {
    draft = { f: { date: e.date, crewLead: e.crewLead, menOnCrew: e.men === null ? "" : String(e.men), clockIn: e.clockIn, rollOut: e.rollOut, job: e.job },
              t: {}, held: e.heldUp || "", ref: e.id, refLine: "the morning of " + showDay(e.date) + (e.crewLead ? ", " + e.crewLead : "") };
    (e.ticks || []).forEach(function (t) { draft.t[t.id] = { done: !!t.done, who: t.who || "" }; });
    saveDraft(); drawToday(); pick("today"); window.scrollTo(0, 0);
  }

  function voidEntry(id) {
    if (!who) { needName(); return; }
    R.api("/" + SLUG + "/void" + Q, { method: "POST", json: { saved_by: who, id: id } }).then(answer).then(function (x) {
      confirmVoid = null;
      if (x.s === 200 && x.j.ok) { status("Taken off the log " + clock()); loadLog(); }
      else { status("Not done: " + ((x.j && x.j.error) || x.s), true); drawLog(); }
    });
  }

  /* ---------- poll ---------- */
  function poll() {
    if (document.hidden) return;
    R.apiJSON("/" + SLUG + "/board?part=state" + (TEST ? "&as=TEST" : "")).then(function (d) {
      if (!d || !d.ok || !d.list || d.list.ver === L.ver) return;
      if (editing || (document.activeElement && document.activeElement.closest && document.activeElement.closest("#panel_list"))) return;
      L = d.list; drawAll(); status("The list was changed by " + L.by + ". This is the new version.");
    }).catch(function () { });
    if (tab === "log") loadLog();
  }

  /* ---------- print: big paper (25 x 30 in flip chart) and Letter, built from the current list ---------- */
  function prepPrint(kind) {
    var big = kind === "big";
    $("qsPageSize").textContent = big ? "@page { size: 25in 30in; margin: 0.9in; }" : "@page { size: letter; margin: 0.5in 0.55in 0.55in; }";
    document.body.setAttribute("data-print", big ? "big" : "letter");
    var pr = $("qsPrint"); pr.innerHTML = ""; pr.className = "qsprint " + (big ? "pbig" : "pletter");
    var top = mk("div", "ptop");
    if (LOGO) { var im = mk("img", "plogo"); im.src = LOGO; im.alt = ""; top.appendChild(im); }
    top.appendChild(mk("h1", null, doc().title || ""));
    pr.appendChild(top);
    if (big && doc().note) pr.appendChild(mk("p", "pnote", doc().note));
    var hf = mk("div", "pfields");
    (doc().headerFields || []).forEach(function (f) { var d = mk("div", "pfield"); d.appendChild(mk("span", null, f.label)); d.appendChild(mk("i")); hf.appendChild(d); });
    pr.appendChild(hf);
    var cols = doc().columns || ["Done", "Item", "Who"];
    visibleSections().forEach(function (v, i) {
      var s = mk("section", "psec" + (big && i > 0 ? " pbreak" : ""));
      var h = mk("h2"); h.appendChild(mk("span", null, v.s.title)); if (v.s.subtitle) h.appendChild(mk("small", null, v.s.subtitle)); s.appendChild(h);
      var t = mk("table", "ptable");
      var hr = mk("tr"); cols.slice(0, 3).forEach(function (c) { hr.appendChild(mk("th", null, c)); });
      var th = mk("thead"); th.appendChild(hr); t.appendChild(th);
      var tb = mk("tbody");
      v.items.concat([null, null, big ? null : undefined].filter(function (x) { return x !== undefined; })).forEach(function (it) {
        var tr = mk("tr", it ? null : "pblank");
        var d = mk("td", "pdone"); d.appendChild(mk("span", "pbox")); tr.appendChild(d);
        var tx = mk("td", "pitem"); if (it) { tx.appendChild(mk("span", null, it.text)); if (it.confirm) tx.appendChild(mk("b", "pq", " ?")); } tr.appendChild(tx);
        tr.appendChild(mk("td", "pwho"));
        tb.appendChild(tr);
      });
      t.appendChild(tb); s.appendChild(t);
      pr.appendChild(s);
    });
    var hq = mk("section", "psec pheld");
    hq.appendChild(mk("h2", null, (doc().heldUp || {}).title || ""));
    for (var k = 0; k < (big ? 4 : 3); k++) hq.appendChild(mk("div", "pline"));
    pr.appendChild(hq);
    pr.appendChild(mk("p", "pfoot", "Version " + L.ver + " of the list, printed " + new Date().toLocaleDateString()));
  }
  function doPrint(kind) { prepPrint(kind); setTimeout(function () { window.print(); }, 60); }
  window.__qsPrep = prepPrint;   /* used by the automated print test */
})();
