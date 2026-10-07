// Grid views: the entity test data, the bank accounts and cash pools built on
// top of it, and the resolver that turns a tab id into a renderable view.
//
// Kept out of App.jsx so the data model can be exercised without a browser.
import { CASH_POOLS, accountOpenings, makeInitialState, uid } from './model.js'

// View tabs. Entity tabs hold their own data in their own currency; `fx` is the
// base→local rate (GBP × fx = local), `size` gives each entity a distinct scale,
// and `seed` a distinct cashflow pattern. SUMMARY is a live, read-only
// consolidation of all entities, converted to the base currency (GBP).
export const BASE_CCY = 'GBP'
export const SUMMARY = { id: 'summary', label: 'GROUP', company: 'Group', currency: BASE_CCY, locale: 'en-GB', summary: true }
// Currencies the consolidated group can be displayed in (fx = GBP → currency).
export const CCY_SYMBOL = { GBP: '£', EUR: '€', USD: '$', DKK: 'kr' }
export const GROUP_CURRENCIES = [
  { code: 'GBP', locale: 'en-GB', fx: 1 },
  { code: 'EUR', locale: 'de-DE', fx: 1.17 },
  { code: 'USD', locale: 'en-US', fx: 1.27 },
  { code: 'DKK', locale: 'da-DK', fx: 8.6 },
]
// Each entity has a distinct trading profile so its balance curve reads
// differently: a steady UK retailer, a fast-growing Nordic scale-up with capex,
// a US turnaround dipping mid-year, and a lumpy project-billing German GmbH.
export const ENTITIES = [
  {
    id: 'uk', label: 'UK · GBP', company: 'UK Ltd', currency: 'GBP', locale: 'en-GB', fx: 1, size: 1.0, seed: 0x1a2b3c4d,
    accounts: [
      { id: 'uk-op', name: 'UK Operating', number: '4021', currency: 'GBP', role: 'operating', bank: 'Barclays', pool: 'gbp-concentration', openShare: 10 },
      { id: 'uk-coll', name: 'UK Collections', number: '4088', currency: 'GBP', role: 'collections', bank: 'Barclays', pool: 'gbp-concentration', openShare: 4 },
      { id: 'uk-pay', name: 'UK Payroll', number: '4155', currency: 'GBP', role: 'payroll', bank: 'Lloyds', pool: null, openShare: 2 },
      { id: 'uk-ap', name: 'UK Payables', number: '4192', currency: 'GBP', role: 'payables', bank: 'Barclays', pool: 'gbp-concentration', openShare: 4 },
      // EUR header for the cross-border sweep pool. It holds the pool's cash: the
      // participants are swept to zero, so everything they would have held has
      // already been concentrated here (11/31 of UK's opening = £68,750, the
      // Nordic opening that used to sit on Nordic's own swept accounts).
      { id: 'uk-eur', name: 'UK EUR Header', number: '4210', currency: 'EUR', role: 'eursweep', bank: 'Barclays', pool: 'eur-sweep', openShare: 11 },
    ],
    profile: {
      growth: 0.012, seasonAmp: 0.14, seasonPeak: 5, payrollStep: 1500,
      // 125,000 of UK's own cash + the 68,750 concentrated in from Nordic
      opening: 193750,
      bigItems: [{ target: 'loan', iso: '2026-09-01', amount: 50000 }],
    },
  },
  {
    id: 'dk', label: 'DK · DKK', company: 'Nordic A/S', currency: 'DKK', locale: 'da-DK', fx: 8.6, size: 0.55, seed: 0x51ce7a11,
    accounts: [
      // Nordic operating + collections feed the group EUR sweep (they used to form
      // the local Nordic sweep, now superseded by concentration into the UK header).
      // Every Nordic account is a participant, so none of them holds cash: each is
      // swept to zero daily and the entity's cash sits in the UK header instead.
      { id: 'dk-op', name: 'Nordic Operating', number: '7310', currency: 'DKK', role: 'operating', bank: 'Danske Bank', pool: 'eur-sweep', openShare: 0 },
      { id: 'dk-coll', name: 'Nordic Collections', number: '7344', currency: 'DKK', role: 'collections', bank: 'Danske Bank', pool: 'eur-sweep', openShare: 0 },
      { id: 'dk-eur', name: 'Nordic EUR Trade', number: '7501', currency: 'EUR', role: 'payables', bank: 'Nordea', pool: 'eur-sweep', openShare: 0 },
    ],
    profile: {
      growth: 0.045, receiptVar: 5200, seasonAmp: 0.2, seasonPeak: 9, payrollStep: 2800, marketingBase: 12000,
      opening: 0, // fully concentrated — Nordic's cash is held in the UK EUR header
      bigItems: [{ target: 'suppliers', iso: '2026-10-15', amount: 145000 }], // equipment capex
    },
  },
  {
    id: 'us', label: 'US · USD', company: 'US Inc', currency: 'USD', locale: 'en-US', fx: 1.27, size: 0.85, seed: 0x0bad1dea,
    accounts: [
      { id: 'us-op', name: 'US Operating', number: '2140', currency: 'USD', role: 'operating', bank: 'Citi', pool: null, openShare: 7 },
      { id: 'us-pay', name: 'US Payroll', number: '2166', currency: 'USD', role: 'payroll', bank: 'Citi', pool: null, openShare: 1 },
    ],
    profile: {
      growth: 0.006, seasonAmp: 0.24, seasonPeak: 11, marketingBase: 12000, marketingVar: 7000,
      payrollStep: 2200, opening: 108000,
      bigItems: [{ target: 'tax', iso: '2027-01-15', amount: 55000 }], // one-off settlement → mid-year dip
    },
  },
  {
    id: 'de', label: 'DE · EUR', company: 'GmbH', currency: 'EUR', locale: 'de-DE', fx: 1.17, size: 0.42, seed: 0x77c0ffee,
    accounts: [
      // GmbH's operating account feeds the group EUR sweep, so it's swept to zero
      // and holds nothing; financing sits outside the pool and carries GmbH's cash.
      { id: 'de-op', name: 'GmbH Operating', number: '9004', currency: 'EUR', role: 'operating', bank: 'Deutsche Bank', pool: 'eur-sweep', openShare: 0 },
      { id: 'de-fin', name: 'GmbH Financing', number: '9077', currency: 'EUR', role: 'financing', bank: 'Deutsche Bank', pool: null, openShare: 1 },
    ],
    profile: {
      receiptBase: 3800, receiptVar: 1500, growth: 0.006, seasonAmp: 0.05,
      payrollBase: 40000, payrollStep: 800, supplierBase: 2600, marketingBase: 4000, rent: 11000,
      bigItems: [
        { target: 'otherInc', iso: '2026-08-20', amount: 90000 }, // project milestone
        { target: 'otherInc', iso: '2026-12-10', amount: 125000 },
        { target: 'otherInc', iso: '2027-04-15', amount: 110000 },
      ],
    },
  },
]
export const makeEntity = (e) => makeInitialState({ scale: e.fx * e.size, seed: e.seed, profile: e.profile, accounts: e.accounts })

