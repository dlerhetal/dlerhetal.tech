/* Fix-list consultant view. Generic: everything arrives from the API after sign-in.
   Shows every pick, done mark, note and step problem, the open questions for the owner
   (with a box to record the answer, saved as an "answer" row by Dale), the full history,
   a CSV of the raw record, and a clear for TEST rows only. */
(function () {
  "use strict";
  var R = window.RAM, esc = R.esc;
  var data = null, view = null;
  var KIND = { pick: "Picked", step: "Moved to step", done: "Marked done", undone: "Undid done", note: "Saved a note",
    ask: "Asked the owner", answer: "Recorded an answer", issue: "Step did not match", reset: "Cleared the pick" };

  function msg(t, bad) { var e = R.$("toolMsg"); e.textContent = t || ""; e.style.color = bad ? "var(--red)" : ""; }
  function card(id) { return data.cards.find(function (c) { return c.id === id; }) || { n: "?", title: id, scenarios: [] }; }
  function scenLabel(c, sid) {
    if (!sid) return "";
    if (sid === "ask") return data.ask_label || "Ask the owner";
    var s = c.scenarios.find(function (x) { return x.id === sid; });
    return s ? s.label : sid;
  }
  function statusLabel(s) { return { done: "Done", waiting_owner: "Waiting on owner", working: "In progress", "new": "Not started" }[s] || s; }

  function renderSummary() {
    var s = view.summary;
    R.$("sumLine").textContent = s.problems + " problems + " + s.prep + " setup steps. " + s.done + " of " + s.cards + " done (" + s.pct + "%).";
    R.$("sumBar").style.width = s.pct + "%";
    R.$("sumGrid").innerHTML =
      '<span class="sumpill done"><b>' + s.done + "</b> done</span>" +
      '<span class="sumpill"><b>' + s.working + "</b> in progress</span>" +
      '<span class="sumpill"><b>' + s.not_started + "</b> not started</span>" +
      '<span class="sumpill wait"><b>' + s.waiting + "</b> waiting (" + s.waiting_owner + " owner, " + s.waiting_cpa + " CPA)</span>" +
      '<span class="sumpill"><b>' + s.open_asks + "</b> open questions</span>";
  }

  function renderAsks() {
    var tb = R.$("askTable").querySelector("tbody"); tb.innerHTML = "";
    var list = view.open_asks || [];
    R.$("askEmpty").textContent = list.length ? "" : "No open questions.";
    list.forEach(function (a) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + esc(a.n + ". " + a.title) + "</td><td>" + esc(a.text) + '</td><td class="meta">' + esc(a.by) + "<br>" + esc(R.fmtTs(a.ts)) + "</td>" +
        '<td class="ansbox"><textarea rows="3" data-ask="' + a.id + '" data-card="' + esc(a.card_id) + '"></textarea>' +
        '<div class="rowbtns"><button type="button" class="btn pri" data-save-ans="' + a.id + '">Save answer</button></div></td>';
      tb.appendChild(tr);
    });
  }

  function renderCards() {
    var tb = R.$("cardTable").querySelector("tbody"); tb.innerHTML = "";
    data.cards.forEach(function (c) {
      var st = view.state[c.id] || {};
      var sc = c.scenarios.find(function (x) { return x.id === st.scenario; });
      var step = sc ? ((st.step || 0) >= sc.steps.length ? "check" : (st.step + 1) + " of " + sc.steps.length) : "";
      var bits = [];
      if (st.note) bits.push("<b>Note</b> (" + esc(st.note_by) + " " + esc(R.fmtTs(st.note_ts)) + "): " + esc(st.note));
      (st.issues || []).forEach(function (x) {
        bits.push('<span class="issueline">Step ' + (Number(x.i) + 1) + " of " + esc(scenLabel(c, x.scenario)) + " did not match (" + esc(x.by) + " " + esc(R.fmtTs(x.ts)) + "): " + esc(x.text) + "</span>");
      });
      (st.asks || []).forEach(function (a) {
        if (a.answer) bits.push("<b>Asked</b>: " + esc(a.text) + " <b>Answer</b> (" + esc(a.answer.by) + "): " + esc(a.answer.text));
      });
      var tr = document.createElement("tr");
      tr.innerHTML = '<td class="num">' + c.n + "</td><td>" + esc(c.title) + '</td><td><span class="pill tag-' + esc(c.tag) + '">' + esc(c.tag_label) + "</span></td>" +
        '<td class="st"><span class="pill st-' + esc(st.status) + '">' + esc(statusLabel(st.status)) + "</span></td>" +
        "<td>" + esc(scenLabel(c, st.scenario)) + (st.picked_by ? '<br><span class="meta">' + esc(st.picked_by) + "</span>" : "") + "</td>" +
        '<td class="meta">' + esc(step) + "</td>" +
        '<td class="meta">' + (st.done ? esc(st.done.by) + "<br>" + esc(R.fmtTs(st.done.ts)) : "") + "</td>" +
        '<td class="note">' + bits.join("<br>") + "</td>" +
        '<td class="meta">' + (st.last_ts ? esc(st.last_by) + "<br>" + esc(R.fmtTs(st.last_ts)) : "") + "</td>";
      tb.appendChild(tr);
    });
  }

  function renderHistory(rows) {
    var tb = R.$("histTable").querySelector("tbody"); tb.innerHTML = "";
    R.$("histEmpty").textContent = rows.length ? "" : "Nothing recorded yet.";
    rows.forEach(function (r) {
      var c = card(r.card_id), p = r.payload || {};
      var d = "";
      if (r.kind === "pick") d = scenLabel(c, p.scenario);
      else if (r.kind === "step") d = scenLabel(c, p.scenario) + ", step " + (Number(p.i) + 1);
      else if (r.kind === "done") d = scenLabel(c, p.scenario);
      else if (r.kind === "issue") d = "Step " + (Number(p.i) + 1) + ": " + (p.text || "");
      else if (r.kind === "answer") d = "Question " + p.ask_id + ": " + (p.text || "");
      else d = p.text || "";
      var tr = document.createElement("tr");
      tr.innerHTML = '<td class="meta">' + esc(R.fmtTs(r.ts_utc)) + "</td><td>" + esc(r.answered_by) + "</td><td>" + esc(c.n + ". " + c.title) + "</td><td>" + esc(KIND[r.kind] || r.kind) + "</td><td>" + esc(d) + "</td>";
      tb.appendChild(tr);
    });
  }

  function load() {
    R.$("adminState").textContent = "Loading";
    return Promise.all([R.apiJSON("/qb/state"), R.apiJSON("/qb/history")]).then(function (res) {
      view = res[0];
      renderSummary(); renderAsks(); renderCards(); renderHistory(res[1].rows || []);
      R.$("adminState").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-save-ans]"); if (!b) return;
    var id = b.dataset.saveAns, t = document.querySelector('textarea[data-ask="' + id + '"]');
    var txt = (t && t.value || "").trim(); if (!txt) { msg("Type the answer first.", true); return; }
    b.disabled = true;
    var by = R.TEST_MODE && /[?&]as=TEST(&|$)/.test(location.search) ? "TEST" : "Dale";
    R.apiJSON("/qb/event", { method: "POST", json: { card: t.dataset.card, kind: "answer", payload: { ask_id: Number(id), text: txt }, answered_by: by } })
      .then(function (r) { if (!r.ok) throw new Error(r.error || "not saved"); msg("Answer saved."); return load(); })
      .catch(function (err) { b.disabled = false; msg("Not saved: " + err.message, true); });
  });

  R.gate(function () {
    R.apiJSON("/qb/cards").then(function (d) {
      data = d;
      document.title = d.client_name + ", fix list: consultant view";
      R.$("appSub").hidden = false;
      return load();
    }).catch(function (e) { if (e.message !== "signed out") msg("Could not load: " + e.message, true); });
    R.$("btnRefresh").addEventListener("click", function () { load().then(function () { msg("Refreshed."); }); });
    R.$("btnCsv").addEventListener("click", function () { R.download("/qb/record.csv", "fix_list_record.csv").catch(function (e) { msg("Download failed: " + e.message, true); }); });
    R.$("btnClearTest").addEventListener("click", function () {
      if (!confirm("Delete every row recorded as TEST? Real rows are not touched.")) return;
      R.apiJSON("/qb/clear-test", { method: "POST", json: {} }).then(function (r) { msg("Removed " + r.deleted + " test rows. " + r.remaining + " real rows remain."); return load(); })
        .catch(function (e) { msg("Clear failed: " + e.message, true); });
    });
  });
})();
