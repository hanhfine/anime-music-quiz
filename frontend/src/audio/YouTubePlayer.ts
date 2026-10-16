import { START_TOLERANCE_SEC, type AudioPlayer, type Clip } from './AudioPlayer'

// Phần nhỏ của YouTube IFrame API mà app dùng.
interface YTPlayer {
  loadVideoById(args: { videoId: string; startSeconds: number; endSeconds: number }): void
  stopVideo(): void
  getPlayerState(): number
  getCurrentTime(): number
  setVolume(volume: number): void
  destroy(): void
}

interface YTPlayerOptions {
  width: string
  height: string
  playerVars: Record<string, number>
  events: { onReady: () => void; onError: (event: { data: number }) => void }
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
  PlayerState: { PLAYING: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const PLAYER_VARS = { controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 }
const POLL_MS = 250

let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const script = document.createElement('script')
    script.src = API_SRC
    script.onerror = () => console.error('Không tải được YouTube IFrame API')
    document.head.append(script)
  })
  return apiPromise
}

export class YouTubePlayer implements AudioPlayer {
  private readonly element: HTMLDivElement
  private player: YTPlayer | null = null
  private playingState = 1
  private ready = false
  private destroyed = false
  private pending: Clip | null = null
  private clip: Clip | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private volume = 100
  private playingCallback = () => {}
  private errorCallback: (code: number) => void = () => {}

  constructor(container: HTMLElement) {
    // Div này do player tự tạo, React không quản lý, nên iframe không bao giờ bị gỡ hay di chuyển.
    this.element = document.createElement('div')
    container.append(this.element)
    void loadYouTubeApi().then((YT) => {
      if (this.destroyed) return
      this.playingState = YT.PlayerState.PLAYING
      this.player = new YT.Player(this.element, {
        width: '100%',
        height: '100%',
        playerVars: PLAYER_VARS,
        events: {
          onReady: () => {
            this.ready = true
            this.player?.setVolume(this.volume)
            if (this.pending) this.load(this.pending)
          },
          onError: (event) => this.errorCallback(event.data),
        },
      })
    })
  }

  load(clip: Clip): void {
    this.stopPolling()
    if (!this.player || !this.ready) {
      this.pending = clip
      return
    }
    this.pending = null
    this.clip = clip
    this.player.loadVideoById({ videoId: clip.videoId, startSeconds: clip.startSec, endSeconds: clip.endSec })
    this.poll = setInterval(() => this.check(), POLL_MS)
  }

  onPlaying(callback: () => void): void {
    this.playingCallback = callback
  }

  onError(callback: (code: number) => void): void {
    this.errorCallback = callback
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.ready) this.player?.setVolume(volume)
  }

  stop(): void {
    this.pending = null
    this.clip = null
    this.stopPolling()
    if (this.ready) this.player?.stopVideo()
  }

  currentTime(): number {
    return this.ready && this.player ? this.player.getCurrentTime() : 0
  }

  destroy(): void {
    this.destroyed = true
    this.stopPolling()
    this.player?.destroy()
    this.element.remove()
  }

  private check(): void {
    if (!this.player || !this.clip) return
    const playing = this.player.getPlayerState() === this.playingState
    if (playing && this.player.getCurrentTime() >= this.clip.startSec - START_TOLERANCE_SEC) {
      this.clip = null
      this.stopPolling()
      this.playingCallback()
    }
  }

  private stopPolling(): void {
    if (this.poll !== null) clearInterval(this.poll)
    this.poll = null
  }
}