// ---- EUR sweep pool ---------------------------------------------------------
// A cross-border physical (zero-balancing) sweep. Each European participant's
// pooled accounts carry the categories already modelled for them (receipts,
// payroll, suppliers, …); each business day their net movement is swept to a EUR
// header account held by the UK, so the participant account holds nothing and the
// UK header concentrates the cash.
//
// Zero-balancing means exactly that: a participant opens at zero and every day's
// movement is swept out, so its balance is flat zero across the horizon. Only the
// header carries an opening balance (see the openShare weightings above).
//
// The sweep is a derived residual, not a forecast — so it's never a modelled
// category. And because each participant's sweep-out equals the UK's sweep-in in
// the base currency, the Sweep nets to zero across the group: it relocates
// modelled cash into the header without changing the consolidated total.
export const EUR_SWEEP = { pool: 'eur-sweep', header: 'uk' }

// Generalised sweep category — currency-agnostic; the pool it belongs to carries
// the currency, not the category itself.
const SWEEP = { name: 'Sweep', code: 'SWEEP', color: '#06b6d4', modelled: false, model: null }

function applyEurSweep(states) {
  const { pool, header } = EUR_SWEEP
  const D = states[header].days.length
  const headerBase = new Array(D).fill(0) // concentration received, in the base currency

  // Daily net movement of one account, from the categories already sitting on it.
  const accountNet = (st, acctId) => {
    const net = new Array(D).fill(0)
    for (const r of st.inflows) if (r.account?.id === acctId) for (let i = 0; i < D; i++) net[i] += Number(r.values[i]) || 0
    for (const r of st.outflows) if (r.account?.id === acctId) for (let i = 0; i < D; i++) net[i] -= Number(r.values[i]) || 0
    return net
  }

  for (const e of ENTITIES) {
    if (e.id === header) continue
    const accts = e.accounts.filter((a) => a.pool === pool)
    if (!accts.length) continue
    const st = states[e.id]
    for (const acct of accts) {
      const net = accountNet(st, acct.id) // computed before this account's own sweep is added
      // sweep the net out each day → the account's movement becomes zero, and
      // since a participant opens at zero its balance stays there
      st.outflows = [...st.outflows, { id: uid('r'), ...SWEEP, values: net, account: acct }]
      for (let i = 0; i < D; i++) headerBase[i] += net[i] / e.fx
    }
  }

  // Header leg, in the header entity's own currency.
  const uk = states[header]
  const hAcct = uk.accounts.find((a) => a.pool === pool)
  const hfx = ENTITIES.find((e) => e.id === header).fx
  uk.inflows = [...uk.inflows, { id: uid('r'), ...SWEEP, values: headerBase.map((v) => v * hfx), account: hAcct }]
  return states
}

