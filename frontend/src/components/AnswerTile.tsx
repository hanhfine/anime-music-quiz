import { TILES, type TileState } from './tiles'

const LOOK: Record<TileState, string> = {
  idle: '',
  chosen: 'ring-4 ring-white',
  correct: 'ring-4 ring-white scale-[1.03]',
  wrong: 'opacity-40',
  dimmed: 'opacity-40',
}

interface Props {
  index: number
  label: string
  state?: TileState
  count?: number
  disabled?: boolean
  onSelect?: (index: number) => void
}

export function AnswerTile({ index, label, state = 'idle', count, disabled, onSelect }: Props) {
  const tile = TILES[index]
  const className = `flex w-full items-center gap-3 rounded-2xl p-4 text-left text-white shadow transition ${tile.color} ${LOOK[state]}`
  const body = (
    <>
      <span aria-hidden="true" className="text-3xl">
        {tile.symbol}
      </span>
      <span className="flex-1 text-xl font-semibold break-words">{label}</span>
      {count !== undefined && <span className="rounded-lg bg-black/30 px-3 py-1 text-xl font-bold">{count}</span>}
    </>
  )
  if (!onSelect) {
    return (
      <div className={className} data-state={state}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`${className} disabled:cursor-not-allowed`}
      data-state={state}
      aria-label={`${tile.letter}: ${label}`}
      disabled={disabled}
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}
