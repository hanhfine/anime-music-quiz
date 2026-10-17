// Ký hiệu và màu cố định của 4 ô đáp án, giống nhau trên màn hình stream và điện thoại.
// Chuỗi class viết nguyên văn để Tailwind quét thấy; không ghép chuỗi lúc chạy.
// Mặt đen luôn có viền trắng ngà (border của C và D), nếu không ô chìm vào nền đen.
export const TILES = [
  {
    letter: 'A',
    symbol: '▲',
    face: 'bg-pop-red text-pop-paper',
    faceHover:
      'group-enabled:group-hover:bg-pop-lime group-enabled:group-hover:text-pop-ink group-enabled:group-active:bg-pop-lime group-enabled:group-active:text-pop-ink',
    swap: 'bg-pop-lime text-pop-ink',
    border: 'bg-transparent',
    hard: 'hard-pop-paper',
    hardHover: '',
    hardSwap: 'hard-pop-paper',
  },
  {
    letter: 'B',
    symbol: '◆',
    face: 'bg-pop-lime text-pop-ink',
    faceHover:
      'group-enabled:group-hover:bg-pop-red group-enabled:group-hover:text-pop-paper group-enabled:group-active:bg-pop-red group-enabled:group-active:text-pop-paper',
    swap: 'bg-pop-red text-pop-paper',
    border: 'bg-transparent',
    hard: 'hard-pop-red',
    hardHover: 'enabled:hover:hard-pop-lime enabled:active:hard-pop-lime',
    hardSwap: 'hard-pop-lime',
  },
  {
    letter: 'C',
    symbol: '●',
    face: 'bg-pop-paper text-pop-ink',
    faceHover:
      'group-enabled:group-hover:bg-pop-ink group-enabled:group-hover:text-pop-paper group-enabled:group-active:bg-pop-ink group-enabled:group-active:text-pop-paper',
    swap: 'bg-pop-ink text-pop-paper',
    border: 'bg-pop-paper',
    hard: 'hard-pop-red',
    hardHover: '',
    hardSwap: 'hard-pop-red',
  },
  {
    letter: 'D',
    symbol: '■',
    face: 'bg-pop-ink text-pop-paper',
    faceHover:
      'group-enabled:group-hover:bg-pop-paper group-enabled:group-hover:text-pop-ink group-enabled:group-active:bg-pop-paper group-enabled:group-active:text-pop-ink',
    swap: 'bg-pop-paper text-pop-ink',
    border: 'bg-pop-paper',
    hard: 'hard-pop-red',
    hardHover: '',
    hardSwap: 'hard-pop-red',
  },
] as const

export type TileState = 'idle' | 'chosen' | 'correct' | 'wrong' | 'dimmed'
