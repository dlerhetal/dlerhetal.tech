/* Team page: people cards, a ratings matrix and a two-picker grid, all editable and saved on the server.
   Generic: nothing in this file names a client or a person and it holds no page wording beyond button labels. The
   questions, the legend, the guidance boxes, the people, the groups and the rows all arrive from the API after
   sign-in.

   Every input carries data-k (the item key) and data-f (the field). A change is queued and sent (a pick at once,
   typing about a second after the last key) as {op:"set", key, field, value, base}; base is the field's rev the
   screen started from, so a change made somewhere else in the meantime is refused (409) and the latest is shown.
   Adds and archives go to the server at once. The page follows the server every 30 seconds and when the tab
   regains focus, but never re-draws a box that has focus or unsent words. Every save carries the name typed once at
   the top (kept in this browser's storage, inside try/catch). Print builds a clean read-only copy. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var WHO_KEY = R.NS.slice(1) + "_team_who";
  var C = null, L = {}, S = null, who = "";
  var dirty = {}, timer = null, chain = Promise.resolve(), drawnSig = "", pendingDraw = false;
  var TEXT_DELAY = 900;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function fail(text) { document.body.insertBefore(mk("p", "tmfail", text), document.body.firstChild); }
  function readWho() { try { return localStorage.getItem(WHO_KEY) || ""; } catch (e) { return ""; } }
  function saveWho(v) { try { if (v) localStorage.setItem(WHO_KEY, v); else localStorage.removeItem(WHO_KEY); } catch (e) { } }

  R.gate(function () {
    R.apiJSON("/team/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.content || !d.state) throw new Error((d && d.error) || "The page could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  function start(d) {
    C = d.content; L = C.labels || {}; S = d.state;
    who = TEST ? "TEST" : readWho();
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet";
    /* the stylesheet sits beside this script, wherever the page is (/team/detail/ since 2026-10-06) */
    var me = document.querySelector('script[src*="/team.js"]');
    css.href = me ? me.src.replace(/\/team\.js[^\/]*$/, "/team.css?v=2") : "../../assets/team.css?v=2";
    var go = function () {
      go = function () { };
      document.title = C.title || "Working page";
      frame();
      draw();
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeunload", function (e) { if (Object.keys(dirty).length) { flush(); e.preventDefault(); e.returnValue = ""; } });
      window.addEventListener("beforeprint", buildPrint);
      document.body.setAttribute("data-team-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- state helpers ---------- */
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function fs(key, field) {
    var t = key.slice(0, 2), id = key.slice(2);
    if (t === "C:") { var c = S.cells[id]; return (c && c[field]) || null; }
    var it = byId(t === "P:" ? S.people : t === "G:" ? S.groups : S.duties, id);
    return (it && it.f[field]) || null;
  }
  function val(key, field) {
    var dk = key + "|" + field;
    if (dk in dirty) return dirty[dk].value;
    var x = fs(key, field); return x ? x.v : "";
  }
  function people(archived) { return S.people.filter(function (p) { return (val("P:" + p.id, "archived") === "1") === !!archived; }); }
  function groups(archived) { return S.groups.filter(function (g) { return (val("G:" + g.id, "archived") === "1") === !!archived; }); }
  function duties(gid, archived) {
    return S.duties.filter(function (d) { return val("D:" + d.id, "group") === gid && (val("D:" + d.id, "archived") === "1") === !!archived; });
  }
  function sig() {
    return JSON.stringify([S.people.map(function (p) { return p.id + val("P:" + p.id, "archived"); }),
      S.groups.map(function (g) { return g.id + val("G:" + g.id, "archived"); }),
      S.duties.map(function (d) { return d.id + val("D:" + d.id, "archived") + val("D:" + d.id, "group"); })]);
  }
  function metaText(keys) {
    var best = null;
    keys.forEach(function (kf) {
      var p = kf.split("|"), x = fs(p[0], p[1]);
      if (x && x.rev && (!best || x.rev > best.rev)) best = x;
    });
    if (!best) return "Not changed yet";
    if (best.by === "Seed") return (L.seedBy || "Set up") + ", " + R.fmtTs(best.ts);
    return "Last changed by " + best.by + ", " + R.fmtTs(best.ts);
  }
  function meta(keys, cls) { var p = mk("p", "tmmeta" + (cls ? " " + cls : "")); p.setAttribute("data-meta", keys.join(",")); p.textContent = metaText(keys); return p; }

  /* ---------- the frame: sticky bar with the name box ---------- */
  function frame() {
    var nav = mk("div", "tmnav noprint"); nav.id = "tmNav";
    var wl = mk("label", "tmwho");
    wl.appendChild(mk("span", null, "Your name"));
    var wi = mk("input"); wi.type = "text"; wi.id = "tmWho"; wi.maxLength = 40; wi.autocomplete = "name"; wi.value = who; wi.placeholder = "Type it once";
    if (TEST) wi.disabled = true;
    wi.addEventListener("change", function () {
      who = wi.value.replace(/\s+/g, " ").trim(); wi.value = who; saveWho(who);
      wl.classList.toggle("need", !who);
      if (who && Object.keys(dirty).length) flush();
    });
    wl.appendChild(wi);
    nav.appendChild(wl);
    var stat = mk("span", "tmstatus"); stat.id = "tmStatus"; stat.setAttribute("role", "status"); nav.appendChild(stat);
    var pr = mk("button", "tmbtn", "Print"); pr.type = "button"; pr.id = "tmPrintBtn";
    pr.addEventListener("click", function () { flush(); buildPrint(); window.print(); });
    nav.appendChild(pr);
    var back = mk("a", null, "Simple grid"); back.href = "../"; back.id = "tmBackGrid"; nav.appendChild(back);
    var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);
    var main = mk("main", "tmmain noprint"); main.id = "tmMain";
    document.body.insertBefore(main, document.body.querySelector("script"));
    var pv = mk("div", "tmprint"); pv.id = "tmPrint";
    document.body.insertBefore(pv, document.body.querySelector("script"));
    main.addEventListener("input", onInput);
    main.addEventListener("change", onInput);
    main.addEventListener("focusout", function () { if (pendingDraw) setTimeout(maybeDraw, 0); });
  }

  /* ---------- drawing ---------- */
  function draw() {
    var main = $("tmMain"), y = window.scrollY;
    main.innerHTML = "";
    main.appendChild(mk("h1", null, C.title || ""));
    main.appendChild(mk("p", "tmintro", L.intro || ""));
    var toc = mk("nav", "tmtoc");
    [["tmPeople", L.people], ["tmMatrix", L.matrix], ["tmSW", L.skillWill]].forEach(function (x) { var a = mk("a", null, x[1] || ""); a.href = "#" + x[0]; toc.appendChild(a); });
    main.appendChild(toc);
    main.appendChild(peopleSection());
    main.appendChild(matrixSection());
    main.appendChild(swSection());
    drawnSig = sig(); pendingDraw = false;
    window.scrollTo(0, y);
  }

  function field(label, key, f, opts) {
    opts = opts || {};
    var box = mk("div", "tmfield" + (opts.cls ? " " + opts.cls : ""));
    var id = "i_" + key.replace(/[^A-Za-z0-9]/g, "_") + "_" + f;
    var lab = mk("label", "tmlabel", label); lab.htmlFor = id; box.appendChild(lab);
    var inp;
    if (opts.area) { inp = mk("textarea", "tmta"); inp.rows = opts.rows || 2; }
    else { inp = mk("input", "tmin"); inp.type = "text"; }
    inp.id = id; inp.maxLength = opts.max || 4000; inp.value = val(key, f);
    if (opts.ph) inp.placeholder = opts.ph;
    inp.setAttribute("data-k", key); inp.setAttribute("data-f", f);
    inp.classList.toggle("empty", !inp.value);
    box.appendChild(inp);
    if (opts.area) setTimeout(function () { grow(inp); }, 0);
    return box;
  }
  function grow(ta) { if (ta.tagName !== "TEXTAREA") return; ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 44) + "px"; }

  function confirmBtn(label, sure, act) {
    var wrap = mk("span", "tmconfirm");
    var b = mk("button", "tmlink", label); b.type = "button";
    b.addEventListener("click", function () {
      wrap.innerHTML = "";
      wrap.appendChild(mk("span", "tmsure", sure + " "));
      var y = mk("button", "tmlink strong", "Yes"); y.type = "button"; y.addEventListener("click", act);
      var n = mk("button", "tmlink", "No"); n.type = "button"; n.addEventListener("click", function () { wrap.innerHTML = ""; wrap.appendChild(b); });
      wrap.appendChild(y); wrap.appendChild(n);
    });
    wrap.appendChild(b);
    return wrap;
  }

  function addForm(ph, btnText, onAdd, cls) {
    var f = mk("form", "tmadd" + (cls ? " " + cls : ""));
    var i = mk("input", "tmin"); i.type = "text"; i.placeholder = ph; i.maxLength = 120; i.setAttribute("aria-label", ph);
    var b = mk("button", "tmbtn", btnText); b.type = "submit";
    f.appendChild(i); f.appendChild(b);
    f.addEventListener("submit", function (e) { e.preventDefault(); var v = i.value.trim(); if (!v) { i.focus(); return; } onAdd(v, i); });
    return f;
  }

  function personKeys(pid, which) {
    var k = "P:" + pid, out = [];
    if (which === "sw") return [k + "|swSkill", k + "|swWill", k + "|swNote"];
    ["name", "time", "title", "reportsTo", "archived"].concat(C.answer_questions || []).forEach(function (f) { out.push(k + "|" + f); });
    return out;
  }

  function peopleSection() {
    var sec = mk("section", "tmsec"); sec.id = "tmPeople";
    sec.appendChild(mk("h2", null, L.people || ""));
    var head = {};
    (C.questions || []).forEach(function (q) { if (q.field) head[q.field] = q; });
    var grid = mk("div", "tmcards");
    people(false).forEach(function (p) {
      var k = "P:" + p.id;
      var card = mk("article", "tmcard"); card.setAttribute("data-person", p.id);
      card.appendChild(field("Name", k, "name", { max: 80, cls: "tmname" }));
      ["time", "title", "reportsTo"].forEach(function (f) {
        var q = head[f]; card.appendChild(field(q ? q.n + ". " + q.text : f, k, f, { max: 200, ph: "Not filled in yet" }));
      });
      var any = (C.answer_questions || []).some(function (qid) { return !!val(k, qid); });
      var det = mk("details", "tmans"); if (any) det.open = true;
      det.appendChild(mk("summary", null, any ? "Interview answers" : "Interview answers (none yet)"));
      if (!any) det.appendChild(mk("p", "tmhint", L.noAnswers || ""));
      (C.questions || []).forEach(function (q) {
        if (q.field) return;
        det.appendChild(field(q.n + ". " + q.text, k, q.id, { area: true, rows: 2, ph: "Answer" }));
      });
      card.appendChild(det);
      var foot = mk("div", "tmfoot");
      foot.appendChild(meta(personKeys(p.id)));
      foot.appendChild(confirmBtn("Archive", "Archive this person? Nothing is deleted.", function () { setNow(k, "archived", "1"); }));
      card.appendChild(foot);
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    sec.appendChild(addForm("New person's name", "Add a person", function (v, i) {
      var fields = { name: v };
      add("person", fields, function () { i.value = ""; });
    }));
    var arch = people(true);
    if (arch.length) {
      var d = mk("details", "tmarch"); d.appendChild(mk("summary", null, "Archived people (" + arch.length + ")"));
      arch.forEach(function (p) {
        var row = mk("div", "tmarchrow"); row.appendChild(mk("span", null, val("P:" + p.id, "name")));
        var b = mk("button", "tmlink", "Bring back"); b.type = "button";
        b.addEventListener("click", function () { setNow("P:" + p.id, "archived", ""); });
        row.appendChild(b); d.appendChild(row);
      });
      sec.appendChild(d);
    }
    return sec;
  }

  function ratingSelect(key) {
    var s = mk("select", "tmrate"); s.setAttribute("data-k", key); s.setAttribute("data-f", "rating");
    var o = mk("option", null, "Rate"); o.value = ""; s.appendChild(o);
    (C.legend || []).forEach(function (l) { var x = mk("option", null, l.v + " " + l.label); x.value = l.v; s.appendChild(x); });
    s.value = val(key, "rating");
    s.classList.toggle("blank", !s.value);
    return s;
  }

  function matrixSection() {
    var sec = mk("section", "tmsec"); sec.id = "tmMatrix";
    sec.appendChild(mk("h2", null, L.matrix || ""));
    sec.appendChild(mk("p", "tmhint", L.matrixHelp || ""));
    var leg = mk("div", "tmlegend");
    (C.legend || []).forEach(function (l) { var x = mk("span", "tmleg r" + l.v); x.appendChild(mk("b", null, l.v)); x.appendChild(document.createTextNode(" " + l.label)); leg.appendChild(x); });
    sec.appendChild(leg);
    var ps = people(false);
    groups(false).forEach(function (g) {
      var gk = "G:" + g.id;
      var gbox = mk("div", "tmgroup"); gbox.setAttribute("data-group", g.id);
      var gh = mk("div", "tmghead");
      gh.appendChild(field("Group", gk, "title", { max: 120, cls: "tmgtitle" }));
      gh.appendChild(meta([gk + "|title"]));
      gbox.appendChild(gh);
      var wrap = mk("div", "tmtablewrap");
      var tb = mk("table", "tmtable");
      var thead = mk("thead"), hr = mk("tr");
      hr.appendChild(mk("th", "tmdutyh", "Duty"));
      ps.forEach(function (p) { hr.appendChild(mk("th", null, val("P:" + p.id, "name"))); });
      thead.appendChild(hr); tb.appendChild(thead);
      var tbody = mk("tbody");
      duties(g.id, false).forEach(function (d) {
        var dk = "D:" + d.id, tr = mk("tr"); tr.setAttribute("data-duty", d.id);
        var th = mk("th", "tmduty"); th.scope = "row";
        th.appendChild(field("Duty", dk, "title", { area: true, rows: 1, max: 200, cls: "tmdtitle" }));
        th.appendChild(field(L.dutyNote || "Note", dk, "note", { area: true, rows: 1, max: 1000, cls: "tmdnote", ph: "Optional" }));
        var df = mk("div", "tmfoot");
        df.appendChild(meta([dk + "|title", dk + "|note", dk + "|group", dk + "|archived"]));
        df.appendChild(confirmBtn("Remove", "Take this duty off the list? Nothing is deleted.", function () { setNow(dk, "archived", "1"); }));
        th.appendChild(df);
        tr.appendChild(th);
        ps.forEach(function (p) {
          var ck = "C:" + d.id + ":" + p.id;
          var td = mk("td", "tmcell"); td.setAttribute("data-cell", d.id + ":" + p.id);
          td.appendChild(mk("span", "tmcellwho", val("P:" + p.id, "name")));
          var row = mk("div", "tmcellrow");
          var sel = ratingSelect(ck); sel.setAttribute("aria-label", "Rating: " + val("P:" + p.id, "name"));
          row.appendChild(sel);
          var n = mk("textarea", "tmcnote"); n.rows = 1; n.maxLength = 300; n.placeholder = "Note"; n.value = val(ck, "note");
          n.setAttribute("data-k", ck); n.setAttribute("data-f", "note"); n.setAttribute("aria-label", "Note: " + val("P:" + p.id, "name"));
          n.classList.toggle("empty", !n.value);
          row.appendChild(n);
          td.appendChild(row);
          setTimeout(function () { grow(n); }, 0);
          td.appendChild(meta([ck + "|rating", ck + "|note"], "tmcmeta"));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      wrap.appendChild(tb);
      gbox.appendChild(wrap);
      gbox.appendChild(addForm("New duty", "Add a duty", function (v, i) { add("duty", { title: v, group: g.id }, function () { i.value = ""; }); }));
      var ad = duties(g.id, true);
      if (ad.length) {
        var det = mk("details", "tmarch"); det.appendChild(mk("summary", null, "Removed duties (" + ad.length + ")"));
        ad.forEach(function (d) {
          var row = mk("div", "tmarchrow"); row.appendChild(mk("span", null, val("D:" + d.id, "title")));
          var b = mk("button", "tmlink", "Bring back"); b.type = "button";
          b.addEventListener("click", function () { setNow("D:" + d.id, "archived", ""); });
          row.appendChild(b); det.appendChild(row);
        });
        gbox.appendChild(det);
      }
      sec.appendChild(gbox);
    });
    sec.appendChild(addForm("New group, for example field duties", "Add a duty group", function (v, i) { add("group", { title: v }, function () { i.value = ""; }); }, "tmaddgroup"));
    return sec;
  }

  function swBox(sk, wl) {
    var hit = null;
    (C.skill_will || []).forEach(function (b) { if (b.skill === sk && b.will === wl) hit = b; });
    return hit;
  }

  function picker(key, f, label) {
    var g = mk("div", "tmpick"); g.setAttribute("role", "group"); g.setAttribute("aria-label", label);
    g.appendChild(mk("span", "tmpicklab", label));
    ["high", "low"].forEach(function (v) {
      var b = mk("button", "tmseg", v === "high" ? "High" : "Low"); b.type = "button";
      b.setAttribute("data-k", key); b.setAttribute("data-f", f); b.setAttribute("data-v", v);
      b.setAttribute("aria-pressed", val(key, f) === v ? "true" : "false");
      b.addEventListener("click", function () {
        var nv = val(key, f) === v ? "" : v;
        queue(key, f, nv, 0); paintPickers();
      });
      g.appendChild(b);
    });
    return g;
  }
  function paintPickers() {
    Array.prototype.forEach.call(document.querySelectorAll("#tmMain .tmseg"), function (b) {
      b.setAttribute("aria-pressed", val(b.getAttribute("data-k"), b.getAttribute("data-f")) === b.getAttribute("data-v") ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tmMain [data-swresult]"), function (n) {
      var k = n.getAttribute("data-swresult"), b = swBox(val(k, "swSkill"), val(k, "swWill"));
      n.textContent = b ? b.title + ". " + b.text : "Pick both to see how to manage.";
      n.classList.toggle("set", !!b);
    });
  }

  function swSection() {
    var sec = mk("section", "tmsec"); sec.id = "tmSW";
    sec.appendChild(mk("h2", null, L.skillWill || ""));
    sec.appendChild(mk("p", "tmhint", L.skillWillHelp || ""));
    var grid = mk("div", "tmswgrid");
    [["low", "high"], ["high", "high"], ["low", "low"], ["high", "low"]].forEach(function (x) {
      var b = swBox(x[0], x[1]); if (!b) return;
      var c = mk("div", "tmswbox s" + x[0] + " w" + x[1]);
      c.appendChild(mk("b", null, b.title)); c.appendChild(mk("p", null, b.text));
      grid.appendChild(c);
    });
    sec.appendChild(grid);
    var list = mk("div", "tmswlist");
    people(false).forEach(function (p) {
      var k = "P:" + p.id;
      var row = mk("div", "tmswrow"); row.setAttribute("data-sw", p.id);
      row.appendChild(mk("h3", null, val(k, "name")));
      var picks = mk("div", "tmpicks");
      picks.appendChild(picker(k, "swSkill", "Skill"));
      picks.appendChild(picker(k, "swWill", "Will"));
      row.appendChild(picks);
      var res = mk("p", "tmswres"); res.setAttribute("data-swresult", k); row.appendChild(res);
      row.appendChild(field("Note", k, "swNote", { area: true, rows: 1, max: 1000, ph: "Optional" }));
      row.appendChild(meta(personKeys(p.id, "sw")));
      list.appendChild(row);
    });
    sec.appendChild(list);
    setTimeout(paintPickers, 0);
    return sec;
  }

  /* ---------- in-place refresh (never touches a focused or unsent box) ---------- */
  function refresh() {
    var act = document.activeElement;
    Array.prototype.forEach.call(document.querySelectorAll("#tmMain [data-k][data-f]"), function (n) {
      if (n.classList.contains("tmseg")) return;
      var k = n.getAttribute("data-k"), f = n.getAttribute("data-f");
      if (n === act || (k + "|" + f) in dirty) return;
      var v = val(k, f);
      if (n.value !== v) { n.value = v; grow(n); }
      n.classList.toggle(n.tagName === "SELECT" ? "blank" : "empty", !v);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tmMain [data-meta]"), function (n) { n.textContent = metaText(n.getAttribute("data-meta").split(",")); });
    paintPickers();
  }
  function busy() {
    var a = document.activeElement;
    return Object.keys(dirty).length > 0 || (a && a.closest && a.closest("#tmMain") && /INPUT|TEXTAREA|SELECT/.test(a.tagName));
  }
  function maybeDraw() {
    if (sig() !== drawnSig) {
      if (busy()) { pendingDraw = true; status("Someone added or removed something. It shows when you finish typing.", false); return; }
      draw();
    } else refresh();
  }

  /* ---------- saving ---------- */
  function status(text, bad) { var s = $("tmStatus"); if (s) { s.textContent = text; s.classList.toggle("bad", !!bad); } }

  function onInput(e) {
    var n = e.target, k = n.getAttribute && n.getAttribute("data-k"), f = n.getAttribute && n.getAttribute("data-f");
    if (!k || !f || n.classList.contains("tmseg")) return;
    var isText = n.tagName === "TEXTAREA" || (n.tagName === "INPUT" && n.type === "text");
    if (isText && e.type === "change") { flush(); return; }
    if (isText) grow(n);
    n.classList.toggle(n.tagName === "SELECT" ? "blank" : "empty", !n.value);
    queue(k, f, n.value, isText ? TEXT_DELAY : 0);
  }

  function queue(key, f, value, delay) {
    dirty[key + "|" + f] = { key: key, field: f, value: value };
    if (!who) { needName(); return; }
    status("Saving...");
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }
  function needName() {
    var w = $("tmWho"); if (w) { w.parentNode.classList.add("need"); }
    status("Type your name at the top so your changes can be saved. They are kept until then.", true);
  }

  function post(ops) {
    return R.api("/team/save" + Q, { method: "POST", json: { saved_by: who, ops: ops } }).then(answer);
  }

  function flush() {
    clearTimeout(timer);
    chain = chain.then(doFlush, doFlush);
    return chain;
  }
  function doFlush() {
    var keys = Object.keys(dirty); if (!keys.length) return;
    if (!who) { needName(); return; }
    var send = {}; keys.forEach(function (dk) { send[dk] = dirty[dk]; });
    var ops = keys.map(function (dk) { var x = send[dk], cur = fs(x.key, x.field); return { op: "set", key: x.key, field: x.field, value: x.value, base: cur ? cur.rev : 0 }; });
    return post(ops).then(function (x) {
      if (x.s === 200 && x.j.ok) {
        keys.forEach(function (dk) { if (dirty[dk] === send[dk]) delete dirty[dk]; });
        S = x.j.state; status("Saved " + clock()); maybeDraw();
      } else if (x.s === 409 && x.j.state) {
        keys.forEach(function (dk) { if (dirty[dk] === send[dk]) delete dirty[dk]; });
        S = x.j.state; status(x.j.error || "Changed somewhere else. The latest is shown.", true);
        if (busy() && sig() === drawnSig) refresh(); else draw();
      } else {
        status("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), true);
      }
    }).catch(function (e) {
      if (e && e.message === "signed out") return;
      status("Not saved: no connection. It will try again.", true);
      setTimeout(flush, 15000);
    });
  }

  function setNow(key, f, value) {
    if (!who) { dirty[key + "|" + f] = { key: key, field: f, value: value }; needName(); return; }
    dirty[key + "|" + f] = { key: key, field: f, value: value };
    status("Saving...");
    flush().then(function () { if (!busy()) draw(); else pendingDraw = true; });
  }

  function add(type, fields, done) {
    if (!who) { needName(); return; }
    status("Saving...");
    chain = chain.then(function () {
      return post([{ op: "add", type: type, fields: fields }]).then(function (x) {
        if (x.s === 200 && x.j.ok) { S = x.j.state; status("Saved " + clock()); if (done) done(); draw(); }
        else status("Not saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), true);
      }).catch(function (e) { if (!e || e.message !== "signed out") status("Not saved: no connection. Try again.", true); });
    });
  }

  function poll() {
    if (document.hidden) return;
    if (Object.keys(dirty).length && who) flush();
    R.apiJSON("/team/board?part=state" + (TEST ? "&as=TEST" : "")).then(function (d) {
      if (!d || !d.ok || !d.state) return;
      if (S && d.state.last_event_id === S.last_event_id) return;
      S = d.state; maybeDraw();
    }).catch(function () { });
  }

  /* ---------- print: a clean read-only copy built from what is on screen ---------- */
  function buildPrint() {
    var pv = $("tmPrint"); if (!pv) return;
    pv.innerHTML = "";
    pv.appendChild(mk("h1", null, C.title || ""));
    pv.appendChild(mk("p", "pdate", "Printed " + new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })));
    var ps = people(false);
    pv.appendChild(mk("h2", null, L.people || ""));
    ps.forEach(function (p) {
      var k = "P:" + p.id, card = mk("div", "pcard");
      card.appendChild(mk("h3", null, val(k, "name")));
      (C.questions || []).forEach(function (q) {
        var v = q.field ? val(k, q.field) : val(k, q.id);
        var row = mk("div", "pq"); row.appendChild(mk("div", "pqt", q.n + ". " + q.text));
        row.appendChild(mk("div", "pqa" + (v ? "" : " pblank"), v || ""));
        card.appendChild(row);
      });
      pv.appendChild(card);
    });
    var ms = mk("div", "pmatrix");
    ms.appendChild(mk("h2", null, L.matrix || ""));
    ms.appendChild(mk("p", "pleg", (C.legend || []).map(function (l) { return l.v + " " + l.label; }).join("   |   ")));
    groups(false).forEach(function (g) {
      ms.appendChild(mk("h3", null, val("G:" + g.id, "title")));
      var t = mk("table", "ptable"), hr = mk("tr");
      hr.appendChild(mk("th", null, "Duty"));
      ps.forEach(function (p) { hr.appendChild(mk("th", null, val("P:" + p.id, "name"))); });
      var th = mk("thead"); th.appendChild(hr); t.appendChild(th);
      var tb = mk("tbody");
      duties(g.id, false).forEach(function (d) {
        var tr = mk("tr"), dc = mk("th", null, val("D:" + d.id, "title")); tr.appendChild(dc);
        ps.forEach(function (p) {
          var ck = "C:" + d.id + ":" + p.id, td = mk("td");
          td.appendChild(mk("div", "prate" + (val(ck, "rating") ? "" : " pblankbox"), val(ck, "rating") || ""));
          if (val(ck, "note")) td.appendChild(mk("div", "pnote", val(ck, "note")));
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb); ms.appendChild(t);
    });
    pv.appendChild(ms);
    var sw = mk("div", "psw");
    sw.appendChild(mk("h2", null, L.skillWill || ""));
    var t2 = mk("table", "ptable"), h2 = mk("tr");
    ["Person", "Skill", "Will", "How to manage", "Note"].forEach(function (x) { h2.appendChild(mk("th", null, x)); });
    var th2 = mk("thead"); th2.appendChild(h2); t2.appendChild(th2);
    var tb2 = mk("tbody");
    ps.forEach(function (p) {
      var k = "P:" + p.id, b = swBox(val(k, "swSkill"), val(k, "swWill")), tr = mk("tr");
      tr.appendChild(mk("th", null, val(k, "name")));
      ["swSkill", "swWill"].forEach(function (f) { var v = val(k, f); tr.appendChild(mk("td", v ? "" : "pblank", v ? (v === "high" ? "High" : "Low") : "")); });
      tr.appendChild(mk("td", b ? "" : "pblank", b ? b.title : ""));
      tr.appendChild(mk("td", null, val(k, "swNote")));
      tb2.appendChild(tr);
    });
    t2.appendChild(tb2); sw.appendChild(t2);
    var gl = mk("div", "pguide");
    (C.skill_will || []).forEach(function (b) { gl.appendChild(mk("p", null, b.title + ": " + b.text)); });
    sw.appendChild(gl);
    pv.appendChild(sw);
  }
})();
