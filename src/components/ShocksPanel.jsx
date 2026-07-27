import { useEffect, useRef, useState } from 'react'
import { useMoney } from '../currency.jsx'

// Side panel listing every manual shock. Shocks can be grouped either by the
// category they hit or by the source grid (company/currency or group) they were
// entered on, via a toggle in the panel's top bar. Each shock is a single,
// collapsible row with an inline-editable reason.
export default function ShocksPanel({ open, shocks, days, highlight, activeTab, onGoToSource, onClose, onUpdate, onRemove }) {
  const { symbol } = useMoney()
  const [groupBy, setGroupBy] = useState('category') // 'category' | 'grid'

  const items = Object.entries(shocks).flatMap(([key, arr]) => arr.map((s) => ({ key, s })))
  const total = items.length
  const groups = buildGroups(items, groupBy)

  return (
    <>
      <div className={`drawer-scrim ${open ? 'is-open' : ''}`} onClick={onClose} />
      <aside className={`shockspanel ${open ? 'shockspanel--open' : ''}`} aria-hidden={!open}>
        <header className="shockspanel__head">
          <span className="shockspanel__title">
            Manual shocks
            {total > 0 && <span className="shockspanel__count">{total}</span>}
          </span>
          <button className="iconbtn" title="Close" onClick={onClose}>×</button>
        </header>

        {total > 0 && (
          <div className="shockspanel__toolbar">
            <span className="shockspanel__groupby">Group by</span>
            <span className="seg seg--sm">
              <button className={`seg__btn ${groupBy === 'category' ? 'seg__btn--on' : ''}`} onClick={() => setGroupBy('category')}>Category</button>
              <button className={`seg__btn ${groupBy === 'grid' ? 'seg__btn--on' : ''}`} onClick={() => setGroupBy('grid')}>Grid</button>
            </span>
          </div>
        )}

        <div className="shockspanel__body">
          {total === 0 ? (
            <div className="shockspanel__empty">
              <p>No shocks applied yet.</p>
              <p className="shockspanel__hint">
                Drill into a category (click its row, or the <span className="inlinei">⧗</span> icon), then click a
                period cell — a shock marker appears on hover — to add one here.
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div className="shockgroup" key={g.id}>
                <div className="shockgroup__head">
                  {groupBy === 'grid' ? (
                    <GridBadge source={g.source} />
                  ) : (
                    <>
                      <span className="shockgroup__swatch" style={{ background: g.cat.color }} />
                      <span className="shockgroup__code">{g.cat.code}</span>
                      <span className="shockgroup__name">{g.cat.name}</span>
                    </>
                  )}
                </div>
                {g.items.map(({ key, s }) => (
                  <ShockEditor
                    key={s.id}
                    s={s}
                    itemKey={key}
                    days={days}
                    symbol={symbol}
                    groupBy={groupBy}
                    activeTab={activeTab}
                    onGoToSource={onGoToSource}
                    highlighted={!!highlight && highlight.key === key && highlight.id === s.id}
                    onUpdate={(patch) => onUpdate(key, s.id, patch)}
                    onRemove={() => onRemove(key, s.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  )
}

// Group flattened { key, s } items by category code or by source grid.
function buildGroups(items, groupBy) {
  const map = new Map()
  if (groupBy === 'grid') {
    for (const it of items) {
      const id = it.s.source?.tabId ?? 'unknown'
      if (!map.has(id)) map.set(id, { id, source: it.s.source, items: [] })
      map.get(id).items.push(it)
    }
  } else {
    for (const it of items) {
      const id = it.s.catCode ?? it.key
      if (!map.has(id)) map.set(id, { id, cat: { code: it.s.catCode, name: it.s.catName, color: it.s.catColor }, items: [] })
      map.get(id).items.push(it)
    }
  }
  return [...map.values()]
}

function GridBadge({ source }) {
  if (!source) return <span className="shockgroup__grid">Unknown grid</span>
  const group = source.level === 'group'
  return (
    <span className={`shockgroup__grid ${group ? 'shockgroup__grid--group' : ''}`}>
      {group && <span className="shockgroup__sigma">Σ</span>}
      <span className="shockgroup__co">{source.company}</span>
      <span className="shockgroup__ccy">{source.currency}</span>
    </span>
  )
}

function ShockEditor({ s, itemKey, days, symbol, groupBy, activeTab, onGoToSource, highlighted, onUpdate, onRemove }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (highlighted && ref.current) {
      setOpen(true)
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlighted])
  const active = s.active !== false
  const pct = s.kind === 'pct'
  const shown = pct ? Math.round(s.value * 100) : Math.round(s.value)
  const first = days[0]
  const last = days[days.length - 1]
  const fromISO = days[s.dayStart] ?? first
  const toISO = days[s.dayEnd] ?? last

  const ongoing = s.scope === 'ongoing'
  const setFrom = (iso) => {
    const i = days.indexOf(iso)
    if (i >= 0) onUpdate({ dayStart: ongoing ? i : Math.min(i, s.dayEnd) })
  }
  const setTo = (iso) => {
    const i = days.indexOf(iso)
    if (i >= 0) onUpdate({ dayEnd: Math.max(i, s.dayStart) })
  }

  const abbr = (n) => {
    const a = Math.abs(n)
    const sign = n < 0 ? '-' : ''
    if (a >= 1_000_000) return `${sign}${symbol}${(a / 1_000_000).toFixed(1)}m`
    if (a >= 1_000) return `${sign}${symbol}${Math.round(a / 1000)}k`
    return `${sign}${symbol}${a}`
  }
  const label = pct ? `${shown > 0 ? '+' : ''}${shown}%` : abbr(shown)

  const src = s.source
  const srcCurrent = src && src.tabId === activeTab
  const srcLabel = src ? `${src.company} · ${src.currency}` : null

  return (
    <div className={`shockedit ${highlighted ? 'shockedit--flash' : ''} ${active ? '' : 'shockedit--off'}`} ref={ref}>
      <div className="shockedit__bar">
        <button
          className={`shockedit__caret ${open ? 'shockedit__caret--open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Collapse' : 'Expand'}
          aria-label="Toggle details"
        >
          ▸
        </button>
        <input
          className="shockedit__reasonfield"
          value={s.reason}
          placeholder="Add a reason…"
          onChange={(e) => onUpdate({ reason: e.target.value })}
          aria-label="Shock reason"
        />
        {/* Complementary context chip: the source grid when grouped by category,
            or the category when grouped by grid. */}
        {groupBy === 'grid' ? (
          <span className="shockchip" title={`${s.catCode} · ${s.catName}`}>
            <span className="shockchip__swatch" style={{ background: s.catColor }} />
            {s.catCode}
          </span>
        ) : (
          src && (
            <button
              type="button"
              className={`shocksrc ${src.level === 'group' ? 'shocksrc--group' : ''} ${srcCurrent ? 'shocksrc--current' : ''}`}
              title={srcCurrent ? `Entered on this grid (${srcLabel})` : `Entered on ${srcLabel} — click to open that grid`}
              onClick={() => { if (!srcCurrent && onGoToSource) onGoToSource(src.tabId) }}
            >
              {src.level === 'group' && <span className="shocksrc__sigma">Σ</span>}
              {srcLabel}
            </button>
          )
        )}
        <span className={`shockedit__delta ${shown < 0 ? 'is-neg' : shown > 0 ? 'is-pos' : ''}`}>{label}</span>
        <button
          className={`activebtn ${active ? 'activebtn--on' : ''}`}
          onClick={() => onUpdate({ active: !active })}
          title={active ? 'Active — click to exclude from the forecast' : 'Inactive — click to include in the forecast'}
        >
          {active ? 'Active' : 'Inactive'}
        </button>
        <button className="shockedit__x" onClick={onRemove} title="Remove shock">×</button>
      </div>
      {open && (
        <div className="shockedit__body">
          <div className="shockedit__controls">
            <span className="seg seg--sm">
              <button className={`seg__btn ${pct ? 'seg__btn--on' : ''}`} onClick={() => onUpdate({ kind: 'pct', value: -0.1 })}>%</button>
              <button className={`seg__btn ${!pct ? 'seg__btn--on' : ''}`} onClick={() => onUpdate({ kind: 'abs', value: -50000 })}>{symbol || '£'}</button>
            </span>
            <input
              className="shockedit__num"
              type="number"
              value={shown}
              onChange={(e) => {
                const n = Number(e.target.value)
                onUpdate({ value: pct ? n / 100 : n })
              }}
              aria-label="Shock amount"
            />
            <span className="seg seg--sm">
              <button className={`seg__btn ${!ongoing ? 'seg__btn--on' : ''}`} onClick={() => onUpdate({ scope: 'oneoff', dayEnd: Math.max(s.dayEnd, s.dayStart) })}>One-off</button>
              <button className={`seg__btn ${ongoing ? 'seg__btn--on' : ''}`} onClick={() => onUpdate({ scope: 'ongoing' })}>Ongoing</button>
            </span>
          </div>
          <div className="shockedit__dates">
            <label className="shockedit__date">
              <span>From</span>
              <input type="date" value={fromISO} min={first} max={ongoing ? last : toISO} onChange={(e) => setFrom(e.target.value)} />
            </label>
            {ongoing ? (
              <span className="shockedit__ongoing">→ end of horizon</span>
            ) : (
              <label className="shockedit__date">
                <span>To</span>
                <input type="date" value={toISO} min={fromISO} max={last} onChange={(e) => setTo(e.target.value)} />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
