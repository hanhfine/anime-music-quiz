import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeSocket } from '../test/fakeSocket'
import { emitAck, setSocketForTests, type GameSocket } from './socket'

afterEach(() => {
  setSocketForTests(null)
  vi.useRealTimers()
})

describe('emitAck', () => {
  it('sends the payload and resolves with the ack', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 't1' })
    const ack = await emitAck('player:join', { code: 'ABC234', name: 'An' })
    expect(ack).toEqual({ ok: true, playerId: 'p1', playerToken: 't1' })
    expect(socket.sent).toEqual([{ event: 'player:join', payload: { code: 'ABC234', name: 'An' } }])
  })

  it('acks ok by default and supports computed replies', async () => {
    const socket = installFakeSocket()
    socket.reply('host:kick', (payload) => ({ ok: false, error: (payload as { playerId: string }).playerId }))
    expect(await emitAck('host:next')).toEqual({ ok: true })
    expect(await emitAck('host:kick', { playerId: 'INVALID_STATE' })).toEqual({ ok: false, error: 'INVALID_STATE' })
  })

  it('resolves NETWORK when the server never acks', async () => {
    vi.useFakeTimers()
    const silent: GameSocket = { connected: false, on: () => {}, off: () => {}, emit: () => {} }
    setSocketForTests(silent)
    const pending = emitAck('host:start', {}, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ ok: false, error: 'NETWORK' })
  })
})
