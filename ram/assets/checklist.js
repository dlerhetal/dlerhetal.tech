/* Job-day checklist page: a form for the day, an editable list, a log of hours against a goal, and a one-page print.
   Generic: nothing in this file names a client or a person, and it holds none of the checklist's wording or figures.
   The kinds of day, each list, its headings, the field labels, the goal and the closing question all arrive from the
   API after sign-in.

   One page serves several kinds of day. GET /api/<name>/days lists the ones that are published; every other call
   goes to /api/<name>/<day>/. The server holds each list as versions (append-only); the print is built from the
   current one. The name is typed once in the top bar (kept in this browser, inside try/catch). An unsent form is
   kept in this browser too, so a reload does not lose it; it is cleared once the server has it. */
(function () {
  "use strict";
  var R = window.RAM;
  var NAME = (document.body.getAttribute("data-list") || "checklist").replace(/[^a-z0-9_-]/gi, "");
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var NSK = R.NS.slice(1);
  var WHO_KEY = NSK + "_" + NAME + "_who";
  var OTHER_WHO = [NSK + "_quickstart_who", NSK + "_growth_who", NSK + "_team_who", NSK + "_plan_who"];
  var DAY_KEY = NSK + "_" + NAME + "_day";
  var TAB_KEY = NSK + "_" + NAME + "_tab";
  var TABS = [["today", "Today"], ["list", "The list"], ["log", "Log"]];
  var HUB = null, DAY = "", L = null, LOGO = "", TODAY = "", LOG = null, who = "", tab = "today";
  var draft = null, busy = false, confirmVoid = null;
  var editMode = false, menuOpen = null, flash = null, pending = [], queue = Promise.resolve(), inflight = 0;
  var redrawing = false, keepAfter = null, openHidden = {}, openInfo = {}, openNote = {};

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
  function base() { return "/" + NAME + "/" + DAY; }
  function draftKey() { return NSK + "_" + NAME + "_" + DAY + "_draft" + (TEST ? "_test" : ""); }
  function visibleSections() { return doc().sections.filter(function (s) { return !s.hidden; }).map(function (s) { return { s: s, items: s.items.filter(function (i) { return !i.hidden; }) }; }); }
  function fieldLabel(key, dflt) { var f = (doc().headerFields || []).filter(function (x) { return x.key === key; })[0]; return f ? f.label : dflt; }
  function goal() { var g = (doc().goal || {}).manHours; return typeof g === "number" && g > 0 ? g : null; }
  function showDay(iso) { try { var p = iso.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }); } catch (e) { return iso; } }
  function showTime(t) { if (!t) return ""; var p = t.split(":"); var h = +p[0], m = p[1]; return ((h % 12) || 12) + ":" + m + (h < 12 ? " AM" : " PM"); }
  function minutesBetween(a, b) {
    var ma = /^(\d{1,2}):(\d{2})$/.exec(a || ""), mb = /^(\d{1,2}):(\d{2})$/.exec(b || "");
    if (!ma || !mb) return null;
    var x = +ma[1] * 60 + +ma[2], y = +mb[1] * 60 + +mb[2];
    return y >= x ? y - x : -1;
  }
  function num(v) { return (Math.round(v * 100) / 100).toString(); }
  /* man-hours always show at least one decimal place */
  function mhText(v) { var r = Math.round(v * 100) / 100; return Math.round(r * 10) === r * 10 ? r.toFixed(1) : r.toFixed(2); }
  /* against the goal, in words: never by color alone */
  function against(mh) {
    var g = goal(); if (g === null || mh === null || mh === undefined) return null;
    var d = Math.round((mh - g) * 100) / 100;
    if (d > 0) return { over: true, text: mhText(d) + " over the goal" };
    if (d === 0) return { over: false, text: "At the goal" };
    return { over: false, text: mhText(-d) + " under the goal" };
  }

  R.gate(function () {
    R.apiJSON("/" + NAME + "/days" + Q).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "The page could not be loaded.");
      if (!d.days || !d.days.length) throw new Error("Nothing is published here yet.");
      HUB = d;
      var want = load(DAY_KEY);
      DAY = d.days.some(function (x) { return x.key === want; }) ? want : d.days[d.days.length - 1].key;
      return loadBoard();
    }).then(function (d) { start(d); })
      .catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function loadBoard() {
    return R.apiJSON(base() + "/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.list) throw new Error((d && d.error) || "The page could not be loaded.");
      return d;
    });
  }

  function start(d) {
    L = d.list; LOGO = d.logo || ""; TODAY = localDate();
    who = TEST ? "TEST by Claude" : readWho();
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../assets/checklist.css?v=1";
    var go = function () {
      go = function () { };
      document.title = HUB.title || "Working page";
      readDraft();
      frame();
      drawAll();
      var h = (location.hash || "").replace("#", "");
      pick(["today", "list", "log"].indexOf(h) >= 0 ? h : (load(TAB_KEY) || "today"));
      loadLog();
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      window.addEventListener("resize", fitAll);
      window.addEventListener("beforeprint", function () { if (!document.body.getAttribute("data-print")) prepPrint(); });
      window.addEventListener("afterprint", function () { document.body.removeAttribute("data-print"); });
      document.body.setAttribute("data-qs-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- frame: top bar, header band, kind-of-day picker, tabs, print button ---------- */
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
      if (who && pending.length) { var pp = pending; pending = []; pp.forEach(function (x) { edit(x.ops, x.opts); }); }
    });
    wi.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); wi.blur(); } });
    wl.appendChild(wi); nav.appendChild(wl);
    var st = mk("span", "qsstatus"); st.id = "qsStatus"; st.setAttribute("role", "status"); nav.appendChild(st);
    var hub = mk("a", "qsout", "All tools"); hub.href = "../"; nav.appendChild(hub);
    var out = mk("a", "qsout", "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);

    var head = mk("header", "qshead noprint");
    var hw = mk("div", "qswrap");
    hw.appendChild(mk("p", "qskicker", HUB.title || ""));
    var h1 = mk("h1"); h1.id = "qsTitle"; hw.appendChild(h1);
    if (HUB.days.length > 1) {
      var dp = mk("div", "qsdays"); dp.id = "qsDays";
      HUB.days.forEach(function (x) {
        var b = mk("button", "qsday" + (x.key === DAY ? " on" : ""), x.title); b.type = "button"; b.setAttribute("data-day", x.key);
        b.addEventListener("click", function () { switchDay(x.key); });
        dp.appendChild(b);
      });
      hw.appendChild(dp);
    }
    if (HUB.comingNote) { var cn = mk("p", "qscoming", HUB.comingNote); cn.id = "qsComing"; hw.appendChild(cn); }
    var sub = mk("p", "qssub"); sub.id = "qsChanged"; hw.appendChild(sub);
    var tabs = mk("div", "qstabs"); tabs.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = mk("button", "qstab", t[1]); b.type = "button"; b.id = "tab_" + t[0]; b.setAttribute("role", "tab");
      b.addEventListener("click", function () { pick(t[0]); });
      tabs.appendChild(b);
    });
    hw.appendChild(tabs);
    head.appendChild(hw);
    document.body.insertBefore(head, nav.nextSibling);

    var main = mk("main", "qswrap noprint"); main.id = "qsMain";
    var tools = mk("div", "qstools");
    var pb = btn("Print the sheet for the truck", "alt", function () { doPrint(); }); pb.id = "qsPrintBtn";
    tools.appendChild(pb);
    main.appendChild(tools);
    TABS.forEach(function (t) { var p = mk("section", "qspanel"); p.id = "panel_" + t[0]; p.setAttribute("role", "tabpanel"); main.appendChild(p); });
    document.body.insertBefore(main, head.nextSibling);
    var pr = mk("div", "qsprint"); pr.id = "qsPrint"; document.body.insertBefore(pr, main.nextSibling);
    var ps = document.createElement("style"); ps.id = "qsPageSize"; document.head.appendChild(ps);
  }

  function switchDay(key) {
    if (key === DAY || inflight) return;
    var old = DAY; DAY = key;
    status("Loading...");
    loadBoard().then(function (d) {
      L = d.list; LOG = null; store(DAY_KEY, key); editMode = false; openInfo = {}; openNote = {}; confirmVoid = null;
      var bs = document.querySelectorAll(".qsday"); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-day") === key);
      readDraft(); drawAll(); loadLog(); status("");
    }).catch(function (e) { DAY = old; if (e && e.message !== "signed out") status(e.message || "Could not load.", true); });
  }

  function pick(t) {
    tab = t; store(TAB_KEY, t);
    TABS.forEach(function (x) {
      $("panel_" + x[0]).hidden = x[0] !== t;
      var b = $("tab_" + x[0]); b.classList.toggle("on", x[0] === t); b.setAttribute("aria-selected", x[0] === t ? "true" : "false");
    });
    if (t === "log") loadLog();
    closeMenus(); fitAll();
    try { history.replaceState(null, "", location.pathname + location.search + "#" + t); } catch (e) { }
  }

  function status(text, bad) { var s = $("qsStatus"); if (s) { s.textContent = text; s.classList.toggle("bad", !!bad); } }
  function needName(forEdit) {
    var wl = $("qsWhoLabel"); if (wl) wl.classList.add("need");
    status(forEdit ? "Type your name here first; your change saves as soon as you do." : "Type your name at the top first.", true);
    var w = $("qsWho"); if (w) { w.focus(); try { w.scrollIntoView({ block: "nearest" }); } catch (e) { } }
  }

  function drawAll() {
    $("qsTitle").textContent = doc().title || "";
    $("qsChanged").textContent = "Last changed by " + L.by + ", " + R.fmtTs(L.ts) + " (version " + L.ver + ")";
    drawToday(); drawList(); drawLog();
  }

  function banner(host) { if (doc().note) { var n = mk("p", "qsnote qsdraft", doc().note); host.appendChild(n); } }

  /* ---------- TODAY: the form for one day on one job ---------- */
  function emptyDraft() { return { f: { date: TODAY }, t: {}, held: "", ref: null, refLine: "" }; }
  function readDraft() {
    draft = null;
    try { draft = JSON.parse(load(draftKey()) || "null"); } catch (e) { draft = null; }
    if (!draft || typeof draft !== "object" || !draft.f) draft = emptyDraft();
    if (!draft.f.date) draft.f.date = TODAY;
    draft.t = draft.t || {};
  }
  function saveDraft() { store(draftKey(), JSON.stringify(draft)); }

  function inputFor(f) {
    var i = mk("input"); i.id = "qf_" + f.key; i.setAttribute("data-field", f.key);
    if (f.key === "date") i.type = "date";
    else if (f.key === "start" || f.key === "finish") i.type = "time";
    else if (f.key === "men") { i.type = "number"; i.min = "1"; i.max = "99"; i.step = "1"; i.inputMode = "numeric"; }
    else if (f.key === "hours") { i.type = "number"; i.min = "0"; i.max = "24"; i.step = "0.25"; i.inputMode = "decimal"; }
    else { i.type = "text"; i.maxLength = f.key === "job" ? 120 : 40; }
    i.value = draft.f[f.key] || "";
    return i;
  }

  function drawToday() {
    var p = $("panel_today"); p.innerHTML = "";
    banner(p);
    var bar = mk("div", "qsedbar" + (editMode ? " on" : ""));
    var tg = mk("button", "qsedtoggle" + (editMode ? " on" : "")); tg.type = "button"; tg.id = "qsEditToggle";
    tg.setAttribute("aria-pressed", editMode ? "true" : "false");
    tg.appendChild(mk("span", "qsknob")); tg.appendChild(mk("span", null, "Edit the list"));
    tg.addEventListener("click", function () {
      editMode = !editMode; closeMenus(); drawToday(); fitAll();
      status(editMode ? "Editing the list. Tap a line to change it." : "");
    });
    bar.appendChild(tg);
    bar.appendChild(mk("span", "qsedhint", editMode
      ? "Changes save for everyone as you make them. Turn this off to tick the list again."
      : "Turn on to change, add, move or archive steps."));
    p.appendChild(bar);
    if (editMode) { p.oninput = null; p.onchange = null; drawEditor(p); return; }
    if (draft.ref) {
      var fx = mk("div", "qsfixing");
      fx.appendChild(mk("span", null, "Fixing " + draft.refLine + ". Saving replaces it on the log."));
      fx.appendChild(btn("Cancel the fix", "alt", function () { draft = emptyDraft(); saveDraft(); drawToday(); }));
      p.appendChild(fx);
    }
    var card = mk("div", "qscard");
    var grid = mk("div", "qsfields");
    (doc().headerFields || []).forEach(function (f) {
      var w = mk("label", "qsfield qsf_" + f.key);
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
        if (it.info) {
          var ib = mk("button", "qsi", "i"); ib.type = "button"; ib.setAttribute("aria-label", "More about this step");
          ib.setAttribute("aria-expanded", openInfo[it.id] ? "true" : "false"); ib.setAttribute("data-info", it.id);
          var note = mk("p", "qsinfo", it.info); note.hidden = !openInfo[it.id];
          ib.addEventListener("click", function () {
            openInfo[it.id] = !openInfo[it.id]; note.hidden = !openInfo[it.id];
            ib.setAttribute("aria-expanded", openInfo[it.id] ? "true" : "false"); ib.classList.toggle("on", !!openInfo[it.id]);
          });
          if (openInfo[it.id]) ib.classList.add("on");
          li.appendChild(ib); li.appendChild(note);
        }
        li.classList.toggle("done", !!t.done);
        ul.appendChild(li);
      });
      if (!v.items.length) ul.appendChild(mk("li", "qsmuted", "No steps here yet. Turn on Edit the list to add them."));
      sc.appendChild(ul);
      p.appendChild(sc);
    });

    var hc = mk("div", "qscard");
    var held = doc().heldUp || {};
    var hl = mk("label", "qsheldlbl", held.title || ""); hl.htmlFor = "qsHeld"; hc.appendChild(hl);
    var ta = mk("textarea", "qsheld"); ta.id = "qsHeld"; ta.rows = 3; ta.maxLength = 2000; ta.value = draft.held || "";
    if ((held.picks || []).length) {
      var chips = mk("div", "qschips");
      held.picks.forEach(function (w) {
        chips.appendChild(btn(w, "alt chip", function () {
          var cur = ta.value.replace(/\s+$/, "");
          ta.value = cur ? cur + (/[.,;:]$/.test(cur) ? " " : ", ") + w : w;
          draft.held = ta.value; saveDraft();
        }));
      });
      hc.appendChild(chips);
    }
    hc.appendChild(ta);
    var row = mk("div", "qsrow");
    var sv = btn(draft.ref ? "Save the fix" : "Save this day", "big", submit); sv.id = "qsSubmit";
    row.appendChild(sv);
    row.appendChild(btn("Start another job", "alt", function () { draft = emptyDraft(); saveDraft(); drawToday(); $("qsSaved").textContent = ""; window.scrollTo(0, 0); }));
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
    } else if (t.id === "qsHeld") draft.held = t.value;
    saveDraft(); calcLine();
  }

  /* hours for the form: the two times when both are there, else the hours typed in */
  function draftHours() {
    var m = minutesBetween(draft.f.start, draft.f.finish);
    if (m !== null) return m < 0 ? -1 : m / 60;
    var h = parseFloat(draft.f.hours);
    return isNaN(h) || h <= 0 ? null : h;
  }

  function fig(id, big, small) { var a = mk("div", "qsfig"); a.id = id; a.appendChild(mk("b", null, big)); a.appendChild(mk("span", null, small)); return a; }

  function calcLine() {
    var c = $("qsCalc"); if (!c) return;
    var h = draftHours(), men = parseInt(draft.f.men, 10), g = goal();
    var lS = fieldLabel("start", "start").toLowerCase(), lF = fieldLabel("finish", "finish").toLowerCase(), lM = fieldLabel("men", "men").toLowerCase();
    c.innerHTML = ""; c.classList.remove("bad");
    if (h === null) {
      c.appendChild(mk("span", "qscalcwait", "Fill in " + lS + " and " + lF + " (or the hours) and " + lM + " to see the man-hours" + (g !== null ? " against the goal of " + num(g) + "." : ".")));
      return;
    }
    if (h < 0) { c.classList.add("bad"); c.appendChild(mk("span", null, "The " + lF + " time is before the " + lS + " time.")); return; }
    c.appendChild(fig("qsHours", num(h), "hours"));
    if (isNaN(men)) c.appendChild(fig("qsManHours", "?", "man-hours: fill in " + lM));
    else {
      var mh = Math.round(men * h * 100) / 100;
      c.appendChild(fig("qsManHours", mhText(mh), "man-hours (" + men + " x " + num(h) + ")"));
      var ag = against(mh);
      if (ag) { var f = fig("qsGoal", num(g), "is the goal. " + ag.text + "."); f.classList.add(ag.over ? "over" : "met"); c.appendChild(f); }
    }
  }

  function entryFromDraft() {
    var ticks = [];
    visibleSections().forEach(function (v) {
      v.items.forEach(function (it) {
        var t = draft.t[it.id] || {};
        ticks.push({ id: it.id, text: it.text, section: v.s.id, done: !!t.done });
      });
    });
    var f = draft.f, blank = function (v) { return v === undefined || v === "" ? null : v; };
    return { date: f.date || "", job: f.job || "", crewLead: f.crewLead || "", men: blank(f.men), start: f.start || "", finish: f.finish || "",
             hours: blank(f.hours), heldUp: draft.held || "", ticks: ticks };
  }

  function submit() {
    if (busy) return;
    if (!who) { needName(); return; }
    var e = entryFromDraft(), out = $("qsSaved");
    if (!e.date) { out.textContent = "Pick the date first."; out.className = "qssaved bad"; return; }
    busy = true; $("qsSubmit").disabled = true; out.className = "qssaved"; out.textContent = "Saving...";
    R.api(base() + "/submit" + Q, { method: "POST", json: { saved_by: who, entry: e, ref: draft.ref } }).then(answer).then(function (x) {
      busy = false; var b = $("qsSubmit"); if (b) b.disabled = false;
      if (x.s === 200 && x.j.ok) {
        var line = "Saved by " + x.j.by + " at " + clock() + ".";
        if (x.j.manHours !== null && x.j.manHours !== undefined) {
          var ag = against(x.j.manHours);
          line += " " + mhText(x.j.manHours) + " man-hours" + (ag ? ": " + ag.text.toLowerCase() + "." : ".");
        } else line += " No man-hours yet: the times or the head count are missing. Use Fix on the Log to add them.";
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

  /* ---------- THE LIST: one inline editor, used on "The list" and on Today when "Edit the list" is on ----------
     Every step, section title and section line is a text field that looks like plain text until hovered or tapped.
     Leaving the field (or Enter) saves it as ONE new version; Esc puts the words back. One small menu per step moves,
     marks or archives it. Every change goes to the server as operations and comes back as a new version. */
  function edit(ops, opts) {
    opts = opts || {};
    if (!who) { pending.push({ ops: ops, opts: opts }); needName(true); return false; }
    inflight++;
    status("Saving...");
    var p = queue.then(function () {
      return R.api(base() + "/edit" + Q, { method: "POST", json: { saved_by: who, base: L.ver, ops: ops } }).then(answer).then(function (x) {
        if (x.j && x.j.list) L = x.j.list;
        if (x.s === 200 && x.j.ok) { status("Saved " + clock()); setFlash(opts.key, true, opts.okText || "Saved"); return true; }
        var msg = (x.j && x.j.error) || ("the server answered " + x.s);
        status("Not saved: " + msg, true);
        setFlash(opts.key, false, "Not saved: " + msg);
        if (x.s === 403) { pending.push({ ops: ops, opts: opts }); needName(true); }
        if (x.s !== 409 && opts.keep) keepAfter = opts.keep;
        return false;
      }).catch(function (e) {
        if (e && e.message === "signed out") return false;
        status("Not saved: no connection.", true);
        setFlash(opts.key, false, "Not saved: no connection. Try again.");
        if (opts.keep) keepAfter = opts.keep;
        return false;
      }).then(function (ok) { inflight--; redraw(); return ok; });
    });
    queue = p.catch(function () { });
    return true;
  }

  function setFlash(key, ok, text) {
    if (!key) return;
    flash = { key: key, ok: ok, text: text, n: (flash ? flash.n : 0) + 1 };
    var n = flash.n;
    setTimeout(function () { if (flash && flash.n === n && flash.ok) { flash = null; var t = document.querySelectorAll(".qstick.good"); for (var i = 0; i < t.length; i++) t[i].remove(); } }, 2600);
  }

  function panelNow() { return $("panel_" + tab); }
  function byKey(host, key) { return host ? host.querySelector('[data-ek="' + key.replace(/["\\]/g, "") + '"]') : null; }
  function fit(t) { if (t && t.tagName === "TEXTAREA") { t.style.height = "auto"; if (t.scrollHeight) t.style.height = t.scrollHeight + "px"; } }
  function fitAll() { var h = panelNow(); if (!h) return; var ts = h.querySelectorAll("textarea.qsinl"); for (var i = 0; i < ts.length; i++) fit(ts[i]); }

  function showTick(key, ok, text) {
    var f = byKey(panelNow(), key); if (!f) return;
    var host = f.parentNode, old = host.querySelector(".qstick");
    if (old) old.remove();
    var t = mk("span", "qstick " + (ok ? "good" : "bad"), (ok ? "\u2713 " : "") + text); t.setAttribute("role", "status");
    if (f.nextSibling) host.insertBefore(t, f.nextSibling); else host.appendChild(t);
  }

  /* Redraw after a save, keeping the field the person moved to (and anything already typed in it). */
  function redraw() {
    var ae = document.activeElement, key = ae && ae.getAttribute ? ae.getAttribute("data-ek") : null, val = null, s0 = 0, s1 = 0;
    if (key) { val = ae.value; try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch (e) { } }
    redrawing = true;
    try { drawAll(); } finally { redrawing = false; }
    var host = panelNow();
    if (keepAfter) { var k = byKey(host, keepAfter.key); if (k) { k.value = keepAfter.value; k.classList.add("dirty"); } keepAfter = null; }
    if (key) {
      var n = byKey(host, key);
      if (n) {
        if (val !== null && val !== n.getAttribute("data-orig") && n.getAttribute("data-orig") !== null) { n.value = val; n.classList.add("dirty"); }
        n.focus(); try { n.setSelectionRange(s0, s1); } catch (e) { }
      }
    }
    fitAll();
    if (flash) showTick(flash.key, flash.ok, flash.text);
  }

  function inl(key, value, cls, label, placeholder, onCommit, allowEmpty, max) {
    var t = mk("textarea", "qsinl " + cls); t.rows = 1; t.maxLength = max || 300; t.value = value;
    t.setAttribute("data-ek", key); t.setAttribute("data-orig", value); t.setAttribute("aria-label", label);
    t.setAttribute("enterkeyhint", "done"); t.title = "Tap to change the words";
    if (placeholder) t.placeholder = placeholder;
    var esc = false;
    t.addEventListener("input", function () { fit(t); t.classList.toggle("dirty", t.value !== t.getAttribute("data-orig")); });
    t.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); t.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); esc = true; t.value = t.getAttribute("data-orig"); t.classList.remove("dirty"); fit(t); t.blur(); }
    });
    t.addEventListener("blur", function () {
      if (redrawing) return;
      if (esc) { esc = false; return; }
      var o = t.getAttribute("data-orig"), v = t.value.replace(/\s+/g, " ").trim();
      if (v === o) { t.value = o; t.classList.remove("dirty"); fit(t); return; }
      if (!v && !allowEmpty) { t.value = o; t.classList.remove("dirty"); fit(t); showTick(key, false, "An empty line is not saved. To take a step off, use \u22EF and Archive."); return; }
      t.value = v; fit(t);
      onCommit(v, o);
    });
    return t;
  }

  function menu(key, label, ents) {
    var w = mk("div", "qsmenuw");
    var b = mk("button", "qsdots", "\u22EF"); b.type = "button"; b.title = label;
    b.setAttribute("aria-label", label); b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false"); b.setAttribute("data-menu", key);
    var m = mk("div", "qsmenu"); m.setAttribute("role", "menu"); m.hidden = true;
    ents.forEach(function (e) {
      var x = mk("button", "qsmi" + (e[2] ? " " + e[2] : ""), e[0]); x.type = "button"; x.setAttribute("role", "menuitem");
      x.addEventListener("click", function (ev) { ev.stopPropagation(); closeMenus(); e[1](); });
      m.appendChild(x);
    });
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var opening = m.hidden;
      closeMenus();
      if (opening) { m.hidden = false; w.classList.add("open"); b.setAttribute("aria-expanded", "true"); menuOpen = key; }
    });
    w.appendChild(b); w.appendChild(m);
    return w;
  }
  function closeMenus() {
    menuOpen = null;
    var ws = document.querySelectorAll(".qsmenuw.open");
    for (var i = 0; i < ws.length; i++) {
      ws[i].classList.remove("open");
      ws[i].querySelector(".qsmenu").hidden = true;
      ws[i].querySelector(".qsdots").setAttribute("aria-expanded", "false");
    }
  }
  document.addEventListener("click", function (e) { if (menuOpen && !(e.target.closest && e.target.closest(".qsmenuw"))) closeMenus(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menuOpen) closeMenus(); });

  function clean(v) { return (v || "").replace(/\s+/g, " ").trim(); }

  function addRow(key, placeholder, label, onAdd) {
    var add = mk("div", "qsadd");
    var ai = mk("input"); ai.type = "text"; ai.maxLength = 300; ai.placeholder = placeholder; ai.setAttribute("aria-label", label);
    ai.setAttribute("data-ek", key); ai.setAttribute("enterkeyhint", "done");
    var go = function () { var v = clean(ai.value); if (!v) { ai.focus(); return; } if (onAdd(v)) ai.value = ""; };
    ai.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    add.appendChild(ai);
    add.appendChild(btn("Add", "alt", go));
    return add;
  }

  function drawEditor(host) {
    var wrap = mk("div", "qsedwrap");
    var secs = doc().sections;
    var shownSecs = secs.filter(function (s) { return !s.hidden; });
    shownSecs.forEach(function (s, si) {
      var sc = mk("div", "qscard qseditsec"); sc.setAttribute("data-sec", s.id);
      var hd = mk("div", "qsedrow qssechead");
      var tx = mk("div", "qsedtext");
      tx.appendChild(inl("st:" + s.id, s.title, "qsinltitle", "Section title", "Section title", function (v, o) {
        edit([{ op: "set", target: s.id, field: "title", value: v, was: o }], { key: "st:" + s.id, keep: { key: "st:" + s.id, value: v } });
      }));
      tx.appendChild(inl("su:" + s.id, s.subtitle || "", "qsinlsub", "Short line under the section title", "Add a short line under the title (optional)", function (v, o) {
        edit([{ op: "set", target: s.id, field: "subtitle", value: v, was: o }], { key: "su:" + s.id, keep: { key: "su:" + s.id, value: v } });
      }, true));
      hd.appendChild(tx);
      var se = [];
      if (si > 0) se.push(["Move section up", function () { edit([{ op: "move", target: s.id, dir: "up" }], { key: "st:" + s.id, okText: "Moved" }); }]);
      if (si < shownSecs.length - 1) se.push(["Move section down", function () { edit([{ op: "move", target: s.id, dir: "down" }], { key: "st:" + s.id, okText: "Moved" }); }]);
      se.push(["Archive this section", function () { edit([{ op: "hide", target: s.id }]); }, "warn"]);
      hd.appendChild(menu("ms:" + s.id, "More for this section", se));
      sc.appendChild(hd);

      var ul = mk("ul", "qsedlist");
      var shown = s.items.filter(function (i) { return !i.hidden; });
      var others = shownSecs.filter(function (o) { return o.id !== s.id; });
      shown.forEach(function (it, k) {
        var li = mk("li", "qsedrow qseditem"); li.setAttribute("data-item", it.id);
        var c = mk("div", "qsedtext");
        c.appendChild(inl("t:" + it.id, it.text, "qsinlitem", "Step", "", function (v, o) {
          edit([{ op: "set", target: it.id, field: "text", value: v, was: o }], { key: "t:" + it.id, keep: { key: "t:" + it.id, value: v } });
        }));
        if (it.info || openNote[it.id]) {
          c.appendChild(mk("small", "qsedlabel", "The note behind the \u201Ci\u201D (leave it empty for none)"));
          c.appendChild(inl("n:" + it.id, it.info || "", "qsinlsub qsinlnote", "The note behind the i", "Type the note. It stays off the step and opens when the i is tapped.", function (v, o) {
            edit([{ op: "set", target: it.id, field: "info", value: v, was: o }], { key: "n:" + it.id, keep: { key: "n:" + it.id, value: v } });
          }, true, 600));
        }
        if (it.src) {
          var sd = mk("details", "qssrc");
          sd.appendChild(mk("summary", null, "Where this starter step came from"));
          sd.appendChild(mk("p", null, it.src));
          c.appendChild(sd);
        }
        li.appendChild(c);
        if (it.confirm) { var q = mk("b", "qsqbadge", "?"); q.title = "Not confirmed yet"; li.appendChild(q); }
        var ie = [];
        if (k > 0) ie.push(["Move up", function () { edit([{ op: "move", target: it.id, dir: "up" }], { key: "t:" + it.id, okText: "Moved" }); }]);
        if (k < shown.length - 1) ie.push(["Move down", function () { edit([{ op: "move", target: it.id, dir: "down" }], { key: "t:" + it.id, okText: "Moved" }); }]);
        others.forEach(function (o) { ie.push(["Move to \u201C" + o.title + "\u201D", function () { edit([{ op: "move", target: it.id, to_section: o.id }], { key: "t:" + it.id, okText: "Moved here" }); }]); });
        ie.push([it.confirm ? "Clear the \u201C?\u201D" : "Mark \u201C?\u201D (not sure yet)", function () {
          edit([{ op: "set", target: it.id, field: "confirm", value: !it.confirm }], { key: "t:" + it.id, okText: it.confirm ? "\u201C?\u201D cleared" : "Marked \u201C?\u201D" });
        }]);
        if (!it.info && !openNote[it.id]) ie.push(["Add a note behind an \u201Ci\u201D", function () {
          openNote[it.id] = true; redraw(); var n = byKey(panelNow(), "n:" + it.id); if (n) n.focus();
        }]);
        ie.push(["Archive this step", function () { edit([{ op: "hide", target: it.id }], { key: "add:" + s.id, okText: "Archived. It is under \u201CArchived steps\u201D." }); }, "warn"]);
        li.appendChild(menu("mi:" + it.id, "More for this step", ie));
        ul.appendChild(li);
      });
      sc.appendChild(ul);
      sc.appendChild(addRow("add:" + s.id, "+ Add a step", "Add a step to this section", function (v) {
        return edit([{ op: "add_item", section: s.id, text: v }], { key: "add:" + s.id, okText: "Added", keep: { key: "add:" + s.id, value: v } });
      }));
      var hid = s.items.filter(function (i) { return i.hidden; });
      if (hid.length) {
        var det = mk("details", "qshidden");
        det.appendChild(mk("summary", null, "Archived steps (" + hid.length + ")"));
        hid.forEach(function (it) {
          var r = mk("div", "qsedrow hiddenline"); r.setAttribute("data-hidden-item", it.id);
          r.appendChild(mk("div", "qsedtext", it.text + (it.confirm ? " ?" : "")));
          r.appendChild(btn("Bring back", "alt", function () { edit([{ op: "restore", target: it.id }], { key: "t:" + it.id, okText: "Brought back" }); }));
          det.appendChild(r);
        });
        if (openHidden[s.id]) det.open = true;
        det.addEventListener("toggle", function () { openHidden[s.id] = det.open; });
        sc.appendChild(det);
      }
      wrap.appendChild(sc);
    });

    var hq = mk("div", "qscard");
    var ht = mk("div", "qsedtext");
    var held = doc().heldUp || {};
    ht.appendChild(mk("small", "qsedlabel", "The question at the end of the form"));
    ht.appendChild(inl("held", held.title || "", "qsinltitle", "The question at the end of the form", "", function (v, o) {
      edit([{ op: "set", target: "heldUp", field: "title", value: v, was: o }], { key: "held", keep: { key: "held", value: v } });
    }));
    hq.appendChild(ht); wrap.appendChild(hq);

    var hs = secs.filter(function (s) { return s.hidden; });
    if (hs.length) {
      var hd2 = mk("details", "qscard qshidden");
      hd2.appendChild(mk("summary", null, "Archived sections (" + hs.length + ")"));
      hs.forEach(function (s) {
        var r = mk("div", "qsedrow hiddenline"); r.setAttribute("data-hidden-sec", s.id);
        r.appendChild(mk("div", "qsedtext", s.title + " (" + s.items.filter(function (i) { return !i.hidden; }).length + " steps)"));
        r.appendChild(btn("Bring back", "alt", function () { edit([{ op: "restore", target: s.id }], { key: "st:" + s.id, okText: "Brought back" }); }));
        hd2.appendChild(r);
      });
      if (openHidden._secs) hd2.open = true;
      hd2.addEventListener("toggle", function () { openHidden._secs = hd2.open; });
      wrap.appendChild(hd2);
    }

    var ns = mk("div", "qscard qsadd qsaddsec");
    ns.appendChild(mk("b", "qsedlabel", "Add a section"));
    var ti = mk("input"); ti.type = "text"; ti.maxLength = 300; ti.placeholder = "Its title"; ti.setAttribute("aria-label", "New section title"); ti.setAttribute("data-ek", "nsT");
    var si2 = mk("input"); si2.type = "text"; si2.maxLength = 300; si2.placeholder = "A short line under it (optional)"; si2.setAttribute("aria-label", "New section line"); si2.setAttribute("data-ek", "nsS");
    var addSec = function () {
      var v = clean(ti.value); if (!v) { ti.focus(); return; }
      if (edit([{ op: "add_section", title: v, subtitle: si2.value }], { key: "nsT", okText: "Section added" })) { ti.value = ""; si2.value = ""; }
    };
    [ti, si2].forEach(function (x) { x.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSec(); } }); });
    ns.appendChild(ti); ns.appendChild(si2);
    ns.appendChild(btn("Add section", "alt", addSec));
    wrap.appendChild(ns);

    var vd = mk("details", "qscard qsversions");
    vd.appendChild(mk("summary", null, "Earlier versions"));
    var vl = mk("ol", "qsvlist"); vd.appendChild(vl);
    vd.addEventListener("toggle", function () { if (vd.open) loadVersions(vl); });
    wrap.appendChild(vd);
    host.appendChild(wrap);
  }

  function drawList() {
    var p = $("panel_list"); if (!p) return; p.innerHTML = "";
    banner(p);
    p.appendChild(mk("p", "qshelp", "Tap any step to change its words. It saves when you leave the line or press Enter; Esc puts the words back. \u201C+ Add a step\u201D is under each section. The \u22EF button beside a step moves it, marks it \u201C?\u201D (not sure yet), adds a note behind an \u201Ci\u201D, or archives it. Every change is a new version with your name. Nothing is ever deleted: an archived step can be brought back, and so can any earlier version. The printed sheet always uses the list as it stands."));
    drawEditor(p);
  }

  function loadVersions(vl) {
    if (!vl) return;
    vl.innerHTML = ""; vl.appendChild(mk("li", null, "Loading..."));
    R.apiJSON(base() + "/versions" + Q).then(function (d) {
      vl.innerHTML = "";
      (d.versions || []).forEach(function (v) {
        var li = mk("li");
        li.appendChild(mk("span", "qsvwho", "Version " + v.id + ", " + v.saved_by + ", " + R.fmtTs(v.ts_utc)));
        li.appendChild(mk("span", "qsvsum", v.summary));
        if (v.id !== L.ver) {
          var b = btn("Bring this version back", "alt", function () {
            b.hidden = true;
            var y = btn("Yes, bring it back", "", function () {
              if (!who) { needName(true); return; }
              R.api(base() + "/restore" + Q, { method: "POST", json: { saved_by: who, version: v.id, base: L.ver } }).then(answer).then(function (x) {
                if (x.s === 200 && x.j.ok) { L = x.j.list; status("Saved " + clock()); redraw(); }
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

  /* ---------- LOG: each day's man-hours against the goal, a picture over time, the weeks ---------- */
  function loadLog() {
    var day = DAY;
    R.apiJSON(base() + "/log" + Q).then(function (d) { if (d && d.ok && day === DAY) { LOG = d; drawLog(); } }).catch(function () { });
  }

  function cell(tr, text, label, cls) { var td = mk("td", cls || null, text); td.setAttribute("data-label", label); tr.appendChild(td); return td; }

  /* One bar per day, oldest at the top, all on one scale, with one line marking the goal. One series, one color;
     each bar carries its number and its standing against the goal in words. The table below holds the same figures. */
  function drawPicture(host) {
    var g = goal();
    var rows = LOG.entries.filter(function (e) { return e.manHours !== null; }).slice().reverse();
    if (!rows.length) { host.appendChild(mk("p", "qsmuted", "No days with man-hours yet. The picture starts with the first one saved.")); return; }
    var top = Math.max.apply(null, rows.map(function (e) { return e.manHours; }).concat(g !== null ? [g] : []));
    var scale = top * 1.08 || 1;
    var fig = mk("div", "qsbars"); fig.id = "qsBars"; fig.setAttribute("role", "img");
    fig.setAttribute("aria-label", "Man-hours for each day saved, oldest first" + (g !== null ? ", against a goal of " + num(g) : ""));
    if (g !== null) {
      var key = mk("p", "qsbarkey");
      key.appendChild(mk("span", "qsgoalmark")); key.appendChild(mk("span", null, "Goal: " + num(g) + " man-hours"));
      fig.appendChild(key);
    }
    rows.forEach(function (e) {
      var ag = against(e.manHours);
      var row = mk("div", "qsbarrow"); row.setAttribute("data-bar", e.id);
      row.title = showDay(e.date) + (e.job ? ", " + e.job : "") + ": " + mhText(e.manHours) + " man-hours" + (ag ? " (" + ag.text.toLowerCase() + ")" : "");
      row.appendChild(mk("div", "qsbarlab", showDay(e.date) + (e.job ? " \u00B7 " + e.job : "")));
      var track = mk("div", "qsbartrack");
      var bar = mk("div", "qsbar"); bar.style.width = Math.max(1, e.manHours / scale * 100) + "%"; track.appendChild(bar);
      if (g !== null) { var gl = mk("div", "qsgoalline"); gl.style.left = (g / scale * 100) + "%"; track.appendChild(gl); }
      row.appendChild(track);
      var val = mk("div", "qsbarval"); val.appendChild(mk("b", null, mhText(e.manHours)));
      if (ag) val.appendChild(mk("span", ag.over ? "over" : "met", (ag.over ? "\u25B2 " : "\u2713 ") + ag.text));
      row.appendChild(val);
      fig.appendChild(row);
    });
    host.appendChild(fig);
  }

  function drawLog() {
    var p = $("panel_log"); if (!p) return; p.innerHTML = "";
    if (doc().why) p.appendChild(mk("p", "qsnote", doc().why));
    if (!LOG) { p.appendChild(mk("p", null, "Loading...")); return; }
    var g = goal();
    var pc = mk("div", "qscard");
    pc.appendChild(mk("h2", null, "Man-hours each day" + (g !== null ? ", against the goal" : "")));
    drawPicture(pc);
    p.appendChild(pc);

    var wc = mk("div", "qscard");
    wc.appendChild(mk("h2", null, "By week"));
    if (!LOG.weeks.length) wc.appendChild(mk("p", "qsmuted", "No days saved yet."));
    else {
      var wt = mk("table", "qstable qsweeks"); wt.id = "qsWeeks";
      var th = mk("tr"); ["Week ending", "Days", "Average man-hours", "Best day", g !== null ? "Days at the goal" : ""].forEach(function (h) { if (h) th.appendChild(mk("th", null, h)); });
      var thead = mk("thead"); thead.appendChild(th); wt.appendChild(thead);
      var tb = mk("tbody");
      LOG.weeks.forEach(function (w) {
        var tr = mk("tr");
        cell(tr, "Sat " + showDay(w.weekEnding).replace(/^\D+/, ""), "Week ending");
        cell(tr, String(w.days) + (w.missing ? " (" + w.missing + " without hours)" : ""), "Days");
        cell(tr, w.avgManHours === null ? "" : mhText(w.avgManHours), "Average man-hours", "qsbig");
        cell(tr, w.best === null ? "" : mhText(w.best), "Best day");
        if (g !== null) cell(tr, w.timed ? w.atGoal + " of " + w.timed : "", "Days at the goal");
        tb.appendChild(tr);
      });
      wt.appendChild(tb); wc.appendChild(wt);
    }
    p.appendChild(wc);

    var mc = mk("div", "qscard");
    mc.appendChild(mk("h2", null, "Days"));
    if (!LOG.entries.length) mc.appendChild(mk("p", "qsmuted", "Nothing yet. Fill in the Today tab and press Save."));
    else {
      var heads = [fieldLabel("date", "Date"), fieldLabel("job", "Job"), fieldLabel("crewLead", "Crew lead"), fieldLabel("men", "Men"), fieldLabel("start", "Start"),
                   fieldLabel("finish", "Finish"), "Hours", "Man-hours", g !== null ? "Against the goal of " + num(g) : "", (doc().heldUp || {}).title || "", "Saved by", ""];
      var t = mk("table", "qstable qslog"); t.id = "qsLog";
      var hr = mk("tr"); heads.forEach(function (h, i) { if (h || i === heads.length - 1) hr.appendChild(mk("th", null, h)); });
      var th2 = mk("thead"); th2.appendChild(hr); t.appendChild(th2);
      var b2 = mk("tbody");
      LOG.entries.forEach(function (e) {
        var tr = mk("tr"); tr.setAttribute("data-entry", e.id);
        var ag = against(e.manHours);
        cell(tr, showDay(e.date), heads[0]);
        cell(tr, e.job, heads[1]);
        cell(tr, e.crewLead, heads[2]);
        cell(tr, e.men === null ? "" : String(e.men), heads[3]);
        cell(tr, showTime(e.start), heads[4]);
        cell(tr, showTime(e.finish), heads[5]);
        cell(tr, e.hoursWorked === null || e.hoursWorked === undefined ? "" : num(e.hoursWorked), heads[6], "qsmin");
        cell(tr, e.manHours === null ? "" : mhText(e.manHours), heads[7], "qsmh qsbig");
        if (g !== null) cell(tr, ag ? (ag.over ? "\u25B2 " : "\u2713 ") + ag.text : "", heads[8], "qsag " + (ag ? (ag.over ? "over" : "met") : ""));
        cell(tr, e.heldUp, heads[9], "qsheldcell");
        cell(tr, e.by + ", " + R.fmtTs(e.ts) + (e.items ? " (" + e.ticked + " of " + e.items + " ticked)" : ""), heads[10], "qsmuted");
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
    draft = { f: { date: e.date, job: e.job, crewLead: e.crewLead, men: e.men === null ? "" : String(e.men), start: e.start, finish: e.finish,
                   hours: e.hours === null || e.hours === undefined ? "" : String(e.hours) },
              t: {}, held: e.heldUp || "", ref: e.id, refLine: "the day of " + showDay(e.date) + (e.job ? ", " + e.job : "") };
    (e.ticks || []).forEach(function (t) { draft.t[t.id] = { done: !!t.done }; });
    editMode = false; saveDraft(); drawToday(); pick("today"); window.scrollTo(0, 0);
  }

  function voidEntry(id) {
    if (!who) { needName(); return; }
    R.api(base() + "/void" + Q, { method: "POST", json: { saved_by: who, id: id } }).then(answer).then(function (x) {
      confirmVoid = null;
      if (x.s === 200 && x.j.ok) { status("Taken off the log " + clock()); loadLog(); }
      else { status("Not done: " + ((x.j && x.j.error) || x.s), true); drawLog(); }
    });
  }

  /* ---------- poll ---------- */
  function poll() {
    if (document.hidden) return;
    var day = DAY;
    R.apiJSON(base() + "/board?part=state" + (TEST ? "&as=TEST" : "")).then(function (d) {
      if (day !== DAY || !d || !d.ok || !d.list || d.list.ver === L.ver) return;
      var ae = document.activeElement;
      if (inflight || menuOpen || (ae && ae.closest && ae.closest(".qsedwrap"))) return;
      L = d.list; redraw(); status("The list was changed by " + L.by + ". This is the new version.");
    }).catch(function () { });
    if (tab === "log") loadLog();
  }

  /* ---------- print: one Letter sheet for the truck, built from the current list ---------- */
  function prepPrint() {
    $("qsPageSize").textContent = "@page { size: letter; margin: 0.45in 0.55in 0.5in; }";
    document.body.setAttribute("data-print", "letter");
    var pr = $("qsPrint"); pr.innerHTML = ""; pr.className = "qsprint pletter";
    var top = mk("div", "ptop");
    if (LOGO) { var im = mk("img", "plogo"); im.src = LOGO; im.alt = ""; top.appendChild(im); }
    var tt = mk("div", "ptitle");
    tt.appendChild(mk("p", "pkicker", HUB.title || ""));
    tt.appendChild(mk("h1", null, doc().title || ""));
    top.appendChild(tt);
    pr.appendChild(top);
    if (doc().note) pr.appendChild(mk("p", "pnote", doc().note));
    var hf = mk("div", "pfields");
    (doc().headerFields || []).forEach(function (f) { var d = mk("div", "pfield pf_" + f.key); d.appendChild(mk("span", null, f.label)); d.appendChild(mk("i")); hf.appendChild(d); });
    pr.appendChild(hf);
    var blanks = Math.max(0, Math.min(20, parseInt(doc().blankLines, 10) || 0));
    var vs = visibleSections();
    vs.forEach(function (v, i) {
      var s = mk("section", "psec");
      var h = mk("h2"); h.appendChild(mk("span", null, v.s.title)); if (v.s.subtitle) h.appendChild(mk("small", null, v.s.subtitle)); s.appendChild(h);
      var t = mk("table", "ptable");
      var tb = mk("tbody");
      var extra = []; if (i === vs.length - 1) for (var k = 0; k < blanks; k++) extra.push(null);
      v.items.concat(extra).forEach(function (it) {
        var tr = mk("tr", it ? null : "pblank");
        var d = mk("td", "pdone"); d.appendChild(mk("span", "pbox")); tr.appendChild(d);
        var tx = mk("td", "pitem"); if (it) { tx.appendChild(mk("span", null, it.text)); if (it.confirm) tx.appendChild(mk("b", "pq", " ?")); } tr.appendChild(tx);
        tb.appendChild(tr);
      });
      t.appendChild(tb); s.appendChild(t);
      if (i === vs.length - 1 && blanks) s.appendChild(mk("p", "padded", "The shaded lines are for steps that are missing: write them in, then add them to the list."));
      pr.appendChild(s);
    });
    var hq = mk("section", "psec pheld");
    hq.appendChild(mk("h2", null, (doc().heldUp || {}).title || ""));
    for (var n = 0; n < 2; n++) hq.appendChild(mk("div", "pline"));
    pr.appendChild(hq);
    var g = goal();
    var sum = mk("div", "psum");
    [["Hours", ""], ["Man-hours", ""]].forEach(function (x) { var d = mk("div", "pfield"); d.appendChild(mk("span", null, x[0])); d.appendChild(mk("i")); sum.appendChild(d); });
    if (g !== null) sum.appendChild(mk("div", "pgoal", "Goal: " + num(g) + " man-hours"));
    pr.appendChild(sum);
    pr.appendChild(mk("p", "pfoot", "Version " + L.ver + " of the list, printed " + new Date().toLocaleDateString() + ". A \u201C?\u201D means not sure yet: keep it or cross it out."));
  }
  function doPrint() { prepPrint(); setTimeout(function () { window.print(); }, 60); }
  window.__qsPrep = prepPrint;   /* used by the automated print test */
})();
