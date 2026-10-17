export type PopVariant = 'primary' | 'secondary' | 'danger'
export type PopSize = 'sm' | 'md' | 'lg'

export interface PopButtonLook {
  outer: string
  frame: string
  face: string
}

// Chuỗi class viết nguyên văn để Tailwind quét thấy. not-disabled: khớp cả <a> và <label>.
const MOTION =
  'motion-safe:transition-transform motion-safe:duration-150 motion-safe:not-disabled:hover:scale-[1.07] motion-safe:not-disabled:hover:-rotate-[1.5deg] motion-safe:not-disabled:active:scale-[1.07] motion-safe:not-disabled:active:-rotate-[1.5deg]'

const SHADOW: Record<PopVariant, string> = {
  primary: 'hard-pop-red',
  secondary: 'hard-pop-red',
  danger: 'hard-pop-paper',
}

// Lớp khung mang màu viền theo cạnh vát; chỉ nút secondary có viền.
const FRAME: Record<PopVariant, string> = {
  primary: '',
  secondary: 'bg-pop-paper p-[2px]',
  danger: '',
}

const FACE: Record<PopVariant, string> = {
  primary:
    'bg-pop-lime text-pop-ink group-not-disabled:group-hover:bg-pop-red group-not-disabled:group-hover:text-pop-paper group-not-disabled:group-active:bg-pop-red group-not-disabled:group-active:text-pop-paper',
  secondary:
    'bg-pop-ink text-pop-paper group-not-disabled:group-hover:bg-pop-paper group-not-disabled:group-hover:text-pop-ink group-not-disabled:group-active:bg-pop-paper group-not-disabled:group-active:text-pop-ink',
  danger:
    'bg-pop-red text-pop-paper group-not-disabled:group-hover:bg-pop-paper group-not-disabled:group-hover:text-pop-red group-not-disabled:group-active:bg-pop-paper group-not-disabled:group-active:text-pop-red',
}

const SIZE: Record<PopSize, { slant: string; face: string }> = {
  sm: { slant: '[--slant:8px]', face: 'px-3 py-1 text-base' },
  md: { slant: '[--slant:12px]', face: 'px-5 py-2 text-xl' },
  lg: { slant: '[--slant:14px]', face: 'px-8 py-3 text-3xl' },
}

export function popButtonClasses(variant: PopVariant, size: PopSize): PopButtonLook {
  return {
    outer: `group inline-flex drop-hard ${SHADOW[variant]} ${SIZE[size].slant} ${MOTION} disabled:cursor-not-allowed disabled:opacity-40`,
    frame: `flex flex-1 clip-slant ${FRAME[variant]}`,
    face: `flex-1 clip-slant text-center leading-tight font-black uppercase italic transition-colors duration-150 ${SIZE[size].face} ${FACE[variant]}`,
  }
}
