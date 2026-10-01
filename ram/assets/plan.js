/* Engagement plan page: agenda + syllabus, print buttons, talk-back.
   Generic shell: every word of content arrives from GET /plan after sign-in.
   Nothing in this file names a client, a person or an amount. */
(function () {
  "use strict";
  var E = RAM.esc, D = null;
  var STATUS = { done: "Done", started: "Started", not: "Not started" };

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

  function renderAgenda() {
    var a = D.agenda, h = '<h2>' + E(a.title) + '</h2>';
    h += '<div class="blk rulings"><h3>Dale\'s rulings for these two days</h3>' + list(a.rulings) + '</div>';
    a.days.forEach(function (day) {
      h += '<div class="dayhead" id="day-' + E(day.id) + '">' + E(day.label) + '</div>';
      if (day.intro) h += '<p class="lead">' + E(day.intro) + '</p>';
      day.blocks.forEach(function (b) {
        h += '<div class="blk agblk">';
        h += '<span class="timepill">' + E(b.time) + '</span><h3>' + E(b.title) + '</h3>';
        if (b.who) h += '<span class="bwho">Who: ' + E(b.who) + '</span>';
        if (b.goal) h += '<p class="goal"><b>Goal:</b> ' + E(b.goal) + '</p>';
        if (b.prereq && b.prereq.length) h += '<h4>Prerequisites</h4>' + list(b.prereq);
        if (b.bring && b.bring.length) h += '<h4>Bring</h4>' + list(b.bring);
        if (b.checks && b.checks.length) h += '<h4>Check each one</h4>' + list(b.checks, "checks");
        if (b.steps && b.steps.length) {
          h += '<table class="ptable"><thead><tr><th style="width:24%">When</th><th>What</th></tr></thead><tbody>' +
            b.steps.map(function (s) { return '<tr><td data-l="When"><b>' + E(s[0]) + '</b></td><td data-l="What">' + E(s[1]) + '</td></tr>'; }).join("") + '</tbody></table>';
        }
        if (b.decisions && b.decisions.length) {
          h += '<table class="ptable"><thead><tr><th style="width:20%">Decision</th><th>Wizard\'s recommendation</th><th style="width:28%">Where it stands</th></tr></thead><tbody>' +
            b.decisions.map(function (s) { return '<tr><td data-l="Decision"><b>' + E(s[0]) + '</b></td><td data-l="Recommendation">' + E(s[1]) + '</td><td data-l="Stands">' + E(s[2]) + '</td></tr>'; }).join("") + '</tbody></table>';
        }
        if (b.ask && b.ask.length) h += '<h4>Only if there are two minutes at the end</h4>' + list(b.ask);
        if (b.links && b.links.length) h += '<h4>Links</h4><ul class="links">' + b.links.map(function (l) { return "<li>" + linkHtml(l) + "</li>"; }).join("") + '</ul>';
        h += '</div>';
      });
      (day.flags || []).forEach(function (k) { h += flagHtml(k, day.short); });
    });
    document.getElementById("agenda").innerHTML = h;
  }

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

  function doPrint(which) {
    var b = document.body, lbl = { agenda: D.agenda.title, syllabus: D.syllabus.title, both: D.agenda.title + ", and " + D.syllabus.title };
    b.classList.remove("print-agenda", "print-syllabus", "print-both");
    b.classList.add("print-" + which);
    var pw = document.getElementById("printWhat"); if (pw) pw.textContent = lbl[which] || D.title;
    setTimeout(function () { window.print(); }, 50);
  }
  window.addEventListener("afterprint", function () { document.body.classList.remove("print-agenda", "print-syllabus", "print-both"); });

  document.addEventListener("click", function (e) {
    var d = e.target.closest("[data-doc]"); if (d) { e.preventDefault(); openDoc(d.dataset.doc); return; }
    var p = e.target.closest("[data-print]"); if (p && D) { e.preventDefault(); doPrint(p.dataset.print); }
  });

  RAM.gate(function () {
    document.getElementById("appSub").hidden = false;
    RAM.apiJSON("/plan").then(function (data) {
      D = data;
      heads(); renderAgenda(); renderSyllabus(); renderNotes();
      if (location.hash) { var t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
    }).catch(function (e) {
      if (e.message !== "signed out") document.getElementById("agenda").innerHTML = '<p class="err2">Could not load the plan: ' + E(e.message) + '</p>';
    });
  });
  window.RAMPLAN = { print: function (w) { doPrint(w); } };
})();
