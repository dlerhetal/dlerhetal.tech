/*
 * Business Plan Wizard: turns answers into an ordered outline of blocks.
 * MIT License, see LICENSE in this folder.
 *
 * The outline is rendered twice: to HTML for print or PDF, and to .docx.
 * Section order follows the SBA traditional business plan:
 * https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan
 * Block types: h1, h2, p, missing, table { head, rows, total }, kv { rows }.
 */
(function (root) {
  'use strict';

  function Q() { return root.BPW_Q || require('./questions.js'); }
  function M() { return root.BPW_Model || require('./model.js'); }

  function money(v) { var x = Math.round(+v || 0); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US'); }
  function pctf(v, d) { return ((+v || 0) * 100).toFixed(d == null ? 1 : d) + '%'; }
  function ratio(v) { return v == null ? 'No debt' : v.toFixed(2) + 'x'; }
  function blank(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.filter(function (r) { return r && Object.keys(r).some(function (k) { return String(r[k] == null ? '' : r[k]).trim() !== ''; }); }).length === 0;
    if (typeof v === 'object') return Object.keys(v).every(function (k) { return String(v[k] == null ? '' : v[k]).trim() === ''; });
    return String(v).trim() === '';
  }

  function fieldIndex() {
    var idx = {};
    Q().STEPS.forEach(function (s) { s.fields.forEach(function (f) { idx[f.id] = { field: f, step: s }; }); });
    return idx;
  }

  /* List of required answers still empty: [{ id, label, step }] */
  function missing(a) {
    var out = [];
    Q().STEPS.forEach(function (s, si) {
      s.fields.forEach(function (f) {
        if (f.req && blank(a[f.id])) out.push({ id: f.id, label: f.label, step: si, stepTitle: s.title });
      });
    });
    return out;
  }

  function monthName(s) {
    var m = /^(\d{4})-(\d{2})/.exec(s || '');
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function outline(a) {
    a = a || {};
    var idx = fieldIndex();
    var r = M().compute(a);
    var B = [];
    function h1(t) { B.push({ type: 'h1', text: t }); }
    function h2(t) { B.push({ type: 'h2', text: t }); }
    function p(t) { B.push({ type: 'p', text: t }); }
    function ans(id, heading) {
      var v = a[id], f = idx[id] && idx[id].field;
      if (blank(v)) {
        if (f && f.req) { if (heading) h2(heading); B.push({ type: 'missing', text: 'Missing: ' + f.label }); }
        return;
      }
      if (heading) h2(heading);
      String(v).split(/\n\s*\n|\r\n\r\n/).forEach(function (para) { if (para.trim()) p(para.trim()); });
    }
    function listTable(id, cols, heading) {
      var rows = (a[id] || []).filter(function (x) { return x && cols.some(function (c) { return String(x[c[0]] == null ? '' : x[c[0]]).trim() !== ''; }); });
      var f = idx[id] && idx[id].field;
      if (!rows.length) {
        if (f && f.req) { if (heading) h2(heading); B.push({ type: 'missing', text: 'Missing: ' + f.label }); }
        return;
      }
      if (heading) h2(heading);
      B.push({ type: 'table', head: cols.map(function (c) { return c[1]; }),
        rows: rows.map(function (x) { return cols.map(function (c) { return c[2] ? c[2](x[c[0]]) : String(x[c[0]] == null ? '' : x[c[0]]); }); }) });
    }

    var biz = a.bizName || 'Business name';
    var program = a.program && a.program !== 'Not sure yet' ? a.program + ' loan' : 'loan';

    // Cover
    B.push({ type: 'cover', title: biz, subtitle: 'Business Plan',
      lines: [a.owners ? 'Prepared by ' + a.owners : '', a.location || '', a.contact || '',
        new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        r.loan.amount > 0 ? 'Funding request: ' + money(r.loan.amount) + ' ' + program : ''].filter(Boolean) });

    // 1 Executive summary
    h1('1. Executive Summary');
    ans('whatWeDo', 'The business');
    ans('whyWin', 'Why it will succeed');
    if (r.loan.amount > 0) {
      h2('The request');
      var s = 'We are requesting a ' + money(r.loan.amount) + ' ' + program;
      if (r.loan.years) s += ' over ' + r.loan.years + ' years';
      if (r.loan.rate) s += ' at an expected ' + pctf(r.loan.rate, 2) + ' interest rate';
      s += '.';
      if (r.funds.total > 0) s += ' The owners are investing ' + money(r.funds.owner) + ' of their own cash, ' + pctf(r.funds.equityPct) + ' of the ' + money(r.funds.total) + ' project.';
      if (r.years[0].revenue > 0) s += ' Year 1 sales are projected at ' + money(r.years[0].revenue) + (r.dscr[0].ratio != null ? ', with a debt service coverage ratio of ' + ratio(r.dscr[0].ratio) + ' in year 1 and ' + ratio(r.dscr[2].ratio) + ' by year 3.' : '.');
      p(s);
    }
    ans('milestones', 'First-year milestones');

    // 2 Company description
    h1('2. Company Description');
    B.push({ type: 'kv', rows: [
      ['Legal name', a.legalName || a.bizName || ''], ['Legal structure', a.entity || ''],
      ['Started', a.founded || ''], ['Address', a.address || a.location || ''], ['Owners', a.owners || '']
    ].filter(function (x) { return x[1]; }) });
    ans('problem', 'The problem we solve');
    ans('strengths', 'Our advantages');
    ans('licenses', 'Licenses and permits');

    // 3 Market analysis
    h1('3. Market Analysis');
    ans('industry', 'Industry outlook');
    ans('target', 'Target customers');
    ans('marketSize', 'Market size');
    listTable('competitors', [['name', 'Competitor'], ['strengths', 'Strengths'], ['weaknesses', 'Weaknesses']], 'Competition');
    ans('advantage', 'Why customers will choose us');

    // 4 Organization and management
    h1('4. Organization and Management');
    listTable('team', [['name', 'Name'], ['role', 'Role'], ['experience', 'Experience'], ['own', 'Ownership', function (v) { return v === '' || v == null ? '' : v + '%'; }]], 'Owners and key people');
    ans('staff', 'Staffing');
    ans('advisors', 'Advisors');
    ans('facility', 'Location, facility and equipment');
    ans('hours', 'Operations');

    // 5 Products and services
    h1('5. Products and Services');
    listTable('offerings', [['name', 'Product or service'], ['desc', 'Description'], ['price', 'Typical price']], 'What we sell');
    ans('delivery', 'Production and delivery');
    ans('suppliers', 'Suppliers');

    // 6 Marketing and sales
    h1('6. Marketing and Sales');
    ans('findYou', 'How customers find us');
    ans('salesProcess', 'Sales process');
    ans('retention', 'Keeping customers');
    ans('pricing', 'Pricing');

    // 7 Funding request
    h1('7. Funding Request');
    if (r.loan.amount > 0) {
      h2('Loan terms requested');
      B.push({ type: 'kv', rows: [
        ['Amount', money(r.loan.amount)], ['Program', a.program || ''], ['Expected rate', r.loan.rate ? pctf(r.loan.rate, 2) : ''],
        ['Term', r.loan.years ? r.loan.years + ' years' : ''], ['Monthly payment', money(r.loan.payment)], ['Annual debt service, new loan', money(r.loan.annual)]
      ].filter(function (x) { return x[1]; }) });
    } else {
      B.push({ type: 'missing', text: 'Missing: ' + idx.loanAmount.field.label });
    }
    var uses = (a.uses || []).filter(function (u) { return u && (u.item || +u.amount); });
    if (uses.length) {
      h2('Sources and uses of funds');
      B.push({ type: 'table', head: ['Use', 'Amount', 'Paid by', 'Spent or kept'],
        rows: uses.map(function (u) { return [u.item || '', money(u.amount), u.source || '', u.kind || 'Spent at start']; }),
        total: ['Total project', money(r.funds.total), '', ''] });
      B.push({ type: 'kv', rows: [['From the loan', money(r.funds.loan)], ['Owner cash (equity injection)', money(r.funds.owner) + ' (' + pctf(r.funds.equityPct) + ')'], ['Other sources', money(r.funds.other)]] });
      if (Math.abs(r.funds.loanDiff) >= 1) B.push({ type: 'missing', text: 'Check: the loan-funded uses total ' + money(r.funds.loan) + ' but the loan request is ' + money(r.loan.amount) + '.' });
    } else {
      B.push({ type: 'missing', text: 'Missing: ' + idx.uses.field.label });
    }
    ans('collateral', 'Collateral');

    // 8 Financial projections
    h1('8. Financial Projections');
    var start = monthName(a.startMonth);
    if (start) p('Projections begin ' + start + '. Year 1 is forecast month by month in the accompanying financial workbook; this summary shows the three years side by side.');
    ans('assumptions', 'Key assumptions');
    if (r.years[0].revenue > 0) {
      h2('Three-year projected profit and loss');
      var Y = r.years, C = r.cashYears;
      function row(lbl, k) { return [lbl, money(Y[0][k]), money(Y[1][k]), money(Y[2][k])]; }
      B.push({ type: 'table', head: ['', 'Year 1', 'Year 2', 'Year 3'], numeric: true, rows: [
        row('Sales', 'revenue'), row('Cost of goods sold', 'cogs'), row('Gross profit', 'gross'), row('Operating expenses', 'opex'),
        row('EBITDA', 'ebitda'), row('Interest', 'interest'), row('Depreciation', 'depreciation'), row('Income tax', 'tax'),
        row('Net income', 'net'), ['Ending cash', money(C[0].end), money(C[1].end), money(C[2].end)]
      ] });
      h2('Debt service coverage');
      B.push({ type: 'table', head: ['', 'Year 1', 'Year 2', 'Year 3'], numeric: true, rows: [
        ['Cash available for debt service'].concat(r.dscr.map(function (d) { return money(d.cads); })),
        ['New loan payments'].concat(r.dscr.map(function (d) { return money(d.newDebt); })),
        ['Existing debt payments'].concat(r.dscr.map(function (d) { return money(d.oldDebt); })),
        ['DSCR'].concat(r.dscr.map(function (d) { return ratio(d.ratio); }))
      ] });
      p('Cash available for debt service is EBITDA less income tax and owner draws. The lender target used here is ' + r.dscrTarget.toFixed(2) + 'x. The ' + r.sba.label + ' is ' + r.sbaFloor.toFixed(2) + 'x. ' + r.sba.source +
        (r.sba.notes.length ? ' ' + r.sba.notes.join(' ') : ''));
      h2('Break-even');
      p('With a contribution margin of ' + pctf(r.breakeven.cm) + ', the business covers its year 1 fixed costs of ' + money(r.breakeven.fixed) +
        ' at ' + money(r.breakeven.monthly) + ' in monthly sales (' + money(r.breakeven.annual) + ' a year). Projected year 1 sales give a margin of safety of ' + pctf(r.breakeven.margin) +
        (r.breakeven.firstMonth ? ', and monthly sales reach break-even in month ' + r.breakeven.firstMonth + '.' : '.'));
      p('The lowest projected month-end cash balance in year 1 is ' + money(r.lowestCash) + '.');
    } else {
      B.push({ type: 'missing', text: 'Missing: sales and expense figures on the Financial projections step.' });
    }
    if (r.debts.list.length) {
      h2('Existing business debt');
      B.push({ type: 'table', head: ['Lender', 'Balance', 'Rate', 'Monthly payment', 'Maturity', 'Collateral'],
        rows: r.debts.list.map(function (d) { return [d.lender || '', money(d.balance), d.rate === '' || d.rate == null ? '' : d.rate + '%', money(d.payment), d.maturity || '', d.collateral || '']; }),
        total: ['Total', money(r.debts.balance), '', money(r.debts.monthly), '', ''] });
    }
    return { blocks: B, model: r, missing: missing(a) };
  }

  var api = { outline: outline, missing: missing, money: money, pct: pctf, ratio: ratio, blank: blank };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPW_Plan = api;
})(typeof window !== 'undefined' ? window : this);
