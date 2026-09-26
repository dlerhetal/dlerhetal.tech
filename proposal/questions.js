/*
 * Business Plan Wizard: question bank and sample plan.
 * MIT License, see LICENSE in this folder.
 *
 * Each step has fields. Field types:
 *   text, textarea, money, percent, number, select, month, date, list
 * A "list" field has columns; each column has its own type.
 * "req: true" marks what a lender will expect to see; missing ones are flagged in red.
 */
(function (root) {
  'use strict';

  var STEPS = [
    {
      id: 'start', title: 'Start here', short: 'Start',
      intro: 'A few basics. These fill the cover page and shape the rest of the questions.',
      fields: [
        { id: 'bizName', label: 'Business name', type: 'text', req: true, example: 'Maple Street Bakery LLC' },
        { id: 'owners', label: 'Owner name or names', type: 'text', req: true, example: 'Jordan Rivera' },
        { id: 'location', label: 'City and state', type: 'text', req: true, example: 'Springfield, Illinois' },
        { id: 'planType', label: 'Which describes you?', type: 'select', req: true,
          options: ['Starting a new business', 'Growing an existing business', 'Buying an existing business', 'Buying out a partner or owner'],
          example: 'Starting a new business' },
        { id: 'program', label: 'Which loan are you applying for?', type: 'select', req: false,
          options: ['SBA 7(a)', 'SBA 7(a) small', 'SBA Express', 'SBA 504', 'SBA Microloan', 'Conventional bank loan', 'Not sure yet'],
          help: 'Not sure? The SBA Loan Guide has a quick picker.', example: 'SBA 7(a) small' },
        { id: 'contact', label: 'Phone or email a lender should use', type: 'text', req: false, example: 'jordan@example.com' }
      ]
    },
    {
      id: 'exec', title: 'Executive summary', short: 'Summary',
      intro: 'The one page a busy loan officer reads first. Write it in plain words. You can come back and polish it after the other sections are done.',
      fields: [
        { id: 'whatWeDo', label: 'What does the business do, and for whom?', type: 'textarea', req: true,
          example: 'Maple Street Bakery is a neighborhood bakery and coffee counter selling fresh bread, pastries and custom cakes to families and local offices on the east side of Springfield.' },
        { id: 'whyWin', label: 'Why will it succeed?', type: 'textarea', req: true,
          help: 'Your experience, a gap in the market, a signed customer, a location advantage.',
          example: 'I managed a high-volume bakery for eight years. The east side has no scratch bakery within three miles, and two office parks nearby have already asked about catering.' },
        { id: 'milestones', label: 'What will you accomplish in the first 12 months?', type: 'textarea', req: false,
          example: 'Open by March. Reach 300 customers a week by month six. Sign three office catering accounts. Break even by month nine.' }
      ]
    },
    {
      id: 'company', title: 'Company description', short: 'Company',
      intro: 'Who you are on paper and what problem you solve.',
      fields: [
        { id: 'legalName', label: 'Legal name, if different from the business name', type: 'text', req: false, example: 'Maple Street Bakery LLC' },
        { id: 'entity', label: 'Legal structure', type: 'select', req: true,
          options: ['LLC', 'S corporation', 'C corporation', 'Sole proprietorship', 'Partnership', 'Not formed yet'], example: 'LLC' },
        { id: 'founded', label: 'Year started (or planned opening date)', type: 'text', req: true, example: 'Opening March 2027' },
        { id: 'address', label: 'Business address', type: 'text', req: false, example: '410 Maple Street, Springfield, IL' },
        { id: 'problem', label: 'What problem do you solve for customers?', type: 'textarea', req: true,
          example: 'East side families and offices drive 20 minutes for fresh bread and custom cakes, and grocery store bakery products are the only nearby option.' },
        { id: 'strengths', label: 'What are your strongest advantages?', type: 'textarea', req: true,
          example: 'Owner experience running a bakery, a lease on a busy corner with parking, and recipes already tested with paying customers at the farmers market.' },
        { id: 'licenses', label: 'Licenses, permits and certifications you hold or need', type: 'textarea', req: false,
          example: 'County food service permit (applied), city business license, food handler certificates for all staff.' }
      ]
    },
    {
      id: 'market', title: 'Market and competition', short: 'Market',
      intro: 'Show the lender you know who buys, how many of them there are, and who else is selling to them.',
      fields: [
        { id: 'industry', label: 'How is your industry doing?', type: 'textarea', req: true,
          help: 'One or two facts with a source: a trade association, the Census Bureau, your state data.',
          example: 'Retail bakeries are a steady local business. Census data shows consistent growth in specialty food stores in our county over the last five years.' },
        { id: 'target', label: 'Who is your target customer?', type: 'textarea', req: true,
          example: 'Households within three miles (about 18,000 people), and the 40 small offices in the two nearby office parks.' },
        { id: 'marketSize', label: 'How big is the market you can reach, and where did the number come from?', type: 'textarea', req: false,
          example: 'About 7,000 households spending an average of $20 a month on baked goods, roughly $1.7 million a year. Source: Census household counts and the Bureau of Labor Statistics Consumer Expenditure Survey.' },
        { id: 'competitors', label: 'Main competitors', type: 'list', req: true,
          columns: [
            { id: 'name', label: 'Competitor', type: 'text' },
            { id: 'strengths', label: 'Their strengths', type: 'text' },
            { id: 'weaknesses', label: 'Their weaknesses', type: 'text' }
          ],
          example: [
            { name: 'Grocery store bakery', strengths: 'Low prices, convenient', weaknesses: 'Not made from scratch, no custom orders' },
            { name: 'Downtown bakery', strengths: 'Well known', weaknesses: '20 minute drive, no parking' }
          ] },
        { id: 'advantage', label: 'Why will customers choose you over them?', type: 'textarea', req: true,
          example: 'Fresh scratch products, custom cakes with a two-day turnaround, and a location people pass on the way to work.' }
      ]
    },
    {
      id: 'services', title: 'Products and services', short: 'Services',
      intro: 'What you sell and what it costs the customer.',
      fields: [
        { id: 'offerings', label: 'What you sell', type: 'list', req: true,
          columns: [
            { id: 'name', label: 'Product or service', type: 'text' },
            { id: 'desc', label: 'Description', type: 'text' },
            { id: 'price', label: 'Typical price', type: 'text' }
          ],
          example: [
            { name: 'Bread and pastries', desc: 'Daily fresh loaves, croissants, muffins', price: '$3 to $8' },
            { name: 'Custom cakes', desc: 'Birthday and event cakes, two-day turnaround', price: '$45 to $150' },
            { name: 'Office catering', desc: 'Breakfast trays delivered', price: '$60 to $200 per order' }
          ] },
        { id: 'delivery', label: 'How do you produce and deliver it?', type: 'textarea', req: false,
          example: 'Baked on site starting at 4 a.m. Counter sales, phone and online orders, and delivery within five miles for catering.' },
        { id: 'suppliers', label: 'Key suppliers', type: 'textarea', req: false,
          example: 'Regional flour mill and a food service distributor, with a second distributor as backup.' }
      ]
    },
    {
      id: 'marketing', title: 'Marketing and sales', short: 'Marketing',
      intro: 'How customers find you and how a first visit becomes a regular.',
      fields: [
        { id: 'findYou', label: 'How will customers find you?', type: 'textarea', req: true,
          example: 'Street signage, a Google business profile, neighborhood social media groups, and sampling at the farmers market.' },
        { id: 'salesProcess', label: 'How do you win and close a sale?', type: 'textarea', req: false,
          example: 'Walk-in counter sales. For catering, I visit each office manager with a sample tray and a price sheet.' },
        { id: 'retention', label: 'How will you keep customers coming back?', type: 'textarea', req: false,
          example: 'A punch-card loyalty program and a weekly special announced by text to customers who sign up.' },
        { id: 'pricing', label: 'How did you set your prices?', type: 'textarea', req: false,
          example: 'Priced at ingredient and labor cost plus a 65 percent gross margin, checked against the downtown bakery.' }
      ]
    },
    {
      id: 'management', title: 'Management and operations', short: 'Team',
      intro: 'Lenders lend to people. Show who runs the business and how the work gets done.',
      fields: [
        { id: 'team', label: 'Owners and key people', type: 'list', req: true,
          columns: [
            { id: 'name', label: 'Name', type: 'text' },
            { id: 'role', label: 'Role', type: 'text' },
            { id: 'experience', label: 'Relevant experience', type: 'text' },
            { id: 'own', label: 'Ownership %', type: 'percent' }
          ],
          example: [
            { name: 'Jordan Rivera', role: 'Owner and head baker', experience: '8 years managing a 40-seat bakery cafe', own: 100 }
          ] },
        { id: 'staff', label: 'Employees now and planned', type: 'textarea', req: false,
          example: 'Opening with two full-time bakers and three part-time counter staff. Adding a delivery driver in year two.' },
        { id: 'advisors', label: 'Outside advisors', type: 'textarea', req: false,
          help: 'Accountant, attorney, insurance agent, mentor.',
          example: 'Bookkeeping and taxes by a local CPA firm. SBDC advisor reviewing this plan.' },
        { id: 'facility', label: 'Location, facility and equipment', type: 'textarea', req: false,
          example: '1,800 square foot storefront, 10-year lease with a 5-year renewal. Deck oven, mixer, proofing cabinet and display cases.' },
        { id: 'hours', label: 'Operating hours and daily routine', type: 'textarea', req: false,
          example: 'Open 6 a.m. to 3 p.m., Tuesday through Sunday.' }
      ]
    },
    {
      id: 'funding', title: 'Funding request', short: 'Funding',
      intro: 'How much you need, what it pays for, and where every dollar comes from. The loan lines should add up to the loan amount. Mark money you will keep in the bank as working capital so the cash flow counts it.',
      fields: [
        { id: 'loanAmount', label: 'Loan amount requested', type: 'money', req: true, example: 175000 },
        { id: 'loanRate', label: 'Expected interest rate (% per year)', type: 'percent', req: true,
          help: 'Ask your lender. SBA 7(a) rates are the prime rate plus a capped spread.', example: 10.5 },
        { id: 'loanYears', label: 'Loan term (years)', type: 'number', req: true,
          help: 'Up to 10 years for equipment and working capital, up to 25 for real estate.', example: 10 },
        { id: 'uses', label: 'Use of funds', type: 'list', req: true,
          columns: [
            { id: 'item', label: 'What it pays for', type: 'text' },
            { id: 'amount', label: 'Amount', type: 'money' },
            { id: 'source', label: 'Paid by', type: 'select', options: ['Loan', 'Owner cash', 'Other'] },
            { id: 'kind', label: 'Spent or kept?', type: 'select', options: ['Spent at start', 'Kept as working capital'] }
          ],
          example: [
            { item: 'Kitchen equipment', amount: 85000, source: 'Loan', kind: 'Spent at start' },
            { item: 'Leasehold improvements', amount: 60000, source: 'Loan', kind: 'Spent at start' },
            { item: 'Opening inventory and supplies', amount: 10000, source: 'Loan', kind: 'Spent at start' },
            { item: 'Working capital reserve', amount: 20000, source: 'Loan', kind: 'Kept as working capital' },
            { item: 'Security deposit, permits and fees', amount: 8000, source: 'Owner cash', kind: 'Spent at start' },
            { item: 'Additional working capital', amount: 12000, source: 'Owner cash', kind: 'Kept as working capital' }
          ] },
        { id: 'collateral', label: 'Collateral you can offer', type: 'textarea', req: false,
          help: 'SBA lenders take available collateral but will not decline a loan only because collateral is short.',
          example: 'Business equipment, and a second mortgage on my home if the lender requires it.' }
      ]
    },
    {
      id: 'financials', title: 'Financial projections', short: 'Numbers',
      intro: 'The workbook builds a 3-year forecast from these few numbers, month by month for year one. Use honest, slightly conservative figures and write down how you got them.',
      fields: [
        { id: 'startMonth', label: 'First month of the forecast', type: 'month', req: true, example: '2027-03' },
        { id: 'month1Revenue', label: 'Sales in the first month', type: 'money', req: true, example: 27000 },
        { id: 'growthY1', label: 'Monthly sales growth during year 1 (%)', type: 'percent', req: true, example: 3 },
        { id: 'growthY2', label: 'Sales growth in year 2 over year 1 (%)', type: 'percent', req: true, example: 12 },
        { id: 'growthY3', label: 'Sales growth in year 3 over year 2 (%)', type: 'percent', req: true, example: 8 },
        { id: 'cogsPct', label: 'Cost of goods sold, as a % of sales', type: 'percent', req: true,
          help: 'Materials and direct costs that rise with each sale.', example: 32 },
        { id: 'expenses', label: 'Monthly operating expenses', type: 'list', req: true,
          help: 'Do not list loan payments here. Existing loans go on the next step and the new loan is calculated for you.',
          columns: [
            { id: 'name', label: 'Expense', type: 'text' },
            { id: 'monthly', label: 'Per month', type: 'money' }
          ],
          example: [
            { name: 'Rent', monthly: 3200 },
            { name: 'Payroll and payroll taxes', monthly: 7800 },
            { name: 'Utilities', monthly: 1100 },
            { name: 'Insurance', monthly: 450 },
            { name: 'Marketing', monthly: 600 },
            { name: 'Software, card fees and other', monthly: 700 }
          ] },
        { id: 'expenseGrowth', label: 'Operating expense growth per year (%)', type: 'percent', req: false, example: 3 },
        { id: 'ownerDraw', label: 'Owner pay not included in expenses, per month', type: 'money', req: false,
          help: 'Lenders subtract a reasonable owner draw before measuring debt coverage.', example: 2500 },
        { id: 'taxRate', label: 'Income tax rate (%)', type: 'percent', req: false, example: 21 },
        { id: 'depreciation', label: 'Depreciation per year', type: 'money', req: false,
          help: 'Roughly equipment cost divided by years of useful life. Your accountant can refine it.', example: 14500 },
        { id: 'startCash', label: 'Business cash on hand before the loan', type: 'money', req: false, example: 0 },
        { id: 'dscrTarget', label: 'Lender coverage target (DSCR)', type: 'number', req: false,
          help: 'SBA minimums (SOP 50 10 8.1, effective Oct 1, 2026): 1.25 for buying a business or buying out an owner, on historical results; otherwise 1.15 for a standard 7(a) loan and 1.10 for a 7(a) small loan. Many lenders want 1.25 either way.', example: 1.25 },
        { id: 'assumptions', label: 'How did you arrive at these numbers?', type: 'textarea', req: true,
          example: 'First-month sales assume 320 customers a week at an $18 average ticket plus three catering orders a week. Cost of goods is based on supplier quotes. Rent is from the signed lease.' }
      ]
    },
    {
      id: 'debts', title: 'Existing debt', short: 'Debt',
      intro: 'Every business loan, equipment lease and line of credit you will keep after this loan closes. Leave it empty if you have none.',
      fields: [
        { id: 'debts', label: 'Business debt schedule', type: 'list', req: false,
          columns: [
            { id: 'lender', label: 'Lender', type: 'text' },
            { id: 'original', label: 'Original amount', type: 'money' },
            { id: 'balance', label: 'Current balance', type: 'money' },
            { id: 'rate', label: 'Rate %', type: 'percent' },
            { id: 'payment', label: 'Monthly payment', type: 'money' },
            { id: 'maturity', label: 'Maturity', type: 'text' },
            { id: 'collateral', label: 'Collateral', type: 'text' }
          ],
          example: [
            { lender: 'Equipment finance company', original: 18000, balance: 12000, rate: 8.9, payment: 380, maturity: '2029-06', collateral: 'Display cases' }
          ] }
      ]
    },
    {
      id: 'pfs', title: 'Personal financial statement', short: 'Personal',
      intro: 'SBA asks every owner of 20 percent or more for a personal financial statement on SBA Form 413. Enter the main owner here to get a summary sheet in the same categories. Each owner still signs the official form.',
      fields: [
        { id: 'pfsName', label: 'Owner name', type: 'text', req: false, example: 'Jordan Rivera' },
        { id: 'pfsDate', label: 'Information current as of', type: 'date', req: false, example: '2027-01-15' },
        { id: 'pfsAssets', label: 'Assets', type: 'group', req: false, items: [
          ['cash', 'Cash on hand and in banks', 42000], ['savings', 'Savings accounts', 15000],
          ['ira', 'IRA or other retirement account', 38000], ['receivables', 'Accounts and notes receivable', 0],
          ['lifeCsv', 'Life insurance, cash surrender value only', 0], ['stocks', 'Stocks and bonds', 6000],
          ['realEstate', 'Real estate', 240000], ['autos', 'Automobiles', 14000],
          ['personalProp', 'Other personal property', 10000], ['otherAssets', 'Other assets', 0]
        ] },
        { id: 'pfsLiabilities', label: 'Liabilities', type: 'group', req: false, items: [
          ['payables', 'Accounts payable', 0], ['notesPayable', 'Notes payable to banks and others', 0],
          ['autoLoan', 'Installment account (auto)', 6500], ['otherInstall', 'Installment account (other)', 0],
          ['lifeLoans', 'Loans against life insurance', 0], ['mortgages', 'Mortgages on real estate', 168000],
          ['unpaidTaxes', 'Unpaid taxes', 0], ['otherLiab', 'Other liabilities', 2400]
        ] },
        { id: 'pfsIncome', label: 'Annual income', type: 'group', req: false, items: [
          ['salary', 'Salary', 52000], ['investIncome', 'Net investment income', 400],
          ['reIncome', 'Real estate income', 0], ['otherIncome', 'Other income', 0]
        ] },
        { id: 'pfsContingent', label: 'Contingent liabilities', type: 'group', req: false, items: [
          ['endorser', 'As endorser or co-maker', 0], ['legal', 'Legal claims and judgments', 0],
          ['fedTax', 'Provision for federal income tax', 0], ['specialDebt', 'Other special debt', 0]
        ] }
      ]
    }
  ];

  function buildSample() {
    var s = {};
    STEPS.forEach(function (st) {
      st.fields.forEach(function (f) {
        if (f.type === 'group') {
          var g = {};
          f.items.forEach(function (it) { g[it[0]] = it[2]; });
          s[f.id] = g;
        } else if (f.type === 'list') {
          s[f.id] = JSON.parse(JSON.stringify(f.example || []));
        } else {
          s[f.id] = f.example;
        }
      });
    });
    return s;
  }

  var api = { STEPS: STEPS, buildSample: buildSample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPW_Q = api;
})(typeof window !== 'undefined' ? window : this);
