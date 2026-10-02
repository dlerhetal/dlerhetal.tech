/* Engagement plan page: agenda + syllabus, print buttons, talk-back, and editing in place.
   Generic shell: every word of content arrives from GET /plan after sign-in.
   Nothing in this file names a client, a person or an amount.

   Daily items: every agenda line that can be done carries an id (it comes with the content). A tick,
   a feedback note or a drop is POSTed to /plan/mark and kept on the server with the name and the
   time; the state of every item is a replay of that record. The page sorts the days around the
   server's "today": today first and open, later days under "Coming up", earlier days under
   "Earlier days". An item from an earlier day that is neither done nor dropped is shown again at
   the top of today as carried. It is the same item, so ticking it there finishes it. Nothing runs
   at night. The page asks the server for the state again every 30 seconds and when the tab regains
   focus; a poll never re-draws a feedback box, and a poll that started before a save is thrown away.

   Editing in place: the server holds the plan as a document with versions. A browser in consultant
   mode gets edit controls: click a line to change it (Enter or leaving the box saves, Escape
   cancels), "More" on a line for up, down, move, remove, and "Add" buttons where a line can be
   added. Every change is one small operation POSTed to /plan/edit; the server applies it to the
   newest version and answers with the whole plan. Everyone else gets the same page with no edit
   control in it, and the server refuses their operations anyway. */
