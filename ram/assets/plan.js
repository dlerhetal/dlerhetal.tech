/* Engagement plan page: agenda + syllabus, print buttons, talk-back.
   Generic shell: every word of content arrives from GET /plan after sign-in.
   Nothing in this file names a client, a person or an amount.

   Daily items: every agenda line that can be done carries an id (it comes with the content). A tick,
   a feedback note or a drop is POSTed to /plan/mark and kept on the server with the name and the
   time; the state of every item is a replay of that record. The page sorts the days around the
   server's "today": today first and open, later days under "Coming up", earlier days under
   "Earlier days". An item from an earlier day that is neither done nor dropped is shown again at
   the top of today as carried. It is the same item, so ticking it there finishes it. Nothing runs
   at night. The page asks the server for the state again every 30 seconds and when the tab regains
   focus; a poll never re-draws a feedback box, and a poll that started before a save is thrown away. */
(function () {
  "use strict";
  var E = RAM.esc, D = null;
  var STATUS = { done: "Done", started: "Started", not: "Not started" };
  var NSK = RAM.NS.slice(1), K_WHO = NSK + "_plan_who";
  var TESTQ = (RAM.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search)) ? "as=TEST" : "";
  var M = {};             // item id -> state replayed by the server (done, dropped, thread)
  var TODAY = "", TZ = "";
  var ITEMS = [], BYID = {};
  var who = "";           // the name ticks and feedback are saved under; "" until one is picked
  var drafts = {};        // item id -> feedback text typed but not saved yet
  var sure = {};          // item id -> true while its "Sure? Yes / No" is showing
  var folds = {};         // fold id -> open or shut, once the visitor has touched it
  var shownCarried = [];  // the ids in the carried block as last drawn
  var justDone = "";      // the carried item ticked a moment ago (offers Undo once)
  var pending = null;     // the action waiting for a name to be picked
  var gen = 0;            // bumped by every save: a poll that started before a save is thrown away
  var started = false;

  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }
  function q(path) { return path + (TESTQ ? (path.indexOf("?") >= 0 ? "&" : "?") + TESTQ : ""); }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  function linkHtml(l) {
    if (l.doc) return '<a href="#" class="doclink" target="_blank" rel="noopener" data-doc="' + E(l.doc) + '">' + E(l.label) + '</a>';
    return E(l.label) + ': <a href="' + E(l.url) + '" target="_blank" rel="noopener">' + E(l.url) + '</a>';
  }
  function list(items, cls) {
    if (!items || !items.length) return "";
    return '<ul' + (cls ? ' class="' + cls + '"' : '') + '>' + items.map(function (t) { return "<li>" + E(t) + "</li>"; }).join("") + "</ul>";
  }
  function flagHtml(key, tag) {
    var f = D.flags[key]; if (!f) return "";
    return '<div class="blk flag" data-flag="' + E(key) + '"><h3><span class="ftag">' + E(tag || "Flag") + '</span>' + E(f.title) + '</h3><p>' + E(f.text) + '</p></div>';
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
    return (it.when ? '<b class="iwhen">' + E(it.when) + '</b> ' : '') + E(it.text);
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
  function dropHtml(it) {
    if (!RAM.DALE_MODE) return "";
    var s = stOf(it.id);
    if (s.dropped) return '<button type="button" class="linkbtn2" data-act="undrop">Bring it back</button>';
    if (s.done) return "";
    if (sure[it.id]) return '<span class="surelbl">Sure?</span><button type="button" class="btn surebtn" data-act="dropyes">Yes</button><button type="button" class="btn surebtn" data-act="dropno">No</button>';
    return '<button type="button" class="linkbtn2" data-act="drop">Not doing this</button>';
  }
  /* mode: "today" (the day itself), "carried" (shown at the top of today), "past" (an earlier day) or
     "future" (read only: no ticking the future). */
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
    if (!ro) h += '<div class="idrop noprint" data-part="drop">' + dropHtml(it) + '</div><div class="iask noprint" data-part="ask"></div>';
    return h + '</div></div>';
  }
  function itemsHtml(its, mode) {
    return '<div class="items">' + its.map(function (x) { return itemHtml(BYID[x.id], mode); }).join("") + '</div>';
  }

  function blockHtml(b, mode) {
    var its = b.items || [];
    function of(kind) { return its.filter(function (x) { return x.kind === kind && BYID[x.id]; }); }
    var h = '<div class="blk agblk">';
    h += '<span class="timepill">' + E(b.time) + '</span><h3>' + E(b.title) + '</h3>';
    if (b.who) h += '<span class="bwho">Who: ' + E(b.who) + '</span>';
    if (b.goal) h += '<p class="goal"><b>Goal:</b> ' + E(b.goal) + '</p>';
    if (b.prereq && b.prereq.length) h += '<h4>Prerequisites</h4>' + list(b.prereq);
    if (b.bring && b.bring.length) h += '<h4>Bring</h4>' + list(b.bring);
    if (b.items) {
      if (of("block").length) h += itemsHtml(of("block"), mode);
      if (of("check").length) h += '<h4>Check each one</h4>' + itemsHtml(of("check"), mode);
      if (of("step").length) h += '<h4>Steps</h4>' + itemsHtml(of("step"), mode);
    } else {
      /* content built before the daily items existed: plain lines, nothing to tick */
      if (b.checks && b.checks.length) h += '<h4>Check each one</h4>' + list(b.checks, "checks");
      if (b.steps && b.steps.length) {
        h += '<table class="ptable"><thead><tr><th style="width:24%">When</th><th>What</th></tr></thead><tbody>' +
          b.steps.map(function (s) { return '<tr><td data-l="When"><b>' + E(s[0]) + '</b></td><td data-l="What">' + E(s[1]) + '</td></tr>'; }).join("") + '</tbody></table>';
      }
    }
    if (b.decisions && b.decisions.length) {
      h += '<table class="ptable"><thead><tr><th style="width:20%">Decision</th><th>Wizard\'s recommendation</th><th style="width:28%">Where it stands</th></tr></thead><tbody>' +
        b.decisions.map(function (s) { return '<tr><td data-l="Decision"><b>' + E(s[0]) + '</b></td><td data-l="Recommendation">' + E(s[1]) + '</td><td data-l="Stands">' + E(s[2]) + '</td></tr>'; }).join("") + '</tbody></table>';
    }
    if (b.ask && b.ask.length) h += '<h4>Only if there are two minutes at the end</h4>' + list(b.ask);
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
    if (day.intro) h += '<p class="lead">' + E(day.intro) + '</p>';
    (day.blocks || []).forEach(function (b) { h += blockHtml(b, mode); });
    (day.flags || []).forEach(function (k) { h += flagHtml(k, day.short); });
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
    var h = '<h2>' + E(a.title) + '</h2>';
    h += '<div class="whobar noprint" id="whoBar"></div><div class="plannews noprint" id="planNews" hidden></div>';
    h += '<div class="blk rulings"><h3>' + E(a.rulings_title || "Rulings for these days") + '</h3>' + list(a.rulings) + '</div>';
    h += '<div id="today">';
    if (todayDay) h += dayHead(todayDay, "today", "Today: ");
    else if (TODAY) h += '<p class="noday" id="noAgenda">No agenda has been written for today yet. Today is ' + E(longDate(TODAY)) + '.</p>';
    h += carriedHtml(ids, earlier.some(function (d) { return (d.blocks || []).some(function (b) { return (b.items || []).length; }); }));
    if (todayDay) h += dayBody(todayDay, "today");
    else if (earlier.length) h += '<p class="recentlbl">The most recent day</p>' + dayHead(earlier[0], "past", "") + dayBody(earlier[0], "past");
    h += '</div>';
    if (later.length) {
      h += foldHtml("coming", '<span class="foldt">Coming up</span><span class="foldn">' + later.length + (later.length === 1 ? " day" : " days") + ', read only</span>',
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

  /* After a poll, or a save that moved nothing: every item's box, state line, thread and drop control in
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
      setPart(el, "drop", dropHtml(it));
    });
    each("[data-daycount]", function (el) {
      var day = (D.agenda.days || []).filter(function (d) { return d.id === el.dataset.daycount; })[0];
      if (day) el.textContent = countLine(day, el.dataset.mode);
    });
    var cc = document.getElementById("carriedCount"); if (cc) cc.textContent = carriedCount(shownCarried);
  }
  /* busy(): something on screen would be lost or disturbed by a re-draw. */
  function busy() {
    if (pending) return true;
    for (var k in sure) if (sure[k]) return true;
    var ae = document.activeElement, tas = document.querySelectorAll("textarea[data-fb]");
    if (ae && ae.matches && ae.matches("textarea[data-fb]")) return true;
    for (var i = 0; i < tas.length; i++) if (tas[i].value.trim()) return true;
    return false;
  }
  /* sync(): put a new state on screen. The agenda is re-drawn only when the carried block gains or loses
     an item; a poll never does that while something is being typed (the next poll tries again). */
  function sync(fromPoll) {
    if (carriedIds().join(",") !== shownCarried.join(",") && !(fromPoll && busy())) renderAgenda();
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
    if (w.indexOf(pre) < 0 && RAM.DALE_MODE) pre = String(D.consultant || "").split(" ")[0];
    who = w.indexOf(pre) >= 0 ? pre : "";
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

  /* ---------------------------------------------------------------- saving */
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
  function drawDrop(id) {
    each('#agenda .item[data-item="' + id + '"]', function (el) { setPart(el, "drop", dropHtml(BYID[id])); });
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
    var ta = e.target; if (!ta.matches || !ta.matches("textarea[data-fb]")) return;
    var id = ta.dataset.fb; drafts[id] = ta.value;
    ta.classList.toggle("has", !!ta.value);
    each('textarea[data-fb="' + id + '"]', function (o) { if (o !== ta) { o.value = ta.value; o.classList.toggle("has", !!ta.value); } });
  });

  function renderSyllabus() {
    var s = D.syllabus, h = '<h2>' + E(s.title) + '</h2><p class="lead">' + E(s.intro) + '</p>';
    h += '<div class="counts"><span><b>' + s.total + '</b> deliverables in the signed VEP</span><span>' + st("done") + ' ' + s.counts.done + '</span><span>' + st("started") + ' ' + s.counts.started + '</span><span>' + st("not") + ' ' + s.counts.not + '</span></div>';
    if (s.vep_change) h += '<div class="blk"><h3>What changed at signing</h3><p>' + E(s.vep_change) + '</p></div>';
    if (s.math && s.math.length) h += '<div class="blk"><h3>The only dates on this page, and where they come from</h3>' + list(s.math) + '</div>';
    h += '<div class="blk"><h3>Calendar anchors</h3><table class="ptable cal"><thead><tr><th style="width:26%">Date</th><th>What</th></tr></thead><tbody>' +
      s.calendar.map(function (c) { return '<tr><td data-l="Date" class="k' + E(c.kind || "") + '"><b>' + E(c.date) + '</b></td><td data-l="What" class="k' + E(c.kind || "") + '">' + E(c.text) + '</td></tr>'; }).join("") + '</tbody></table></div>';
    s.phases.forEach(function (p, pi) {
      if (pi === 0) h += '<div class="keep"><h2 class="subh">The sequence: what must happen before what, and why</h2>';
      h += '<div class="blk phase"><div class="phasehead"><span class="phasen">Phase ' + p.n + '</span><h3>' + E(p.name) + '</h3></div>';
      h += '<p class="when"><b>When:</b> ' + E(p.when) + '</p><p class="why"><b>Why this order:</b> ' + E(p.why) + '</p>';
      h += '<table class="ptable"><thead><tr><th style="width:12%">ID</th><th style="width:22%">Deliverable</th><th style="width:12%">Status</th><th>The work</th><th style="width:30%">Needs first</th></tr></thead><tbody>' +
        p.items.map(function (i) { return '<tr><td data-l="ID" class="idc">' + E(i.id) + '</td><td data-l="Deliverable"><b>' + E(i.name) + '</b></td><td data-l="Status">' + st(i.status) + '</td><td data-l="Work">' + E(i.what) + '</td><td data-l="Needs">' + E(i.needs) + '</td></tr>'; }).join("") + '</tbody></table></div>';
      if (pi === 0) h += '</div>';
    });
    s.groups.forEach(function (g, gi) {
      if (gi === 0) h += '<div class="keep"><h2 class="subh">By SOFM: every deliverable, its status and the evidence</h2>';
      h += '<table class="ptable sofmtable"><thead><tr class="grow"><th colspan="6"><div class="grouphead"><h3>' + E(g.name) + ' <span class="sofm">(' + E(g.sofm) + ', ' + g.items.length + ')</span></h3><p class="lead">' + E(g.objective) + '</p></div></th></tr><tr><th style="width:11%">ID</th><th style="width:20%">Deliverable</th><th style="width:24%">What it is</th><th style="width:11%">Status</th><th>Evidence</th><th style="width:7%">Phase</th></tr></thead><tbody>' +
        g.items.map(function (i) { return '<tr data-del="' + E(i.id) + '"><td data-l="ID" class="idc">' + E(i.id) + '</td><td data-l="Deliverable"><b>' + E(i.name) + '</b></td><td data-l="What">' + E(i.desc) + '</td><td data-l="Status">' + st(i.status) + '</td><td data-l="Evidence">' + E(i.evidence) + '</td><td data-l="Phase">' + i.phase + '</td></tr>'; }).join("") + '</tbody></table>';
      if (gi === 0) h += '</div>';
    });
    h += '<div class="blk"><h3>Built so far outside the 27 rows</h3>' + list(s.outside) + '</div>';
    (D.flag_order || []).forEach(function (k, fi) {
      if (fi === 0) h += '<div class="keep"><h2 class="subh">Every flag</h2>';
      h += flagHtml(k, "Flag");
      if (fi === 0) h += '</div>';
    });
    document.getElementById("syllabus").innerHTML = h;
  }

  function renderNotes() {
    var who = (D.who || ["Dale"]).slice(); if (RAM.TEST_MODE) who.push("TEST");
    var abouts = ["General", "Thursday agenda", "Friday agenda", "Syllabus", "A flag"];
    var h = '<h2>Talk back</h2><div class="blk notesform"><p>' + E(D.notes_prompt || "") + '</p>' +
      '<div class="row"><div><label for="noteAbout">About</label><select id="noteAbout">' + abouts.map(function (a) { return "<option>" + E(a) + "</option>"; }).join("") + '</select></div>' +
      '<div><label for="noteWho">From</label><select id="noteWho">' + who.map(function (a) { return "<option>" + E(a) + "</option>"; }).join("") + '</select></div></div>' +
      '<label for="noteText">What should change, or how did it go?</label><textarea id="noteText"></textarea>' +
      '<p><button type="button" class="btn pri" id="noteSend">Send</button><span class="notestate" id="noteState"></span></p>' +
      '<ul class="notelist" id="noteList"></ul></div>';
    document.getElementById("notes").innerHTML = h;
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
        t.value = ""; s.className = "notestate"; s.textContent = "Saved for Dale and Claude."; drawNotes(r.notes || []);
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
    var j = e.target.closest('a[href^="#fold-"]'); if (j) { setFold(j.getAttribute("href").slice(6), true); return; }
    var f = e.target.closest("[data-fold]");
    if (f) { setFold(f.dataset.fold, !f.parentNode.classList.contains("open")); return; }
    var w = e.target.closest("[data-who],[data-pick]"); if (w) { setWho(w.dataset.who || w.dataset.pick); return; }
    var a = e.target.closest("[data-act]"); if (!a) return;
    var name = a.dataset.act;
    if (name === "reload") { location.reload(); return; }
    if (name === "undo") { var u = justDone; justDone = ""; if (u) act(u, "uncheck", "", null); return; }
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
    } else if (name === "drop") { sure[id] = true; drawDrop(id); }
    else if (name === "dropno") { sure[id] = false; drawDrop(id); }
    else if (name === "dropyes") { sure[id] = false; needWho(el, function () { act(id, "drop", "", el); }); }
    else if (name === "undrop") { needWho(el, function () { act(id, "undrop", "", el); }); }
  });

  /* ---------------------------------------------------------------- staying current */
  function show(data, first) {
    D = data; M = data.marks || {}; TODAY = data.today || ""; TZ = data.tz || "";
    indexItems();
    if (first) initWho();
    heads(); renderAgenda(); renderWeek(); renderSyllabus();
    if (first) { renderNotes(); drawWho(); }
  }
  /* news(r): the date has rolled over, or the content was rebuilt, since this page was drawn. Fetch it
     again and re-draw, unless something is being typed: then say so and let the visitor choose when. */
  var fetching = false;
  function news(r) {
    if (!r || !D || fetching) return;
    if (!((r.today && r.today !== TODAY) || (r.built && r.built !== D.built))) return;
    if (busy()) {
      var n = document.getElementById("planNews");
      if (n) { n.innerHTML = 'This page has changed since it was opened. Save what is typed, then <button type="button" class="btn" data-act="reload">Reload</button>'; n.hidden = false; }
      return;
    }
    fetching = true;
    var g = gen;
    RAM.apiJSON(q("/plan")).then(function (data) {
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
    RAM.apiJSON(q("/plan")).then(function (data) {
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
  window.RAMPLAN = { print: function (w) { doPrint(w); }, refresh: refresh };
})();
