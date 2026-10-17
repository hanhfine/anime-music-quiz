import type { ReactNode } from 'react'
import { DelayBadge } from '../../components/DelayBadge'
import type { HostPlayer } from '../../lib/protocol'

interface Props {
  player: HostPlayer
  onKick: (player: HostPlayer) => void
  children?: ReactNode // nút chuyển đội, đặt trước nút kick
}

// Thẻ người chơi ở sảnh chờ, dùng cho cả danh sách thường lẫn cột đội.
export function LobbyPlayer({ player, onKick, children }: Props) {
  return (
    <li
      data-online={player.online}
      className="clip-slant bg-pop-paper p-[2px] [--slant:10px] data-[online=false]:opacity-40"
    >
      <div className="flex items-center gap-2 clip-slant bg-neutral-950 px-5 py-2 text-xl font-semibold">
        <span className="flex-1 truncate">{player.name}</span>
        <DelayBadge delayMs={player.delayMs} calibrated={player.calibrated} />
        {children}
        <button
          type="button"
          onClick={() => onKick(player)}
          aria-label={`Mời ${player.name} ra khỏi phòng`}
          className="px-1 text-neutral-400 hover:text-pop-red"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
