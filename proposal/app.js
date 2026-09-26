/*
 * Business Plan Wizard: the page.
 * MIT License, see LICENSE in this folder.
 *
 * Answers save to this browser's localStorage only. Nothing is sent anywhere.
 * The Word and Excel libraries load the first time someone asks for a download.
 */
(function () {
  'use strict';

  var Q = window.BPW_Q, Model = window.BPW_Model, Plan = window.BPW_Plan;
  var STEPS = Q.STEPS;
  var KEY = 'dlerhetal.proposal.v1';
  var LIST_LIMITS = { expenses: 25, uses: 30, debts: 20 };
  var REVIEW = STEPS.length; // index of the review step

  var state = { answers: {}, step: 0 };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) { var p = JSON.parse(raw); if (p && typeof p === 'object' && p.answers) state = { answers: p.answers, step: +p.step || 0 }; }
  } catch (e) { /* storage blocked: the wizard still works for this visit */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var A = function () { return state.answers; };
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var money = Plan.money, pct = Plan.pct, ratio = Plan.ratio;

  function stepDone(i) {
    var s = STEPS[i];
    return s.fields.every(function (f) { return !f.req || !Plan.blank(A()[f.id]); }) &&
      s.fields.some(function (f) { return !Plan.blank(A()[f.id]); });
  }

  /* ---------------- Stepper ---------------- */
  function renderStepper() {
    var ul = $('stepper'); ul.innerHTML = '';
    STEPS.concat([{ short: 'Review and download' }]).forEach(function (s, i) {
      var li = el('li');
      var b = el('button', { type: 'button', 'aria-label': 'Go to ' + (s.title || s.short) }, esc((i < REVIEW ? (i + 1) + '. ' : '') + s.short));
      if (i === state.step) { b.className = 'current'; b.setAttribute('aria-current', 'step'); }
      if (i < REVIEW && stepDone(i)) b.className += ' done';
      b.addEventListener('click', function () { go(i); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function go(i) {
    state.step = Math.max(0, Math.min(REVIEW, i)); save(); render();
    var top = $('wizardTop'); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Field renderers ---------------- */
  function setAns(id, v) { A()[id] = v; save(); refreshLive(); renderStepper(); }

  function exampleText(f) {
    if (f.type === 'list') return (f.example || []).map(function (r) { return f.columns.map(function (c) { var v = r[c.id]; return c.type === 'money' ? money(v) : (c.type === 'percent' ? v + '%' : v); }).join(', '); }).join('; ');
    if (f.type === 'money') return money(f.example);
    if (f.type === 'percent') return f.example + '%';
    return String(f.example);
  }

  function scalarInput(f, value, onChange, idAttr) {
    var inp;
    if (f.type === 'textarea') { inp = el('textarea', { id: idAttr, rows: 4 }); inp.value = value == null ? '' : value; }
    else if (f.type === 'select') {
      inp = el('select', { id: idAttr });
      inp.appendChild(el('option', { value: '' }, 'Choose one'));
      f.options.forEach(function (o) { var op = el('option', { value: o }, esc(o)); inp.appendChild(op); });
      inp.value = value == null ? '' : value;
    } else if (f.type === 'money' || f.type === 'percent' || f.type === 'number') {
      inp = el('input', { id: idAttr, type: 'number', inputmode: 'decimal', step: f.type === 'money' ? '1' : 'any' });
      inp.value = value == null ? '' : value;
    } else if (f.type === 'month') { inp = el('input', { id: idAttr, type: 'month' }); inp.value = value || ''; }
    else if (f.type === 'date') { inp = el('input', { id: idAttr, type: 'date' }); inp.value = value || ''; }
    else { inp = el('input', { id: idAttr, type: 'text' }); inp.value = value == null ? '' : value; }
    var evt = (inp.tagName === 'SELECT' || f.type === 'month' || f.type === 'date') ? 'change' : 'input';
    inp.addEventListener(evt, function () {
      var v = inp.value;
      if ((f.type === 'money' || f.type === 'percent' || f.type === 'number') && v !== '') v = parseFloat(v);
      onChange(v);
    });
    if (f.type === 'money' || f.type === 'percent') {
      var wrap = el('div', { class: 'affix' });
      if (f.type === 'money') wrap.appendChild(el('span', { class: 'pre' }, '$'));
      wrap.appendChild(inp);
      if (f.type === 'percent') wrap.appendChild(el('span', { class: 'post' }, '%'));
      return wrap;
    }
    return inp;
  }

  function renderField(f) {
    var box = el('div', { class: 'field', 'data-field': f.id });
    var fid = 'f_' + f.id;
    if (f.type === 'list' || f.type === 'group') box.appendChild(el('div', { class: 'lbl' }, esc(f.label) + (f.req ? '<span class="req">Lenders expect this</span>' : '')));
    else box.appendChild(el('label', { for: fid }, esc(f.label) + (f.req ? '<span class="req">Lenders expect this</span>' : '')));
    if (f.help) box.appendChild(el('p', { class: 'help' }, esc(f.help)));

    if (f.type === 'list') box.appendChild(renderList(f));
    else if (f.type === 'group') box.appendChild(renderGroup(f));
    else box.appendChild(scalarInput(f, A()[f.id], function (v) { setAns(f.id, v); }, fid));

    if (f.type !== 'group' && f.example != null && !(Array.isArray(f.example) && !f.example.length)) {
      var ex = el('div', { class: 'example' }, '<b>Example:</b> ' + esc(exampleText(f)));
      var use = el('button', { type: 'button', class: 'btn link' }, 'Use this example');
      use.addEventListener('click', function () {
        if (!Plan.blank(A()[f.id]) && !confirm('Replace your answer with the example?')) return;
        A()[f.id] = JSON.parse(JSON.stringify(f.example)); save(); render();
      });
      ex.appendChild(use);
      box.appendChild(ex);
    }
    return box;
  }

  function renderList(f) {
    var wrap = el('div');
    var rows = Array.isArray(A()[f.id]) ? A()[f.id] : [];
    if (!rows.length) { rows = [{}]; A()[f.id] = rows; }
    var limit = LIST_LIMITS[f.id] || 15;
    var tmpl = f.columns.map(function (c) { return c.type === 'text' && f.columns.length > 2 && c === f.columns[0] ? '1.4fr' : (c.type === 'text' ? '1.4fr' : '1fr'); }).join(' ') + ' auto';
    rows.forEach(function (row, ri) {
      var r = el('div', { class: 'lrow' });
      r.style.gridTemplateColumns = tmpl;
      f.columns.forEach(function (c) {
        var col = el('div', { class: 'col' });
        var cid = 'f_' + f.id + '_' + ri + '_' + c.id;
        col.appendChild(el('label', { for: cid }, esc(c.label)));
        var ctl = scalarInput(c, row[c.id], function (v) { row[c.id] = v; setAns(f.id, rows); updateListTotal(); }, cid);
        col.appendChild(ctl);
        r.appendChild(col);
      });
      var rm = el('button', { type: 'button', class: 'btn ghost small rm', 'aria-label': 'Remove row ' + (ri + 1) }, 'Remove');
      rm.addEventListener('click', function () { rows.splice(ri, 1); setAns(f.id, rows); render(); });
      r.appendChild(rm);
      wrap.appendChild(r);
    });
    var add = el('button', { type: 'button', class: 'btn ghost small' }, 'Add a row');
    if (rows.length >= limit) { add.disabled = true; add.textContent = 'Limit of ' + limit + ' rows reached'; }
    add.addEventListener('click', function () { rows.push({}); setAns(f.id, rows); render(); });
    wrap.appendChild(add);
    var moneyCol = f.id === 'debts' ? f.columns.filter(function (c) { return c.id === 'payment'; })[0]
      : f.columns.filter(function (c) { return c.type === 'money'; })[0];
    var tot = el('p', { class: 'ltotal' });
    function updateListTotal() {
      if (!moneyCol) return;
      var t = rows.reduce(function (s, r) { return s + (parseFloat(r[moneyCol.id]) || 0); }, 0);
      tot.textContent = 'Total ' + moneyCol.label.toLowerCase() + ': ' + money(t);
    }
    if (moneyCol) { updateListTotal(); wrap.appendChild(tot); }
    return wrap;
  }

  function renderGroup(f) {
    var g = el('div', { class: 'group' });
    var vals = A()[f.id] && typeof A()[f.id] === 'object' ? A()[f.id] : {};
    A()[f.id] = vals;
    var totalEl = el('span', { class: 'gtotal' });
    function upd() { var t = 0; Object.keys(vals).forEach(function (k) { t += parseFloat(vals[k]) || 0; }); totalEl.textContent = money(t); }
    f.items.forEach(function (it) {
      var id = 'f_' + f.id + '_' + it[0];
      g.appendChild(el('label', { for: id }, esc(it[1])));
      g.appendChild(scalarInput({ type: 'money' }, vals[it[0]], function (v) { vals[it[0]] = v; setAns(f.id, vals); upd(); }, id));
    });
    g.appendChild(el('strong', null, 'Total ' + esc(f.label.toLowerCase())));
    g.appendChild(totalEl);
    upd();
    return g;
  }

  /* ---------------- Live checks on the money steps ---------------- */
  function liveHtml(step) {
    var r = Model.compute(A());
    if (step.id === 'funding') {
      if (!(r.loan.amount > 0)) return 'Enter the loan amount, rate and term to see the payment.';
      var s = 'Monthly payment: <strong>' + money(r.loan.payment) + '</strong> (' + money(r.loan.annual) + ' a year). ';
      if (r.funds.total > 0) {
        s += 'Project total ' + money(r.funds.total) + '; your cash ' + money(r.funds.owner) + ' = <span class="' + (r.funds.equityPct >= 0.1 ? 'good' : 'bad') + '">' + pct(r.funds.equityPct) + ' equity</span>. ';
        if (Math.abs(r.funds.loanDiff) >= 1) s += '<span class="bad">Loan-funded lines total ' + money(r.funds.loan) + ', which does not match the ' + money(r.loan.amount) + ' request.</span>';
      }
      return s;
    }
    if (step.id === 'financials' || step.id === 'debts') {
      if (!(r.years[0].revenue > 0)) return 'Enter first-month sales and your expenses to see year 1 results.';
      var d = r.dscr[0].ratio, cls = d == null ? 'good' : (d >= r.dscrTarget ? 'good' : (d >= r.sbaFloor ? 'warn' : 'bad'));
      return 'Year 1 sales <strong>' + money(r.years[0].revenue) + '</strong>, net income <strong>' + money(r.years[0].net) + '</strong>. ' +
        'DSCR year 1: <span class="' + cls + '">' + ratio(d) + '</span> (target ' + r.dscrTarget.toFixed(2) + 'x; ' + r.sba.label + ' ' + r.sbaFloor.toFixed(2) + 'x). ' +
        (r.sba.notes.length ? '<br><small>' + r.sba.notes.join(' ') + ' ' + r.sba.source + '</small><br>' : '') +
        'Lowest month-end cash: <span class="' + (r.lowestCash >= 0 ? 'good' : 'bad') + '">' + money(r.lowestCash) + '</span>.';
    }
    if (step.id === 'pfs') {
      return 'Total assets ' + money(r.pfs.assets) + ', total liabilities ' + money(r.pfs.liabilities) + ', net worth <strong>' + money(r.pfs.netWorth) + '</strong>.';
    }
    return '';
  }
  function refreshLive() {
    var box = $('liveBox'); if (!box) return;
    box.innerHTML = liveHtml(STEPS[state.step]);
  }

  /* ---------------- Step and review screens ---------------- */
  function render() {
    renderStepper();
    var host = $('stepHost'); host.innerHTML = '';
    if (state.step >= REVIEW) { host.appendChild(renderReview()); return; }
    var s = STEPS[state.step];
    var card = el('section', { class: 'card', 'aria-labelledby': 'stepTitle' });
    card.appendChild(el('div', { class: 'count' }, 'Step ' + (state.step + 1) + ' of ' + STEPS.length));
    card.appendChild(el('h2', { id: 'stepTitle' }, esc(s.title)));
    card.appendChild(el('p', { class: 'intro' }, esc(s.intro)));
    if (['funding', 'financials', 'debts', 'pfs'].indexOf(s.id) >= 0) card.appendChild(el('div', { class: 'live', id: 'liveBox', role: 'status' }));
    s.fields.forEach(function (f) { card.appendChild(renderField(f)); });
    var nav = el('div', { class: 'navrow' });
    var back = el('button', { type: 'button', class: 'btn ghost', id: 'btnBack' }, 'Back');
    back.disabled = state.step === 0;
    back.addEventListener('click', function () { go(state.step - 1); });
    var next = el('button', { type: 'button', class: 'btn', id: 'btnNext' }, state.step === REVIEW - 1 ? 'Review and download' : 'Next');
    next.addEventListener('click', function () { go(state.step + 1); });
    nav.appendChild(back); nav.appendChild(next);
    card.appendChild(nav);
    host.appendChild(card);
    refreshLive();
  }

  function renderReview() {
    var o = Plan.outline(A()), r = o.model;
    var card = el('section', { class: 'card' });
    card.appendChild(el('h2', null, 'Review and download'));
    card.appendChild(el('p', { class: 'intro' }, 'Your plan and workbook are built right here in your browser. Fix anything flagged in red first, then download.'));

    var al = el('div', { class: o.missing.length ? 'alarm' : 'alarm ok', id: 'reviewAlarm', role: 'status' });
    if (!o.missing.length) al.innerHTML = '<strong>Nothing missing.</strong> Every section a lender expects has an answer.';
    else {
      al.innerHTML = '<strong>' + o.missing.length + ' answer' + (o.missing.length === 1 ? '' : 's') + ' still missing.</strong> They show in red in the downloaded plan until you fill them in.';
      var ul = el('ul');
      o.missing.forEach(function (m) {
        var li = el('li');
        var b = el('button', { type: 'button', class: 'btn link' }, esc(m.stepTitle + ': ' + m.label));
        b.addEventListener('click', function () { go(m.step); setTimeout(function () { var fe = document.querySelector('[data-field="' + m.id + '"]'); if (fe) fe.scrollIntoView({ block: 'center' }); }, 50); });
        li.appendChild(b); ul.appendChild(li);
      });
      al.appendChild(ul);
    }
    card.appendChild(al);

    if (r.years[0].revenue > 0 || r.loan.amount > 0) {
      var tiles = el('div', { class: 'tiles' });
      function tile(k, v, s) { tiles.appendChild(el('div', { class: 'tile' }, '<div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : ''))); }
      tile('Loan request', money(r.loan.amount), r.loan.amount > 0 ? money(r.loan.payment) + ' a month' : '');
      tile('Owner equity', pct(r.funds.equityPct), money(r.funds.owner) + ' of ' + money(r.funds.total));
      tile('Year 1 sales', money(r.years[0].revenue), 'Year 3: ' + money(r.years[2].revenue));
      tile('DSCR year 1', ratio(r.dscr[0].ratio), 'Target ' + r.dscrTarget.toFixed(2) + 'x, SBA minimum ' + r.sbaFloor.toFixed(2) + 'x (' + r.sba.short + ')');
      tile('Break-even', money(r.breakeven.monthly), 'sales per month');
      tile('Lowest cash', money(r.lowestCash), 'month-end, year 1');
      card.appendChild(tiles);
    }

    card.appendChild(el('h3', { style: 'color:var(--navy);margin:8px 0 4px' }, 'Downloads'));
    var dl = el('div', { class: 'downloads' });
    var bDocx = el('button', { type: 'button', class: 'btn', id: 'dlDocx' }, 'Business plan (.docx)');
    var bXlsx = el('button', { type: 'button', class: 'btn', id: 'dlXlsx' }, 'Financial workbook (.xlsx)');
    var bPrint = el('button', { type: 'button', class: 'btn ghost', id: 'dlPrint' }, 'Print or save as PDF');
    dl.appendChild(bDocx); dl.appendChild(bXlsx); dl.appendChild(bPrint);
    card.appendChild(dl);
    var st = el('div', { class: 'status', id: 'dlStatus', role: 'status' });
    card.appendChild(st);
    bDocx.addEventListener('click', function () { downloadDocx(st); });
    bXlsx.addEventListener('click', function () { downloadXlsx(st); });
    bPrint.addEventListener('click', function () { renderPrint(); window.print(); });

    card.appendChild(el('p', { style: 'font-size:14px;margin:14px 0 4px' },
      'The workbook has live formulas on every sheet: startup costs and use of funds, a 3-year profit and loss (monthly for year 1), cash flow, break-even, loan payment and amortization, debt service coverage, your existing debt schedule, and a personal financial statement summary in the categories of SBA Form 413. Change a yellow input cell and everything recalculates.'));

    var nav = el('div', { class: 'navrow' });
    var back = el('button', { type: 'button', class: 'btn ghost' }, 'Back');
    back.addEventListener('click', function () { go(REVIEW - 1); });
    var guide = el('a', { class: 'btn ghost', href: '/sba/' }, 'SBA loan checklist');
    nav.appendChild(back); nav.appendChild(guide);
    card.appendChild(nav);
    return card;
  }

  /* ---------------- Print (PDF) ---------------- */
  function renderPrint() {
    var o = Plan.outline(A()), h = [];
    o.blocks.forEach(function (b) {
      if (b.type === 'cover') {
        h.push('<div class="cover"><h1>' + esc(b.title) + '</h1><div class="sub">' + esc(b.subtitle) + '</div>' + b.lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>');
      } else if (b.type === 'h1') h.push('<h1>' + esc(b.text) + '</h1>');
      else if (b.type === 'h2') h.push('<h2>' + esc(b.text) + '</h2>');
      else if (b.type === 'p') h.push('<p>' + esc(b.text) + '</p>');
      else if (b.type === 'missing') h.push('<p class="missing">' + esc(b.text) + '</p>');
      else if (b.type === 'kv') { if (b.rows.length) h.push('<table>' + b.rows.map(function (r) { return '<tr><td class="k">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>'); }
      else if (b.type === 'table') {
        var t = '<table><tr>' + b.head.map(function (x, i) { return '<th' + (b.numeric && i ? ' class="n"' : '') + '>' + esc(x) + '</th>'; }).join('') + '</tr>';
        t += b.rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (b.numeric && i ? ' class="n"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('');
        if (b.total) t += '<tr class="total">' + b.total.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
        h.push(t + '</table>');
      }
    });
    $('printPlan').innerHTML = h.join('\n');
  }
  window.addEventListener('beforeprint', renderPrint);

  /* ---------------- Downloads ---------------- */
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { loaded[src] = null; rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function slug() { return (A().bizName || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'business'; }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function downloadDocx(st) {
    st.textContent = 'Building your plan...';
    loadScript('vendor/docx.min.js').then(function () {
      var doc = window.BPW_DOCX.build(window.docx, Plan.outline(A()));
      return window.docx.Packer.toBlob(doc);
    }).then(function (blob) {
      var name = slug() + '-business-plan.docx';
      saveBlob(blob, name); st.textContent = 'Downloaded ' + name + '.';
    }).catch(function (e) { st.textContent = 'Something went wrong building the plan: ' + e.message; });
  }
  function downloadXlsx(st) {
    st.textContent = 'Building your workbook...';
    loadScript('vendor/exceljs.min.js').then(function () {
      return window.BPW_XLSX.build(window.ExcelJS, A()).xlsx.writeBuffer();
    }).then(function (buf) {
      var name = slug() + '-financials.xlsx';
      saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
      st.textContent = 'Downloaded ' + name + '.';
    }).catch(function (e) { st.textContent = 'Something went wrong building the workbook: ' + e.message; });
  }

  /* ---------------- Toolbar: sample, backup, restore, clear ---------------- */
  $('btnSample').addEventListener('click', function () {
    var has = Object.keys(A()).some(function (k) { return !Plan.blank(A()[k]); });
    if (has && !confirm('Replace your answers with the sample bakery plan? Save a backup first if you want to keep them.')) return;
    state.answers = Q.buildSample(); save(); render();
  });
  $('btnBackup').addEventListener('click', function () {
    saveBlob(new Blob([JSON.stringify({ tool: 'business-plan-wizard', version: 1, saved: new Date().toISOString(), answers: A() }, null, 2)], { type: 'application/json' }), slug() + '-plan-answers.json');
  });
  $('fileRestore').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || typeof d.answers !== 'object') throw new Error('not a plan answers file');
        state.answers = d.answers; state.step = 0; save(); render();
      } catch (e) { alert('That file could not be read as saved plan answers.'); }
      ev.target.value = '';
    };
    rd.readAsText(file);
  });
  $('btnRestore').addEventListener('click', function () { $('fileRestore').click(); });
  $('btnClear').addEventListener('click', function () {
    if (!confirm('Erase every answer in this browser and start over?')) return;
    state = { answers: {}, step: 0 }; save(); render();
  });

  render();
})();
