// Documentation for the test-data export: which family each sheet belongs to,
// what one row of it represents, and what every column means.
//
// This is the SINGLE SOURCE OF TRUTH for the structure documentation. The export
// reads it to (a) emit a ready-to-paste Notion section, (b) tell the workbook
// formatter which family each tab belongs to, and (c) name any column that has
// appeared in the data without a description being written for it.
//
// The data model changes often. When it does, `npm run export-data` reports what
// moved and what is now undocumented — add the missing entries here rather than
// editing the Notion page by hand.

// Tab families, in workbook order. Adding a sheet means listing it here too;
// the export fails loudly if a sheet is missing from this list.
export const FAMILIES = [
  { name: 'Setup', colour: '1F2933', label: 'Ink', purpose: 'Index, horizon, FX, fixed lookups', sheets: ['Contents', 'Reference'] },
  {
    name: 'Reference data',
    colour: '0078FF',
    label: 'Blue',
    purpose: 'The inputs and the shape of the world',
    sheets: [
      'Entities', 'Seed profiles', 'One-off items', 'Tax payments', 'Bank accounts',
      'Cash pools', 'Grid views', 'Source types', 'Payment terms', 'Invoice survival', 'Categories',
    ],
  },
  {
    name: 'Forecast data',
    colour: '00A06E',
    label: 'Green',
    purpose: 'The numbers themselves, raw and aggregated',
    sheets: ['Daily cashflows', 'Daily balance', 'Bucket balances', 'Monthly by category', 'GROUP by currency'],
  },
  {
    name: 'Drill-in detail',
    colour: '8B49FF',
    label: 'Purple',
    purpose: 'What the side panels and chart overlays show',
    sheets: ['Models', 'Invoice detail', 'Invoice tail (Other)', 'Scenarios', 'Scenario balances', 'Manual shocks'],
  },
  { name: 'Assurance', colour: 'E07B00', label: 'Amber', purpose: 'Reconciliation assertions', sheets: ['Checks'] },
]

// Columns that carry the same meaning wherever they appear. Used as a fallback,
// so a recurring column landing on a new sheet is documented automatically.
export const COMMON_COLUMNS = {
  'Tab id': 'Machine id of the grid — the key for isolating one grid: `summary`, `uk`, `dk`, `us`, `de`, `acct:<id>` or `pool:<id>`',
  Grid: 'The grid’s display title',
  Kind: 'What sort of grid: group, company, account or pool',
  Company: 'The holding entity',
  Section: 'Direction of the flow — Inflow or Outflow',
  Code: 'Category code — stable across entities, so safe to join on',
  Category: 'Category display name — repeats legitimately across source types and sweep legs',
  'Source type': 'Where the flow came from, independent of the category it lands in. `Not set` means the dimension has not reached that category',
  'Bank account': 'Account the cash moves through, as `name ···number`, or Unassigned',
  Day: 'Weekday abbreviation, so the weekly rhythm is visible without a formula',
  Month: 'Month label, as the table shows it',
  'Month key': 'Sortable `YYYY-MM` form of the month',
  Currency: 'The currency this row’s amounts are in',
}

