// A small category pill mirroring the model catalogue: Statistical / Custom R&D / ML/AI.
export default function CategoryTag({ category, className = '' }) {
  const cls = category === 'Statistical' ? 'tag--stat' : category === 'ML/AI' ? 'tag--ml' : 'tag--rnd'
  return <span className={`tag ${cls} ${className}`}>{category}</span>
}
