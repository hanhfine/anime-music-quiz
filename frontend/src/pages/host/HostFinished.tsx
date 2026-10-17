import { Callout } from '../../components/Callout'
import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import { playerPodium } from '../../components/podiumEntries'
import { PopButton } from '../../components/PopButton'
import { PopChip } from '../../components/PopPanel'
import { TeamBoard } from '../../components/TeamBoard'
import { teamPodium } from '../../components/teams'
import type { HostSnapshot } from '../../lib/protocol'
import { useHostCommand } from './useHostCommand'

export function HostFinished({ snapshot, onClose }: { snapshot: HostSnapshot; onClose: () => void }) {
  const { run, error, busy } = useHostCommand()
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <PopChip as="h1" className="self-center text-5xl">
        Kết quả chung cuộc 🏆
      </PopChip>
      {snapshot.teams ? (
        <>
          <Podium entries={teamPodium(snapshot.teams)} />
          <TeamBoard teams={snapshot.teams} />
        </>
      ) : (
        <>
          <Podium entries={playerPodium(snapshot.leaderboard)} />
          <Leaderboard rows={snapshot.leaderboard} />
        </>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex justify-center gap-6">
        <PopButton size="lg" onClick={() => void run('host:play_again')} disabled={busy}>
          Chơi lại
        </PopButton>
        <PopButton variant="danger" size="lg" onClick={onClose}>
          Đóng phòng
        </PopButton>
      </div>
    </div>
  )
}
