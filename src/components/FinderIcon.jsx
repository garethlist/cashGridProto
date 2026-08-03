// A crosshair/target reticle used by the "low point finder" — the clickable
// icon in the Lowest-point KPI and the matching badge on the pinned tooltip,
// so both ends of that journey read as the same gesture.
export default function FinderIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="6.4" />
      <path d="M12 2.4v3.1M12 18.5v3.1M2.4 12h3.1M18.5 12h3.1" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  )
}
