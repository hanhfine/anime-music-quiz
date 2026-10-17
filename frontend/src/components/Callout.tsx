import type { ReactNode } from 'react'

const TONES = {
  error: 'bg-pop-red text-pop-paper',
  warn: 'bg-pop-lime text-pop-ink',
}

interface Props {
  tone: keyof typeof TONES
  role?: 'alert' | 'status'
  className?: string
  children: ReactNode
}

export function Callout({ tone, role = 'alert', className = '', children }: Props) {
  return (
    <p role={role} className={`clip-slant px-4 py-2 font-semibold [--slant:8px] ${TONES[tone]} ${className}`}>
      {children}
    </p>
  )
}
