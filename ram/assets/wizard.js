/* Process-map wizard. One question per screen; every answer is posted to the server
   the moment Next is tapped. Nothing is kept in the browser. All text, stages, names
   and questions come from the API config after sign-in. */
(function () {
  "use strict";
  var $ = RAM.$, esc = RAM.esc, el = RAM.el, fmtTs = RAM.fmtTs;
  var Q = null, latest = {}, summary = [], seq = [], idx = 0, who = "", saving = false, resumeCue = "";
  /* "?as=TEST" preselects the TEST answerer, but only on a URL that also carries ?test=1. */
  var AS = RAM.TEST_MODE ? ((location.search.match(/[?&]as=([^&]+)/) || [])[1] || "") : "";
  var WHO_KEY = RAM.NS.slice(1) + "_who";
  var WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

  /* ---------- sequence ---------- */
  /* A row whose payload is {cleared:true} is an explicit erase: the question counts
     as unanswered again, and the control opens empty. */
  function row(stage, qid) { return (latest[stage] && latest[stage][qid]) ? latest[stage][qid] : null; }
  function ans(stage, qid) { var r = row(stage, qid); return (r && r.payload && !r.payload.cleared) ? r.payload : null; }
  function buildSeq() {
    var s = [], bn = 0;
    function push(it) { if (it.kind !== "branch") it.bn = ++bn; s.push(it); }
    Q.opening.questions.forEach(function (q) { push({ stage: "opening", label: Q.opening.title, q: q, kind: "opening" }); });
    Q.stages.forEach(function (st) {
      Q.per_stage.forEach(function (q) { push({ stage: st.id, st: st, label: st.n + ". " + st.name, hint: st.hint, q: q, kind: "stage" }); });
      (Q.branches || []).forEach(function (b) {
        if (b.stage !== st.id) return;
        push({ stage: st.id, st: st, label: st.n + ". " + st.name, hint: st.hint, q: b.gate, kind: "gate" });
        var g = ans(st.id, b.gate.id);
        if (g && g.choice === "Yes") b.questions.forEach(function (q, i) { push({ stage: st.id, st: st, label: st.n + ". " + st.name + " (more)", hint: st.hint, q: q, kind: "branch", bi: i + 1, bl: b.questions.length }); });
      });
    });
    Q.closing.questions.forEach(function (q) { push({ stage: "closing", label: Q.closing.title, q: q, kind: "closing" }); });
    s.push({ stage: "closing", label: "", q: { id: "__done", type: "done", text: "That is everything I have for now." }, kind: "done" });
    seq = s;
    /* The counter's total never moves: it counts the questions every walk sees. The
       extra questions behind a Yes gate are labelled as extras instead (#10). */
    seq.baseTotal = bn;
  }
  function firstUnanswered() {
    for (var i = 0; i < seq.length; i++) { if (seq[i].kind === "done") continue; if (!ans(seq[i].stage, seq[i].q.id)) return i; }
    return seq.length - 1;
  }
  function answeredCount() { var n = 0, t = 0; seq.forEach(function (it) { if (it.kind === "done") return; t++; if (ans(it.stage, it.q.id)) n++; }); return { n: n, t: t }; }
  function counterText(it) {
    if (it.kind === "done") return "";
    if (it.kind === "branch") return (WORDS[it.bl] || it.bl) + " more about this, " + it.bi + " of " + it.bl;
    return "Question " + it.bn + " of " + seq.baseTotal;
  }
  /* Per-stage wording: a stage may carry sub: {who: "...", hours: "..."} and
     hours_unit ("hours" for office steps) in questions.json (#11). */
  function subFor(it, q) { var o = it.st && it.st.sub && it.st.sub[q.id]; return o || q.sub || ""; }
  function hoursUnit(it) { return (it.st && it.st.hours_unit) || "crew hours"; }

  /* ---------- rendering ---------- */
  function chip(label, on, extra) { return '<button type="button" class="chip' + (on ? " on" : "") + '"' + (extra || "") + '>' + esc(label) + '</button>'; }
  function pickOne(container) { container.addEventListener("click", function (e) { var t = e.target.closest(".chip,.opt"); if (!t) return; Array.prototype.forEach.call(this.children, function (c) { c.classList.remove("on"); }); t.classList.add("on"); container.dispatchEvent(new CustomEvent("pick", { detail: t.dataset.val })); }); }
  function numBox(id, val, extra) { return '<input type="number" inputmode="decimal" min="0" step="any" class="bigin num" id="' + id + '" value="' + esc(val == null ? "" : val) + '"' + (extra || "") + '>'; }
  function render() {
    var it = seq[idx], q = it.q, a = ans(it.stage, q.id) || {};
    $("intro").hidden = true; $("qcard").hidden = false; $("navBar").hidden = false;
    /* The resume cue shows once, on the first screen after sign-in, then clears. */
    $("resumeCue").hidden = !resumeCue; $("resumeCue").textContent = resumeCue; resumeCue = "";
    $("qStage").textContent = it.label;
    $("qStage").title = it.hint || "";
    $("qProg").textContent = counterText(it);
    $("qText").textContent = q.text || "";
    $("qSub").textContent = subFor(it, q) + (it.kind === "stage" && it.hint && Q.per_stage[0].id === q.id ? "  (" + it.hint + ")" : "");
    var b = $("qBody"); b.innerHTML = "";
    var meta = "", r = row(it.stage, q.id);
    if (r) { meta = (r.payload && r.payload.cleared ? "Cleared by " : "Answered by ") + r.answered_by + " on " + fmtTs(r.ts_utc) + ". Change it and tap Next to save a new answer."; }
    $("qMeta").textContent = meta;

    if (q.type === "number") {
      if (q.range) {
        b.appendChild(el('<div class="numrow"><label class="rangelbl" for="inNum">Low</label>' + numBox("inNum", a.value) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
        b.appendChild(el('<div class="numrow"><label class="rangelbl" for="inHigh">High</label>' + numBox("inHigh", a.high) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
      } else {
        b.appendChild(el('<div class="numrow">' + numBox("inNum", a.value) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
      }
      if (q.note) b.appendChild(el('<textarea class="bigta" id="inNote" rows="2" placeholder="Note (optional)">' + esc(a.note || "") + '</textarea>'));
    } else if (q.type === "people") {
      var names = a.names || [], grid = el('<div class="chips" id="chips"></div>');
      /* A stage may add chips that are not staff (stage 3: Customer). */
      ((it.st && it.st.who_extra) || []).forEach(function (n) { grid.appendChild(el(chip(n, names.indexOf(n) >= 0, ' data-name="' + esc(n) + '"'))); });
      Q.roster.forEach(function (n) { var lbl = n === Q.me_name ? "Me (" + n + ")" : n; grid.appendChild(el(chip(lbl, names.indexOf(n) >= 0, ' data-name="' + esc(n) + '"'))); });
      b.appendChild(grid);
      b.appendChild(el('<input type="text" class="bigin" id="inOther" placeholder="Other (type a name)" value="' + esc(a.other || "") + '">'));
      grid.addEventListener("click", function (e) { var t = e.target.closest(".chip"); if (t) t.classList.toggle("on"); });
    } else if (q.type === "hours") {
      b.appendChild(el('<div class="numrow">' + numBox("inHours", a.hours) + '<span class="unit">' + esc(hoursUnit(it)) + '</span></div>'));
      b.appendChild(el('<label class="check"><input type="checkbox" id="inDep"' + (a.depends ? " checked" : "") + '> It depends</label>'));
      b.appendChild(el('<input type="text" class="bigin" id="inWhy" placeholder="On what? One line." value="' + esc(a.why || "") + '"' + (a.depends ? "" : ' style="display:none"') + '>'));
      $("inDep").addEventListener("change", function () { $("inWhy").style.display = this.checked ? "" : "none"; if (this.checked) $("inWhy").focus(); });
    } else if (q.type === "text" || q.type === "longtext") {
      b.appendChild(el('<textarea class="bigta" id="inText" rows="' + (q.type === "longtext" ? 6 : 3) + '" placeholder="Type here">' + esc(a.text || "") + '</textarea>'));
    } else if (q.type === "problem") {
      b.appendChild(el('<textarea class="bigta" id="inText" rows="4" placeholder="Type here">' + esc(a.text || "") + '</textarea>'));
      b.appendChild(el('<button type="button" class="btn flag' + (a.flag ? " on" : "") + '" id="btnFlag">' + (a.flag ? "Flagged as a money leak (tap to unflag)" : "Flag it: this costs real money") + '</button>'));
      b.appendChild(el('<div class="flagbox" id="flagBox"' + (a.flag ? "" : ' style="display:none"') + '><label class="biglabel">Rough guess, dollars each time it happens</label><div class="numrow"><span class="unit">$</span>' + numBox("inDollars", a.dollars) + '</div><label class="biglabel">How often?</label><div class="chips" id="oftenChips"></div></div>'));
      Q.how_often_options.forEach(function (o) { $("oftenChips").appendChild(el(chip(o, a.how_often === o, ' data-val="' + esc(o) + '"'))); });
      pickOne($("oftenChips"));
      $("btnFlag").addEventListener("click", function () { this.classList.toggle("on"); var on = this.classList.contains("on"); this.textContent = on ? "Flagged as a money leak (tap to unflag)" : "Flag it: this costs real money"; $("flagBox").style.display = on ? "" : "none"; });
    } else if (q.type === "approval") {
      var opts = el('<div class="options" id="opts"></div>');
      Q.approval_options.forEach(function (o) { opts.appendChild(el('<button type="button" class="btn opt' + (a.choice === o ? " on" : "") + '" data-val="' + esc(o) + '">' + esc(o) + '</button>')); });
      b.appendChild(opts);
      var fu = Q.approval_followup, show = a.choice && a.choice !== "No";
      b.appendChild(el('<div id="okWho"' + (show ? "" : ' style="display:none"') + '><label class="biglabel">' + esc(fu.text) + '</label><p class="qsub">' + esc(fu.sub || "") + '</p><textarea class="bigta" id="inWho" rows="2" placeholder="Type here">' + esc(a.who || "") + '</textarea></div>'));
      pickOne(opts);
      opts.addEventListener("pick", function (e) { $("okWho").style.display = e.detail === "No" ? "none" : ""; });
    } else if (q.type === "yesno") {
      var yn = el('<div class="options" id="opts"></div>');
      ["Yes", "No"].forEach(function (o) { yn.appendChild(el('<button type="button" class="btn opt' + (a.choice === o ? " on" : "") + '" data-val="' + o + '">' + o + '</button>')); });
      b.appendChild(yn);
      pickOne(yn);
    } else if (q.type === "done") {
      var cc = answeredCount();
      b.appendChild(el('<div><p class="donetext">' + esc(Q.closing.done_text) + '</p><p class="donetext">You have answered ' + cc.n + ' of ' + cc.t + ' questions.' + (cc.n < cc.t ? ' Tap Back, or tap any stage in the map above, to fill in the rest.' : '') + '</p><button type="button" class="btn big pri wide" id="btnDone">' + esc(Q.closing.done_label) + '</button><p class="pdesc center" id="doneMsg"></p></div>'));
      $("btnDone").addEventListener("click", function () { $("doneMsg").textContent = "Saved. You can close this page. Open the same link any time to come back."; window.scrollTo(0, 0); });
    }
    $("btnBack").disabled = idx === 0;
    $("btnNext").textContent = it.kind === "done" ? "Back to the top" : (idx === seq.length - 2 ? "Finish" : "Next");
    $("navHint").textContent = it.kind === "done" ? "" : (r && !(r.payload && r.payload.cleared) ? "Tap Next to save. Leave it blank to clear the earlier answer." : "Tap Next to save. Leave it blank to skip for now.");
    var first = b.querySelector("input,textarea"); if (first && window.innerWidth > 700 && window.innerHeight > 500) first.focus();
    renderStrip();
    window.scrollTo(0, 0);
  }
  /* The intro (from questions.json) shows on a first visit, before question 1 (#9). */
  function renderIntro() {
    $("qcard").hidden = true; $("navBar").hidden = true; $("intro").hidden = false;
    $("introStage").textContent = "Before we start";
    $("introText").textContent = Q.intro || "";
    renderStrip();
    window.scrollTo(0, 0);
  }
  $("btnStart").addEventListener("click", function () { idx = 0; render(); });

  function numVal(id) { var e = $(id); if (!e) return null; var v = e.value.trim(); return v === "" ? null : Number(v); }
  /* Anything that must not be saved, as a short reason (#6: no negative numbers). */
  function validate() {
    var q = seq[idx].q, bad = "";
    function neg(id, what) { var v = numVal(id); if (v != null && (isNaN(v) || v < 0)) bad = what + " cannot be less than zero"; }
    if (q.type === "number") { neg("inNum", "the number"); neg("inHigh", "the high number"); }
    if (q.type === "hours") neg("inHours", "hours");
    if (q.type === "problem" && $("btnFlag").classList.contains("on")) neg("inDollars", "dollars");
    return bad;
  }
  function readAnswer() {
    var it = seq[idx], q = it.q;
    if (q.type === "number") { var v = numVal("inNum"), hi = numVal("inHigh"), note = $("inNote") ? $("inNote").value.trim() : ""; if (v == null && hi == null && !note) return null; var o = { value: v, note: note }; if (q.range) o.high = hi; return o; }
    if (q.type === "people") { var names = Array.prototype.map.call(document.querySelectorAll("#chips .chip.on"), function (c) { return c.dataset.name; }); var other = $("inOther").value.trim(); if (!names.length && !other) return null; return { names: names, other: other }; }
    if (q.type === "hours") { var h = numVal("inHours"), dep = $("inDep").checked, why = $("inWhy").value.trim(); if (h == null && !dep) return null; return { hours: h, depends: dep, why: dep ? why : "" }; }
    if (q.type === "text" || q.type === "longtext") { var t = $("inText").value.trim(); if (!t) return null; return { text: t }; }
    if (q.type === "problem") { var tx = $("inText").value.trim(), flag = $("btnFlag").classList.contains("on"); if (!tx && !flag) return null; var d = numVal("inDollars"), oc = document.querySelector("#oftenChips .chip.on"); return { text: tx, flag: flag, dollars: flag ? d : null, how_often: flag && oc ? oc.dataset.val : "" }; }
    if (q.type === "approval") { var o2 = document.querySelector("#opts .opt.on"); if (!o2) return null; return { choice: o2.dataset.val, who: o2.dataset.val === "No" ? "" : $("inWho").value.trim() }; }
    if (q.type === "yesno") { var y = document.querySelector("#opts .opt.on"); if (!y) return null; return { choice: y.dataset.val }; }
    return null;
  }

  /* ---------- strip ---------- */
  /* Roster names are shortened to the first name; anything typed under Other (or an
     extra chip such as Customer) is shown whole (#5). */
  function shortName(n) { return Q.roster.indexOf(n) >= 0 ? String(n).split(" ")[0] : String(n); }
  function renderStrip() {
    var s = $("strip"); s.innerHTML = "";
    var cur = seq[idx] ? seq[idx].stage : "", done = 0;
    summary.forEach(function (st) {
      if (st.answered === st.total) done++;
      var names = st.who.map(shortName), nm = names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
      s.appendChild(el('<div class="sbox' + (st.id === cur ? " cur" : "") + (st.answered ? " has" : "") + '" data-stage="' + st.id + '">' +
        '<div class="sn">' + st.n + '</div><div class="sname">' + esc(st.short) + '</div>' +
        '<div class="sline">' + (nm ? esc(nm) : '<span class="dim">who?</span>') + '</div>' +
        '<div class="sline">' + (st.hours ? esc(st.hours) : '<span class="dim">hours?</span>') + '</div>' +
        (st.before ? '<div class="sline wait" title="' + esc(st.before) + '">Waiting on: ' + esc(st.before.length > 40 ? st.before.slice(0, 40) + "..." : st.before) + '</div>' : "") +
        '<div class="sicons">' + (st.flags ? '<span class="sflag" title="Flagged as a money leak">' + st.flags + '</span>' : "") + (st.locked ? '<span class="slock" title="Needs the owner\'s OK">&#128274; ' + esc(Q.me_short || "OK") + '</span>' : "") + '</div>' +
        '<div class="sbar"><i style="width:' + Math.round(100 * st.answered / st.total) + '%"></i></div></div>'));
    });
    $("stripCount").textContent = "(" + done + " of " + summary.length + " stages done)";
    scrollStripToCurrent();
  }
  /* Slide the strip so the current stage's box is in view (centred when there is room).
     Touches only the strip's own scroll position, never the page's. */
  function scrollStripToCurrent() {
    var s = $("strip"), box = s.querySelector(".sbox.cur");
    if (!box || !s.clientWidth) return;
    var target = box.offsetLeft - Math.max(0, (s.clientWidth - box.offsetWidth) / 2);
    s.scrollLeft = Math.max(0, Math.min(target, s.scrollWidth - s.clientWidth));
  }
  $("strip").addEventListener("click", function (e) {
    var t = e.target.closest(".sbox"); if (!t) return;
    for (var i = 0; i < seq.length; i++) if (seq[i].stage === t.dataset.stage) { idx = i; render(); return; }
  });
  /* The strip starts closed on a narrow screen or a short one (phone held sideways, #1);
     it follows a rotation until the user has toggled it by hand. */
  var stripTouched = false;
  function compact() { return window.innerWidth <= 700 || window.innerHeight <= 500; }
  function setStrip(open) { $("stripWrap").classList.toggle("closed", !open); $("stripToggle").setAttribute("aria-expanded", open ? "true" : "false"); if (open) scrollStripToCurrent(); }
  $("stripToggle").addEventListener("click", function () { stripTouched = true; setStrip($("stripWrap").classList.contains("closed")); });
  setStrip(!compact());
  window.addEventListener("resize", function () { if (!stripTouched) setStrip(!compact()); });

  /* ---------- who toggle ---------- */
  /* The last Answering choice is remembered per browser (#8); ?as= on a test URL wins. */
  function buildWho() {
    var opts = (Q.answered_by_options || ["Owner", "Consultant"]).slice();
    if (RAM.TEST_MODE) opts.push("TEST");
    var box = $("whoButtons"); box.innerHTML = "";
    opts.forEach(function (o, i) { box.appendChild(el('<button type="button" class="whobtn' + (i === 0 ? " on" : "") + '" data-who="' + esc(o) + '">' + esc(o) + '</button>')); });
    who = opts[0];
    $("whoToggle").hidden = false;
    var want = AS; if (!want) { try { want = localStorage.getItem(WHO_KEY) || ""; } catch (e) { } }
    var tb = want ? box.querySelector('.whobtn[data-who="' + want + '"]') : null; if (tb) tb.click();
  }
  $("whoToggle").addEventListener("click", function (e) {
    var t = e.target.closest(".whobtn"); if (!t) return;
    Array.prototype.forEach.call(this.querySelectorAll(".whobtn"), function (b) { b.classList.remove("on"); }); t.classList.add("on"); who = t.dataset.who;
    try { localStorage.setItem(WHO_KEY, who); } catch (e2) { }
  });

  /* ---------- nav ---------- */
  /* Save status lives in the header on wide screens and in the Back/Next bar on phones
     (the phone header has no room for it); both elements get the same text. */
  function setSaved(msg, bad) { var e = $("saveState"); e.textContent = msg; e.className = "saved" + (bad ? " bad" : ""); var n = $("navState"); if (n) { n.textContent = msg; n.className = "navstate" + (bad ? " bad" : ""); } }
  function advance(dir) { idx = Math.max(0, Math.min(seq.length - 1, idx + dir)); render(); }
  function saveThen(then) {
    var it = seq[idx];
    if (it.kind === "done") { then(); return; }
    var bad = validate();
    if (bad) { setSaved("Not saved: " + bad + ".", true); return; }
    var payload = readAnswer(), prev = ans(it.stage, it.q.id), cleared = false;
    if (payload === null) {
      /* Blank with no earlier answer: skip. Blank over an earlier answer: erase it (#7). */
      if (!prev) { then(); return; }
      payload = { cleared: true }; cleared = true;
    }
    if (prev && JSON.stringify(prev) === JSON.stringify(payload)) { then(); return; }
    if (saving) return;
    saving = true; setSaved("Saving");
    $("btnNext").disabled = true;
    RAM.apiJSON("/answers", { method: "POST", json: { stage: it.stage, question: it.q.id, payload: payload, answered_by: who } })
      .then(function (r) {
        saving = false; $("btnNext").disabled = false;
        if (!r || !r.ok) { setSaved("Not saved: " + (r && r.error ? r.error : "something went wrong") + ". Try again.", true); return; }
        latest[it.stage] = latest[it.stage] || {};
        latest[it.stage][it.q.id] = { payload: payload, answered_by: who, ts_utc: new Date().toISOString() };
        summary = r.summary || summary;
        setSaved((cleared ? "Cleared " : "Saved ") + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        if (it.kind === "gate") { var key = it.stage + "|" + it.q.id; buildSeq(); for (var i = 0; i < seq.length; i++) if (seq[i].stage + "|" + seq[i].q.id === key) { idx = i; break; } }
        then();
      })
      .catch(function (e) { saving = false; $("btnNext").disabled = false; if (e.message !== "signed out") setSaved("Not saved: no connection. Check the signal and tap Next again.", true); });
  }
  $("btnNext").addEventListener("click", function () { if (seq[idx].kind === "done") { idx = 0; render(); return; } saveThen(function () { advance(1); }); });
  $("btnBack").addEventListener("click", function () { saveThen(function () { advance(-1); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.tagName === "INPUT" && e.target.id !== "gatePassword") { e.preventDefault(); $("btnNext").click(); } });

  /* ---------- boot ---------- */
  RAM.gate(function (cfg) {
    Q = cfg;
    Q.me_short = (Q.me_name || "").split(" ")[0] ? (Q.me_name.split(" ")[0] + " OK") : "OK";
    $("appSub").hidden = false;
    if ($("h1sub")) $("h1sub").hidden = false;
    buildWho();
    RAM.apiJSON("/answers").then(function (r) {
      latest = r.latest || {}; summary = r.summary || [];
      buildSeq(); idx = firstUnanswered();
      var c = answeredCount();
      setSaved(c.n ? c.n + " answered so far" : "Let's start.");
      if (c.n && idx > 0) {
        var it = seq[idx], where = it.kind === "done" ? "the last screen" : (it.kind === "branch" ? "the extra questions" : "question " + it.bn);
        var stage = it.kind === "stage" || it.kind === "gate" || it.kind === "branch" ? it.label.replace(/^\d+\.\s*/, "").replace(/ \(more\)$/, "") : it.label;
        resumeCue = "Picking up at " + where + (stage ? ", " + stage : "") + (it.q.text && it.kind !== "done" ? ": " + it.q.text : "");
      }
      if (c.n === 0 && Q.intro) renderIntro(); else render();
      window.RAMWIZ = { seq: function () { return seq; }, latest: function () { return latest; }, go: function (i) { idx = i; render(); }, idx: function () { return idx; } };
    }).catch(function (e) { if (e.message !== "signed out") setSaved("Could not load the answers: " + e.message, true); });
  });
})();
