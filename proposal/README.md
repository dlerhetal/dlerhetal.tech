# Business Plan Wizard

A guided business plan builder for small business owners applying for an SBA or bank loan.
It runs entirely in the browser: no server, no account, and no answers leave the page.

Live at https://dlerhetal.tech/proposal/

## What it does

- Walks the owner through the sections SBA's guide lists for a traditional business plan:
  executive summary, company description, market analysis, organization and management,
  products and services, marketing and sales, funding request, and financial projections.
- Shows an example answer for every question, and flags missing answers in red.
- Saves progress in the browser's localStorage, with a backup file for moving between computers.
- Builds three outputs in the browser:
  - **Business plan (.docx)** via docx.
  - **Financial workbook (.xlsx)** via ExcelJS, with live formulas on every sheet: summary,
    inputs, use of funds, 3-year profit and loss (monthly for year 1), cash flow, break-even,
    loan amortization, debt service coverage ratio, debt schedule, and a personal financial
    statement summary in the categories of SBA Form 413.
  - **Print or save as PDF** through a print stylesheet.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page |
| `style.css` | Styles, including the print layout |
| `questions.js` | Every step and question, with examples and the sample plan |
| `model.js` | The financial model; computes the same figures as the workbook formulas |
| `plan.js` | Turns answers into the plan outline used by the Word and print outputs |
| `export-docx.js` | Word export |
| `export-xlsx.js` | Excel export with formulas |
| `app.js` | The wizard interface, storage and downloads |
| `vendor/` | docx 9.x and ExcelJS 4.4, both MIT, with their license files |

To change the questions, edit `questions.js`. To change the math, change `model.js` and
`export-xlsx.js` together so the review screen and the workbook keep agreeing.

## Model notes

- Sales grow monthly in year 1, then by yearly rates. Cost of goods is a percent of sales.
- The new loan funds in month 1 and pays monthly from month 1 (level payment, PMT).
- DSCR = (EBITDA minus income tax minus owner draws) / (new loan payments + existing debt payments).
- SBA minimum DSCR, per SOP 50 10 8.1 (effective Oct 1, 2026), from `BPW_Model.sbaFloor()`:
  1.25x when the plan type is buying a business or buying out an owner (historical results);
  otherwise 1.10x for a 7(a) small loan and 1.15x for a standard 7(a) loan. The lender target
  defaults to 1.25x.

## Reuse

MIT License (see `LICENSE.txt`). Copy the folder, change what you like, host it anywhere
that serves static files.
