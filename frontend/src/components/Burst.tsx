// Hình nổ răng cưa 12 cánh: 24 đỉnh xen kẽ bán kính 50 và 34 quanh tâm (50, 50).
const POINTS = Array.from({ length: 24 }, (_, i) => {
  const angle = (Math.PI * i) / 12 - Math.PI / 2
  const radius = i % 2 === 0 ? 50 : 34
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(50 + radius * Math.sin(angle)).toFixed(1)}`
}).join(' ')

export function Burst({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <polygon points={POINTS} />
    </svg>
  )
}
