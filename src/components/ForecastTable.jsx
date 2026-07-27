import { useState } from 'react'
import EditableCell from './EditableCell.jsx'
import CategoryTag from './CategoryTag.jsx'
import ShockIcon from './ShockIcon.jsx'
import { useMoney } from '../currency.jsx'

// The table. Columns == buckets, at the same geometry as the chart above.
// Cells are editable only in Days view (the atomic level); aggregated
// Weeks/Months views show read-only totals.
export default function ForecastTable({
  state,
  buckets,
  agg,
  granularity,
  labelW,
  colW,
  contentW,
  onCell,
  onRowName,
  onOpeningBalance,
  onAddRow,
  onRemoveRow,
  readOnly,
  focus,
  focusActive,
  onFocus,
  onAddShock,
  onCellClick,
  underlyingCell,
  gridMode = 'base',
  shockRanges = [],
}) {
  const editable = granularity === 'day' && !readOnly
  const { num0, dashNum } = useMoney()
  const { inflowRows, outflowRows, totalInflows, totalOutflows, net, opening, closing } = agg
  const [collapsed, setCollapsed] = useState({})
  const toggle = (s) => setCollapsed((c) => ({ ...c, [s]: !c[s] }))

  return (
    <table className={`grid grid--mode-${gridMode} ${focusActive ? 'grid--focusmode' : ''}`} style={{ width: contentW }}>
      <colgroup>
        <col style={{ width: labelW }} />
        {buckets.map((b) => (
          <col key={b.key} style={{ width: colW }} />
        ))}
      </colgroup>

      <thead>
        <tr>
          <th className="grid__rowhead grid__rowhead--corner">
            {editable ? 'Category · daily' : `Category · ${granularity === 'week' ? 'weekly' : 'monthly'}`}
          </th>
          {buckets.map((b) => (
            <th key={b.key} className="grid__colhead">
              {b.label}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {/* Opening balance — first column editable, rest computed */}
        <tr className="grid__row grid__row--summary grid__row--opening">
          <td className="grid__rowhead">Opening balance</td>
          {buckets.map((b, bi) => (
            <td key={b.key} className="grid__cell">
              {bi === 0 && !readOnly ? (
                <EditableCell value={state.openingBalance} onChange={onOpeningBalance} />
              ) : (
                <span className="cell cell--readonly">{num0(opening[bi])}</span>
              )}
            </td>
          ))}
        </tr>

        <SectionHeader
          title="Inflow"
          tone="in"
          collapsed={!!collapsed.inflows}
          onToggle={() => toggle('inflows')}
          onAdd={() => onAddRow('inflows')}
          readOnly={readOnly}
          values={totalInflows}
          dashNum={dashNum}
          span={buckets.length}
        />
        {!collapsed.inflows &&
          inflowRows.map((row) => (
            <LineRow
              key={row.id}
              section="inflows"
              row={row}
              buckets={buckets}
              editable={editable}
              dashNum={dashNum}
              onCell={onCell}
              onRowName={onRowName}
              onRemove={() => onRemoveRow('inflows', row.id)}
              readOnly={readOnly}
              focused={focus?.section === 'inflows' && focus?.id === row.id}
              onFocus={() => onFocus('inflows', row.id)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              gridMode={gridMode}
              underlyingCell={underlyingCell}
              shockRanges={focus?.section === 'inflows' && focus?.id === row.id ? shockRanges : null}
            />
          ))}

        <SectionHeader
          title="Outflow"
          tone="out"
          collapsed={!!collapsed.outflows}
          onToggle={() => toggle('outflows')}
          onAdd={() => onAddRow('outflows')}
          readOnly={readOnly}
          values={totalOutflows}
          dashNum={dashNum}
          span={buckets.length}
        />
        {!collapsed.outflows &&
          outflowRows.map((row) => (
            <LineRow
              key={row.id}
              section="outflows"
              row={row}
              buckets={buckets}
              editable={editable}
              dashNum={dashNum}
              onCell={onCell}
              onRowName={onRowName}
              onRemove={() => onRemoveRow('outflows', row.id)}
              readOnly={readOnly}
              focused={focus?.section === 'outflows' && focus?.id === row.id}
              onFocus={() => onFocus('outflows', row.id)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              gridMode={gridMode}
              underlyingCell={underlyingCell}
              shockRanges={focus?.section === 'outflows' && focus?.id === row.id ? shockRanges : null}
            />
          ))}

        <tr className="grid__row grid__row--summary">
          <td className="grid__rowhead">Net movement</td>
          {net.map((v, bi) => (
            <td key={bi} className="grid__cell">
              <span className={`cell cell--readonly ${v < 0 ? 'is-neg' : ''}`}>{dashNum(v)}</span>
            </td>
          ))}
        </tr>

        <tr className="grid__row grid__row--closing">
          <td className="grid__rowhead">Closing balance</td>
          {closing.map((v, bi) => (
            <td key={bi} className="grid__cell">
              <span className={`cell cell--strong ${v < 0 ? 'is-neg' : ''}`}>{num0(v)}</span>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function SectionHeader({ title, tone, collapsed, onToggle, onAdd, readOnly, values, dashNum, span }) {
  return (
    <tr className={`grid__section grid__section--${tone}`}>
      <td className="grid__rowhead">
        <button className="caret" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          <span className={`caret__icon ${collapsed ? '' : 'caret__icon--open'}`}>▸</span>
        </button>
        <span className={`grid__dot grid__dot--${tone}`} />
        <span className="grid__sectiontitle">{title}</span>
        {!readOnly && (
          <button className="iconbtn iconbtn--add" title={`Add ${title.toLowerCase()} category`} onClick={onAdd}>+</button>
        )}
      </td>
      {values.map((v, bi) => (
        <td key={bi} className="grid__cell">
          <span className="cell cell--section">{dashNum(v)}</span>
        </td>
      ))}
    </tr>
  )
}

function LineRow({ section, row, buckets, editable, dashNum, onCell, onRowName, onRemove, readOnly, focused, onFocus, onAddShock, onCellClick, gridMode, underlyingCell, shockRanges }) {
  const shocksMode = gridMode === 'shocks'
  // Shocks mode: clicking anywhere on the row drills into it — except on
  // interactive controls (the name field, cell inputs, and the row buttons).
  const onRowClick = (e) => {
    if (!shocksMode) return
    if (e.target.closest('input, textarea, select, button, a')) return
    onFocus()
  }
  return (
    <tr
      className={`grid__row grid__row--item ${focused ? 'grid__row--focused' : ''}`}
      onClick={onRowClick}
    >
      <td className="grid__rowhead grid__rowhead--item">
        <span className="rowswatch" style={{ background: row.color }} />
        {readOnly ? (
          <span className="grid__rowname grid__rowname--ro">{row.name}</span>
        ) : (
          <input
            className="grid__rowname"
            value={row.name}
            onChange={(e) => onRowName(section, row.id, e.target.value)}
            aria-label="Category name"
          />
        )}
        <ModelBadge modelled={row.modelled} model={row.model} />
        {shocksMode && (
          <button
            className={`focusbtn ${focused ? 'focusbtn--on' : ''}`}
            title={focused ? 'Drilled into this category — click to return to balance' : 'Drill into this category'}
            aria-pressed={focused}
            onClick={onFocus}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.5" />
              <line x1="20" y1="20" x2="15.6" y2="15.6" />
            </svg>
          </button>
        )}
        {!readOnly && (
          <button className="iconbtn iconbtn--remove" title="Remove category" onClick={onRemove}>×</button>
        )}
      </td>
      {buckets.map((b, bi) => {
        const bStart = b.dayIndices[0]
        const bEnd = b.dayIndices[b.dayIndices.length - 1]
        const hasShock = focused && shockRanges && shockRanges.some((r) => bStart <= r.end && bEnd >= r.start)
        // Base mode: read-only cells can be clicked to inspect their underlying data.
        const inspectable = gridMode === 'base' && !editable
        const isActive = !!underlyingCell && underlyingCell.section === section && underlyingCell.rowId === row.id && underlyingCell.bucketKey === b.key
        return (
          <td
            key={b.key}
            className={`grid__cell ${focused ? 'grid__cell--shockable' : ''} ${inspectable ? 'grid__cell--inspect' : ''} ${isActive ? 'grid__cell--active' : ''}`}
            onClick={inspectable ? () => onCellClick(section, row, b) : undefined}
          >
            {focused && (
              <button
                className={`cellshock ${hasShock ? 'cellshock--on' : ''}`}
                title={hasShock ? 'Shock applied here — open the shocks panel to edit' : `Add a shock in ${b.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddShock(section, row, b)
                }}
              >
                <ShockIcon size={15} />
              </button>
            )}
            {editable ? (
              <EditableCell value={row.bucketValues[bi]} onChange={(val) => onCell(section, row.id, b.dayIndices[0], val)} />
            ) : (
              <span className="cell cell--agg">{dashNum(row.bucketValues[bi])}</span>
            )}
          </td>
        )
      })}
    </tr>
  )
}

// ⚡ for a modelled category, 👤 for a manually-entered one.
function ModelBadge({ modelled, model }) {
  if (!modelled) {
    return (
      <span className="modelbadge modelbadge--manual" title="Manual entry — not modelled">
        <PersonIcon />
        <span className="tag tag--manual">Manual</span>
      </span>
    )
  }
  return (
    <span className="modelbadge" title={model ? `Modelled · ${model.name} · ${model.category}` : 'Modelled'}>
      <BoltIcon />
      {model && <CategoryTag category={model.category} />}
    </span>
  )
}

function BoltIcon() {
  return (
    <svg className="mi mi--bolt" viewBox="0 0 24 24" width="13" height="13" aria-hidden>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg className="mi mi--person" viewBox="0 0 24 24" width="13" height="13" aria-hidden>
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
    </svg>
  )
}
