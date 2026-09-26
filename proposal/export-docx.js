/*
 * Business Plan Wizard: Word (.docx) export.
 * MIT License, see LICENSE in this folder. Uses docx (MIT), vendored in ./vendor.
 */
(function (root) {
  'use strict';

  var NAVY = '1A3C6E', RED = 'C00000', MUTED = '5B6777', FONT = 'Calibri';

  function build(docx, outline) {
    var D = docx;
    var children = [];

    function run(text, o) { o = o || {}; return new D.TextRun(Object.assign({ text: text, font: FONT }, o)); }
    function para(text, o) {
      o = o || {};
      return new D.Paragraph({ children: [run(text, o.run)], spacing: { after: 140, line: 276 }, alignment: o.align, keepNext: o.keepNext });
    }
    function cell(text, o) {
      o = o || {};
      return new D.TableCell({
        children: [new D.Paragraph({ children: [run(text, { bold: !!o.bold, color: o.color, size: 20 })], alignment: o.right ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT })],
        shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 }
      });
    }
    function table(head, rows, opts) {
      opts = opts || {};
      var trs = [];
      if (head) trs.push(new D.TableRow({ tableHeader: true, children: head.map(function (h, i) { return cell(h, { bold: true, color: 'FFFFFF', fill: NAVY, right: opts.numeric && i > 0 }); }) }));
      rows.forEach(function (r, ri) {
        trs.push(new D.TableRow({ children: r.map(function (c, i) { return cell(c, { right: opts.numeric && i > 0, fill: ri % 2 ? 'F2F4F7' : undefined, bold: opts.boldFirst && i === 0 }); }) }));
      });
      if (opts.total) trs.push(new D.TableRow({ children: opts.total.map(function (c, i) { return cell(c, { bold: true, right: i > 0 && opts.numeric, fill: 'E6E9EE' }); }) }));
      return new D.Table({ rows: trs, width: { size: 100, type: D.WidthType.PERCENTAGE } });
    }

    outline.blocks.forEach(function (b) {
      if (b.type === 'cover') {
        children.push(new D.Paragraph({ spacing: { before: 2600 }, children: [] }));
        children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 200 }, children: [run(b.title, { bold: true, size: 56, color: NAVY })] }));
        children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 600 }, children: [run(b.subtitle, { size: 36, color: MUTED })] }));
        b.lines.forEach(function (l) { children.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 120 }, children: [run(l, { size: 24 })] })); });
        children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      } else if (b.type === 'h1') {
        children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 360, after: 160 },
          border: { bottom: { color: NAVY, size: 8, style: D.BorderStyle.SINGLE, space: 4 } },
          children: [run(b.text, { bold: true, size: 32, color: NAVY })] }));
      } else if (b.type === 'h2') {
        children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 220, after: 100 },
          children: [run(b.text, { bold: true, size: 24, color: NAVY })] }));
      } else if (b.type === 'p') {
        children.push(para(b.text, { run: { size: 22 } }));
      } else if (b.type === 'missing') {
        children.push(new D.Paragraph({ spacing: { after: 140 },
          border: { left: { color: RED, size: 18, style: D.BorderStyle.SINGLE, space: 6 } },
          children: [run(b.text, { bold: true, color: RED, size: 22 })] }));
      } else if (b.type === 'table') {
        children.push(table(b.head, b.rows, { numeric: b.numeric, total: b.total }));
        children.push(new D.Paragraph({ spacing: { after: 120 }, children: [] }));
      } else if (b.type === 'kv') {
        if (b.rows.length) {
          children.push(table(null, b.rows, { boldFirst: true }));
          children.push(new D.Paragraph({ spacing: { after: 120 }, children: [] }));
        }
      }
    });

    var bizName = (outline.blocks[0] && outline.blocks[0].title) || 'Business Plan';
    return new D.Document({
      creator: bizName,
      title: bizName + ' Business Plan',
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1200, right: 1200 } }, titlePage: true },
        footers: {
          default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER,
            children: [run(bizName + ' Business Plan    Page ', { size: 18, color: MUTED }), new D.TextRun({ children: [D.PageNumber.CURRENT], size: 18, color: MUTED, font: FONT })] })] }),
          first: new D.Footer({ children: [new D.Paragraph({ children: [] })] })
        },
        children: children
      }]
    });
  }

  var api = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPW_DOCX = api;
})(typeof window !== 'undefined' ? window : this);
