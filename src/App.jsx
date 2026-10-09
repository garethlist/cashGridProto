import { useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { computeDaily, bucketize, aggregateGrouped, GROUP_LEVELS, CASH_POOLS, consolidate, applyShocks, shockState, scopeState, levelKeys, cellUnderlying, modelDetail, uid, monthOrdinals, findFlowOutliers, attributeOutlier, SCENARIOS, SOURCE_TYPE_UNSET } from './model.js'
import {
  BASE_CCY, SUMMARY, CCY_SYMBOL, GROUP_CURRENCIES, ENTITIES, buildEntityStates,
  CCY_LOCALE, CCY_FX, ALL_ACCOUNTS, ALL_POOLS, VIEW_DIMS, acctTab, poolTab, resolveView, EUR_SWEEP,
  CONTRIB_COLORS, accountBalances, fxConv, TODAY_ISO,
} from './views.js'
import AlignedChart from './components/AlignedChart.jsx'
import ForecastTable from './components/ForecastTable.jsx'
import ShocksPanel from './components/ShocksPanel.jsx'
import UnderlyingPanel from './components/UnderlyingPanel.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import BalancePanel from './components/BalancePanel.jsx'
import OutlierPanel from './components/OutlierPanel.jsx'
import ShockIcon from './components/ShockIcon.jsx'
import FinderIcon from './components/FinderIcon.jsx'
import OutlierIcon from './components/OutlierIcon.jsx'
import CategoryTag from './components/CategoryTag.jsx'
import { CurrencyProvider, useMoney } from './currency.jsx'
import { useGridNav, AcctBadge } from './components/GridNav.jsx'
import brandMarkDark from './assets/brand-mark-dark.svg'
import brandMarkLight from './assets/brand-mark-light.svg'

// Shared column geometry — the single source of alignment between chart & table.
// Wide enough for the row name plus its badges/controls once the full-bleed
// table's left gutter inset is taken off.
// Category column width. Draggable via the splitter on the chart/table divider,
// clamped so neither the labels nor the data columns can be squeezed out.
const LABEL_W_DEFAULT = 320
const LABEL_W_MIN = 200
const LABEL_W_MAX = 560
const CHART_H = 380

// How many columns should fill the window by default, per granularity.
const TARGET_COLS = { day: 14, week: 13, month: 12 }
// Floor so columns never collapse on a narrow window (then it scrolls instead).
const MIN_COL_W = { day: 46, week: 64, month: 88 }

// How many selected categories the header names before it collapses the rest to
// a count. The header shares the title's line, so it can't be allowed to grow.
const HEAD_CHIPS = 3

const GRANULARITIES = [
  { key: 'day', label: 'Days' },
  { key: 'week', label: 'Weeks' },
  { key: 'month', label: 'Months' },
]

// Track the available width of an element (excludes scrollbar), live on resize.
// side-panel slide length — the page's reserve animates in lockstep with it
const PANEL_MS = 240

function useMeasuredWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  // while a panel slides, the width is set once to its end value and the
  // per-frame resize readings are ignored, so the chart + grid render once
  const frozen = useRef(false)
  const onMeasure = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // first measure is urgent; later ones (panels docking, window resizes) are
    // transitions, so the panel's slide starts at once and the big re-layout of
    // chart + grid happens behind it without blocking input
    const update = () => { if (!frozen.current) { onMeasure.current?.(); setWidth(el.clientWidth) } }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width, setWidth, frozen, onMeasure]
}

