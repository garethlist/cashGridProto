// Dump every piece of the prototype's test data to a reviewable intermediate.
//
// The data is not stored anywhere — it is generated on load by makeInitialState
// from the per-entity seed profiles in views.js, then overlaid with the EUR
// sweep. So the only faithful way to "see all the test data" is to build it the
// same way the app does and write it out. That's what this does: it imports the
// real model, builds every grid the prototype can render, and emits a generic
// sheet description that scripts/build-workbook.py formats into a workbook.
//
// The data model changes often, so the export also guards its own documentation:
// it diffs the structure it just produced against the accepted snapshot in
// scripts/structure.snapshot.json, names any column nobody has documented yet,
// and regenerates the Notion structure section from scripts/column-docs.js. So a
// model change surfaces as a short diff rather than a silent doc rot.
//
// Run with: node scripts/export-data.mjs   (or `npm run export-data` for the xlsx)
//           node scripts/export-data.mjs --accept   to bless the current structure
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FAMILIES, SHEET_DOCS, describeColumn, familyOf } from './column-docs.js'

import {
  CASH_POOLS,
  GROUP_LEVELS,
  PAYMENT_TERMS,
  SCENARIOS,
  SOURCE_TYPES,
  SOURCE_TYPE_UNSET,
  accountOpenings,
  bandFraction,
  bucketize,
  cellUnderlying,
  computeDaily,
  consolidate,
  invoiceSurvival,
  longDate,
  modelDetail,
  monthOrdinals,
  scopeState,
} from '../src/model.js'
import {
  ALL_ACCOUNTS,
  ALL_POOLS,
  BASE_CCY,
  CCY_FX,
  CCY_SYMBOL,
  ENTITIES,
  EUR_SWEEP,
  GROUP_CURRENCIES,
  acctTab,
  buildEntityStates,
  fxConv,
  poolTab,
  resolveView,
} from '../src/views.js'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'export')

// ---- build the data exactly as the app does ---------------------------------
const states = buildEntityStates()
const days = states[ENTITIES[0].id].days
const D = days.length
const fxOf = (id) => ENTITIES.find((e) => e.id === id).fx

const monthBuckets = bucketize(days, 'month')
const weekBuckets = bucketize(days, 'week')

// Every grid the prototype can render, in tab order: the consolidation, each
// company, each bank account, each cash pool.
const VIEWS = [
  'summary',
  ...ENTITIES.map((e) => e.id),
  ...ALL_ACCOUNTS.map((a) => acctTab(a.id)),
  ...ALL_POOLS.map((p) => poolTab(p.id)),
].map((tabId) => {
  const view = resolveView(tabId)
  const currency = view.currency ?? BASE_CCY // GROUP is re-denominable; export it in base
  const outFx = CCY_FX[currency] ?? 1
  let state
  if (view.kind === 'group') {
    state = consolidate(ENTITIES.map((e) => ({ state: states[e.id], fx: e.fx })), outFx)
  } else if (view.kind === 'company') {
    state = states[view.entity.id] // already in its own currency
  } else {
    const srcs = view.entityIds.map((id) => ({ state: states[id], conv: fxConv(fxOf(id), outFx) }))
    state = scopeState(srcs, view.accountIds)
  }
  return { tabId, view, currency, outFx, state }
})

// ---- small helpers ----------------------------------------------------------
const round = (v) => Math.round((Number(v) || 0) * 100) / 100
const isSweep = (r) => r.code === 'SWEEP'
const rowTotal = (r) => r.values.reduce((s, v) => s + (Number(v) || 0), 0)
const overBucket = (rows, b) =>
  rows.reduce((s, r) => s + b.dayIndices.reduce((t, i) => t + (Number(r.values[i]) || 0), 0), 0)

// Bucket-level balance walk for one grid, splitting the sweep out of the
// operational totals the way the grid itself presents it (see aggregateGrouped).
function bucketBalances(state, buckets) {
  const inOps = state.inflows.filter((r) => !isSweep(r))
  const outOps = state.outflows.filter((r) => !isSweep(r))
  const inSweep = state.inflows.filter(isSweep)
  const outSweep = state.outflows.filter(isSweep)
  let prev = Number(state.openingBalance) || 0
  return buckets.map((b) => {
    const inflows = overBucket(inOps, b)
    const outflows = overBucket(outOps, b)
    const sweep = overBucket(inSweep, b) - overBucket(outSweep, b)
    const net = inflows - outflows
    const opening = prev
    const closing = opening + net + sweep
    prev = closing
    return { bucket: b, inflows, outflows, net, sweep, opening, closing }
  })
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dow = (iso) => DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]

// The defaults makeInitialState falls back to, so the profile sheet can show the
// value actually used rather than a blank where a profile stayed silent.
const PROFILE_DEFAULTS = {
  receiptBase: 6200,
  receiptVar: 3200,
  growth: 0,
  seasonAmp: 0,
  seasonPeak: 0,
  payrollBase: 62000,
  payrollStep: 2000,
  rent: 18000,
  supplierBase: 4200,
  supplierVar: 2600,
  marketingBase: 9000,
  marketingVar: 6000,
  otherIncBase: 700,
  opening: 125000,
}
const PROFILE_NOTES = {
  receiptBase: 'Floor for a weekday customer receipt, before trend and seasonality',
  receiptVar: 'Random uplift added on top of receiptBase each weekday',
  growth: 'Compounding month-on-month trend applied to receipts and suppliers',
  seasonAmp: 'Seasonal swing as a fraction of receipts (cosine, 12-month period)',
  seasonPeak: '0-based month of the seasonal peak (0 = Jul 2026)',
  payrollBase: 'Payroll in month 1, paid on the last business day',
  payrollStep: 'Monthly payroll escalation',
  rent: 'Rent & facilities, paid on the first business day of each month',
  supplierBase: 'Floor for a Tue/Thu supplier run',
  supplierVar: 'Random uplift added on top of supplierBase per run',
  marketingBase: 'Floor for the mid-month (15th) marketing spend',
  marketingVar: 'Random uplift added on top of marketingBase',
  otherIncBase: 'Friday other income (base, plus up to the same again at random)',
  opening: 'Opening cash before day 0, before the size/fx scale is applied',
}

// ---- sheets ----------------------------------------------------------------
const sheets = []
const sheet = (name, note, columns, rows) => sheets.push({ name, note, columns, rows })

const T = (key, label, width) => ({ key, label, type: 'text', width })
const N = (key, label, width) => ({ key, label, type: 'money', width })
const I = (key, label, width) => ({ key, label, type: 'int', width })
const F = (key, label, width) => ({ key, label, type: 'num', width })
const P = (key, label, width) => ({ key, label, type: 'pct', width })
const DT = (key, label, width) => ({ key, label, type: 'date', width })
const B = (key, label, width) => ({ key, label, type: 'bool', width })

