import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beep } from '../../lib/beep'
import type { HostPlayer, HostTeam, LeaderboardRow } from '../../lib/protocol'
import { installFakeSocket } from '../../test/fakeSocket'
import { hostRound, hostSnapshot } from '../../test/snapshots'
import { HostCalibration } from './HostCalibration'
import { HostFinished } from './HostFinished'
import { HostLobby } from './HostLobby'
import { HostQuestion } from './HostQuestion'

vi.mock('../../lib/beep', () => ({ beep: vi.fn() }))

const players: HostPlayer[] = [
  { id: 'p1', name: 'Mai', online: true, delayMs: 1200, calibrated: true, score: 870, team: null },
  { id: 'p2', name: 'Long', online: false, delayMs: 800, calibrated: false, score: 0, team: null },
]

const leaderboard: LeaderboardRow[] = [
  { playerId: 'p1', name: 'Mai', score: 870, rank: 1, gained: 870 },
  { playerId: 'p2', name: 'Long', score: 0, rank: 2, gained: 0 },
]

const reveal = {
  correctIndex: 0,
  optionCounts: [1, 1, 0, 0],
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
  teamPicks: null,
}

const hostTeams: HostTeam[] = [
  { index: 0, name: 'Đội Đỏ', score: 0, rank: 3, gained: 0, memberIds: ['p1'] },
  { index: 1, name: 'Đội Chanh', score: 900, rank: 1, gained: 900, memberIds: ['p2'] },
  { index: 2, name: 'Đội Trắng', score: 900, rank: 1, gained: 0, memberIds: ['p3'] },
]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(beep).mockClear()
})

