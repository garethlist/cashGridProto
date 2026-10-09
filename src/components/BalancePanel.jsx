import { useEffect, useRef } from 'react'
import { useMoney } from '../currency.jsx'
import { longDate, prevDayISO } from '../model.js'

const pct = (a, t) => (t ? Math.max(0, Math.round((a / t) * 100)) : 0)

// Balance drawer, opened from either balance cell in the grid or from the target
// on the matching KPI card. Docks on the left (the underlying-data drawer takes
// the right), so the chart and grid reflow beside it and stay live while you read.
//
// Shows the bank accounts behind the balance at one end of the horizon, each with
// its share, in the grid's currency. The rows always add back to the figure on the
// grid — a company grid splits one entity's, GROUP spans them all, and an account
// or pool grid narrows to just the accounts in scope.
//
// The two ends are not the same kind of number, and the panel says so: the opening
// is actual (the closing ledger balance each bank reported yesterday), the closing
// is forecast and not banked.
export default function BalancePanel({ open, mode = 'opening', side = 'left', order = null, hover = null, onHover, view, breakdown, total, currency, firstDay, lastDay, activeTab, origin, onSelectAccount, onBack, onClose }) {
  const { money0 } = useMoney()
  const closing = mode === 'closing'
  // The horizon opens on today, so the opening position is yesterday's close.
  const asOf = closing ? lastDay : firstDay && prevDayISO(firstDay)
  // Companies in the order they appear; the company band is only worth showing
  // when the grid spans more than one.
  const companies = []
  for (const r of breakdown) {
    let c = companies.find((x) => x.id === r.entityId)
    if (!c) { c = { id: r.entityId, company: r.company, currency: r.entityCurrency, color: r.color, rows: [], total: 0 }; companies.push(c) }
    c.rows.push(r)
    c.total += r.value
  }
  // A shared order (the opening balance's) keeps both panes listing accounts the
  // same way, so they can be read across; otherwise largest first.
  for (const c of companies) c.rows.sort(order ? (a, b) => (order[a.id] ?? 1e9) - (order[b.id] ?? 1e9) : (a, b) => b.value - a.value)
  if (order) {
    const rank = (c) => Math.min(...c.rows.map((r) => order[r.id] ?? 1e9))
    companies.sort((a, b) => rank(a) - rank(b))
  }
  // Hovering an account in either pane focuses it in both. The pane that didn't
  // start the hover scrolls the row into view, so the pair can be compared.
  const bodyRef = useRef(null)
  const hoverId = hover?.id ?? null
  useEffect(() => {
    if (!open || !hover || hover.side === side) return
    const body = bodyRef.current
    const el = body?.querySelector(`[data-acct="${CSS.escape(String(hover.id))}"]`)
    if (!body || !el) return
    const top = el.offsetTop - body.offsetTop
    const bottom = top + el.offsetHeight
    if (top < body.scrollTop) body.scrollTo({ top: top - 8, behavior: 'smooth' })
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTo({ top: bottom - body.clientHeight + 8, behavior: 'smooth' })
  }, [hover, open, side])
  const multiCompany = companies.length > 1
  // The largest single account either way, so the bars use the full width of the
  // panel rather than all sitting stubbily at the low end. Magnitude, not value:
  // a forecast account can end overdrawn, and that bar should still read.
  const peak = breakdown.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0)

  return (
    <aside className={`balpanel ${side === 'right' ? 'balpanel--right' : ''} ${open ? 'balpanel--open' : ''} ${hoverId != null && breakdown.some((r) => r.id === hoverId) ? 'balpanel--hovering' : ''}`} aria-hidden={!open} aria-label={`${closing ? 'Closing' : 'Opening'} balance by account`}>
      {/* Drilled in from another grid's breakdown — the trail back sits above the
          title, so the panel you left from is always one click away. */}

      <header className="balpanel__head">
        <div className="balpanel__titles">
          <span className="balpanel__title">
            {closing ? 'Closing balance' : 'Opening balance'}
            {/* which kind of number this is — the panel's most important claim */}
            <span
              className={`balstatus balstatus--${closing ? 'forecast' : 'actual'}`}
              title={closing
                ? 'Forecast — modelled to the end of the horizon, not banked'
                : 'Actual — the closing ledger balance each bank reported for the previous day'}
            >
              {closing ? 'Forecast' : 'CL · Actual'}
            </span>
          </span>
        </div>
        <span className="balpanel__actions">
        {/* drilled in from another grid: the way back sits beside Close, so the
            header keeps the page's top-bar height and the grey bands stay level */}
        {origin && (
          <button className="gclosebtn balpanel__back" onClick={onBack} title={`Back to the ${origin.title} grid`}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
            <span className="balpanel__backlabel">Back to {origin.title}</span>
          </button>
        )}
        <button className="gclosebtn balpanel__close" title={origin ? `Close and return to ${origin.title} (Esc)` : 'Close (Esc)'} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          Close
        </button>
        </span>
      </header>

      {/* sits level with the page's title band, so the two read as one strip */}
      <div className="balpanel__total">
        <span className={`balpanel__total-val ${total < 0 ? 'is-neg' : ''}`}>{money0(total)}</span>
        <span className="balpanel__total-label">
          <span className="balpanel__total-scope">{view.title} · {currency}</span>
          <span>
            {breakdown.length} account{breakdown.length === 1 ? '' : 's'}
            {asOf ? ` · ${closing ? 'at' : 'close of'} ${longDate(asOf)}` : ''}
          </span>
        </span>
      </div>

      <div className="balpanel__body" ref={bodyRef}>
        {companies.map((c) => (
          <div key={c.id} className="balco">
            {multiCompany && (
              <div className="balco__head">
                <span className="balco__dot" style={{ background: c.color }} />
                <span className="balco__name">{c.company}</span>
                <span className="balco__ccy">{c.currency}</span>
                <span className="balco__amt">{money0(c.total)}</span>
              </div>
            )}
            {c.rows.map((r) => (
              <AccountRow
                key={r.id}
                row={r}
                peak={peak}
                total={total}
                closing={closing}
                money0={money0}
                currency={currency}
                onSelect={onSelectAccount}
                current={activeTab === `acct:${r.id}`}
                hovered={hoverId === r.id}
                onHover={onHover ? (on) => onHover(on ? { id: r.id, side } : null) : undefined}
              />
            ))}
          </div>
        ))}
        {!breakdown.length && <p className="balpanel__empty">No accounts feed this grid.</p>}
      </div>

      <footer className="balpanel__foot">
        {closing
          ? 'Forecast, not banked: each account’s opening balance plus everything the forecast moves across it over the horizon, sweeps included.'
          : 'Actual: the closing ledger (CL) balance each bank reported for the day before the horizon opens.'}
        {breakdown.length > 1 && ' Hover an account to open its own grid.'}
      </footer>
    </aside>
  )
}

