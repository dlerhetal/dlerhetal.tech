/*
 * Business Plan Wizard: financial workbook export (.xlsx with live formulas).
 * MIT License, see LICENSE in this folder. Uses ExcelJS (MIT), vendored in ./vendor.
 *
 * Every calculated cell is a formula, so the owner (or the lender) can change an
 * input on the Inputs sheet and the whole workbook recalculates.
 * Input cells are blue text on a pale yellow fill. Formula cells are black.
 */
(function (root) {
  'use strict';

  var EXP_FIRST = 23, EXP_ROWS = 25;           // Inputs!A23:B47, total in row 48
  var EXP_TOTAL = EXP_FIRST + EXP_ROWS;         // 48
  var USE_FIRST = 4, USE_ROWS = 30;             // Use of Funds rows 4..33
  var DEBT_FIRST = 4, DEBT_ROWS = 20;           // Debt Schedule rows 4..23
  var PERIODS = 300;                            // Loan schedule rows 8..307

  var NAVY = 'FF1A3C6E', INPUT_FILL = 'FFFFF6D5', INPUT_FONT = 'FF1F4E9E', BAND = 'FFF2F4F7';
  var MONEY = '$#,##0;[Red]-$#,##0', PCT = '0.0%', RATIO = '0.00"x"', DATEM = 'mmm yyyy';

  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function colL(i) { var s = ''; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  function header(ws, rowNum, values) {
    var row = ws.getRow(rowNum);
    values.forEach(function (v, i) {
      var c = row.getCell(i + 1);
      c.value = v;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.alignment = { vertical: 'middle', wrapText: true };
    });
  }
  function title(ws, text, sub) {
    ws.getCell('A1').value = text;
    ws.getCell('A1').font = { bold: true, size: 15, color: { argb: NAVY } };
    if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = { italic: true, color: { argb: 'FF5B6777' } }; }
  }
  function input(cell, value, fmt) {
    cell.value = value;
    cell.font = { color: { argb: INPUT_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
    if (fmt) cell.numFmt = fmt;
  }
  function f(cell, formula, fmt, bold) {
    cell.value = { formula: formula };
    if (fmt) cell.numFmt = fmt;
    if (bold) cell.font = { bold: true };
  }
  function label(cell, text, bold) { cell.value = text; if (bold) cell.font = { bold: true }; }

  function parseMonth(s) {
    var m = /^(\d{4})-(\d{2})/.exec(s || '');
    if (!m) { var d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)); }
    return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  }

  function build(ExcelJS, a) {
    a = a || {};
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Business Plan Wizard';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    var biz = a.bizName || 'Your business';

    var sum = wb.addWorksheet('Summary', { properties: { tabColor: { argb: NAVY } } });
    var inp = wb.addWorksheet('Inputs');
    var uof = wb.addWorksheet('Use of Funds');
    var pl = wb.addWorksheet('PnL');
    var cf = wb.addWorksheet('Cash Flow');
    var be = wb.addWorksheet('Break Even');
    var ln = wb.addWorksheet('Loan');
    var dscr = wb.addWorksheet('DSCR');
    var ds = wb.addWorksheet('Debt Schedule');
    var pfs = wb.addWorksheet('PFS Form 413');
    var notes = wb.addWorksheet('Notes');

    /* ---------------- Inputs ---------------- */
    title(inp, biz + ': assumptions', 'Change any yellow cell and every sheet recalculates.');
    inp.getColumn(1).width = 44; inp.getColumn(2).width = 18; inp.getColumn(3).width = 60;
    var rows = [
      [4, 'First month of the forecast', parseMonth(a.startMonth), DATEM, 'The plan starts on the first of this month.'],
      [5, 'Sales in month 1', n(a.month1Revenue), MONEY, ''],
      [6, 'Monthly sales growth, year 1', n(a.growthY1) / 100, PCT, 'Each month of year 1 grows by this much over the month before.'],
      [7, 'Sales growth, year 2 over year 1', n(a.growthY2) / 100, PCT, ''],
      [8, 'Sales growth, year 3 over year 2', n(a.growthY3) / 100, PCT, ''],
      [9, 'Cost of goods sold, % of sales', n(a.cogsPct) / 100, PCT, 'Materials and direct costs that rise with each sale.'],
      [10, 'Operating expense growth per year', n(a.expenseGrowth) / 100, PCT, 'Applied to years 2 and 3.'],
      [11, 'Owner draw per month (not in expenses)', n(a.ownerDraw), MONEY, 'Subtracted from cash flow and from cash available for debt service.'],
      [12, 'Income tax rate', n(a.taxRate) / 100, PCT, 'Applied to positive pre-tax income only.'],
      [13, 'Depreciation per year', n(a.depreciation), MONEY, 'Non-cash; added back in the cash flow.'],
      [14, 'Business cash on hand before the loan', n(a.startCash), MONEY, ''],
      [16, 'New loan amount', n(a.loanAmount), MONEY, ''],
      [17, 'Interest rate per year', n(a.loanRate) / 100, '0.00%', ''],
      [18, 'Term in years', n(a.loanYears), '0', 'Up to 25. The Loan sheet schedules up to 300 monthly payments.'],
      [19, 'Lender DSCR target', a.dscrTarget === '' || a.dscrTarget == null ? 1.25 : n(a.dscrTarget), RATIO, 'Many lenders want 1.25x or better.'],
      [20, 'SBA minimum DSCR, standard 7(a)', 1.15, RATIO, 'SBA SOP 50 10: 1.15x for standard 7(a) loans, 1.10x for 7(a) small loans.']
    ];
    rows.forEach(function (r) {
      label(inp.getCell('A' + r[0]), r[1]);
      input(inp.getCell('B' + r[0]), r[2], r[3]);
      inp.getCell('C' + r[0]).value = r[4];
      inp.getCell('C' + r[0]).font = { color: { argb: 'FF5B6777' } };
    });
    label(inp.getCell('A3'), 'Revenue and costs', true);
    label(inp.getCell('A15'), 'New loan', true);
    header(inp, EXP_FIRST - 1, ['Monthly operating expense', 'Per month', 'Do not include loan payments here']);
    var exps = (a.expenses || []).filter(function (e) { return e && (e.name || n(e.monthly)); }).slice(0, EXP_ROWS);
    for (var i = 0; i < EXP_ROWS; i++) {
      var e = exps[i] || {};
      input(inp.getCell('A' + (EXP_FIRST + i)), e.name || null);
      input(inp.getCell('B' + (EXP_FIRST + i)), e.name || e.monthly ? n(e.monthly) : null, MONEY);
    }
    label(inp.getCell('A' + EXP_TOTAL), 'Total operating expenses per month', true);
    f(inp.getCell('B' + EXP_TOTAL), 'SUM(B' + EXP_FIRST + ':B' + (EXP_TOTAL - 1) + ')', MONEY, true);
    var OPEX = 'Inputs!$B$' + EXP_TOTAL;

    /* ---------------- Use of Funds ---------------- */
    title(uof, 'Sources and uses of funds', 'Source must read Loan, Owner cash or Other. Working capital you keep stays in the cash flow.');
    uof.getColumn(1).width = 44; uof.getColumn(2).width = 16; uof.getColumn(3).width = 16; uof.getColumn(4).width = 26;
    header(uof, 3, ['What it pays for', 'Amount', 'Source', 'Spent or kept']);
    var uses = (a.uses || []).filter(function (u) { return u && (u.item || n(u.amount)); }).slice(0, USE_ROWS);
    var UL = USE_FIRST + USE_ROWS - 1; // 33
    for (var u = 0; u < USE_ROWS; u++) {
      var it = uses[u] || {}, r = USE_FIRST + u;
      input(uof.getCell('A' + r), it.item || null);
      input(uof.getCell('B' + r), it.item || it.amount ? n(it.amount) : null, MONEY);
      input(uof.getCell('C' + r), it.source || null);
      uof.getCell('C' + r).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Loan,Owner cash,Other"'] };
      input(uof.getCell('D' + r), it.item || it.amount ? (it.kind || 'Spent at start') : null);
      uof.getCell('D' + r).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Spent at start,Kept as working capital"'] };
    }
    var ur = 'B' + USE_FIRST + ':B' + UL, uc = 'C' + USE_FIRST + ':C' + UL;
    label(uof.getCell('A35'), 'Total project cost', true); f(uof.getCell('B35'), 'SUM(' + ur + ')', MONEY, true);
    label(uof.getCell('A36'), 'From the loan'); f(uof.getCell('B36'), 'SUMIF(' + uc + ',"Loan",' + ur + ')', MONEY);
    label(uof.getCell('A37'), 'Owner cash (equity injection)'); f(uof.getCell('B37'), 'SUMIF(' + uc + ',"Owner cash",' + ur + ')', MONEY);
    label(uof.getCell('A38'), 'Other sources'); f(uof.getCell('B38'), 'B35-B36-B37', MONEY);
    label(uof.getCell('A39'), 'Owner equity as % of project', true); f(uof.getCell('B39'), 'IF(B35>0,B37/B35,0)', PCT, true);
    label(uof.getCell('A40'), 'Loan amount on the Inputs sheet'); f(uof.getCell('B40'), 'Inputs!B16', MONEY);
    label(uof.getCell('A41'), 'Difference (should be zero)'); f(uof.getCell('B41'), 'B36-B40', MONEY);
    label(uof.getCell('A42'), 'Meets 10% equity for startups and purchases?'); f(uof.getCell('B42'), 'IF(B39>=0.1,"Yes","No")');
    label(uof.getCell('A43'), 'Spent at the start'); f(uof.getCell('B43'), 'B35-B44', MONEY);
    label(uof.getCell('A44'), 'Kept in the bank as working capital'); f(uof.getCell('B44'), 'SUMIF(D' + USE_FIRST + ':D' + UL + ',"Kept as working capital",' + ur + ')', MONEY);

    /* ---------------- Loan ---------------- */
    title(ln, 'New loan: payment and amortization', 'Payment is level principal and interest, paid monthly from month 1.');
    [8, 8, 16, 14, 14, 14, 16].forEach(function (w, i) { ln.getColumn(i + 1).width = w; });
    label(ln.getCell('A3'), 'Monthly payment', true); f(ln.getCell('C3'), 'IF(AND(Inputs!B16>0,Inputs!B18>0),IF(Inputs!B17=0,Inputs!B16/(Inputs!B18*12),PMT(Inputs!B17/12,Inputs!B18*12,-Inputs!B16)),0)', MONEY, true);
    label(ln.getCell('A4'), 'Annual payments'); f(ln.getCell('C4'), 'C3*12', MONEY);
    label(ln.getCell('A5'), 'Total interest over the term'); f(ln.getCell('C5'), 'SUM(E8:E' + (7 + PERIODS) + ')', MONEY);
    header(ln, 7, ['Period', 'Year', 'Beginning balance', 'Payment', 'Interest', 'Principal', 'Ending balance']);
    for (var p = 1; p <= PERIODS; p++) {
      var rr = 7 + p;
      ln.getCell('A' + rr).value = p;
      f(ln.getCell('B' + rr), 'ROUNDUP(A' + rr + '/12,0)');
      f(ln.getCell('C' + rr), p === 1 ? 'Inputs!$B$16' : 'G' + (rr - 1), MONEY);
      f(ln.getCell('D' + rr), 'IF(A' + rr + '<=Inputs!$B$18*12,$C$3,0)', MONEY);
      f(ln.getCell('E' + rr), 'IF(A' + rr + '<=Inputs!$B$18*12,C' + rr + '*Inputs!$B$17/12,0)', MONEY);
      f(ln.getCell('F' + rr), 'D' + rr + '-E' + rr, MONEY);
      f(ln.getCell('G' + rr), 'C' + rr + '-F' + rr, MONEY);
    }
    var LY = 'Loan!$B$8:$B$' + (7 + PERIODS), LD = 'Loan!$D$8:$D$' + (7 + PERIODS),
      LE = 'Loan!$E$8:$E$' + (7 + PERIODS), LF = 'Loan!$F$8:$F$' + (7 + PERIODS);

    /* ---------------- Debt Schedule ---------------- */
    title(ds, 'Business debt schedule', 'Loans, leases and lines of credit that stay in place after the new loan closes.');
    [30, 15, 15, 9, 15, 12, 26].forEach(function (w, i) { ds.getColumn(i + 1).width = w; });
    header(ds, 3, ['Lender', 'Original amount', 'Current balance', 'Rate', 'Monthly payment', 'Maturity', 'Collateral']);
    var debts = (a.debts || []).filter(function (d) { return d && (d.lender || n(d.balance) || n(d.payment)); }).slice(0, DEBT_ROWS);
    for (var d = 0; d < DEBT_ROWS; d++) {
      var dd = debts[d] || {}, dr = DEBT_FIRST + d, has = !!(dd.lender || dd.balance || dd.payment);
      input(ds.getCell('A' + dr), dd.lender || null);
      input(ds.getCell('B' + dr), has ? n(dd.original) : null, MONEY);
      input(ds.getCell('C' + dr), has ? n(dd.balance) : null, MONEY);
      input(ds.getCell('D' + dr), has ? n(dd.rate) / 100 : null, '0.00%');
      input(ds.getCell('E' + dr), has ? n(dd.payment) : null, MONEY);
      input(ds.getCell('F' + dr), dd.maturity || null);
      input(ds.getCell('G' + dr), dd.collateral || null);
    }
    var DL = DEBT_FIRST + DEBT_ROWS - 1;
    label(ds.getCell('A25'), 'Totals', true);
    f(ds.getCell('B25'), 'SUM(B4:B' + DL + ')', MONEY, true);
    f(ds.getCell('C25'), 'SUM(C4:C' + DL + ')', MONEY, true);
    f(ds.getCell('E25'), 'SUM(E4:E' + DL + ')', MONEY, true);
    label(ds.getCell('A26'), 'Annual payments on existing debt'); f(ds.getCell('E26'), 'E25*12', MONEY);

    /* ---------------- P&L ---------------- */
    title(pl, 'Projected profit and loss', 'Year 1 by month, then years 2 and 3.');
    pl.getColumn(1).width = 30;
    for (var c = 2; c <= 16; c++) pl.getColumn(c).width = 13;
    header(pl, 3, ['']);
    for (var mi = 0; mi < 12; mi++) {
      var hc = pl.getCell(colL(1 + mi) + '3');
      f(hc, 'EDATE(Inputs!$B$4,' + mi + ')', DATEM);
      hc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    }
    ['Year 1', 'Year 2', 'Year 3'].forEach(function (t, i) {
      var hc2 = pl.getCell(colL(13 + i) + '3'); hc2.value = t;
      hc2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    });
    var PLR = { rev: 4, cogs: 5, gross: 6, gm: 7, opex: 8, ebitda: 9, int: 10, dep: 11, pre: 12, tax: 13, net: 14, nm: 15 };
    var plLabels = [[4, 'Sales'], [5, 'Cost of goods sold'], [6, 'Gross profit'], [7, 'Gross margin'], [8, 'Operating expenses'],
      [9, 'EBITDA'], [10, 'Interest on new loan'], [11, 'Depreciation'], [12, 'Pre-tax income'], [13, 'Income tax'], [14, 'Net income'], [15, 'Net margin']];
    plLabels.forEach(function (x) { label(pl.getCell('A' + x[0]), x[1], [6, 9, 14].indexOf(x[0]) >= 0); });
    for (var m = 0; m < 12; m++) {
      var C = colL(1 + m);
      f(pl.getCell(C + 4), m === 0 ? 'Inputs!$B$5' : colL(m) + '4*(1+Inputs!$B$6)', MONEY);
      f(pl.getCell(C + 5), C + '4*Inputs!$B$9', MONEY);
      f(pl.getCell(C + 8), OPEX, MONEY);
      f(pl.getCell(C + 10), 'Loan!E' + (8 + m), MONEY);
      f(pl.getCell(C + 11), 'Inputs!$B$13/12', MONEY);
      f(pl.getCell(C + 13), 'MAX(0,' + C + '12)*Inputs!$B$12', MONEY);
    }
    // Year 1 totals
    [4, 5, 8, 10, 11, 13].forEach(function (r) { f(pl.getCell('N' + r), 'SUM(B' + r + ':M' + r + ')', MONEY); });
    // Years 2 and 3
    [['O', 'N', 'Inputs!$B$7', 2], ['P', 'O', 'Inputs!$B$8', 3]].forEach(function (y) {
      var C2 = y[0], P = y[1];
      f(pl.getCell(C2 + 4), P + '4*(1+' + y[2] + ')', MONEY);
      f(pl.getCell(C2 + 5), C2 + '4*Inputs!$B$9', MONEY);
      f(pl.getCell(C2 + 8), P + '8*(1+Inputs!$B$10)', MONEY);
      f(pl.getCell(C2 + 10), 'SUMIF(' + LY + ',' + y[3] + ',' + LE + ')', MONEY);
      f(pl.getCell(C2 + 11), 'Inputs!$B$13', MONEY);
      f(pl.getCell(C2 + 13), 'MAX(0,' + C2 + '12)*Inputs!$B$12', MONEY);
    });
    for (var cc = 1; cc <= 15; cc++) {
      var X = colL(cc);
      f(pl.getCell(X + 6), X + '4-' + X + '5', MONEY, true);
      f(pl.getCell(X + 7), 'IF(' + X + '4>0,' + X + '6/' + X + '4,0)', PCT);
      f(pl.getCell(X + 9), X + '6-' + X + '8', MONEY, true);
      f(pl.getCell(X + 12), X + '9-' + X + '10-' + X + '11', MONEY);
      f(pl.getCell(X + 14), X + '12-' + X + '13', MONEY, true);
      f(pl.getCell(X + 15), 'IF(' + X + '4>0,' + X + '14/' + X + '4,0)', PCT);
    }
    pl.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

    /* ---------------- Cash Flow ---------------- */
    title(cf, 'Projected cash flow', 'Loan proceeds and owner cash arrive in month 1, and the project is paid for in month 1.');
    cf.getColumn(1).width = 34;
    for (var c3 = 2; c3 <= 16; c3++) cf.getColumn(c3).width = 13;
    header(cf, 3, ['']);
    for (var mi2 = 0; mi2 < 16; mi2++) {
      if (mi2 >= 15) break;
      var h = cf.getCell(colL(1 + mi2) + '3');
      if (mi2 < 12) f(h, 'EDATE(Inputs!$B$4,' + mi2 + ')', DATEM); else h.value = ['Year 1', 'Year 2', 'Year 3'][mi2 - 12];
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    }
    [[4, 'Beginning cash'], [5, 'Loan proceeds'], [6, 'Owner cash invested'], [7, 'Other sources'], [8, 'Project spending (use of funds spent at start)'],
      [9, 'Net income'], [10, 'Add back depreciation'], [11, 'New loan principal paid'], [12, 'Existing loan payments'], [13, 'Owner draws'],
      [14, 'Net change in cash'], [15, 'Ending cash'], [16, 'Lowest month-end cash, year 1']].forEach(function (x) { label(cf.getCell('A' + x[0]), x[1], [14, 15, 16].indexOf(x[0]) >= 0); });
    for (var k = 0; k < 12; k++) {
      var K = colL(1 + k);
      f(cf.getCell(K + 4), k === 0 ? 'Inputs!$B$14' : colL(k) + '15', MONEY);
      f(cf.getCell(K + 5), k === 0 ? 'Inputs!$B$16' : '0', MONEY);
      f(cf.getCell(K + 6), k === 0 ? "'Use of Funds'!$B$37" : '0', MONEY);
      f(cf.getCell(K + 7), k === 0 ? "'Use of Funds'!$B$38" : '0', MONEY);
      f(cf.getCell(K + 8), k === 0 ? "-'Use of Funds'!$B$43" : '0', MONEY);
      f(cf.getCell(K + 9), 'PnL!' + K + '14', MONEY);
      f(cf.getCell(K + 10), 'PnL!' + K + '11', MONEY);
      f(cf.getCell(K + 11), '-Loan!F' + (8 + k), MONEY);
      f(cf.getCell(K + 12), "-'Debt Schedule'!$E$25", MONEY);
      f(cf.getCell(K + 13), '-Inputs!$B$11', MONEY);
    }
    f(cf.getCell('N4'), 'B4', MONEY);
    for (var r5 = 5; r5 <= 13; r5++) f(cf.getCell('N' + r5), 'SUM(B' + r5 + ':M' + r5 + ')', MONEY);
    [['O', 'N', 2], ['P', 'O', 3]].forEach(function (y) {
      var C4 = y[0], P4 = y[1];
      f(cf.getCell(C4 + 4), P4 + '15', MONEY);
      [5, 6, 7, 8].forEach(function (r6) { f(cf.getCell(C4 + r6), '0', MONEY); });
      f(cf.getCell(C4 + 9), 'PnL!' + C4 + '14', MONEY);
      f(cf.getCell(C4 + 10), 'PnL!' + C4 + '11', MONEY);
      f(cf.getCell(C4 + 11), '-SUMIF(' + LY + ',' + y[2] + ',' + LF + ')', MONEY);
      f(cf.getCell(C4 + 12), "-'Debt Schedule'!$E$26", MONEY);
      f(cf.getCell(C4 + 13), '-Inputs!$B$11*12', MONEY);
    });
    for (var c5 = 1; c5 <= 15; c5++) {
      var Y = colL(c5);
      f(cf.getCell(Y + 14), 'SUM(' + Y + '5:' + Y + '13)', MONEY, true);
      f(cf.getCell(Y + 15), Y + '4+' + Y + '14', MONEY, true);
    }
    f(cf.getCell('B16'), 'MIN(B15:M15)', MONEY, true);
    cf.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

    /* ---------------- Break Even ---------------- */
    title(be, 'Break-even analysis', 'Sales needed to cover all fixed costs in year 1, including interest and depreciation.');
    be.getColumn(1).width = 42; be.getColumn(2).width = 16; be.getColumn(3).width = 16; be.getColumn(4).width = 18;
    label(be.getCell('A4'), 'Contribution margin (1 minus cost of goods %)'); f(be.getCell('B4'), '1-Inputs!B9', PCT);
    label(be.getCell('A5'), 'Fixed costs, year 1'); f(be.getCell('B5'), 'PnL!N8+PnL!N10+PnL!N11', MONEY);
    label(be.getCell('A6'), 'Break-even sales per year', true); f(be.getCell('B6'), 'IF(B4>0,B5/B4,0)', MONEY, true);
    label(be.getCell('A7'), 'Break-even sales per month', true); f(be.getCell('B7'), 'B6/12', MONEY, true);
    label(be.getCell('A8'), 'Projected sales, year 1'); f(be.getCell('B8'), 'PnL!N4', MONEY);
    label(be.getCell('A9'), 'Margin of safety'); f(be.getCell('B9'), 'IF(B8>0,(B8-B6)/B8,0)', PCT);
    header(be, 11, ['Month', 'Sales', 'Break-even', 'Above break-even?']);
    for (var q = 0; q < 12; q++) {
      var br = 12 + q, PC = colL(1 + q);
      f(be.getCell('A' + br), 'PnL!' + PC + '3', DATEM);
      f(be.getCell('B' + br), 'PnL!' + PC + '4', MONEY);
      f(be.getCell('C' + br), '$B$7', MONEY);
      f(be.getCell('D' + br), 'IF(B' + br + '>=C' + br + ',"Yes","No")');
    }

    /* ---------------- DSCR ---------------- */
    title(dscr, 'Debt service coverage ratio (DSCR)', 'Cash available for debt service divided by all loan payments.');
    dscr.getColumn(1).width = 44; [2, 3, 4].forEach(function (c6) { dscr.getColumn(c6).width = 15; });
    header(dscr, 3, ['', 'Year 1', 'Year 2', 'Year 3']);
    var PLC = ['N', 'O', 'P'];
    [[4, 'EBITDA'], [5, 'Less income tax'], [6, 'Less owner draws'], [7, 'Cash available for debt service'], [8, 'New loan payments'],
      [9, 'Existing debt payments'], [10, 'Total debt service'], [11, 'DSCR'], [12, 'Lender target'], [13, 'Meets lender target?'],
      [14, 'SBA minimum (standard 7(a))'], [15, 'Meets SBA minimum?']].forEach(function (x) { label(dscr.getCell('A' + x[0]), x[1], [7, 10, 11].indexOf(x[0]) >= 0); });
    ['B', 'C', 'D'].forEach(function (C7, i) {
      f(dscr.getCell(C7 + 4), 'PnL!' + PLC[i] + '9', MONEY);
      f(dscr.getCell(C7 + 5), '-PnL!' + PLC[i] + '13', MONEY);
      f(dscr.getCell(C7 + 6), '-Inputs!$B$11*12', MONEY);
      f(dscr.getCell(C7 + 7), 'SUM(' + C7 + '4:' + C7 + '6)', MONEY, true);
      f(dscr.getCell(C7 + 8), 'SUMIF(' + LY + ',' + (i + 1) + ',' + LD + ')', MONEY);
      f(dscr.getCell(C7 + 9), "'Debt Schedule'!$E$26", MONEY);
      f(dscr.getCell(C7 + 10), C7 + '8+' + C7 + '9', MONEY, true);
      f(dscr.getCell(C7 + 11), 'IF(' + C7 + '10>0,' + C7 + '7/' + C7 + '10,"No debt")', RATIO, true);
      f(dscr.getCell(C7 + 12), 'Inputs!$B$19', RATIO);
      f(dscr.getCell(C7 + 13), 'IF(ISNUMBER(' + C7 + '11),IF(' + C7 + '11>=' + C7 + '12,"Yes","No"),"n/a")');
      f(dscr.getCell(C7 + 14), 'Inputs!$B$20', RATIO);
      f(dscr.getCell(C7 + 15), 'IF(ISNUMBER(' + C7 + '11),IF(' + C7 + '11>=' + C7 + '14,"Yes","No"),"n/a")');
    });
    dscr.getCell('A17').value = 'SBA SOP 50 10 sets a minimum DSCR of 1.15x for standard 7(a) loans and 1.10x for 7(a) small loans. Many lenders look for 1.25x.';
    dscr.getCell('A18').value = 'Source: https://www.sba.gov/document/sop-50-10-lender-development-company-loan-programs';
    dscr.getCell('A17').font = dscr.getCell('A18').font = { italic: true, color: { argb: 'FF5B6777' } };

    /* ---------------- PFS ---------------- */
    title(pfs, 'Personal financial statement summary', 'Same categories as SBA Form 413. Submit the official, signed Form 413 for each owner of 20 percent or more.');
    pfs.getColumn(1).width = 46; pfs.getColumn(2).width = 16;
    label(pfs.getCell('A3'), 'Owner'); input(pfs.getCell('B3'), a.pfsName || null);
    label(pfs.getCell('A4'), 'Current as of'); input(pfs.getCell('B4'), a.pfsDate || null);
    var groups = [
      { key: 'pfsAssets', head: 'Assets', start: 7 },
      { key: 'pfsLiabilities', head: 'Liabilities', start: 20 },
      { key: 'pfsIncome', head: 'Source of income (annual)', start: 34 },
      { key: 'pfsContingent', head: 'Contingent liabilities', start: 42 }
    ];
    var Q = root.BPW_Q || (typeof require !== 'undefined' ? require('./questions.js') : null);
    var pfsStep = Q.STEPS.filter(function (s) { return s.id === 'pfs'; })[0];
    var totals = {};
    groups.forEach(function (g) {
      var fld = pfsStep.fields.filter(function (x) { return x.id === g.key; })[0];
      header(pfs, g.start - 1, [g.head, 'Amount']);
      var vals = a[g.key] || {};
      fld.items.forEach(function (itm, i) {
        label(pfs.getCell('A' + (g.start + i)), itm[1]);
        input(pfs.getCell('B' + (g.start + i)), n(vals[itm[0]]), MONEY);
      });
      var tr = g.start + fld.items.length;
      totals[g.key] = tr;
      label(pfs.getCell('A' + tr), 'Total ' + g.head.toLowerCase(), true);
      f(pfs.getCell('B' + tr), 'SUM(B' + g.start + ':B' + (tr - 1) + ')', MONEY, true);
    });
    var nw = totals.pfsLiabilities + 1;
    label(pfs.getCell('A' + nw), 'Net worth (total assets minus total liabilities)', true);
    f(pfs.getCell('B' + nw), 'B' + totals.pfsAssets + '-B' + totals.pfsLiabilities, MONEY, true);
    label(pfs.getCell('A' + (nw + 1)), 'Total liabilities plus net worth (equals total assets)');
    f(pfs.getCell('B' + (nw + 1)), 'B' + totals.pfsLiabilities + '+B' + nw, MONEY);
    pfs.getCell('A50').value = 'Official form: https://www.sba.gov/document/sba-form-413-personal-financial-statement';
    pfs.getCell('A50').font = { italic: true, color: { argb: 'FF5B6777' } };

    /* ---------------- Summary ---------------- */
    title(sum, biz + ': financial summary', 'Every figure here is a formula that reads the other sheets.');
    sum.getColumn(1).width = 44; [2, 3, 4].forEach(function (c8) { sum.getColumn(c8).width = 16; });
    header(sum, 4, ['Three-year outlook', 'Year 1', 'Year 2', 'Year 3']);
    [[5, 'Sales', 4], [6, 'Gross profit', 6], [7, 'Operating expenses', 8], [8, 'EBITDA', 9], [9, 'Net income', 14]].forEach(function (x) {
      label(sum.getCell('A' + x[0]), x[1]);
      ['B', 'C', 'D'].forEach(function (C9, i) { f(sum.getCell(C9 + x[0]), 'PnL!' + PLC[i] + x[2], MONEY); });
    });
    label(sum.getCell('A10'), 'Ending cash');
    ['B', 'C', 'D'].forEach(function (C9, i) { f(sum.getCell(C9 + '10'), "'Cash Flow'!" + PLC[i] + '15', MONEY); });
    label(sum.getCell('A11'), 'DSCR', true);
    ['B', 'C', 'D'].forEach(function (C9) { f(sum.getCell(C9 + '11'), 'DSCR!' + C9 + '11', RATIO, true); });
    header(sum, 13, ['Loan and funding', 'Amount', '', '']);
    [[14, 'Loan amount', 'Inputs!B16', MONEY], [15, 'Monthly loan payment', 'Loan!C3', MONEY], [16, 'Total project cost', "'Use of Funds'!B35", MONEY],
      [17, 'Owner equity injection', "'Use of Funds'!B37", MONEY], [18, 'Owner equity %', "'Use of Funds'!B39", PCT],
      [19, 'Break-even sales per month', "'Break Even'!B7", MONEY], [20, 'Lowest month-end cash, year 1', "'Cash Flow'!B16", MONEY],
      [21, 'Personal net worth (main owner)', "'PFS Form 413'!B" + nw, MONEY]].forEach(function (x) {
      label(sum.getCell('A' + x[0]), x[1]); f(sum.getCell('B' + x[0]), x[2], x[3]);
    });

    /* ---------------- Notes ---------------- */
    notes.getColumn(1).width = 110;
    var lines = [
      'How this workbook works',
      '',
      'Yellow cells with blue text are inputs. Everything else is a formula.',
      'Sales grow monthly in year 1, then by the yearly rates on the Inputs sheet.',
      'Cost of goods sold is a fixed percentage of sales. Operating expenses are flat in year 1 and grow by the yearly rate after that.',
      'The new loan is funded in month 1 and paid monthly from month 1. Interest is in the PnL; principal is in the Cash Flow.',
      'Existing debt payments come from the Debt Schedule and appear in the Cash Flow and DSCR, not in operating expenses.',
      'Income tax applies only to positive pre-tax income, month by month in year 1. Talk to your accountant about your actual tax situation.',
      'DSCR = (EBITDA minus income tax minus owner draws) divided by (new loan payments plus existing debt payments).',
      'Break-even = (operating expenses + interest + depreciation) divided by (1 minus cost of goods %).',
      '',
      'Sources',
      'SBA, Write your business plan: https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan',
      'SBA, SOP 50 10 Lender and Development Company Loan Programs: https://www.sba.gov/document/sop-50-10-lender-development-company-loan-programs',
      'SBA Form 413 Personal Financial Statement: https://www.sba.gov/document/sba-form-413-personal-financial-statement',
      '',
      'Built with the free Business Plan Wizard at https://dlerhetal.tech/proposal/ (MIT licensed). Uses ExcelJS (MIT).'
    ];
    lines.forEach(function (t, i) { notes.getCell('A' + (i + 1)).value = t; });
    notes.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
    notes.getCell('A12').font = { bold: true };

    return wb;
  }

  var api = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPW_XLSX = api;
})(typeof window !== 'undefined' ? window : this);
