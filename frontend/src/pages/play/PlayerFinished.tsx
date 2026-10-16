import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerFinished({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  const rows = snapshot.leaderboardTop ?? []
  return (
    <section className="flex flex-col gap-6 text-center">
      <h1 className="text-3xl font-black">Kết thúc! 🏁</h1>
      <div>
        <p className="text-5xl font-black">
          Hạng {me.rank}/{playerCount}
        </p>
        <p className="text-xl text-slate-300">{me.score.toLocaleString('vi-VN')} điểm</p>
      </div>
      <Podium rows={rows} />
      <Leaderboard rows={rows} highlightId={me.id} />
      <p className="text-slate-400">Chờ quản trò chơi lại hoặc đóng phòng…</p>
    </section>
  )
}