// Build every entity's dataset, then overlay the EUR sweep so the pool's legs are
// present and reconcile. This is the app's source of truth for entity data.
export const TODAY_ISO = '2026-07-01'
export const HISTORY_FROM_ISO = '2026-01-01'

// Six months of actuals ahead of today. The forecast model only runs forward, so
// history is struck from the opening half-year with a per-day variance applied
// uniformly across every row and entity — which keeps sweeps zero-balancing and
// the group reconciling. Each entity's configured opening is its 1 Jan position.
function withHistory(states) {
  const any = Object.values(states)[0]
  const H = Math.round((Date.parse(TODAY_ISO) - Date.parse(HISTORY_FROM_ISO)) / 86400000)
  const hDays = []
  for (let i = 0; i < H; i++) hDays.push(new Date(Date.parse(HISTORY_FROM_ISO) + i * 86400000).toISOString().slice(0, 10))
  let seed = 0x5eed1234
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const f = hDays.map((_, i) => 0.86 + 0.08 * Math.sin(i / 17) + rnd() * 0.12) // actuals ran a touch under the current trend
  const D = any.days.length
  for (const st of Object.values(states)) {
    const hist = (r) => f.map((k, i) => (Number(r.values[i % D]) || 0) * k)
    let net = 0
    st.inflows = st.inflows.map((r) => { const h = hist(r); net += h.reduce((s, x) => s + x, 0); return { ...r, values: [...h, ...r.values] } })
    st.outflows = st.outflows.map((r) => { const h = hist(r); net -= h.reduce((s, x) => s + x, 0); return { ...r, values: [...h, ...r.values] } })
    st.days = [...hDays, ...st.days]
    st.todayIndex = H
    // the configured opening now stands on 1 Jan; the half-year of actuals carries it into today
  }
  return states
}
export function buildEntityStates() {
  return withHistory(applyEurSweep(Object.fromEntries(ENTITIES.map((e) => [e.id, makeEntity(e)]))))
}

// ---- grid views -------------------------------------------------------------
// A grid can be scoped four ways: the consolidated group, one company, one bank
// account, or one cash pool. The last two are cuts through the same underlying
// entity data, filtered to the accounts in scope — so they always reconcile back
// to their company and to GROUP.
export const CCY_LOCALE = { GBP: 'en-GB', EUR: 'de-DE', USD: 'en-US', DKK: 'da-DK' }
export const CCY_FX = Object.fromEntries(GROUP_CURRENCIES.map((c) => [c.code, c.fx]))
// Every account, flattened with a back-reference to the entity that holds it.
export const ALL_ACCOUNTS = ENTITIES.flatMap((e) => e.accounts.map((a) => ({ ...a, entityId: e.id, company: e.company })))
// Only pools that actually hold accounts; unpooled accounts stay reachable
// individually under the Bank account dimension.
export const ALL_POOLS = Object.values(CASH_POOLS)
  .map((p) => ({ ...p, accounts: ALL_ACCOUNTS.filter((a) => a.pool === p.id) }))
  .filter((p) => p.accounts.length > 0)
// The dimensions offered at the top of the view picker, each driving its own
// sub-selection list.
export const VIEW_DIMS = [
  { id: 'company', label: 'Company', head: 'Local grids' },
  { id: 'account', label: 'Bank account', head: 'Bank account grids' },
  { id: 'pool', label: 'Cash pool', head: 'Cash pool grids' },
]
export const acctTab = (id) => `acct:${id}`
export const poolTab = (id) => `pool:${id}`

