import type { ReactNode } from 'react'

type ChipTone = 'paper' | 'red' | 'lime'

const CHIP_TONES: Record<ChipTone, string> = {
  paper: 'bg-pop-paper text-pop-ink shadow-[5px_5px_0_var(--color-pop-red)]',
  red: 'bg-pop-red text-pop-paper shadow-[5px_5px_0_var(--color-pop-ink)]',
  lime: 'bg-pop-lime text-pop-ink shadow-[5px_5px_0_var(--color-pop-red)]',
}

interface ChipProps {
  as?: 'h1' | 'h2' | 'p' | 'span'
  tone?: ChipTone
  className?: string
  children: ReactNode
}

// Hình bình hành nhờ skew (không dùng clip-path) nên đổ bóng trực tiếp bằng box-shadow.
export function PopChip({ as: Tag = 'span', tone = 'paper', className = '', children }: ChipProps) {
  return (
    <Tag
      className={`inline-block w-fit -skew-x-12 -rotate-2 px-3 py-1 leading-none font-black uppercase italic ${CHIP_TONES[tone]} ${className}`}
    >
      {children}
    </Tag>
  )
}

interface PanelProps {
  title?: string
  titleAs?: 'h1' | 'h2'
  className?: string
  children: ReactNode
}

export function PopPanel({ title, titleAs = 'h2', className = '', children }: PanelProps) {
  return (
    <section className={`drop-hard hard-pop-red ${className}`}>
      <div className="clip-slant bg-pop-paper p-[3px] [--slant:18px]">
        <div className="clip-slant flex flex-col gap-4 bg-neutral-950 p-6 [--slant:18px]">
          {/* ml-3: chip cách mép trái hơn 20px để góc vát không cắt vào. */}
          {title && (
            <PopChip as={titleAs} className="ml-3 text-2xl">
              {title}
            </PopChip>
          )}
          {children}
        </div>
      </div>
    </section>
  )
}
