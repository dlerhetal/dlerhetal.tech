/* Label cards page: a sheet of cells laid out at true size. Type in a cell, or fill the cells from a list, then print.
   Generic: nothing in this file names a client, a person or a part. The title, the help lines, the card size and the
   cards all arrive from the API after sign-in.

   The server holds the set as versions (append-only). A typed card is sent by itself about a second after the last
   key, or when the cursor leaves it. Each card shows its own state (a dotted mark = on its way, a green mark = saved,
   a red tag = NOT saved) and the line at the top never says "saved" for a request that failed. The name is typed
   once in the top bar (kept in this browser, inside try/catch). */
(function () {
  "use strict";
  var R = window.RAM;
  var NAME = (document.body.getAttribute("data-tool") || "labels").replace(/[^a-z0-9_-]/gi, "");
  var TEST = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search);
  var Q = TEST ? "?as=TEST" : "";
  var NSK = R.NS.slice(1);
  var WHO_KEY = NSK + "_" + NAME + "_who";
  var OTHER_WHO = ["checklist", "quickstart", "growth", "team", "plan"].map(function (n) { return NSK + "_" + n + "_who"; });
  var FONT = "Arial, Helvetica, sans-serif";
  var MM = 96 / 25.4, PT_PER_MM = 72 / 25.4;
  var B = null, SET = null, S = null, who = "";
  var local = [], server = [], cells = {};      /* cells[i] = {dirty, base, state, msg, timer, theirs} */
  var shown = 0, sending = false, retryTimer = null, lastSaved = "", lastError = "", needName = false;
  var panel = "", blanks = false, selIndex = -1, undo = null, notice = null;
  var fill = { text: "", format: "lines", file: "", mode: "append", preview: null, err: "", sure: false, busy: false, timer: null, seq: 0 };
  var sizeDraft = null, sizeErr = "", vers = null, versSure = 0;
  var canvas = document.createElement("canvas").getContext("2d");

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function btn(text, cls, fn) { var b = mk("button", "lbbtn" + (cls ? " " + cls : ""), text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function answer(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function readWho() { var v = load(WHO_KEY) || ""; for (var i = 0; !v && i < OTHER_WHO.length; i++) v = load(OTHER_WHO[i]) || ""; return v; }
  function squash(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function phone() { try { return window.matchMedia("(max-width: 700px)").matches; } catch (e) { return false; } }
  function per() { return S.columns * S.rows; }
  function card(i) { return local[i] || { main: "", second: "" }; }
  function isFilled(c) { return !!(c && (c.main || c.second)); }
  function same(a, b) { return squash(a && a.main) === squash(b && b.main) && squash(a && a.second) === squash(b && b.second); }
  function lastFilled() { for (var i = local.length - 1; i >= 0; i--) if (isFilled(local[i])) return i; return -1; }
  function countFilled() { var n = 0; local.forEach(function (c) { if (isFilled(c)) n++; }); return n; }
  function cellState(i) { return cells[i] || (cells[i] = { dirty: false, base: null, state: "", msg: "", timer: null, theirs: null }); }

  /* how many sheets to draw: what was asked for, what the cards need, and one more once the very last card is filled */
  function sheetsWanted() {
    var lf = lastFilled(), n = Math.max(SET.doc.sheets || 1, Math.ceil((lf + 1) / per()), 1);
    if (lf + 1 === n * per()) n += 1;
    return Math.min(n, (B.limits && B.limits.sheets) || 60);
  }

  /* ------------------------------------------------------------------ fitted type */
  function textWidth(text, weight) { canvas.font = weight + " 100px " + FONT; return canvas.measureText(text).width / 100; }   /* em */
  function fit(i) {
    var el = document.querySelector('.lbcell[data-i="' + i + '"]'); if (!el) return;
    var c = card(i), m = el.querySelector(".lbm"), s = el.querySelector(".lbs");
    var availW = (S.cardWidthMm - 2 * S.clearMm) * PT_PER_MM * 0.97, availH = (S.cardHeightMm - 2 * S.clearMm) * PT_PER_MM;
    var long = false, sPt = 0;
    if (c.second) {
      var floor2 = Math.min(S.minFontPt, S.secondFontPt);
      sPt = Math.min(S.secondFontPt, availW / Math.max(textWidth(c.second, 400), 0.01));
      if (sPt < floor2) { sPt = floor2; long = true; }
      s.style.fontSize = sPt.toFixed(2) + "pt";
    } else s.style.fontSize = S.secondFontPt + "pt";
    var mPt = Math.min(S.maxFontPt, (availH - sPt * 1.2) / 1.2);
    if (c.main) {
      mPt = Math.min(mPt, availW / Math.max(textWidth(c.main, 700), 0.01));
      if (mPt < S.minFontPt) { mPt = S.minFontPt; long = true; }
    }
    m.style.fontSize = Math.max(mPt, 1).toFixed(2) + "pt";
    el.classList.toggle("two", !!c.second);
    el.classList.toggle("long", long);
    paintCell(i);
  }
  function paintCell(i) {
    var el = document.querySelector('.lbcell[data-i="' + i + '"]'); if (!el) return;
    var st = cells[i] || {}, tag = el.querySelector(".lbtag");
    el.classList.toggle("pend", st.state === "pend");
    el.classList.toggle("ok", st.state === "ok");
    el.classList.toggle("err", st.state === "err");
    el.classList.toggle("conf", st.state === "conf");
    tag.textContent = st.state === "err" ? "Not saved" : st.state === "conf" ? "Changed" : el.classList.contains("long") ? "Too long" : "";
    el.title = st.state === "err" ? "Not saved: " + (st.msg || "") : el.classList.contains("long") ? "Too long to fit on the card, even at the smallest type. Shorten it." : "";
  }

  /* ------------------------------------------------------------------ the sheets */
  function geometry() {
    var gw = S.columns * S.cardWidthMm, gh = S.rows * S.cardHeightMm;
    return { gw: gw, gh: gh, left: (S.pageWidthMm - gw) / 2, top: (S.pageHeightMm - gh) / 2 };
  }
  function buildSheet(n) {
    var g = geometry(), p = per();
    var box = mk("div", "lbsheetbox"); box.setAttribute("data-s", n);
    box.appendChild(mk("div", "lbsheetlbl"));
    var sc = mk("div", "lbscale"), sh = mk("div", "lbsheet");
    sh.style.setProperty("--pw", S.pageWidthMm + "mm"); sh.style.setProperty("--ph", S.pageHeightMm + "mm");
    var ruler = mk("div", "lbruler"), line = mk("span", "lbline"), rt = mk("span", "lbrtext", (B.texts || {}).ruler || "");
    ruler.appendChild(line); ruler.appendChild(rt);
    if (g.top >= 8 && g.gw >= 50) { ruler.className = "lbruler h show"; ruler.style.left = g.left + "mm"; ruler.style.top = Math.max(4.5, g.top - 6) + "mm"; ruler.style.width = g.gw + "mm"; }
    else if (g.left >= 8 && g.gh >= 50) { ruler.className = "lbruler v show"; ruler.style.top = g.top + "mm"; ruler.style.left = Math.max(4.5, g.left - 6) + "mm"; ruler.style.height = g.gh + "mm"; }
    sh.appendChild(ruler);
    var grid = mk("div", "lbgrid"); grid.style.left = g.left + "mm"; grid.style.top = g.top + "mm"; grid.style.width = g.gw + "mm"; grid.style.height = g.gh + "mm";
    for (var k = 0; k < p; k++) {
      var i = n * p + k, r = Math.floor(k / S.columns), c = k % S.columns;
      var cell = mk("div", "lbcell"); cell.setAttribute("data-i", i);
      cell.style.left = (c * S.cardWidthMm) + "mm"; cell.style.top = (r * S.cardHeightMm) + "mm";
      cell.style.width = S.cardWidthMm + "mm"; cell.style.height = S.cardHeightMm + "mm"; cell.style.padding = S.clearMm + "mm";
      var m = mk("input", "lbm"), s = mk("input", "lbs");
      [m, s].forEach(function (inp) { inp.type = "text"; inp.maxLength = (B.limits && B.limits.line) || 80; inp.autocomplete = "off"; inp.spellcheck = false; inp.setAttribute("autocapitalize", "words"); });
      m.setAttribute("aria-label", "Card " + (i + 1) + ", main line"); s.setAttribute("aria-label", "Card " + (i + 1) + ", small second line");
      m.value = card(i).main; s.value = card(i).second;
      cell.appendChild(m); cell.appendChild(s); cell.appendChild(mk("span", "lbtag")); cell.appendChild(mk("span", "lbdot"));
      grid.appendChild(cell);
    }
    /* cut lines: one drawing per sheet, each line once, at exact multiples of the card size (a drawn line prints
       whatever the browser's background setting is, and can be thinner than a box border) */
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), x, y;
    svg.setAttribute("class", "lbcut"); svg.setAttribute("viewBox", "0 0 " + g.gw + " " + g.gh); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
    function cut(x1, y1, x2, y2) { var l = document.createElementNS(NS, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); svg.appendChild(l); }
    for (x = 0; x <= S.columns; x++) cut(x * S.cardWidthMm, 0, x * S.cardWidthMm, g.gh);
    for (y = 0; y <= S.rows; y++) cut(0, y * S.cardHeightMm, g.gw, y * S.cardHeightMm);
    grid.appendChild(svg);
    sh.appendChild(grid); sc.appendChild(sh); box.appendChild(sc);
    return box;
  }
  function labelSheets() {
    var boxes = document.querySelectorAll(".lbsheetbox"), p = per();
    Array.prototype.forEach.call(boxes, function (b, n) {
      b.querySelector(".lbsheetlbl").textContent = "Sheet " + (n + 1) + " of " + boxes.length + ": cards " + (n * p + 1) + " to " + ((n + 1) * p);
    });
    var rm = $("lbRemove"); if (rm) rm.hidden = !(shown > 1 && (SET.doc.sheets || 1) > Math.max(1, Math.ceil((lastFilled() + 1) / p)) && SET.doc.sheets === shown);
  }
  function scaleSheets() {
    var host = $("lbSheets"); if (!host) return;
    var w = S.pageWidthMm * MM, h = S.pageHeightMm * MM, k = Math.min(1, host.clientWidth / w);
    Array.prototype.forEach.call(host.querySelectorAll(".lbscale"), function (sc) {
      sc.style.width = (w * k) + "px"; sc.style.height = (h * k) + "px";
      sc.firstChild.style.transform = k < 1 ? "scale(" + k + ")" : "none";
    });
    document.body.classList.toggle("lbphone", phone());
  }
  /* add or drop sheets at the end without touching the ones already drawn, so a cursor stays where it is */
  function syncSheets() {
    var host = $("lbSheets"), want = sheetsWanted();
    while (shown < want) { host.appendChild(buildSheet(shown)); for (var i = shown * per(); i < (shown + 1) * per(); i++) fit(i); shown++; }
    while (shown > want) { host.removeChild(host.lastChild); shown--; }
    labelSheets(); scaleSheets();
  }
  function drawAll() {
    var host = $("lbSheets"); host.innerHTML = ""; shown = 0;
    var st = $("lbPage"); st.textContent = "@page { size: " + S.pageWidthMm + "mm " + S.pageHeightMm + "mm; margin: 0; }";
    syncSheets();
  }
  /* put a card's words on the screen without disturbing a box that is being typed in */
  function showCard(i) {
    var el = document.querySelector('.lbcell[data-i="' + i + '"]'); if (!el) return;
    var m = el.querySelector(".lbm"), s = el.querySelector(".lbs"), c = card(i);
    if (m.value !== c.main && !(document.activeElement === m && cellState(i).dirty)) m.value = c.main;
    if (s.value !== c.second && !(document.activeElement === s && cellState(i).dirty)) s.value = c.second;
    fit(i);
  }

  /* ------------------------------------------------------------------ taking a version from the server */
  function takeSet(set) {
    var oldS = S ? JSON.stringify(S) : "";
    SET = set; S = set.doc.settings; server = set.doc.cards.map(function (c) { return { main: c.main || "", second: c.second || "" }; });
    var n = Math.max(server.length, local.length), next = [];
    for (var i = 0; i < n; i++) {
      var st = cells[i];
      next[i] = (st && (st.dirty || st.state === "conf")) ? card(i) : (server[i] || { main: "", second: "" });
    }
    local = next;
    if (!$("lbSheets")) return;
    if (oldS !== JSON.stringify(S)) drawAll();
    else { syncSheets(); for (var j = 0; j < shown * per(); j++) showCard(j); }
    status(); drawChanged();
  }

  /* ------------------------------------------------------------------ typing and saving */
  function setLocal(i, main, second) {
    var st = cellState(i), before = card(i);
    if (!st.dirty) st.base = { main: (server[i] || {}).main || "", second: (server[i] || {}).second || "" };
    while (local.length <= i) local.push({ main: "", second: "" });
    local[i] = { main: main, second: second };
    if (same(local[i], st.base) && st.state !== "conf") { st.dirty = false; st.state = ""; }
    else { st.dirty = true; if (st.state !== "conf") st.state = "pend"; }
    clearTimeout(st.timer);
    if (st.dirty && st.state !== "conf") st.timer = setTimeout(flush, 900);
    fit(i);
    if (isFilled(before) !== isFilled(local[i])) syncSheets();
    status();
  }
  function dirtyList() { var out = []; Object.keys(cells).forEach(function (k) { if (cells[k].dirty && cells[k].state !== "conf") out.push(+k); }); return out.sort(function (a, b) { return a - b; }); }
  function flush() {
    if (sending) return Promise.resolve();
    var list = dirtyList().slice(0, 60);
    if (!list.length) { status(); return Promise.resolve(); }
    if (!who) { needName = true; status(); return Promise.resolve(); }
    needName = false; sending = true; clearTimeout(retryTimer);
    var sent = {}, ops = list.map(function (i) {
      var c = { main: squash(card(i).main), second: squash(card(i).second) }; sent[i] = c;
      return { op: "cell", index: i, main: c.main, second: c.second, was: cells[i].base };
    });
    status();
    return R.api("/" + NAME + "/save", { method: "POST", json: { saved_by: who, base: SET.ver, ops: ops } }).then(answer).then(function (x) {
      sending = false;
      if (x.s === 200 && x.j.ok) {
        list.forEach(function (i) {
          var st = cells[i];
          if (same(card(i), sent[i])) { st.dirty = false; st.state = "ok"; st.base = null; (function (st, i) { setTimeout(function () { if (st.state === "ok") { st.state = ""; paintCell(i); } }, 2500); })(st, i); }
          else st.base = sent[i];
        });
        lastSaved = clock(); lastError = "";
        takeSet(x.j.set);
        if (dirtyList().length) flush();
        return;
      }
      if (x.s === 409 && typeof x.j.index === "number") {
        var st = cellState(x.j.index); st.state = "conf"; st.theirs = x.j.current; paintCell(x.j.index);
        if (x.j.set) takeSet(x.j.set);
        status(); if (dirtyList().length) flush();
        return;
      }
      if (x.s === 403) { needName = true; status(); return; }
      failSave(list, (x.j && x.j.error) || ("the server answered " + x.s), x.s >= 500);
    }).catch(function (e) {
      sending = false;
      if (e && e.message === "signed out") { failSave(list, "signed out; sign in again and the cards will be sent", false); return; }
      failSave(list, "no connection", true);
    });
  }
  function failSave(list, why, again) {
    list.forEach(function (i) { cells[i].state = "err"; cells[i].msg = why; paintCell(i); });
    lastError = why; status();
    clearTimeout(retryTimer);
    if (again) retryTimer = setTimeout(flush, 5000);
  }
  function resolve(i, keepMine) {
    var st = cellState(i);
    if (keepMine) { st.base = st.theirs; st.state = "pend"; st.dirty = true; st.theirs = null; paintCell(i); flush(); }
    else { local[i] = { main: st.theirs.main, second: st.theirs.second }; st.dirty = false; st.state = ""; st.theirs = null; showCard(i); }
    status();
  }
  function status() {
    var el = $("lbStatus"); if (!el) return;
    el.innerHTML = "";
    var dirty = dirtyList(), bad = dirty.filter(function (i) { return cells[i].state === "err"; });
    var conf = Object.keys(cells).filter(function (k) { return cells[k].state === "conf"; }).map(Number);
    var wi = $("lbWho"); if (wi) wi.classList.toggle("need", needName && !who);
    if (needName && !who && dirty.length) { el.className = "lbstatus bad"; el.textContent = "NOT saved yet: type your name at the top. " + plural(dirty.length, "card") + " waiting."; }
    else if (bad.length) {
      el.className = "lbstatus bad"; el.appendChild(document.createTextNode("NOT saved: " + plural(bad.length, "card") + " (" + lastError + "). The words are still on this screen."));
      var b = mk("button", "", "Try again"); b.type = "button"; b.addEventListener("click", function () { flush(); }); el.appendChild(b);
    }
    else if (sending || dirty.length) { el.className = "lbstatus wait"; el.textContent = "Saving " + plural(dirty.length, "card") + "..."; }
    else { el.className = "lbstatus good"; el.textContent = lastSaved ? "All cards saved, " + lastSaved : (SET.ver ? "All cards saved" : "Nothing typed yet"); }
    var cb = $("lbConf"); cb.innerHTML = "";
    conf.forEach(function (i) {
      var p = mk("p", "lbnote bad", "Card " + (i + 1) + " was changed by someone else while you typed. Theirs: \"" + cells[i].theirs.main + (cells[i].theirs.second ? " | " + cells[i].theirs.second : "") + "\". Yours: \"" + card(i).main + (card(i).second ? " | " + card(i).second : "") + "\".");
      var a = mk("button", "", "Keep mine"), t = mk("button", "", "Take theirs"); a.type = t.type = "button";
      a.addEventListener("click", function () { resolve(i, true); }); t.addEventListener("click", function () { resolve(i, false); });
      p.appendChild(a); p.appendChild(t); cb.appendChild(p);
    });
    var lg = document.querySelectorAll(".lbcell.long").length, ln = $("lbLong");
    ln.hidden = !lg; ln.textContent = lg ? plural(lg, "card") + " marked \"Too long\": the words do not fit even at the smallest type and will be cut off in print. Shorten them." : "";
  }
  function drawChanged() {
    var el = $("lbChanged"); if (!el) return;
    el.textContent = SET.ver ? "Last change: " + SET.by + ", " + R.fmtTs(SET.ts) + ". " + plural(countFilled(), "card") + " filled." : "";
  }

  /* ------------------------------------------------------------------ keys */
  function focusCard(i, second) {
    if (i < 0) return;
    if (i >= shown * per()) return;
    var el = document.querySelector('.lbcell[data-i="' + i + '"]'); if (!el) return;
    if (second) el.classList.add("open");
    var t = el.querySelector(second ? ".lbs" : ".lbm"); t.focus(); try { t.select(); } catch (e) { }
  }
  function wire(host) {
    host.addEventListener("input", function (e) {
      var cell = e.target.closest && e.target.closest(".lbcell"); if (!cell) return;
      setLocal(+cell.getAttribute("data-i"), cell.querySelector(".lbm").value, cell.querySelector(".lbs").value);
    });
    host.addEventListener("keydown", function (e) {
      var cell = e.target.closest && e.target.closest(".lbcell"); if (!cell) return;
      var i = +cell.getAttribute("data-i"), inSecond = e.target.classList.contains("lbs");
      if (e.key === "Enter") { e.preventDefault(); if (inSecond) focusCard(i + 1, false); else focusCard(i, true); }
      else if (e.key === "Tab") {
        if (e.shiftKey) { if (inSecond) { e.preventDefault(); focusCard(i, false); } else if (i > 0) { e.preventDefault(); focusCard(i - 1, false); } }
        else if (i + 1 < shown * per()) { e.preventDefault(); focusCard(i + 1, false); }
      }
      else if (e.key === "ArrowDown" && !inSecond && card(i).second) { e.preventDefault(); focusCard(i, true); }
      else if (e.key === "ArrowUp" && inSecond) { e.preventDefault(); focusCard(i, false); }
    });
    host.addEventListener("focusout", function (e) {
      var cell = e.target.closest && e.target.closest(".lbcell"); if (!cell) return;
      var i = +cell.getAttribute("data-i");
      setTimeout(function () {
        if (!cell.contains(document.activeElement)) {
          cell.classList.remove("open");
          var c = card(i), m = squash(c.main), s = squash(c.second);
          if (m !== c.main || s !== c.second) { setLocal(i, m, s); showCard(i); }
          if (cells[i] && cells[i].dirty) { clearTimeout(cells[i].timer); flush(); }
        }
      }, 0);
    });
    host.addEventListener("click", function (e) {
      var cell = e.target.closest && e.target.closest(".lbcell"); if (!cell) return;
      var i = +cell.getAttribute("data-i");
      if (document.body.classList.contains("lbphone")) { openEdit(i); return; }
      if (e.target.tagName !== "INPUT") cell.querySelector(".lbm").focus();
    });
  }

  /* ------------------------------------------------------------------ the bottom editor (narrow screens) */
  function openEdit(i) {
    closeEdit(true);
    selIndex = i;
    var el = document.querySelector('.lbcell[data-i="' + i + '"]'); if (!el) return;
    el.classList.add("sel");
    var bar = mk("div", "lbedit noprint"); bar.id = "lbEdit";
    bar.appendChild(mk("p", "lbewhich", "Card " + (i + 1) + ", sheet " + (Math.floor(i / per()) + 1)));
    var m = mk("input"), s = mk("input");
    m.id = "lbEditMain"; s.id = "lbEditSecond"; m.type = s.type = "text"; m.maxLength = s.maxLength = (B.limits && B.limits.line) || 80;
    m.placeholder = "Main line"; s.placeholder = "Small second line (size or part number)";
    m.value = card(i).main; s.value = card(i).second; m.autocomplete = s.autocomplete = "off";
    function push() { setLocal(i, m.value, s.value); var mi = el.querySelector(".lbm"), si = el.querySelector(".lbs"); mi.value = m.value; si.value = s.value; }
    m.addEventListener("input", push); s.addEventListener("input", push);
    m.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); s.focus(); } });
    s.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); step(1); } });
    function step(d) { var n = i + d; if (n < 0) return; syncSheets(); if (n >= shown * per()) { closeEdit(); return; } openEdit(n); }
    var row = mk("div", "lbrow");
    row.appendChild(btn("Back", "", function () { step(-1); }));
    row.appendChild(btn("Next card", "pri", function () { step(1); }));
    row.appendChild(btn("Done", "", function () { closeEdit(); }));
    bar.appendChild(m); bar.appendChild(s); bar.appendChild(row);
    document.body.appendChild(bar);
    m.focus();
    try { el.scrollIntoView({ block: "center" }); } catch (e) { }
  }
  function closeEdit(quiet) {
    var bar = $("lbEdit"); if (bar) bar.parentNode.removeChild(bar);
    if (selIndex >= 0) {
      var el = document.querySelector('.lbcell[data-i="' + selIndex + '"]'); if (el) el.classList.remove("sel");
      var c = card(selIndex); if (squash(c.main) !== c.main || squash(c.second) !== c.second) { setLocal(selIndex, squash(c.main), squash(c.second)); showCard(selIndex); }
      if (cells[selIndex] && cells[selIndex].dirty) { clearTimeout(cells[selIndex].timer); flush(); }
    }
    selIndex = -1;
  }

  /* ------------------------------------------------------------------ whole-set changes */
  function post(path, body) { return R.api("/" + NAME + path, { method: "POST", json: body }).then(answer); }
  function settle() { return dirtyList().length ? flush() : Promise.resolve(); }
  function note(text, cls, undoVer) { notice = text ? { text: text, cls: cls || "", undo: undoVer || 0 } : null; drawNotice(); }
  function drawNotice() {
    var el = $("lbNotice"); if (!el) return; el.innerHTML = ""; el.hidden = !notice; if (!notice) return;
    el.className = "lbnote " + notice.cls; el.appendChild(document.createTextNode(notice.text));
    if (notice.undo) { var b = mk("button", "", "Bring back the set from before"); b.type = "button"; b.addEventListener("click", function () { restore(notice.undo); }); el.appendChild(b); }
  }
  function saveOps(ops, done) {
    if (!who) { needName = true; status(); note("Type your name at the top first.", "bad"); var w = $("lbWho"); if (w) w.focus(); return Promise.resolve(false); }
    return settle().then(function () { return post("/save", { saved_by: who, base: SET.ver, ops: ops }); }).then(function (x) {
      if (x.s === 200 && x.j.ok) { lastSaved = clock(); cells = {}; local = []; takeSet(x.j.set); if (done) done(x.j); return true; }
      note("NOT saved: " + ((x.j && x.j.error) || ("the server answered " + x.s)), "bad"); return false;
    }).catch(function () { note("NOT saved: no connection. Nothing was changed.", "bad"); return false; });
  }
  function restore(ver) {
    if (!who) { needName = true; status(); note("Type your name at the top first.", "bad"); return; }
    post("/restore", { saved_by: who, version: ver, base: SET.ver }).then(function (x) {
      if (x.s === 200 && x.j.ok) { lastSaved = clock(); cells = {}; local = []; takeSet(x.j.set); vers = null; versSure = 0; note("Brought back. " + plural(countFilled(), "card") + " on the sheet.", "good"); drawPanel(); }
      else note("NOT brought back: " + ((x.j && x.j.error) || x.s), "bad");
    }).catch(function () { note("NOT brought back: no connection.", "bad"); });
  }

  /* ------------------------------------------------------------------ panels */
  function togglePanel(p) { panel = panel === p ? "" : p; if (panel === "size") { sizeDraft = null; sizeErr = ""; } if (panel === "vers") { vers = null; versSure = 0; loadVers(); } drawPanel(); }
  function drawPanel() {
    ["fill", "size", "vers"].forEach(function (p) { var b = $("lbBtn_" + p); if (b) b.classList.toggle("on", panel === p); });
    var host = $("lbPanel"); host.innerHTML = ""; host.hidden = !panel;
    if (panel === "fill") drawFill(host); else if (panel === "size") drawSize(host); else if (panel === "vers") drawVers(host);
  }
  function drawFill(host) {
    host.appendChild(mk("h2", "", "Fill from a list"));
    var p = mk("p", "lbhint"); p.innerHTML = "One card per line. For a small second line, add <code> | </code> and the words. For copies, start the line with a number and x: <code>3x </code>. Or pick a .txt or .csv file (first column the main line, second column the small line).";
    host.appendChild(p);
    var ta = mk("textarea"); ta.id = "lbFillText"; ta.value = fill.text; ta.setAttribute("aria-label", "The list, one card per line"); ta.spellcheck = false;
    ta.addEventListener("input", function () { fill.text = ta.value; fill.sure = false; if (!fill.text.trim()) { fill.format = "lines"; fill.file = ""; } askPreview(); });
    host.appendChild(ta);
    var row = mk("div", "lbrow"), f = mk("input"); f.type = "file"; f.id = "lbFillFile"; f.accept = ".txt,.csv,text/plain,text/csv";
    f.addEventListener("change", function () {
      var file = f.files && f.files[0]; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () { fill.text = String(rd.result || ""); fill.format = /\.csv$/i.test(file.name) ? "csv" : "lines"; fill.file = file.name; fill.sure = false; drawPanel(); askPreview(true); };
      rd.onerror = function () { fill.err = "That file could not be read."; drawPanel(); };
      rd.readAsText(file);
    });
    row.appendChild(f);
    if (fill.file) row.appendChild(mk("span", "lbhint", "From the file " + fill.file + (fill.format === "csv" ? " (columns)" : "")));
    host.appendChild(row);
    var out = mk("div"); out.id = "lbFillOut"; host.appendChild(out);
    drawFillOut();
  }
  function drawFillOut() {
    var out = $("lbFillOut"); if (!out) return; out.innerHTML = "";
    if (fill.err) { out.appendChild(mk("p", "lbnote bad", fill.err)); return; }
    var pv = fill.preview; if (!pv) { if (fill.text.trim()) out.appendChild(mk("p", "lbhint", "Counting...")); return; }
    var has = pv.existing > 0; if (!has) fill.mode = "append";
    var m = pv[fill.mode] || {};
    var cnt = mk("p", "lbcount", m.error ? m.error : plural(pv.cards, "card") + ", " + plural(m.sheets, "sheet")); cnt.id = "lbFillCount"; out.appendChild(cnt);
    var bits = [plural(pv.lines, "line") + " read"];
    if (has && !m.error) bits.push(fill.mode === "append" ? "starting at card " + m.startAt + ", after the " + pv.existing + " already here" : "the " + pv.existing + " cards here now are replaced");
    if (pv.first && pv.first.length) bits.push("first: " + pv.first.map(function (c) { return c.main + (c.second ? " | " + c.second : ""); }).join("; "));
    out.appendChild(mk("p", "lbhint", bits.join(". ") + "."));
    if (has) {
      var row = mk("div", "lbrow");
      [["append", "Add after the last filled card"], ["replace", "Replace everything"]].forEach(function (o) {
        var l = mk("label", "lbcheck"), r = mk("input"); r.type = "radio"; r.name = "lbmode"; r.value = o[0]; r.checked = fill.mode === o[0];
        r.addEventListener("change", function () { fill.mode = o[0]; fill.sure = false; drawFillOut(); });
        l.appendChild(r); l.appendChild(document.createTextNode(o[1])); row.appendChild(l);
      });
      out.appendChild(row);
    }
    var act = mk("div", "lbrow");
    if (fill.sure) {
      act.appendChild(mk("span", "lbnote bad", "Replace all " + plural(pv.existing, "card") + " now on the sheet? The set as it is now stays under Earlier versions."));
      var y = btn("Yes, replace", "warn", function () { applyFill(); }); y.id = "lbFillYes"; act.appendChild(y);
      act.appendChild(btn("No", "", function () { fill.sure = false; drawFillOut(); }));
    } else {
      var go = btn(fill.busy ? "Working..." : "Put them on the sheet", "pri", function () { if (fill.mode === "replace" && has) { fill.sure = true; drawFillOut(); } else applyFill(); });
      go.id = "lbFillGo"; go.disabled = fill.busy || !!m.error; act.appendChild(go);
    }
    out.appendChild(act);
  }
  function askPreview(now) {
    clearTimeout(fill.timer); fill.preview = null; fill.err = "";
    if (!fill.text.trim()) { drawFillOut(); return; }
    drawFillOut();
    fill.timer = setTimeout(function () {
      var seq = ++fill.seq;
      post("/preview" + Q, { text: fill.text, format: fill.format }).then(function (x) {
        if (seq !== fill.seq) return;
        if (x.s === 200 && x.j.ok) fill.preview = x.j; else fill.err = (x.j && x.j.error) || ("The list could not be checked (" + x.s + ").");
        drawFillOut();
      }).catch(function () { if (seq === fill.seq) { fill.err = "The list could not be checked: no connection."; drawFillOut(); } });
    }, now ? 0 : 400);
  }
  function applyFill() {
    var mode = fill.mode, n = fill.preview ? fill.preview.cards : 0;
    fill.busy = true; fill.sure = false; drawFillOut();
    saveOps([{ op: "fill", mode: mode, text: fill.text, format: fill.format }], function (j) {
      fill.text = ""; fill.preview = null; fill.file = ""; fill.format = "lines"; fill.mode = "append"; panel = "";
      note((mode === "replace" ? "Replaced everything: " : "Added: ") + plural(n, "card") + ". Now " + plural(countFilled(), "card") + " on " + plural(shown, "sheet") + ".", "good", mode === "replace" ? j.was : 0);
    }).then(function () { fill.busy = false; drawPanel(); });
  }

  function fitsOf(d) {
    return { c: Math.max(0, Math.floor((d.pageWidthMm - 2 * d.marginMm + 1e-6) / d.cardWidthMm)), r: Math.max(0, Math.floor((d.pageHeightMm - 2 * d.marginMm + 1e-6) / d.cardHeightMm)) };
  }
  function drawSize(host) {
    if (!sizeDraft) sizeDraft = JSON.parse(JSON.stringify(S));
    var d = sizeDraft;
    host.appendChild(mk("h2", "", "Card size"));
    host.appendChild(mk("p", "lbhint", "For a different bin, measure its slot and type the size here. The sheet is laid out again and the cards keep their order."));
    var grid = mk("div", "lbfields");
    [["cardWidthMm", "Card width, mm", true], ["cardHeightMm", "Card height, mm", true], ["columns", "Cards across", false], ["rows", "Cards down", false],
     ["marginMm", "Smallest paper edge, mm", true], ["clearMm", "Clear inside each edge, mm", false]].forEach(function (f) {
      var l = mk("label", "", f[1]), inp = mk("input"); inp.type = "number"; inp.step = "any"; inp.min = "0"; inp.value = d[f[0]]; inp.id = "lbSz_" + f[0]; inp.inputMode = "decimal";
      inp.addEventListener("change", function () {
        var v = parseFloat(inp.value); if (isNaN(v)) return;
        d[f[0]] = v; sizeErr = "";
        if (f[2]) { var q = fitsOf(d); if (q.c >= 1 && q.r >= 1) { d.columns = q.c; d.rows = q.r; } }
        drawPanel();
      });
      l.appendChild(inp); grid.appendChild(l);
    });
    host.appendChild(grid);
    var q = fitsOf(d), ok = q.c >= 1 && q.r >= 1 && d.columns <= q.c && d.rows <= q.r && d.columns >= 1 && d.rows >= 1;
    var line = mk("p", "lbcount", q.c >= 1 && q.r >= 1 ? "Up to " + q.c + " across and " + q.r + " down fit on the paper. This layout: " + d.columns + " x " + d.rows + " = " + plural(d.columns * d.rows, "card") + " a sheet." : "A card that size does not fit on the paper.");
    line.id = "lbSzLine"; host.appendChild(line);
    if (sizeErr) host.appendChild(mk("p", "lbnote bad", sizeErr));
    var row = mk("div", "lbrow");
    var sv = btn("Save this size", "pri", function () {
      var vals = {}; ["cardWidthMm", "cardHeightMm", "columns", "rows", "marginMm", "clearMm"].forEach(function (k) { vals[k] = d[k]; });
      sizeErr = "";
      saveOps([{ op: "settings", values: vals }], function () { panel = ""; sizeDraft = null; note("Card size saved: " + S.cardWidthMm + " x " + S.cardHeightMm + " mm, " + plural(per(), "card") + " a sheet.", "good"); }).then(function (okSaved) { if (!okSaved && notice) { sizeErr = notice.text; note(""); } drawPanel(); });
    });
    sv.id = "lbSzSave"; sv.disabled = !ok; row.appendChild(sv);
    row.appendChild(btn("Back to the standard size", "", function () { var k; for (k in B.defaults) d[k] = B.defaults[k]; sizeErr = ""; drawPanel(); }));
    host.appendChild(row);
  }

  function loadVers() {
    R.api("/" + NAME + "/versions" + Q).then(answer).then(function (x) { vers = x.s === 200 ? x.j.versions : []; if (panel === "vers") drawPanel(); }).catch(function () { vers = []; if (panel === "vers") drawPanel(); });
  }
  function drawVers(host) {
    host.appendChild(mk("h2", "", "Earlier versions"));
    host.appendChild(mk("p", "lbhint", "Every change is kept, with who and when. Bringing one back makes it the newest; nothing is deleted."));
    if (!vers) { host.appendChild(mk("p", "lbhint", "Loading...")); return; }
    if (!vers.length) { host.appendChild(mk("p", "lbhint", "Nothing has been saved yet.")); return; }
    /* a run of typed cards by one person shows as one line (its newest state) */
    var rows = [];
    vers.forEach(function (v) {
      var lastRow = rows[rows.length - 1];
      if (lastRow && v.kind === "cell" && lastRow.kind === "cell" && lastRow.saved_by === v.saved_by) { lastRow.n++; lastRow.from = v.ts_utc; }
      else rows.push({ id: v.id, kind: v.kind, saved_by: v.saved_by, ts_utc: v.ts_utc, from: v.ts_utc, summary: v.summary, filled: v.filled, n: 1 });
    });
    var ul = mk("ul", "lbvers");
    rows.slice(0, 60).forEach(function (v) {
      var li = mk("li"); li.setAttribute("data-ver", v.id);
      li.appendChild(mk("span", "when", R.fmtTs(v.ts_utc)));
      li.appendChild(mk("span", "what", v.saved_by + ": " + (v.n > 1 ? "typed cards (" + v.n + " saves)" : v.summary) + " [" + plural(v.filled, "card") + "]"));
      if (v.id === SET.ver) li.appendChild(mk("span", "now", "On the sheet now"));
      else if (versSure === v.id) {
        li.appendChild(mk("span", "lbnote bad", "Bring this one back?"));
        var y = btn("Yes", "warn", function () { restore(v.id); }); y.setAttribute("data-yes", v.id); li.appendChild(y);
        li.appendChild(btn("No", "", function () { versSure = 0; drawPanel(); }));
      } else { var b = btn("Bring back", "", function () { versSure = v.id; drawPanel(); }); b.setAttribute("data-back", v.id); li.appendChild(b); }
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  /* ------------------------------------------------------------------ print */
  function prepPrint() {
    var boxes = document.querySelectorAll(".lbsheetbox"), p = per(), first = null, lastBox = null, n = 0;
    Array.prototype.forEach.call(boxes, function (b, s) {
      var any = false; for (var i = s * p; i < (s + 1) * p; i++) if (isFilled(local[i])) { any = true; break; }
      var on = any || blanks;
      b.classList.toggle("skip", !on); b.classList.remove("first"); b.classList.remove("last");
      if (on) { n++; if (!first) first = b; lastBox = b; }
    });
    if (first) first.classList.add("first");
    if (lastBox) lastBox.classList.add("last");
    return n;
  }
  function doPrint() {
    closeEdit();
    var n = prepPrint();
    if (!n) { note("Nothing to print yet: no card has words on it. To print empty cards for hand-writing, tick \"Print blank sheets too\".", "bad"); return; }
    window.print();
  }

  /* ------------------------------------------------------------------ the page */
  function build() {
    var app = $("app"); app.innerHTML = "";
    var style = mk("style"); style.id = "lbPage"; document.head.appendChild(style);
    var top = mk("header", "lbtop noprint"); top.appendChild(mk("h1", "", B.title || "Working page"));
    var links = mk("div", "lblinks"), a = mk("a", "", "All tools"); a.href = "../"; links.appendChild(a);
    var so = mk("a", "", "Sign out"); so.href = "#"; so.setAttribute("data-action", "signout"); links.appendChild(so);
    top.appendChild(links); app.appendChild(top);
    var wrap = mk("div", "lbmainwrap"); app.appendChild(wrap);
    if (TEST) wrap.appendChild(mk("p", "lbtest noprint", "TEST line. Nothing typed here shows on the real page."));
    var bar = mk("div", "lbbar noprint");
    var r1 = mk("div", "lbrow"), wl = mk("label", "lbwho", "Your name "), wi = mk("input"); wi.id = "lbWho"; wi.type = "text"; wi.maxLength = 40; wi.value = who; wi.autocomplete = "off"; wi.disabled = TEST;
    wi.addEventListener("change", function () { who = squash(wi.value); wi.value = who; store(WHO_KEY, who || null); if (who) { needName = false; flush(); } status(); });
    wl.appendChild(wi); r1.appendChild(wl);
    var st = mk("div", "lbstatus"); st.id = "lbStatus"; st.setAttribute("aria-live", "polite"); r1.appendChild(st); bar.appendChild(r1);
    var cf = mk("div"); cf.id = "lbConf"; bar.appendChild(cf);
    var lg = mk("p", "lbnote bad"); lg.id = "lbLong"; lg.hidden = true; bar.appendChild(lg);
    var r2 = mk("div", "lbrow");
    var pb = btn("Print the cards", "pri", doPrint); pb.id = "lbPrint"; r2.appendChild(pb);
    var bl = mk("label", "lbcheck"), bc = mk("input"); bc.type = "checkbox"; bc.id = "lbBlanks"; bc.addEventListener("change", function () { blanks = bc.checked; });
    bl.appendChild(bc); bl.appendChild(document.createTextNode("Print blank sheets too")); r2.appendChild(bl);
    bar.appendChild(r2);
    var rem = mk("p", "lbremind", (B.texts || {}).printReminder || ""); rem.id = "lbRemind"; rem.style.marginTop = "8px"; bar.appendChild(rem);
    var r3 = mk("div", "lbrow");
    [["fill", "Fill from a list"], ["size", "Card size"], ["vers", "Earlier versions"]].forEach(function (p) { var b = btn(p[1], "", function () { togglePanel(p[0]); }); b.id = "lbBtn_" + p[0]; r3.appendChild(b); });
    var blank = btn("Start a blank set", "", function () {
      if (!countFilled()) { note("The set is already blank.", ""); return; }
      note("", ""); var el = $("lbNotice"); el.hidden = false; el.className = "lbnote bad"; el.innerHTML = "";
      el.appendChild(document.createTextNode("Empty all " + plural(countFilled(), "card") + "? The set as it is now stays under Earlier versions."));
      var y = mk("button", "", "Yes, start blank"), n = mk("button", "", "No"); y.type = n.type = "button"; y.id = "lbBlankYes";
      y.addEventListener("click", function () { saveOps([{ op: "clear" }], function (j) { note("Blank set started.", "good", j.was); }); });
      n.addEventListener("click", function () { note(""); });
      el.appendChild(y); el.appendChild(n);
    });
    blank.id = "lbBlank"; r3.appendChild(blank); bar.appendChild(r3);
    var nt = mk("p", "lbnote"); nt.id = "lbNotice"; nt.hidden = true; bar.appendChild(nt);
    bar.appendChild(mk("p", "lbhint", (B.texts || {}).intro || ""));
    var ch = mk("p", "lbhint"); ch.id = "lbChanged"; bar.appendChild(ch);
    wrap.appendChild(bar);
    var ph = mk("div", "lbpanel noprint"); ph.id = "lbPanel"; ph.hidden = true; wrap.appendChild(ph);
    var sheets = mk("div", "lbsheets"); sheets.id = "lbSheets"; wrap.appendChild(sheets);
    var add = mk("div", "lbaddrow noprint");
    var ab = btn("Add a sheet", "", function () { saveOps([{ op: "sheets", value: shown + 1 }]); }); ab.id = "lbAdd"; add.appendChild(ab);
    var rb = btn("Take off the last blank sheet", "", function () { saveOps([{ op: "sheets", value: shown - 1 }]); }); rb.id = "lbRemove"; rb.hidden = true; add.appendChild(rb);
    wrap.appendChild(add);
    wire(sheets);
  }

  function poll() {
    if (!SET || sending) return;
    R.api("/" + NAME + "/board?part=state" + (TEST ? "&as=TEST" : "")).then(answer).then(function (x) {
      if (x.s === 200 && x.j.ok && x.j.set.ver !== SET.ver && !sending) takeSet(x.j.set);
    }).catch(function () { });
  }

  R.gate(function () {
    who = TEST ? "TEST by Claude" : readWho();
    R.api("/" + NAME + "/board" + Q).then(answer).then(function (x) {
      if (x.s !== 200 || !x.j.ok) throw new Error((x.j && x.j.error) || ("the server answered " + x.s));
      B = x.j;
      document.title = B.title || "Working page";
      build();
      takeSet(B.set);
      window.addEventListener("resize", scaleSheets);
      window.addEventListener("beforeprint", function () { prepPrint(); });
      window.addEventListener("online", function () { flush(); });
      window.addEventListener("focus", poll);
      window.addEventListener("beforeunload", function (e) { if (dirtyList().length) { e.preventDefault(); e.returnValue = ""; } });
      setInterval(poll, 30000);
      document.body.setAttribute("data-lb-ready", TEST ? "test" : "yes");
    }).catch(function (e) {
      if (e && e.message === "signed out") return;
      var app = $("app"); app.hidden = false; app.innerHTML = ""; app.appendChild(mk("p", "lbnote bad", "This page could not be loaded: " + (e && e.message ? e.message : "no connection") + ". Reload to try again."));
    });
  });
  window.__labelsPrep = prepPrint;   /* used by the automated print test */
})();
