import type { LeaderboardRow } from '../lib/protocol'

interface Props {
  rows: LeaderboardRow[]
  highlightId?: string
}

export function Leaderboard({ rows, highlightId }: Props) {
  if (rows.length === 0) return <p className="text-slate-400">Chưa có người chơi</p>
  return (
    <ol className="space-y-1">
      {rows.map((row) => (
        <li
          key={row.playerId}
          data-me={row.playerId === highlightId}
          className="flex items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 data-[me=true]:bg-sky-800"
        >
          <span className="w-8 text-right font-bold text-slate-300">{row.rank}</span>
          <span className="flex-1 truncate">{row.name}</span>
          {row.gained !== null && row.gained > 0 && <span className="text-emerald-400">+{row.gained}</span>}
          <span className="w-20 text-right font-mono">{row.score.toLocaleString('vi-VN')}</span>
        </li>
      ))}
    </ol>
  )
}