// Per-sheet documentation. `grain` completes the sentence "one row per …";
// `summary` is the one-line description used in the sheet index; `columns` maps
// a column's exact label to its meaning, overriding COMMON_COLUMNS.
// `patterns` handles columns whose labels are generated rather than fixed.
export const SHEET_DOCS = {
  Reference: {
    grain: 'lookup item',
    summary: 'Horizon bounds, FX rates and locales, grouping levels, sweep pool config, uncertainty-band samples',
    columns: {
      Group: 'Which family of lookup: Horizon, Currency, Grouping level, Sweep pool, Uncertainty band',
      Item: 'The specific setting',
      Value: 'Its value, held as text so mixed kinds sit together',
      Detail: 'What it means and where it bites',
    },
  },

  Entities: {
    grain: 'company',
    summary: 'The four local companies with their FX, scale, seed, opening and closing, and a plain-English trading profile',
    columns: {
      Id: 'Entity key, which is also its Tab id',
      'Tab label': 'Label on the app’s tab bar',
      Company: 'Legal-ish name used throughout the workbook',
      Currency: 'The entity’s own currency',
      Locale: 'Formatting locale',
      'FX (GBP → local)': 'Base-to-local rate; base value = local ÷ fx',
      Size: 'Relative size of the entity',
      'Scale (fx x size)': 'Multiplier applied to every seeded figure',
      Seed: 'PRNG seed in hex — fixes the entity’s random pattern',
      Accounts: 'How many bank accounts it holds',
      'Opening balance': 'Cash before day 0, after the scale is applied',
      'Closing balance': 'Balance on the final day of the horizon',
      'Trading profile': 'Plain-English shape of the entity’s curve',
    },
  },

  'Seed profiles': {
    grain: 'company × knob',
    summary: 'Every generator knob, the value actually used, and whether it came from the profile or the shared default',
    columns: {
      Company: 'Entity the knob applies to',
      Currency: 'Its currency — note the figures here are pre-scale',
      Knob: 'Generator parameter name, exactly as in the code',
      'Value used': 'The value actually used for this entity',
      Source: '`profile` if the entity set it, `default` if it fell back to the shared value',
      'What it drives': 'Which series or behaviour the knob controls',
    },
  },

  'One-off items': {
    grain: 'hand-placed lump',
    summary: 'The drawdowns, capex, milestones and settlements that give each entity its distinctive curve',
    columns: {
      Date: 'The single day the lump lands on',
      'Lands on': 'Category it is added to',
      'Amount (pre-scale)': 'As written in the profile',
      'Amount in grid': 'After the entity’s scale — what the grid actually shows',
      Currency: 'Entity currency',
      'What it represents': 'Business meaning, e.g. equipment capex',
    },
  },

  'Tax payments': {
    grain: 'company × instalment',
    summary: 'The four quarterly-ish tax dates, identical across entities; only the amounts differ',
    columns: {
      Date: 'Payment date — the same for every entity',
      Instalment: 'Q1 to Q4',
      'Amount (pre-scale)': 'As written in the profile',
      'Amount in grid': 'After the entity’s scale',
      Currency: 'Entity currency',
    },
  },

  'Bank accounts': {
    grain: 'account',
    summary: 'Opening split by share, forecast movement over the horizon, closing, and pool membership',
    columns: {
      Id: 'Account key; `acct:<id>` is its Tab id',
      Company: 'Holding entity',
      Account: 'Account name',
      Number: 'Last four digits',
      Currency: 'Account currency — may differ from the entity’s own',
      Role: 'Which categories route here: operating, collections, payroll, payables, financing, eursweep',
      Bank: 'Holding bank',
      'Cash pool': 'Pool name, or *Not pooled*',
      'Open share': 'Weight used to split the entity opening across its accounts',
      Opening: 'Its share of the opening; the rounding remainder lands on the primary account',
      'Forecast movement': 'Everything the forecast moves across the account over the horizon, sweeps included',
      Closing: 'Opening + movement. Not banked, and not actual',
      Note: 'Flags sweep participants and the sweep header',
    },
  },

  'Cash pools': {
    grain: 'pool',
    summary: 'Pool type, currency, members, and whether it still earns a grid',
    columns: {
      Id: 'Pool key; `pool:<id>` is its Tab id',
      Pool: 'Display name',
      Type: 'Physical sweep or Notional',
      Currency: 'Currency the pool grid is shown in',
      Accounts: 'Member count',
      Companies: 'Entities represented — more than one means the pool is cross-border',
      'Member accounts': 'The accounts themselves',
      'Has a grid': '*No* means the pool holds no accounts and is retired from the view picker',
    },
  },

  'Grid views': {
    grain: 'grid the app can render',
    summary: 'GROUP plus companies, accounts and pools, each with opening, net, closing and lowest cash point',
    columns: {
      Title: 'Heading the app shows',
      Subtitle: 'Secondary heading, e.g. account number and bank',
      'Shown in': 'Display currency. GROUP is re-denominable, so it is exported in the base currency',
      Entities: 'Companies the grid draws on',
      'Accounts in scope': 'How many accounts the cut covers',
      Opening: 'Where the grid starts',
      'Net over horizon': 'Sum of every daily net',
      Closing: 'Final-day balance',
      'Lowest cash point': 'Minimum daily closing — caught at daily resolution, not hidden inside a month',
      'Lowest on': 'The day the lowest point happens',
    },
  },

  'Source types': {
    grain: 'vocabulary member',
    summary: 'The fixed source-type list, which of them are seeded, and the *Not set* sentinel',
    columns: {
      'Source type': 'Vocabulary member, plus the *Not set* sentinel on the last row',
      'In the data': 'Whether any seeded row currently carries it',
      Note: 'What it means. *Unknown* is a real source whose origin the feed could not identify; *Not set* means the dimension has not reached that category',
    },
  },

  'Payment terms': {
    grain: 'terms bucket',
    summary: 'The terms distribution behind the invoice register',
    columns: {
      'Terms (days)': 'Contractual payment terms',
      'Share of invoices': 'Weight of the register sitting on those terms',
      Note: 'Commentary',
    },
  },

  'Invoice survival': {
    grain: 'day',
    summary: 'Share of invoiced volume still on the register, AR and AP — this is what explains the AR/AP taper',
    columns: {
      'Day index': '0-based day into the horizon',
      Date: 'Calendar date',
      'Weeks out': 'The same position expressed in weeks',
      'AR surviving': 'Share of a steady-state day’s invoiced receipts still on the register',
      'AP surviving': 'The same for payables — tighter, because you choose when to pay',
    },
  },

  Categories: {
    grain: 'company × forecast row',
    summary: 'Every row behind a company grid, sweep legs included, with model, source type, account and horizon totals',
    columns: {
      Colour: 'Swatch hex used in the grid and chart',
      Modelled: 'Whether a model produces it, rather than manual entry or a treasury rule',
      Model: 'Model name, or *Manual entry* / *Zero-balancing sweep (rule)*',
      'Model class': 'Statistical, ML/AI, Custom R&D, Treasury or Manual',
      Currency: 'Entity currency',
      'Total over horizon': 'Sum of all daily values — unsigned within its section',
      'Days with a value': 'Count of non-zero days; a low count shows tapering or a sparse schedule',
      'Largest single day': 'Largest absolute daily amount',
    },
  },

  'Daily cashflows': {
    grain: 'company × row × day',
    summary: 'The source of truth. Every seeded daily amount, with zero rows kept deliberately — non-pay days are part of the shape',
    columns: {
      Currency: 'Entity currency — the amounts are in this',
      Date: 'The day',
      Amount: 'The seeded daily amount. Zeros are kept on purpose',
    },
  },

  'Daily balance': {
    grain: 'grid × day',
    summary: 'The daily running balance the chart plots, for every grid, in that grid’s display currency',
    columns: {
      Currency: 'The grid’s display currency',
      Date: 'The day',
      'Daily net': 'Inflows less outflows on the day',
      'Daily closing': 'Opening balance + cumulative net. This is the line the chart plots',
    },
  },

  'Bucket balances': {
    grain: 'grid × granularity × bucket',
    summary: 'The table’s own numbers at both Weeks and Months, with the sweep broken out into its own column',
    columns: {
      Currency: 'The grid’s display currency',
      Granularity: 'Week or Month — both are present, so filter to one',
      Bucket: 'Column label as the table shows it',
      Starts: 'First day in the bucket',
      Ends: 'Last day in the bucket',
      Days: 'Days spanned — the first and last buckets can be partial',
      'Total inflows': 'Operational inflows, excluding the sweep',
      'Total outflows': 'Operational outflows, excluding the sweep',
      'Net movement': 'Inflows less outflows',
      Sweep: 'Signed sweep effect; positive means cash swept in. Shown separately, exactly as in the grid',
      Opening: 'The previous bucket’s closing',
      Closing: 'Opening + net + sweep',
    },
  },

  'Monthly by category': {
    grain: 'company × row × month',
    summary: 'The Months view of each company grid, ready to pivot',
    columns: {
      Currency: 'Entity currency',
      Amount: 'Month total for the row',
    },
  },

  'GROUP by currency': {
    grain: 'currency × month',
    summary: 'The consolidation in each currency the *Show in* picker offers — the same numbers at four rates',
    columns: {
      'Shown in': 'Display currency — four blocks of the same twelve months',
      'Rate (GBP →)': 'Rate applied to the base-currency consolidation',
      'Total inflows': 'Excluding the sweep',
      'Total outflows': 'Excluding the sweep',
      'Net movement': 'Inflows less outflows',
      Sweep: 'Nets to zero across the group',
      Opening: 'The previous month’s closing',
      Closing: 'Opening + net + sweep',
    },
  },

  Models: {
    grain: 'company × row',
    summary: 'What the model panel shows: model, class, owner, retrain cadence, drivers and backtest stats',
    columns: {
      Modelled: 'Yes or No',
      Model: 'Model name as the panel shows it',
      'Model class': 'Statistical, ML/AI, Custom R&D, Treasury or Manual',
      Owner: 'Owning team',
      Retrain: 'Retrain cadence',
      'Trained on': 'Months of history the fit used',
      MAPE: 'Backtested mean absolute percentage error — ⚠️ one sample only, see the determinism table',
      Bias: 'Average signed error; positive means over-forecasting — ⚠️ one sample only',
      Coverage: 'Share of actuals falling inside the 80% prediction interval — ⚠️ one sample only',
      Drivers: 'Inputs the model consumes',
      Description: 'Blurb shown in the panel',
    },
  },

  'Invoice detail': {
    grain: 'invoice line',
    summary: 'Counterparty and invoice lines behind every AR/AP cell at Months granularity',
    columns: {
      Currency: 'Entity currency',
      Category: 'Customer Receipts or Suppliers',
      'Party type': 'Customer or Supplier',
      Month: 'The cell being drilled into',
      Counterparty: 'Named party — repeats once per invoice line',
      'Counterparty total': 'That party’s share of the cell, repeated on each of its lines',
      'Share of cell': 'Counterparty total ÷ cell total',
      Invoice: 'Invoice reference — ⚠️ one sample only, see the determinism table',
      Due: 'Value date within the bucket',
      Status: 'Contracted, Expected, Recurring or Forecast',
      'Invoice amount': 'The line amount; a party’s lines sum to its counterparty total',
    },
  },

  'Invoice tail (Other)': {
    grain: 'cell with a tail',
    summary: 'The counterparties beyond the top 10, rolled up as the panel shows them',
    columns: {
      Currency: 'Entity currency',
      Category: 'Customer Receipts or Suppliers',
      Month: 'The cell',
      Counterparties: 'How many parties fell outside the top 10',
      'Other amount': 'Their combined amount',
      'Cell total': 'The cell total being reconciled to',
    },
  },

  Scenarios: {
    grain: 'scenario',
    summary: 'The chart overlays and what each one does to the baseline',
    columns: {
      Id: 'Internal key',
      Code: 'Short code, e.g. BASE, UP10, VOL5, DN3',
      Name: 'Label in the Compare dropdown',
      'Colour token': 'CSS variable used for its line',
      Description: 'What the transform does',
    },
  },

  'Scenario balances': {
    grain: 'day',
    summary: 'Each scenario applied to the GROUP daily closing balance, in the base currency',
    columns: { Date: 'The day' },
    // One money column per scenario, labelled "CODE — Name", so the set changes
    // whenever SCENARIOS does.
    patterns: [
      [/^\w+ — /, 'One column per scenario, applied to the GROUP daily closing balance in the base currency. BASE is the identity — the table’s own numbers'],
    ],
  },

  'Manual shocks': {
    grain: 'field on a shock',
    summary: 'No shocks are seeded — this documents the shape a shock takes',
    columns: {
      Field: 'Field on a shock object',
      Type: 'Its type or allowed values',
      Meaning: 'What it does to the forecast',
    },
  },

  Checks: {
    grain: 'assertion',
    summary: 'Reconciliation results, each with its tolerance and the invariant it protects',
    columns: {
      Check: 'The assertion',
      Got: 'Value computed from the exported data',
      Expected: 'Value it must equal',
      Difference: 'Got less Expected',
      Tolerance: 'Allowed absolute difference, to absorb FX rounding',
      Pass: 'Green *Yes* or red *No*',
      'Why it must hold': 'The invariant being protected',
    },
  },
}

// Resolve a column's description: sheet-specific, then a generated-label pattern,
// then the shared recurring set. Returns null when nothing is documented yet.
export function describeColumn(sheetName, label) {
  const doc = SHEET_DOCS[sheetName]
  if (doc?.columns?.[label]) return doc.columns[label]
  for (const [re, text] of doc?.patterns ?? []) if (re.test(label)) return text
  return COMMON_COLUMNS[label] ?? null
}

export const familyOf = (sheetName) => FAMILIES.find((f) => f.sheets.includes(sheetName)) ?? null
