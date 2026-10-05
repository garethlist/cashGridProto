import { useEffect, useRef, useState } from 'react'
import EditableCell from './EditableCell.jsx'
import ShockIcon from './ShockIcon.jsx'
import { useMoney } from '../currency.jsx'

// The table. Columns == buckets, at the same geometry as the chart above.
// Cells are editable only in Days view (the atomic level); aggregated
// Weeks/Months views show read-only totals.
export default function ForecastTable({
  buckets,
  agg,
  granularity,
  labelW,
  colW,
  contentW,
  onCell,
  onRowName,
  onOpenBalance,
  balanceMode,
  onAddRow,
  readOnly,
  canShock = true,
  selection,
  focusActive,
  singleFocus,
  onFocus,
  onSelectSection,
  onAddShock,
  onCellClick,
  onOpenModel,
  onGridMode,
  groupMulti,
  onGroupMulti,
  groupSingle,
  onGroupSingle,
  groupChain,
  onGroupChain,
  groupDisabled,
  chartStack,
  onChartStack,
  litRow,
  underlyingCell,
  gridMode = 'base',
  stackRow = null,
  todayBucket = 0,
  periodStep,
  periodEdge = { start: false, end: false },
  shockRanges = {},
}) {
  const editable = granularity === 'day' && !readOnly
  const { num0, dashNum } = useMoney()
  const { inflowRows, outflowRows, totalInflows, totalOutflows, net, sweep, hasSweep, opening, closing } = agg
  // children per drill-down parent, so a row only advertises a chart split it can actually draw
  const countKids = (rows) => rows.reduce((m, r) => { if (r.parentPath != null) m[r.parentPath] = (m[r.parentPath] || 0) + 1; return m }, {})
  const inflowKids = countKids(inflowRows)
  // today's opening position is the clickable balance — it opens the bank-account breakdown
  const balAt = todayBucket >= 0 && todayBucket < buckets.length ? todayBucket : 0
  const outflowKids = countKids(outflowRows)
  const [collapsed, setCollapsed] = useState({})
  const toggle = (s) => setCollapsed((c) => ({ ...c, [s]: !c[s] }))
  // collapsed group nodes, keyed by their tree path
  const [closedGroups, setClosedGroups] = useState({})
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const toggleGroup = (path) => setClosedGroups((c) => ({ ...c, [path]: !c[path] }))
  // every parent row across both sections — drives the collapse/expand-all control
  const parentPaths = [...inflowRows, ...outflowRows].filter((r) => r.hasChildren).map((r) => r.path)
  const allClosed = parentPaths.length > 0 && parentPaths.every((p) => closedGroups[p])
  const toggleAllGroups = () =>
    setClosedGroups(allClosed ? {} : Object.fromEntries(parentPaths.map((p) => [p, true])))

  // Which rows are on the chart. Membership is by grid-row id, so it survives
  // collapsing and expanding but not a change of grouping (which rebuilds the ids).
  const selected = new Set((selection ?? []).map((s) => `${s.section}:${s.id}`))
  // Only leaf rows can be selected — a drill-down parent would double-count the
  // children sitting under it.
  // Leaves only — a drill-down parent would double-count its own children. Roll-up
  // leaves count: in most chains the deepest level is a roll-up, and excluding them
  // left Select all with nothing to select.
  const leafIds = (rows) => rows.filter((r) => !r.hasChildren).map((r) => r.id)

  // a row hides if its section is collapsed or any ancestor group is closed
  const groupHidden = (row) => {
    let p = row.parentPath
    while (p && p.includes('/')) {
      if (closedGroups[p]) return true
      p = p.slice(0, p.lastIndexOf('/'))
    }
    return false
  }

  // Grouping lives in a tray inside the grid frame, toggled from the corner.
  // mounted → expanded → settled, and back, so the tray opens and closes on a height animation
  const [trayOpen, setTrayOpen] = useState(false)
  const [trayIn, setTrayIn] = useState(false)
  const [traySettled, setTraySettled] = useState(false)
  const trayT = useRef([])
  useEffect(() => () => trayT.current.forEach(clearTimeout), [])
  const openTray = () => {
    trayT.current.forEach(clearTimeout)
    setTrayOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setTrayIn(true)))
    trayT.current = [setTimeout(() => setTraySettled(true), 320)]
  }
  // hover opens the tray; it closes once the pointer has left both the button and the tray
  const hoverT = useRef(null)
  // click opens; hovering back in keeps it open, and leaving the button + tray closes it
  const trayHoverIn = () => { clearTimeout(hoverT.current) }
  const trayHoverOut = () => { clearTimeout(hoverT.current); if (trayIn) hoverT.current = setTimeout(() => closeTray(), 280) }
  useEffect(() => () => clearTimeout(hoverT.current), [])
  const closeTray = () => {
    trayT.current.forEach(clearTimeout)
    setTraySettled(false)
    setTrayIn(false)
    trayT.current = [setTimeout(() => setTrayOpen(false), 320)]
  }
  return (
    <table className={`grid grid--mode-${gridMode} ${trayOpen ? 'grid--trayopen' : ''} ${focusActive ? 'grid--focusmode' : ''}`} style={{ width: contentW }}>
      <colgroup>
        <col style={{ width: labelW }} />
        {buckets.map((b) => (
          <col key={b.key} style={{ width: colW }} />
        ))}
      </colgroup>

      <thead>
        <tr>
          <th className={`grid__rowhead grid__rowhead--corner ${groupMenuOpen ? 'grid__rowhead--menuopen' : ''}`}>
            <span className="rowhead__inner">
              {/* Row mode charts categories everywhere; on account / pool grids —
                  cuts through company data — it just can't also enter shocks. */}
              <GroupButton
                open={trayIn}
                onToggle={() => (trayIn ? closeTray() : openTray())}
                onHoverIn={trayHoverIn}
                onHoverOut={trayHoverOut}
                levels={groupLevelsOf(groupMulti, groupSingle, groupChain, groupDisabled)}
                stacked={chartStack}
              />
              {periodStep && (
                <span className="cornernav" role="group" aria-label="Move through time">
                  <button className="cornernav__btn cornernav__btn--back" onClick={() => periodStep(-1)} disabled={periodEdge.start} aria-label="Back one period" title="Back one period — towards actuals">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
                  </button>
                  <button className="cornernav__btn cornernav__btn--fwd" onClick={() => periodStep(1)} disabled={periodEdge.end} aria-label="Forward one period" title="Forward one period">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </span>
              )}
            </span>
          </th>
          {buckets.map((b) => (
            <th key={b.key} className="grid__colhead">
              {b.label}
            </th>
          ))}
        </tr>
        {trayOpen && (
          <tr className="grouptray__row">
            <td className="grouptray__cell" colSpan={buckets.length + 1}>
              <div className={`grouptray__wrap ${trayIn ? 'is-in' : ''} ${traySettled ? 'is-settled' : ''}`} onMouseEnter={trayHoverIn} onMouseLeave={trayHoverOut}>
              <div className="grouptray__clip">
              <GroupTray
                onDone={() => setTimeout(closeTray, 160)}
                multi={groupMulti}
                onMulti={onGroupMulti}
                single={groupSingle}
                onSingle={onGroupSingle}
                chain={groupChain}
                onChain={onGroupChain}
                disabled={groupDisabled}
                chartStack={chartStack}
                onChartStack={onChartStack}
                labelW={labelW}
              />
              </div>
              </div>
            </td>
          </tr>
        )}
      </thead>

      <tbody>
        {/* Opening balance — first column editable, rest computed.
            Balance level: bookends the table, paired with Closing balance. */}
        <tr className="grid__row grid__row--bal grid__row--opening">
          <td className="grid__rowhead">
            <span className="rowhead__inner">
              <span className="grid__baltitle">Opening balance</span>
              {/* right-aligned here: close to the rows it acts on, and clear of
                  the tighter corner cell above */}
              {parentPaths.length > 0 && (
                <button
                  className="collapseall"
                  onClick={toggleAllGroups}
                  title={allClosed ? 'Expand all groups' : 'Collapse all groups'}
                  aria-label={allClosed ? 'Expand all groups' : 'Collapse all groups'}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {allClosed ? (
                      <path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" />
                    ) : (
                      <path d="M4.5 3 8 6.5 11.5 3M4.5 13 8 9.5 11.5 13" />
                    )}
                  </svg>
                  {allClosed ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </span>
          </td>
          {buckets.map((b, bi) => (
            /* The first cell is the balance the grid opens on — click it for the
               bank accounts it's made of. The rest just carry it forward. */
            <td key={b.key} className={`grid__cell ${bi === balAt ? 'grid__cell--balcell' : ''} ${bi === balAt && balanceMode === 'opening' ? 'grid__cell--active' : ''}`}>
              {bi === balAt ? (
                <BalanceCell value={opening[bi]} num0={num0} compact={colW < BALCELL_CHEV_MIN_W} mode="opening" active={balanceMode === 'opening'} onOpen={onOpenBalance} />
              ) : (
                <span className={`cell cell--strong ${opening[bi] < 0 ? 'is-neg' : ''}`}>{num0(opening[bi])}</span>
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
          selectable
          selectedCount={leafIds(inflowRows).filter((id) => selected.has(`inflows:${id}`)).length}
          totalCount={leafIds(inflowRows).length}
          onSelectAll={(on) => onSelectSection('inflows', leafIds(inflowRows), on)}
        />
        {inflowRows.map((row) => (
            <LineRow
              key={row.id}
              hidden={!!collapsed.inflows || groupHidden(row)}
              closed={!!closedGroups[row.path]}
              onToggleGroup={() => toggleGroup(row.path)}
              section="inflows"
              row={row}
              buckets={buckets}
              editable={editable}
              dashNum={dashNum}
              onCell={onCell}
              onRowName={onRowName}
              readOnly={readOnly}
              focused={selected.has(`inflows:${row.id}`)}
              singleFocus={singleFocus}
              lit={litRow === row.id}
              canShock={canShock}
              onFocus={() => onFocus('inflows', row)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              onOpenModel={onOpenModel}
              gridMode={gridMode}
              splitOnChart={!!stackRow && stackRow.section === 'inflows' && stackRow.id === row.id}
              canSplit={chartStack}
              kidCount={inflowKids[row.path] || 0}
              underlyingCell={underlyingCell}
              shockRanges={shockRanges[`inflows:${row.id}`] ?? null}
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
          selectable
          selectedCount={leafIds(outflowRows).filter((id) => selected.has(`outflows:${id}`)).length}
          totalCount={leafIds(outflowRows).length}
          onSelectAll={(on) => onSelectSection('outflows', leafIds(outflowRows), on)}
        />
        {outflowRows.map((row) => (
            <LineRow
              key={row.id}
              hidden={!!collapsed.outflows || groupHidden(row)}
              closed={!!closedGroups[row.path]}
              onToggleGroup={() => toggleGroup(row.path)}
              section="outflows"
              row={row}
              buckets={buckets}
              editable={editable}
              dashNum={dashNum}
              onCell={onCell}
              onRowName={onRowName}
              readOnly={readOnly}
              focused={selected.has(`outflows:${row.id}`)}
              singleFocus={singleFocus}
              lit={litRow === row.id}
              canShock={canShock}
              onFocus={() => onFocus('outflows', row)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              onOpenModel={onOpenModel}
              gridMode={gridMode}
              splitOnChart={!!stackRow && stackRow.section === 'outflows' && stackRow.id === row.id}
              canSplit={chartStack}
              kidCount={outflowKids[row.path] || 0}
              underlyingCell={underlyingCell}
              shockRanges={shockRanges[`outflows:${row.id}`] ?? null}
            />
          ))}

        {/* Movement level: the resultant of the Inflow / Outflow groups above,
            so it carries the same dot + caps-label treatment as their headers. */}
        <tr className="grid__row grid__row--move grid__row--net">
          <td className="grid__rowhead">
            <span className="rowhead__inner">
              {/* stands in for the section rows' caret so the dot + label line up */}
              <span className="caret caret--spacer" aria-hidden />
              <span className="grid__dot grid__dot--net" />
              <span className="grid__sectiontitle">Net movement</span>
            </span>
          </td>
          {net.map((v, bi) => (
            <td key={bi} className="grid__cell">
              <span className={`cell cell--section ${v < 0 ? 'is-neg' : ''}`}>{dashNum(v)}</span>
            </td>
          ))}
        </tr>

        {/* Sweep: the end-of-day zero-balancing move, a direct consequence of the
            net movement above. Kept out of the Inflow/Outflow groupings and pinned
            here beside Net movement; it still folds into the closing balance. */}
        {hasSweep && (
          <tr className="grid__row grid__row--move grid__row--sweep">
            <td className="grid__rowhead">
              <span className="rowhead__inner">
                <span className="caret caret--spacer" aria-hidden />
                <span className="grid__dot grid__dot--sweep" />
                <span className="grid__sectiontitle">Sweep</span>
              </span>
            </td>
            {sweep.map((v, bi) => (
              <td key={bi} className="grid__cell">
                <span className={`cell cell--section ${v < 0 ? 'is-neg' : ''}`}>{dashNum(v)}</span>
              </td>
            ))}
          </tr>
        )}

        <tr className="grid__row grid__row--bal grid__row--closing">
          <td className="grid__rowhead">
            <span className="grid__baltitle">Closing balance</span>
          </td>
          {closing.map((v, bi) => {
            // The horizon's last column is where the forecast lands, so that's
            // the cell the closing breakdown hangs off — the mirror of the
            // opening balance's first cell.
            const last = bi === closing.length - 1
            return (
              <td key={bi} className={`grid__cell ${last ? 'grid__cell--balcell' : ''} ${last && balanceMode === 'closing' ? 'grid__cell--active' : ''}`}>
                {last ? (
                  <BalanceCell value={v} num0={num0} compact={colW < BALCELL_CHEV_MIN_W} mode="closing" active={balanceMode === 'closing'} onOpen={onOpenBalance} />
                ) : (
                  <span className={`cell cell--strong ${v < 0 ? 'is-neg' : ''}`}>{num0(v)}</span>
                )}
              </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  )
}

// A balance figure that doubles as the way into its account breakdown. The two
// ends of the horizon carry one each: the opening is actual, the closing forecast
// — the panel draws that distinction, this is just the handle.
// Below this column width a full figure leaves no room for the chevron, and it
// would spill into the neighbouring cell — the hover tint and title carry it.
const BALCELL_CHEV_MIN_W = 84
function BalanceCell({ value, num0, compact, mode, active, onOpen }) {
  const closing = mode === 'closing'
  const noun = closing ? 'closing' : 'opening'
  return (
    <button
      className="cell cell--strong balcell"
      onClick={() => onOpen(mode)}
      aria-expanded={active}
      title={active
        ? `Hide the accounts behind the ${noun} balance`
        : closing
          ? 'Show the forecast account balances this ends on'
          : 'Show the actual account balances this opens on'}
    >
      <span className={value < 0 ? 'is-neg' : undefined}>{num0(value)}</span>
      {!compact && <svg className="balcell__chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>}
    </button>
  )
}

// How the rows under the fixed Inflow/Outflow sections are grouped. Counterparty
// is a placeholder for the groupings still to come.
const GROUPINGS = [
  { id: 'category', label: 'Category', hint: 'One row per forecast category' },
  { id: 'currency', label: 'Currency', hint: 'One row per source currency' },
  { id: 'bankAccount', label: 'Bank account', hint: 'One row per bank account' },
  { id: 'cashPool', label: 'Cash pool', hint: 'Accounts grouped into their pool' },
  { id: 'sourceType', label: 'Source type', hint: 'Where the flow came from' },
  { id: 'counterparty', label: 'Counterparty', hint: 'Coming soon', soon: true },
]

function GroupingPicker({ multi, onMulti, single, onSingle, chain, onChain, disabled = {}, onOpenChange, chartStack = true, onChartStack }) {
  const [open, setOpen] = useState(false)
  // Drag-to-reorder state for the drill-down levels: the level being dragged and
  // the one it's hovering over (for the drop indicator).
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  useEffect(() => { onOpenChange?.(open) }, [open, onOpenChange])
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const labelOf = (id) => GROUPINGS.find((g) => g.id === id)?.label ?? id
  // A grouping is off either because it isn't built yet, or because the grid
  // you're on has collapsed it to a single row. Both read the same in the menu,
  // with the reason standing in for the hint.
  const offReason = (g) => (g.soon ? g.hint : disabled[g.id] ?? null)
  // Your selection survives navigation, but a retired level isn't applied — so
  // the level numbers, the count badge and the summary all track the levels that
  // actually run, not the ones merely chosen.
  const live = chain.filter((id) => !disabled[id])
  const applied = multi ? (live.length ? live : ['category']) : [disabled[single] ? 'category' : single]
  const summary = applied.map(labelOf).join(' → ')

  // In multi mode a grouping can be added to / removed from the chain; the last
  // level that's actually running can't be removed or there'd be nothing to
  // group by.
  const toggleInChain = (id) => {
    if (chain.includes(id)) {
      if (live.length > 1 || !live.includes(id)) onChain(chain.filter((x) => x !== id))
    } else {
      onChain([...chain, id])
    }
  }
  // Drag one applied level onto another to drop it into that slot. The reorder
  // runs against the levels actually applied, skipping over any retired ones
  // sitting dormant in the chain, then writes the new order back into the live
  // slots of `chain` — leaving the dormant levels anchored where they sit.
  const reorder = (from, to) => {
    if (!from || from === to) return
    if (live.indexOf(from) < 0 || live.indexOf(to) < 0) return
    const seq = live.filter((id) => id !== from)
    seq.splice(seq.indexOf(to), 0, from)
    const slots = chain.map((id, i) => (disabled[id] ? -1 : i)).filter((i) => i >= 0)
    const next = [...chain]
    slots.forEach((slot, k) => { next[slot] = seq[k] })
    onChain(next)
  }

  return (
    <span className={`grouppick ${open ? 'grouppick--open' : ''}`} ref={ref}>
      <button
        className={`grouppick__btn ${applied.length > 1 || applied[0] !== 'category' ? 'grouppick__btn--on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Grouped by ${summary} — change grouping`}
      >
        {/* stacked rows with a grouping bracket */}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M2 3.5h12M5 8h9M5 12.5h9M2 3.5v9" />
        </svg>
        {/* fixed label — the corner cell is tight, and the chain can get long.
            The chain itself is in the tooltip and spelled out in the menu. */}
        <span className="grouppick__label">Group</span>
        {multi && applied.length > 1 && <span className="grouppick__count">{applied.length}</span>}
      </button>

      {open && (
        <span className="grouppick__menu">
          <span className="grouppick__modes">
            <span className="seg seg--sm">
              <button className={`seg__btn ${!multi ? 'seg__btn--on' : ''}`} onClick={() => onMulti(false)}>Single</button>
              <button className={`seg__btn ${multi ? 'seg__btn--on' : ''}`} onClick={() => onMulti(true)}>Drill-down</button>
            </span>
          </span>
          <span className="grouppick__head">{multi ? 'Levels, outermost first' : 'Group rows by'}</span>

          {multi
            /* chain order first, then anything not yet in the chain */
            ? [...chain, ...GROUPINGS.map((g) => g.id).filter((id) => !chain.includes(id))].map((id, idx) => {
                const g = GROUPINGS.find((x) => x.id === id)
                if (!g) return null
                const off = offReason(g)
                // A retired level can still be in the chain — it just isn't
                // running, so it shows no level number and no reorder arrows.
                const inChain = chain.includes(id) && !off
                const pos = live.indexOf(id)
                const dragging = dragId === id
                const draggable = inChain && live.length > 1
                return (
                  /* The whole row is the drag handle, not just the grip — the
                     grip stays as the affordance. A click that didn't turn into
                     a drag still falls through to the button below. */
                  <span
                    key={id}
                    className={`grouprow ${inChain ? 'grouprow--on' : ''} ${off ? 'grouprow--soon' : ''} ${draggable ? 'grouprow--draggable' : ''} ${dragging ? 'grouprow--dragging' : ''} ${overId === id && dragId && !dragging ? 'grouprow--drop' : ''}`}
                    draggable={draggable}
                    onDragStart={draggable ? (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) } : undefined}
                    onDragEnd={draggable ? () => { setDragId(null); setOverId(null) } : undefined}
                    onDragOver={draggable && dragId && !dragging ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(id) } : undefined}
                    onDragLeave={draggable ? () => setOverId((o) => (o === id ? null : o)) : undefined}
                    onDrop={draggable ? (e) => { e.preventDefault(); reorder(e.dataTransfer.getData('text/plain') || dragId, id); setDragId(null); setOverId(null) } : undefined}
                  >
                    {draggable && (
                      <span className="grouprow__grip" title="Drag anywhere on this row to reorder" aria-hidden>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                          <circle cx="6" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" />
                          <circle cx="6" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" />
                          <circle cx="6" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" />
                        </svg>
                      </span>
                    )}
                    <button
                      className="grouprow__pick"
                      disabled={!!off}
                      aria-pressed={inChain}
                      onClick={() => { if (!off) toggleInChain(id) }}
                      title={off || (inChain ? `Remove ${g.label} from the drill-down` : `Add ${g.label} to the drill-down`)}
                    >
                      <span className={`grouprow__level ${inChain ? '' : 'grouprow__level--off'}`}>{inChain ? pos + 1 : '—'}</span>
                      <span className="grouprow__main">
                        <span className="grouprow__label">{g.label}</span>
                        <span className="grouprow__hint">{off || g.hint}</span>
                      </span>
                    </button>
                  </span>
                )
              })
            : GROUPINGS.map((g) => {
                const off = offReason(g)
                return (
                  <button
                    key={g.id}
                    className={`grouprow grouprow--single ${g.id === single ? 'grouprow--on' : ''} ${off ? 'grouprow--soon' : ''}`}
                    role="option"
                    aria-selected={g.id === single}
                    disabled={!!off}
                    title={off || undefined}
                    onClick={() => { if (!off) { onSingle(g.id); setOpen(false) } }}
                  >
                    <span className="grouprow__main">
                      <span className="grouprow__label">{g.label}</span>
                      <span className="grouprow__hint">{off || g.hint}</span>
                    </span>
                    {g.id === single && <span className="grouprow__tick" aria-hidden>✓</span>}
                  </button>
                )
              })}

          {/* The chart follows the chain's first two levels, so the switch for it
              belongs with the levels rather than out on the chart. Only offered
              when there are two levels running for it to act on. */}
          {multi && applied.length > 1 && (
            <button
              className={`groupstack ${chartStack ? 'groupstack--on' : ''}`}
              role="switch"
              aria-checked={chartStack}
              onClick={() => onChartStack?.(!chartStack)}
              title={
                chartStack
                  ? `Selecting a ${labelOf(applied[0])} row splits it by ${labelOf(applied[1])} on the chart — click to turn off`
                  : 'Selected rows chart as a single net flow line — click to split them on the chart'
              }
            >
              <span className="groupstack__box" aria-hidden>
                {chartStack && (
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5 4.8 9.2 10 3.4" />
                  </svg>
                )}
              </span>
              <span className="groupstack__main">
                <span className="groupstack__label">Stack on chart</span>
                <span className="groupstack__hint">A {labelOf(applied[0]).toLowerCase()} row splits by {labelOf(applied[1]).toLowerCase()}</span>
              </span>
            </button>
          )}

          {multi && <span className="grouppick__summary">{summary}</span>}
        </span>
      )}
    </span>
  )
}

// Cell ⇄ Row, as a small switch with the option named either side. The knob
// slides between them and picks up the shock orange on the right.
function ModeSwitch({ value, onChange, canShock = true }) {
  const shocks = value === 'shocks'
  const rowTip = canShock
    ? 'Row — click rows to chart their combined flow, and add manual shocks'
    : 'Row — click rows to chart their combined flow'
  return (
    <span className={`modeswitch ${shocks ? 'modeswitch--shocks' : ''}`}>
      <button
        className={`modeswitch__opt ${!shocks ? 'modeswitch__opt--on' : ''}`}
        onClick={() => onChange('base')}
        title="Cell — click a cell to see the underlying data behind it"
      >
        Cell
      </button>
      <button
        className="modeswitch__track"
        role="switch"
        aria-checked={shocks}
        aria-label="Grid mode: Cell or Row"
        onClick={() => onChange(shocks ? 'base' : 'shocks')}
        title={shocks ? 'Switch to Cell mode' : 'Switch to Row mode'}
      >
        <span className="modeswitch__knob" />
      </button>
      <button
        className={`modeswitch__opt ${shocks ? 'modeswitch__opt--on' : ''}`}
        onClick={() => onChange('shocks')}
        title={rowTip}
      >
        Row
      </button>
    </span>
  )
}

function SectionHeader({ title, tone, collapsed, onToggle, onAdd, readOnly, values, dashNum, span, selectable, selectedCount = 0, totalCount = 0, onSelectAll }) {
  // The whole header row toggles the section; the caret and + keep their own
  // handlers, so ignore clicks that land on a button (they'd double-fire).
  const onRowClick = (e) => {
    if (e.target.closest('button')) return
    onToggle()
  }
  const all = totalCount > 0 && selectedCount === totalCount
  const some = selectedCount > 0 && !all
  return (
    <tr className={`grid__section grid__section--${tone}`} onClick={onRowClick}>
      <td className="grid__rowhead">
        <span className="rowhead__inner">
          <button className="caret" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
            <svg
              className={`caret__icon ${collapsed ? '' : 'caret__icon--open'}`}
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
          <span className={`grid__dot grid__dot--${tone}`} />
          <span className="grid__sectiontitle">{title}</span>
          {!readOnly && (
            <button className="iconbtn iconbtn--add" title={`Add ${title.toLowerCase()} category`} onClick={onAdd}>+</button>
          )}
          {/* Row mode: put the whole section on the chart in one go — the quickest
              route to the operational flow, since the Sweep row sits outside both
              sections and so is never swept up by it. Right-aligned, with its box
              last, so it heads the column of row checkboxes beneath it. */}
          {selectable && totalCount > 0 && (
            <button
              className={`selectall ${all ? 'selectall--on' : ''} ${some ? 'selectall--some' : ''}`}
              onClick={(e) => { e.stopPropagation(); onSelectAll(!all) }}
              aria-pressed={all}
              title={all ? `Remove all ${title.toLowerCase()} categories from the chart` : `Add all ${totalCount} ${title.toLowerCase()} categories to the chart`}
            >
              {all ? 'All selected' : some ? `${selectedCount} of ${totalCount}` : 'Select all'}
              <span className="tickbox" aria-hidden>{all ? '✓' : some ? '–' : ''}</span>
            </button>
          )}
        </span>
      </td>
      {values.map((v, bi) => (
        <td key={bi} className="grid__cell">
          <span className="cell cell--section">{dashNum(v)}</span>
        </td>
      ))}
    </tr>
  )
}

function LineRow({ kidCount = 0, canSplit = false, splitOnChart = false, hidden, closed, onToggleGroup, section, row, buckets, editable, dashNum, onCell, onRowName, readOnly, focused, singleFocus, lit, canShock, onFocus, onAddShock, onCellClick, onOpenModel, gridMode, underlyingCell, shockRanges }) {
  // Grouped rows (e.g. by currency) are roll-ups, not categories: they have no
  // model behind them, no name to edit and nothing to shock.
  const synthetic = !!row.synthetic
  // Row mode does two jobs, and they don't have the same reach. Anything the grid
  // draws can go on the chart, roll-ups included — that's how a drill-down level
  // gets charted, and how the chart composition finds a parent to split. Shocks
  // are narrower: they're written back to one category of one company, so a
  // roll-up has nowhere to put them.
  // No mode switch: the click target decides. The label gutter selects the row
  // (charting it, and arming shocks); a cell opens the data underneath it.
  const rowMode = true
  const shockable = focused && singleFocus && canShock && !synthetic
  const onRowClick = (e) => {
    if (e.target.closest('input, textarea, select, button, a')) return
    onFocus()
  }
  return (
    <tr
      className={`grid__row grid__row--item ${focused ? 'grid__row--focused' : ''} ${lit ? 'grid__row--lit' : ''} ${hidden ? 'grid__row--hidden' : ''}`}
      aria-hidden={hidden || undefined}
    >
      <td className="grid__rowhead grid__rowhead--item grid__rowhead--pick" onClick={onRowClick} title={focused ? 'On the chart — click to take it off' : 'Click to chart this row'}>
        <span className="rowhead__inner" style={row.depth ? { paddingLeft: row.depth * 18 } : undefined}>
          {/* parent rows in a drill-down chain get their own disclosure */}
          {row.hasChildren ? (
            <button
              className="caret"
              onClick={(e) => { e.stopPropagation(); onToggleGroup() }}
              aria-expanded={!closed}
              title={closed ? 'Expand' : 'Collapse'}
            >
              <svg className={`caret__icon ${closed ? '' : 'caret__icon--open'}`} viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>
          ) : row.depth > 0 ? (
            <span className="caret caret--spacer" aria-hidden />
          ) : null}
          {/* colour-coded capsule: dot · name · model (revealed on hover) · type icon */}
          <span className={`catcap ${row.modelled ? '' : 'catcap--manual'}`}>
            <span
              className={`catcap__dot ${row.color ? '' : 'catcap__dot--plain'}`}
              style={row.color ? { background: row.color } : undefined}
            />
            {readOnly || synthetic ? (
              <span className="catcap__name">{row.name}</span>
            ) : (
              /* The wrapper carries the value so the field can size to its text.
                 Sizing by character count instead put the model icon 16–22px
                 further right on an editable grid than on a read-only one. */
              <span className="catcap__namefit" data-value={row.name}>
                <input
                  className="catcap__name catcap__name--input"
                  value={row.name}
                  /* an input's intrinsic width is its `size` (20 by default), which
                     would set the grid track instead of the mirrored text */
                  size={1}
                  onChange={(e) => onRowName(section, row.id, e.target.value)}
                  aria-label="Category name"
                />
              </span>
            )}
            {/* the model half of the capsule is its own button → model panel */}
            {!synthetic && <button
              className="catcap__btn"
              onClick={(e) => { e.stopPropagation() /* model panel parked for now */ }}
              title={row.modelled ? `${row.model?.name ?? 'Model'} — view model details` : 'Manual entry — view details'}
              aria-label={`${row.name}: ${row.modelled ? row.model?.name ?? 'model' : 'manual entry'} — view details`}
            >
              <span className={`catcap__model ${row.model ? tagClass(row.model.category) : 'catcap__model--manual'}`}>
                <span className="catcap__modeltext">{row.model ? row.model.name : 'Manual entry'}</span>
              </span>
              <span className="catcap__icon">
                {row.modelled ? <BoltIcon /> : <PersonIcon />}
              </span>
            </button>}
          </span>
          {!splitOnChart && canSplit && row.depth === 0 && row.hasChildren && (
            <span className={`rowsplit rowsplit--ghost ${kidCount < 2 ? 'rowsplit--flat' : ''}`} title={kidCount < 2 ? 'Only one value beneath — nothing to split on the chart' : 'Select to split this row on the chart'} aria-hidden>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18" /><path d="M4 16l5-6 4 4 7-8" /></svg>
              Split
            </span>
          )}
          {splitOnChart && (
            <span className="rowsplit" title="Split on the chart by the next level">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 20h18" /><path d="M4 16l5-6 4 4 7-8" /></svg>
              Split
            </span>
          )}
          {rowMode && (
            /* The row is a selection toggle now, not a drill-in, so it carries the
               same tickbox as the section's Select all — right-aligned, so the
               boxes read as one column down the label gutter. */
            <button
              className={`focusbtn ${focused ? 'focusbtn--on' : ''}`}
              title={focused ? 'On the chart — click to take it off' : 'Add this category to the chart'}
              aria-pressed={focused}
              onClick={onFocus}
            >
              <span className="tickbox" aria-hidden>{focused ? '✓' : ''}</span>
            </button>
          )}
        </span>
      </td>
      {buckets.map((b, bi) => {
        const bStart = b.dayIndices[0]
        const bEnd = b.dayIndices[b.dayIndices.length - 1]
        const hasShock = shockable && shockRanges && shockRanges.some((r) => bStart <= r.end && bEnd >= r.start)
        // Base mode: read-only cells can be clicked to inspect their underlying data.
        const inspectable = !editable
        const isActive = !!underlyingCell && underlyingCell.section === section && underlyingCell.rowId === row.id && underlyingCell.bucketKey === b.key
        return (
          <td
            key={b.key}
            className={`grid__cell ${shockable ? 'grid__cell--shockable' : ''} ${inspectable ? 'grid__cell--inspect' : ''} ${isActive ? 'grid__cell--active' : ''}`}
            onClick={inspectable ? () => onCellClick(section, row, b) : undefined}
          >
            {shockable && (
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

// Tints the revealed model name by its catalogue category, so the
// Statistical / Custom R&D / ML-AI split survives losing the tag pills.
const tagClass = (category) =>
  category === 'Statistical' ? 'tag--stat' : category === 'ML/AI' ? 'tag--ml' : 'tag--rnd'

// ⚡ for a modelled category, 👤 for a manually-entered one.
function BoltIcon() {
  return (
    <svg className="mi mi--bolt" viewBox="0 0 24 24" width="15" height="15" aria-hidden>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg className="mi mi--person" viewBox="0 0 24 24" width="15" height="15" aria-hidden>
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
    </svg>
  )
}


// ---- grouping tray ----------------------------------------------------------
// One level is a plain grouping; two or more is a drill-down — so there's no
// mode to pick. The tray opens inside the grid frame under the header row.
const MAX_GROUP_LEVELS = 3
const groupLevelsOf = (multi, single, chain, disabled = {}) => {
  if (!multi) return [disabled[single] ? 'category' : single]
  const live = chain.filter((id) => !disabled[id])
  return live.length ? live : ['category']
}
const glabel = (id) => GROUPINGS.find((g) => g.id === id)?.label ?? id

function GroupButton({ open, onToggle, levels, stacked, onHoverIn, onHoverOut }) {
  const summary = levels.map(glabel).join(' → ')
  return (
    <span className="groupbtn" onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}>
      <button className={`groupbtn__btn ${open ? 'groupbtn__btn--on' : ''}`} onClick={onToggle} aria-expanded={open} title={`Grouped by ${summary}`}>
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M2 3.5h12M5 8h9M5 12.5h9M2 3.5v9" /></svg>
        <span className="groupbtn__text"><span className="groupbtn__by">Group by&nbsp;</span>{levels.map((id) => glabel(id).toLowerCase()).join(' → ')}</span>
        <svg className="groupbtn__chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </span>
  )
}

function GroupTray({ multi, onMulti, single, onSingle, chain, onChain, disabled = {}, chartStack, onChartStack, labelW, onDone }) {
  const levels = groupLevelsOf(multi, single, chain, disabled)
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  const [pick, setPick] = useState(false)
  const [w, setW] = useState(null)
  const [insetR, setInsetR] = useState(null) // right edge lands on the row checkboxes' right edge
  const [inset, setInset] = useState(null) // the grid's own label inset, so Levels starts where OPENING BALANCE does
  const ref = useRef(null)
  const pickRef = useRef(null)
  // stays the width of the visible grid while the columns scroll beneath it
  useEffect(() => {
    const scroller = ref.current?.closest('.aligned__scroll')
    if (!scroller) return undefined
    // Insets are taken from the Levels column's own box against the grid rows below, so
    // any offset between the pinned tray and the scrolled table cancels out.
    const measure = () => {
      // Sticky can only pin the tray while the table still spans the viewport. In Months the
      // grid can be scrolled so the table ends a few px short of the right edge (the column
      // slack), and a full-width tray would be shoved left by that much — so cap it to the table.
      const table = ref.current?.closest('table')
      const sR = scroller.getBoundingClientRect()
      const span = table ? Math.floor(table.getBoundingClientRect().right - sR.left) : scroller.clientWidth
      setW(Math.max(0, Math.min(scroller.clientWidth, span)))
      const lv = ref.current?.querySelector('.grouptray__levels')
      const head = scroller.querySelector('.grid__row--bal .grid__rowhead .rowhead__inner')
      const tick = scroller.querySelector('.grid__row--item .tickbox, .grid__section .tickbox')
      if (!lv) return
      const L = lv.getBoundingClientRect()
      if (head) setInset(Math.max(0, Math.round(head.getBoundingClientRect().left - L.left)))
      if (tick) setInsetR(Math.max(0, Math.round(L.right - tick.getBoundingClientRect().right)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    scroller.addEventListener('scroll', measure, { passive: true })
    const settle = setTimeout(measure, 360)
    return () => { ro.disconnect(); scroller.removeEventListener('scroll', measure); clearTimeout(settle) }
  }, [])
  useEffect(() => {
    if (!pick) return undefined
    const onDoc = (e) => { if (pickRef.current && !pickRef.current.contains(e.target)) setPick(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pick])

  const apply = (next) => {
    if (next.length === 1) { onSingle(next[0]); onMulti(false) }
    else {
      if (levels.length === 1) onChartStack?.(true) // a second level arrives with the chart split on
      onChain(next); onMulti(true)
    }
  }
  const remove = (id) => { if (levels.length > 1) apply(levels.filter((x) => x !== id)) }
  const add = (id) => { if (levels.length < MAX_GROUP_LEVELS) apply([...levels, id]) }
  const reorder = (from, to) => {
    if (!from || from === to) return
    const next = levels.filter((x) => x !== from)
    next.splice(next.indexOf(to) + (levels.indexOf(from) < levels.indexOf(to) ? 1 : 0), 0, from)
    apply(next)
  }
  const reason = (g) => (g.soon ? g.hint : disabled[g.id] ?? null)
  const avail = GROUPINGS.filter((g) => !levels.includes(g.id))
  const split = levels.length > 1 && chartStack

  return (
    <div className="grouptray" ref={ref} style={{ ...(w ? { width: w } : {}), gridTemplateColumns: labelW ? `${labelW}px minmax(0, 1fr)` : undefined }}>
      <div className="grouptray__levels" >
        <span className="grouptray__micro">Levels</span>
        {levels.map((id, i) => (
          <div
            key={id}
            className={`gtlevel ${drag === id ? 'gtlevel--drag' : ''} ${over === id && drag && drag !== id ? 'gtlevel--over' : ''}`}
            draggable={levels.length > 1}
            onDragStart={(e) => { try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move' } catch (err) { /* ignore */ } setDrag(id) }}
            onDragOver={(e) => { e.preventDefault(); if (over !== id) setOver(id) }}
            onDrop={(e) => { e.preventDefault(); reorder(drag, id); setDrag(null); setOver(null) }}
            onDragEnd={() => { setDrag(null); setOver(null) }}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="gtlevel__grip" aria-hidden>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></svg>
            </span>
            <span className="gtlevel__n">{i + 1}</span>
            <span className="gtlevel__main">
              {levels.length === 1 ? (
                <span className="gtpick" ref={pickRef}>
                  <button className={`gtpick__btn ${pick ? 'gtpick__btn--on' : ''}`} onClick={() => setPick((p) => !p)} aria-haspopup="listbox" aria-expanded={pick}>
                    {glabel(id)}
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {pick && (
                    <span className="gtpick__menu" role="listbox">
                      <span className="grouptray__micro gtpick__head">Group rows by</span>
                      {GROUPINGS.map((g) => {
                        const off = reason(g)
                        return (
                          <button key={g.id} role="option" aria-selected={g.id === id} disabled={!!off} className={`gtpick__opt ${g.id === id ? 'gtpick__opt--on' : ''}`} onClick={() => { if (!off) { apply([g.id]); setPick(false); onDone?.() } }} title={off || undefined}>
                            <span className="gtpick__tick" aria-hidden><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
                            <span className="gtpick__text"><span className="gtpick__label">{g.label}</span><span className="gtpick__hint">{off || g.hint}</span></span>
                          </button>
                        )
                      })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="gtlevel__label">{glabel(id)}</span>
              )}
              {split && i < 2 && (
                <span className="gtlevel__chart" title={i === 0 ? `Selecting a ${glabel(id).toLowerCase()} row charts it` : `…split by ${glabel(id).toLowerCase()} on the chart`}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 20h18" /><path d="M4 16l5-6 4 4 7-8" /></svg>
                  {i === 0 ? 'Chart' : 'Split'}
                </span>
              )}
            </span>
            {levels.length > 1 && (
              <button className="gtlevel__x" onClick={() => remove(id)} aria-label={`Remove ${glabel(id)}`}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        ))}
        {levels.length > 1 && (
          <button className={`gtsplit ${chartStack ? 'gtsplit--on' : ''}`} role="switch" aria-checked={chartStack} onClick={() => onChartStack?.(!chartStack)}>
            <span className="gtsplit__track" aria-hidden><span className="gtsplit__knob" /></span>
            Split each {glabel(levels[0]).toLowerCase()} by {glabel(levels[1]).toLowerCase()} on the chart
          </button>
        )}
      </div>
      <div className="grouptray__add">
        <span className="grouptray__micro grouptray__addhead">
          Add a level
          <span className="gtinfo" tabIndex={0} aria-label="About levels">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.01" /></svg>
            <span className="gtinfo__tip" role="tooltip">One level is a plain grouping. Add more to drill down; the first two levels also drive the chart split.</span>
          </span>
        </span>
        <div className="grouptray__chips">
          {levels.length < MAX_GROUP_LEVELS && avail.map((g) => {
            const off = reason(g)
            return (
              <button key={g.id} className="gtchip" disabled={!!off} title={off || g.hint} onClick={() => add(g.id)}>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                {g.label}
              </button>
            )
          })}
          {levels.length >= MAX_GROUP_LEVELS && <span className="grouptray__note">Three levels is the limit — remove one to add another.</span>}
        </div>
      </div>
    </div>
  )
}
