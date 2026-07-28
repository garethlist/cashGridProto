// Cash-forecast data model.
//
// The SOURCE OF TRUTH is daily data. State shape:
//   {
//     openingBalance: number,                 // cash before day 0
//     days: string[],                         // ISO 'YYYY-MM-DD', one per day, ordered
//     inflows:  [{ id, name, values: number[] }],   // values[] parallel to days
//     outflows: [{ id, name, values: number[] }],
//   }
//
// The table aggregates days -> buckets (day | week | month).
// The chart always plots the daily running balance.

let counter = 0
export const uid = (p = 'id') =>
  `${p}_${(counter++).toString(36)}_${Math.floor(performance.now())}`

// ---- date helpers ----------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const parseISO = (iso) => new Date(`${iso}T00:00:00Z`)
const ymd = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const addUTCDays = (d, n) => new Date(d.getTime() + n * 86400000)

function eachDay(startISO, endISO) {
  const out = []
  let d = parseISO(startISO)
  const end = parseISO(endISO)
  while (d <= end) {
    out.push(ymd(d))
    d = addUTCDays(d, 1)
  }
  return out
}

const isWeekday = (iso) => {
  const dow = parseISO(iso).getUTCDay()
  return dow >= 1 && dow <= 5
}

export function dayLabel(iso) {
  const d = parseISO(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
export function weekLabel(iso) {
  const d = parseISO(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
export function monthLabel(iso) {
  const d = parseISO(iso)
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`
}
export function longDate(iso) {
  const d = parseISO(iso)
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${dows[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const startOfISOWeek = (d) => {
  const offset = (d.getUTCDay() + 6) % 7 // days since Monday
  return addUTCDays(d, -offset)
}

// ---- bucketing (days -> table columns) -------------------------------------
export function bucketize(days, granularity) {
  if (granularity === 'day') {
    return days.map((iso, i) => ({
      index: i,
      key: iso,
      label: dayLabel(iso),
      sublabel: parseISO(iso).getUTCFullYear() === new Date().getUTCFullYear() ? '' : '',
      dayIndices: [i],
      startISO: iso,
      endISO: iso,
    }))
  }

  if (granularity === 'week') {
    const buckets = []
    let cur = null
    days.forEach((iso, i) => {
      const key = ymd(startOfISOWeek(parseISO(iso)))
      if (!cur || cur.key !== key) {
        cur = { index: buckets.length, key, label: `w/c ${weekLabel(key)}`, dayIndices: [], startISO: key }
        buckets.push(cur)
      }
      cur.dayIndices.push(i)
      cur.endISO = iso
    })
    return buckets
  }

  // month
  const buckets = []
  let cur = null
  days.forEach((iso, i) => {
    const key = iso.slice(0, 7)
    if (!cur || cur.key !== key) {
      cur = { index: buckets.length, key, label: monthLabel(iso), dayIndices: [], startISO: iso }
      buckets.push(cur)
    }
    cur.dayIndices.push(i)
    cur.endISO = iso
  })
  return buckets
}

// ---- daily running balance (chart) -----------------------------------------
export function computeDaily(state) {
  const D = state.days.length
  const dailyNet = new Array(D).fill(0)
  for (const r of state.inflows) for (let i = 0; i < D; i++) dailyNet[i] += Number(r.values[i]) || 0
  for (const r of state.outflows) for (let i = 0; i < D; i++) dailyNet[i] -= Number(r.values[i]) || 0

  const dailyClosing = new Array(D)
  let prev = Number(state.openingBalance) || 0
  for (let i = 0; i < D; i++) {
    prev += dailyNet[i]
    dailyClosing[i] = prev
  }
  return { dailyNet, dailyClosing }
}

// ---- bucket aggregation (table) --------------------------------------------
export function aggregate(state, buckets) {
  const agg = (rows) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      color: r.color,
      modelled: r.modelled,
      model: r.model,
      bucketValues: buckets.map((b) => b.dayIndices.reduce((s, i) => s + (Number(r.values[i]) || 0), 0)),
    }))

  const inflowRows = agg(state.inflows)
  const outflowRows = agg(state.outflows)

  const totalInflows = buckets.map((_, bi) => inflowRows.reduce((s, r) => s + r.bucketValues[bi], 0))
  const totalOutflows = buckets.map((_, bi) => outflowRows.reduce((s, r) => s + r.bucketValues[bi], 0))
  const net = buckets.map((_, bi) => totalInflows[bi] - totalOutflows[bi])

  const opening = new Array(buckets.length)
  const closing = new Array(buckets.length)
  let prev = Number(state.openingBalance) || 0
  for (let bi = 0; bi < buckets.length; bi++) {
    opening[bi] = prev
    closing[bi] = prev + net[bi]
    prev = closing[bi]
  }

  return { inflowRows, outflowRows, totalInflows, totalOutflows, net, opening, closing }
}

// ---- manual scenario shocks ------------------------------------------------
// Apply manual shocks to a daily value series. Each shock covers a day range
// [dayStart, dayEnd]; `pct` multiplies (value is a fraction, e.g. -0.2 = -20%),
// `abs` adds `value` spread evenly across the range.
export function applyShocks(values, shocks) {
  if (!shocks || !shocks.length) return values
  const out = values.slice()
  for (const s of shocks) {
    const start = Math.max(0, s.dayStart)
    const end = Math.min(out.length - 1, s.dayEnd)
    const span = end - start + 1
    if (span <= 0) continue
    for (let i = start; i <= end; i++) {
      out[i] = s.kind === 'pct' ? out[i] * (1 + s.value) : out[i] + s.value / span
    }
  }
  return out
}

// Return a copy of `state` with manual shocks baked into each category's daily
// values, so shocks flow through to totals, net, closing balance and the chart.
// `shocks` = { `${section}:${rowId}`: shock[] }.
export function shockState(state, shocks) {
  if (!shocks || !Object.keys(shocks).length) return state
  const shockRows = (section, rows) =>
    rows.map((r) => {
      const arr = shocks[`${section}:${r.id}`]
      return arr && arr.length ? { ...r, values: applyShocks(r.values, arr) } : r
    })
  return { ...state, inflows: shockRows('inflows', state.inflows), outflows: shockRows('outflows', state.outflows) }
}

// ---- consolidation ---------------------------------------------------------
// Sum several entity states into one. `entities` = [{ state, fx }] where fx
// converts the base currency → that entity's currency (so base value =
// local / fx). The result is expressed in the base currency scaled by `outFx`
// (outFx = 1 → base/GBP; outFx = 8.6 → DKK, etc.). Category metadata is taken
// from the first entity; values and opening balance are summed element-wise.
export function consolidate(entities, outFx = 1) {
  const base = entities[0].state
  const sumCell = (section, ri, t) =>
    entities.reduce((s, e) => {
      const cell = e.state[section]?.[ri]?.values?.[t]
      return s + (Number(cell) || 0) / e.fx
    }, 0) * outFx
  const sumSection = (section) =>
    base[section].map((row, ri) => ({ ...row, values: row.values.map((_, t) => sumCell(section, ri, t)) }))
  return {
    openingBalance: entities.reduce((s, e) => s + (Number(e.state.openingBalance) || 0) / e.fx, 0) * outFx,
    days: base.days,
    inflows: sumSection('inflows'),
    outflows: sumSection('outflows'),
  }
}

// ---- scenarios (chart overlays on the baseline daily balance) --------------
// 0-based count of whole months elapsed since the series start, per day.
// So "month 3" (1-indexed) == ordinal >= 2.
export function monthOrdinals(days) {
  if (!days.length) return []
  const first = parseISO(days[0])
  const base = first.getUTCFullYear() * 12 + first.getUTCMonth()
  return days.map((iso) => {
    const d = parseISO(iso)
    return d.getUTCFullYear() * 12 + d.getUTCMonth() - base
  })
}

// Dummy forecast-uncertainty half-width, as a fraction of the value, for day i
// of n. Fans out with the horizon (~±2% early → ~±16% late, sqrt shape) to
// mimic a confidence cone. Placeholder for a real model later.
export function bandFraction(i, n) {
  if (n <= 1) return 0
  const t = i / (n - 1)
  const F_MIN = 0.02
  const F_MAX = 0.16
  return F_MIN + (F_MAX - F_MIN) * Math.sqrt(t)
}

// Each scenario transforms the baseline daily closing-balance line.
// 'base' is the identity — the main table numbers — shown by default.
// (Forecasting models are defined per category at the row level, not here.)
export const SCENARIOS = [
  {
    id: 'base',
    code: 'BASE',
    name: 'Base (table)',
    color: 'var(--brand)',
    description: 'The forecast built directly from the inflows and outflows entered in the table.',
    apply: (base) => base,
  },
  {
    id: 's1',
    code: 'UP10',
    name: 'Uplift +10% from M3',
    color: 'var(--sc1)',
    description: 'Parallel uplift — the balance is scaled +10% from month 3 onward, e.g. a step-change in receipts.',
    // parallel uplift: from month 3 onward, scale the balance by +10%
    apply: (base, ord) => base.map((v, i) => (ord[i] >= 2 ? v * 1.1 : v)),
  },
  {
    id: 's2',
    code: 'VOL5',
    name: 'Volatility ±5%',
    color: 'var(--sc2)',
    description: 'Applies an independent random shift within ±5% to each of the 12 months to stress volatility.',
    // one random shift per month within [-5%, +5%], applied across all 12 months
    apply: (base, ord) => {
      const rand = mulberry32(0xc0ffee)
      const factor = {}
      return base.map((v, i) => {
        const m = ord[i]
        if (factor[m] === undefined) factor[m] = 1 + (rand() * 0.1 - 0.05)
        return v * factor[m]
      })
    },
  },
  {
    id: 's3',
    code: 'DN3',
    name: 'Downside −3%/mo from M6',
    color: 'var(--sc3)',
    description: 'Downside stress — compounding −3% per month from month 6 to the end of the horizon.',
    // from month 6 onward, compounding -3% per elapsed month
    apply: (base, ord) => base.map((v, i) => (ord[i] >= 5 ? v * Math.pow(0.97, ord[i] - 4) : v)),
  },
]

// ---- seed data: a full daily dataset ---------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- underlying detail (Base-mode cell drill-in) ---------------------------
// Some category rows are backed by invoice-level data; the rest are just daily
// cash flows. Customer Receipts (ARE) and Suppliers (APE) get a plausible,
// deterministic set of invoices grouped by counterparty.
const RECEIPT_CUSTOMERS = [
  'Northwind Trading', 'Acme Logistics', 'Globex Retail', 'Umbrella Foods',
  'Initech Systems', 'Soylent Corp', 'Stark Industries', 'Wayne Enterprises',
  'Wonka Industries', 'Cyberdyne Systems', 'Hooli Media', 'Vandelay Imports',
  'Gekko Capital', 'Bluth Company', 'Tessier Retail',
]
const SUPPLIER_VENDORS = [
  'Dunder Mifflin', 'Prestige Worldwide', 'Vehement Capital', 'Massive Dynamic',
  'Wernham Hogg', 'Gringotts Supplies', 'Tyrell Corp', 'Weyland Freight',
  'Oscorp Materials', 'Nakatomi Services', 'Bishop & Co', 'Aperture Facilities',
  'Monarch Utilities', 'Sterling Power', 'Waystar Cloud',
]
const INV_STATUSES = ['Contracted', 'Expected', 'Recurring', 'Forecast']

export const INVOICE_CODES = new Set(['ARE', 'APE'])

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Break one aggregate cell into its underlying detail.
//  - ARE / APE: invoices grouped by counterparty (top 10 + "Other"), summing
//    exactly to the cell total.
//  - anything else: the daily cash flows that make up the bucket.
// `dailyValues` are the effective (post-shock) daily amounts for the bucket.
export function cellUnderlying(row, bucket, dailyValues, days) {
  const total = dailyValues.reduce((s, v) => s + (Number(v) || 0), 0)
  if (!INVOICE_CODES.has(row.code)) {
    const cashflows = bucket.dayIndices.map((di, k) => ({ date: days[di], amount: Number(dailyValues[k]) || 0 }))
    return { kind: 'cashflow', total, cashflows }
  }

  const isReceipt = row.code === 'ARE'
  const party = isReceipt ? 'Customer' : 'Supplier'
  const roster = isReceipt ? RECEIPT_CUSTOMERS : SUPPLIER_VENDORS
  const prefix = isReceipt ? 'AR' : 'AP'
  const rng = mulberry32(hashStr(`${row.id}|${bucket.key}`))

  // Front-loaded weights (a few big counterparties) with per-cell jitter; drop a
  // random handful so not every counterparty appears in every period.
  const active = roster
    .map((name, i) => ({ name, w: (roster.length - i) * (0.45 + rng() * 1.1) }))
    .filter(() => rng() > 0.18)
  if (!active.length) active.push({ name: roster[0], w: 1 })
  const sumW = active.reduce((s, p) => s + p.w, 0)

  // Allocate the total across counterparties (largest-remainder rounding).
  const parties = active.map((p) => ({ name: p.name, raw: (total * p.w) / sumW }))
  parties.sort((a, b) => b.raw - a.raw)
  const alloc = parties.map((p) => ({ name: p.name, amount: Math.floor(p.raw) }))
  let rem = Math.round(total) - alloc.reduce((s, p) => s + p.amount, 0)
  for (let i = 0; i < alloc.length && rem > 0; i++) { alloc[i].amount += 1; rem-- }

  const dayIdx = bucket.dayIndices
  const makeInvoices = (name, amount) => {
    if (amount <= 0) return []
    const n = 1 + Math.floor(rng() * 3)
    const out = []
    let left = amount
    for (let k = 0; k < n && left > 0; k++) {
      const amt = k === n - 1 ? left : Math.max(1, Math.round((amount * (0.25 + rng() * 0.5)) / n))
      const val = Math.min(left, amt)
      left -= val
      const di = dayIdx[Math.floor(rng() * dayIdx.length)]
      out.push({
        id: `${prefix}-${(hashStr(`${name}${bucket.key}${k}`) % 90000) + 10000}`,
        date: days[di],
        amount: val,
        status: INV_STATUSES[Math.floor(rng() * INV_STATUSES.length)],
      })
    }
    return out
  }

  const withInvoices = alloc.map((p) => ({ name: p.name, amount: p.amount, invoices: makeInvoices(p.name, p.amount) }))
  const TOP = 10
  const groups = withInvoices.slice(0, TOP).filter((p) => p.amount > 0)
  const restList = withInvoices.slice(TOP).filter((p) => p.amount > 0)
  const other = restList.length
    ? { count: restList.length, amount: restList.reduce((s, p) => s + p.amount, 0) }
    : null

  return { kind: 'invoice', party, total, groups, other }
}

// ---- model detail (capsule → model panel) ----------------------------------
// Plausible, deterministic metadata for the model behind a category. Stands in
// for what a real model registry would return.
const MODEL_BLURB = {
  SARIMA: 'Seasonal ARIMA on daily receipts, with weekday and month-end seasonality terms fitted per entity.',
  'Seasonal Naïve': 'Carries the value from the same point in the previous season forward. A deliberately simple, hard-to-beat baseline.',
  'Holt-Winters': 'Triple exponential smoothing over level, trend and seasonality — responsive to recent shifts without overfitting.',
  'Componentised Payroll Model': 'Builds payroll bottom-up from headcount, contracted salary, employer NI and pension, then lands it on each pay date.',
  XGBoost: 'Gradient-boosted trees over supplier payment-term features, invoice ageing buckets and historical settlement behaviour.',
  Chronos: 'Pretrained time-series foundation model, zero-shot over the marketing spend history with a light fine-tune per entity.',
}
const MODEL_DRIVERS = {
  SARIMA: ['Invoice register', 'Customer payment terms', 'Weekday seasonality', 'Month-end effect'],
  'Seasonal Naïve': ['Prior-season actuals', 'Calendar alignment'],
  'Holt-Winters': ['Level', 'Trend', 'Seasonal index'],
  'Componentised Payroll Model': ['Headcount', 'Contracted salary', 'Employer NI', 'Pension contributions', 'Pay calendar'],
  XGBoost: ['Supplier terms', 'Invoice ageing', 'Settlement history', 'Purchase orders'],
  Chronos: ['Spend history', 'Campaign calendar', 'Channel mix'],
}

export function modelDetail(row) {
  if (!row.modelled || !row.model) {
    return {
      manual: true,
      name: 'Manual entry',
      category: 'Manual',
      blurb: 'Entered by hand and not produced by a model. Values flow through the forecast exactly as typed.',
      drivers: [],
      owner: 'Treasury',
      stats: [],
    }
  }
  const rng = mulberry32(hashStr(`${row.id}|${row.model.name}`))
  const mape = (2.5 + rng() * 6).toFixed(1)
  const bias = (rng() * 3 - 1.5).toFixed(1)
  const cover = (88 + rng() * 10).toFixed(0)
  const months = 12 + Math.floor(rng() * 24)
  return {
    manual: false,
    name: row.model.name,
    category: row.model.category,
    blurb: MODEL_BLURB[row.model.name] ?? 'Statistical forecast fitted on this category’s history.',
    drivers: MODEL_DRIVERS[row.model.name] ?? ['Historical actuals'],
    owner: row.model.category === 'Custom R&D' ? 'Treasury R&D' : row.model.category === 'ML/AI' ? 'Data Science' : 'Treasury Analytics',
    retrain: row.model.category === 'ML/AI' ? 'Weekly' : 'Monthly',
    trainedOn: `${months} months of history`,
    stats: [
      { label: 'MAPE', value: `${mape}%`, hint: 'Mean absolute percentage error, backtested' },
      { label: 'Bias', value: `${bias > 0 ? '+' : ''}${bias}%`, hint: 'Average signed error — positive means over-forecasting' },
      { label: 'Coverage', value: `${cover}%`, hint: 'Share of actuals falling inside the 80% prediction interval' },
    ],
  }
}

function monthGroups(days) {
  const groups = new Map()
  days.forEach((iso, i) => {
    const k = iso.slice(0, 7)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  })
  return [...groups.values()]
}

export function makeInitialState(opts = {}) {
  const scale = opts.scale ?? 1
  // Per-entity profile knobs so each local company has a distinct chart shape:
  // trend (growth), seasonality (amplitude + peak month), cost ratios, opening
  // buffer, and one-off items (drawdowns, capex, milestone billings, settlements).
  const p = opts.profile ?? {}
  const receiptBase = p.receiptBase ?? 6200
  const receiptVar = p.receiptVar ?? 3200
  const growth = p.growth ?? 0 // compounding month-on-month trend on receipts
  const seasonAmp = p.seasonAmp ?? 0 // seasonal swing as a fraction of receipts
  const seasonPeak = p.seasonPeak ?? 0 // 0-based month (0 = Jul) of the seasonal peak
  const payrollBase = p.payrollBase ?? 62000
  const payrollStep = p.payrollStep ?? 2000
  const rentAmt = p.rent ?? 18000
  const supplierBase = p.supplierBase ?? 4200
  const supplierVar = p.supplierVar ?? 2600
  const marketingBase = p.marketingBase ?? 9000
  const marketingVar = p.marketingVar ?? 6000
  const otherIncBase = p.otherIncBase ?? 700
  const openingBase = p.opening ?? 125000
  const taxAmts = p.tax ?? [28000, 31000, 29500, 33000]
  const bigItems = p.bigItems ?? [{ target: 'loan', iso: '2026-09-01', amount: 50000 }]

  const days = eachDay('2026-07-01', '2027-06-30') // full 12-month horizon
  const D = days.length
  const rand = mulberry32(opts.seed ?? 0x1a2b3c4d)
  const ord = monthOrdinals(days)
  const zeros = () => new Array(D).fill(0)

  const receipts = zeros()
  const otherInc = zeros()
  const loan = zeros()
  const payroll = zeros()
  const rent = zeros()
  const suppliers = zeros()
  const marketing = zeros()
  const tax = zeros()

  const growthFactor = (mi) => Math.pow(1 + growth, mi)
  const seasonFactor = (mi) => 1 + seasonAmp * Math.cos((2 * Math.PI * (mi - seasonPeak)) / 12)

  days.forEach((iso, i) => {
    const d = parseISO(iso)
    const dow = d.getUTCDay()
    const dom = d.getUTCDate()
    const weekday = dow >= 1 && dow <= 5
    const trend = growthFactor(ord[i]) * seasonFactor(ord[i])

    if (weekday) receipts[i] = Math.round(((receiptBase + rand() * receiptVar) * trend) / 10) * 10 // daily customer receipts
    if (dow === 5) otherInc[i] = otherIncBase + Math.round(rand() * otherIncBase) // Friday other income
    if (dow === 2 || dow === 4) suppliers[i] = Math.round((supplierBase + rand() * supplierVar) * growthFactor(ord[i])) // Tue/Thu supplier runs
    if (dom === 15) marketing[i] = marketingBase + Math.round(rand() * marketingVar) // mid-month marketing spend
  })

  // rent on first business day of each month; payroll on last business day (escalating)
  monthGroups(days).forEach((idxs, mi) => {
    const first = idxs.find((i) => isWeekday(days[i]))
    const last = [...idxs].reverse().find((i) => isWeekday(days[i]))
    if (first != null) rent[first] = rentAmt
    if (last != null) payroll[last] = payrollBase + mi * payrollStep
  })

  // quarterly-ish tax payments
  const setDay = (arr, iso, v) => {
    const i = days.indexOf(iso)
    if (i >= 0) arr[i] = v
  }
  ;['2026-08-07', '2026-11-06', '2027-02-05', '2027-05-07'].forEach((iso, k) => setDay(tax, iso, taxAmts[k] ?? 0))

  // one-off items placed into specific category series (drawdowns, capex,
  // milestone receipts, settlements) — a key differentiator of each profile.
  const arrays = { receipts, otherInc, loan, payroll, rent, suppliers, marketing, tax }
  for (const item of bigItems) {
    const i = days.indexOf(item.iso)
    if (i >= 0 && arrays[item.target]) arrays[item.target][i] += item.amount
  }

  const sc = (arr) => (scale === 1 ? arr : arr.map((v) => Math.round(v * scale)))

  return {
    openingBalance: Math.round(openingBase * scale),
    days,
    // Each category carries: a swatch colour, whether it is modelled (⚡) or
    // entered manually (👤), and — when modelled — the model that forecasts it.
    inflows: [
      { id: uid('r'), name: 'Customer Receipts', code: 'ARE', color: '#00c089', values: sc(receipts), modelled: true, model: { name: 'SARIMA', category: 'Statistical' } },
      { id: uid('r'), name: 'Loan Drawdown', code: 'ARI', color: '#0078ff', values: sc(loan), modelled: true, model: { name: 'Seasonal Naïve', category: 'Statistical' } },
      { id: uid('r'), name: 'Other Income', code: 'AREX', color: '#16bba4', values: sc(otherInc), modelled: true, model: { name: 'Holt-Winters', category: 'Statistical' } },
    ],
    outflows: [
      { id: uid('r'), name: 'Payroll', code: 'SALARIES', color: '#ff9600', values: sc(payroll), modelled: true, model: { name: 'Componentised Payroll Model', category: 'Custom R&D' } },
      { id: uid('r'), name: 'Rent & Facilities', code: 'PAIT', color: '#b849ff', values: sc(rent), modelled: true, model: { name: 'Seasonal Naïve', category: 'Statistical' } },
      { id: uid('r'), name: 'Suppliers', code: 'APE', color: '#de4383', values: sc(suppliers), modelled: true, model: { name: 'XGBoost', category: 'ML/AI' } },
      { id: uid('r'), name: 'Marketing', code: 'APIX', color: '#ffd621', values: sc(marketing), modelled: true, model: { name: 'Chronos', category: 'ML/AI' } },
      { id: uid('r'), name: 'Tax & VAT', code: 'TAX', color: '#858585', values: sc(tax), modelled: false, model: null },
    ],
  }
}