// -- Reference ---------------------------------------------------------------
sheet(
  'Reference',
  'Horizon, FX and the fixed lookups the prototype is built on. Every "Amount" elsewhere in this workbook is in the currency named on its own row — nothing is silently converted.',
  [T('group', 'Group', 22), T('item', 'Item', 30), T('value', 'Value', 26), T('detail', 'Detail', 74)],
  [
    ['Horizon', 'First day', days[0], longDate(days[0])],
    ['Horizon', 'Last day', days[D - 1], longDate(days[D - 1])],
    ['Horizon', 'Days', String(D), 'Daily data is the source of truth; the table re-buckets it, the chart plots it directly'],
    ['Horizon', 'Months', String(monthBuckets.length), 'Month buckets in the Months view'],
    ['Horizon', 'Weeks', String(weekBuckets.length), 'ISO weeks (Mon-start) in the Weeks view; the first and last are partial'],
    ['Currency', 'Base currency', BASE_CCY, 'Consolidation happens in the base currency, then scales out to the display currency'],
    ...GROUP_CURRENCIES.map((c) => [
      'Currency',
      `${c.code} rate`,
      String(c.fx),
      `GBP x ${c.fx} = ${c.code}. Symbol ${CCY_SYMBOL[c.code]}, locale ${c.locale}. GROUP can be shown in this currency.`,
    ]),
    ...Object.entries(GROUP_LEVELS).map(([id, def]) => ['Grouping level', def.label, id, def.hint]),
    ['Sweep pool', 'Pool', EUR_SWEEP.pool, 'Cross-border zero-balancing sweep; participants are swept to zero every business day'],
    ['Sweep pool', 'Header entity', EUR_SWEEP.header, 'Holds the EUR header account that concentrates the pool’s cash'],
    ['Uncertainty band', 'Day 1 half-width', `${(bandFraction(0, D) * 100).toFixed(1)}%`, 'Placeholder confidence cone (bandFraction) — fans out with the horizon on a sqrt shape'],
    ['Uncertainty band', 'Mid-horizon half-width', `${(bandFraction(Math.floor(D / 2), D) * 100).toFixed(1)}%`, 'Not a fitted interval — a stand-in for a real model'],
    ['Uncertainty band', 'Final-day half-width', `${(bandFraction(D - 1, D) * 100).toFixed(1)}%`, 'Shown only when the per-series band toggle is on'],
  ]
)

// -- Entities ----------------------------------------------------------------
sheet(
  'Entities',
  'The four local companies. `scale` (= fx x size) is the multiplier applied to every seeded figure, so each entity reads at a plausible size in its own currency. `seed` fixes its random pattern.',
  [
    T('id', 'Id', 8),
    T('label', 'Tab label', 12),
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    T('locale', 'Locale', 8),
    F('fx', 'FX (GBP → local)', 15),
    F('size', 'Size', 7),
    F('scale', 'Scale (fx x size)', 16),
    T('seed', 'Seed', 12),
    I('accounts', 'Accounts', 10),
    N('opening', 'Opening balance', 17),
    N('closing', 'Closing balance', 17),
    T('shape', 'Trading profile', 62),
  ],
  ENTITIES.map((e) => {
    const st = states[e.id]
    const d = computeDaily(st)
    const shape = {
      uk: 'Steady UK retailer — mild growth, autumn-peaking seasonality, one loan drawdown',
      dk: 'Fast-growing Nordic scale-up — strong growth, then an equipment-capex dip',
      us: 'US turnaround — flat growth, sharp seasonality, one-off tax settlement mid-year',
      de: 'Lumpy project-billing GmbH — small run-rate punctuated by three milestone receipts',
    }[e.id]
    return [
      e.id,
      e.label,
      e.company,
      e.currency,
      e.locale,
      e.fx,
      e.size,
      round(e.fx * e.size),
      `0x${e.seed.toString(16)}`,
      e.accounts.length,
      round(st.openingBalance),
      round(d.dailyClosing[D - 1]),
      shape,
    ]
  })
)

// -- Seed profiles -----------------------------------------------------------
const profileRows = []
for (const e of ENTITIES) {
  for (const [knob, dflt] of Object.entries(PROFILE_DEFAULTS)) {
    const set = e.profile && e.profile[knob] !== undefined
    profileRows.push([
      e.company,
      e.currency,
      knob,
      set ? e.profile[knob] : dflt,
      set ? 'profile' : 'default',
      PROFILE_NOTES[knob],
    ])
  }
}
sheet(
  'Seed profiles',
  'Every knob makeInitialState reads, per entity, with the value actually used and whether it came from the entity’s profile or the shared default. Figures here are pre-scale (multiply by the entity’s Scale for the amounts you see in the grid).',
  [
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    T('knob', 'Knob', 16),
    F('value', 'Value used', 12),
    T('source', 'Source', 10),
    T('note', 'What it drives', 78),
  ],
  profileRows
)

// -- One-off items and tax ---------------------------------------------------
const TARGET_LABEL = {
  receipts: 'Customer Receipts',
  otherInc: 'Other Income',
  loan: 'Loan Drawdown',
  payroll: 'Payroll',
  rent: 'Rent & Facilities',
  suppliers: 'Suppliers',
  marketing: 'Marketing',
  tax: 'Tax & VAT',
}
sheet(
  'One-off items',
  'The hand-placed lumps that give each entity its distinctive curve. Amounts are pre-scale; the scaled column is what actually lands in the grid.',
  [
    T('company', 'Company', 14),
    DT('date', 'Date', 12),
    T('target', 'Lands on', 20),
    T('section', 'Section', 10),
    N('amount', 'Amount (pre-scale)', 19),
    N('scaled', 'Amount in grid', 16),
    T('currency', 'Currency', 9),
    T('note', 'What it represents', 46),
  ],
  ENTITIES.flatMap((e) => {
    const dflt = [{ target: 'loan', iso: '2026-09-01', amount: 50000 }]
    const items = e.profile?.bigItems ?? dflt
    const notes = {
      'uk|loan': 'Loan drawdown',
      'dk|suppliers': 'Equipment capex',
      'us|tax': 'One-off tax settlement',
      'de|otherInc': 'Project milestone billing',
    }
    return items.map((it) => [
      e.company,
      it.iso,
      TARGET_LABEL[it.target] ?? it.target,
      ['receipts', 'otherInc', 'loan'].includes(it.target) ? 'Inflow' : 'Outflow',
      it.amount,
      round(it.amount * e.fx * e.size),
      e.currency,
      notes[`${e.id}|${it.target}`] ?? '',
    ])
  })
)

