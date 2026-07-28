import { useMemo, useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { computeDaily, bucketize, aggregate, makeInitialState, consolidate, applyShocks, shockState, cellUnderlying, modelDetail, uid, monthOrdinals, SCENARIOS } from './model.js'
import AlignedChart from './components/AlignedChart.jsx'
import ForecastTable from './components/ForecastTable.jsx'
import ShocksPanel from './components/ShocksPanel.jsx'
import UnderlyingPanel from './components/UnderlyingPanel.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import ShockIcon from './components/ShockIcon.jsx'
import CategoryTag from './components/CategoryTag.jsx'
import { CurrencyProvider, useMoney } from './currency.jsx'

// Shared column geometry — the single source of alignment between chart & table.
// Wide enough for the row name plus its badges/controls once the full-bleed
// table's left gutter inset is taken off.
// Category column width. Draggable via the splitter on the chart/table divider,
// clamped so neither the labels nor the data columns can be squeezed out.
const LABEL_W_DEFAULT = 320
const LABEL_W_MIN = 200
const LABEL_W_MAX = 560
const CHART_H = 300

// How many columns should fill the window by default, per granularity.
const TARGET_COLS = { day: 14, week: 13, month: 12 }
// Floor so columns never collapse on a narrow window (then it scrolls instead).
const MIN_COL_W = { day: 46, week: 64, month: 88 }

const GRANULARITIES = [
  { key: 'day', label: 'Days' },
  { key: 'week', label: 'Weeks' },
  { key: 'month', label: 'Months' },
]

// View tabs. Entity tabs hold their own data in their own currency; `fx` is the
// base→local rate (GBP × fx = local), `size` gives each entity a distinct scale,
// and `seed` a distinct cashflow pattern. SUMMARY is a live, read-only
// consolidation of all entities, converted to the base currency (GBP).
const BASE_CCY = 'GBP'
const SUMMARY = { id: 'summary', label: 'GROUP', company: 'Group', currency: BASE_CCY, locale: 'en-GB', summary: true }
// Currencies the consolidated group can be displayed in (fx = GBP → currency).
const CCY_SYMBOL = { GBP: '£', EUR: '€', USD: '$', DKK: 'kr' }
const GROUP_CURRENCIES = [
  { code: 'GBP', locale: 'en-GB', fx: 1 },
  { code: 'EUR', locale: 'de-DE', fx: 1.17 },
  { code: 'USD', locale: 'en-US', fx: 1.27 },
  { code: 'DKK', locale: 'da-DK', fx: 8.6 },
]
// Each entity has a distinct trading profile so its balance curve reads
// differently: a steady UK retailer, a fast-growing Nordic scale-up with capex,
// a US turnaround dipping mid-year, and a lumpy project-billing German GmbH.
const ENTITIES = [
  {
    id: 'uk', label: 'UK · GBP', company: 'UK Ltd', currency: 'GBP', locale: 'en-GB', fx: 1, size: 1.0, seed: 0x1a2b3c4d,
    profile: {
      growth: 0.012, seasonAmp: 0.14, seasonPeak: 5, payrollStep: 1500,
      bigItems: [{ target: 'loan', iso: '2026-09-01', amount: 50000 }],
    },
  },
  {
    id: 'dk', label: 'DK · DKK', company: 'Nordic A/S', currency: 'DKK', locale: 'da-DK', fx: 8.6, size: 0.55, seed: 0x51ce7a11,
    profile: {
      growth: 0.045, receiptVar: 5200, seasonAmp: 0.2, seasonPeak: 9, payrollStep: 2800, marketingBase: 12000,
      bigItems: [{ target: 'suppliers', iso: '2026-10-15', amount: 145000 }], // equipment capex
    },
  },
  {
    id: 'us', label: 'US · USD', company: 'US Inc', currency: 'USD', locale: 'en-US', fx: 1.27, size: 0.85, seed: 0x0bad1dea,
    profile: {
      growth: 0.006, seasonAmp: 0.24, seasonPeak: 11, marketingBase: 12000, marketingVar: 7000,
      payrollStep: 2200, opening: 108000,
      bigItems: [{ target: 'tax', iso: '2027-01-15', amount: 55000 }], // one-off settlement → mid-year dip
    },
  },
  {
    id: 'de', label: 'DE · EUR', company: 'GmbH', currency: 'EUR', locale: 'de-DE', fx: 1.17, size: 0.42, seed: 0x77c0ffee,
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
const TABS = [SUMMARY, ...ENTITIES]
const makeEntity = (e) => makeInitialState({ scale: e.fx * e.size, seed: e.seed, profile: e.profile })
// Uniun brand palette — blue / teal / orange / purple
const CONTRIB_COLORS = ['#0078ff', '#16bba4', '#ff9600', '#b849ff']

// Track the available width of an element (excludes scrollbar), live on resize.
function useMeasuredWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export default function App() {
  // One dataset per entity; SUMMARY is derived (a consolidation), not stored.
  const [tabStates, setTabStates] = useState(() =>
    Object.fromEntries(ENTITIES.map((e) => [e.id, makeEntity(e)]))
  )
  const [activeTab, setActiveTab] = useState('summary')
  const [groupCurrency, setGroupCurrency] = useState(BASE_CCY) // display currency for the GROUP tab
  const tab = TABS.find((t) => t.id === activeTab)
  const isSummary = tab.summary
  const groupCcy = GROUP_CURRENCIES.find((c) => c.code === groupCurrency) ?? GROUP_CURRENCIES[0]

  // Live consolidation of every entity, expressed in the chosen group currency.
  const consolidated = useMemo(
    () => consolidate(ENTITIES.map((e) => ({ state: tabStates[e.id], fx: e.fx })), groupCcy.fx),
    [tabStates, groupCcy.fx]
  )
  const state = isSummary ? consolidated : tabStates[activeTab]

  // Active display currency/locale (group tab can be re-denominated).
  const displayCurrency = isSummary ? groupCcy.code : tab.currency
  const displayLocale = isSummary ? groupCcy.locale : tab.locale

  // SUMMARY is read-only — edits happen on entity tabs.
  const setState = useCallback(
    (updater) => {
      if (activeTab === 'summary') return
      setTabStates((all) => ({
        ...all,
        [activeTab]: typeof updater === 'function' ? updater(all[activeTab]) : updater,
      }))
    },
    [activeTab]
  )

  const [granularity, setGranularity] = useState('month')

  // Theme: explicit light/dark choice (overrides OS), persisted.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('cf-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch (e) { /* ignore */ }
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
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
  const [gridMode, setGridMode] = useState('base') // 'base' (click a cell → underlying data) | 'shocks' (click a row → isolate + add shocks)
  const [showContrib, setShowContrib] = useState(false) // contributions strip is tall — off by default
  const [showScenario, setShowScenario] = useState(true) // the scenario/compare control line

  // Sliding pink underline under whichever view is active (Group vs Local grids).
  const viewtabsRef = useRef(null)
  const groupTabRef = useRef(null)
  const entityTabRef = useRef(null)
  const [ink, setInk] = useState({ left: 0, width: 0 })
  const [labelW, setLabelW] = useState(LABEL_W_DEFAULT) // category column width, set by the splitter
  const [dragging, setDragging] = useState(false)

  // Splitter: drag the chart/table divider to resize the category column.
  // The start width is read from a ref, not a closure over `labelW` — a stale
  // capture here makes the column jump to the wrong size on drag.
  const dragRef = useRef(null)
  const labelWRef = useRef(LABEL_W_DEFAULT)
  useEffect(() => { labelWRef.current = labelW }, [labelW])
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
  const [focus, setFocus] = useState(null) // { section, id } — isolate a category's flow in the chart
  const [underlying, setUnderlying] = useState(null) // { section, row, bucket, data } for the Base-mode detail panel

  // Leaving Shocks mode drops any isolated category so the chart returns to balance.
  useEffect(() => {
    if (gridMode !== 'shocks') setFocus(null)
    if (gridMode !== 'base') setUnderlying(null)
  }, [gridMode])

  // Switching tabs closes the detail panel (the clicked cell isn't on the new grid).
  useEffect(() => { setUnderlying(null) }, [activeTab])

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

  const focusKey = focus ? `${focus.section}:${focus.id}` : null
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
  // Count of shocks affecting the current grid: every active shock on GROUP (all
  // entities roll up, plus group-level), or just this entity's own otherwise.
  const activeShockCount = useMemo(() => {
    let n = 0
    for (const arr of Object.values(shocks)) {
      for (const s of arr) {
        if (s.active === false) continue
        if (isSummary || (s.source?.tabId ?? activeTab) === activeTab) n++
      }
    }
    return n
  }, [shocks, isSummary, activeTab])
  // Whether the current grid has any shocks at all (active or inactive). Used to
  // reserve the chart's marker row so its height stays constant between the
  // balance view and drilling into a category (whose row may have no shocks).
  const gridHasShocks = useMemo(() => {
    for (const arr of Object.values(shocks)) {
      for (const s of arr) {
        if (isSummary || (s.source?.tabId ?? activeTab) === activeTab) return true
      }
    }
    return false
  }, [shocks, isSummary, activeTab])

  // Add a shock to a category, spanning the clicked period (dates then editable).
  // The shock records the *source grid* it was entered on (a company/currency
  // tab or the consolidated group) so it applies and reads back only there.
  const addShock = useCallback((section, row, bucket) => {
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
        company: tab.company,
        currency: displayCurrency,
        level: isSummary ? 'group' : 'company',
      },
    }
    setShocks((cur) => ({ ...cur, [key]: [...(cur[key] || []), shock] }))
    setShocksOpen(true)
  }, [activeTab, tab.company, displayCurrency, isSummary])

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

  // Click a category row to isolate its flow; click again to clear.
  const toggleFocus = useCallback((section, id) => {
    setFocus((cur) => (cur && cur.section === section && cur.id === id ? null : { section, id }))
  }, [])

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
    return shockState(state, activeResolvedShocks)
  }, [isSummary, tabStates, groupCcy.fx, shocksForTab, state, activeResolvedShocks])
  const daily = useMemo(() => computeDaily(effectiveState), [effectiveState])
  // Pre-shock baseline (all shocks removed) — the diverging ghost line + KPI
  // impact. On GROUP this is the raw consolidation, so the impact reflects both
  // rolled-up entity shocks and group-level shocks.
  const baseDaily = useMemo(() => computeDaily(state), [state])
  const buckets = useMemo(() => bucketize(state.days, granularity), [state.days, granularity])
  const agg = useMemo(() => aggregate(effectiveState, buckets), [effectiveState, buckets])

  // Base mode: clicking a cell opens its underlying detail (invoices for
  // Customer Receipts / Suppliers, else the daily cash flows), built from the
  // effective (post-shock) daily values so it reconciles with the shown cell.
  const openUnderlying = useCallback((section, row, bucket) => {
    const eff = effectiveState[section]?.find((r) => r.id === row.id)
    if (!eff) return
    const dailyValues = bucket.dayIndices.map((i) => Number(eff.values[i]) || 0)
    const data = cellUnderlying(row, bucket, dailyValues, state.days)
    setUnderlying({ section, row, bucket, data })
  }, [effectiveState, state.days])
  const closeUnderlying = useCallback(() => setUnderlying(null), [])

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

  // Base is always the primary line; the dropdown adds at most one scenario.
  const base = useMemo(() => SCENARIOS.find((s) => s.id === 'base'), [])
  const overlays = useMemo(() => SCENARIOS.filter((s) => s.id !== 'base'), [])

  // The focused category (if any) and its signed daily flow (outflows go negative).
  const focusRow = useMemo(() => {
    if (!focus) return null
    const row = state[focus.section]?.find((r) => r.id === focus.id)
    if (!row) return null
    const sign = focus.section === 'outflows' ? -1 : 1
    return { ...row, section: focus.section, series: row.values.map((v) => (Number(v) || 0) * sign) }
  }, [focus, state])

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

  // The isolated category's own line uses the base pink for every category
  // (consistent with the main balance line); the scenario overlay carries the
  // scenario colour.
  const focusColor = focusRow ? 'var(--brand)' : null

  // When a category is focused, the chart shows that category's flow, the same
  // scenario overlay applied to it (if one is chosen), and a dashed "shocked"
  // line when manual shocks are applied.
  const lines = useMemo(() => {
    if (!focusRow) return balanceLines
    const sign = focusRow.section === 'outflows' ? -1 : 1
    const raw = focusRow.values
    const ov = overlays.find((s) => s.id === overlayId)
    const overlayProminent = !!ov && emphasis === 'scenario'
    const result = [
      {
        id: 'base',
        name: focusRow.name,
        code: focusRow.code,
        model: focusRow.model,
        color: focusColor,
        series: focusRow.series,
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
        series: ov.apply(raw, ordinals).map((v) => v * sign),
        band: bandIds.includes(ov.id),
        prominent: overlayProminent,
        muted: !overlayProminent,
      })
    }
    if (resolvedFocusShocks.length) {
      const shocked = applyShocks(raw, resolvedFocusShocks).map((v) => v * sign)
      result.push({ id: 'focus-shock', name: `${focusRow.name} (shocked)`, color: 'var(--sc2)', dash: true, series: shocked, band: false })
    }
    return result
  }, [focusRow, focusColor, bandIds, overlayId, overlays, emphasis, ordinals, resolvedFocusShocks, balanceLines])

  // Descriptor for the dropdown's "base" row — the focused category in isolate mode.
  const dropdownBase = focusRow
    ? { id: 'base', code: focusRow.code, name: focusRow.name, color: focusColor, model: focusRow.model, description: "This category's own forecast." }
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
    // show here — matched to the isolated category by code when focused.
    if (isSummary) {
      const all = Object.entries(shocks).flatMap(([key, arr]) => arr.map((s) => ({ key, s })))
      const items = focusRow ? all.filter(({ s }) => s.catCode === focusRow.code) : all
      return items.map(({ key, s }) => mark(key, s))
    }
    // Entity grid: only its own shocks.
    const mine = (s) => (s.source?.tabId ?? activeTab) === activeTab
    if (focusRow) return focusShocks.filter(mine).map((s) => mark(focusKey, s))
    const keys = new Set([
      ...state.inflows.map((r) => `inflows:${r.id}`),
      ...state.outflows.map((r) => `outflows:${r.id}`),
    ])
    return Object.entries(shocks)
      .filter(([key]) => keys.has(key))
      .flatMap(([key, arr]) => arr.filter(mine).map((s) => mark(key, s)))
  }, [isSummary, focusRow, focusShocks, focusKey, shocks, state.inflows, state.outflows, activeTab])

  // Size columns so the target count fills the measured width; scroll for more.
  // Widening the category column takes space from the data columns (and vice
  // versa), so dragging the splitter re-proportions every period column.
  const [scrollRef, availW] = useMeasuredWidth()
  const target = TARGET_COLS[granularity]
  const colW = availW > 0
    ? Math.max(MIN_COL_W[granularity], Math.floor((availW - labelW) / target))
    : MIN_COL_W[granularity]
  const contentW = labelW + buckets.length * colW
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

  const setOpeningBalance = useCallback((value) => setState((s) => ({ ...s, openingBalance: value })), [])

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

  const resetAll = useCallback(() => {
    if (isSummary) {
      setTabStates(Object.fromEntries(ENTITIES.map((e) => [e.id, makeEntity(e)])))
    } else {
      const e = ENTITIES.find((x) => x.id === activeTab)
      setState(makeEntity(e))
    }
  }, [isSummary, activeTab, setState])

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

  // --- headline metrics (from daily series) ---------------------------------
  const closingEnd = daily.dailyClosing[daily.dailyClosing.length - 1] ?? 0
  const lowest = daily.dailyClosing.length ? Math.min(...daily.dailyClosing) : 0
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

  return (
    <CurrencyProvider currency={displayCurrency} locale={displayLocale}>
    <div className="shell">
    <UniunRail theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
    <div className={`app ${underlying ? 'app--docked' : ''}`}>
      {/* view tabs — company / currency grid combinations */}
      <div className="tabbar">
        <span className="tabbar__brand">Cash Forecast</span>
        <div className="tabbar__tabs">
          {/* Group vs Local grids, with one pink underline that slides between
              them to mark which view is active. */}
          <span className="viewtabs" ref={viewtabsRef}>
            <button
              ref={groupTabRef}
              className={`tab tab--summary ${isSummary ? 'tab--on' : ''}`}
              onClick={() => setActiveTab(SUMMARY.id)}
              title="Consolidated group view"
            >
              <span className="tab__sigma" aria-hidden>Σ</span>
              {SUMMARY.label}
            </button>
            <span className="tabbar__div" aria-hidden />
            {/* the four local grids live behind one picker rather than four tabs */}
            <span className="viewtabs__slot" ref={entityTabRef}>
              <EntityPicker
                entities={ENTITIES}
                details={contributions}
                activeTab={activeTab}
                groupFmt={groupFmt}
                groupCcyCode={groupCcy.code}
                groupClosing={groupClosing}
                onSelect={setActiveTab}
              />
            </span>
            <span className="viewtabs__ink" style={ink} aria-hidden />
          </span>
          <span className="tabbar__div" aria-hidden />
          <button
            className={`contribbtn ${showContrib ? 'contribbtn--on' : ''}`}
            onClick={() => setShowContrib((v) => !v)}
            aria-pressed={showContrib}
            title={showContrib ? 'Hide the group contributions strip' : 'Show the group contributions strip'}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <rect x="2" y="9" width="7" height="6" rx="1.5" fill="currentColor" />
              <rect x="10" y="9" width="5" height="6" rx="1.5" fill="currentColor" opacity="0.62" />
              <rect x="16" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.34" />
            </svg>
            Contributions
          </button>
          <button
            className={`contribbtn ${showScenario ? 'contribbtn--on' : ''}`}
            onClick={() => setShowScenario((v) => !v)}
            aria-pressed={showScenario}
            title={showScenario ? 'Hide the scenario controls' : 'Show the scenario controls'}
          >
            {/* two paths diverging from a common baseline */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 17c4 0 5-10 9-10s5 5 11 5" />
              <path d="M2 17c4 0 6-4 10-4s6 2 10 2" opacity="0.45" />
            </svg>
            Scenarios
          </button>
        </div>
        <span className="tabbar__meta">{tab.company} · {displayCurrency}</span>
      </div>

      <header className="app__header">
        <div>
          {/* The descriptive caption lives in the pill's tooltip rather than a
              subtitle line, to keep the header short. */}
          <h1>
            <span>{tab.company}</span>
            {isSummary ? (
              /* the group can be re-denominated, so its currency is editable
                 in place; entity grids show their own currency as plain text */
              <CurrencyPicker value={groupCurrency} onChange={setGroupCurrency} />
            ) : (
              <span className="app__ccy">{displayCurrency}</span>
            )}
            {isSummary && (
              <span
                className="pill pill--readonly"
                tabIndex={0}
                data-tip={`Consolidation of ${ENTITIES.map((e) => e.company).join(', ')}, shown in ${displayCurrency}. Edit figures on each entity tab.`}
              >
                Σ Consolidated · read-only
              </span>
            )}
          </h1>
        </div>
        <div className="app__controls">
          <span className="modepick">
            <span className="modepick__label">Mode</span>
            <span className="seg">
              <button className={`seg__btn ${gridMode === 'base' ? 'seg__btn--on' : ''}`} onClick={() => setGridMode('base')} title="Base — click a cell to see the underlying data behind it">Base</button>
              <button className={`seg__btn ${gridMode === 'shocks' ? 'seg__btn--on' : ''}`} onClick={() => setGridMode('shocks')} title="Shocks — click a row to isolate it and add manual shocks">Shocks</button>
            </span>
          </span>
          <Segmented value={granularity} onChange={setGranularity} />
          <button className="btn btn--ghost" onClick={resetAll}>{isSummary ? 'Reset all' : 'Reset'}</button>
        </div>
      </header>

      {showContrib && (
      <section className="contrib">
        <span className="contrib__label">
          Contributions to group closing ({groupCcy.code})
          {!isSummary && <span className="contrib__note"> · highlighting {tab.company}</span>}
        </span>
        <div className="contrib__bar">
          {contributions.map((c, i) => (
            <div
              key={c.id}
              className={`contrib__seg ${!isSummary && c.id !== activeTab ? 'contrib__seg--dim' : ''}`}
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
              className={`contrib__item ${!isSummary && c.id !== activeTab ? 'contrib__item--dim' : ''} ${c.id === activeTab ? 'contrib__item--active' : ''}`}
              onClick={() => setActiveTab(c.id)}
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
        <Metric label="Opening balance" value={state.openingBalance} />
        <Metric
          label="Net over horizon"
          value={netTotal}
          signed
          impact={buildImpact(netTotal, baseNet, kpiScenario?.net)}
        />
        <Metric
          label="Closing balance"
          value={closingEnd}
          impact={buildImpact(closingEnd, baseClosing, kpiScenario?.closing)}
        />
        <Metric
          label="Lowest point"
          value={lowest}
          tone={lowest < 0 ? 'danger' : 'ok'}
          impact={buildImpact(lowest, baseLowest, kpiScenario?.lowest)}
        />
      </section>

      {focusRow ? (
        <div className="scenariobar focusbar">
          <span className="scenariobar__label">Isolated flow</span>
          <span className="focusbar__series">
            <span className="dd__dot" style={{ background: focusColor }} />
            <span className="focusbar__name">{focusRow.name}</span>
            {focusRow.modelled && focusRow.model ? (
              <>
                <CategoryTag category={focusRow.model.category} />
                <span className="focusbar__model">{focusRow.model.name}</span>
              </>
            ) : (
              <span className="tag tag--manual">Manual</span>
            )}
          </span>
          {/* the scenario controls hide with the toggle, but the bar itself stays
              — it carries the only way back out of the isolated view */}
          {showScenario && (
            <>
              <span className="scenariobar__label scenariobar__label--sub">Scenario</span>
              <OverlayDropdown
                base={dropdownBase}
                baseName={focusRow.name}
                overlays={overlays}
                overlayId={overlayId}
                onOverlay={setOverlayId}
                bandIds={bandIds}
                onToggleBand={toggleBand}
              />
              {overlayId !== 'none' && <EmphasisSwitch value={emphasis} onChange={setEmphasis} />}
            </>
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
          <button className="btn btn--sm" onClick={() => setFocus(null)}>← Back to balance</button>
        </div>
      ) : showScenario || activeShockCount > 0 ? (
        <div className="scenariobar">
          {/* Diverge shocks is a shock control, not a scenario one, so it stays
              put when the scenario controls are hidden. */}
          {showScenario && (
            <>
              <span className="scenariobar__label">Scenario</span>
              <OverlayDropdown
                base={base}
                overlays={overlays}
                overlayId={overlayId}
                onOverlay={setOverlayId}
                bandIds={bandIds}
                onToggleBand={toggleBand}
              />
              {overlayId !== 'none' && !divergeShocks && <EmphasisSwitch value={emphasis} onChange={setEmphasis} />}
            </>
          )}
          {activeShockCount > 0 && (
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
            <span className="scenariobar__hint">± toggles each series' forecast error band · click a category's ⟋ icon to isolate its flow</span>
          )}
        </div>
      ) : null}

      {/* One scroll container so chart + table move and align together */}
      <section className={`aligned ${scratchpad ? 'aligned--scratch' : ''} ${scratchClosing ? 'aligned--scratch-closing' : ''}`}>
        {scratchpad && (
          <div className="scratchbar">
            <span className="scratchbar__title">
              <span className="scratchbar__dot" />
              {tab.company} · {focusRow ? focusRow.name : 'Cash forecast'}
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
          <button className="expandbtn" onClick={openScratchpad} title="Expand to full-screen scratchpad">
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
        <div className="aligned__scroll" ref={scrollRef}>
          <div className="aligned__content" style={{ width: contentW }}>
            <AlignedChart
              days={state.days}
              lines={lines}
              dailyNet={daily.dailyNet}
              buckets={buckets}
              labelW={labelW}
              colW={colW}
              contentW={contentW}
              height={chartH}
              title={focusRow ? 'Daily flow' : 'Daily balance'}
              markers={!focusRow}
              annotations={annotations}
              reserveMarkers={gridHasShocks}
              onAnnotationClick={openShock}
            />
            <ForecastTable
              state={state}
              buckets={buckets}
              agg={agg}
              granularity={granularity}
              labelW={labelW}
              colW={colW}
              contentW={contentW}
              onCell={setCell}
              onRowName={setRowName}
              onOpeningBalance={setOpeningBalance}
              onAddRow={addRow}
              readOnly={isSummary}
              gridMode={gridMode}
              focus={focus}
              focusActive={!!focusRow}
              onFocus={toggleFocus}
              onAddShock={addShock}
              onCellClick={openUnderlying}
              onOpenModel={openModel}
              underlyingCell={underlying ? { section: underlying.section, rowId: underlying.row.id, bucketKey: underlying.bucket.key } : null}
              shockRanges={resolvedFocusShocks.map((s) => ({ start: s.dayStart, end: s.dayEnd }))}
            />
          </div>
        </div>
        {modelRow && (
          <ModelPanel
            row={modelRow}
            detail={modelDetail(modelRow)}
            closing={modelClosing}
            /* sits directly below the chart, so it fills the table's area */
            topOffset={chartH + (gridHasShocks || annotations.length > 0 ? 26 : 0)}
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
        onGoToSource={setActiveTab}
        onClose={() => setShocksOpen(false)}
        onUpdate={updateShock}
        onRemove={removeShock}
      />

      <UnderlyingPanel
        open={!!underlying}
        cell={underlying}
        company={tab.company}
        currency={displayCurrency}
        onClose={closeUnderlying}
      />
    </div>
    </div>
    </CurrencyProvider>
  )
}

// The Uniun signature: a 56px black rail carrying the brand mark and the app
// switcher. This grid is the "Forecast" app (pink in the Uniun app taxonomy).
function UniunRail({ theme, onToggleTheme }) {
  const apps = [
    { id: 'forecast', label: 'Forecast', color: 'var(--app-forecast)', on: true },
    { id: 'core', label: 'Core', color: 'var(--uniun-teal)' },
    { id: 'payments', label: 'Payments', color: 'var(--uniun-blue)' },
    { id: 'journal', label: 'Journal', color: 'var(--uniun-purple)' },
    { id: 'pulse', label: 'Pulse', color: 'var(--uniun-cyan)' },
  ]
  return (
    <nav className="rail" aria-label="Uniun apps">
      <span className="rail__brand" title="Uniun">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" fill="none" stroke="var(--uniun-green)" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 8.1 16.3 10.6v4.9L12 18l-4.3-2.5v-4.9z" fill="var(--uniun-green)" />
        </svg>
      </span>
      <span className="rail__apps">
        {apps.map((a) => (
          <button
            key={a.id}
            className={`railapp ${a.on ? 'railapp--on' : ''}`}
            style={{ '--app-color': a.color }}
            title={a.on ? `${a.label} (current)` : `${a.label} — not in this prototype`}
            aria-current={a.on ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M12 2.8 19.6 7.4v9.2L12 21.2 4.4 16.6V7.4z" fill="currentColor" />
            </svg>
          </button>
        ))}
      </span>
      <span className="rail__foot">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </span>
    </nav>
  )
}

function Segmented({ value, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="Granularity">
      {GRANULARITIES.map((g) => (
        <button
          key={g.key}
          role="tab"
          aria-selected={value === g.key}
          className={`seg__btn ${value === g.key ? 'seg__btn--on' : ''}`}
          onClick={() => onChange(g.key)}
        >
          {g.label}
        </button>
      ))}
    </div>
  )
}

// Dropdown: Base is always shown (with its own band toggle); pick at most one
// scenario to overlay, and toggle the forecast error band per series.
// The four local grids behind one capsule. The menu is "rich": each row carries
// that grid's closing balance, share of the group and any shocks on it, so you
// can pick a grid on its numbers rather than just its code.
function EntityPicker({ entities, details, activeTab, groupFmt, groupCcyCode, groupClosing, onSelect }) {
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

  const active = entities.find((e) => e.id === activeTab)
  const byId = Object.fromEntries(details.map((d) => [d.id, d]))

  return (
    <span className={`entpick ${open ? 'entpick--open' : ''}`} ref={ref}>
      <button
        className={`entpick__btn ${active ? 'entpick__btn--on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active ? `${active.company} · ${active.currency}` : 'Choose a local grid'}
      >
        {active
          ? <><span className="entpick__co">{active.company}</span><span className="entpick__ccy">{active.currency}</span></>
          : <><span className="entpick__co">Local grids</span><span className="entpick__ccy">{entities.length}</span></>}
        <svg className="entpick__chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6.5 8 10.5 12 6.5" />
        </svg>
      </button>

      {open && (
        <div className="entpick__menu" role="listbox">
          <div className="entpick__head">Local grids</div>
          {entities.map((e, i) => {
            const d = byId[e.id] || {}
            const share = groupClosing ? Math.round((d.gbpClosing / groupClosing) * 100) : 0
            const on = e.id === activeTab
            return (
              <button
                key={e.id}
                className={`entrow ${on ? 'entrow--on' : ''}`}
                role="option"
                aria-selected={on}
                onClick={() => { onSelect(e.id); setOpen(false) }}
              >
                <span className="entrow__dot" style={{ background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} />
                <span className="entrow__main">
                  <span className="entrow__co">{e.company}</span>
                  <span className="entrow__meta">
                    <span className="entrow__ccy">{e.currency}</span>
                    <span className="entrow__share">{share}% of group</span>
                    {d.shocks > 0 && (
                      <span className="entrow__shocks"><ShockIcon size={10} />{d.shocks}</span>
                    )}
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
        {value}
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
              {c.code === value && <span className="ccypick__tick" aria-hidden>✓</span>}
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

function Metric({ label, value, tone, signed, impact }) {
  const { money0, signed: signedFmt } = useMoney()
  const cls = ['metric']
  if (tone === 'danger') cls.push('metric--danger')
  if (tone === 'ok') cls.push('metric--ok')
  const fmt = signed ? signedFmt : money0
  return (
    <div className={cls.join(' ')}>
      <div className="metric__main">
        <span className="metric__label">{label}</span>
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
