// Bottom sheet that rises over the table with details of the model behind a
// category. Opened from the right-hand side of the category capsule.
export default function ModelPanel({ row, detail, closing, topOffset = 0, onClose }) {
  if (!row || !detail) return null
  const catCls = detail.manual
    ? 'modelpanel__cat--manual'
    : detail.category === 'Statistical'
      ? 'tag--stat'
      : detail.category === 'ML/AI'
        ? 'tag--ml'
        : 'tag--rnd'

  return (
    <div
      className={`modelpanel ${closing ? 'modelpanel--closing' : ''}`}
      /* capped so the tray can never ride up over the chart */
      style={{ maxHeight: topOffset ? `calc(100% - ${topOffset}px)` : undefined }}
      role="dialog"
      aria-label={`${detail.name} model details`}
    >
      {/* Close sits top-left — nearest the capsule that opens the tray, so the
          pointer barely travels between opening and dismissing it. */}
      <header className="modelpanel__head">
        <button className="modelpanel__close" onClick={onClose} title="Close model details (Esc)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          Close
        </button>
        <span className="modelpanel__title">
          <span className="modelpanel__dot" style={{ background: row.color }} />
          <span className="modelpanel__cat">{row.name}</span>
          <span className="modelpanel__sep">·</span>
          <span className={`modelpanel__model ${catCls}`}>{detail.name}</span>
          {!detail.manual && <span className={`tag ${catCls}`}>{detail.category}</span>}
        </span>
      </header>

      <div className="modelpanel__body">
        <p className="modelpanel__blurb">{detail.blurb}</p>

        {detail.stats.length > 0 && (
          <div className="modelpanel__stats">
            {detail.stats.map((s) => (
              <div className="mstat" key={s.label} data-tip={s.hint}>
                <span className="mstat__label">{s.label}</span>
                <span className="mstat__value">{s.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="modelpanel__meta">
          {!detail.manual && (
            <>
              <Meta label="Retrained" value={detail.retrain} />
              <Meta label="Trained on" value={detail.trainedOn} />
            </>
          )}
          <Meta label="Owner" value={detail.owner} />
        </div>

        {detail.drivers.length > 0 && (
          <div className="modelpanel__drivers">
            <span className="modelpanel__sublabel">Inputs</span>
            <span className="modelpanel__driverlist">
              {detail.drivers.map((d) => (
                <span className="driver" key={d}>{d}</span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Meta({ label, value }) {
  return (
    <span className="mmeta">
      <span className="mmeta__label">{label}</span>
      <span className="mmeta__value">{value}</span>
    </span>
  )
}
