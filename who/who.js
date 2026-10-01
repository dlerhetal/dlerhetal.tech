/* The owner's view of who has been on the site. Generic shell: every address, visit and saved
   item arrives from the site service, and only for a device the owner has set up. */
(function () {
  "use strict";
  var S = window.Site;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function when(iso) {
    if (!iso) return "";
    try { var d = new Date(iso); return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return iso; }
  }
  function link(text, fn) { var b = el("button", "link", String(text)); b.type = "button"; b.addEventListener("click", fn); return b; }
  function pill(text, red) { return el("span", "pill" + (red ? " red" : ""), text); }
  function table(node, heads, rows, empty) {
    clear(node);
    var tr = el("tr"); heads.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    var thead = el("thead"); thead.appendChild(tr); node.appendChild(thead);
    var tb = el("tbody");
    if (!rows.length) { var r = el("tr"), c = el("td", "muted", empty || "Nothing yet."); c.colSpan = heads.length; r.appendChild(c); tb.appendChild(r); }
    rows.forEach(function (cells) {
      var r = el("tr");
      cells.forEach(function (c) {
        var td = el("td");
        if (c && c.nodeType) td.appendChild(c);
        else if (Array.isArray(c)) c.forEach(function (x) { td.appendChild(x && x.nodeType ? x : document.createTextNode(String(x))); });
        else td.textContent = c == null ? "" : String(c);
        r.appendChild(td);
      });
      tb.appendChild(r);
    });
    node.appendChild(tb);
  }
  /* A button that asks once more, on the page, before it acts. No pop-up boxes. */
  function twoStep(label, sure, fn, cls) {
    var b = el("button", cls || "btn warn", label); b.type = "button";
    var armed = false, t = null;
    b.addEventListener("click", function () {
      if (!armed) { armed = true; b.textContent = sure; t = setTimeout(function () { armed = false; b.textContent = label; }, 6000); return; }
      clearTimeout(t); b.disabled = true; fn(b);
    });
    return b;
  }

  /* ---------- setting up a device ---------- */
  var setupKey = "";
  (function readKey() {
    var m = location.hash.match(/[#&]setup=([^&]+)/);
    if (!m) return;
    setupKey = decodeURIComponent(m[1]);
    /* take the key out of the address bar and the history at once */
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
  })();

  function showSetup(mode, signedInAs) {
    $("view").hidden = true;
    $("setup").hidden = false;
    $("setupCodeWrap").hidden = mode !== "code";
    $("setupEmailWrap").hidden = !!signedInAs;
    if (mode === "key") {
      $("lede").textContent = "One step, once per device.";
      $("setupTitle").textContent = "Set up this device";
      $("setupText").textContent = signedInAs
        ? "This device is signed in as " + signedInAs + ". Press the button and it will open this page from now on."
        : "Type your email and press the button. This device will open this page from now on, with nothing more to type.";
    } else {
      $("lede").textContent = "This page opens only on the site owner's devices.";
      $("setupTitle").textContent = "Have a device code?";
      $("setupText").textContent = "On a device that is already set up, open this page and press \"Get a device code\". Type that code here.";
    }
    setTimeout(function () { var f = mode === "code" ? $("setupCode") : $("setupEmail"); if (f && !f.closest("[hidden]")) f.focus(); }, 30);
    $("setupForm").onsubmit = function (e) {
      e.preventDefault();
      var body = {};
      if (mode === "key") body.key = setupKey; else body.code = $("setupCode").value.trim();
      if (!signedInAs) body.email = $("setupEmail").value.trim();
      if (mode === "code" && !body.code) { $("setupErr").textContent = "Type the device code."; return; }
      if (!signedInAs && !body.email) { $("setupErr").textContent = "Type your email address."; return; }
      $("setupBtn").disabled = true; $("setupErr").textContent = "";
      S.apiJSON("/admin/trust", { json: body }).then(function (j) {
        setupKey = "";
        if (j.token) S.adopt(j.token, j.email, true);
        $("setup").hidden = true;
        /* a full reload so every part of the page starts from the new state */
        location.replace(location.pathname + location.search);
      }, function (x) {
        $("setupBtn").disabled = false;
        $("setupErr").textContent = x.message;
      });
    };
  }

  /* ---------- the view ---------- */
  var range = "today", summary = null;
  function sinceFor(r) {
    if (r === "all") return "";
    var d = new Date(); d.setHours(0, 0, 0, 0);
    if (r === "week") d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 19) + "Z";
  }
  function rangeWords() { return range === "today" ? "today" : range === "week" ? "in the last 7 days" : "since the start"; }
  function qs(o) {
    var out = [];
    Object.keys(o).forEach(function (k) { if (o[k] !== "" && o[k] != null) out.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); });
    return out.length ? "?" + out.join("&") : "";
  }

  function load() {
    return S.apiJSON("/admin/summary" + qs({ since: sinceFor(range) })).then(function (s) {
      summary = s;
      $("setup").hidden = true; $("view").hidden = false;
      $("lede").textContent = "Signed-in people by address, everyone else counted by page.";
      Array.prototype.forEach.call(document.querySelectorAll("#ranges [data-range]"), function (b) { b.classList.toggle("on", b.dataset.range === range); });
      $("asOf").textContent = "As of " + when(s.nowUtc);
      renderTiles(s); renderPeople(s); renderUnknown(s); renderFlags(s);
      $("clearTestBtn").hidden = !s.people.some(function (p) { return p.isTest; });
    }, function (x) {
      if (x.status === 403 || x.status === 401) { var u = S.user(); showSetup("code", u ? u.email : ""); }
      else { $("lede").textContent = x.message; }
    });
  }

  function tile(n, label, fn) {
    var b = el("button", "tile"); b.type = "button";
    b.appendChild(el("b", null, String(n))); b.appendChild(el("span", null, label));
    b.addEventListener("click", fn);
    return b;
  }
  function renderTiles(s) {
    var t = clear($("tiles")), since = sinceFor(range);
    t.appendChild(tile(s.totals.signedInPeople, "people signed in and active " + rangeWords(), function () { showRows("Signed-in activity " + rangeWords(), { since: since, known: 1 }); }));
    t.appendChild(tile(s.totals.newPeople, "new addresses " + rangeWords(), function () { showRows("First sign-ins " + rangeWords(), { since: since, action: "signIn", detail: "new" }); }));
    t.appendChild(tile(s.totals.unknownVisitors, "visitors who did not sign in " + rangeWords(), function () { showRows("Visits without a sign-in " + rangeWords(), { since: since, unknown: 1 }); }));
    t.appendChild(tile(s.totals.pageViews, "rows in the record " + rangeWords(), function () { showRows("Everything " + rangeWords(), { since: since }); }));
  }

  function renderPeople(s) {
    var since = sinceFor(range);
    $("peopleNote").textContent = s.people.length + (s.people.length === 1 ? " address" : " addresses") + " active or new " + rangeWords() + ". Press a number to see what is behind it.";
    table($("people"), ["Email", "First seen", "Last seen", "Devices", "Saved items", "Visits", "Pages used"], s.people.map(function (p) {
      var who = [link(p.email, function () { showPerson(p.userId); })];
      if (p.isOwner) who.push(pill("owner"));
      if (p.isNew) who.push(pill("new"));
      if (p.isTest) who.push(pill("test", true));
      if (p.merged) who.push(pill("merged"));
      return [who, when(p.createdUtc), when(p.lastSeenUtc),
        link(p.deviceCount, function () { showPerson(p.userId); }),
        link(p.itemCount, function () { showPerson(p.userId); }),
        link(p.visitCount, function () { showRows(p.email + " " + rangeWords(), { since: since, userId: p.userId }); }),
        p.pages.map(function (x) { return x.page + " (" + x.views + ")"; }).join(", ")];
    }), "Nobody signed in " + rangeWords() + ".");
  }
  function renderUnknown(s) {
    var since = sinceFor(range);
    table($("unknown"), ["Page", "Views", "Visitors"], s.unknown.map(function (u) {
      return [u.page, link(u.views, function () { showRows("Visits without a sign-in to " + u.page + " " + rangeWords(), { since: since, unknown: 1, page: u.page }); }), u.visitors];
    }), "No visits without a sign-in " + rangeWords() + ".");
  }
  function renderFlags(s) {
    table($("newDevices"), ["Email", "Device", "First seen"], s.flags.newDevices.map(function (d) {
      return [link(d.email, function () { showPerson(d.userId); }), d.label + (d.isTrusted ? " (owner)" : ""), when(d.createdUtc)];
    }), "None " + rangeWords() + ".");
    table($("twins"), ["This address", "Looks like", ""], s.flags.typoTwins.map(function (t) {
      return [link(t.email, function () { showPerson(t.userId); }), link(t.otherEmail, function () { showPerson(t.otherUserId); }),
        twoStep("Merge into " + t.otherEmail, "Press again to merge", function (b) {
          S.apiJSON("/admin/merge", { json: { fromUserId: t.userId, intoUserId: t.otherUserId } }).then(function () { $("flagErr").textContent = ""; load(); },
            function (x) { b.disabled = false; $("flagErr").textContent = x.message; });
        })];
    }), "None.");
  }

  function showRows(title, filter) {
    $("rowsBox").hidden = false; $("rowsTitle").textContent = title; $("rowsNote").textContent = "Loading.";
    clear($("rowsTable"));
    S.apiJSON("/admin/visits" + qs(filter)).then(function (j) {
      $("rowsNote").textContent = j.total + (j.total === 1 ? " row." : " rows.") + (j.visits.length < j.total ? " Showing the newest " + j.visits.length + "." : "");
      table($("rowsTable"), ["When", "Who", "Page", "What", "Detail", "Device"], j.visits.map(function (v) {
        var who = v.email ? [link(v.email, function () { showPerson(v.userId); })] : "Not signed in" + (v.anonId ? " (" + v.anonId.slice(0, 8) + ")" : "");
        if (v.beforeSignIn) who.push(pill("before signing in"));
        return [when(v.tsUtc), who, v.page, v.action, v.detail, v.device || ""];
      }));
      $("rowsBox").scrollIntoView({ block: "start" });
    }, function (x) { $("rowsNote").textContent = x.message; });
  }

  function showPerson(userId) {
    $("personBox").hidden = false; $("itemBox").hidden = true; $("personTitle").textContent = "Loading"; $("personNote").textContent = "";
    S.apiJSON("/admin/person" + qs({ userId: userId })).then(function (p) {
      $("personTitle").textContent = p.user.email;
      $("personNote").textContent = "First seen " + when(p.user.createdUtc) + ". Last seen " + when(p.user.lastSeenUtc) + "." +
        (p.user.mergedInto ? " Merged into " + p.user.mergedInto + "." : "") +
        (p.user.emailAsTyped && p.user.emailAsTyped.toLowerCase() !== p.user.email ? " Typed as " + p.user.emailAsTyped + "." : "");
      table($("personDevices"), ["Device", "First seen", "Last seen", "State", ""], p.devices.map(function (d) {
        var state = d.signedOutUtc ? "Signed out " + when(d.signedOutUtc) : (d.isTrusted ? "Signed in, owner's device" : "Signed in");
        var act = d.signedOutUtc ? "" : twoStep("End this device", "Press again to end it", function () {
          S.apiJSON("/admin/deviceSignout", { json: { deviceId: d.deviceId } }).then(function () { showPerson(userId); }, function (x) { $("personNote").textContent = x.message; });
        });
        return [d.label, when(d.createdUtc), when(d.lastSeenUtc), state, act];
      }), "No devices.");
      table($("personItems"), ["Title", "Tool", "Last saved", "Versions", ""], p.items.map(function (i) {
        return [i.title + (i.archived ? " (removed)" : ""), i.tool, when(i.updatedUtc), i.versionCount,
          p.canOpenItems ? link("Open, read-only", function () { showItem(i.itemId, ""); }) : ""];
      }), "Nothing saved.");
      table($("personVisits"), ["When", "Page", "What", "Detail", "Device"], p.visits.map(function (v) {
        return [when(v.tsUtc), v.page, v.beforeSignIn ? [v.action, pill("before signing in")] : v.action, v.detail, v.device || ""];
      }), "No visits.");
      $("personBox").scrollIntoView({ block: "start" });
    }, function (x) { $("personTitle").textContent = x.message; });
  }

  function showItem(itemId, versionId) {
    $("itemBox").hidden = false; $("itemTitle").textContent = "Loading"; $("itemBody").textContent = "";
    S.apiJSON("/admin/item" + qs({ itemId: itemId, versionId: versionId })).then(function (j) {
      $("itemTitle").textContent = j.item.title + " (read-only)";
      $("itemNote").textContent = "Saved by " + j.email + ". This version was saved " + when(j.savedUtc) + ". Nothing here can be changed from this page.";
      var vs = clear($("itemVersions"));
      j.versions.forEach(function (v) {
        var b = el("button", "btn" + (v.versionId === j.versionId ? " on" : ""), when(v.tsUtc) + (v.kind === "named" ? " (named)" : v.kind === "restore" ? " (brought back)" : ""));
        b.type = "button"; b.addEventListener("click", function () { showItem(itemId, v.versionId); });
        vs.appendChild(b);
      });
      $("itemBody").textContent = JSON.stringify(j.body, null, 2);
      $("itemBox").scrollIntoView({ block: "start" });
    }, function (x) { $("itemTitle").textContent = x.message; });
  }

  function loadSettings() {
    S.apiJSON("/admin/settings").then(function (j) {
      table($("settings"), ["Setting", "Value", ""], j.settings.map(function (s) {
        var input = el("input"); input.type = "text"; input.value = s.value; input.setAttribute("data-setting", s.key);
        if (s.numeric) input.setAttribute("inputmode", "numeric");
        var note = el("span", "muted", "");
        var save = el("button", "btn", "Save"); save.type = "button";
        save.addEventListener("click", function () {
          save.disabled = true; note.className = "muted"; note.textContent = " Saving";
          S.apiJSON("/admin/settings", { json: { key: s.key, value: input.value } }).then(function (r) {
            save.disabled = false; input.value = r.value; note.className = "ok"; note.textContent = " Saved " + S.fmtTime();
          }, function (x) { save.disabled = false; note.className = "err"; note.textContent = " " + x.message; });
        });
        var name = el("div"); name.appendChild(el("b", null, s.key)); name.appendChild(el("div", "muted", s.help));
        return [name, input, [save, note]];
      }));
    }, function () { });
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("#ranges [data-range]"), function (b) {
      b.addEventListener("click", function () { range = b.dataset.range; $("rowsBox").hidden = true; load(); });
    });
    $("rowsClose").addEventListener("click", function () { $("rowsBox").hidden = true; });
    $("personClose").addEventListener("click", function () { $("personBox").hidden = true; });
    $("codeBtn").addEventListener("click", function () {
      $("codeBtn").disabled = true;
      S.apiJSON("/admin/trustcode", { method: "POST" }).then(function (j) {
        $("codeBtn").disabled = false; $("codeOut").hidden = false;
        $("codeText").textContent = j.code;
        $("codeNote").textContent = "Good for " + j.minutes + " minutes, and for one device. On the other device, open this same page and type it in.";
      }, function (x) { $("codeBtn").disabled = false; $("codeOut").hidden = false; $("codeText").textContent = ""; $("codeNote").textContent = x.message; });
    });
    $("csvBtn").addEventListener("click", function () {
      $("recordNote").textContent = "Preparing the file.";
      S.api("/admin/visits.csv").then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (blob) {
        var a = el("a"); a.href = URL.createObjectURL(blob); a.download = "site_visits.csv"; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        $("recordNote").textContent = "Downloaded " + S.fmtTime() + ".";
      }).catch(function () { $("recordNote").textContent = "The file could not be made. Try again."; });
    });
    var ct = twoStep("Remove test rows", "Press again to remove test rows", function (b) {
      S.apiJSON("/admin/clearTest", { method: "POST" }).then(function (j) {
        $("recordNote").textContent = "Removed " + j.removed.users + " test addresses and " + j.removed.visits + " test visits.";
        b.disabled = false; b.textContent = "Remove test rows"; load();
      }, function (x) { b.disabled = false; $("recordNote").textContent = x.message; });
    });
    ct.id = "clearTestBtn"; ct.hidden = true;
    $("clearTestBtn").replaceWith(ct);
  }

  S.ready.then(function (u) {
    wire();
    if (setupKey) { showSetup("key", u ? u.email : ""); return; }
    if (!u) { showSetup("code", ""); return; }
    load().then(function () { if (!$("view").hidden) loadSettings(); });
  });
})();
