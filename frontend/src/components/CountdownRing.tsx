interface Props {
  remainingMs: number
  totalMs: number
  size?: number
}

const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function CountdownRing({ remainingMs, totalMs, size = 112 }: Props) {
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0
  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div role="timer" aria-label={`Còn ${seconds} giây`} className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="8" className="stroke-slate-700" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          className="stroke-sky-400 transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-4xl font-black">{seconds}</span>
    </div>
  )
}
