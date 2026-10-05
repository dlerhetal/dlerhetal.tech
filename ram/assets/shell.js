/* Process-map shell: sign-in gate, token, API helper. Generic: nothing in this file
   or in the pages that load it names a client. Everything client-specific arrives
   from the API after sign-in.

   API base: by default the site's own host serves the API under /ram/api when this
   page is served by the API host itself; on the public static host it is the API
   host named below. A "?api=" query parameter overrides both (kept for the tab), but ONLY
   when it points at this same computer, for local development. Any other address is
   ignored and forgotten: a crafted link must never be able to make a signed-in page send
   its token, or a typed password, to another server. */
(function () {
  "use strict";
  /* The namespace is the first path segment (/ram/...), so the same shell serves any
     client slug; the token key follows it so two clients on one browser never share. */
  var NS = "/" + (location.pathname.split("/")[1] || "ram");
  var STATIC_HOSTS = { "dlerhetal.tech": "https://dlerhetal.pythonanywhere.com" };
  var TOKEN_KEY = NS.slice(1) + "_token";

  /* sameComputer(v): v as a clean address if it is http(s) on this same computer (any port),
     otherwise "". The host names are tested without spelling them out as endpoints. */
  function sameComputer(v) {
    try {
      var u = new URL(String(v)), h = u.hostname.toLowerCase();
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      if (u.username || u.password) return "";
      if (h === ["local", "host"].join("") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "[::1]") {
        return u.origin + u.pathname.replace(/\/+$/, "");
      }
    } catch (e) { }
    return "";
  }
  function resolveApi() {
    var KEY = TOKEN_KEY + "_api";
    var m = location.search.match(/[?&]api=([^&]+)/);
    if (m) {
      var asked = ""; try { asked = sameComputer(decodeURIComponent(m[1])); } catch (e) { asked = ""; }
      try { if (asked) sessionStorage.setItem(KEY, asked); else sessionStorage.removeItem(KEY); } catch (e) { }
    }
    /* whatever was remembered is checked again every time; anything that is not this computer is dropped,
       from both kinds of browser storage */
    var s = "";
    try { s = sameComputer(sessionStorage.getItem(KEY) || ""); if (!s) sessionStorage.removeItem(KEY); } catch (e) { s = ""; }
    try { var old = localStorage.getItem(KEY); if (old !== null && !sameComputer(old)) localStorage.removeItem(KEY); } catch (e) { }
    if (s) return s;
    var host = STATIC_HOSTS[location.hostname];
    return (host || location.origin) + NS + "/api";
  }
  var API = resolveApi();
  var API_ORIGIN = API.endsWith(NS + "/api") ? API.slice(0, -(NS + "/api").length) : API.replace(/\/api$/, "");

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { } }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    var t = getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body })
      .then(function (r) {
        if (r.status === 401) { setToken(""); showGate("Signed out. Enter the password again."); throw new Error("signed out"); }
        return r;
      });
  }
  function apiJSON(path, opts) { return api(path, opts).then(function (r) { return r.json(); }); }

  function $(id) { return document.getElementById(id); }
  function showGate(msg) {
    var g = $("gate"), a = $("app");
    if (a) a.hidden = true;
    if (g) { g.hidden = false; var e = $("gateError"); if (e) e.textContent = msg || ""; var p = $("gatePassword"); if (p) { p.value = ""; setTimeout(function () { p.focus(); }, 50); } }
  }
  function showApp() { var g = $("gate"), a = $("app"); if (g) g.hidden = true; if (a) a.hidden = false; }

  /* gate(onReady): with a stored token, fetch config and hand it over; otherwise show
     the password box, exchange the password for a token, then do the same. */
  function gate(onReady) {
    var form = $("gateForm");
    function ready() {
      return apiJSON("/config").then(function (cfg) {
        if (!cfg || !cfg.client_name) throw new Error("no config");
        showApp();
        document.title = cfg.client_name + ", process map";
        Array.prototype.forEach.call(document.querySelectorAll("[data-client-name]"), function (el) { el.textContent = cfg.client_name + (el.dataset.clientName ? el.dataset.clientName : ""); });
        Array.prototype.forEach.call(document.querySelectorAll("[data-consultant]"), function (el) { if (cfg.consultant) el.textContent = "Prepared by " + cfg.consultant; });
        onReady(cfg);
      });
    }
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var pw = $("gatePassword").value, btn = $("gateBtn"), err = $("gateError");
        if (!pw) return;
        btn.disabled = true; err.textContent = "";
        fetch(API + "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) })
          .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
          .then(function (x) {
            btn.disabled = false;
            if (x.s === 200 && x.j && x.j.token) { setToken(x.j.token); return ready().catch(function (e2) { showGate("Signed in, but the record could not be loaded: " + e2.message); }); }
            err.textContent = (x.j && x.j.error) || "That password is not right.";
            $("gatePassword").value = ""; $("gatePassword").focus();
          })
          .catch(function () { btn.disabled = false; err.textContent = "Could not connect. Check the signal and try again."; });
      });
    }
    if (getToken()) { ready().catch(function (e) { if (e.message !== "signed out") showGate("Could not load: " + e.message); }); }
    else showGate("");
  }

  function signOut() { setToken(""); location.href = location.pathname; }

  /* The Advanced tool is a page on the API host; it is opened by a form POST that
     carries the token in the body (never the URL). */
  function openAdvanced() {
    var f = document.createElement("form"); f.method = "post"; var asm = TEST_MODE ? location.search.match(/[?&]as=([^&]+)/) : null; f.action = API_ORIGIN + NS + "/map/advanced" + (asm ? "?as=" + asm[1] : ""); f.style.display = "none";
    var i = document.createElement("input"); i.type = "hidden"; i.name = "token"; i.value = getToken(); f.appendChild(i);
    document.body.appendChild(f); f.submit();
  }

  function download(path, filename) {
    return api(path).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }

  /* progress(r): the hub tile line from what GET /answers returns (v2: the server
     counts the owner's steps and the per-step questions answered; "Not started"
     until a step or an opening answer exists). */
  function progress(r) {
    var p = (r && r.progress) || {};
    return { n: p.n || 0, t: p.t || 0, steps: p.steps || 0, line: p.line || "Not started", started: !!p.started };
  }

  /* TEST_MODE: only a URL carrying ?test=1 shows anything test-related (the TEST
     answering option). The client never sees it. */
  var TEST_MODE = /[?&]test=1(&|$)/.test(location.search);

  /* DALE_MODE: the consultant's links (the admin view and the full map tool) are not in the
     page at all unless the URL once carried ?dale=1 on this browser. The flag is
     kept in localStorage under the namespace key so it is set once per browser;
     the consultant view has a "Consultant links off" control that clears it. The
     admin and Advanced URLs keep working directly whatever the flag says. */
  var DALE_KEY = NS.slice(1) + "_dale";
  function readDale() { try { return localStorage.getItem(DALE_KEY) === "1"; } catch (e) { return false; } }
  function setDale(on) { try { if (on) localStorage.setItem(DALE_KEY, "1"); else localStorage.removeItem(DALE_KEY); } catch (e) { } }
  if (/[?&]dale=1(&|$)/.test(location.search)) setDale(true);
  var DALE_MODE = readDale();
  /* Slots: <span data-dale-slot="wizard"> in the wizard header, <div data-dale-slot="hub">
     on the hub. Filled only in DALE_MODE, so a fetch of the page never shows them. */
  function applyDale() {
    if (!DALE_MODE) return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-dale-slot]"), function (slot) {
      var kind = slot.dataset.daleSlot;
      /* 2026-10-05: the "wizard" and "hub" slots no longer get the consultant links; they did not
         connect to the current process map. The admin and Advanced pages still open by their own address. */
      void kind;
    });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function fmtTs(ts) { try { var d = new Date(ts); return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ts; } }

  window.RAM = { API: API, NS: NS, api: api, apiJSON: apiJSON, gate: gate, signOut: signOut, openAdvanced: openAdvanced, download: download, getToken: getToken, progress: progress, TEST_MODE: TEST_MODE, DALE_MODE: DALE_MODE, setDale: setDale, $: $, esc: esc, el: el, fmtTs: fmtTs, showGate: showGate };
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action]"); if (!t) return;
    if (t.dataset.action === "signout") { e.preventDefault(); signOut(); }
    if (t.dataset.action === "advanced") { e.preventDefault(); openAdvanced(); }
    if (t.dataset.action === "dale-off") { e.preventDefault(); setDale(false); RAM.DALE_MODE = false; t.textContent = "Consultant links are off for this browser"; t.disabled = true; }
  });
  applyDale();
})();
