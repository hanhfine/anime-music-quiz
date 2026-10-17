import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerSnapshot } from '../lib/protocol'
import { loadRoomAuth, saveRoomAuth } from '../lib/roomAuth'
import { setSocketForTests } from '../lib/socket'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { playerRound, playerSnapshot } from '../test/snapshots'
import PlayScreen from './PlayScreen'

const CODE = 'K7M2QX'
const options = ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']

interface SetupOptions {
  token?: string | null
  rejoin?: object
  url?: string
}

function setup({ token = null, rejoin, url = `/play/${CODE}` }: SetupOptions = {}) {
  if (token) saveRoomAuth(CODE, { playerId: 'p1', playerToken: token })
  const socket = installFakeSocket()
  if (rejoin) socket.reply('player:rejoin', rejoin)
  const { user } = renderRoute(<PlayScreen />, { path: '/play/:code', url })
  const push = (patch: Partial<PlayerSnapshot> = {}) => socket.serverEmit('room:state', playerSnapshot(patch))
  return { socket, user, push }
}

afterEach(() => {
  setSocketForTests(null)
})

describe('PlayScreen', () => {
  it('asks for a name, joins, then shows the lobby', async () => {
    const { socket, user, push } = setup()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 'player-token' })
    expect(socket.payloads('player:rejoin')).toEqual([])
    await user.type(screen.getByLabelText('Tên của bạn'), 'Mai')
    await user.click(screen.getByRole('button', { name: 'Vào phòng' }))
    expect(await screen.findByText('Đang vào phòng…')).toBeInTheDocument()
    push()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
  })

  it('accepts a lower-case code in the link', () => {
    setup({ url: '/play/k7m2qx' })
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
  })

  it('rejoins with the saved token', () => {
    const { socket, push } = setup({ token: 'player-token' })
    expect(socket.payloads('player:rejoin')).toEqual([{ code: CODE, playerToken: 'player-token' }])
    push()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
  })

  it('asks for a name again when the saved token is no longer valid', async () => {
    setup({ token: 'old-token', rejoin: { ok: false, error: 'INVALID_TOKEN' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiên đã hết hạn, hãy vào lại phòng')
    expect(screen.getByLabelText('Tên của bạn')).toBeInTheDocument()
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('goes home when the room no longer exists', async () => {
    setup({ token: 'player-token', rejoin: { ok: false, error: 'ROOM_NOT_FOUND' } })
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Phòng không còn tồn tại')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('goes home when the host kicks the player', () => {
    const { socket, push } = setup({ token: 'player-token' })
    push()
    socket.serverEmit('room:closed', { reason: 'KICKED' })
    expect(screen.getByTestId('location-state')).toHaveTextContent('Bạn đã bị mời ra khỏi phòng')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('warns when the host is offline', () => {
    const { push } = setup({ token: 'player-token' })
    push({ hostOnline: false })
    expect(screen.getByRole('status')).toHaveTextContent('Quản trò mất kết nối, đang chờ…')
  })

  it('shows the calibration button and the final results', () => {
    const { push } = setup({ token: 'player-token' })
    push({ phase: 'CALIBRATING', calib: { round: 1, tapped: false } })
    expect(screen.getByRole('button', { name: 'BẤM' })).toBeInTheDocument()
    push({ phase: 'FINISHED', leaderboardTop: [] })
    expect(screen.getByText('Hạng 1/2')).toBeInTheDocument()
  })

  it('plays a question from answer to result', async () => {
    const { socket, user, push } = setup({ token: 'player-token' })
    push({ phase: 'PREPARING', round: playerRound() })
    expect(screen.getByText('Câu 1/2: chuẩn bị nghe…')).toBeInTheDocument()

    push({ phase: 'ANSWERING', round: playerRound({ options, deadline: Date.now() + 15_000 }) })
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(socket.payloads('player:answer')).toEqual([{ roundIndex: 0, optionIndex: 1 }])

    const result = { correctIndex: 0, correct: false, gained: 0, animeName: 'Shingeki no Kyojin', songLabel: null, team: null }
    push({ phase: 'REVEAL', round: playerRound({ options, myAnswer: 1, result }) })
    expect(screen.getByText('❌ Sai, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
  })

  it('unlocks the tiles when the question is replayed', async () => {
    const { user, push } = setup({ token: 'player-token' })
    const deadline = Date.now() + 15_000
    push({ phase: 'ANSWERING', round: playerRound({ options, deadline }) })
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeDisabled()
    // Phát lại câu: server xóa câu trả lời và đặt deadline mới.
    push({ phase: 'ANSWERING', round: playerRound({ options, deadline: deadline + 5000 }) })
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeEnabled()
  })

  it('shows my team and the team score in the header', () => {
    const { push } = setup({ token: 'player-token' })
    const teams = [
      { index: 0, name: 'Đội Đỏ', score: 0, rank: 2, gained: null, members: ['An'] },
      { index: 1, name: 'Đội Chanh', score: 1200, rank: 1, gained: null, members: ['Mai'] },
    ]
    push({ phase: 'PREPARING', round: playerRound(), me: { ...playerSnapshot().me, team: 1 }, teams })
    expect(screen.getByText('Đội Chanh')).toBeInTheDocument()
    expect(screen.getByText('1.200 điểm')).toBeInTheDocument()
  })
})
