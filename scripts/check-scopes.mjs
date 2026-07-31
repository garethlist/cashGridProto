// Reconciliation check for the account / pool grid cuts.
//
// Every bank-account grid is a slice of its company's rows, and every cash-pool
// grid is a slice across companies. So the parts must always add back to the
// whole: sum of all account grids == GROUP, and each pool == the accounts in it.
// Run with: node scripts/check-scopes.mjs
import { computeDaily, consolidate, scopeState, accountOpenings } from '../src/model.js'
import { ENTITIES, buildEntityStates, ALL_ACCOUNTS, ALL_POOLS, CCY_FX } from '../src/views.js'

const states = buildEntityStates()
const fxOf = (id) => ENTITIES.find((e) => e.id === id).fx

// Closing balance of a cut, converted back to GBP so everything is comparable.
const closingGBP = (entityIds, accountIds, ccy) => {
  const outFx = CCY_FX[ccy] ?? 1
  const srcs = entityIds.map((id) => ({
    state: states[id],
    conv: (v) => (v / fxOf(id)) * outFx,
  }))
  const d = computeDaily(scopeState(srcs, accountIds))
  return (d.dailyClosing[d.dailyClosing.length - 1] ?? 0) / outFx
}

const groupState = consolidate(ENTITIES.map((e) => ({ state: states[e.id], fx: e.fx })), 1)
const groupDaily = computeDaily(groupState)
const groupClosing = groupDaily.dailyClosing[groupDaily.dailyClosing.length - 1] ?? 0

let failures = 0
const near = (label, got, want, tol = 1) => {
  const ok = Math.abs(got - want) <= tol
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${Math.round(got).toLocaleString()} vs ${Math.round(want).toLocaleString()}`)
}

// 1. every account, summed, is the group
const acctSum = ALL_ACCOUNTS.reduce(
  (s, a) => s + closingGBP([a.entityId], new Set([a.id]), a.currency),
  0
)
near('all accounts == GROUP closing', acctSum, groupClosing, 12)

// 2. each company's accounts sum to that company
for (const e of ENTITIES) {
  const d = computeDaily(states[e.id])
  const want = (d.dailyClosing[d.dailyClosing.length - 1] ?? 0) / e.fx
  const got = e.accounts.reduce((s, a) => s + closingGBP([e.id], new Set([a.id]), a.currency), 0)
  near(`${e.company} accounts == company closing`, got, want, 4)
}

// 3. each pool equals the accounts inside it
for (const p of ALL_POOLS) {
  const entityIds = [...new Set(p.accounts.map((a) => a.entityId))]
  const got = closingGBP(entityIds, new Set(p.accounts.map((a) => a.id)), p.ccy)
  const want = p.accounts.reduce((s, a) => s + closingGBP([a.entityId], new Set([a.id]), a.currency), 0)
  near(`${p.name} == its ${p.accounts.length} accounts`, got, want, 4)
}

// 4. pools + unpooled accounts == group
const pooled = new Set(ALL_POOLS.flatMap((p) => p.accounts.map((a) => a.id)))
const unpooled = ALL_ACCOUNTS.filter((a) => !pooled.has(a.id))
const poolSum =
  ALL_POOLS.reduce(
    (s, p) => s + closingGBP([...new Set(p.accounts.map((a) => a.entityId))], new Set(p.accounts.map((a) => a.id)), p.ccy),
    0
  ) + unpooled.reduce((s, a) => s + closingGBP([a.entityId], new Set([a.id]), a.currency), 0)
near(`${ALL_POOLS.length} pools + ${unpooled.length} unpooled == GROUP closing`, poolSum, groupClosing, 12)

// 5. every category is assigned to an account, and every opening balance splits
//    back to the whole
for (const e of ENTITIES) {
  const st = states[e.id]
  const ids = new Set(e.accounts.map((a) => a.id))
  const orphan = [...st.inflows, ...st.outflows].filter((r) => !ids.has(r.account?.id))
  if (orphan.length) {
    failures++
    console.log(`FAIL  ${e.company}: ${orphan.length} rows with no account (${orphan.map((r) => r.name).join(', ')})`)
  }
  const opens = accountOpenings(st)
  near(`${e.company} account openings == opening balance`, Object.values(opens).reduce((s, v) => s + v, 0), st.openingBalance, 0)
  const base = e.accounts.filter((a) => a.currency === e.currency)
  if (!base.length) {
    failures++
    console.log(`FAIL  ${e.company}: no account in its base currency ${e.currency}`)
  }
}

console.log(failures === 0 ? '\nAll scope reconciliations pass.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
