import { createContext, useContext, useMemo } from 'react'

const CurrencyContext = createContext({ currency: 'GBP', locale: 'en-GB', multiplier: 'base' })

// multiplier: 'base' (whole units) or 'k' (thousands, one decimal) — grid figures only
export function CurrencyProvider({ currency, locale, multiplier = 'base', children }) {
  const value = useMemo(() => ({ currency, locale, multiplier }), [currency, locale, multiplier])
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

// Formatters bound to the active tab's currency/locale.
export function useMoney() {
  const { currency, locale, multiplier } = useContext(CurrencyContext)
  return useMemo(() => {
    // A zero-balancing account nets to zero only to within float precision, so
    // snap anything under half a unit to a clean 0 — otherwise the residue shows
    // up as "-0" once the fractional digits are dropped.
    const snap = (v) => {
      const n = Number(v) || 0
      return Math.abs(n) < 0.5 ? 0 : n
    }
    const money0 = (v) =>
      snap(v).toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
    const signed = (v) => {
      const n = snap(v)
      return n > 0 ? `+${money0(n)}` : money0(n)
    }
    // currency symbol only (strip digits/spaces/separators from a formatted 0)
    const symbol = (0).toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).replace(/[\d.,\s ]/g, '')
    const compact = (v) => {
      const a = Math.abs(v)
      if (a >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}m`
      if (a >= 1_000) return `${symbol}${Math.round(v / 1000)}k`
      return `${symbol}${Math.round(v)}`
    }
    // plain grouped number (no currency symbol) — grid style; currency shown by the tab
    const num0 = multiplier === 'k'
      ? (v) => {
          const n = Math.round((Number(v) || 0) / 100) / 10
          return (n === 0 ? 0 : n).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        }
      : (v) => Math.round(Number(v) || 0).toLocaleString(locale)
    const dashNum = (v) => (Number(v) === 0 ? '–' : num0(v))
    return { money0, signed, compact, num0, dashNum, symbol, currency, locale, multiplier }
  }, [currency, locale, multiplier])
}
