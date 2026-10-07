import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { longDate, bandFraction } from '../model.js'
import { useMoney } from '../currency.jsx'
import ShockIcon from './ShockIcon.jsx'
import FinderIcon from './FinderIcon.jsx'

// A custom SVG chart of one or more daily balance series (Base, optionally plus
// one scenario), laid out on the exact same column geometry as the table below
// so the two read as one connected view. `lines[0]` is the primary (Base).
// When `stack` is set the chart draws a composition instead of lines: one row
// split into its children as stacked areas, daily like everything else here. It
// takes over the y-domain, since it replaces the lines rather than joining them.
export default function AlignedChart({ days, lines, stack = null, dailyNet, buckets, labelW, colW, contentW, height, title = 'Daily balance', note = null, markers = true, annotations = [], reserveMarkers = false, onAnnotationClick, pinnedDay = null, pinnedLabel, scrollParentRef, outliers = [], activeOutlier = null, onOutlierClick, onStackHover, todayIndex = null }) {
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [snapToday, setSnapToday] = useState(false) // pointer is on the Today line
  const { compact } = useMoney()

  // A live hover always wins; when the pointer is away we fall back to the
  // pinned day (set by the KPI "low point finder"), so its tooltip persists.
  const activeDay = hover != null ? hover : pinnedDay
  const showPinned = hover == null && pinnedDay != null

  // Upper/lower forecast bounds (dummy uncertainty cone) for lines with band on.
  const bands = useMemo(() => {
    const n = days.length
    const out = {}
    if (stack) return out // a composition has no forecast cone of its own
    for (const ln of lines) {
      if (!ln.band) continue
      out[ln.id] = {
        upper: ln.series.map((v, i) => v * (1 + bandFraction(i, n))),
        lower: ln.series.map((v, i) => v * (1 - bandFraction(i, n))),
      }
    }
    return out
  }, [lines, days.length, stack])

  const padTop = 16
  const padBottom = 22
  const plotTop = padTop
  const plotBottom = height - padBottom
  const plotH = plotBottom - plotTop

  const geom = useMemo(() => {
    // y domain across every displayed series (+ band bounds), always incl. zero.
    // A composition replaces the lines rather than joining them, so it owns the
    // domain outright — the balance line it stands in for is orders of magnitude
    // larger and would flatten the stack against the axis.
    const allValues = [0]
    if (stack) {
      for (const v of stack.total) allValues.push(v)
    } else {
      for (const ln of lines) for (const v of ln.series) allValues.push(v)
      for (const id of Object.keys(bands)) {
        for (const v of bands[id].upper) allValues.push(v)
        for (const v of bands[id].lower) allValues.push(v)
      }
    }
    let lo = Math.min(...allValues)
    let hi = Math.max(...allValues)
    // A series with no real range must not be stretched to fill the plot. The
    // domain always includes zero, so this only catches a series that IS zero
    // throughout — a zero-balancing account, whose remaining spread is rounding
    // residue. Scaled up, that residue draws a convincing moving balance out of
    // nothing. Give it a nominal domain instead and let the line lie flat on £0.
    const flat = hi - lo < Math.max(Math.abs(lo), Math.abs(hi), 1) * 1e-6
    if (flat) { lo = -1; hi = 1 }
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
    const yScale = (v) => plotBottom - ((v - lo) / (hi - lo)) * plotH

    // map every day -> its bucket + position, then to an x coordinate
    const dayToBucket = new Array(days.length)
    const posInBucket = new Array(days.length)
    buckets.forEach((b) => {
      b.dayIndices.forEach((di, pos) => {
        dayToBucket[di] = b.index
        posInBucket[di] = pos
      })
    })
    const dayX = days.map((_, i) => {
      const b = buckets[dayToBucket[i]]
      const count = b.dayIndices.length
      const frac = (posInBucket[i] + 0.5) / count
      return labelW + b.index * colW + frac * colW
    })

    const ticks = []
    const N = 5
    for (let k = 0; k < N; k++) {
      const v = lo + ((hi - lo) * k) / (N - 1)
      ticks.push({ v, y: yScale(v) })
    }

    const primary = lines[0]?.series ?? []
    // "Short of cash" means a balance that reads negative, not one that rounds to
    // zero — otherwise a swept account's -1e-11 residue paints the whole chart as
    // breached. Half a unit is the display precision, so anything inside it is £0.
    // An outflow composition sits entirely below zero by construction, which is
    // its direction of travel, not a cash shortfall — so it never shades.
    const hasNeg = stack ? false : Math.min(0, ...primary, ...lines.flatMap((l) => l.series)) < -0.5
    // Zero sits somewhere on the plot whenever the domain straddles it — which,
    // since the domain always includes zero, is true unless every value is zero.
    // We surface the £0 line whenever it's genuinely in range so the "cash floor"
    // is always readable, not only once a balance has already gone negative.
    const zeroInRange = lo < 0 && hi > 0
    return { lo, hi, yScale, dayX, ticks, hasNeg, zeroInRange, flat }
  }, [days, lines, stack, bands, buckets, labelW, colW, plotBottom, plotH])

  // Days, weeks and months are one daily series on a re-scaled x axis, so a
  // granularity change morphs every point from its old x to its new one — the
  // axis zooms rather than the chart being redrawn.
  const [morphX, setMorphX] = useState(null)
  const prevXRef = useRef(null)
  const shownXRef = useRef(null)
  const rafRef = useRef(0)
  useLayoutEffect(() => {
    const next = geom.dayX
    const prev = shownXRef.current || prevXRef.current
    prevXRef.current = next
    if (!prev || prev.length !== next.length) return
    const n = next.length
    if (Math.abs(prev[n - 1] - next[n - 1]) < 4 && Math.abs(prev[0] - next[0]) < 4) return
    cancelAnimationFrame(rafRef.current)
    const from = prev.slice()
    const t0 = performance.now()
    const D = 720
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const step = (now) => {
      const t = Math.min(1, (now - t0) / D)
      const e = ease(t)
      if (t < 1) {
        const x = new Array(n)
        for (let i = 0; i < n; i++) x[i] = from[i] + (next[i] - from[i]) * e
        shownXRef.current = x
        setMorphX(x)
        rafRef.current = requestAnimationFrame(step)
      } else {
        shownXRef.current = null
        setMorphX(null)
      }
    }
    setHover(null)
    rafRef.current = requestAnimationFrame(step)
  }, [geom.dayX])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
  const morphing = morphX != null
  const { yScale, ticks, hasNeg, zeroInRange, flat } = geom
  const dayX = morphX || geom.dayX
  // x of the boundary between the last actual day and the first forecast day
  // left edge of today's slot in its column — the same x the grid's today rule uses
  const todayX = (() => {
    if (todayIndex == null || todayIndex <= 0 || dayX[todayIndex] == null) return null
    const b = buckets.find((bk) => bk.dayIndices.includes(todayIndex))
    if (!b) return null
    // exact column boundary when today opens a period, so it sits on the period's start line
    const pos = b.dayIndices.indexOf(todayIndex)
    return labelW + b.index * colW + (pos / b.dayIndices.length) * colW
  })()

  // Bring a singled-out day into view — the low point, or an outlier stepped to
  // with the panel's arrows, often sits off-screen in the horizontally scrolling
  // grid, and a silent highlight there would go unseen.
  const centerDay = (day) => {
    if (day == null) return
    const parent = scrollParentRef?.current
    if (!parent || dayX[day] == null) return
    const max = parent.scrollWidth - parent.clientWidth
    const target = Math.max(0, Math.min(max, dayX[day] - parent.clientWidth / 2))
    parent.scrollTo({ left: target, behavior: 'smooth' })
  }
  useEffect(() => { centerDay(pinnedDay) }, [pinnedDay, dayX, scrollParentRef])
  useEffect(() => { centerDay(activeOutlier) }, [activeOutlier, dayX, scrollParentRef])

  const toLine = (series) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'}${dayX[i].toFixed(2)},${yScale(v).toFixed(2)}`).join(' ')

  // the emphasised line gets the area fill + markers; others recede
  const prominent = lines.find((l) => l.prominent) || lines[0]

  const linePaths = useMemo(() => (stack ? [] : lines.map((ln) => ({ ...ln, d: toLine(ln.series) }))), [lines, stack, dayX, yScale])

  // Stacked bands, laid out cumulatively from zero. Each band's floor is the one
  // below it, so the top edge of the last band is the parent's own total.
  const stackPaths = useMemo(() => {
    if (!stack) return null
    const n = days.length
    const cum = new Array(n).fill(0)
    const at = (i, v) => `${dayX[i].toFixed(2)},${yScale(v).toFixed(2)}`
    return stack.bands.map((band) => {
      const lower = cum.slice()
      const upper = cum.map((v, i) => v + (band.values[i] ?? 0))
      for (let i = 0; i < n; i++) cum[i] = upper[i]
      let d = `M${at(0, upper[0])}`
      for (let i = 1; i < n; i++) d += ` L${at(i, upper[i])}`
      for (let i = n - 1; i >= 0; i--) d += ` L${at(i, lower[i])}`
      return { ...band, d: `${d} Z`, edge: upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${at(i, v)}`).join(' ') }
    })
  }, [stack, days.length, dayX, yScale])

  const areaPath = useMemo(() => {
    // area-to-zero fill only for the emphasised line, and only when bands are off
    if (stack || !prominent || prominent.band || !prominent.series.length) return null
    const y0 = yScale(0)
    return `${toLine(prominent.series)} L${dayX[dayX.length - 1].toFixed(2)},${y0.toFixed(2)} L${dayX[0].toFixed(2)},${y0.toFixed(2)} Z`
  }, [prominent, stack, dayX, yScale])

  const bandPaths = useMemo(
    () =>
      Object.keys(bands).map((id) => {
        const b = bands[id]
        const fwd = toLine(b.upper)
        let back = ''
        for (let i = b.lower.length - 1; i >= 0; i--) back += `L${dayX[i].toFixed(2)},${yScale(b.lower[i]).toFixed(2)} `
        const color = lines.find((l) => l.id === id)?.color
        return { id, color, d: `${fwd} ${back} Z` }
      }),
    [bands, lines, dayX, yScale]
  )

  const y0 = yScale(0)

  // The column splitter sits over the divider, which is exactly where Today lands
  // when it opens the window — so the snap is also tracked at document level and
  // still fires with the splitter (one unified line) under the pointer.
  useEffect(() => {
    if (todayX == null) return undefined
    const onDoc = (e) => {
      const svg = svgRef.current
      if (!svg || morphing) return
      const r = svg.getBoundingClientRect()
      const inY = e.clientY >= r.top && e.clientY <= r.bottom
      const near = inY && Math.abs(e.clientX - (r.left + todayX)) <= 14
      if (near) { setSnapToday(true); setHover(todayIndex) }
      else if (snapToday && !svg.contains(e.target)) { setSnapToday(false); setHover(null) }
    }
    document.addEventListener('mousemove', onDoc, { passive: true })
    return () => document.removeEventListener('mousemove', onDoc)
  }, [todayX, todayIndex, snapToday, morphing])

  const onMove = (e) => {
    const svg = svgRef.current
    if (!svg || morphing) return
    const mx = e.clientX - svg.getBoundingClientRect().left
    // the Today line is a hover target of its own: near it, the readout snaps to today
    if (todayX != null && Math.abs(mx - todayX) <= 14) { setSnapToday(true); setHover(todayIndex); return }
    if (snapToday) setSnapToday(false)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < dayX.length; i++) {
      const d = Math.abs(dayX[i] - mx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    // period ends are magnetic: within a short reach the readout snaps to the closing day
    const reach = Math.min(16, Math.max(6, colW * 0.22))
    for (const b of buckets) {
      const end = b.dayIndices[b.dayIndices.length - 1]
      if (dayX[end] != null && Math.abs(dayX[end] - mx) <= reach) { best = end; break }
    }
    if (best !== hover) setHover(best)
  }

  const bucketOf = (i) => buckets.find((b) => b.dayIndices.includes(i))

  const activeBucket = activeDay != null ? bucketOf(activeDay) : null
  const guideX = activeDay == null ? null : snapToday && todayX != null ? todayX : dayX[activeDay]

  // Bands of a single hue need more separation than opacity alone provides. The
  // fill steps down in lightness across the whole ramp, mixed toward the panel
  // rather than made transparent so it holds up in either theme; every boundary
  // then carries a hairline in the hue at full strength. Bands that have their
  // own colours only get a slight softening — they're already distinct.
  const bandFill = (b) =>
    b.ramped
      ? `color-mix(in srgb, ${b.color} ${Math.round(28 + 62 * b.fade)}%, var(--panel))`
      : `color-mix(in srgb, ${b.color} 78%, var(--panel))`
  // Every step past the first in a ramp is hatched, more densely the further down
  // it sits. Texture separates the bands where tone alone struggles, and it reads
  // as "modelled" against the solid band of committed cash at the bottom.
  const bandHatch = (b, i) => (b.ramped && i > 0 ? i : 0)

  // While the pointer is over the plot, whichever band holds the largest share of
  // the day under it is held at full strength across the whole canvas and the
  // rest recede — so sweeping the chart walks the handover from one source to the
  // next instead of having to read three tones at once.
  //
  // Weekends carry no cash at all, and every band is zero there. Reading
  // dominance off such a day would just pick whichever sorts first and make the
  // highlight flicker at every weekend, so those fall back to the nearest day
  // that does have cash on it.
  // A band can be pinned by clicking it, which holds it forward after the pointer
  // leaves the plot — the point being to read its row in the table below without
  // the highlight dropping the moment you move off the chart.
  const [held, setHeld] = useState(null)
  const bandKey = stack ? stack.bands.map((b) => b.id).join('|') : ''
  useEffect(() => { setHeld(null) }, [bandKey])

  const hoverDominant = useMemo(() => {
    if (!stack || hover == null) return null
    const n = stack.total.length
    const live = (i) => i >= 0 && i < n && Math.abs(stack.total[i] ?? 0) > 0.5
    let d = hover
    if (!live(d)) {
      let back = hover
      let fwd = hover
      while (back >= 0 && !live(back)) back--
      while (fwd < n && !live(fwd)) fwd++
      if (!live(back) && !live(fwd)) return null
      d = !live(fwd) || (live(back) && hover - back <= fwd - hover) ? back : fwd
    }
    let best = 0
    for (let b = 1; b < stack.bands.length; b++) {
      if (Math.abs(stack.bands[b].values[d] ?? 0) > Math.abs(stack.bands[best].values[d] ?? 0)) best = b
    }
    return best
  }, [stack, hover])
  // A hold outranks the pointer: that's what makes it a hold.
  const dominant = held != null ? held : hoverDominant
  const bandDim = (i) => (dominant == null || dominant === i ? 1 : 0.2)

  // Which band's area a point falls in, walking the same cumulative ranges the
  // paths are built from. Sign-agnostic, so an outflow stack (which runs down
  // from zero) hit-tests the same way as an inflow one.
  const bandAtValue = (dayIdx, value) => {
    if (!stack) return null
    let floor = 0
    for (let i = 0; i < stack.bands.length; i++) {
      const ceil = floor + (stack.bands[i].values[dayIdx] ?? 0)
      if (floor !== ceil && value >= Math.min(floor, ceil) && value <= Math.max(floor, ceil)) return i
      floor = ceil
    }
    return null
  }

  // Click a band to hold it; click it again, or click off the bands entirely, to
  // let go. Clicking a different band moves the hold rather than dropping it —
  // the alternative is a release-then-click for something the one click says.
  const onPlotClick = (e) => {
    if (!stack || activeDay == null) return
    if (e.target.closest?.('.chart__outlier')) return // the outlier markers own their clicks
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const value = geom.lo + ((plotBottom - (e.clientY - rect.top)) * (geom.hi - geom.lo)) / plotH
    const hit = bandAtValue(activeDay, value)
    setHeld((cur) => (hit == null || cur === hit ? null : hit))
  }

  // Report the band being held forward so the table can light its row and show
  // the numbers behind it. Band ids are the grid's own row ids. Keyed on the id
  // rather than the pointer, so this fires when dominance actually changes —
  // three or four times across a sweep — not on every mousemove, which would
  // re-render the whole grid continuously.
  const dominantId = stack && dominant != null ? stack.bands[dominant]?.id ?? null : null
  useEffect(() => {
    onStackHover?.(dominantId)
  }, [dominantId, onStackHover])

  return (
    <div className="chart" style={{ width: contentW }}>
      {(reserveMarkers || annotations.length > 0) && (
        <div className="chart__markers" style={{ height: 26 }}>
          <span className="chart__markers-label" style={{ width: labelW }}>Shocks</span>
          {annotations.map((a, i) => (
            <button
              key={`mk-${a.id || i}`}
              className={`chart__markerbtn ${a.active === false ? 'chart__markerbtn--off' : ''}`}
              style={{ left: dayX[a.dayIndex], color: a.color }}
              title={`${a.active === false ? 'Inactive shock' : 'Shock'}${a.reason ? `: ${a.reason}` : ' — click to edit'}`}
              onClick={() => onAnnotationClick && onAnnotationClick(a.key, a.id)}
            >
              <ShockIcon size={15} />
            </button>
          ))}
        </div>
      )}
      <div className="chart__plot" style={{ position: 'relative', height }}>
      <svg
        ref={svgRef}
        className={`chart__svg ${morphing ? 'chart__svg--morph' : ''}`}
        width={contentW}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => { setHover(null); setSnapToday(false) }}
        onClick={stack ? onPlotClick : undefined}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: prominent?.color, stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: prominent?.color, stopOpacity: 0.02 }} />
          </linearGradient>
          {stackPaths &&
            stackPaths.map((b, i) =>
              bandHatch(b, i) ? (
                <pattern
                  key={`hatchdef-${i}`}
                  id={`stackhatch-${i}`}
                  patternUnits="userSpaceOnUse"
                  width="7"
                  height="7"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="7" stroke={b.color} strokeWidth={0.8 + 0.6 * i} strokeOpacity="0.45" />
                </pattern>
              ) : null
            )}
          <linearGradient id="areaFillPast" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--muted)', stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: 'var(--muted)', stopOpacity: 0.02 }} />
          </linearGradient>
          {todayX != null && (
            <>
              <clipPath id="clipActual"><rect x="0" y="0" width={Math.max(0, todayX)} height={height} /></clipPath>
              <clipPath id="clipForecast"><rect x={todayX} y="0" width={Math.max(0, contentW - todayX)} height={height} /></clipPath>
            </>
          )}
        </defs>

        {/* alternating column bands, one per table column */}
        {buckets.map((b) => (
          <rect
            key={b.key}
            className={`chart__band ${b.index % 2 ? 'chart__band--alt' : ''}`}
            x={labelW + b.index * colW}
            y={plotTop}
            width={colW}
            height={plotH}
          />
        ))}

        {/* "short of cash" zone: everything below the £0 line, shaded faint
            danger. Only drawn once a balance actually dips negative. */}
        {zeroInRange && hasNeg && (
          <rect
            className="chart__short"
            x={labelW}
            y={y0}
            width={contentW - labelW}
            height={Math.max(0, plotBottom - y0)}
          />
        )}

        {/* horizontal gridlines + zero line */}
        {ticks.map((t, i) => (
          <line key={i} className="chart__grid" x1={labelW} y1={t.y} x2={contentW} y2={t.y} />
        ))}
        {zeroInRange && (
          <line
            className={`chart__zero ${hasNeg ? 'chart__zero--breached' : ''}`}
            x1={labelW}
            y1={y0}
            x2={contentW}
            y2={y0}
          />
        )}

        {/* column separators aligned to table column borders */}
        {buckets.slice(1).map((b) => (
          <line
            key={`sep-${b.key}`}
            className="chart__sep"
            x1={labelW + b.index * colW}
            y1={plotTop}
            x2={labelW + b.index * colW}
            y2={plotBottom}
          />
        ))}

        {/* forecast error bands (when on) — one per displayed line */}
        {bandPaths.map((b) => (
          <path key={`band-${b.id}`} className="chart__banderr" style={{ fill: b.color }} d={b.d} />
        ))}

        {/* area-to-zero fill under the primary line (when bands are off) */}
        {areaPath && todayX == null && <path className="chart__area" style={{ fill: 'url(#areaFill)' }} d={areaPath} />}
        {areaPath && todayX != null && (
          <>
            <path className="chart__area" clipPath="url(#clipActual)" style={{ fill: 'url(#areaFillPast)' }} d={areaPath} />
            <path className="chart__area" clipPath="url(#clipForecast)" style={{ fill: 'url(#areaFill)' }} d={areaPath} />
          </>
        )}

        {/* composition: one row split into its children, stacked from zero —
            tone, then texture over it, then a hairline on every boundary. */}
        {stackPaths && (
          /* Drawn in three passes rather than grouped per band, so every edge
             lands above every fill — a band's top edge is its neighbour's floor,
             and per-band groups let the next fill paint over half of it. */
          <g className="chart__stack">
            {stackPaths.map((b, i) => (
              <path key={`sf-${b.id}`} className="chart__stackband" style={{ fill: bandFill(b), opacity: bandDim(i) }} d={b.d} />
            ))}
            {stackPaths.map((b, i) =>
              bandHatch(b, i) ? (
                <path key={`sh-${b.id}`} className="chart__stackband" style={{ fill: `url(#stackhatch-${i})`, opacity: bandDim(i) }} d={b.d} />
              ) : null
            )}
            {stackPaths.map((b, i) => (
              <path key={`se-${b.id}`} className="chart__stackedge" style={{ stroke: b.color, opacity: bandDim(i) }} d={b.edge} />
            ))}
          </g>
        )}

        {/* faint guide line linking each shock marker (above) to the plot */}
        {annotations.map((a, i) => (
          <line
            key={`anno-${a.id || i}`}
            className={`chart__anno ${a.active === false ? 'chart__anno--off' : ''}`}
            style={{ stroke: a.color }}
            x1={dayX[a.dayIndex]}
            y1={plotTop}
            x2={dayX[a.dayIndex]}
            y2={plotBottom}
          />
        ))}

        {/* the line(s) — emphasised line bold, muted lines thin & faint */}
        {/* actuals solid up to today; the forecast beyond it lighter and dashed */}
        {[['actual', 'url(#clipActual)'], ['forecast', 'url(#clipForecast)']].map(([part, clip]) => (
          <g key={part} clipPath={todayX != null ? clip : undefined} className={`chart__part chart__part--${part}`}>
            {(todayX != null || part === 'actual') && linePaths.map((ln) => (
              <path
                key={`line-${part}-${ln.id}`}
                className="chart__line"
                style={{
                  // actuals read as settled history in grey; the forecast carries the series colour, solid
                  stroke: part === 'actual' && todayX != null ? 'var(--muted)' : ln.color,
                  strokeWidth: ln.prominent ? 1.5 : ln.muted ? 1 : 1.25,
                  strokeOpacity: ln.muted ? 0.4 : 1,
                  strokeDasharray: ln.dash ? '6 4' : undefined,
                }}
                d={ln.d}
              />
            ))}
          </g>
        ))}
        {todayX != null && (
          <g className={`chart__today ${snapToday ? 'chart__today--hot' : ''}`} pointerEvents="none">
            <line x1={todayX} x2={todayX} y1={plotTop} y2={plotBottom} shapeRendering="crispEdges" />
            <text x={todayX + 6} y={plotTop + 10}>Today</text>
          </g>
        )}

        {/* markers at each bucket's closing day, on the emphasised line */}
        {markers &&
          !stack &&
          prominent &&
          buckets.map((b) => {
            const last = b.dayIndices[b.dayIndices.length - 1]
            return (
              <circle
                key={`m-${b.key}`}
                className="chart__marker"
                style={{ fill: prominent.color }}
                cx={dayX[last]}
                cy={yScale(prominent.series[last])}
                r={3}
              />
            )
          })}

        {/* Outlier mode: a clickable ring on the emphasised line at each day whose
            movement sits outside the usual range. The ring is what you see; the
            invisible disc behind it is what you hit, since a 6px target on a
            year-long axis is not something a pointer can be expected to find. */}
        {!stack && prominent && outliers.map((o) => {
          const cx = dayX[o.dayIndex]
          const cy = yScale(prominent.series[o.dayIndex])
          if (cx == null || !Number.isFinite(cy)) return null
          const on = activeOutlier === o.dayIndex
          return (
            <g
              key={`out-${o.dayIndex}`}
              className={`chart__outlier ${on ? 'chart__outlier--on' : ''}`}
              onClick={() => onOutlierClick && onOutlierClick(o.dayIndex)}
              role="button"
              tabIndex={0}
              // The <title> below is the pointer tooltip, and would otherwise also
              // be the accessible name — which would tell a keyboard user to click.
              aria-label={`Outlier · ${longDate(days[o.dayIndex])} — open the day's breakdown`}
              aria-expanded={on}
              aria-controls="outlier-panel"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOutlierClick && onOutlierClick(o.dayIndex) }
              }}
            >
              <title>{`Outlier · ${longDate(days[o.dayIndex])} — click to drill into the day`}</title>
              <circle className="chart__outlier-hit" cx={cx} cy={cy} r={13} />
              <circle className="chart__outlier-halo" cx={cx} cy={cy} r={10} />
              <circle className="chart__outlier-ring" cx={cx} cy={cy} r={6} />
            </g>
          )
        })}

        {/* persistent "found" halo at the pinned low point, so it stays visible
            even while the pointer roams elsewhere on the chart */}
        {pinnedDay != null && !stack && prominent && dayX[pinnedDay] != null && (
          <g className="chart__found">
            <circle className="chart__found-halo" cx={dayX[pinnedDay]} cy={yScale(prominent.series[pinnedDay])} r={11} />
            <circle className="chart__found-ring" cx={dayX[pinnedDay]} cy={yScale(prominent.series[pinnedDay])} r={6} />
          </g>
        )}

        {/* hover guide + a dot on each line — or the pinned low point when idle */}
        {activeDay != null && (
          <g>
            <line
              className={`chart__guide ${showPinned ? 'chart__guide--pinned' : ''} ${snapToday ? 'chart__guide--today' : ''}`}
              x1={guideX}
              y1={plotTop}
              x2={guideX}
              y2={plotBottom}
            />
            {!stack && lines.map((ln) => (
              <circle
                key={`h-${ln.id}`}
                className={`chart__hoverdot ${showPinned ? 'chart__hoverdot--pinned' : ''}`}
                style={showPinned ? undefined : { fill: ln.color }}
                cx={dayX[activeDay]}
                cy={yScale(ln.series[activeDay])}
                r={ln.id === lines[0].id ? 4.5 : 3.8}
              />
            ))}
          </g>
        )}

        <line className="chart__axisline" x1={labelW} y1={plotBottom} x2={contentW} y2={plotBottom} />
      </svg>

      {/* sticky Y-axis gutter — stays pinned left while columns scroll */}
      <div className="chart__gutter" style={{ width: labelW, height }}>
        <span className="chart__gutter-title">{title}</span>
        {/* Standing note about the grid itself, in the gutter's empty upper area —
            e.g. why a swept account's line is pinned flat at zero. */}
        {note && (
          <span className="chart__gutter-note">
            <span className="chart__gutter-note-label">
              <span className="chart__gutter-note-dot" aria-hidden />
              {note.label}
            </span>
            {note.detail && <span className="chart__gutter-note-detail">{note.detail}</span>}
          </span>
        )}
        {/* A stack of one hue is unreadable without naming its steps. Listed from
            the base of the stack upward, which is also the table's row order. */}
        {stack && (
          <span className={`chart__gutter-legend ${note ? 'chart__gutter-legend--pushed' : ''}`}>
            {stack.bands.map((b, i) => (
              /* the key dims with the plot, so the band being singled out is
                 named as well as highlighted */
              <span
                className={`chart__legenditem ${held === i ? 'chart__legenditem--held' : ''}`}
                key={`lg-${b.id}`}
                style={{ opacity: bandDim(i) === 1 ? 1 : 0.4 }}
              >
                <span className="chart__legendswatch" style={{ background: bandFill(b), borderColor: b.color }}>
                  {bandHatch(b, i) > 0 && <span className="chart__legendhatch" style={{ color: b.color }} />}
                </span>
                <span className="chart__legendname">{b.name}</span>
                {held === i && <span className="chart__legendhold" title="Held — click the band again to release">HELD</span>}
              </span>
            ))}
          </span>
        )}
        {/* A flat-at-zero series has a nominal domain, so its ticks would be five
            arbitrary subdivisions of nothing — all reading £0. The zero marker
            below says it once. */}
        {(flat ? [] : ticks).map((t, i) =>
          // Suppress any regular tick that would collide with the dedicated £0
          // label — the zero marker takes precedence over the padded scale tick.
          // ~20px clears a label's height; regular ticks sit far further apart.
          zeroInRange && Math.abs(t.y - y0) < 20 ? null : (
            <span key={i} className="chart__ytick" style={{ top: t.y }}>
              {compact(t.v)}
            </span>
          )
        )}
        {zeroInRange && (
          <span
            className={`chart__ytick chart__ytick--zero ${hasNeg ? 'chart__ytick--breached' : ''}`}
            style={{ top: y0 }}
          >
            {compact(0)}
          </span>
        )}
      </div>

      {activeDay != null && stack && (
        <StackTip
          x={guideX}
          contentW={contentW}
          labelW={labelW}
          iso={days[activeDay]}
          bands={stack.bands.map((b, i) => ({ id: b.id, name: b.name, fill: bandFill(b), color: b.color, hatch: bandHatch(b, i), lead: dominant === i, value: b.values[activeDay] ?? 0 }))}
          total={stack.total[activeDay] ?? 0}
        />
      )}

      {activeDay != null && !stack && (
        <HoverTip
          x={snapToday && todayX != null ? todayX : dayX[activeDay]}
          contentW={contentW}
          labelW={labelW}
          iso={days[activeDay]}
          lines={lines.map((ln) => ({
            id: ln.id,
            name: ln.name,
            code: ln.code,
            model: ln.model,
            color: ln.color,
            value: ln.series[activeDay],
            band: ln.band ? Math.abs(ln.series[activeDay]) * bandFraction(activeDay, days.length) : null,
          }))}
          net={dailyNet[activeDay]}
          bucket={bucketOf(activeDay)}
          found={showPinned || snapToday}
          foundLabel={snapToday ? 'Today' : pinnedLabel}
        />
      )}
      </div>
    </div>
  )
}

