/*
 * Business Plan Wizard: financial model.
 * MIT License, see LICENSE in this folder.
 *
 * Computes the same figures the generated workbook computes with live formulas,
 * so the review screen and the Word plan agree with the spreadsheet.
 * Percent answers are stored as whole numbers (3 means 3 percent).
 */
(function (root) {
  'use strict';

  var MAX_PERIODS = 300; // 25 years, the longest SBA term

  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function pct(v) { return n(v) / 100; }
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; }

  /*
   * SBA minimum debt service coverage for this plan, per SBA SOP 50 10 8.1 (effective Oct 1, 2026).
   * Buying a business or buying out an owner: 1.25x, measured on historical results.
   * Otherwise the per-loan-type minimum kept from SOP 50 10 8: 1.10x for a 7(a) small loan,
   * 1.15x for a standard 7(a) loan (used as the reference for every other program).
   */
  var SOP_NOTE = 'Rules as of SBA SOP 50 10 8.1, effective Oct 1, 2026.';
  function isPurchase(a) { return /^Buying/.test((a && a.planType) || ''); }
  function sbaFloor(a) {
    a = a || {};
    var prog = a.program || '', notes = [];
    if (isPurchase(a)) {
      notes.push('For a business purchase or owner buyout the lender must see 1.25x on the business\'s historical results; projections alone cannot clear it.');
      notes.push('The lender orders an independent business valuation for every change of ownership, and a quality of earnings report when the purchase price is $3 million or more.');
      notes.push('You put in at least 10 percent of the total project cost. A seller note counts toward that only if it is on full standby for the life of the SBA loan, and standby debt plus outside investors can cover no more than half of it.');
      if (prog === 'SBA 7(a) small') notes.push('7(a) small loan processing is not allowed for any change of ownership, so expect a standard 7(a) loan.');
      return { floor: 1.25, label: 'SBA minimum for a business purchase or owner buyout', short: 'business purchase or buyout', notes: notes, source: SOP_NOTE };
    }
    if (prog === 'SBA 7(a) small') return { floor: 1.10, label: 'SBA minimum for a 7(a) small loan', short: '7(a) small loan', notes: notes, source: SOP_NOTE };
    return { floor: 1.15, label: 'SBA minimum for a standard 7(a) loan', short: 'standard 7(a) loan', notes: notes, source: SOP_NOTE };
  }

  function pmt(rate, periods, pv) {
    if (!(pv > 0) || !(periods > 0)) return 0;
    if (rate === 0) return pv / periods;
    return pv * rate / (1 - Math.pow(1 + rate, -periods));
  }

  function compute(a) {
    a = a || {};
    var r = {};
    var L = n(a.loanAmount), rate = pct(a.loanRate), years = n(a.loanYears);
    var periods = Math.round(years * 12);
    var mr = rate / 12;
    var payment = pmt(mr, periods, L);

    // Amortization schedule (same 300 rows as the workbook)
    var sched = [], bal = L;
    for (var p = 1; p <= MAX_PERIODS; p++) {
      var active = p <= periods;
      var pay = active ? payment : 0;
      var intr = active ? bal * mr : 0;
      var prin = pay - intr;
      var end = bal - prin;
      sched.push({ period: p, year: Math.ceil(p / 12), begin: bal, payment: pay, interest: intr, principal: prin, end: end });
      bal = end;
    }
    function byYear(y, key) { var t = 0; sched.forEach(function (s) { if (s.year === y) t += s[key]; }); return t; }

    // Use of funds
    var uses = (a.uses || []).filter(function (u) { return u && (u.item || n(u.amount)); });
    var totalUses = sum(uses.map(function (u) { return n(u.amount); }));
    var fromLoan = sum(uses.filter(function (u) { return u.source === 'Loan'; }).map(function (u) { return n(u.amount); }));
    var fromOwner = sum(uses.filter(function (u) { return u.source === 'Owner cash'; }).map(function (u) { return n(u.amount); }));
    var fromOther = totalUses - fromLoan - fromOwner;
    var spent = sum(uses.filter(function (u) { return u.kind !== 'Kept as working capital'; }).map(function (u) { return n(u.amount); }));
    r.funds = { total: totalUses, spent: spent, kept: totalUses - spent, loan: fromLoan, owner: fromOwner, other: fromOther,
      equityPct: totalUses > 0 ? fromOwner / totalUses : 0, loanDiff: fromLoan - L };

    // Operating expenses and debts
    var opexMonthly = sum((a.expenses || []).map(function (e) { return n(e && e.monthly); }));
    var debts = (a.debts || []).filter(function (d) { return d && (d.lender || n(d.balance) || n(d.payment)); });
    var debtMonthly = sum(debts.map(function (d) { return n(d.payment); }));

    var g1 = pct(a.growthY1), g2 = pct(a.growthY2), g3 = pct(a.growthY3);
    var cogs = pct(a.cogsPct), eg = pct(a.expenseGrowth), tax = pct(a.taxRate);
    var dep = n(a.depreciation), draw = n(a.ownerDraw);

    // P&L year 1 monthly
    var m = [];
    var rev = n(a.month1Revenue);
    for (var i = 0; i < 12; i++) {
      if (i > 0) rev = rev * (1 + g1);
      var row = { revenue: rev };
      row.cogs = rev * cogs;
      row.gross = row.revenue - row.cogs;
      row.opex = opexMonthly;
      row.ebitda = row.gross - row.opex;
      row.interest = sched[i].interest;
      row.depreciation = dep / 12;
      row.pretax = row.ebitda - row.interest - row.depreciation;
      row.tax = Math.max(0, row.pretax) * tax;
      row.net = row.pretax - row.tax;
      m.push(row);
    }
    function total(key) { return sum(m.map(function (x) { return x[key]; })); }
    var y1 = {}; ['revenue', 'cogs', 'gross', 'opex', 'ebitda', 'interest', 'depreciation', 'pretax', 'tax', 'net'].forEach(function (k) { y1[k] = total(k); });

    function yearN(prev, growth, yr) {
      var y = {};
      y.revenue = prev.revenue * (1 + growth);
      y.cogs = y.revenue * cogs;
      y.gross = y.revenue - y.cogs;
      y.opex = prev.opex * (1 + eg);
      y.ebitda = y.gross - y.opex;
      y.interest = byYear(yr, 'interest');
      y.depreciation = dep;
      y.pretax = y.ebitda - y.interest - y.depreciation;
      y.tax = Math.max(0, y.pretax) * tax;
      y.net = y.pretax - y.tax;
      return y;
    }
    var y2 = yearN(y1, g2, 2);
    var y3 = yearN(y2, g3, 3);
    r.monthly = m; r.years = [y1, y2, y3];

    // Cash flow
    var cash = n(a.startCash), cf = [];
    for (var k = 0; k < 12; k++) {
      var c = { begin: cash };
      c.loan = k === 0 ? L : 0;
      c.owner = k === 0 ? fromOwner : 0;
      c.other = k === 0 ? fromOther : 0;
      c.spend = k === 0 ? -spent : 0;
      c.net = m[k].net;
      c.dep = m[k].depreciation;
      c.principal = -sched[k].principal;
      c.debt = -debtMonthly;
      c.draw = -draw;
      c.change = c.loan + c.owner + c.other + c.spend + c.net + c.dep + c.principal + c.debt + c.draw;
      c.end = c.begin + c.change;
      cash = c.end;
      cf.push(c);
    }
    var cfy = [];
    var y1c = { begin: n(a.startCash) };
    ['loan', 'owner', 'other', 'spend', 'net', 'dep', 'principal', 'debt', 'draw', 'change'].forEach(function (key) { y1c[key] = sum(cf.map(function (x) { return x[key]; })); });
    y1c.end = y1c.begin + y1c.change;
    cfy.push(y1c);
    [2, 3].forEach(function (yr) {
      var prev = cfy[cfy.length - 1];
      var yy = r.years[yr - 1];
      var c = { begin: prev.end, loan: 0, owner: 0, other: 0, spend: 0, net: yy.net, dep: dep,
        principal: -byYear(yr, 'principal'), debt: -debtMonthly * 12, draw: -draw * 12 };
      c.change = c.loan + c.owner + c.other + c.spend + c.net + c.dep + c.principal + c.debt + c.draw;
      c.end = c.begin + c.change;
      cfy.push(c);
    });
    r.cashMonthly = cf; r.cashYears = cfy;
    r.lowestCash = Math.min.apply(null, cf.map(function (x) { return x.end; }));

    // Break-even
    var cm = 1 - cogs;
    var fixed = y1.opex + y1.interest + y1.depreciation;
    var beAnnual = cm > 0 ? fixed / cm : 0;
    r.breakeven = { cm: cm, fixed: fixed, annual: beAnnual, monthly: beAnnual / 12,
      margin: y1.revenue > 0 ? (y1.revenue - beAnnual) / y1.revenue : 0,
      firstMonth: (function () { for (var q = 0; q < 12; q++) if (m[q].revenue >= beAnnual / 12) return q + 1; return 0; })() };

    // DSCR
    var sf = sbaFloor(a);
    var target = a.dscrTarget === '' || a.dscrTarget == null ? Math.max(1.25, sf.floor) : n(a.dscrTarget);
    r.dscr = [1, 2, 3].map(function (yr) {
      var y = r.years[yr - 1];
      var cads = y.ebitda - y.tax - draw * 12;
      var ds = byYear(yr, 'payment') + debtMonthly * 12;
      return { cads: cads, newDebt: byYear(yr, 'payment'), oldDebt: debtMonthly * 12, service: ds,
        ratio: ds > 0 ? cads / ds : null };
    });
    r.dscrTarget = target;
    r.sbaFloor = sf.floor;
    r.sba = sf;

    r.loan = { amount: L, rate: rate, years: years, periods: periods, payment: payment,
      annual: payment * 12, totalInterest: sum(sched.map(function (s) { return s.interest; })) };
    r.debts = { list: debts, monthly: debtMonthly, balance: sum(debts.map(function (d) { return n(d.balance); })) };
    r.opexMonthly = opexMonthly;

    // Personal financial statement
    var pa = a.pfsAssets || {}, pl = a.pfsLiabilities || {}, pi = a.pfsIncome || {}, pc = a.pfsContingent || {};
    function gsum(o) { var t = 0; Object.keys(o).forEach(function (k2) { t += n(o[k2]); }); return t; }
    r.pfs = { assets: gsum(pa), liabilities: gsum(pl), income: gsum(pi), contingent: gsum(pc) };
    r.pfs.netWorth = r.pfs.assets - r.pfs.liabilities;
    return r;
  }

  var api = { compute: compute, pmt: pmt, sbaFloor: sbaFloor, SOP_NOTE: SOP_NOTE, MAX_PERIODS: MAX_PERIODS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPW_Model = api;
})(typeof window !== 'undefined' ? window : this);
