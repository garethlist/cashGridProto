import { useMoney } from '../currency.jsx'
import { longDate } from '../model.js'
import OutlierIcon from './OutlierIcon.jsx'

const pct = (share) => Math.round(Math.abs(share) * 100)

// Drill-in for one outlier day: what moved, by how much against its own normal,
// and whether any single category carries enough of that to be called the cause.
//
// The panel deliberately answers "no single cause" out loud when the excess is
// spread across several categories. A confident-looking attribution to whichever
// row happened to rank first would be worse than no attribution at all.
export default function OutlierPanel({
  open, day, scan, detail, soleCategory = false, seriesLabel, company, currency,
  index, count, onPrev, onNext, onClose,
}) {
  const { money0, signed } = useMoney()
  const driver = detail?.driver ?? null
  const movers = detail?.movers ?? []
  const against = detail?.against ?? []
  // A damping category is only worth naming if it was material against the spike.
  const offsets = against.filter((r) => Math.abs(r.excess) > Math.abs(detail?.total ?? 0) * 0.1)
  const up = (detail?.direction ?? 1) > 0

  return (
    <aside className={`outpanel ${open ? 'outpanel--open' : ''}`} aria-hidden={!open}>
      {day && scan && detail && (
        <>
          <header className="outpanel__head">
            <div className="outpanel__titles">
              <span className="outpanel__tag">
                <OutlierIcon size={12} />
                Outlier
              </span>
              <span className="outpanel__date">{longDate(day)}</span>
              <span className="outpanel__sub">{seriesLabel} · {company} · {currency}</span>
            </div>
            <div className="outpanel__headctl">
              {count > 1 && (
                <span className="outpanel__nav">
                  <button className="iconbtn outpanel__navbtn" title="Previous outlier" onClick={onPrev}>‹</button>
                  <span className="outpanel__navpos">{index + 1} of {count}</span>
                  <button className="iconbtn outpanel__navbtn" title="Next outlier" onClick={onNext}>›</button>
                </span>
              )}
              <button className="iconbtn" title="Close" onClick={onClose}>×</button>
            </div>
          </header>

          <div className="outpanel__total">
            <span className="outpanel__total-block">
              <span className="outpanel__total-label">Movement that day</span>
              <span className={`outpanel__total-val ${up ? 'is-pos' : 'is-neg'}`}>{signed(scan.value)}</span>
            </span>
            <span className="outpanel__total-block outpanel__total-block--alt">
              <span className="outpanel__total-label">Usual range</span>
              <span className="outpanel__total-range">
                {money0(scan.usualLo)} – {money0(scan.usualHi)}
              </span>
            </span>
          </div>

          <div className="outpanel__body">
            {soleCategory ? (
              /* Nothing sits beneath a single isolated category, so the finding is
                 the day — which is the thing a month column was hiding anyway. */
              <div className="outverdict outverdict--none">
                <span className="outverdict__label">Already one category</span>
                <p className="outverdict__why">
                  {movers.length ? `${movers[0].name} is` : 'This selection is'} the only category on the
                  chart, so there is nothing beneath it to attribute to. The finding is the day:
                  {' '}{signed(scan.value)} against a normal of {money0(scan.median)}, which the month
                  column it sits in gives no way of seeing. Clear the selection to see this day
                  attributed across every category on the grid.
                </p>
              </div>
            ) : driver ? (
              <div className="outverdict">
                <span className="outverdict__label">Materially caused by</span>
                <span className="outverdict__cat">
                  <span className="outverdict__swatch" style={driver.color ? { background: driver.color } : undefined} />
                  <span className="outverdict__name">{driver.name}</span>
                  <span className="outverdict__share">{pct(driver.share)}%</span>
                </span>
                <p className="outverdict__why">
                  {driver.name} moved {signed(driver.value)} on this day against a normal of{' '}
                  {money0(driver.normal)} — {signed(driver.excess)} more than it usually contributes, and{' '}
                  {pct(driver.share)}% of everything pushing the day {up ? 'up' : 'down'}.
                </p>
              </div>
            ) : (
              <div className="outverdict outverdict--none">
                <span className="outverdict__label">No single cause</span>
                <p className="outverdict__why">
                  {movers.length
                    ? `The excess is spread across ${movers.length} categories — the largest, ${movers[0].name}, carries only ${pct(movers[0].share)}% of it. This day is a coincidence of ordinary movements rather than one event.`
                    : 'Nothing in this grid’s categories accounts for the movement on this day.'}
                </p>
              </div>
            )}

            {!soleCategory && movers.length > 0 && (
              <>
                <div className="outpanel__colhead">
                  <span>Pushing the day {up ? 'up' : 'down'}</span>
                  <span>vs its normal</span>
                </div>
                {movers.map((r, i) => (
                  <div key={r.id} className={`outmover ${driver && r.id === driver.id ? 'outmover--driver' : ''}`}>
                    <div className="outmover__body">
                      <span className="outmover__rank">{i + 1}</span>
                      <span className="outmover__swatch" style={r.color ? { background: r.color } : undefined} />
                      <span className="outmover__name">{r.name}</span>
                      <span className="outmover__share">{pct(r.share)}%</span>
                      <span className="outmover__amts">
                        <span className="outmover__excess">{signed(r.excess)}</span>
                        <span className="outmover__normal">{money0(r.value)} vs {money0(r.normal)} normal</span>
                      </span>
                    </div>
                    <span
                      className="outmover__bar"
                      style={{ width: `${Math.max(2, pct(r.share))}%`, background: r.color || 'var(--outlier)' }}
                    />
                  </div>
                ))}
              </>
            )}

            {offsets.length > 0 && (
              <div className="outpanel__offsets">
                <span className="outpanel__offsets-label">Partly offset by</span>
                {offsets.map((r) => (
                  <span key={r.id} className="outpanel__offset">
                    <span className="outpanel__offset-swatch" style={r.color ? { background: r.color } : undefined} />
                    {r.name}
                    <strong>{signed(r.excess)}</strong>
                  </span>
                ))}
              </div>
            )}

            {/* The method, stated where the numbers are — an attribution nobody can
                interrogate is a number nobody should act on. */}
            <p className="outpanel__method">
              {scan.basis === 'events'
                ? `This series is flat on most days, so “usual” is no movement at all and the bar is half a typical event.`
                : `“Usual” is the median daily movement ± ${scan.z} robust deviations across the horizon.`}
              {!soleCategory && ' Each category is compared with its own median day, so a category that is reliably large contributes no excess when it behaves normally.'}
              {scan.recurring > 0 && ` ${scan.recurring} other large ${scan.recurring === 1 ? 'day was' : 'days were'} left unflagged as recurring structure — payroll, rent, tax runs.`}
            </p>
          </div>
        </>
      )}
    </aside>
  )
}