// Navigation dimensions: every way an account can be grouped on a route. A
// route is an ordering of these, always ending at the bank account; any node
// along it is a loadable grid (a "cut" when it isn't a native company/pool).
export const NAV_DIMS = {
  company: { label: 'Company', noun: ['company', 'companies'], val: (a) => a.entityId, name: (a) => a.company, code: (a) => ENTITIES.find((e) => e.id === a.entityId)?.currency ?? '' },
  ccy: { label: 'Currency', noun: ['currency', 'currencies'], val: (a) => a.currency, name: (a) => a.currency },
  pool: { label: 'Cash pool', noun: ['cash pool', 'cash pools'], val: (a) => a.pool || 'none', name: (a) => (a.pool ? CASH_POOLS[a.pool]?.name ?? a.pool : 'Not pooled') },
  bank: { label: 'Bank', noun: ['bank', 'banks'], val: (a) => a.bank, name: (a) => a.bank },
}
export const cutTab = (filters) => 'cut:' + filters.map(([d, val]) => `${d}=${encodeURIComponent(val)}`).join(';')

// Converter from one entity's currency into a grid's display currency. Identity
// when they're the same rather than a round-trip through the base: (v / 1.17) *
// 1.17 is not v in floating point, and on a zero-balancing account that residue
// is the whole signal — its daily net has to land on exactly zero, not 1e-11.
export const fxConv = (fromFx, toFx) => (fromFx === toFx ? (v) => v : (v) => (v / fromFx) * toFx)
// One colour per entity, in ENTITIES order — the group contributions bar, the
// view picker and the opening-balance panel all identify a company by it.
export const CONTRIB_COLORS = ['#0078ff', '#16bba4', '#ff9600', '#b849ff']
export const entityColor = (id) => CONTRIB_COLORS[Math.max(0, ENTITIES.findIndex((e) => e.id === id)) % CONTRIB_COLORS.length]

// The bank accounts behind a grid's balance, at either end of the horizon.
//
//   'opening' — where the grid starts. The horizon opens on today, so this is
//     each account's actual position: the closing ledger (CL) balance its bank
//     reported for the previous day. (An entity's opening is split across its own
//     accounts by weight — see accountOpenings — which stands in for reading real
//     statement balances, and keeps the parts adding back to the whole.)
//   'closing' — where the forecast ends: that same opening plus everything the
//     forecast moves across the account over the horizon, sweeps included. Not
//     banked, and not actual.
//
// Either way this walks every account the grid draws on — one company's, several
// companies' on GROUP, or just the accounts in scope on an account/pool cut — and
// converts into the grid's display currency, so the rows always sum to the figure
// the grid itself shows.
export function accountBalances(states, view, displayCurrency, mode = 'opening') {
  const outFx = CCY_FX[displayCurrency] ?? 1
  const closing = mode === 'closing'
  const out = []
  for (const id of view.entityIds) {
    const e = ENTITIES.find((x) => x.id === id)
    const st = states[id]
    if (!e || !st) continue
    const opens = accountOpenings(st)
    const conv = fxConv(e.fx, outFx)

    // What the forecast moves across each account over the whole horizon, in the
    // entity's own currency. Rows added by hand carry no account yet, so their
    // movement is held aside rather than silently dropped.
    const moves = {}
    let loose = 0
    // 'opening' is today's position: with actuals ahead of today, that's the 1 Jan
    // balance carried through every actual day. 'closing' runs the whole horizon.
    const upto = closing ? Infinity : (st.todayIndex || 0)
    if (closing || upto > 0) {
      const walk = (rows, sign) => {
        for (const r of rows) {
          const total = r.values.slice(0, upto === Infinity ? undefined : upto).reduce((s, v) => s + (Number(v) || 0), 0) * sign
          const k = r.account?.id
          if (k) moves[k] = (moves[k] ?? 0) + total
          else loose += total
        }
      }
      walk(st.inflows, 1)
      walk(st.outflows, -1)
    }

    // Today's opening is one entity position split by the same account weights as 1 Jan
    // (actuals aren't modelled per account), so every account holds a slice of it.
    const todaySplit = !closing && upto > 0
    const entityToday = todaySplit ? (Number(st.openingBalance) || 0) + Object.values(moves).reduce((s, x) => s + x, 0) + loose : 0
    const weights = e.accounts.map((x) => (x.openShare != null ? x.openShare : 1))
    const wSum = weights.reduce((s, w) => s + w, 0) || 1
    for (const [ai, a] of e.accounts.entries()) {
      if (view.accountIds && !view.accountIds.has(a.id)) continue
      const open = opens[a.id] ?? 0
      const move = todaySplit ? 0 : moves[a.id] ?? 0
      const local = todaySplit ? entityToday * (weights[ai] / wSum) : open + move
      out.push({
        ...a,
        entityId: e.id,
        company: e.company,
        entityCurrency: e.currency,
        entityLocale: e.locale,
        color: entityColor(e.id),
        poolName: a.pool ? CASH_POOLS[a.pool]?.name ?? null : null,
        local, // in the holding entity's currency, as the split is struck
        value: conv(local), // in the grid's display currency
        // What the forecast does to this account over the horizon. A share of the
        // total says nothing at the closing end — accounts can end negative, and a
        // positive one can exceed the whole — so the panel shows this instead.
        move: conv(move),
        moveLocal: move,
      })
    }

    // Account/pool cuts already exclude account-less rows, so this only ever
    // applies to a company or the group — where it keeps the rows reconciling.
    if (closing && !view.accountIds && Math.round(loose) !== 0) {
      out.push({
        id: `${e.id}:unassigned`,
        name: 'Unassigned',
        number: '—',
        bank: 'No account set',
        currency: e.currency,
        pool: null,
        entityId: e.id,
        company: e.company,
        entityCurrency: e.currency,
        entityLocale: e.locale,
        color: entityColor(e.id),
        poolName: null,
        unassigned: true,
        local: loose,
        value: conv(loose),
        move: conv(loose),
        moveLocal: loose,
      })
    }
  }
  return out
}

