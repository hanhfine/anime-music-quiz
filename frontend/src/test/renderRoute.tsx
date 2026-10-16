import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import LocationProbe from './LocationProbe'

interface Options {
  path?: string
  url?: string
  state?: unknown
}

// Vẽ một trang ở đúng route của nó; điều hướng sang route khác sẽ hiện LocationProbe.
export function renderRoute(element: ReactElement, { path = '/', url = path, state }: Options = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[{ pathname: url, state }]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
  return { user }
}
