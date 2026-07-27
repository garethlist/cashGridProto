import { useState } from 'react'
import { useMoney } from '../currency.jsx'
import { dayLabel } from '../model.js'

const pct = (a, t) => (t ? Math.max(2, Math.round((a / t) * 100)) : 0)

// Base-mode detail drawer: the underlying data behind one aggregate cell —
// invoices grouped by counterparty (Customer Receipts / Suppliers) or the daily
// cash flows that make up the bucket.
export default function UnderlyingPanel({ open, cell, company, currency, onClose }) {
  const { money0, num0 } = useMoney()
  const data = cell?.data
  const row = cell?.row
  const bucket = cell?.bucket

  return (
    <aside className={`underpanel ${open ? 'underpanel--open' : ''}`} aria-hidden={!open}>
        {data && (
          <>
            <header className="underpanel__head">
              <div className="underpanel__titles">
                <span className="underpanel__cat">
                  <span className="underpanel__swatch" style={{ background: row.color }} />
                  {row.name}
                </span>
                <span className="underpanel__sub">{bucket.label} · {company} · {currency}</span>
              </div>
              <button className="iconbtn" title="Close" onClick={onClose}>×</button>
            </header>

            <div className="underpanel__total">
              <span className="underpanel__total-label">
                {data.kind === 'invoice' ? `Underlying invoices · by ${data.party.toLowerCase()}` : 'Underlying daily cash flows'}
              </span>
              <span className="underpanel__total-val">{money0(data.total)}</span>
            </div>

            <div className="underpanel__body">
              {data.kind === 'invoice' ? (
                <>
                  <div className="underpanel__colhead">
                    <span>{data.party}</span>
                    <span>Amount</span>
                  </div>
                  {data.groups.map((g, i) => (
                    <PartyGroup key={g.name} rank={i + 1} group={g} total={data.total} money0={money0} />
                  ))}
                  {data.other && (
                    <div className="party party--other">
                      <div className="party__body">
                        <span className="party__caret party__caret--none" />
                        <span className="party__rank">–</span>
                        <span className="party__name">Other</span>
                        <span className="party__meta">{data.other.count} {data.party.toLowerCase()}{data.other.count > 1 ? 's' : ''}</span>
                        <span className="party__amt">{money0(data.other.amount)}</span>
                      </div>
                      <span className="party__bar" style={{ width: `${pct(data.other.amount, data.total)}%` }} />
                    </div>
                  )}
                  {!data.groups.length && !data.other && <p className="underpanel__empty">Nothing in this period.</p>}
                </>
              ) : (
                <div className="cashflows">
                  {data.cashflows.map((c) => (
                    <div key={c.date} className={`cashflow ${c.amount === 0 ? 'cashflow--zero' : ''}`}>
                      <span className="cashflow__date">{dayLabel(c.date)}</span>
                      <span className="cashflow__amt">{c.amount === 0 ? '–' : num0(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
    </aside>
  )
}

function PartyGroup({ rank, group, total, money0 }) {
  const [open, setOpen] = useState(false)
  const share = total ? Math.round((group.amount / total) * 100) : 0
  return (
    <div className={`party ${open ? 'party--open' : ''}`}>
      <button className="party__body" onClick={() => setOpen((o) => !o)}>
        <span className={`party__caret ${open ? 'party__caret--open' : ''}`}>▸</span>
        <span className="party__rank">{rank}</span>
        <span className="party__name">{group.name}</span>
        <span className="party__share">{share}%</span>
        <span className="party__amt">{money0(group.amount)}</span>
      </button>
      <span className="party__bar" style={{ width: `${pct(group.amount, total)}%` }} />
      {open && (
        <div className="party__invoices">
          {group.invoices.map((inv) => (
            <div key={inv.id} className="invrow">
              <span className="invrow__id">{inv.id}</span>
              <span className="invrow__date">{dayLabel(inv.date)}</span>
              <span className="invrow__status">{inv.status}</span>
              <span className="invrow__amt">{money0(inv.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
