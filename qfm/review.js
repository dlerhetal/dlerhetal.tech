// QFM owner review mode — completely inert for normal visitors.
// Activates ONLY when the visitor arrives on a private review link
// (?review=1 with the key in the URL fragment, #k=...). The flag and key
// live in sessionStorage so the widget follows the reviewer across pages
// and dies when the tab closes. Notes POST to the same relay ticket store
// the team feedback page reads (topic tag: owner-site-review).
// No secrets in this file — the key arrives only via the private link.
(function () {
  'use strict';
  var RELAY = 'https://dlerhetal.pythonanywhere.com/qfm-api';
  var ON_KEY = 'qfmReviewOn', PW_KEY = 'qfmReviewKey';

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
  } catch (e) { return; } // sessionStorage unavailable: stay inert

  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/, '') || 'index';
  var pageTitle = (document.title.split('—')[0] || page).trim();
  var lastSel = '';
  document.addEventListener('selectionchange', function () {
    var box = document.getElementById('qfmRev');
    var sel = String(window.getSelection ? window.getSelection() : '').trim();
    if (sel && !(box && box.contains(document.activeElement))) {
      lastSel = sel.slice(0, 300);
    }
  });

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
    '#qfmRev .row{display:flex;gap:10px;align-items:center;margin-top:10px}' +
    '#qfmRevSend{background:#4a5d43;color:#fff;border:none;border-radius:8px;padding:10px 20px;' +
    'font:700 14px "Segoe UI",sans-serif;cursor:pointer}' +
    '#qfmRevSend:disabled{opacity:.55}' +
    '#qfmRevX{background:none;border:none;font-size:20px;color:#7a6f63;cursor:pointer;' +
    'position:absolute;top:8px;right:10px}' +
    '#qfmRevMsg{font-size:12.5px;color:#7a6f63;flex:1}' +
    '#qfmRevMsg.ok{color:#4a5d43;font-weight:700}' +
    '#qfmRevMsg.err{color:#a33327;font-weight:700}';
  document.head.appendChild(css);

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
    '<div class="row"><button id="qfmRevSend" type="button">Send</button><div id="qfmRevMsg"></div></div>';
  panel.querySelector('.pg b').textContent = pageTitle;

  function attach() {
    document.body.appendChild(tab);
    document.body.appendChild(panel);
  }
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);

  var selq = panel.querySelector('.selq');
  var ta = panel.querySelector('textarea');
  var sendBtn = panel.querySelector('#qfmRevSend');
  var msg = panel.querySelector('#qfmRevMsg');

  function setMsg(text, cls) { msg.textContent = text || ''; msg.className = cls || ''; }

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
        topic: 'owner-site-review — ' + page,
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
        sendBtn.disabled = false;
        setMsg('Couldn’t send — your note is still here. ' +
               'Screenshot this and text it to Dale.', 'err');
      });
  });
})();