(function () {
  "use strict";
  var E = RAM.esc, D = null;
  var STATUS = { done: "Done", started: "Started", not: "Not started" };
  var CALKINDS = [["", "Plain"], ["flag", "Red"], ["away", "Grey"], ["ver", "Review day"], ["end", "Bold"]];
  var NSK = RAM.NS.slice(1), K_WHO = NSK + "_plan_who";
  var TESTQ = (RAM.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search)) ? "as=TEST" : "";
  var EDIT = !!RAM.DALE_MODE;   // consultant mode: the edit controls are in the page
  var editor = "";        // the name changes are saved under
  var M = {};             // item id -> state replayed by the server (done, dropped, thread)
  var TODAY = "", TZ = "";
  var ITEMS = [], BYID = {};
  var IX = {};            // id -> { t: kind of node, n: the node, sibs: the list it sits in, p: its parent }
  var FLAG = {}, PHASEOF = {};
  var who = "";           // the name ticks and feedback are saved under; "" until one is picked
  var drafts = {};        // item id -> feedback text typed but not saved yet
  var folds = {};         // fold id -> open or shut, once the visitor has touched it
  var shownCarried = [];  // the ids in the carried block as last drawn
  var justDone = "";      // the carried item ticked a moment ago (offers Undo once)
  var pending = null;     // the action waiting for a name to be picked
  var gen = 0;            // bumped by every save: a poll that started before a save is thrown away
  var started = false;
  var cur = null;         // the line being edited: { id, f, span, ta, was, saving }
  var form = null;        // the open "add" form: { el, spec, busy, hold }
  var menu = null;        // the open "More" panel: { key, kind, id, where, sub, day, msg }
  var needDraw = false;   // a newer plan is in hand and waits for typing to stop
  var afterDraw = null;   // run once after the next full draw (scroll to a new day)
  var undoRev = 0;        // the version this browser's last change made (offers Undo once)
  var vers = { open: false, list: null, sure: 0, warn: "" };

  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function q(path) { return path + (TESTQ ? (path.indexOf("?") >= 0 ? "&" : "?") + TESTQ : ""); }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^ | $/g, ""); }

  /* ---------------------------------------------------------------- editable text */
  /* ed(): the words of one field. For a viewer it is the plain text. In consultant mode it is a
     span that opens a box when clicked; ph is what an empty optional field shows there. */
  function ed(id, f, ph) {
    var v = IX[id] ? IX[id].n[f] : "";
    if (!EDIT) return E(v);
    return '<span class="ed' + (v ? "" : " edempty") + '" data-ed="' + E(id) + '" data-f="' + E(f) + '" tabindex="0" role="button">' +
      (v ? E(v) : '<span class="edph">' + E(ph || "add") + '</span>') + '</span>';
  }
  function addBtn(what, to, label, kind) {
    if (!EDIT) return "";
    return '<button type="button" class="edadd noprint" data-add="' + what + '"' + (to ? ' data-to="' + E(to) + '"' : "") +
      (kind ? ' data-kind="' + kind + '"' : "") + '>' + E(label) + '</button>';
  }
  function toolsBox(kind, id, where) {
    if (!EDIT) return "";
    var key = id + "|" + (where || "");
    return '<div class="edtools noprint' + (menu && menu.key === key ? " open" : "") + '" data-tools="' + E(key) + '" data-kind="' + kind + '" data-id="' + E(id) + '" data-where="' + E(where || "") + '">' +
      toolsHtml(kind, id, where || "") + '</div>';
  }
  /* line(): words and their "More" side by side in consultant mode; for a viewer, just the words. */
  function line(words, tools) { return EDIT ? '<div class="edline">' + words + tools + '</div>' : words; }
  function pbtn(act, label, extra, off) {
    return '<button type="button" class="btn edbtn' + (off === "on" ? " on" : "") + '" data-pact="' + act + '"' + (extra || "") + (off === true ? " disabled" : "") + '>' + E(label) + '</button>';
  }
  function grp(html) { return '<span class="edgrp">' + html + '</span>'; }
  function sureHtml(text, act) { return '<span class="surelbl">' + E(text) + '</span>' + pbtn(act, "Yes") + pbtn("back", "No"); }
  function sibsOf(kind, id) {
    var x = IX[id]; if (!x) return [];
    if (kind === "deliverable") return (PHASEOF[id] ? PHASEOF[id].items : []).slice();
    var ids = (x.sibs || []).map(function (s) { return s.id; });
    if (kind === "item") ids = (x.sibs || []).filter(function (s) { return s.kind === x.n.kind; }).map(function (s) { return s.id; });
    return ids;
  }
  function daysPicker(act, skip) {
    return daysSorted().filter(function (d) { return d.id !== skip; }).map(function (d) { return pbtn(act, d.short || d.label, ' data-day="' + E(d.id) + '"'); }).join("");
  }
  /* toolsHtml(): the "More" button of one line and, when it is open, its panel. */
  function toolsHtml(kind, id, where) {
    var key = id + "|" + where, open = !!(menu && menu.key === key), x = IX[id];
    var h = '<button type="button" class="edmore" data-menu="' + E(key) + '" aria-expanded="' + open + '">' + (open ? "Close" : "More") + '</button>';
    if (!open || !x) return h;
    var m = menu, p = "", sibs = sibsOf(kind, id), at = sibs.indexOf(id);
    var updown = pbtn("up", "Up", "", at <= 0) + pbtn("down", "Down", "", at < 0 || at >= sibs.length - 1);
    if (m.sub === "remove") p = sureHtml(kind === "day" ? "Remove this day?" : (kind === "block" ? "Remove this block and its lines?" : (kind === "list" ? "Remove this list and its lines?" : (kind === "flag" ? "Remove this flag everywhere?" : "Remove this?"))), "removeyes");
    else if (m.sub === "drop") p = sureHtml("Not doing this. Sure?", "dropyes");
    else if (m.sub === "move") p = '<span class="edlbl">Move to which day?</span>' + daysPicker("moveday", kind === "block" && x.p ? x.p.id : "") + pbtn("back", "Cancel");
    else if (m.sub === "moveblk" && IX[m.day]) p = '<span class="edlbl">Which block on ' + E(IX[m.day].n.short) + '?</span>' +
      IX[m.day].n.blocks.map(function (b) { return pbtn("moveto", b.title, ' data-to="' + E(b.id) + '"'); }).join("") + pbtn("back", "Cancel");
    else if (m.sub === "attach") p = '<span class="edlbl">Show it under which day?</span>' + daysPicker("attachday", "") + pbtn("back", "Cancel");
    else if (kind === "item") {
      var s = stOf(id);
      if (where !== "carried") p += updown;
      p += pbtn("move", "Move to another day");
      if (!x.n.when) p += pbtn("when", "Add a time label");
      if (where !== "future") { if (s.dropped) p += pbtn("undrop", "Bring it back"); else if (!s.done) p += pbtn("drop", "Not doing this"); }
      p += pbtn("remove", "Remove");
    }
    else if (kind === "block") p = updown + pbtn("move", "Move to another day") + pbtn("addlist", "Add a list") + pbtn("remove", "Remove this block");
    else if (kind === "list") p = pbtn("remove", "Remove this list");
    else if (kind === "day") p = pbtn("remove", "Remove this day");
    else if (kind === "flag") p = (where ? pbtn("detach", "Take it off this day") : pbtn("attach", "Show it under a day")) + pbtn("remove", "Remove this flag");
    else if (kind === "cal") p = grp(updown + pbtn("remove", "Remove")) + grp('<span class="edlbl">Look:</span>' + CALKINDS.map(function (k) { return pbtn("calkind", k[1], ' data-v="' + k[0] + '"', (x.n.kind || "") === k[0] ? "on" : false); }).join(""));
    else if (kind === "deliverable") p = grp(updown) + grp('<span class="edlbl">Status:</span>' + ["done", "started", "not"].map(function (k) { return pbtn("status", STATUS[k], ' data-v="' + k + '"', x.n.status === k ? "on" : false); }).join("")) +
      grp('<span class="edlbl">Phase:</span>' + D.syllabus.phases.map(function (ph) { return pbtn("phase", String(ph.n), ' data-to="' + E(ph.id) + '"', PHASEOF[id] === ph ? "on" : false); }).join(""));
    else p = updown + pbtn("remove", "Remove");
    return h + '<div class="edpanel">' + p + (m.msg ? '<p class="edmsg" role="status">' + E(m.msg) + '</p>' : "") + '</div>';
  }

  function linkHtml(l) {
    if (l.doc) return '<a href="#" class="doclink" target="_blank" rel="noopener" data-doc="' + E(l.doc) + '">' + E(l.label) + '</a>';
    return E(l.label) + ': <a href="' + E(l.url) + '" target="_blank" rel="noopener">' + E(l.url) + '</a>';
  }
  /* linesHtml(): the lines of a display-only list (a block's list, the rulings, the list under the syllabus). */
  function linesHtml(parent, addLabel) {
    var lines = parent.lines || [];
    if (!lines.length && !EDIT) return "";
    return '<ul>' + lines.map(function (n) { return "<li>" + line(ed(n.id, "text"), toolsBox("line", n.id)) + "</li>"; }).join("") + "</ul>" +
      addBtn("line", parent.id || (parent === D.agenda.rulings ? "rulings" : "outside"), addLabel || "Add a line");
  }
  function flagHtml(key, tag, dayId) {
    var f = FLAG[key]; if (!f) return "";
    return '<div class="blk flag" data-flag="' + E(key) + '"><h3><span class="ftag">' + E(tag || "Flag") + '</span>' + ed(key, "title") + '</h3><p>' + ed(key, "text", "add the detail") + '</p>' +
      toolsBox("flag", key, dayId || "") + '</div>';
  }
  function st(s) { return '<span class="st ' + E(s) + '">' + E(STATUS[s] || s) + '</span>'; }

  /* ---------------------------------------------------------------- dates */
  function isoDate(iso) { var p = String(iso).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function longDate(iso) {
    try { return isoDate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); } catch (e) { return iso; }
  }
  function addDays(iso, n) { var d = isoDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekOf(iso) { var sun = addDays(iso, -isoDate(iso).getUTCDay()); return { sun: sun, sat: addDays(sun, 6) }; }
  function fmtWhen(ts) {
    try {
      var o = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
      if (TZ) o.timeZone = TZ;
      return new Date(ts).toLocaleString("en-US", o);
    } catch (e) { return RAM.fmtTs(ts); }
  }
  function clock() { try { return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }

  /* ---------------------------------------------------------------- the document, indexed */
  function indexDoc() {
    IX = {}; FLAG = {}; PHASEOF = {};
    function put(id, t, n, sibs, p) { IX[id] = { t: t, n: n, sibs: sibs || null, p: p || null }; }
    var a = D.agenda, s = D.syllabus;
    put("plan", "plan", D); put("agenda", "agenda", a); put("rulings", "rulings", a.rulings); put("syllabus", "syllabus", s); put("outside", "outside", s.outside);
    a.rulings.lines.forEach(function (n) { put(n.id, "line", n, a.rulings.lines, a.rulings); });
    s.outside.lines.forEach(function (n) { put(n.id, "line", n, s.outside.lines, s.outside); });
    a.days.forEach(function (d) {
      put(d.id, "day", d, a.days);
      (d.blocks || []).forEach(function (b) {
        put(b.id, "block", b, d.blocks, d);
        (b.lists || []).forEach(function (l) { put(l.id, "list", l, b.lists, b); l.lines.forEach(function (n) { put(n.id, "line", n, l.lines, l); }); });
        (b.items || []).forEach(function (it) { put(it.id, "item", it, b.items, b); });
      });
    });
    (D.flags || []).forEach(function (f) { put(f.id, "flag", f, D.flags); FLAG[f.id] = f; });
    s.calendar.forEach(function (c) { put(c.id, "cal", c, s.calendar); });
    s.phases.forEach(function (p) { put(p.id, "phase", p, s.phases); p.items.forEach(function (i) { PHASEOF[i] = p; }); });
    Object.keys(s.deliverables).forEach(function (i) { put(i, "deliverable", s.deliverables[i]); });
  }

  /* ---------------------------------------------------------------- daily items */
  function indexItems() {
    ITEMS = []; BYID = {};
    daysSorted().forEach(function (day) {
      (day.blocks || []).forEach(function (b) {
        (b.items || []).forEach(function (it) {
          var x = { id: it.id, kind: it.kind, when: it.when || "", text: it.text || "", day: day, block: b };
          ITEMS.push(x); BYID[x.id] = x;
        });
      });
    });
  }
  function daysSorted() {
    return (D.agenda.days || []).slice().sort(function (a, b) { var x = String(a.date || ""), y = String(b.date || ""); return x < y ? -1 : (x > y ? 1 : 0); });
  }
  function stOf(id) { return M[id] || { done: false, dropped: false, thread: [] }; }
  function isOpen(id) { var s = stOf(id); return !s.done && !s.dropped; }
  function plainText(it) { return (it.when ? it.when + ": " : "") + it.text; }
  function textHtml(it, inBlock) {
    if (it.kind === "block" && inBlock) return '<span class="iall">All of this block</span>';
    return (it.when ? '<b class="iwhen">' + ed(it.id, "when") + '</b> ' : '') + ed(it.id, "text");
  }
  function metaHtml(it, mode) {
    var s = stOf(it.id), h = "";
    if (s.done) h += '<span class="ok">Done by ' + E(s.doneBy) + ', ' + E(fmtWhen(s.doneAt)) + '</span>';
    if (s.dropped) h += (h ? " " : "") + '<span class="dropd">Dropped by ' + E(s.droppedBy) + ', ' + E(fmtWhen(s.droppedAt)) + '</span>';
    if (!s.done && !s.dropped && mode === "past") h = '<span class="carry">Not done, carried forward</span>';
    return h;
  }
  function threadSig(id) { var t = stOf(id).thread || []; return t.length + "-" + (t.length ? t[t.length - 1].id : 0); }
  function notesHtml(notes) {
    return (notes || []).map(function (t) {
      return '<div class="titem"><span class="tmeta">' + E(t.by) + ', ' + E(fmtWhen(t.ts)) + '</span><div class="ttext">' + E(t.text) + '</div></div>';
    }).join("");
  }
  /* the tools of an item (consultant mode only): "More" and its panel, where dropping now lives */
  function dropHtml(it, mode) { return EDIT ? toolsHtml("item", it.id, mode) : ""; }
  /* mode: "today" (the day itself), "carried" (shown at the top of today), "past" (an earlier day) or
     "future" (no ticking the future). */
  function itemHtml(it, mode) {
    var s = stOf(it.id), ro = mode === "future", d = drafts[it.id] || "";
    var h = '<div class="item' + (s.done ? " isdone" : "") + (s.dropped && !s.done ? " isdropped" : "") + (ro ? " ro" : "") + '" data-item="' + E(it.id) + '" data-mode="' + mode + '">';
    if (ro) h += '<span class="chk ro" aria-hidden="true"><span class="cbox"></span></span>';
    else h += '<label class="chk"><input type="checkbox" data-act="tick"' + (s.done ? " checked" : "") + ' aria-label="Done: ' + E(plainText(it).slice(0, 90)) + '"><span class="cbox" aria-hidden="true"></span></label>';
    h += '<div class="ibody"><div class="itext">' +
      (mode === "carried" ? '<span class="ctag">Carried from ' + E(it.day.short || it.day.label) + '</span>' : "") +
      textHtml(it, mode !== "carried") +
      (mode === "carried" && it.kind !== "block" ? ' <span class="ictx">' + E(it.block.title) + '</span>' : "") + '</div>';
    h += '<div class="imeta" data-part="meta">' + metaHtml(it, mode) + '</div>';
    if (!ro) {
      h += '<div class="ifb noprint"><textarea data-fb="' + E(it.id) + '" rows="1"' + (d ? ' class="has"' : "") + ' placeholder="Feedback on this item" aria-label="Feedback on this item">' + E(d) + '</textarea>' +
        '<button type="button" class="btn fbsave" data-act="savefb">Save</button><span class="fbstate" data-part="fbstate" role="status"></span></div>';
    }
    h += '<div class="ithread" data-part="thread" data-sig="' + threadSig(it.id) + '">' + notesHtml(stOf(it.id).thread) + '</div>';
    if (!ro || EDIT) h += '<div class="idrop noprint" data-part="drop">' + dropHtml(it, mode) + '</div>';
    if (!ro) h += '<div class="iask noprint" data-part="ask"></div>';
    return h + '</div></div>';
  }
  function itemsHtml(its, mode) {
    return '<div class="items">' + its.map(function (x) { return itemHtml(BYID[x.id], mode); }).join("") + '</div>';
  }
  function listHtml(l) {
    if (!l.lines.length && !EDIT) return "";
    return line('<h4>' + ed(l.id, "heading") + '</h4>', toolsBox("list", l.id)) + linesHtml(l);
  }

  function blockHtml(b, mode) {
    var its = b.items || [], lists = b.lists || [];
    function of(kind) { return its.filter(function (x) { return x.kind === kind && BYID[x.id]; }); }
    function at(place) { return lists.filter(function (l) { return (l.place === "bottom") === (place === "bottom"); }).map(listHtml).join(""); }
    var h = '<div class="blk agblk" data-block="' + E(b.id) + '">';
    if (b.time || EDIT) h += '<span class="timepill">' + ed(b.id, "time", "add a time") + '</span>';
    h += '<h3>' + ed(b.id, "title") + '</h3>';
    if (b.who || EDIT) h += '<span class="bwho">Who: ' + ed(b.id, "who", "add who") + '</span>';
    if (b.goal || EDIT) h += '<p class="goal"><b>Goal:</b> ' + ed(b.id, "goal", "add a goal") + '</p>';
    h += toolsBox("block", b.id);
    h += at("top");
    if (of("block").length) h += itemsHtml(of("block"), mode);
    if (of("check").length) h += '<h4>Check each one</h4>' + itemsHtml(of("check"), mode) + addBtn("item", b.id, "Add a check", "check");
    if (of("step").length) h += '<h4>Steps</h4>' + itemsHtml(of("step"), mode);
    h += addBtn("item", b.id, "Add a step", "step");
    if (b.decisions && b.decisions.length) {
      h += '<table class="ptable"><thead><tr><th style="width:20%">Decision</th><th>Wizard\'s recommendation</th><th style="width:28%">Where it stands</th></tr></thead><tbody>' +
        b.decisions.map(function (s) { return '<tr><td data-l="Decision"><b>' + E(s[0]) + '</b></td><td data-l="Recommendation">' + E(s[1]) + '</td><td data-l="Stands">' + E(s[2]) + '</td></tr>'; }).join("") + '</tbody></table>';
    }
    h += at("bottom");
    if (b.links && b.links.length) h += '<h4>Links</h4><ul class="links">' + b.links.map(function (l) { return "<li>" + linkHtml(l) + "</li>"; }).join("") + '</ul>';
    return h + '</div>';
  }

  function countLine(day, mode) {
    var n = 0, done = 0, dropped = 0;
    (day.blocks || []).forEach(function (b) {
      (b.items || []).forEach(function (it) { n++; var s = stOf(it.id); if (s.done) done++; else if (s.dropped) dropped++; });
    });
    if (!n) return "";
    var t = done + " of " + n + " done", open = n - done - dropped;
    if (dropped) t += ", " + dropped + " dropped";
    if (mode === "past" && open) t += ", " + open + " carried forward";
    return t;
  }
  function countSpan(day, mode, cls) {
    return '<span class="' + cls + '" data-daycount="' + E(day.id) + '" data-mode="' + mode + '">' + E(countLine(day, mode)) + '</span>';
  }
  function dayHead(day, mode, lead) {
    return '<div class="dayhead" id="day-' + E(day.id) + '" data-day="' + E(day.id) + '"><span>' + E((lead || "") + day.label) + '</span>' + countSpan(day, mode, "dcount") + '</div>';
  }
  function dayBody(day, mode) {
    var h = "";
    if (day.intro || EDIT) h += '<p class="lead">' + ed(day.id, "intro", "add a line under the day's name") + '</p>';
    (day.blocks || []).forEach(function (b) { h += blockHtml(b, mode); });
    h += addBtn("block", day.id, "Add a block");
    (day.flags || []).forEach(function (k) { h += flagHtml(k, day.short, day.id); });
    h += addBtn("flag", day.id, "Add a flag under this day");
    h += toolsBox("day", day.id);
    return h;
  }
  function foldHtml(id, titleHtml, body, defOpen, cls, attrs) {
    var open = folds[id] == null ? !!defOpen : !!folds[id];
    return '<div class="fold' + (open ? " open" : "") + (cls ? " " + cls : "") + '" id="fold-' + E(id) + '"' + (attrs || "") + '>' +
      '<button type="button" class="foldhead" data-fold="' + E(id) + '" aria-expanded="' + open + '">' + titleHtml +
      '<span class="chev" aria-hidden="true">&#8250;</span></button><div class="foldbody">' + body + '</div></div>';
  }

  /* The carried block: every item from an earlier day that is neither done nor dropped. An item whose
     feedback box still holds unsaved words stays in the block until they are saved, even once ticked. */
  function carriedIds() {
    var keep = {};
    shownCarried.forEach(function (id) { keep[id] = 1; });
    return ITEMS.filter(function (it) {
      if (!(it.day.date && TODAY && it.day.date < TODAY)) return false;
      return isOpen(it.id) || (keep[it.id] && (drafts[it.id] || "").trim());
    }).map(function (it) { return it.id; });
  }
  function carriedCount(ids) { var n = ids.filter(isOpen).length; return n ? "(" + n + ")" : ""; }
  function carriedHtml(ids, anyEarlier) {
    if (!anyEarlier) return "";
    var h = '<div class="blk carried" id="carried"><h3>Carried from earlier days <span class="ccount" id="carriedCount">' + carriedCount(ids) + '</span></h3>';
    if (ids.length) {
      h += '<p class="lead">Not finished on its own day. Ticking one here finishes it.</p>' +
        '<div class="items">' + ids.map(function (id) { return itemHtml(BYID[id], "carried"); }).join("") + '</div>';
    } else h += '<p class="lead">Nothing is carried. Every earlier item is done or dropped.</p>';
    if (justDone && BYID[justDone] && stOf(justDone).done && ids.indexOf(justDone) < 0) {
      var t = plainText(BYID[justDone]);
      h += '<p class="undoline noprint">Marked done: ' + E(t.length > 90 ? t.slice(0, 90) + "..." : t) + ' <button type="button" class="linkbtn2" data-act="undo">Undo</button></p>';
    }
    return h + '</div>';
  }

  function renderAgenda() {
    var a = D.agenda, todayDay = null, earlier = [], later = [];
    daysSorted().forEach(function (d) {
      if (TODAY && d.date === TODAY) todayDay = d;
      else if (TODAY && d.date && d.date < TODAY) earlier.push(d);
      else later.push(d);
    });
    earlier.reverse();   /* newest first */
    var ids = carriedIds();
    var h = '<h2>' + ed("agenda", "title") + '</h2>';
    h += '<div class="whobar noprint" id="whoBar"></div><div class="plannews noprint" id="planNews" hidden></div>';
    h += '<div class="blk rulings"><h3>' + ed("rulings", "heading") + '</h3>' + linesHtml(a.rulings, "Add a ruling") + '</div>';
    h += addBtn("day", "", "Add a day");
    h += '<div id="today">';
    if (todayDay) h += dayHead(todayDay, "today", "Today: ");
    else if (TODAY) h += '<p class="noday" id="noAgenda">No agenda has been written for today yet. Today is ' + E(longDate(TODAY)) + '.</p>';
    h += carriedHtml(ids, earlier.some(function (d) { return (d.blocks || []).some(function (b) { return (b.items || []).length; }); }));
    if (todayDay) h += dayBody(todayDay, "today");
    else if (earlier.length) h += '<p class="recentlbl">The most recent day</p>' + dayHead(earlier[0], "past", "") + dayBody(earlier[0], "past");
    h += '</div>';
    if (later.length) {
      h += foldHtml("coming", '<span class="foldt">Coming up</span><span class="foldn">' + later.length + (later.length === 1 ? " day" : " days") + (EDIT ? ", no ticking yet" : ", read only") + '</span>',
        later.map(function (d) { return dayHead(d, "future", "") + dayBody(d, "future"); }).join(""), false, "");
    }
    if (earlier.length) {
      h += foldHtml("earlier", '<span class="foldt">Earlier days</span><span class="foldn">' + earlier.length + (earlier.length === 1 ? " day" : " days") + ', newest first</span>',
        earlier.map(function (d, i) {
          return foldHtml("arch-" + d.id, '<span class="foldt">' + E(d.label) + '</span>' + countSpan(d, "past", "foldn"), dayBody(d, "past"), i === 0, "dayfold", ' data-day="' + E(d.id) + '"');
        }).join(""), false, "");
    }
    document.getElementById("agenda").innerHTML = h;
    shownCarried = ids;
    each('a[href="#fold-earlier"]', function (l) { l.hidden = !earlier.length; });
    drawWho();
  }

  /* After a poll, or a save that moved nothing: every item's box, state line, thread and tools in
     place, plus the counts. The feedback boxes are never touched here. */
  function setPart(el, name, html) {
    var p = el.querySelector('[data-part="' + name + '"]');
    if (p && p._h !== html) { p.innerHTML = html; p._h = html; }
  }
  function softUpdate() {
    each("#agenda .item[data-item]", function (el) {
      var it = BYID[el.dataset.item]; if (!it) return;
      var s = stOf(it.id), cb = el.querySelector('input[data-act="tick"]');
      el.classList.toggle("isdone", !!s.done);
      el.classList.toggle("isdropped", !!s.dropped && !s.done);
      if (cb && !cb.disabled && cb.checked !== !!s.done) cb.checked = !!s.done;
      setPart(el, "meta", metaHtml(it, el.dataset.mode));
      var th = el.querySelector('[data-part="thread"]'), sig = threadSig(it.id);
      if (th && th.dataset.sig !== sig) { th.innerHTML = notesHtml(s.thread); th.dataset.sig = sig; }
      if (!(form && el.contains(form.el))) setPart(el, "drop", dropHtml(it, el.dataset.mode));
    });
    each("[data-daycount]", function (el) {
      var day = (D.agenda.days || []).filter(function (d) { return d.id === el.dataset.daycount; })[0];
      if (day) el.textContent = countLine(day, el.dataset.mode);
    });
    var cc = document.getElementById("carriedCount"); if (cc) cc.textContent = carriedCount(shownCarried);
  }
  /* typing(): the cursor is in a box on this page. */
  function typing() {
    var ae = document.activeElement;
    return !!(ae && ae.matches && ae.matches("textarea, input, select") && ae.closest && ae.closest("#planMain") && !ae.readOnly);
  }
  /* busy(): something on screen would be lost or disturbed by a re-draw that the visitor did not cause. */
  function busy() {
    if (pending || cur || form || menu || vers.sure) return true;
    var ae = document.activeElement, tas = document.querySelectorAll("textarea[data-fb]");
    if (ae && ae.matches && ae.matches("textarea[data-fb]")) return true;
    for (var i = 0; i < tas.length; i++) if (tas[i].value.trim()) return true;
    return false;
  }
  /* sync(): put a new state on screen. The agenda is re-drawn only when the carried block gains or loses
     an item; a poll never does that while something is being typed (the next poll tries again). */
  function sync(fromPoll) {
    if (carriedIds().join(",") !== shownCarried.join(",") && !(fromPoll && busy()) && !cur && !form) renderAgenda();
    else softUpdate();
    renderWeek();
  }

  /* ---------------------------------------------------------------- this week */
  function wrow(it, box, meta) {
    return '<li class="wrow" data-witem="' + E(it.id) + '"><span class="wbox ' + box + '" aria-hidden="true"></span><div class="wtxt">' +
      (it.when ? '<b class="iwhen">' + E(it.when) + '</b> ' : "") + E(it.text) + '<span class="wmeta">' + meta + '</span></div></li>';
  }
  function wblock(key, title, rows) {
    return '<div class="blk wk" data-wk="' + key + '"><h3>' + title + ' <span class="ccount">(' + rows.length + ')</span></h3>' +
      (rows.length ? '<ul class="wlist">' + rows.join("") + '</ul>' : '<p class="lead">Nothing here.</p>') + '</div>';
  }
  function renderWeek() {
    var box = document.getElementById("week"); if (!box || !TODAY) return;
    var w = weekOf(TODAY);
    function inWeek(iso) { return !!iso && iso >= w.sun && iso <= w.sat; }
    var done = [], open = [], dropped = [], noted = [], nNotes = 0;
    ITEMS.forEach(function (it) {
      var s = stOf(it.id), d = it.day.date || "", own = E(it.day.short || it.day.label);
      if (s.done) {
        if (inWeek(d) || inWeek(s.doneDay)) done.push({ at: s.doneAt, h: wrow(it, "on", own + ". Done by " + E(s.doneBy) + ", " + E(fmtWhen(s.doneAt))) });
      } else if (s.dropped) {
        if (inWeek(d) || inWeek(s.droppedDay)) dropped.push(wrow(it, "x", own + ". Dropped by " + E(s.droppedBy) + ", " + E(fmtWhen(s.droppedAt))));
      } else if (d && d <= w.sat) {
        open.push(wrow(it, "", d < TODAY ? "Carried from " + own : (d === TODAY ? "Today, " + own : "Coming " + own)));
      }
      var notes = (s.thread || []).filter(function (t) { return inWeek(t.day); });
      if (notes.length) {
        nNotes += notes.length;
        noted.push('<div class="wnote" data-witem="' + E(it.id) + '"><div class="wtxt">' + (it.when ? '<b class="iwhen">' + E(it.when) + '</b> ' : "") + E(it.text) +
          '<span class="wmeta">' + own + '. ' + (s.done ? "Done" : (s.dropped ? "Dropped" : "Open")) + '</span></div><div class="ithread">' + notesHtml(notes) + '</div></div>');
      }
    });
    done.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0); });
    var h = '<h2>This week</h2><p class="lead" id="weekRange">' + E(longDate(w.sun)) + ' to ' + E(longDate(w.sat)) + '. What was done, what is still open, what was dropped, and everything said about it.</p>';
    h += '<div class="counts"><span><b>' + done.length + '</b> done</span><span><b>' + open.length + '</b> open or carried</span><span><b>' + dropped.length +
      '</b> dropped</span><span><b>' + nNotes + '</b> feedback ' + (nNotes === 1 ? "note" : "notes") + '</span></div>';
    h += wblock("done", "Done", done.map(function (x) { return x.h; }));
    h += wblock("open", "Open or carried", open);
    h += wblock("dropped", "Dropped", dropped);
    h += '<div class="blk wk" data-wk="notes"><h3>Feedback this week <span class="ccount">(' + nNotes + ')</span></h3>' +
      (noted.length ? noted.join("") : '<p class="lead">Nothing here.</p>') + '</div>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- who is ticking */
  function whoList() { var w = (D.who || []).slice(); if (RAM.TEST_MODE) w.push("TEST"); return w; }
  function initWho() {
    var w = whoList(), m = location.search.match(/[?&]as=([^&]+)/);
    var pre = RAM.TEST_MODE && m ? decodeURIComponent(m[1]) : lsGet(K_WHO);
    /* a browser in consultant mode starts as the consultant (still changeable in the bar) */
    var first = String(D.consultant || "").split(" ")[0];
    if (w.indexOf(pre) < 0 && RAM.DALE_MODE) pre = first;
    who = w.indexOf(pre) >= 0 ? pre : "";
    editor = TESTQ ? "TEST" : first;
  }
  function whoButtons(attr) {
    return whoList().map(function (n) {
      return '<button type="button" class="wbtn' + (n === who ? " on" : "") + '" ' + attr + '="' + E(n) + '" aria-pressed="' + (n === who) + '">' + E(n) + '</button>';
    }).join("");
  }
  function drawWho() {
    var bar = document.getElementById("whoBar"); if (!bar) return;
    bar.innerHTML = '<span class="wholine">' + (who ? "Ticks and feedback are saved as" : "Who are you? Pick your name once.") + '</span>' + whoButtons("data-who");
    var sel = document.getElementById("noteWho"); if (sel && who) sel.value = who;
  }
  function setWho(name) {
    who = name; if (name !== "TEST") lsSet(K_WHO, name);
    drawWho();
    each('[data-part="ask"]', function (s) { s.innerHTML = ""; });
    var run = pending; pending = null; if (run) run();
  }
  /* needWho(el, run): run now if a name is picked; otherwise ask once, inside the item, and run after. */
  function needWho(el, run) {
    if (who) { run(); return; }
    pending = run;
    var slot = el && el.querySelector('[data-part="ask"]');
    if (!slot) { var bar = document.getElementById("whoBar"); if (bar) bar.scrollIntoView({ block: "center" }); return; }
    slot.innerHTML = '<span class="asklbl">Who are you? This is asked once.</span>' + whoButtons("data-pick");
    var b = slot.querySelector("button"); if (b) b.focus();
  }

  /* ---------------------------------------------------------------- saving ticks and feedback */
  function say(el, text, bad) {
    var s = el && el.querySelector('[data-part="fbstate"]');
    if (s) { s.textContent = text; s.className = "fbstate" + (bad ? " bad" : ""); }
  }
  function sayAll(id, text, bad) { each('#agenda .item[data-item="' + id + '"]', function (el) { say(el, text, bad); }); }
  /* act(): one row to the record. Resolves true when it was saved. */
  function act(id, kind, text, el, after) {
    gen++;
    return RAM.apiJSON("/plan/mark", { method: "POST", json: { item: id, kind: kind, text: text || "", answered_by: who } })
      .then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "not saved"); return r; })
      .then(function (r) {
        gen++;
        M = r.marks || {};
        if (after) after(r);
        sync(false);
        news(r);
        return true;
      }, function (e) {
        gen++;
        if (e && e.message === "signed out") return false;
        softUpdate();
        var msg = "Not saved: " + (e && e.message === "Failed to fetch" ? "no connection. Try again." : (e && e.message) || "try again");
        if (document.body.contains(el)) say(el, msg, true); else sayAll(id, msg, true);
        return false;
      });
  }

  document.addEventListener("change", function (e) {
    var cb = e.target; if (!D || !cb.matches || !cb.matches('input[data-act="tick"]')) return;
    var el = cb.closest(".item"), id = el.dataset.item, mode = el.dataset.mode, want = cb.checked;
    if (!who) cb.checked = !want;            /* nothing moves until there is a name to save it under */
    needWho(el, function () {
      cb.checked = want; cb.disabled = true; justDone = "";
      act(id, want ? "check" : "uncheck", "", el, function () { if (want && mode === "carried") justDone = id; }).then(function (ok) {
        cb.disabled = false;
        if (!ok) softUpdate();               /* the box goes back to what the record says */
        var n = document.querySelector('#agenda .item[data-item="' + id + '"][data-mode="' + mode + '"] input[data-act="tick"]');
        if (n && (document.activeElement === document.body || !document.activeElement)) n.focus({ preventScroll: true });
      });
    });
  });
  document.addEventListener("input", function (e) {
    var ta = e.target; if (!ta.matches) return;
    if (ta.matches(".edin")) { grow(ta); return; }
    if (!ta.matches("textarea[data-fb]")) return;
    var id = ta.dataset.fb; drafts[id] = ta.value;
    ta.classList.toggle("has", !!ta.value);
    each('textarea[data-fb="' + id + '"]', function (o) { if (o !== ta) { o.value = ta.value; o.classList.toggle("has", !!ta.value); } });
  });

  /* ---------------------------------------------------------------- editing in place (consultant mode) */
  function setStatus(text, bad) {
    var s = document.getElementById("edState");
    if (s) { s.textContent = text; s.className = "edstate" + (bad ? " bad" : ""); }
  }
  function drawBar() {
    var row = document.getElementById("edRow"); if (!row) return;
    if (!EDIT) { row.hidden = true; return; }
    if (!row.firstChild) {
      row.innerHTML = '<span class="edon">Editing is on' + (editor === "TEST" ? " (test)" : "") + '</span><span class="edstate" id="edState" role="status">Click a line to change it.</span>' +
        '<button type="button" class="btn edbtn" id="edUndo" data-act="edundo" hidden>Undo</button><button type="button" class="btn edbtn" data-act="edvers">Earlier versions</button>';
    }
    row.hidden = false;
    document.body.classList.add("editing");
    var u = document.getElementById("edUndo"); if (u) u.hidden = !(undoRev && D && D.rev === undoRev);
  }
  function grow(ta) { if (ta.tagName !== "TEXTAREA") return; ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; }
  /* sendOps(): a list of changes to the server, as one version. Resolves { ok, error, r }. onOk runs
     before the page is re-drawn. The status line says Saved only when the server said so. */
  function sendOps(ops, onOk, okWord) {
    gen++;
    setStatus("Saving");
    return RAM.api(q("/plan/edit"), { method: "POST", json: { answered_by: editor, ops: ops } })
      .then(function (resp) {
        return resp.json().then(function (j) { return j; }, function () { return { ok: false, error: "the server answered " + resp.status + ". Try again." }; });
      })
      .then(function (r) {
        gen++;
        if (!r || !r.ok) {
          var why = (r && r.error) || "the server refused it";
          setStatus("Not saved: " + why, true);
          return { ok: false, error: why, r: r || {} };
        }
        if (onOk) onOk(r);
        if (r.changed && r.plan) {
          undoRev = okWord === "Undone" ? 0 : r.rev;
          take(r.plan);
          if (typing() || cur || form) { needDraw = true; drawBar(); } else drawAll();
          setStatus((okWord || "Saved") + " " + clock());
          if (vers.open) loadVersions();
        } else setStatus("Nothing changed");
        return { ok: true, r: r };
      }, function (e) {
        gen++;
        var why = e && e.message === "signed out" ? "signed out. Enter the password again." : "no connection. Try again.";
        setStatus("Not saved: " + why, true);
        return { ok: false, error: why, r: {} };
      });
  }
  /* settle(): draw the newer plan that was held back while a box had the cursor. */
  function settle() { if (needDraw && !typing() && !cur && !form) drawAll(); }

  function openEd(span) {
    if (cur && cur.span === span) return;
    if (cur) commitEd();
    var id = span.dataset.ed, f = span.dataset.f, x = IX[id];
    if (!x) return;
    var was = String(x.n[f] || "");
    var ta = document.createElement("textarea");
    ta.className = "edin"; ta.rows = 1; ta.value = was;
    ta.setAttribute("aria-label", "Change this text. Enter saves, Escape cancels.");
    span.hidden = true;
    span.parentNode.insertBefore(ta, span.nextSibling);
    cur = { id: id, f: f, span: span, ta: ta, was: was, saving: false };
    grow(ta); ta.focus();
    try { ta.setSelectionRange(was.length, was.length); } catch (e) { }
  }
  function edMsg(c, text) {
    var m = c.ta.nextSibling;
    if (!(m && m.classList && m.classList.contains("edmsg"))) { m = document.createElement("span"); m.className = "edmsg"; m.setAttribute("role", "status"); c.ta.parentNode.insertBefore(m, c.ta.nextSibling); }
    m.textContent = text;
  }
  function closeEd(c) {
    var m = c.ta.nextSibling; if (m && m.classList && m.classList.contains("edmsg")) m.remove();
    c.ta.remove(); c.span.hidden = false;
    if (cur === c) cur = null;
  }
  function cancelEd() { if (cur && !cur.saving) { closeEd(cur); settle(); } }
  function commitEd() {
    var c = cur; if (!c || c.saving) return;
    var v = clean(c.ta.value);
    if (v === clean(c.was) && !c.over) { closeEd(c); settle(); return; }
    c.saving = true; c.ta.readOnly = true;
    if (document.activeElement === c.ta) c.ta.blur();
    sendOps([{ op: "set", target: c.id, field: c.f, text: v, was: c.was }], function () {
      /* saved: the box closes now; the page is re-drawn right after (or when typing elsewhere stops) */
      if (v) { c.span.textContent = v; c.span.classList.remove("edempty"); }
      closeEd(c);
    }).then(function (res) {
      if (res.ok) return;
      c.saving = false; c.ta.readOnly = false;
      if (res.r && res.r.current !== undefined) {
        c.was = String(res.r.current); c.over = true;
        edMsg(c, "Not saved: " + res.error + " Press Enter in the box to save yours over it, or Escape to keep the other.");
      } else edMsg(c, "Not saved: " + res.error + (res.r && res.r.gone ? "" : " Your words are still in the box."));
    });
  }

  function formVals(f) {
    var v = {};
    Array.prototype.forEach.call(f.el.querySelectorAll(".edin"), function (i) { v[i.dataset.f] = clean(i.value); });
    return v;
  }
  function closeForm() { if (form) { form.el.remove(); form = null; settle(); } }
  /* openForm(): a small form put in front of `anchor`. spec: { fields: [{ n, ph, type, v }], ok, ops(vals), again, done(r) }. */
  function openForm(anchor, spec) {
    if (cur) commitEd();
    closeForm();
    var el = document.createElement("div");
    el.className = "edform noprint";
    el.innerHTML = spec.fields.map(function (f) {
      return f.type === "date" ? '<input type="date" class="edin" data-f="' + f.n + '" aria-label="' + E(f.ph) + '">' :
        '<textarea class="edin" rows="1" data-f="' + f.n + '" placeholder="' + E(f.ph) + '" aria-label="' + E(f.ph) + '">' + E(f.v || "") + '</textarea>';
    }).join("") + '<button type="button" class="btn edbtn" data-fact="ok">' + E(spec.ok || "Add") + '</button><button type="button" class="btn edbtn" data-fact="no">Cancel</button><span class="edmsg" role="status"></span>';
    anchor.parentNode.insertBefore(el, anchor);
    form = { el: el, spec: spec, busy: false, hold: 0 };
    var first = el.querySelector(".edin"); if (first) first.focus();
  }
  function submitForm(chain) {
    var f = form; if (!f || f.busy) return;
    var ops = f.spec.ops(formVals(f)), msg = f.el.querySelector(".edmsg");
    if (typeof ops === "string") { msg.textContent = ops; return; }
    f.busy = true; msg.textContent = "Saving";
    var ae = document.activeElement; if (ae && f.el.contains(ae)) ae.blur();
    sendOps(ops, function (r) {
      f.el.remove(); if (form === f) form = null;
      if (f.spec.done) f.spec.done(r);
    }).then(function (res) {
      if (!res.ok) { f.busy = false; msg.textContent = "Not saved: " + res.error; return; }
      if (chain && f.spec.again) { var b = document.querySelector(f.spec.again); if (b) startAdd(b); }
    });
  }
  function startAdd(btn) {
    var what = btn.dataset.add, to = btn.dataset.to || "", kind = btn.dataset.kind || "";
    var sel = '[data-add="' + what + '"]' + (to ? '[data-to="' + to + '"]' : "") + (kind ? '[data-kind="' + kind + '"]' : "");
    var spec = null;
    if (what === "item") spec = { fields: [{ n: "text", ph: kind === "check" ? "The new check" : "The new step" }], again: sel,
      ops: function (v) { return v.text ? [{ op: "add", what: "item", block: to, kind: kind || "step", text: v.text }] : "Type the line first."; } };
    else if (what === "line") spec = { fields: [{ n: "text", ph: "The new line" }], again: sel,
      ops: function (v) { return v.text ? [{ op: "add", what: "line", to: to, text: v.text }] : "Type the line first."; } };
    else if (what === "cal") spec = { fields: [{ n: "date", ph: "The date, as it should read" }, { n: "text", ph: "What happens then" }],
      ops: function (v) { return v.date && v.text ? [{ op: "add", what: "cal", date: v.date, text: v.text }] : "Give both the date and what happens."; } };
    else if (what === "flag") spec = { fields: [{ n: "title", ph: "The flag, in a few words" }, { n: "text", ph: "The detail" }],
      ops: function (v) { var o = { op: "add", what: "flag", title: v.title, text: v.text }; if (to) o.day = to; return v.title ? [o] : "Give the flag a few words first."; } };
    else if (what === "block") spec = { fields: [{ n: "title", ph: "The name of the block" }, { n: "time", ph: "When (can be left empty)" }, { n: "who", ph: "Who (can be left empty)" }],
      ops: function (v) { return v.title ? [{ op: "add", what: "block", day: to, title: v.title, time: v.time, who: v.who }] : "Give the block a name first."; } };
    else if (what === "list") spec = { fields: [{ n: "heading", ph: "The heading of the list" }],
      ops: function (v) { return v.heading ? [{ op: "add", what: "list", block: to, heading: v.heading }] : "Give the list a heading first."; } };
    else if (what === "day") spec = { fields: [{ n: "date", type: "date", ph: "The date of the new day" }],
      ops: function (v) { return v.date ? [{ op: "add", what: "day", date: v.date }] : "Pick the date first."; },
      done: function (r) {
        var id = (r.new_ids || [])[0]; if (!id) return;
        folds.coming = true; folds.earlier = true; folds["arch-" + id] = true;
        afterDraw = function () { var t = document.getElementById("day-" + id) || document.getElementById("fold-arch-" + id); if (t) t.scrollIntoView({ block: "center" }); };
      } };
    if (spec) openForm(btn, spec);
  }

  function refreshTools() {
    each("[data-tools]", function (el) {
      if (form && el.contains(form.el)) return;
      var h = toolsHtml(el.dataset.kind, el.dataset.id, el.dataset.where);
      el.classList.toggle("open", !!(menu && menu.key === el.dataset.tools));
      if (el._h !== h) { el.innerHTML = h; el._h = h; }
    });
    each("#agenda .item[data-item]", function (el) {
      var it = BYID[el.dataset.item];
      if (it && !(form && el.contains(form.el))) setPart(el, "drop", dropHtml(it, el.dataset.mode));
    });
  }
  function toggleMenu(btn) {
    var key = btn.dataset.menu, box = btn.closest("[data-tools]"), item = btn.closest(".item");
    if (form) closeForm();
    if (menu && menu.key === key) menu = null;
    else if (box) menu = { key: key, kind: box.dataset.kind, id: box.dataset.id, where: box.dataset.where || "", sub: "", msg: "" };
    else if (item) menu = { key: key, kind: "item", id: item.dataset.item, where: item.dataset.mode, sub: "", msg: "" };
    refreshTools();
    if (!menu) settle();
  }
  /* run(): one change from a panel. shut: the panel closes when it is saved. */
  function run(ops, shut) {
    var m = menu;
    sendOps(ops, function () { if (shut && menu === m) menu = null; }).then(function (res) {
      if (!res.ok && menu === m) { m.sub = ""; m.msg = "Not done: " + res.error; refreshTools(); }
    });
  }
  function doPanel(a, btn) {
    var m = menu; if (!m || !IX[m.id]) return;
    var id = m.id, kind = m.kind, sibs = sibsOf(kind, id), at = sibs.indexOf(id), el = btn.closest(".item");
    m.msg = "";
    if (a === "back") { m.sub = ""; refreshTools(); }
    else if (a === "up" && at > 0) run([{ op: "move", target: id, before: sibs[at - 1] }]);
    else if (a === "down" && at >= 0 && at < sibs.length - 1) run([{ op: "move", target: id, after: sibs[at + 1] }]);
    else if (a === "remove" || a === "drop" || a === "move" || a === "attach") { m.sub = a; refreshTools(); }
    else if (a === "removeyes") run([{ op: "remove", target: id }], true);
    else if (a === "moveday") {
      var day = IX[btn.dataset.day] && IX[btn.dataset.day].n; if (!day) return;
      if (kind === "block") run([{ op: "move", target: id, to: day.id }], true);
      else if (!day.blocks.length) { m.sub = ""; m.msg = "That day has no block yet. Add a block there first."; refreshTools(); }
      else if (day.blocks.length === 1) run([{ op: "move", target: id, to: day.blocks[0].id }], true);
      else { m.sub = "moveblk"; m.day = day.id; refreshTools(); }
    }
    else if (a === "moveto") run([{ op: "move", target: id, to: btn.dataset.to }], true);
    else if (a === "dropyes") { menu = null; needWho(el, function () { act(id, "drop", "", el); }); refreshTools(); }
    else if (a === "undrop") { menu = null; needWho(el, function () { act(id, "undrop", "", el); }); refreshTools(); }
    else if (a === "when") openForm(btn, { fields: [{ n: "when", ph: "The time label, for example First" }], ok: "Save",
      ops: function (v) { return v.when ? [{ op: "set", target: id, field: "when", text: v.when }] : "Type the label first."; } });
    else if (a === "addlist") openForm(btn, { fields: [{ n: "heading", ph: "The heading of the list" }],
      ops: function (v) { return v.heading ? [{ op: "add", what: "list", block: id, heading: v.heading }] : "Give the list a heading first."; } });
    else if (a === "status") run([{ op: "set", target: id, field: "status", text: btn.dataset.v }]);
    else if (a === "calkind") run([{ op: "set", target: id, field: "kind", text: btn.dataset.v }]);
    else if (a === "phase") run([{ op: "move", target: id, to: btn.dataset.to }]);
    else if (a === "detach") run([{ op: "attach", target: id, day: m.where, on: false }], true);
    else if (a === "attachday") run([{ op: "attach", target: id, day: btn.dataset.day, on: true }], true);
  }

  /* ---------------------------------------------------------------- earlier versions (consultant mode) */
  function drawVersions() {
    var box = document.getElementById("versions"); if (!box) return;
    if (!EDIT || !vers.open) { box.hidden = true; box.innerHTML = ""; return; }
    var h = '<h2>Earlier versions</h2><p class="lead">Every change is kept. Making an earlier version current adds it again as the newest; nothing is deleted.</p>';
    if (!vers.list) h += '<p class="lead">Loading</p>';
    else {
      h += '<ul class="vlist">' + vers.list.map(function (v) {
        var li = '<li class="vrow' + (v.current ? " cur" : "") + '" data-ver="' + v.id + '"><div class="vtxt"><b>Version ' + v.id + '</b> <span class="vmeta">' + E(v.saved_by) + ', ' + E(fmtWhen(v.ts_utc)) + '</span><div class="vsum">' + E(v.summary) + '</div></div>';
        if (v.current) li += '<span class="vcur">Current</span>';
        else if (vers.sure === v.id) li += '<div class="vsure"><span class="surelbl">' + E(vers.warn || "Make version " + v.id + " the current version?") + '</span><button type="button" class="btn edbtn" data-vact="yes">Yes</button><button type="button" class="btn edbtn" data-vact="no">No</button></div>';
        else li += '<button type="button" class="btn edbtn" data-vact="pick">Make this the current version</button>';
        return li + '</li>';
      }).join("") + '</ul>';
    }
    h += '<p><button type="button" class="btn edbtn" data-vact="close">Close</button></p>';
    box.innerHTML = h; box.hidden = false;
  }
  function loadVersions() {
    RAM.apiJSON(q("/plan/versions")).then(function (r) { if (r && r.ok) { vers.list = r.versions; drawVersions(); } }).catch(function () { });
  }
  function doVersion(a, btn) {
    var li = btn.closest("[data-ver]"), id = li ? +li.dataset.ver : 0;
    if (a === "close") { vers.open = false; vers.sure = 0; drawVersions(); }
    else if (a === "no") { vers.sure = 0; drawVersions(); }
    else if (a === "pick") {
      vers.sure = id; vers.warn = ""; drawVersions();
      RAM.apiJSON(q("/plan/versions?id=" + id)).then(function (r) {
        var n = r && r.ok && r.marked_missing ? r.marked_missing.length : 0;
        if (n && vers.sure === id) {
          vers.warn = "Make version " + id + " the current version? " + n + (n === 1 ? " item that has" : " items that have") + " a tick or a note " + (n === 1 ? "is" : "are") + " not in it. The ticks and notes stay in the record and show again if the item comes back.";
          drawVersions();
        }
      }).catch(function () { });
    }
    else if (a === "yes") { vers.sure = 0; sendOps([{ op: "restore", version: id }], null, "Made version " + id + " current,").then(function (res) { if (!res.ok) drawVersions(); }); }
  }

  /* ---------------------------------------------------------------- syllabus */
  function renderSyllabus() {
    var s = D.syllabus, dl = s.deliverables, h = '<h2>' + E(s.title) + '</h2><p class="lead">' + ed("syllabus", "intro", "add an opening line") + '</p>';
    h += '<div class="counts"><span><b>' + s.total + '</b> deliverables in the signed VEP</span><span>' + st("done") + ' ' + s.counts.done + '</span><span>' + st("started") + ' ' + s.counts.started + '</span><span>' + st("not") + ' ' + s.counts.not + '</span></div>';
    if (s.vep_change) h += '<div class="blk"><h3>What changed at signing</h3><p>' + E(s.vep_change) + '</p></div>';
    if (s.math && s.math.length) h += '<div class="blk"><h3>The only dates on this page, and where they come from</h3><ul>' + s.math.map(function (t) { return "<li>" + E(t) + "</li>"; }).join("") + '</ul></div>';
    h += '<div class="blk" id="calendar"><h3>Calendar anchors</h3><table class="ptable cal"><thead><tr><th style="width:26%">Date</th><th>What</th></tr></thead><tbody>' +
      s.calendar.map(function (c) {
        return '<tr data-cal="' + E(c.id) + '"><td data-l="Date" class="k' + E(c.kind || "") + '"><b>' + ed(c.id, "date") + '</b></td><td data-l="What" class="k' + E(c.kind || "") + '">' + line(ed(c.id, "text"), toolsBox("cal", c.id)) + '</td></tr>';
      }).join("") + '</tbody></table>' + addBtn("cal", "", "Add a date") + '</div>';
    s.phases.forEach(function (p, pi) {
      if (pi === 0) h += '<div class="keep"><h2 class="subh">The sequence: what must happen before what, and why</h2>';
      h += '<div class="blk phase" data-phase="' + E(p.id) + '"><div class="phasehead"><span class="phasen">Phase ' + p.n + '</span><h3>' + ed(p.id, "name") + '</h3></div>';
      h += '<p class="when"><b>When:</b> ' + ed(p.id, "when", "add when") + '</p><p class="why"><b>Why this order:</b> ' + ed(p.id, "why", "add why") + '</p>';
      h += '<table class="ptable"><thead><tr><th style="width:12%">ID</th><th style="width:22%">Deliverable</th><th style="width:12%">Status</th><th>The work</th><th style="width:30%">Needs first</th></tr></thead><tbody>' +
        p.items.map(function (id) {
          var i = dl[id];
          return '<tr data-pdel="' + E(id) + '"><td data-l="ID" class="idc">' + E(id) + '</td><td data-l="Deliverable"><b>' + ed(id, "name") + '</b></td><td data-l="Status">' + st(i.status) + '</td><td data-l="Work">' + line(ed(id, "what", "add the work"), toolsBox("deliverable", id)) + '</td><td data-l="Needs">' + ed(id, "needs", "add what it needs") + '</td></tr>';
        }).join("") + '</tbody></table></div>';
      if (pi === 0) h += '</div>';
    });
    s.groups.forEach(function (g, gi) {
      if (gi === 0) h += '<div class="keep"><h2 class="subh">By SOFM: every deliverable, its status and the evidence</h2>';
      h += '<table class="ptable sofmtable"><thead><tr class="grow"><th colspan="6"><div class="grouphead"><h3>' + E(g.name) + ' <span class="sofm">(' + E(g.sofm) + ', ' + g.items.length + ')</span></h3><p class="lead">' + E(g.objective) + '</p></div></th></tr><tr><th style="width:11%">ID</th><th style="width:20%">Deliverable</th><th style="width:24%">What it is</th><th style="width:11%">Status</th><th>Evidence</th><th style="width:7%">Phase</th></tr></thead><tbody>' +
        g.items.map(function (id) {
          var i = dl[id];
          return '<tr data-del="' + E(id) + '"><td data-l="ID" class="idc">' + E(id) + '</td><td data-l="Deliverable"><b>' + E(i.name) + '</b></td><td data-l="What">' + ed(id, "desc", "add what it is") + '</td><td data-l="Status">' + st(i.status) + '</td><td data-l="Evidence">' + ed(id, "evidence", "add the evidence") + '</td><td data-l="Phase">' + (PHASEOF[id] ? PHASEOF[id].n : "") + '</td></tr>';
        }).join("") + '</tbody></table>';
      if (gi === 0) h += '</div>';
    });
    h += '<div class="blk" id="outside"><h3>' + ed("outside", "heading") + '</h3>' + linesHtml(s.outside) + '</div>';
    (D.flags || []).forEach(function (f, fi) {
      if (fi === 0) h += '<div class="keep"><h2 class="subh">Every flag</h2>';
      h += flagHtml(f.id, "Flag", "");
      if (fi === 0) h += '</div>';
    });
    h += addBtn("flag", "", "Add a flag");
    document.getElementById("syllabus").innerHTML = h;
  }

  /* ---------------------------------------------------------------- talk back */
  function currentDay() {
    var days = daysSorted(), today = null, before = null, after = null;
    days.forEach(function (d) { if (d.date === TODAY) today = d; else if (d.date < TODAY) before = d; else if (!after) after = d; });
    return today || before || after;
  }
  /* The "About" choices: a general one, then the blocks of the day the page is showing. */
  function aboutChoices() {
    var a = ["General"], day = currentDay();
    if (day) (day.blocks || []).forEach(function (b) { if (b.title && a.indexOf(b.title) < 0) a.push(b.title); });
    return a;
  }
  function drawAbout() {
    var sel = document.getElementById("noteAbout"); if (!sel || document.activeElement === sel) return;
    var keep = sel.value, a = aboutChoices(), h = a.map(function (x) { return "<option>" + E(x) + "</option>"; }).join("");
    if (sel._h === h) return;
    sel.innerHTML = h; sel._h = h;
    if (a.indexOf(keep) >= 0) sel.value = keep;
  }
  function renderNotes() {
    var who = (D.who || []).slice(); if (RAM.TEST_MODE) who.push("TEST");
    var h = '<h2>Talk back</h2><div class="blk notesform"><p>' + E(D.notes_prompt || "") + '</p>' +
      '<div class="row"><div><label for="noteAbout">About</label><select id="noteAbout"></select></div>' +
      '<div><label for="noteWho">From</label><select id="noteWho">' + who.map(function (a) { return "<option>" + E(a) + "</option>"; }).join("") + '</select></div></div>' +
      '<label for="noteText">What should change, or how did it go?</label><textarea id="noteText"></textarea>' +
      '<p><button type="button" class="btn pri" id="noteSend">Send</button><span class="notestate" id="noteState"></span></p>' +
      '<ul class="notelist" id="noteList"></ul></div>';
    document.getElementById("notes").innerHTML = h;
    drawAbout();
    drawNotes(D.notes || []);
    document.getElementById("noteSend").addEventListener("click", sendNote);
  }
  function drawNotes(notes) {
    var ul = document.getElementById("noteList"); if (!ul) return;
    ul.innerHTML = notes.length ? notes.map(function (n) {
      return '<li><span class="meta">' + E(n.answered_by) + ', ' + E(RAM.fmtTs(n.ts_utc)) + ', about ' + E(n.about) + '</span><br>' + E(n.text) + '</li>';
    }).join("") : '<li class="meta">Nothing sent yet.</li>';
  }
  function sendNote() {
    var t = document.getElementById("noteText"), s = document.getElementById("noteState"), b = document.getElementById("noteSend");
    if (!t.value.trim()) { s.className = "notestate bad"; s.textContent = "Type something first."; return; }
    b.disabled = true; s.className = "notestate"; s.textContent = "Sending";
    RAM.apiJSON("/plan/note", { method: "POST", json: { text: t.value, about: document.getElementById("noteAbout").value, answered_by: document.getElementById("noteWho").value } })
      .then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { s.className = "notestate bad"; s.textContent = (r && r.error) || "Not saved. Try again."; return; }
        t.value = ""; s.className = "notestate"; s.textContent = "Saved."; drawNotes(r.notes || []);
      })
      .catch(function () { b.disabled = false; s.className = "notestate bad"; s.textContent = "Not saved: no connection. Your text is still in the box."; });
  }

  function openDoc(name) {
    var w = window.open("", "_blank");
    if (w) { try { w.document.write("<p style='font-family:Calibri,Arial,sans-serif;padding:24px'>Loading...</p>"); } catch (e) { } }
    RAM.api("/plan/doc/" + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (html) {
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
      else {
        var u = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        location.href = u;
      }
    }).catch(function (e) {
      if (w) { try { w.document.body.innerHTML = "<p style='font-family:Calibri,Arial,sans-serif;padding:24px'>Could not open it: " + E(e.message) + "</p>"; } catch (x) { } }
    });
  }

  function heads() {
    var title = D.client_name + ", " + D.title;
    document.title = title;
    var built = "Updated " + D.built;
    document.getElementById("builtLine").textContent = built;
    document.getElementById("h1sub").hidden = false;
    document.getElementById("printHead").innerHTML = '<span><b>' + E(D.client_name) + '</b><br><span id="printWhat">' + E(D.title) + '</span></span><span>' + E(D.engagement) + '<br>' + E(built) + '</span>';
    document.getElementById("printFoot").innerHTML = '<span>Prepared by ' + E(D.consultant) + '. ' + E(D.source) + '</span>' + (D.logo ? '<img alt="" src="' + D.logo + '">' : '');
  }

  var PRINTS = ["print-agenda", "print-syllabus", "print-both", "print-week"];
  function doPrint(which) {
    var b = document.body, wk = TODAY ? weekOf(TODAY) : null;
    var lbl = { agenda: D.agenda.title, syllabus: D.syllabus.title, both: D.agenda.title + ", and " + D.syllabus.title,
      week: "This week" + (wk ? ": " + longDate(wk.sun) + " to " + longDate(wk.sat) : "") };
    if (cur) cancelEd();
    closeForm();
    PRINTS.forEach(function (c) { b.classList.remove(c); });
    b.classList.add("print-" + which);
    var pw = document.getElementById("printWhat"); if (pw) pw.textContent = lbl[which] || D.title;
    setTimeout(function () { window.print(); }, 50);
  }
  window.addEventListener("afterprint", function () { PRINTS.forEach(function (c) { document.body.classList.remove(c); }); });

  function setFold(id, open) {
    folds[id] = open;
    var f = document.getElementById("fold-" + id); if (!f) return;
    f.classList.toggle("open", open);
    var b = f.querySelector(".foldhead"); if (b) b.setAttribute("aria-expanded", open);
  }

  document.addEventListener("click", function (e) {
    var d = e.target.closest("[data-doc]"); if (d) { e.preventDefault(); openDoc(d.dataset.doc); return; }
    var p = e.target.closest("[data-print]"); if (p && D) { e.preventDefault(); doPrint(p.dataset.print); return; }
    if (!D) return;
    if (EDIT) {
      var fa = e.target.closest("[data-fact]"); if (fa && form) { if (fa.dataset.fact === "ok") submitForm(false); else closeForm(); return; }
      var mb = e.target.closest("[data-menu]"); if (mb) { toggleMenu(mb); return; }
      var pa = e.target.closest("[data-pact]"); if (pa) { doPanel(pa.dataset.pact, pa); return; }
      var va = e.target.closest("[data-vact]"); if (va) { doVersion(va.dataset.vact, va); return; }
      var ab = e.target.closest("[data-add]"); if (ab) { startAdd(ab); return; }
      var sp = e.target.closest(".ed"); if (sp) { e.preventDefault(); openEd(sp); return; }
    }
    var j = e.target.closest('a[href^="#fold-"]'); if (j) { setFold(j.getAttribute("href").slice(6), true); return; }
    var f = e.target.closest("[data-fold]");
    if (f) { setFold(f.dataset.fold, !f.parentNode.classList.contains("open")); return; }
    var w = e.target.closest("[data-who],[data-pick]"); if (w) { setWho(w.dataset.who || w.dataset.pick); return; }
    var a = e.target.closest("[data-act]"); if (!a) return;
    var name = a.dataset.act;
    if (name === "reload") { location.reload(); return; }
    if (name === "undo") { var u = justDone; justDone = ""; if (u) act(u, "uncheck", "", null); return; }
    if (name === "edundo") { if (undoRev) sendOps([{ op: "undo", version: undoRev }], null, "Undone"); return; }
    if (name === "edvers") {
      vers.open = !vers.open; vers.sure = 0; drawVersions();
      if (vers.open) { loadVersions(); var vb = document.getElementById("versions"); if (vb) vb.scrollIntoView({ block: "start" }); }
      return;
    }
    var el = a.closest(".item"); if (!el) return;
    var id = el.dataset.item;
    if (name === "savefb") {
      var ta = el.querySelector("textarea[data-fb]"), txt = ((ta && ta.value) || "").trim();
      if (!txt) { say(el, "Type something first.", true); if (ta) ta.focus(); return; }
      needWho(el, function () {
        a.disabled = true; say(el, "Saving");
        act(id, "note", txt, el, function () {
          drafts[id] = "";
          each('textarea[data-fb="' + id + '"]', function (o) { o.value = ""; o.classList.remove("has"); });
        }).then(function (ok) { a.disabled = false; if (ok) sayAll(id, "Saved"); });
      });
    }
  });
  document.addEventListener("keydown", function (e) {
    var t = e.target; if (!EDIT || !t.matches) return;
    if (cur && t === cur.ta) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEd(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEd(); }
      return;
    }
    if (form && form.el.contains(t) && t.matches(".edin")) {
      if (e.key === "Escape") { e.preventDefault(); closeForm(); return; }
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      var ins = Array.prototype.slice.call(form.el.querySelectorAll(".edin")), nx = ins[ins.indexOf(t) + 1];
      if (nx && !nx.value && t.value) nx.focus(); else submitForm(true);
      return;
    }
    if (t.matches(".ed") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openEd(t); }
  });
  /* A press on a form button must not be read as "the cursor left the form" (some phones do not focus buttons). */
  document.addEventListener("pointerdown", function (e) { if (form && e.target.closest && e.target.closest(".edform button")) form.hold = Date.now(); });
  document.addEventListener("focusout", function (e) {
    if (!EDIT) return;
    var t = e.target;
    setTimeout(function () {
      if (cur && t === cur.ta && document.activeElement !== t && document.hasFocus()) commitEd();
      else if (form && form.el.contains(t) && !form.el.contains(document.activeElement) && document.hasFocus() && Date.now() - form.hold > 600) {
        var v = formVals(form), any = Object.keys(v).some(function (k) { return v[k]; });
        if (any) submitForm(false); else closeForm();
      }
      settle();
    }, 0);
  });

  /* ---------------------------------------------------------------- staying current */
  function take(data) {
    D = data; M = data.marks || {}; TODAY = data.today || ""; TZ = data.tz || "";
    indexDoc(); indexItems();
  }
  function drawAll() {
    var y = window.pageYOffset;
    needDraw = false;
    heads(); renderAgenda(); renderWeek(); renderSyllabus(); drawAbout(); drawBar();
    window.scrollTo(0, y);
    if (afterDraw) { var f = afterDraw; afterDraw = null; f(); }
  }
  function show(data, first) {
    take(data);
    if (first) { initWho(); renderNotes(); }
    drawAll();
    if (first) drawWho();
  }
  /* news(r): the date has rolled over, or the plan was changed, since this page was drawn. Fetch it
     again and re-draw, unless something is being typed: then say so and try again at the next check. */
  var fetching = false;
  function news(r) {
    if (!r || !D || fetching) return;
    var moved = r.rev !== undefined && D.rev !== undefined ? r.rev !== D.rev : (r.built && r.built !== D.built);
    if (!((r.today && r.today !== TODAY) || moved)) return;
    if (busy()) {
      var n = document.getElementById("planNews");
      if (n) { n.innerHTML = 'The plan was changed on another screen. It shows here once what is typed is saved, or press <button type="button" class="btn" data-act="reload">Reload</button>'; n.hidden = false; }
      return;
    }
    fetching = true;
    var g = gen;
    RAM.apiJSON(q("/plan?shape=2")).then(function (data) {
      fetching = false;
      if (data && data.agenda && g === gen && !busy()) show(data, false);
    }).catch(function () { fetching = false; });
  }
  var polling = false, lastPoll = 0;
  function refresh() {
    if (!D || polling) return Promise.resolve(false);
    polling = true; lastPoll = Date.now();
    var g = gen;
    return RAM.apiJSON(q("/plan/marks?rows=0")).then(function (r) {
      polling = false;
      if (!r || !r.ok || g !== gen) return false;
      M = r.marks || {};
      sync(true);
      news(r);
      return true;
    }).catch(function () { polling = false; return false; });
  }
  function refreshSoon() { if (!document.hidden && Date.now() - lastPoll > 3000) refresh(); }

  RAM.gate(function () {
    document.getElementById("appSub").hidden = false;
    RAM.apiJSON(q("/plan?shape=2")).then(function (data) {
      if (!data || !data.agenda) throw new Error((data && data.error) || "no plan");
      show(data, true);
      if (location.hash) {
        if (location.hash.indexOf("#fold-") === 0) setFold(location.hash.slice(6), true);
        var t = document.querySelector(location.hash); if (t) t.scrollIntoView();
      }
      if (started) return;
      started = true;
      setInterval(function () { if (!document.hidden) refresh(); }, 30000);
      window.addEventListener("focus", refreshSoon);
      document.addEventListener("visibilitychange", refreshSoon);
    }).catch(function (e) {
      if (e.message !== "signed out") document.getElementById("agenda").innerHTML = '<p class="err2">Could not load the plan: ' + E(e.message) + '</p>';
    });
  });
  window.RAMPLAN = { print: function (w) { doPrint(w); }, refresh: refresh, rev: function () { return D ? D.rev : 0; } };
})();
