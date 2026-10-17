import { useState } from 'react'
import { AnswerTile } from '../../components/AnswerTile'
import { Burst } from '../../components/Burst'
import { Callout } from '../../components/Callout'
import { CdDisc } from '../../components/CdDisc'
import { PopChip } from '../../components/PopPanel'
import { votesTied } from '../../components/teams'
import { TILES, type TileState } from '../../components/tiles'
import { remainingMs } from '../../lib/clock'
import {
  errorMessage,
  type PlayerResult,
  type PlayerRound,
  type PlayerSnapshot,
  type PlayerTeam,
} from '../../lib/protocol'
import { emitAck } from '../../lib/socket'
import { useNow } from '../../lib/useNow'

function Title({ round }: { round: PlayerRound }) {
  return (
    <PopChip as="h1" className="text-3xl">
      Câu {round.index + 1}/{round.total}
    </PopChip>
  )
}

export function PlayerPreparing({ round }: { round: PlayerRound }) {
  return (
    <section className="flex flex-col items-center gap-8 py-16">
      <PopChip as="p" className="text-3xl">
        Câu {round.index + 1}/{round.total}: chuẩn bị nghe…
      </PopChip>
      <CdDisc size="sm" />
    </section>
  )
}

// Mount với key={`${round.index}:${round.deadline}`}: phát lại câu tạo deadline mới nên lựa chọn cũ bị xóa.
// Chế độ đội (team khác null): ô là phiếu bầu, bấm ô khác để đổi phiếu tới hết giờ.
export function PlayerAnswering({
  round,
  offset,
  team = null,
}: {
  round: PlayerRound
  offset: number
  team?: PlayerTeam | null
}) {
  const now = useNow()
  const deadline = round.deadline ?? 0
  const [totalMs] = useState(() => remainingMs(deadline, offset))
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Chơi thường: câu trả lời server đã nhận là chốt. Chế độ đội: lựa chọn mới nhất trên máy hiện ngay.
  const picked = team ? (chosen ?? round.myAnswer) : (round.myAnswer ?? chosen)

  const choose = async (optionIndex: number) => {
    if (optionIndex === picked) return
    setChosen(optionIndex)
    setError(null)
    const response = await emitAck('player:answer', { roundIndex: round.index, optionIndex })
    if (response.ok || response.error === 'ALREADY_ANSWERED') return
    setChosen(null)
    setError(errorMessage(response.error))
  }

  const tileState = (i: number): TileState =>
    i === picked ? 'chosen' : picked === null || team ? 'idle' : 'dimmed'

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <Title round={round} />
        <CdDisc size="sm" remainingMs={remainingMs(deadline, offset, now)} totalMs={totalMs} />
      </div>
      {/* Cùng vị trí với màn stream: A trên-trái, B trên-phải, C dưới-trái, D dưới-phải. */}
      <div className="grid min-h-[55dvh] flex-1 grid-cols-2 grid-rows-2 gap-3 text-xl">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile
            key={i}
            index={i}
            label={label}
            layout="stack"
            state={tileState(i)}
            votes={round.teamVotes?.[i]}
            disabled={!team && picked !== null}
            onSelect={(index) => void choose(index)}
          />
        ))}
      </div>
      {team ? (
        <TeamStatus team={team} votes={round.teamVotes ?? []} />
      ) : (
        picked !== null && (
          <p className="text-center text-xl font-black text-pop-lime italic">
            Đã chọn {TILES[picked].letter}, chờ kết quả
          </p>
        )
      )}
      {error && <Callout tone="error">{error}</Callout>}
    </section>
  )
}

function TeamStatus({ team, votes }: { team: PlayerTeam; votes: number[] }) {
  if (votesTied(votes)) {
    return (
      <p
        role="status"
        className="-skew-x-6 bg-pop-red py-2 text-center text-2xl font-black text-pop-paper italic motion-safe:animate-blink"
      >
        ĐANG HÒA!
      </p>
    )
  }
  const sum = votes.reduce((total, count) => total + count, 0)
  return (
    <p className="text-center text-xl font-black text-pop-lime italic">
      {team.name} · {sum}/{team.members.length} đã bỏ phiếu
    </p>
  )
}

const BANNERS = {
  lime: 'bg-pop-lime text-pop-ink shadow-[5px_5px_0_var(--color-pop-red)]',
  paper: 'bg-pop-paper text-pop-ink shadow-[5px_5px_0_var(--color-pop-red)]',
  red: 'bg-pop-red text-pop-paper shadow-[5px_5px_0_var(--color-pop-paper)]',
}

// Chế độ đội báo theo đáp án của đội; chơi thường báo theo câu trả lời của mình.
function revealBanner(result: PlayerResult, myAnswer: number | null, rank: number) {
  const { team } = result
  if (team) {
    if (team.correct) return { line: `ĐỘI ĐÚNG! +${team.gained}`, tone: BANNERS.lime, won: true }
    if (team.tied) return { line: 'HÒA PHIẾU · 0 ĐIỂM', tone: BANNERS.red, won: false }
    return { line: 'ĐỘI SAI', tone: BANNERS.paper, won: false }
  }
  const answer = `${TILES[result.correctIndex].letter} · ${result.animeName}`
  if (result.correct) return { line: `✅ Đúng! +${result.gained} · Hạng ${rank}`, tone: BANNERS.lime, won: true }
  if (myAnswer === null) return { line: `⌛ Hết giờ, đáp án là ${answer}`, tone: BANNERS.paper, won: false }
  return { line: `❌ Sai, đáp án là ${answer}`, tone: BANNERS.red, won: false }
}

export function PlayerReveal({ snapshot, round }: { snapshot: PlayerSnapshot; round: PlayerRound }) {
  const { result, myAnswer } = round
  if (!result) return null
  const { line, tone, won } = revealBanner(result, myAnswer, snapshot.me.rank)
  // Chế độ đội: dấu ✕ đặt trên ô đội chốt.
  const wrongPick = result.team ? result.team.option : myAnswer

  const tileState = (i: number): TileState =>
    i === result.correctIndex ? 'correct' : i === wrongPick ? 'wrong' : 'dimmed'

  return (
    <section className="flex flex-1 flex-col gap-4">
      <Title round={round} />
      <div className="relative">
        {won && <Burst className="absolute -top-10 -right-4 size-32 fill-pop-red motion-safe:animate-slam" />}
        <p className={`relative -skew-x-6 px-4 py-3 text-3xl font-black italic motion-safe:animate-slam ${tone}`}>
          {line}
        </p>
      </div>
      {result.songLabel && (
        <PopChip as="p" className="text-lg">
          {result.songLabel}
        </PopChip>
      )}
      <div className="grid min-h-[45dvh] flex-1 grid-cols-2 grid-rows-2 gap-3 text-xl">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile key={i} index={i} label={label} layout="stack" state={tileState(i)} />
        ))}
      </div>
    </section>
  )
}
