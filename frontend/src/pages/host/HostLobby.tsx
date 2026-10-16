import { QRCodeSVG } from 'qrcode.react'
import { DelayBadge } from '../../components/DelayBadge'
import type { HostPlayer, HostSnapshot } from '../../lib/protocol'
import { useHostCommand } from './useHostCommand'

export function HostLobby({ snapshot }: { snapshot: HostSnapshot }) {
  const { code, players, settings } = snapshot
  const { run, error, busy } = useHostCommand()
  const link = `${window.location.origin}/play/${code}`
  const onlineCount = players.filter((player) => player.online).length

  const kick = (player: HostPlayer) => {
    if (window.confirm(`Mời ${player.name} ra khỏi phòng?`)) void run('host:kick', { playerId: player.id })
  }

  return (
    <div className="grid gap-8 p-8 lg:grid-cols-[auto_1fr]">
      <section className="flex flex-col items-center gap-4 rounded-3xl bg-slate-900 p-8">
        <p className="text-xl text-slate-400">Mã phòng</p>
        <p data-testid="room-code" className="font-mono text-7xl font-black tracking-[0.2em]">
          {code}
        </p>
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG value={link} size={200} title="Mã QR vào phòng" />
        </div>
        <p className="text-lg text-sky-300">{link}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-bold">
          Người chơi ({players.length}/{settings.maxPlayers})
        </h2>
        {players.length === 0 ? (
          <p className="text-xl text-slate-400">Chưa có ai vào phòng. Gửi mã hoặc link cho người chơi nhé!</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {players.map((player) => (
              <li
                key={player.id}
                data-online={player.online}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-xl data-[online=false]:opacity-40"
              >
                <span className="flex-1 truncate">{player.name}</span>
                <DelayBadge delayMs={player.delayMs} calibrated={player.calibrated} />
                <button
                  type="button"
                  onClick={() => kick(player)}
                  aria-label={`Mời ${player.name} ra khỏi phòng`}
                  className="px-1 text-slate-400 hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-lg text-slate-400">
          {settings.questionCount} câu · nhạc {settings.clipSec} giây · công bố {settings.revealSec} giây
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => void run('host:calibrate')}
            disabled={busy || onlineCount === 0}
            className="rounded-xl bg-amber-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
          >
            Đo độ trễ
          </button>
          <button
            type="button"
            onClick={() => void run('host:start')}
            disabled={busy || players.length === 0}
            className="rounded-xl bg-emerald-600 px-8 py-3 text-2xl font-bold disabled:opacity-40"
          >
            Bắt đầu
          </button>
        </div>
        <p className="text-slate-400">
          Đo độ trễ: người chơi bấm nút trên máy khi thấy BẤM! trên stream, để điểm tốc độ công bằng với mọi người.
        </p>
      </section>
    </div>
  )
}
