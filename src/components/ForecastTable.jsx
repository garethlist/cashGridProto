import { useEffect, useRef, useState } from 'react'
import EditableCell from './EditableCell.jsx'
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
  readOnly,
  canShock = true,
  focus,
  focusActive,
  onFocus,
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
  underlyingCell,
  gridMode = 'base',
  shockRanges = [],
}) {
  const editable = granularity === 'day' && !readOnly
  const { num0, dashNum } = useMoney()
  const { inflowRows, outflowRows, totalInflows, totalOutflows, net, opening, closing } = agg
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

  // a row hides if its section is collapsed or any ancestor group is closed
  const groupHidden = (row) => {
    let p = row.parentPath
    while (p && p.includes('/')) {
      if (closedGroups[p]) return true
      p = p.slice(0, p.lastIndexOf('/'))
    }
    return false
  }

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
          <th className={`grid__rowhead grid__rowhead--corner ${groupMenuOpen ? 'grid__rowhead--menuopen' : ''}`}>
            <span className="rowhead__inner">
              {/* account / pool grids are cuts through company data — no shocks */}
              {canShock && <ModeSwitch value={gridMode} onChange={onGridMode} />}
              <GroupingPicker
                multi={groupMulti}
                onMulti={onGroupMulti}
                single={groupSingle}
                onSingle={onGroupSingle}
                chain={groupChain}
                onChain={onGroupChain}
                disabled={groupDisabled}
                onOpenChange={setGroupMenuOpen}
              />
            </span>
          </th>
          {buckets.map((b) => (
            <th key={b.key} className="grid__colhead">
              {b.label}
            </th>
          ))}
        </tr>
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
            <td key={b.key} className="grid__cell">
              {bi === 0 && !readOnly ? (
                <EditableCell value={state.openingBalance} onChange={onOpeningBalance} />
              ) : (
                <span className="cell cell--strong">{num0(opening[bi])}</span>
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
              focused={focus?.section === 'inflows' && focus?.id === row.id}
              onFocus={() => onFocus('inflows', row.id)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              onOpenModel={onOpenModel}
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
              focused={focus?.section === 'outflows' && focus?.id === row.id}
              onFocus={() => onFocus('outflows', row.id)}
              onAddShock={onAddShock}
              onCellClick={onCellClick}
              onOpenModel={onOpenModel}
              gridMode={gridMode}
              underlyingCell={underlyingCell}
              shockRanges={focus?.section === 'outflows' && focus?.id === row.id ? shockRanges : null}
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

        <tr className="grid__row grid__row--bal grid__row--closing">
          <td className="grid__rowhead">
            <span className="grid__baltitle">Closing balance</span>
          </td>
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

// How the rows under the fixed Inflow/Outflow sections are grouped. Counterparty
// is a placeholder for the groupings still to come.
const GROUPINGS = [
  { id: 'category', label: 'Category', hint: 'One row per forecast category' },
  { id: 'currency', label: 'Currency', hint: 'One row per source currency' },
  { id: 'bankAccount', label: 'Bank account', hint: 'One row per bank account' },
  { id: 'cashPool', label: 'Cash pool', hint: 'Accounts grouped into their pool' },
  { id: 'counterparty', label: 'Counterparty', hint: 'Coming soon', soon: true },
]

function GroupingPicker({ multi, onMulti, single, onSingle, chain, onChain, disabled = {}, onOpenChange }) {
  const [open, setOpen] = useState(false)
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
  // Reorder against the levels that are actually applied, skipping over any
  // retired ones sitting dormant in the chain — otherwise a swap with a dormant
  // neighbour would look like the button did nothing.
  const move = (id, dir) => {
    const li = live.indexOf(id)
    const lj = li + dir
    if (li < 0 || lj < 0 || lj >= live.length) return
    const i = chain.indexOf(id)
    const j = chain.indexOf(live[lj])
    const next = [...chain]
    ;[next[i], next[j]] = [next[j], next[i]]
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
                return (
                  <span key={id} className={`grouprow ${inChain ? 'grouprow--on' : ''} ${off ? 'grouprow--soon' : ''}`}>
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
                    {inChain && live.length > 1 && (
                      <span className="grouprow__moves">
                        <button className="grouprow__move" disabled={pos === 0} onClick={() => move(id, -1)} title="Move up a level" aria-label={`Move ${g.label} up`}>↑</button>
                        <button className="grouprow__move" disabled={pos === live.length - 1} onClick={() => move(id, 1)} title="Move down a level" aria-label={`Move ${g.label} down`}>↓</button>
                      </span>
                    )}
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

          {multi && <span className="grouppick__summary">{summary}</span>}
        </span>
      )}
    </span>
  )
}

// Base ⇄ Shocks, as a small switch with the option named either side. The knob
// slides between them and picks up the shock orange on the right.
function ModeSwitch({ value, onChange }) {
  const shocks = value === 'shocks'
  return (
    <span className={`modeswitch ${shocks ? 'modeswitch--shocks' : ''}`}>
      <button
        className={`modeswitch__opt ${!shocks ? 'modeswitch__opt--on' : ''}`}
        onClick={() => onChange('base')}
        title="Base — click a cell to see the underlying data behind it"
      >
        Base
      </button>
      <button
        className="modeswitch__track"
        role="switch"
        aria-checked={shocks}
        aria-label="Grid mode: Base or Shocks"
        onClick={() => onChange(shocks ? 'base' : 'shocks')}
        title={shocks ? 'Switch to Base mode' : 'Switch to Shocks mode'}
      >
        <span className="modeswitch__knob" />
      </button>
      <button
        className={`modeswitch__opt ${shocks ? 'modeswitch__opt--on' : ''}`}
        onClick={() => onChange('shocks')}
        title="Shocks — click a row to isolate it and add manual shocks"
      >
        Shocks
      </button>
    </span>
  )
}

function SectionHeader({ title, tone, collapsed, onToggle, onAdd, readOnly, values, dashNum, span }) {
  // The whole header row toggles the section; the caret and + keep their own
  // handlers, so ignore clicks that land on a button (they'd double-fire).
  const onRowClick = (e) => {
    if (e.target.closest('button')) return
    onToggle()
  }
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

function LineRow({ hidden, closed, onToggleGroup, section, row, buckets, editable, dashNum, onCell, onRowName, readOnly, focused, onFocus, onAddShock, onCellClick, onOpenModel, gridMode, underlyingCell, shockRanges }) {
  // Grouped rows (e.g. by currency) are roll-ups, not categories: they have no
  // model behind them, no name to edit and nothing to shock.
  const synthetic = !!row.synthetic
  const shocksMode = gridMode === 'shocks' && !synthetic
  // Shocks mode: clicking anywhere on the row drills into it — except on
  // interactive controls (the name field, cell inputs, and the row buttons).
  const onRowClick = (e) => {
    if (!shocksMode) return
    if (e.target.closest('input, textarea, select, button, a')) return
    onFocus()
  }
  return (
    <tr
      className={`grid__row grid__row--item ${focused ? 'grid__row--focused' : ''} ${hidden ? 'grid__row--hidden' : ''}`}
      onClick={onRowClick}
      aria-hidden={hidden || undefined}
    >
      <td className="grid__rowhead grid__rowhead--item">
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
              <input
                className="catcap__name catcap__name--input"
                value={row.name}
                size={Math.max(6, row.name.length)}
                onChange={(e) => onRowName(section, row.id, e.target.value)}
                aria-label="Category name"
              />
            )}
            {/* the model half of the capsule is its own button → model panel */}
            {!synthetic && <button
              className="catcap__btn"
              onClick={(e) => { e.stopPropagation(); onOpenModel(section, row) }}
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
        </span>
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
