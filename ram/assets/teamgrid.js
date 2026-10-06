/* Team skills, the simple grid: skills down the side, people across the top, one box per pair meaning
   "can do this today". Generic: no person, skill or client name is in this file; the people and the skills arrive
   from the API after sign-in.

   A tick is saved at once ({op:"set", key:"T:<skill>:<person>", field:"v", value:"1" or ""}), append-only on the
   server with the name typed once at the top (kept in this browser's storage, inside try/catch) and the time. A tick
   made before a name is typed is held and saved as soon as the name is in. Hovering or tapping a box shows who
   changed it last and when. The page follows the server every 30 seconds and when the tab comes back.

   Wide screens: one grid, sticky skill column and sticky name row, scrolling sideways inside its own box only.
   Narrow screens (under 700px): "One person" (pick a person, tick their skills as a list) and "One skill"
   (pick a skill, see and tick who can do it). Print: the grid on landscape pages. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var WHO_KEY = R.NS.slice(1) + "_team_who";
  var VIEW_KEY = R.NS.slice(1) + "_team_view";
  var S = null, who = "", held = [], busy = false, chain = Promise.resolve();
  var view = { mode: "person", person: "", skill: "" };

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function readKey(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function writeKey(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function fail(text) { document.body.insertBefore(mk("p", "tgfail", text), document.body.firstChild); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function status(text, bad) { var s = $("tgStatus"); if (s) { s.textContent = text || ""; s.classList.toggle("bad", !!bad); } }

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
  function tick(sid, pid) { return S.ticks[sid + ":" + pid] || null; }
  function isOn(sid, pid) { var t = tick(sid, pid); return !!(t && t.v === "1"); }
  function byId(bag, id) { for (var i = 0; i < bag.length; i++) if (bag[i].id === id) return bag[i]; return null; }
  function lastLine(sid, pid) {
    var t = tick(sid, pid), s = byId(S.skills, sid), p = byId(S.people, pid);
    var head = (s ? fv(s, "title") : "") + ", " + (p ? fv(p, "name") : "") + ": ";
    if (!t) return head + "not ticked yet.";
    return head + (t.v === "1" ? "ticked" : "unticked") + " by " + t.by + ", " + R.fmtTs(t.ts) + ".";
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
    css.href = me ? me.src.replace(/\/teamgrid\.js[^\/]*$/, "/teamgrid.css?v=1") : "../assets/teamgrid.css?v=1";
    var go = function () {
      go = function () { };
      document.title = "Team skills";
      frame();
      draw();
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeprint", buildPrint);
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
      if (who && held.length) { var ops = held; held = []; send(ops); }
    });
    wl.appendChild(wi);
    nav.appendChild(wl);
    var st = mk("span", "tgstatus"); st.id = "tgStatus"; st.setAttribute("role", "status"); nav.appendChild(st);
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
    main.addEventListener("mouseover", onPoint);
    main.addEventListener("focusin", onPoint);
  }

  /* ---------- drawing ---------- */
  function draw() {
    var main = $("tgMain"), y = window.scrollY;
    var openSet = {}, gw = $("tgGridWrap"), gx = gw ? gw.scrollLeft : 0, gy = gw ? gw.scrollTop : 0;
    Array.prototype.forEach.call(main.querySelectorAll("details[id]"), function (d) { openSet[d.id] = d.open; });
    main.innerHTML = "";
    main.appendChild(mk("h1", null, "Team skills"));
    main.appendChild(mk("p", "tgintro", "Tick every box the person can do today."));
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
    var wl = $("tgWhoWrap"); if (wl) wl.classList.toggle("need", !who && held.length > 0);
  }

  function box(sid, pid, label) {
    var c = mk("input"); c.type = "checkbox"; c.className = "tgbox";
    c.setAttribute("data-s", sid); c.setAttribute("data-p", pid);
    c.checked = isOn(sid, pid);
    c.title = lastLine(sid, pid);
    if (label) c.setAttribute("aria-label", label);
    return c;
  }

  function gridView() {
    var wrap = mk("div", "tgwide"); wrap.id = "tgGridWrap";
    var ppl = people("grid");
    var tbl = mk("table", "tggrid"); tbl.id = "tgGrid";
    var thead = mk("thead"), hr = mk("tr");
    var corner = mk("th", "tgcorner", "Skill"); corner.scope = "col"; hr.appendChild(corner);
    ppl.forEach(function (p) { var th = mk("th", "tgname", fv(p, "name")); th.scope = "col"; th.setAttribute("data-p", p.id); hr.appendChild(th); });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = mk("tbody");
    groups().forEach(function (g) {
      var sk = skills(g.id, false);
      if (!sk.length) return;
      var gr = mk("tr", "tggrow");
      var gth = mk("th", "tggroup", fv(g, "title")); gth.scope = "rowgroup"; gr.appendChild(gth);
      if (ppl.length) { var fill = mk("td", "tggfill"); fill.colSpan = ppl.length; gr.appendChild(fill); }
      tb.appendChild(gr);
      sk.forEach(function (s) {
        var tr = mk("tr");
        var th = mk("th", "tgskill", fv(s, "title")); th.scope = "row"; tr.appendChild(th);
        ppl.forEach(function (p) {
          var td = mk("td", "tgcell");
          td.appendChild(box(s.id, p.id, fv(s, "title") + ", " + fv(p, "name")));
          tr.appendChild(td);
        });
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
      ppl.forEach(function (p) { var o = mk("option", null, fv(p, "name")); o.value = p.id; sel.appendChild(o); });
      sel.value = view.person;
      sel.addEventListener("change", function () { view.person = sel.value; saveView(); draw(); });
      wrap.appendChild(sel);
      if (view.person) {
        var n = S.skills.filter(function (s) { return !fv(s, "archived") && isOn(s.id, view.person); }).length;
        wrap.appendChild(mk("p", "tgcount", n + " ticked"));
        groups().forEach(function (g) {
          var sk = skills(g.id, false); if (!sk.length) return;
          wrap.appendChild(mk("h3", "tglisthead", fv(g, "title")));
          var ul = mk("div", "tglist");
          sk.forEach(function (s) {
            var row = mk("label", "tgrow");
            row.appendChild(box(s.id, view.person));
            row.appendChild(mk("span", null, fv(s, "title")));
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
        var k = ppl.filter(function (p) { return isOn(view.skill, p.id); }).length;
        wrap.appendChild(mk("p", "tgcount", "Who can do this: " + k + " of " + ppl.length));
        var list = mk("div", "tglist");
        ppl.forEach(function (p) {
          var row = mk("label", "tgrow");
          row.appendChild(box(view.skill, p.id));
          row.appendChild(mk("span", null, fv(p, "name")));
          list.appendChild(row);
        });
        wrap.appendChild(list);
      }
    }
    return wrap;
  }
  function saveView() { writeKey(VIEW_KEY, JSON.stringify(view)); }

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

  /* ---------- events ---------- */
  function onPoint(e) {
    var c = e.target.closest && e.target.closest(".tgbox, td.tgcell");
    if (!c) return;
    if (c.tagName === "TD") c = c.querySelector(".tgbox");
    if (!c) return;
    var info = $("tgInfo"); if (info) info.textContent = lastLine(c.getAttribute("data-s"), c.getAttribute("data-p"));
  }
  function onChange(e) {
    var c = e.target;
    if (!c.classList || !c.classList.contains("tgbox")) return;
    var sid = c.getAttribute("data-s"), pid = c.getAttribute("data-p"), v = c.checked ? "1" : "";
    /* show it at once everywhere this pair appears */
    S.ticks[sid + ":" + pid] = { v: v, by: who || "(not saved yet)", ts: new Date().toISOString(), rev: -1 };
    Array.prototype.forEach.call(document.querySelectorAll('.tgbox[data-s="' + sid + '"][data-p="' + pid + '"]'), function (x) { x.checked = !!v; });
    send([{ op: "set", key: "T:" + sid + ":" + pid, field: "v", value: v }]);
  }

  /* ---------- saving ---------- */
  function send(ops) {
    if (!who) {
      held = held.concat(ops);
      var wl = $("tgWhoWrap"); if (wl) wl.classList.add("need");
      status("Type your name at the top to save.", true);
      var wi = $("tgWho"); if (wi) wi.focus();
      return;
    }
    busy = true;
    status("Saving...");
    chain = chain.then(function () {
      return R.api("/team/grid/save" + Q, { method: "POST", json: { saved_by: who, ops: ops } }).then(answer).then(function (x) {
        if (x.j && x.j.state) S = x.j.state;
        if (x.s === 200) {
          status("Saved " + clock());
          var info = $("tgInfo"), op = ops[0];
          draw();
          if (info && op && op.key && op.key.indexOf("T:") === 0) { var p = op.key.split(":"); $("tgInfo").textContent = lastLine(p[1], p[2]); }
        } else {
          status((x.j && x.j.error) || "Not saved. Try again.", true);
          if (!x.j || !x.j.state) return poll(true);
          draw();
        }
      }).catch(function (e) { if (e && e.message !== "signed out") status("Not saved: no connection. Tick it again when the signal is back.", true); });
    }).then(function () { busy = false; });
  }

  function poll(force) {
    if (!S || (busy && !force) || held.length) return Promise.resolve();
    var a = document.activeElement;
    if (!force && a && (a.tagName === "INPUT" && a.type === "text" || a.tagName === "SELECT")) return Promise.resolve();
    return R.apiJSON("/team/grid" + Q).then(function (d) {
      if (d && d.ok && d.state && d.state.last_event_id !== S.last_event_id) { S = d.state; draw(); }
    }).catch(function () { });
  }

  /* ---------- print: the grid on landscape pages ---------- */
  function buildPrint() {
    if (!S) return;
    var pv = $("tgPrint"); pv.innerHTML = "";
    pv.appendChild(mk("h1", null, "Team skills"));
    pv.appendChild(mk("p", null, "Tick every box the person can do today. Printed " + new Date().toLocaleDateString()));
    var ppl = people("grid");
    var tbl = mk("table", "tgptable"), thead = mk("thead"), hr = mk("tr");
    hr.appendChild(mk("th", "tgpcorner", "Skill"));
    ppl.forEach(function (p) { var th = mk("th", "tgpname2"); th.appendChild(mk("span", null, fv(p, "name"))); hr.appendChild(th); });
    thead.appendChild(hr); tbl.appendChild(thead);
    var tb = mk("tbody");
    groups().forEach(function (g) {
      var sk = skills(g.id, false); if (!sk.length) return;
      var gr = mk("tr", "tgpgroup"); var gth = mk("th", null, fv(g, "title")); gth.colSpan = ppl.length + 1; gr.appendChild(gth); tb.appendChild(gr);
      sk.forEach(function (s) {
        var tr = mk("tr"); tr.appendChild(mk("th", "tgpskill", fv(s, "title")));
        ppl.forEach(function (p) { tr.appendChild(mk("td", "tgpcell", isOn(s.id, p.id) ? "✓" : "")); });
        tb.appendChild(tr);
      });
    });
    tbl.appendChild(tb);
    pv.appendChild(tbl);
  }
})();
