import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import { playerPodium } from '../../components/podiumEntries'
import { PopChip } from '../../components/PopPanel'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerFinished({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  const rows = snapshot.leaderboardTop ?? []
  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <PopChip as="h1" className="text-4xl">
        Kết thúc! 🏁
      </PopChip>
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
      <p className="text-neutral-400">Chờ quản trò chơi lại hoặc đóng phòng…</p>
    </section>
  )
}
