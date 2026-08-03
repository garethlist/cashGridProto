import { useMemo, useRef, useState, useEffect } from 'react'
import { longDate, bandFraction } from '../model.js'
import { useMoney } from '../currency.jsx'
import ShockIcon from './ShockIcon.jsx'
import FinderIcon from './FinderIcon.jsx'

// A custom SVG chart of one or more daily balance series (Base, optionally plus
// one scenario), laid out on the exact same column geometry as the table below
// so the two read as one connected view. `lines[0]` is the primary (Base).
export default function AlignedChart({ days, lines, dailyNet, buckets, labelW, colW, contentW, height, title = 'Daily balance', note = null, markers = true, annotations = [], reserveMarkers = false, onAnnotationClick, pinnedDay = null, pinnedLabel, scrollParentRef }) {
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const { compact } = useMoney()

  // A live hover always wins; when the pointer is away we fall back to the
  // pinned day (set by the KPI "low point finder"), so its tooltip persists.
  const activeDay = hover != null ? hover : pinnedDay
  const showPinned = hover == null && pinnedDay != null

  // Upper/lower forecast bounds (dummy uncertainty cone) for lines with band on.
  const bands = useMemo(() => {
    const n = days.length
    const out = {}
    for (const ln of lines) {
      if (!ln.band) continue
      out[ln.id] = {
        upper: ln.series.map((v, i) => v * (1 + bandFraction(i, n))),
        lower: ln.series.map((v, i) => v * (1 - bandFraction(i, n))),
      }
    }
    return out
  }, [lines, days.length])

  const padTop = 16
  const padBottom = 22
  const plotTop = padTop
  const plotBottom = height - padBottom
  const plotH = plotBottom - plotTop

  const geom = useMemo(() => {
    // y domain across every displayed series (+ band bounds), always incl. zero
    const allValues = [0]
    for (const ln of lines) for (const v of ln.series) allValues.push(v)
    for (const id of Object.keys(bands)) {
      for (const v of bands[id].upper) allValues.push(v)
      for (const v of bands[id].lower) allValues.push(v)
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
    const hasNeg = Math.min(0, ...primary, ...lines.flatMap((l) => l.series)) < -0.5
    // Zero sits somewhere on the plot whenever the domain straddles it — which,
    // since the domain always includes zero, is true unless every value is zero.
    // We surface the £0 line whenever it's genuinely in range so the "cash floor"
    // is always readable, not only once a balance has already gone negative.
    const zeroInRange = lo < 0 && hi > 0
    return { lo, hi, yScale, dayX, ticks, hasNeg, zeroInRange, flat }
  }, [days, lines, bands, buckets, labelW, colW, plotBottom, plotH])

  const { yScale, dayX, ticks, hasNeg, zeroInRange, flat } = geom

  // When the finder pins a day, bring it into view — the low point often sits
  // off-screen in the horizontally scrolling grid, and a silent highlight there
  // would go unseen.
  useEffect(() => {
    if (pinnedDay == null) return
    const parent = scrollParentRef?.current
    if (!parent || dayX[pinnedDay] == null) return
    const max = parent.scrollWidth - parent.clientWidth
    const target = Math.max(0, Math.min(max, dayX[pinnedDay] - parent.clientWidth / 2))
    parent.scrollTo({ left: target, behavior: 'smooth' })
  }, [pinnedDay, dayX, scrollParentRef])

  const toLine = (series) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'}${dayX[i].toFixed(2)},${yScale(v).toFixed(2)}`).join(' ')

  // the emphasised line gets the area fill + markers; others recede
  const prominent = lines.find((l) => l.prominent) || lines[0]

  const linePaths = useMemo(() => lines.map((ln) => ({ ...ln, d: toLine(ln.series) })), [lines, dayX, yScale])

  const areaPath = useMemo(() => {
    // area-to-zero fill only for the emphasised line, and only when bands are off
    if (!prominent || prominent.band || !prominent.series.length) return null
    const y0 = yScale(0)
    return `${toLine(prominent.series)} L${dayX[dayX.length - 1].toFixed(2)},${y0.toFixed(2)} L${dayX[0].toFixed(2)},${y0.toFixed(2)} Z`
  }, [prominent, dayX, yScale])

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

  const onMove = (e) => {
    const svg = svgRef.current
    if (!svg) return
    const mx = e.clientX - svg.getBoundingClientRect().left
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < dayX.length; i++) {
      const d = Math.abs(dayX[i] - mx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    setHover(best)
  }

  const bucketOf = (i) => buckets.find((b) => b.dayIndices.includes(i))

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
        className="chart__svg"
        width={contentW}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: prominent?.color, stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: prominent?.color, stopOpacity: 0.02 }} />
          </linearGradient>
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
        {areaPath && <path className="chart__area" style={{ fill: 'url(#areaFill)' }} d={areaPath} />}

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
        {linePaths.map((ln) => (
          <path
            key={`line-${ln.id}`}
            className="chart__line"
            style={{
              stroke: ln.color,
              strokeWidth: ln.prominent ? 1.5 : ln.muted ? 1 : 1.25,
              strokeOpacity: ln.muted ? 0.4 : 1,
              strokeDasharray: ln.dash ? '6 4' : undefined,
            }}
            d={ln.d}
          />
        ))}

        {/* markers at each bucket's closing day, on the emphasised line */}
        {markers &&
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

        {/* persistent "found" halo at the pinned low point, so it stays visible
            even while the pointer roams elsewhere on the chart */}
        {pinnedDay != null && prominent && dayX[pinnedDay] != null && (
          <g className="chart__found">
            <circle className="chart__found-halo" cx={dayX[pinnedDay]} cy={yScale(prominent.series[pinnedDay])} r={11} />
            <circle className="chart__found-ring" cx={dayX[pinnedDay]} cy={yScale(prominent.series[pinnedDay])} r={6} />
          </g>
        )}

        {/* hover guide + a dot on each line — or the pinned low point when idle */}
        {activeDay != null && (
          <g>
            <line
              className={`chart__guide ${showPinned ? 'chart__guide--pinned' : ''}`}
              x1={dayX[activeDay]}
              y1={plotTop}
              x2={dayX[activeDay]}
              y2={plotBottom}
            />
            {lines.map((ln) => (
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

      {activeDay != null && (
        <HoverTip
          x={dayX[activeDay]}
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
          found={showPinned}
          foundLabel={pinnedLabel}
        />
      )}
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
