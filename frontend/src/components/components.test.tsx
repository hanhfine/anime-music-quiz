import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LeaderboardRow } from '../lib/protocol'
import { AnswerTile } from './AnswerTile'
import { CdDisc } from './CdDisc'
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

  it('darkens faded tiles but keeps them opaque so the background stripe stays behind', () => {
    for (const state of ['dimmed', 'wrong'] as const) {
      const { container, unmount } = render(<AnswerTile index={0} label="Naruto" state={state} />)
      expect(container.querySelector('[class*="brightness-"]')).not.toBeNull()
      expect(container.innerHTML).not.toMatch(/\bopacity-/)
      expect(container.firstChild).toHaveClass('hard-neutral-800')
      unmount()
    }
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
  it('shows the top 3 with their rank on the podium blocks', () => {
    render(
      <Podium
        rows={[row('a', 'An', 3000, 1), row('b', 'Bình', 2000, 2), row('c', 'Chi', 2000, 2), row('d', 'Dũng', 10, 4)]}
      />,
    )
    const podium = screen.getByRole('list', { name: 'Bục vinh quang' })
    expect(within(within(podium).getByText('An').closest('li')!).getByText('1')).toBeInTheDocument()
    expect(within(within(podium).getByText('Chi').closest('li')!).getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('Dũng')).not.toBeInTheDocument()
    expect(screen.queryByText('🥇')).not.toBeInTheDocument()
  })
})

describe('CdDisc', () => {
  it('counts down the remaining seconds, rounded up', () => {
    render(<CdDisc size="lg" remainingMs={4200} totalMs={18000} />)
    expect(screen.getByRole('timer', { name: 'Còn 5 giây' })).toHaveTextContent('5')
  })

  it('is decorative without a countdown', () => {
    const { container } = render(<CdDisc size="sm" />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.textContent).toBe('')
  })

  it('throws notes and bolts only around the large disc', () => {
    const large = render(<CdDisc size="lg" />)
    expect(screen.getAllByText(/^[♪♫♬♩]$/)).toHaveLength(5)
    expect(large.container.querySelectorAll('polygon')).toHaveLength(2)
    large.unmount()
    const small = render(<CdDisc size="sm" remainingMs={9000} totalMs={18000} />)
    expect(screen.queryAllByText(/^[♪♫♬♩]$/)).toHaveLength(0)
    expect(small.container.querySelectorAll('polygon')).toHaveLength(0)
  })

  it('turns the ring red in the last 5 seconds', () => {
    const { container, rerender } = render(<CdDisc size="sm" remainingMs={9000} totalMs={18000} />)
    expect(container.querySelector('.stroke-pop-lime')).not.toBeNull()
    rerender(<CdDisc size="sm" remainingMs={4200} totalMs={18000} />)
    expect(container.querySelector('.stroke-pop-red')).not.toBeNull()
    expect(container.querySelector('.stroke-pop-lime')).toBeNull()
  })

  it('paints over the spindle hole only while a number sits on it', () => {
    const timed = render(<CdDisc size="lg" remainingMs={9000} totalMs={18000} />)
    expect(timed.container.querySelector('.disc-face')).toHaveClass('[--disc-hub:var(--color-pop-red)]')
    timed.unmount()
    const plain = render(<CdDisc size="lg" />)
    expect(plain.container.querySelector('.disc-face')).not.toHaveClass('[--disc-hub:var(--color-pop-red)]')
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