// Tooltip for the composition view. Deliberately spare: it sits over a chart the
// reader is trying to see, so it carries only the day, the split and the total.
// The category is named in the header bar and the key, and the column it falls in
// is labelled directly beneath the plot — repeating either just costs height.
// Shares stay, since band thickness alone can't be judged once the total moves.
function StackTip({ x, contentW, labelW, iso, bands, total }) {
  const { money0 } = useMoney()
  const W = 178
  let left = x + 14
  if (left + W > contentW) left = x - W - 14
  if (left < labelW + 4) left = labelW + 4
  const share = (v) => (total ? Math.round((v / total) * 100) : 0)
  return (
    <div className="chart__tip chart__tip--stack" style={{ left }}>
      <div className="chart__tip-date">{longDate(iso)}</div>
      {bands.map((b) => (
        <div className={`chart__tip-row ${b.lead ? 'chart__tip-row--lead' : ''}`} key={b.id}>
          <span className="chart__tip-key">
            {/* the swatch carries the band's own tone and texture, so the tip
                keys back to the plot without relying on order alone */}
            <span className="chart__legendswatch chart__tip-swatch" style={{ background: b.fill, borderColor: b.color }}>
              {b.hatch > 0 && <span className="chart__legendhatch" style={{ color: b.color }} />}
            </span>
            <span className="chart__tip-name">{b.name}</span>
          </span>
          <span className="chart__tip-val">
            <span className="chart__tip-band">{share(b.value)}%</span>
            <strong>{money0(b.value)}</strong>
          </span>
        </div>
      ))}
      <div className="chart__tip-row chart__tip-row--sub">
        <span>Day total</span>
        <strong>{money0(total)}</strong>
      </div>
    </div>
  )
}