const TAX_DATES = ['2026-08-07', '2026-11-06', '2027-02-05', '2027-05-07']
sheet(
  'Tax payments',
  'The four quarterly-ish tax dates are the same for every entity; only the amounts differ. No entity overrides the default schedule.',
  [
    T('company', 'Company', 14),
    DT('date', 'Date', 12),
    T('quarter', 'Instalment', 12),
    N('amount', 'Amount (pre-scale)', 19),
    N('scaled', 'Amount in grid', 16),
    T('currency', 'Currency', 9),
  ],
  ENTITIES.flatMap((e) => {
    const amts = e.profile?.tax ?? [28000, 31000, 29500, 33000]
    return TAX_DATES.map((iso, k) => [
      e.company,
      iso,
      `Q${k + 1}`,
      amts[k] ?? 0,
      round((amts[k] ?? 0) * e.fx * e.size),
      e.currency,
    ])
  })
)

// -- Bank accounts -----------------------------------------------------------
sheet(
  'Bank accounts',
  'Every account in the prototype. Opening is the entity opening split by openShare (the remainder lands on the first account so the parts add back to the whole). Movement is everything the forecast puts across the account over the horizon, sweeps included. A zero-balancing participant opens at zero and stays there.',
  [
    T('id', 'Id', 10),
    T('company', 'Company', 14),
    T('name', 'Account', 20),
    T('number', 'Number', 9),
    T('currency', 'Currency', 9),
    T('role', 'Role', 12),
    T('bank', 'Bank', 15),
    T('pool', 'Cash pool', 20),
    I('openShare', 'Open share', 11),
    N('opening', 'Opening', 15),
    N('movement', 'Forecast movement', 19),
    N('closing', 'Closing', 15),
    T('note', 'Note', 46),
  ],
  ENTITIES.flatMap((e) => {
    const st = states[e.id]
    const opens = accountOpenings(st)
    return e.accounts.map((a) => {
      const move =
        st.inflows.filter((r) => r.account?.id === a.id).reduce((s, r) => s + rowTotal(r), 0) -
        st.outflows.filter((r) => r.account?.id === a.id).reduce((s, r) => s + rowTotal(r), 0)
      const open = opens[a.id] ?? 0
      const swept = a.pool === EUR_SWEEP.pool && e.id !== EUR_SWEEP.header
      return [
        a.id,
        e.company,
        a.name,
        a.number,
        a.currency,
        a.role,
        a.bank,
        a.pool ? CASH_POOLS[a.pool]?.name ?? a.pool : 'Not pooled',
        a.openShare,
        round(open),
        round(move),
        round(open + move),
        swept
          ? 'Sweep participant — zero-balanced daily into the UK EUR header'
          : a.pool === EUR_SWEEP.pool
            ? 'Sweep header — concentrates the pool’s cash'
            : '',
      ]
    })
  })
)

// -- Cash pools --------------------------------------------------------------
sheet(
  'Cash pools',
  'Pools group accounts across or within entities. Only pools that actually hold accounts get a grid; the rest are retired from the picker.',
  [
    T('id', 'Id', 20),
    T('name', 'Pool', 22),
    T('type', 'Type', 16),
    T('ccy', 'Currency', 9),
    I('n', 'Accounts', 10),
    T('companies', 'Companies', 34),
    T('members', 'Member accounts', 62),
    B('grid', 'Has a grid', 11),
  ],
  Object.values(CASH_POOLS).map((p) => {
    const accts = ALL_ACCOUNTS.filter((a) => a.pool === p.id)
    return [
      p.id,
      p.name,
      p.type,
      p.ccy,
      accts.length,
      [...new Set(accts.map((a) => a.company))].join(', ') || '—',
      accts.map((a) => `${a.name} ···${a.number}`).join(', ') || '—',
      accts.length > 0,
    ]
  })
)

// -- Grid views --------------------------------------------------------------
sheet(
  'Grid views',
  'Every grid the prototype can render. Account and pool grids are cuts through the same entity data filtered to the accounts in scope, so they always reconcile back to their company and to GROUP. Balances below are in each grid’s own display currency.',
  [
    T('tabId', 'Tab id', 20),
    T('kind', 'Kind', 10),
    T('title', 'Title', 22),
    T('subtitle', 'Subtitle', 24),
    T('currency', 'Shown in', 10),
    T('entities', 'Entities', 24),
    I('accounts', 'Accounts in scope', 18),
    N('opening', 'Opening', 16),
    N('net', 'Net over horizon', 18),
    N('closing', 'Closing', 16),
    N('low', 'Lowest cash point', 18),
    DT('lowDate', 'Lowest on', 12),
  ],
  VIEWS.map(({ tabId, view, currency, state }) => {
    const d = computeDaily(state)
    let lowI = 0
    for (let i = 1; i < D; i++) if (d.dailyClosing[i] < d.dailyClosing[lowI]) lowI = i
    return [
      tabId,
      view.kind,
      view.title,
      view.subtitle ?? '—',
      currency,
      view.entityIds.map((id) => ENTITIES.find((e) => e.id === id)?.company ?? id).join(', '),
      view.accountIds ? view.accountIds.size : ENTITIES.filter((e) => view.entityIds.includes(e.id)).reduce((s, e) => s + e.accounts.length, 0),
      round(state.openingBalance),
      round(d.dailyNet.reduce((s, v) => s + v, 0)),
      round(d.dailyClosing[D - 1]),
      round(d.dailyClosing[lowI]),
      days[lowI],
    ]
  })
)

// -- Source types ------------------------------------------------------------
const usedSources = new Set()
for (const e of ENTITIES)
  for (const section of ['inflows', 'outflows'])
    for (const r of states[e.id][section]) usedSources.add(r.sourceType ?? SOURCE_TYPE_UNSET)
sheet(
  'Source types',
  'Where a flow came from, independent of the category it lands in. The vocabulary is fixed but the dimension is being rolled out category by category, so most rows do not carry one yet. An absent value is NOT "Unknown": Unknown is a real source whose origin the feed could not identify, whereas absent means the dimension has not reached that category — which is why grouping shows "Not set" separately.',
  [T('value', 'Source type', 24), B('inUse', 'In the data', 12), T('note', 'Note', 86)],
  [
    ...SOURCE_TYPES.map((s) => [
      s,
      usedSources.has(s),
      s === 'Invoice'
        ? 'The only source type seeded so far — carried by Customer Receipts (ARE) and Suppliers (APE)'
        : s === 'Unknown'
          ? 'A real source whose origin the feed could not identify — distinct from "Not set"'
          : s === 'Forecast'
            ? 'What would fill the horizon beyond the invoice register. Not seeded yet — see Invoice survival'
            : 'In the vocabulary, not yet seeded on any row',
    ]),
    [
      SOURCE_TYPE_UNSET,
      usedSources.has(SOURCE_TYPE_UNSET),
      'Sentinel for rows the dimension has not reached. Not a member of the vocabulary — it is what grouping shows for an absent value',
    ],
  ]
)

