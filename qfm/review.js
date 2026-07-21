// QFM owner review mode — completely inert for normal visitors.
// Activates ONLY when the visitor arrives on a private review link
// (?review=1 with the key in the URL fragment, #k=...). The flag and key
// live in sessionStorage so the widget follows the reviewer across pages
// and dies when the tab closes. Notes POST to the same relay ticket store
// the team feedback page reads (topic tag: owner-site-review).
// No secrets in this file — the key arrives only via the private link.
//
// HARD RULE: the note button never appears unless a key is present AND the
// relay has confirmed it works. A half-link (?review=1 with no #k=...) used
// to arm a button whose every send silently failed — it now shows a plain
// "your link is incomplete" notice instead.
(function () {
  'use strict';
  var RELAY = 'https://dlerhetal.pythonanywhere.com/qfm-api';
  var ON_KEY = 'qfmReviewOn', PW_KEY = 'qfmReviewKey';
  var key = '';

  // arm review mode from the link, then scrub the fragment from the bar
  try {
    if (new URLSearchParams(location.search).has('review')) {
      sessionStorage.setItem(ON_KEY, '1');
    }
    var m = (location.hash || '').match(/[#&]k=([^&]+)/);
    if (m) {
      sessionStorage.setItem(PW_KEY, decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (sessionStorage.getItem(ON_KEY) !== '1') return; // normal visitor: stop here
    key = sessionStorage.getItem(PW_KEY) || '';
  } catch (e) { return; } // sessionStorage unavailable: stay inert

  // Full path slug, so directory URLs stay distinct (/qfm/admin/udes/ -> "admin/udes").
  // Drops a leading /qfm/ base if present, any leading/trailing slashes, and a .html/.htm tail.
  var page = location.pathname
    .replace(/^\/qfm(?=\/|$)/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.html?$/i, '') || 'home';
  var pageTitle = (document.title.split('—')[0] || page).trim();
  var topicTitle = (document.title || '').split('—')[0].trim().slice(0, 60).trim();
  var topic = 'owner-site-review — ' + page + (topicTitle ? ' — ' + topicTitle : '');
  var lastSel = '';
  document.addEventListener('selectionchange', function () {
    var box = document.getElementById('qfmRev');
    var sel = String(window.getSelection ? window.getSelection() : '').trim();
    if (sel && !(box && box.contains(document.activeElement))) {
      lastSel = sel.slice(0, 300);
    }
  });

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var css = document.createElement('style');
  css.textContent =
    '#qfmRevTab{position:fixed;bottom:16px;right:14px;z-index:120;background:#c9992e;color:#241a08;' +
    'border:none;border-radius:24px;padding:12px 20px;font:700 14px/1 "Segoe UI",system-ui,sans-serif;' +
    'cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)}' +
    '#qfmRevTab:hover{filter:brightness(1.07)}' +
    '#qfmRev{position:fixed;bottom:16px;right:14px;z-index:121;width:min(340px,92vw);background:#fffdf9;' +
    'border:1px solid #e9dfd0;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.3);' +
    'padding:16px;font-family:"Segoe UI",system-ui,sans-serif;display:none}' +
    '#qfmRev.open{display:block}' +
    '#qfmRev h4{margin:0 0 4px;font-size:15px;color:#2b2118}' +
    '#qfmRev .pg{font-size:12px;color:#7a6f63;margin-bottom:10px}' +
    '#qfmRev .selq{font-size:11.5px;color:#6d5410;background:#fbf0d0;border:1px solid #e6cd8c;' +
    'border-radius:6px;padding:5px 8px;margin-bottom:8px;font-style:italic;word-break:break-word}' +
    '#qfmRev textarea{width:100%;box-sizing:border-box;min-height:92px;font:14px/1.4 "Segoe UI",sans-serif;' +
    'padding:9px 10px;border:1px solid #e9dfd0;border-radius:8px;resize:vertical}' +
    '#qfmRev .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}' +
    '#qfmRevSend{background:#4a5d43;color:#fff;border:none;border-radius:8px;padding:10px 20px;' +
    'font:700 14px "Segoe UI",sans-serif;cursor:pointer}' +
    '#qfmRevSend:disabled{opacity:.55}' +
    '#qfmRevCopy{display:none;background:#fffdf9;color:#a33327;border:1.5px solid #a33327;border-radius:8px;' +
    'padding:9px 16px;font:700 13.5px "Segoe UI",sans-serif;cursor:pointer;order:2}' +
    '#qfmRevCopy.show{display:inline-block}' +
    '#qfmRevX{background:none;border:none;font-size:20px;color:#7a6f63;cursor:pointer;' +
    'position:absolute;top:8px;right:10px}' +
    '#qfmRevMsg{font-size:12.5px;color:#7a6f63;flex:1}' +
    '#qfmRevMsg.ok{color:#4a5d43;font-weight:700}' +
    '#qfmRevMsg.err{color:#a33327;font-weight:700}' +
    // loud, unmistakable send-failure block — never a status whisper
    '#qfmRevMsg.fail{order:3;flex:1 0 100%;font-size:14.5px;line-height:1.35;font-weight:700;color:#8f2a1f;' +
    'background:#fceae7;border:1.5px solid #d8a29a;border-left:5px solid #a33327;border-radius:8px;' +
    'padding:10px 12px;margin-top:2px}' +
    '#qfmRevMsg.fail .hd{display:block;font-size:16px;margin-bottom:4px;letter-spacing:.01em}' +
    '#qfmRevMsg.fail .sub{display:block;font-weight:400;font-size:13px;color:#6b3a33;margin-top:4px}' +
    // incomplete-link notice: same corner, same family as the panel
    '#qfmRevBad{position:fixed;bottom:16px;right:14px;z-index:121;width:min(340px,92vw);background:#fffdf9;' +
    'border:1px solid #e9dfd0;border-left:5px solid #a33327;border-radius:12px;' +
    'box-shadow:0 10px 34px rgba(0,0,0,.3);padding:16px 16px 14px;' +
    'font-family:"Segoe UI",system-ui,sans-serif}' +
    '#qfmRevBad h4{margin:0 0 6px;font-size:15px;color:#8f2a1f}' +
    '#qfmRevBad p{margin:0 0 8px;font-size:13px;line-height:1.45;color:#4a4038}' +
    '#qfmRevBad p:last-child{margin-bottom:0}' +
    '#qfmRevBadX{background:none;border:none;font-size:20px;color:#7a6f63;cursor:pointer;' +
    'position:absolute;top:8px;right:10px}';
  document.head.appendChild(css);

  // ---------------------------------------------------------------- part 1
  // Armed but unusable: say so in plain words, in the same corner, instead of
  // handing the reviewer a button that eats everything they type.
  var badShown = false;
  function showIncompleteLink() {
    if (badShown) return;
    badShown = true;
    var bad = document.createElement('div');
    bad.id = 'qfmRevBad';
    bad.innerHTML =
      '<button id="qfmRevBadX" type="button" title="Close">&times;</button>' +
      '<h4>This review link is incomplete</h4>' +
      '<p><b>Notes cannot be saved from this page.</b> Anything typed here would be lost, ' +
      'so the note box is switched off.</p>' +
      '<p>This happens when the page is opened from browser history, a bookmark, a new tab, ' +
      'or a shortened copy of the link.</p>' +
      '<p>Please open the original link Dale sent you again — tap it straight from that ' +
      'message — and leave the note from there.</p>';
    whenBody(function () {
      document.body.appendChild(bad);
      bad.querySelector('#qfmRevBadX').addEventListener('click', function () {
        bad.parentNode && bad.parentNode.removeChild(bad);
      });
    });
  }

  // ---------------------------------------------------------------- part 3
  var probeUnverified = false; // true only when the pre-flight check couldn't run

  function arm() {
    var tab = document.createElement('button');
    tab.id = 'qfmRevTab';
    tab.type = 'button';
    tab.textContent = 'Leave a note for Dale';

    var panel = document.createElement('div');
    panel.id = 'qfmRev';
    panel.innerHTML =
      '<button id="qfmRevX" type="button" title="Close">&times;</button>' +
      '<h4>Leave a note for Dale</h4>' +
      '<div class="pg">This page: <b></b></div>' +
      '<div class="selq" style="display:none"></div>' +
      '<textarea maxlength="3600" placeholder="What should we change or check on this page?"></textarea>' +
      '<div class="row"><button id="qfmRevSend" type="button">Send</button>' +
      '<button id="qfmRevCopy" type="button">Copy my note</button>' +
      '<div id="qfmRevMsg"></div></div>';
    panel.querySelector('.pg b').textContent = pageTitle;

    whenBody(function () {
      document.body.appendChild(tab);
      document.body.appendChild(panel);
    });

    var selq = panel.querySelector('.selq');
    var ta = panel.querySelector('textarea');
    var sendBtn = panel.querySelector('#qfmRevSend');
    var copyBtn = panel.querySelector('#qfmRevCopy');
    var msg = panel.querySelector('#qfmRevMsg');

    function setMsg(text, cls) {
      msg.textContent = text || '';
      msg.className = cls || '';
      copyBtn.className = '';
      copyBtn.textContent = 'Copy my note';
    }

    function setFailure() {
      msg.className = 'fail';
      msg.innerHTML =
        '<span class="hd">Your note was NOT saved.</span>' +
        'It did not reach Dale. Your words are still in the box above — copy them with the ' +
        'button and text or email them to Dale, or they will be lost when this page closes.' +
        (probeUnverified
          ? '<span class="sub">You can also try Send again, or reopen the original link Dale sent you.</span>'
          : '<span class="sub">You can also try Send once more.</span>');
      copyBtn.className = 'show';
      copyBtn.textContent = 'Copy my note';
    }

    tab.addEventListener('click', function () {
      if (lastSel) {
        selq.style.display = 'block';
        selq.textContent = '“' + lastSel + '”';
      } else { selq.style.display = 'none'; }
      panel.classList.add('open');
      tab.style.display = 'none';
      setMsg('');
      ta.focus();
    });
    panel.querySelector('#qfmRevX').addEventListener('click', function () {
      panel.classList.remove('open');
      tab.style.display = '';
    });

    copyBtn.addEventListener('click', function () {
      var text = ta.value;
      function flash(ok) {
        copyBtn.textContent = ok ? 'Copied ✓' : 'Now press Ctrl+C';
        setTimeout(function () { copyBtn.textContent = 'Copy my note'; }, 3000);
      }
      function legacy() {
        var ok = false;
        try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
        flash(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { flash(true); }, legacy);
        } else { legacy(); }
      } catch (e) { legacy(); }
    });

    sendBtn.addEventListener('click', function () {
      var note = ta.value.trim();
      if (!note) { setMsg('Type the note first.', 'err'); return; }
      var quoted = (selq.style.display !== 'none') ? selq.textContent : '';
      var body = note + (quoted ? '\n\nAbout this text on the page: ' + quoted : '');
      sendBtn.disabled = true;
      setMsg('Sending…');
      fetch(RELAY + '/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: sessionStorage.getItem(PW_KEY) || '',
          action: 'add',
          topic: topic,
          message: body
        })
      }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function () {
          ta.value = '';
          lastSel = '';
          selq.style.display = 'none';
          setMsg('Got it — noted. Send another any time.', 'ok');
          sendBtn.disabled = false;
        })
        .catch(function () {
          // panel stays open, textarea untouched — that text is the only copy
          sendBtn.disabled = false;
          setFailure();
        });
    });
  }

  // ---------------------------------------------------------------- part 2
  // No key at all: never render the button.
  if (!key) { showIncompleteLink(); return; }

  // Key present: prove it works BEFORE the reviewer types a word. 'list' is a
  // read-only probe — it does not create a ticket.
  fetch(RELAY + '/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: key, action: 'list' })
  }).then(function (r) {
    if (!r.ok) { showIncompleteLink(); return; } // rejected credential — same as no key
    arm();
  }).catch(function () {
    // Couldn't reach the relay at all. A transient outage must not lock the
    // owner out, so arm anyway — but remember the check never passed.
    probeUnverified = true;
    arm();
  });
})();
