// A single tall spike breaking out of a flat run — the shape of the thing outlier
// mode looks for. Deliberately unlike ShockIcon's symmetric pulse: a shock is
// something you apply, an outlier is something the forecast already contains.
export default function OutlierIcon({ size = 13 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 17h4l2-3 2 3h1l2-12 2 12h3l2-3h2" />
    </svg>
  )
}
