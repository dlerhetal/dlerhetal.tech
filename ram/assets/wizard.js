/* Process-map wizard, v2: the owner builds the list of steps himself.
   Phase 1  "The phone rings. What happens first?" then "Then what?" until he says the
            job is done. Each answer is a step (server-assigned id), in his order and his
            words; any step can be renamed, moved or taken out.
   Phase 2  five questions about each of HIS steps.
   Phase 3  "Did I miss anything?": a checklist of things drillers sometimes do; Yes or
            Sometimes puts it into his list where he says, No is recorded as a No.
   One screen at a time; everything is posted to the server the moment a button is
   tapped. Nothing is kept in the browser. All text, names, questions and checklist
   items come from the API config after sign-in; the step list comes from the record. */
(function () {
  "use strict";
  var $ = RAM.$, esc = RAM.esc, el = RAM.el, fmtTs = RAM.fmtTs;
  var Q = null, latest = {}, steps = [], summary = [], tallyObj = null, cands = [], p1done = false;
  var seq = [], idx = 0, who = "", saving = false, resumeCue = "", editing = "", pendingReturn = "";
  /* "?as=TEST" preselects the TEST answerer, but only on a URL that also carries ?test=1. */
  var AS = RAM.TEST_MODE ? ((location.search.match(/[?&]as=([^&]+)/) || [])[1] || "") : "";
  var WHO_KEY = RAM.NS.slice(1) + "_who";
  /* PREVIEW (?preview=1, this page load only, never stored): the consultant rehearses
     every screen in order. Nothing is validated, nothing is posted; a throwaway
     in-memory demo (three sample steps) stands in for the record so the strip, the
     list, the tally and the checklist look real. No page links here; URL only. */
  var PREVIEW = /[?&]preview=1(&|$)/.test(location.search);
  var DEMO_STEPS = ["I take the call", "I go look at the job site", "We drill the hole"];
  var tour = [], tourIdx = 0, previewBuild = "";
  /* A TEST walk (?test=1 with Answering = TEST) never dead-ends on Phase 1: an empty
     "Then what?" moves on without saving and "That's it" works with zero steps. The
     owner's own walk keeps the gate (a step needs words). */
  function testWalk() { return RAM.TEST_MODE && who === "TEST"; }

  /* ---------- record helpers ---------- */
  function row(stage, qid) { return (latest[stage] && latest[stage][qid]) ? latest[stage][qid] : null; }
  function ans(stage, qid) { var r = row(stage, qid); return (r && r.payload && !r.payload.cleared) ? r.payload : null; }
  function stepById(id) { for (var i = 0; i < steps.length; i++) if (steps[i].id === id) return steps[i]; return null; }
  function candState(id) { for (var i = 0; i < cands.length; i++) if (cands[i].id === id) return cands[i]; return null; }
  function candDef(id) { for (var i = 0; i < Q.candidates.length; i++) if (Q.candidates[i].id === id) return Q.candidates[i]; return null; }
  function meFirst() { return String(Q.me_name || "").split(" ")[0] || "Owner"; }
  function fmt(t, map) { return String(t || "").replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }); }
  /* Take what the server sent back after any save. */
  function absorb(r) {
    if (!r) return;
    if (r.steps) steps = r.steps;
    if (r.summary) summary = r.summary;
    if (r.tally) tallyObj = r.tally;
    if (r.candidates) cands = r.candidates;
    if (typeof r.phase1_done === "boolean") p1done = r.phase1_done;
    if (r.latest) latest = r.latest;
  }

  /* ---------- sequence ---------- */
  function buildSeq() {
    var s = [];
    Q.opening.questions.forEach(function (q, i) { s.push({ stage: "opening", label: Q.opening.title, q: q, kind: "opening", i: i + 1, t: Q.opening.questions.length }); });
    s.push({ stage: "phase1", label: Q.build.title, q: { id: "done", type: "build", text: "" }, kind: "build" });
    steps.forEach(function (st) {
      Q.per_stage.forEach(function (q, i) { s.push({ stage: st.id, st: st, label: "Step " + st.n + " of " + steps.length + ": " + st.title, q: q, kind: "stage", i: i + 1, t: Q.per_stage.length }); });
    });
    if (p1done) {
      Q.candidates.forEach(function (c, i) { s.push({ stage: "candidates", label: Q.candidates_screen.title, q: { id: c.id, type: "candidate", text: c.title, sub: c.sub }, cand: c, kind: "candidate", i: i + 1, t: Q.candidates.length }); });
    }
    Q.closing.questions.forEach(function (q) { s.push({ stage: "closing", label: Q.closing.title, q: q, kind: "closing" }); });
    s.push({ stage: "closing", label: "", q: { id: "__done", type: "done", text: "That is everything I have for now." }, kind: "done" });
    seq = s;
  }
  function itemAnswered(it) {
    if (it.kind === "done") return true;
    if (it.kind === "build") return p1done;
    if (it.kind === "candidate") { var c = candState(it.q.id); return !!(c && c.choice); }
    return !!ans(it.stage, it.q.id);
  }
  function firstUnanswered() {
    for (var i = 0; i < seq.length; i++) if (!itemAnswered(seq[i])) return i;
    return seq.length - 1;
  }
  function answeredCount() { var n = 0, t = 0; seq.forEach(function (it) { if (it.kind === "done" || it.kind === "build") return; t++; if (itemAnswered(it)) n++; }); return { n: n, t: t }; }
  function counterText(it) {
    if (it.kind === "opening") return "Question " + it.i + " of " + it.t;
    if (it.kind === "stage") return "Question " + it.i + " of " + it.t + " about this step";
    if (it.kind === "candidate") return "Checklist " + it.i + " of " + it.t;
    return "";
  }
  function findIdx(stage, qid) { for (var i = 0; i < seq.length; i++) if (seq[i].stage === stage && seq[i].q.id === qid) return i; return -1; }
  /* The hours question's wording follows the Who answer: office hours when the only
     owners are the office people (office_names), crew hours otherwise. */
  function hoursInfo(stepId) {
    var w = ans(stepId, "who"), names = w ? (w.names || []).concat(w.other ? [w.other] : []) : [];
    var office = Q.office_names || [], hq = null;
    Q.per_stage.forEach(function (q) { if (q.id === "hours") hq = q; });
    var isOffice = names.length > 0 && names.every(function (n) { return office.indexOf(n) >= 0; });
    return { unit: isOffice ? (hq.unit_office || "hours") : (hq.unit || "crew hours"), sub: isOffice ? (hq.sub_office || hq.sub) : hq.sub };
  }

  /* ---------- rendering ---------- */
  function chip(label, on, extra) { return '<button type="button" class="chip' + (on ? " on" : "") + '"' + (extra || "") + '>' + esc(label) + '</button>'; }
  function pickOne(container) { container.addEventListener("click", function (e) { var t = e.target.closest(".chip,.opt"); if (!t) return; Array.prototype.forEach.call(container.children, function (c) { c.classList.remove("on"); }); t.classList.add("on"); container.dispatchEvent(new CustomEvent("pick", { detail: t.dataset.val })); }); }
  function numBox(id, val, extra) { return '<input type="number" inputmode="decimal" min="0" step="any" class="bigin num" id="' + id + '" value="' + esc(val == null ? "" : val) + '"' + (extra || "") + '>'; }
  function showCard() { $("intro").hidden = true; $("editcard").hidden = true; $("qcard").hidden = false; $("navBar").hidden = false; }

  function render() {
    editing = "";
    var it = seq[idx], q = it.q, a = ans(it.stage, q.id) || {};
    showCard();
    $("resumeCue").hidden = !resumeCue; $("resumeCue").textContent = resumeCue; resumeCue = "";
    $("qStage").textContent = it.label;
    $("qProg").textContent = counterText(it);
    $("qText").textContent = q.text || "";
    $("qSub").textContent = q.sub || "";
    var b = $("qBody"); b.innerHTML = "";
    var meta = "", r = row(it.stage, q.id);
    if (r && it.kind !== "build" && !PREVIEW) { meta = (r.payload && r.payload.cleared ? "Cleared by " : "Answered by ") + r.answered_by + " on " + fmtTs(r.ts_utc) + ". Change it and tap Next to save a new answer."; }
    $("qMeta").textContent = meta;
    $("navBar").hidden = it.kind === "build";
    $("qcard").classList.toggle("buildcard", it.kind === "build");

    if (q.type === "number") {
      if (q.range) {
        b.appendChild(el('<div class="numrow"><label class="rangelbl" for="inNum">Low</label>' + numBox("inNum", a.value) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
        b.appendChild(el('<div class="numrow"><label class="rangelbl" for="inHigh">High</label>' + numBox("inHigh", a.high) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
      } else {
        b.appendChild(el('<div class="numrow">' + numBox("inNum", a.value) + '<span class="unit">' + esc(q.unit || "") + '</span></div>'));
      }
      if (q.note) b.appendChild(el('<textarea class="bigta" id="inNote" rows="2" placeholder="Note (optional)">' + esc(a.note || "") + '</textarea>'));
    } else if (q.type === "build") {
      renderBuild(b);
    } else if (q.type === "people") {
      var names = a.names || [], grid = el('<div class="chips" id="chips"></div>');
      (Q.who_extra || []).forEach(function (n) { grid.appendChild(el(chip(n, names.indexOf(n) >= 0, ' data-name="' + esc(n) + '"'))); });
      Q.roster.forEach(function (n) { var lbl = n === Q.me_name ? "Me (" + n + ")" : n; grid.appendChild(el(chip(lbl, names.indexOf(n) >= 0, ' data-name="' + esc(n) + '"'))); });
      b.appendChild(grid);
      b.appendChild(el('<input type="text" class="bigin" id="inOther" placeholder="Other (type a name)" value="' + esc(a.other || "") + '">'));
      grid.addEventListener("click", function (e) { var t = e.target.closest(".chip"); if (t) t.classList.toggle("on"); });
    } else if (q.type === "hours") {
      var hi = hoursInfo(it.stage);
      $("qSub").textContent = hi.sub;
      b.appendChild(el('<div class="numrow">' + numBox("inHours", a.hours) + '<span class="unit">' + esc(hi.unit) + '</span></div>'));
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
    } else if (q.type === "candidate") {
      renderCandidate(b, it);
    } else if (q.type === "done") {
      var cc = answeredCount();
      b.appendChild(el('<div><p class="donetext">' + esc(Q.closing.done_text) + '</p><p class="donetext">' + esc(tallyObj ? tallyObj.line : "") + ' You have answered ' + cc.n + ' of ' + cc.t + ' questions.' + (cc.n < cc.t ? ' Tap Back, or tap any step in the map above, to fill in the rest.' : '') + '</p><button type="button" class="btn big pri wide" id="btnDone">' + esc(Q.closing.done_label) + '</button><p class="pdesc center" id="doneMsg"></p></div>'));
      $("btnDone").addEventListener("click", function () { $("doneMsg").textContent = "Saved. You can close this page. Open the same link any time to come back."; window.scrollTo(0, 0); });
    }
    if (it.kind === "stage") {
      b.appendChild(el('<p class="skipline"><a href="#" id="skipStep">' + esc(Q.skip_label || "Skip this step for now") + '</a></p>'));
      $("skipStep").addEventListener("click", function (e) { e.preventDefault(); if (PREVIEW) showStop(tourIdx + 1); else skipStep(); });
    }
    $("btnBack").disabled = idx === 0;
    $("btnNext").textContent = it.kind === "done" ? "Back to the top" : (idx === seq.length - 2 ? "Finish" : "Next");
    $("navHint").textContent = it.kind === "done" || it.kind === "candidate" ? (it.kind === "candidate" ? "Tap Next to save." : "") : (r && !(r.payload && r.payload.cleared) ? "Tap Next to save. Leave it blank to clear the earlier answer." : "Tap Next to save. Leave it blank to skip for now.");
    if (PREVIEW) { $("navHint").textContent = it.kind === "done" ? "" : "Preview: Next moves to the next screen. Nothing is saved."; $("btnBack").disabled = tourIdx === 0; $("btnNext").textContent = it.kind === "done" ? "Back to the top" : "Next"; }
    var first = b.querySelector("input,textarea"); if (first && window.innerWidth > 700 && window.innerHeight > 500) first.focus();
    renderStrip();
    window.scrollTo(0, 0);
  }

  /* Phase 1: the list builder. */
  function renderBuild(b) {
    var B = Q.build, last = steps.length ? steps[steps.length - 1] : null;
    /* In preview the same screen is shown twice: first as the opener (empty list), then
       as the "Then what?" loop with the sample steps. */
    var asFirst = previewBuild === "first" || !steps.length, asAgain = !asFirst && p1done && previewBuild !== "list";
    var shown = asFirst ? [] : steps;
    if (asFirst) { $("qText").textContent = B.first_text; $("qSub").textContent = B.first_sub; }
    else if (asAgain) { $("qText").textContent = B.again_text; $("qSub").textContent = B.again_sub; }
    else { $("qText").textContent = B.next_text; $("qSub").textContent = 'After "' + last.title + '": ' + B.next_sub; }
    b.appendChild(el('<textarea class="bigta" id="inBuild" rows="3" placeholder="Type here"></textarea>'));
    b.appendChild(el('<button type="button" class="btn big pri wide" id="btnThen">' + esc(B.then_label) + '</button>'));
    b.appendChild(el('<button type="button" class="btn big wide" id="btnBuildDone">' + esc(asAgain ? B.done_again_label : B.done_label) + '</button>'));
    b.appendChild(el('<p class="pdesc" id="buildMsg"></p>'));
    var list = el('<ol class="steplist" id="stepList"></ol>');
    shown.forEach(function (s) {
      var sm = null; summary.forEach(function (x) { if (x.id === s.id) sm = x; });
      list.appendChild(el('<li><button type="button" class="steprow" data-edit="' + s.id + '"><span class="stepn">' + s.n + '</span><span class="steptitle">' + esc(s.title) + '</span><span class="stepmeta">' + (sm && sm.who.length ? esc(sm.who.map(shortName).join(", ")) : "") + '</span></button></li>'));
    });
    b.appendChild(el('<p class="pdesc">' + esc(shown.length ? B.edit_hint : B.empty_hint) + '</p>'));
    b.appendChild(list);
    if (idx > 0) { b.appendChild(el('<p class="skipline"><a href="#" id="buildBack">Back</a></p>')); $("buildBack").addEventListener("click", function (e) { e.preventDefault(); if (PREVIEW) showStop(tourIdx - 1); else advance(-1); }); }
    list.addEventListener("click", function (e) { var t = e.target.closest("[data-edit]"); if (t) renderEdit(t.dataset.edit); });
    $("btnThen").addEventListener("click", function () {
      var text = $("inBuild").value.trim();
      if (PREVIEW) { showStop(tourIdx + 1); return; }
      if (!text) {
        if (testWalk()) { $("buildMsg").textContent = "TEST walk: nothing added, moving on."; buildSeq(); idx = Math.min(idx + 1, seq.length - 1); render(); return; }
        $("buildMsg").textContent = "Type what happens, then tap the button."; $("inBuild").focus(); return;
      }
      postStep({ event: "create", payload: { text: text, after: "" } }, function () { render(); $("inBuild").focus(); });
    });
    $("btnBuildDone").addEventListener("click", function () {
      var text = $("inBuild").value.trim();
      if (PREVIEW) { showStop(tourIdx + 1); return; }
      function finish() {
        if (!steps.length) {
          if (!testWalk()) { $("buildMsg").textContent = "Add at least one step first."; return; }
          /* TEST walk with no steps: straight to the checklist, nothing saved. */
          p1done = true; buildSeq(); idx = Math.min(idx + 1, seq.length - 1); render(); return;
        }
        if (p1done) { buildSeq(); idx = Math.min(idx + 1, seq.length - 1); render(); return; }
        saveAnswer("phase1", "done", { done: true }, function () { p1done = true; buildSeq(); idx = Math.min(idx + 1, seq.length - 1); render(); });
      }
      if (text) postStep({ event: "create", payload: { text: text, after: "" } }, finish); else finish();
    });
    document.addEventListener("keydown", buildEnter);
  }
  function buildEnter(e) {
    var ta = $("inBuild"); if (!ta || e.target !== ta || e.key !== "Enter" || e.shiftKey) { if (!ta) document.removeEventListener("keydown", buildEnter); return; }
    e.preventDefault(); $("btnThen").click();
  }

  /* One step's own screen: rename, move, take out, or go to its questions. */
  function renderEdit(id) {
    var s = stepById(id); if (!s) return;
    editing = id;
    $("intro").hidden = true; $("qcard").hidden = true; $("navBar").hidden = true; $("editcard").hidden = false;
    $("editStage").textContent = "Step " + s.n + " of " + steps.length;
    $("editText").value = s.text || s.title;
    $("editMsg").textContent = "";
    $("btnEditUp").disabled = s.n === 1;
    $("btnEditDown").disabled = s.n === steps.length;
    renderStrip();
    window.scrollTo(0, 0);
  }
  var PREVIEW_EDIT_MSG = "Preview: nothing is saved. Tap the blue button to go on.";
  $("btnEditSave").addEventListener("click", function () {
    var text = $("editText").value.trim(), s = stepById(editing);
    if (PREVIEW) { $("editMsg").textContent = PREVIEW_EDIT_MSG; return; }
    if (!text) { $("editMsg").textContent = "A step needs a name. To take it out, use the button below."; return; }
    if (s && text === (s.text || s.title)) { $("editMsg").textContent = "No change."; return; }
    postStep({ event: "rename", step_id: editing, payload: { text: text } }, function () { buildSeq(); renderEdit(editing); $("editMsg").textContent = "Renamed."; });
  });
  $("btnEditUp").addEventListener("click", function () { if (PREVIEW) { $("editMsg").textContent = PREVIEW_EDIT_MSG; return; } postStep({ event: "move", step_id: editing, payload: { dir: "up" } }, function () { buildSeq(); renderEdit(editing); $("editMsg").textContent = "Moved up."; }); });
  $("btnEditDown").addEventListener("click", function () { if (PREVIEW) { $("editMsg").textContent = PREVIEW_EDIT_MSG; return; } postStep({ event: "move", step_id: editing, payload: { dir: "down" } }, function () { buildSeq(); renderEdit(editing); $("editMsg").textContent = "Moved down."; }); });
  $("btnEditDelete").addEventListener("click", function () {
    var s = stepById(editing); if (!s) return;
    if (PREVIEW) { $("editMsg").textContent = PREVIEW_EDIT_MSG; return; }
    if (!confirm('Take "' + s.title + '" out of the list? Its answers stay on record.')) return;
    var id = editing;
    postStep({ event: "delete", step_id: id }, function () { buildSeq(); if (seq[idx] && seq[idx].stage === id) idx = findIdx("phase1", "done"); else { var cur = seq[idx]; idx = Math.max(0, Math.min(idx, seq.length - 1)); if (cur) { var j = findIdx(cur.stage, cur.q.id); if (j >= 0) idx = j; } } render(); });
  });
  $("btnEditGo").addEventListener("click", function () { if (PREVIEW) { showStop(tour[tourIdx].k === "edit" ? tourIdx + 1 : tourIdx); return; } var j = findIdx(editing, Q.per_stage[0].id); if (j >= 0) { idx = j; render(); } });
  $("btnEditBack").addEventListener("click", function () { if (PREVIEW) { showStop(tour[tourIdx].k === "edit" ? tourIdx - 1 : tourIdx); return; } render(); });

  /* Phase 3: one checklist item. */
  function renderCandidate(b, it) {
    var C = Q.candidates_screen, c = it.cand, state = candState(c.id) || {}, a = ans("candidates", c.id) || {};
    $("qText").textContent = c.title;
    var match = state.match, opts = el('<div class="options" id="opts"></div>');
    var head = el('<p class="qsub" id="candQ"></p>');
    if (state.step) head.textContent = "This is step " + state.step.n + " in your list.";
    else if (match) head.textContent = fmt(C.matched_text, { n: match.n, title: match.name });
    else head.textContent = C.question;
    b.appendChild(head);
    var options = (match && !state.step) ? C.matched_options : C.options;
    var cur = a.choice ? (match && !state.step ? (a.choice === "No" ? C.matched_options[2] : (a.matched ? C.matched_options[0] : C.matched_options[1])) : a.choice) : "";
    options.forEach(function (o) { opts.appendChild(el('<button type="button" class="btn opt' + (cur === o ? " on" : "") + '" data-val="' + esc(o) + '">' + esc(o) + '</button>')); });
    b.appendChild(opts);
    var sel = '<div id="placeBox" style="display:none"><label class="biglabel">' + esc(C.place_text) + '</label><p class="qsub">' + esc(C.place_sub) + '</p><select class="bigin" id="inPlace"><option value="first">' + esc(C.place_first) + '</option>';
    steps.forEach(function (s) { sel += '<option value="' + s.id + '"' + (s.n === steps.length ? " selected" : "") + '>' + esc(fmt(C.place_after, { n: s.n, title: s.title })) + '</option>'; });
    sel += '</select></div>';
    b.appendChild(el(sel));
    pickOne(opts);
    function needsPlace(v) { if (state.step) return false; if (match) return v === C.matched_options[1]; return v === "Yes" || v === "Sometimes"; }
    opts.addEventListener("pick", function (e) { $("placeBox").style.display = needsPlace(e.detail) ? "" : "none"; });
    if (cur && needsPlace(cur)) $("placeBox").style.display = "";
  }
  function candidateAnswer(it) {
    var C = Q.candidates_screen, c = it.cand, state = candState(c.id) || {}, o = document.querySelector("#opts .opt.on");
    if (!o) return null;
    var v = o.dataset.val, out = { choice: v, matched: false, step_id: state.step ? state.step.id : "", create: false, after: "" };
    if (state.match && !state.step) {
      if (v === C.matched_options[0]) { out.choice = "Yes"; out.matched = true; out.step_id = state.match.id; }
      else if (v === C.matched_options[1]) { out.choice = "Yes"; out.create = true; }
      else out.choice = "No";
    } else if (!state.step && (v === "Yes" || v === "Sometimes")) out.create = true;
    if (out.create) out.after = $("inPlace") ? $("inPlace").value : "";
    return out;
  }
  function saveCandidate(it, then) {
    var c = it.cand, state = candState(c.id) || {}, o = candidateAnswer(it), prev = ans("candidates", c.id);
    if (!o) { then(); return; }
    function record(stepId, matched) {
      var payload = { choice: o.choice, step_id: stepId || "", matched: !!matched };
      if (prev && prev.choice === payload.choice && prev.step_id === payload.step_id) { then(); return; }
      saveAnswer("candidates", c.id, payload, function () { buildSeq(); then(); });
    }
    if (o.choice === "No" && state.step) {
      /* He changed his mind: the step made from this item leaves the list too. */
      postStep({ event: "delete", step_id: state.step.id }, function () { record("", false); });
    } else if (o.create) {
      postStep({ event: "create", payload: { text: c.title, after: o.after, candidate: c.id } }, function (r) {
        var sid = r.step_id;
        saveAnswer("candidates", c.id, { choice: o.choice, step_id: sid, matched: false }, function () {
          buildSeq();
          /* Straight into its five questions, then back to the checklist. */
          var nextCand = null; for (var i = it.i; i < Q.candidates.length; i++) { nextCand = Q.candidates[i].id; break; }
          pendingReturn = nextCand ? "candidates|" + nextCand : "closing|" + Q.closing.questions[0].id;
          var j = findIdx(sid, Q.per_stage[0].id); idx = j >= 0 ? j : idx; render();
        });
      });
    } else record(o.step_id, o.matched);
  }

  /* The intro (from questions.json) shows on a first visit, before question 1 (#9). */
  function renderIntro() {
    $("qcard").hidden = true; $("navBar").hidden = true; $("editcard").hidden = true; $("intro").hidden = false;
    $("introStage").textContent = "Before we start";
    $("introText").textContent = Q.intro || "";
    renderStrip();
    window.scrollTo(0, 0);
  }
  $("btnStart").addEventListener("click", function () { if (PREVIEW) { showStop(1); return; } idx = 0; render(); });

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
    return null;
  }

  /* ---------- strip ---------- */
  /* Roster names are shortened to the first name; anything typed under Other (or the
     Customer chip) is shown whole (#5). */
  function shortName(n) { return Q.roster.indexOf(n) >= 0 ? String(n).split(" ")[0] : String(n); }
  function tallyLine() { return tallyObj ? tallyObj.line : "No steps yet."; }
  function renderStrip() {
    var s = $("strip"); s.innerHTML = "";
    var cur = editing || (seq[idx] ? seq[idx].stage : "");
    summary.forEach(function (st) {
      var names = st.who.map(shortName), nm = names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
      s.appendChild(el('<div class="sbox' + (st.id === cur ? " cur" : "") + (st.answered ? " has" : "") + (st.me_alone ? " alone" : "") + '" data-stage="' + st.id + '">' +
        '<div class="sn">' + st.n + '</div><div class="sname">' + esc(st.name) + '</div>' +
        '<div class="sline">' + (nm ? esc(nm) : '<span class="dim">who?</span>') + '</div>' +
        '<div class="sline">' + (st.hours ? esc(st.hours) : '<span class="dim">hours?</span>') + '</div>' +
        (st.before ? '<div class="sline wait" title="' + esc(st.before) + '">Waiting on: ' + esc(st.before.length > 40 ? st.before.slice(0, 40) + "..." : st.before) + '</div>' : "") +
        '<div class="sicons">' + (st.me_alone ? '<span class="salone">' + esc(meFirst()) + ' alone</span>' : "") + (st.flags ? '<span class="sflag" title="Flagged as a money leak">' + st.flags + '</span>' : "") + (st.locked ? '<span class="slock" title="Needs the owner\'s OK">&#128274; ' + esc(meFirst()) + ' OK</span>' : "") + '</div>' +
        '<div class="sbar"><i style="width:' + Math.round(100 * st.answered / st.total) + '%"></i></div></div>'));
    });
    if (!summary.length) s.appendChild(el('<div class="sempty">' + esc(Q.build.empty_hint) + '</div>'));
    $("stripCount").textContent = tallyLine();
    $("stripTally").textContent = tallyLine();
    scrollStripToCurrent();
  }
  function scrollStripToCurrent() {
    var s = $("strip"), box = s.querySelector(".sbox.cur");
    if (!box || !s.clientWidth) return;
    var target = box.offsetLeft - Math.max(0, (s.clientWidth - box.offsetWidth) / 2);
    s.scrollLeft = Math.max(0, Math.min(target, s.scrollWidth - s.clientWidth));
  }
  /* Tap a box: rename it, move it, take it out, or go to its questions. */
  $("strip").addEventListener("click", function (e) { var t = e.target.closest(".sbox"); if (t) renderEdit(t.dataset.stage); });
  /* The strip starts closed on a narrow screen or a short one (phone held sideways, #1);
     it follows a rotation until the user has toggled it by hand. */
  var stripTouched = false;
  function compact() { return window.innerWidth <= 700 || window.innerHeight <= 500; }
  function setStrip(open) { $("stripWrap").classList.toggle("closed", !open); $("stripToggle").setAttribute("aria-expanded", open ? "true" : "false"); if (open) scrollStripToCurrent(); }
  $("stripToggle").addEventListener("click", function () { stripTouched = true; setStrip($("stripWrap").classList.contains("closed")); });
  setStrip(!compact());
  window.addEventListener("resize", function () { if (!stripTouched) setStrip(!compact()); });

  /* ---------- who toggle ---------- */
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

  /* ---------- saving ---------- */
  function setSaved(msg, bad) { var e = $("saveState"); e.textContent = msg; e.className = "saved" + (bad ? " bad" : ""); var n = $("navState"); if (n) { n.textContent = msg; n.className = "navstate" + (bad ? " bad" : ""); } }
  function busy(on) { saving = on; ["btnNext", "btnThen", "btnBuildDone", "btnEditSave", "btnEditUp", "btnEditDown", "btnEditDelete"].forEach(function (id) { var b = $(id); if (b) b.disabled = on; }); }
  function stamp() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function postStep(body, then) {
    if (PREVIEW) { setSaved("Preview: nothing is saved"); return; }   /* never a write in preview */
    if (saving) return;
    body.answered_by = who;
    busy(true); setSaved("Saving");
    RAM.apiJSON("/steps", { method: "POST", json: body })
      .then(function (r) {
        busy(false);
        if (!r || !r.ok) { setSaved("Not saved: " + (r && r.error ? r.error : "something went wrong") + ". Try again.", true); var m = $("buildMsg") || $("editMsg"); if (m) m.textContent = r && r.error ? r.error : ""; return; }
        absorb(r); buildSeq();
        setSaved("Saved " + stamp());
        then(r);
      })
      .catch(function (e) { busy(false); if (e.message !== "signed out") setSaved("Not saved: no connection. Check the signal and try again.", true); });
  }
  function saveAnswer(stage, qid, payload, then) {
    if (PREVIEW) { setSaved("Preview: nothing is saved"); return; }   /* never a write in preview */
    if (saving) return;
    busy(true); setSaved("Saving");
    RAM.apiJSON("/answers", { method: "POST", json: { stage: stage, question: qid, payload: payload, answered_by: who } })
      .then(function (r) {
        busy(false);
        if (!r || !r.ok) { setSaved("Not saved: " + (r && r.error ? r.error : "something went wrong") + ". Try again.", true); return; }
        latest[stage] = latest[stage] || {};
        latest[stage][qid] = { payload: payload, answered_by: who, ts_utc: new Date().toISOString() };
        absorb(r);
        setSaved((payload.cleared ? "Cleared " : "Saved ") + stamp());
        then(r);
      })
      .catch(function (e) { busy(false); if (e.message !== "signed out") setSaved("Not saved: no connection. Check the signal and tap Next again.", true); });
  }
  function saveThen(then) {
    var it = seq[idx];
    if (it.kind === "done" || it.kind === "build") { then(); return; }
    if (it.kind === "candidate") { saveCandidate(it, then); return; }
    var bad = validate();
    if (bad) { setSaved("Not saved: " + bad + ".", true); return; }
    var payload = readAnswer(), prev = ans(it.stage, it.q.id);
    if (payload === null) {
      /* Blank with no earlier answer: skip. Blank over an earlier answer: erase it (#7). */
      if (!prev) { then(); return; }
      payload = { cleared: true };
    }
    if (prev && JSON.stringify(prev) === JSON.stringify(payload)) { then(); return; }
    saveAnswer(it.stage, it.q.id, payload, function () { buildSeq(); then(); });
  }

  /* ---------- nav ---------- */
  function advance(dir) {
    var it = seq[idx];
    /* Leaving the last question of a step that came from the checklist: back to the checklist. */
    if (dir > 0 && pendingReturn && it.kind === "stage" && it.i === it.t) {
      var parts = pendingReturn.split("|"), j = findIdx(parts[0], parts[1]); pendingReturn = "";
      if (j >= 0) { idx = j; render(); return; }
    }
    idx = Math.max(0, Math.min(seq.length - 1, idx + dir)); render();
  }
  function skipStep() {
    var it = seq[idx], i = idx;
    while (i < seq.length - 1 && seq[i].stage === it.stage) i++;
    idx = i; render();
  }
  $("btnNext").addEventListener("click", function () {
    if (PREVIEW) { previewCapture(); showStop(seq[idx].kind === "done" ? 0 : tourIdx + 1); return; }
    if (seq[idx].kind === "done") { idx = 0; render(); return; }
    saveThen(function () { advance(1); });
  });
  $("btnBack").addEventListener("click", function () { if (PREVIEW) { previewCapture(); showStop(tourIdx - 1); return; } saveThen(function () { advance(-1); }); });

  /* ---------- preview (URL only: ?preview=1) ---------- */
  /* The demo record: three sample steps, no answers yet. The strip, the list, the tally
     and the checklist are computed here, the same way the server does it, from whatever
     the consultant types while rehearsing. Nothing leaves the page. */
  function demoRecompute() {
    var me = Q.me_name, base = Q.per_stage.map(function (q) { return q.id; });
    summary = steps.map(function (s) {
      var a = latest[s.id] || {};
      function P(q) { var r = a[q]; return r && r.payload && !r.payload.cleared ? r.payload : null; }
      var w = P("who"), whoNames = w ? (w.names || []).concat(w.other ? [w.other] : []) : [];
      var hi = hoursInfo(s.id), hp = P("hours"), hours = "";
      if (hp) {
        if (hp.hours != null && hp.hours !== "" && !isNaN(Number(hp.hours))) { var fh = Number(hp.hours); hours = fh + " " + (fh === 1 && /s$/.test(hi.unit) ? hi.unit.slice(0, -1) : hi.unit); }
        if (hp.depends) hours += (hours ? "; " : "") + "it depends" + (hp.why ? ": " + hp.why : "");
      }
      var wp = P("wrong"), okp = P("ok"), ok = okp ? okp.choice : "", bp = P("before");
      return { id: s.id, n: s.n, name: s.title, short: s.title, text: s.text, source: s.source, candidate: s.candidate,
        who: whoNames, hours: hours, before: bp ? bp.text : "", wrong: wp ? wp.text : "", flags: wp && wp.flag ? 1 : 0,
        ok: ok, locked: ok === "Yes, always" || ok === "Sometimes", me_does: whoNames.indexOf(me) >= 0,
        me_alone: whoNames.length === 1 && whoNames[0] === me, answered: base.filter(function (q) { return !!P(q); }).length, total: base.length };
    });
    var does = summary.filter(function (s) { return s.me_does; }), alone = summary.filter(function (s) { return s.me_alone; }), n = summary.length, mf = meFirst();
    var line = n ? n + " step" + (n !== 1 ? "s" : "") + " so far. " + mf + " does " + does.length + " of " + n + "." + (alone.length ? " " + alone.length + " alone." : "") : "No steps yet.";
    tallyObj = { me: mf, steps: n, me_does: does.length, me_alone: alone.length, line: line };
    cands = Q.candidates.map(function (c) {
      var m = null;
      steps.forEach(function (s) { if (m) return; var hay = (s.title + " " + s.text).toLowerCase(); if ((c.keywords || []).some(function (k) { return hay.indexOf(String(k).toLowerCase()) >= 0; })) m = s; });
      return { id: c.id, title: c.title, sub: c.sub, choice: "", matched: false, step: null, match: m ? { id: m.id, n: m.n, name: m.title } : null };
    });
  }
  /* What the consultant typed on a question screen goes into the demo record (so the
     tally and the strip move), never to the server. */
  function previewCapture() {
    var it = seq[idx]; if (!it || $("qcard").hidden) return;
    if (it.kind !== "opening" && it.kind !== "stage" && it.kind !== "closing") return;
    try { var p = readAnswer(); if (p) { latest[it.stage] = latest[it.stage] || {}; latest[it.stage][it.q.id] = { payload: p, answered_by: "Preview", ts_utc: new Date().toISOString() }; demoRecompute(); } } catch (e) { }
  }
  /* The tour: every screen type in order. Each stop renders one screen. */
  function buildTour() {
    var t = [{ k: "intro" }];
    seq.forEach(function (it, i) { if (it.kind === "opening") t.push({ k: "seq", i: i }); });
    t.push({ k: "build", mode: "first" });
    t.push({ k: "build", mode: "list" });
    t.push({ k: "edit", id: steps[0].id });
    Q.per_stage.forEach(function (q) { t.push({ k: "seq", i: findIdx(steps[0].id, q.id), open: q.type === "problem" ? "flag" : (q.type === "approval" ? "ok" : "") }); });
    var matched = "", cold = "";
    cands.forEach(function (c) { if (c.match && !matched) matched = c.id; if (!c.match && !cold) cold = c.id; });
    if (matched) t.push({ k: "seq", i: findIdx("candidates", matched) });
    if (cold) { t.push({ k: "seq", i: findIdx("candidates", cold) }); t.push({ k: "seq", i: findIdx("candidates", cold), open: "place" }); }
    Q.closing.questions.forEach(function (q) { t.push({ k: "seq", i: findIdx("closing", q.id) }); });
    t.push({ k: "seq", i: seq.length - 1 });
    tour = t.filter(function (s) { return s.k !== "seq" || s.i >= 0; });
  }
  function showStop(n) {
    tourIdx = Math.max(0, Math.min(tour.length - 1, n));
    var s = tour[tourIdx];
    if (s.k === "intro") renderIntro();
    else if (s.k === "build") { previewBuild = s.mode; idx = findIdx("phase1", "done"); render(); previewBuild = ""; }
    else if (s.k === "edit") renderEdit(s.id);
    else {
      idx = s.i; render();
      var opt;
      if (s.open === "flag" && $("btnFlag") && !$("btnFlag").classList.contains("on")) $("btnFlag").click();
      if (s.open === "ok") { opt = document.querySelector('#opts .opt[data-val="' + esc(Q.approval_options[0]) + '"]'); if (opt && !opt.classList.contains("on")) opt.click(); }
      if (s.open === "place") { opt = document.querySelector('#opts .opt[data-val="' + esc(Q.candidates_screen.options[0]) + '"]'); if (opt && !opt.classList.contains("on")) opt.click(); }
    }
    var lbl = $("previewStop"); if (lbl) lbl.textContent = "Screen " + (tourIdx + 1) + " of " + tour.length;
  }
  function leaveHref() {
    var q = location.search.replace(/([?&])preview=1(&|$)/, function (m, p, e) { return e ? p : ""; }).replace(/[?&]$/, "");
    return location.pathname + (q && q !== "?" ? q : "");
  }
  function startPreview() {
    steps = DEMO_STEPS.map(function (t, i) { return { id: "s0" + (i + 1), n: i + 1, title: t, text: t, source: "own", candidate: "", created_by: "Preview" }; });
    latest = {}; p1done = true; who = "Preview";
    demoRecompute(); buildSeq();
    $("whoToggle").hidden = true;
    var band = el('<div class="preview-band" id="previewBand"><div class="preview-row"><strong>PREVIEW.</strong> Nothing you do here is saved. <a href="' + esc(leaveHref()) + '" id="leavePreview">Leave preview</a></div><div class="preview-hint">Next always moves to the next screen, in the order the owner will see them. <span id="previewStop"></span></div></div>');
    document.body.insertBefore(band, document.body.firstChild);
    setSaved("Preview: nothing is saved");
    buildTour(); showStop(0);
    window.RAMWIZ = { seq: function () { return seq; }, latest: function () { return latest; }, steps: function () { return steps; }, tally: function () { return tallyObj; }, go: function (i) { idx = i; render(); }, idx: function () { return idx; }, edit: renderEdit, preview: true, tour: function () { return tour; }, stop: function () { return tourIdx; } };
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.tagName === "INPUT" && e.target.id !== "gatePassword" && !$("qcard").hidden && !$("navBar").hidden) { e.preventDefault(); $("btnNext").click(); } });

  /* ---------- boot ---------- */
  RAM.gate(function (cfg) {
    Q = cfg;
    $("appSub").hidden = false;
    if ($("h1sub")) $("h1sub").hidden = false;
    if (PREVIEW) { startPreview(); return; }   /* no record read, no record write */
    buildWho();
    RAM.apiJSON("/answers").then(function (r) {
      absorb(r);
      buildSeq(); idx = firstUnanswered();
      var c = answeredCount();
      setSaved(c.n || steps.length ? c.n + " answered so far" : "Let's start.");
      if ((c.n || steps.length) && idx > 0) {
        var it = seq[idx];
        var where = it.kind === "done" ? "the last screen" : it.kind === "build" ? "your list of steps" : it.kind === "candidate" ? "the checklist, item " + it.i + " of " + it.t : it.kind === "stage" ? "step " + it.st.n + ", " + it.st.title : it.label;
        resumeCue = "Picking up at " + where + (it.q.text && it.kind !== "done" && it.kind !== "build" ? ": " + it.q.text : "");
      }
      if (c.n === 0 && !steps.length && Q.intro) renderIntro(); else render();
      window.RAMWIZ = { seq: function () { return seq; }, latest: function () { return latest; }, steps: function () { return steps; }, tally: function () { return tallyObj; }, go: function (i) { idx = i; render(); }, idx: function () { return idx; }, edit: renderEdit };
    }).catch(function (e) { if (e.message !== "signed out") setSaved("Could not load the answers: " + e.message, true); });
  });
})();
