import { TeamChip } from './TeamChip'
import { TILES, type TileState } from './tiles'

interface Props {
  index: number
  label: string
  state?: TileState
  count?: number
  disabled?: boolean
  layout?: 'row' | 'stack'
  onSelect?: (index: number) => void
  votes?: number // số phiếu của đội mình (điện thoại, chế độ đội)
  teamMarks?: { team: number; name: string }[] // các đội chốt ô này (màn quản trò lúc công bố)
}

const HOVER_MOTION =
  'motion-safe:enabled:hover:scale-[1.07] motion-safe:enabled:hover:-rotate-[1.5deg] motion-safe:enabled:active:scale-[1.07] motion-safe:enabled:active:-rotate-[1.5deg] disabled:cursor-not-allowed'

const STATE_MOTION: Record<TileState, string> = {
  idle: '',
  chosen: 'motion-safe:scale-[1.04] motion-safe:-rotate-[1.5deg]',
  correct: 'motion-safe:scale-[1.05]',
  wrong: '',
  dimmed: '',
}

// Cấu trúc: phần tử ngoài (bóng cứng, phóng to) > lớp viền clip-slant > mặt clip-slant.
// Ô chỉ phản ứng với chuột khi là button đang bật: chuột của quản trò dừng trên ô nào thì cả stream thấy.
export function AnswerTile({
  index,
  label,
  state = 'idle',
  count,
  disabled,
  layout = 'row',
  onSelect,
  votes,
  teamMarks,
}: Props) {
  const tile = TILES[index]
  const interactive = onSelect !== undefined
  const chosen = state === 'chosen'
  // Làm tối trên lớp viền (drop-hard đã chiếm thuộc tính filter của phần tử ngoài). Không dùng opacity:
  // ô trong suốt để lộ dải chéo đỏ của nền, ô không ai chọn trông như ô sai.
  const faded = state === 'dimmed' || state === 'wrong'

  const outer = `group relative flex w-full text-left drop-hard motion-safe:transition-transform motion-safe:duration-150 ${
    faded ? 'hard-neutral-800' : chosen ? tile.hardSwap : tile.hard
  } ${STATE_MOTION[state]} ${interactive ? `${tile.hardHover} ${HOVER_MOTION}` : ''}`
  const frame = `flex flex-1 clip-slant p-[3px] ${tile.border} ${faded ? 'brightness-[.35] grayscale' : ''}`
  const face = `flex min-w-0 flex-1 clip-slant transition-colors duration-150 ${chosen ? tile.swap : tile.face} ${
    interactive ? tile.faceHover : ''
  } ${layout === 'stack' ? 'flex-col justify-between gap-2 px-5 py-3' : 'items-center gap-3 py-3 pr-7 pl-6'}`

  const letter = (
    <span aria-hidden="true" className="text-[1.8em] leading-none font-black italic">
      {tile.letter}
    </span>
  )
  const symbol = (
    <span aria-hidden="true" className="text-[0.7em]">
      {tile.symbol}
    </span>
  )
  const name = <span className="min-w-0 leading-tight font-extrabold break-words italic">{label}</span>

  const body = (
    <>
      <span className={frame}>
        {layout === 'stack' ? (
          <span className={face}>
            {letter}
            <span className="flex items-baseline gap-1.5">
              {symbol}
              {name}
            </span>
          </span>
        ) : (
          <span className={face}>
            {letter}
            {symbol}
            <span className="flex min-w-0 flex-1">{name}</span>
            {count !== undefined && (
              <span className="-skew-x-12 bg-pop-ink px-3 py-1 font-black text-pop-lime italic tabular-nums">
                {count}
              </span>
            )}
          </span>
        )}
      </span>
      {state === 'correct' && (
        <span
          aria-hidden="true"
          className="absolute -top-3 -right-2 rotate-8 bg-pop-paper px-2 py-0.5 text-base font-black text-pop-red uppercase italic shadow-[3px_3px_0_var(--color-pop-ink)]"
        >
          ✓ Đúng
        </span>
      )}
      {state === 'wrong' && (
        <span
          aria-hidden="true"
          className="absolute -top-3 -right-2 rotate-8 bg-pop-red px-2 py-0.5 text-xl leading-none font-black text-pop-paper italic shadow-[3px_3px_0_var(--color-pop-ink)]"
        >
          ✕
        </span>
      )}
      {votes !== undefined && votes > 0 && (
        <span className="absolute -top-3 left-4 -skew-x-12 bg-pop-ink px-2 text-sm font-black text-pop-lime italic tabular-nums">
          {votes} phiếu
        </span>
      )}
      {teamMarks && teamMarks.length > 0 && (
        <span className="absolute -bottom-3 left-4 flex gap-1">
          {teamMarks.map((mark) => (
            <TeamChip key={mark.team} team={mark.team} name={mark.name} size="sm" />
          ))}
        </span>
      )}
    </>
  )

  if (!interactive) {
    return (
      <div className={outer} data-state={state}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={outer}
      data-state={state}
      aria-label={`${tile.letter}: ${label}`}
      disabled={disabled}
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}
