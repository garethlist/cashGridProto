import { useMemo, useRef, useState } from 'react'
import { longDate, bandFraction } from '../model.js'
import { useMoney } from '../currency.jsx'
import ShockIcon from './ShockIcon.jsx'

// A custom SVG chart of one or more daily balance series (Base, optionally plus
// one scenario), laid out on the exact same column geometry as the table below
// so the two read as one connected view. `lines[0]` is the primary (Base).
export default function AlignedChart({ days, lines, dailyNet, buckets, labelW, colW, contentW, height, title = 'Daily balance', markers = true, annotations = [], reserveMarkers = false, onAnnotationClick }) {
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const { compact } = useMoney()

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
    if (lo === hi) hi = lo + 1
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
    const hasNeg = Math.min(0, ...primary, ...lines.flatMap((l) => l.series)) < 0
    return { lo, hi, yScale, dayX, ticks, hasNeg }
  }, [days, lines, bands, buckets, labelW, colW, plotBottom, plotH])

  const { yScale, dayX, ticks, hasNeg } = geom

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

        {/* horizontal gridlines + zero line */}
        {ticks.map((t, i) => (
          <line key={i} className="chart__grid" x1={labelW} y1={t.y} x2={contentW} y2={t.y} />
        ))}
        {hasNeg && <line className="chart__zero" x1={labelW} y1={y0} x2={contentW} y2={y0} />}

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

        {/* hover guide + a dot on each line */}
        {hover != null && (
          <g>
            <line className="chart__guide" x1={dayX[hover]} y1={plotTop} x2={dayX[hover]} y2={plotBottom} />
            {lines.map((ln) => (
              <circle
                key={`h-${ln.id}`}
                className="chart__hoverdot"
                style={{ fill: ln.color }}
                cx={dayX[hover]}
                cy={yScale(ln.series[hover])}
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
        {ticks.map((t, i) => (
          <span key={i} className="chart__ytick" style={{ top: t.y }}>
            {compact(t.v)}
          </span>
        ))}
      </div>

      {hover != null && (
        <HoverTip
          x={dayX[hover]}
          contentW={contentW}
          labelW={labelW}
          iso={days[hover]}
          lines={lines.map((ln) => ({
            id: ln.id,
            name: ln.name,
            code: ln.code,
            model: ln.model,
            color: ln.color,
            value: ln.series[hover],
            band: ln.band ? Math.abs(ln.series[hover]) * bandFraction(hover, days.length) : null,
          }))}
          net={dailyNet[hover]}
          bucket={bucketOf(hover)}
        />
      )}
      </div>
    </div>
  )
}

const tagClass = (category) =>
  category === 'Statistical' ? 'tag--stat' : category === 'ML/AI' ? 'tag--ml' : 'tag--rnd'

function HoverTip({ x, contentW, labelW, iso, lines, net, bucket }) {
  const { money0: gbp0 } = useMoney()
  const W = 268
  let left = x + 14
  if (left + W > contentW) left = x - W - 14
  if (left < labelW + 4) left = labelW + 4
  const baseVal = lines[0]?.value ?? 0
  return (
    <div className="chart__tip" style={{ left }}>
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