describe('HostLobby', () => {
  it('shows the room code, join link, QR code and players with their delay', () => {
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    expect(screen.getByTestId('room-code')).toHaveTextContent('K7M2QX')
    expect(screen.getByText(`${window.location.origin}/play/K7M2QX`)).toBeInTheDocument()
    expect(screen.getByTitle('Mã QR vào phòng')).toBeInTheDocument()
    expect(screen.getByText('Người chơi (2/30)')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    expect(screen.getByText('~0.8s')).toBeInTheDocument()
    expect(screen.getByText('Long').closest('li')).toHaveAttribute('data-online', 'false')
    expect(screen.getByText('2 câu · nhạc 15 giây · công bố 15 giây')).toBeInTheDocument()
  })

  it('kicks a player after confirmation', async () => {
    const socket = installFakeSocket()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    const kick = screen.getByRole('button', { name: 'Mời Mai ra khỏi phòng' })
    await userEvent.click(kick)
    expect(socket.payloads('host:kick')).toEqual([])
    await userEvent.click(kick)
    expect(socket.payloads('host:kick')).toEqual([{ playerId: 'p1' }])
    expect(window.confirm).toHaveBeenCalledWith('Mời Mai ra khỏi phòng?')
  })

  it('needs players to start and online players to calibrate', () => {
    const { rerender } = render(<HostLobby snapshot={hostSnapshot()} />)
    expect(screen.getByText(/Chưa có ai vào phòng/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Đo độ trễ' })).toBeDisabled()

    rerender(<HostLobby snapshot={hostSnapshot({ players: [players[1]] })} />)
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Đo độ trễ' })).toBeDisabled()
  })

  it('sends calibrate and start, and shows a failed ack', async () => {
    const socket = installFakeSocket()
    socket.reply('host:start', { ok: false, error: 'INVALID_STATE' })
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Đo độ trễ' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }))
    expect(socket.payloads('host:calibrate')).toEqual([{}])
    expect(socket.payloads('host:start')).toEqual([{}])
    expect(await screen.findByRole('alert')).toHaveTextContent('Thao tác không hợp lệ lúc này')
  })
})

describe('HostCalibration', () => {
  it('counts down 3, 2, 1 after waitMs, then flashes BẤM! with a beep', async () => {
    vi.useFakeTimers()
    const socket = installFakeSocket()
    render(<HostCalibration calib={{ round: 2, waitMs: 2500, flashed: false, tappedCount: 0 }} players={players} />)
    expect(screen.getByText('Đo độ trễ · Lượt 2/3')).toBeInTheDocument()
    expect(screen.getByText('Chuẩn bị…')).toBeInTheDocument()

    for (const [ms, text] of [
      [2500, '3'],
      [1000, '2'],
      [1000, '1'],
    ] as const) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(socket.payloads('host:calib_flash')).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('BẤM!')).toBeInTheDocument()
    expect(beep).toHaveBeenCalledTimes(1)
    expect(socket.payloads('host:calib_flash')).toEqual([{ round: 2 }])
  })

  it('shows how many online players have tapped after the flash', () => {
    render(<HostCalibration calib={{ round: 1, waitMs: 3000, flashed: true, tappedCount: 1 }} players={players} />)
    expect(screen.getByText('BẤM!')).toBeInTheDocument()
    expect(screen.getByText('1/1 người đã bấm')).toBeInTheDocument()
    expect(beep).not.toHaveBeenCalled()
  })

  it('keeps the round label above the BẤM! burst', () => {
    render(<HostCalibration calib={{ round: 1, waitMs: 3000, flashed: true, tappedCount: 0 }} players={players} />)
    expect(screen.getByText('Đo độ trễ · Lượt 1/3')).toHaveClass('relative', 'z-10')
  })
})

describe('HostQuestion', () => {
  it('shows the preparing message and lets the host replay after confirming', async () => {
    const socket = installFakeSocket()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const round = hostRound()
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'PREPARING', round })} round={round} offset={0} />)
    expect(screen.getByText('Câu 1/2: chuẩn bị…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Phát lại câu này' }))
    expect(window.confirm).toHaveBeenCalledWith('Phát lại câu này? Câu trả lời của câu này sẽ bị hủy.')
    expect(socket.payloads('host:replay_round')).toEqual([{}])
  })

  it('shows the options, the countdown and the answer count while answering', () => {
    const round = hostRound({ deadline: Date.now() + 18_000, answeredCount: 1, onlineCount: 2 })
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'ANSWERING', round })} round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 1/2' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName('Còn 18 giây')
    for (const option of ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']) {
      expect(screen.getByText(option)).toBeInTheDocument()
    }
    expect(screen.getByText('1/2 đã trả lời')).toBeInTheDocument()
  })

  it('reveals the answer, the counts and the top 10, then moves on', async () => {
    const socket = installFakeSocket()
    const round = hostRound({ reveal })
    const { container } = render(
      <HostQuestion snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard })} round={round} offset={0} />,
    )
    expect(screen.getByRole('heading', { name: 'Shingeki no Kyojin' })).toBeInTheDocument()
    expect(screen.getByText('OP1 · Guren no Yumiya')).toBeInTheDocument()
    const tiles = [...container.querySelectorAll('[data-state]')]
    expect(tiles.map((tile) => tile.getAttribute('data-state'))).toEqual(['correct', 'dimmed', 'dimmed', 'dimmed'])
    expect(tiles[1]).toHaveTextContent('Naruto1')
    expect(screen.getByText('+870')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Câu tiếp →' }))
    expect(socket.payloads('host:next')).toEqual([{}])
  })

  it('labels the last next button "Xem kết quả"', () => {
    const round = hostRound({ index: 1, total: 2, reveal })
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard })} round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 2/2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeInTheDocument()
  })

  it('scrolls a long leaderboard inside the column so the next button stays on screen', () => {
    const round = hostRound({ reveal })
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard })} round={round} offset={0} />)
    const board = screen.getByRole('list').parentElement!
    expect(board).toHaveClass('min-h-0', 'overflow-y-auto')
    const column = board.parentElement!
    expect(column).toHaveClass('fixed', 'top-20', 'bottom-6')
    expect(column).toContainElement(screen.getByRole('button', { name: 'Câu tiếp →' }))
  })

  it('counts votes instead of answers in team mode', () => {
    const round = hostRound({ deadline: Date.now() + 18_000, answeredCount: 1, onlineCount: 3 })
    render(
      <HostQuestion snapshot={hostSnapshot({ phase: 'ANSWERING', round, teams: hostTeams })} round={round} offset={0} />,
    )
    expect(screen.getByText('1/3 đã bỏ phiếu')).toBeInTheDocument()
  })

  it('marks each tile with the teams that picked it and ranks the teams', () => {
    const teamPicks = [
      { team: 0, option: null, tied: true, gained: 0 },
      { team: 1, option: 0, tied: false, gained: 900 },
      { team: 2, option: 1, tied: false, gained: 0 },
    ]
    const round = hostRound({ reveal: { ...reveal, teamPicks } })
    const { container } = render(
      <HostQuestion
        snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard, teams: hostTeams })}
        round={round}
        offset={0}
      />,
    )
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-state]')]
    expect(within(tiles[0]).getByText('Đội Chanh')).toBeInTheDocument()
    expect(within(tiles[1]).getByText('Đội Trắng')).toBeInTheDocument()
    for (const tile of tiles) expect(within(tile).queryByText('Đội Đỏ')).not.toBeInTheDocument()

    const board = screen.getByRole('list', { name: 'Bảng xếp hạng đội' })
    expect(within(board).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1Đội Chanh+900900',
      '1Đội Trắng900',
      '3Đội ĐỏHÒA0',
    ])
    expect(screen.queryByText('Mai')).not.toBeInTheDocument()
  })
})

describe('HostFinished', () => {
  it('shows the podium and the full leaderboard, and offers replay or close', async () => {
    const socket = installFakeSocket()
    const onClose = vi.fn()
    render(<HostFinished snapshot={hostSnapshot({ phase: 'FINISHED', leaderboard })} onClose={onClose} />)
    expect(screen.getByRole('heading', { name: /Kết quả chung cuộc/ })).toBeInTheDocument()
    const podium = screen.getByRole('list', { name: 'Bục vinh quang' })
    expect(within(within(podium).getByText('Mai').closest('li')!).getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText('Mai')).toHaveLength(2) // bục vinh quang + bảng xếp hạng
    await userEvent.click(screen.getByRole('button', { name: 'Chơi lại' }))
    expect(socket.payloads('host:play_again')).toEqual([{}])
    await userEvent.click(screen.getByRole('button', { name: 'Đóng phòng' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the team podium and the team board in team mode', () => {
    render(<HostFinished snapshot={hostSnapshot({ phase: 'FINISHED', leaderboard, teams: hostTeams })} onClose={vi.fn()} />)
    const podium = screen.getByRole('list', { name: 'Bục vinh quang' })
    expect(within(within(podium).getByText('Đội Chanh').closest('li')!).getByText('1')).toBeInTheDocument()
    expect(within(within(podium).getByText('Đội Đỏ').closest('li')!).getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Bảng xếp hạng đội' })).toBeInTheDocument()
    expect(screen.queryByText('Mai')).not.toBeInTheDocument()
  })
})
