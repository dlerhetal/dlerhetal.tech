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
    if ("value" in p) { return (p.value == null ? "" : p.value) + (p.high != null ? " to " + p.high : "") + (p.note ? " (" + p.note + ")" : ""); }
    if ("text" in p) return p.text;
    if ("title" in p) return p.title + (p.after ? " (after " + (p.after === "first" ? "nothing, first" : stepLabel(p.after)) + ")" : "") + (p.candidate ? " [from the checklist]" : "");
    if ("dir" in p) return "moved " + p.dir + (p.after ? ", now after " + stepLabel(p.after) : (p.after === "first" ? ", now first" : ""));
    return JSON.stringify(p);
  }
  function stepLabel(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].n + ". " + STEPS[i].title; if (DELETED[id]) return id + " (" + DELETED[id].title + ", taken out)"; return id; }
  function qText(stage, qid) {
    var pool = [];
    if (stage === "opening") pool = Q.opening.questions; else if (stage === "closing") pool = Q.closing.questions;
    else if (stage === "candidates") pool = Q.candidates.map(function (c) { return { id: c.id, text: "Checklist: " + c.title }; });
    else if (stage === "phase1") pool = [{ id: "done", text: "Finished the list of steps" }];
    else pool = Q.per_stage;
    for (var i = 0; i < pool.length; i++) if (pool[i].id === qid) return pool[i].text;
    return qid;
  }
  function stageName(id) { if (id === "opening") return "Opening"; if (id === "closing") return "Closing"; if (id === "candidates") return "Checklist"; if (id === "phase1") return "The list"; return stepLabel(id); }

  function renderStrip(summary) {
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
      renderCandidates(A);
      renderStrip(A.summary || []);
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

  RAM.gate(function (cfg) { Q = cfg; $("appSub").hidden = false; load(); });
})();
