import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'
import { newSet } from './lib/sets/schema'
import { saveSet } from './lib/sets/storage'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

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
})