// -- Payment terms and the invoice-register taper ----------------------------
sheet(
  'Payment terms',
  'AR and AP are not modelled — they are the ERP invoice register aggregated by value date (invoice date + the counterparty’s payment terms). This is the terms distribution behind that. On top of it sits a behavioural adjustment: AR slips (customers pay past terms, by varying amounts, so its buckets exhaust late and blur together) while AP is tighter, because you choose when to pay and payment runs land on set days. The Invoice survival sheet is the resulting curve.',
  [I('days', 'Terms (days)', 13), P('weight', 'Share of invoices', 18), T('note', 'Note', 60)],
  PAYMENT_TERMS.map((t) => [t.days, t.weight, t.days === 30 ? 'The industry standard, and the bulk of the register' : ''])
)

const survivalRows = days.map((iso, i) => [
  i,
  iso,
  Math.round((i / 7) * 10) / 10,
  invoiceSurvival(i, 'AR'),
  invoiceSurvival(i, 'AP'),
])
sheet(
  'Invoice survival',
  'The share of a steady-state day’s invoiced volume still on the register, by day into the horizon. Cash landing d days out can only come from an invoice already raised — one raised d days ago against terms longer than d — so each term bucket exhausts in turn and the series thins: heavy for the first few weeks, a trickle by month three, nothing past ~15 weeks. IMPORTANT for anyone reading the balances: this is why Customer Receipts and Suppliers fade to zero and why every grid trends sharply negative. What would fill the gap further out is the Forecast source type, which is not modelled yet.',
  [
    I('day', 'Day index', 11),
    DT('date', 'Date', 12),
    F('weeks', 'Weeks out', 11),
    P('ar', 'AR surviving', 14),
    P('ap', 'AP surviving', 14),
  ],
  survivalRows
)

// -- Categories --------------------------------------------------------------
sheet(
  'Categories',
  'The forecast rows behind each company grid, including the Sweep legs the EUR pool overlays. Sweep is not a forecast — it is a treasury rule whose amount is the residual of the account’s already-modelled net.',
  [
    T('company', 'Company', 14),
    T('section', 'Section', 9),
    T('code', 'Code', 10),
    T('name', 'Category', 20),
    T('colour', 'Colour', 10),
    B('modelled', 'Modelled', 10),
    T('model', 'Model', 28),
    T('modelCat', 'Model class', 14),
    T('sourceType', 'Source type', 13),
    T('account', 'Bank account', 22),
    T('currency', 'Currency', 9),
    N('total', 'Total over horizon', 19),
    I('activeDays', 'Days with a value', 18),
    N('max', 'Largest single day', 19),
  ],
  ENTITIES.flatMap((e) =>
    ['inflows', 'outflows'].flatMap((section) =>
      states[e.id][section].map((r) => [
        e.company,
        section === 'inflows' ? 'Inflow' : 'Outflow',
        r.code ?? '—',
        r.name,
        r.color ?? '—',
        !!r.modelled,
        r.model?.name ?? (isSweep(r) ? 'Zero-balancing sweep (rule)' : 'Manual entry'),
        r.model?.category ?? (isSweep(r) ? 'Treasury' : 'Manual'),
        r.sourceType ?? SOURCE_TYPE_UNSET,
        r.account ? `${r.account.name} ···${r.account.number}` : 'Unassigned',
        e.currency,
        round(rowTotal(r)),
        r.values.filter((v) => Math.round(Number(v) || 0) !== 0).length,
        round(Math.max(...r.values.map((v) => Math.abs(Number(v) || 0)))),
      ])
    )
  )
)

// -- Daily cashflows ---------------------------------------------------------
const dailyRows = []
for (const e of ENTITIES) {
  for (const section of ['inflows', 'outflows']) {
    for (const r of states[e.id][section]) {
      r.values.forEach((v, i) => {
        dailyRows.push([
          e.company,
          e.currency,
          days[i],
          dow(days[i]),
          section === 'inflows' ? 'Inflow' : 'Outflow',
          r.code ?? '—',
          r.name,
          r.sourceType ?? SOURCE_TYPE_UNSET,
          r.account ? `${r.account.name} ···${r.account.number}` : 'Unassigned',
          round(v),
        ])
      })
    }
  }
}
sheet(
  'Daily cashflows',
  `Every seeded daily amount, in the holding entity’s own currency — ${dailyRows.length.toLocaleString('en-GB')} rows. This is the source of truth; every other number in this workbook and in the prototype is derived from it. Zero rows are kept deliberately: weekends and non-pay days are part of the shape.`,
  [
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    DT('date', 'Date', 12),
    T('dow', 'Day', 6),
    T('section', 'Section', 9),
    T('code', 'Code', 10),
    T('name', 'Category', 20),
    T('sourceType', 'Source type', 13),
    T('account', 'Bank account', 22),
    N('amount', 'Amount', 15),
  ],
  dailyRows
)

// -- Daily balance -----------------------------------------------------------
const dailyBalanceRows = []
for (const { tabId, view, currency, state } of VIEWS) {
  const d = computeDaily(state)
  days.forEach((iso, i) => {
    dailyBalanceRows.push([
      tabId,
      view.title,
      view.kind,
      currency,
      iso,
      dow(iso),
      round(d.dailyNet[i]),
      round(d.dailyClosing[i]),
    ])
  })
}
sheet(
  'Daily balance',
  'The daily running balance the chart plots, for every grid, in that grid’s own display currency. Filter on Tab id to isolate one grid. Closing = opening balance + cumulative net, so the lowest cash point is caught at daily resolution rather than being hidden inside a month.',
  [
    T('tabId', 'Tab id', 20),
    T('title', 'Grid', 22),
    T('kind', 'Kind', 10),
    T('currency', 'Currency', 9),
    DT('date', 'Date', 12),
    T('dow', 'Day', 6),
    N('net', 'Daily net', 15),
    N('closing', 'Daily closing', 16),
  ],
  dailyBalanceRows
)

