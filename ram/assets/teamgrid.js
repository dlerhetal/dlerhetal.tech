/* Team skills, the simple grid: skills down the side, people across the top, one box per pair.
   Generic: no person, skill or client name is in this file; the people and the skills arrive from the API after
   sign-in.

   A box takes a NUMBER, 0 to 3 (the scale is in SCALE below), or stays blank. Blank means "not entered yet" and is
   never the same as 0. A row the record marks as yes/no (skill field kind = "yn") takes a tick and, once ticked, an
   optional date it runs out.

   Typing a digit saves that one box at once and moves down to the next skill for the same person; Enter, Tab and the
   down arrow move down too, Shift+Tab and the up arrow move up, Backspace or Delete blanks the box. Every change is one
   op ({op:"set", key:"T:<skill>:<person>", field:"r" | "v" | "x", value}), append-only on the server with the name
   typed once at the top (kept in this browser's storage, inside try/catch) and the time. A change made before a name
   is typed is held and saved as soon as the name is in.

   A box is drawn from what the server holds unless a change to it is still on its way (dotted edge) or was refused
   (red edge, counted at the top with "Try again"). It never shows as saved before the server has answered with the
   same value. The page follows the server every 30 seconds and when the tab comes back, without moving the cursor.

   Wide screens: one grid, sticky skill column and sticky name row, scrolling sideways inside its own box only.
   Narrow screens (under 700px): "One person" (pick a person, key their skills top to bottom) and "One skill"
   (pick a skill, see everyone). Print: the grid on landscape pages.

   Self-rated (2026-10-15): numbers loaded from a man's own skills sheet are saved under the author SELF_BY; the one
   line the sheet's "Checked by" column marked is saved under CHK_BY + who checked it. Such a box carries a corner
   mark and says so when pointed at; anything typed on the page later is saved under the typist's name as before.
   "Where training stands" at the top is worked out from the record every time it is drawn: sheets in (a person on
   the grid whose flag starts with "No skills sheet" is not counted), who is still out, the pump-set skills with who
   self-rates 3, and the skills nobody with a sheet rates above 1. No names live in this file. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var WHO_KEY = R.NS.slice(1) + "_team_who";
  var VIEW_KEY = R.NS.slice(1) + "_team_view";
  var CSS_V = "3";
  var SCALE = [[0, "Never done it"], [1, "Done it with help"], [2, "Can do it alone, every time"], [3, "Can teach it to someone else"]];
  var S = null, who = "", busy = false, sending = false, lastError = "";
  var local = {};   /* "T:<s>:<p>|<field>" -> {key, field, value, st: queued | sending | failed} : changes not yet confirmed */
  var okAt = {};    /* same key -> time the server confirmed it, for the short "saved" mark */
  var view = { mode: "person", person: "", skill: "" };
  var SELF_BY = "Skills sheet (self-rated)";
  var CHK_BY = "Skills sheet, checked by ";
  var NO_SHEET = /^No skills sheet/i;
  /* setting a pump: the skills the job leans on (from the 10/15 seven-sheet read) */
  var PUMP_SET = ["s4_01", "s4_03", "s4_06", "s4_02", "s4_04", "s4_07", "s6_03", "s1_10", "s2_08", "s2_09", "s2_10", "s6_10", "s6_12", "s6_11"];

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function readKey(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function writeKey(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function fail(text) { document.body.insertBefore(mk("p", "tgfail", text), document.body.firstChild); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function each(sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); }

  R.gate(function () {
    R.apiJSON("/team/grid" + Q).then(function (d) {
      if (!d || !d.ok || !d.state) throw new Error((d && d.error) || "The page could not be loaded.");
      start(d.state);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The page could not be loaded."); });
  });

  /* ---------- state helpers ---------- */
  function fv(it, f) { var c = it && it.f && it.f[f]; return c ? c.v : ""; }
  function people(list) { return S.people.filter(function (p) { return (fv(p, "list") || "grid") === list; }); }
  function groups() { return S.groups; }
  function skills(groupId, hidden) {
    return S.skills.filter(function (s) { return (groupId == null || fv(s, "group") === groupId) && (!!fv(s, "archived")) === !!hidden; });
  }
  function byId(bag, id) { for (var i = 0; i < bag.length; i++) if (bag[i].id === id) return bag[i]; return null; }
  function isYN(s) { return fv(s, "kind") === "yn"; }
  function bagOf(field) { return field === "r" ? (S.rates || {}) : field === "x" ? (S.exp || {}) : (S.ticks || {}); }
  function blank(field) { return field === "r" ? null : ""; }
  function cell(sid, pid, field) { return bagOf(field)[sid + ":" + pid] || null; }
  function held(sid, pid, field) { return local["T:" + sid + ":" + pid + "|" + field] || null; }
  /* what the server holds */
  function saved(sid, pid, field) { var c = cell(sid, pid, field); return c && c.v !== undefined && c.v !== "" ? c.v : blank(field); }
  /* what the box shows: a change on its way wins over what the server holds */
  function shown(sid, pid, field) { var h = held(sid, pid, field); return h ? h.value : saved(sid, pid, field); }
  function rate(sid, pid) { var v = shown(sid, pid, "r"); return v === null || v === undefined || v === "" ? null : Number(v); }
  function isOn(sid, pid) { return shown(sid, pid, "v") === "1"; }
  /* where a box's value came from: "self" (his own sheet), "chk" (the sheet's Checked by column), or "" */
  function origin(sid, pid, field) {
    if (held(sid, pid, field)) return "";
    var c = cell(sid, pid, field); if (!c || c.v === null || c.v === "") return "";
    if (c.by === SELF_BY) return "self";
    return c.by && c.by.indexOf(CHK_BY) === 0 ? "chk" : "";
  }
  function checkedBy(sid, pid, field) { var c = cell(sid, pid, field); return c && c.by ? c.by.slice(CHK_BY.length) : ""; }
  function originText(sid, pid, field) {
    var o = origin(sid, pid, field);
    if (o === "self") return " Self-rated on his own skills sheet; not checked by a supervisor yet.";
    if (o === "chk") return " From his skills sheet; the Checked by column is marked (checked by " + checkedBy(sid, pid, field) + ").";
    return "";
  }
  /* the name on the grid: the first name, or the whole name when two people on the grid share a first name */
  function shortName(p) {
    var full = fv(p, "name"), first = full.split(" ")[0];
    var same = people("grid").filter(function (x) { return fv(x, "name").split(" ")[0] === first; }).length;
    return same > 1 ? full : first;
  }
  function isoToday() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function showDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? (+m[2]) + "/" + (+m[3]) + "/" + m[1].slice(2) : ""; }
  /* "" for blank, a YYYY-MM-DD date, or null when the words are not a date */
  function parseDate(t) {
    t = String(t || "").trim();
    if (!t) return "";
    var y, mo, d, m;
    if ((m = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2}|\d{4})$/.exec(t))) { mo = +m[1]; d = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(t))) { mo = +m[1]; d = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (y < 100) y += 2000;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + "-" + ("0" + mo).slice(-2) + "-" + ("0" + d).slice(-2);
  }
  function lastLine(sid, pid) {
    var s = byId(S.skills, sid), p = byId(S.people, pid);
    var head = (s ? fv(s, "title") : "") + ", " + (p ? shortName(p) : "") + ": ";
    var h = held(sid, pid, "r") || held(sid, pid, "v") || held(sid, pid, "x");
    if (h) return head + (h.st === "failed" ? "NOT SAVED. Type it again or press Try again." : "saving...");
    if (s && isYN(s)) {
      var t = cell(sid, pid, "v"), x = saved(sid, pid, "x");
      if (!t) return head + "not entered yet.";
      return head + (t.v === "1" ? "yes" : "blank") + (x ? ", runs out " + showDate(x) : "") + ", changed by " + t.by + ", " + R.fmtTs(t.ts) + "." + originText(sid, pid, "v");
    }
    var c = cell(sid, pid, "r");
    if (!c) return head + "not entered yet.";
    return head + (c.v === null || c.v === "" ? "blanked" : c.v) + " by " + c.by + ", " + R.fmtTs(c.ts) + "." + originText(sid, pid, "r");
  }

  /* ---------- start ---------- */
  function start(state) {
    S = state;
    who = TEST ? "TEST" : readKey(WHO_KEY);
    try { var v = JSON.parse(readKey(VIEW_KEY) || "{}"); if (v && v.mode) view = { mode: v.mode, person: v.person || "", skill: v.skill || "" }; } catch (e) { }
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet";
    var me = document.querySelector('script[src*="/teamgrid.js"]');
    css.href = me ? me.src.replace(/\/teamgrid\.js[^\/]*$/, "/teamgrid.css?v=" + CSS_V) : "../assets/teamgrid.css?v=" + CSS_V;
    var go = function () {
      go = function () { };
      document.title = "Team skills";
      frame();
      draw();
      setInterval(poll, 30000);
      window.addEventListener("focus", function () { poll(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeprint", buildPrint);
      window.addEventListener("beforeunload", function (e) { if (Object.keys(local).length) { e.preventDefault(); e.returnValue = ""; } });
      document.body.setAttribute("data-grid-ready", TEST ? "test" : "yes");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  function frame() {
    var nav = mk("div", "tgnav noprint");
    var home = mk("a", null, "All tools"); home.href = "../"; nav.appendChild(home);
    var wl = mk("label", "tgwho"); wl.id = "tgWhoWrap";
    wl.appendChild(mk("span", null, "Your name"));
    var wi = mk("input"); wi.type = "text"; wi.id = "tgWho"; wi.maxLength = 40; wi.autocomplete = "name"; wi.value = who; wi.placeholder = "Type it once";
    if (TEST) wi.disabled = true;
    wi.addEventListener("change", function () {
      who = wi.value.replace(/\s+/g, " ").trim(); wi.value = who; writeKey(WHO_KEY, who);
      wl.classList.toggle("need", !who);
      if (who) pump();
    });
    wl.appendChild(wi);
    nav.appendChild(wl);
    var st = mk("span", "tgstatus"); st.id = "tgStatus"; st.setAttribute("role", "status"); nav.appendChild(st);
    var re = mk("button", "tgbtn warn", "Try again"); re.type = "button"; re.id = "tgRetry"; re.hidden = true;
    re.addEventListener("click", retry);
    nav.appendChild(re);
    var pr = mk("button", "tgbtn", "Print"); pr.type = "button"; pr.id = "tgPrintBtn";
    pr.addEventListener("click", function () { buildPrint(); window.print(); });
    nav.appendChild(pr);
    var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);
    var main = mk("main", "tgmain noprint"); main.id = "tgMain";
    document.body.insertBefore(main, document.body.querySelector("script"));
    var pv = mk("div", "tgprint"); pv.id = "tgPrint";
    document.body.insertBefore(pv, document.body.querySelector("script"));
    main.addEventListener("change", onChange);
    main.addEventListener("input", onInput);
    main.addEventListener("keydown", onKey);
    main.addEventListener("mouseover", onPoint);
    main.addEventListener("focusin", onFocus);
  }

  /* ---------- where training stands (top of the page, for the office) ---------- */
  function hasSheet(p) {
    return S.skills.some(function (s) { return origin(s.id, p.id, isYN(s) ? "v" : "r") !== ""; });
  }
  function fillStand() {
    var box = $("tgStand"); if (!box || !S) return;
    box.innerHTML = "";
    var crew = people("grid").filter(function (p) { return !NO_SHEET.test(fv(p, "flag")); });
    var inn = crew.filter(hasSheet), out = crew.filter(function (p) { return !hasSheet(p); });
    var h = mk("h2", null, "Where team training stands"); h.id = "tgStandHead"; box.appendChild(h);
    var p1 = mk("p", "tgsline"); p1.id = "tgSheetsIn";
    p1.appendChild(mk("b", null, "Skills sheets in: " + inn.length + " of " + crew.length + "."));
    if (out.length) p1.appendChild(document.createTextNode(" Still out: " + out.map(shortName).join(", ") + "."));
    box.appendChild(p1);
    var lg = mk("p", "tgsline"); lg.id = "tgStandKey";
    lg.appendChild(document.createTextNode("0 never done it, 1 done it with help, 2 alone every time, 3 can teach it. "));
    lg.appendChild(mk("span", "tgselfmark", ""));
    lg.appendChild(document.createTextNode(" Self-rated: every number from a sheet is the man's own claim until a supervisor checks it (watches him do it, then watches him teach it)."));
    box.appendChild(lg);
    var rated = function (s) { return !isYN(s) && !fv(s, "archived"); };
    var pump = PUMP_SET.map(function (id) { return byId(S.skills, id); }).filter(function (s) { return s && rated(s); });
    if (pump.length && inn.length) {
      var d = mk("div", "tgspump"); d.id = "tgPumpSet";
      d.appendChild(mk("h3", null, "Setting a well pump: who says he can teach each skill"));
      d.appendChild(mk("p", "tgsnote", "Self-rated 3s: candidates to teach, not proven."));
      var ul = mk("ul", "tgslist");
      pump.forEach(function (s) {
        var li = mk("li"); li.setAttribute("data-pump", s.id);
        li.appendChild(mk("b", null, fv(s, "title") + ": "));
        var who3 = inn.filter(function (p) { return rate(s.id, p.id) === 3; }).map(function (p) {
          return shortName(p) + (origin(s.id, p.id, "r") === "chk" ? " (checked by " + checkedBy(s.id, p.id, "r") + ")" : "");
        });
        li.appendChild(document.createTextNode(who3.length ? who3.join(", ") : "nobody yet"));
        ul.appendChild(li);
      });
      d.appendChild(ul);
      box.appendChild(d);
    }
    var gaps = S.skills.filter(rated).filter(function (s) {
      return inn.length > 0 && inn.every(function (p) { var v = rate(s.id, p.id); return v !== null && v <= 1; });
    });
    if (inn.length) {
      var g = mk("div", "tgsgap"); g.id = "tgGaps";
      g.appendChild(mk("h3", null, "Nobody of the " + inn.length + " with a sheet rates above 1"));
      var gl = mk("ul", "tgslist");
      if (!gaps.length) gl.appendChild(mk("li", null, "None."));
      gaps.forEach(function (s) { var li = mk("li", null, fv(s, "title")); li.setAttribute("data-gap", s.id); gl.appendChild(li); });
      g.appendChild(gl);
      box.appendChild(g);
    }
  }

  /* ---------- drawing ---------- */
  function scaleKey() {
    var k = mk("div", "tgkey"); k.id = "tgKey";
    k.appendChild(mk("p", "tgkeyhead", "What the numbers mean"));
    var ul = mk("ul", "tgkeylist");
    SCALE.forEach(function (x) {
      var li = mk("li");
      li.appendChild(mk("span", "tgchip lv" + x[0], String(x[0])));
      li.appendChild(mk("span", null, x[1]));
      ul.appendChild(li);
    });
    k.appendChild(ul);
    k.appendChild(mk("p", "tgkeynote", "A blank box means not entered yet. It is not the same as 0."));
    if (S.skills.some(function (s) { return isYN(s) && !fv(s, "archived"); })) {
      k.appendChild(mk("p", "tgkeynote", "Rows marked Yes / No: tick the box for yes, then type the date it runs out, if it has one."));
    }
    return k;
  }

  function draw() {
    var main = $("tgMain"), y = window.scrollY;
    var openSet = {}, gw = $("tgGridWrap"), gx = gw ? gw.scrollLeft : 0, gy = gw ? gw.scrollTop : 0;
    each("details[id]", function (d) { openSet[d.id] = d.open; }, main);
    main.innerHTML = "";
    main.appendChild(mk("h1", null, "Team skills"));
    main.appendChild(mk("p", "tgintro", "Type a number in each box. It saves by itself and moves down to the next skill."));
    var stand = mk("section", "tgstand"); stand.id = "tgStand"; stand.setAttribute("aria-labelledby", "tgStandHead");
    main.appendChild(stand);
    fillStand();
    main.appendChild(scaleKey());
    main.appendChild(gridView());
    main.appendChild(narrowView());
    var info = mk("p", "tginfo"); info.id = "tgInfo"; info.setAttribute("aria-live", "polite");
    info.textContent = "Point at or tap a box to see who changed it last.";
    main.appendChild(info);
    main.appendChild(pastSection());
    main.appendChild(changeSection());
    var foot = mk("p", "tgfoot");
    var a = mk("a", null, "Interview cards and full skills matrix"); a.href = "detail/"; a.id = "tgDetailLink";
    foot.appendChild(a);
    main.appendChild(foot);
    Object.keys(openSet).forEach(function (id) { var d = $(id); if (d) d.open = openSet[id]; });
    window.scrollTo(0, y);
    gw = $("tgGridWrap"); if (gw) { gw.scrollLeft = gx; gw.scrollTop = gy; }
    sync();
    showStatus();
  }

  /* one pair's controls: a number box, or a tick plus the date it runs out */
  function ctl(s, p, label) {
    var w = mk("span", "tgc");
    if (isYN(s)) {
      w.classList.add("yn");
      var c = mk("input", "tgbox"); c.type = "checkbox";
      c.setAttribute("data-s", s.id); c.setAttribute("data-p", p.id); c.setAttribute("data-f", "v");
      c.setAttribute("aria-label", label + ", yes or no");
      var x = mk("input", "tgexp"); x.type = "text"; x.inputMode = "numeric"; x.autocomplete = "off"; x.maxLength = 10;
      x.placeholder = "m/d/yy";
      x.setAttribute("data-s", s.id); x.setAttribute("data-p", p.id); x.setAttribute("data-f", "x");
      x.setAttribute("aria-label", label + ", date it runs out");
      w.appendChild(c); w.appendChild(x);
    } else {
      var n = mk("input", "tgnum"); n.type = "text"; n.inputMode = "numeric"; n.autocomplete = "off";
      n.setAttribute("pattern", "[0-3]?");
      n.setAttribute("data-s", s.id); n.setAttribute("data-p", p.id); n.setAttribute("data-f", "r");
      n.setAttribute("aria-label", label + ", 0 to 3");
      w.appendChild(n);
    }
    return w;
  }

  function gridView() {
    var wrap = mk("div", "tgwide"); wrap.id = "tgGridWrap";
    var ppl = people("grid");
    var tbl = mk("table", "tggrid"); tbl.id = "tgGrid";
    var thead = mk("thead"), hr = mk("tr");
    var corner = mk("th", "tgcorner", "Skill"); corner.scope = "col"; hr.appendChild(corner);
    ppl.forEach(function (p) {
      var th = mk("th", "tgname"); th.scope = "col"; th.setAttribute("data-p", p.id);
      th.appendChild(mk("span", "tgnm", shortName(p)));
      var dn = mk("span", "tgdone"); dn.setAttribute("data-done", p.id); dn.title = "Numbers entered for this person";
      th.appendChild(dn);
      hr.appendChild(th);
    });
    var sh = mk("th", "tgsumh", "At 2 or 3"); sh.scope = "col"; sh.title = "How many people can do it alone or teach it (for a Yes / No row: how many are ticked)";
    hr.appendChild(sh);
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = mk("tbody");
    groups().forEach(function (g) {
      var sk = skills(g.id, false);
      if (!sk.length) return;
      var gr = mk("tr", "tggrow");
      var gth = mk("th", "tggroup", fv(g, "title")); gth.scope = "rowgroup"; gr.appendChild(gth);
      var fill = mk("td", "tggfill"); fill.colSpan = ppl.length + 1; gr.appendChild(fill);
      tb.appendChild(gr);
      sk.forEach(function (s) {
        var tr = mk("tr");
        var th = mk("th", "tgskill"); th.scope = "row";
        th.appendChild(mk("span", null, fv(s, "title")));
        if (isYN(s)) th.appendChild(mk("span", "tgtag", "Yes / No"));
        tr.appendChild(th);
        ppl.forEach(function (p) {
          var td = mk("td", "tgcell");
          td.appendChild(ctl(s, p, fv(s, "title") + ", " + shortName(p)));
          tr.appendChild(td);
        });
        var sum = mk("td", "tgsum"); sum.setAttribute("data-sum", s.id); tr.appendChild(sum);
        tb.appendChild(tr);
      });
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    return wrap;
  }

  function narrowView() {
    var wrap = mk("div", "tgnarrow"); wrap.id = "tgNarrow";
    var tabs = mk("div", "tgtabs"); tabs.setAttribute("role", "tablist");
    [["person", "One person"], ["skill", "One skill"]].forEach(function (x) {
      var b = mk("button", "tgtab" + (view.mode === x[0] ? " on" : ""), x[1]); b.type = "button";
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", view.mode === x[0] ? "true" : "false");
      b.setAttribute("data-mode", x[0]);
      b.addEventListener("click", function () { view.mode = x[0]; saveView(); draw(); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
    var ppl = people("grid");
    if (view.mode === "person") {
      if (!byId(ppl, view.person)) view.person = ppl.length ? ppl[0].id : "";
      var sel = mk("select", "tgsel"); sel.id = "tgPickPerson"; sel.setAttribute("aria-label", "Person");
      ppl.forEach(function (p) { var o = mk("option", null, shortName(p)); o.value = p.id; sel.appendChild(o); });
      sel.value = view.person;
      sel.addEventListener("change", function () { view.person = sel.value; saveView(); draw(); });
      wrap.appendChild(sel);
      if (view.person) {
        var who1 = byId(ppl, view.person);
        var cnt = mk("p", "tgcount"); cnt.id = "tgCount"; wrap.appendChild(cnt);
        groups().forEach(function (g) {
          var sk = skills(g.id, false); if (!sk.length) return;
          wrap.appendChild(mk("h3", "tglisthead", fv(g, "title")));
          var ul = mk("div", "tglist");
          sk.forEach(function (s) {
            var row = mk("label", "tgrow");
            row.appendChild(ctl(s, who1, fv(s, "title") + ", " + shortName(who1)));
            row.appendChild(mk("span", "tgrowt", fv(s, "title")));
            ul.appendChild(row);
          });
          wrap.appendChild(ul);
        });
      }
    } else {
      var all = skills(null, false);
      if (!byId(all, view.skill)) view.skill = all.length ? all[0].id : "";
      var ss = mk("select", "tgsel"); ss.id = "tgPickSkill"; ss.setAttribute("aria-label", "Skill");
      groups().forEach(function (g) {
        var sk = skills(g.id, false); if (!sk.length) return;
        var og = document.createElement("optgroup"); og.label = fv(g, "title");
        sk.forEach(function (s) { var o = mk("option", null, fv(s, "title")); o.value = s.id; og.appendChild(o); });
        ss.appendChild(og);
      });
      ss.value = view.skill;
      ss.addEventListener("change", function () { view.skill = ss.value; saveView(); draw(); });
      wrap.appendChild(ss);
      if (view.skill) {
        var sk1 = byId(all, view.skill);
        var c2 = mk("p", "tgcount"); c2.id = "tgCount"; wrap.appendChild(c2);
        var list = mk("div", "tglist");
        ppl.forEach(function (p) {
          var row = mk("label", "tgrow");
          row.appendChild(ctl(sk1, p, fv(sk1, "title") + ", " + shortName(p)));
          row.appendChild(mk("span", "tgrowt", shortName(p)));
          list.appendChild(row);
        });
        wrap.appendChild(list);
      }
    }
    return wrap;
  }
  function saveView() { writeKey(VIEW_KEY, JSON.stringify(view)); }

  /* ---------- painting boxes and counts in place (never moves the cursor) ---------- */
  function paint(el) {
    var sid = el.getAttribute("data-s"), pid = el.getAttribute("data-p"), f = el.getAttribute("data-f");
    var lk = "T:" + sid + ":" + pid + "|" + f, h = local[lk];
    var active = document.activeElement === el;
    el.classList.toggle("is-wait", !!h && h.st !== "failed");
    el.classList.toggle("is-err", !!h && h.st === "failed");
    el.classList.toggle("is-ok", !h && !!okAt[lk] && Date.now() - okAt[lk] < 2500);
    if (f !== "x") {
      var og = origin(sid, pid, f), host = f === "v" && el.parentNode ? el.parentNode : el;
      host.classList.toggle("is-self", og === "self");
      host.classList.toggle("is-chk", og === "chk");
    }
    if (f === "r") {
      var v = rate(sid, pid), t = v === null ? "" : String(v);
      if (el.value !== t) el.value = t;
      [0, 1, 2, 3].forEach(function (n) { el.classList.toggle("lv" + n, v === n); });
      el.title = lastLine(sid, pid);
    } else if (f === "v") {
      var on = isOn(sid, pid);
      if (el.checked !== on) el.checked = on;
      if (el.parentNode) el.parentNode.classList.toggle("on", on);
      el.title = lastLine(sid, pid);
    } else {
      var x = shown(sid, pid, "x") || "";
      if (el.getAttribute("data-bad") === "1") { el.classList.add("is-err"); return; }   /* words that are not a date stay, in red */
      if (!active) el.value = showDate(x);
      el.classList.toggle("old", !!x && x < isoToday());
      el.title = x && x < isoToday() ? "This date has passed." : "The date it runs out";
    }
  }
  function sync() {
    var main = $("tgMain"); if (!main) return;
    each(".tgnum, .tgbox, .tgexp", paint, main);
    counts();
    fillStand();
  }
  function counts() {
    var ppl = people("grid"), sk = skills(null, false);
    var rated = sk.filter(function (s) { return !isYN(s); });
    each("[data-done]", function (n) {
      var pid = n.getAttribute("data-done");
      var k = rated.filter(function (s) { return rate(s.id, pid) !== null; }).length;
      n.textContent = k + " of " + rated.length;
      n.classList.toggle("full", rated.length > 0 && k === rated.length);
    });
    each("[data-sum]", function (n) {
      var s = byId(S.skills, n.getAttribute("data-sum")); if (!s) return;
      var k = ppl.filter(function (p) { return isYN(s) ? isOn(s.id, p.id) : (rate(s.id, p.id) || 0) >= 2; }).length;
      var any = ppl.some(function (p) { return isYN(s) ? isOn(s.id, p.id) : rate(s.id, p.id) !== null; });
      n.textContent = any ? String(k) : "";
    });
    var c = $("tgCount");
    if (c && view.mode === "person" && view.person) {
      var k1 = rated.filter(function (s) { return rate(s.id, view.person) !== null; }).length;
      c.textContent = k1 + " of " + rated.length + " numbers entered";
    } else if (c && view.skill) {
      var s1 = byId(S.skills, view.skill);
      if (s1 && isYN(s1)) c.textContent = "Yes: " + ppl.filter(function (p) { return isOn(s1.id, p.id); }).length + " of " + ppl.length;
      else if (s1) c.textContent = "At 2 or 3: " + ppl.filter(function (p) { return (rate(s1.id, p.id) || 0) >= 2; }).length + " of " + ppl.length;
    }
  }
  function showStatus() {
    var s = $("tgStatus"), re = $("tgRetry"); if (!s) return;
    var keys = Object.keys(local);
    var bad = keys.filter(function (k) { return local[k].st === "failed"; }).length, wait = keys.length - bad;
    var wl = $("tgWhoWrap"); if (wl) wl.classList.toggle("need", !who && keys.length > 0);
    if (re) re.hidden = !bad;
    if (bad) { s.textContent = bad + (bad === 1 ? " box NOT saved" : " boxes NOT saved") + (lastError ? ": " + lastError : "."); s.className = "tgstatus bad"; }
    else if (wait && !who) { s.textContent = "Type your name at the top to save."; s.className = "tgstatus bad"; }
    else if (wait) { s.textContent = "Saving..."; s.className = "tgstatus"; }
    else if (s.getAttribute("data-msg")) { s.textContent = s.getAttribute("data-msg"); s.className = "tgstatus" + (s.getAttribute("data-bad") ? " bad" : ""); }
    s.setAttribute("data-state", bad ? "failed" : wait ? "saving" : "idle");
  }
  function note(text, bad) { var s = $("tgStatus"); if (!s) return; s.setAttribute("data-msg", text || ""); if (bad) s.setAttribute("data-bad", "1"); else s.removeAttribute("data-bad"); showStatus(); }

  function pastSection() {
    var d = mk("details", "tgmore"); d.id = "tgPast";
    var past = people("past");
    d.appendChild(mk("summary", null, "Past 2026 employees (" + past.length + ")"));
    d.appendChild(mk("p", "tghint", "Worked here earlier this year. Add someone back to put them on the grid."));
    past.forEach(function (p) {
      var row = mk("div", "tgpast");
      row.appendChild(mk("span", "tgpname", fv(p, "name")));
      if (fv(p, "flag")) row.appendChild(mk("span", "tgflag", fv(p, "flag")));
      var b = mk("button", "tglink", "Add back"); b.type = "button"; b.setAttribute("data-addback", p.id);
      b.addEventListener("click", function () { send([{ op: "set", key: "P:" + p.id, field: "list", value: "grid" }]); });
      row.appendChild(b);
      d.appendChild(row);
    });
    return d;
  }

  function field(labelText, input) { var l = mk("label", "tgfield"); l.appendChild(mk("span", null, labelText)); l.appendChild(input); return l; }
  function textIn(id, ph) { var i = mk("input", "tgin"); i.type = "text"; i.id = id; i.maxLength = 120; i.placeholder = ph || ""; return i; }
  function button(id, text, fn) { var b = mk("button", "tgbtn small", text); b.type = "button"; b.id = id; b.addEventListener("click", fn); return b; }
  function skillSelect(id, hidden) {
    var sel = mk("select", "tgsel"); sel.id = id;
    groups().forEach(function (g) {
      var sk = skills(g.id, hidden); if (!sk.length) return;
      var og = document.createElement("optgroup"); og.label = fv(g, "title");
      sk.forEach(function (s) { var o = mk("option", null, fv(s, "title")); o.value = s.id; og.appendChild(o); });
      sel.appendChild(og);
    });
    return sel;
  }

  function changeSection() {
    var d = mk("details", "tgmore"); d.id = "tgChange";
    d.appendChild(mk("summary", null, "Add, rename or hide people and skills"));
    var box1 = mk("div", "tgform");
    var np = textIn("tgNewPerson", "Name"); np.maxLength = 60;
    box1.appendChild(field("Add a person", np));
    box1.appendChild(button("tgAddPerson", "Add", function () {
      var v = np.value.trim(); if (!v) { np.focus(); return; }
      send([{ op: "add", type: "person", fields: { name: v } }]); np.value = "";
    }));
    d.appendChild(box1);

    var box2 = mk("div", "tgform");
    var hp = mk("select", "tgsel"); hp.id = "tgHidePersonSel";
    people("grid").forEach(function (p) { var o = mk("option", null, fv(p, "name")); o.value = p.id; hp.appendChild(o); });
    box2.appendChild(field("Hide a person", hp));
    box2.appendChild(button("tgHidePerson", "Hide", function () { if (hp.value) send([{ op: "set", key: "P:" + hp.value, field: "list", value: "hidden" }]); }));
    d.appendChild(box2);

    var box3 = mk("div", "tgform");
    var ns = textIn("tgNewSkill", "Skill");
    var gs = mk("select", "tgsel"); gs.id = "tgNewSkillGroup";
    groups().forEach(function (g) { var o = mk("option", null, fv(g, "title")); o.value = g.id; gs.appendChild(o); });
    box3.appendChild(field("Add a skill", ns));
    box3.appendChild(field("Under", gs));
    box3.appendChild(button("tgAddSkill", "Add", function () {
      var v = ns.value.trim(); if (!v) { ns.focus(); return; }
      send([{ op: "add", type: "skill", fields: { title: v, group: gs.value } }]); ns.value = "";
    }));
    d.appendChild(box3);

    var box4 = mk("div", "tgform");
    var rs = skillSelect("tgRenameSel", false);
    var rn = textIn("tgRenameTo", "New name");
    rs.addEventListener("change", function () { var s = byId(S.skills, rs.value); rn.value = s ? fv(s, "title") : ""; });
    box4.appendChild(field("Rename a skill", rs));
    box4.appendChild(field("To", rn));
    box4.appendChild(button("tgRename", "Save", function () {
      var s = byId(S.skills, rs.value), v = rn.value.trim(); if (!s || !v) return;
      var c = s.f.title;
      send([{ op: "set", key: "S:" + s.id, field: "title", value: v, base: c ? c.rev : 0 }]);
    }));
    d.appendChild(box4);

    var box5 = mk("div", "tgform");
    var hs = skillSelect("tgHideSkillSel", false);
    box5.appendChild(field("Hide a skill", hs));
    box5.appendChild(button("tgHideSkill", "Hide", function () { if (hs.value) send([{ op: "set", key: "S:" + hs.value, field: "archived", value: "1" }]); }));
    d.appendChild(box5);

    var hiddenP = people("hidden"), hiddenS = skills(null, true);
    if (hiddenP.length || hiddenS.length) {
      d.appendChild(mk("h3", "tglisthead", "Hidden"));
      hiddenP.forEach(function (p) {
        var row = mk("div", "tgpast"); row.appendChild(mk("span", "tgpname", fv(p, "name")));
        var b = mk("button", "tglink", "Show again"); b.type = "button";
        b.addEventListener("click", function () { send([{ op: "set", key: "P:" + p.id, field: "list", value: "grid" }]); });
        row.appendChild(b); d.appendChild(row);
      });
      hiddenS.forEach(function (s) {
        var row = mk("div", "tgpast"); row.appendChild(mk("span", "tgpname", fv(s, "title")));
        var b = mk("button", "tglink", "Show again"); b.type = "button";
        b.addEventListener("click", function () { send([{ op: "set", key: "S:" + s.id, field: "archived", value: "" }]); });
        row.appendChild(b); d.appendChild(row);
      });
    }
    return d;
  }

  /* ---------- moving between boxes ---------- */
  function isCtl(el) { return !!(el && el.classList && (el.classList.contains("tgnum") || el.classList.contains("tgbox") || el.classList.contains("tgexp"))); }
  /* the boxes one keys through, in order: the same person's column on the grid, the whole list on a narrow screen */
  function lane(el) {
    var g = el.closest("#tgGrid");
    if (g) return Array.prototype.slice.call(g.querySelectorAll('.tgnum[data-p="' + el.getAttribute("data-p") + '"], .tgbox[data-p="' + el.getAttribute("data-p") + '"]'));
    var n = el.closest("#tgNarrow");
    return n ? Array.prototype.slice.call(n.querySelectorAll(".tgnum, .tgbox")) : [];
  }
  function mainOf(el) { return el.classList.contains("tgexp") ? el.parentNode.querySelector(".tgbox") : el; }
  function reveal(el) {
    var w = el.closest("#tgGridWrap"), r = el.getBoundingClientRect();
    if (w) {
      var wr = w.getBoundingClientRect(), th = w.querySelector("thead"), sc = w.querySelector("th.tgskill");
      var top = wr.top + (th ? th.offsetHeight : 0), left = wr.left + (sc ? sc.offsetWidth : 0);
      if (r.top < top) w.scrollTop -= top - r.top + 4; else if (r.bottom > wr.top + w.clientHeight) w.scrollTop += r.bottom - (wr.top + w.clientHeight) + 4;
      if (r.left < left) w.scrollLeft -= left - r.left + 4; else if (r.right > wr.left + w.clientWidth) w.scrollLeft += r.right - (wr.left + w.clientWidth) + 4;
      r = el.getBoundingClientRect();
    }
    var nav = document.querySelector(".tgnav");
    var t2 = (nav ? nav.getBoundingClientRect().bottom : 0) + 8;
    var vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - 8;
    if (r.top < t2) window.scrollBy(0, r.top - t2); else if (r.bottom > vh) window.scrollBy(0, r.bottom - vh);
  }
  function go(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.select && el.type === "text") { try { el.select(); } catch (e2) { } }
    reveal(el);
  }
  function move(el, dir) {
    var l = lane(el), i = l.indexOf(mainOf(el)), to = l[i + dir];
    if (i < 0 || !to) return false;
    go(to);
    return true;
  }
  function side(el, dir) {
    var g = el.closest("#tgGrid"); if (!g) return false;
    var row = Array.prototype.slice.call(el.closest("tr").querySelectorAll(".tgnum, .tgbox"));
    var to = row[row.indexOf(mainOf(el)) + dir];
    if (!to) return false;
    go(to);
    return true;
  }

  /* ---------- events ---------- */
  function onPoint(e) {
    var c = e.target.closest && e.target.closest(".tgnum, .tgbox, .tgexp, td.tgcell");
    if (!c) return;
    if (c.tagName === "TD") c = c.querySelector(".tgnum, .tgbox");
    if (!c) return;
    var info = $("tgInfo"); if (info) info.textContent = lastLine(c.getAttribute("data-s"), c.getAttribute("data-p"));
  }
  function onFocus(e) {
    onPoint(e);
    var el = e.target;
    if (el.classList && el.classList.contains("tgnum")) setTimeout(function () { if (document.activeElement === el) { try { el.select(); } catch (x) { } } }, 0);
  }
  function wrong(el, text) {
    note(text, true);
    el.classList.add("is-no");
    setTimeout(function () { el.classList.remove("is-no"); }, 600);
  }
  function setNum(el, v) {
    change(el.getAttribute("data-s"), el.getAttribute("data-p"), "r", v);
  }
  function setExp(el) {
    var sid = el.getAttribute("data-s"), pid = el.getAttribute("data-p"), d = parseDate(el.value);
    if (d === null) {
      el.setAttribute("data-bad", "1"); el.classList.add("is-err");
      note("That is not a date. Type it as month/day/year, for example 3/15/27.", true);
      return false;
    }
    if (el.getAttribute("data-bad") === "1") note("");
    el.removeAttribute("data-bad"); el.classList.remove("is-err");
    el.value = showDate(d);
    change(sid, pid, "x", d);
    return true;
  }
  function onKey(e) {
    var el = e.target, k = e.key;
    if (!isCtl(el) || e.ctrlKey || e.metaKey || e.altKey) return;
    var num = el.classList.contains("tgnum"), box = el.classList.contains("tgbox"), exp = el.classList.contains("tgexp");
    if (num && /^[0-3]$/.test(k)) { e.preventDefault(); setNum(el, Number(k)); if (!move(el, 1)) { try { el.select(); } catch (x) { } } return; }
    if (num && (k === "Backspace" || k === "Delete")) { e.preventDefault(); setNum(el, null); return; }
    if (box && (k === "y" || k === "Y" || k === "n" || k === "N")) {
      e.preventDefault();
      var on = k === "y" || k === "Y";
      el.checked = on; tick(el);
      if (on) go(el.parentNode.querySelector(".tgexp")); else move(el, 1);
      return;
    }
    if (k === "Enter" || k === "ArrowDown" || (k === "Tab" && !e.shiftKey)) {
      if (exp && !setExp(el)) { e.preventDefault(); return; }
      if (box && el.checked && k !== "ArrowDown") { e.preventDefault(); go(el.parentNode.querySelector(".tgexp")); return; }
      if (move(el, 1) || k !== "Tab") e.preventDefault();
      return;
    }
    if (k === "ArrowUp" || (k === "Tab" && e.shiftKey)) {
      if (exp && !setExp(el)) { e.preventDefault(); return; }
      if (exp) { e.preventDefault(); go(mainOf(el)); return; }
      if (move(el, -1) || k !== "Tab") e.preventDefault();
      return;
    }
    if (!exp && (k === "ArrowLeft" || k === "ArrowRight")) { if (side(el, k === "ArrowLeft" ? -1 : 1)) e.preventDefault(); return; }
    if (num && k.length === 1) { e.preventDefault(); wrong(el, "Type 0, 1, 2 or 3. Backspace makes the box blank."); }
  }
  /* phones and paste: the keyboard gives no key name, so read what landed in the box */
  function onInput(e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains("tgnum")) return;
    var t = el.value.replace(/\s/g, "");
    if (t === "") { setNum(el, null); return; }
    var ch = t.length === 1 ? t : (el.selectionStart === 1 ? t.charAt(0) : t.charAt(t.length - 1));
    if (/^[0-3]$/.test(ch)) { el.value = ch; setNum(el, Number(ch)); if (!move(el, 1)) { try { el.select(); } catch (x) { } } }
    else { paint(el); try { el.select(); } catch (x2) { } wrong(el, "Type 0, 1, 2 or 3."); }
  }
  function tick(el) {
    var sid = el.getAttribute("data-s"), pid = el.getAttribute("data-p");
    change(sid, pid, "v", el.checked ? "1" : "");
    if (!el.checked && shown(sid, pid, "x")) change(sid, pid, "x", "");
  }
  function onChange(e) {
    var el = e.target;
    if (!el.classList) return;
    if (el.classList.contains("tgbox")) tick(el);
    else if (el.classList.contains("tgexp")) setExp(el);
  }

  /* ---------- saving one box ---------- */
  function change(sid, pid, field, value) {
    var key = "T:" + sid + ":" + pid, lk = key + "|" + field, h = local[lk];
    if (h ? (h.value === value && h.st !== "failed") : saved(sid, pid, field) === value) { repaint(sid, pid); return; }
    local[lk] = { key: key, field: field, value: value, st: "queued" };
    delete okAt[lk];
    repaint(sid, pid);
    counts();
    pump();
  }
  function repaint(sid, pid) { each('[data-s="' + sid + '"][data-p="' + pid + '"]', paint, $("tgMain")); }
  function retry() {
    Object.keys(local).forEach(function (k) { if (local[k].st === "failed") local[k].st = "queued"; });
    lastError = "";
    sync();
    pump();
  }
  function pump() {
    showStatus();
    if (sending || busy) return;
    var keys = Object.keys(local).filter(function (k) { return local[k].st === "queued"; }).slice(0, 100);
    if (!keys.length) return;
    if (!who) { var wi = $("tgWho"); if (wi) wi.focus(); return; }
    var sent = keys.map(function (k) { local[k].st = "sending"; return local[k]; });
    var ops = sent.map(function (h) { return { op: "set", key: h.key, field: h.field, value: h.value }; });
    sending = true;
    showStatus();
    var done = function (ok, why) {
      var now = Date.now();
      sent.forEach(function (h, i) {
        var lk = keys[i], p = h.key.split(":");
        if (local[lk] !== h) return;                       /* typed over while this was on its way: the newer one is queued */
        if (ok && saved(p[1], p[2], h.field) === h.value) { delete local[lk]; okAt[lk] = now; }
        else { h.st = "failed"; lastError = why || "the server holds something else. Type it again."; }
      });
      sending = false;
      if (ok && !Object.keys(local).some(function (k) { return local[k].st === "failed"; })) { lastError = ""; note("Saved " + clock()); }
      sync();
      showStatus();
      setTimeout(function () { sync(); }, 2600);          /* drop the short "saved" mark */
      pump();
    };
    R.api("/team/grid/save" + Q, { method: "POST", json: { saved_by: who, ops: ops } }).then(answer).then(function (x) {
      if (x.j && x.j.state) S = x.j.state;
      if (x.s === 200 && x.j && x.j.ok && x.j.state) done(true);
      else done(false, (x.j && x.j.error) || ("the server answered " + x.s + ". Press Try again."));
    }).catch(function (e) {
      if (e && e.message === "signed out") { sending = false; return; }
      done(false, "no connection. Press Try again when the signal is back.");
    });
  }

  /* ---------- saving a change to the lists (people, skills): the whole page is drawn again ---------- */
  function send(ops) {
    if (!who) {
      var wl = $("tgWhoWrap"); if (wl) wl.classList.add("need");
      note("Type your name at the top first, then press the button again.", true);
      var wi = $("tgWho"); if (wi) wi.focus();
      return;
    }
    if (busy || sending) { note("Still saving. Try again in a moment.", true); return; }
    busy = true;
    note("Saving...");
    R.api("/team/grid/save" + Q, { method: "POST", json: { saved_by: who, ops: ops } }).then(answer).then(function (x) {
      if (x.j && x.j.state) S = x.j.state;
      if (x.s === 200) note("Saved " + clock());
      else note((x.j && x.j.error) || "Not saved. Try again.", true);
      busy = false;
      if (!x.j || !x.j.state) return poll(true);
      draw();
    }).catch(function (e) { busy = false; if (e && e.message !== "signed out") note("Not saved: no connection. Try again when the signal is back.", true); })
      .then(function () { pump(); });
  }

  /* the parts of the state that decide which boxes exist */
  function shape(st) {
    return JSON.stringify([st.people.map(function (p) { return [p.id, fv(p, "name"), fv(p, "list")]; }),
      st.groups.map(function (g) { return [g.id, fv(g, "title")]; }),
      st.skills.map(function (s) { return [s.id, fv(s, "title"), fv(s, "group"), fv(s, "archived"), fv(s, "kind")]; })]);
  }
  function poll(force) {
    if (!S || ((busy || sending) && !force)) return Promise.resolve();
    return R.apiJSON("/team/grid" + Q).then(function (d) {
      if (!d || !d.ok || !d.state || d.state.last_event_id === S.last_event_id || sending || busy) return;
      var a = document.activeElement, typing = a && (a.tagName === "INPUT" || a.tagName === "SELECT") && a.id !== "tgWho";
      if (shape(d.state) === shape(S)) { S = d.state; sync(); }
      else if (force || !typing) { S = d.state; draw(); }
    }).catch(function () { });
  }

  /* ---------- print: the grid on landscape pages ---------- */
  function buildPrint() {
    if (!S) return;
    var pv = $("tgPrint"); pv.innerHTML = "";
    pv.appendChild(mk("h1", null, "Team skills"));
    pv.appendChild(mk("p", "tgpkey", SCALE.map(function (x) { return x[0] + " = " + x[1]; }).join("     ") + "     Blank = not entered yet"));
    pv.appendChild(mk("p", null, "Printed " + new Date().toLocaleDateString()));
    var ppl = people("grid");
    var tbl = mk("table", "tgptable"), thead = mk("thead"), hr = mk("tr");
    hr.appendChild(mk("th", "tgpcorner", "Skill"));
    ppl.forEach(function (p) { var th = mk("th", "tgpname2"); th.appendChild(mk("span", null, shortName(p))); hr.appendChild(th); });
    var sh = mk("th", "tgpname2"); sh.appendChild(mk("span", null, "At 2 or 3")); hr.appendChild(sh);
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = mk("tbody");
    groups().forEach(function (g) {
      var sk = skills(g.id, false); if (!sk.length) return;
      var gr = mk("tr", "tgpgroup"); var gth = mk("th", null, fv(g, "title")); gth.colSpan = ppl.length + 2; gr.appendChild(gth); tb.appendChild(gr);
      sk.forEach(function (s) {
        var tr = mk("tr"); tr.appendChild(mk("th", "tgpskill", fv(s, "title") + (isYN(s) ? " (Yes / No)" : "")));
        var k = 0, any = false;
        ppl.forEach(function (p) {
          var td;
          if (isYN(s)) {
            var on = isOn(s.id, p.id), x = shown(s.id, p.id, "x");
            td = mk("td", "tgpcell yn", on ? "Yes" : "");
            if (on && x) td.appendChild(mk("span", "tgpdate", showDate(x)));
            if (on) { k++; any = true; }
          } else {
            var v = rate(s.id, p.id);
            td = mk("td", "tgpcell" + (v === null ? "" : " plv" + v), v === null ? "" : String(v));
            if (v !== null) any = true;
            if (v >= 2) k++;
          }
          tr.appendChild(td);
        });
        tr.appendChild(mk("td", "tgpcell tgpsum", any ? String(k) : ""));
        tb.appendChild(tr);
      });
    });
    tbl.appendChild(tb);
    pv.appendChild(tbl);
  }
})();
