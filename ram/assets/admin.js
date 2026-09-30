/* Consultant view: full map, every answer with who and when, flagged UDEs, exports. */
(function () {
  "use strict";
  var $ = RAM.$, esc = RAM.esc, fmtTs = RAM.fmtTs;
  var Q = null;
  function money(v) { return v == null ? "" : "$" + Number(v).toLocaleString(); }

  function describe(p) {
    if (p == null) return "";
    if (typeof p !== "object") return String(p);
    if ("names" in p) { var n = (p.names || []).slice(); if (p.other) n.push(p.other); return n.join(", "); }
    if ("hours" in p) { var s = p.hours != null ? p.hours + " crew hours" : ""; if (p.depends) s += (s ? "; " : "") + "it depends" + (p.why ? ": " + p.why : ""); return s; }
    if ("flag" in p) { var t = p.text || ""; if (p.flag) t = "[FLAG " + (p.dollars != null ? money(p.dollars) : "") + (p.how_often ? ", " + p.how_often : "") + "] " + t; return t; }
    if ("choice" in p) { return p.choice + (p.who ? " (could decide instead: " + p.who + ")" : ""); }
    if ("value" in p) { return (p.value == null ? "" : p.value) + (p.note ? " (" + p.note + ")" : ""); }
    if ("text" in p) return p.text;
    return JSON.stringify(p);
  }
  function qText(stage, qid) {
    var pool = [];
    if (stage === "opening") pool = Q.opening.questions; else if (stage === "closing") pool = Q.closing.questions;
    else { pool = Q.per_stage.slice(); (Q.branches || []).forEach(function (b) { if (b.stage === stage) { pool.push(b.gate); pool = pool.concat(b.questions); } }); }
    for (var i = 0; i < pool.length; i++) if (pool[i].id === qid) return pool[i].text;
    return qid;
  }
  function stageName(id) { if (id === "opening") return "Opening"; if (id === "closing") return "Closing"; for (var i = 0; i < Q.stages.length; i++) if (Q.stages[i].id === id) return Q.stages[i].n + ". " + Q.stages[i].name; return id; }

  function renderStrip(summary) {
    var s = $("strip"); s.innerHTML = "";
    summary.forEach(function (st) {
      s.insertAdjacentHTML("beforeend", '<div class="sbox' + (st.answered ? " has" : "") + '"><div class="sn">' + st.n + '</div><div class="sname">' + esc(st.name) + '</div>' +
        '<div class="sline">' + (st.who.length ? esc(st.who.join(", ")) : '<span class="dim">who?</span>') + '</div>' +
        '<div class="sline">' + (st.hours ? esc(st.hours) : '<span class="dim">hours?</span>') + '</div>' +
        (st.before ? '<div class="sline wait">Waiting on: ' + esc(st.before) + '</div>' : "") +
        (st.wrong ? '<div class="sline pain">' + esc(st.wrong) + '</div>' : "") +
        '<div class="sicons">' + (st.flags ? '<span class="sflag">' + st.flags + '</span>' : "") + (st.locked ? '<span class="slock">&#128274; ' + esc(st.ok) + '</span>' : (st.ok ? '<span class="sok">' + esc(st.ok) + '</span>' : "")) + '</div>' +
        '<div class="sbar"><i style="width:' + Math.round(100 * st.answered / st.total) + '%"></i></div></div>');
    });
  }

  function load() {
    Promise.all([RAM.apiJSON("/answers"), RAM.apiJSON("/history")]).then(function (res) {
      var A = res[0], H = res[1];
      renderStrip(A.summary || []);
      var tb = $("udeTable").querySelector("tbody"); tb.innerHTML = "";
      (A.udes || []).forEach(function (u) {
        tb.insertAdjacentHTML("beforeend", '<tr class="ude-row"><td>' + esc(u.stage) + '</td><td>' + esc(u.text) + '</td><td class="num">' + esc(money(u.dollars)) + '</td><td>' + esc(u.how_often) + '</td><td>' + esc(u.answered_by) + '</td><td>' + esc(fmtTs(u.ts_utc)) + '</td></tr>');
      });
      $("udeEmpty").textContent = (A.udes || []).length ? "" : "Nothing flagged yet.";
      var box = $("latestBox"); box.innerHTML = "";
      var order = ["opening"].concat(Q.stages.map(function (s) { return s.id; })).concat(["closing"]);
      var count = 0;
      order.forEach(function (sid) {
        var a = A.latest[sid]; if (!a) return;
        var html = '<h3>' + esc(stageName(sid)) + '</h3><table class="latest"><tbody>';
        Object.keys(a).forEach(function (qid) { count++; var r = a[qid]; html += '<tr><td class="qcol">' + esc(qText(sid, qid)) + '</td><td>' + esc(describe(r.payload)) + '</td><td class="meta">' + esc(r.answered_by) + '<br>' + esc(fmtTs(r.ts_utc)) + '</td></tr>'; });
        box.insertAdjacentHTML("beforeend", html + "</tbody></table>");
      });
      if (!count) box.innerHTML = '<p class="pdesc">No answers yet.</p>';
      var hb = $("histTable").querySelector("tbody"); hb.innerHTML = "";
      (H.rows || []).forEach(function (r) {
        hb.insertAdjacentHTML("beforeend", '<tr><td>' + r.id + '</td><td>' + esc(r.ts_utc) + '</td><td>' + esc(stageName(r.stage_id)) + '</td><td>' + esc(qText(r.stage_id, r.question_id)) + '</td><td>' + esc(r.answered_by) + '</td><td class="mono">' + esc(r.ip_hash) + '</td><td>' + esc(describe(r.payload)) + '</td></tr>');
      });
      $("adminState").textContent = (H.rows || []).length + " rows on record, " + count + " current answers, " + (A.udes || []).length + " flagged";
    }).catch(function (e) { if (e.message !== "signed out") $("adminState").textContent = "Could not load: " + e.message; });
  }

  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()); }
  $("btnExport").addEventListener("click", function () { RAM.download("/export", "ProcessMap_" + stamp() + ".json").then(function () { $("exportMsg").textContent = "Export saved to your downloads folder. In Advanced, use Data and print, Import JSON."; }); });
  $("btnCsv").addEventListener("click", function () { RAM.download("/record.csv", "map_record_" + stamp() + ".csv").then(function () { $("exportMsg").textContent = "Record CSV saved to your downloads folder."; }); });
  $("btnClearTest").addEventListener("click", function () {
    if (!confirm("Delete every row whose answered_by is TEST? Real answers are untouched.")) return;
    RAM.apiJSON("/clear-test", { method: "POST" }).then(function (r) {
      $("exportMsg").textContent = r.ok ? ("Deleted " + r.deleted_answers + " test answers and " + r.deleted_snapshots + " test snapshots.") : ("Failed: " + r.error);
      load();
    });
  });

  RAM.gate(function (cfg) { Q = cfg; $("appSub").hidden = false; load(); });
})();
