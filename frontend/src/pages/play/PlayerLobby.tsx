import { CdDisc } from '../../components/CdDisc'
import { DelayBadge } from '../../components/DelayBadge'
import { PopChip } from '../../components/PopPanel'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerLobby({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  return (
    <section className="flex flex-col items-center gap-5 py-10 text-center">
      <PopChip as="p" className="text-xl">
        Bạn là
      </PopChip>
      <p className="max-w-full text-5xl font-black break-words text-pop-lime italic [text-shadow:4px_4px_0_var(--color-pop-red)]">
        {me.name}
      </p>
      <p className="flex items-center gap-3 text-2xl font-semibold">
        <CdDisc size="sm" />
        Chờ quản trò bắt đầu…
      </p>
      <p className="text-neutral-300">{playerCount} người trong phòng</p>
      {me.calibrated && (
        <p className="flex items-center gap-2 text-neutral-300">
          Độ trễ stream của bạn <DelayBadge delayMs={me.delayMs} calibrated />
        </p>
      )}
    </section>
  )
}
