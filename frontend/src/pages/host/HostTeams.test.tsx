import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostPlayer, HostTeam } from '../../lib/protocol'
import { setSocketForTests } from '../../lib/socket'
import { installFakeSocket } from '../../test/fakeSocket'
import { hostSnapshot } from '../../test/snapshots'
import { HostLobby } from './HostLobby'

const player = (id: string, name: string, team: number | null): HostPlayer => ({
  id,
  name,
  online: true,
  delayMs: 0,
  calibrated: false,
  score: 0,
  team,
})

const team = (index: number, name: string, memberIds: string[]): HostTeam => ({
  index,
  name,
  score: 0,
  rank: 1,
  gained: null,
  memberIds,
})

const players = [player('p1', 'Mai', 0), player('p2', 'Long', 1), player('p3', 'An', 0)]
const teams = [team(0, 'Đội Đỏ', ['p1', 'p3']), team(1, 'Đội Chanh', ['p2'])]

afterEach(() => {
  setSocketForTests(null)
  vi.restoreAllMocks()
})

describe('TeamModeBar', () => {
  it('switches between normal and team play and picks the team count', async () => {
    const socket = installFakeSocket()
    const user = userEvent.setup()
    const solo = players.map((p) => ({ ...p, team: null }))
    const { rerender } = render(<HostLobby snapshot={hostSnapshot({ players: solo })} />)
    expect(screen.getByRole('radio', { name: 'Chơi thường' })).toBeChecked()
    expect(screen.queryByRole('radiogroup', { name: 'Số đội' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Theo đội' }))

    rerender(<HostLobby snapshot={hostSnapshot({ players, teams })} />)
    expect(screen.getByRole('radio', { name: 'Theo đội' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '2 đội' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: '2 đội' }))
    await user.click(screen.getByRole('radio', { name: '4 đội' }))
    await user.click(screen.getByRole('radio', { name: 'Chơi thường' }))
    expect(socket.payloads('host:set_teams')).toEqual([{ count: 2 }, { count: 4 }, { count: 0 }])

    await user.click(screen.getByRole('button', { name: 'Chia ngẫu nhiên' }))
    expect(socket.payloads('host:shuffle_teams')).toEqual([{}])
  })
})

describe('TeamColumns', () => {
  it('shows a column per team and moves or kicks players', async () => {
    const socket = installFakeSocket()
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<HostLobby snapshot={hostSnapshot({ players, teams })} />)
    const red = screen.getByRole('region', { name: 'Đội Đỏ' })
    const lime = screen.getByRole('region', { name: 'Đội Chanh' })
    expect(within(red).getByText('Mai')).toBeInTheDocument()
    expect(within(red).getByText('An')).toBeInTheDocument()
    expect(within(lime).getByText('Long')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chuyển Mai sang Đội Đỏ' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled()

    await user.click(within(red).getByRole('button', { name: 'Chuyển Mai sang Đội Chanh' }))
    expect(socket.payloads('host:move_player')).toEqual([{ playerId: 'p1', team: 1 }])
    await user.click(within(red).getByRole('button', { name: 'Mời An ra khỏi phòng' }))
    expect(socket.payloads('host:kick')).toEqual([{ playerId: 'p3' }])
  })

  it('blocks the start while a team has nobody', () => {
    const withEmpty = [...teams, team(2, 'Đội Trắng', [])]
    render(<HostLobby snapshot={hostSnapshot({ players, teams: withEmpty })} />)
    expect(within(screen.getByRole('region', { name: 'Đội Trắng' })).getByText('Chưa có ai')).toBeInTheDocument()
    expect(screen.getByText('Còn đội chưa có người')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled()
  })
})

describe('TeamName', () => {
  it('renames a team with Enter and cancels with Escape', async () => {
    const socket = installFakeSocket()
    const user = userEvent.setup()
    render(<HostLobby snapshot={hostSnapshot({ players, teams })} />)
    await user.click(screen.getByRole('button', { name: 'Đổi tên Đội Đỏ' }))
    const input = screen.getByRole('textbox', { name: 'Tên Đội Đỏ' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, '  Mèo  {Enter}')
    expect(socket.payloads('host:rename_team')).toEqual([{ team: 0, name: 'Mèo' }])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Đổi tên Đội Chanh' }))
    await user.type(screen.getByRole('textbox', { name: 'Tên Đội Chanh' }), 'Cáo{Escape}')
    expect(socket.payloads('host:rename_team')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Đổi tên Đội Chanh' })).toBeInTheDocument()
  })

  it('saves on blur only when the name changed', async () => {
    const socket = installFakeSocket()
    const user = userEvent.setup()
    render(<HostLobby snapshot={hostSnapshot({ players, teams })} />)
    await user.click(screen.getByRole('button', { name: 'Đổi tên Đội Đỏ' }))
    await user.tab()
    expect(socket.payloads('host:rename_team')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Đổi tên Đội Chanh' }))
    const input = screen.getByRole('textbox', { name: 'Tên Đội Chanh' })
    await user.clear(input)
    await user.type(input, 'Cáo')
    await user.tab()
    expect(socket.payloads('host:rename_team')).toEqual([{ team: 1, name: 'Cáo' }])
  })
})