// Resolve a tab id into everything the app needs to render that grid.
export function resolveView(tabId) {
  if (tabId.startsWith('cut:')) {
    const filters = tabId.slice(4).split(';').map((s) => { const [d, val] = s.split('='); return [d, decodeURIComponent(val ?? '')] })
    const accts = ALL_ACCOUNTS.filter((a) => filters.every(([d, val]) => NAV_DIMS[d] && String(NAV_DIMS[d].val(a)) === val))
    if (accts.length) {
      const ccys = [...new Set(accts.map((a) => a.currency))]
      const ccy = ccys.length === 1 ? ccys[0] : BASE_CCY
      const labels = filters.map(([d, val]) => NAV_DIMS[d].name(accts.find((a) => String(NAV_DIMS[d].val(a)) === val)))
      const title = labels.join(' · ')
      return {
        kind: 'cut', dim: 'cut', filters,
        title, subtitle: `${accts.length} accounts`, company: title,
        currency: ccy, locale: CCY_LOCALE[ccy] ?? 'en-GB',
        entityIds: [...new Set(accts.map((a) => a.entityId))],
        accountIds: new Set(accts.map((a) => a.id)),
        tip: `${filters.map(([d]) => NAV_DIMS[d].label).join(' · ')} cut over ${accts.length} accounts. Shown in ${ccy}${ccys.length > 1 ? ' (mixed currencies converted)' : ''}; edit figures on each company grid.`,
      }
    }
  }
  if (tabId.startsWith('acct:')) {
    const a = ALL_ACCOUNTS.find((x) => x.id === tabId.slice(5))
    if (a) {
      return {
        kind: 'account', dim: 'account', account: a,
        title: a.name, subtitle: `···${a.number} · ${a.bank}`,
        company: a.name, currency: a.currency, locale: CCY_LOCALE[a.currency] ?? 'en-GB',
        entityIds: [a.entityId], accountIds: new Set([a.id]),
        tip: `${a.company} · ${a.bank} account ···${a.number}${a.pool ? ` · ${CASH_POOLS[a.pool].name}` : ' · not pooled'}. Shown in ${a.currency}; edit figures on the ${a.company} grid.`,
      }
    }
  }
  if (tabId.startsWith('pool:')) {
    const p = ALL_POOLS.find((x) => x.id === tabId.slice(5))
    if (p) {
      const companies = [...new Set(p.accounts.map((a) => a.company))]
      return {
        kind: 'pool', dim: 'pool', pool: p,
        title: p.name, subtitle: `${p.type} · ${p.accounts.length} accounts`,
        company: p.name, currency: p.ccy, locale: CCY_LOCALE[p.ccy] ?? 'en-GB',
        entityIds: [...new Set(p.accounts.map((a) => a.entityId))],
        accountIds: new Set(p.accounts.map((a) => a.id)),
        tip: `${p.type} pool over ${p.accounts.length} accounts in ${companies.join(', ')}. Shown in ${p.ccy}; edit figures on each company grid.`,
      }
    }
  }
  const e = ENTITIES.find((x) => x.id === tabId)
  if (e) {
    return {
      kind: 'company', dim: 'company', entity: e,
      title: e.company, subtitle: e.currency,
      company: e.company, currency: e.currency, locale: e.locale,
      entityIds: [e.id], accountIds: null,
    }
  }
  return {
    kind: 'group', dim: 'company',
    title: SUMMARY.company, subtitle: null, company: SUMMARY.company,
    currency: null, locale: null, // GROUP is re-denominable, so set at render
    entityIds: ENTITIES.map((x) => x.id), accountIds: null,
  }
}
