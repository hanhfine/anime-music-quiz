import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setPlayerFactoryForTests } from '../audio/createPlayer'
import type { HostSnapshot } from '../lib/protocol'
import { loadRoomAuth, saveRoomAuth } from '../lib/roomAuth'
import { setSocketForTests } from '../lib/socket'
import { installFakePlayer } from '../test/fakePlayer'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { hostRound, hostSnapshot } from '../test/snapshots'
import HostScreen from './HostScreen'

const CODE = 'K7M2QX'

const reveal = {
  correctIndex: 0,
  optionCounts: [1, 0, 0, 0],
  animeName: 'Shingeki no Kyojin',
  songLabel: null,
}

interface SetupOptions {
  token?: string | null
  resume?: object
}

function setup({ token = 'host-token', resume }: SetupOptions = {}) {
  if (token) saveRoomAuth(CODE, { hostToken: token })
  const socket = installFakeSocket()
  if (resume) socket.reply('host:resume', resume)
  const players = installFakePlayer()
  const { user } = renderRoute(<HostScreen />, { path: '/host/:code', url: `/host/${CODE}` })
  const push = (patch: Partial<HostSnapshot> = {}) => socket.serverEmit('room:state', hostSnapshot(patch))
  return { socket, players, user, push }
}

afterEach(() => {
  setSocketForTests(null)
  setPlayerFactoryForTests(null)
  vi.restoreAllMocks()
})

describe('HostScreen', () => {
  it('resumes the room with the saved host token and shows the lobby', () => {
    const { socket, push } = setup()
    expect(socket.payloads('host:resume')).toEqual([{ code: CODE, hostToken: 'host-token' }])
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
    push()
    expect(screen.getByTestId('room-code')).toHaveTextContent(CODE)
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'hidden')
  })

  it('sends the host home when this browser has no host token', () => {
    const { socket } = setup({ token: null })
    expect(socket.payloads('host:resume')).toEqual([])
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(screen.getByTestId('location-state')).toHaveTextContent(
      'Trình duyệt này không giữ quyền quản trò phòng K7M2QX',
    )
  })

  it('forgets the token and goes home when the room no longer exists', async () => {
    setup({ resume: { ok: false, error: 'ROOM_NOT_FOUND' } })
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Phòng không còn tồn tại')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('stays on the page when the resume ack is lost', async () => {
    setup({ resume: { ok: false, error: 'NETWORK' } })
    await act(async () => {})
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
    expect(loadRoomAuth(CODE)).toEqual({ hostToken: 'host-token' })
  })

  it('plays the clip under a cover, then enlarges the same player on reveal', () => {
    const { socket, players, push } = setup()
    const round = hostRound()
    push({ phase: 'PREPARING', round })
    expect(players).toHaveLength(1)
    expect(players[0].loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }])
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'small')
    expect(screen.getByTestId('stage-cover')).not.toHaveClass('opacity-0')
    const video = screen.getByTestId('fake-player')

    act(() => players[0].emitPlaying())
    expect(socket.payloads('host:audio_started')).toEqual([{ roundIndex: 0 }])

    push({ phase: 'ANSWERING', round: { ...round, deadline: Date.now() + 18_000 } })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'small')

    push({ phase: 'REVEAL', round: { ...round, reveal } })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'large')
    expect(screen.getByTestId('stage-cover')).toHaveClass('opacity-0')
    expect(screen.getByTestId('fake-player')).toBe(video)
    expect(players[0].loads).toHaveLength(1)
    expect(players[0].stopCount).toBe(0)

    push({ phase: 'FINISHED' })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'hidden')
    expect(players[0].stopCount).toBe(1)
  })

  it('centers the covered clip where the disc will sit', () => {
    const { push } = setup()
    push({ phase: 'PREPARING', round: hostRound() })
    expect(screen.getByTestId('stage')).toHaveClass('left-[calc(50%-160px)]', 'top-[calc(50%-90px)]')
  })

  it('applies the saved volume and remembers changes', () => {
    localStorage.setItem('animequiz:volume', '35')
    const { players } = setup()
    const slider = screen.getByRole('slider', { name: /Âm lượng/ })
    expect(slider).toHaveValue('35')
    expect(players[0].volume).toBe(35)
    fireEvent.change(slider, { target: { value: '60' } })
    expect(players[0].volume).toBe(60)
    expect(localStorage.getItem('animequiz:volume')).toBe('60')
  })

  it('shows a notice when the server swapped a broken video', () => {
    const { push } = setup()
    push({ phase: 'PREPARING', round: hostRound({ prepareSeq: 2 }), notice: 'AUDIO_REPLACED' })
    expect(screen.getByRole('status')).toHaveTextContent('Video lỗi, đã đổi bài khác')
  })

  it('shows the calibration screen', () => {
    const { push } = setup()
    push({ phase: 'CALIBRATING', calib: { round: 1, waitMs: 3000, flashed: false, tappedCount: 0 } })
    expect(screen.getByText('Đo độ trễ · Lượt 1/3')).toBeInTheDocument()
  })

  it('goes home when the room expires', () => {
    const { socket, push } = setup()
    push()
    socket.serverEmit('room:closed', { reason: 'EXPIRED' })
    expect(screen.getByTestId('location-state')).toHaveTextContent('Phòng đã hết hạn')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('closes the room from the results screen after confirmation', async () => {
    const { socket, user, push } = setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    push({ phase: 'FINISHED' })
    // Ở FINISHED chỉ còn nút của HostFinished, nút trên thanh đầu trang bị ẩn.
    await user.click(screen.getByRole('button', { name: 'Đóng phòng' }))
    expect(window.confirm).toHaveBeenCalledWith('Đóng phòng? Mọi người chơi sẽ bị đưa ra ngoài.')
    expect(socket.payloads('host:close_room')).toEqual([{}])
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Đã đóng phòng')
  })
})
