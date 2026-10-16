import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isFatalError } from './AudioPlayer'
import { FakePlayer } from './FakePlayer'
import { DEFAULT_VOLUME, loadVolume, saveVolume } from './volume'
import { loadYouTubeApi, YouTubePlayer, type YTNamespace } from './YouTubePlayer'

interface FakeOptions {
  width: string
  height: string
  playerVars: Record<string, number>
  events: { onReady: () => void; onError: (event: { data: number }) => void }
}

// Thay cho YT.Player thật: test điều khiển state/currentTime và gọi các event.
class FakeYT {
  static instances: FakeYT[] = []
  element: HTMLElement
  options: FakeOptions
  state = -1
  time = 0
  volume = 100
  loads: unknown[] = []
  stops = 0
  destroyed = false

  constructor(element: HTMLElement, options: FakeOptions) {
    this.element = element
    this.options = options
    FakeYT.instances.push(this)
  }

  loadVideoById(args: unknown) {
    this.loads.push(args)
  }

  stopVideo() {
    this.stops += 1
  }

  getPlayerState() {
    return this.state
  }

  getCurrentTime() {
    return this.time
  }

  setVolume(volume: number) {
    this.volume = volume
  }

  destroy() {
    this.destroyed = true
  }
}

const installYT = () => {
  window.YT = { Player: FakeYT, PlayerState: { PLAYING: 1 } } as unknown as YTNamespace
}

const clip = { videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }

async function readyPlayer() {
  const container = document.createElement('div')
  const player = new YouTubePlayer(container)
  await vi.waitFor(() => expect(FakeYT.instances).toHaveLength(1))
  const yt = FakeYT.instances[0]
  return { container, player, yt }
}

beforeEach(() => {
  FakeYT.instances = []
})

afterEach(() => {
  delete window.YT
  vi.useRealTimers()
})

describe('loadYouTubeApi', () => {
  // Chạy trước các test khác trong file: các test sau gán sẵn window.YT nên không chèn script nữa.
  it('injects the IFrame API script once and resolves when it is ready', async () => {
    const first = loadYouTubeApi()
    expect(loadYouTubeApi()).toBe(first)
    expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1)
    installYT()
    window.onYouTubeIframeAPIReady?.()
    await expect(first).resolves.toBe(window.YT)
  })
})

describe('YouTubePlayer', () => {
  beforeEach(installYT)

  it('creates one player with the spec player vars inside its own element', async () => {
    const { container, player, yt } = await readyPlayer()
    expect(yt.options.playerVars).toEqual({ controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 })
    expect(yt.element.parentElement).toBe(container)
    player.destroy()
    expect(yt.destroyed).toBe(true)
    expect(container.childElementCount).toBe(0)
  })

  it('queues a load until the player is ready and applies the volume', async () => {
    const { player, yt } = await readyPlayer()
    player.setVolume(35)
    player.load(clip)
    expect(yt.loads).toEqual([])
    yt.options.events.onReady()
    expect(yt.loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSeconds: 30, endSeconds: 60 }])
    expect(yt.volume).toBe(35)
  })

  it('reports playing once, and only when the clip itself (not an ad) is playing', async () => {
    vi.useFakeTimers()
    const { player, yt } = await readyPlayer()
    yt.options.events.onReady()
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)

    yt.state = 1
    yt.time = 3 // quảng cáo: PLAYING nhưng chưa tới đoạn nhạc
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).not.toHaveBeenCalled()

    yt.time = 29.2
    await vi.advanceTimersByTimeAsync(250)
    expect(playing).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).toHaveBeenCalledTimes(1)
  })

  it('forwards errors, and stop() cancels the pending report', async () => {
    vi.useFakeTimers()
    const { player, yt } = await readyPlayer()
    yt.options.events.onReady()
    const playing = vi.fn()
    const error = vi.fn()
    player.onPlaying(playing)
    player.onError(error)
    player.load(clip)

    yt.options.events.onError({ data: 150 })
    expect(error).toHaveBeenCalledWith(150)

    player.stop()
    expect(yt.stops).toBe(1)
    yt.state = 1
    yt.time = 31
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).not.toHaveBeenCalled()
  })
})

describe('isFatalError', () => {
  it('treats the YouTube codes from the spec as fatal', () => {
    expect([2, 5, 100, 101, 150].every(isFatalError)).toBe(true)
    expect(isFatalError(3)).toBe(false)
  })
})

describe('FakePlayer', () => {
  it('shows the loaded clip and auto-plays after the configured delay', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const player = new FakePlayer(container, { autoPlayMs: 300 })
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)
    expect(container.querySelector('[data-testid="fake-player"]')).toHaveTextContent('AAAAAAAAAAA')
    await vi.advanceTimersByTimeAsync(299)
    expect(playing).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(playing).toHaveBeenCalledTimes(1)
    expect(player.currentTime()).toBe(30)
  })

  it('waits for emitPlaying() when auto-play is off and cancels on stop', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer(document.createElement('div'))
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)
    await vi.advanceTimersByTimeAsync(5000)
    expect(playing).not.toHaveBeenCalled()
    player.emitPlaying()
    expect(playing).toHaveBeenCalledTimes(1)
    player.stop()
    expect(player.stopCount).toBe(1)
    expect(player.currentTime()).toBe(0)
  })
})

describe('volume', () => {
  it('defaults to 80, persists and clamps', () => {
    expect(loadVolume()).toBe(DEFAULT_VOLUME)
    saveVolume(35)
    expect(loadVolume()).toBe(35)
    localStorage.setItem('animequiz:volume', '250')
    expect(loadVolume()).toBe(100)
    localStorage.setItem('animequiz:volume', 'abc')
    expect(loadVolume()).toBe(DEFAULT_VOLUME)
  })
})
