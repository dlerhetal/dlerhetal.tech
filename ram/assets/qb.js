/* Fix-list wizard (front end). Generic: every card, name, amount and step arrives from
   the API after sign-in (GET /qb/cards, GET /qb/state). Every pick, step, done mark,
   note and question is POSTed to /qb/event and kept on the server; this page keeps only
   UI conveniences in localStorage (which card is open, who is working). */
(function () {
  "use strict";
  var R = window.RAM, esc = R.esc;
  var NSK = R.NS.slice(1);
  var K_OPEN = NSK + "_qb_open", K_WHO = NSK + "_qb_who";
  var data = null, view = null, who = "", openId = "";
  var issueOpen = {};   // card id -> true while the "does not match" box is open
  var drafts = {};      // unsaved textarea text, kept across re-renders

  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } }

  /* tiny markup: [[menu path]] -> path chip, **bold** -> bold. Escaped first. */
  function fmt(s) {
    return esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="path">$1</span>').replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }
  function owner() { return (data && data.owner) || "the owner"; }
  function cpa() { return (data && data.cpa) || "the CPA"; }
  function card(id) { return data.cards.find(function (c) { return c.id === id; }); }
  function scen(c, sid) { return c.scenarios.find(function (s) { return s.id === sid; }); }
  function stOf(id) { return (view && view.state[id]) || { status: "new", asks: [], issues: [] }; }
  function statusLabel(s) {
    return { done: "Done", waiting_owner: "Question waiting for " + owner(), working: "In progress", "new": "Not started" }[s] || s;
  }

  function setSaved(text, bad) {
    var e = R.$("saveState"); if (!e) return;
    e.textContent = text; e.className = "saved" + (bad ? " bad" : "");
  }
  function nowLabel() { var d = new Date(); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  /* ---------------------------------------------------------------- server */
  function post(cardId, kind, payload) {
    setSaved("Saving");
    return R.apiJSON("/qb/event", { method: "POST", json: { card: cardId, kind: kind, payload: payload || {}, answered_by: who } })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "not saved");
        view = r; setSaved("Saved " + nowLabel()); return r;
      })
      .catch(function (e) { setSaved("Not saved: " + (e.message === "Failed to fetch" ? "no connection" : e.message), true); throw e; });
  }

  /* ---------------------------------------------------------------- who */
  function renderWho() {
    var opts = (data.who || []).slice();
    if (R.TEST_MODE) opts.push("TEST");
    var m = location.search.match(/[?&]as=([^&]+)/);
    var pre = R.TEST_MODE && m ? decodeURIComponent(m[1]) : lsGet(K_WHO);
    who = opts.indexOf(pre) >= 0 ? pre : opts[0];
    var box = R.$("whoButtons"); box.innerHTML = "";
    opts.forEach(function (o) {
      var b = R.el('<button type="button" class="whobtn' + (o === who ? " on" : "") + '">' + esc(o) + "</button>");
      b.addEventListener("click", function () { who = o; if (o !== "TEST") lsSet(K_WHO, o); renderWho(); });
      box.appendChild(b);
    });
    R.$("whoToggle").hidden = false;
  }

  /* ---------------------------------------------------------------- summary */
  function renderSummary() {
    var s = view.summary;
    R.$("intro").textContent = data.intro || "";
    R.$("sumLine").textContent = s.problems + " problems found, plus " + s.prep + " setup steps. " + s.done + " of " + s.cards + " done.";
    R.$("sumBar").style.width = s.pct + "%";
    R.$("sumBarLbl").textContent = s.pct + "% done";
    var g = R.$("sumGrid");
    g.innerHTML =
      '<span class="sumpill done"><b>' + s.done + "</b> done</span>" +
      '<span class="sumpill"><b>' + s.working + "</b> in progress</span>" +
      '<span class="sumpill wait"><b>' + s.waiting + "</b> waiting on someone (" + s.waiting_owner + " on " + esc(owner()) + ", " + s.waiting_cpa + " on " + esc(cpa()) + ")</span>" +
      '<span class="sumpill"><b>' + s.open_asks + "</b> open questions for " + esc(owner()) + "</span>";
  }

  /* ---------------------------------------------------------------- cards */
  function headHTML(c) {
    var st = stOf(c.id);
    return '<button type="button" class="qbhead" aria-expanded="' + (openId === c.id) + '" data-open="' + esc(c.id) + '">' +
      '<span class="qbnum">' + (st.status === "done" ? "&#10003;" : c.n) + "</span>" +
      '<span class="qbht"><span class="qbtitle">' + esc(c.title) + "</span>" +
      '<span class="qbpills">' + (c.urgent && st.status !== "done" ? '<span class="pill urgentpill">Urgent</span>' : "") +
      '<span class="pill tag-' + esc(c.tag) + '">' + esc(c.tag_label) + "</span>" +
      '<span class="pill st-' + esc(st.status) + '">' + esc(statusLabel(st.status)) + "</span></span></span>" +
      '<span class="qbchev" aria-hidden="true">&#8250;</span></button>';
  }

  function evidenceHTML(c) {
    if (!c.evidence || !c.evidence.length) return "";
    return "<h3>The evidence</h3><dl class=\"qbev\">" + c.evidence.map(function (e) {
      return "<div><dt>" + esc(e[0]) + "</dt><dd>" + esc(e[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function walkHTML(c, st) {
    var s = scen(c, st.scenario);
    if (!s) return "";
    var n = s.steps.length, i = Math.max(0, Math.min(st.step || 0, n));  // i == n is the check screen
    var dots = "";
    for (var k = 0; k <= n; k++) dots += '<i class="' + (k < i ? "past" : (k === i ? "now" : "")) + '"></i>';
    var h = '<div class="walk" id="walk-' + esc(c.id) + '">';
    h += '<div class="walkhead"><b>' + esc(s.label) + "</b><span>" + (i < n ? "Step " + (i + 1) + " of " + n : "Last: check it worked") + "</span></div>";
    h += '<div class="stepdots" aria-hidden="true">' + dots + "</div>";
    if (i < n) {
      var t = s.steps[i], caut = t.charAt(0) === "!";
      h += '<p class="steptext' + (caut ? " caution" : "") + '">' + fmt(caut ? t.slice(1).trim() : t) + "</p>";
      h += '<div class="walknav"><button type="button" class="btn" data-act="back"' + (i === 0 ? " disabled" : "") + '>Back</button>' +
        '<button type="button" class="btn pri" data-act="next">' + (i === n - 1 ? "Next: check it worked" : "Next step") + "</button></div>";
      h += '<button type="button" class="linkbtn" data-act="issue">This step does not match my screen</button>';
      if (issueOpen[c.id]) {
        h += '<div class="issuebox"><p class="pdesc">Say what your screen shows instead. It is saved for Dale. For help right now, press the Ask button in the corner.</p>' +
          '<textarea data-draft="issue-' + esc(c.id) + '" rows="3">' + esc(drafts["issue-" + c.id] || "") + "</textarea>" +
          '<div class="rowbtns"><button type="button" class="btn pri" data-act="saveissue">Save for Dale</button><button type="button" class="btn" data-act="closeissue">Close</button></div></div>';
      }
    } else {
      h += "<h3>How to check it worked</h3><ul class=\"checklist\">" + s.check.map(function (x) { return "<li>" + fmt(x) + "</li>"; }).join("") + "</ul>";
      if (st.done) {
        h += '<div class="donebar"><span class="donenote">Done. Marked by ' + esc(st.done.by) + " on " + esc(R.fmtTs(st.done.ts)) + '.</span><button type="button" class="linkbtn" data-act="undone">Undo done</button></div>';
      } else {
        h += '<div class="donebar"><button type="button" class="btn donebtn" data-act="done">It checks out: mark this card done</button></div>';
      }
      h += '<div class="walknav"><button type="button" class="btn" data-act="back">Back to the steps</button></div>';
    }
    return h + "</div>";
  }

  function asksHTML(c, st) {
    var showBox = st.scenario === "ask" || (st.asks && st.asks.length);
    if (!showBox) return "";
    var h = '<div class="askbox">';
    if (st.asks && st.asks.length) {
      h += "<label>Questions for " + esc(owner()) + "</label><ul class=\"asklist\">" + st.asks.map(function (a) {
        return '<li class="' + (a.answer ? "answered" : "") + '">' + esc(a.text) +
          '<span class="meta">Asked by ' + esc(a.by) + " " + esc(R.fmtTs(a.ts)) + (a.answer ? "" : ". Waiting for an answer.") + "</span>" +
          (a.answer ? '<span class="meta"><b>Answer</b> (' + esc(a.answer.by) + " " + esc(R.fmtTs(a.answer.ts)) + "): " + esc(a.answer.text) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
    }
    if (st.scenario === "ask") {
      var key = "ask-" + c.id;
      var pre = drafts[key] != null ? drafts[key] : (c.owner_q || ("About \"" + c.title + "\": "));
      h += '<label for="ta-' + key + '">' + (st.asks && st.asks.length ? "Ask another question" : "The question for " + esc(owner()) + " (change it if you like)") + "</label>" +
        '<textarea id="ta-' + key + '" data-draft="' + key + '" rows="4">' + esc(pre) + "</textarea>" +
        '<div class="rowbtns"><button type="button" class="btn pri" data-act="saveask">Save the question for ' + esc(owner()) + '</button>' +
        '<span class="savedmsg">Saved questions show on Dale\'s screen. Once ' + esc(owner()) + ' answers, come back and pick what happened.</span></div>';
    }
    return h + "</div>";
  }

  function bodyHTML(c) {
    var st = stOf(c.id);
    var h = '<div class="qbbody">';
    if (c.urgent && st.status !== "done") h += '<div class="urgbox">Urgent: answer this before the next payroll.</div>';
    h += '<p class="qbwhat">' + fmt(c.what) + "</p>";
    h += evidenceHTML(c);
    if (c.history) h += '<div class="warnbox"><b class="wt">This changes history in QuickBooks</b>' + fmt(c.history) + " Use the practice copy (card 2) and wait for " + esc(cpa()) + "'s sign-off.</div>";
    if (c.caution) h += '<div class="cautbox"><b>Please note:</b> ' + fmt(c.caution) + "</div>";
    h += "<h3>" + esc(c.pick_prompt || "Which of these happened?") + "</h3><div class=\"scenlist\">";
    c.scenarios.forEach(function (s) {
      h += '<button type="button" class="btn scen' + (st.scenario === s.id ? " on" : "") + '" data-scen="' + esc(s.id) + '">' + esc(s.label) +
        (s.sub ? '<span class="ssub">' + esc(s.sub) + "</span>" : "") + "</button>";
    });
    h += '<button type="button" class="btn scen askowner' + (st.scenario === "ask" ? " on" : "") + '" data-scen="ask">' + esc(data.ask_label || "I don't know / ask the owner") +
      '<span class="ssub">Save the question for ' + esc(owner()) + ' and come back to this card later.</span></button></div>';
    h += walkHTML(c, st);
    h += asksHTML(c, st);
    var nk = "note-" + c.id;
    var noteVal = drafts[nk] != null ? drafts[nk] : (st.note || "");
    h += '<div class="notebox"><label for="ta-' + nk + '">Notes for Dale</label>' +
      '<textarea id="ta-' + nk + '" data-draft="' + nk + '" rows="3" placeholder="What you found, what you changed, anything odd.">' + esc(noteVal) + "</textarea>" +
      '<div class="rowbtns"><button type="button" class="btn" data-act="savenote">Save note</button><span class="savedmsg">' +
      (st.note_ts ? "Last saved by " + esc(st.note_by) + " " + esc(R.fmtTs(st.note_ts)) : "Not saved yet") + "</span></div></div>";
    var next = data.cards[data.cards.indexOf(c) + 1];
    if (next) h += '<p class="nextcard"><button type="button" class="btn" data-open="' + esc(next.id) + '">Next card: ' + esc(next.n + ". " + next.title) + "</button></p>";
    return h + "</div>";
  }

  function cardEl(c) {
    var st = stOf(c.id);
    var el = document.createElement("article");
    el.className = "qbcard" + (openId === c.id ? " open" : "") + (st.status === "done" ? " isdone" : "") + (c.urgent ? " urgent" : "");
    el.id = "card-" + c.id; el.dataset.card = c.id;
    el.innerHTML = headHTML(c) + (openId === c.id ? bodyHTML(c) : "");
    return el;
  }

  function captureDrafts() {
    Array.prototype.forEach.call(document.querySelectorAll("textarea[data-draft]"), function (t) { drafts[t.dataset.draft] = t.value; });
  }

  function renderAll() {
    captureDrafts();
    var box = R.$("sections"); box.innerHTML = "";
    data.sections.forEach(function (sec) {
      var cards = data.cards.filter(function (c) { return c.section === sec.id; });
      if (!cards.length) return;
      var s = document.createElement("section");
      s.className = "qbsec";
      s.innerHTML = "<h2>" + esc(sec.title) + "</h2>" + (sec.sub ? "<p>" + esc(sec.sub) + "</p>" : "");
      box.appendChild(s);
      cards.forEach(function (c) { box.appendChild(cardEl(c)); });
    });
    renderSummary();
    if (window.RAMASK) window.RAMASK.refresh();
  }

  function rerenderCard(id) {
    captureDrafts();
    var old = R.$("card-" + id); var c = card(id);
    if (old && c) old.parentNode.replaceChild(cardEl(c), old);
    renderSummary();
    if (window.RAMASK) window.RAMASK.refresh();
  }

  function openCard(id, scroll) {
    var prev = openId;
    openId = (openId === id && !scroll) ? "" : id;
    lsSet(K_OPEN, openId);
    if (prev && prev !== openId) rerenderCard(prev);
    if (id) rerenderCard(id);
    if (openId && scroll !== false) {
      var el = R.$("card-" + openId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------------------------------------------------------------- actions */
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { e.preventDefault(); var id = o.dataset.open; openCard(id, o.classList.contains("qbhead") ? false : true); return; }
    var host = e.target.closest("[data-card]"); if (!host) return;
    var id = host.dataset.card, c = card(id), st = stOf(id);
    var sb = e.target.closest("[data-scen]");
    if (sb) {
      var sid = sb.dataset.scen;
      if (st.scenario === sid && !st.done) return;
      issueOpen[id] = false;
      post(id, "pick", { scenario: sid }).then(function () { rerenderCard(id); scrollWalk(id); }).catch(function () { });
      return;
    }
    var a = e.target.closest("[data-act]"); if (!a) return;
    var act = a.dataset.act;
    var s = scen(c, st.scenario);
    if (act === "next" || act === "back") {
      if (!s) return;
      var n = s.steps.length, i = st.step || 0;
      i = act === "next" ? Math.min(n, i + 1) : Math.max(0, (i > n ? n : i) - 1);
      issueOpen[id] = false;
      post(id, "step", { scenario: st.scenario, i: i }).then(function () { rerenderCard(id); scrollWalk(id); }).catch(function () { });
    } else if (act === "done") {
      post(id, "done", { scenario: st.scenario }).then(function () { rerenderCard(id); }).catch(function () { });
    } else if (act === "undone") {
      post(id, "undone", {}).then(function () { rerenderCard(id); }).catch(function () { });
    } else if (act === "issue") {
      issueOpen[id] = !issueOpen[id]; rerenderCard(id);
    } else if (act === "closeissue") {
      issueOpen[id] = false; rerenderCard(id);
    } else if (act === "saveissue") {
      var key = "issue-" + id, t = host.querySelector('textarea[data-draft="' + key + '"]');
      var txt = (t && t.value || "").trim(); if (!txt) { setSaved("Type what the screen shows first", true); return; }
      post(id, "issue", { scenario: st.scenario, i: st.step || 0, text: txt }).then(function () { drafts[key] = ""; issueOpen[id] = false; rerenderCard(id); }).catch(function () { });
    } else if (act === "saveask") {
      var k2 = "ask-" + id, t2 = host.querySelector('textarea[data-draft="' + k2 + '"]');
      var q = (t2 && t2.value || "").trim(); if (!q) { setSaved("Type the question first", true); return; }
      post(id, "ask", { text: q }).then(function () { drafts[k2] = ""; rerenderCard(id); }).catch(function () { });
    } else if (act === "savenote") {
      var k3 = "note-" + id, t3 = host.querySelector('textarea[data-draft="' + k3 + '"]');
      post(id, "note", { text: (t3 && t3.value || "") }).then(function () { delete drafts[k3]; rerenderCard(id); }).catch(function () { });
    }
  });

  function scrollWalk(id) {
    var w = R.$("walk-" + id) || document.querySelector("#card-" + id + " .askbox");
    if (!w) return;
    var r = w.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) w.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------------------------------------------------------- ask context */
  function askContext() {
    var base = (data && data.qb) ? data.qb + " (Desktop, not Online)" : "QuickBooks Desktop";
    if (!openId) return { page: base + " fix list, an office manager fixing errors", step: "The overview of the fix list" };
    var c = card(openId), st = stOf(openId), s = scen(c, st.scenario);
    var page = base + " fix list. Card " + c.n + ": " + c.title;
    var step;
    if (!st.scenario) step = "Card " + c.n + ", not started yet. Problem: " + c.what;
    else if (st.scenario === "ask") step = "Card " + c.n + ": waiting for the owner's answer.";
    else {
      var n = s.steps.length, i = st.step || 0;
      step = "Picked: " + s.label + ". " + (i < n ? "Step " + (i + 1) + " of " + n + ": " + s.steps[i].replace(/^!\s*/, "") : "Checking it worked: " + s.check.join(" "));
    }
    step = step.replace(/\[\[|\]\]|\*\*/g, "");
    return { page: page.slice(0, 160), step: step.slice(0, 240) };
  }

  /* ---------------------------------------------------------------- boot */
  R.gate(function () {
    Promise.all([R.apiJSON("/qb/cards"), R.apiJSON("/qb/state")]).then(function (res) {
      data = res[0]; view = res[1];
      document.title = data.client_name + ", " + (data.title || "QuickBooks fixes");
      var sub = R.$("h1sub"); if (sub) { sub.textContent = data.title || "QuickBooks fixes"; sub.hidden = false; }
      R.$("appSub").hidden = false;
      if (R.DALE_MODE) { var slot = document.querySelector('[data-dale-slot="qb"]'); if (slot) slot.innerHTML = '<a href="admin/" class="daleonly">Dale\'s view</a>'; }
      renderWho();
      var saved = lsGet(K_OPEN);
      openId = saved && card(saved) ? saved : "";
      renderAll();
      setSaved(view.summary.done + " of " + view.summary.cards + " done");
      if (window.RAMASK) {
        window.RAMASK.setContext(askContext);
        if (data.ask_code) window.RAMASK.setCode(data.ask_code);
        window.RAMASK.start();
      }
      if (openId) { var el = R.$("card-" + openId); if (el) el.scrollIntoView({ block: "start" }); }
    }).catch(function (e) {
      if (e && e.message === "signed out") return;
      setSaved("Could not load the fix list. Check the connection and reload.", true);
    });
  });
  window.RAMQB = { askContext: askContext };
})();
