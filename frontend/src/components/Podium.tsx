import type { LeaderboardRow } from '../lib/protocol'

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const HEIGHTS = ['h-40', 'h-28', 'h-20']

export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.slice(0, 3)
  // Thứ tự hiển thị: hạng 2, hạng 1, hạng 3.
  const order = [1, 0, 2].filter((i) => i < top.length)
  return (
    <ol className="flex items-end justify-center gap-4">
      {order.map((i) => (
        <li key={top[i].playerId} className="flex w-36 flex-col items-center gap-2">
          <span className="text-4xl">{MEDALS[top[i].rank] ?? ''}</span>
          <span className="max-w-full truncate text-xl font-bold">{top[i].name}</span>
          <span className="font-mono text-slate-300">{top[i].score.toLocaleString('vi-VN')}</span>
          <div className={`w-full rounded-t-xl bg-sky-700 ${HEIGHTS[i]}`} />
        </li>
      ))}
    </ol>
  )
}
