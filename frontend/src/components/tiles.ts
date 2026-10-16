// Ký hiệu và màu cố định của 4 ô đáp án, giống nhau trên màn hình stream và điện thoại.
export const TILES = [
  { letter: 'A', symbol: '▲', color: 'bg-red-600' },
  { letter: 'B', symbol: '◆', color: 'bg-blue-600' },
  { letter: 'C', symbol: '●', color: 'bg-amber-500' },
  { letter: 'D', symbol: '■', color: 'bg-green-600' },
] as const

export type TileState = 'idle' | 'chosen' | 'correct' | 'wrong' | 'dimmed'
