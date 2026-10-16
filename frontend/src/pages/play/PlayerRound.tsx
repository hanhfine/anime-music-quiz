import { useState } from 'react'
import { AnswerTile } from '../../components/AnswerTile'
import { CountdownRing } from '../../components/CountdownRing'
import { TILES, type TileState } from '../../components/tiles'
import { remainingMs } from '../../lib/clock'
import { errorMessage, type PlayerRound, type PlayerSnapshot } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'
import { useNow } from '../../lib/useNow'

function Title({ round }: { round: PlayerRound }) {
  return (
    <h1 className="text-2xl font-bold">
      Câu {round.index + 1}/{round.total}
    </h1>
  )
}

export function PlayerPreparing({ round }: { round: PlayerRound }) {
  return (
    <p className="py-16 text-center text-3xl font-bold">
      Câu {round.index + 1}/{round.total}: chuẩn bị nghe…
    </p>
  )
}

// Mount với key={`${round.index}:${round.deadline}`}: phát lại câu tạo deadline mới nên lựa chọn cũ bị xóa.
export function PlayerAnswering({ round, offset }: { round: PlayerRound; offset: number }) {
  const now = useNow()
  const deadline = round.deadline ?? 0
  const [totalMs] = useState(() => remainingMs(deadline, offset))
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const picked = round.myAnswer ?? chosen

  const choose = async (optionIndex: number) => {
    setChosen(optionIndex)
    setError(null)
    const response = await emitAck('player:answer', { roundIndex: round.index, optionIndex })
    if (response.ok || response.error === 'ALREADY_ANSWERED') return
    setChosen(null)
    setError(errorMessage(response.error))
  }

  const tileState = (i: number): TileState => (picked === null ? 'idle' : i === picked ? 'chosen' : 'dimmed')

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Title round={round} />
        <CountdownRing remainingMs={remainingMs(deadline, offset, now)} totalMs={totalMs} size={80} />
      </div>
      <div className="grid gap-3">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile
            key={i}
            index={i}
            label={label}
            state={tileState(i)}
            disabled={picked !== null}
            onSelect={(index) => void choose(index)}
          />
        ))}
      </div>
      {picked !== null && <p className="text-center text-xl">Đã chọn {TILES[picked].letter}, chờ kết quả</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}

export function PlayerReveal({ snapshot, round }: { snapshot: PlayerSnapshot; round: PlayerRound }) {
  const { result, myAnswer } = round
  if (!result) return null
  const answer = `${TILES[result.correctIndex].letter} · ${result.animeName}`
  const line = result.correct
    ? `✅ Đúng! +${result.gained} · Hạng ${snapshot.me.rank}`
    : myAnswer === null
      ? `⌛ Hết giờ, đáp án là ${answer}`
      : `❌ Sai, đáp án là ${answer}`

  const tileState = (i: number): TileState =>
    i === result.correctIndex ? 'correct' : i === myAnswer ? 'wrong' : 'dimmed'

  return (
    <section className="flex flex-col gap-4">
      <Title round={round} />
      <p className={`text-3xl font-black ${result.correct ? 'text-emerald-300' : 'text-red-300'}`}>{line}</p>
      {result.songLabel && <p className="text-lg text-slate-300">{result.songLabel}</p>}
      <div className="grid gap-3">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile key={i} index={i} label={label} state={tileState(i)} />
        ))}
      </div>
    </section>
  )
}
