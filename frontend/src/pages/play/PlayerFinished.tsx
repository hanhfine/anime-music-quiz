import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import { playerPodium } from '../../components/podiumEntries'
import { PopChip } from '../../components/PopPanel'
import { TeamBoard } from '../../components/TeamBoard'
import { teamPodium } from '../../components/teams'
import type { PlayerSnapshot } from '../../lib/protocol'
import { myTeam } from './myTeam'

export function PlayerFinished({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount, teams } = snapshot
  const team = myTeam(snapshot)
  const rows = snapshot.leaderboardTop ?? []
  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <PopChip as="h1" className="text-4xl">
        Kết thúc! 🏁
      </PopChip>
      {teams && team ? (
        <>
          <div className="max-w-full">
            <p className="text-5xl font-black break-words italic">
              {team.name} · Hạng {team.rank}/{teams.length}
            </p>
            <p className="text-xl font-semibold text-neutral-300">{team.score.toLocaleString('vi-VN')} điểm</p>
          </div>
          <Podium entries={teamPodium(teams)} />
          <div className="w-full text-left">
            <TeamBoard teams={teams} highlight={team.index} />
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="text-6xl font-black italic">
              Hạng {me.rank}/{playerCount}
            </p>
            <p className="text-xl font-semibold text-neutral-300">{me.score.toLocaleString('vi-VN')} điểm</p>
          </div>
          <Podium entries={playerPodium(rows)} />
          <div className="w-full text-left">
            <Leaderboard rows={rows} highlightId={me.id} />
          </div>
        </>
      )}
      <p className="text-neutral-400">Chờ quản trò chơi lại hoặc đóng phòng…</p>
    </section>
  )
}
