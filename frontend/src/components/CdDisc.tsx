import type { CSSProperties } from 'react'

interface Props {
  remainingMs?: number
  totalMs?: number
  size: 'lg' | 'sm'
  spin?: boolean
  className?: string
}

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const URGENT_SECONDS = 5

// Nốt nhạc bay từ tâm ra quá mép đĩa; cqw tính theo bề rộng đĩa (gốc là @container).
const NOTES = [
  { glyph: '♪', dx: '-52cqw', dy: '-46cqw', rot: '-30deg', delay: '0s', color: 'text-pop-lime' },
  { glyph: '♫', dx: '54cqw', dy: '-42cqw', rot: '25deg', delay: '0.5s', color: 'text-pop-paper' },
  { glyph: '♬', dx: '-56cqw', dy: '38cqw', rot: '-15deg', delay: '1s', color: 'text-pop-red' },
  { glyph: '♩', dx: '6cqw', dy: '-62cqw', rot: '10deg', delay: '0.8s', color: 'text-pop-paper' },
  { glyph: '♪', dx: '52cqw', dy: '44cqw', rot: '40deg', delay: '1.5s', color: 'text-pop-lime' },
]

const BOLTS = [
  { position: '-left-[6%] top-[6%]', fill: 'fill-pop-lime', delay: '0.2s' },
  { position: '-right-[6%] bottom-[6%]', fill: 'fill-pop-paper', delay: '0.9s' },
]

const FX = 'pointer-events-none motion-reduce:hidden'

export function CdDisc({ remainingMs, totalMs = 0, size, spin = true, className = '' }: Props) {
  const timed = remainingMs !== undefined
  const seconds = timed ? Math.ceil(remainingMs / 1000) : 0
  const fraction = timed && totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0

  return (
    <div
      role={timed ? 'timer' : undefined}
      aria-label={timed ? `Còn ${seconds} giây` : undefined}
      aria-hidden={timed ? undefined : true}
      className={`@container relative aspect-square ${size === 'sm' ? 'size-16 shrink-0' : ''} ${className}`}
    >
      {/* Có số đếm ngược thì lấp lỗ tâm, không thì lỗ lộ ra giữa các chữ số. */}
      <div
        className={`absolute inset-[9%] disc-face ${spin ? 'motion-safe:animate-disc-spin' : ''} ${
          timed ? '[--disc-hub:var(--color-pop-red)]' : ''
        }`}
      />
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="6" className="stroke-neutral-800" />
        {timed && (
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth="6"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            className={`transition-[stroke-dashoffset] duration-200 ${
              seconds <= URGENT_SECONDS ? 'stroke-pop-red' : 'stroke-pop-lime'
            }`}
          />
        )}
      </svg>
      {size === 'lg' && (
        <>
          {NOTES.map((note, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`absolute top-1/2 left-1/2 text-[9cqw] leading-none opacity-0 [text-shadow:2px_2px_0_var(--color-pop-ink)] motion-safe:animate-note-fly ${note.color} ${FX}`}
              style={{ '--dx': note.dx, '--dy': note.dy, '--rot': note.rot, animationDelay: note.delay } as CSSProperties}
            >
              {note.glyph}
            </span>
          ))}
          {BOLTS.map((bolt, i) => (
            <svg
              key={i}
              viewBox="0 0 40 60"
              aria-hidden="true"
              className={`absolute w-[18%] opacity-0 motion-safe:animate-bolt-flash ${bolt.position} ${FX}`}
              style={{ animationDelay: bolt.delay }}
            >
              <polygon
                points="24,0 6,34 18,34 10,60 34,22 22,22 30,0"
                strokeWidth="3"
                strokeLinejoin="round"
                className={`stroke-pop-ink ${bolt.fill}`}
              />
            </svg>
          ))}
        </>
      )}
      {timed && (
        <span
          className={`absolute inset-0 flex items-center justify-center leading-none font-black italic [text-shadow:3px_3px_0_var(--color-pop-ink)] ${
            size === 'lg' ? 'text-[22cqw]' : 'text-xl'
          }`}
        >
          {seconds}
        </span>
      )}
    </div>
  )
}
