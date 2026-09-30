/* Consultant view: the finding first (how many of his own steps the owner does himself,
   and alone), the checklist verdicts, the map in his order, flagged leaks, every answer
   with who and when, step events, exports. */
(function () {
  "use strict";
  var $ = RAM.$, esc = RAM.esc, fmtTs = RAM.fmtTs;
  var Q = null, STEPS = [], DELETED = {};
  function money(v) { return v == null ? "" : "$" + Number(v).toLocaleString(); }

  function describe(p) {
    if (p == null) return "";
    if (typeof p !== "object") return String(p);
    if (p.cleared) return "(cleared)";
    if ("names" in p) { var n = (p.names || []).slice(); if (p.other) n.push(p.other); return n.join(", "); }
    if ("hours" in p) { var s = p.hours != null ? p.hours + " hours" : ""; if (p.depends) s += (s ? "; " : "") + "it depends" + (p.why ? ": " + p.why : ""); return s; }
    if ("flag" in p) { var t = p.text || ""; if (p.flag) t = "[FLAG " + (p.dollars != null ? money(p.dollars) : "") + (p.how_often ? ", " + p.how_often : "") + "] " + t; return t; }
    if ("choice" in p) { return p.choice + (p.who ? " (could decide instead: " + p.who + ")" : "") + (p.step_id ? (p.matched ? " (already step " : " (became step ") + stepLabel(p.step_id) + ")" : ""); }
    if ("done" in p) return p.done ? "Finished the list" : "";
    if ("list" in p) return (p.list || []).length ? (p.list || []).join("; ") : "(none)";
    if ("value" in p) { return (p.value == null ? "" : p.value) + (p.high != null ? " to " + p.high : "") + (p.note ? " (" + p.note + ")" : ""); }
    if ("text" in p) return p.text;
    if ("title" in p) return p.title + (p.after ? " (after " + (p.after === "first" ? "nothing, first" : stepLabel(p.after)) + ")" : "") + (p.candidate ? " [from the checklist]" : "");
    if ("dir" in p) return "moved " + p.dir + (p.after ? ", now after " + stepLabel(p.after) : (p.after === "first" ? ", now first" : ""));
    return JSON.stringify(p);
  }
  function stepLabel(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].n + ". " + STEPS[i].title; if (DELETED[id]) return id + " (" + DELETED[id].title + ", taken out)"; return id; }
  function qText(stage, qid) {
    var pool = [];
    if (stage === "opening" && qid === "other_starts") return (Q.build.other_starts || {}).text || "Other ways a job starts";
    if (stage === "opening") pool = Q.opening.questions; else if (stage === "closing") pool = Q.closing.questions;
    else if (stage === "candidates") pool = Q.candidates.map(function (c) { return { id: c.id, text: "Checklist: " + c.title }; });
    else if (stage === "phase1") pool = [{ id: "done", text: "Finished the list of steps" }];
    else pool = Q.per_stage;
    for (var i = 0; i < pool.length; i++) if (pool[i].id === qid) return pool[i].text;
    return qid;
  }
  function stageName(id) { if (id === "opening") return "Opening"; if (id === "closing") return "Closing"; if (id === "candidates") return "Checklist"; if (id === "phase1") return "The list"; return stepLabel(id); }

  function renderStrip(summary, starts) {
    var s = $("strip"); s.innerHTML = "";
    summary.forEach(function (st) {
      s.insertAdjacentHTML("beforeend", '<div class="sbox' + (st.answered ? " has" : "") + (st.me_alone ? " alone" : "") + '"><div class="sn">' + st.n + '</div><div class="sname">' + esc(st.name) + '</div>' +
        (st.source === "candidate" ? '<div class="sline dim">from the checklist</div>' : "") +
        '<div class="sline">' + (st.who.length ? esc(st.who.join(", ")) : '<span class="dim">who?</span>') + '</div>' +
        '<div class="sline">' + (st.hours ? esc(st.hours) : '<span class="dim">hours?</span>') + '</div>' +
        (st.before ? '<div class="sline wait">Waiting on: ' + esc(st.before) + '</div>' : "") +
        (st.wrong ? '<div class="sline pain">' + esc(st.wrong) + '</div>' : "") +
        '<div class="sicons">' + (st.me_alone ? '<span class="salone">alone</span>' : "") + (st.flags ? '<span class="sflag">' + st.flags + '</span>' : "") + (st.locked ? '<span class="slock">&#128274; ' + esc(st.ok) + '</span>' : (st.ok ? '<span class="sok">' + esc(st.ok) + '</span>' : "")) + '</div>' +
        '<div class="sbar"><i style="width:' + Math.round(100 * st.answered / st.total) + '%"></i></div></div>');
      if (st.n === 1) (starts || []).forEach(function (t) { s.insertAdjacentHTML("beforeend", '<div class="sbox sstart"><div class="sname">' + esc((Q.build.other_starts || {}).strip_label || "also starts as:") + '</div><div class="sline sstarttext">' + esc(t) + '</div></div>'); });
    });
    if (!summary.length) s.innerHTML = '<p class="pdesc">No steps yet.</p>';
  }

  function renderFinding(A) {
    var T = A.tally || {}, me = T.me || "The owner";
    $("findingLine").textContent = T.line || "No steps yet.";
    var html = "";
    if (T.alone_steps && T.alone_steps.length) {
      html += '<h3>Steps ' + esc(me) + ' does alone (' + T.alone_steps.length + ')</h3><ol class="finding-list">' + T.alone_steps.map(function (s) { return '<li>' + esc(s.n + ". " + s.name) + '</li>'; }).join("") + '</ol>';
    }
    var withOthers = (T.does_steps || []).filter(function (s) { return s.who.length > 1; });
    if (withOthers.length) {
      html += '<h3>Steps ' + esc(me) + ' does with others (' + withOthers.length + ')</h3><ol class="finding-list">' + withOthers.map(function (s) { return '<li>' + esc(s.n + ". " + s.name) + ' <span class="dim">(' + esc(s.who.join(", ")) + ')</span></li>'; }).join("") + '</ol>';
    }
    var noWho = (A.summary || []).filter(function (s) { return !s.who.length; });
    html += '<p class="pdesc">' + (T.steps || 0) + ' steps in the list; ' + (T.answered_who || 0) + ' have a Who answer' + (noWho.length ? '; not yet answered: ' + esc(noWho.map(function (s) { return s.n + ". " + s.name; }).join("; ")) : "") + '.</p>';
    $("findingBody").innerHTML = html;
  }

  /* How work arrives: step 1 in his words, then the other ways a job starts. */
  function renderArrives(A) {
    var OS = Q.build.other_starts || {}, r = (A.latest && A.latest.opening && A.latest.opening.other_starts) || null;
    var list = r && r.payload && !r.payload.cleared && r.payload.list ? r.payload.list : [];
    var s1 = (A.steps || [])[0];
    $("arrivesTitle").textContent = OS.admin_title || "How work arrives";
    var html = s1 ? '<p class="finding-line">Step 1, in the owner\'s words: <strong>' + esc(s1.title) + '</strong></p>' : '<p class="pdesc">No first step yet.</p>';
    if (list.length) html += '<h3>Also starts as (' + list.length + ')</h3><ol class="finding-list" id="arrivesList">' + list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ol><p class="pdesc">' + esc(r.answered_by) + ', ' + esc(fmtTs(r.ts_utc)) + '</p>';
    else html += '<p class="pdesc">No other way in named' + (s1 ? ' (asked once, right after step 1)' : '') + '.</p>';
    $("arrivesBody").innerHTML = html;
  }

  /* The script: every screen the wizard shows, in order, numbered, from the config. */
  function renderScript() {
    var n = 0, out = [], B = Q.build, OS = B.other_starts || {}, C = Q.candidates_screen, hq = null;
    Q.per_stage.forEach(function (q) { if (q.id === "hours") hq = q; });
    function screen(title, lines) { n++; out.push('<section class="scr"><h3><span class="scrn">' + n + '.</span> ' + esc(title) + '</h3>' + lines.join("") + '</section>'); }
    function say(t) { return '<p class="say">' + esc(t) + '</p>'; }
    function sub(t) { return t ? '<p class="saysub">' + esc(t) + '</p>' : ""; }
    function btns(list) { return '<p class="saybtn">Buttons: ' + list.map(function (b) { return '<span class="pill">' + esc(b) + '</span>'; }).join(" ") + '</p>'; }
    function note(t) { return '<p class="saynote">' + esc(t) + '</p>'; }
    screen("Before we start", [say(Q.intro || ""), btns(["Let's start"])]);
    Q.opening.questions.forEach(function (q, i) {
      var l = [note(Q.opening.title + ". Question " + (i + 1) + " of " + Q.opening.questions.length), say(q.text), sub(q.sub)];
      l.push(note(q.range ? "Two number boxes, Low and High, in " + q.unit + (q.note ? ", and a note box." : ".") : "A number box in " + q.unit + (q.note ? ", and a note box." : ".")));
      l.push(btns(["Back", "Next"]));
      screen(q.text, l);
    });
    screen(B.title + ": the first step", [note(B.title), say(B.first_text), sub(B.first_sub), note("One text box. Enter is the same as tapping " + B.then_label), btns([B.then_label, B.done_label])]);
    if (OS.text) screen(OS.text, [note("Shown once, right after step 1 is saved."), say(OS.text), sub(OS.sub), note("A text box; each entry shows as a chip above it."), btns([OS.add_label || "Add another way", OS.then_label || "Then what?"])]);
    screen(B.title + ": the loop", [say(B.next_text), sub('After "<the last step>": ' + B.next_sub), note("The list of his steps grows under the buttons, numbered, in his order. " + B.edit_hint), btns([B.then_label, B.done_label]), note("Coming back later: " + B.again_text + " / " + B.again_sub + " / button: " + B.done_again_label)]);
    screen("This step (tap a step in the list or the map)", [say("This step"), sub("Change the words, move it, or take it out of the list."), btns(["Save the new name", "Move up", "Move down", "Take this step out", "Answer the questions about this step", "Back"]), note("Take this step out asks first; its answers stay on record.")]);
    Q.per_stage.forEach(function (q, i) {
      var l = [note("Step n of N: <his title>. Question " + (i + 1) + " of " + Q.per_stage.length + " about this step"), say(q.text), sub(q.sub)];
      if (q.type === "people") l.push(note("Chips: " + (Q.who_extra || []).concat(Q.roster.map(function (r) { return r === Q.me_name ? "Me (" + r + ")" : r; })).join(", ") + ". Plus an Other box."));
      if (q.type === "hours") { l.push(note("Unit: " + q.unit + ". Plus an It depends box with On what? One line.")); l.push(note("Office wording, when everyone named is in the office (" + (Q.office_names || []).join(", ") + "): " + q.sub_office + " Unit: " + q.unit_office + ".")); }
      if (q.type === "problem") l.push(note("Button: Flag it: this costs real money. Opens: Rough guess, dollars each time it happens ($ box), How often? " + Q.how_often_options.join(" / ") + ". Flagged reads: Flagged as a money leak (tap to unflag)."));
      if (q.type === "approval") { l.push(btns(Q.approval_options)); l.push(note("Follow-up unless No: " + Q.approval_followup.text + " " + (Q.approval_followup.sub || ""))); }
      l.push(note("Link: " + (Q.skip_label || "Skip this step for now"))); l.push(btns(["Back", "Next"]));
      screen(q.text, l);
    });
    var cl = [note("Shown once the list is finished. Counter: Checklist i of " + Q.candidates.length), sub(C.intro), say(C.question), btns(C.options),
      note("Already covered by a step he named (keyword match): " + C.matched_text.replace("{n}", "n").replace("{title}", "<his title>")), btns(C.matched_options),
      note("Reopened later: This is step n in your list. with " + C.options.join(" / ") + "; changing to No takes the step out of the list."),
      '<ol class="scritems">' + Q.candidates.map(function (c, i) { return '<li><span class="scrn">' + n + "." + (i + 1) + '</span> <strong>' + esc(c.title) + '</strong><br><span class="saysub">' + esc(c.sub) + '</span></li>'; }).join("") + '</ol>'];
    screen(C.title + " (" + Q.candidates.length + " items)", cl);
    screen(C.place_text, [note("After Yes or Sometimes on a checklist item, or It is a separate step."), say(C.place_text), sub(C.place_sub), note("Picker: " + C.place_first + "; " + C.place_after.replace("{n}", "n").replace("{title}", "<his title>") + " for every step (the last one preselected). Next puts the step there and opens its five questions, then returns to the checklist.")]);
    Q.closing.questions.forEach(function (q) { screen(q.text, [note(Q.closing.title), say(q.text), sub(q.sub), btns(["Back", "Finish"])]); });
    screen("Done", [say("That is everything I have for now."), sub(Q.closing.done_text), note("<the tally line> You have answered n of t questions. Tap Back, or tap any step in the map above, to fill in the rest."), btns([Q.closing.done_label, "Back to the top"]), note("After the button: Saved. You can close this page. Open the same link any time to come back.")]);
    $("scriptBody").innerHTML = out.join("");
  }
  $("btnPrintScript").addEventListener("click", function () {
    document.body.classList.add("print-script");
    var off = function () { document.body.classList.remove("print-script"); window.removeEventListener("afterprint", off); };
    window.addEventListener("afterprint", off);
    window.print();
    setTimeout(off, 2000);
  });

  function renderCandidates(A) {
    var rows = A.candidates || [], me = (A.tally && A.tally.me) || "The owner";
    var rej = rows.filter(function (c) { return c.choice === "No"; }), yes = rows.filter(function (c) { return c.choice === "Yes" || c.choice === "Sometimes"; }), open = rows.filter(function (c) { return !c.choice; });
    var html = "";
    if (rej.length) html += '<h3 class="rej">' + esc(me) + ' says they do not do this (' + rej.length + ')</h3><ul class="finding-list">' + rej.map(function (c) { return '<li>' + esc(c.title) + ' <span class="dim">(' + esc(c.answered_by) + ", " + esc(fmtTs(c.ts_utc)) + ')</span></li>'; }).join("") + '</ul>';
    if (yes.length) html += '<h3>Yes or Sometimes (' + yes.length + ')</h3><ul class="finding-list">' + yes.map(function (c) { return '<li>' + esc(c.title) + ': ' + esc(c.choice) + (c.step ? (c.matched ? ', already step ' : ', now step ') + esc(c.step.n + ". " + c.step.name) : "") + '</li>'; }).join("") + '</ul>';
    if (open.length) html += '<p class="pdesc">Not asked yet: ' + open.length + ' of ' + rows.length + (A.phase1_done ? "" : " (the checklist starts once the owner finishes his list)") + '.</p>';
    $("candBox").innerHTML = html || '<p class="pdesc">No checklist answers yet.</p>';
  }

  function load() {
    Promise.all([RAM.apiJSON("/answers"), RAM.apiJSON("/history")]).then(function (res) {
      var A = res[0], H = res[1];
      STEPS = A.steps || []; DELETED = A.deleted || {};
      renderFinding(A);
      renderArrives(A);
      renderCandidates(A);
      var osr = (A.latest && A.latest.opening && A.latest.opening.other_starts) || null;
      renderStrip(A.summary || [], osr && osr.payload && !osr.payload.cleared ? (osr.payload.list || []) : []);
      var dk = Object.keys(DELETED);
      $("deletedNote").textContent = dk.length ? "Taken out of the list: " + dk.map(function (k) { return DELETED[k].title + " (" + DELETED[k].deleted_by + ")"; }).join("; ") : "";
      var tb = $("udeTable").querySelector("tbody"); tb.innerHTML = "";
      (A.udes || []).forEach(function (u) {
        tb.insertAdjacentHTML("beforeend", '<tr class="ude-row"><td>' + esc(u.stage) + '</td><td>' + esc(u.text) + '</td><td class="num">' + esc(money(u.dollars)) + '</td><td>' + esc(u.how_often) + '</td><td>' + esc(u.answered_by) + '</td><td>' + esc(fmtTs(u.ts_utc)) + '</td></tr>');
      });
      $("udeEmpty").textContent = (A.udes || []).length ? "" : "Nothing flagged yet.";
      var box = $("latestBox"); box.innerHTML = "";
      var order = ["opening", "phase1"].concat(STEPS.map(function (s) { return s.id; })).concat(["candidates", "closing"]);
      Object.keys(A.latest || {}).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
      var count = 0;
      order.forEach(function (sid) {
        var a = A.latest[sid]; if (!a) return;
        var html = '<h3>' + esc(stageName(sid)) + '</h3><table class="latest"><tbody>';
        Object.keys(a).forEach(function (qid) { count++; var r = a[qid]; html += '<tr><td class="qcol">' + esc(qText(sid, qid)) + '</td><td>' + esc(describe(r.payload)) + '</td><td class="meta">' + esc(r.answered_by) + '<br>' + esc(fmtTs(r.ts_utc)) + '</td></tr>'; });
        box.insertAdjacentHTML("beforeend", html + "</tbody></table>");
      });
      if (!count) box.innerHTML = '<p class="pdesc">No answers yet.</p>';
      var sb = $("stepTable").querySelector("tbody"); sb.innerHTML = "";
      (H.step_events || []).forEach(function (r) {
        sb.insertAdjacentHTML("beforeend", '<tr><td>' + r.id + '</td><td>' + esc(r.ts_utc) + '</td><td>' + esc(stepLabel(r.step_id)) + '</td><td>' + esc(r.event) + '</td><td>' + esc(r.answered_by) + '</td><td class="mono">' + esc(r.ip_hash) + '</td><td>' + esc(describe(r.payload)) + '</td></tr>');
      });
      var hb = $("histTable").querySelector("tbody"); hb.innerHTML = "";
      (H.rows || []).forEach(function (r) {
        hb.insertAdjacentHTML("beforeend", '<tr><td>' + r.id + '</td><td>' + esc(r.ts_utc) + '</td><td>' + esc(stageName(r.stage_id)) + '</td><td>' + esc(qText(r.stage_id, r.question_id)) + '</td><td>' + esc(r.answered_by) + '</td><td class="mono">' + esc(r.ip_hash) + '</td><td>' + esc(describe(r.payload)) + '</td></tr>');
      });
      $("adminState").textContent = (H.rows || []).length + " rows on record, " + (H.step_events || []).length + " step events, " + STEPS.length + " steps, " + (A.udes || []).length + " flagged";
    }).catch(function (e) { if (e.message !== "signed out") $("adminState").textContent = "Could not load: " + e.message; });
  }

  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()); }
  $("btnExport").addEventListener("click", function () { RAM.download("/export", "ProcessMap_" + stamp() + ".json").then(function () { $("exportMsg").textContent = "Export saved to your downloads folder. In Advanced, use Data and print, Import JSON."; }); });
  $("btnCsv").addEventListener("click", function () { RAM.download("/record.csv", "map_record_" + stamp() + ".csv").then(function () { $("exportMsg").textContent = "Record CSV saved to your downloads folder."; }); });
  $("btnClearTest").addEventListener("click", function () {
    if (!confirm("Delete every row whose answered_by is TEST (answers, step events and Advanced saves)? Real answers are untouched.")) return;
    RAM.apiJSON("/clear-test", { method: "POST" }).then(function (r) {
      $("exportMsg").textContent = r.ok ? ("Deleted " + r.deleted_answers + " test answers, " + r.deleted_steps + " test step events and " + r.deleted_snapshots + " test snapshots.") : ("Failed: " + r.error);
      load();
    });
  });

  RAM.gate(function (cfg) { Q = cfg; $("appSub").hidden = false; renderScript(); load(); });
})();