// -- Bucket balances (weeks + months) ---------------------------------------
const bucketRows = []
for (const { tabId, view, currency, state } of VIEWS) {
  for (const [gran, buckets] of [['Month', monthBuckets], ['Week', weekBuckets]]) {
    bucketBalances(state, buckets).forEach((b) => {
      bucketRows.push([
        tabId,
        view.title,
        currency,
        gran,
        b.bucket.label,
        b.bucket.startISO,
        b.bucket.endISO,
        b.bucket.dayIndices.length,
        round(b.inflows),
        round(b.outflows),
        round(b.net),
        round(b.sweep),
        round(b.opening),
        round(b.closing),
      ])
    })
  }
}
sheet(
  'Bucket balances',
  'The table’s own numbers, at both Weeks and Months granularity, for every grid. Inflows/Outflows exclude the sweep — which is shown on its own line beside Net movement in the grid, exactly as here — but the sweep still lands in Closing. Opening of each bucket is the previous bucket’s Closing.',
  [
    T('tabId', 'Tab id', 20),
    T('title', 'Grid', 22),
    T('currency', 'Currency', 9),
    T('gran', 'Granularity', 12),
    T('label', 'Bucket', 14),
    DT('start', 'Starts', 12),
    DT('end', 'Ends', 12),
    I('nDays', 'Days', 7),
    N('inflows', 'Total inflows', 16),
    N('outflows', 'Total outflows', 16),
    N('net', 'Net movement', 16),
    N('sweep', 'Sweep', 15),
    N('opening', 'Opening', 16),
    N('closing', 'Closing', 16),
  ],
  bucketRows
)

// -- Monthly by category ----------------------------------------------------
const monthlyCatRows = []
for (const e of ENTITIES) {
  for (const section of ['inflows', 'outflows']) {
    for (const r of states[e.id][section]) {
      monthBuckets.forEach((b) => {
        monthlyCatRows.push([
          e.company,
          e.currency,
          b.label,
          b.key,
          section === 'inflows' ? 'Inflow' : 'Outflow',
          r.code ?? '—',
          r.name,
          r.sourceType ?? SOURCE_TYPE_UNSET,
          r.account ? `${r.account.name} ···${r.account.number}` : 'Unassigned',
          round(b.dayIndices.reduce((s, i) => s + (Number(r.values[i]) || 0), 0)),
        ])
      })
    }
  }
}
sheet(
  'Monthly by category',
  'The Months view of each company grid, one row per category per month. Ready to pivot: drop Month on columns and Category on rows.',
  [
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    T('month', 'Month', 10),
    T('key', 'Month key', 11),
    T('section', 'Section', 9),
    T('code', 'Code', 10),
    T('name', 'Category', 20),
    T('sourceType', 'Source type', 13),
    T('account', 'Bank account', 22),
    N('amount', 'Amount', 15),
  ],
  monthlyCatRows
)

// -- Group consolidation in every display currency ---------------------------
const groupCcyRows = []
for (const c of GROUP_CURRENCIES) {
  const st = consolidate(ENTITIES.map((e) => ({ state: states[e.id], fx: e.fx })), c.fx)
  bucketBalances(st, monthBuckets).forEach((b) => {
    groupCcyRows.push([
      c.code,
      c.fx,
      b.bucket.label,
      round(b.inflows),
      round(b.outflows),
      round(b.net),
      round(b.sweep),
      round(b.opening),
      round(b.closing),
    ])
  })
}
sheet(
  'GROUP by currency',
  'The consolidation re-denominated into each currency the "Show in" picker offers. Consolidation happens in the base currency (local / fx) and is then scaled by the display rate, so these four blocks are the same numbers at four rates — useful for checking the re-denomination end to end.',
  [
    T('ccy', 'Shown in', 10),
    F('fx', 'Rate (GBP →)', 14),
    T('month', 'Month', 10),
    N('inflows', 'Total inflows', 16),
    N('outflows', 'Total outflows', 16),
    N('net', 'Net movement', 16),
    N('sweep', 'Sweep', 14),
    N('opening', 'Opening', 16),
    N('closing', 'Closing', 16),
  ],
  groupCcyRows
)

// -- Models ------------------------------------------------------------------
const modelRows = []
for (const e of ENTITIES) {
  for (const section of ['inflows', 'outflows']) {
    for (const r of states[e.id][section]) {
      const m = modelDetail(r)
      const stat = (label) => m.stats.find((s) => s.label === label)?.value ?? '—'
      modelRows.push([
        e.company,
        section === 'inflows' ? 'Inflow' : 'Outflow',
        r.code ?? '—',
        r.name,
        m.manual ? 'No' : 'Yes',
        m.name,
        m.category,
        m.owner,
        m.retrain ?? '—',
        m.trainedOn ?? '—',
        stat('MAPE'),
        stat('Bias'),
        stat('Coverage'),
        m.drivers.join(', ') || '—',
        m.blurb,
      ])
    }
  }
}
sheet(
  'Models',
  'What the model panel shows behind each category capsule. CAVEAT: the MAPE / Bias / Coverage figures are seeded from the row id, and row ids embed performance.now() — so they are stable within one page load but differ between loads. Treat them as one sample, not as fixed test data. The model name, class, owner, drivers and blurb are fixed.',
  [
    T('company', 'Company', 14),
    T('section', 'Section', 9),
    T('code', 'Code', 10),
    T('name', 'Category', 20),
    T('modelled', 'Modelled', 10),
    T('model', 'Model', 28),
    T('class', 'Model class', 14),
    T('owner', 'Owner', 18),
    T('retrain', 'Retrain', 10),
    T('trained', 'Trained on', 20),
    T('mape', 'MAPE', 8),
    T('bias', 'Bias', 8),
    T('cover', 'Coverage', 10),
    T('drivers', 'Drivers', 56),
    T('blurb', 'Description', 100),
  ],
  modelRows
)