const tagClass = (category) =>
  category === 'Statistical' ? 'tag--stat' : category === 'ML/AI' ? 'tag--ml' : 'tag--rnd'

function HoverTip({ x, contentW, labelW, iso, lines, net, bucket, found = false, foundLabel }) {
  const { money0: gbp0 } = useMoney()
  const W = 268
  let left = x + 14
  if (left + W > contentW) left = x - W - 14
  if (left < labelW + 4) left = labelW + 4
  const baseVal = lines[0]?.value ?? 0
  return (
    <div className={`chart__tip ${found ? 'chart__tip--found' : ''}`} style={{ left }}>
      {found && (
        <div className="chart__tip-found">
          <FinderIcon size={12} />
          <span>{foundLabel || 'Lowest point'}</span>
        </div>
      )}
      <div className="chart__tip-date">{longDate(iso)}</div>
      {lines.map((ln, i) => {
        const impact = ln.value - baseVal
        return (
          <div className="chart__tip-line" key={ln.id}>
            <div className="chart__tip-row">
              <span className="chart__tip-key">
                <span className="chart__tip-dot" style={{ background: ln.color }} />
                {ln.code && <span className="chart__tip-code">{ln.code}</span>}
                <span className="chart__tip-name">{ln.name}</span>
              </span>
              <span className="chart__tip-val">
                <strong className={ln.value < 0 ? 'is-neg' : ''}>{gbp0(ln.value)}</strong>
                {ln.band != null && <span className="chart__tip-band">± {gbp0(ln.band)}</span>}
              </span>
            </div>
            {i > 0 && (
              <div className="chart__tip-impact">
                <span>Net impact vs base</span>
                <strong className={impact < 0 ? 'is-neg' : impact > 0 ? 'is-pos' : ''}>
                  {impact > 0 ? '+' : ''}
                  {gbp0(impact)}
                </strong>
              </div>
            )}
            {ln.model && (
              <div className="chart__tip-model">
                <span className={`tag ${tagClass(ln.model.category)}`}>{ln.model.category}</span>
                <span className="chart__tip-modelname">{ln.model.name}</span>
              </div>
            )}
          </div>
        )
      })}
      <div className="chart__tip-row chart__tip-row--sub">
        <span>Day net</span>
        <strong className={net < 0 ? 'is-neg' : net > 0 ? 'is-pos' : ''}>
          {net > 0 ? '+' : ''}
          {gbp0(net)}
        </strong>
      </div>
      {bucket && <div className="chart__tip-bucket">in {bucket.label}</div>}
    </div>
  )
}
