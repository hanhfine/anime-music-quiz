import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeSocket } from '../test/fakeSocket'
import { setSocketForTests } from './socket'
import { useRoomSnapshot } from './useRoomSnapshot'

interface Snap {
  code: string
  serverNow: number
  phase: string
}

afterEach(() => {
  setSocketForTests(null)
  vi.useRealTimers()
})

describe('useRoomSnapshot', () => {
  it('authenticates on mount when connected and again on every reconnect', () => {
    const socket = installFakeSocket()
    const authenticate = vi.fn()
    renderHook(() => useRoomSnapshot<Snap>('ABC234', authenticate))
    expect(authenticate).toHaveBeenCalledTimes(1)
    socket.serverEmit('connect')
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it('waits for the connect event when the socket is not connected yet', () => {
    const socket = installFakeSocket()
    socket.connected = false
    const authenticate = vi.fn()
    renderHook(() => useRoomSnapshot<Snap>('ABC234', authenticate))
    expect(authenticate).not.toHaveBeenCalled()
    socket.serverEmit('connect')
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest snapshot of its own room and the clock offset', () => {
    vi.useFakeTimers({ now: 10_000 })
    const socket = installFakeSocket()
    const { result } = renderHook(() => useRoomSnapshot<Snap>('ABC234', () => {}))
    expect(result.current).toEqual({ snapshot: null, offset: 0, closedReason: null })

    socket.serverEmit('room:state', { code: 'ABC234', serverNow: 10_400, phase: 'LOBBY' })
    expect(result.current.snapshot?.phase).toBe('LOBBY')
    expect(result.current.offset).toBe(400)

    socket.serverEmit('room:state', { code: 'ZZZ999', serverNow: 99_999, phase: 'REVEAL' })
    expect(result.current.snapshot?.phase).toBe('LOBBY')
  })

  it('reports room:closed', () => {
    const socket = installFakeSocket()
    const { result } = renderHook(() => useRoomSnapshot<Snap>('ABC234', () => {}))
    socket.serverEmit('room:closed', { reason: 'KICKED' })
    expect(result.current.closedReason).toBe('KICKED')
  })

  it('uses the latest authenticate callback and unsubscribes on unmount', () => {
    const socket = installFakeSocket()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ auth }) => useRoomSnapshot<Snap>('ABC234', auth), {
      initialProps: { auth: first },
    })
    rerender({ auth: second })
    socket.serverEmit('connect')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
    socket.serverEmit('connect')
    expect(second).toHaveBeenCalledTimes(1)
  })
})
