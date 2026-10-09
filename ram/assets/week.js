/* Week plan: a job board and labor budget for one week, Monday to Saturday. Generic: no client, person, crew,
   customer or rate is in this file; the lists, the rate and the rows arrive from the API after sign-in.

   One row per job: customer or job, location, job type, crew, the days (Mon to Sat), crew size, budgeted crew-hours,
   actual crew-hours, notes. Worked out here: labor budget $ = budgeted crew-hours x the crew rate, actual $, and the
   variance in hours and dollars. A row over budget shows its variance in dollars as UDE #1, overused labor.
   Every change is saved at once ({op:"set", key:"R:<id>", field, value, base}) under the name typed once at the top
   (kept in this browser's storage, inside try/catch); a change made before a name is typed is held until it is.
   The page follows the server every 30 seconds and when the tab comes back. Print: one landscape page.
   Talk back: one box per row and one for the page, sent to the same notes the plan page keeps (/plan/note). */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var WHO_KEY = R.NS.slice(1) + "_week_who";
  var OTHER_WHO = [R.NS.slice(1) + "_team_who", R.NS.slice(1) + "_growth_who", R.NS.slice(1) + "_quickstart_who"];
  var NOTE_NAMES = [];
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var S = null, LOGO = "", TODAY = "", week = "", who = "", held = [], busy = false, chain = Promise.resolve();
  var notes = [], drafts = {};

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function readKey(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function writeKey(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function fail(text) { document.body.insertBefore(mk("p", "wkfail", text), document.body.firstChild); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function status(text, bad) { var s = $("wkStatus"); if (s) { s.textContent = text || ""; s.classList.toggle("bad", !!bad); } }

  /* ---------- dates (local calendar days, no time zone arithmetic) ---------- */
  function parse(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function addDays(isoDate, n) { var d = parse(isoDate); d.setDate(d.getDate() + n); return iso(d); }
  function mondayOf(isoDate) { var d = parse(isoDate), w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); }
  function md(isoDate) { var d = parse(isoDate); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function mdy(isoDate) { var d = parse(isoDate); return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear(); }
  function weekLabel(m) { return "Mon " + mdy(m) + " to Sat " + mdy(addDays(m, 5)); }
  /* the week to plan: from Friday on, next week; Monday to Thursday, this week */
  function defaultWeek(today) { var d = parse(today).getDay(); return d === 5 || d === 6 || d === 0 ? mondayOf(addDays(today, 3)) : mondayOf(today); }

  /* ---------- state helpers ---------- */
  function fv(it, f) { var c = it && it.f && it.f[f]; return c ? c.v : ""; }
  function rev(it, f) { var c = it && it.f && it.f[f]; return c ? c.rev : 0; }
  function cfgList(f) { var c = S.config[f]; try { var v = JSON.parse(c ? c.v : "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function rate() { var c = S.config.crewRate; var n = parseFloat(c ? c.v : ""); return isFinite(n) ? n : 0; }
  function weekRows(m, archived) { return S.rows.filter(function (r) { return fv(r, "week") === m && (!!fv(r, "archived")) === !!archived; }); }
  function byId(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === id) return S.rows[i]; return null; }
  function num(v) { if (v === "" || v == null) return null; var n = parseFloat(v); return isFinite(n) ? n : null; }
  function money(n) { var neg = n < 0; n = Math.round(Math.abs(n)); return (neg ? "-$" : "$") + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function hrs(n) { return (Math.round(n * 100) / 100).toString(); }
  function days(r) { var d = fv(r, "days"); return /^[01]{6}$/.test(d) ? d : "000000"; }
  function blank(r) { return !fv(r, "job") && !fv(r, "location") && !fv(r, "crew") && !fv(r, "jobType") && days(r) === "000000" && !fv(r, "budgetHours") && !fv(r, "actualHours") && !fv(r, "notes"); }
  function rowName(r, i) { return fv(r, "job") || "Row " + (i + 1); }

  function calc(r) {
    var b = num(fv(r, "budgetHours")), a = num(fv(r, "actualHours")), k = rate();
    var o = { b: b, a: a, bd: b == null ? null : b * k, ad: a == null ? null : a * k, vh: null, vd: null, over: false };
    if (a != null && b != null) { o.vh = a - b; o.vd = o.vh * k; o.over = o.vh > 0.0001; }
    return o;
  }
  function totals(list) {
    var t = { b: 0, a: 0, bd: 0, ad: 0, vh: 0, vd: 0, ude: 0, overRows: 0, hasA: false };
    list.forEach(function (r) {
      var c = calc(r);
      if (c.b != null) { t.b += c.b; t.bd += c.bd; }
      if (c.a != null) { t.a += c.a; t.ad += c.ad; t.hasA = true; }
      if (c.vh != null) { t.vh += c.vh; t.vd += c.vd; }
      if (c.over) { t.ude += c.vd; t.overRows++; }
    });
    return t;
  }

  /* ---------- start ---------- */
  R.gate(function () {
    R.apiJSON("/week/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.state) throw new Error((d && d.error) || "The page could not be loaded.");
      LOGO = d.logo || ""; NOTE_NAMES = d.note_names || []; TODAY = d.today || iso(new Date());
      start(d.state);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function start(state) {
    S = state;
    who = TEST ? "TEST" : readKey(WHO_KEY);
    if (!who && !TEST) { for (var i = 0; i < OTHER_WHO.length && !who; i++) who = readKey(OTHER_WHO[i]); }
    var h = (location.hash || "").replace("#", "");
    week = /^\d{4}-\d{2}-\d{2}$/.test(h) ? mondayOf(h) : defaultWeek(TODAY);
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet";
    var me = document.querySelector('script[src*="/week.js"]');
    css.href = me ? me.src.replace(/\/week\.js[^\/]*$/, "/week.css?v=2") : "../assets/week.css?v=2";
    var go = function () {
      go = function () { };
      document.title = "Week plan";
      frame();
      draw();
      loadNotes();
      setInterval(poll, 30000);
      window.addEventListener("focus", function () { poll(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeprint", buildPrint);
      window.addEventListener("hashchange", function () {
        var x = (location.hash || "").replace("#", "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(x) && mondayOf(x) !== week) { week = mondayOf(x); draw(); }
      });
      document.body.setAttribute("data-week-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  function frame() {
    var nav = mk("div", "wknav noprint");
    var home = mk("a", null, "All tools"); home.href = "../"; nav.appendChild(home);
    var wl = mk("label", "wkwho"); wl.id = "wkWhoWrap";
    wl.appendChild(mk("span", null, "Your name"));
    var wi = mk("input"); wi.type = "text"; wi.id = "wkWho"; wi.maxLength = 40; wi.autocomplete = "name"; wi.value = who; wi.placeholder = "Type it once";
    if (TEST) wi.disabled = true;
    wi.addEventListener("change", function () {
      who = wi.value.replace(/\s+/g, " ").trim(); wi.value = who; writeKey(WHO_KEY, who);
      wl.classList.toggle("need", !who);
      if (who && held.length) { var ops = held; held = []; send(ops); }
    });
    wl.appendChild(wi);
    nav.appendChild(wl);
    var st = mk("span", "wkstatus"); st.id = "wkStatus"; st.setAttribute("role", "status"); nav.appendChild(st);
    var pr = mk("button", "wkbtn", "Print"); pr.type = "button"; pr.id = "wkPrintBtn";
    pr.addEventListener("click", function () { buildPrint(); window.print(); });
    nav.appendChild(pr);
    var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout");
    out.addEventListener("click", function (e) { e.preventDefault(); R.signOut(); });
    nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);
    var main = mk("main", "wkmain noprint"); main.id = "wkMain";
    document.body.insertBefore(main, document.body.querySelector("script"));
    var pv = mk("div", "wkprint"); pv.id = "wkPrint";
    document.body.insertBefore(pv, document.body.querySelector("script"));
    main.addEventListener("change", onChange);
  }

  /* ---------- drawing ---------- */
  function draw() {
    var main = $("wkMain"), y = window.scrollY, a = document.activeElement, focus = null;
    if (a && a.getAttribute && a.getAttribute("data-k")) focus = { k: a.getAttribute("data-k"), f: a.getAttribute("data-f"), s: a.selectionStart, e: a.selectionEnd };
    var openSet = {};
    Array.prototype.forEach.call(main.querySelectorAll("details[id]"), function (d) { openSet[d.id] = d.open; });
    Array.prototype.forEach.call(main.querySelectorAll("textarea[data-note]"), function (t) { var k = t.getAttribute("data-note"); if (t.value !== t._pre) drafts[k] = t.value; else delete drafts[k]; });
    var wx = $("wkTableWrap") ? $("wkTableWrap").scrollLeft : 0;
    main.innerHTML = "";
    main.appendChild(mk("h1", null, "Week plan"));
    main.appendChild(mk("p", "wkintro", "Each job for the week: which crew, which days, and the crew-hours it should take. Actual crew-hours go in after the week."));
    main.appendChild(weekBar());
    main.appendChild(rateLine());
    main.appendChild(tableView());
    main.appendChild(udeLine());
    main.appendChild(crewDays());
    main.appendChild(takenOff());
    main.appendChild(settings());
    main.appendChild(talkBack());
    Object.keys(openSet).forEach(function (id) { var d = $(id); if (d) d.open = openSet[id]; });
    window.scrollTo(0, y);
    if ($("wkTableWrap")) $("wkTableWrap").scrollLeft = wx;
    if (focus) {
      var n = main.querySelector('[data-k="' + focus.k + '"][data-f="' + focus.f + '"]');
      if (n) { n.focus(); try { if (focus.s != null) n.setSelectionRange(focus.s, focus.e); } catch (e) { } }
    }
    var wl = $("wkWhoWrap"); if (wl) wl.classList.toggle("need", !who && held.length > 0);
  }

  function weekBar() {
    var bar = mk("div", "wkweekbar");
    var prev = mk("button", "wkbtn ghost", "Previous week"); prev.type = "button"; prev.id = "wkPrev";
    prev.addEventListener("click", function () { setWeek(addDays(week, -7)); });
    var lab = mk("h2", "wkweek", weekLabel(week)); lab.id = "wkWeekLabel";
    var next = mk("button", "wkbtn ghost", "Next week"); next.type = "button"; next.id = "wkNext";
    next.addEventListener("click", function () { setWeek(addDays(week, 7)); });
    var pick = mk("input", "wkdate"); pick.type = "date"; pick.id = "wkPick"; pick.value = week; pick.setAttribute("aria-label", "Go to the week of");
    pick.addEventListener("change", function () { if (pick.value) setWeek(mondayOf(pick.value)); });
    bar.appendChild(prev); bar.appendChild(lab); bar.appendChild(next); bar.appendChild(pick);
    var acts = mk("div", "wkacts");
    var add = mk("button", "wkbtn", "Add a row"); add.type = "button"; add.id = "wkAddRow";
    add.addEventListener("click", function () { send([{ op: "add", type: "row", fields: { week: week } }]); });
    var cp = mk("button", "wkbtn ghost", "Copy last week forward"); cp.type = "button"; cp.id = "wkCopy";
    cp.title = "Adds a copy of every job from the week of " + md(addDays(week, -7)) + " to this week (not the actual hours).";
    cp.addEventListener("click", function () { send([{ op: "copyweek", from: addDays(week, -7), to: week }], "Copied the jobs from the week of " + md(addDays(week, -7)) + "."); });
    acts.appendChild(add); acts.appendChild(cp);
    bar.appendChild(acts);
    return bar;
  }
  function setWeek(m) { week = m; try { history.replaceState(null, "", "#" + m); } catch (e) { } draw(); }

  function rateLine() {
    var p = mk("p", "wkrate"); p.id = "wkRate";
    p.textContent = "Labor dollars use the burdened crew rate: " + (rate() ? "$" + rate().toFixed(2) + " a crew-hour" : "not set yet") + ". Change it under Lists and rate.";
    return p;
  }

  function input(key, field, value, cls, label, opts) {
    var i = mk("input", "wkin " + (cls || "")); i.type = "text"; i.value = value || "";
    i.setAttribute("data-k", key); i.setAttribute("data-f", field); i.setAttribute("aria-label", label);
    if (opts && opts.num) i.inputMode = "decimal";
    if (opts && opts.max) i.maxLength = opts.max;
    return i;
  }
  function select(key, field, value, list, label) {
    var s = mk("select", "wksel"); s.setAttribute("data-k", key); s.setAttribute("data-f", field); s.setAttribute("aria-label", label);
    var o0 = mk("option", null, ""); o0.value = ""; s.appendChild(o0);
    var all = list.slice(); if (value && all.indexOf(value) < 0) all.push(value);
    all.forEach(function (x) { var o = mk("option", null, x); o.value = x; s.appendChild(o); });
    s.value = value || "";
    return s;
  }
  function td(cls, child, text) { var c = mk("td", cls, text); if (child) c.appendChild(child); return c; }

  function tableView() {
    var wrap = mk("div", "wkwide"); wrap.id = "wkTableWrap";
    var list = weekRows(week, false);
    var tbl = mk("table", "wktable"); tbl.id = "wkTable";
    var thead = mk("thead"), hr = mk("tr");
    var heads = [["#", "wknum"], ["Customer or job", "wkjob"], ["Location", "wkloc"], ["Job type", ""], ["Crew", ""]];
    DAYS.forEach(function (d, i) { heads.push([d + " " + md(addDays(week, i)), "wkday"]); });
    heads = heads.concat([["Crew size", "wkn"], ["Budgeted crew-hours", "wkn"], ["Labor budget", "wkn"], ["Actual crew-hours", "wkn"],
      ["Actual", "wkn"], ["Variance hours", "wkn"], ["Variance", "wkn"], ["Notes", "wknotes"], ["", ""]]);
    heads.forEach(function (h) {
      var th = mk("th", h[1]); th.scope = "col";
      h[0].split(" ").length === 2 && h[1] === "wkday" ? (th.appendChild(mk("span", null, h[0].split(" ")[0])), th.appendChild(mk("br")), th.appendChild(mk("span", null, h[0].split(" ")[1]))) : (th.textContent = h[0]);
      hr.appendChild(th);
    });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = mk("tbody");
    var types = cfgList("jobTypes"), crews = cfgList("crews");
    list.forEach(function (r, i) {
      var k = "R:" + r.id, c = calc(r), tr = mk("tr", c.over ? "over" : ""); tr.setAttribute("data-row", r.id);
      tr.appendChild(td("wknum", null, String(i + 1)));
      tr.appendChild(td("wkjob", input(k, "job", fv(r, "job"), "", "Customer or job, row " + (i + 1), { max: 120 })));
      tr.appendChild(td("wkloc", input(k, "location", fv(r, "location"), "", "Location, row " + (i + 1), { max: 120 })));
      tr.appendChild(td("", select(k, "jobType", fv(r, "jobType"), types, "Job type, row " + (i + 1))));
      tr.appendChild(td("", select(k, "crew", fv(r, "crew"), crews, "Crew, row " + (i + 1))));
      var dd = days(r);
      DAYS.forEach(function (d, j) {
        var cb = mk("input", "wkday"); cb.type = "checkbox"; cb.checked = dd.charAt(j) === "1";
        cb.setAttribute("data-k", k); cb.setAttribute("data-f", "days"); cb.setAttribute("data-d", String(j));
        cb.setAttribute("aria-label", d + ", row " + (i + 1));
        tr.appendChild(td("wkdaycell", cb));
      });
      tr.appendChild(td("wkn", input(k, "crewSize", fv(r, "crewSize"), "short", "Crew size, row " + (i + 1), { num: true, max: 3 })));
      tr.appendChild(td("wkn", input(k, "budgetHours", fv(r, "budgetHours"), "short", "Budgeted crew-hours, row " + (i + 1), { num: true, max: 8 })));
      tr.appendChild(td("wkn wkcalc", null, c.bd == null ? "" : money(c.bd)));
      var at = td("wkn", input(k, "actualHours", fv(r, "actualHours"), "short", "Actual crew-hours, row " + (i + 1), { num: true, max: 8 }));
      if (fv(r, "actualSource") === "timeclock") at.appendChild(mk("span", "wksrc", "time clock"));
      tr.appendChild(at);
      tr.appendChild(td("wkn wkcalc", null, c.ad == null ? "" : money(c.ad)));
      tr.appendChild(td("wkn wkcalc", null, c.vh == null ? (c.a != null && c.b == null ? "no budget" : "") : (c.vh > 0 ? "+" : "") + hrs(c.vh)));
      var vd = td("wkn wkcalc wkvar");
      if (c.vd != null) {
        if (c.over) { vd.appendChild(mk("span", "wkude", "UDE #1: overused labor")); vd.appendChild(mk("strong", "wkover", money(c.vd))); }
        else vd.textContent = c.vd < -0.5 ? money(-c.vd) + " under" : "on budget";
      }
      tr.appendChild(vd);
      tr.appendChild(td("wknotes", input(k, "notes", fv(r, "notes"), "", "Notes, row " + (i + 1), { max: 1000 })));
      var rm = mk("button", "wklink", "Take off"); rm.type = "button"; rm.setAttribute("data-off", r.id);
      rm.title = "Take this row off the week (it can be put back)";
      rm.addEventListener("click", function () { send([{ op: "set", key: k, field: "archived", value: "1" }]); });
      tr.appendChild(td("", rm));
      tb.appendChild(tr);
    });
    if (!list.length) {
      var er = mk("tr"), ec = mk("td", "wkempty", "No jobs on this week yet. Add a row, or copy last week forward.");
      ec.colSpan = 20; er.appendChild(ec); tb.appendChild(er);
    }
    tbl.appendChild(tb);
    var t = totals(list), tf = mk("tfoot"), fr = mk("tr");
    var lab = mk("th", null, "Totals"); lab.colSpan = 11; lab.scope = "row"; fr.appendChild(lab);
    fr.appendChild(td("wkn", null, ""));
    fr.appendChild(td("wkn", null, hrs(t.b))); fr.id = "wkTotals";
    fr.appendChild(td("wkn", null, money(t.bd)));
    fr.appendChild(td("wkn", null, t.hasA ? hrs(t.a) : ""));
    fr.appendChild(td("wkn", null, t.hasA ? money(t.ad) : ""));
    fr.appendChild(td("wkn", null, t.hasA ? (t.vh > 0 ? "+" : "") + hrs(t.vh) : ""));
    fr.appendChild(td("wkn", null, t.hasA ? money(t.vd) : ""));
    fr.appendChild(td("", null, "")); fr.appendChild(td("", null, ""));
    tf.appendChild(fr); tbl.appendChild(tf);
    wrap.appendChild(tbl);
    return wrap;
  }

  function udeLine() {
    var t = totals(weekRows(week, false));
    var p = mk("p", "wkudeline" + (t.ude > 0 ? " on" : "")); p.id = "wkUde";
    p.textContent = t.ude > 0
      ? "UDE #1: overused labor this week: " + money(t.ude) + " on " + t.overRows + (t.overRows === 1 ? " job" : " jobs") + " over budget."
      : "UDE #1: overused labor this week: none so far. It counts once actual crew-hours are in.";
    return p;
  }

  function crewDays() {
    var sec = mk("section", "wksum"); sec.id = "wkCrewDays";
    sec.appendChild(mk("h2", null, "By crew, by day"));
    var list = weekRows(week, false).filter(function (r) { return !blank(r); });
    var crews = cfgList("crews").slice();
    list.forEach(function (r) { var c = fv(r, "crew"); if (c && crews.indexOf(c) < 0) crews.push(c); });
    if (list.some(function (r) { return !fv(r, "crew"); })) crews.push("");
    var wrap = mk("div", "wkwide small");
    var tbl = mk("table", "wksumt"), hr = mk("tr");
    hr.appendChild(mk("th", null, "Crew"));
    DAYS.forEach(function (d, i) { hr.appendChild(mk("th", null, d + " " + md(addDays(week, i)))); });
    var th = mk("thead"); th.appendChild(hr); tbl.appendChild(th);
    var tb = mk("tbody");
    crews.forEach(function (c) {
      var tr = mk("tr"); tr.appendChild(mk("th", null, c || "No crew yet"));
      DAYS.forEach(function (d, j) {
        var jobs = list.filter(function (r) { return fv(r, "crew") === c && days(r).charAt(j) === "1"; })
          .map(function (r) { return fv(r, "job") || "Row " + (weekRows(week, false).indexOf(r) + 1); });
        var cell = mk("td", jobs.length > 1 ? "two" : "", jobs.join("; "));
        tr.appendChild(cell);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); sec.appendChild(wrap);
    sec.appendChild(mk("p", "wkhint", "A crew on two jobs the same day is shaded."));
    return sec;
  }

  function takenOff() {
    var off = weekRows(week, true);
    var d = mk("details", "wkmore"); d.id = "wkOff";
    d.appendChild(mk("summary", null, "Taken off this week (" + off.length + ")"));
    if (!off.length) d.appendChild(mk("p", "wkhint", "Nothing taken off."));
    off.forEach(function (r) {
      var row = mk("div", "wkoffrow"); row.appendChild(mk("span", null, fv(r, "job") || "(blank row)"));
      var b = mk("button", "wklink", "Put back"); b.type = "button";
      b.addEventListener("click", function () { send([{ op: "set", key: "R:" + r.id, field: "archived", value: "" }]); });
      row.appendChild(b); d.appendChild(row);
    });
    return d;
  }

  function settings() {
    var d = mk("details", "wkmore"); d.id = "wkSettings";
    d.appendChild(mk("summary", null, "Lists and rate"));
    d.appendChild(mk("p", "wkhint", "One line per choice. Changing a list does not change rows already filled in."));
    var f = mk("div", "wkform");
    var jt = mk("textarea", "wkta"); jt.id = "wkJobTypes"; jt.rows = 6; jt.value = cfgList("jobTypes").join("\n");
    var cr = mk("textarea", "wkta"); cr.id = "wkCrews"; cr.rows = 5; cr.value = cfgList("crews").join("\n");
    var rt = mk("input", "wkin short"); rt.type = "text"; rt.inputMode = "decimal"; rt.id = "wkRateIn"; rt.value = S.config.crewRate ? S.config.crewRate.v : "";
    function lab(t, n) { var l = mk("label", "wkfield"); l.appendChild(mk("span", null, t)); l.appendChild(n); return l; }
    f.appendChild(lab("Job types", jt)); f.appendChild(lab("Crews", cr)); f.appendChild(lab("Burdened crew rate, dollars a crew-hour", rt));
    var b = mk("button", "wkbtn", "Save lists and rate"); b.type = "button"; b.id = "wkSaveSettings";
    b.addEventListener("click", function () {
      function lines(t) { return t.value.split("\n").map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(Boolean); }
      var c = S.config;
      send([
        { op: "set", key: "CFG:main", field: "jobTypes", value: JSON.stringify(lines(jt)), base: c.jobTypes ? c.jobTypes.rev : 0 },
        { op: "set", key: "CFG:main", field: "crews", value: JSON.stringify(lines(cr)), base: c.crews ? c.crews.rev : 0 },
        { op: "set", key: "CFG:main", field: "crewRate", value: rt.value.replace(/[$,\s]/g, ""), base: c.crewRate ? c.crewRate.rev : 0 }
      ]);
    });
    f.appendChild(b);
    d.appendChild(f);
    var c = S.config.crewRate;
    if (c) d.appendChild(mk("p", "wkhint", "Rate last changed by " + c.by + ", " + R.fmtTs(c.ts) + "."));
    return d;
  }

  /* ---------- talk back: one box per row, one for the page ---------- */
  function noteAbout(id) {
    if (id === "page") return "Week plan " + md(week) + ": the page";
    var r = byId(id), i = weekRows(week, false).indexOf(r);
    return ("Week plan " + md(week) + ": " + (r ? rowName(r, i) : id)).slice(0, 120);
  }
  function prefill(id) {
    if (id === "page") return "About the week plan for " + weekLabel(week) + ": ";
    var r = byId(id), i = weekRows(week, false).indexOf(r);
    var on = DAYS.filter(function (d, j) { return days(r).charAt(j) === "1"; }).join(", ");
    return "Row " + (i + 1) + (fv(r, "job") ? ", " + fv(r, "job") : "") + (fv(r, "crew") ? ", " + fv(r, "crew") : "") + (on ? ", " + on : "") + ": ";
  }
  function talkBack() {
    var sec = mk("section", "wktalk"); sec.id = "wkTalk";
    sec.appendChild(mk("h2", null, "Talk back to Claude"));
    sec.appendChild(mk("p", "wkhint", "One box per job and one for the page. Send goes to the same notes as the plan page."));
    var ids = weekRows(week, false).map(function (r) { return r.id; }).concat(["page"]);
    ids.forEach(function (id) {
      var box = mk("div", "wknote");
      var key = week + ":" + id;
      var t = mk("textarea", "wkta"); t.rows = 2; t.setAttribute("data-note", key); t.setAttribute("aria-label", noteAbout(id));
      t._pre = prefill(id); t.value = drafts[key] != null ? drafts[key] : t._pre;
      var b = mk("button", "wkbtn small", "Send to Claude"); b.type = "button"; b.setAttribute("data-send", id);
      var s = mk("span", "wknotestate");
      b.addEventListener("click", function () { sendNote(id, t, b, s, key); });
      box.appendChild(t); var row = mk("div", "wknoterow"); row.appendChild(b); row.appendChild(s); box.appendChild(row);
      t.rows = 1;
      sec.appendChild(box);
    });
    var mine = notes.filter(function (n) { return String(n.about || "").indexOf("Week plan " + md(week)) === 0; });
    var ul = mk("ul", "wknotelist"); ul.id = "wkNoteList";
    if (!mine.length) ul.appendChild(mk("li", "wkhint", "Nothing sent for this week yet."));
    mine.forEach(function (n) {
      var li = mk("li"); li.appendChild(mk("span", "wkmeta", n.answered_by + ", " + R.fmtTs(n.ts_utc) + ", " + n.about));
      li.appendChild(mk("div", null, n.text)); ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }
  function sendNote(id, t, b, s, key) {
    var text = t.value.trim(), pre = prefill(id).trim();
    if (!text || text === pre) { s.className = "wknotestate bad"; s.textContent = "Type something first."; return; }
    /* the plan notes keep a short list of names; anyone else is saved under the default name with "From <name>:" in front */
    var from = TEST ? "TEST" : who;
    if (!TEST && who && NOTE_NAMES.indexOf(who) < 0) text = "From " + who + ": " + text;
    b.disabled = true; s.className = "wknotestate"; s.textContent = "Sending";
    R.apiJSON("/plan/note", { method: "POST", json: { text: text, about: noteAbout(id), answered_by: from } }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { s.className = "wknotestate bad"; s.textContent = (r && r.error) || "Not sent. Try again."; return; }
      notes = r.notes || notes; delete drafts[key]; t.value = prefill(id);
      draw();
      var st = document.querySelector('[data-send="' + id + '"]'); if (st && st.nextSibling) st.nextSibling.textContent = "Sent " + clock() + ".";
    }).catch(function () { b.disabled = false; s.className = "wknotestate bad"; s.textContent = "Not sent: no connection. Your words are still in the box."; });
  }
  function loadNotes() {
    R.apiJSON("/plan/notes").then(function (r) { if (r && r.ok) { notes = r.notes || []; if (!busyTyping()) draw(); } }).catch(function () { });
  }

  /* ---------- events ---------- */
  function onChange(e) {
    var n = e.target, k = n.getAttribute && n.getAttribute("data-k"), f = n.getAttribute && n.getAttribute("data-f");
    if (!k || !f) return;
    var r = byId(k.slice(2)); if (!r) return;
    var ops;
    if (f === "days") {
      var d = days(r).split(""); d[+n.getAttribute("data-d")] = n.checked ? "1" : "0";
      ops = [{ op: "set", key: k, field: "days", value: d.join(""), base: rev(r, "days") }];
    } else {
      var v = n.value;
      if (/^(crewSize|budgetHours|actualHours)$/.test(f)) {
        v = v.replace(/[,\s]/g, "");
        if (v !== "" && !/^\d+(\.\d{0,2})?$/.test(v)) { status("That is not a number. Use digits, like 24 or 37.5.", true); n.focus(); return; }
        v = v.replace(/\.$/, "");
      }
      ops = [{ op: "set", key: k, field: f, value: v, base: rev(r, f) }];
      if (f === "actualHours" && fv(r, "actualSource") !== "manual") ops.push({ op: "set", key: k, field: "actualSource", value: "manual" });
    }
    /* show it at once; the server's answer replaces it */
    ops.forEach(function (o) { r.f[o.field] = { v: o.value, by: who || "(not saved yet)", ts: new Date().toISOString(), rev: rev(r, o.field) }; });
    send(ops);
  }

  /* ---------- saving ---------- */
  function send(ops, okText) {
    if (!who) {
      held = held.concat(ops);
      var wl = $("wkWhoWrap"); if (wl) wl.classList.add("need");
      status("Type your name at the top to save.", true);
      var wi = $("wkWho"); if (wi) wi.focus();
      draw();
      return;
    }
    busy = true;
    status("Saving...");
    chain = chain.then(function () {
      return R.api("/week/save" + Q, { method: "POST", json: { saved_by: who, ops: ops } }).then(answer).then(function (x) {
        if (x.j && x.j.state) S = x.j.state;
        if (x.s === 200) { status(okText ? okText + " Saved " + clock() : "Saved " + clock()); draw(); }
        else {
          status((x.j && x.j.error) || "Not saved. Try again.", true);
          if (!x.j || !x.j.state) return poll(true);
          draw();
        }
      }).catch(function (e) { if (e && e.message !== "signed out") status("Not saved: no connection. Change it again when the signal is back.", true); });
    }).then(function () { busy = false; });
  }

  function busyTyping() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" && a.type !== "checkbox" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
  }
  function poll(force) {
    if (!S || (busy && !force) || held.length) return Promise.resolve();
    if (!force && busyTyping()) return Promise.resolve();
    return R.apiJSON("/week/board" + Q + (Q ? "&" : "?") + "part=state").then(function (d) {
      if (d && d.ok && d.state && d.state.last_event_id !== S.last_event_id) { S = d.state; draw(); }
    }).catch(function () { });
  }

  /* ---------- print: one landscape page, black on white ---------- */
  function buildPrint() {
    if (!S) return;
    var pv = $("wkPrint"); pv.innerHTML = "";
    var top = mk("div", "wkptop");
    if (LOGO) { var im = mk("img", "wkplogo"); im.src = LOGO; im.alt = ""; top.appendChild(im); }
    var ttl = mk("div", "wkptitle");
    ttl.appendChild(mk("h1", null, "Week plan: " + weekLabel(week)));
    ttl.appendChild(mk("p", null, "Burdened crew rate " + (rate() ? "$" + rate().toFixed(2) + " a crew-hour" : "not set") + ". Printed " + mdy(iso(new Date())) + "."));
    top.appendChild(ttl); pv.appendChild(top);
    var list = weekRows(week, false);
    var tbl = mk("table", "wkptable"), hr = mk("tr");
    ["#", "Customer or job", "Location", "Job type", "Crew"].concat(DAYS.map(function (d, i) { return d + " " + md(addDays(week, i)); }))
      .concat(["Crew size", "Budget crew-hrs", "Labor budget", "Actual crew-hrs", "Actual", "Variance", "Notes"])
      .forEach(function (h) { hr.appendChild(mk("th", null, h)); });
    var th = mk("thead"); th.appendChild(hr); tbl.appendChild(th);
    var tb = mk("tbody");
    list.forEach(function (r, i) {
      var c = calc(r), tr = mk("tr");
      [String(i + 1), fv(r, "job"), fv(r, "location"), fv(r, "jobType"), fv(r, "crew")].forEach(function (v) { tr.appendChild(mk("td", null, v)); });
      DAYS.forEach(function (d, j) { tr.appendChild(mk("td", "c", days(r).charAt(j) === "1" ? "X" : "")); });
      tr.appendChild(mk("td", "n", fv(r, "crewSize")));
      tr.appendChild(mk("td", "n", fv(r, "budgetHours")));
      tr.appendChild(mk("td", "n", c.bd == null ? "" : money(c.bd)));
      tr.appendChild(mk("td", "n", fv(r, "actualHours")));
      tr.appendChild(mk("td", "n", c.ad == null ? "" : money(c.ad)));
      tr.appendChild(mk("td", "n", c.vd == null ? "" : (c.over ? "UDE #1 " + money(c.vd) : money(c.vd))));
      tr.appendChild(mk("td", null, fv(r, "notes")));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var t = totals(list), fr = mk("tr");
    var l = mk("th", null, "Totals"); l.colSpan = 12; fr.appendChild(l);
    fr.appendChild(mk("td", "n", hrs(t.b))); fr.appendChild(mk("td", "n", money(t.bd)));
    fr.appendChild(mk("td", "n", t.hasA ? hrs(t.a) : "")); fr.appendChild(mk("td", "n", t.hasA ? money(t.ad) : ""));
    fr.appendChild(mk("td", "n", t.hasA ? money(t.vd) : "")); fr.appendChild(mk("td", null, ""));
    var tf = mk("tfoot"); tf.appendChild(fr); tbl.appendChild(tf);
    pv.appendChild(tbl);
    pv.appendChild(mk("p", "wkpude", t.ude > 0 ? "UDE #1: overused labor this week: " + money(t.ude) + "." : "UDE #1: overused labor this week: counts once actual crew-hours are in."));
    var cd = crewDays(); cd.className = "wkpsum"; cd.removeAttribute("id");
    var hint = cd.querySelector(".wkhint"); if (hint) hint.parentNode.removeChild(hint);
    pv.appendChild(cd);
  }
})();
