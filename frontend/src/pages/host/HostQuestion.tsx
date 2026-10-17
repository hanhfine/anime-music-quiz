import { AnswerTile } from '../../components/AnswerTile'
import { Callout } from '../../components/Callout'
import { CdDisc } from '../../components/CdDisc'
import { Leaderboard } from '../../components/Leaderboard'
import { PopButton } from '../../components/PopButton'
import type { PopSize } from '../../components/popButtonClasses'
import { PopChip } from '../../components/PopPanel'
import { TeamBoard } from '../../components/TeamBoard'
import { remainingMs } from '../../lib/clock'
import { GRACE_MS, type HostRound, type HostSnapshot } from '../../lib/protocol'
import { useNow } from '../../lib/useNow'
import { useHostCommand } from './useHostCommand'

interface Props {
  snapshot: HostSnapshot
  round: HostRound
  offset: number
}

// Vị trí 4 ô quanh đĩa: A trên-trái, B trên-phải, C dưới-trái, D dưới-phải.
const CELLS = [
  'col-start-1 row-start-1',
  'col-start-3 row-start-1',
  'col-start-1 row-start-2',
  'col-start-3 row-start-2',
]

// Tâm đĩa trùng tâm viewport, ngay trên khung YouTube 320×180 mà HostScreen đặt giữa màn hình.
function Disc({ timer }: { timer?: { remainingMs: number; totalMs: number } }) {
  return (
    <div className="fixed top-1/2 left-1/2 z-20 size-(--disc) -translate-x-1/2 -translate-y-1/2">
      <CdDisc size="lg" className="size-full" {...timer} />
    </div>
  )
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

  const replayButton = (size: PopSize) => (
    <PopButton variant="secondary" size={size} onClick={replay} disabled={busy}>
      Phát lại câu này
    </PopButton>
  )
  const errorBox = error && <Callout tone="error">{error}</Callout>

  if (phase === 'PREPARING') {
    return (
      // --disc: biến CSS kế thừa theo cây DOM nên các phần tử fixed bên trong vẫn dùng được.
      <div className="[--disc:min(34vw,60vh)]">
        <PopChip as="p" className="fixed top-20 left-1/2 -translate-x-1/2 text-5xl">
          Câu {number}: chuẩn bị…
        </PopChip>
        <Disc />
        <div className="fixed inset-x-0 bottom-6 flex flex-col items-center gap-3 text-center">
          <p className="text-xl font-semibold text-neutral-300">
            Đang tải nhạc. Nếu chờ quá lâu, hãy bấm Phát lại câu này.
          </p>
          {errorBox}
          {replayButton('md')}
        </div>
      </div>
    )
  }

  if (reveal) {
    const { teams } = snapshot
    const picks = reveal.teamPicks ?? []
    // Chip các đội chốt ô i. Đội hòa hoặc không ai bỏ phiếu có option null nên không gắn lên ô nào.
    const teamMarks = (i: number) =>
      teams
        ? picks.filter((pick) => pick.option === i).map((pick) => ({ team: pick.team, name: teams[pick.team].name }))
        : undefined
    const tiedTeams = picks.filter((pick) => pick.tied).map((pick) => pick.team)
    return (
      // Cột cố định bên phải khung video (HostScreen đặt khung ở left-6 top-20, rộng 56vw), cao vừa màn hình:
      // bảng xếp hạng dài thì cuộn bên trong, nút "Câu tiếp" luôn nằm trong màn hình.
      // right-12 chừa chỗ cho ô đúng phóng to và nhãn "✓ Đúng" nhô ra.
      <div className="fixed top-20 right-12 bottom-6 left-[calc(58vw+3rem)] flex flex-col gap-4">
        <PopChip as="h1" className="text-3xl">
          Câu {number}
        </PopChip>
        <h2 className="text-5xl leading-none font-black text-pop-lime italic [text-shadow:4px_4px_0_var(--color-pop-red)] motion-safe:animate-slam">
          {reveal.animeName}
        </h2>
        {reveal.songLabel && (
          <PopChip as="p" className="text-lg">
            {reveal.songLabel}
          </PopChip>
        )}
        <div className={`grid text-xl ${teams ? 'gap-5' : 'gap-2'}`}>
          {round.options.map((label, i) => (
            <AnswerTile
              key={i}
              index={i}
              label={label}
              state={i === reveal.correctIndex ? 'correct' : 'dimmed'}
              count={reveal.optionCounts[i]}
              teamMarks={teamMarks(i)}
            />
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
          {teams ? (
            <TeamBoard teams={teams} tiedTeams={tiedTeams} />
          ) : (
            <Leaderboard rows={snapshot.leaderboard.slice(0, 10)} />
          )}
        </div>
        {errorBox}
        <div className="flex flex-wrap items-center gap-6">
          <PopButton size="lg" onClick={() => void run('host:next')} disabled={busy}>
            {round.index + 1 >= round.total ? 'Xem kết quả' : 'Câu tiếp →'}
          </PopButton>
          {replayButton('md')}
        </div>
      </div>
    )
  }

  return (
    <div className="[--disc:min(34vw,60vh)]">
      <div className="fixed inset-x-8 top-20 flex items-start justify-between gap-6">
        <PopChip as="h1" className="text-5xl">
          Câu {number}
        </PopChip>
        <PopChip as="p" tone="red" className="text-3xl">
          {round.answeredCount}/{round.onlineCount} {snapshot.teams ? 'đã bỏ phiếu' : 'đã trả lời'}
        </PopChip>
      </div>
      <Disc
        timer={
          round.deadline === null
            ? undefined
            : { remainingMs: remainingMs(round.deadline, offset, now), totalMs: settings.clipSec * 1000 + GRACE_MS }
        }
      />
      {/* Cột giữa để trống cho đĩa. */}
      <div className="fixed inset-x-8 top-1/2 grid h-(--disc) -translate-y-1/2 grid-cols-[1fr_var(--disc)_1fr] grid-rows-2 gap-x-[3vw] gap-y-6 text-3xl">
        {round.options.map((label, i) => (
          <div key={i} className={`flex ${CELLS[i]}`}>
            <AnswerTile index={i} label={label} />
          </div>
        ))}
      </div>
      <div className="fixed bottom-6 left-6 flex flex-col items-start gap-3">
        {errorBox}
        {replayButton('sm')}
      </div>
    </div>
  )
}
