import { useState } from 'react'
import { Callout } from '../../components/Callout'
import { TEAM_COLORS } from '../../components/teams'
import { errorMessage, type PlayerTeam } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

// Danh sách đội ở sảnh chờ; bấm đội khác để chuyển sang. Snapshot mới đến qua room:state.
export function TeamPicker({ teams, myTeam }: { teams: PlayerTeam[]; myTeam: number | null }) {
  const [error, setError] = useState<string | null>(null)

  const choose = async (team: number) => {
    if (team === myTeam) return
    setError(null)
    const response = await emitAck('player:choose_team', { team })
    if (!response.ok) setError(errorMessage(response.error))
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <ul aria-label="Chọn đội" className="flex flex-col gap-3">
        {teams.map((team) => {
          const color = TEAM_COLORS[team.index]
          const mine = team.index === myTeam
          return (
            <li key={team.index} className={`drop-hard ${color.hard}`}>
              <button
                type="button"
                aria-label={team.name}
                aria-pressed={mine}
                onClick={() => void choose(team.index)}
                className={`flex w-full flex-col items-start gap-1 clip-slant px-6 py-3 text-left ${color.face}`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-2xl font-black italic">{team.name}</span>
                  {mine && (
                    <span className="shrink-0 -skew-x-12 bg-pop-ink px-2 text-sm font-black text-pop-lime italic">
                      ĐỘI CỦA BẠN
                    </span>
                  )}
                </span>
                <span className="text-base font-semibold break-words">
                  {team.members.length > 0 ? team.members.join(', ') : 'Chưa có ai'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {error && <Callout tone="error">{error}</Callout>}
    </div>
  )
}
