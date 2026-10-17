import { TEAM_COLORS } from './teams'

const SIZES = {
  sm: 'px-1.5 text-sm',
  md: 'px-3 py-1 text-2xl',
}

// Viền mực để chip vẫn nổi khi nằm trên ô đáp án cùng màu.
export function TeamChip({ team, name, size = 'md' }: { team: number; name: string; size?: keyof typeof SIZES }) {
  return (
    <span
      className={`inline-block max-w-full -skew-x-12 truncate border-2 border-pop-ink leading-tight font-black italic ${TEAM_COLORS[team].face} ${SIZES[size]}`}
    >
      {name}
    </span>
  )
}
