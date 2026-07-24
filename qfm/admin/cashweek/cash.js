
(function () {
  var API = "https://dlerhetal.pythonanywhere.com/qfm-api";
  var LS_KEY = "qfmCashweek";
  var CFG = null, PW = null;
  var STORE = { weeks: {}, defaults: null, defaultsSavedAt: null };
  var viewWeek = null;      // "YYYY-MM-DD" Saturday being shown
  var offline = false, blocked = false, saveTimer = null;
  var editingRow = null;    // row id with an open amount input

  // ---------- gate (same pattern as every /qfm/admin page) ----------
  function b64d(s) {
    var bin = atob(s), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  async function decrypt(password) {
    var blob = window.QFM_PAGE_BLOB, enc = new TextEncoder();
    var km = await crypto.subtle.importKey("raw", enc.encode(password),
      "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64d(blob.salt), iterations: blob.iters,
        hash: "SHA-256" }, km,
      { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64d(blob.iv) }, key, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function tryUnlock(pw) {
    try {
      CFG = await decrypt(pw);
      PW = pw;
      sessionStorage.setItem("qfmAdminPw", pw);
      document.getElementById("gate").style.display = "none";
      document.getElementById("app").hidden = false;
      boot();
      return true;
    } catch (e) { return false; }
  }
  document.getElementById("unlock").addEventListener("click", async function () {
    var pw = document.getElementById("pw").value.trim();
    if (!(await tryUnlock(pw)))
      document.getElementById("gatemsg").textContent =
        "That's not it — check the text you were sent and try again.";
  });
  document.getElementById("pw").addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("unlock").click();
  });
  var saved = sessionStorage.getItem("qfmAdminPw");
  if (saved) tryUnlock(saved);

  // ---------- helpers ----------
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    var neg = n < 0; n = Math.abs(n);
    var s = (Math.round(n * 100) / 100).toLocaleString("en-US",
      { minimumFractionDigits: (n % 1 ? 2 : 0), maximumFractionDigits: 2 });
    return (neg ? "-$" : "$") + s;
  }
  function parseMoney(s) {
    if (s === null || s === undefined) return null;
    s = String(s).replace(/[$,\s]/g, "");
    if (s === "") return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function fromIso(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function currentWeekEnding() {   // this week's Saturday (weeks end Saturday)
    var d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay()) + 7) % 7);
    return iso(d);
  }
  function shiftWeek(week, n) {
    var d = fromIso(week); d.setDate(d.getDate() + 7 * n); return iso(d);
  }
  function weekLabel(week) {
    var d = fromIso(week);
    return "Week ending Saturday, " + d.toLocaleDateString("en-US",
      { month: "long", day: "numeric" });
  }
  function weekStart(week) {       // the Sunday that starts this week
    var d = fromIso(week); d.setDate(d.getDate() - 6); return iso(d);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getDefaults() {
    return (STORE.defaults && STORE.defaults.length) ? STORE.defaults : CFG.defaults;
  }
  function forecastFor(week) {     // same week last year = 364 days back
    var d = fromIso(week); d.setDate(d.getDate() - 364);
    var v = CFG.forecast[iso(d)];
    return (v === undefined) ? null : v;
  }
  function rowsFromDefaults() {
    return getDefaults().map(function (d) {
      return { id: uid(), name: d.name, freq: d.freq, day: d.day || null,
               amount: d.amount, orig: d.amount, match: d.match || [],
               included: null, actual: null, matchedIds: [] };
    });
  }
  function prevProjection(week) {
    var prev = STORE.weeks[shiftWeek(week, -1)];
    return (prev && typeof prev.projectedEnd === "number") ? prev.projectedEnd : null;
  }
  function ensureWeek(week) {
    if (!STORE.weeks[week]) {
      STORE.weeks[week] = {
        weekEnding: week, startCash: null,
        moneyIn: { forecast: forecastFor(week), entered: null },
        payrollWeek: true, rows: rowsFromDefaults(),
        cashOut: [], bankIn: null, bankPulledAt: null, projectedEnd: null
      };
    }
    return STORE.weeks[week];
  }
  function dueThisWeek(row, week) {
    var wk = STORE.weeks[week];
    if (row.freq === "w") return true;
    if (row.freq === "p") return !!wk.payrollWeek;
    if (row.freq === "m") {
      var end = fromIso(week);
      for (var i = 0; i < 7; i++) {
        var d = new Date(end); d.setDate(end.getDate() - i);
        if (d.getDate() === row.day) return true;
        // months shorter than the due day: day 31 in a 30-day month falls
        // on the last day — treat the last day of the month as matching
        var next = new Date(d); next.setDate(d.getDate() + 1);
        if (row.day > 28 && next.getDate() === 1 && d.getDate() < row.day)
          return true;
      }
      return false;
    }
    return false;
  }
  function rowActive(row, week) {
    return row.included === null ? dueThisWeek(row, week) : row.included;
  }
  function freqNote(row) {
    if (row.freq === "w") return "every week";
    if (row.freq === "p") return "payroll weeks";
    return "monthly, around the " + row.day + ordinal(row.day);
  }
  function ordinal(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  }

  function totals(week) {
    var wk = STORE.weeks[week];
    var start = (wk.startCash !== null) ? wk.startCash : prevProjection(week);
    var moneyIn = (wk.moneyIn.entered !== null) ? wk.moneyIn.entered
                : (wk.moneyIn.forecast !== null ? wk.moneyIn.forecast : 0);
    var reg = 0;
    wk.rows.forEach(function (r) {
      if (rowActive(r, week)) reg += (r.actual !== null ? r.actual : r.amount);
    });
    var out = 0;
    wk.cashOut.forEach(function (e) { out += e.amount; });
    var projected = (start || 0) + moneyIn - reg - out;
    return { start: start, moneyIn: moneyIn, reg: reg, out: out,
             projected: Math.round(projected * 100) / 100,
             noStart: (start === null) };
  }

  // ---------- persistence ----------
  function mirrorLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STORE)); } catch (e) {}
  }
  function setStatus(msg, err) {
    var el = document.getElementById("statuschip");
    if (el) { el.textContent = msg; el.className = "statuschip" + (err ? " err" : ""); }
  }
  async function api(path, payload) {
    payload.password = PW;
    var r = await fetch(API + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload) });
    var j = await r.json().catch(function () { return {}; });
    return { status: r.status, body: j };
  }
  async function serverLoad() {
    try {
      var r = await api("/cashweek", { action: "load" });
      if (r.status === 200) {
        STORE.weeks = r.body.weeks || {};
        if (r.body.defaults) STORE.defaults = r.body.defaults;
        STORE.defaultsSavedAt = r.body.defaultsSavedAt || null;
        offline = false; mirrorLocal(); return;
      }
    } catch (e) {}
    offline = true;
    try {
      var cached = localStorage.getItem(LS_KEY);
      if (cached) STORE = JSON.parse(cached);
    } catch (e) {}
  }
  function scheduleSave() {
    var wk = STORE.weeks[viewWeek];
    wk.projectedEnd = totals(viewWeek).projected;
    mirrorLocal();
    if (blocked) return;
    setStatus("Saving\u2026");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }
  async function saveNow() {
    var week = viewWeek, wk = STORE.weeks[week];
    try {
      var r = await api("/cashweek", { action: "saveweek", week: week,
        data: wk, baseSavedAt: wk.savedAt });
      if (r.status === 200) {
        wk.savedAt = r.body.savedAt; offline = false;
        setStatus("Saved \u2713");
        mirrorLocal();
      } else if (r.status === 409) {
        blocked = true;
        setStatus("This week was changed on another screen \u2014 reload the page to get the latest.", true);
      } else {
        setStatus((r.body && r.body.error) || "Could not save \u2014 will keep trying.", true);
      }
    } catch (e) {
      offline = true;
      setStatus("Saved on this device only \u2014 the office server is not reachable right now.", true);
    }
  }

  // ---------- bank ----------
  async function updateFromBank() {
    var note = document.getElementById("banknote");
    note.textContent = "Checking the bank\u2026";
    var wk = STORE.weeks[viewWeek];
    var r;
    try {
      r = await api("/cashweek-bank", { start: weekStart(viewWeek), end: viewWeek });
    } catch (e) {
      note.textContent = "Could not reach the office server \u2014 try again in a minute. Everything still works by hand.";
      return;
    }
    if (r.status !== 200) {
      note.textContent = (r.body && r.body.error) || "The bank check did not go through \u2014 try again in a minute.";
      return;
    }
    if (r.body.configured === false) {
      note.textContent = "Bank connection not set up yet \u2014 everything still works by hand.";
      return;
    }
    var txns = (r.body.transactions || []).filter(function (t) { return !t.pending; });
    var bankIn = 0, matched = 0, added = 0;
    txns.forEach(function (t) {
      if (t.amount > 0) { bankIn += t.amount; return; }
      var amt = Math.abs(t.amount), desc = (t.description || "").toUpperCase();
      var hit = null;
      wk.rows.forEach(function (row) {
        if (hit || !rowActive(row, viewWeek)) return;
        if (row.matchedIds.indexOf(t.id) !== -1) { hit = row; return; }
        var kw = (row.match || []).some(function (k) { return k && desc.indexOf(k) !== -1; });
        var close = Math.abs(amt - row.amount) <= Math.max(2, row.amount * 0.02);
        if (kw || close) hit = row;
      });
      if (hit) {
        if (hit.matchedIds.indexOf(t.id) === -1) {
          hit.actual = Math.round(((hit.actual || 0) + amt) * 100) / 100;
          hit.matchedIds.push(t.id);
          matched++;
        }
      } else {
        var dup = wk.cashOut.some(function (e) { return e.bankId === t.id; });
        if (!dup) {
          wk.cashOut.push({ id: uid(), desc: t.description || "Bank withdrawal",
            amount: amt, fromBank: true, bankId: t.id, edited: false });
          added++;
        }
      }
    });
    wk.bankIn = Math.round(bankIn * 100) / 100;
    wk.bankPulledAt = new Date().toLocaleString("en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    scheduleSave();
    render();
    document.getElementById("banknote").textContent =
      "Updated from the bank: " + matched + " regular" + (matched === 1 ? "" : "s") +
      " marked paid, " + added + " new item" + (added === 1 ? "" : "s") +
      " added below. Amounts you typed keep their dot \u2014 the bank squares up later.";
  }

  // ---------- render ----------
  function render() {
    var wk = ensureWeek(viewWeek);
    var t = totals(viewWeek);
    var main = document.getElementById("pagemain");
    var isCurrent = viewWeek === currentWeekEnding();

    var dueRows = wk.rows.filter(function (r) { return rowActive(r, viewWeek); });
    var notDue = wk.rows.filter(function (r) { return !rowActive(r, viewWeek); });

    var html = "";
    if (blocked) html += '<div class="banner">This week was changed on another screen. ' +
      '<a href="javascript:location.reload()">Reload the page</a> to get the latest before making more changes.</div>';
    if (offline) html += '<div class="banner">Working offline \u2014 changes are saved on this device and will need to be re-entered if you switch machines.</div>';

    // --- top card: week nav + the math ---
    html += '<section class="card">' +
      '<div class="weeknav">' +
      '<button id="prevwk" title="Last week">\u2039</button>' +
      '<h2>' + weekLabel(viewWeek) + '</h2>' +
      '<button id="nextwk" title="Next week">\u203a</button></div>' +
      (isCurrent ? "" : '<p class="notthisweek">This is not the current week \u2014 <a href="#" id="gotonow">jump to this week</a>.</p>') +
      '<div class="bigmath"><div class="label">Projected end of week</div>' +
      '<div class="value ' + (t.projected >= 0 ? "good" : "bad") + '">' + fmt(t.projected) + '</div></div>' +
      '<p class="mathline"><b>' + fmt(t.start || 0) + '</b> start + <b>' + fmt(t.moneyIn) +
      '</b> in \u2212 <b>' + fmt(t.reg) + '</b> regulars \u2212 <b>' + fmt(t.out) + '</b> other = <b>' +
      fmt(t.projected) + '</b></p>' +
      '<label class="fieldlabel" for="startcash">Starting cash (Monday morning)</label>' +
      '<input class="moneyinput" id="startcash" type="text" inputmode="decimal" value="' +
      (wk.startCash !== null ? esc(fmt(wk.startCash).replace("$", "")) : "") + '" placeholder="' +
      (t.start !== null && wk.startCash === null ? esc(fmt(t.start).replace("$", "")) : "enter this Monday\u2019s cash position") + '">' +
      '<p class="small">' +
      (wk.startCash !== null ? "You entered this yourself."
        : (t.start !== null ? "Suggested from last week\u2019s projected end \u2014 type over it any time."
        : "From the bank balance or the last cash sheet. The math works without it, but the end-of-week number only means something once it\u2019s in.")) + '</p>' +
      '<p style="text-align:center;margin:14px 0 0;"><button class="bankbtn" id="bankbtn">Update from bank</button></p>' +
      '<p class="banknote" id="banknote">' +
      (wk.bankPulledAt ? "Last updated from the bank: " + esc(wk.bankPulledAt) + "." : "") + '</p>' +
      '<p class="statuschip" id="statuschip"></p></section>';

    // --- band 1: money in ---
    var f = wk.moneyIn.forecast;
    html += '<section class="card"><h2>Money in</h2>' +
      '<label class="fieldlabel" for="moneyin">What the week brings in</label>' +
      '<input class="moneyinput" id="moneyin" type="text" inputmode="decimal" value="' +
      (wk.moneyIn.entered !== null ? esc(fmt(wk.moneyIn.entered).replace("$", ""))
        : (f !== null ? esc(fmt(f).replace("$", "")) : "")) + '" placeholder="what you expect this week">' +
      '<p class="small">' +
      (wk.moneyIn.entered !== null
        ? (f !== null ? "Forecast was <b>" + fmt(f) + "</b> \u2014 " + esc(CFG.basis) + "." : "Your number.")
        : (f !== null ? "Forecast: <b>" + fmt(f) + "</b> \u2014 " + esc(CFG.basis) + ". Type over it any time."
          : "No last-year number for this week \u2014 type what you expect.")) +
      (wk.bankIn !== null ? " The bank shows <b>" + fmt(wk.bankIn) + "</b> in so far this week." : "") +
      '</p></section>';

    // --- band 2: regulars ---
    html += '<section class="card"><h2>Money out \u2014 the regulars</h2>' +
      '<p class="small">Tap an amount to change it. Changed numbers get a dot \u25cf and keep the original underneath.</p>' +
      '<div class="toggleline"><input type="checkbox" id="payrollwk"' + (wk.payrollWeek ? " checked" : "") +
      '><label for="payrollwk">Payroll lands this week</label></div>' +
      '<ul class="rowlist">';
    dueRows.forEach(function (r) {
      html += '<li><span class="rowname">' + esc(r.name) +
        '<span class="freqnote">' + freqNote(r) + '</span>' +
        (r.actual !== null ? '<span class="paidnote">\u2713 paid \u2014 ' + fmt(r.actual) + ' hit the bank</span>' : "") +
        '</span><span class="amtwrap">' +
        (editingRow === r.id
          ? '<input class="amtinput" id="edit-' + r.id + '" type="text" inputmode="decimal" value="' + esc(String(r.amount)) + '">'
          : '<button class="amtbtn" data-row="' + r.id + '">' +
            (r.amount !== r.orig ? '<span class="editdot">\u25cf </span>' : "") + fmt(r.amount) + '</button>') +
        (r.amount !== r.orig ? '<span class="wasnote">was ' + fmt(r.orig) + '</span>' : "") +
        '<br><button class="skiplink" data-skip="' + r.id + '">skip this week</button>' +
        '</span></li>';
    });
    html += '</ul><p class="subtotal">Regulars this week: ' + fmt(t.reg) + '</p>';
    if (notDue.length) {
      html += '<details class="notdue"><summary>Not due this week (' + notDue.length + ')</summary><ul class="rowlist">';
      notDue.forEach(function (r) {
        html += '<li><span class="rowname">' + esc(r.name) +
          '<span class="freqnote">' + freqNote(r) + ' \u2014 ' + fmt(r.amount) + '</span></span>' +
          '<span class="amtwrap"><button class="addback" data-add="' + r.id + '">Add to this week</button></span></li>';
      });
      html += '</ul></details>';
    }
    html += '<button class="drawerbtn" id="opensettings">Edit the regular list (what shows up each new week)</button>';
    html += '<div id="settingsbox"></div></section>';

    // --- band 3: shoebox ---
    html += '<section class="card"><h2>Money out \u2014 everything else</h2>' +
      '<p class="small">The receipt pile: parts runs, vendor checks, wood buys, anything paid this week that is not on the regular list.</p>' +
      '<div class="addform">' +
      '<input type="text" id="newdesc" placeholder="What was it?">' +
      '<input type="tel" id="newamt" placeholder="How much?">' +
      '<button id="addout">Add</button></div>' +
      '<ul class="rowlist">';
    wk.cashOut.forEach(function (e) {
      html += '<li><span class="rowname">' +
        (editingRow === "d" + e.id
          ? '<input class="amtinput" style="width:95%;text-align:left" id="editd-' + e.id + '" type="text" value="' + esc(e.desc) + '">'
          : '<button class="amtbtn" style="font-weight:400" data-desc="' + e.id + '">' + esc(e.desc) + '</button>') +
        (e.fromBank ? '<span class="freqnote">from the bank \u2014 tap the name to say what it was</span>' : "") +
        '</span><span class="amtwrap">' +
        (editingRow === "a" + e.id
          ? '<input class="amtinput" id="edita-' + e.id + '" type="text" inputmode="decimal" value="' + esc(String(e.amount)) + '">'
          : '<button class="amtbtn" data-amt="' + e.id + '">' +
            (e.edited ? '<span class="editdot">\u25cf </span>' : "") + fmt(e.amount) + '</button>') +
        (e.edited && e.orig !== undefined ? '<span class="wasnote">bank said ' + fmt(e.orig) + '</span>' : "") +
        '<button class="dellink" data-del="' + e.id + '" title="Remove">\u00d7</button>' +
        '</span></li>';
    });
    html += '</ul><p class="subtotal">Everything else this week: ' + fmt(t.out) + '</p></section>';

    html += '<p class="small" style="text-align:center">Weeks end Saturday. A new week starts fresh from the regular list every Sunday.</p>';

    main.innerHTML = html;
    wire(wk);
  }

  function wire(wk) {
    var $ = function (id) { return document.getElementById(id); };
    $("prevwk").onclick = function () { viewWeek = shiftWeek(viewWeek, -1); editingRow = null; render(); };
    $("nextwk").onclick = function () { viewWeek = shiftWeek(viewWeek, 1); editingRow = null; render(); };
    var go = $("gotonow");
    if (go) go.onclick = function (e) { e.preventDefault(); viewWeek = currentWeekEnding(); editingRow = null; render(); };

    $("startcash").addEventListener("change", function () {
      wk.startCash = parseMoney(this.value);
      scheduleSave(); render();
    });
    $("moneyin").addEventListener("change", function () {
      var v = parseMoney(this.value);
      // typing the forecast back in (or clearing the field) = no override
      wk.moneyIn.entered = (v === null || v === wk.moneyIn.forecast) ? null : v;
      scheduleSave(); render();
    });
    $("payrollwk").addEventListener("change", function () {
      wk.payrollWeek = this.checked; scheduleSave(); render();
    });
    $("bankbtn").onclick = updateFromBank;

    // regular rows: amount edit / skip / add-back
    document.querySelectorAll("[data-row]").forEach(function (btn) {
      btn.onclick = function () { editingRow = btn.dataset.row; render();
        var inp = document.getElementById("edit-" + btn.dataset.row);
        if (inp) { inp.focus(); inp.select(); } };
    });
    wk.rows.forEach(function (r) {
      var inp = document.getElementById("edit-" + r.id);
      if (inp) {
        var commit = function () {
          var v = parseMoney(inp.value);
          if (v !== null) r.amount = v;
          editingRow = null; scheduleSave(); render();
        };
        inp.addEventListener("blur", commit);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
      }
    });
    document.querySelectorAll("[data-skip]").forEach(function (btn) {
      btn.onclick = function () {
        var r = wk.rows.find(function (x) { return x.id === btn.dataset.skip; });
        if (r) { r.included = false; scheduleSave(); render(); }
      };
    });
    document.querySelectorAll("[data-add]").forEach(function (btn) {
      btn.onclick = function () {
        var r = wk.rows.find(function (x) { return x.id === btn.dataset.add; });
        if (r) { r.included = true; scheduleSave(); render(); }
      };
    });

    // shoebox
    $("addout").onclick = function () {
      var desc = $("newdesc").value.trim();
      var amt = parseMoney($("newamt").value);
      if (!desc && amt === null) return;
      wk.cashOut.push({ id: uid(), desc: desc || "(no description)",
        amount: amt || 0, fromBank: false, edited: false });
      scheduleSave(); render();
      var nd = document.getElementById("newdesc"); if (nd) nd.focus();
    };
    $("newamt").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("addout").click();
    });
    document.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        wk.cashOut = wk.cashOut.filter(function (e) { return e.id !== btn.dataset.del; });
        scheduleSave(); render();
      };
    });
    document.querySelectorAll("[data-amt]").forEach(function (btn) {
      btn.onclick = function () { editingRow = "a" + btn.dataset.amt; render();
        var inp = document.getElementById("edita-" + btn.dataset.amt);
        if (inp) { inp.focus(); inp.select(); } };
    });
    document.querySelectorAll("[data-desc]").forEach(function (btn) {
      btn.onclick = function () { editingRow = "d" + btn.dataset.desc; render();
        var inp = document.getElementById("editd-" + btn.dataset.desc);
        if (inp) { inp.focus(); inp.select(); } };
    });
    wk.cashOut.forEach(function (e) {
      var ia = document.getElementById("edita-" + e.id);
      if (ia) {
        var commitA = function () {
          var v = parseMoney(ia.value);
          if (v !== null && v !== e.amount) {
            if (e.fromBank && !e.edited) e.orig = e.amount;
            e.amount = v; e.edited = true;
          }
          editingRow = null; scheduleSave(); render();
        };
        ia.addEventListener("blur", commitA);
        ia.addEventListener("keydown", function (ev) { if (ev.key === "Enter") ia.blur(); });
      }
      var id = document.getElementById("editd-" + e.id);
      if (id) {
        var commitD = function () {
          var v = id.value.trim();
          if (v) e.desc = v;
          editingRow = null; scheduleSave(); render();
        };
        id.addEventListener("blur", commitD);
        id.addEventListener("keydown", function (ev) { if (ev.key === "Enter") id.blur(); });
      }
    });

    $("opensettings").onclick = function () { renderSettings(); };
  }

  // ---------- settings drawer (edit the defaults list) ----------
  function renderSettings() {
    var box = document.getElementById("settingsbox");
    var defs = JSON.parse(JSON.stringify(getDefaults()));
    function draw() {
      var h = '<div class="settings"><p class="small" style="margin-top:12px">' +
        'This list is what every <b>new</b> week starts with. Changing it does not change weeks already on the books ' +
        '(use the reset button below to re-pull it into this week).</p><table><tbody>';
      defs.forEach(function (d, i) {
        h += '<tr><td><input data-f="name" data-i="' + i + '" value="' + esc(d.name) + '"></td>' +
          '<td style="width:110px"><input class="samt" data-f="amount" data-i="' + i + '" inputmode="decimal" value="' + esc(String(d.amount)) + '"></td>' +
          '<td style="width:150px"><select data-f="freq" data-i="' + i + '">' +
          '<option value="w"' + (d.freq === "w" ? " selected" : "") + '>Every week</option>' +
          '<option value="m"' + (d.freq === "m" ? " selected" : "") + '>Monthly</option>' +
          '<option value="p"' + (d.freq === "p" ? " selected" : "") + '>Payroll weeks</option></select></td>' +
          '<td style="width:70px">' + (d.freq === "m" ? '<input class="sday" data-f="day" data-i="' + i + '" inputmode="numeric" value="' + (d.day || "") + '" placeholder="day">' : "") + '</td>' +
          '<td style="width:34px"><button class="dellink" data-sdel="' + i + '">\u00d7</button></td></tr>';
      });
      h += '</tbody></table>' +
        '<button class="ghostbtn" id="settadd">+ Add a row</button><br>' +
        '<button class="savebtn" id="settsave">Save the list</button>' +
        '<button class="ghostbtn" id="settreset">Reset this week\u2019s regulars to this list</button>' +
        '<button class="ghostbtn" id="settclose">Close</button>' +
        '<p class="small" id="settmsg"></p></div>';
      box.innerHTML = h;

      box.querySelectorAll("input,select").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var i = +inp.dataset.i, f = inp.dataset.f;
          if (f === "amount") { var v = parseMoney(inp.value); if (v !== null) defs[i].amount = v; }
          else if (f === "day") { var n = parseInt(inp.value, 10); defs[i].day = (n >= 1 && n <= 31) ? n : 15; }
          else if (f === "freq") { defs[i].freq = inp.value; if (inp.value === "m" && !defs[i].day) defs[i].day = 15; draw(); }
          else defs[i][f] = inp.value;
        });
      });
      box.querySelectorAll("[data-sdel]").forEach(function (btn) {
        btn.onclick = function () { defs.splice(+btn.dataset.sdel, 1); draw(); };
      });
      document.getElementById("settadd").onclick = function () {
        defs.push({ name: "", amount: 0, freq: "m", day: 15, match: [] }); draw();
      };
      document.getElementById("settclose").onclick = function () { box.innerHTML = ""; };
      document.getElementById("settreset").onclick = function () {
        var wk = STORE.weeks[viewWeek];
        STORE.defaults = defs;
        wk.rows = rowsFromDefaults();
        scheduleSave(); render();
      };
      document.getElementById("settsave").onclick = async function () {
        var clean = defs.filter(function (d) { return d.name.trim(); });
        var msg = document.getElementById("settmsg");
        try {
          var r = await api("/cashweek", { action: "savedefaults", defaults: clean,
            baseDefaultsSavedAt: STORE.defaultsSavedAt });
          if (r.status === 200) {
            STORE.defaults = clean; STORE.defaultsSavedAt = r.body.savedAt;
            mirrorLocal();
            msg.textContent = "Saved. New weeks will start with this list.";
          } else if (r.status === 409) {
            msg.textContent = "The list was changed on another screen \u2014 reload the page and make your change again.";
          } else {
            msg.textContent = (r.body && r.body.error) || "Could not save the list.";
          }
        } catch (e) {
          STORE.defaults = clean; mirrorLocal();
          msg.textContent = "Saved on this device only \u2014 the office server is not reachable right now.";
        }
      };
    }
    draw();
  }

  // ---------- boot ----------
  async function boot() {
    await serverLoad();
    viewWeek = currentWeekEnding();
    ensureWeek(viewWeek);
    render();
    setStatus(offline ? "Working offline \u2014 saved on this device only." : "");
  }
})();
