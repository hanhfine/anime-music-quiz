import { QRCodeSVG } from 'qrcode.react'
import { Callout } from '../../components/Callout'
import { PopButton } from '../../components/PopButton'
import { PopChip, PopPanel } from '../../components/PopPanel'
import type { HostPlayer, HostSnapshot } from '../../lib/protocol'
import { TeamColumns, TeamModeBar } from './HostTeams'
import { LobbyPlayer } from './LobbyPlayer'
import { useHostCommand } from './useHostCommand'

export function HostLobby({ snapshot }: { snapshot: HostSnapshot }) {
  const { code, players, settings, teams } = snapshot
  const { run, error, busy } = useHostCommand()
  const link = `${window.location.origin}/play/${code}`
  const onlineCount = players.filter((player) => player.online).length
  const emptyTeam = teams?.some((team) => team.memberIds.length === 0) ?? false

  const kick = (player: HostPlayer) => {
    if (window.confirm(`Mời ${player.name} ra khỏi phòng?`)) void run('host:kick', { playerId: player.id })
  }

  return (
    <div className="grid gap-10 p-8 lg:grid-cols-[auto_1fr]">
      <PopPanel className="self-start">
        <div className="flex flex-col items-center gap-4">
          <PopChip as="p" className="text-2xl">
            Mã phòng
          </PopChip>
          <p data-testid="room-code" className="text-8xl font-black tracking-[0.15em] italic tabular-nums">
            {code}
          </p>
          <div className="bg-white p-4">
            <QRCodeSVG value={link} size={200} title="Mã QR vào phòng" />
          </div>
          <p className="text-lg font-semibold text-pop-lime">{link}</p>
        </div>
      </PopPanel>

      <section className="flex flex-col gap-5">
        <PopChip as="h2" className="text-4xl">
          Người chơi ({players.length}/{settings.maxPlayers})
        </PopChip>
        <TeamModeBar teams={teams} run={run} busy={busy} />
        {teams ? (
          <TeamColumns teams={teams} players={players} run={run} busy={busy} onKick={kick} />
        ) : players.length === 0 ? (
          <p className="text-xl text-neutral-400">Chưa có ai vào phòng. Gửi mã hoặc link cho người chơi nhé!</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {players.map((player) => (
              <LobbyPlayer key={player.id} player={player} onKick={kick} />
            ))}
          </ul>
        )}

        <p className="text-lg text-neutral-400">
          {settings.questionCount} câu · nhạc {settings.clipSec} giây · công bố {settings.revealSec} giây
        </p>
        {emptyTeam && <p className="font-semibold text-pop-red">Còn đội chưa có người</p>}
        {error && <Callout tone="error">{error}</Callout>}
        <div className="flex flex-wrap gap-6">
          <PopButton
            variant="secondary"
            size="lg"
            onClick={() => void run('host:calibrate')}
            disabled={busy || onlineCount === 0}
          >
            Đo độ trễ
          </PopButton>
          <PopButton
            size="lg"
            onClick={() => void run('host:start')}
            disabled={busy || players.length === 0 || emptyTeam}
          >
            Bắt đầu
          </PopButton>
        </div>
        <p className="text-neutral-400">
          Đo độ trễ: người chơi bấm nút trên máy khi thấy BẤM! trên stream, để điểm tốc độ công bằng với mọi người.
        </p>
      </section>
    </div>
  )
}
