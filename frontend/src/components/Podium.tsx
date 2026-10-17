import type { PodiumEntry } from './podiumEntries'

// Theo vị trí trong top 3: khối càng cao càng nổi.
const BLOCKS = [
  'h-40 bg-pop-lime text-pop-ink',
  'h-28 bg-pop-paper text-pop-ink',
  'h-20 bg-pop-red text-pop-paper',
]

export function Podium({ entries }: { entries: PodiumEntry[] }) {
  const top = entries.slice(0, 3)
  // Thứ tự hiển thị: hạng 2, hạng 1, hạng 3.
  const order = [1, 0, 2].filter((i) => i < top.length)
  return (
    <ol aria-label="Bục vinh quang" className="flex w-full items-end justify-center gap-4">
      {order.map((i) => (
        <li key={top[i].id} className="flex max-w-36 min-w-0 flex-1 flex-col items-center gap-1">
          <span className="max-w-full truncate text-2xl font-black italic">{top[i].name}</span>
          <span className="font-semibold text-neutral-300 tabular-nums">{top[i].score.toLocaleString('vi-VN')}</span>
          <div
            className={`flex w-full items-center justify-center clip-slant text-6xl font-black italic [--slant:12px] ${BLOCKS[i]}`}
          >
            {top[i].rank}
          </div>
        </li>
      ))}
    </ol>
  )
}