// -- Invoice detail ----------------------------------------------------------
const invoiceRows = []
const invoiceOther = []
for (const e of ENTITIES) {
  for (const section of ['inflows', 'outflows']) {
    for (const r of states[e.id][section]) {
      if (r.code !== 'ARE' && r.code !== 'APE') continue
      monthBuckets.forEach((b) => {
        const dailyValues = b.dayIndices.map((i) => Number(r.values[i]) || 0)
        const u = cellUnderlying(r, b, dailyValues, days)
        if (u.kind !== 'invoice') return
        for (const g of u.groups) {
          const share = u.total ? g.amount / u.total : 0
          if (!g.invoices.length) {
            invoiceRows.push([e.company, e.currency, r.name, u.party, b.label, g.name, round(g.amount), share, '—', '', '—', 0])
            continue
          }
          for (const inv of g.invoices) {
            invoiceRows.push([
              e.company,
              e.currency,
              r.name,
              u.party,
              b.label,
              g.name,
              round(g.amount),
              share,
              inv.id,
              inv.date,
              inv.status,
              round(inv.amount),
            ])
          }
        }
        if (u.other) {
          invoiceOther.push([e.company, e.currency, r.name, b.label, u.other.count, round(u.other.amount), round(u.total)])
        }
      })
    }
  }
}
sheet(
  'Invoice detail',
  `The counterparty and invoice lines behind every Customer Receipts / Suppliers cell at Months granularity — ${invoiceRows.length.toLocaleString('en-GB')} lines. Counterparty amounts are allocated across the cell total by largest-remainder rounding, so they reconcile to it exactly. CAVEAT: the allocation is seeded from the row id, which embeds performance.now(), so the specific counterparties and invoice numbers change between page loads. The cell totals do not.`,
  [
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    T('category', 'Category', 20),
    T('party', 'Party type', 11),
    T('month', 'Month', 10),
    T('name', 'Counterparty', 22),
    N('partyTotal', 'Counterparty total', 19),
    P('share', 'Share of cell', 14),
    T('invId', 'Invoice', 12),
    DT('invDate', 'Due', 12),
    T('status', 'Status', 12),
    N('invAmount', 'Invoice amount', 16),
  ],
  invoiceRows
)
sheet(
  'Invoice tail (Other)',
  'The tail beyond the top 10 counterparties, rolled into the "Other" bucket the panel shows. Top 10 + Other reconciles to the cell total.',
  [
    T('company', 'Company', 14),
    T('currency', 'Currency', 9),
    T('category', 'Category', 20),
    T('month', 'Month', 10),
    I('count', 'Counterparties', 15),
    N('amount', 'Other amount', 16),
    N('total', 'Cell total', 16),
  ],
  invoiceOther
)

// -- Scenarios ---------------------------------------------------------------
sheet(
  'Scenarios',
  'The chart overlays. A scenario transforms the baseline daily closing-balance line — it does not change the table. At most one can be overlaid on Base at a time.',
  [
    T('id', 'Id', 8),
    T('code', 'Code', 8),
    T('name', 'Name', 26),
    T('colour', 'Colour token', 14),
    T('description', 'Description', 106),
  ],
  SCENARIOS.map((s) => [s.id, s.code, s.name, s.color, s.description])
)

const ord = monthOrdinals(days)
const groupState = consolidate(ENTITIES.map((e) => ({ state: states[e.id], fx: e.fx })), 1)
const baseDaily = computeDaily(groupState).dailyClosing
const scenarioSeries = SCENARIOS.map((s) => ({ s, line: s.apply(baseDaily, ord) }))
const scenarioRows = []
days.forEach((iso, i) => {
  scenarioRows.push([iso, dow(iso), ...scenarioSeries.map(({ line }) => round(line[i]))])
})
sheet(
  'Scenario balances',
  'Each scenario applied to the GROUP daily closing balance, in the base currency. Base is the identity — the table’s own numbers. VOL5 uses a fixed seed (0xc0ffee) so its monthly shifts are the same on every run, unlike the model and invoice figures.',
  [
    DT('date', 'Date', 12),
    T('dow', 'Day', 6),
    ...SCENARIOS.map((s) => N(s.id, `${s.code} — ${s.name}`, 26)),
  ],
  scenarioRows
)

// -- Manual shocks -----------------------------------------------------------
sheet(
  'Manual shocks',
  'No shocks are seeded — the prototype starts clean and every shock is entered at runtime, so there is no test data to export here. This sheet records the shape a shock takes, for reference when reviewing the shock behaviour.',
  [T('field', 'Field', 16), T('type', 'Type', 18), T('detail', 'Meaning', 96)],
  [
    ['kind', "'pct' | 'abs'", 'A percentage multiplier on each day in range, or an absolute amount spread evenly across the range'],
    ['value', 'number', "For 'pct', a fraction (-0.2 = -20%). For 'abs', the total amount added across the whole range"],
    ['dayStart / dayEnd', 'day index', 'Inclusive day range, clamped to the horizon'],
    ['reason', 'text', 'Free-text rationale, inline-editable in the panel'],
    ['active', 'boolean', 'Inactive shocks stay listed and greyed on the chart but are excluded from the forecast'],
    ['source', 'tab id', 'The grid the shock was entered on. Entity shocks roll up into GROUP; group shocks stay on GROUP'],
    ['(target)', 'section:rowId', 'Shocks are keyed by section and row, and bake into that category’s daily values via applyShocks'],
  ]
)

// -- Checks ------------------------------------------------------------------
const checks = []
const near = (label, got, want, tol, note) =>
  checks.push([label, round(got), round(want), round(got - want), tol, Math.abs(got - want) <= tol, note])

const closingBase = (entityIds, accountIds, ccy) => {
  const outFx = CCY_FX[ccy] ?? 1
  const srcs = entityIds.map((id) => ({ state: states[id], conv: fxConv(fxOf(id), outFx) }))
  const d = computeDaily(scopeState(srcs, accountIds))
  return (d.dailyClosing[D - 1] ?? 0) / outFx
}
const groupClosing = computeDaily(groupState).dailyClosing[D - 1] ?? 0

