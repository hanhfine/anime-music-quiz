import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardRow } from '../../lib/protocol'
import { loadRoomAuth } from '../../lib/roomAuth'
import { setSocketForTests } from '../../lib/socket'
import { installFakeSocket } from '../../test/fakeSocket'
import { playerRound, playerSnapshot } from '../../test/snapshots'
import { JoinForm } from './JoinForm'
import { PlayerCalibration } from './PlayerCalibration'
import { PlayerFinished } from './PlayerFinished'
import { PlayerLobby } from './PlayerLobby'
import { PlayerAnswering, PlayerPreparing, PlayerReveal } from './PlayerRound'

const options = ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']

const result = {
  correctIndex: 0,
  correct: false,
  gained: 0,
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
}

afterEach(() => {
  setSocketForTests(null)
})

describe('JoinForm', () => {
  it('joins with the trimmed name and remembers the player token', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 'player-token' })
    const onJoined = vi.fn()
    render(<JoinForm code="K7M2QX" message={null} onJoined={onJoined} />)
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Vào phòng' })
    expect(button).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Tên của bạn'), '  Mai  ')
    await userEvent.click(button)
    expect(socket.payloads('player:join')).toEqual([{ code: 'K7M2QX', name: 'Mai' }])
    expect(loadRoomAuth('K7M2QX')).toEqual({ playerId: 'p1', playerToken: 'player-token' })
    expect(onJoined).toHaveBeenCalledTimes(1)
  })

  it('shows why joining failed', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: false, error: 'NAME_TAKEN' })
    const onJoined = vi.fn()
    render(<JoinForm code="K7M2QX" message={null} onJoined={onJoined} />)
    await userEvent.type(screen.getByLabelText('Tên của bạn'), 'Mai{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Tên này đã có người dùng trong phòng')
    expect(onJoined).not.toHaveBeenCalled()
    expect(loadRoomAuth('K7M2QX')).toEqual({})
  })

  it('shows a message handed over by the play screen', () => {
    render(<JoinForm code="K7M2QX" message="Phiên đã hết hạn, hãy vào lại phòng" onJoined={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Phiên đã hết hạn, hãy vào lại phòng')
  })
})

describe('PlayerLobby', () => {
  it('shows my name, the player count and my measured delay', () => {
    const me = { id: 'p1', name: 'Mai', score: 0, rank: 1, delayMs: 1200, calibrated: true }
    render(<PlayerLobby snapshot={playerSnapshot({ playerCount: 5, me })} />)
    expect(screen.getByText('Mai')).toBeInTheDocument()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
    expect(screen.getByText('5 người trong phòng')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
  })
})

describe('PlayerCalibration', () => {
  it('sends a tap for the current round', async () => {
    const socket = installFakeSocket()
    render(<PlayerCalibration calib={{ round: 2, tapped: false }} />)
    expect(screen.getByText('Đo độ trễ · Lượt 2/3')).toBeInTheDocument()
    expect(screen.getByText('Bấm đúng lúc thấy hoặc nghe BẤM! trên stream')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'BẤM' }))
    expect(socket.payloads('player:calib_tap')).toEqual([{ round: 2 }])
  })

  it('explains an early tap', async () => {
    const socket = installFakeSocket()
    socket.reply('player:calib_tap', { ok: false, error: 'INVALID_STATE' })
    render(<PlayerCalibration calib={{ round: 1, tapped: false }} />)
    await userEvent.click(screen.getByRole('button', { name: 'BẤM' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tới lúc, chờ thấy BẤM! trên stream rồi bấm')
  })

  it('confirms the tap once the server has it', () => {
    render(<PlayerCalibration calib={{ round: 3, tapped: true }} />)
    expect(screen.getByText('Đã bấm lượt 3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BẤM' })).not.toBeInTheDocument()
  })
})

describe('PlayerRound', () => {
  it('asks players to get ready while the host loads the clip', () => {
    render(<PlayerPreparing round={playerRound({ index: 1 })} />)
    expect(screen.getByText('Câu 2/2: chuẩn bị nghe…')).toBeInTheDocument()
  })

  it('locks the tiles after an answer', async () => {
    const socket = installFakeSocket()
    const round = playerRound({ options, deadline: Date.now() + 15_000 })
    render(<PlayerAnswering round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 1/2' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName('Còn 15 giây')

    await userEvent.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(socket.payloads('player:answer')).toEqual([{ roundIndex: 0, optionIndex: 1 }])
    expect(screen.getByText('Đã chọn B, chờ kết quả')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'B: Naruto' })).toHaveAttribute('data-state', 'chosen')
  })

  it('unlocks the tiles when the answer is rejected', async () => {
    const socket = installFakeSocket()
    socket.reply('player:answer', { ok: false, error: 'TOO_LATE' })
    render(<PlayerAnswering round={playerRound({ options, deadline: Date.now() + 1000 })} offset={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Hết giờ rồi')
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeEnabled()
  })

  it('stays locked when the server already has my answer', () => {
    render(<PlayerAnswering round={playerRound({ options, deadline: Date.now() + 9000, myAnswer: 2 })} offset={0} />)
    expect(screen.getByText('Đã chọn C, chờ kết quả')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C: One Piece' })).toBeDisabled()
  })

  it('celebrates a correct answer with the points and rank', () => {
    const round = playerRound({ options, myAnswer: 0, result: { ...result, correct: true, gained: 870 } })
    const me = { id: 'p1', name: 'Mai', score: 870, rank: 4, delayMs: 0, calibrated: false }
    render(<PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL', me })} round={round} />)
    expect(screen.getByText('✅ Đúng! +870 · Hạng 4')).toBeInTheDocument()
    expect(screen.getByText('OP1 · Guren no Yumiya')).toBeInTheDocument()
  })

  it('shows the right answer after a wrong pick', () => {
    const { container } = render(
      <PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL' })} round={playerRound({ options, myAnswer: 1, result })} />,
    )
    expect(screen.getByText('❌ Sai, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
    const states = [...container.querySelectorAll('[data-state]')].map((tile) => tile.getAttribute('data-state'))
    expect(states).toEqual(['correct', 'wrong', 'dimmed', 'dimmed'])
  })

  it('tells a player who did not answer that time ran out', () => {
    render(<PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL' })} round={playerRound({ options, result })} />)
    expect(screen.getByText('⌛ Hết giờ, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
  })
})

describe('PlayerFinished', () => {
  it('shows my final rank and score with the top 3', () => {
    const leaderboardTop: LeaderboardRow[] = [
      { playerId: 'p2', name: 'Long', score: 1500, rank: 1, gained: null },
      { playerId: 'p1', name: 'Mai', score: 870, rank: 2, gained: null },
    ]
    const me = { id: 'p1', name: 'Mai', score: 870, rank: 2, delayMs: 0, calibrated: false }
    const { container } = render(<PlayerFinished snapshot={playerSnapshot({ phase: 'FINISHED', me, leaderboardTop })} />)
    expect(screen.getByText('Hạng 2/2')).toBeInTheDocument()
    expect(screen.getByText('870 điểm')).toBeInTheDocument()
    const podium = screen.getByRole('list', { name: 'Bục vinh quang' })
    expect(within(within(podium).getByText('Long').closest('li')!).getByText('1')).toBeInTheDocument()
    expect(container.querySelector('[data-me="true"]')).toHaveTextContent('Mai')
  })
})
