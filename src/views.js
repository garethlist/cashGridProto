// Grid views: the entity test data, the bank accounts and cash pools built on
// top of it, and the resolver that turns a tab id into a renderable view.
//
// Kept out of App.jsx so the data model can be exercised without a browser.
import { CASH_POOLS, makeInitialState } from './model.js'

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
      { id: 'uk-op', name: 'UK Operating', number: '4021', currency: 'GBP', role: 'operating', bank: 'Barclays', pool: 'gbp-concentration', openShare: 5 },
      { id: 'uk-coll', name: 'UK Collections', number: '4088', currency: 'GBP', role: 'collections', bank: 'Barclays', pool: 'gbp-concentration', openShare: 2 },
      { id: 'uk-pay', name: 'UK Payroll', number: '4155', currency: 'GBP', role: 'payroll', bank: 'Lloyds', pool: null, openShare: 1 },
      { id: 'uk-ap', name: 'UK Payables', number: '4192', currency: 'GBP', role: 'payables', bank: 'Barclays', pool: 'gbp-concentration', openShare: 2 },
    ],
    profile: {
      growth: 0.012, seasonAmp: 0.14, seasonPeak: 5, payrollStep: 1500,
      bigItems: [{ target: 'loan', iso: '2026-09-01', amount: 50000 }],
    },
  },
  {
    id: 'dk', label: 'DK · DKK', company: 'Nordic A/S', currency: 'DKK', locale: 'da-DK', fx: 8.6, size: 0.55, seed: 0x51ce7a11,
    accounts: [
      { id: 'dk-op', name: 'Nordic Operating', number: '7310', currency: 'DKK', role: 'operating', bank: 'Danske Bank', pool: 'nordic-sweep', openShare: 6 },
      { id: 'dk-coll', name: 'Nordic Collections', number: '7344', currency: 'DKK', role: 'collections', bank: 'Danske Bank', pool: 'nordic-sweep', openShare: 3 },
      { id: 'dk-eur', name: 'Nordic EUR Trade', number: '7501', currency: 'EUR', role: 'payables', bank: 'Nordea', pool: 'eur-notional', openShare: 2 },
    ],
    profile: {
      growth: 0.045, receiptVar: 5200, seasonAmp: 0.2, seasonPeak: 9, payrollStep: 2800, marketingBase: 12000,
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
      { id: 'de-op', name: 'GmbH Operating', number: '9004', currency: 'EUR', role: 'operating', bank: 'Deutsche Bank', pool: 'eur-notional', openShare: 4 },
      { id: 'de-fin', name: 'GmbH Financing', number: '9077', currency: 'EUR', role: 'financing', bank: 'Deutsche Bank', pool: 'eur-notional', openShare: 1 },
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

// Resolve a tab id into everything the app needs to render that grid.
export function resolveView(tabId) {
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
