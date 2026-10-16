import { useLocation } from 'react-router'

// Đứng ở mọi route "lạ" trong test để kiểm tra trang đã điều hướng đi đâu.
export default function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="location-state">{JSON.stringify(location.state)}</div>
    </>
  )
}