function AccountRow({ row, peak, total, closing, money0, currency, onSelect, current, hovered, onHover }) {
  // The second figure is the same money in the currency the holding company's
  // books are kept in — which is where the split is struck, so it needn't match
  // the account's own currency (a EUR account of a DKK company splits in DKK).
  // Only worth showing when the grid isn't already denominated in it.
  const localDiffers = row.entityCurrency !== currency
  // A hand-added row with no bank account behind it isn't a grid you can open —
  // it's here so the figures still add back to the balance on the grid.
  const canOpen = !row.unassigned && !current
  return (
    <div
      className={`balacct ${current ? 'balacct--on' : ''} ${hovered ? 'balacct--hover' : ''} ${row.value === 0 ? 'balacct--zero' : ''} ${row.unassigned ? 'balacct--inert' : ''}`}
      data-acct={row.id}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      title={row.unassigned ? 'Rows with no bank account set yet' : current ? `${row.name} — this grid` : undefined}
    >
      <span className="balacct__body">
        <span className="balacct__main">
          <span className="balacct__name">
            {row.name}
            {!row.unassigned && <span className="balacct__no">···{row.number}</span>}
            {/* shortcut into this account's own grid — leaves a breadcrumb back */}
            {canOpen && (
              <button className="balacct__open" onClick={() => onSelect(row.id)} title={`Open the ${row.name} grid`}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 6h12M6 6v7.5" />
                </svg>
                <span>Open grid</span>
              </button>
            )}
          </span>
          <span className="balacct__meta">
            <span className="balacct__bank">{row.bank}</span>
            <span className="balacct__ccy">{row.currency}</span>
            {!row.unassigned && (
              <span className={`balacct__pool ${row.poolName ? '' : 'balacct__pool--none'}`}>
                {row.poolName ?? 'Not pooled'}
              </span>
            )}
          </span>
        </span>
        <span className="balacct__figs">
          <span className={`balacct__amt ${row.value < 0 ? 'is-neg' : ''}`}>{money0(row.value)}</span>
          {/* At the opening end every account holds a slice of one total, so a
              share reads. At the closing end it doesn't — an account can end
              overdrawn, and another can hold more than the group — so the useful
              second figure is what the forecast moved across it. */}
          <span
            className={`balacct__sub ${closing && row.move < 0 ? 'is-neg' : ''}`}
            title={[
              closing ? `${row.move >= 0 ? 'Up' : 'Down'} ${money0(Math.abs(row.move))} over the horizon` : `${pct(row.value, total)}% of the balance`,
              localDiffers ? `held on ${row.company}'s books in ${row.entityCurrency}` : null,
            ].filter(Boolean).join(' · ')}
          >
            {closing
              ? `${row.move > 0 ? '+' : ''}${money0(row.move)}`
              : `${pct(row.value, total)}%`}
            {localDiffers && ` · ${row.local.toLocaleString(row.entityLocale, { style: 'currency', currency: row.entityCurrency, maximumFractionDigits: 0 })}`}
          </span>
        </span>
      </span>
      <span
        className="balacct__bar"
        style={{
          width: `${peak ? (Math.abs(row.value) / peak) * 100 : 0}%`,
          background: row.value < 0 ? 'var(--neg)' : row.color,
        }}
      />
    </div>
  )
}
