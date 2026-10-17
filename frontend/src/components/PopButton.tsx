import type { ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router'
import { popButtonClasses, type PopSize, type PopVariant } from './popButtonClasses'

interface Look {
  variant?: PopVariant
  size?: PopSize
}

export function PopButton({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & Look) {
  const look = popButtonClasses(variant, size)
  return (
    <button type={type} className={`${look.outer} ${className}`} {...rest}>
      <span className={look.frame}>
        <span className={look.face}>{children}</span>
      </span>
    </button>
  )
}

export function PopLink({ variant = 'primary', size = 'md', className = '', children, ...rest }: LinkProps & Look) {
  const look = popButtonClasses(variant, size)
  return (
    <Link className={`${look.outer} ${className}`} {...rest}>
      <span className={look.frame}>
        <span className={look.face}>{children}</span>
      </span>
    </Link>
  )
}
