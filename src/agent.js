// Agent prototype: canned "skills" the agent panel can run against the forecast.
// Nothing here calls a model — each skill is a deterministic query over the same
// data the grid is drawn from, so every answer can be clicked through to the cell
// that holds it.
import { aggregateGrouped, cellUnderlying } from './model.js'

// The largest invoices on the register from `fromISO` onward, across every grid
// in `targets`. Each target is one company grid as the user would see it:
//   { tabId, title, currency, sources, levels, toDisplay }
// Invoices are read through cellUnderlying() on the same grouped rows and buckets
// the grid shows, so the ids and amounts match what opening that cell lists.
export function topInvoices(targets, buckets, days, fromISO, limit = 5) {
  const fromIdx = Math.max(0, days.indexOf(fromISO))
  const live = buckets.filter((b) => b.dayIndices[b.dayIndices.length - 1] >= fromIdx)
  const found = []
  for (const t of targets) {
    const agg = aggregateGrouped(t.sources, t.levels, buckets, 0, days.length)
    for (const section of ['inflows', 'outflows']) {
      const rows = section === 'inflows' ? agg.inflowRows : agg.outflowRows
      for (const row of rows) {
        if (row.hasChildren) continue // leaves only, so nothing is counted twice
        for (const bucket of live) {
          const daily = bucket.dayIndices.map((i) => Number(row.values[i]) || 0)
          const data = cellUnderlying(row, bucket, daily, days)
          if (data.kind !== 'invoice') continue
          for (const g of data.groups) {
            for (const inv of g.invoices) {
              if (inv.date < fromISO) continue
              found.push({
                key: `${t.tabId}|${section}|${row.id}|${bucket.key}|${inv.id}`,
                id: inv.id,
                date: inv.date,
                status: inv.status,
                amount: inv.amount,
                value: Math.abs(t.toDisplay(inv.amount)),
                party: g.name,
                side: section === 'inflows' ? 'Receipt' : 'Payment',
                tabId: t.tabId,
                gridTitle: t.title,
                currency: t.currency,
                section,
                rowId: row.id,
                rowName: row.name,
                rowColor: row.color,
                bucketKey: bucket.key,
                bucketLabel: bucket.label,
              })
            }
          }
        }
      }
    }
  }
  found.sort((a, b) => b.value - a.value)
  return found.slice(0, limit)
}

// Which canned skill a prompt maps to. The prototype only knows one.
export const SUGGESTED_PROMPT = 'Show me the top 5 high value invoices in this forecast'
export function intentOf(text) {
  const t = text.toLowerCase()
  if (/invoice/.test(t) && /(top|high|largest|biggest)/.test(t)) {
    const n = Number((t.match(/\b(\d{1,2})\b/) || [])[1]) || 5
    return { kind: 'topInvoices', limit: Math.min(10, Math.max(1, n)) }
  }
  return { kind: 'unknown' }
}
