// Grid navigator: a breadcrumb that always says which grid is open, an in-frame
// panel that browses every grid along a user-defined route, and a Load button
// that is the only thing that changes the grid. Routes are orderings of
// dimensions (company, currency, cash pool, bank) that always end at the bank
// account; they are picked in the Group panel and defined by drag and drop.
import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { SUMMARY, ENTITIES, ALL_ACCOUNTS, ALL_POOLS, CCY_FX, CCY_LOCALE, NAV_DIMS, acctTab, poolTab, cutTab } from '../views.js'

const DIM_ORDER = ['company', 'ccy', 'pool', 'bank']
const MAX_LEVELS = 3
const DEFAULT_ROUTES = [
  { id: 'r-company', name: 'By company', dims: ['company', 'ccy'] },
  { id: 'r-pool', name: 'By cash pool', dims: ['ccy', 'pool'] },
  { id: 'r-bank', name: 'By bank', dims: ['bank', 'company'] },
]
const ROUTES_KEY = 'cashgrid.routes.v1'
const loadRoutes = () => {
  try {
    const r = JSON.parse(localStorage.getItem(ROUTES_KEY) || 'null')
    if (Array.isArray(r) && r.length && r.every((x) => x.id && x.name && Array.isArray(x.dims))) return r
  } catch (e) { /* fall through */ }
  return DEFAULT_ROUTES
}
const chainOf = (dims) => ['Group', ...dims.map((d) => NAV_DIMS[d].label), 'Account']
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`

// The tab id that opens a node's grid. Nodes whose accounts are exactly one
// company, one pool or one account resolve to those native grids; anything else
// is a generic cut through the entity data.
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
function tabFor(n) {
  if (n.depth === 0) return SUMMARY.id
  if (n.account) return acctTab(n.account.id)
  const ids = n.accounts.map((a) => a.id)
  if (ids.length === 1) return acctTab(ids[0])
  const ent = ENTITIES.find((e) => sameSet(e.accounts.map((a) => a.id), ids))
  if (ent) return ent.id
  const pool = ALL_POOLS.find((p) => sameSet(p.accounts.map((a) => a.id), ids))
  if (pool) return poolTab(pool.id)
  return cutTab(n.filters)
}

function buildTree(dims) {
  const byKey = {}
  const mk = (accounts, depth, filters, parent, label, dim) => {
    const key = depth === 0 ? 'root' : filters.map(([d, v]) => `${d}=${v}`).join('|')
    const n = { key, depth, label, dim, accounts, parent, filters, kids: [] }
    byKey[key] = n
    if (depth < dims.length) {
      const d = dims[depth], D = NAV_DIMS[d], groups = new Map()
      for (const a of accounts) {
        const v = D.val(a)
        if (!groups.has(v)) groups.set(v, [])
        groups.get(v).push(a)
      }
      n.kids = [...groups].map(([v, l]) => mk(l, depth + 1, [...filters, [d, v]], n, D.name(l[0]), d))
      n.kids.sort((x, y) => (x.label === 'Not pooled') - (y.label === 'Not pooled') || x.label.localeCompare(y.label))
      n.nextNoun = D.noun
    } else {
      n.nextNoun = ['account', 'accounts']
      n.kids = accounts.map((a) => {
        const leaf = { key: `acct=${a.id}`, depth: depth + 1, label: a.name, account: a, accounts: [a], parent: n, filters, kids: [], dim: 'account' }
        byKey[leaf.key] = leaf
        return leaf
      })
    }
    n.code = dim === 'company' ? NAV_DIMS.company.code(accounts[0]) : ''
    return n
  }
  const root = mk(ALL_ACCOUNTS, 0, [], null, 'Group', null)
  const byTab = {}
  const walk = (n) => {
    n.tab = tabFor(n)
    if (!byTab[n.tab]) byTab[n.tab] = n // shallowest node wins
    n.kids.forEach(walk)
  }
  walk(root)
  return { root, byKey, byTab }
}
const pathOf = (n) => { const p = []; for (let x = n; x; x = x.parent) p.unshift(x); return p }

const Svg = ({ size = 14, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>{children}</svg>
)
const Chev = (p) => <Svg size={12} {...p}><path d="m6 9 6 6 6-6" /></Svg>
const ChevR = () => <Svg size={12}><path d="m9 6 6 6-6 6" /></Svg>
const Arrow = () => <Svg size={16}><path d="M4 12h15M14 7l5 5-5 5" /></Svg>
const Check = () => <Svg size={14}><path d="M5 12l5 5L20 7" /></Svg>
const Close = () => <Svg size={14}><path d="M18 6 6 18M6 6l12 12" /></Svg>
const Sliders = () => (
  <Svg size={15}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>
)
const Grip = ({ size = 14 }) => (
  <Svg size={size}><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></Svg>
)
const Lock = () => <Svg size={13}><rect x="5" y="11" width="14" height="10" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>
const Up = () => <Svg size={13}><path d="m18 15-6-6-6 6" /></Svg>
const Spinner = () => (
  <svg className="gload__spin" viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)
export const AcctBadge = ({ number }) => <span className="gbadge"><i>••</i>{number}</span>

export function useGridNav({ activeTab, view, scopeDetails, groupCcy, groupText, onLoad }) {
  const [routes, setRoutes] = useState(loadRoutes)
  const [routeId, setRouteId] = useState(() => loadRoutes()[0].id)
  const [sel, setSel] = useState(null)
  const [trail, setTrail] = useState(null)
  const [open, setOpen] = useState(false)
  const [focusCol, setFocusCol] = useState(0)
  const [hoverCol, setHoverCol] = useState(null)
  const [routeMenu, setRouteMenu] = useState(false)
  const [qs, setQs] = useState({})
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState(null) // route editor; null = closed
  const loadT = useRef(null)
  // The open panel overlays the page rather than pushing it down: its base sits
  // on the line between the chart and the grid, so nothing below it moves.
  const [bandH, setBandH] = useState(null)
  const [expanded, setExpanded] = useState(false) // Show all: the panel grows to the bottom of the window
  const [bandTop, setBandTop] = useState(0)
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = () => {
      const wrap = document.querySelector('.gnavwrap')
      const table = document.querySelector('.tablewrap')
      if (!wrap) return
      const wrapBottom = wrap.getBoundingClientRect().bottom
      // start under the title row so its opener stays visible and clickable
      const head = document.querySelector('.app__header')
      const top = head ? Math.max(wrapBottom, head.getBoundingClientRect().bottom) : wrapBottom
      setBandTop(Math.round(top - wrapBottom))
      // base = the pink rule on the grid's first body row (below its header row)
      let base = table ? table.getBoundingClientRect().top : top + 372
      const balRow = table && table.querySelector('.grid__row--bal')
      if (balRow) base = balRow.getBoundingClientRect().top // the pink rule sits on the first balance row
      const collapsed = Math.max(240, Math.round(base - top))
      setBandH(expanded ? Math.max(collapsed, Math.round(window.innerHeight - top - 12)) : collapsed)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open, expanded])

  useEffect(() => { try { localStorage.setItem(ROUTES_KEY, JSON.stringify(routes)) } catch (e) { /* ignore */ } }, [routes])
  useEffect(() => () => clearTimeout(loadT.current), [])

  const route = routes.find((r) => r.id === routeId) || routes[0]
  const T = useMemo(() => buildTree(route.dims), [route.dims.join('>')]) // eslint-disable-line react-hooks/exhaustive-deps
  const LN = T.byTab[activeTab] || null // loaded node in this route, if the route reaches it

  // The grid can change from elsewhere (contribution strip, balance drill-through):
  // follow it whenever the panel isn't being browsed.
  useEffect(() => {
    if (open) return
    const k = LN ? LN.key : 'root'
    setSel(k)
    setTrail(k)
  }, [activeTab, T]) // eslint-disable-line react-hooks/exhaustive-deps

  const selNode = T.byKey[sel] || LN || T.root
  const selPath = pathOf(selNode)
  const loadedPath = new Set(LN ? pathOf(LN) : [])
  const trailNode = T.byKey[trail]
  const trailPath = trailNode ? pathOf(trailNode) : null
  const cpath = trailPath && trailPath.includes(selNode) ? trailPath : selPath
  const offRoute = !LN && view.kind !== 'group' // loaded grid isn't reachable on this route

  // Closing balance of a node, in its own currency when it has one.
  const closingOf = (n) => {
    if (n.depth === 0) return groupText
    const ccys = [...new Set(n.accounts.map((a) => a.currency))]
    const ccy = ccys.length === 1 ? ccys[0] : groupCcy.code
    const out = CCY_FX[ccy] ?? 1
    const v = n.accounts.reduce((s, a) => s + ((scopeDetails.accounts[a.id]?.closing ?? 0) / (CCY_FX[a.currency] ?? 1)) * out, 0)
    return v.toLocaleString(CCY_LOCALE[ccy] ?? 'en-GB', { style: 'currency', currency: ccy, notation: 'compact', maximumFractionDigits: 1 })
  }

  const pending = selNode.tab !== activeTab
  const revert = () => { const k = LN ? LN.key : 'root'; setSel(k); setTrail(k) }
  const close = () => { setExpanded(false); setOpen(false); setRouteMenu(false); revert() }

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !draft) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }) // re-bound each render so close() sees current state

  // Load: the grid steps back under its loader, the new selection loads behind
  // it, then the panel lifts away to reveal the result.
  const [closing, setClosing] = useState(false)
  const timers = useRef([])
  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const tableBusy = (on) => {
    const el = document.querySelector('.aligned__content')
    el?.classList.toggle('aligned__content--busy', on)
    el?.classList.toggle('aligned__content--fetch', on)
  }
  const load = () => { if (pending) loadTo(selNode) }
  const loadTo = (target) => {
    if (loading || !target || target.tab === activeTab) return
    setSel(target.key)
    setLoading(true)
    tableBusy(true)
    later(90, () => onLoad(target.tab))
    later(620, () => setClosing(true))
    later(880, () => {
      setSel(target.key)
      setTrail(target.key)
      setLoading(false)
      setClosing(false)
      setOpen(false)
      setRouteMenu(false)
    })
    later(1080, () => tableBusy(false))
  }


  const pick = (n) => { setSel(n.key); setTrail(n.key) }
  const crumbNav = (n, i) => { setSel(n.key); setFocusCol(i === 0 ? -1 : i - 1); setOpen(true); setRouteMenu(false) }
  const crumbOpen = (i) => {
    if (open && focusCol === i) { close(); return }
    setOpen(true); setFocusCol(i); setRouteMenu(false)
  }
  const switchRoute = (id) => {
    setRouteId(id); setRouteMenu(false); setQs({}); setFocusCol(0); setOpen(true)
    setSel(null); setTrail(null) // re-resolved against the new tree on the next render
  }

  // ---- bar --------------------------------------------------------------
  // the loaded grid itself is the page title, so the trail shows everything around it
  const crumbs = cpath.map((n, i) => {
    if (n === LN || n.tab === activeTab) return null // the loaded grid is the title — never repeat it in the trail
    const on = n === selNode || (!cpath.includes(selNode) && i === cpath.length - 1)
    const chevOn = open && focusCol === i
    return (
      <span key={n.key} className="gcrumb">
        {i > 0 && <span className="gcrumb__sep" aria-hidden>/</span>}
        <button className={`gcrumb__btn ${on ? 'gcrumb__btn--on' : ''}`} onClick={() => crumbNav(n, i)} aria-current={n === LN ? 'page' : undefined}>
          {i === 0 && <span className="tab__sigma" aria-hidden>Σ</span>}
          <span className="gcrumb__lbl">{n.label}</span>
          {n.account && <AcctBadge number={n.account.number} />}
          {n.code && <span className="gcrumb__code">{n.code}</span>}
        </button>
      </span>
    )
  })
  const crumbsEl = crumbs.some(Boolean) ? (
    <nav className="gnav__crumbs gnav__crumbs--title" aria-label="Grid path">{crumbs}</nav>
  ) : null
  const bar = (
    <span className="gnav">
    </span>
  )

  // ---- band -------------------------------------------------------------
  const levels = route.dims.length + 1
  const cols = []
  let at = T.root
  for (let i = 0; i < levels; i++) {
    // a column only comes into play once the one before it has a selection — no auto-advance
    const next = selPath[i + 1] || null
    const q = (qs[i] || '').trim().toLowerCase()
    const all = at ? at.kids : []
    const items = q ? all.filter((k) => k.label.toLowerCase().includes(q) || (k.account && k.account.number.includes(q)) || (k.code || '').toLowerCase().includes(q)) : all
    const noun = i < route.dims.length ? NAV_DIMS[route.dims[i]].noun[1] : 'accounts'
    const Noun = noun[0].toUpperCase() + noun.slice(1)
    cols.push({ i, at, next, items, total: all.length, q, label: at && i > 0 ? `${Noun} in ${at.label}` : Noun, isAcct: i === route.dims.length, empty: `Pick a ${i > 0 ? NAV_DIMS[route.dims[i - 1]].noun[0] : 'grid'}` })
    at = next
  }
  const steps = [...route.dims, 'account']
  const band = open && (
    <div className={`gband ${closing ? 'gband--closing' : ''}`} style={bandH ? { height: bandH, top: `calc(100% + ${bandTop}px)` } : undefined}>
      <div className="gband__route">
        <div className="groute">
          <button className="groute__btn" onClick={() => setRouteMenu((v) => !v)} aria-haspopup="listbox" aria-expanded={routeMenu} title={chainOf(route.dims).join(' → ')}>
            <span className="groute__name">Route<span className="groute__by">&nbsp;{route.name.charAt(0).toLowerCase() + route.name.slice(1)}</span></span>
            <Chev />
            <span
              className="groute__edit"
              role="button"
              tabIndex={0}
              title="Edit routes"
              aria-label="Edit routes"
              onClick={(e) => { e.stopPropagation(); setDraft({ ...route, dims: [...route.dims] }); setRouteMenu(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDraft({ ...route, dims: [...route.dims] }); setRouteMenu(false) } }}
            ><Sliders /></span>
          </button>
          {routeMenu && (
            <div className="groute__menu" role="listbox">
              {routes.map((r) => (
                <button key={r.id} role="option" aria-selected={r.id === route.id} className={`groute__opt ${r.id === route.id ? 'groute__opt--on' : ''}`} onClick={() => switchRoute(r.id)}>
                  <span className="groute__tick"><Check /></span>
                  <span className="groute__text">
                    <span className="groute__optname">{r.name}</span>
                    <span className="groute__mini">
                      {chainOf(r.dims).map((l, j) => <span key={j}>{j > 0 && <Svg size={11}><path d="M4 12h15M14 7l5 5-5 5" /></Svg>}{l}</span>)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="gflow" aria-label="Route levels">
          <button
            className="gchip gchip--home"
            onClick={() => (activeTab === SUMMARY.id ? close() : loadTo(T.root))}
            title={activeTab === SUMMARY.id ? 'Group is open — close the panel' : 'Load the Group view'}
          >Group</button>
          {steps.map((d, i) => (
            <span key={d} className={`gflow__step ${focusCol === i ? 'gflow__step--on' : ''} ${cols[i] && !cols[i].at ? 'gflow__step--idle' : ''} ${hoverCol === i ? 'gflow__step--hover' : ''} ${selPath[i + 1] ? 'gflow__step--picked' : ''}`} style={{ animationDelay: `${80 + i * 60}ms` }}>
              <Arrow />
              <button className={`gchip ${d === 'account' ? 'gchip--end' : ''} ${focusCol === i ? 'gchip--on' : ''}`} onClick={() => setFocusCol(i)}>
                {d === 'account' ? 'Account' : NAV_DIMS[d].label}
              </button>
            </span>
          ))}
        </div>
        <span className="gband__spacer" />
        <button
          className={`gload gload--band ${pending ? 'gload--ready' : ''} ${loading ? 'gload--busy' : ''}`}
          onClick={load}
          disabled={!pending && !loading}
          aria-busy={loading}
          title={pending ? `Load ${selNode.label}` : 'Select a grid to load'}
        >
          {loading ? 'Loading' : 'Load'}
        </button>
        <button className="gclosebtn" onClick={close}><Close />Close</button>
      </div>
      <div className="gband__cols" style={{ gridTemplateColumns: `repeat(${levels}, minmax(0, 1fr))` }}>
        {cols.map((c) => {
          const act = focusCol === c.i
          return (
            <div key={`${route.id}-${c.i}`} className={`gcol ${act ? 'gcol--on' : ''} ${!c.at ? 'gcol--idle' : ''}`} onMouseEnter={() => c.at && setHoverCol(c.i)} onMouseLeave={() => setHoverCol((h) => (h === c.i ? null : h))} onMouseDown={() => focusCol !== c.i && setFocusCol(c.i)} onFocus={() => focusCol !== c.i && setFocusCol(c.i)} style={{ animationDelay: `${60 + c.i * 50}ms` }}>
              <div className="gcol__head">
                <span className="gmicro gcol__label">{c.label}</span>
                <span className="gmicro">{c.at ? (c.q ? `${c.items.length} of ${c.total}` : c.total) : ''}</span>
              </div>
              {c.at && (
                <div className="gcol__filter">
                  <input value={qs[c.i] || ''} onChange={(e) => { const v = e.target.value; setQs((s) => ({ ...s, [c.i]: v })) }} placeholder={c.isAcct ? 'Name or number' : 'Filter'} aria-label={`Filter ${c.label}`} />
                </div>
              )}
              <div className="gcol__list">
                {!c.at && (
                  <>
                    <div className="gcol__ghost" aria-hidden>
                      {[72, 54, 64, 46, 58, 40].map((w, k) => (
                        <span key={k} className="gcol__ghostrow"><span style={{ width: `${w}%` }} /><span /></span>
                      ))}
                    </div>
                    <div className="gcol__empty">{c.empty}</div>
                  </>
                )}
                {c.items.map((n) => {
                  const isSel = n === selNode
                  const onPath = !isSel && n === c.next
                  return (
                    <button key={n.key} className={`gitem ${isSel ? 'gitem--on' : ''} ${onPath ? 'gitem--path' : ''} ${c.isAcct ? 'gitem--acct' : ''}`} onClick={() => pick(n)}>
                      {n === LN && <span className="gdot gdot--on" title="Loaded in the grid" />}
                      {n !== LN && n.depth > 0 && loadedPath.has(n) && <span className="gdot" title="Contains the loaded grid" />}
                      <span className="gitem__label">
                        <span className="gitem__name">{n.label}</span>
                        {n.code && <span className="gitem__code">{n.code}</span>}
                        {!n.code && !n.account && <span className="gitem__code">{plural(n.kids.length, n.nextNoun)}</span>}
                      </span>
                      <span className="gitem__badge">{c.isAcct && n.account && <AcctBadge number={n.account.number} />}</span>
                      <span className="gitem__closing">{closingOf(n)}</span>
                      <span className="gitem__kid">{n.kids.length > 0 && <ChevR />}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {cols[0] && cols[0].at && (
        <button className="gcol__more gband__more" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
          {expanded ? 'Show less' : `Show all ${cols[0].total}`}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}
    </div>
  )

  const editor = draft && (
    <RouteEditor
      draft={draft}
      setDraft={setDraft}
      routes={routes}
      sample={selNode.account || selNode.accounts[0]}
      onClose={() => setDraft(null)}
      onSave={(r) => {
        setRoutes((rs) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs, r]))
        setDraft(null)
        switchRoute(r.id)
      }}
      onDelete={(id) => {
        const rest = routes.filter((x) => x.id !== id)
        setRoutes(rest)
        setDraft({ ...rest[0], dims: [...rest[0].dims] })
        if (routeId === id) switchRoute(rest[0].id)
      }}
    />
  )

  // the page only dims while browsing; once Load is pressed the table loader takes over, crisp
  // opener for the title-row icon: the panel opens on the column that holds the loaded grid
  const toggle = () => {
    if (open) { close(); return }
    setOpen(true); setRouteMenu(false)
    setFocusCol(LN && LN.depth > 0 ? LN.depth - 1 : -1)
  }
  return { bar, band, editor, crumbs: crumbsEl, open: open && !loading, isOpen: open, toggle }
}

function RouteEditor({ draft, setDraft, routes, sample, onClose, onSave, onDelete }) {
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const [nameError, setNameError] = useState(false)
  const dragDim = useRef(null)
  const full = draft.dims.length >= MAX_LEVELS
  const avail = DIM_ORDER.filter((d) => !draft.dims.includes(d))
  const existing = routes.some((r) => r.id === draft.id)

  const place = (dim, at) => setDraft((d0) => {
    const from = d0.dims.indexOf(dim)
    if (from < 0 && d0.dims.length >= MAX_LEVELS) return d0
    const dims = d0.dims.filter((x) => x !== dim)
    let idx = at == null ? dims.length : at
    if (from >= 0 && from < idx) idx -= 1
    dims.splice(Math.max(0, Math.min(idx, dims.length)), 0, dim)
    return { ...d0, dims }
  })
  const remove = (dim) => setDraft((d0) => ({ ...d0, dims: d0.dims.filter((x) => x !== dim) }))
  const start = (dim) => (e) => { dragDim.current = dim; try { e.dataTransfer.setData('text/plain', dim); e.dataTransfer.effectAllowed = 'move' } catch (err) { /* ignore */ } setDragging(dim) }
  const end = () => { dragDim.current = null; setDragging(null); setOver(null) }
  const overAt = (i) => (e) => { e.preventDefault(); if (over !== i) setOver(i) }
  const dropLevels = (e) => { e.preventDefault(); if (dragDim.current) place(dragDim.current, typeof over === 'number' ? over : null); end() }
  const dropAvail = (e) => { e.preventDefault(); if (dragDim.current) remove(dragDim.current); end() }

  // Example path for the sample account under the draft ordering.
  const example = ['Group', ...draft.dims.map((d) => NAV_DIMS[d].name(sample)), sample.name].join(' / ')

  const save = () => {
    if (!draft.name.trim()) { setNameError(true); return }
    if (!draft.dims.length) return
    onSave({ ...draft, name: draft.name.trim() })
  }

  return (
    <>
      <div className="geditor__scrim" onClick={onClose} />
      <aside className="geditor" aria-label="Grid routes">
        <div className="geditor__head">
          <span className="geditor__title">Grid routes</span>
          <button className="gicon" onClick={onClose} aria-label="Close"><Close /></button>
        </div>
        <div className="geditor__body">
          <section className="geditor__sec" style={{ animationDelay: '120ms' }}>
            <div className="geditor__row">
              <span className="gmicro">Saved routes</span>
              <button className="glink" onClick={() => { setDraft({ id: `r-${Date.now()}`, name: '', dims: ['company'] }); setNameError(false) }}>New route</button>
            </div>
            {routes.map((r) => (
              <button key={r.id} className={`gsaved ${r.id === draft.id ? 'gsaved--on' : ''}`} onClick={() => { setDraft({ ...r, dims: [...r.dims] }); setNameError(false) }}>
                <span className="gsaved__name">{r.name}</span>
                <span className="gsaved__chain">{chainOf(r.dims).join(' / ')}</span>
              </button>
            ))}
          </section>
          <label className="geditor__sec geditor__field" style={{ animationDelay: '170ms' }}>
            <span className="gmicro">Name</span>
            <input value={draft.name} onChange={(e) => { setDraft((d0) => ({ ...d0, name: e.target.value })); setNameError(false) }} placeholder="By cash pool" />
            {nameError && <span className="geditor__error">Give the route a name.</span>}
          </label>
          <section className="geditor__sec" style={{ animationDelay: '220ms' }}>
            <span className="gmicro">Levels</span>
            <div className="glevels" onDrop={dropLevels}>
              <div className="glevel glevel--fixed"><span /><span /><span>Group</span><Lock /></div>
              {draft.dims.map((dim, i) => (
                <div
                  key={dim}
                  className={`glevel ${dragging === dim ? 'glevel--drag' : ''} ${over === i && dragging ? 'glevel--over' : ''}`}
                  draggable
                  onDragStart={start(dim)}
                  onDragEnd={end}
                  onDragOver={overAt(i)}
                >
                  <span className="glevel__grip"><Grip /></span>
                  <span className="glevel__n">{i + 1}</span>
                  <span className="glevel__name">{NAV_DIMS[dim].label}</span>
                  <span className="glevel__tools">
                    {i > 0 && <button className="gicon gicon--sm" onClick={() => place(dim, i - 1)} aria-label="Move up"><Up /></button>}
                    {i < draft.dims.length - 1 && <button className="gicon gicon--sm" onClick={() => place(dim, i + 2)} aria-label="Move down"><Chev /></button>}
                    <button className="gicon gicon--sm" onClick={() => remove(dim)} aria-label={`Remove ${NAV_DIMS[dim].label}`}><Close /></button>
                  </span>
                </div>
              ))}
              <div className={`glevel__drop ${over === draft.dims.length && dragging ? 'glevel--over' : ''}`} onDragOver={overAt(draft.dims.length)}>Drop a level here</div>
              <div className="glevel glevel--fixed"><span /><span /><span>Account</span><Lock /></div>
            </div>
            <span className="geditor__hint">{full ? `${MAX_LEVELS} levels is the limit — remove one to add another.` : 'Drag to reorder. Drag a level down to Available to remove it.'}</span>
          </section>
          <section
            className={`geditor__sec gavail ${over === 'avail' ? 'gavail--over' : ''}`}
            style={{ animationDelay: '270ms' }}
            onDragOver={(e) => { e.preventDefault(); if (over !== 'avail') setOver('avail') }}
            onDrop={dropAvail}
          >
            <span className="gmicro">Available</span>
            <div className="gavail__chips">
              {avail.map((dim) => (
                <button key={dim} className="gavail__chip" draggable onDragStart={start(dim)} onDragEnd={end} onClick={() => place(dim, null)} title={full ? `A route holds up to ${MAX_LEVELS} levels` : `Add ${NAV_DIMS[dim].label}`}>
                  <Grip size={12} />{NAV_DIMS[dim].label}
                </button>
              ))}
              {!avail.length && <span className="geditor__hint">Every dimension is in use.</span>}
            </div>
          </section>
          <section className="geditor__sec geditor__example" style={{ animationDelay: '320ms' }}>
            <span className="gmicro">Example path</span>
            <span>{draft.dims.length ? example : 'Add at least one level.'}</span>
          </section>
        </div>
        <div className="geditor__foot">
          <span>{existing && routes.length > 1 && <button className="glink glink--danger" onClick={() => onDelete(draft.id)}>Delete route</button>}</span>
          <span className="geditor__actions">
            <button className="gbtn gbtn--ghost" onClick={onClose}>Cancel</button>
            <button className="gbtn gbtn--primary" onClick={save} disabled={!draft.dims.length}>{existing ? 'Save route' : 'Create route'}</button>
          </span>
        </div>
      </aside>
    </>
  )
}