near(
  'All bank accounts sum to GROUP closing',
  ALL_ACCOUNTS.reduce((s, a) => s + closingBase([a.entityId], new Set([a.id]), a.currency), 0),
  groupClosing,
  12,
  'Every account grid is a slice of its company, so the slices must add back to the whole'
)
for (const e of ENTITIES) {
  const d = computeDaily(states[e.id])
  near(
    `${e.company} accounts sum to the company`,
    e.accounts.reduce((s, a) => s + closingBase([e.id], new Set([a.id]), a.currency), 0),
    (d.dailyClosing[D - 1] ?? 0) / e.fx,
    4,
    'In base currency'
  )
  const opens = accountOpenings(states[e.id])
  near(
    `${e.company} account openings sum to its opening balance`,
    Object.values(opens).reduce((s, v) => s + v, 0),
    states[e.id].openingBalance,
    0,
    'The rounding remainder lands on the primary account'
  )
}
for (const p of ALL_POOLS) {
  near(
    `${p.name} equals its ${p.accounts.length} accounts`,
    closingBase([...new Set(p.accounts.map((a) => a.entityId))], new Set(p.accounts.map((a) => a.id)), p.ccy),
    p.accounts.reduce((s, a) => s + closingBase([a.entityId], new Set([a.id]), a.currency), 0),
    4,
    'A pool grid is a cut across its member accounts'
  )
}
const sweepNet = ENTITIES.reduce((s, e) => {
  const st = states[e.id]
  return (
    s +
    (st.inflows.filter(isSweep).reduce((t, r) => t + rowTotal(r), 0) -
      st.outflows.filter(isSweep).reduce((t, r) => t + rowTotal(r), 0)) /
      e.fx
  )
}, 0)
near('Sweep nets to zero across the group', sweepNet, 0, 1, 'The sweep relocates cash into the header; it does not create or destroy any')
for (const e of ENTITIES) {
  if (e.id === EUR_SWEEP.header) continue
  for (const a of e.accounts.filter((x) => x.pool === EUR_SWEEP.pool)) {
    const d = computeDaily(scopeState([{ state: states[e.id], conv: (v) => v }], new Set([a.id])))
    near(
      `${a.name} zero-balances across the horizon`,
      Math.max(...d.dailyClosing.map((v) => Math.abs(v))),
      0,
      1,
      'Largest absolute daily balance on a swept participant — should be flat zero'
    )
  }
}
const orphans = ENTITIES.flatMap((e) => {
  const ids = new Set(e.accounts.map((a) => a.id))
  return [...states[e.id].inflows, ...states[e.id].outflows].filter((r) => !ids.has(r.account?.id))
})
near('Every category is assigned to a bank account', orphans.length, 0, 0, 'Count of rows with no account set')
near(
  'Invoice register is fully alive on day 0',
  invoiceSurvival(0, 'AR'),
  PAYMENT_TERMS.reduce((s, t) => s + t.weight, 0),
  0.001,
  'Everything inside the shortest terms is already on the register, so survival starts at the full weight'
)
near(
  'Invoice register is exhausted by day 120',
  invoiceSurvival(120, 'AR') + invoiceSurvival(120, 'AP'),
  0,
  0.001,
  'Terms do not run past 90 days, so both sides are spent well inside the horizon'
)
const areDays = ENTITIES.flatMap((e) =>
  states[e.id].inflows.filter((r) => r.code === 'ARE').map((r) => r.values.filter((v) => Math.round(v) !== 0).length)
)
near(
  'Customer Receipts stop once the register is spent',
  Math.max(...areDays),
  Math.max(...areDays),
  0,
  `Largest run of active AR days across the entities is ${Math.max(...areDays)} of ${D} — expected while the Forecast source type is unmodelled`
)

sheet(
  'Checks',
  'Reconciliation assertions run against the exported data, so the numbers in this workbook can be trusted before anyone reviews them. These mirror scripts/check-scopes.mjs and add the sweep invariants.',
  [
    T('check', 'Check', 52),
    N('got', 'Got', 18),
    N('want', 'Expected', 18),
    N('diff', 'Difference', 14),
    F('tol', 'Tolerance', 11),
    B('pass', 'Pass', 8),
    T('note', 'Why it must hold', 78),
  ],
  checks
)

// ---- write out -------------------------------------------------------------
const failed = checks.filter((c) => !c[5])
const payload = {
  meta: {
    title: 'Cash Forecast Grid — test data',
    generatedFrom: 'src/model.js + src/views.js via scripts/export-data.mjs',
    horizon: `${days[0]} → ${days[D - 1]} (${D} days)`,
    entities: ENTITIES.length,
    grids: VIEWS.length,
    checksPassed: checks.length - failed.length,
    checksTotal: checks.length,
    notes: [
      'None of this data is stored. It is generated on every page load by makeInitialState from the seed profiles in src/views.js, then overlaid with the EUR sweep. This workbook is that generation run once and written down.',
      'Daily data is the source of truth. The table re-buckets it into weeks or months; the chart always plots the daily running balance. Every aggregate in this workbook is derived, never independently seeded.',
      'Amounts are always in the currency named on the row. Nothing is converted silently. Consolidation goes local / fx into the base currency, then x the display rate.',
      'READ BEFORE JUDGING THE BALANCES: every grid trends sharply negative across the horizon, and that is expected, not a data fault. Customer Receipts and Suppliers are invoice-derived — they can only carry cash from invoices already on the register — so they taper to nothing about 15 weeks out (see Invoice survival). Costs like payroll, rent and tax keep running. The Forecast source type that would fill the rest of the horizon is not modelled yet, so from roughly November the grids show costs with almost no income.',
      'Row ids embed performance.now(), and both the model statistics and the invoice-level allocations are seeded from the row id. Those two sheets are therefore one sample: stable within a page load, different between loads. Cell totals, daily values and balances are fully deterministic.',
      'No manual shocks are seeded. The prototype starts clean.',
    ],
  },
  sheets,
}

// ---- annotate sheets from column-docs, in workbook order --------------------
// The family list drives tab order and tab colour, so the formatter needs no
// knowledge of which sheet is which. A sheet missing from FAMILIES is an error
// rather than a silent fallback — otherwise new sheets drift to the end untagged.
const undocumented = []
const unfamilied = []
for (const sh of sheets) {
  const fam = familyOf(sh.name)
  if (!fam) unfamilied.push(sh.name)
  const doc = SHEET_DOCS[sh.name]
  sh.family = fam?.name ?? 'Other'
  sh.familyColour = fam?.colour ?? '6B7785'
  sh.grain = doc?.grain ?? null
  sh.summary = doc?.summary ?? null
  for (const c of sh.columns) {
    c.desc = describeColumn(sh.name, c.label)
    if (!c.desc) undocumented.push(`${sh.name} → ${c.label}`)
  }
}
const famOrder = FAMILIES.flatMap((f) => f.sheets)
sheets.sort((a, b) => {
  const ai = famOrder.indexOf(a.name)
  const bi = famOrder.indexOf(b.name)
  return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
})

mkdirSync(OUT_DIR, { recursive: true })
const jsonPath = resolve(OUT_DIR, 'test-data.json')
writeFileSync(jsonPath, JSON.stringify(payload))
const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0)
console.log(`${sheets.length} sheets, ${totalRows.toLocaleString('en-GB')} rows → ${jsonPath}`)
for (const sh of sheets) console.log(`  ${sh.name.trim().padEnd(22)} ${sh.rows.length.toLocaleString('en-GB').padStart(8)}`)
if (failed.length) {
  console.log(`\n${failed.length} reconciliation check(s) FAILED:`)
  for (const c of failed) console.log(`  ${c[0]}: ${c[1]} vs ${c[2]}`)
} else {
  console.log(`\nAll ${checks.length} reconciliation checks pass.`)
}

// ---- structure drift -------------------------------------------------------
// The workbook regenerates cleanly whatever the model does, which is exactly why
// the documentation needs its own guard: nothing else would notice a column
// quietly changing shape. Compare against the accepted snapshot and say what
// moved, so the Notion page can be reviewed against a diff rather than re-read.
const SNAPSHOT = resolve(dirname(fileURLToPath(import.meta.url)), 'structure.snapshot.json')
const structure = {
  sheets: sheets.map((sh) => ({
    name: sh.name,
    family: sh.family,
    columns: sh.columns.map((c) => ({ label: c.label, type: c.type })),
  })),
}

