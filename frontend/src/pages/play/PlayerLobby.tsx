import { DelayBadge } from '../../components/DelayBadge'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerLobby({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  return (
    <section className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-lg text-slate-400">Bạn là</p>
      <p className="text-4xl font-black">{me.name}</p>
      <p className="text-2xl">Chờ quản trò bắt đầu…</p>
      <p className="text-slate-300">{playerCount} người trong phòng</p>
      {me.calibrated && (
        <p className="flex items-center gap-2 text-slate-300">
          Độ trễ stream của bạn <DelayBadge delayMs={me.delayMs} calibrated />
        </p>
      )}
    </section>
  )
}
