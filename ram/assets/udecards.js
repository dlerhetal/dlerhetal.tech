/* Problem-card page shell (the wall form). Generic: nothing in this file names a client or a person, and it holds no
   wording from the cards. The cards, the field names, the labels and every word arrive from the API after sign-in.

   Who can edit: a browser in consultant mode (the same once-per-browser flag the other pages use), or a signed-in
   viewer who presses "Edit these cards" and picks a name from the API's editor list (remembered in this browser; the
   page reopens with ?edit=<name>). Every save carries that name and is one more row on the server; nothing is
   overwritten. Each save says which version of the card its screen started from (base_rev); if someone else saved
   the card in the meantime the server refuses it with 409 and the page reloads the latest cards with a plain message.
   Everyone else reads, and can print: all cards, one per page, or a single card. */
(function () {
  "use strict";
  var R = window.RAM;
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var DALE = !!R.DALE_MODE;
  var EDIT = DALE || TEST;               /* a client editor is decided in start(), from ?edit= and the API's list */
  var Q = TEST ? "?as=TEST" : "";
  var who = "";
  var EDITOR_KEY = "udecards_editor" + (R.NS || "");
  var OTHER_KEY = "lanes_editor" + (R.NS || "");   /* the name picked on the process map, offered first if it is on the list */
  var NEWER = "Someone else saved a newer version of this card. The latest cards are loaded; please redo your last change.";
  var C = null, L = {}, FIELDS = [], names = [];
  var cards = {}, order = [], seq = 0, leaving = false, polling = false;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function fail(text) { document.body.insertBefore(mk("p", "cfail", text), document.body.firstChild); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function recall() { try { return localStorage.getItem(EDITOR_KEY) || localStorage.getItem(OTHER_KEY) || ""; } catch (e) { return ""; } }
  function remember(name) { try { if (name) localStorage.setItem(EDITOR_KEY, name); else localStorage.removeItem(EDITOR_KEY); } catch (e) { } }
  function param(name) { try { return new URL(location.href).searchParams.get(name) || ""; } catch (e) { return ""; } }
  function urlWith(set) {
    var u = new URL(location.href);
    Object.keys(set).forEach(function (k) { if (set[k]) u.searchParams.set(k, set[k]); else u.searchParams.delete(k); });
    return u.toString();
  }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function anyDirty() { return order.some(function (id) { var c = cards[id]; return c && (c.isNew || Object.keys(c.dirty).length); }); }

  R.gate(function () {
    R.apiJSON("/ude/cards/board" + Q).then(function (d) {
      if (!d || !d.ok || !d.content || !d.state) throw new Error((d && d.error) || "The cards could not be loaded.");
      start(d);
    }).catch(function (e) { if (e && e.message !== "signed out") fail(e.message || "The cards could not be loaded."); });
  });

  function start(d) {
    C = d.content; L = C.labels || {}; FIELDS = C.fields || []; names = d.client_editors || [];
    var asked = param("edit");
    if (!DALE && !TEST && asked) {
      if (names.indexOf(asked) >= 0) { EDIT = true; remember(asked); }
      else { try { history.replaceState(null, "", urlWith({ edit: "" })); } catch (e) { } }
    }
    who = TEST ? "TEST" : (DALE ? ((d.editors || [])[0] || "") : (EDIT ? asked : ""));
    var notice = param("notice") === "newer";
    var addAsk = param("add");
    if (notice || addAsk) { try { history.replaceState(null, "", urlWith({ notice: "", add: "" })); } catch (e) { } }
    ["gate", "app", "gateCss"].forEach(function (id) { var n = $(id); if (n) n.parentNode.removeChild(n); });
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "../../assets/udecards.css?v=2";
    var go = function () {
      go = function () { };
      document.title = C.title || document.title;
      document.body.classList.add(EDIT ? "ed" : "ro");
      draw(d);
      if (notice) showNotice(NEWER);
      if (EDIT && addAsk !== "") {
        var n = (C.needs_a_story || [])[parseInt(addAsk, 10)];
        if (n) addBlank(n.from_list);
      }
      setInterval(poll, 30000);
      window.addEventListener("focus", poll);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
      window.addEventListener("beforeunload", function (e) { if (!leaving && EDIT && anyDirty()) { e.preventDefault(); e.returnValue = ""; } });
      window.addEventListener("afterprint", endPrintOne);
      document.body.setAttribute("data-cards-ready", EDIT ? "edit" : "view");
    };
    css.onload = function () { go(); };
    css.onerror = function () { go(); };
    document.head.appendChild(css);
  }

  /* ---------- the page ---------- */
  function draw(d) {
    var nav = mk("div", "cnav noprint");
    nav.appendChild(mk("span", "cmode", !EDIT ? "Read only" : (TEST ? "Editing as TEST" : "Editing as " + who)));
    if (!DALE && !TEST && names.length) {
      if (EDIT) {
        var change = mk("button", "cbtn", "Change name"); change.type = "button"; change.id = "ucChangeName";
        change.addEventListener("click", function () { showPicker(""); });
        nav.appendChild(change);
        var done = mk("button", "cbtn", "Done editing"); done.type = "button"; done.id = "ucDoneEditing";
        done.addEventListener("click", function () { location.assign(urlWith({ edit: "" })); });
        nav.appendChild(done);
      } else {
        var eb = mk("button", "cbtn cpri", "Edit these cards"); eb.type = "button"; eb.id = "ucEditBtn";
        eb.addEventListener("click", function () { startEditing(""); });
        nav.appendChild(eb);
      }
    }
    var pr = mk("button", "cbtn", "Print all"); pr.type = "button"; pr.id = "ucPrintAll";
    pr.addEventListener("click", function () { endPrintOne(); window.print(); });
    nav.appendChild(pr);
    var home = mk("a", null, "Home"); home.href = "../../"; nav.appendChild(home);
    var out = mk("a", null, "Sign out"); out.href = "#"; out.setAttribute("data-action", "signout"); nav.appendChild(out);
    document.body.insertBefore(nav, document.body.firstChild);

    var main = mk("main", "cmain");
    var intro = mk("section", "cintro noprint");
    intro.appendChild(mk("h1", null, C.title || ""));
    if (C.rule) intro.appendChild(mk("p", "crule", C.rule));
    (C.help || []).forEach(function (t) { intro.appendChild(mk("p", "chelp", t)); });
    var tally = mk("p", "ctally"); tally.id = "ucTally"; tally.setAttribute("role", "status"); intro.appendChild(tally);
    main.appendChild(intro);
    var list = mk("section", "clist"); list.id = "ucCards"; main.appendChild(list);
    var needs = mk("section", "cneeds noprint"); needs.id = "ucNeeds";
    needs.appendChild(mk("h2", null, C.needs_heading || ""));
    if (C.needs_help) needs.appendChild(mk("p", "chelp", C.needs_help));
    (C.needs_a_story || []).forEach(function (n, i) {
      var box = mk("div", "cneed"); box.setAttribute("data-need", String(i));
      box.appendChild(mk("span", "ctag", n.from_list));
      box.appendChild(mk("p", "cprompt", n.prompt));
      var b = mk("button", "cbtn cpri", "Add a card"); b.type = "button"; b.setAttribute("data-add", String(i));
      if (!EDIT && !names.length) b.disabled = true;
      b.addEventListener("click", function () { if (EDIT) addBlank(n.from_list); else startEditing(String(i)); });
      box.appendChild(b);
      needs.appendChild(box);
    });
    main.appendChild(needs);
    document.body.insertBefore(main, document.body.querySelector("script"));
    (d.state.cards || []).forEach(function (c) { put(c); });
    tallyLine();
  }

  function tallyLine() {
    var n = 0, s = 0;
    order.forEach(function (id) { var c = cards[id]; if (!c || c.isNew) return; n += 1; if (c.data.status === "set") s += 1; });
    var t = $("ucTally"); if (t) { t.textContent = n + (n === 1 ? " card: " : " cards: ") + s + " set, " + (n - s) + " to fill in."; t.setAttribute("data-count", String(n)); }
  }

  /* ---------- one card ---------- */
  function put(data, isNew) {
    var id = data.id;
    var rec = cards[id];
    if (!rec) { rec = cards[id] = { dirty: {}, isNew: !!isNew }; order.push(id); }
    rec.data = data; rec.base = data.rev || 0;
    var el = cardEl(rec);
    if (rec.el && rec.el.parentNode) rec.el.parentNode.replaceChild(el, rec.el); else $("ucCards").appendChild(el);
    rec.el = el;
    return rec;
  }

  /* a value on screen and on paper: each run of underscores becomes a short line, an empty value a full line */
  function fill(box, text, long) {
    box.textContent = "";
    text = String(text || "");
    box.classList.toggle("cempty", !text.trim());
    if (!text.trim()) { for (var i = 0; i < (long ? 3 : 1); i++) box.appendChild(mk("span", "cline")); return; }
    text.split(/_{3,}/).forEach(function (part, i) {
      if (i) box.appendChild(mk("span", "cblank"));
      if (part) box.appendChild(document.createTextNode(part));
    });
  }

  function cardEl(rec) {
    var c = rec.data, id = c.id;
    var art = mk("article", "ccard"); art.setAttribute("data-id", id); art.setAttribute("data-status", c.status);
    if (rec.isNew) art.classList.add("cnew");
    var head = mk("header", "chead");
    var badges = mk("div", "cbadges");
    badges.appendChild(mk("span", "cbadge " + (c.status === "set" ? "cset" : "cstarter"), c.status === "set" ? L.set : L.starter));
    if (c.number) badges.appendChild(mk("span", "cnum", (L.number_prefix || "") + c.number));
    if (c.added || rec.isNew) badges.appendChild(mk("span", "cadded", L.added));
    if (c.from_list) badges.appendChild(mk("span", "ctag", (L.from_list ? L.from_list + ": " : "") + c.from_list));
    head.appendChild(badges);
    var title = mk("h2", "ctitle cv"); fill(title, val(rec, "title"), false); head.appendChild(title);
    var where = mk("p", "cwhere cv");
    var wl = mk("span", "cwl", (L.where || "") + ": "), wv = mk("span", "cwv"); fill(wv, val(rec, "where"), false);
    where.appendChild(wl); where.appendChild(wv); head.appendChild(where);
    if (EDIT) {
      head.appendChild(input(rec, "title", L.title || "", false, title));
      head.appendChild(input(rec, "where", L.where || "", false, wv));
    }
    art.appendChild(head);
    var grid = mk("div", "cgrid");
    FIELDS.forEach(function (f) {
      var box = mk("div", "cf" + (f.long ? " clong" : "")); box.setAttribute("data-f", f.key);
      box.appendChild(mk("div", "cl", f.label));
      var v = mk("div", "cv cval"); fill(v, val(rec, f.key), f.long); box.appendChild(v);
      if (EDIT) box.appendChild(input(rec, f.key, f.label, true, v, f.long));
      grid.appendChild(box);
    });
    art.appendChild(grid);
    var foot = mk("div", "cfoot noprint");
    var st = mk("span", "cstat"); st.setAttribute("role", "status"); foot.appendChild(st);
    if (EDIT) {
      var save = mk("button", "cbtn cpri", "Save card"); save.type = "button"; save.setAttribute("data-do", "save");
      save.addEventListener("click", function () { saveCard(id, null); });
      foot.appendChild(save);
      if (c.status !== "set") {
        var ms = mk("button", "cbtn cgo", "Mark as set"); ms.type = "button"; ms.setAttribute("data-do", "set");
        ms.addEventListener("click", function () { saveCard(id, "set"); });
        foot.appendChild(ms);
      } else if (!rec.isNew) {
        var back = mk("button", "cbtn", "Back to a draft"); back.type = "button"; back.setAttribute("data-do", "starter");
        back.addEventListener("click", function () { saveCard(id, "starter"); });
        foot.appendChild(back);
      }
      if (rec.isNew) {
        var drop = mk("button", "cbtn", "Discard"); drop.type = "button"; drop.setAttribute("data-do", "discard");
        drop.addEventListener("click", function () { discard(id); });
        foot.appendChild(drop);
      }
    }
    var p1 = mk("button", "cbtn", "Print this card"); p1.type = "button"; p1.setAttribute("data-do", "print");
    p1.addEventListener("click", function () { printOne(art); });
    foot.appendChild(p1);
    art.appendChild(foot);
    var meta = mk("p", "cmeta noprint");
    if (c.last_by) meta.textContent = "Last changed " + R.fmtTs(c.last_ts) + " by " + c.last_by + ".";
    art.appendChild(meta);
    refreshFoot(rec, art);
    return art;
  }

  function val(rec, key) { return rec.dirty.hasOwnProperty(key) ? rec.dirty[key] : (rec.data[key] || ""); }

  function input(rec, key, label, area, mirror, long) {
    var t = mk(area ? "textarea" : "input", "ci");
    if (!area) t.type = "text";
    t.value = val(rec, key);
    t.setAttribute("aria-label", label);
    t.setAttribute("data-k", key);
    if (area) t.rows = long ? 4 : 1;
    t.addEventListener("input", function () {
      var id = rec.data.id;
      if (t.value === (rec.data[key] || "")) delete rec.dirty[key]; else rec.dirty[key] = t.value;
      fill(mirror, t.value, !!long);
      if (area) grow(t);
      refreshFoot(cards[id], rec.el);
    });
    if (area) setTimeout(function () { grow(t); }, 0);
    return t;
  }
  function grow(t) { if (!t.offsetWidth) return; t.style.height = "auto"; t.style.height = (t.scrollHeight + 4) + "px"; }

  function refreshFoot(rec, art) {
    if (!rec || !art) return;
    var n = Object.keys(rec.dirty).length;
    art.classList.toggle("cdirty", n > 0 || rec.isNew);
    var save = art.querySelector('[data-do="save"]');
    if (save) save.disabled = !n;
    var st = art.querySelector(".cstat");
    if (st && n && !st.classList.contains("cbad")) st.textContent = "Not saved yet.";
    if (st && !n && st.textContent === "Not saved yet.") st.textContent = "";
  }
  function say(rec, text, bad) {
    var st = rec.el && rec.el.querySelector(".cstat");
    if (st) { st.textContent = text; st.classList.toggle("cbad", !!bad); }
  }

  /* ---------- saving: one card at a time; "Saved" only after the server says so ---------- */
  function saveCard(id, status) {
    var rec = cards[id]; if (!rec || rec.busy) return;
    var fields = {}; Object.keys(rec.dirty).forEach(function (k) { fields[k] = rec.dirty[k]; });
    if (!Object.keys(fields).length && status === null) return;
    var body = { saved_by: who, card_id: rec.isNew ? "new" : id, base_rev: rec.isNew ? null : rec.base, fields: fields };
    if (status) body.status = status;
    if (rec.isNew) body.from_list = rec.data.from_list || "";
    rec.busy = true; say(rec, "Saving...");
    all(rec.el, "button").forEach(function (b) { b.disabled = true; });
    fetch(R.API + "/ude/cards/save" + Q, { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + R.getToken() },
      body: JSON.stringify(body) })
      .then(answer)
      .then(function (x) {
        rec.busy = false;
        if (x.s === 200 && x.j && x.j.ok && x.j.card) {
          var fresh = x.j.card;
          if (rec.isNew) {
            delete cards[id];
            order[order.indexOf(id)] = fresh.id;
            cards[fresh.id] = rec;
            rec.isNew = false;
          }
          rec.dirty = {};
          put(fresh);
          var r2 = cards[fresh.id];
          say(r2, (x.j.saved.changes || x.j.saved.added) ? "Saved " + clock() + " by " + x.j.saved.saved_by + "." : "Nothing had changed.");
          r2.el.setAttribute("data-saved-rev", String(fresh.rev));
          document.body.setAttribute("data-saved-rev", String(fresh.rev));
          tallyLine();
          return;
        }
        refreshFoot(rec, rec.el);
        all(rec.el, "button").forEach(function (b) { if (b.getAttribute("data-do") !== "save") b.disabled = false; });
        if (x.s === 409 && x.j && x.j.conflict) { conflict(rec); return; }
        if (x.s === 401) { say(rec, "Not saved: signed out. Reload the page and enter the password again.", true); return; }
        say(rec, "Not saved: " + String((x.j && x.j.error) || ("the server answered " + x.s)).replace(/\.$/, "") + ". Your words are still on this screen.", true);
      })
      .catch(function () {
        rec.busy = false;
        refreshFoot(rec, rec.el);
        all(rec.el, "button").forEach(function (b) { if (b.getAttribute("data-do") !== "save") b.disabled = false; });
        say(rec, "Not saved: the server could not be reached. Your words are still on this screen; press Save again.", true);
      });
  }
  function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function conflict(rec) {
    say(rec, NEWER, true);
    showNotice(NEWER.replace(" The latest cards are loaded;", " Loading the latest cards now;"));
    leaving = true;
    setTimeout(function () { location.assign(urlWith({ notice: "newer" })); }, 1500);
  }

  function showNotice(text) {
    var old = $("ucNotice"); if (old) old.parentNode.removeChild(old);
    var p = mk("p", "cnotice noprint", text); p.id = "ucNotice"; p.setAttribute("role", "alert");
    var nav = document.querySelector(".cnav");
    nav.parentNode.insertBefore(p, nav.nextSibling);
  }

  /* ---------- adding a card for a topic that has none ---------- */
  function addBlank(fromList) {
    seq += 1;
    var id = "draft" + seq, data = { id: id, status: "starter", from_list: fromList || "", title: "", where: "", rev: 0, added: true };
    FIELDS.forEach(function (f) { data[f.key] = ""; });
    var rec = put(data, true);
    rec.el.scrollIntoView({ block: "start" });
    var first = rec.el.querySelector(".ci"); if (first) first.focus();
    return rec;
  }
  function discard(id) {
    var rec = cards[id]; if (!rec || !rec.isNew) return;
    if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    delete cards[id]; order.splice(order.indexOf(id), 1);
  }

  /* ---------- who is editing: one question, the answer remembered in this browser ---------- */
  function startEditing(addIndex) {
    var r = recall();
    if (names.indexOf(r) >= 0) location.assign(urlWith({ edit: r, add: addIndex })); else showPicker(addIndex);
  }
  function showPicker(addIndex) {
    var old = $("ucPick"); if (old) old.parentNode.removeChild(old);
    var box = mk("div", "cpick noprint"); box.id = "ucPick"; box.setAttribute("role", "dialog"); box.setAttribute("aria-labelledby", "ucPickTitle");
    var h = mk("p", "cpicktitle", "Who is editing?"); h.id = "ucPickTitle"; box.appendChild(h);
    var row = mk("div", "crow");
    names.forEach(function (n) {
      var b = mk("button", "cbtn cpri", n); b.type = "button"; b.setAttribute("data-name", n);
      b.addEventListener("click", function () { remember(n); leaving = true; location.assign(urlWith({ edit: n, add: addIndex })); });
      row.appendChild(b);
    });
    var cancel = mk("button", "cbtn", "Cancel"); cancel.type = "button"; cancel.id = "ucPickCancel";
    cancel.addEventListener("click", function () { box.parentNode.removeChild(box); });
    row.appendChild(cancel);
    box.appendChild(row);
    box.appendChild(mk("p", "chelp", "Your changes are saved under this name, and this browser remembers it."));
    var nav = document.querySelector(".cnav");
    nav.parentNode.insertBefore(box, nav.nextSibling);
    box.scrollIntoView({ block: "nearest" });
    var first = box.querySelector("button"); if (first) first.focus();
  }

  /* ---------- printing one card ---------- */
  function printOne(art) {
    endPrintOne();
    document.body.classList.add("cprintone"); art.classList.add("cprintthis");
    window.print();
    setTimeout(endPrintOne, 1000);
  }
  function endPrintOne() {
    document.body.classList.remove("cprintone");
    Array.prototype.forEach.call(document.querySelectorAll(".cprintthis"), function (n) { n.classList.remove("cprintthis"); });
  }

  /* ---------- live refresh: a card nobody is typing in follows the server ---------- */
  function poll() {
    if (polling || leaving) return;
    polling = true;
    fetch(R.API + "/ude/cards/board?part=state" + (TEST ? "&as=TEST" : ""), { headers: { "Authorization": "Bearer " + R.getToken() } })
      .then(answer)
      .then(function (x) {
        polling = false;
        if (x.s !== 200 || !x.j || !x.j.ok) return;
        (x.j.state.cards || []).forEach(function (c) {
          var rec = cards[c.id];
          if (!rec) { put(c); return; }
          if (rec.busy || Object.keys(rec.dirty).length || rec.el.contains(document.activeElement)) return;
          if ((c.rev || 0) !== rec.base) put(c);
        });
        tallyLine();
        document.body.setAttribute("data-refreshed", String(+new Date()));
      })
      .catch(function () { polling = false; });
  }
})();
