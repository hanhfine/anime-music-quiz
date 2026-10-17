import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LeaderboardRow } from '../lib/protocol'
import { AnswerTile } from './AnswerTile'
import { CountdownRing } from './CountdownRing'
import { DelayBadge } from './DelayBadge'
import { Leaderboard } from './Leaderboard'
import { Podium } from './Podium'
import { TILES } from './tiles'

const row = (playerId: string, name: string, score: number, rank: number, gained: number | null = null): LeaderboardRow => ({
  playerId,
  name,
  score,
  rank,
  gained,
})

describe('AnswerTile', () => {
  it('uses fixed letters and symbols', () => {
    expect(TILES.map((t) => `${t.letter}${t.symbol}`)).toEqual(['A▲', 'B◆', 'C●', 'D■'])
  })

  it('calls onSelect with its index', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<AnswerTile index={1} label="Naruto" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('does not fire when disabled and exposes its state', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<AnswerTile index={2} label="Bleach" state="chosen" disabled onSelect={onSelect} />)
    const tile = screen.getByRole('button', { name: 'C: Bleach' })
    await user.click(tile)
    expect(onSelect).not.toHaveBeenCalled()
    expect(tile).toBeDisabled()
    expect(tile).toHaveAttribute('data-state', 'chosen')
  })

  it('renders a display-only tile with a pick count', () => {
    render(<AnswerTile index={3} label="One Piece" state="correct" count={4} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('One Piece').closest('[data-state]')).toHaveAttribute('data-state', 'correct')
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('shows its letter on the tile', () => {
    render(<AnswerTile index={0} label="Naruto" />)
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true')
  })

  it('reacts to hover only when it can be picked', () => {
    const { container, unmount } = render(<AnswerTile index={1} label="Naruto" />)
    expect(container.innerHTML).not.toContain('hover:')
    unmount()
    render(<AnswerTile index={1} label="Naruto" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'B: Naruto' }).outerHTML).toContain('hover:')
  })

  it('stamps only the correct and the wrong tile', () => {
    const { rerender } = render(<AnswerTile index={0} label="Naruto" state="correct" />)
    expect(screen.getByText('✓ Đúng')).toHaveAttribute('aria-hidden', 'true')
    rerender(<AnswerTile index={0} label="Naruto" state="wrong" />)
    expect(screen.getByText('✕')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('✓ Đúng')).not.toBeInTheDocument()
    for (const state of ['idle', 'chosen', 'dimmed'] as const) {
      rerender(<AnswerTile index={0} label="Naruto" state={state} />)
      expect(screen.queryByText(/✓|✕/)).not.toBeInTheDocument()
    }
  })

  it('stacks the letter above the name in the stack layout', () => {
    const { rerender } = render(<AnswerTile index={2} label="Bleach" layout="stack" />)
    expect(screen.getByText('C').parentElement).toHaveClass('flex-col')
    rerender(<AnswerTile index={2} label="Bleach" />)
    expect(screen.getByText('C').parentElement).not.toHaveClass('flex-col')
  })
})

describe('Leaderboard', () => {
  it('renders ranks, names, gained points and formatted scores', () => {
    render(<Leaderboard rows={[row('a', 'An', 2430, 1, 870), row('b', 'Bình', 900, 2, 0)]} highlightId="b" />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('1An+8702.430')
    expect(items[1]).toHaveTextContent('2Bình900')
    expect(items[1]).toHaveAttribute('data-me', 'true')
  })

  it('shows an empty state', () => {
    render(<Leaderboard rows={[]} />)
    expect(screen.getByText('Chưa có người chơi')).toBeInTheDocument()
  })
})

describe('Podium', () => {
  it('shows the top 3 with medals by rank', () => {
    render(
      <Podium
        rows={[row('a', 'An', 3000, 1), row('b', 'Bình', 2000, 2), row('c', 'Chi', 2000, 2), row('d', 'Dũng', 10, 4)]}
      />,
    )
    expect(screen.getByText('An').closest('li')).toHaveTextContent('🥇')
    expect(screen.getByText('Chi').closest('li')).toHaveTextContent('🥈')
    expect(screen.queryByText('Dũng')).not.toBeInTheDocument()
  })
})

describe('CountdownRing', () => {
  it('rounds the remaining seconds up', () => {
    render(<CountdownRing remainingMs={4200} totalMs={18000} />)
    expect(screen.getByRole('timer', { name: 'Còn 5 giây' })).toHaveTextContent('5')
  })
})

describe('DelayBadge', () => {
  it('formats measured and estimated delays', () => {
    const { rerender } = render(<DelayBadge delayMs={1234} calibrated />)
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    rerender(<DelayBadge delayMs={800} calibrated={false} />)
    expect(screen.getByText('~0.8s')).toHaveAttribute('title', 'Chưa đo, dùng trung vị của phòng')
  })
})
