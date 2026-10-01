/* dlerhetal.tech site script.

   One script tag on a page gives it:
     - the page view recorded (signed-in people by address, everyone else by a random id);
     - "Signed in as ... Not you?" when this device is known;
     - the email box, but only when a tool that saves asks for it (Site.requireSignIn(), or
       data-require-signin on the script tag). Reading a page never asks for anything;
     - saved work that follows the address to any device (Site.items, Site.saver).

   Sign-in is an email address and nothing else. The server hands this browser a device token,
   kept in localStorage, so a device that has signed in once is not asked again. Nothing about
   any person is in this file or anywhere in the public repo. */
(function () {
  "use strict";
  if (window.Site) return;

  var SCRIPT = document.currentScript;
  var LIVE_API = { "dlerhetal.tech": "https://dlerhetal.pythonanywhere.com/site/api", "www.dlerhetal.tech": "https://dlerhetal.pythonanywhere.com/site/api" };
  var KEY = { token: "site_device", anon: "site_anon", email: "site_email", trusted: "site_trusted", api: "site_api", draft: "site_draft_" };

  /* ---------- storage that never throws ---------- */
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v === "" || v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }

  /* ---------- where the API is ----------
     On the live site it is the fixed address above. A "?api=" override exists for testing and is
     honored ONLY when it points at this same computer, so a crafted link can never send a
     device token to someone else's server. */
  function sameComputer(u) {
    try {
      var h = new URL(u).hostname;
      return h === ["local", "host"].join("") || /^127\.\d+\.\d+\.\d+$/.test(h);
    } catch (e) { return false; }
  }
  function resolveApi() {
    var m = location.search.match(/[?&]api=([^&]+)/);
    if (m) { var v = decodeURIComponent(m[1]).replace(/\/$/, ""); if (sameComputer(v)) ssSet(KEY.api, v); }
    var s = ssGet(KEY.api);
    if (s && sameComputer(s)) return s;
    return LIVE_API[location.hostname] || (location.origin + "/site/api");
  }
  var API = resolveApi();

  /* ---------- identity ---------- */
  var me = { email: "", isTrusted: false, offline: false };
  function token() { return lsGet(KEY.token); }
  function anonId() {
    var a = lsGet(KEY.anon);
    if (a) return a;
    var bytes = new Uint8Array(12), out = "";
    try { crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < bytes.length; j++) out += ("0" + bytes[j].toString(16)).slice(-2);
    lsSet(KEY.anon, out);
    return out;
  }
  function remember(tok, email, trusted) {
    lsSet(KEY.token, tok); lsSet(KEY.email, email); lsSet(KEY.trusted, trusted ? "1" : "");
    me = { email: email, isTrusted: !!trusted, offline: false };
  }
  function forget() {
    lsSet(KEY.token, ""); lsSet(KEY.email, ""); lsSet(KEY.trusted, "");
    me = { email: "", isTrusted: false, offline: false };
  }
  function fire(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { }
  }

  /* ---------- API helper ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    var t = token();
    if (t) headers["Authorization"] = "Bearer " + t;
    var body;
    if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || (body ? "POST" : "GET"), headers: headers, body: body, keepalive: !!opts.keepalive });
  }
  /* Resolves with the JSON on 2xx. Rejects with {status, error, message}; status 0 means the
     site could not be reached at all. A 401 forgets this device's token. */
  function apiJSON(path, opts) {
    return api(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        if (r.status === 401 && token()) { forget(); renderWho(); fire("site:signout", { reason: "expired" }); }
        throw { status: r.status, error: j.error || "", message: j.message || "That did not work. Try again." };
      });
    }, function () { throw { status: 0, error: "offline", message: "Could not reach the site. Check the connection and try again." }; });
  }

  /* ---------- the visit record ----------
     Sent as plain text so the browser makes one request with no preflight. */
  function visit(action, detail) {
    var payload = { page: location.pathname, action: action || "view", detail: detail || "" };
    if (!action || action === "view") payload.ref = document.referrer || "";
    var t = token();
    if (t) payload.t = t; else payload.a = anonId();
    try { fetch(API + "/visit", { method: "POST", body: JSON.stringify(payload), keepalive: true }).catch(function () { }); } catch (e) { }
  }

  /* ---------- small DOM helpers ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmtTime(iso) {
    try { var d = iso ? new Date(iso) : new Date(); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
  }
  function addStyle() {
    if (document.getElementById("siteStyle")) return;
    var s = el("style"); s.id = "siteStyle";
    s.textContent = [
      ".site-who{font:600 13px/1.3 'Inter','Segoe UI',system-ui,sans-serif;color:rgba(255,255,255,.86);display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}",
      ".site-who b{font-weight:700;color:#fff;word-break:break-all}",
      ".site-who button{font:inherit;background:none;border:0;padding:0;color:#fff;text-decoration:underline;cursor:pointer}",
      ".site-who.site-who-float{position:fixed;left:10px;bottom:10px;z-index:900;background:#1A3C6E;padding:7px 12px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);max-width:calc(100vw - 20px)}",
      ".site-who .site-ask{flex-basis:100%;font-weight:500}",
      ".site-sheet{position:fixed;inset:0;z-index:1000;background:rgba(15,39,72,.55);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;overflow:auto}",
      ".site-card{background:#F2F4F7;color:#14213D;border-top:5px solid #CF2A27;border-radius:8px;max-width:440px;width:100%;padding:26px 26px 20px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:16px/1.5 'Inter','Segoe UI',system-ui,sans-serif}",
      ".site-card h2{margin:0 0 6px;font-size:22px;color:#1A3C6E}",
      ".site-card p{margin:0 0 14px}",
      ".site-card label{display:block;font-weight:700;font-size:14px;margin-bottom:4px}",
      ".site-card input[type=email],.site-card input[type=text]{width:100%;box-sizing:border-box;font:inherit;font-size:18px;padding:11px 12px;border:2px solid #1A3C6E;border-radius:6px;background:#fff;color:#14213D}",
      ".site-card input:focus{outline:3px solid rgba(207,42,39,.35)}",
      ".site-go{margin-top:12px;width:100%;font:inherit;font-weight:700;font-size:18px;padding:12px;border:0;border-radius:6px;background:#CF2A27;color:#fff;cursor:pointer;min-height:48px}",
      ".site-go:disabled{opacity:.6;cursor:default}",
      ".site-err{color:#A11F1C;font-weight:600;min-height:1.4em;margin:8px 0 0}",
      ".site-hint{background:#fff;border:1px solid rgba(26,60,110,.3);border-radius:6px;padding:10px 12px;margin-top:10px}",
      ".site-hint button{font:inherit;font-weight:700;margin:8px 8px 0 0;padding:8px 12px;border-radius:6px;border:2px solid #1A3C6E;background:#fff;color:#1A3C6E;cursor:pointer;min-height:44px}",
      ".site-hint button.pri{background:#1A3C6E;color:#fff}",
      ".site-fine{font-size:13px;color:#5B6777;margin:16px 0 0;border-top:1px solid rgba(26,60,110,.2);padding-top:12px}",
      ".site-back{display:inline-block;margin-top:10px;font-size:14px;color:#1A3C6E}",
      ".site-trap{position:absolute;left:-6000px;top:auto;width:1px;height:1px;overflow:hidden}",
      ".site-note{background:#FFF7D6;color:#14213D;border-bottom:1px solid #E0C766;padding:10px 16px;font:15px/1.4 'Inter','Segoe UI',system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center}",
      ".site-note button{font:inherit;font-weight:700;background:none;border:0;padding:0;color:#A11F1C;text-decoration:underline;cursor:pointer}",
      "@media print{.site-who-float,.site-sheet,.site-note{display:none!important}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ---------- "Signed in as ... Not you?" ---------- */
  var whoEl = null;
  function whoSlot() {
    if (whoEl && document.contains(whoEl)) return whoEl;
    addStyle();
    var host = document.querySelector("[data-site-who]");
    whoEl = el("span", "site-who");
    whoEl.setAttribute("data-site-who-line", "");
    if (host) host.appendChild(whoEl);
    else {
      var bar = document.querySelector("nav.topbar .topbar-inner");
      if (bar) bar.appendChild(whoEl);
      else { whoEl.className = "site-who site-who-float"; document.body.appendChild(whoEl); }
    }
    return whoEl;
  }
  function renderWho() {
    if (!document.body) return;
    if (!me.email) { if (whoEl && whoEl.parentNode) { whoEl.parentNode.removeChild(whoEl); whoEl = null; } return; }
    var slot = whoSlot();
    slot.textContent = "";
    slot.appendChild(document.createTextNode("Signed in as "));
    slot.appendChild(el("b", null, me.email));
    var btn = el("button", null, "Not you?");
    btn.type = "button";
    btn.setAttribute("data-site-notyou", "");
    btn.addEventListener("click", function () {
      if (!me.isTrusted) { signOut(); return; }
      /* an owner's device: say what leaving costs, on the page, and let him choose */
      btn.hidden = true;
      var ask = el("span", "site-ask", "This is one of the site owner's devices. Signing out here means setting it up again. ");
      var yes = el("button", null, "Sign out"); yes.type = "button"; yes.setAttribute("data-site-notyou-yes", "");
      var no = el("button", null, "Stay signed in"); no.type = "button";
      yes.addEventListener("click", function () { signOut(); });
      no.addEventListener("click", function () { renderWho(); });
      ask.appendChild(yes); ask.appendChild(document.createTextNode("  ")); ask.appendChild(no);
      slot.appendChild(ask);
    });
    slot.appendChild(document.createTextNode(" "));
    slot.appendChild(btn);
  }

  /* ---------- the email box ---------- */
  var DOMAIN_FIX = {
    "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
    "gmal.com": "gmail.com", "gmail.cm": "gmail.com", "gmaill.com": "gmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
    "hotmail.co": "hotmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com", "outlok.com": "outlook.com",
    "outloo.com": "outlook.com", "outlook.co": "outlook.com", "iclod.com": "icloud.com", "icould.com": "icloud.com", "icloud.co": "icloud.com",
    "aol.co": "aol.com", "comcast.ent": "comcast.net", "att.ent": "att.net"
  };
  function suggest(email) {
    var at = email.lastIndexOf("@");
    if (at < 1) return "";
    var name = email.slice(0, at), dom = email.slice(at + 1).toLowerCase();
    var fix = DOMAIN_FIX[dom];
    if (!fix && /\.(con|cmo|ocm|vom|xom)$/.test(dom)) fix = dom.replace(/\.[a-z]+$/, ".com");
    return fix ? name + "@" + fix : "";
  }

  var sheet = null, waiting = [];
  function closeSheet() { if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); sheet = null; }
  function openSheet(prefill) {
    if (sheet) return;
    addStyle();
    sheet = el("div", "site-sheet");
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "siteSheetTitle");
    var form = el("form", "site-card"); form.noValidate = true; form.id = "siteSignIn";
    var h = el("h2", null, "Type your email to start"); h.id = "siteSheetTitle";
    form.appendChild(h);
    form.appendChild(el("p", null, "No password. Your work is saved under this address, so it is here when you come back, on any phone or computer."));
    var lab = el("label", null, "Your email"); lab.htmlFor = "siteEmail";
    var input = el("input"); input.type = "email"; input.id = "siteEmail"; input.name = "email"; input.autocomplete = "email";
    input.setAttribute("inputmode", "email"); input.setAttribute("autocapitalize", "none"); input.spellcheck = false; input.value = prefill || "";
    var trapWrap = el("div", "site-trap"); trapWrap.setAttribute("aria-hidden", "true");
    var trap = el("input"); trap.type = "text"; trap.name = "website"; trap.tabIndex = -1; trap.autocomplete = "off";
    trapWrap.appendChild(trap);
    var go = el("button", "site-go", "Go"); go.type = "submit"; go.id = "siteGo";
    var hint = el("div", "site-hint"); hint.hidden = true; hint.id = "siteHint";
    var err = el("p", "site-err"); err.id = "siteErr"; err.setAttribute("role", "alert");
    var fine = el("p", "site-fine", "Anyone who types this address can open what is saved under it, so keep confidential work off this site. Dale Linn runs this site. He can see who signs in and can look at what is saved here.");
    var back = el("a", "site-back", "Back to the site"); back.href = "/";
    form.appendChild(lab); form.appendChild(input); form.appendChild(trapWrap); form.appendChild(hint); form.appendChild(go);
    form.appendChild(err); form.appendChild(fine); form.appendChild(back);
    sheet.appendChild(form);
    document.body.appendChild(sheet);
    setTimeout(function () { input.focus(); }, 30);

    var passed = "";   /* an address the person said to keep as typed */
    function send(email) {
      go.disabled = true; err.textContent = ""; hint.hidden = true;
      /* "a" is this browser's random id, so the pages it read before signing in can be shown with the person */
      apiJSON("/signin", { json: { email: email, website: trap.value, page: location.pathname, a: lsGet(KEY.anon) } }).then(function (j) {
        remember(j.token, j.email, j.isTrusted);
        closeSheet(); renderWho();
        if (j.isNew) newNote(j.email);
        fire("site:signin", { email: j.email, isNew: !!j.isNew, itemCount: j.itemCount || 0 });
        var list = waiting; waiting = [];
        list.forEach(function (cb) { try { cb(user()); } catch (e) { } });
      }, function (x) {
        go.disabled = false;
        err.textContent = x.message;
        input.focus();
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!email) { err.textContent = "Type your email address."; input.focus(); return; }
      var better = email === passed ? "" : suggest(email);
      if (!better) { send(email); return; }
      hint.textContent = "";
      hint.appendChild(document.createTextNode("Did you mean "));
      hint.appendChild(el("b", null, better));
      hint.appendChild(document.createTextNode("?"));
      hint.appendChild(el("br"));
      var yes = el("button", "pri", "Yes, use that"); yes.type = "button"; yes.id = "siteHintYes";
      var no = el("button", null, "No, keep what I typed"); no.type = "button"; no.id = "siteHintNo";
      yes.addEventListener("click", function () { input.value = better; send(better); });
      no.addEventListener("click", function () { passed = email; send(email); });
      hint.appendChild(yes); hint.appendChild(no);
      hint.hidden = false; err.textContent = "";
    });
  }

  /* A brand-new address gets one line, not an extra step: catches a typo without slowing
     down anyone who typed it right. */
  function newNote(email) {
    var old = document.getElementById("siteNewNote");
    if (old) old.parentNode.removeChild(old);
    addStyle();
    var n = el("div", "site-note"); n.id = "siteNewNote"; n.setAttribute("role", "status");
    var line = el("span");
    line.appendChild(document.createTextNode("New workspace started for "));
    line.appendChild(el("b", null, email));
    line.appendChild(document.createTextNode(". Wrong address?"));
    var fix = el("button", null, "Fix it"); fix.type = "button"; fix.id = "siteFixIt";
    var ok = el("button", null, "It is right"); ok.type = "button"; ok.id = "siteNoteOk";
    fix.addEventListener("click", function () { n.parentNode.removeChild(n); signOut(email); });
    ok.addEventListener("click", function () { n.parentNode.removeChild(n); });
    n.appendChild(line); n.appendChild(fix); n.appendChild(ok);
    var nav = document.querySelector("nav.topbar");
    if (nav && nav.parentNode) nav.parentNode.insertBefore(n, nav.nextSibling); else document.body.insertBefore(n, document.body.firstChild);
  }

  /* ---------- sign-in state ---------- */
  var needSignIn = false;
  function user() { return me.email ? { email: me.email, isTrusted: me.isTrusted, offline: me.offline } : null; }

  var ready = new Promise(function (resolve) {
    function start() {
      if (!token()) { resolve(null); return; }
      apiJSON("/me").then(function (j) {
        me = { email: j.email, isTrusted: !!j.isTrusted, offline: false };
        lsSet(KEY.email, j.email); lsSet(KEY.trusted, j.isTrusted ? "1" : "");
        resolve(user());
      }, function (x) {
        if (x.status === 0 && token()) {
          /* the site cannot be reached: keep working as the address this device last had */
          me = { email: lsGet(KEY.email), isTrusted: lsGet(KEY.trusted) === "1", offline: true };
          resolve(user());
        } else resolve(null);
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  });

  /* requireSignIn(cb): run cb(user) once this browser is signed in. Shows the box only if it
     has to. A tool that saves calls this; a page that only reads never does. */
  function requireSignIn(cb) {
    needSignIn = true;
    return ready.then(function (u) {
      if (u) { if (cb) cb(u); return u; }
      return new Promise(function (resolve) {
        waiting.push(function (nu) { if (cb) cb(nu); resolve(nu); });
        openSheet("");
      });
    });
  }

  function signOut(prefill) {
    var had = !!token();
    var done = function () {
      forget(); renderWho();
      fire("site:signout", { reason: "notYou" });
      if (needSignIn) openSheet(typeof prefill === "string" ? prefill : "");
    };
    if (!had) { done(); return Promise.resolve(); }
    return api("/signout", { json: { page: location.pathname } }).then(done, done);
  }

  /* ---------- saved work ---------- */
  var items = {
    list: function (tool) { return apiJSON("/items" + (tool ? "?tool=" + encodeURIComponent(tool) : "")).then(function (j) { return j.items; }); },
    create: function (tool, title, body) { return apiJSON("/items", { json: { tool: tool, title: title, body: body === undefined ? null : body } }); },
    get: function (id) { return apiJSON("/items/" + id); },
    save: function (id, body, opts) {
      opts = opts || {};
      var j = { body: body, kind: opts.named ? "named" : "auto", note: opts.note || "" };
      if (typeof opts.baseRev === "number") j.baseRev = opts.baseRev;
      if (opts.title != null) j.title = opts.title;
      return apiJSON("/items/" + id + "/save", { json: j, keepalive: !!opts.keepalive });
    },
    history: function (id, versionId) { return apiJSON("/items/" + id + "/history" + (versionId ? "?versionId=" + versionId : "")); },
    restore: function (id, versionId) { return apiJSON("/items/" + id + "/restore", { json: { versionId: versionId } }); },
    archive: function (id) { return apiJSON("/items/" + id + "/archive", { method: "POST" }); },
    unarchive: function (id) { return apiJSON("/items/" + id + "/unarchive", { method: "POST" }); },
    rename: function (id, title) { return apiJSON("/items/" + id + "/rename", { json: { title: title } }); }
  };

  /* A change that has not reached the site yet is kept on this device under site_draft_<id>,
     so closing the page or losing the connection never loses it. */
  function pendingDraft(id) {
    try { var d = JSON.parse(lsGet(KEY.draft + id) || "null"); return d && d.body ? d : null; } catch (e) { return null; }
  }

  /* saver({itemId, rev, getBody, onStatus, delay}): autosave for one item.
       .changed()         call after every edit
       .flush()           save now
       .saveNamed(note)   keep a named version that autosave never replaces
       .setRev(n)         after a restore
       .stop()
     onStatus gets {state, text}: state is saving | saved | offline | conflict | error | signedOut. */
  function saver(o) {
    var id = o.itemId, rev = o.rev, delay = o.delay || 2500;
    var timer = null, retry = null, dirty = false, busy = false, again = false, tries = 0, stopped = false;
    function say(state, text) { if (o.onStatus) { try { o.onStatus({ state: state, text: text }); } catch (e) { } } }
    function keepLocal(body) { return lsSet(KEY.draft + id, JSON.stringify({ body: body, baseRev: rev, ts: new Date().toISOString() })); }
    function push(named, note, keepalive) {
      if (stopped) return Promise.resolve();
      if (busy) { again = true; return Promise.resolve(); }
      var body = o.getBody();
      busy = true; dirty = false;
      clearTimeout(timer); clearTimeout(retry);
      say("saving", "Saving");
      return items.save(id, body, { baseRev: rev, named: named, note: note, keepalive: keepalive }).then(function (j) {
        busy = false; tries = 0; rev = j.rev;
        if (!dirty && !again) lsSet(KEY.draft + id, "");
        if (j.conflict) say("conflict", "Saved " + fmtTime(j.savedUtc) + ". This was also changed on another device. Both versions are in History.");
        else say("saved", "Saved " + fmtTime(j.savedUtc));
        if (again || dirty) { again = false; schedule(); }
        return j;
      }, function (x) {
        busy = false; dirty = true;
        if (x.status === 0 || x.status >= 500 || x.status === 429) {
          tries += 1;
          say("offline", "Not saved to the site yet. Kept on this device. Trying again.");
          retry = setTimeout(function () { push(false, "", false); }, Math.min(30000, 4000 * tries));
        } else if (x.status === 401) {
          say("signedOut", "Signed out. Your changes are kept on this device. Sign in again to save them.");
          requireSignIn(function () { push(false, "", false); });
        } else {
          say("error", x.message);
        }
        again = false;
      });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(function () { push(false, "", false); }, delay); }
    function changed() {
      if (stopped) return;
      dirty = true;
      if (!keepLocal(o.getBody())) say("error", "This browser would not keep a copy. Stay on the page until it says Saved.");
      else say("saving", "Saving");
      schedule();
    }
    function onHide() { if (document.visibilityState === "hidden" && dirty && !busy) push(false, "", true); }
    function onOnline() { if (dirty && !busy) push(false, "", false); }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return {
      changed: changed,
      flush: function () { return push(false, "", false); },
      saveNamed: function (note) { return push(true, note || "", false); },
      setRev: function (n) { rev = n; },
      rev: function () { return rev; },
      stop: function () { stopped = true; clearTimeout(timer); clearTimeout(retry); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("online", onOnline); }
    };
  }

  window.Site = {
    API: API, ready: ready, user: user, requireSignIn: requireSignIn, signOut: signOut, visit: visit,
    api: api, apiJSON: apiJSON, items: items, saver: saver, pendingDraft: pendingDraft, fmtTime: fmtTime,
    /* for the owner's setup page only: adopt a token the server just issued */
    adopt: function (tok, email, trusted) { remember(tok, email, trusted); renderWho(); fire("site:signin", { email: email, isNew: false }); }
  };

  ready.then(function () {
    renderWho();
    if (!SCRIPT || !SCRIPT.hasAttribute("data-no-view")) visit("view");
    if (SCRIPT && SCRIPT.hasAttribute("data-require-signin")) requireSignIn();
  });
})();
