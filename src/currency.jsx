import { createContext, useContext, useMemo } from 'react'

const CurrencyContext = createContext({ currency: 'GBP', locale: 'en-GB' })

export function CurrencyProvider({ currency, locale, children }) {
  const value = useMemo(() => ({ currency, locale }), [currency, locale])
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

// Formatters bound to the active tab's currency/locale.
export function useMoney() {
  const { currency, locale } = useContext(CurrencyContext)
  return useMemo(() => {
    const money0 = (v) =>
      Number(v || 0).toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
    const signed = (v) => {
      const n = Number(v) || 0
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
    const num0 = (v) => Math.round(Number(v) || 0).toLocaleString(locale)
    const dashNum = (v) => (Number(v) === 0 ? '–' : num0(v))
    return { money0, signed, compact, num0, dashNum, symbol, currency, locale }
  }, [currency, locale])
}
