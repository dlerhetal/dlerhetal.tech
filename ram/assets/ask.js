/* Ask panel: the floating "Ask" button and its chat drawer, ported from the /qbo/ wizard
   pages (same help service, same request shape: {code, message, page, step, history}).
   Generic: nothing here names a client. The page supplies its context through
   RAMASK.setContext(fn), where fn() returns {page, step}; the help service reads those two
   fields. RAMASK.start() adds the button (the page calls it after sign-in). A signed-in page may hand over the access code with RAMASK.setCode(code), kept
   in memory only; without it the panel asks for the code the same way the /qbo/ pages do.
   The service only answers pages served from https://dlerhetal.tech, so test it there. */
(function () {
  "use strict";
  var ENDPOINT = "https://dlerhetal.pythonanywhere.com/qbo/chat";
  var CODE_KEY = "qbo_wizard_ask_code";
  var memCode = "";
  var ctxFn = function () { return { page: document.title || "Fix list", step: "" }; };

  var css = [
    "#askBtn{position:fixed;right:18px;bottom:18px;z-index:9999;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:#c62828;color:#fff;box-shadow:0 5px 16px rgba(0,0,0,.35);cursor:pointer;font-family:inherit;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}",
    "#askBtn:hover,#askBtn:focus{background:#96201a;outline:none}",
    "#askBtn:focus-visible{box-shadow:0 0 0 4px #FFCD00}",
    "#askBtn .ico{font-size:23px;font-weight:bold}",
    "#askBtn .lbl{font-size:12px;font-weight:bold;letter-spacing:.6px;margin-top:3px;text-transform:uppercase}",
    "#askPanel{position:fixed;right:18px;bottom:94px;z-index:10000;width:392px;max-width:calc(100vw - 24px);max-height:72vh;display:flex;flex-direction:column;background:#fff;border:1px solid #d7dde6;border-radius:8px;box-shadow:0 10px 34px rgba(0,0,0,.30);font-size:16px;overflow:hidden}",
    "#askPanel[hidden]{display:none !important}",
    "#askPanel .askhead{background:#1A3C6E;color:#fff;padding:11px 14px;font-weight:bold;font-size:17px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #FFCD00}",
    "#askPanel .askhead button{background:none;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:0 6px;font-family:inherit;min-height:44px;min-width:44px}",
    "#askPanel .askpad{padding:13px 14px}",
    "#askPanel p{margin:8px 0;font-size:15px}",
    "#askPanel label{display:block;font-size:13px;font-weight:bold;color:#1A3C6E;text-transform:uppercase;letter-spacing:.4px;margin:8px 0 4px}",
    "#askPanel input,#askPanel textarea{width:100%;padding:9px 10px;border:2px solid #c6d2e4;border-radius:4px;font-family:inherit;font-size:16px;background:#fcfdff;color:#1b1b1b;box-sizing:border-box}",
    "#askPanel textarea{resize:vertical;min-height:62px}",
    "#askPanel .askgo{margin-top:9px;background:#1A3C6E;color:#fff;border:0;border-radius:4px;padding:10px 18px;font-family:inherit;font-size:16px;font-weight:bold;cursor:pointer;min-height:44px}",
    "#askPanel .askgo:hover{background:#2E5496}",
    "#askPanel .askgo[disabled]{background:#9aa7ba;cursor:default}",
    "#askLog{flex:1 1 auto;overflow-y:auto;padding:13px 14px 4px;background:#eef1f6}",
    "#askLog .turn{margin:0 0 11px;padding:9px 12px;border-radius:6px;font-size:15px;line-height:1.5;word-wrap:break-word}",
    "#askLog .me{background:#e4ebf7;border-left:5px solid #2E5496}",
    "#askLog .them{background:#fff;border:1px solid #d7dde6;border-left:5px solid #FFCD00}",
    "#askLog .who{display:block;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#5a5a5a;margin-bottom:3px}",
    "#askCtx{padding:6px 14px 0;font-size:13px;color:#5a5a5a}",
    ".askmsg{min-height:19px;font-size:14px;font-weight:bold}",
    ".askmsg.work{color:#2E5496}.askmsg.bad{color:#a4262c}.askmsg.good{color:#0f6b3f}",
    "#askForget{background:none;border:0;color:#5a5a5a;font-family:inherit;font-size:13px;text-decoration:underline;cursor:pointer;padding:4px 0 0}",
    "@media (max-width:520px){#askPanel{right:10px;left:10px;width:auto;bottom:86px;max-height:76vh}#askBtn{right:12px;bottom:12px;width:58px;height:58px}}",
    "@media print{#askBtn,#askPanel{display:none !important}}"
  ].join("\n");

  function build() {
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<button type="button" id="askBtn" aria-expanded="false" aria-controls="askPanel" aria-label="Ask a question about this step"><span class="ico" aria-hidden="true">?</span><span class="lbl">Ask</span></button>' +
      '<div id="askPanel" role="dialog" aria-labelledby="askTitle" hidden>' +
      '<div class="askhead"><span id="askTitle">Ask about this step</span><button type="button" id="askClose" aria-label="Close the ask panel">&times;</button></div>' +
      '<div id="askGate" class="askpad"><p>This helper needs its access code. Type the code you were given. This browser will remember it.</p>' +
      '<label for="askCode">Access code</label><input id="askCode" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button type="button" class="askgo" id="askSave">Save and continue</button><p class="askmsg" id="askGateMsg"></p></div>' +
      '<div id="askLog" hidden aria-live="polite"></div><div id="askCtx" hidden></div>' +
      '<div id="askForm" class="askpad" hidden><label for="askInput">Your question</label>' +
      '<textarea id="askInput" rows="3" placeholder="What is on your screen that does not match the step?"></textarea>' +
      '<button type="button" class="askgo" id="askSend">Send</button><p class="askmsg" id="askMsg"></p>' +
      '<button type="button" id="askForget" hidden>Forget the code on this browser</button></div></div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function init() {
    build();
    var $ = function (id) { return document.getElementById(id); };
    var btn = $("askBtn"), panel = $("askPanel"), gate = $("askGate"), gateMsg = $("askGateMsg"), codeBox = $("askCode");
    var log = $("askLog"), ctx = $("askCtx"), form = $("askForm"), input = $("askInput"), sendBtn = $("askSend"), msg = $("askMsg"), forgetBtn = $("askForget");
    var history = [], busy = false;

    function stored() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
    function setStored(v) { try { if (v) localStorage.setItem(CODE_KEY, v); else localStorage.removeItem(CODE_KEY); } catch (e) { } }
    function getCode() { return memCode || stored(); }
    function say(el, text, kind) { el.className = "askmsg" + (kind ? " " + kind : ""); el.textContent = text || ""; }
    function context() { var c = {}; try { c = ctxFn() || {}; } catch (e) { c = {}; } return { page: String(c.page || "").slice(0, 160), step: String(c.step || "").slice(0, 240) }; }
    function addTurn(who, text) {
      var w = document.createElement("div"); w.className = "turn " + (who === "You" ? "me" : "them");
      var t = document.createElement("span"); t.className = "who"; t.textContent = who; w.appendChild(t);
      /* the helper writes **bold**; show it as bold using text nodes only (never innerHTML) */
      String(text).split("\n").forEach(function (line, i) {
        if (i) w.appendChild(document.createElement("br"));
        line.split(/\*\*(.+?)\*\*/).forEach(function (part, j) {
          if (!part) return;
          if (j % 2) { var bb = document.createElement("b"); bb.textContent = part; w.appendChild(bb); }
          else w.appendChild(document.createTextNode(part));
        });
      });
      log.appendChild(w); log.scrollTop = log.scrollHeight;
    }
    function showGate(show) { gate.hidden = !show; log.hidden = show; ctx.hidden = show; form.hidden = show; forgetBtn.hidden = !!memCode; }
    function refreshCtx() { var c = context(); ctx.textContent = "Answering about: " + (c.step || c.page); }
    function openPanel() {
      panel.hidden = false; btn.setAttribute("aria-expanded", "true");
      if (getCode()) {
        showGate(false); refreshCtx();
        if (!log.childNodes.length) addTurn("Helper", "Ask anything about the step you are on, or about what you see in QuickBooks. Answers are short.");
        input.focus();
      } else { showGate(true); say(gateMsg, ""); codeBox.focus(); }
    }
    function closePanel() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    btn.addEventListener("click", function () { if (panel.hidden) openPanel(); else closePanel(); });
    $("askClose").addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) closePanel(); });
    $("askSave").addEventListener("click", function () {
      var v = (codeBox.value || "").trim();
      if (!v) { say(gateMsg, "Type the code first.", "bad"); return; }
      setStored(v); codeBox.value = ""; openPanel();
    });
    codeBox.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("askSave").click(); } });
    forgetBtn.addEventListener("click", function () { setStored(""); history = []; log.innerHTML = ""; showGate(true); say(gateMsg, "The code was removed from this browser.", "good"); });

    function send() {
      if (busy) return;
      var q = (input.value || "").trim();
      if (!q) { say(msg, "Type a question first.", "bad"); return; }
      var code = getCode();
      if (!code) { showGate(true); return; }
      busy = true; sendBtn.disabled = true; say(msg, "Sending your question.", "work");
      addTurn("You", q); input.value = "";
      var c = context();
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code, message: q, page: c.page, step: c.step, history: history.slice(-12) })
      }).then(function (res) {
        say(msg, "Working on an answer.", "work");
        return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, data: d }; });
      }).then(function (r) {
        if (r.status === 200 && r.data && r.data.reply) {
          history.push({ role: "user", content: q }); history.push({ role: "assistant", content: r.data.reply });
          addTurn("Helper", r.data.reply); say(msg, "", "");
        } else if (r.status === 401) {
          memCode = ""; setStored(""); showGate(true); say(gateMsg, "That code was not accepted. Check it and try again.", "bad");
        } else if (r.status === 429) {
          addTurn("Helper", (r.data && r.data.error) || "The daily limit has been reached. Please try again tomorrow."); say(msg, "Limit reached.", "bad");
        } else {
          addTurn("Helper", (r.data && r.data.error) || "The answer did not come back. Please try again."); say(msg, "That did not go through.", "bad");
        }
      }).catch(function () {
        addTurn("Helper", "The help service could not be reached. Check the internet connection. Everything on this page still works without it.");
        say(msg, "Could not reach the service.", "bad");
      }).then(function () { busy = false; sendBtn.disabled = false; refreshCtx(); });
    }
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    window.RAMASK.refresh = function () { if (!panel.hidden && gate.hidden) refreshCtx(); };
  }

  window.RAMASK = {
    setContext: function (fn) { if (typeof fn === "function") ctxFn = fn; },
    setCode: function (c) { memCode = String(c || ""); },
    refresh: function () { },
    start: function () { if (started) return; started = true; init(); }
  };
  var started = false;
})();
