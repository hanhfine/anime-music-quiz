import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { setPlayerFactoryForTests } from './audio/createPlayer'
import { saveRoomAuth } from './lib/roomAuth'
import { newSet } from './lib/sets/schema'
import { saveSet } from './lib/sets/storage'
import { setSocketForTests } from './lib/socket'
import { installFakePlayer } from './test/fakePlayer'
import { installFakeSocket } from './test/fakeSocket'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

afterEach(() => {
  setSocketForTests(null)
  setPlayerFactoryForTests(null)
})

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    renderAt('/khong-co-trang-nay')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })

  it('routes / to the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Đoán anime qua nhạc/ })).toBeInTheDocument()
  })

  it('routes /sets to the set list', () => {
    renderAt('/sets')
    expect(screen.getByRole('heading', { name: 'Bộ câu hỏi' })).toBeInTheDocument()
  })

  it('routes /sets/:id to the editor', () => {
    const set = saveSet(newSet('Anime OP'))
    renderAt(`/sets/${set.id}`)
    expect(screen.getByRole('heading', { name: 'Soạn bộ câu hỏi' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên bộ câu hỏi')).toHaveValue('Anime OP')
  })

  it('routes /host/:code to the host screen', () => {
    saveRoomAuth('K7M2QX', { hostToken: 'host-token' })
    installFakeSocket()
    installFakePlayer()
    renderAt('/host/K7M2QX')
    expect(screen.getByText('Phòng K7M2QX')).toBeInTheDocument()
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
  })

  it('routes /play/:code to the player screen', () => {
    installFakeSocket()
    renderAt('/play/K7M2QX')
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
  })
})
