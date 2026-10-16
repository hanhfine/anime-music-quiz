import type { AudioPlayer, Clip } from './AudioPlayer'

interface Options {
  // Số ms sau mỗi load thì tự gọi onPlaying; null = chờ test gọi emitPlaying().
  autoPlayMs?: number | null
}

// Player giả cho unit test và E2E (VITE_FAKE_PLAYER=1): không tải YouTube, không phát tiếng.
export class FakePlayer implements AudioPlayer {
  loads: Clip[] = []
  stopCount = 0
  volume = 100
  destroyed = false
  private readonly screen: HTMLDivElement
  private readonly autoPlayMs: number | null
  private clip: Clip | null = null
  private startedAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private playingCallback = () => {}
  private errorCallback: (code: number) => void = () => {}

  constructor(container: HTMLElement, { autoPlayMs = null }: Options = {}) {
    this.autoPlayMs = autoPlayMs
    this.screen = document.createElement('div')
    this.screen.dataset.testid = 'fake-player'
    this.screen.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000'
    container.append(this.screen)
  }

  load(clip: Clip): void {
    this.clearTimer()
    this.clip = clip
    this.startedAt = null
    this.loads.push(clip)
    this.screen.textContent = `▶ ${clip.videoId} (${clip.startSec}s → ${clip.endSec}s)`
    if (this.autoPlayMs !== null) this.timer = setTimeout(() => this.emitPlaying(), this.autoPlayMs)
  }

  emitPlaying(): void {
    this.startedAt = Date.now()
    this.playingCallback()
  }

  emitError(code: number): void {
    this.errorCallback(code)
  }

  onPlaying(callback: () => void): void {
    this.playingCallback = callback
  }

  onError(callback: (code: number) => void): void {
    this.errorCallback = callback
  }

  setVolume(volume: number): void {
    this.volume = volume
  }

  stop(): void {
    this.clearTimer()
    this.clip = null
    this.stopCount += 1
    this.screen.textContent = ''
  }

  currentTime(): number {
    if (!this.clip) return 0
    return this.clip.startSec + (this.startedAt === null ? 0 : (Date.now() - this.startedAt) / 1000)
  }

  destroy(): void {
    this.clearTimer()
    this.destroyed = true
    this.screen.remove()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
