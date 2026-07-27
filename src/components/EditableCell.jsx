import { useEffect, useRef, useState } from 'react'
import { useMoney } from '../currency.jsx'

// A number cell that shows formatted currency when idle and a raw editable
// value when focused. Commits on blur / Enter, cancels on Escape.
export default function EditableCell({ value, onChange, align = 'right', className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const { dashNum } = useMoney()

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const start = () => {
    setDraft(String(value ?? 0))
    setEditing(true)
  }

  const commit = () => {
    const parsed = parseNumber(draft)
    setEditing(false)
    if (parsed !== null && parsed !== Number(value)) onChange(parsed)
  }

  const cancel = () => setEditing(false)

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`cell cell--input ${className}`}
        style={{ textAlign: align }}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
        }}
      />
    )
  }

  return (
    <div
      className={`cell cell--display ${className}`}
      style={{ textAlign: align }}
      tabIndex={0}
      role="button"
      onClick={start}
      onFocus={start}
    >
      {dashNum(value)}
    </div>
  )
}

function parseNumber(raw) {
  if (raw == null) return null
  const cleaned = String(raw).replace(/[^\d.-]/g, '') // keep digits, minus, dot
  if (cleaned === '' || cleaned === '-') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
