import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import type { HostSnapshot } from '../../lib/protocol'
import { useHostCommand } from './useHostCommand'

export function HostFinished({ snapshot, onClose }: { snapshot: HostSnapshot; onClose: () => void }) {
  const { run, error, busy } = useHostCommand()
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <h1 className="text-center text-5xl font-black">Kết quả chung cuộc 🏆</h1>
      <Podium rows={snapshot.leaderboard} />
      <Leaderboard rows={snapshot.leaderboard} />
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() => void run('host:play_again')}
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
        >
          Chơi lại
        </button>
        <button type="button" onClick={onClose} className="rounded-xl bg-red-700 px-6 py-3 text-2xl font-bold">
          Đóng phòng
        </button>
      </div>
    </div>
  )
}
