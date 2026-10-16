import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/renderRoute'
import Home from './Home'

describe('Home', () => {
  it('normalizes the room code and opens the player page', async () => {
    const { user } = renderRoute(<Home />)
    const join = screen.getByRole('button', { name: 'Vào phòng' })
    expect(join).toBeDisabled()
    await user.type(screen.getByLabelText('Mã phòng'), ' k7m-2qx ')
    expect(screen.getByLabelText('Mã phòng')).toHaveValue('K7M2QX')
    await user.click(join)
    expect(screen.getByTestId('location')).toHaveTextContent('/play/K7M2QX')
  })

  it('links hosts to the question sets', () => {
    renderRoute(<Home />)
    expect(screen.getByRole('link', { name: 'Tạo phòng' })).toHaveAttribute('href', '/sets')
  })

  it('shows a message passed through navigation state', () => {
    renderRoute(<Home />, { state: { message: 'Phòng không còn tồn tại' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Phòng không còn tồn tại')
  })
})
