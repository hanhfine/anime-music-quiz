import { AnswerTile } from '../../components/AnswerTile'
import { CdDisc } from '../../components/CdDisc'
import { Leaderboard } from '../../components/Leaderboard'
import { remainingMs } from '../../lib/clock'
import { GRACE_MS, type HostRound, type HostSnapshot } from '../../lib/protocol'
import { useNow } from '../../lib/useNow'
import { useHostCommand } from './useHostCommand'

interface Props {
  snapshot: HostSnapshot
  round: HostRound
  offset: number
}

export function HostQuestion({ snapshot, round, offset }: Props) {
  const { phase, settings } = snapshot
  const now = useNow(200, phase === 'ANSWERING')
  const { run, error, busy } = useHostCommand()
  const number = `${round.index + 1}/${round.total}`
  const reveal = phase === 'REVEAL' ? round.reveal : null

  const replay = () => {
    if (window.confirm('Phát lại câu này? Câu trả lời của câu này sẽ bị hủy.')) void run('host:replay_round')
  }

  const actions = (
    <>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {reveal && (
          <button
            type="button"
            onClick={() => void run('host:next')}
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
          >
            {round.index + 1 >= round.total ? 'Xem kết quả' : 'Câu tiếp →'}
          </button>
        )}
        <button
          type="button"
          onClick={replay}
          disabled={busy}
          className="rounded-xl bg-slate-700 px-4 py-3 text-lg disabled:opacity-40"
        >
          Phát lại câu này
        </button>
      </div>
    </>
  )

  if (phase === 'PREPARING') {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-6 text-center">
        <p className="text-5xl font-bold">Câu {number}: chuẩn bị…</p>
        <p className="text-xl text-slate-400">Đang tải nhạc. Nếu chờ quá lâu, hãy bấm Phát lại câu này.</p>
        {actions}
      </div>
    )
  }

  if (reveal) {
    return (
      // 58vw bên trái để trống cho khung video (HostScreen đặt khung video cố định ở đó).
      <div className="grid grid-cols-[58vw_1fr] gap-6 p-6">
        <div aria-hidden="true" />
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl text-slate-400">Câu {number}</h1>
          <h2 className="text-4xl font-black text-emerald-300">{reveal.animeName}</h2>
          {reveal.songLabel && <p className="text-xl text-slate-300">{reveal.songLabel}</p>}
          <div className="grid gap-2">
            {round.options.map((label, i) => (
              <AnswerTile
                key={i}
                index={i}
                label={label}
                state={i === reveal.correctIndex ? 'correct' : 'dimmed'}
                count={reveal.optionCounts[i]}
              />
            ))}
          </div>
          <Leaderboard rows={snapshot.leaderboard.slice(0, 10)} />
          {actions}
        </div>
      </div>
    )
  }

  return (
    // pb-56: chừa chỗ cho khung nhạc nhỏ (đã bị che) ở góc phải dưới.
    <div className="flex flex-col gap-6 p-8 pb-56">
      <div className="flex items-center justify-between gap-6">
        <h1 className="text-4xl font-black">Câu {number}</h1>
        {round.deadline !== null && (
          <CdDisc
            size="sm"
            remainingMs={remainingMs(round.deadline, offset, now)}
            totalMs={settings.clipSec * 1000 + GRACE_MS}
          />
        )}
        <p className="text-3xl">
          {round.answeredCount}/{round.onlineCount} đã trả lời
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {round.options.map((label, i) => (
          <AnswerTile key={i} index={i} label={label} />
        ))}
      </div>
      {actions}
    </div>
  )
}
