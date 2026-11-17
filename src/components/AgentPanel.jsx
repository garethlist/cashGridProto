import { useEffect, useRef, useState } from 'react'
import { CCY_LOCALE } from '../views.js'
import { dayLabel } from '../model.js'
import { SUGGESTED_PROMPT } from '../agent.js'
import '../agent.css'

export function AgentIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5 13.8 9a1.5 1.5 0 0 0 1 1l5.2 1.7-5.2 1.7a1.5 1.5 0 0 0-1 1L12 20l-1.8-5.6a1.5 1.5 0 0 0-1-1L4 11.7 9.2 10a1.5 1.5 0 0 0 1-1Z" />
      <path d="M19 3v3M17.5 4.5h3" />
    </svg>
  )
}

const fmt = (amount, ccy) => {
  try {
    return new Intl.NumberFormat(CCY_LOCALE[ccy] ?? 'en-GB', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(amount)
  } catch (e) {
    return `${ccy} ${Math.round(amount).toLocaleString()}`
  }
}

// Right-hand agent dock: a short conversation where answers can be clicked
// through to the grid cell that holds them.
export default function AgentPanel({ open, gridTitle, messages, busy, activeKey, onSend, onFollow, onClose }) {
  const [draft, setDraft] = useState('')
  const bodyRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [open])

  const send = (text) => {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setDraft('')
  }

  return (
    <aside className={`agentpanel ${open ? 'agentpanel--open' : ''}`} aria-hidden={!open} aria-label="Agent">
      <header className="agentpanel__head">
        <span className="agentpanel__title">
          <span className="agentpanel__mark"><AgentIcon size={15} /></span>
          Agent
          <span className="agentpanel__scope">{gridTitle}</span>
        </span>
        <button className="gclosebtn balpanel__close" title="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          Close
        </button>
      </header>

      <div className="agentpanel__body" ref={bodyRef}>
        {!messages.length && (
          <div className="agentpanel__empty">
            <p className="agentpanel__hello">Ask about this forecast. Answers link straight to the cells behind them.</p>
            <button className="agentchip" onClick={() => send(SUGGESTED_PROMPT)}>
              <AgentIcon size={13} />
              {SUGGESTED_PROMPT}
            </button>
          </div>
        )}
        {messages.map((m, mi) => (
          <div key={mi} className={`agentmsg agentmsg--${m.role}`}>
            {m.text && <p className="agentmsg__text">{m.text}</p>}
            {m.results && (
              <ol className="agentres">
                {m.results.map((r, i) => (
                  <li key={r.key}>
                    <button
                      className={`agentres__item ${activeKey === r.key ? 'agentres__item--on' : ''}`}
                      onClick={() => onFollow(m.results, i)}
                      title={`Open ${r.id} in ${r.gridTitle} · ${r.rowName} · ${r.bucketLabel}`}
                    >
                      <span className="agentres__rank">{i + 1}</span>
                      <span className="agentres__main">
                        <span className="agentres__line">
                          <span className="agentres__id">{r.id}</span>
                          <span className="agentres__party">{r.party}</span>
                        </span>
                        <span className="agentres__where">
                          <span className="agentres__dot" style={r.rowColor ? { background: r.rowColor } : undefined} />
                          {r.gridTitle} · {r.rowName} · {dayLabel(r.date)}
                        </span>
                      </span>
                      <span className={`agentres__amt agentres__amt--${r.section === 'inflows' ? 'in' : 'out'}`}>
                        {r.section === 'outflows' ? '−' : '+'}{fmt(r.amount, r.currency)}
                      </span>
                      <svg className="agentres__go" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {m.note && <p className="agentmsg__note">{m.note}</p>}
            {m.suggest && (
              <button className="agentchip" onClick={() => send(SUGGESTED_PROMPT)}>
                <AgentIcon size={13} />
                {SUGGESTED_PROMPT}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="agentmsg agentmsg--agent agentmsg--busy" aria-live="polite">
            <span className="agentdots"><i /><i /><i /></span>
            Searching the invoice register…
          </div>
        )}
      </div>

      <form className="agentpanel__compose" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <input
          ref={inputRef}
          className="agentpanel__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the agent…"
          aria-label="Message the agent"
        />
        <button className="agentpanel__send" type="submit" disabled={!draft.trim() || busy} aria-label="Send">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
    </aside>
  )
}

// The bar across the top while you're following an agent answer: which result
// you're on, step through the rest, or go back to where you asked from.
export function AgentTrailBar({ trail, onStep, onBack, onDismiss }) {
  if (!trail) return null
  const r = trail.results[trail.index]
  const n = trail.results.length
  return (
    <div className="agenttrail" role="region" aria-label="Agent result">
      <span className="agenttrail__mark"><AgentIcon size={14} /></span>
      <span className="agenttrail__label">Agent result {trail.index + 1} of {n}</span>
      <span className="agenttrail__what">
        <span className="agenttrail__id">{r.id}</span>
        <span className="agenttrail__party">{r.party}</span>
        <span className="agenttrail__amt">{fmt(r.amount, r.currency)}</span>
      </span>
      <span className="agenttrail__step">
        <button className="agenttrail__btn" onClick={() => onStep(-1)} disabled={trail.index === 0} aria-label="Previous result">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3.5 5.5 8 10 12.5" /></svg>
        </button>
        <button className="agenttrail__btn" onClick={() => onStep(1)} disabled={trail.index === n - 1} aria-label="Next result">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>
        </button>
      </span>
      <button className="agenttrail__back" onClick={onBack}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        Back to {trail.ctx.title}
      </button>
      <button className="agenttrail__x" onClick={onDismiss} aria-label="Stay here and close the agent bar" title="Stay here">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
