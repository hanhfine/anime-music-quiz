import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Burst } from './Burst'
import { Callout } from './Callout'
import { PopButton, PopLink } from './PopButton'
import { PopChip, PopPanel } from './PopPanel'

describe('PopButton', () => {
  it('is named by its text and ignores clicks while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<PopButton onClick={onClick}>Câu tiếp →</PopButton>)
    await user.click(screen.getByRole('button', { name: 'Câu tiếp →' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <PopButton onClick={onClick} disabled>
        Câu tiếp →
      </PopButton>,
    )
    await user.click(screen.getByRole('button', { name: 'Câu tiếp →' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not submit forms unless asked to', () => {
    render(<PopButton>Thêm</PopButton>)
    expect(screen.getByRole('button', { name: 'Thêm' })).toHaveAttribute('type', 'button')
  })

  it('renders a link that looks like a button', () => {
    render(
      <MemoryRouter>
        <PopLink to="/sets">Tạo phòng</PopLink>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Tạo phòng' })).toHaveAttribute('href', '/sets')
  })
})

describe('PopPanel and PopChip', () => {
  it('titles a panel with a heading chip', () => {
    render(
      <PopPanel title="Người chơi">
        <p>Nội dung</p>
      </PopPanel>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Người chơi' })).toBeInTheDocument()
    expect(screen.getByText('Nội dung')).toBeInTheDocument()
  })

  it('renders a chip as the requested element', () => {
    render(<PopChip as="h1">Câu 3/10</PopChip>)
    expect(screen.getByRole('heading', { level: 1, name: 'Câu 3/10' })).toBeInTheDocument()
  })
})

describe('Callout', () => {
  it('is an alert by default and can be a status', () => {
    const { rerender } = render(<Callout tone="error">Lỗi rồi</Callout>)
    expect(screen.getByRole('alert')).toHaveTextContent('Lỗi rồi')
    rerender(
      <Callout tone="warn" role="status">
        Đang chờ
      </Callout>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Đang chờ')
  })
})

describe('Burst', () => {
  it('is a decorative 12-point star', () => {
    const { container } = render(<Burst />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.querySelector('polygon')?.getAttribute('points')?.split(' ')).toHaveLength(24)
  })
})
