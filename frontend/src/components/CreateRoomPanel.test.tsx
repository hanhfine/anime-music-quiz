import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { loadRoomAuth } from '../lib/roomAuth'
import type { Song } from '../lib/sets/schema'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { CreateRoomPanel } from './CreateRoomPanel'

const makeSong = (i: number, patch: Partial<Song> = {}): Song => ({
  videoId: `video${String(i).padStart(6, '0')}`,
  videoTitle: `Bài ${i}`,
  durationSec: 240,
  animeName: `Anime ${i}`,
  songLabel: null,
  startSec: null,
  needsReview: false,
  ...patch,
})

const songs = (n: number) => Array.from({ length: n }, (_, i) => makeSong(i))

describe('CreateRoomPanel', () => {
  it('explains why the room cannot be created yet', () => {
    renderRoute(<CreateRoomPanel songs={[makeSong(1), makeSong(2, { needsReview: true })]} />)
    expect(screen.getByText('Còn 1 bài chưa xác nhận tên anime')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeDisabled()
  })

  it('defaults the question count to the smaller of 10 and the song count', () => {
    renderRoute(<CreateRoomPanel songs={songs(3)} />)
    expect(screen.getByLabelText('Số câu')).toHaveValue(3)
  })

  it('creates the room with clamped settings and opens the host screen', async () => {
    const socket = installFakeSocket()
    socket.reply('host:create_room', { ok: true, code: 'K7M2QX', hostToken: 'tok-1' })
    const list = songs(12)
    const { user } = renderRoute(<CreateRoomPanel songs={list} />)
    expect(screen.getByLabelText('Số câu')).toHaveValue(10)

    await user.clear(screen.getByLabelText('Độ dài đoạn nhạc (giây)'))
    await user.type(screen.getByLabelText('Độ dài đoạn nhạc (giây)'), '99')
    await user.clear(screen.getByLabelText('Số người tối đa'))
    await user.click(screen.getByRole('button', { name: 'Tạo phòng' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/host/K7M2QX')
    expect(socket.payloads('host:create_room')).toEqual([
      {
        set: { songs: list },
        settings: { questionCount: 10, clipSec: 30, revealSec: 15, maxPlayers: 2, mode: 'stream' },
      },
    ])
    expect(loadRoomAuth('K7M2QX')).toEqual({ hostToken: 'tok-1' })
  })

  it('shows the server error and lets the host retry', async () => {
    const socket = installFakeSocket()
    socket.reply('host:create_room', { ok: false, error: 'INVALID_SET' })
    const { user } = renderRoute(<CreateRoomPanel songs={songs(2)} />)
    await user.click(screen.getByRole('button', { name: 'Tạo phòng' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bộ câu hỏi hoặc thiết lập phòng không hợp lệ')
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeEnabled()
  })
})