function diffStructure(prev, next) {
  const out = { added: [], removed: [], columns: [] }
  const prevBy = new Map((prev?.sheets ?? []).map((s) => [s.name, s]))
  const nextBy = new Map(next.sheets.map((s) => [s.name, s]))
  for (const name of nextBy.keys()) if (!prevBy.has(name)) out.added.push(name)
  for (const name of prevBy.keys()) if (!nextBy.has(name)) out.removed.push(name)
  for (const [name, ns] of nextBy) {
    const ps = prevBy.get(name)
    if (!ps) continue
    const pc = new Map(ps.columns.map((c) => [c.label, c.type]))
    const nc = new Map(ns.columns.map((c) => [c.label, c.type]))
    for (const [label, type] of nc) {
      if (!pc.has(label)) out.columns.push(`${name}: + ${label} (${type})`)
      else if (pc.get(label) !== type) out.columns.push(`${name}: ~ ${label} (${pc.get(label)} → ${type})`)
    }
    for (const label of pc.keys()) if (!nc.has(label)) out.columns.push(`${name}: − ${label}`)
    if (ps.family !== ns.family) out.columns.push(`${name}: ~ family (${ps.family} → ${ns.family})`)
  }
  return out
}

const accept = process.argv.includes('--accept')
const prev = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null
const drift = diffStructure(prev, structure)
const driftCount = drift.added.length + drift.removed.length + drift.columns.length

if (unfamilied.length) {
  console.log(`\nSheets missing from FAMILIES in scripts/column-docs.js (they will be untagged and last):`)
  for (const n of unfamilied) console.log(`  ${n}`)
}

if (!prev) {
  console.log('\nNo structure snapshot yet — run `npm run export-data:accept` to record the current structure as the baseline.')
} else if (driftCount === 0) {
  console.log('Structure matches the accepted snapshot. The Notion structure section is still accurate.')
} else {
  console.log(`\nSTRUCTURE CHANGED in ${driftCount} place(s) since the accepted snapshot:`)
  for (const n of drift.added) console.log(`  + sheet ${n}`)
  for (const n of drift.removed) console.log(`  − sheet ${n}`)
  for (const c of drift.columns) console.log(`  ${c}`)
  console.log('\n  → update the Notion structure section from export/structure.md,')
  console.log('    then run `npm run export-data:accept` to bless the new structure.')
}

if (undocumented.length) {
  console.log(`\n${undocumented.length} column(s) have no description in scripts/column-docs.js:`)
  for (const u of undocumented) console.log(`  ${u}`)
  console.log('  → add them to SHEET_DOCS so the generated structure section stays complete.')
}

if (accept) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(structure, null, 2)}\n`)
  console.log(`\nStructure snapshot updated → ${SNAPSHOT}`)
}

// ---- version log row -------------------------------------------------------
// The Notion page carries a version log so a reader can tell how current the
// workbook attached to it is. Emit the row ready to paste, with everything the
// export can already know filled in — only the data-model description needs a
// human, and only when the model actually moved.
const stamp = new Date().toISOString().slice(0, 10)
const driftText = !prev
  ? 'Baseline recorded'
  : driftCount === 0
    ? 'None'
    : [
        ...drift.added.map((n) => `+ tab ${n}`),
        ...drift.removed.map((n) => `− tab ${n}`),
        ...drift.columns,
      ].join('; ')
const versionCells = [
  stamp,
  `${sheets.length} + Contents`,
  totalRows.toLocaleString('en-GB'),
  `${checks.length - failed.length}/${checks.length}`,
  driftCount === 0 && prev ? 'None' : '**TODO — one line on what changed in the data model**',
  driftText,
]
const rowPath = resolve(OUT_DIR, 'version-row.md')
writeFileSync(rowPath, `${['\t<tr>', ...versionCells.map((c) => `\t\t<td>${c}</td>`), '\t</tr>'].join('\n')}\n`)
console.log(`\nVersion-log row → ${rowPath}`)
console.log(
  `  ${stamp} · ${sheets.length} tabs · ${totalRows.toLocaleString('en-GB')} rows · ` +
    `checks ${checks.length - failed.length}/${checks.length} · drift: ${driftText}`
)

// ---- generated Notion structure section ------------------------------------
// Notion-flavoured Markdown, ready to paste over the "How the file is structured"
// section of the Notion page. Only the mechanical parts are generated; the prose
// sections (regenerating, invariants, determinism) are maintained by hand.
const esc = (s) => String(s).replace(/([<>|{}[\]^])/g, '\\$1')
const md = []
const push = (...lines) => md.push(...lines)
const table = (headers, rows) => {
  push('<table fit-page-width="true" header-row="true">')
  push('\t<tr>', ...headers.map((h) => `\t\t<td>${esc(h)}</td>`), '\t</tr>')
  for (const r of rows) push('\t<tr>', ...r.map((c) => `\t\t<td>${c ?? '—'}</td>`), '\t</tr>')
  push('</table>')
}

// No <empty-block/> padding — Notion spaces blocks itself, and empty blocks just
// leave dead vertical gaps on the page.
push('## Workbook layout')
push(
  'Tabs are colour-coded by family and indexed on a hyperlinked **Contents** tab. Every sheet carries the same furniture: row 1 the title, row 2 a wrapped plain-English note, row 3 the frozen header with an autofilter, data from row 4.'
)
table(
  ['Family', 'Tab colour', 'Tabs', 'Purpose'],
  FAMILIES.map((f) => [f.name, f.label, f.sheets.filter((s) => s === 'Contents' || sheets.some((sh) => sh.name === s)).map(esc).join(', '), f.purpose])
)
push('## Sheet index')
push('Row counts are from the run that generated this section.')
table(
  ['Tab', 'Rows', 'Grain — one row per…', 'What it holds'],
  sheets.map((sh) => [esc(sh.name), sh.rows.length.toLocaleString('en-GB'), sh.grain, sh.summary])
)
push('## Column specs by sheet')
for (const sh of sheets) {
  push(`<details>`, `<summary>**${esc(sh.name)}** — ${sh.columns.length} columns</summary>`)
  table(['Column', 'Type', 'Meaning'], sh.columns.map((c) => [esc(c.label), `\`${c.type}\``, c.desc]))
  push('</details>')
}
const mdPath = resolve(OUT_DIR, 'structure.md')
writeFileSync(mdPath, `${md.join('\n')}\n`)
console.log(`\nNotion structure section → ${mdPath}`)
