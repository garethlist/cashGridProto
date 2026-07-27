// A spike/pulse icon for manual shocks — deliberately distinct from the
// lightning bolt used to denote modelled categories.
export default function ShockIcon({ size = 12 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 14h5l3-10 4 18 3-10h5" />
    </svg>
  )
}