export default function App() {
  // One dataset per entity; SUMMARY is derived (a consolidation), not stored.
  const [tabStates, setTabStates] = useState(() => buildEntityStates())
  const [activeTab, setActiveTab] = useState('summary')
  const [groupCurrency, setGroupCurrency] = useState(BASE_CCY) // display currency for the GROUP tab
  const view = useMemo(() => resolveView(activeTab), [activeTab])
  const isSummary = view.kind === 'group'
  // Bank-account and cash-pool grids are cuts through the entity data, not stores
  // of their own — read-only, like GROUP.
  const isScoped = view.kind === 'account' || view.kind === 'pool' || view.kind === 'cut'
  const groupCcy = GROUP_CURRENCIES.find((c) => c.code === groupCurrency) ?? GROUP_CURRENCIES[0]

  // Live consolidation of every entity, expressed in the chosen group currency.
  const consolidated = useMemo(
    () => consolidate(ENTITIES.map((e) => ({ state: tabStates[e.id], fx: e.fx })), groupCcy.fx),
    [tabStates, groupCcy.fx]
  )

  // Active display currency/locale (group tab can be re-denominated).
  const displayCurrency = isSummary ? groupCcy.code : view.currency
  const displayLocale = isSummary ? groupCcy.locale : view.locale

  // The entities feeding this grid, each with a converter into the display
  // currency. One source per entity, so grouping can still separate them.
  const viewSources = useCallback(
    (states) => {
      const outFx = CCY_FX[displayCurrency] ?? 1
      return view.entityIds.map((id) => {
        const e = ENTITIES.find((x) => x.id === id)
        return { meta: { currency: e.currency }, state: states[id], fx: e.fx, conv: fxConv(e.fx, outFx) }
      })
    },
    [view.entityIds, displayCurrency]
  )

  const state = useMemo(() => {
    if (isSummary) return consolidated
    if (isScoped) return scopeState(viewSources(tabStates), view.accountIds)
    return tabStates[activeTab]
  }, [isSummary, isScoped, consolidated, viewSources, tabStates, view.accountIds, activeTab])

  // Only company grids are stores. GROUP and the account/pool cuts are derived,
  // so they're read-only — edits happen on the company grids they draw from.
  const readOnly = isSummary || isScoped
  // Which grid an edit writes to, held in a ref so setState — and the edit
  // callbacks built on it — never go stale. Capturing `activeTab` in a dependency
  // array instead freezes those callbacks on whichever tab was open when they were
  // created, which silently swallows every edit.
  const editTargetRef = useRef(null)
  editTargetRef.current = readOnly ? null : activeTab
  const setState = useCallback((updater) => {
    const target = editTargetRef.current
    if (!target) return
    setTabStates((all) => ({
      ...all,
      [target]: typeof updater === 'function' ? updater(all[target]) : updater,
    }))
  }, [])

  const [granularity, setGranularity] = useState('month')

  // Theme: explicit light/dark choice (overrides OS), persisted.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('cf-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch (e) { /* ignore */ }
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  // Grid number multiplier: whole units or thousands. Persisted.
  const [multiplier, setMultiplier] = useState(() => { try { return localStorage.getItem('cf-mult') === 'k' ? 'k' : 'base' } catch (e) { return 'base' } })
  useEffect(() => { try { localStorage.setItem('cf-mult', multiplier) } catch (e) {} }, [multiplier])
  // View toggles, persisted: weekends in the Days grid, and the chart above the grid.
  const [showWeekends, setShowWeekends] = useState(() => { try { return localStorage.getItem('cf-weekends') !== 'off' } catch (e) { return true } })
  useEffect(() => { try { localStorage.setItem('cf-weekends', showWeekends ? 'on' : 'off') } catch (e) {} }, [showWeekends])
  // Grouping area: the space above the grouping column. 'context' keeps the chart's
  // key there (title, y-axis, stack legend, notes) pinned while the dates scroll;
  // 'chart' lets the plot run underneath it edge to edge.
  const [groupArea, setGroupArea] = useState(() => { try { return localStorage.getItem('cf-area') === 'chart' ? 'chart' : 'context' } catch (e) { return 'context' } })
  useEffect(() => { try { localStorage.setItem('cf-area', groupArea) } catch (e) {} }, [groupArea])
  const [showChart, setShowChart] = useState(() => { try { return localStorage.getItem('cf-chart') !== 'off' } catch (e) { return true } })
  useEffect(() => { try { localStorage.setItem('cf-chart', showChart ? 'on' : 'off') } catch (e) {} }, [showChart])
  // Skin: the Uniun look, or a light, dense "Enterprise" skin for ERP-style reviews. Persisted.
  const [skin, setSkin] = useState(() => { try { return localStorage.getItem('cf-skin') === 'enterprise' ? 'enterprise' : 'uniun' } catch (e) { return 'uniun' } })
  useLayoutEffect(() => {
    if (skin === 'enterprise') document.documentElement.setAttribute('data-skin', 'enterprise')
    else document.documentElement.removeAttribute('data-skin')
    try { localStorage.setItem('cf-skin', skin) } catch (e) { /* ignore */ }
  }, [skin])
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('cf-theme', theme) } catch (e) { /* ignore */ }
  }, [theme])
  const [overlayId, setOverlayId] = useState('none') // Base is always shown; optionally overlay one scenario
  const [bandIds, setBandIds] = useState([]) // which series show their error band (per-series; off by default for a clean filled area)
  const [emphasis, setEmphasis] = useState('scenario') // which line is prominent when an overlay is shown: 'scenario' | 'base'
  const [divergeShocks, setDivergeShocks] = useState(false) // split the balance line into pre-shock ghost + shocked pink
  const [scratchpad, setScratchpad] = useState(false) // full-screen "scratchpad" view of the chart + table
  const [scratchClosing, setScratchClosing] = useState(false) // plays the exit animation before unmounting
  const [viewportH, setViewportH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  const [gridMode, setGridMode] = useState('shocks') // fixed: rows select from their label, cells inspect — no switch // 'base' (click a cell → underlying data) | 'shocks' (click a row → isolate + add shocks)
  const [showContrib, setShowContrib] = useState(false) // contributions strip is tall — off by default
  const [showScenario, setShowScenario] = useState(false) // the scenario/compare control line — opt in
  const [findLow, setFindLow] = useState(false) // "low point finder" — pin + highlight the lowest point on the chart
  // Outlier mode. Monthly columns compress ~30 days into one cell, so a single
  // day's spike is plain on the chart but has no column of its own to click.
  // Switching this on marks the days whose movement sits outside the usual range
  // and makes each one openable — the only route from a visible peak to the day
  // and category behind it. Monthly only: at day or week granularity the column
  // the spike sits in already *is* the day (or close enough to it).
  const [outlierMode, setOutlierMode] = useState(false)
  const [outlierDay, setOutlierDay] = useState(null) // the day index being drilled into
  // Row grouping under Inflow/Outflow: either one level, or a drill-down chain.
  // Each mode keeps its own selection so switching between them is lossless.
  const [groupMulti, setGroupMulti] = useState(false)
  const [groupSingle, setGroupSingle] = useState('category')
  const [groupChain, setGroupChain] = useState(['currency', 'category'])
  // With a drill-down running, selecting one of its top-level rows splits that
  // row on the chart into the level beneath it. On by default; switched off from
  // the grouping menu when the combined magnitude matters more than the mix.
  const [chartStack, setChartStack] = useState(true)
  // The stack band the chart is currently holding forward, as a grid row id, so
  // the table can light the matching row and put the numbers next to the shape.
  const [litRow, setLitRow] = useState(null)
  // What you've *chosen*. What actually gets applied is this minus any level the
  // current grid has made redundant — see groupLevels below. The choice itself is
  // never rewritten, so it comes back intact when you return to a grid that can
  // use it.
  const groupSelection = useMemo(
    () => (groupMulti ? groupChain : [groupSingle]),
    [groupMulti, groupChain, groupSingle]
  )
  // Row mode isn't only a shock entry point — it's how categories get onto the
  // chart — so it stays available on the account/pool cuts. Only the per-cell
  // shock controls drop away there (see canShock), since a cut has no company
  // row to write a shock back to.

  // Sliding pink underline under whichever view is active (Group vs Local grids).
  const viewtabsRef = useRef(null)
  const groupTabRef = useRef(null)
  const entityTabRef = useRef(null)
  const [ink, setInk] = useState({ left: 0, width: 0 })
  const [labelWPref, setLabelW] = useState(LABEL_W_DEFAULT) // category column width, set by the splitter
  const [dragging, setDragging] = useState(false)

  // Splitter: drag the chart/table divider to resize the category column.
  // The start width is read from a ref, not a closure over `labelW` — a stale
  // capture here makes the column jump to the wrong size on drag.
  const dragRef = useRef(null)
  const labelWRef = useRef(LABEL_W_DEFAULT)
  useEffect(() => { labelWRef.current = labelWPref }, [labelWPref])
  const onSplitterDown = useCallback((e) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: labelWRef.current }
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])
  const onSplitterMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const next = d.startW + (e.clientX - d.startX)
    setLabelW(Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, Math.round(next))))
  }, [])
  const onSplitterUp = useCallback((e) => {
    dragRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])
  // Keyboard nudge + double-click to restore the default width.
  const onSplitterKey = useCallback((e) => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') { e.preventDefault(); setLabelW((w) => Math.max(LABEL_W_MIN, w - step)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setLabelW((w) => Math.min(LABEL_W_MAX, w + step)) }
    if (e.key === 'Home') { e.preventDefault(); setLabelW(LABEL_W_DEFAULT) }
  }, [])
  // Row mode: the categories isolated on the chart, as [{ section, id }] against
  // the grid's own row ids. One row reads as a drill-in; several plot the net of
  // the set, which is how you see a group of categories' combined effect — e.g.
  // every operational category on a swept account, which the sweep otherwise
  // flattens out of the balance.
  const [selection, setSelection] = useState([])
  const [underlying, setUnderlying] = useState(null) // { section, row, bucket, data } for the Base-mode detail panel
  // Which end of the horizon the left-hand balance panel is showing, if any:
  // 'opening' (actual, yesterday's closing ledger) or 'closing' (forecast).
  // Opening docks left, closing docks right — both can be open at once.
  const [balOpen, setBalOpen] = useState({ opening: false, closing: false })
  // Where a drill-through from the balance panel started — { tabId, title } —
  // so the panel can offer the way back. Only set by that drill; any other route
  // to another grid clears it (see goToTab), since the trail no longer holds.
  const [balanceOrigin, setBalanceOrigin] = useState(null)

  // Leaving Shocks mode drops any isolated category so the chart returns to balance.
  useEffect(() => {
    if (gridMode !== 'shocks') setSelection([])
  }, [gridMode])

  // Switching grids drops any row-level selection — neither the clicked cell nor
  // the isolated rows are necessarily on the grid you've moved to.
  useEffect(() => { setSelection([]); setUnderlying(null) }, [activeTab])

  // Re-grouping replaces the rows, so any row-level selection no longer applies.
  useEffect(() => { setSelection([]); setUnderlying(null) }, [groupSelection])

  const openScratchpad = useCallback(() => setScratchpad(true), [])
  const closeScratchpad = useCallback(() => {
    setScratchClosing(true)
    window.setTimeout(() => {
      setScratchpad(false)
      setScratchClosing(false)
    }, 220)
  }, [])

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Keep the underline on the active view. Re-measured on selection and on any
  // resize of the tab strip — the capsule's label changes width with the grid.
  useLayoutEffect(() => {
    const measure = () => {
      const box = viewtabsRef.current
      const el = isSummary ? groupTabRef.current : entityTabRef.current
      if (!box || !el) return
      const b = box.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      setInk({ left: Math.round(r.left - b.left), width: Math.round(r.width) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (viewtabsRef.current) ro.observe(viewtabsRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [isSummary, activeTab])

  // While dragging the splitter, stop the pointer selecting table text.
  useEffect(() => {
    if (!dragging) return undefined
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      document.body.style.userSelect = prev
      document.body.style.cursor = ''
    }
  }, [dragging])

  // While the scratchpad is open, lock background scroll and let Esc close it.
  useEffect(() => {
    if (!scratchpad) return undefined
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') closeScratchpad() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [scratchpad, closeScratchpad])
  const [shocks, setShocks] = useState({}) // `${section}:${id}` -> shock[]
  const [shocksOpen, setShocksOpen] = useState(false)

  // Shocks are entered against one category, so the shock controls only engage
  // when the selection is a single row.
  const focusKey = selection.length === 1 ? `${selection[0].section}:${selection[0].id}` : null
  const focusShocks = focusKey ? shocks[focusKey] || [] : []

  // Active shocks only, scoped to the grid currently being viewed, with ongoing
  // shocks resolved to run to the horizon end. (Inactive shocks, and shocks
  // entered on other grids, are excluded from this grid's forecast.)
  const lastDay = state.days.length - 1
  // Active shocks entered on one specific grid, re-keyed for shockState() and with
  // ongoing shocks resolved to the horizon end.
  const shocksForTab = useCallback(
    (tabId) => {
      const out = {}
      for (const [key, arr] of Object.entries(shocks)) {
        const a = arr
          .filter((s) => s.active !== false && (s.source?.tabId ?? tabId) === tabId)
          .map((s) => ({ ...s, dayEnd: s.scope === 'ongoing' ? lastDay : s.dayEnd }))
        if (a.length) out[key] = a
      }
      return out
    },
    [shocks, lastDay]
  )
  // Shocks entered directly on the grid being viewed (an entity's own, or the
  // group-level ones on GROUP). Entity shocks additionally roll up into GROUP via
  // the consolidation (see effectiveState) — they aren't in here.
  const activeResolvedShocks = useMemo(() => shocksForTab(activeTab), [shocksForTab, activeTab])
  const resolvedFocusShocks = focusKey ? activeResolvedShocks[focusKey] || [] : []
  // Does a shock show up in the grid being viewed? Its own shocks always do; a
  // contributing entity's roll up, and on a scoped grid only if the category it
  // hits actually moves through an account in scope.
  const shockInGrid = useCallback(
    (s) => {
      const t = s.source?.tabId ?? activeTab
      if (t === activeTab) return true
      if (!view.entityIds.includes(t)) return false
      if (!view.accountIds) return true // group / company: everything rolls up
      const row = tabStates[t]?.[s.section]?.find((r) => r.id === s.catId)
      return !!row && view.accountIds.has(row.account?.id)
    },
    [activeTab, view.entityIds, view.accountIds, tabStates]
  )
  // Count of shocks affecting the current grid.
  const activeShockCount = useMemo(() => {
    let n = 0
    for (const arr of Object.values(shocks)) {
      for (const s of arr) if (s.active !== false && shockInGrid(s)) n++
    }
    return n
  }, [shocks, shockInGrid])
  // Whether the current grid has any shocks at all (active or inactive). Used to
  // reserve the chart's marker row so its height stays constant between the
  // balance view and drilling into a category (whose row may have no shocks).
  const gridHasShocks = useMemo(() => {
    for (const arr of Object.values(shocks)) {
      for (const s of arr) if (shockInGrid(s)) return true
    }
    return false
  }, [shocks, shockInGrid])

  // Add a shock to a category, spanning the clicked period (dates then editable).
  // The shock records the *source grid* it was entered on (a company/currency
  // tab or the consolidated group) so it applies and reads back only there.
  const addShock = useCallback((section, row, bucket) => {
    // Account/pool grids are cuts, not stores: a shock entered there would have
    // no company row to write back to, so it would break reconciliation.
    if (isScoped) return
    const key = `${section}:${row.id}`
    const shock = {
      id: uid('sh'),
      active: true,
      scope: 'oneoff',
      dayStart: bucket.dayIndices[0],
      dayEnd: bucket.dayIndices[bucket.dayIndices.length - 1],
      kind: 'pct',
      value: -0.1,
      reason: '',
      section,
      catId: row.id,
      catName: row.name,
      catColor: row.color,
      catCode: row.code,
      source: {
        tabId: activeTab,
        company: view.title,
        currency: displayCurrency,
        level: isSummary ? 'group' : 'company',
      },
    }
    setShocks((cur) => ({ ...cur, [key]: [...(cur[key] || []), shock] }))
    setShocksOpen(true)
  }, [activeTab, view.title, displayCurrency, isSummary, isScoped])

  const updateShock = useCallback((key, id, patch) => {
    setShocks((cur) => ({ ...cur, [key]: (cur[key] || []).map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }, [])

  const removeShock = useCallback((key, id) => {
    setShocks((cur) => {
      const arr = (cur[key] || []).filter((s) => s.id !== id)
      const next = { ...cur }
      if (arr.length) next[key] = arr
      else delete next[key]
      return next
    })
  }, [])

  const totalShocks = Object.values(shocks).reduce((n, arr) => n + arr.length, 0)

  // Clicking a shock marker on the chart opens the panel and highlights it.
  const [highlightShock, setHighlightShock] = useState(null)
  const openShock = useCallback((key, id) => {
    setShocksOpen(true)
    setHighlightShock({ key, id })
  }, [])

  const toggleBand = useCallback((id) => {
    setBandIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }, [])

  // Click a category row to add its flow to the chart; click again to drop it.
  // Selection is additive, so a set of categories builds up without modifier keys.
  const toggleFocus = useCallback((section, row) => {
    setSelection((cur) =>
      cur.some((s) => s.section === section && s.id === row.id)
        ? cur.filter((s) => !(s.section === section && s.id === row.id))
        : [...cur, { section, id: row.id }]
    )
  }, [])
  // Whole-section select/clear, driven from the Inflow / Outflow headers. Only
  // leaf rows are passed in — a drill-down parent would double-count its children.
  const setSectionSelected = useCallback((section, rowIds, on) => {
    setSelection((cur) => {
      const rest = cur.filter((s) => s.section !== section || !rowIds.includes(s.id))
      return on ? [...rest, ...rowIds.map((id) => ({ section, id }))] : rest
    })
  }, [])
  const clearSelection = useCallback(() => setSelection([]), [])

  // Effective state = base figures with manual shocks baked in, so shocks flow
  // through to category rows, totals, net, closing balance and the chart.
  const effectiveState = useMemo(() => {
    // GROUP: consolidate the *shocked* entity states (so each entity's own shocks
    // roll up), then apply any group-level shocks on top.
    if (isSummary) {
      const shockedEntities = ENTITIES.map((e) => ({
        state: shockState(tabStates[e.id], shocksForTab(e.id)),
        fx: e.fx,
      }))
      return shockState(consolidate(shockedEntities, groupCcy.fx), activeResolvedShocks)
    }
    // Account / pool grids: scope the *shocked* entity states, so each company's
    // shocks flow through to whichever accounts they move over.
    if (isScoped) {
      const shocked = Object.fromEntries(
        view.entityIds.map((id) => [id, shockState(tabStates[id], shocksForTab(id))])
      )
      return scopeState(viewSources(shocked), view.accountIds)
    }
    return shockState(state, activeResolvedShocks)
  }, [isSummary, isScoped, tabStates, groupCcy.fx, shocksForTab, state, activeResolvedShocks, view.entityIds, view.accountIds, viewSources])
  const daily = useMemo(() => computeDaily(effectiveState), [effectiveState])
  // Pre-shock baseline (all shocks removed) — the diverging ghost line + KPI
  // impact. On GROUP this is the raw consolidation, so the impact reflects both
  // rolled-up entity shocks and group-level shocks.
  const baseDaily = useMemo(() => computeDaily(state), [state])
  // Hiding weekends (Days view only) folds Saturday and Sunday into the following
  // Monday's column — the money still lands, and every total still reconciles.
  // A trailing weekend folds back into the last weekday.
  const buckets = useMemo(() => {
    const raw = bucketize(state.days, granularity)
    if (granularity !== 'day' || showWeekends) return raw
    const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay()
    const out = []
    let pending = []
    for (const b of raw) {
      if (dow(b.startISO) % 6 === 0) { pending.push(...b.dayIndices); continue }
      out.push({ ...b, index: out.length, dayIndices: [...pending, ...b.dayIndices], startISO: pending.length ? state.days[pending[0]] : b.startISO, folded: pending.length > 0 })
      pending = []
    }
    if (pending.length && out.length) {
      const last = out[out.length - 1]
      out[out.length - 1] = { ...last, dayIndices: [...last.dayIndices, ...pending], endISO: state.days[pending[pending.length - 1]], folded: true }
    }
    return out
  }, [state.days, granularity, showWeekends])
  // Rows beneath the fixed Inflow/Outflow sections, grouped by one level or a
  // drill-down chain. Only the table's aggregation swaps — the chart, KPIs and
  // balances are unaffected.
  // On GROUP each entity is a source converted into the group currency; on an
  // entity grid there's a single source in its own currency.
  const groupSources = useMemo(() => {
    // GROUP and the account/pool cuts draw on several entities, so each is its own
    // source (converted into the display currency) and grouping can separate them.
    // A scoped source additionally drops rows outside the accounts in scope.
    if (isSummary || isScoped) {
      const shocked = Object.fromEntries(
        view.entityIds.map((id) => [id, shockState(tabStates[id], shocksForTab(id))])
      )
      const srcs = viewSources(shocked)
      if (!isScoped) return srcs
      return srcs.map((s) => ({
        ...s,
        state: {
          ...s.state,
          inflows: s.state.inflows.filter((r) => view.accountIds.has(r.account?.id)),
          outflows: s.state.outflows.filter((r) => view.accountIds.has(r.account?.id)),
        },
      }))
    }
    return [{
      meta: { currency: (ENTITIES.find((x) => x.id === activeTab) ?? {}).currency ?? displayCurrency },
      state: effectiveState,
      conv: (v) => v,
    }]
  }, [isSummary, isScoped, tabStates, shocksForTab, view.entityIds, view.accountIds, viewSources, activeTab, effectiveState, displayCurrency])

  // The grid selector narrows what's worth grouping by: on a single-account grid
  // "Bank account" can only ever draw one row, and on a pool grid so can "Cash
  // pool". Any level the current scope has collapsed to one key is retired from
  // the picker, with the reason shown in its place. Category always stays — it's
  // the fallback when everything else drops out.
  const groupDisabled = useMemo(() => {
    const keys = levelKeys(groupSources)
    const out = {}
    const n = (lv) => keys[lv]?.size ?? 0
    if (n('currency') <= 1) out.currency = `All rows are ${[...(keys.currency ?? [])][0] ?? 'one currency'}`
    if (n('bankAccount') <= 1) out.bankAccount = 'This grid is one account'
    if (n('cashPool') <= 1) {
      const only = [...(keys.cashPool ?? [])][0]
      out.cashPool = only === 'unpooled' ? 'No accounts here are pooled' : 'This grid is one pool'
    }
    if (n('sourceType') <= 1) {
      const only = [...(keys.sourceType ?? [])][0]
      out.sourceType = only === SOURCE_TYPE_UNSET ? 'No rows here carry a source type' : `All rows are ${only}`
    }
    return out
  }, [groupSources])

  // The levels actually applied: your selection with the retired ones dropped,
  // falling back to Category if that empties it out.
  const groupLevels = useMemo(() => {
    const kept = groupSelection.filter((lv) => !groupDisabled[lv])
    return kept.length ? kept : ['category']
  }, [groupSelection, groupDisabled])

  const agg = useMemo(
    () => aggregateGrouped(groupSources, groupLevels, buckets, effectiveState.openingBalance, state.days.length),
    [groupSources, groupLevels, buckets, effectiveState.openingBalance, state.days.length]
  )

  // Base mode: clicking a cell opens its underlying detail (invoices for
  // Customer Receipts / Suppliers, else the daily cash flows), built from the
  // effective (post-shock) daily values so it reconciles with the shown cell.
  // Grouped rows carry their own post-shock daily series in the display currency
  // (a row can span entities and accounts, so there's no single state row to look
  // up) — read the days straight off the row.
  const openUnderlying = useCallback((section, row, bucket) => {
    if (!row.values) return
    const dailyValues = bucket.dayIndices.map((i) => Number(row.values[i]) || 0)
    const data = cellUnderlying(row, bucket, dailyValues, state.days)
    setOutlierDay(null) // the drill-ins share the right-hand dock
    setBalOpen((b) => (b.closing ? { ...b, closing: false } : b))
    // clicking the cell that's already open closes the panel again
    setUnderlying((cur) =>
      cur && cur.section === section && cur.row.id === row.id && cur.bucket.key === bucket.key
        ? null
        : { section, row, bucket, data }
    )
  }, [state.days])
  const closeUnderlying = useCallback(() => setUnderlying(null), [])

  // Entity data with each company's own shocks baked in — the same figures the
  // grid is built from, so an account's forecast balance reconciles with it.
  const shockedStates = useMemo(
    () => Object.fromEntries(ENTITIES.map((e) => [e.id, shockState(tabStates[e.id], shocksForTab(e.id))])),
    [tabStates, shocksForTab]
  )
  // The balance at whichever end of the horizon is being inspected, broken into
  // the bank accounts the active grid draws on. The panel is left open across grid
  // changes — it re-reads for whichever grid you land on, which is what makes
  // clicking through to an account work.
  const openBreakdown = useMemo(
    () => accountBalances(shockedStates, view, displayCurrency, 'opening'),
    [shockedStates, view, displayCurrency]
  )
  const closeBreakdown = useMemo(
    () => accountBalances(shockedStates, view, displayCurrency, 'closing'),
    [shockedStates, view, displayCurrency]
  )
  // one account order for both panes — the opening balance's, largest first
  const balOrder = useMemo(() => {
    const o = {}
    openBreakdown.slice().sort((a, b) => b.value - a.value).forEach((r, i) => { o[r.id] = i })
    return o
  }, [openBreakdown])
  const [balHover, setBalHover] = useState(null)
  // Context of the grid a panel drill started from, so closing the panels can put
  // the user back exactly where they were: same grid, period window, page scroll
  // and selected rows.
  const restoreRef = useRef(null)
  const ctxRef = useRef({ colW: 0, selection: [] })
  const closeBalanceOnly = useCallback((which) => setBalOpen((b) => (which ? { ...b, [which]: false } : { opening: false, closing: false })), [])
  // Every other route to another grid — the tab strip, the view picker, the
  // contributions legend, a shock's source link — abandons the drill-through, so
  // the breadcrumb goes with it.
  const goToTab = useCallback((id) => {
    setBalanceOrigin(null)
    setActiveTab(id)
  }, [])
  // Drill from the panel into one account's own grid, remembering where we came
  // from. The first origin is kept, so "back" always returns to where the trail
  // started rather than one hop up it.
  const drillToAccount = useCallback((acctId) => {
    const id = acctTab(acctId)
    if (id === activeTab) return
    setBalanceOrigin((cur) => cur ?? {
      tabId: activeTab,
      title: view.title,
      bucket: ctxRef.current.colW > 0 && scrollRef.current ? Math.round(scrollRef.current.scrollLeft / ctxRef.current.colW) : null,
      scrollY: window.scrollY,
      selection: ctxRef.current.selection,
    })
    setActiveTab(id)
  }, [activeTab, view.title])
  // From the opening pane, an account drill also opens the closing pane on the
  // right, so the account's start and end positions read side by side.
  const drillFromOpening = useCallback((acctId) => {
    drillToAccount(acctId)
    setUnderlying(null)
    setOutlierDay(null)
    setBalOpen((b) => (b.closing ? b : { ...b, closing: true }))
  }, [drillToAccount])
  const backToOrigin = useCallback(() => {
    if (balanceOrigin) {
      restoreRef.current = { ...balanceOrigin }
      setActiveTab(balanceOrigin.tabId)
    }
    setBalanceOrigin(null)
  }, [balanceOrigin])
  // Closing the balance panels after a drill-through returns to the grid it started on.
  const closeBalance = useCallback((which) => {
    closeBalanceOnly(which)
    if (!which && balanceOrigin) backToOrigin()
  }, [closeBalanceOnly, balanceOrigin, backToOrigin])
  useEffect(() => {
    if (!balOpen.opening && !balOpen.closing) return undefined
    const onKey = (e) => e.key === 'Escape' && closeBalance()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [balOpen, closeBalance])
  // Open on one end of the horizon, and bring the cell it refers to into view —
  // the closing cell is at the far right of a year-long grid, so a highlight on
  // its own would land off-screen.
  const showBalance = useCallback((next) => {
    let opening = false
    setBalOpen((b) => { opening = !b[next]; return { ...b, [next]: !b[next] } })
    // the closing panel takes the right-hand dock from the other drill-ins
    if (next === 'closing') { setUnderlying(null); setOutlierDay(null) }
    const box = scrollRef.current
    if (!box) return
    // opening: leave the grid where it is — the user's focus stays put
  }, [])

  // Model detail sheet, opened from the right-hand half of a category capsule.
  const [modelRow, setModelRow] = useState(null)
  const [modelClosing, setModelClosing] = useState(false)
  const openModel = useCallback((section, row) => {
    setModelClosing(false)
    setModelRow({ ...row, section })
  }, [])
  const closeModel = useCallback(() => {
    setModelClosing(true)
    window.setTimeout(() => { setModelRow(null); setModelClosing(false) }, 200)
  }, [])
  useEffect(() => {
    if (!modelRow) return undefined
    const onKey = (e) => e.key === 'Escape' && closeModel()
    // Click anywhere off the tray to dismiss it, so you never have to travel
    // back up to the Close button. Clicks on a capsule button are left alone —
    // those switch the tray to another category rather than closing it.
    const onDown = (e) => {
      if (e.target.closest('.modelpanel') || e.target.closest('.catcap__btn')) return
      closeModel()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [modelRow, closeModel])

  const ordinals = useMemo(() => monthOrdinals(state.days), [state.days])

  // A zero-balancing participant's line is pinned flat at zero by design, which
  // looks like missing data unless the chart says why. Read from the rows rather
  // than the pool's declared type: only accounts that actually carry a sweep leg
  // are swept, so this can't label an account the sweep never touches.
  const chartNote = useMemo(() => {
    if (view.kind !== 'account') return null
    if (!state.outflows.some((r) => r.code === 'SWEEP')) return null
    const header = ALL_ACCOUNTS.find((a) => a.pool === view.account.pool && a.entityId === EUR_SWEEP.header)
    return {
      label: 'Sweeping account',
      detail: header ? `Swept daily to ${header.name}` : 'Swept daily to the pool header',
    }
  }, [view, state.outflows])

  // Shock day-ranges per selected row, so each row's own cells can mark where a
  // shock already sits. Keyed the same way shocks themselves are.
  const shockRangesByRow = useMemo(() => {
    const out = {}
    for (const [key, arr] of Object.entries(activeResolvedShocks)) {
      out[key] = arr.map((s) => ({ start: s.dayStart, end: s.dayEnd }))
    }
    return out
  }, [activeResolvedShocks])

  // Base is always the primary line; the dropdown adds at most one scenario.
  const base = useMemo(() => SCENARIOS.find((s) => s.id === 'base'), [])
  const overlays = useMemo(() => SCENARIOS.filter((s) => s.id !== 'base'), [])

  // The selected categories, resolved against the grid's own rows. The series is
  // read off the row rather than looked up in `state`: a grid row can roll up
  // several entities and accounts, so there's no single state row behind it.
  const focusRows = useMemo(() => {
    if (!selection.length) return []
    const byKey = new Map()
    for (const r of agg.inflowRows) byKey.set(`inflows:${r.id}`, { ...r, section: 'inflows' })
    for (const r of agg.outflowRows) byKey.set(`outflows:${r.id}`, { ...r, section: 'outflows' })
    return selection.map((s) => byKey.get(`${s.section}:${s.id}`)).filter(Boolean)
  }, [selection, agg])
  const focusActive = focusRows.length > 0
  // A single row still reads as a drill-in — it keeps its own name, model and
  // shock controls, none of which mean anything for a set.
  const singleFocus = focusRows.length === 1 ? focusRows[0] : null
  // The net of the selection: inflows up, outflows down. So selecting everything
  // on a swept account draws the operational cash flow the sweep flattens out of
  // the balance, rather than a pile of unrelated magnitudes.
  const focusSeries = useMemo(() => {
    if (!focusRows.length) return null
    const D = state.days.length
    const out = new Array(D).fill(0)
    for (const r of focusRows) {
      const sign = r.section === 'outflows' ? -1 : 1
      for (let i = 0; i < D; i++) out[i] += sign * (Number(r.values[i]) || 0)
    }
    return out
  }, [focusRows, state.days.length])
  const focusLabel = singleFocus ? singleFocus.name : `${focusRows.length} categories`

  // Composition view: one top-level drill-down row, split into the level beneath
  // it. Deliberately fixed to the chain's first two levels — selecting deeper
  // keeps the plain net-flow line, so the stack always answers the same question
  // however long the chain gets.
  //
  // Daily, like every other series on this chart — the columns only set the x
  // geometry. A weekday-only category does drop to the floor at each weekend, so
  // the bands read as a run of islands rather than a continuous ribbon, but that
  // is the shape of the underlying cash and the rest of the chart shows it too.
  // Outlier mode wants the daily line back: it marks single days, and a composition
  // is a band of colour, not a point you can put a ring on. The composition is a
  // default, outlier mode is something you deliberately switched on, so the
  // explicit choice wins and the stack steps aside until it's switched off again.
  const outlierRequested = outlierMode && granularity === 'month'
  const stack = useMemo(() => {
    if (!chartStack || outlierRequested || groupLevels.length < 2) return null
    const parent = singleFocus
    if (!parent || parent.depth !== 0 || !parent.hasChildren) return null
    const kids = (parent.section === 'inflows' ? agg.inflowRows : agg.outflowRows)
      .filter((r) => r.parentPath === parent.path)
    if (kids.length < 2) return null
    // Outflows stack downward, matching the sign convention of the net-flow line
    // this replaces. One parent means one section, so a stack is never mixed.
    const sign = parent.section === 'outflows' ? -1 : 1
    // Children that are categories bring their own colours, and keep them —
    // they're genuinely different things. A level like source type has none, and
    // there the stack is one row in several states, so it steps down the base
    // pink instead: the same colour the isolated-flow line it replaces carries
    // (see focusColor), which keeps the chart meaning "what you selected" rather
    // than changing hue every time you pick a different row.
    const ownColors = kids.every((k) => k.color)
    const bands = kids.map((k, i) => ({
      id: k.id,
      name: k.name,
      color: ownColors ? k.color : 'var(--brand)',
      // Position in the ramp, 1 (first, strongest) → 0 (last, faintest). The
      // chart turns this into tone and texture; a full 1→0 span is what makes
      // three steps of one hue actually separate.
      fade: ownColors ? 1 : 1 - i / Math.max(1, kids.length - 1),
      ramped: !ownColors,
      values: k.values.map((v) => sign * v),
    }))
    const D = state.days.length
    return {
      name: parent.name,
      color: parent.color,
      bands,
      total: Array.from({ length: D }, (_, i) => bands.reduce((s, b) => s + (b.values[i] ?? 0), 0)),
    }
  }, [chartStack, outlierRequested, groupLevels.length, singleFocus, agg, state.days.length])

  // --- outlier detection & attribution ---------------------------------------
  // Every (entity × category) atom on the active grid: its daily series in the
  // display currency, signed so an outflow reads negative, tagged with the grouped
  // path it sits under. This is the finest grain the grid holds, and the level an
  // outlier has to be explained at — grouping exists to summarise, and a summary
  // can't name a cause. The tag is what lets the explanation be narrowed to
  // whatever the chart is currently isolating, however deep the drill-down runs.
  const flowAtoms = useMemo(() => {
    const out = []
    for (const { meta, state: src, conv } of groupSources) {
      for (const section of ['inflows', 'outflows']) {
        const sign = section === 'outflows' ? -1 : 1
        for (const r of src[section] ?? []) {
          const keyed = { currency: meta.currency, code: r.code, account: r.account, sourceType: r.sourceType }
          const path = groupLevels.reduce((p, lv) => `${p}/${lv}:${GROUP_LEVELS[lv].key(keyed)}`, section)
          out.push({
            id: `${section}:${r.id}`,
            name: r.name,
            code: r.code,
            color: r.color,
            section,
            path,
            values: r.values.map((v) => sign * conv(Number(v) || 0)),
          })
        }
      }
    }
    return out
  }, [groupSources, groupLevels])

  // The categories an outlier is attributed across: everything on the grid, or —
  // when rows are isolated on the chart — only what sits beneath the selection, so
  // the explanation answers for the line you actually clicked.
  //
  // Atoms are merged by CATEGORY CODE ALONE, deliberately crossing the Inflow /
  // Outflow split. Only the sweep appears on both sides, as a matched pair of
  // legs, and netting them is the whole point: a leg swept out and straight back
  // in moved no cash, so counting each separately would put a mechanical 50% of
  // every attribution against "Sweep" and bury whatever actually happened.
  //
  // Isolated rows drop the sweep entirely, matching aggregateGrouped — the series
  // being explained excludes it, so the explanation has to as well.
  const attributionRows = useMemo(() => {
    const picked = focusActive
      ? flowAtoms.filter((a) => a.code !== 'SWEEP' && focusRows.some((r) => a.path === r.path || a.path.startsWith(`${r.path}/`)))
      : flowAtoms
    const byCat = new Map()
    for (const a of picked) {
      const key = a.code ?? a.id
      const cur = byCat.get(key)
      if (!cur) {
        byCat.set(key, { id: key, name: a.name, code: a.code, color: a.color, values: a.values.slice() })
      } else {
        for (let i = 0; i < cur.values.length; i++) cur.values[i] += a.values[i]
      }
    }
    return [...byCat.values()]
  }, [flowAtoms, focusActive, focusRows])

  // `stack` is always null while outlier mode is on (it stands aside — see above),
  // so this only ever restates outlierRequested. Kept as a guard so a future change
  // to the stack's own conditions can't silently start marking days on a chart that
  // isn't drawing them.
  const outlierActive = outlierRequested && !stack
  // The series tested is the net of the isolated selection, or the grid's own daily
  // net movement. Never the balance — see findFlowOutliers on why the level can't
  // be tested even when the level is what's drawn.
  const flowSeries = focusActive ? focusSeries : daily.dailyNet
  const outlierScan = useMemo(
    () => (outlierActive && flowSeries ? findFlowOutliers(flowSeries) : null),
    [outlierActive, flowSeries]
  )
  const outliers = outlierScan?.outliers ?? []
  const outlierIndex = outlierDay == null ? -1 : outliers.findIndex((o) => o.dayIndex === outlierDay)
  const activeOutlier = outlierIndex >= 0 ? outliers[outlierIndex] : null
  const outlierDetail = useMemo(
    () => (activeOutlier
      ? attributeOutlier(activeOutlier.dayIndex, attributionRows, { direction: Math.sign(activeOutlier.excess) || 1 })
      : null),
    [activeOutlier, attributionRows]
  )
  // Isolate one category and there is nothing left beneath it to attribute to —
  // an attribution would just name the category back at you. The day itself is
  // then the finding, and the panel says as much rather than claiming a cause.
  const outlierSoleCategory = attributionRows.length <= 1
  // The gutter note explains why the chart looks the way it does, so outlier mode
  // uses it to say what the rings are — but never at the cost of the standing
  // sweep note, which explains a line pinned flat at zero and can't be displaced.
  const noteForChart = chartNote ?? (outlierActive
    ? outliers.length
      ? { label: `${outliers.length} outlier${outliers.length === 1 ? '' : 's'}`, detail: 'Days whose movement is outside the usual range — click a ring to drill in' }
      : { label: 'No outliers', detail: 'No day’s movement sits outside the usual range on this series' }
    : null)

  // Both drill-ins dock to the same edge, so opening one dismisses the other.
  const openOutlier = useCallback((dayIndex) => {
    setUnderlying(null)
    setBalOpen((b) => (b.closing ? { ...b, closing: false } : b))
    setOutlierDay((cur) => (cur === dayIndex ? null : dayIndex))
  }, [])
  const closeOutlier = useCallback(() => setOutlierDay(null), [])
  // Walk the peaks from the panel, wrapping at either end — with a year of days
  // behind twelve columns, hunting the next ring by eye is the slow way round.
  const stepOutlier = (delta) => {
    if (!outliers.length) return
    const next = (outlierIndex + delta + outliers.length) % outliers.length
    setOutlierDay(outliers[next].dayIndex)
  }
  // An outlier is a day on one particular series, so anything that changes what's
  // plotted invalidates the open one.
  useEffect(() => { setOutlierDay(null) }, [activeTab, selection, granularity, groupSelection])
  useEffect(() => { if (!outlierActive) setOutlierDay(null) }, [outlierActive])
  useEffect(() => {
    if (!activeOutlier) return undefined
    const onKey = (e) => e.key === 'Escape' && closeOutlier()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeOutlier, closeOutlier])

  const balanceLines = useMemo(() => {
    const ov = overlays.find((s) => s.id === overlayId)
    const overlayProminent = !!ov && emphasis === 'scenario'

    // Diverging shock view: show the active forecast (scenario if selected, else
    // base) twice — its pre-shock path as a grey "ghost", and its shocked path in
    // forecast pink — so the divergence the shocks introduce is visible.
    //
    // The scenario is applied to the *pre-shock* baseline to form the ghost, then
    // the shock's absolute balance impact is added on top. This keeps the gap
    // between the two lines equal to the shock effect everywhere, instead of
    // letting the scenario's own multiplier re-scale (and distort) the shock.
    if (divergeShocks && activeShockCount > 0) {
      const applyOv = (s) => (ov ? ov.apply(s, ordinals) : s)
      const name = ov ? ov.name : base.name
      const code = ov ? ov.code : base.code
      const ghostSeries = applyOv(baseDaily.dailyClosing)
      const shockDelta = daily.dailyClosing.map((v, i) => v - (baseDaily.dailyClosing[i] ?? 0))
      const shockedSeries = ghostSeries.map((v, i) => v + (shockDelta[i] ?? 0))
      return [
        {
          id: 'ghost',
          name: ov ? `${name} · pre-shock` : 'Base · pre-shock',
          code,
          model: null,
          color: 'var(--muted)',
          series: ghostSeries,
          band: false,
          dash: true,
          muted: true,
          prominent: false,
          ghost: true,
        },
        {
          id: 'shocked',
          name: ov ? `${name} · shocked` : 'Base · shocked',
          code,
          model: null,
          color: 'var(--brand)',
          series: shockedSeries,
          band: false,
          prominent: true,
        },
      ]
    }

    const result = [
      {
        id: 'base',
        name: 'Base',
        code: base.code,
        model: base.model,
        color: base.color,
        series: daily.dailyClosing,
        band: bandIds.includes('base'),
        prominent: !overlayProminent,
        muted: overlayProminent,
      },
    ]
    if (ov) {
      result.push({
        id: ov.id,
        name: ov.name,
        code: ov.code,
        model: ov.model,
        color: ov.color,
        series: ov.apply(daily.dailyClosing, ordinals),
        band: bandIds.includes(ov.id),
        prominent: overlayProminent,
        muted: !overlayProminent,
      })
    }
    return result
  }, [base, overlays, overlayId, bandIds, emphasis, daily.dailyClosing, ordinals, divergeShocks, activeShockCount, baseDaily.dailyClosing])

  // The isolated line uses the base pink for every category (consistent with the
  // main balance line); the scenario overlay carries the scenario colour.
  const focusColor = focusActive ? 'var(--brand)' : null

  // With categories selected the chart shows their net flow, the same scenario
  // overlay applied to it (if one is chosen), and — for a single category — a
  // dashed "shocked" line when manual shocks are applied.
  const lines = useMemo(() => {
    if (!focusActive) return balanceLines
    const ov = overlays.find((s) => s.id === overlayId)
    const overlayProminent = !!ov && emphasis === 'scenario'
    const result = [
      {
        id: 'base',
        name: focusLabel,
        code: singleFocus ? singleFocus.code : `${focusRows.length}×`,
        model: singleFocus ? singleFocus.model : null,
        color: focusColor,
        series: focusSeries,
        band: bandIds.includes('base'),
        prominent: !overlayProminent,
        muted: overlayProminent,
      },
    ]
    if (ov) {
      result.push({
        id: ov.id,
        name: ov.name,
        code: ov.code,
        model: ov.model,
        color: ov.color,
        // every scenario is a per-month multiplier, so applying it to the net of
        // the selection matches applying it to each category and re-summing
        series: ov.apply(focusSeries, ordinals),
        band: bandIds.includes(ov.id),
        prominent: overlayProminent,
        muted: !overlayProminent,
      })
    }
    if (singleFocus && resolvedFocusShocks.length) {
      const sign = singleFocus.section === 'outflows' ? -1 : 1
      const shocked = applyShocks(singleFocus.values, resolvedFocusShocks).map((v) => v * sign)
      result.push({ id: 'focus-shock', name: `${focusLabel} (shocked)`, color: 'var(--sc2)', dash: true, series: shocked, band: false })
    }
    return result
  }, [focusActive, focusRows.length, singleFocus, focusSeries, focusLabel, focusColor, bandIds, overlayId, overlays, emphasis, ordinals, resolvedFocusShocks, balanceLines])

  // Descriptor for the dropdown's "base" row — the selection in isolate mode.
  const dropdownBase = focusActive
    ? {
        id: 'base',
        code: singleFocus ? singleFocus.code : `${focusRows.length}×`,
        name: focusLabel,
        color: focusColor,
        model: singleFocus ? singleFocus.model : null,
        description: singleFocus ? "This category's own forecast." : 'The net of the categories selected on the grid.',
      }
    : base

  // Shock markers overlaid on the chart. In isolate view: the focused category's
  // shocks. In balance view: every shock that affects the current numbers.
  const annotations = useMemo(() => {
    const mark = (key, s) => ({
      dayIndex: s.dayStart,
      id: s.id,
      key,
      active: s.active !== false,
      color: s.active !== false ? 'var(--sc2)' : 'var(--muted)',
      reason: s.reason,
    })
    // GROUP consolidates every entity, so all their shocks (plus group-level ones)
    // show here — matched to the selected categories by code when any are isolated.
    if (isSummary) {
      const all = Object.entries(shocks).flatMap(([key, arr]) => arr.map((s) => ({ key, s })))
      const codes = new Set(focusRows.map((r) => r.code))
      const items = focusActive ? all.filter(({ s }) => codes.has(s.catCode)) : all
      return items.map(({ key, s }) => mark(key, s))
    }
    // Entity grid: only its own shocks.
    const mine = (s) => (s.source?.tabId ?? activeTab) === activeTab
    // Isolated: the shocks sitting on the selected rows, whether that's one or many.
    const selected = new Set(focusRows.map((r) => `${r.section}:${r.id}`))
    const keys = focusActive
      ? selected
      : new Set([
          ...state.inflows.map((r) => `inflows:${r.id}`),
          ...state.outflows.map((r) => `outflows:${r.id}`),
        ])
    return Object.entries(shocks)
      .filter(([key]) => keys.has(key))
      .flatMap(([key, arr]) => arr.filter(mine).map((s) => mark(key, s)))
  }, [isSummary, focusActive, focusRows, shocks, state.inflows, state.outflows, activeTab])

  // Size columns so the target count fills the measured width; scroll for more.
  // Widening the category column takes space from the data columns (and vice
  // versa), so dragging the splitter re-proportions every period column.
  const [scrollRef, measuredW, setMeasuredW, widthFrozen, onMeasure] = useMeasuredWidth()
  const appRef = useRef(null)
  // Docked side panels. The page reserve beside each animates with the panel
  // (same curve, PANEL_MS), so the chart + grid edge travels with the panel edge.
  // The end width is known up front — the reserve is the panel width — so the
  // chart and grid render once at their final size in the same render as the
  // click, and the sliding frame just reveals or covers that layout.
  const wantRight = !!(underlying || activeOutlier || balOpen.closing)
  const wantLeft = balOpen.opening
  const dock = { left: wantLeft, right: wantRight }
  const reserveFor = (l, r) => {
    if (typeof window === 'undefined') return 0
    const pw = Math.min(460, Math.floor((window.innerWidth - 72) * (l && r ? 0.36 : 0.5)))
    return (l ? pw : 0) + (r ? pw : 0)
  }
  const targetReserve = reserveFor(wantLeft, wantRight)
  const targetReserveRef = useRef(targetReserve)
  targetReserveRef.current = targetReserve
  const measuredReserveRef = useRef(targetReserve)
  onMeasure.current = () => { measuredReserveRef.current = targetReserveRef.current }
  const dockKey = `${wantLeft}|${wantRight}`
  const lastDockKey = useRef(dockKey)
  if (lastDockKey.current !== dockKey) { lastDockKey.current = dockKey; widthFrozen.current = true }
  // Unfreeze when the reserve's padding transition actually finishes (not on a
  // timer, which can fire early if the first frame is slow), then take one real
  // measurement so the layout settles on the true width.
  useEffect(() => {
    const el = appRef.current
    if (!el) return undefined
    let fallback = 0
    let raf = 0
    // While the frame animates, its width changes every frame and the browser
    // clamps / re-snaps scrollLeft as it does — pin the held period each frame.
    const pin = () => {
      const box = scrollRef.current
      const b = firstBucket.current, cw = anchorColW.current
      if (box && b != null && cw > 0 && Math.abs(box.scrollLeft - b * cw) > 0.5) box.scrollLeft = b * cw
    }
    const loop = () => { pin(); raf = requestAnimationFrame(loop) }
    const settle = () => {
      clearTimeout(fallback)
      cancelAnimationFrame(raf); raf = 0
      widthFrozen.current = false
      const box = scrollRef.current
      if (box) { measuredReserveRef.current = targetReserveRef.current; setMeasuredW(box.clientWidth) }
      requestAnimationFrame(pin)
    }
    const isPad = (e) => e.target === el && e.propertyName.startsWith('padding')
    const onRun = (e) => {
      if (!isPad(e)) return
      widthFrozen.current = true
      clearTimeout(fallback); fallback = setTimeout(settle, PANEL_MS * 4)
      if (!raf) loop()
    }
    const onEnd = (e) => {
      if (!isPad(e)) return
      // both sides can be animating; wait for the last one
      requestAnimationFrame(() => { if (!el.getAnimations || !el.getAnimations().some((a) => a.transitionProperty?.startsWith('padding'))) settle() })
    }
    el.addEventListener('transitionrun', onRun)
    el.addEventListener('transitionend', onEnd)
    el.addEventListener('transitioncancel', onEnd)
    return () => { clearTimeout(fallback); cancelAnimationFrame(raf); el.removeEventListener('transitionrun', onRun); el.removeEventListener('transitionend', onEnd); el.removeEventListener('transitioncancel', onEnd) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // no padding change (e.g. reduced motion, or the reserve didn't move): settle now
    if (!widthFrozen.current) return undefined
    const t = setTimeout(() => {
      const el = appRef.current
      const running = el?.getAnimations?.().some((a) => a.transitionProperty?.startsWith('padding'))
      if (running) return
      widthFrozen.current = false
      const box = scrollRef.current
      if (box) { measuredReserveRef.current = targetReserveRef.current; setMeasuredW(box.clientWidth) }
    }, 60)
    return () => clearTimeout(t)
  }, [dockKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const availW = measuredW > 0 ? Math.max(0, measuredW + measuredReserveRef.current - targetReserve) : 0
  // While a panel slides in, the frame is still at its old (wider) width but the
  // content is already at its final (narrower) size, so the scroll range would be
  // too short to hold the period in view and the browser would clamp it back
  // towards actuals. Trailing slack equal to the not-yet-reserved width keeps the
  // range; it drops to 0 once the reserve has landed and been measured.
  const freezeSlack = Math.max(0, targetReserve - measuredReserveRef.current)
  // The category column gives way when the grid is framed between panels, so the
  // data columns are never squeezed out of view; it returns to its set width after.
  const labelW = availW > 0 ? Math.min(labelWPref, Math.max(150, Math.round(availW * 0.36))) : labelWPref
  const footRef = useRef(null)
  const headRef = useRef(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const foot = footRef.current
    if (!el || !foot) return undefined
    const sync = () => {
      foot.scrollLeft = el.scrollLeft
      const clip = headRef.current?.firstElementChild
      if (clip) clip.scrollLeft = el.scrollLeft
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    return () => el.removeEventListener('scroll', sync)
  })
  // Pinned date header: a zero-height sticky strip parked under the top bar. Its
  // position is native sticky; it is only shown once the real header slides beneath it.
  useLayoutEffect(() => {
    const head = headRef.current
    if (!head) return undefined
    const update = () => {
      const bar = document.querySelector('.gnavwrap')
      const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0
      head.style.top = top + 'px'
      const real = scrollRef.current?.querySelector('table.grid:not(.grid--head):not(.grid--foot) > thead')
      const on = !!real && real.getBoundingClientRect().top < top
      head.classList.toggle('gridhead--on', on)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  })
  // Side panels line their header and total band up with the page's top bar and
  // title band, so the greys and rules run straight across. Measured at scroll 0.
  useLayoutEffect(() => {
    const root = document.documentElement
    const measure = () => {
      const bar = document.querySelector('.gnavwrap')
      const kpis = document.querySelector('.metrics')
      if (!bar || !kpis) return
      const top = bar.offsetHeight
      // +1: the KPI strip draws its rule inside its own top edge, the band draws its
      // rule inside its bottom edge — so the band runs 1px further to overlay it exactly
      const band = Math.max(56, Math.round(kpis.getBoundingClientRect().top + window.scrollY - top) + 1)
      root.style.setProperty('--chrome-top', top + 'px')
      root.style.setProperty('--chrome-band', band + 'px')
    }
    measure()
    const ro = new ResizeObserver(measure)
    const bar = document.querySelector('.gnavwrap')
    const head = document.querySelector('.app__header')
    if (bar) ro.observe(bar)
    if (head) ro.observe(head)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  })
  const openGroupFromHead = useCallback(() => {
    const real = scrollRef.current?.querySelector('table.grid:not(.grid--head):not(.grid--foot) > thead')
    if (!real) return
    const bar = document.querySelector('.gnavwrap')
    const top = bar ? bar.getBoundingClientRect().bottom : 0
    window.scrollTo({ top: window.scrollY + real.getBoundingClientRect().top - top })
    requestAnimationFrame(() => real.querySelector('.groupbtn__btn')?.click())
  }, [scrollRef])
  // Re-settle the chart and grid whenever the period granularity changes.
  const alignedRef = useRef(null)
  // The table steps back under a loader while the chart morphs. Toggled straight
  // on the DOM so the click doesn't wait on an App re-render to show it.
  const markBusy = useCallback(() => { alignedRef.current?.classList.add('aligned__content--busy') }, [])
  const firstGran = useRef(true)
  useEffect(() => {
    if (firstGran.current) { firstGran.current = false; return }
    const t = setTimeout(() => alignedRef.current?.classList.remove('aligned__content--busy'), 820) // chart morph is 720ms
    return () => clearTimeout(t)
  }, [granularity])
  const target = TARGET_COLS[granularity]
  // Fit a whole number of columns to the visible width, so the last one always
  // ends exactly at the frame edge (and so at a docked panel's edge). When the
  // target count won't fit at the minimum width, show fewer, wider-than-minimum
  // columns rather than a part-column cut off by the panel.
  // The visible set of periods is decided at the undocked width and then held:
  // docking a panel narrows the same columns rather than dropping any, so the
  // dates on screen never move when a balance panel opens or closes.
  const freeW = measuredW > 0 ? measuredW + measuredReserveRef.current : 0
  const freeLabelW = freeW > 0 ? Math.min(labelWPref, Math.max(150, Math.round(freeW * 0.36))) : labelWPref
  const fitCols = freeW > 0 ? Math.max(1, Math.min(target, Math.floor((freeW - freeLabelW) / MIN_COL_W[granularity]))) : target
  const docked = targetReserve > 0
  const colW = availW > 0
    ? Math.max(docked ? 28 : MIN_COL_W[granularity], Math.floor((availW - labelW) / fitCols))
    : MIN_COL_W[granularity]
  const contentW = labelW + buckets.length * colW
  // Columns are floored to whole pixels, so a sliver of width is left over at the right. It's
  // added as trailing slack so the window can always rest exactly on a column start (today)
  // instead of being clamped short and showing the edge of the previous period.
  // Six months of actuals sit before today. The grid opens with today as its first
  // column; back / forward step the window one period at a time.
  const todayIdx = state.days.indexOf(TODAY_ISO)
  const todayBucket = todayIdx >= 0 ? buckets.findIndex((b) => b.dayIndices.includes(todayIdx)) : -1
  const [edge, setEdge] = useState({ start: false, end: false })
  // Re-anchor on today whenever the timeframe or grid changes. Applied once the new
  // columns have laid out (the morph and the deferred re-render both land late).
  const anchoredFor = useRef('')
  const anchorColW = useRef(0)
  // The first period in view, tracked from deliberate moves only (period buttons,
  // wheel/trackpad, re-anchors) — never read back from scrollLeft after a resize,
  // which the browser clamps and re-snaps as the content narrows.
  const firstBucket = useRef(null)
  // The column splitter only spans the grid, so it never sits over the chart and
  // swallow its hover — the Today line lands right on that divider.
  const [splitTop, setSplitTop] = useState(0)
  useLayoutEffect(() => {
    const tw = alignedRef.current?.querySelector('.tablewrap')
    const sec = alignedRef.current?.closest('.aligned')
    if (!tw || !sec) return
    const t = Math.round(tw.getBoundingClientRect().top - sec.getBoundingClientRect().top)
    if (t !== splitTop) setSplitTop(t)
  })
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || todayBucket < 0 || !(colW > 0)) return
    const key = `${granularity}|${activeTab}|${buckets.length}|${colW}` // colW settles after the first measure
    if (anchoredFor.current === key) return
    const prev = anchoredFor.current
    anchoredFor.current = key
    const ctx = `${granularity}|${activeTab}|${buckets.length}|`
    // only the column width changed (a panel docked, the window resized): hold the
    // same first period in view rather than jumping back to today
    const widthOnly = prev.startsWith(ctx) && firstBucket.current != null
    const keepBucket = widthOnly ? firstBucket.current : null
    anchorColW.current = colW
    const back = restoreRef.current && restoreRef.current.tabId === activeTab && restoreRef.current.bucket != null ? restoreRef.current : null
    const wk = weekendKeep.current
    weekendKeep.current = null
    const left = back ? back.bucket * colW : wk != null ? wk * colW : keepBucket != null ? keepBucket * colW : todayBucket * colW
    firstBucket.current = Math.round(left / colW)
    el.scrollLeft = left
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = left })
  }, [granularity, activeTab, todayBucket, colW, buckets.length, contentW]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const back = restoreRef.current
    if (!back || back.tabId !== activeTab) return
    restoreRef.current = null
    if (back.selection?.length) setSelection(back.selection)
    requestAnimationFrame(() => window.scrollTo({ top: back.scrollY ?? 0 }))
  }, [activeTab])
  ctxRef.current = { colW, selection }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const onScroll = () => setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 })
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, contentW])
  // Controls in the sticky label column (Group by, the period arrows, row ticks, the
  // grouping tray) sit at x=0 in layout terms, so focusing one makes the browser
  // scroll the grid back to Jan '26 "to reveal it". Hold the window where it was.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    let keep = null
    let t = 0
    const arm = () => { keep = el.scrollLeft; clearTimeout(t); t = setTimeout(() => { keep = null }, 500) }
    const onKey = (e) => { if (e.key === 'Tab') arm() }
    const onFocus = (e) => {
      if (keep == null || !e.target.closest('.grid__rowhead, .grouptray, .grouptray__row')) return
      const x = keep
      if (el.scrollLeft !== x) el.scrollLeft = x
      requestAnimationFrame(() => { if (el.scrollLeft !== x) el.scrollLeft = x })
    }
    el.addEventListener('pointerdown', arm, true)
    el.addEventListener('keydown', onKey, true)
    el.addEventListener('focusin', onFocus)
    return () => {
      clearTimeout(t)
      el.removeEventListener('pointerdown', arm, true)
      el.removeEventListener('keydown', onKey, true)
      el.removeEventListener('focusin', onFocus)
    }
  }, [scrollRef])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    let user = false
    const mark = () => { user = true }
    const onEnd = () => {
      if (!user || widthFrozen.current || !(anchorColW.current > 0)) return
      user = false
      firstBucket.current = Math.round(el.scrollLeft / anchorColW.current)
    }
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('touchstart', mark, { passive: true })
    el.addEventListener('scrollend', onEnd)
    return () => { el.removeEventListener('wheel', mark); el.removeEventListener('touchstart', mark); el.removeEventListener('scrollend', onEnd) }
  }, [scrollRef]) // eslint-disable-line react-hooks/exhaustive-deps
  // The low-point finder scrolls the grid to the lowest day; switching it off
  // returns to the period the user was on before they asked.
  const lowOrigin = useRef(null)
  const toggleFindLow = () => {
    setFindLow((on) => {
      const el = scrollRef.current
      if (!on) {
        lowOrigin.current = firstBucket.current ?? (el && colW > 0 ? Math.round(el.scrollLeft / colW) : null)
      } else if (lowOrigin.current != null && el) {
        const b = lowOrigin.current
        lowOrigin.current = null
        firstBucket.current = b
        requestAnimationFrame(() => el.scrollTo({ left: b * colW, behavior: 'smooth' }))
      }
      return !on
    })
  }
  const stepPeriod = (d) => {
    const el = scrollRef.current
    if (!el) return
    const cur = firstBucket.current ?? Math.round(el.scrollLeft / colW)
    const maxB = Math.max(0, Math.round((el.scrollWidth - el.clientWidth) / colW))
    const next = Math.min(maxB, Math.max(0, cur + d))
    firstBucket.current = next
    el.scrollTo({ left: next * colW, behavior: 'smooth' })
  }
  // Chart grows to use vertical space in the full-screen scratchpad view.
  const chartH = scratchpad ? Math.max(340, Math.round(viewportH * 0.46)) : CHART_H

  // --- edits ----------------------------------------------------------------
  const setCell = useCallback((section, rowId, dayIndex, value) => {
    setState((s) => ({
      ...s,
      [section]: s[section].map((row) =>
        row.id !== rowId ? row : { ...row, values: row.values.map((v, i) => (i === dayIndex ? value : v)) }
      ),
    }))
  }, [])

  const setRowName = useCallback((section, rowId, name) => {
    setState((s) => ({ ...s, [section]: s[section].map((r) => (r.id === rowId ? { ...r, name } : r)) }))
  }, [])

  const addRow = useCallback((section) => {
    setState((s) => ({
      ...s,
      [section]: [
        ...s[section],
        {
          id: uid('r'),
          name: section === 'inflows' ? 'New inflow' : 'New outflow',
          values: s.days.map(() => 0),
          model: { name: 'Seasonal Naïve', category: 'Statistical' },
        },
      ],
    }))
  }, [])

  // Per-entity contribution to the group closing balance, in the group currency.
  // Always computed so the bar stays put when switching tabs.
  const contributions = useMemo(
    () =>
      ENTITIES.map((e) => {
        const eff = shockState(tabStates[e.id], shocksForTab(e.id))
        const d = computeDaily(eff)
        const closingLocal = d.dailyClosing[d.dailyClosing.length - 1] ?? 0
        const lowestLocal = d.dailyClosing.length ? Math.min(...d.dailyClosing) : 0
        return {
          id: e.id,
          company: e.company,
          currency: e.currency,
          label: e.label,
          fx: e.fx,
          gbpClosing: (closingLocal / e.fx) * groupCcy.fx,
          // local-currency figures for the entity picker's rich rows
          closingLocal,
          lowestLocal,
          closingText: closingLocal.toLocaleString(e.locale, { style: 'currency', currency: e.currency, maximumFractionDigits: 0 }),
          shocks: Object.values(shocksForTab(e.id)).reduce((n, a) => n + a.length, 0),
        }
      }),
    [tabStates, groupCcy.fx, shocksForTab]
  )
  const groupClosing = contributions.reduce((s, c) => s + c.gbpClosing, 0)
  // Contributions are always shown in the group currency (independent of the
  // active entity tab's own currency).
  const groupFmt = useMemo(
    () => new Intl.NumberFormat(groupCcy.locale, { style: 'currency', currency: groupCcy.code, maximumFractionDigits: 0 }),
    [groupCcy]
  )

  // Closing balance of every account and pool cut, each in its own currency, so
  // the picker can show what a grid holds before you open it. Computed from the
  // shocked entity states, exactly as the grids themselves are.
  const scopeDetails = useMemo(() => {
    const shocked = Object.fromEntries(
      ENTITIES.map((e) => [e.id, shockState(tabStates[e.id], shocksForTab(e.id))])
    )
    const cut = (entityIds, accountIds, ccy) => {
      const outFx = CCY_FX[ccy] ?? 1
      const srcs = entityIds.map((id) => {
        const e = ENTITIES.find((x) => x.id === id)
        return { state: shocked[id], conv: fxConv(e.fx, outFx) }
      })
      const d = computeDaily(scopeState(srcs, accountIds))
      const closing = d.dailyClosing[d.dailyClosing.length - 1] ?? 0
      return {
        closing,
        closingText: closing.toLocaleString(CCY_LOCALE[ccy] ?? 'en-GB', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }),
        gbpClosing: (closing / outFx) * groupCcy.fx, // for the share-of-group figure
      }
    }
    return {
      accounts: Object.fromEntries(ALL_ACCOUNTS.map((a) => [a.id, cut([a.entityId], new Set([a.id]), a.currency)])),
      pools: Object.fromEntries(
        ALL_POOLS.map((p) => [
          p.id,
          cut([...new Set(p.accounts.map((a) => a.entityId))], new Set(p.accounts.map((a) => a.id)), p.ccy),
        ])
      ),
    }
  }, [tabStates, shocksForTab, groupCcy.fx])

  // Breadcrumb, route browser and Load — replaces the Group tab + view picker.
  const nav = useGridNav({ activeTab, view, scopeDetails, groupCcy, groupText: groupFmt.format(groupClosing), onLoad: goToTab })

  // --- headline metrics (from daily series) ---------------------------------
  const closingEnd = daily.dailyClosing[daily.dailyClosing.length - 1] ?? 0
  const lowest = daily.dailyClosing.length ? Math.min(...daily.dailyClosing) : 0
  const lowestIdx = daily.dailyClosing.length ? daily.dailyClosing.indexOf(lowest) : -1
  const netTotal = daily.dailyNet.reduce((a, b) => a + b, 0)

  const baseClosing = baseDaily.dailyClosing[baseDaily.dailyClosing.length - 1] ?? 0
  const baseLowest = baseDaily.dailyClosing.length ? Math.min(...baseDaily.dailyClosing) : 0
  const baseNet = baseDaily.dailyNet.reduce((a, b) => a + b, 0)

  // Scenario impact shown on the KPI cards. The KPIs are always the balance-level
  // figures, so this is computed whenever a scenario is selected — regardless of
  // whether a category is isolated — which keeps the card heights (and the whole
  // page layout) stable when drilling into a row.
  const scenarioObj = overlays.find((s) => s.id === overlayId)
  const kpiScenario = useMemo(() => {
    if (!scenarioObj) return null
    const s = scenarioObj.apply(daily.dailyClosing, ordinals)
    const sClosing = s[s.length - 1] ?? 0
    return {
      code: scenarioObj.code,
      color: scenarioObj.color,
      closing: sClosing,
      lowest: s.length ? Math.min(...s) : 0,
      net: sClosing - (Number(state.openingBalance) || 0),
    }
  }, [scenarioObj, daily.dailyClosing, ordinals, state.openingBalance])

  // Composite KPI impact: shock (vs pre-shock base), scenario (additional, on
  // top of shocks), and their combined total. Rows shown only when non-zero.
  const buildImpact = (shocked, base, scnVal) => {
    const shockD = shocked - base
    const hasShock = Math.round(shockD) !== 0
    const scnD = kpiScenario && scnVal != null ? scnVal - shocked : 0
    const hasScn = kpiScenario && scnVal != null && Math.round(scnD) !== 0
    if (!hasShock && !hasScn) return null
    return {
      shock: hasShock ? shockD : null,
      scenario: hasScn ? { code: kpiScenario.code, delta: scnD } : null,
      total: hasShock && hasScn ? scnVal - base : null,
    }
  }

  // Weekends hidden: the chart drops Saturday and Sunday too, in every period.
  // A balance line takes Monday's closing over the weekend (which already
  // includes the weekend's flows); a flow series folds the weekend into Monday.
  const weekendMask = useMemo(() => (showWeekends ? null : state.days.map((iso) => new Date(iso + 'T00:00:00Z').getUTCDay() % 6 === 0)), [showWeekends, state.days])
  const nextVisible = useMemo(() => {
    if (!weekendMask) return null
    const n = weekendMask.length, nx = new Array(n)
    let next = -1
    for (let i = n - 1; i >= 0; i--) { if (!weekendMask[i]) next = i; nx[i] = next }
    let prev = -1
    for (let i = 0; i < n; i++) { if (!weekendMask[i]) prev = i; else if (nx[i] < 0) nx[i] = prev }
    return nx
  }, [weekendMask])
  const carry = (s) => (weekendMask && s ? s.map((v, i) => (weekendMask[i] && nextVisible[i] >= 0 ? s[nextVisible[i]] : v)) : s)
  const fold = (s) => {
    if (!weekendMask || !s) return s
    const o = s.slice()
    for (let i = 0; i < o.length; i++) if (weekendMask[i] && nextVisible[i] >= 0 && nextVisible[i] !== i) { o[nextVisible[i]] += Number(s[i]) || 0 }
    for (let i = 0; i < o.length; i++) if (weekendMask[i] && nextVisible[i] >= 0) o[i] = o[nextVisible[i]]
    return o
  }
  const chartLines = useMemo(() => (weekendMask ? lines.map((l) => ({ ...l, series: focusActive ? fold(l.series) : carry(l.series) })) : lines), [lines, weekendMask, focusActive]) // eslint-disable-line react-hooks/exhaustive-deps
  const chartStack2 = useMemo(() => (weekendMask && stack ? { ...stack, bands: stack.bands.map((b) => ({ ...b, values: fold(b.values) })) } : stack), [stack, weekendMask]) // eslint-disable-line react-hooks/exhaustive-deps
  // Toggling weekends in the Days view changes the column count. Hold the same
  // day at the left edge (the bucket that now contains it), and tell the chart
  // how far the scroll moves so its morph starts from where the line was on screen.
  const wkKey = `${granularity}|${activeTab}|${showWeekends}`
  const wkPrev = useRef({ key: wkKey, buckets })
  const wkShift = useRef({ key: wkKey, shift: 0 })
  const weekendKeep = useRef(null)
  if (wkPrev.current.key !== wkKey) {
    const p = wkPrev.current
    let shift = 0
    if (p.key.startsWith(`${granularity}|${activeTab}|`) && firstBucket.current != null && p.buckets[firstBucket.current]) {
      const ob = p.buckets[firstBucket.current]
      const d = ob.dayIndices[ob.dayIndices.length - 1]
      const nb = buckets.findIndex((b) => b.dayIndices.includes(d))
      if (nb >= 0) {
        weekendKeep.current = nb
        shift = nb * colW - firstBucket.current * (anchorColW.current || colW)
      }
    }
    wkShift.current = { key: wkKey, shift }
    wkPrev.current = { key: wkKey, buckets }
  } else wkPrev.current.buckets = buckets
  // With a panel docked the columns narrow. If whole-unit figures would no longer
  // fit their cells, step up to thousands for as long as a panel is open; the
  // user's own choice is untouched, so closing the panels restores it.
  const widestFigure = useMemo(() => {
    let m = 0
    const scan = (arr) => { if (arr) for (const v of arr) { const a = Math.abs(Number(v) || 0); if (a > m) m = a } }
    scan(agg.opening); scan(agg.closing); scan(agg.totalInflows); scan(agg.totalOutflows); scan(agg.net); scan(agg.sweep)
    for (const r of [...(agg.inflowRows || []), ...(agg.outflowRows || [])]) scan(r.buckets || r.values)
    return m
  }, [agg])
  const baseChars = Math.round(widestFigure).toLocaleString(displayLocale).length + (widestFigure > 0 ? 1 : 0) // + sign room
  const bleeds = colW > 0 && baseChars * 7.6 + 16 > colW
  const autoK = targetReserve > 0 && multiplier === 'base' && bleeds
  const shownMultiplier = autoK ? 'k' : multiplier
  return (
    <CurrencyProvider currency={displayCurrency} locale={displayLocale} multiplier={shownMultiplier}>
    <div className="shell">
    <UniunRail theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} skin={skin} onToggleSkin={() => setSkin((s) => (s === 'enterprise' ? 'uniun' : 'enterprise'))} />
    <div ref={appRef} className={`app ${dock.right ? 'app--docked' : ''} ${dock.left ? 'app--docked-left' : ''} ${wantLeft && wantRight ? 'app--both' : ''} ${nav.open ? 'app--navopen' : ''} ${nav.isOpen ? 'app--navshown' : ''}`}>
      {/* grid navigator: breadcrumb bar + in-frame route browser */}
      <div className="gnavwrap">
      <div className="tabbar">
        <div className="tabbar__tabs">
          {/* Group vs Local grids, with one pink underline that slides between
              them to mark which view is active. */}
          {nav.bar}
        </div>
      </div>
      {nav.band}
      </div>
      {nav.editor}

      <header className="app__header">
        <div className="app__titleblock">
          {nav.crumbs}
          {/* The descriptive caption lives in the pill's tooltip rather than a
              subtitle line, to keep the header short. */}
          <h1>
            <button className={`titlenav ${nav.isOpen ? 'titlenav--on' : ''}`} onClick={nav.toggle} aria-expanded={nav.isOpen} aria-label="Change grid">
              <span className="titlenav__label" aria-hidden>Change grid</span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" />
              </svg>
            </button>
            <span>{view.title}</span>
            {view.kind === 'account' && <span className="app__acct"><AcctBadge number={view.account.number} /></span>}
            {isSummary ? (
              /* the group can be re-denominated, so its currency is editable
                 in place; entity grids show their own currency as plain text */
              <CurrencyPicker value={groupCurrency} onChange={setGroupCurrency} />
            ) : (
              <span className="app__ccy">{displayCurrency}</span>
            )}
          </h1>
        </div>
        {/* The isolated-flow readout rides the title line rather than occupying a
            bar of its own. As its own row it appeared and disappeared with the
            selection, shunting the chart down and up every time you moved between
            Cell and Row mode; here it sits inside the header's existing height. */}
        {focusActive && (
          <div className="focushead">
            <span className="focushead__label">{singleFocus ? 'Isolated flow' : 'Net of selection'}</span>
            <span className="focusbar__series">
              <span className="dd__dot" style={{ background: focusColor }} />
              {singleFocus ? (
                <>
                  <span className="focusbar__name">{singleFocus.name}</span>
                  {singleFocus.modelled && singleFocus.model ? (
                    <>
                      <CategoryTag category={singleFocus.model.category} />
                      <span className="focusbar__model">{singleFocus.model.name}</span>
                    </>
                  ) : (
                    <span className="tag tag--manual">Manual</span>
                  )}
                </>
              ) : (
                /* A set has no one model behind it, so it lists what's in it and
                   each chip drops its own category back out. Capped, and kept on
                   one line, so a big selection can't grow the header — the grid's
                   own tickboxes are the full picture. */
                <span className="focusbar__chips">
                  {focusRows.slice(0, HEAD_CHIPS).map((r) => (
                    <button
                      key={`${r.section}:${r.id}`}
                      className={`focuschip focuschip--${r.section === 'outflows' ? 'out' : 'in'}`}
                      onClick={() => toggleFocus(r.section, r)}
                      title={`Remove ${r.name} from the selection`}
                    >
                      <span className="focuschip__dot" style={r.color ? { background: r.color } : undefined} />
                      <span className="focuschip__name">{r.name}</span>
                      <span className="focuschip__x" aria-hidden>×</span>
                    </button>
                  ))}
                  {focusRows.length > HEAD_CHIPS && (
                    <span className="focuschip focuschip--more" title={focusRows.slice(HEAD_CHIPS).map((r) => r.name).join(', ')}>
                      +{focusRows.length - HEAD_CHIPS}
                    </span>
                  )}
                </span>
              )}
              {!singleFocus && (
                /* Narrow windows squeeze the chips past the point of being
                   readable, so there the CSS swaps them for this plain count. */
                <span className="focushead__count" title={focusRows.map((r) => r.name).join(', ')}>
                  {focusRows.length} categories
                </span>
              )}
            </span>
            <button className="gclosebtn backbalbtn" onClick={clearSelection}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
              Back to balance
            </button>
          </div>
        )}
        {/* right-aligned, so it lines up with the right edge of the last KPI card */}
        <div className="app__controls">
          <span className={`app__mult ${shownMultiplier === 'k' ? 'app__mult--on' : ''} ${autoK ? 'app__mult--auto' : ''}`} title={autoK ? 'Shown in thousands while the side panels are open, so figures fit their narrower columns' : 'Grid figures in thousands'} aria-hidden={shownMultiplier !== 'k'}>{autoK && <span className="app__multauto">Auto</span>}000s</span>
          <span className={`app__mult app__wkd ${!showWeekends ? 'app__mult--on' : ''}`} title={granularity === 'day' ? 'Weekends hidden — Saturday and Sunday are folded into Monday' : 'Weekends hidden in the Days view'} aria-hidden={showWeekends}>Mon–Fri</span>
          <Segmented value={granularity} onChange={setGranularity} onStart={markBusy} />
          <ViewMenu multiplier={multiplier} onMultiplier={setMultiplier} autoK={autoK} showWeekends={showWeekends} onWeekends={setShowWeekends} showChart={showChart} onChart={setShowChart} groupArea={groupArea} onGroupArea={setGroupArea} />
        </div>
      </header>

      {showContrib && (
      <section className="contrib">
        <span className="contrib__label">
          Contributions to group closing ({groupCcy.code})
          {!isSummary && <span className="contrib__note"> · highlighting {view.title}</span>}
        </span>
        <div className="contrib__bar">
          {contributions.map((c, i) => (
            <div
              key={c.id}
              className={`contrib__seg ${!isSummary && !view.entityIds.includes(c.id) ? 'contrib__seg--dim' : ''}`}
              style={{
                width: `${groupClosing ? Math.max(0, (c.gbpClosing / groupClosing) * 100) : 0}%`,
                background: CONTRIB_COLORS[i % CONTRIB_COLORS.length],
              }}
              title={`${c.company}: ${Math.round((c.gbpClosing / groupClosing) * 100)}%`}
            />
          ))}
        </div>
        <div className="contrib__legend">
          {contributions.map((c, i) => (
            <button
              key={c.id}
              className={`contrib__item ${!isSummary && !view.entityIds.includes(c.id) ? 'contrib__item--dim' : ''} ${!isSummary && view.entityIds.includes(c.id) ? 'contrib__item--active' : ''}`}
              onClick={() => goToTab(c.id)}
              title={`Open ${c.company}`}
            >
              <span className="contrib__dot" style={{ background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} />
              <span className="contrib__co">{c.company}</span>
              <span className="contrib__ccy">{c.currency}</span>
              <span className="contrib__val">
                {groupFmt.format(c.gbpClosing)} <span className="contrib__share">{Math.round((groupClosing ? c.gbpClosing / groupClosing : 0) * 100)}%</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      )}

      <section className="metrics">
        <Metric
          label="Opening balance"
          value={state.openingBalance}
          onFind={() => showBalance('opening')}
          finding={balOpen.opening}
          findTitle={balOpen.opening ? 'Hide the accounts behind the opening balance' : 'Show the actual account balances this opens on'}
        />
        <Metric
          label="Net over horizon"
          value={netTotal}
          signed
          impact={buildImpact(netTotal, baseNet, kpiScenario?.net)}
        />
        <Metric
          label="Lowest point"
          value={lowest}
          tone={lowest < 0 ? 'danger' : undefined}
          impact={buildImpact(lowest, baseLowest, kpiScenario?.lowest)}
          onFind={focusActive || lowestIdx < 0 ? undefined : toggleFindLow}
          finding={findLow && !focusActive}
          findTitle={findLow ? 'Hide the lowest point on the chart' : 'Find the lowest point on the chart'}
        />
        {/* far right: the horizon's end, on the same side its panel docks */}
        <Metric
          label="Closing balance"
          value={closingEnd}
          impact={buildImpact(closingEnd, baseClosing, kpiScenario?.closing)}
          onFind={() => showBalance('closing')}
          finding={balOpen.closing}
          findTitle={balOpen.closing ? 'Hide the accounts behind the closing balance' : 'Show the forecast account balances this ends on'}
        />
      </section>

      {/* One bar, whatever the grid is showing. The isolation readout has moved to
          the header, so this carries only the scenario and shock controls — and
          appears only when you've asked for them. */}
      {showScenario || activeShockCount > 0 ? (
        <div className="scenariobar">
          {/* Diverge shocks is a shock control, not a scenario one, so it stays
              put when the scenario controls are hidden. */}
          {showScenario && (
            <>
              <span className="scenariobar__label">Scenario</span>
              <OverlayDropdown
                base={dropdownBase}
                baseName={focusActive ? focusLabel : 'Base'}
                overlays={overlays}
                overlayId={overlayId}
                onOverlay={setOverlayId}
                bandIds={bandIds}
                onToggleBand={toggleBand}
              />
              {overlayId !== 'none' && !divergeShocks && <EmphasisSwitch value={emphasis} onChange={setEmphasis} />}
            </>
          )}
          {/* the divergence splits the balance line, so it has nothing to say
              while a category selection is on the chart */}
          {activeShockCount > 0 && !focusActive && (
            <button
              className={`btn btn--sm divergebtn ${divergeShocks ? 'divergebtn--on' : ''}`}
              onClick={() => setDivergeShocks((v) => !v)}
              title="Split the line into its pre-shock path (grey ghost) and shocked path (pink)"
            >
              <ShockIcon size={13} />
              Diverge shocks
            </button>
          )}
          <button
            className={`btn btn--sm shockapply ${shocksOpen ? 'shockapply--on' : ''}`}
            onClick={() => setShocksOpen((o) => !o)}
            aria-pressed={shocksOpen}
            title="Open the manual shocks panel"
          >
            <ShockIcon size={13} />
            Apply shocks
            {totalShocks > 0 && <span className="shockapply__count">{totalShocks}</span>}
          </button>
          {showScenario && (
            <span className="scenariobar__hint">± toggles each series' forecast error band · switch the grid to Row mode to chart categories</span>
          )}
        </div>
      ) : null}

      {/* One scroll container so chart + table move and align together */}
      <section className={`aligned aligned--area-${groupArea} ${scratchpad ? 'aligned--scratch' : ''} ${scratchClosing ? 'aligned--scratch-closing' : ''}`}>
        {scratchpad && (
          <div className="scratchbar">
            <span className="scratchbar__title">
              <span className="scratchbar__dot" />
              {view.title} · {focusActive ? focusLabel : 'Cash forecast'}
              <span className="scratchbar__tag">Scratchpad</span>
            </span>
            <button className="scratchbar__close" onClick={closeScratchpad} title="Close scratchpad (Esc)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Close
            </button>
          </div>
        )}
        {!scratchpad && (
          <button className="expandbtn" onClick={openScratchpad} title="Expand to full-screen scratchpad" aria-label="Scratchpad">
            <span className="expandbtn__label" aria-hidden>Scratchpad</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        )}
        {/* Draggable splitter sitting on the category/data divider. The label
            column is sticky, so this stays put while the columns scroll. */}
        <div
          className={`splitter ${dragging ? 'splitter--on' : ''}`}
          style={{ left: labelW }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the category column"
          aria-valuenow={labelW}
          aria-valuemin={LABEL_W_MIN}
          aria-valuemax={LABEL_W_MAX}
          tabIndex={0}
          title="Drag to resize the category column (double-click to reset)"
          onPointerDown={onSplitterDown}
          onPointerMove={onSplitterMove}
          onPointerUp={onSplitterUp}
          onPointerCancel={onSplitterUp}
          onDoubleClick={() => setLabelW(LABEL_W_DEFAULT)}
          onKeyDown={onSplitterKey}
        >
          <span className="splitter__grip" aria-hidden />
        </div>
        <div className="gridhead" ref={headRef}>
          <div className="gridhead__clip">
            <div className="gridhead__content" style={{ width: contentW + Math.max(0, availW - labelW - fitCols * colW) + freezeSlack }}>
              <ForecastTable
                headOnly
                onHeadGroup={openGroupFromHead}
                buckets={buckets}
                agg={agg}
                granularity={granularity}
                labelW={labelW}
                colW={colW}
                contentW={contentW}
                readOnly={readOnly}
                gridMode={gridMode}
                periodStep={stepPeriod}
                todayBucket={todayBucket}
                periodEdge={edge}
                groupMulti={groupMulti}
                groupSingle={groupSingle}
                groupChain={groupChain}
                groupDisabled={groupDisabled}
                chartStack={chartStack}
              />
            </div>
          </div>
        </div>
        <div className="aligned__scroll" ref={scrollRef} style={{ scrollPaddingLeft: labelW }}>
          <div className="aligned__content" ref={alignedRef} style={{ width: contentW + Math.max(0, availW - labelW - fitCols * colW) + freezeSlack }}>
            <div className={`chartwrap ${showChart ? '' : 'chartwrap--off'}`} aria-hidden={!showChart}>
            <div className="chartwrap__inner">
            <AlignedChart
              skipDays={weekendMask}
              morphShift={wkShift.current.key === wkKey ? wkShift.current.shift : 0}
              morphKey={`${granularity}|${showWeekends}`}
              dockKey={dockKey}
              dockShift={firstBucket.current != null && anchorColW.current > 0 ? firstBucket.current * (colW - anchorColW.current) : 0}
              dockMs={PANEL_MS}
              days={state.days}
              lines={chartLines}
              stack={chartStack2}
              dailyNet={daily.dailyNet}
              buckets={buckets}
              labelW={labelW}
              colW={colW}
              contentW={contentW}
              height={chartH}
              title={stack ? 'Composition' : focusActive ? 'Daily flow' : 'Daily balance'}
              note={noteForChart}
              markers={!focusActive}
              annotations={annotations}
              reserveMarkers={gridHasShocks}
              onAnnotationClick={openShock}
              pinnedDay={findLow && !focusActive && lowestIdx >= 0 ? lowestIdx : null}
              pinnedLabel="Lowest point"
              scrollParentRef={scrollRef}
              onStackHover={setLitRow}
              outliers={outliers}
              activeOutlier={activeOutlier?.dayIndex ?? null}
              onOutlierClick={openOutlier}
              todayIndex={todayIdx >= 0 ? todayIdx : null}
            />
            </div>
            </div>
            <div className="tablewrap">
              {todayBucket >= 0 && todayIdx > 0 && <div className="todayrule" style={{ left: labelW + todayBucket * colW + (buckets[todayBucket].dayIndices.indexOf(todayIdx) / buckets[todayBucket].dayIndices.length) * colW }} aria-hidden />}
            <div className="tablebusy" aria-hidden="true">
              <div className="tablebusy__stick" style={{ width: availW || undefined }}>
              <span className="tablebusy__chip">
                <svg className="tablebusy__spin" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <span className="tablebusy__txt tablebusy__txt--nav">Navigating the model…</span>
                <span className="tablebusy__txt tablebusy__txt--fetch">Fetching the data…</span>
              </span>
              </div>
            </div>
            <ForecastTable
              buckets={buckets}
              agg={agg}
              granularity={granularity}
              labelW={labelW}
              colW={colW}
              contentW={contentW}
              onCell={setCell}
              onRowName={setRowName}
              onOpenBalance={showBalance}
              balanceMode={balOpen}
              onAddRow={addRow}
              readOnly={readOnly}
              canShock={!isScoped}
              gridMode={gridMode}
              periodStep={stepPeriod}
              todayBucket={todayBucket}
              periodEdge={edge}
              selection={selection}
              focusActive={focusActive}
              singleFocus={!!singleFocus}
              onSelectSection={setSectionSelected}
              onFocus={toggleFocus}
              onAddShock={addShock}
              onCellClick={openUnderlying}
              onOpenModel={openModel}
              onGridMode={setGridMode}
              groupMulti={groupMulti}
              onGroupMulti={setGroupMulti}
              groupSingle={groupSingle}
              onGroupSingle={setGroupSingle}
              groupChain={groupChain}
              onGroupChain={setGroupChain}
              groupDisabled={groupDisabled}
              chartStack={chartStack}
              onChartStack={setChartStack}
              stackRow={stack && singleFocus ? { section: singleFocus.section, id: singleFocus.id } : null}
              litRow={litRow}
              underlyingCell={underlying ? { section: underlying.section, rowId: underlying.row.id, bucketKey: underlying.bucket.key } : null}
              shockRanges={shockRangesByRow}
            />
            </div>
          </div>
        </div>
        {/* Net movement / Sweep / Closing balance: a sticky strip, so it pins to the
            viewport bottom natively while the grid runs past it. Horizontal position
            mirrors the grid's scroller. */}
        <div className="gridfoot" ref={footRef}>
          <div className="gridfoot__content" style={{ width: contentW + Math.max(0, availW - labelW - fitCols * colW) + freezeSlack }}>
            <ForecastTable
              footOnly
              buckets={buckets}
              agg={agg}
              granularity={granularity}
              labelW={labelW}
              colW={colW}
              contentW={contentW}
              onOpenBalance={showBalance}
              balanceMode={balOpen}
              readOnly={readOnly}
              gridMode={gridMode}
              todayBucket={todayBucket}
            />
          </div>
        </div>
        {modelRow && (
          <ModelPanel
            row={modelRow}
            detail={modelDetail(modelRow)}
            closing={modelClosing}
            /* sits directly below the chart, so it fills the table's area */
            topOffset={showChart ? chartH + (gridHasShocks || annotations.length > 0 ? 26 : 0) : 0}
            onClose={closeModel}
          />
        )}
      </section>

      <ShocksPanel
        open={shocksOpen}
        shocks={shocks}
        days={state.days}
        highlight={highlightShock}
        activeTab={activeTab}
        onGoToSource={goToTab}
        onClose={() => setShocksOpen(false)}
        onUpdate={updateShock}
        onRemove={removeShock}
      />

      <BalancePanel
        open={balOpen.opening}
        mode="opening"
        order={balOrder}
        hover={balHover}
        onHover={setBalHover}
        view={view}
        breakdown={openBreakdown}
        total={openBreakdown.reduce((s, r) => s + (Number(r.value) || 0), 0)}
        currency={displayCurrency}
        firstDay={TODAY_ISO}
        lastDay={state.days[state.days.length - 1]}
        activeTab={activeTab}
        origin={balanceOrigin}
        onSelectAccount={drillFromOpening}
        onBack={backToOrigin}
        onClose={() => closeBalance()}
      />
      <BalancePanel
        open={balOpen.closing}
        mode="closing"
        side="right"
        order={balOrder}
        hover={balHover}
        onHover={setBalHover}
        view={view}
        breakdown={closeBreakdown}
        total={closingEnd}
        currency={displayCurrency}
        firstDay={TODAY_ISO}
        lastDay={state.days[state.days.length - 1]}
        activeTab={activeTab}
        origin={balanceOrigin}
        onSelectAccount={drillToAccount}
        onBack={backToOrigin}
        onClose={() => closeBalance()}
      />

      <UnderlyingPanel
        open={!!underlying}
        cell={underlying}
        company={view.title}
        currency={displayCurrency}
        onClose={closeUnderlying}
      />

      <OutlierPanel
        open={!!activeOutlier}
        day={activeOutlier ? state.days[activeOutlier.dayIndex] : null}
        scan={activeOutlier ? { ...activeOutlier, ...outlierScan, outliers: undefined } : null}
        detail={outlierDetail}
        soleCategory={outlierSoleCategory}
        seriesLabel={focusActive ? focusLabel : 'Daily net movement'}
        company={view.title}
        currency={displayCurrency}
        index={outlierIndex}
        count={outliers.length}
        onPrev={() => stepOutlier(-1)}
        onNext={() => stepOutlier(1)}
        onClose={closeOutlier}
      />
    </div>
    </div>
    </CurrencyProvider>
  )
}

// The Uniun shell rail, as in the live Honeycomb app: white, hairline edge,
// brand mark on top, the current app's rich icon, then help / Pulse / avatar.
function UniunRail({ theme, onToggleTheme, skin, onToggleSkin }) {
  return (
    <nav className="rail" aria-label="Uniun apps">
      <span className="rail__brand" title="Uniun">
        <img className="rail__mark--dark" src={brandMarkDark} alt="Uniun" />
        <img className="rail__mark--light" src={brandMarkLight} alt="Uniun" />
      </span>
      <span className="rail__apps">
        <button className="railapp railapp--on" title="Forecast (current)" aria-current="page">
          <span className="railapp__badge" aria-hidden>F</span>
        </button>
      </span>
      <span className="rail__foot">
        <span className="rail__tools">
          <button
            className={`themebtn skinbtn ${skin === 'enterprise' ? 'skinbtn--on' : ''}`}
            onClick={onToggleSkin}
            aria-pressed={skin === 'enterprise'}
            title={skin === 'enterprise' ? 'Switch to the Uniun skin' : 'Switch to the Enterprise skin'}
            aria-label="Toggle Enterprise skin"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 9v11" />
            </svg>
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </span>
        <button className="railhelp" title="Help" aria-label="Help">?</button>
        <button className="railpulse" title="Pulse" aria-label="Pulse"><svg viewBox="50 80 162 72" width="46" height="20" aria-hidden>
            <circle fill="#00EDFF" cx="135.63" cy="125.08" r="22" />
            <path fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" d="M55.63,125.08h15.46c2.74,0,5.21-1.67,6.23-4.22l12.76-31.91c2.150-5.38,9.64-5.69,12.230-0.51l27.31,54.63c2.47,4.95,9.53,4.95,12,0l11-21.99c1.66-3.32,5.69-4.66,9-3.16l30.99,11" />
          </svg></button>
        <button className="railavatar" title="Your account" aria-label="Your account">GL</button>
      </span>
    </nav>
  )
}

function ViewSwitch({ on, onChange, label }) {
  return (
    <button className={`vswitch ${on ? 'vswitch--on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="vswitch__knob" aria-hidden />
    </button>
  )
}

// "View" — a home for display controls. Opens a small popover under the button.
function ViewMenu({ multiplier, onMultiplier, autoK, showWeekends, onWeekends, showChart, onChart, groupArea, onGroupArea }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className={`viewmenu ${open ? 'viewmenu--open' : ''}`} ref={ref}>
      <button className="viewmenu__btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label="View">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" />
        </svg>
        <span className="viewmenu__label" aria-hidden>View</span>
      </button>
      {open && (
        <div className="viewmenu__panel" role="dialog" aria-label="View options">
          <div className="viewmenu__title">View</div>
          <div className="viewmenu__row">
            <span className="viewmenu__label-text">
              <span className="viewmenu__name">Number format</span>
              <span className="viewmenu__hint">{autoK ? 'Thousands while panels are open' : multiplier === 'k' ? 'Grid figures in thousands' : 'Grid figures in whole units'}</span>
            </span>
            <span className="seg seg--sm viewmenu__seg" role="radiogroup" aria-label="Number format">
              {[['base', 'Base'], ['k', 'K']].map(([k, label]) => (
                <button key={k} className={`seg__btn ${multiplier === k ? 'seg__btn--on' : ''}`} role="radio" aria-checked={multiplier === k} onClick={() => onMultiplier(k)}>{label}</button>
              ))}
            </span>
          </div>
          <div className="viewmenu__row">
            <span className="viewmenu__label-text">
              <span className="viewmenu__name">Weekends</span>
              <span className="viewmenu__hint">{showWeekends ? 'Shown as their own days' : 'Folded into Monday (Days view)'}</span>
            </span>
            <ViewSwitch on={showWeekends} onChange={onWeekends} label="Show weekends" />
          </div>
          <div className="viewmenu__row">
            <span className="viewmenu__label-text">
              <span className="viewmenu__name">Chart</span>
              <span className="viewmenu__hint">{showChart ? 'Daily balance above the grid' : 'Grid only'}</span>
            </span>
            <ViewSwitch on={showChart} onChange={onChart} label="Show chart" />
          </div>
          <div className={`viewmenu__row ${showChart ? '' : 'viewmenu__row--off'}`}>
            <span className="viewmenu__label-text">
              <span className="viewmenu__name">Grouping area</span>
              <span className="viewmenu__hint">{groupArea === 'context' ? 'Chart key pinned above the groupings' : 'Chart runs under the groupings'}</span>
            </span>
            <span className="seg seg--sm viewmenu__seg" role="radiogroup" aria-label="Grouping area">
              {[['chart', 'Chart'], ['context', 'Context']].map(([k, label]) => (
                <button key={k} className={`seg__btn ${groupArea === k ? 'seg__btn--on' : ''}`} role="radio" aria-checked={groupArea === k} disabled={!showChart} onClick={() => onGroupArea(k)}>{label}</button>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Segmented({ value, onChange, onStart }) {
  // A single green pill slides between the options rather than each button
  // swapping its own fill.
  const boxRef = useRef(null)
  const btnRefs = useRef({})
  const [pill, setPill] = useState(null)
  // a faint ghost of the pill glides to whichever option is under the pointer
  const [ghost, setGhost] = useState(null)
  const hoverAt = (k) => {
    const el = btnRefs.current[k]
    if (!el) return
    setGhost({ left: el.offsetLeft, width: el.offsetWidth, on: k !== shown })
  }
  // The pill follows a local choice set on click, so it slides immediately;
  // the expensive grid re-render is deferred until after that frame paints.
  const [shown, setShown] = useState(value)
  useEffect(() => { setShown(value) }, [value])
  const choose = (k) => {
    if (k === shown) return
    setShown(k)
    onStart?.()
    requestAnimationFrame(() => setTimeout(() => onChange(k), 40)) // one painted frame for the pill, then go
  }
  useLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[shown]
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (boxRef.current) ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [shown])
  return (
    <div className="seg seg--slide" role="tablist" aria-label="Granularity" ref={boxRef} onMouseLeave={() => setGhost((g) => (g ? { ...g, on: false } : g))}>
      {ghost && <span className={`seg__ghost ${ghost.on ? 'seg__ghost--on' : ''}`} style={{ transform: `translateX(${ghost.left}px)`, width: ghost.width }} aria-hidden />}
      {pill && <span className="seg__pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden />}
      {GRANULARITIES.map((g) => (
        <button
          key={g.key}
          ref={(el) => { btnRefs.current[g.key] = el }}
          role="tab"
          aria-selected={shown === g.key}
          className={`seg__btn ${shown === g.key ? 'seg__btn--on' : ''}`}
          onMouseEnter={() => hoverAt(g.key)}
          onClick={() => { choose(g.key); setGhost((gh) => (gh ? { ...gh, on: false } : gh)) }}
        >
          {g.label}
        </button>
      ))}
    </div>
  )
}

// Every non-group grid behind one capsule. The dimension is picked at the top of
// the menu and drives the list beneath it: companies, their bank accounts, or the
// cash pools those accounts sit in. Rows are "rich" — each carries the grid's
// closing balance, share of the group and any shocks on it, so you can pick a
// grid on its numbers rather than just its name.
function ViewPicker({
  entities, accounts, pools, details, scopeDetails, view, activeTab,
  groupFmt, groupCcyCode, groupClosing, onSelect,
}) {
  const [open, setOpen] = useState(false)
  // The dimension being browsed. Opens on whichever one the active grid belongs
  // to, so the menu always starts where you left off.
  const [dim, setDim] = useState(view.dim)
  // Free-text filter across every grid's name, currency, bank, account number
  // and pool — a query in flight overrides the dimension tabs, since finding
  // an item is more useful here than browsing one dimension at a time.
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const searchRef = useRef(null)
  useEffect(() => {
    if (!open) { setQuery(''); return undefined }
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    // Autofocus so typing can start the moment the menu opens.
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open])

  const isGroup = view.kind === 'group'
  const pick = (id) => { onSelect(id); setOpen(false) }
  const share = (gbp) => (groupClosing ? Math.round(((gbp || 0) / groupClosing) * 100) : 0)
  const total = entities.length + accounts.length + pools.length

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const hit = (...vals) => vals.some((v) => v && String(v).toLowerCase().includes(q))
  const matchedEntities = searching ? entities.filter((e) => hit(e.company, e.currency, e.label)) : []
  const matchedAccounts = searching
    ? accounts.filter((a) => hit(a.name, a.number, a.bank, a.currency, a.pool && CASH_POOLS[a.pool]?.name))
    : []
  const matchedPools = searching
    ? pools.filter((p) => hit(p.name, p.ccy, p.type, ...p.accounts.map((a) => a.company)))
    : []
  const noMatches = searching && !matchedEntities.length && !matchedAccounts.length && !matchedPools.length

  // What the capsule reads when a grid is open: its name plus one short chip.
  const chip = view.kind === 'account' ? `···${view.account.number}`
    : view.kind === 'pool' ? view.pool.ccy
    : view.currency

  const byId = Object.fromEntries(details.map((d) => [d.id, d]))
  const head = VIEW_DIMS.find((d) => d.id === dim)?.head ?? 'Grids'

  return (
    <span className={`entpick ${open ? 'entpick--open' : ''}`} ref={ref}>
      <button
        className={`entpick__btn ${!isGroup ? 'entpick__btn--on' : ''}`}
        onClick={() => { if (!open) setDim(view.dim); setOpen((o) => !o) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isGroup ? 'Choose a company, bank account or cash pool grid' : `${view.title} · ${view.subtitle}`}
      >
        {isGroup
          ? <><span className="entpick__co">Local grids</span><span className="entpick__ccy">{total}</span></>
          : <><span className="entpick__co">{view.title}</span><span className="entpick__ccy">{chip}</span></>}
        <svg className="entpick__chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6.5 8 10.5 12 6.5" />
        </svg>
      </button>

      {open && (
        <div className="entpick__menu entpick__menu--dims" role="listbox">
          <div className="entpick__search">
            <svg className="entpick__searchicon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11 15 15" />
            </svg>
            <input
              ref={searchRef}
              className="entpick__searchfield"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company, account or pool…"
              aria-label="Search grids"
            />
            {searching && (
              <button
                type="button"
                className="entpick__searchclear"
                onClick={() => { setQuery(''); searchRef.current?.focus() }}
                aria-label="Clear search"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {/* top-level dimension, driving the sub-selection below — moot once a
              search is in flight, since results are shown across all of them */}
          {!searching && (
            <div className="seg seg--dims">
              {VIEW_DIMS.map((d) => (
                <button
                  key={d.id}
                  className={`seg__btn ${dim === d.id ? 'seg__btn--on' : ''}`}
                  onClick={() => setDim(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {!searching && <div className="entpick__head">{head}</div>}
          {noMatches && <div className="entpick__empty">No grids match "{query.trim()}"</div>}

          {searching && matchedEntities.length > 0 && <div className="entpick__head">Company</div>}
          {(searching ? matchedEntities : dim === 'company' ? entities : []).map((e) => {
            const d = byId[e.id] || {}
            const on = e.id === activeTab
            const i = entities.findIndex((x) => x.id === e.id)
            return (
              <button key={e.id} className={`entrow ${on ? 'entrow--on' : ''}`} role="option" aria-selected={on} onClick={() => pick(e.id)}>
                <span className="entrow__dot" style={{ background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} />
                <span className="entrow__main">
                  <span className="entrow__co">{e.company}</span>
                  <span className="entrow__meta">
                    <span className="entrow__ccy">{e.currency}</span>
                    <span className="entrow__share">{share(d.gbpClosing)}% of group</span>
                    {d.shocks > 0 && <span className="entrow__shocks"><ShockIcon size={10} />{d.shocks}</span>}
                  </span>
                </span>
                <span className="entrow__figs">
                  <span className="entrow__closing">{d.closingText}</span>
                  {/* the group-currency equivalent only adds anything when the
                      local currency differs from the group's */}
                  <span className="entrow__sub">
                    {d.currency === groupCcyCode ? 'closing' : `closing · ${groupFmt.format(d.gbpClosing || 0)}`}
                  </span>
                </span>
              </button>
            )
          })}

          {searching && matchedAccounts.length > 0 && <div className="entpick__head">Bank account</div>}
          {(searching ? matchedAccounts : dim === 'account' ? accounts : []).map((a) => {
            const id = acctTab(a.id)
            const d = scopeDetails.accounts[a.id] || {}
            const on = id === activeTab
            const ei = entities.findIndex((e) => e.id === a.entityId)
            return (
              <button key={a.id} className={`entrow ${on ? 'entrow--on' : ''}`} role="option" aria-selected={on} onClick={() => pick(id)}>
                <span className="entrow__dot" style={{ background: CONTRIB_COLORS[ei % CONTRIB_COLORS.length] }} />
                <span className="entrow__main">
                  <span className="entrow__co">{a.name}<span className="entrow__acno">···{a.number}</span></span>
                  <span className="entrow__meta">
                    <span className="entrow__ccy">{a.currency}</span>
                    <span className="entrow__share">{a.bank}</span>
                    <span className={`entrow__pool ${a.pool ? '' : 'entrow__pool--none'}`}>
                      {a.pool ? CASH_POOLS[a.pool].name : 'Not pooled'}
                    </span>
                  </span>
                </span>
                <span className="entrow__figs">
                  <span className="entrow__closing">{d.closingText}</span>
                  <span className="entrow__sub">closing · {share(d.gbpClosing)}% of group</span>
                </span>
              </button>
            )
          })}

          {searching && matchedPools.length > 0 && <div className="entpick__head">Cash pool</div>}
          {(searching ? matchedPools : dim === 'pool' ? pools : []).map((p) => {
            const id = poolTab(p.id)
            const d = scopeDetails.pools[p.id] || {}
            const on = id === activeTab
            const companies = [...new Set(p.accounts.map((a) => a.company))]
            return (
              <button key={p.id} className={`entrow ${on ? 'entrow--on' : ''}`} role="option" aria-selected={on} onClick={() => pick(id)}>
                <span className="entrow__dot entrow__dot--pool" />
                <span className="entrow__main">
                  <span className="entrow__co">{p.name}</span>
                  <span className="entrow__meta">
                    <span className="entrow__ccy">{p.ccy}</span>
                    <span className="entrow__share">{p.type}</span>
                    <span className="entrow__pool">{p.accounts.length} accounts · {companies.join(', ')}</span>
                  </span>
                </span>
                <span className="entrow__figs">
                  <span className="entrow__closing">{d.closingText}</span>
                  <span className="entrow__sub">closing · {share(d.gbpClosing)}% of group</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

// The group's display currency, edited in place in the page title. A custom
// menu rather than a <select>, since a native popup can't carry the app's theme.
function CurrencyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
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

  return (
    <span className={`ccypick ${open ? 'ccypick--open' : ''}`} ref={ref}>
      <button
        className="ccypick__btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Group currency: ${value}. Change it.`}
        title="Change the currency the group is shown in"
      >
        <span className="ccypick__lead" aria-hidden>Display in</span>
        <span className="ccypick__val">{value}</span>
        <svg className="ccypick__chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6.5 8 10.5 12 6.5" />
        </svg>
      </button>
      {open && (
        <span className="ccypick__menu" role="listbox">
          {GROUP_CURRENCIES.map((c) => (
            <button
              key={c.code}
              className={`ccypick__opt ${c.code === value ? 'ccypick__opt--on' : ''}`}
              role="option"
              aria-selected={c.code === value}
              onClick={() => { onChange(c.code); setOpen(false) }}
            >
              <span className="ccypick__code">{c.code}</span>
              <span className="ccypick__sym">{CCY_SYMBOL[c.code]}</span>
              {c.code === value && (
                <svg className="ccypick__tick" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>
              )}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function OverlayDropdown({ base, baseName = 'Base', overlays, overlayId, onOverlay, bandIds, onToggleBand }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const overlay = overlays.find((o) => o.id === overlayId)
  const btnLabel = overlay ? `${baseName} + ${shortName(overlay.name)}` : `${baseName} only`

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`dd ${open ? 'dd--open' : ''}`} ref={ref}>
      <button className="dd__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="dd__dot" style={{ background: base.color }} />
        {overlay && <span className="dd__dot" style={{ background: overlay.color }} />}
        <span className="dd__label">{btnLabel}</span>
        <span className="dd__chev" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dd__menu dd__table" role="listbox">
          <div className="dd__thead">
            <span />
            <span>Code</span>
            <span>Scenario</span>
            <span>Description</span>
            <span className="dd__c">Band</span>
          </div>

          <SeriesRow
            s={base}
            fixed
            bandOn={bandIds.includes('base')}
            onToggleBand={() => onToggleBand('base')}
          />

          <div className="dd__divider" />

          <div
            className={`dd__tr dd__tr--click ${overlayId === 'none' ? 'dd__tr--on' : ''}`}
            role="option"
            aria-selected={overlayId === 'none'}
            onClick={() => onOverlay('none')}
          >
            <span className="dd__c"><span className={`dd__radio ${overlayId === 'none' ? 'dd__radio--on' : ''}`} /></span>
            <span />
            <span className="dd__cell-name">None — base only</span>
            <span />
            <span />
          </div>

          {overlays.map((o) => (
            <SeriesRow
              key={o.id}
              s={o}
              selected={overlayId === o.id}
              onSelect={() => onOverlay(o.id)}
              bandOn={bandIds.includes(o.id)}
              onToggleBand={() => onToggleBand(o.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// One table row per series: [select] [code] [name] [description] [band]
function SeriesRow({ s, fixed, selected, onSelect, bandOn, onToggleBand }) {
  return (
    <div
      className={`dd__tr ${fixed ? 'dd__tr--fixed' : 'dd__tr--click'} ${selected ? 'dd__tr--on' : ''}`}
      role="option"
      aria-selected={fixed ? true : selected}
      onClick={fixed ? undefined : onSelect}
    >
      <span className="dd__c">
        {fixed ? (
          <span className="dd__pin" title="Always shown">✓</span>
        ) : (
          <span className={`dd__radio ${selected ? 'dd__radio--on' : ''}`} />
        )}
      </span>
      <span><span className="dd__code">{s.code}</span></span>
      <span className="dd__cell-name">
        <span className="dd__dot" style={{ background: s.color }} />
        <span className="dd__nametext">{s.name}</span>
      </span>
      <span className="dd__cell-desc" title={s.description}>{s.description}</span>
      <span className="dd__c">
        <BandToggle on={bandOn} color={s.color} onClick={onToggleBand} />
      </span>
    </div>
  )
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark'
  return (
    <button
      className="themebtn"
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle colour theme"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </svg>
      )}
    </button>
  )
}

function EmphasisSwitch({ value, onChange }) {
  return (
    <span className="emphasis" title="Which line is shown prominently">
      <span className="emphasis__label">Emphasis</span>
      <span className="seg seg--sm">
        <button className={`seg__btn ${value === 'base' ? 'seg__btn--on' : ''}`} onClick={() => onChange('base')}>Base</button>
        <button className={`seg__btn ${value === 'scenario' ? 'seg__btn--on' : ''}`} onClick={() => onChange('scenario')}>Scenario</button>
      </span>
    </span>
  )
}

function BandToggle({ on, color, onClick }) {
  return (
    <button
      className={`bandbtn ${on ? 'bandbtn--on' : ''}`}
      style={{ '--sc': color }}
      title={on ? 'Hide error band' : 'Show error band'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      ±
    </button>
  )
}

function shortName(name) {
  return name.split(' ')[0]
}

function Metric({ label, value, tone, signed, impact, onFind, finding, findTitle }) {
  const { money0, signed: signedFmt } = useMoney()
  const cls = ['metric']
  if (tone === 'danger') cls.push('metric--danger')
  if (tone === 'ok') cls.push('metric--ok')
  if (finding) cls.push('metric--finding')
  const fmt = signed ? signedFmt : money0
  return (
    <div className={cls.join(' ')}>
      <div className="metric__main">
        <div className="metric__head">
          <span className="metric__label">{label}</span>
          {onFind && (
            <button
              type="button"
              className={`metric__find ${finding ? 'metric__find--on' : ''}`}
              onClick={onFind}
              aria-pressed={!!finding}
              title={findTitle || 'Find on chart'}
            >
              <FinderIcon size={13} />
            </button>
          )}
        </div>
        <span className="metric__value">{fmt(value)}</span>
      </div>
      {impact && (
        <div className="metric__impact">
          {impact.shock != null && <ImpRow kind="shock" label="Shock" delta={impact.shock} />}
          {impact.scenario && <ImpRow kind="scenario" label={impact.scenario.code} delta={impact.scenario.delta} />}
          {impact.total != null && <ImpRow kind="total" label="Total" delta={impact.total} />}
        </div>
      )}
    </div>
  )
}

function ImpRow({ kind, label, delta }) {
  const { money0 } = useMoney()
  const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  return (
    <div className={`improw improw--${kind} imp-${dir}`}>
      <span className="improw__label">{label}</span>
      <span className="improw__delta">
        <ImpactArrow dir={dir} />
        {dir === 'flat' ? '—' : `${delta > 0 ? '+' : ''}${money0(delta)}`}
      </span>
    </div>
  )
}

function ImpactArrow({ dir }) {
  if (dir === 'flat') {
    return (
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
        <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden style={dir === 'down' ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M12 5v14M12 5l-6 6M12 5l6 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
