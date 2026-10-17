import { byRank, TEAM_COLORS, type TeamRow } from './teams'

interface Props {
  teams: TeamRow[]
  tiedTeams?: number[] // chỉ số các đội hòa phiếu ở câu vừa công bố
  highlight?: number | null // chỉ số đội của người xem
}

// Cùng kiểu với Leaderboard. Hàng của mình tô xám thay vì đỏ, để vạch màu Đội Đỏ không chìm vào nền.
export function TeamBoard({ teams, tiedTeams = [], highlight = null }: Props) {
  return (
    <ol aria-label="Bảng xếp hạng đội" className="flex flex-col gap-1.5">
      {byRank(teams).map((team) => (
        <li
          key={team.index}
          data-me={team.index === highlight}
          className="flex items-center gap-3 clip-slant bg-neutral-900 py-1.5 pr-6 pl-3 [--slant:10px] data-[me=true]:bg-neutral-700"
        >
          <span className={`w-10 text-right text-2xl font-black italic ${team.rank === 1 ? 'text-pop-lime' : ''}`}>
            {team.rank}
          </span>
          <span aria-hidden="true" className={`h-6 w-3 shrink-0 -skew-x-12 ${TEAM_COLORS[team.index].swatch}`} />
          <span className="flex-1 truncate font-semibold">{team.name}</span>
          {tiedTeams.includes(team.index) ? (
            <span className="-skew-x-12 bg-pop-red px-2 font-black text-pop-paper italic">HÒA</span>
          ) : (
            team.gained !== null &&
            team.gained > 0 && (
              <span className="-skew-x-12 bg-pop-lime px-2 font-black text-pop-ink italic">+{team.gained}</span>
            )
          )}
          <span className="w-20 text-right font-semibold tabular-nums">{team.score.toLocaleString('vi-VN')}</span>
        </li>
      ))}
    </ol>
  )
}
