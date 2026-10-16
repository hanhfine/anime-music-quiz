import { render, renderHook, screen, within } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostRound, HostSnapshot } from '../lib/protocol'
import { installFakePlayer } from '../test/fakePlayer'
import { installFakeSocket, type FakeSocket } from '../test/fakeSocket'
import { hostRound, hostSnapshot } from '../test/snapshots'
import { FakePlayer } from './FakePlayer'
import { useAudioPlayer } from './useAudioPlayer'
import { useHostPlayback } from './useHostPlayback'

const preparing = (patch: Partial<HostRound> = {}) => hostSnapshot({ phase: 'PREPARING', round: hostRound(patch) })

let socket: FakeSocket
let player: FakePlayer

function renderPlayback(snapshot: HostSnapshot | null) {
  return renderHook((props: { snapshot: HostSnapshot | null }) => useHostPlayback(player, props.snapshot), {
    initialProps: { snapshot },
  })
}

beforeEach(() => {
  socket = installFakeSocket()
  player = new FakePlayer(document.createElement('div'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useHostPlayback', () => {
  it('loads the clip once per prepareSeq and reports audio_started once', () => {
    const { rerender } = renderPlayback(preparing())
    expect(player.loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }])

    rerender({ snapshot: preparing({ answeredCount: 0 }) }) // snapshot mới, cùng prepareSeq
    expect(player.loads).toHaveLength(1)

    player.emitPlaying()
    player.emitPlaying()
    expect(socket.payloads('host:audio_started')).toEqual([{ roundIndex: 0 }])
  })

  it('reloads when prepareSeq changes (replay or replacement)', () => {
    const { rerender } = renderPlayback(preparing())
    rerender({ snapshot: preparing({ prepareSeq: 2, videoId: 'BBBBBBBBBBB', startSec: 10, endSec: 40 }) })
    expect(player.loads.map((clip) => clip.videoId)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB'])
  })

  it('reports fatal player errors as audio_failed and ignores the rest', () => {
    renderPlayback(preparing({ index: 1 }))
    player.emitError(3)
    expect(socket.payloads('host:audio_failed')).toEqual([])
    player.emitError(150)
    player.emitError(100)
    expect(socket.payloads('host:audio_failed')).toEqual([{ roundIndex: 1, reason: 'ERROR_150' }])
  })

  it('reports TIMEOUT when the clip has not started after 10 seconds', async () => {
    vi.useFakeTimers()
    renderPlayback(preparing())
    await vi.advanceTimersByTimeAsync(9_999)
    expect(socket.payloads('host:audio_failed')).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.payloads('host:audio_failed')).toEqual([{ roundIndex: 0, reason: 'TIMEOUT' }])
  })

  it('keeps playing through ANSWERING and REVEAL without reporting again', async () => {
    vi.useFakeTimers()
    const { rerender } = renderPlayback(preparing())
    player.emitPlaying()
    rerender({ snapshot: hostSnapshot({ phase: 'ANSWERING', round: hostRound({ deadline: Date.now() + 18_000 }) }) })
    rerender({ snapshot: hostSnapshot({ phase: 'REVEAL', round: hostRound() }) })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(player.loads).toHaveLength(1)
    expect(player.stopCount).toBe(0)
    expect(socket.payloads('host:audio_started')).toHaveLength(1)
    expect(socket.payloads('host:audio_failed')).toEqual([])
  })

  it('stops the player in the lobby and when the game is finished', () => {
    const { rerender } = renderPlayback(hostSnapshot())
    expect(player.stopCount).toBe(1)
    rerender({ snapshot: preparing() })
    rerender({ snapshot: hostSnapshot({ phase: 'FINISHED' }) })
    expect(player.stopCount).toBe(2)
  })
})

function Stage() {
  const ref = useRef<HTMLDivElement>(null)
  const player = useAudioPlayer(ref)
  return <div ref={ref} data-testid="stage" data-ready={player ? 'yes' : 'no'} />
}

describe('useAudioPlayer', () => {
  it('creates the player inside the container and destroys it on unmount', () => {
    const players = installFakePlayer()
    const { unmount } = render(<Stage />)
    const stage = screen.getByTestId('stage')
    expect(stage).toHaveAttribute('data-ready', 'yes')
    expect(within(stage).getByTestId('fake-player')).toBeInTheDocument()
    expect(players).toHaveLength(1)
    unmount()
    expect(players[0].destroyed).toBe(true)
  })
})
