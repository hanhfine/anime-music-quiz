import type { LeaderboardRow } from '../lib/protocol'

interface Props {
  rows: LeaderboardRow[]
  highlightId?: string
}

export function Leaderboard({ rows, highlightId }: Props) {
  if (rows.length === 0) return <p className="text-neutral-400">Chưa có người chơi</p>
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li
          key={row.playerId}
          data-me={row.playerId === highlightId}
          className="flex items-center gap-3 clip-slant bg-neutral-900 py-1.5 pr-6 pl-3 [--slant:10px] data-[me=true]:bg-pop-red"
        >
          <span className={`w-10 text-right text-2xl font-black italic ${row.rank === 1 ? 'text-pop-lime' : ''}`}>
            {row.rank}
          </span>
          <span className="flex-1 truncate font-semibold">{row.name}</span>
          {row.gained !== null && row.gained > 0 && (
            <span className="-skew-x-12 bg-pop-lime px-2 font-black text-pop-ink italic">+{row.gained}</span>
          )}
          <span className="w-20 text-right font-semibold tabular-nums">{row.score.toLocaleString('vi-VN')}</span>
        </li>
      ))}
    </ol>
  )
}
